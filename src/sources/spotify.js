import { request } from '../http.js';

const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

/**
 * Read-only Spotify client (client-credentials flow) used to mirror public
 * playlists such as Aquarium Drunkard's. No user login required.
 */
export class SpotifyClient {
  constructor({ clientId, clientSecret }) {
    if (!clientId || !clientSecret) {
      throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are required to mirror Spotify playlists');
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async #getToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const { data } = await request(ACCOUNTS, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` },
      form: { grant_type: 'client_credentials' },
    });
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }

  async #get(path) {
    const token = await this.#getToken();
    const { data } = await request(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  }

  async getPlaylistName(playlistId) {
    const data = await this.#get(`/playlists/${playlistId}?fields=name`);
    return data.name;
  }

  /**
   * All tracks of a playlist as { id, artist, artists, title, album, isrc }.
   * Skips local files and episodes.
   */
  async getPlaylistTracks(playlistId) {
    const tracks = [];
    const fields = 'items(track(id,name,is_local,type,external_ids(isrc),album(name),artists(name))),next';
    let offset = 0;
    for (;;) {
      const data = await this.#get(
        `/playlists/${playlistId}/tracks?limit=100&offset=${offset}&fields=${encodeURIComponent(fields)}`,
      );
      for (const item of data.items ?? []) {
        const t = item.track;
        if (!t || t.is_local || (t.type && t.type !== 'track') || !t.id) continue;
        const artists = (t.artists ?? []).map((a) => a.name).filter(Boolean);
        tracks.push({
          id: t.id,
          artist: artists.join(', '),
          artists,
          title: t.name,
          album: t.album?.name ?? '',
          isrc: t.external_ids?.isrc ?? null,
        });
      }
      if (!data.next || !(data.items ?? []).length) break;
      offset += 100;
    }
    return tracks;
  }
}
