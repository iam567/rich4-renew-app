// 排行榜's check, by hand: a game won alone against three easy computers (the human on 托管 from its first turn), its
// record as the phone sends it — for trying the relay's /ranks (npx vite-node scripts/rank-sample.ts OUT.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBoard, type RawMap } from '../src/core/board';
import { pack } from '../src/core/date';
import { Game } from '../src/core/game';
import { Recorder } from '../src/core/replay';
import { scores } from '../src/core/ranks';
import { attachLedger } from '../src/core/stats';
import { simMapFile } from '../src/core/ai-sim';
import type { Answer, GameSettings } from '../src/core/types';

const SEEDS = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : Array.from({ length: 59 }, (_, i) => i + 1);
for (const seed of SEEDS) {
  const settings: GameSettings = { mapId: 0, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i === 0 })), fundIndex: 1, traffic: 0,
    landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed, aiLevel: 0 };
  const g = new Game(JSON.parse(JSON.stringify(settings)), parseBoard(JSON.parse(readFileSync(simMapFile(0), 'utf8')) as RawMap));
  attachLedger(g.players);
  g.animation = false;
  const rec = new Recorder(false), flow = g.run();
  let answer: Answer = undefined, first = true;
  for (let n = 0; n < 3_000_000; n++) {
    rec.step(answer);
    const r = flow.next(answer);
    answer = undefined;
    if (r.done) break;
    const s = r.value as { ask?: boolean; t?: string };
    if ('ask' in s && s.t === 'turn' && first) { answer = { action: 'autopilot' } as Answer; first = false; }
    if (g.daysElapsed > 1500) break;
  }
  if (g.over && g.over.winner === 0) {
    const me = g.players[0], sc = scores(g.stats!.of(0));
    const out = { map: 'm0', level: 0, rich: Math.round(g.wealth(me)), ms: 0, days: g.daysElapsed, ...sc, char: me.character, fund: 1, seed, v: '1.2.4', log: rec.log, settings: JSON.stringify(settings) };
    writeFileSync(process.argv[2] ?? 'rank-sample.json', JSON.stringify(out));
    console.log('won with seed', seed, 'days', g.daysElapsed, 'rich', out.rich, 'log', JSON.stringify(rec.log).length, 'bytes');
    break;
  }
}
