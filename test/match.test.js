import assert from 'node:assert/strict';
import test from 'node:test';

import { normalize, pickBestTrack, scoreTrack, stripQualifiers } from '../src/match.js';

test('normalize strips diacritics, punctuation, and case', () => {
  assert.equal(normalize('Björk'), 'bjork');
  assert.equal(normalize('R&B  Jams!'), 'r and b jams');
  assert.equal(normalize('don’t'), "don't");
});

test('stripQualifiers removes feat/remaster noise', () => {
  assert.equal(stripQualifiers('Song (feat. Someone)'), 'Song');
  assert.equal(stripQualifiers('Song [2011 Remaster]'), 'Song');
  assert.equal(stripQualifiers('Plain Song'), 'Plain Song');
});

test('scoreTrack prefers exact matches and tolerates missing artists', () => {
  const want = { artist: 'Geese', title: 'Taxes' };
  const exact = scoreTrack(want, { title: 'Taxes', artists: ['Geese'] });
  const wrong = scoreTrack(want, { title: 'Completely Different', artists: ['Someone Else'] });
  assert.equal(exact, 1);
  assert.ok(wrong < 0.3, `wrong match scored ${wrong}`);

  const noArtists = scoreTrack(want, { title: 'Taxes', artists: [] });
  assert.ok(noArtists >= 0.85 && noArtists < 1);
});

test('pickBestTrack applies the threshold', () => {
  const want = { artist: 'Rosalía', title: 'Berghain' };
  const candidates = [
    { id: 1, title: 'Berghain (feat. Björk)', artists: ['Rosalía'] },
    { id: 2, title: 'Something Else', artists: ['Nobody'] },
  ];
  const best = pickBestTrack(want, candidates);
  assert.equal(best.id, 1);

  assert.equal(pickBestTrack(want, [{ id: 3, title: 'Zzz', artists: ['Qqq'] }]), null);
});

test('featured-artist mismatch still matches when primary artist agrees', () => {
  const want = { artist: 'MIKE, Tony Seltzer', title: 'On God' };
  const best = pickBestTrack(want, [{ id: 9, title: 'On God', artists: ['MIKE'] }]);
  assert.equal(best?.id, 9);
});
