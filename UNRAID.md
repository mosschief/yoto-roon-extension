# Running on Unraid

Two ways to run this on Unraid:

- **[A. As an Unraid app (Docker template)](#a-install-as-an-unraid-app--recommended)** — point-and-click install from the Docker tab, configured entirely through the template's fields. Recommended.
- **[B. Manual (bind-mounted repo + User Scripts cron)](#b-manual-setup-bind-mounted-repo)** — no prebuilt image needed; runs the code straight from appdata.

## A. Install as an Unraid app — recommended

A prebuilt image is published to `ghcr.io/mosschief/roon-playlist-automation`
by CI, and an Unraid template lives in [`unraid/roon-playlist-automation.xml`](unraid/roon-playlist-automation.xml).

> One-time prerequisite: the GHCR package must be **public** for Unraid to
> pull it anonymously. After the first CI build, check
> github.com → your profile → Packages → `roon-playlist-automation` →
> Package settings → Change visibility → Public.

1. Install the template by copying it to Unraid's user-templates folder.
   Open the Unraid web terminal (the `>_` icon, top right) and run:

   ```sh
   wget -O /boot/config/plugins/dockerMan/templates-user/roon-playlist-automation.xml \
     "https://raw.githubusercontent.com/mosschief/yoto-roon-extension/refs/heads/claude/roon-plugin-playlist-automation-v3c80d/unraid/roon-playlist-automation.xml"
   ```

   (This works on every Unraid version. Older 6.x releases alternatively had a
   *Template Repositories* box at the bottom of the Docker tab where
   `https://github.com/mosschief/yoto-roon-extension` could be added; newer
   versions removed it in favor of Community Applications, so the file copy
   above is the reliable route.)

2. Go to the **Docker** tab, click **Add Container**, and pick
   `roon-playlist-automation` from the **Select a template** dropdown (it
   appears under *User templates*).

3. Fill in the fields (the template defaults to Qobuz, so TIDAL fields are
   tucked under *Show more settings*):
   - `QOBUZ_USERNAME` / `QOBUZ_PASSWORD` — your normal Qobuz account. No developer signup; the Qobuz app id is auto-discovered.
   - `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` — a free app from [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard). With these, Aquarium Drunkard's playlists are **found automatically** — you don't list any IDs. (No Spotify login/account-linking, just the app's ID and secret.)
   - `AD_SPOTIFY_PLAYLIST_IDS` — leave blank for auto-discovery. Only fill this if you want specific playlists instead; these are read even without Spotify credentials.
   - **TIDAL instead of Qobuz:** set `PROVIDER=tidal` and fill `TIDAL_CLIENT_ID` (from [developer.tidal.com/dashboard](https://developer.tidal.com/dashboard), redirect URI `http://127.0.0.1:8976/callback`).
   - Auto-discovery tuning (`AD_MAX_PLAYLISTS`, `AD_NAME_FILTER`) and everything else is under *Show more settings* with sensible defaults.

4. Apply. The container starts in loop mode (sync on start, then every
   `LOOP_INTERVAL_HOURS`). **Qobuz users are done at this point** — no
   interactive login step. For TIDAL, the first sync will fail with
   `No TIDAL tokens found` until you do the **one-time TIDAL login** — see
   [step 2 of the manual setup](#2-one-time-tidal-login) below; for the
   template install, Option B's command becomes: open the container's
   **Console** (click its icon → Console) and run
   `node src/index.js auth-tidal`, with the same SSH tunnel from your desktop
   (the template already publishes port 8976). Or just copy a
   `tidal-tokens.json` made on your desktop into
   `/mnt/user/appdata/roon-playlist-automation/`, which is mounted at
   `/app/data`.

5. Restart the container and watch its log: you should see the fetches and
   `added ...` lines. Then force a service sync in Roon
   (**Settings → Services → TIDAL → Sync library now**).

To publish it for *all* Unraid users in Community Applications search, the
template repo has to be registered with the CA maintainers — see the
[CA application policies thread](https://forums.unraid.net/topic/87144-ca-application-policies-notes/)
(requires a support thread and a moderation pass). The template above works
privately without any of that.

## B. Manual setup (bind-mounted repo)

Unraid doesn't ship Node, so everything runs through Docker using the stock
`node:22-alpine` image with the repo bind-mounted — no image build needed, and
all config/state lives in your appdata share.

## 1. Get the code onto the server

Open the Unraid web terminal (top-right `>_` icon) and run:

```sh
cd /mnt/user/appdata
mkdir roon-playlist-automation && cd roon-playlist-automation
wget -qO- https://github.com/mosschief/yoto-roon-extension/archive/refs/heads/claude/roon-plugin-playlist-automation-v3c80d.tar.gz | tar xz --strip-components=1
cp .env.example .env
cp config.example.json config.json
```

(If you have git installed via NerdTools, `git clone` works too.)

Edit the two config files — either with `nano` in the terminal or over SMB at
`\\TOWER\appdata\roon-playlist-automation\`:

- **`.env`** — your `TIDAL_CLIENT_ID` (from [developer.tidal.com/dashboard](https://developer.tidal.com/dashboard), with `http://127.0.0.1:8976/callback` added as a redirect URI) and `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` (from [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)).
- **`config.json`** — the Aquarium Drunkard Spotify playlist IDs you want to mirror, playlist names, etc. (see README).

Then fix ownership so the container (run as Unraid's `nobody:users`) can write state:

```sh
chown -R 99:100 /mnt/user/appdata/roon-playlist-automation
```

## 2. One-time TIDAL login

The TIDAL OAuth flow needs a browser to hit a short-lived callback server on
port 8976. Two ways to do it — **A is easier** if you have Node on your
desktop/laptop; **B** does it all on the server.

**Option A — authorize on your desktop, copy the tokens.**
On any machine with Node ≥ 18: clone the repo, create the same `.env`, run
`npm run auth:tidal`, complete the login in your browser. Then copy the
resulting `data/tidal-tokens.json` into
`\\TOWER\appdata\roon-playlist-automation\data\`. Done — tokens refresh
themselves from then on.

**Option B — authorize on the server through an SSH tunnel.**

1. In the Unraid terminal, start the auth flow with the port published:

   ```sh
   docker run --rm -it -p 8976:8976 --user 99:100 \
     -v /mnt/user/appdata/roon-playlist-automation:/app -w /app \
     node:22-alpine node src/index.js auth-tidal
   ```

2. On your desktop, open a tunnel so `127.0.0.1:8976` reaches the server
   (TIDAL only redirects to loopback, hence the tunnel):

   ```sh
   ssh -N -L 8976:localhost:8976 root@YOUR-UNRAID-IP
   ```

3. Open the URL the container printed in your desktop browser and log in to
   TIDAL. When the page says "Authorized", close the tunnel (Ctrl-C both).

Qobuz and Spotify need no interactive login — credentials in `.env` are enough.

## 3. Test a one-shot sync

```sh
docker run --rm --user 99:100 \
  -v /mnt/user/appdata/roon-playlist-automation:/app -w /app \
  node:22-alpine node src/index.js sync
```

You should see the Pitchfork/Spotify fetches and `added ...` lines. Check
TIDAL (or Qobuz) — the playlists should exist. In Roon, force a service sync
(**Settings → Services → TIDAL/Qobuz → Sync library now**) and they'll appear
under **Playlists**.

## 4. Schedule it

**Recommended: User Scripts plugin (cron-style one-shot).**

1. Install **User Scripts** from Community Applications if you don't have it.
2. **Settings → User Scripts → Add New Script**, name it `roon-playlist-sync`,
   and set its contents to:

   ```sh
   #!/bin/bash
   docker run --rm --user 99:100 \
     -v /mnt/user/appdata/roon-playlist-automation:/app -w /app \
     node:22-alpine node src/index.js sync >> /mnt/user/appdata/roon-playlist-automation/sync.log 2>&1
   ```

3. Set the schedule to **Custom** with a cron like `0 7 * * *` (daily 7am).
   Pitchfork posts BNM on weekday mornings; daily is plenty.

**Alternative: always-on container (loop mode) via the Docker tab.**

Docker tab → **Add Container** → toggle **Advanced View**:

| Field | Value |
|---|---|
| Name | `roon-playlist-automation` |
| Repository | `node:22-alpine` |
| Post Arguments | `node /app/src/index.js sync --loop` |
| Extra Parameters | `-w /app --user 99:100 --restart=unless-stopped` |
| Add Path | Container: `/app` → Host: `/mnt/user/appdata/roon-playlist-automation` |

It syncs on start and then every `loopIntervalHours` (config.json, default 12).
Container logs show the sync output.

## Troubleshooting

- **`EACCES` writing `data/state.json`** — rerun the `chown -R 99:100 ...` from step 1 (files created over SMB or as root can lose the right ownership).
- **Playlist exists in TIDAL but not Roon** — Roon only syncs streaming playlists periodically; force it via Settings → Services, and make sure the playlist is visible in your TIDAL account (the tool creates it as UNLISTED, which Roon still syncs since it's in your collection).
- **`No TIDAL tokens found`** — step 2 didn't complete or `data/tidal-tokens.json` isn't in the mounted folder.
- **Unmatched tracks** — look at `unmatched` inside `data/state.json`; items are retried on the next runs up to 5 times.
