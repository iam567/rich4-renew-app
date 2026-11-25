import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoard } from './board';
import { Game } from './game';
import { pack } from './date';
import './qingming';   // (registers map 111's rules)
import type { QingmingRules } from './qingming';
import { QM_MOVES } from './qingming-moves';
import type { MoveEvent } from './move-events';
import type { Player } from './types';

// 清明上河's 小事件 (the user 2026-11-23): 27 of the 點券 squares (12 in the city, 15 on 梁山), 長安's move engine over
// QM_MOVES, kept to the part one stands in (梁山 / the town) — only 金沙灘's boat goes between them.
const raw = () => JSON.parse(readFileSync('../editor/site/assets/remake/qingming.json', 'utf8'));
const newGame = (seed: number) => new Game({ mapId: 111, players: [0, 4, 9, 11].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0,
  landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 23), seed }, parseBoard(raw()));

/** Runs a game until every player is on the board; the game's own flow stays paused there. */
function started(seed: number) {
  const g = newGame(seed), f = g.run();
  for (let r = f.next(), n = 0; !r.done && n < 20000 && !g.players.every(p => p.placed); n++) r = f.next(undefined as never);
  return g;
}
/** Plays a flow to its end (a computer never asks); its steps. */
function play(flow: Generator<unknown, unknown, unknown>) {
  const out: { t: string; kind?: string; p?: number; node?: number; to?: number; data?: Record<string, unknown> }[] = [];
  for (let r = flow.next(); !r.done; r = flow.next(undefined)) { out.push(r.value as never); if (out.length > 5000) throw new Error('runaway'); }
  return out;
}
/** A square from which `k` steps on (the way from `from`) reach a square of kind `kind`, none between a 小事件 or 金沙灘 (the others act only on a stop). */
function before(g: Game, p: Player, kind: string, k: number, inLs: boolean) {
  const r4 = g.rules as QingmingRules, ls = r4.liangshan();
  for (const n of g.board.nodes) {
    if (ls.has(n.id) !== inLs || g.board.specials?.[n.id] === 'land') continue;
    for (const from of n.adjacent.filter(Boolean)) {
      let at = n.id, prev = from, ok = true;
      for (let i = 0; i < k; i++) {
        const next = g.peekNext(p.id, at, prev); prev = at; at = next;
        if (i < k - 1 && ['move', 'land'].includes(g.board.specials?.[at] ?? '')) ok = false;
      }
      if (ok && g.board.specials?.[at] === kind) return { node: n.id, from, to: at };
    }
  }
  throw new Error('no square before ' + kind);
}
const only = (r4: QingmingRules, e: MoveEvent) => { (r4.mover as unknown as { list: MoveEvent[] }).list = [e]; };

it('清明上河: 33 小事件 squares (12 in the city, 21 on 梁山 since 2026-11-24), no longer 點券, never side by side; 30 moves of 1–6 steps', () => {
  const g = newGame(1), r4 = g.rules as QingmingRules, ls = r4.liangshan();
  const moves = Object.entries(g.board.specials ?? {}).filter(([, v]) => v === 'move').map(([k]) => Number(k));
  expect(moves).toHaveLength(33);
  expect(moves.filter(id => ls.has(id))).toHaveLength(21);
  expect(moves.filter(id => r4.inCity(g.node(id)))).toHaveLength(12);
  for (const id of moves) {
    expect([10, 11, 12]).not.toContain(g.node(id).event);
    for (const a of g.node(id).adjacent) if (a) expect(moves).not.toContain(a);
  }
  expect(QM_MOVES).toHaveLength(30);
  expect(new Set(QM_MOVES.map(e => e.id)).size).toBe(30);
  for (const e of QM_MOVES) { expect(e.lo ?? 1).toBeGreaterThanOrEqual(1); expect(e.hi ?? e.lo ?? 1).toBeLessThanOrEqual(6); }
});

it('清明上河 小事件: the area rules — no lot on 梁山, the whirlwind and the swap within one part, 金沙灘 ends a walk', () => {
  const g = started(2), r4 = g.rules as QingmingRules, ls = r4.liangshan();
  const [p, q, s] = g.players;
  const lsNode = [...ls].find(id => !g.board.specials?.[id])!;
  p.node = lsNode;
  expect(r4.moveArea.pool!(g, p, QM_MOVES).some(e => e.t === 'lot')).toBe(false);
  const town = g.board.nodes.find(n => !ls.has(n.id) && !g.board.specials?.[n.id])!.id;
  p.node = town;
  expect(r4.moveArea.pool!(g, p, QM_MOVES).some(e => e.t === 'lot')).toBe(true);

  // the whirlwind: 梁山 stays 梁山 (never 金沙灘), the town stays the town
  for (let i = 0; i < 30; i++) {
    p.node = lsNode; p.lastNode = g.node(lsNode).adjacent.find(Boolean)!;
    const to = r4.moveArea.windTo!(g, p);
    expect(ls.has(to.id)).toBe(true); expect(g.board.specials?.[to.id]).not.toBe('land');
    p.node = town;
    expect(ls.has(r4.moveArea.windTo!(g, p).id)).toBe(false);
  }
  // the swap: only with a rival in the same part
  p.node = town; q.node = [...ls].find(id => id !== lsNode)!; s.node = lsNode;
  for (const o of g.players.slice(3)) o.node = lsNode;
  expect(r4.moveArea.swapOk!(g, p, q)).toBe(false);
  only(r4, { id: 'qm-m-swap', head: '', text: '', t: 'swap' });
  play(r4.mover.move(g, p));
  expect(ls.has(p.node)).toBe(false);                      // nobody in town to swap with: one step on

  // walking onto 金沙灘 on 梁山 ends there and the boat goes home (town)
  const b = before(g, p, 'land', 2, true);
  p.node = b.node; p.lastNode = b.from;
  only(r4, { id: 'qm-m-donkey', head: '', text: '{n}', t: 'fwd', lo: 6, hi: 6 });
  const out = play(r4.mover.move(g, p));
  const steps = out.filter(x => x.t === 'step');
  expect(steps).toHaveLength(2);
  expect(steps[1].to).toBe(b.to);
  expect(out.some(x => x.t === 'fx' && x.kind === 'qm-sail')).toBe(true);
  expect(ls.has(p.node)).toBe(false);
  expect(g.board.specials?.[p.node]).toBe('boat');
});

it('清明上河 小事件: a move ending on another 小事件 square does nothing there', () => {
  const g = started(3), r4 = g.rules as QingmingRules;
  const p = g.players[0];
  for (const inLs of [true, false]) {
    const b = before(g, p, 'move', 3, inLs);
    p.node = b.node; p.lastNode = b.from;
    only(r4, { id: 'qm-m-donkey', head: '', text: '{n}', t: 'fwd', lo: 3, hi: 3 });
    const out = play(r4.mover.move(g, p));
    expect(p.node).toBe(b.to);
    expect(out.filter(x => x.t === 'fx' && x.kind === 'cn-move')).toHaveLength(1);
    expect(r4.mover.moving).toBe(false);
  }
  (r4.mover as unknown as { list: MoveEvent[] }).list = QM_MOVES;
});

it('清明上河 小事件: computers meet them in long games; the move itself never pays or crosses between 梁山 and the town', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 4; seed++) {
    const g = newGame(seed), r4 = g.rules as QingmingRules, ls = r4.liangshan();
    const f = g.run();
    let n = 0, inMove = -1, part = false, before: number[] = [];
    for (let r = f.next(); !r.done && n < 600000; n++) {
      const s = r.value as { t: string; kind?: string; ask?: boolean; p?: number; node?: number; to?: number; data?: { id: string; set?: string } };
      if (s.ask) throw new Error('a computer asked: ' + JSON.stringify(s));
      if (s.t === 'fx' && s.kind === 'cn-move') {
        seen.add(s.data!.id); inMove = s.p!;
        expect(s.data!.set).toBe('qingming');
        const q = g.players[inMove]; before = [q.cash, q.bank, q.points]; part = ls.has(q.node);
        if (part) expect(s.data!.id).not.toBe('qm-m-yaren');
      } else if (inMove >= 0) {
        const walking = s.t === 'step' || s.t === 'dice' || s.t === 'teleport' || s.t === 'say' || (s.t === 'fx' && (s.kind === 'turn-around' || s.kind === 'cn-whirlwind'));
        if (walking) {
          const q = g.players[inMove];
          expect([q.cash, q.bank, q.points]).toEqual(before);
          if (s.t === 'step') expect(ls.has(s.to!)).toBe(part);
          if (s.t === 'teleport') expect(ls.has(s.node!)).toBe(part);
        } else inMove = -1;
      }
      if (g.daysElapsed > 300) break;
      r = f.next(undefined as never);
    }
    expect(n).toBeLessThan(600000);
  }
  console.log('清明上河 小事件 seen', seen.size);
  expect(seen.size).toBeGreaterThan(20);
}, 300000);
