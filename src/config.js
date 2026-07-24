import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

/** Minimal .env loader (KEY=VALUE lines, # comments). Does not override existing env. */
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

function envStr(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envBool(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v);
}

function envNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : fallback;
}

/**
 * Settings may come from config.json or from environment variables
 * (environment wins). The env names exist so Docker/Unraid deployments can be
 * configured entirely from the container template with no file edits.
 */
function applyEnvOverrides(config) {
  config.provider = envStr('PROVIDER', config.provider);
  config.countryCode = envStr('COUNTRY_CODE', config.countryCode);
  config.loopIntervalHours = envNum('LOOP_INTERVAL_HOURS', config.loopIntervalHours);

  const pf = (config.pitchfork ??= {});
  pf.enabled = envBool('PITCHFORK_ENABLED', pf.enabled);
  pf.includeAlbums = envBool('PITCHFORK_INCLUDE_ALBUMS', pf.includeAlbums);
  pf.includeTracks = envBool('PITCHFORK_INCLUDE_TRACKS', pf.includeTracks);
  pf.maxTracksPerAlbum = envNum('PITCHFORK_MAX_TRACKS_PER_ALBUM', pf.maxTracksPerAlbum);
  pf.albumMode = envStr('PITCHFORK_ALBUM_MODE', pf.albumMode || 'tracks');
  pf.tracksPlaylistName = envStr('PITCHFORK_TRACKS_PLAYLIST_NAME', pf.tracksPlaylistName);
  pf.albumsPlaylistName = envStr('PITCHFORK_ALBUMS_PLAYLIST_NAME', pf.albumsPlaylistName);
  pf.playlistName = envStr('PITCHFORK_PLAYLIST_NAME', pf.playlistName); // legacy fallback for tracks

  const ad = (config.aquariumDrunkard ??= {});
  ad.enabled = envBool('AD_ENABLED', ad.enabled);
  ad.playlistName = envStr('AD_PLAYLIST_NAME', ad.playlistName);
  ad.autoDiscover = envBool('AD_AUTO_DISCOVER', ad.autoDiscover ?? true);
  ad.spotifyUser = envStr('AD_SPOTIFY_USER', ad.spotifyUser || 'aquariumdrunkard');
  ad.nameFilter = envStr('AD_NAME_FILTER', ad.nameFilter || '');
  ad.maxPlaylists = envNum('AD_MAX_PLAYLISTS', ad.maxPlaylists ?? 4);
  const ids = envStr('AD_SPOTIFY_PLAYLIST_IDS', '');
  if (ids) ad.spotifyPlaylistIds = ids.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig() {
  loadDotEnv(path.join(ROOT, '.env'));

  const configFile = path.join(ROOT, 'config.json');
  const exampleFile = path.join(ROOT, 'config.example.json');
  const file = fs.existsSync(configFile) ? configFile : exampleFile;
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  applyEnvOverrides(config);

  config.rootDir = ROOT;
  config.dataDir = path.join(ROOT, 'data');
  config.env = {
    tidalClientId: process.env.TIDAL_CLIENT_ID || '',
    tidalRedirectUri: process.env.TIDAL_REDIRECT_URI || 'http://127.0.0.1:8976/callback',
    qobuzAppId: process.env.QOBUZ_APP_ID || '',
    qobuzAppSecret: process.env.QOBUZ_APP_SECRET || '',
    qobuzUsername: process.env.QOBUZ_USERNAME || '',
    qobuzPassword: process.env.QOBUZ_PASSWORD || '',
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  };
  return config;
}
