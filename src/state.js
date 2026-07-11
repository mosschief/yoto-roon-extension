import fs from 'node:fs';
import path from 'node:path';

const MAX_MATCH_ATTEMPTS = 5;

/**
 * Persisted sync state (data/state.json):
 *  - which provider playlist backs each logical playlist
 *  - which source items have already been added (append-only dedupe)
 *  - unmatched items and how often we've retried them
 */
export class State {
  constructor(file, data) {
    this.file = file;
    this.data = data;
  }

  static load(dataDir) {
    const file = path.join(dataDir, 'state.json');
    let data = { playlists: {}, added: {}, unmatched: {} };
    if (fs.existsSync(file)) {
      data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
    return new State(file, data);
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  getPlaylistId(key) {
    return this.data.playlists[key]?.providerId ?? null;
  }

  setPlaylistId(key, providerId, name) {
    this.data.playlists[key] = { providerId, name, createdAt: new Date().toISOString() };
  }

  hasItem(playlistKey, itemKey) {
    return Boolean(this.data.added[playlistKey]?.[itemKey]);
  }

  markAdded(playlistKey, itemKey, info = {}) {
    (this.data.added[playlistKey] ??= {})[itemKey] = {
      addedAt: new Date().toISOString(),
      ...info,
    };
    delete this.data.unmatched[playlistKey]?.[itemKey];
  }

  /** Returns true when the item should be skipped (retried too many times). */
  bumpUnmatched(playlistKey, itemKey, label) {
    const bucket = (this.data.unmatched[playlistKey] ??= {});
    const entry = (bucket[itemKey] ??= { label, attempts: 0 });
    entry.attempts += 1;
    entry.lastAttempt = new Date().toISOString();
    return entry.attempts >= MAX_MATCH_ATTEMPTS;
  }

  isGivenUp(playlistKey, itemKey) {
    return (this.data.unmatched[playlistKey]?.[itemKey]?.attempts ?? 0) >= MAX_MATCH_ATTEMPTS;
  }
}
