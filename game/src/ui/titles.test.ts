import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../core/board';
import { pack } from '../core/date';
import { Game } from '../core/game';
import { attachLedger } from '../core/stats';
import { TITLE_BAND, TitleBook, TITLES } from './titles';

// 派對模式's 稱號 (the user 2026-11-08): each real player wears the latest title won.
const tokyo = fileURLToPath(new URL('../../../editor/site/assets/remake/tokyo.json', import.meta.url));

describe.skipIf(!existsSync(tokyo))('稱號', () => {
  const setup = () => {
    const g = new Game({ mapId: 100, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i < 2 })), fundIndex: 1, traffic: 0, landLimitIndex: 0,
      daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 18), seed: 7, party: true }, parseBoard(JSON.parse(readFileSync(tokyo, 'utf8')) as RawMap));
    return { g, ledger: attachLedger(g.players) };
  };
  const ev = { t: 'day', date: 0 } as never;

  it('every title has its picture band', () => {
    for (const t of TITLES) expect(TITLE_BAND[t.key]).toBeDefined();
  });

  it('won once, kept; the latest is worn; computers wear none', () => {
    const { g, ledger } = setup(), b = new TitleBook(g);
    expect(b.of(0)).toBeNull();
    ledger.of(0).unlucky = 8;
    expect(b.see(ev).map(w => [w.p, w.title.name])).toEqual([[0, '非酋本酋']]);
    expect(b.of(0)?.name).toBe('非酋本酋');
    expect(b.see(ev)).toEqual([]);
    ledger.of(0).lotteryWins = 1;
    b.see(ev);
    expect(b.of(0)?.name).toBe('天選之子');
    // won again (still true) changes nothing: the latest stays
    ledger.of(0).unlucky = 20;
    b.see(ev);
    expect(b.of(0)?.name).toBe('天選之子');
    ledger.of(3).unlucky = 20;
    b.see(ev);
    expect(b.of(3)).toBeNull();
  });

  it('爆倉 counted from its event', () => {
    const { g } = setup(), b = new TitleBook(g);
    b.see({ t: 'fx', kind: 'position-liquidated', p: 1 } as never);
    expect(b.of(1)?.name).toBe('爆倉戰神');
  });
});
