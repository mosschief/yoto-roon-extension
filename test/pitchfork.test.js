import assert from 'node:assert/strict';
import test from 'node:test';

import { artistFromLink, parseAlbumEntry, parseTrackEntry, slugify } from '../src/sources/pitchfork.js';

test('slugify normalizes punctuation, accents, and ampersands', () => {
  assert.equal(slugify('Music, Fashion, Film'), 'music-fashion-film');
  assert.equal(slugify('You’re Gonna Need a Little Music'), 'youre-gonna-need-a-little-music');
  assert.equal(slugify('Björk & Friends'), 'bjork-and-friends');
});

test('artistFromLink recovers the artist from the review URL slug', () => {
  assert.equal(
    artistFromLink('https://pitchfork.com/reviews/shania-twain-little-miss-twain/', 'Little Miss Twain'),
    'shania twain',
  );
  assert.equal(artistFromLink('https://pitchfork.com/reviews/albums/rico-nasty-rx/', 'RX'), 'rico nasty');
  assert.equal(
    artistFromLink('https://pitchfork.com/reviews/charli-xcx-music-fashion-film/', 'Music, Fashion, Film'),
    'charli xcx',
  );
  // Unrecoverable (slug doesn't end with the title) -> empty, matcher falls back to title only
  assert.equal(artistFromLink('https://pitchfork.com/reviews/something-else/', 'Totally Different'), '');
  assert.equal(artistFromLink('', 'Anything'), '');
});

test('parseAlbumEntry uses the title as the album and the link for the artist', () => {
  assert.deepEqual(
    parseAlbumEntry({ title: 'RX', link: 'https://pitchfork.com/reviews/albums/rico-nasty-rx/' }),
    { artist: 'rico nasty', album: 'RX' },
  );
  assert.equal(parseAlbumEntry({ title: '   ', link: 'x' }), null);
});

test('parseTrackEntry strips quotes and [ft. …] and pulls the artist from the link', () => {
  assert.deepEqual(
    parseTrackEntry({ title: '“Berghain” [ft. Björk]', link: 'https://pitchfork.com/reviews/tracks/rosalia-berghain/' }),
    { artist: 'rosalia', title: 'Berghain' },
  );
  assert.deepEqual(
    parseTrackEntry({ title: 'Broom of Wind', link: 'https://pitchfork.com/reviews/tracks/mount-eerie-broom-of-wind/' }),
    { artist: 'mount eerie', title: 'Broom of Wind' },
  );
});
