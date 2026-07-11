import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { request } from '../http.js';

const API = 'https://www.qobuz.com/api.json/0.2';

/**
 * Qobuz provider. Qobuz has no open developer signup — you need an app_id
 * (and app_secret for signed endpoints) issued by Qobuz. Login is
 * username/password; the user_auth_token is cached in data/qobuz-session.json.
 */
export class QobuzProvider {
  constructor({ appId, appSecret, username, password, dataDir }) {
    if (!appId || !username || !password) {
      throw new Error('QOBUZ_APP_ID, QOBUZ_USERNAME and QOBUZ_PASSWORD are required for the qobuz provider');
    }
    this.appId = appId;
    this.appSecret = appSecret || '';
    this.username = username;
    this.password = password;
    this.sessionFile = path.join(dataDir, 'qobuz-session.json');
    this.userAuthToken = null;
  }

  async #login() {
    if (this.userAuthToken) return this.userAuthToken;
    if (fs.existsSync(this.sessionFile)) {
      this.userAuthToken = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8')).user_auth_token;
      if (this.userAuthToken) return this.userAuthToken;
    }
    const { data } = await request(`${API}/user/login`, {
      method: 'POST',
      headers: { 'X-App-Id': this.appId },
      form: { username: this.username, password: this.password, app_id: this.appId },
    });
    this.userAuthToken = data.user_auth_token;
    fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true });
    fs.writeFileSync(this.sessionFile, JSON.stringify({ user_auth_token: this.userAuthToken }, null, 2));
    return this.userAuthToken;
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

  /** Some endpoints require a signed request (md5 over endpoint+params+ts+secret). */
  sign(endpoint, params, ts) {
    const flat = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
    return crypto
      .createHash('md5')
      .update(`${endpoint.replace(/\//g, '')}${flat}${ts}${this.appSecret}`)
      .digest('hex');
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
