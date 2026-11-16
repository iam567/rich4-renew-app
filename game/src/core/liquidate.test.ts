import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import type { Step } from './types';

// 派對模式's 破產清算 (the user 2026-11-11, issue #87): a human short of money may sell everything before going bankrupt.
const assets = fileURLToPath(new URL('../../../editor/site/assets/', import.meta.url));
const tokyo = `${assets}remake/tokyo.json`;
const have = existsSync(tokyo);

function setup(party = true) {
  const humans = [true, true, false, false];
  const g = new Game({ mapId: 100, players: [0, 4, 9, 11].map((character, i) => ({ character, human: humans[i] })), fundIndex: 1, traffic: 0, landLimitIndex: 0,
    daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 18), seed: 7, ...(party ? { party: true } : {}) }, parseBoard(JSON.parse(readFileSync(tokyo, 'utf8')) as RawMap));
  g.players.forEach((q, i) => { q.placed = true; q.whoPlays = humans[i] ? 1 : 2; q.cash = 1000; q.bank = 0; q.cards = []; });
  return g;
}
/** Runs a flow, answering every question `answer`; the questions asked. */
const run = (flow: Generator<Step, unknown, unknown>, answer: unknown) => {
  const asked: Step[] = [];
  let r = flow.next();
  while (!r.done) { if ('ask' in (r.value as object)) asked.push(r.value as Step); r = flow.next('ask' in (r.value as object) ? answer : undefined); }
  return asked;
};
/** Player 0 owns two lots, one at level 3. */
function rich(g: Game) {
  const [a, b] = g.board.lands;
  a.owner = 1; b.owner = 1; b.level = 3;
  return (a.price + (b.price + 3 * b.perLevel)) * g.priceIndex;
}

describe.skipIf(!have)('派對模式 破產清算', () => {
  it('asked first; yes sells every lot at half value, pays, keeps the rest, not bankrupt', () => {
    const g = setup(), p = g.players[0], worth = rich(g);
    const asked = run(g.transfer(0, 1, 3000, 0, '過路費'), true);
    expect(asked.map(s => (s as { kind?: string }).kind)).toEqual(['liquidate']);
    expect(p.bankrupt).toBe(false);
    expect(g.board.lands.filter(l => l.owner === 1)).toHaveLength(0);
    expect(p.cash + p.bank).toBe(1000 + Math.trunc(g.board.lands[0].price * g.priceIndex / 2) + Math.trunc((g.board.lands[1].price + 3 * g.board.lands[1].perLevel) * g.priceIndex / 2) - 3000);
    expect(worth).toBeGreaterThan(0);
    expect(g.players[1].bank).toBe(3000);
  });

  it('no: bankrupt as before; still short after selling: bankrupt too', () => {
    const g = setup();
    rich(g);
    run(g.transfer(0, 1, 3000, 0, '過路費'), false);
    expect(g.players[0].bankrupt).toBe(true);
    const h = setup();
    rich(h);
    run(h.transfer(0, 1, 10_000_000, 0, '過路費'), true);
    expect(h.players[0].bankrupt).toBe(true);
  });

  it('nothing to sell, a computer, the host turned it off, or alone: no question', () => {
    const g = setup();
    expect(run(g.transfer(0, 1, 3000, 0, 'x'), true)).toHaveLength(0);
    const c = setup(); c.board.lands[0].owner = 3;
    expect(run(c.transfer(2, 1, 3000, 0, 'x'), true)).toHaveLength(0);
    expect(c.players[2].bankrupt).toBe(true);
    const off = setup(); off.settings.noLiquidate = true; rich(off);
    expect(run(off.transfer(0, 1, 3000, 0, 'x'), true)).toHaveLength(0);
    const solo = setup(false); rich(solo);
    expect(run(solo.transfer(0, 1, 3000, 0, 'x'), true)).toHaveLength(0);
  });

  it('托管 sells without asking', () => {
    const g = setup(); rich(g); g.players[0].autopilot = true;
    expect(run(g.transfer(0, 1, 3000, 0, 'x'), false)).toHaveLength(0);
    expect(g.players[0].bankrupt).toBe(false);
  });
});
