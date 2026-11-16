import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { lunarNewYearEve, pack } from './date';
import { Game } from './game';
import type { GameEvent } from './types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));

describe('節日送卡 (docs/rules/01 §4.4)', () => {
  it('除夕 is the day before the lunar new year', () => {
    expect(lunarNewYearEve(pack(2027, 2, 6))).toBe(true);   // 2027-02-07 is lunar 1/1
    expect(lunarNewYearEve(pack(2027, 2, 5))).toBe(false);
    expect(lunarNewYearEve(pack(2026, 2, 16))).toBe(true);  // 2026-02-17 is lunar 1/1
  });
  it.skipIf(!existsSync(mapFile(2)))('on 12/25 every living player gets a card; not the day before', () => {
    const g = new Game({ mapId: 2, players: [0, 4, 9, 11].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 12, 20), seed: 4 },
      parseBoard(JSON.parse(readFileSync(mapFile(2), 'utf8')) as RawMap));
    const flow = g.run();
    let gifts: GameEvent | null = null, dayOfGift = '';
    for (let r = flow.next(), n = 0; !r.done && g.daysElapsed < 8 && n < 300000; r = flow.next(), n++) {
      const e = r.value as GameEvent;
      if ('ask' in e) throw new Error('question');
      if (e.t === 'fx' && e.kind === 'event-result' && (e.data as { src?: string }).src === 'holiday') { gifts = e; dayOfGift = `${(g.date >> 8) & 0xff}/${g.date & 0xff}`; }
    }
    expect(gifts).not.toBeNull();
    expect(dayOfGift).toBe('12/25');
    expect(((gifts as unknown as { data: { lines: unknown[] } }).data.lines).length).toBe(4);
  });
});
