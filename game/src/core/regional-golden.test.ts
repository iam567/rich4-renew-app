import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { Game } from './game';
import { pack } from './date';
import { saveGame } from './save';
import type { GameSettings } from './types';

/**
 * Normal mode stays the original (docs/rules/18 §1): the 大富豪模式 local news / fate and the world-wide decks must not
 * touch a normal game. Every map (the eight originals and the five remake cities, which a normal game can also play)
 * runs 200 computer days from a fixed seed; the hash of every step and of the final save must equal the hashes taken
 * before the local events were added (2026-10-16, commit 5cdb6a8 + the working tree then).
 */
const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };
const mapFile = (id: number) => fileURLToPath(new URL(id >= 100 ? `../../../editor/site/assets/remake/${KEYS[id]}.json` : `../../../editor/site/assets/map-${id}.json`, import.meta.url));
const MAPS = [0, 1, 2, 3, 4, 5, 6, 7, 100, 101, 102, 103, 104];
const have = MAPS.every(id => existsSync(mapFile(id)));

export function goldenRun(mapId: number, days: number): string {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 9000 + mapId,
  };
  const game = new Game(settings, board);
  const h = createHash('sha256');
  const flow = game.run();
  let boards = 0;
  for (let r = flow.next(); !r.done && game.daysElapsed < days; r = flow.next()) {
    const s = r.value as { t?: string; kind?: string };
    if (s.t === 'fx' && (s.kind === 'news' || s.kind === 'fate')) boards++;
    h.update(JSON.stringify(r.value));
  }
  // The run must really cover the days and draw news and fate (else the hash proves nothing).
  if (!game.over && game.daysElapsed < days) throw new Error(`map ${mapId}: only ${game.daysElapsed} days`);
  if (boards < 5) throw new Error(`map ${mapId}: only ${boards} news / fate boards`);
  if (process.env.RICH4_PRINT_GOLDEN) console.log(mapId, game.daysElapsed, boards, !!game.over);
  const save = saveGame(game) as unknown as Record<string, unknown>;
  delete save.savedAt;
  h.update(JSON.stringify(save));
  return h.digest('hex').slice(0, 16);
}

/** Hashes taken before the regional events existed. */
const GOLDEN: Record<number, string> = {
  0: '897efe927eed0cdc', 1: 'f9fc6f63f125f531', 2: '0ced4144f7a073b8', 3: '2fe8ea37cebb1349', 4: '2eb7120b12b7b482',
  5: 'd86c865fcf563ada', 6: '52dd1728be1481bd', 7: 'b40755b198f271f4', 100: 'f9d23758716ca428', 101: '2910bb8883533e34',
  102: 'c1539c9b48b6f16e', 103: '3017f90d8f361881', 104: 'ae6f0403ac401dbc',
};

describe.skipIf(!have)('normal mode is unchanged by 大富豪模式 local events', () => {
  it('every map plays bit for bit as before', () => {
    const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
    if (process.env.RICH4_PRINT_GOLDEN) console.log(JSON.stringify(got));
    for (const id of MAPS) expect(got[id], `map ${id}`).toBe(GOLDEN[id]);
  }, 120_000);
});
