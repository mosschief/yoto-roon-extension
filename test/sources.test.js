import assert from 'node:assert/strict';
import test from 'node:test';

import { extractAppId } from '../src/providers/qobuz.js';
import { parseEmbedTracks } from '../src/sources/spotify.js';

test('parseEmbedTracks reads tracks from the embed page JSON', () => {
  const embedData = {
    props: {
      pageProps: {
        state: {
          data: {
            entity: {
              name: 'AD Picks',
              trackList: [
                { uri: 'spotify:track:abc123DEF', title: 'Song One', subtitle: 'Some Band' },
                { uri: 'spotify:track:xyz789', title: 'Song Two', subtitle: 'Artist A, Artist B' },
                { uri: 'spotify:episode:notatrack', title: 'A Podcast', subtitle: 'Host' },
              ],
            },
          },
        },
      },
    },
  };
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(embedData)}</script></body></html>`;

  const tracks = parseEmbedTracks(html);
  assert.equal(tracks.length, 2);
  assert.deepEqual(tracks[0], {
    id: 'abc123DEF',
    artist: 'Some Band',
    artists: ['Some Band'],
    title: 'Song One',
    album: '',
    isrc: null,
  });
  assert.deepEqual(tracks[1].artists, ['Artist A', 'Artist B']);
});

test('parseEmbedTracks returns null when the page has no data blob', () => {
  assert.equal(parseEmbedTracks('<html><body>captcha</body></html>'), null);
});

test('extractAppId finds credentials in a web player bundle', () => {
  const bundle = 'x={development:{api:{appId:"000",appSecret:"dev"}},production:{api:{appId:"123456789",appSecret:"abc123def456"}}};';
  assert.deepEqual(extractAppId(bundle), { appId: '123456789', appSecret: 'abc123def456' });
  assert.equal(extractAppId('nothing here'), null);
});
