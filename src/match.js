/** Fuzzy matching between what a source names and what a provider's search returns. */

export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip parenthetical/bracketed qualifiers like (feat. X), [Remastered], - Single Version. */
export function stripQualifiers(s) {
  return (s || '')
    .replace(/[([][^)\]]*(?:feat\.?|ft\.?|with |remaster|deluxe|edition|version|edit|mono|stereo|live|demo)[^)\]]*[)\]]/gi, ' ')
    .replace(/\s[-–]\s.*(remaster|version|edit|mix|live|demo).*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSetScore(a, b) {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}

function fieldScore(want, got) {
  const w = normalize(want);
  const g = normalize(got);
  if (!w || !g) return 0;
  if (w === g) return 1;
  const ws = normalize(stripQualifiers(want));
  const gs = normalize(stripQualifiers(got));
  if (ws && ws === gs) return 0.95;
  if (g.includes(w) || w.includes(g)) return 0.85;
  return tokenSetScore(ws || w, gs || g);
}

/**
 * Score a candidate track against the wanted { artist, title }.
 * Candidates are { title, artists: [names] } — artists may be empty when the
 * provider response didn't include them, in which case we lean on the title
 * (the search query already contained the artist).
 */
export function scoreTrack(want, candidate) {
  const titleScore = fieldScore(want.title, candidate.title);
  // When the wanted artist is unknown (e.g. Pitchfork feed gave us only the
  // release name), match on title alone rather than penalizing for the gap.
  if (!normalize(want.artist)) return titleScore;
  const artistNames = candidate.artists?.filter(Boolean) ?? [];
  if (!artistNames.length) return titleScore * 0.9;
  const artistScore = Math.max(...artistNames.map((a) => fieldScore(want.artist, a)), fieldScore(want.artist, artistNames.join(' ')));
  return 0.6 * titleScore + 0.4 * artistScore;
}

export function pickBestTrack(want, candidates, threshold = 0.65) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = scoreTrack(want, c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return bestScore >= threshold ? { ...best, score: bestScore } : null;
}

/** Same idea for albums: { artist, album } vs { title, artists } candidates. */
export function pickBestAlbum(want, candidates, threshold = 0.65) {
  return pickBestTrack({ artist: want.artist, title: want.album }, candidates, threshold);
}
