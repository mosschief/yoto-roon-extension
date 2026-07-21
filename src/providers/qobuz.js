import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { request } from '../http.js';

const API = 'https://www.qobuz.com/api.json/0.2';
const WEB_PLAYER = 'https://play.qobuz.com';
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

/** Locate the app credentials Qobuz's own web player ships in its JS bundle. Exported for tests. */
export function extractAppId(bundleJs) {
  const m = bundleJs.match(/production:\s*\{\s*api:\s*\{\s*appId:\s*"(\d+)"\s*,\s*appSecret:\s*"([a-zA-Z0-9]+)"/);
  return m ? { appId: m[1], appSecret: m[2] } : null;
}

/**
 * Qobuz provider. Qobuz has no open developer signup, so if QOBUZ_APP_ID isn't
 * set we discover the app id Qobuz's own web player uses (the approach
 * open-source Qobuz clients take) and cache it. You authenticate with your own
 * Qobuz account: QOBUZ_USERNAME + QOBUZ_PASSWORD (plaintext, or its MD5 hash).
 */
export class QobuzProvider {
  constructor({ appId, appSecret, username, password, dataDir }) {
    if (!username || !password) {
      throw new Error('QOBUZ_USERNAME and QOBUZ_PASSWORD are required for the qobuz provider');
    }
    this.appId = appId || null;
    this.appSecret = appSecret || null;
    this.username = username;
    this.password = password;
    this.appFile = path.join(dataDir, 'qobuz-app.json');
    this.sessionFile = path.join(dataDir, 'qobuz-session.json');
    this.userAuthToken = null;
  }

  async #ensureAppId() {
    if (this.appId) return this.appId;
    if (fs.existsSync(this.appFile)) {
      const cached = JSON.parse(fs.readFileSync(this.appFile, 'utf8'));
      if (cached.appId) {
        this.appId = cached.appId;
        this.appSecret ??= cached.appSecret;
        return this.appId;
      }
    }
    const { data: loginHtml } = await request(`${WEB_PLAYER}/login`, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    });
    const bundlePath = loginHtml.match(/src="(\/resources\/[^"]+\/bundle\.js)"/)?.[1];
    if (!bundlePath) throw new Error('Could not locate the Qobuz web player bundle to discover an app id — set QOBUZ_APP_ID manually');
    const { data: bundle } = await request(`${WEB_PLAYER}${bundlePath}`, {
      headers: { 'User-Agent': BROWSER_UA },
    });
    const found = extractAppId(bundle);
    if (!found) throw new Error('Could not extract an app id from the Qobuz web player bundle — set QOBUZ_APP_ID manually');
    this.appId = found.appId;
    this.appSecret ??= found.appSecret;
    fs.mkdirSync(path.dirname(this.appFile), { recursive: true });
    fs.writeFileSync(this.appFile, JSON.stringify(found, null, 2));
    return this.appId;
  }

  async #login() {
    if (this.userAuthToken) return this.userAuthToken;
    if (fs.existsSync(this.sessionFile)) {
      this.userAuthToken = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8')).user_auth_token;
      if (this.userAuthToken) return this.userAuthToken;
    }
    const appId = await this.#ensureAppId();
    // Qobuz's login endpoint expects the MD5 hash of the password; accept a
    // pre-hashed value (32 hex chars) as-is and fall back to the raw string
    // for robustness.
    const alreadyHashed = /^[a-f0-9]{32}$/i.test(this.password);
    const attempts = alreadyHashed ? [this.password] : [md5(this.password), this.password];
    let lastErr;
    for (const password of attempts) {
      try {
        const { data } = await request(`${API}/user/login`, {
          method: 'POST',
          headers: { 'X-App-Id': appId },
          form: { username: this.username, password, app_id: appId },
        });
        this.userAuthToken = data.user_auth_token;
        fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true });
        fs.writeFileSync(this.sessionFile, JSON.stringify({ user_auth_token: this.userAuthToken }, null, 2));
        return this.userAuthToken;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`Qobuz login failed for ${this.username}: ${lastErr?.message ?? 'unknown error'}`);
  }

  async #call(endpoint, { method = 'GET', params = {} } = {}) {
    const token = await this.#login();
    const headers = { 'X-App-Id': this.appId, 'X-User-Auth-Token': token };
    if (method === 'GET') {
      const qs = new URLSearchParams(params).toString();
      const { data } = await request(`${API}/${endpoint}?${qs}`, { headers });
      return data;
    }
    const { data } = await request(`${API}/${endpoint}`, { method, headers, form: params });
    return data;
  }

  async findTrackByIsrc() {
    return null; // Qobuz search has no public ISRC filter; fall back to fuzzy search
  }

  async searchTracks(query) {
    const data = await this.#call('track/search', { params: { query, limit: 25 } });
    return (data.tracks?.items ?? []).map((t) => ({
      id: t.id,
      title: t.title ?? '',
      isrc: t.isrc ?? null,
      artists: [t.performer?.name].filter(Boolean),
    }));
  }

  async searchAlbums(query) {
    const data = await this.#call('album/search', { params: { query, limit: 25 } });
    return (data.albums?.items ?? []).map((a) => ({
      id: a.id,
      title: a.title ?? '',
      artists: [a.artist?.name].filter(Boolean),
    }));
  }

  async getAlbumTrackIds(albumId) {
    const data = await this.#call('album/get', { params: { album_id: albumId, limit: 500 } });
    return (data.tracks?.items ?? []).map((t) => t.id);
  }

  async createPlaylist(name, description) {
    const data = await this.#call('playlist/create', {
      method: 'POST',
      params: { name, description: description ?? '', is_public: 'false', is_collaborative: 'false' },
    });
    return String(data.id);
  }

  async addTracks(playlistId, trackIds) {
    await this.#call('playlist/addTracks', {
      method: 'POST',
      params: { playlist_id: playlistId, track_ids: trackIds.join(','), no_duplicate: 'true' },
    });
  }
}
