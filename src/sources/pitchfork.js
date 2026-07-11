import { request } from '../http.js';
import { parseRss } from '../rss.js';

export const FEEDS = {
  albums: 'https://pitchfork.com/rss/reviews/best/albums/',
  tracks: 'https://pitchfork.com/rss/reviews/best/tracks/',
};

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

export async function fetchBestNewMusic({ includeAlbums = true, includeTracks = true } = {}) {
  const result = { albums: [], tracks: [] };

  if (includeAlbums) {
    const { data } = await request(FEEDS.albums, { headers: { 'User-Agent': UA } });
    for (const item of parseRss(data)) {
      const parsed = parseAlbumTitle(item.title);
      if (parsed) result.albums.push({ ...parsed, id: item.guid, link: item.link, pubDate: item.pubDate });
    }
  }

  if (includeTracks) {
    const { data } = await request(FEEDS.tracks, { headers: { 'User-Agent': UA } });
    for (const item of parseRss(data)) {
      const parsed = parseTrackTitle(item.title);
      if (parsed) result.tracks.push({ ...parsed, id: item.guid, link: item.link, pubDate: item.pubDate });
    }
  }

  return result;
}
