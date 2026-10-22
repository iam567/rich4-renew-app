import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { Game, type Flow } from './game';
import { pack } from './date';
import { loadGame, reshuffleGame, saveGame } from './save';
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

function newTestGameForReshuffle(): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(2), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 2, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 1, landLimitIndex: 2, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 4242,
  };
  const g = new Game(settings, board);
  until(g.run(), () => g.daysElapsed >= 5);
  return g;
}

describe.skipIf(!existsSync(mapFile(2)))('issue #5: a loaded game rolls new dice', () => {
  it('the same save loaded twice with different salts rolls differently; salt 0 keeps the old behaviour; the salt is saved', () => {
    const g = newTestGameForReshuffle();
    const data = saveGame(g);
    const rolls = (salt: number | null) => {
      const h = loadGame(JSON.parse(JSON.stringify(data)));
      if (salt !== null) reshuffleGame(h, salt);
      return Array.from({ length: 12 }, () => h.rng.rand() % 6 + 1).join('');
    };
    expect(rolls(null)).toBe(rolls(null));
    expect(rolls(123)).not.toBe(rolls(null));
    expect(rolls(123)).not.toBe(rolls(456));
    const h = loadGame(JSON.parse(JSON.stringify(data)));
    reshuffleGame(h, 777);
    const again = loadGame(JSON.parse(JSON.stringify(saveGame(h))));
    expect(again.rngSalt).toBe(777);
    expect(again.rollSeed()).toBe(h.rollSeed());
  });
});

describe.skipIf(!existsSync(mapFile(2)))('issue #5: the days after a reshuffled load differ too', () => {
  it('a salted game plays a different game over the next days (the daily reseed includes the salt)', () => {
    const data = JSON.parse(JSON.stringify(saveGame(newTestGameForReshuffle())));
    const play = (salt: number) => {
      const h = loadGame(JSON.parse(JSON.stringify(data)));
      if (salt) reshuffleGame(h, salt);
      until(h.run(), () => h.daysElapsed >= 20);
      return h.players.map(p => `${p.node}:${p.cash}`).join(',');
    };
    expect(play(0)).toBe(play(0));
    expect(play(99)).not.toBe(play(0));
  });
});
