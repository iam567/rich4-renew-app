import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { Game, type Flow } from './game';
import { pack } from './date';
import { loadGame, saveGame } from './save';
import type { GameSettings } from './types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));

/** Advances a computer-only flow until `stop` holds at a turn start; returns false if the game ended. */
function until(flow: Flow, stop: () => boolean): boolean {
  for (let r = flow.next(); !r.done; r = flow.next()) {
    if ('ask' in r.value) throw new Error('unexpected question');
    if (r.value.t === 'turn' && stop()) return true;
  }
  return false;
}

const comparable = (g: Game) => { const s = saveGame(g); return { ...s, savedAt: 0 }; };

describe.skipIf(!existsSync(mapFile(2)))('saved games', () => {
  it('a loaded game continues exactly like the original one', () => {
    for (const [mapId, seed] of [[2, 77], [5, 1234], [0, 9]]) {
      const board = parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap);
      const settings: GameSettings = {
        mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
        fundIndex: 1, traffic: 1, landLimitIndex: 2, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
      };
      const a = new Game(settings, board), fa = a.run();
      expect(until(fa, () => a.daysElapsed >= 40)).toBe(true);
      // Through JSON, as the app stores it.
      const saved = JSON.parse(JSON.stringify(saveGame(a)));
      const b = loadGame(saved), fb = b.run();
      expect(comparable(b)).toEqual(comparable(a));
      // The restored flow first replays the turn that was in progress at the save point.
      const rb = fb.next();
      expect(!rb.done && !('ask' in rb.value) && rb.value.t).toBe('turn');
      const target = 160;
      const aliveA = until(fa, () => a.daysElapsed >= target);
      const aliveB = until(fb, () => b.daysElapsed >= target);
      expect(aliveB).toBe(aliveA);
      // A game may end before the target day (bankruptcies); then both must have ended on the same day.
      if (aliveA) expect(a.daysElapsed).toBe(target);
      expect(b.daysElapsed).toBe(a.daysElapsed);
      expect(comparable(b)).toEqual(comparable(a));
    }
  });
});
