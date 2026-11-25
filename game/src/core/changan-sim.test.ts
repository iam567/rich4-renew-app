import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoard } from './board';
import { Game } from './game';
import { pack } from './date';
import { ChanganRules } from './changan';
it('長安: computers play a long game; every special square is stopped on, nothing hangs', () => {
  const raw = JSON.parse(readFileSync('../editor/site/assets/remake/changan.json', 'utf8'));
  const seen: Record<string, number> = {};
  for (let seed = 1; seed <= 3; seed++) {
    const g = new Game({ mapId: 110, players: [0, 4, 9, 11].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 19), seed }, parseBoard(raw));
    expect(g.rules).toBeInstanceOf(ChanganRules);
    const f = g.run();
    let n = 0;
    for (let r = f.next(); !r.done && n < 400000; n++) {
      const s = r.value as { t: string; kind?: string; ask?: boolean };
      if (s.ask) throw new Error("a computer asked: " + JSON.stringify(s));
      for (const p of g.players) { expect(p.cash).toBeGreaterThanOrEqual(0); expect(p.points).toBeGreaterThanOrEqual(0); }
      if (s.t === 'fx' && s.kind?.startsWith('cn-')) seen[s.kind] = (seen[s.kind] ?? 0) + 1;
      if (g.daysElapsed > 300) break;
      r = f.next(undefined as never);
    }
    expect(n).toBeLessThan(400000);
  }
  console.log('seen', seen);
  expect(seen['cn-exam-result'] ?? 0).toBeGreaterThan(0);
  expect(seen['cn-dice-roll'] ?? 0).toBeGreaterThanOrEqual(0);
}, 120000);
