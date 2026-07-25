import { log } from '../log.js';
import { request } from '../http.js';
import { parseRss } from '../rss.js';

// Pitchfork has moved feed URLs over the years (the old /rss/reviews/best/...
// paths now 404). We try a list of candidates per feed and use the first that
// returns items; both can be overridden via config/env.
export const DEFAULT_ALBUM_FEEDS = [
  'https://pitchfork.com/feed/feed-best-albums/rss',
  'https://pitchfork.com/feed/feed-album-reviews/rss',
  'https://pitchfork.com/rss/reviews/best/albums/',
];
export const DEFAULT_TRACK_FEEDS = [
  'https://pitchfork.com/feed/feed-best-tracks/rss',
  'https://pitchfork.com/feed/feed-track-reviews/rss',
  'https://pitchfork.com/rss/reviews/best/tracks/',
];

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) roon-playlist-automation/0.1 (personal playlist sync)';

/**
 * Album feed titles look like "Artist: Album" (colon-space separator; artists
 * with multiple names use " / "). Returns null for titles we can't split.
 */
export function parseAlbumTitle(title) {
  const idx = title.indexOf(': ');
  if (idx === -1) return null;
  return {
    artist: title.slice(0, idx).trim(),
    album: title.slice(idx + 2).trim(),
  };
}

/**
 * Track feed titles look like: Artist: “Song” or Artist: "Song" [ft. Guest].
 */
export function parseTrackTitle(title) {
  const idx = title.indexOf(': ');
  if (idx === -1) return null;
  const artist = title.slice(0, idx).trim();
  let song = title.slice(idx + 2).trim();
  song = song.replace(/\s*\[(?:ft|feat)\.?[^\]]*\]\s*$/i, '').trim();
  song = song.replace(/^[“"']+/, '').replace(/[”"']+$/, '').trim();
  if (!artist || !song) return null;
  return { artist, title: song };
}

/** Fetch the first candidate feed URL that returns parseable RSS items. */
async function fetchFirstWorkingFeed(urls, kind) {
  const errors = [];
  for (const url of urls) {
    try {
      const { data } = await request(url, { headers: { 'User-Agent': UA } });
      const items = parseRss(data);
      if (items.length) {
        log.info(`Pitchfork ${kind}: using feed ${url} (${items.length} items)`);
        return items;
      }
      errors.push(`${url} → 0 items`);
    } catch (err) {
      errors.push(`${url} → ${err.message.split('\n')[0].slice(0, 80)}`);
    }
  }
  throw new Error(`no working Pitchfork ${kind} feed. Tried: ${errors.join('; ')}`);
}

export async function fetchBestNewMusic({
  includeAlbums = true,
  includeTracks = true,
  albumFeeds = DEFAULT_ALBUM_FEEDS,
  trackFeeds = DEFAULT_TRACK_FEEDS,
} = {}) {
  const result = { albums: [], tracks: [] };

  if (includeAlbums) {
    for (const item of await fetchFirstWorkingFeed(albumFeeds, 'albums')) {
      const parsed = parseAlbumTitle(item.title);
      if (parsed) result.albums.push({ ...parsed, id: item.guid, link: item.link, pubDate: item.pubDate });
    }
  }

  if (includeTracks) {
    for (const item of await fetchFirstWorkingFeed(trackFeeds, 'tracks')) {
      const parsed = parseTrackTitle(item.title);
      if (parsed) result.tracks.push({ ...parsed, id: item.guid, link: item.link, pubDate: item.pubDate });
    }
  }

  return result;
}
