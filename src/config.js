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

export function loadConfig() {
  loadDotEnv(path.join(ROOT, '.env'));

  const configFile = path.join(ROOT, 'config.json');
  const exampleFile = path.join(ROOT, 'config.example.json');
  const file = fs.existsSync(configFile) ? configFile : exampleFile;
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));

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
