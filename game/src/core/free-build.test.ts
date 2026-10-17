import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { HALLS } from './casino-rules';
import { pack } from './date';
import { FINALE_MAP } from './finale';
import { Game } from './game';
import { KB_MAP } from './kabukicho';
import type { Answer, Step } from './types';
import { applyOverlay } from './world';

// A human's free building on an own empty large plot (機器工人; 05 §3.8, fcn_0040b110 → fcn_00440aac): the facility
// type is asked, with each map's own picker (the original's five, 大富翁城's halls, 歌舞伎町's five shops).
const MAPS: Record<number, string> = { 100: 'tokyo', [FINALE_MAP]: 'finale', [KB_MAP]: 'kabukicho' };
const file = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/remake/${MAPS[id]}.json`, import.meta.url));
const have = Object.keys(MAPS).every(id => existsSync(file(Number(id))));

function game(mapId: number) {
  const r = JSON.parse(readFileSync(file(mapId), 'utf8')) as RawMap;
  const board = mapId === FINALE_MAP ? applyOverlay(parseBoard(r), undefined, FINALE_MAP) : parseBoard(r);
  const g = new Game({ mapId, players: [0, 4].map((character, i) => ({ character, human: i === 0 })), fundIndex: 1, traffic: 0, landLimitIndex: 0,
    daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 18), seed: 5 }, board);
  const p = g.players[0];
  p.placed = true; p.whoPlays = 1; p.tools[8] = 1;
  const f = g.board.facilities[0];
  f.owner = 1; f.level = 0; f.type = 0;
  return { g, p, f };
}

/** Runs a flow, answering each question with `answer` (and noting what was asked). */
function drive(flow: Generator<Step, unknown, Answer>, answer: (s: Step) => Answer) {
  const asked: Step[] = [];
  let r = flow.next(undefined as unknown as Answer);
  while (!r.done) {
    const s = r.value as Step & { ask?: boolean };
    if (s.ask) { asked.push(s); r = flow.next(answer(s)); } else r = flow.next(undefined as unknown as Answer);
  }
  return asked;
}

describe.skipIf(!have)('free building on an empty large plot asks a human for the type', () => {
  it('歌舞伎町: the five-shop picker; a cancel builds the plot\'s default shop', () => {
    const { g, p, f } = game(KB_MAP);
    const asked = drive(g.tools.use(p, 9, f.id + 4000) as Generator<Step, unknown, Answer>, s => ((s as { screen?: string }).screen === 'kb-shop' ? 13 : 0) as Answer);
    expect(asked.some(s => (s as { screen?: string }).screen === 'kb-shop')).toBe(true);
    expect([f.type, f.level]).toEqual([13, 1]);
    const b = game(KB_MAP);
    drive(b.g.tools.use(b.p, 9, b.f.id + 4000) as Generator<Step, unknown, Answer>, () => -1 as Answer);
    expect([b.f.type, b.f.level]).toEqual([b.g.rules!.facilityType!(b.f), 1]);
  });

  it('大富翁城: the hall picker', () => {
    const { g, p, f } = game(FINALE_MAP);
    const want = HALLS[2];
    const asked = drive(g.tools.use(p, 9, f.id + 4000) as Generator<Step, unknown, Answer>, s => ((s as { screen?: string }).screen === 'casino-hall' ? want : 0) as Answer);
    expect(asked.some(s => (s as { screen?: string }).screen === 'casino-hall')).toBe(true);
    expect(f.type).toBe(want);
    expect(f.level).toBeGreaterThanOrEqual(1);
  });

  it('a classic map: the original facility picker', () => {
    const { g, p, f } = game(100);
    const asked = drive(g.tools.use(p, 9, f.id + 4000) as Generator<Step, unknown, Answer>, s => (s.t === 'facility-type' ? 3 : 0) as Answer);
    expect(asked.some(s => s.t === 'facility-type')).toBe(true);
    expect([f.type, f.level]).toEqual([3, 1]);
  });
});

describe.skipIf(!have)('a facility reaching level 5 signals the top-out (fireworks, 02 §4.2), every type and path', () => {
  const step = (asked: Step[]) => asked;
  void step;
  const all = (flow: Generator<Step, unknown, Answer>, answer: (s: Step) => Answer = () => true as Answer) => {
    const out: Step[] = [];
    let r = flow.next(undefined as unknown as Answer);
    while (!r.done) { const s = r.value as Step & { ask?: boolean }; out.push(s); r = flow.next(s.ask ? answer(s) : undefined as unknown as Answer); }
    return out;
  };
  const cases: [number, number][] = [[100, 4], [100, 1], [100, 2], [KB_MAP, 10], [KB_MAP, 13], [KB_MAP, 4]];
  for (const [mapId, type] of cases) {
    it(`map ${mapId} type ${type}: the paid upgrade 4 → 5 and 機器工人 4 → 5`, () => {
      const { g, p, f } = game(mapId);
      f.type = type; f.level = 4; p.cash = 10_000_000;
      const paid = all(g.landOnFacility(p, f) as Generator<Step, unknown, Answer>);
      expect(paid.some(s => s.t === 'build' && s.kind === 'facility' && s.level === 5)).toBe(true);
      const b = game(mapId);
      b.f.type = type; b.f.level = 4;
      const robot = all(b.g.tools.use(b.p, 9, b.f.id + 4000) as Generator<Step, unknown, Answer>);
      expect(robot.some(s => s.t === 'fx' && s.kind === 'robot-worker' && (s.data as { done?: boolean }).done)).toBe(true);
    });
  }
});
