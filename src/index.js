import { loadConfig } from './config.js';
import { log } from './log.js';
import { buildProvider, runSync } from './sync.js';

const USAGE = `Usage:
  node src/index.js sync [--loop] [--interval-hours N]   Run a sync (optionally forever)
  node src/index.js auth-tidal                            One-time TIDAL login (PKCE)
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const config = loadConfig();

  if (cmd === 'auth-tidal') {
    const provider = buildProvider({ ...config, provider: 'tidal' });
    await provider.authInteractive();
    return;
  }

  if (cmd === 'sync') {
    const loop = rest.includes('--loop');
    const idx = rest.indexOf('--interval-hours');
    const hours = idx !== -1 ? Number(rest[idx + 1]) : config.loopIntervalHours || 12;

    if (!loop) {
      await runSync(config);
      return;
    }
    // In loop mode (e.g. as an always-on container) a failed sync — including
    // the first one — is logged and retried on the next tick instead of
    // crashing the process.
    for (;;) {
      try {
        await runSync(config);
      } catch (err) {
        log.error(`Sync failed: ${err.message}`);
      }
      log.info(`Next sync in ${hours}h.`);
      await new Promise((r) => setTimeout(r, hours * 3600 * 1000));
    }
  }

  console.log(USAGE);
  process.exitCode = cmd ? 1 : 0;
}

main().catch((err) => {
  log.error(err.stack || err.message);
  process.exitCode = 1;
});
