import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { Game } from './game';
import { pack } from './date';
import type { GameSettings } from './types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

/** Plays a computer-only game for a number of days and returns the game. */
function play(mapId: number, seed: number, days: number) {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
  };
  const game = new Game(settings, board);
  const flow = game.run();
  const log: string[] = [];
  for (let r = flow.next(); !r.done && game.daysElapsed < days; r = flow.next()) {
    const s = r.value;
    if ('ask' in s) throw new Error('computer players never ask: ' + JSON.stringify(s));
    if (s.t === 'pay' || s.t === 'buy' || s.t === 'build' || s.t === 'bankrupt' || s.t === 'gameover') log.push(JSON.stringify(s));
    for (const p of game.players) {
      expect(p.cash).toBeGreaterThanOrEqual(0);
      expect(p.bank).toBeGreaterThanOrEqual(0);
    }
  }
  return { game, log };
}

describe.skipIf(!haveMaps)('computer-only games', () => {
  it('play a year on every original map without breaking rules', () => {
    for (const mapId of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const { game, log } = play(mapId, 1234 + mapId, 365);
      expect(game.daysElapsed > 300 || game.over).toBeTruthy();
      expect(log.some(l => l.includes('"t":"buy"'))).toBeTruthy();
      for (const l of game.board.lands) expect(l.owner).toBeLessThanOrEqual(game.players.length);
    }
  }, 30_000); // eight year-long games: ~4 s alone, longer while the machine is busy

  it('is reproducible from the seed', () => {
    const a = play(1, 42, 120), b = play(1, 42, 120), c = play(1, 43, 120);
    expect(a.log).toEqual(b.log);
    expect(a.log).not.toEqual(c.log);
  });

  it('merges tolls along a street', () => {
    const { game } = play(1, 7, 1);
    const street = game.board.lands.filter(l => l.name === game.board.lands[0].name);
    for (const l of street) { l.owner = 1; l.level = 0; }
    street[0].level = 2;
    const expected = (street[0].tolls[2] + street.slice(1).reduce((s, l) => s + l.tolls[0], 0)) * game.priceIndex;
    expect(game.calcToll(1, street[0].name)).toBe(expected);
  });
});
