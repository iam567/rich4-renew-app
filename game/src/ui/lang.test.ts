import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toSimplified } from './zh-hans';
import { defaultLang, lang, setLang, t } from './lang';
import { parseBoard, type RawMap } from '../core/board';
import { Game } from '../core/game';
import { pack } from '../core/date';
import type { GameSettings } from '../core/types';

describe('Traditional → Simplified', () => {
  it('converts characters and phrases the game uses', () => {
    const cases: [string, string][] = [
      ['孫小美', '孙小美'], ['錢夫人', '钱夫人'], ['宮本寶藏', '宫本宝藏'], ['約翰喬', '约翰乔'], ['烏咪', '乌咪'],
      ['臺北', '台北'], ['台灣', '台湾'], ['頭髮', '头发'], ['向後轉', '向后转'], ['皇后', '皇后'],
      ['乾坤大挪移！', '乾坤大挪移！'], ['拆得還真乾淨～', '拆得还真干净～'], ['哼！真不乾脆！', '哼！真不干脆！'],
      ['新幹線', '新干线'], ['幹活吧！', '干活吧！'], ['怎麼', '怎么'], ['我走回去幹麼？', '我走回去干么？'],
      ['超級颱風過境', '超级台风过境'], ['三分鐘不晚', '三分钟不晚'], ['盈餘', '盈余'], ['追著', '追着'],
      ['政府強制徵收土地一處', '政府强制征收土地一处'], ['瞄準目標！！', '瞄准目标！！'], ['製造噪音被罰', '制造噪音被罚'],
      ['麵包', '面包'], ['祝你像牠', '祝你像它'], ['1,234萬元', '1,234万元'], ['語言', '语言'], ['繁體', '繁体'],
    ];
    for (const [a, b] of cases) expect(toSimplified(a), a).toBe(b);
  });

  it('leaves Simplified, Latin and numbers alone and is idempotent on all the game text', () => {
    expect(toSimplified('GO ×2 $1,000 ＰＡＳＳ')).toBe('GO ×2 $1,000 ＰＡＳＳ');
    // Every run of Chinese in the game's code and map data: converting twice gives the same as once.
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    const runs = new Set<string>();
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f), st = statSync(p);
        if (st.isDirectory()) { if (!/node_modules|sprites|modular|remaster/.test(f)) walk(p); continue; }
        if (!/\.(ts|json)$/.test(f) || /\.test\.ts$/.test(f) || st.size > 30e6) continue;
        for (const m of readFileSync(p, 'utf8').matchAll(/[　-鿿豈-﫿＀-￯]+/g)) runs.add(m[0]);
      }
    };
    walk(join(root, 'game/src'));
    if (existsSync(join(root, 'editor/site/assets'))) walk(join(root, 'editor/site/assets'));
    expect(runs.size).toBeGreaterThan(1000);
    const bad = [...runs].filter(r => { const c = toSimplified(r); return toSimplified(c) !== c; });
    expect(bad).toEqual([]);
  });

  it('picks 简体 by default only for Simplified Chinese devices', () => {
    expect(defaultLang(['zh-CN'])).toBe('hans');
    expect(defaultLang(['zh-Hans-JP', 'ja-JP'])).toBe('hans');
    expect(defaultLang(['en-US', 'zh-SG'])).toBe('hans');
    expect(defaultLang(['zh-TW'])).toBe('hant');
    expect(defaultLang(['zh-Hant-HK'])).toBe('hant');
    expect(defaultLang(['zh'])).toBe('hant');
    expect(defaultLang(['en-US', 'ja'])).toBe('hant');
    expect(defaultLang([])).toBe('hant');
  });
});

const mapFile = fileURLToPath(new URL('../../../editor/site/assets/map-1.json', import.meta.url));

/** A computer-only game: every step the engine yields, and the end state. */
function play(days: number) {
  const board = parseBoard(JSON.parse(readFileSync(mapFile, 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 1, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 2024,
  };
  const game = new Game(settings, board);
  const flow = game.run();
  const steps: string[] = [];
  for (let r = flow.next(); !r.done && game.daysElapsed < days; r = flow.next()) steps.push(JSON.stringify(r.value));
  return { steps, players: JSON.stringify(game.players), lands: JSON.stringify(game.board.lands) };
}

describe('the language is display only', () => {
  it('starts in 繁體 and t() returns the text as is', () => {
    expect(lang()).toBe('hant');
    expect(t('孫小美走了三步')).toBe('孫小美走了三步');
  });

  it.skipIf(!existsSync(mapFile))('a computer game gives the same engine results in 繁體 and 简体', async () => {
    const hant = play(90);
    await setLang('hans');
    try {
      expect(t('孫小美走了三步')).toBe('孙小美走了三步');
      const hans = play(90);
      expect(hans.steps.length).toBeGreaterThan(100);
      expect(hans.steps).toEqual(hant.steps);
      expect(hans.players).toBe(hant.players);
      expect(hans.lands).toBe(hant.lands);
    } finally {
      await setLang('hant');
    }
    expect(t('孫小美')).toBe('孫小美');
  });
});
