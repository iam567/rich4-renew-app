import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

/**
 * The game must run on an older Android System WebView and on vendors' own (issue #7: HarmonyOS 4.2 runs the APK on
 * Huawei's WebView, which is not updated through Google Play): Chrome 87 and up. The bundle is lowered for it
 * (vite.config.ts), every file must be lowerable (no top-level await, no regex flags it lacks), and no function newer than
 * Chrome 87 is used unless ui/compat.ts fills it in (as old-safari.test.ts does for iPadOS 16.3).
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const files = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(f) && !/\.(test|d)\.ts$/.test(f) ? [p] : []; });
const sources = files(root).map(f => ({ f: f.slice(root.length), text: readFileSync(f, 'utf8') }));
/** The code without its comments (the newer names may be mentioned there). */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Functions after Chrome 87 (the version that has them). */
const NEWER: [RegExp, string][] = [
  [/\.findLast(Index)?\(/, 'Array findLast (97)'],
  [/Object\.hasOwn\(/, 'Object.hasOwn (93)'],
  [/\.(toSorted|toReversed|toSpliced)\(/, 'change-array-by-copy (110)'],
  [/(Object|Map)\.groupBy\(/, 'groupBy (117)'],
  [/Promise\.withResolvers\(/, 'Promise.withResolvers (119)'],
  [/Array\.fromAsync\(/, 'Array.fromAsync (121)'],
  [/AbortSignal\.(timeout|any)\(/, 'AbortSignal.timeout / any (103 / 116)'],
  [/\.(isWellFormed|toWellFormed)\(/, 'String well-formed (111)'],
  [/\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, 'Set methods (122)'],
  [/\.(replaceAll)\(\s*\/[^/]+\/[a-z]*v/, 'regex v flag (112)'],
  [/\bstructuredClone\(/, 'structuredClone (98)'],
  [/(?:^|[^.])\.at\(/, 'Array / String at() (92)'], // not `...at(` (a spread)
];
/** Uses that are fine: structuredClone is filled in by ui/compat.ts; `.at(` of the game's own classes (Objects.at, BoardView.at). */
const ALLOWED: Record<string, RegExp> = {
  'structuredClone (98)': /\bstructuredClone\(/,
  'Array / String at() (92)': /(\bobjects|\bthis)\.at\(/,
};

describe('older Android WebView (Chrome 87)', () => {
  it('builds the script for Chrome 87', () => {
    const cfg = readFileSync(fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), 'utf8');
    expect(cfg).toMatch(/target:\s*\[[^\]]*'chrome87'/);
  });

  it('every file can be lowered for Chrome 87', () => {
    const bad: string[] = [];
    for (const { f, text } of sources) {
      try { transformSync(text, { loader: 'ts', target: 'chrome87', format: 'esm', logLevel: 'silent' }); }
      catch (e) { bad.push(`${f}: ${(e as Error).message.split('\n')[0]}`); }
    }
    expect(bad).toEqual([]);
  });

  it('uses no function newer than Chrome 87 that ui/compat.ts does not fill in', () => {
    const bad: string[] = [];
    for (const { f, text } of sources) {
      const c = code(text);
      for (const [re, what] of NEWER) {
        const all = new RegExp(re.source, 'g');
        for (const m of c.matchAll(all)) {
          const at = m.index ?? 0, around = c.slice(Math.max(0, at - 12), at + m[0].length);
          const ok = ALLOWED[what];
          if (ok && new RegExp(ok.source).test(around)) continue;
          bad.push(`${f}: ${what}: …${around}…`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('ui/compat.ts is the first thing main.ts loads and fills in structuredClone', () => {
    const main = readFileSync(join(root, 'ui/main.ts'), 'utf8');
    const firstImport = main.split('\n').find(l => l.startsWith('import '));
    expect(firstImport).toMatch(/^import '\.\/compat';/);
    expect(readFileSync(join(root, 'ui/compat.ts'), 'utf8')).toMatch(/g\.structuredClone = /);
  });
});
