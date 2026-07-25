import { log } from '../log.js';
import { request } from '../http.js';
import { parseRss } from '../rss.js';

// Pitchfork has moved feed URLs over the years. The old /rss/reviews/best/...
// paths and the dedicated Best-New-Music feeds now 404; the working feeds are
// the general album/track review feeds. We try a list of candidates per feed
// and use the first that returns items; both can be overridden via config/env.
export const DEFAULT_ALBUM_FEEDS = [
  'https://pitchfork.com/feed/feed-album-reviews/rss',
  'https://pitchfork.com/rss/reviews/best/albums/',
];
export const DEFAULT_TRACK_FEEDS = [
  'https://pitchfork.com/feed/feed-track-reviews/rss',
  'https://pitchfork.com/rss/reviews/best/tracks/',
];

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) roon-playlist-automation/0.1 (personal playlist sync)';

export function slugify(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The current review feeds put only the release/song name in <title>; the
 * artist lives in the review URL slug, which is "<artist-slug>-<title-slug>"
 * (e.g. .../shania-twain-little-miss-twain/). Recover the artist by removing
 * the title slug from the tail of the URL's last path segment. Returns '' when
 * it can't be determined (matching then falls back to title only).
 */
export function artistFromLink(link, title) {
  if (!link) return '';
  const seg = link.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '';
  const tslug = slugify(title);
  if (tslug && seg.endsWith(`-${tslug}`)) {
    return seg.slice(0, seg.length - tslug.length - 1).replace(/-/g, ' ').trim();
  }
  return '';
}

/** Album entry: title is the album name; artist comes from the link slug. */
export function parseAlbumEntry({ title, link }) {
  const album = (title || '').trim();
  if (!album) return null;
  return { artist: artistFromLink(link, album), album };
}

/** Track entry: strip quotes/[ft. …] from the title, artist from the link slug. */
export function parseTrackEntry({ title, link }) {
  let song = (title || '').trim();
  song = song.replace(/\s*\[(?:ft|feat)\.?[^\]]*\]\s*$/i, '').trim();
  song = song.replace(/^[“"']+/, '').replace(/[”"']+$/, '').trim();
  if (!song) return null;
  return { artist: artistFromLink(link, song), title: song };
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
      const parsed = parseAlbumEntry(item);
      if (parsed) result.albums.push({ ...parsed, id: item.guid, link: item.link, pubDate: item.pubDate });
    }
  }

  if (includeTracks) {
    for (const item of await fetchFirstWorkingFeed(trackFeeds, 'tracks')) {
      const parsed = parseTrackEntry(item);
      if (parsed) result.tracks.push({ ...parsed, id: item.guid, link: item.link, pubDate: item.pubDate });
    }
  }

  return result;
}
