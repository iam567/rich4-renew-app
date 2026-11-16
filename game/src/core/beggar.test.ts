import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { landOf, parseBoard, type RawMap } from './board';
import { pack } from './date';
import { ALMS, BEG, Game, REVIVE } from './game';
import { OBJ } from './modules/objects';
import type { Step } from './types';

// 派對模式's 乞丐 (the user 2026-11-08): a human who goes bankrupt in a party game keeps playing as a beggar — begs
// BEG from everyone met, buys nothing, pays no toll, comes back at REVIVE. Nowhere else.
const assets = fileURLToPath(new URL('../../../editor/site/assets/', import.meta.url));
const tokyo = `${assets}remake/tokyo.json`;
const have = existsSync(tokyo);

function setup(party = true, humans = [true, true, true, false]) {
  const g = new Game({ mapId: 100, players: [0, 4, 9, 11].map((character, i) => ({ character, human: humans[i] })), fundIndex: 1, traffic: 0, landLimitIndex: 0,
    daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 18), seed: 7, ...(party ? { party: true } : {}) }, parseBoard(JSON.parse(readFileSync(tokyo, 'utf8')) as RawMap));
  g.players.forEach((q, i) => { q.placed = true; q.whoPlays = humans[i] ? 1 : 2; q.cash = 500000; q.bank = 0; q.cards = []; q.node = g.board.nodes.filter(n => n.event === 0)[i * 7].id; });
  return g;
}
type Any = Record<string, (...a: unknown[]) => Generator<Step, unknown, unknown>>;
/** Runs a flow, answering every question `answer` (default: no / the first choice). */
const run = (flow: Generator<Step, unknown, unknown>, answer: (s: Step) => unknown = () => false) => {
  const out: Step[] = [];
  let r = flow.next();
  while (!r.done) { out.push(r.value as Step); r = flow.next('ask' in (r.value as object) ? answer(r.value as Step) : undefined); }
  return out;
};
const call = (g: Game, name: string, ...a: unknown[]) => run((g as unknown as Any)[name].call(g, ...a));
const said = (steps: Step[]) => steps.filter(s => s.t === 'say').map(s => (s as { text: string }).text).join('\n');

describe.skipIf(!have)('派對模式 乞丐', () => {
  it('a human bankrupt in a party game becomes a walking beggar: no land, nothing left, still playing', () => {
    const g = setup(), b = g.players[0];
    const lot = g.board.lands[0]; lot.owner = 1;
    run(g.bankrupt(b));
    expect(b.bankrupt).toBe(true);
    expect(b.whoPlays).toBe(1);
    expect(g.isBeggar(b)).toBe(true);
    expect(g.isOut(b)).toBe(false);
    expect(lot.owner).toBe(0);
    expect(b.cash + b.bank).toBe(0);
    expect(g.over).toBeFalsy();
  });

  it('nowhere else: alone, or a computer, goes out as before', () => {
    const solo = setup(false, [true, false, false, false]);
    run(solo.bankrupt(solo.players[1]));
    expect(solo.isOut(solo.players[1])).toBe(true);
    const g = setup();
    run(g.bankrupt(g.players[3]));
    expect(g.isOut(g.players[3])).toBe(true);
    expect(g.isBeggar(g.players[3])).toBe(false);    // the host turned 乞丐復活 off (追加玩法): out as before
    const off = setup();
    off.settings.noBeggar = true;
    run(off.bankrupt(off.players[0]));
    expect(off.isOut(off.players[0])).toBe(true);
  });

  it('begs BEG from a player met, either one walking; 小衰神 half, 大衰神 nothing; never more than they have', () => {
    const g = setup(), b = g.players[0], q = g.players[1];
    run(g.bankrupt(b));
    b.node = q.node;
    const s1 = call(g, 'stepDone', b, 2);
    expect(b.cash).toBe(BEG);
    expect(q.cash).toBe(500000 - BEG);
    expect(said(s1)).toContain(`乞討${BEG}元`);
    // once a week each, whoever walks: crossing again the same week gives nothing
    call(g, 'stepDone', q, 1);
    call(g, 'stepDone', b, 0);
    expect(b.cash).toBe(BEG);
    // someone else walking by the beggar gives too
    const r = g.players[2];
    r.node = b.node;
    call(g, 'stepDone', r, 1);
    expect(b.cash).toBe(2 * BEG);
    // a week later: again; 小衰神 half, 大衰神 nothing
    g.daysElapsed += 7;
    const god = g.objects.godType.bind(g.objects);
    g.objects.godType = p => (p === b ? OBJ.SmallBadLuck : god(p));
    call(g, 'stepDone', b, 0);
    expect(b.cash).toBe(2 * BEG + 2 * BEG / 2);
    g.daysElapsed += 7;
    g.objects.godType = p => (p === b ? OBJ.BigBadLuck : god(p));
    call(g, 'stepDone', b, 0);
    expect(b.cash).toBe(2 * BEG + 2 * BEG / 2);
    g.objects.godType = god;
    // never more than they have
    g.daysElapsed += 7;
    q.cash = 300; q.bank = 0; r.node = -1;
    call(g, 'stepDone', b, 0);
    expect(q.cash).toBe(0);
    expect(q.bankrupt).toBe(false);
  });

  it('comes back at REVIVE', () => {
    const g = setup(), b = g.players[0], q = g.players[1];
    run(g.bankrupt(b));
    b.cash = REVIVE - BEG + 1; b.node = q.node;
    const s = call(g, 'stepDone', b, 0);
    expect(b.bankrupt).toBe(false);
    expect(g.isBeggar(b)).toBe(false);
    expect(said(s)).toContain('東山再起');
  });

  it('stops: no buying, no toll; 土地公 takes nothing for a beggar', () => {
    const g = setup(), b = g.players[0];
    run(g.bankrupt(b));
    b.cash = 40000;
    const n = g.board.nodes.find(x => x.event === 0 && landOf(g.board, x))!, lot = landOf(g.board, n)!;
    b.node = n.id;
    lot.owner = 0;
    const asked: Step[] = [];
    run(g.land(b), s => { asked.push(s); return true; });
    expect(lot.owner).toBe(0);
    expect(asked).toHaveLength(0);
    // someone's land: no toll, ALMS by its level from the owner instead (100 on an empty lot, up to 1,000 at level 5)
    const owner = g.players[1];
    for (const level of [0, 5, 5, 5, 5, 5]) {
      lot.owner = 2; lot.level = level;
      const [c, o] = [b.cash, owner.cash];
      run(g.land(b));
      const got = b.cash - c;
      expect(owner.cash).toBe(o - got);
      expect(got).toBeGreaterThanOrEqual(ALMS[0]);
      expect(got).toBeLessThanOrEqual(level ? ALMS[1] : ALMS[0]);
    }
    run(g.objects.earthGodTakes(b, lot, n.ref, n.id));
    expect(lot.owner).toBe(2);
  });

  it('keeps the cards it gets, uses none (the passive ones neither) till it is back', () => {
    const g = setup(), b = g.players[0];
    run(g.bankrupt(b));
    b.cards = [20, 21];
    expect(g.cards.has(b, 21)).toBe(false);
    b.cash = REVIVE;
    call(g, 'revive', b);
    expect(g.cards.has(b, 21)).toBe(true);
  });

  it('the last player who is not a beggar wins; a beggar who gives up is out', () => {
    const g = setup(true, [true, true, false, false]);
    run(g.bankrupt(g.players[0]));
    run(g.bankrupt(g.players[3]));
    expect(g.over).toBeFalsy();
    run(g.bankrupt(g.players[2]));
    expect(g.over?.winner).toBe(1);
    const h = setup();
    run(h.bankrupt(h.players[0]));
    call(h, 'surrender', h.players[0]);
    expect(h.isOut(h.players[0])).toBe(true);
  });

  it('keeps taking turns: the turn goes to the beggar', () => {
    const g = setup(), b = g.players[1];
    run(g.bankrupt(b));
    g.current = 0;
    const steps = call(g, 'endTurn');
    expect(g.current).toBe(1);
    expect(steps.length).toBeGreaterThanOrEqual(0);
  });
});
