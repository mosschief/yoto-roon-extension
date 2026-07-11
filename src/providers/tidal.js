import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { request } from '../http.js';

const AUTHORIZE_URL = 'https://login.tidal.com/authorize';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const API = 'https://openapi.tidal.com/v2';
const SCOPES = 'playlists.read playlists.write user.read';
const JSONAPI = 'application/vnd.api+json';
const ADD_BATCH_SIZE = 20;

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * TIDAL provider using the v2 openapi (JSON:API) with Authorization Code +
 * PKCE. Run `npm run auth:tidal` once; tokens are stored in
 * data/tidal-tokens.json and refreshed automatically afterwards.
 */
export class TidalProvider {
  constructor({ clientId, redirectUri, countryCode, dataDir }) {
    if (!clientId) throw new Error('TIDAL_CLIENT_ID is required (create an app at developer.tidal.com)');
    this.clientId = clientId;
    this.redirectUri = redirectUri;
    this.countryCode = countryCode || 'US';
    this.tokenFile = path.join(dataDir, 'tidal-tokens.json');
  }

  // ---- auth -------------------------------------------------------------

  #loadTokens() {
    if (!fs.existsSync(this.tokenFile)) return null;
    return JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
  }

  #saveTokens(tokens) {
    fs.mkdirSync(path.dirname(this.tokenFile), { recursive: true });
    fs.writeFileSync(this.tokenFile, JSON.stringify(tokens, null, 2));
  }

  async authInteractive() {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const url = new URL(this.redirectUri);
    const port = Number(url.port || 80);

    const authUrl =
      `${AUTHORIZE_URL}?response_type=code` +
      `&client_id=${encodeURIComponent(this.clientId)}` +
      `&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&code_challenge_method=S256&code_challenge=${challenge}`;

    console.log('\nOpen this URL in your browser and log in to TIDAL:\n');
    console.log(`  ${authUrl}\n`);
    console.log(`Waiting for the redirect on ${this.redirectUri} ...`);

    const code = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url, `http://${req.headers.host}`);
        if (reqUrl.pathname !== url.pathname) {
          res.writeHead(404).end();
          return;
        }
        const err = reqUrl.searchParams.get('error');
        const c = reqUrl.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(err ? `Authorization failed: ${err}` : 'Authorized — you can close this tab.');
        server.close();
        err ? reject(new Error(`TIDAL authorization failed: ${err}`)) : resolve(c);
      });
      server.on('error', reject);
      // Bind all interfaces (not just the loopback in the redirect URI) so the
      // callback is reachable when this runs inside Docker with a published
      // port; override with AUTH_BIND_HOST if you want it stricter.
      server.listen(port, process.env.AUTH_BIND_HOST || '0.0.0.0');
    });

    const { data } = await request(TOKEN_URL, {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        client_id: this.clientId,
        code_verifier: verifier,
      },
    });
    this.#saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });
    console.log('TIDAL authorization complete; tokens saved.');
  }

  async #accessToken() {
    const tokens = this.#loadTokens();
    if (!tokens) throw new Error('No TIDAL tokens found — run `npm run auth:tidal` first');
    if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;

    const { data } = await request(TOKEN_URL, {
      method: 'POST',
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: this.clientId,
      },
    });
    this.#saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? tokens.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });
    return data.access_token;
  }

  async #api(pathAndQuery, opts = {}) {
    const token = await this.#accessToken();
    let url = `${API}${pathAndQuery}`;
    if (!/[?&]countryCode=/.test(url)) {
      url += `${url.includes('?') ? '&' : '?'}countryCode=${this.countryCode}`;
    }
    const { data } = await request(url, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: JSONAPI,
        ...(opts.json !== undefined ? { 'Content-Type': JSONAPI } : {}),
        ...opts.headers,
      },
    });
    return data;
  }

  // ---- JSON:API helpers ---------------------------------------------------

  /** Resolve artist names for a resource from a JSON:API `included` array. */
  #artistNames(resource, included) {
    const refs = resource.relationships?.artists?.data ?? [];
    const byId = new Map((included ?? []).filter((r) => r.type === 'artists').map((r) => [r.id, r]));
    return refs.map((ref) => byId.get(ref.id)?.attributes?.name).filter(Boolean);
  }

  #searchCandidates(data, type) {
    const included = data.included ?? [];
    return included
      .filter((r) => r.type === type)
      .map((r) => ({
        id: r.id,
        title: r.attributes?.title ?? '',
        isrc: r.attributes?.isrc ?? null,
        artists: this.#artistNames(r, included),
      }));
  }

  // ---- provider interface -------------------------------------------------

  async findTrackByIsrc(isrc) {
    try {
      const data = await this.#api(`/tracks?filter%5Bisrc%5D=${encodeURIComponent(isrc)}`);
      const hit = data.data?.[0];
      return hit ? { id: hit.id, title: hit.attributes?.title ?? '' } : null;
    } catch {
      return null;
    }
  }

  async searchTracks(query) {
    const data = await this.#api(
      `/searchresults/${encodeURIComponent(query)}?include=tracks,tracks.artists`,
    );
    return this.#searchCandidates(data, 'tracks');
  }

  async searchAlbums(query) {
    const data = await this.#api(
      `/searchresults/${encodeURIComponent(query)}?include=albums,albums.artists`,
    );
    return this.#searchCandidates(data, 'albums');
  }

  async getAlbumTrackIds(albumId) {
    const ids = [];
    let next = `/albums/${albumId}/relationships/items`;
    while (next) {
      const data = await this.#api(next);
      for (const item of data.data ?? []) {
        if (item.type === 'tracks') ids.push(item.id);
      }
      // links.next is a path relative to the API base, e.g.
      // "/albums/123/relationships/items?page[cursor]=...&countryCode=US"
      next = data.links?.next ? data.links.next.replace(/^\/v2/, '') : null;
    }
    return ids;
  }

  async createPlaylist(name, description) {
    const data = await this.#api('/playlists', {
      method: 'POST',
      json: {
        data: {
          type: 'playlists',
          attributes: { name, description, accessType: 'UNLISTED' },
        },
      },
    });
    return data.data.id;
  }

  async addTracks(playlistId, trackIds) {
    for (let i = 0; i < trackIds.length; i += ADD_BATCH_SIZE) {
      const batch = trackIds.slice(i, i + ADD_BATCH_SIZE);
      await this.#api(`/playlists/${playlistId}/relationships/items`, {
        method: 'POST',
        json: { data: batch.map((id) => ({ id: String(id), type: 'tracks' })) },
      });
    }
  }
}
