import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 简体 on iOS / iPadOS: Huninn has no glyph for many simplified characters (戏, 选, 择, 发 …). With
 * `"Huninn", system-ui` WebKit drew them as empty boxes, each as wide as several characters (the title's ticker, the
 * new-game sheet, whose option labels then wrapped until 開始遊戲 was pushed off the bottom of an iPad's screen). A
 * named Chinese system font before the generic family fixes it: every stack that starts with Huninn names one.
 */
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.css') ? [p] : [];
});

describe('Huninn font stacks', () => {
  it('fall back to a Chinese font before system-ui / sans-serif', () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname))) {
      const css = readFileSync(f, 'utf8');
      for (const m of css.matchAll(/font-family:\s*([^;}]*)/g)) {
        const stack = m[1];
        if (/^["']?Huninn/.test(stack) && !/PingFang|Hiragino|Noto Sans [ST]C|Microsoft (JhengHei|YaHei)/.test(stack)) bad.push(`${f.split('/ui/')[1]}: ${stack}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
