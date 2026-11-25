import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoard } from './board';
import { Game } from './game';
import { pack } from './date';
import { MOVES } from './changan';

// 開元盛世's 小事件 (the user 2026-11-23): 26 squares (none beside a 點券 square), 30 moves; computers meet them in long games, nothing hangs and the
// move itself never touches money or 點券 (whatever the square it ends on does is that square's own).
it('開元盛世: 32 小事件 squares; the moves play out and only move', () => {
  const raw = JSON.parse(readFileSync('../editor/site/assets/remake/changan.json', 'utf8'));
  expect(Object.values(raw.specials).filter(v => v === 'move')).toHaveLength(32);   // (26 beside no 點券 square, 6 on the city's two sides)
  expect(MOVES).toHaveLength(30);
  const seen = new Set<string>();
  for (let seed = 1; seed <= 6; seed++) {
    const g = new Game({ mapId: 110, players: [0, 4, 9, 11].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 23), seed }, parseBoard(raw));
    const f = g.run();
    let n = 0, inMove = -1, before: number[] = [];
    for (let r = f.next(); !r.done && n < 400000; n++) {
      const s = r.value as { t: string; kind?: string; ask?: boolean; p?: number; data?: { id: string } };
      if (s.ask) throw new Error('a computer asked: ' + JSON.stringify(s));
      if (s.t === 'fx' && s.kind === 'cn-move') {
        seen.add(s.data!.id); inMove = s.p!;
        const q = g.players[inMove]; before = [q.cash, q.bank, q.points];
      } else if (inMove >= 0) {
        // every step of the walk (and the dice, the whirlwind, the turn): nothing paid yet — the square it ends on pays
        // or sells after the last of them, as that square's own (its first event ends the check)
        const walking = s.t === 'step' || s.t === 'dice' || s.t === 'teleport' || s.t === 'say' || (s.t === 'fx' && (s.kind === 'turn-around' || s.kind === 'cn-whirlwind'));
        if (walking) { const q = g.players[inMove]; expect([q.cash, q.bank, q.points]).toEqual(before); }
        else inMove = -1;
      }
      if (g.daysElapsed > 300) break;
      r = f.next(undefined as never);
    }
    expect(n).toBeLessThan(400000);
  }
  console.log('小事件 seen', seen.size);
  expect(seen.size).toBeGreaterThan(20);
}, 180000);
