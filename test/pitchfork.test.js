import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAlbumTitle, parseTrackTitle } from '../src/sources/pitchfork.js';

test('parseAlbumTitle splits on first colon', () => {
  assert.deepEqual(parseAlbumTitle('Geese: Getting Killed'), {
    artist: 'Geese',
    album: 'Getting Killed',
  });
  assert.deepEqual(parseAlbumTitle('Björk: Fossora: The Remixes'), {
    artist: 'Björk',
    album: 'Fossora: The Remixes',
  });
  assert.deepEqual(parseAlbumTitle('Sault / Cleo Sol: 10'), {
    artist: 'Sault / Cleo Sol',
    album: '10',
  });
  assert.equal(parseAlbumTitle('No separator here'), null);
});

test('parseTrackTitle handles curly quotes and [ft.] suffixes', () => {
  assert.deepEqual(parseTrackTitle('Rosalía: “Berghain” [ft. Björk & Yves Tumor]'), {
    artist: 'Rosalía',
    title: 'Berghain',
  });
  assert.deepEqual(parseTrackTitle('Mount Eerie: "Broom of Wind"'), {
    artist: 'Mount Eerie',
    title: 'Broom of Wind',
  });
  assert.equal(parseTrackTitle('Nothing to see'), null);
});
