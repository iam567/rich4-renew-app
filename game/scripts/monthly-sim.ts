// 每月任務 (docs/rules/27) in headless games: four 挑戰模式 computers play each map; every month's card is noted with
// who took it. npx vite-node scripts/monthly-sim.ts [seeds=4] [years=3] [maps=0,2,…] [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { simMapFile } from '../src/core/ai-sim';
import { parseBoard, type RawMap } from '../src/core/board';
import { pack } from '../src/core/date';
import { Game } from '../src/core/game';
import { MONTHLY_TASKS } from '../src/core/monthly';
import { attachLedger } from '../src/core/stats';
import type { GameSettings } from '../src/core/types';

const args = process.argv.slice(2);
const seeds = Array.from({ length: Number(args[0] ?? 4) }, (_, i) => 3000 + i);
const years = Number(args[1] ?? 3);
const maps = (args[2] ?? '0,1,2,3,4,5,6,7,100,101,102,103,104,106,107').split(',').map(Number);
const per: Record<string, { drawn: number; won: number; winners: number }> = {};
const months: number[] = [];
const rows: { map: number; seed: number; monthStars: number[]; stars: number[] }[] = [];
let k = 0;
for (const mapId of maps) for (const s0 of seeds) {
  const seed = s0 + mapId * 37;
  const board = parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: [9, 4, 3, 0].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed, challenge: true, challengeYears: years,
  };
  const g = new Game(settings, board);
  g.animation = false;
  attachLedger(g.players);
  const ch = g.challengeTracker!;
  const flow = g.run();
  for (let r = flow.next(); !r.done; r = flow.next()) if ('ask' in r.value) throw new Error('question');
  for (const l of ch.monthLog) {
    const x = (per[l.id] ??= { drawn: 0, won: 0, winners: 0 });
    x.drawn++; if (l.won.length) { x.won++; x.winners += l.won.length; }
  }
  months.push(ch.monthLog.length);
  rows.push({ map: mapId, seed, monthStars: [...ch.monthStars], stars: g.players.map(p => ch.stars(p)) });
  k++;
  process.stderr.write(`${k} map ${mapId} seed ${seed}: months ${ch.monthLog.length}, month stars ${ch.monthStars.join('/')}, stars ${rows.at(-1)!.stars.join('/')}\n`);
}
const table = MONTHLY_TASKS.map(t => ({ id: t.id, name: t.name, kind: t.kind, ...(per[t.id] ?? { drawn: 0, won: 0, winners: 0 }) }));
if (args[3]) writeFileSync(args[3], JSON.stringify({ table, rows }, null, 1));
for (const r of table) console.log(`${r.id} ${r.kind.padEnd(4)} ${r.name.padEnd(8, '　')} drawn ${r.drawn} won ${r.won} winners ${r.winners}`);
