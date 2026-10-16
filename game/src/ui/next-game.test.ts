import { describe, expect, it } from 'vitest';
import { drawOpponents, nextSettings, OPPONENTS, recordResult, type RunRecord } from './next-game';
import type { GameResults, PlayerResult } from '../core/stats';

/** A deterministic [0, 1) stream. */
const lcg = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);

const row = (p: number, character: number, human: boolean, winner: boolean): PlayerResult =>
  ({ p, character, human, winner, rank: winner ? 1 : p + 2, bankrupt: !winner, assets: 0, money: 0, lots: 0, houses: 0, plots: 0, fellDay: -1, titles: [], stats: {} as PlayerResult['stats'] });

describe('下一局 (next game)', () => {
  it('a human win clears the map and beats the other characters; a loss changes nothing', () => {
    const won: GameResults = { mode: 'classic', mapId: 2, winner: 0, days: 100, date: 0, players: [row(0, 9, true, true), row(1, 4, false, false), row(2, 3, false, false), row(3, 0, false, false)] };
    let run: RunRecord = { cleared: [], defeated: [] };
    run = recordResult(run, won);
    expect(run).toEqual({ cleared: [2], defeated: [4, 3, 0] });
    const lost: GameResults = { ...won, mapId: 5, winner: 1, players: [row(1, 4, false, true), row(0, 9, true, false)] };
    expect(recordResult(run, lost)).toBe(run);
    // The same map twice is cleared once.
    expect(recordResult(run, won).cleared).toEqual([2]);
  });

  it('draws three opponents other than the human, the characters not beaten yet first', () => {
    for (let seed = 1; seed < 200; seed++) {
      const r = lcg(seed);
      const ops = drawOpponents([9], [0, 1, 2, 3, 4, 5, 6, 7], r);
      expect(ops).toHaveLength(OPPONENTS);
      expect(new Set(ops).size).toBe(OPPONENTS);
      expect(ops).not.toContain(9);
      // Only 8, 10, 11 are left unbeaten: they are the three.
      expect([...ops].sort((a, b) => a - b)).toEqual([8, 10, 11]);
    }
    // Everyone beaten: still three, from the beaten ones.
    const all = drawOpponents([0], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], lcg(7));
    expect(all).toHaveLength(3);
    expect(all).not.toContain(0);
    // Different draws over seeds (random matching).
    const seen = new Set(Array.from({ length: 50 }, (_, i) => drawOpponents([9], [], lcg(i + 1)).join(',')));
    expect(seen.size).toBeGreaterThan(10);
    // Two humans: two opponents fill the four seats.
    expect(drawOpponents([1, 2], [], lcg(3))).toHaveLength(2);
  });

  it('starts with the same settings on the chosen map', () => {
    const s = nextSettings({ fundIndex: 3, traffic: 1, landLimitIndex: 2, daysLimitIndex: 4, victoryIndex: 5 }, 101, [9], [4, 3, 0], 12345, 77);
    expect(s).toEqual({
      mapId: 101, players: [{ character: 9, human: true }, { character: 4, human: false }, { character: 3, human: false }, { character: 0, human: false }],
      fundIndex: 3, traffic: 1, landLimitIndex: 2, daysLimitIndex: 4, victoryIndex: 5, startDate: 12345, seed: 77,
    });
  });
});
