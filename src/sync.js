import { log } from './log.js';
import { pickBestAlbum, pickBestTrack } from './match.js';
import { State } from './state.js';
import { fetchBestNewMusic } from './sources/pitchfork.js';
import { SpotifySource } from './sources/spotify.js';
import { QobuzProvider } from './providers/qobuz.js';
import { TidalProvider } from './providers/tidal.js';

export function buildProvider(config) {
  const { env } = config;
  if (config.provider === 'qobuz') {
    return new QobuzProvider({
      appId: env.qobuzAppId,
      appSecret: env.qobuzAppSecret,
      username: env.qobuzUsername,
      password: env.qobuzPassword,
      dataDir: config.dataDir,
    });
  }
  return new TidalProvider({
    clientId: env.tidalClientId,
    redirectUri: env.tidalRedirectUri,
    countryCode: config.countryCode,
    dataDir: config.dataDir,
  });
}

async function ensurePlaylist(provider, state, playlistKey, name, description) {
  let id = state.getPlaylistId(playlistKey);
  if (id) return id;
  id = await provider.createPlaylist(name, description);
  state.setPlaylistId(playlistKey, id, name);
  state.save();
  log.info(`Created playlist "${name}" (${id})`);
  return id;
}

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
const SEASONS = 'spring|summer|autumn|fall|winter';

/**
 * Reduce a playlist title to its series name by stripping a trailing dated or
 * numbered edition marker, so successive editions group together:
 *   "Radio Free Aquarium Drunkard :: May 2026" -> "Radio Free Aquarium Drunkard"
 *   "AD Guide To Drag City: Vol. II"           -> "AD Guide To Drag City"
 * Titles without such a marker (one-offs) are returned unchanged, i.e. each is
 * its own series. Exported for tests.
 */
export function deriveSeries(name) {
  let s = (name || '').trim();
  const dc = s.indexOf('::'); // AD's standard dated-edition separator
  if (dc !== -1) {
    s = s.slice(0, dc);
  } else {
    s = s.replace(/\s*[:\-–—]?\s*(vol\.?|volume|part|pt\.?|no\.?|#)\s*[ivxlcdm0-9]+\s*$/i, '');
    const tail = new RegExp(`\\s*[:\\-–—]?\\s*((${MONTHS}|${SEASONS})(\\s+\\d{4})?|\\d{4})\\s*$`, 'i');
    s = s.replace(tail, '');
  }
  s = s.replace(/[\s:–—-]+$/, '').replace(/\s+/g, ' ').trim();
  return s || (name || '').trim();
}

/** Stable state/playlist key for a series display name. */
export function seriesKey(seriesName) {
  return `ad-series:${seriesName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * Choose which of a user's playlists to mirror. Applies an optional name regex
 * filter, restricts to playlists actually owned by the user, and caps the
 * count. Exported for tests.
 */
export function selectDiscoveredPlaylists(playlists, { userId, nameFilter, max } = {}) {
  let picked = playlists.filter((p) => p.trackCount > 0);
  if (userId) picked = picked.filter((p) => !p.owner || p.owner === userId);
  if (nameFilter) {
    const re = new RegExp(nameFilter, 'i');
    picked = picked.filter((p) => re.test(p.name));
  }
  if (max && max > 0) picked = picked.slice(0, max);
  return picked;
}

/** Resolve one wanted track to a provider track id (ISRC first, then fuzzy search). */
async function resolveTrack(provider, want) {
  if (want.isrc) {
    const hit = await provider.findTrackByIsrc(want.isrc);
    if (hit) return [hit.id];
  }
  const candidates = await provider.searchTracks(`${want.artist} ${want.title}`);
  const best = pickBestTrack(want, candidates);
  return best ? [best.id] : null;
}

/** Resolve a wanted album to its track ids on the provider. */
async function resolveAlbum(provider, want, maxTracks) {
  const candidates = await provider.searchAlbums(`${want.artist} ${want.album}`);
  const best = pickBestAlbum(want, candidates);
  if (!best) return null;
  let ids = await provider.getAlbumTrackIds(best.id);
  if (maxTracks > 0) ids = ids.slice(0, maxTracks);
  return ids.length ? ids : null;
}

/**
 * Add a list of wanted items to a provider playlist, deduped via state.
 * Each item: { key, label, kind: 'track'|'album', ...trackOrAlbumFields }.
 */
export async function syncItems({ provider, state, playlistKey, playlistName, description, items, maxTracksPerAlbum }) {
  const pending = items.filter(
    (it) => !state.hasItem(playlistKey, it.key) && !state.isGivenUp(playlistKey, it.key),
  );
  if (!pending.length) {
    log.info(`[${playlistName}] nothing new (${items.length} items already synced or exhausted)`);
    return { added: 0, unmatched: 0 };
  }

  const playlistId = await ensurePlaylist(provider, state, playlistKey, playlistName, description);
  let added = 0;
  let unmatched = 0;

  for (const item of pending) {
    try {
      const trackIds =
        item.kind === 'album'
          ? await resolveAlbum(provider, item, maxTracksPerAlbum ?? 0)
          : await resolveTrack(provider, item);

      if (!trackIds) {
        unmatched++;
        const gaveUp = state.bumpUnmatched(playlistKey, item.key, item.label);
        log.warn(`[${playlistName}] no match for ${item.label}${gaveUp ? ' (giving up)' : ''}`);
        continue;
      }

      await provider.addTracks(playlistId, trackIds);
      state.markAdded(playlistKey, item.key, { label: item.label, trackIds });
      added++;
      log.info(`[${playlistName}] added ${item.label} (${trackIds.length} track${trackIds.length === 1 ? '' : 's'})`);
    } catch (err) {
      log.error(`[${playlistName}] failed on ${item.label}: ${err.message}`);
    } finally {
      state.save();
    }
  }

  return { added, unmatched };
}

export async function runSync(config) {
  const provider = buildProvider(config);
  const state = State.load(config.dataDir);

  if (config.pitchfork?.enabled) {
    const { includeAlbums = true, includeTracks = true, maxTracksPerAlbum = 0 } = config.pitchfork;
    log.info('Fetching Pitchfork Best New Music feeds...');
    const bnm = await fetchBestNewMusic({ includeAlbums, includeTracks });
    log.info(`Pitchfork: ${bnm.albums.length} BNM albums, ${bnm.tracks.length} BNM tracks in feed`);

    const items = [
      ...bnm.tracks.map((t) => ({
        key: `pitchfork-track:${t.id}`,
        label: `${t.artist} — "${t.title}"`,
        kind: 'track',
        artist: t.artist,
        title: t.title,
      })),
      ...bnm.albums.map((a) => ({
        key: `pitchfork-album:${a.id}`,
        label: `${a.artist} — ${a.album} (album)`,
        kind: 'album',
        artist: a.artist,
        album: a.album,
      })),
    ];

    await syncItems({
      provider,
      state,
      playlistKey: 'pitchfork-bnm',
      playlistName: config.pitchfork.playlistName || 'Pitchfork: Best New Music',
      description: 'Auto-synced from Pitchfork Best New Music. github.com/mosschief/yoto-roon-extension',
      items,
      maxTracksPerAlbum,
    });
  }

  if (config.aquariumDrunkard?.enabled) {
    const ad = config.aquariumDrunkard;
    const spotify = new SpotifySource({
      clientId: config.env.spotifyClientId,
      clientSecret: config.env.spotifyClientSecret,
    });

    const fallbackName = ad.playlistName || 'Aquarium Drunkard';
    // Sources carry a name so editions can be grouped into a series playlist.
    // Explicit IDs have no known name, so they fall back to one combined list.
    let sources = (ad.spotifyPlaylistIds ?? []).map((id) => ({ id, name: null }));

    // Auto-discover from the AD Spotify user when no explicit IDs are given.
    if (!sources.length && ad.autoDiscover !== false) {
      const user = ad.spotifyUser || 'aquariumdrunkard';
      try {
        log.info(`Auto-discovering Aquarium Drunkard playlists from Spotify user "${user}"...`);
        const all = await spotify.getUserPlaylists(user);
        const picked = selectDiscoveredPlaylists(all, {
          userId: user,
          nameFilter: ad.nameFilter || '',
          max: ad.maxPlaylists ?? 4,
        });
        sources = picked.map((p) => ({ id: p.id, name: p.name }));
        log.info(`Discovered ${all.length} playlists, mirroring ${sources.length}: ${picked.map((p) => `"${p.name}"`).join(', ') || '(none matched)'}`);
      } catch (err) {
        log.warn(`Auto-discovery failed: ${err.message}`);
      }
    }

    if (!sources.length) {
      log.warn('Aquarium Drunkard: no playlists to sync (none discovered and none configured) — skipping');
    } else {
      log.info(`Reading Spotify playlists via ${spotify.hasApi ? 'the official API' : 'the public embed page (no Spotify credentials configured)'}`);
      // Group source playlists into one target playlist per series.
      const groups = new Map();
      for (const src of sources) {
        const seriesName = src.name ? deriveSeries(src.name) : fallbackName;
        const key = seriesKey(seriesName);
        log.info(`Fetching Spotify playlist ${src.id}${src.name ? ` ("${src.name}")` : ''} → series "${seriesName}"...`);
        const tracks = await spotify.getPlaylistTracks(src.id);
        log.info(`Spotify ${src.id}: ${tracks.length} tracks`);
        const group = groups.get(key) ?? { name: seriesName, items: [] };
        for (const t of tracks) {
          group.items.push({
            key: `spotify-track:${t.id}`,
            label: `${t.artist} — "${t.title}"`,
            kind: 'track',
            artist: t.artist,
            title: t.title,
            isrc: t.isrc,
          });
        }
        groups.set(key, group);
      }

      for (const [key, group] of groups) {
        await syncItems({
          provider,
          state,
          playlistKey: key,
          playlistName: group.name,
          description: 'Auto-mirrored from Aquarium Drunkard on Spotify.',
          items: group.items,
        });
      }
    }
  }

  log.info('Sync complete.');
}
