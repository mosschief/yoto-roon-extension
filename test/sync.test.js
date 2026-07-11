import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { State } from '../src/state.js';
import { syncItems } from '../src/sync.js';

function fakeProvider() {
  const calls = { created: [], added: [] };
  return {
    calls,
    async findTrackByIsrc(isrc) {
      return isrc === 'ISRC-HIT' ? { id: 'isrc-track' } : null;
    },
    async searchTracks(query) {
      if (query.includes('Findable')) return [{ id: 't1', title: 'Findable Song', artists: ['Some Band'] }];
      return [];
    },
    async searchAlbums(query) {
      if (query.includes('Great Album')) return [{ id: 'a1', title: 'Great Album', artists: ['Album Band'] }];
      return [];
    },
    async getAlbumTrackIds() {
      return ['at1', 'at2', 'at3'];
    },
    async createPlaylist(name) {
      calls.created.push(name);
      return `pl-${calls.created.length}`;
    },
    async addTracks(playlistId, ids) {
      calls.added.push({ playlistId, ids });
    },
  };
}

function tempState() {
  return State.load(fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-')));
}

const baseArgs = { playlistKey: 'k', playlistName: 'Test List', description: 'd' };

test('adds matched tracks/albums, dedupes on re-run, records unmatched', async () => {
  const provider = fakeProvider();
  const state = tempState();
  const items = [
    { key: 'i1', label: 'track by search', kind: 'track', artist: 'Some Band', title: 'Findable Song' },
    { key: 'i2', label: 'track by isrc', kind: 'track', artist: 'X', title: 'Y', isrc: 'ISRC-HIT' },
    { key: 'i3', label: 'album', kind: 'album', artist: 'Album Band', album: 'Great Album' },
    { key: 'i4', label: 'unfindable', kind: 'track', artist: 'Ghost', title: 'Nothing' },
  ];

  const res = await syncItems({ provider, state, items, ...baseArgs });
  assert.equal(res.added, 3);
  assert.equal(res.unmatched, 1);
  assert.deepEqual(provider.calls.created, ['Test List']);
  const allAdded = provider.calls.added.flatMap((c) => c.ids);
  assert.deepEqual(allAdded.sort(), ['at1', 'at2', 'at3', 'isrc-track', 't1'].sort());

  // Re-run: everything already synced, unmatched retried once more.
  const res2 = await syncItems({ provider, state, items, ...baseArgs });
  assert.equal(res2.added, 0);
  assert.equal(res2.unmatched, 1);
  assert.equal(provider.calls.created.length, 1, 'playlist is reused, not recreated');
});

test('unmatched items are abandoned after repeated attempts', async () => {
  const provider = fakeProvider();
  const state = tempState();
  const items = [{ key: 'u1', label: 'unfindable', kind: 'track', artist: 'Ghost', title: 'Nothing' }];

  for (let i = 0; i < 5; i++) await syncItems({ provider, state, items, ...baseArgs });
  assert.ok(state.isGivenUp('k', 'u1'));

  const res = await syncItems({ provider, state, items, ...baseArgs });
  assert.equal(res.added + res.unmatched, 0, 'exhausted item is not retried');
});

test('maxTracksPerAlbum caps album expansion', async () => {
  const provider = fakeProvider();
  const state = tempState();
  const items = [{ key: 'a', label: 'album', kind: 'album', artist: 'Album Band', album: 'Great Album' }];

  await syncItems({ provider, state, items, maxTracksPerAlbum: 2, ...baseArgs });
  assert.deepEqual(provider.calls.added[0].ids, ['at1', 'at2']);
});
