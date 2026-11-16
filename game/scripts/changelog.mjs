// 更新日誌 (the user 2026-11-04: a small 「更新日誌」 on the title, each version's changes in words): the CHANGELOG's
// versions as dist/changelog.json — the newest first, each line plain text (no Markdown), in Traditional Chinese (the
// game's own script; 简体 converts on the screen as every other text). Written with the build (bundle-assets.mjs),
// so the online update carries it too.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** The CHANGELOG in this repo (scripts/app-repo/) or in the app repo (its root). */
function source(root) {
  for (const p of [join(root, '../scripts/app-repo/CHANGELOG.md'), join(root, '../CHANGELOG.md')]) if (existsSync(p)) return p;
  return null;
}

const plain = s => s.replace(/\*\*/g, '').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();

/** Writes `dir`/changelog.json; returns the number of versions (0: no CHANGELOG found). */
export function writeChangelog(root, dir) {
  const src = source(root);
  if (!src) return 0;
  const toTw = createRequire(import.meta.url)('opencc-js').Converter({ from: 'cn', to: 'tw' });
  const versions = [];
  let cur = null;
  for (const line of readFileSync(src, 'utf8').split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { if (/尚未发布|尚未發布/.test(h[1])) { cur = null; continue; } cur = { title: toTw(plain(h[1])), lines: [] }; versions.push(cur); continue; }
    if (!cur) continue;
    const b = /^\s*-\s+(.+)$/.exec(line);
    if (b) cur.lines.push(toTw(plain(b[1])));
    else if (line.trim() && cur.lines.length && /^\s{2,}/.test(line)) cur.lines[cur.lines.length - 1] += ' ' + toTw(plain(line));
  }
  const out = versions.filter(v => v.lines.length);
  writeFileSync(join(dir, 'changelog.json'), JSON.stringify(out));
  return out.length;
}
