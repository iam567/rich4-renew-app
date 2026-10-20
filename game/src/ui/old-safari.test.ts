import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The game must start on iOS / iPadOS 15–16 (the user's iPad mini on iPadOS 16.3: a black screen, 2026-10-20): no
 * regular-expression lookbehind `(?<=` / `(?<!` (Safari 16.4+) anywhere in the game's code — one at module level stops
 * the whole bundle.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const files = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : []; });

describe('old Safari', () => {
  it('has no regex lookbehind', () => {
    const bad = files(root).filter(f => /\(\?<[=!]/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
