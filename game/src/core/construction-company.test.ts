import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { HALLS } from './casino-rules';
import { pack } from './date';
import { FINALE_MAP } from './finale';
import { FACILITY_MAX_LEVEL, Game, REMAKE_FREE_BUILD } from './game';
import { KB_MAP } from './kabukicho';
import type { Answer, Step } from './types';
import { applyOverlay } from './world';

// The construction company's free floors (docs/rules/02 §5; REMAKE_FREE_BUILD, the user 2026-10-18): own lots and own
// large plots alike — an empty plot is built first with the facility-type picker (the map's own on 歌舞伎町 / 大富翁城),
// each type up to its own top, fireworks whenever the floors top it out; the computer chooses from the same set.
const MAPS: Record<number, string> = { 100: 'tokyo', [FINALE_MAP]: 'finale', [KB_MAP]: 'kabukicho' };
const file = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/remake/${MAPS[id]}.json`, import.meta.url));
const have = Object.keys(MAPS).every(id => existsSync(file(Number(id))));

/** Player 0 (human unless `computer`) controls a construction company (category 11) and owns large plot #1. */
function game(mapId: number, computer = false) {
  const r = JSON.parse(readFileSync(file(mapId), 'utf8')) as RawMap;
  const board = mapId === FINALE_MAP ? applyOverlay(parseBoard(r), undefined, FINALE_MAP) : parseBoard(r);
  const g = new Game({ mapId, players: [0, 4].map((character, i) => ({ character, human: i === 0 && !computer })), fundIndex: 1, traffic: 0,
    landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 18), seed: 5 }, board);
  const p = g.players[0];
  p.placed = true;
  if (!computer) p.whoPlays = 1;
  for (const l of g.board.lands) l.owner = 0;
  for (const x of g.board.facilities) x.owner = 0;
  const f = g.board.facilities[0];
  f.owner = 1; f.level = 0; f.type = 0;
  const c = g.board.companies[0]; // 大富翁城 has none
  if (c) { c.category = 11; c.controller = 1; }
  return { g, p, f, c };
}

/** Runs a flow to its end, answering each question with `answer`; returns every step. */
function run(flow: Generator<Step, unknown, Answer>, answer: (s: Step) => Answer) {
  const out: Step[] = [];
  let r = flow.next(undefined as unknown as Answer);
  while (!r.done) { const s = r.value as Step & { ask?: boolean }; out.push(s); r = flow.next(s.ask ? answer(s) : undefined as unknown as Answer); }
  return out;
}

const nodeOf = (g: Game, ref: number) => g.board.nodes.find(n => n.ref === ref)!.id;
const fx = (steps: Step[]) => steps.find(s => s.t === 'fx' && s.kind === 'free-upgrade') as { data: { ref: number; level: number; top: boolean } } | undefined;
/** Answers: the plot for the map pick, `type` (or a map screen's choice) for the type, no to the shares. */
const answers = (g: Game, ref: number, type: number) => (s: Step): Answer => {
  if (s.t === 'pick-node') return nodeOf(g, ref) as Answer;
  if (s.t === 'yesno') return false as Answer;
  return type as Answer;
};

describe.skipIf(!have)('construction company: free floors on large plots too (02 §5, REMAKE_FREE_BUILD)', () => {
  it('東京: the empty own plot glows on its building; the type is asked; two floors', () => {
    const { g, p, f, c } = game(100);
    const steps = run(g.stocks.landOnCompany(p, c) as Generator<Step, unknown, Answer>, answers(g, f.id + 4000, 2));
    const pick = steps.find(s => s.t === 'pick-node') as Extract<Step, { t: 'pick-node' }>;
    expect(pick.plot).toBe(true);
    expect(pick.nodes).toContain(nodeOf(g, f.id + 4000));
    expect(steps.some(s => s.t === 'facility-type')).toBe(true);
    expect([f.type, f.level]).toEqual([2, 2]);
    expect(fx(steps)?.data).toMatchObject({ ref: f.id + 4000, level: 2, top: false });
  });

  it('a park (top 1) built on an empty plot is topped out at once: one floor, fireworks', () => {
    const { g, p, f, c } = game(100);
    const steps = run(g.stocks.landOnCompany(p, c) as Generator<Step, unknown, Answer>, answers(g, f.id + 4000, 0));
    expect([f.type, f.level]).toEqual([0, 1]);
    expect(fx(steps)?.data).toMatchObject({ level: 1, top: true });
  });

  it('a facility topped out by the second floor gets the fireworks too (off: only by the first, as the original)', () => {
    for (const on of [true, false]) {
      REMAKE_FREE_BUILD.on = on;
      try {
        const { g, p, f, c } = game(100);
        f.type = 2; f.level = 3;
        const steps = run(g.stocks.landOnCompany(p, c) as Generator<Step, unknown, Answer>, answers(g, f.id + 4000, 0));
        expect(f.level).toBe(5);
        expect(fx(steps)?.data.top).toBe(on);
      } finally { REMAKE_FREE_BUILD.on = true; }
    }
  });

  it('a facility at its type\'s top is not offered; neither is someone else\'s plot', () => {
    const { g, p, f } = game(100);
    f.type = 3; f.level = FACILITY_MAX_LEVEL[3];
    const other = g.board.facilities[1];
    other.owner = 2; other.level = 0;
    const refs = g.stocks.upgradableRefs(p);
    expect(refs).not.toContain(f.id + 4000);
    expect(refs).not.toContain(other.id + 4000);
  });

  it('with REMAKE_FREE_BUILD off the empty plot is not offered (the remake\'s earlier rule)', () => {
    const { g, p, f } = game(100);
    REMAKE_FREE_BUILD.on = false;
    try { expect(g.stocks.upgradableRefs(p)).not.toContain(f.id + 4000); } finally { REMAKE_FREE_BUILD.on = true; }
    expect(g.stocks.upgradableRefs(p)).toContain(f.id + 4000);
  });

  it('歌舞伎町: the five-shop picker on an empty plot; a built shop below its top is offered', () => {
    const { g, p, f, c } = game(KB_MAP);
    const steps = run(g.stocks.landOnCompany(p, c) as Generator<Step, unknown, Answer>,
      s => (s.t === 'pick-node' ? nodeOf(g, f.id + 4000) : s.t === 'yesno' ? false : (s as { screen?: string }).screen === 'kb-shop' ? 12 : 0) as Answer);
    expect(steps.some(s => (s as { screen?: string }).screen === 'kb-shop')).toBe(true);
    expect([f.type, f.level]).toEqual([12, 2]);
    const b = game(KB_MAP);
    b.f.type = 11; b.f.level = 2;
    expect(b.g.stocks.upgradableRefs(b.p)).toContain(b.f.id + 4000);
    b.f.level = FACILITY_MAX_LEVEL[11];
    expect(b.g.stocks.upgradableRefs(b.p)).not.toContain(b.f.id + 4000);
  });

  it('大富翁城 (no companies there): an empty hall plot is offered and built with the hall picker', () => {
    const { g, p, f } = game(FINALE_MAP);
    expect(g.stocks.upgradableRefs(p)).toContain(f.id + 4000);
    const want = HALLS[1];
    const steps = run(g.buildEmptyPlot(p, f) as Generator<Step, unknown, Answer>, s => ((s as { screen?: string }).screen === 'casino-hall' ? want : 0) as Answer);
    expect(steps.some(s => (s as { screen?: string }).screen === 'casino-hall')).toBe(true);
    expect([f.type, f.level]).toEqual([want, 1]);
  });

  it('the computer chooses from the same set: its only property, an empty plot, is built', () => {
    const { g, p, f, c } = game(100, true);
    const steps = run(g.stocks.landOnCompany(p, c) as Generator<Step, unknown, Answer>, () => false as Answer);
    expect(steps.some(s => s.t === 'pick-node' || s.t === 'facility-type')).toBe(false);
    expect(f.level).toBeGreaterThanOrEqual(1);
    expect(f.type).toBeGreaterThanOrEqual(1);
    expect(fx(steps)?.data.ref).toBe(f.id + 4000);
  });

  it('someone else\'s construction company: one free floor, an empty plot of the visitor built too', () => {
    const { g, p, f, c } = game(100);
    c.controller = 2;
    p.cash = 1_000_000;
    const steps = run(g.stocks.landOnCompany(p, c) as Generator<Step, unknown, Answer>, answers(g, f.id + 4000, 4));
    expect([f.type, f.level]).toEqual([4, 1]);
    expect(fx(steps)?.data).toMatchObject({ ref: f.id + 4000, level: 1 });
  });
});
