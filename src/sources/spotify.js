import { request } from '../http.js';

const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const EMBED = 'https://open.spotify.com/embed/playlist/';
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * Reads public Spotify playlists (e.g. Aquarium Drunkard's) two ways:
 *  - with SPOTIFY_CLIENT_ID/SECRET: the official API (richer data, incl. ISRC)
 *  - without credentials: the public embed page, which serves the track list
 *    as JSON — no Spotify account needed at all
 */
export class SpotifySource {
  constructor({ clientId, clientSecret } = {}) {
    this.hasApi = Boolean(clientId && clientSecret);
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async getPlaylistTracks(playlistId) {
    return this.hasApi ? this.#apiTracks(playlistId) : this.#embedTracks(playlistId);
  }

  // ---- official API (client-credentials) --------------------------------

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

  async #apiTracks(playlistId) {
    const token = await this.#getToken();
    const tracks = [];
    const fields = 'items(track(id,name,is_local,type,external_ids(isrc),album(name),artists(name))),next';
    let offset = 0;
    for (;;) {
      const { data } = await request(
        `${API}/playlists/${playlistId}/tracks?limit=100&offset=${offset}&fields=${encodeURIComponent(fields)}`,
        { headers: { Authorization: `Bearer ${token}` } },
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

  // ---- credential-free embed page ---------------------------------------

  async #embedTracks(playlistId) {
    const { data: html } = await request(`${EMBED}${playlistId}`, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    });
    const tracks = parseEmbedTracks(html);
    if (!tracks) {
      throw new Error(
        `Could not parse the Spotify embed page for playlist ${playlistId}. ` +
          'Spotify may have changed the page format — set SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET to use the official API instead.',
      );
    }
    return tracks;
  }
}

/** Depth-first search for a `trackList` array anywhere in the embed's JSON blob. */
function findTrackList(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node.trackList)) return node.trackList;
  for (const value of Object.values(node)) {
    const found = findTrackList(value);
    if (found) return found;
  }
  return null;
}

/**
 * The embed page ships its data in a JSON <script> block; each track entry has
 * { uri: "spotify:track:ID", title, subtitle (artist names) }. Exported for tests.
 */
export function parseEmbedTracks(html) {
  const m = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const list = findTrackList(data);
  if (!list) return null;
  const tracks = [];
  for (const item of list) {
    const id = /^spotify:track:([A-Za-z0-9]+)$/.exec(item.uri ?? '')?.[1];
    if (!id || !item.title) continue;
    const artist = item.subtitle ?? '';
    tracks.push({
      id,
      artist,
      artists: artist.split(',').map((s) => s.trim()).filter(Boolean),
      title: item.title,
      album: '',
      isrc: null,
    });
  }
  return tracks;
}
