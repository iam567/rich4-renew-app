// 排行榜's check on the server (the user 2026-11-16, 防作弊): the game's rules built into one file the relay runs —
// core/replay.ts and everything it needs, nothing of the screen. Run after a change to the rules:
//   node scripts/build-replay.mjs        -> ../tools/party-relay/replay/core-<version>.mjs
// One file per version: a record is checked by the rules of the version it was played on (the relay keeps them all).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).version;
await build({
  entryPoints: [`${root}/src/core/replay.ts`],
  bundle: true, platform: 'node', format: 'esm', target: 'node18',
  outfile: `${root}/../tools/party-relay/replay/core-${version}.mjs`,
  define: { __APP_VERSION__: JSON.stringify(version), __UPDATE_CHANNEL__: '""' },
  banner: { js: `// Built by game/scripts/build-replay.mjs from game/src/core (v${version}); do not edit.` },
  logLevel: 'warning',
});
console.log(`replay/core-${version}.mjs built`);
