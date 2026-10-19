import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { Game } from './game';
import { pack } from './date';
import { loadGame, saveGame } from './save';

/**
 * 派對模式 with up to eight players on a normal map (the user 2026-10-19): the players 0..7, the four NPCs 8..11 after
 * them (npcBase), the day after the NPCs. Every map runs computer days without an error, everyone gets turns, a save
 * loads back. (Up to four players nothing changed: regional-golden.test.ts.)
 */
const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));
const MAPS = [0, 1, 2, 3, 4, 5, 6, 7];
const have = MAPS.every(id => existsSync(mapFile(id)));

describe.skipIf(!have)('eight players on a normal map', () => {
  for (const mapId of MAPS) it(`map ${mapId}`, () => {
    const board = parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap);
    const g = new Game({ mapId, players: [0, 1, 2, 3, 4, 5, 6, 7].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 19), seed: 800 + mapId }, board);
    expect(g.npcBase).toBe(8);
    const turns = new Array(8).fill(0);
    const flow = g.run();
    for (let r = flow.next(); !r.done && g.daysElapsed < 150; r = flow.next()) {
      const s = r.value as { t?: string; p?: number; ask?: boolean };
      if (s.t === 'turn' && !s.ask && s.p !== undefined) turns[s.p]++;
    }
    expect(g.daysElapsed >= 150 || !!g.over).toBe(true);
    for (const [i, n] of turns.entries()) if (!g.players[i].bankrupt) expect(n).toBeGreaterThan(20);
    const back = loadGame(JSON.parse(JSON.stringify(saveGame(g))), parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap));
    expect(back.players.length).toBe(8);
    expect(back.current).toBe(g.current);
  });
});
