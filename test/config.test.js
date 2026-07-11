import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

const ENV_KEYS = [
  'PROVIDER',
  'LOOP_INTERVAL_HOURS',
  'PITCHFORK_ENABLED',
  'PITCHFORK_MAX_TRACKS_PER_ALBUM',
  'AD_SPOTIFY_PLAYLIST_IDS',
  'AD_PLAYLIST_NAME',
];

function withEnv(vars, fn) {
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('file values are used when no env overrides are set', () => {
  withEnv({}, () => {
    const config = loadConfig();
    assert.equal(config.provider, 'tidal');
    assert.equal(config.pitchfork.enabled, true);
    assert.deepEqual(config.aquariumDrunkard.spotifyPlaylistIds, []);
  });
});

test('environment variables override file config', () => {
  withEnv(
    {
      PROVIDER: 'qobuz',
      LOOP_INTERVAL_HOURS: '6',
      PITCHFORK_ENABLED: 'false',
      PITCHFORK_MAX_TRACKS_PER_ALBUM: '3',
      AD_SPOTIFY_PLAYLIST_IDS: ' abc123 , def456,',
      AD_PLAYLIST_NAME: 'AD Picks',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.provider, 'qobuz');
      assert.equal(config.loopIntervalHours, 6);
      assert.equal(config.pitchfork.enabled, false);
      assert.equal(config.pitchfork.maxTracksPerAlbum, 3);
      assert.deepEqual(config.aquariumDrunkard.spotifyPlaylistIds, ['abc123', 'def456']);
      assert.equal(config.aquariumDrunkard.playlistName, 'AD Picks');
    },
  );
});
