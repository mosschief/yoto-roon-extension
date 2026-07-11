import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseRss } from '../src/rss.js';

const fixture = fs.readFileSync(
  path.join(new URL('.', import.meta.url).pathname, 'fixtures', 'pitchfork-albums.xml'),
  'utf8',
);

test('parses RSS items with CDATA, entities, and guid', () => {
  const items = parseRss(fixture);
  assert.equal(items.length, 3);

  assert.equal(items[0].title, 'Geese: Getting Killed');
  assert.equal(items[0].guid, '68b0e13fb0d1a1e94fed7f0a');
  assert.equal(items[0].link, 'https://pitchfork.com/reviews/albums/geese-getting-killed/');
  assert.match(items[0].description, /live-wire energy/);

  assert.equal(items[1].title, 'Sault & Cleo Sol: 10');
  assert.equal(items[2].title, 'Björk: Fossora: The Remixes');
});

test('empty feed yields no items', () => {
  assert.deepEqual(parseRss('<rss><channel></channel></rss>'), []);
});
