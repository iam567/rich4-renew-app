// 在線更新 (docs/rules/29): the list of every file of a build with its content hash, written into the build as
// update-base.json. An installed app compares it with a newer version's list and downloads only the files that
// differ (ui/update.ts); scripts/publish-update.mjs puts a version's list and files on the update server.
//
//   node scripts/update-manifest.mjs [dist]
//
// SHELL is what the installed app's own native part (ios/, android/, desktop/main.cjs, the Capacitor plugins) can
// do: raise it whenever that part changes, so an update that needs it is never applied to an older installer (that
// one is told to download the new installer instead).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHELL = 1;
export const BASE_FILE = 'update-base.json';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file under `dir` (but the list itself) → [hash (32 hex of SHA-256), size]. */
export function listFiles(dir) {
  const files = {};
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && !e.name.startsWith('.')) {
        const rel = relative(dir, p).split(sep).join('/');
        if (rel === BASE_FILE) continue;
        const b = readFileSync(p);
        files[rel] = [createHash('sha256').update(b).digest('hex').slice(0, 32), b.length];
      }
    }
  };
  walk(dir);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Writes `dir`/update-base.json for the version in package.json; returns it. */
export function writeBase(dir = join(root, 'dist')) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const m = { version, shell: SHELL, files: listFiles(dir) };
  writeFileSync(join(dir, BASE_FILE), JSON.stringify(m));
  return m;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const m = writeBase(resolve(process.argv[2] ?? join(root, 'dist')));
  console.log(`update-base.json: v${m.version}, ${Object.keys(m.files).length} files`);
}
