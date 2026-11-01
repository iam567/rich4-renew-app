// 挑戰模式 (docs/rules/26) in headless games: four computers (the original's, 簡單) play each map for years with no
// bankruptcy; every task of the map's pool is measured for every seat, then each game's 120-star draw is scored.
// npx vite-node scripts/challenge-sim.ts [seeds=6] [years=5] [maps=0,1,…] [out.json] [level=0: 0 the original's computer, 2 挑戰模式's]
import { readFileSync, writeFileSync } from 'node:fs';
import { simMapFile } from '../src/core/ai-sim';
import { parseBoard, type RawMap } from '../src/core/board';
import * as C from '../src/core/challenge';
import { ChallengeAi } from '../src/core/challenge-ai';
import { pack } from '../src/core/date';
import { Game } from '../src/core/game';
import { attachLedger } from '../src/core/stats';
import type { GameEvent, GameSettings } from '../src/core/types';

const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
const seeds = Array.from({ length: Number(args[0] ?? 6) }, (_, i) => 2000 + i);
const years = Number(args[1] ?? 5);
const maps = (args[2] ?? '0,1,2,3,4,5,6,7,100,101,102,103,104,106,107').split(',').map(Number);
const out = args[3];
const level = Number(args[4] ?? 0) as 0 | 1 | 2;
const CHECK = [1, 3, 5].filter(y => y <= years);

interface GameRow { map: number; seed: number; first100: number; drawn: string[]; stars: Record<number, number[]>; tasks: Record<string, Record<number, number[]>> }
const rows: GameRow[] = [];
const t0 = Date.now();
for (const mapId of maps) {
  for (const seed of seeds) {
    const board = parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap);
    const settings: GameSettings = {
      mapId, players: [9, 4, 3, 0].map(character => ({ character, human: true })),
      fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed, challenge: true,
    };
    const game = new Game(settings, board);
    game.animation = false;
    for (const p of game.players) p.autopilot = true;
    game.testLevels = [level, level, level, level];
    attachLedger(game.players);
    const pool = C.taskPool(mapId);
    const ch = new C.Challenge(game, pool);
    const drawn = C.drawTasks(mapId, seed);
    if (level === 2 && !process.argv.includes('--plain')) game.challengeAi = new ChallengeAi(game, ch, drawn);
    const row: GameRow = { map: mapId, seed, first100: -1, drawn: drawn.map(t => t.id), stars: {}, tasks: {} };
    const flow = game.run();
    let r = flow.next(), steps = 0, lastDay = game.daysElapsed;
    const end = years * 365;
    const snap = (y: number) => {
      row.stars[y] = game.players.map(p => drawn.reduce((n, t) => n + C.starsFor(t, ch.own[p.id].best[t.id] ?? 0, t.id === 'G33' || t.id === 'W01' ? game.board.companies.length : Infinity), 0));
      for (const t of pool) (row.tasks[t.id] ??= {})[y] = game.players.map(p => C.starsFor(t, ch.own[p.id].best[t.id] ?? 0, t.id === 'G33' || t.id === 'W01' ? game.board.companies.length : Infinity));
    };
    while (!r.done && game.daysElapsed < end && !game.over) {
      if (++steps > 40_000_000) throw new Error(`map ${mapId} seed ${seed}: too long`);
      const s = r.value as { ask?: boolean; t?: string };
      if (!('ask' in s)) ch.see(s as GameEvent);
      if (game.daysElapsed !== lastDay) {
        lastDay = game.daysElapsed;
        ch.newDay();
        if (row.first100 < 0) {
          const best = Math.max(...game.players.map(p => drawn.reduce((n, t) => n + C.starsFor(t, ch.own[p.id].best[t.id] ?? 0), 0)));
          if (best >= C.CHALLENGE_WIN) row.first100 = game.daysElapsed;
        }
        for (const y of CHECK) if (game.daysElapsed === y * 365) snap(y);
      }
      r = 'ask' in s ? flow.next(0) : flow.next();
    }
    for (const y of CHECK) if (!row.stars[y]) snap(y);
    rows.push(row);
    const debt = game.players.map(p => p.cash).join(' ');
    console.log(`map ${mapId} seed ${seed}: ${game.daysElapsed} days, stars ${CHECK.map(y => `${y}y [${row.stars[y].join(',')}]`).join(' ')}, first to 100: ${row.first100 < 0 ? 'none' : `day ${row.first100}`}, cash ${debt}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
if (out) writeFileSync(out, JSON.stringify({ seeds, years, maps, rows, unmeasured: [...new Set(maps.flatMap(m => new C.Challenge({ board: { mapId: m }, players: [], settings: { seed: 0 } } as never, C.taskPool(m)).unmeasured().map(t => t.id)))] }));
console.log(`done, ${rows.length} games, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
