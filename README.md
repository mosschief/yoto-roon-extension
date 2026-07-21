# Roon Playlist Automation

Automatically maintains playlists in **Roon** from two sources:

- **Pitchfork Best New Music** — new BNM albums and tracks from Pitchfork's RSS feeds
- **Aquarium Drunkard** — a mirror of AD's public Spotify playlists

## How it works (and why it isn't a "real" Roon extension)

Roon's extension API ([node-roon-api](https://github.com/RoonLabs/node-roon-api)) can control playback and browse the library, but it **cannot create or edit playlists** — a [long-standing limitation](https://github.com/RoonLabs/node-roon-api/issues/23). So instead of talking to Roon, this tool creates and updates playlists **in your linked streaming service (TIDAL or Qobuz)**. Roon automatically syncs playlists from your linked streaming account, so the playlists simply appear in Roon's Playlists browser.

```
Pitchfork BNM RSS ─┐
                   ├─► match tracks on TIDAL/Qobuz ─► upsert playlist ─► appears in Roon
AD Spotify lists ──┘
```

Two playlists are maintained:

| Playlist | Source | Contents |
|---|---|---|
| Pitchfork: Best New Music | BNM albums + tracks RSS | BNM tracks, plus each BNM album expanded into its tracks |
| Aquarium Drunkard | AD's Spotify playlists | every track, matched by ISRC where possible |

Syncing is **append-only with dedupe**: new picks are added, nothing is removed, and items that can't be matched are retried on later runs (up to 5 times). State lives in `data/state.json`.

## Setup

Requires Node ≥ 18.17. No npm dependencies. **Running it on an Unraid server? See [UNRAID.md](UNRAID.md)** for a Docker-based setup with scheduling.

```sh
cp .env.example .env
cp config.example.json config.json
```

### 1. Streaming provider (where the playlist lives)

**TIDAL (recommended — official developer program):**

1. Create an app at [developer.tidal.com/dashboard](https://developer.tidal.com/dashboard).
2. Add `http://127.0.0.1:8976/callback` as a redirect URI in the app settings.
3. Put the client ID in `.env` (`TIDAL_CLIENT_ID`).
4. Run `npm run auth:tidal` and log in via the printed URL (once; tokens auto-refresh).

**Qobuz:** set `"provider": "qobuz"` in `config.json` and fill in `QOBUZ_USERNAME` and `QOBUZ_PASSWORD` in `.env` — that's it. Qobuz has no open developer signup, so the required app id is auto-discovered from Qobuz's own web player on first run (and cached in `data/`); set `QOBUZ_APP_ID` manually only if that ever breaks. No TIDAL or Spotify account is needed in this mode.

### 2. Aquarium Drunkard source (Spotify — credentials optional)

AD publishes its playlists on Spotify, but **you don't need a Spotify account**: without credentials the tool reads the public playlist via Spotify's embed page. For the more robust official API (also returns ISRCs, which improve TIDAL matching), create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) — a free Spotify account is enough — and put its client ID/secret in `.env`.

Either way, pick the AD playlists you want to mirror from [open.spotify.com/user/aquariumdrunkard](https://open.spotify.com/user/aquariumdrunkard) (they post new ones [on the site](https://aquariumdrunkard.com/category/spotify/)). Copy each playlist's ID (the part after `/playlist/` in its share URL) into `config.json`:

```json
"aquariumDrunkard": {
  "enabled": true,
  "playlistName": "Aquarium Drunkard",
  "spotifyPlaylistIds": ["5NIKBJAbWFkNkKQqSzcdzB"]
}
```

Skip this (set `"enabled": false`) if you only want Pitchfork.

### 3. Run it

```sh
npm run sync          # one-shot
npm run loop          # sync every 12h (configurable) in the foreground
npm test              # unit tests
```

For unattended operation, prefer cron on the machine that runs your Roon core (or any always-on box):

```cron
0 7 * * * cd /path/to/repo && /usr/bin/node src/index.js sync >> sync.log 2>&1
```

Playlists appear in Roon under **Playlists** after Roon's next streaming-service sync (you can force it in Roon via Settings → Services → Sync library now).

## Config reference

Every setting can come from `config.json` or an environment variable
(environment wins — handy for Docker/Unraid where you configure the container
instead of editing files):

| `config.json` key | Env variable | Default | Meaning |
|---|---|---|---|
| `provider` | `PROVIDER` | `tidal` | `tidal` or `qobuz` |
| `countryCode` | `COUNTRY_CODE` | `US` | TIDAL catalog country |
| `loopIntervalHours` | `LOOP_INTERVAL_HOURS` | `12` | interval for `--loop` mode |
| `pitchfork.enabled` | `PITCHFORK_ENABLED` | `true` | maintain the BNM playlist |
| `pitchfork.playlistName` | `PITCHFORK_PLAYLIST_NAME` | `Pitchfork: Best New Music` | playlist name |
| `pitchfork.includeAlbums` / `includeTracks` | `PITCHFORK_INCLUDE_ALBUMS` / `_TRACKS` | `true` | which BNM feeds to use |
| `pitchfork.maxTracksPerAlbum` | `PITCHFORK_MAX_TRACKS_PER_ALBUM` | `0` (all) | cap tracks added per BNM album |
| `aquariumDrunkard.enabled` | `AD_ENABLED` | `true` | maintain the AD playlist |
| `aquariumDrunkard.playlistName` | `AD_PLAYLIST_NAME` | `Aquarium Drunkard` | playlist name |
| `aquariumDrunkard.spotifyPlaylistIds` | `AD_SPOTIFY_PLAYLIST_IDS` (comma-separated) | `[]` | AD playlists to mirror |

A prebuilt container image is published to
`ghcr.io/mosschief/roon-playlist-automation` (see `Dockerfile` and
`.github/workflows/docker.yml`), and an Unraid Docker template lives in
[`unraid/`](unraid/).

## Caveats

- **Append-only.** Removing a track from an AD Spotify playlist won't remove it from the mirror. (Roon-side you can prune manually; true two-way mirroring would need playlist-item deletion, which is left out for now.)
- **Matching is fuzzy** except when Spotify provides an ISRC (TIDAL is looked up by ISRC first). Unmatched items are logged and abandoned after 5 attempts — check `data/state.json` → `unmatched`.
- **External APIs drift.** The TIDAL v2 (JSON:API) endpoint shapes and the unofficial Qobuz API are isolated in `src/providers/`; if a request 404s after an API change, that's the file to adjust. Pitchfork's RSS feeds (`pitchfork.com/rss/reviews/best/albums/`, `.../best/tracks/`) have been stable for years but are Condé Nast property — the parser lives in `src/sources/pitchfork.js`.
- **Spotify is read-only** here and only used for public AD playlists. Without API credentials the embed-page fallback is used, which Spotify could change without notice — if AD syncs suddenly fail, add free API credentials.

## Possible next steps

- A thin companion Roon extension (node-roon-api) adding a "queue this playlist now" action on a zone.
- True mirroring (remove tracks that left the source playlist).
- More sources — any RSS feed or public Spotify playlist fits the existing source model.
