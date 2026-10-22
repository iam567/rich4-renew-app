import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Facility, type RawMap } from './board';
import { pack } from './date';
import { FACILITY_MAX_LEVEL, Game } from './game';
import { JQ_MAP, JiqingRules, jqRules } from './jiqing';
import { JQ_FAC_TYPES, JQ_FATE, JQ_NEWS, JQ_PARK_BAD, JQ_PARK_GOOD, STUDY_DAYS, T_XUAN, xuanFactor } from './modules/jq-data';
import { loadGame, saveGame } from './save';
import type { GameSettings, Player, Step } from './types';

// 激情歲月 (docs/rules/24): map 107's own rules in a normal game.
const file = fileURLToPath(new URL('../../../editor/site/assets/remake/jiqing.json', import.meta.url));
const have = existsSync(file);
const board = () => parseBoard(JSON.parse(readFileSync(file, 'utf8')) as RawMap);

function settings(seed: number, chars = [0, 4, 9, 11]): GameSettings {
  return {
    mapId: JQ_MAP, players: chars.map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 22), seed,
  };
}

/** Runs computers for `days`; every step goes to `see`. */
function run(g: Game, days: number, see?: (s: Step) => void): void {
  const flow = g.run();
  for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; r = flow.next()) see?.(r.value as Step);
}
/** Runs a flow to its end (computers only: no question is asked); its value and its steps. */
function drain<T>(f: Generator<unknown, T, unknown>): { value: T; out: Step[] } {
  const out: Step[] = [];
  let r = f.next();
  while (!r.done) { out.push(r.value as Step); r = f.next(); }
  return { value: r.value, out };
}

/** A game with everyone on the road, `visitor` on the facility's square and a built facility of `owner`. */
function scene(seed: number, type: number, level: number) {
  const g = new Game(settings(seed), board()), jq = jqRules(g)!;
  for (const q of g.players) { q.placed = true; q.whoPlays = 2; q.cards = []; q.cash = 50000; q.bank = 50000; }
  const f = g.board.facilities[0], node = g.board.nodes.find(n => n.ref === f.id + 4000)!;
  const [visitor, owner] = g.players;
  f.owner = owner.id + 1; f.type = type; f.level = level;
  visitor.node = node.id;
  return { g, jq, f, visitor, owner, third: g.players[2] };
}

describe.skipIf(!have)('激情歲月 (map 107)', () => {
  it('the map: 160 squares, 72 lots, 14 large plots, two banks (人民銀行, 人民銀行支行), the era names', () => {
    const b = board();
    expect(b.nodes).toHaveLength(160);
    expect(b.lands).toHaveLength(72);
    expect(b.facilities).toHaveLength(14);
    const raw = (JSON.parse(readFileSync(file, 'utf8')) as { nodes: { name: string; type_aux: number }[] }).nodes;
    expect(raw.filter(n => n.type_aux === 27).map(n => n.name).sort()).toEqual(['人民銀行', '人民銀行支行']);
    expect(raw.filter(n => n.type_aux === 3).every(n => n.name === '廣播站')).toBe(true);
    expect(raw.find(n => n.type_aux === 7)!.name).toBe('牛棚');
  });

  it('tables: 24 news, 24 fate, two park decks of 8; the facility cap only grows at the end', () => {
    expect(JQ_NEWS).toHaveLength(24);
    expect(JQ_FATE).toHaveLength(24);
    expect(JQ_PARK_GOOD).toHaveLength(8);
    expect(JQ_PARK_BAD).toHaveLength(8);
    expect(FACILITY_MAX_LEVEL.slice(0, 14)).toEqual([1, 5, 5, 1, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(FACILITY_MAX_LEVEL[T_XUAN]).toBe(5);
    expect([1, 2, 3, 4, 5].map(xuanFactor)).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  it('宣傳站: a scooter / a car pays the gas fee × (1 + 0.5 × (level − 1)) to the owner and sits 2 turns in the 學習班', () => {
    for (const [vehicle, level] of [[1, 1], [1, 3], [2, 5], [2, 2]] as const) {
      const { g, jq, f, visitor, owner } = scene(3 + level, T_XUAN, level);
      visitor.traffic = vehicle; g.diceTotal = 7;
      const before = owner.cash + owner.bank;
      drain(g.landOnFacility(visitor, f));
      const fine = Math.trunc(500 * (1 << (vehicle - 1)) * 7 * g.priceIndex * xuanFactor(level));
      expect(owner.cash + owner.bank - before, `vehicle ${vehicle} level ${level}`).toBe(fine);
      expect(jq.s.study[visitor.id]).toBe(STUDY_DAYS);
      // the two turns are sat out in place
      const at = visitor.node;
      expect(drain(jq.turnHold(g, visitor)).value).toBe(true);
      expect(drain(jq.turnHold(g, visitor)).value).toBe(true);
      expect(drain(jq.turnHold(g, visitor)).value).toBe(false);
      expect(visitor.node).toBe(at);
    }
  });

  it('宣傳站: walking and the 工程車 go free; an absent owner (牛棚) neither fines nor holds', () => {
    const a = scene(10, T_XUAN, 3);
    const cash = a.visitor.cash;
    drain(a.g.landOnFacility(a.visitor, a.f));
    expect(a.visitor.cash).toBe(cash);
    expect(a.jq.s.study[a.visitor.id]).toBe(0);
    a.visitor.traffic = 3; a.g.diceTotal = 5;
    drain(a.g.landOnFacility(a.visitor, a.f));
    expect(a.visitor.cash).toBe(cash);
    expect(a.jq.s.study[a.visitor.id]).toBe(0);
    const b = scene(11, T_XUAN, 3);
    b.visitor.traffic = 2; b.g.diceTotal = 9; b.owner.prison = 3;
    const c0 = b.visitor.cash;
    drain(b.g.landOnFacility(b.visitor, b.f));
    expect(b.visitor.cash).toBe(c0);
    expect(b.jq.s.study[b.visitor.id]).toBe(0);
  });

  it('宣傳站: 免費卡 waives the fine but not the class; 嫁禍卡 moves both to the framed one', () => {
    const a = scene(12, T_XUAN, 2);
    a.visitor.traffic = 1; a.g.diceTotal = 12; a.visitor.cash = 100; a.visitor.bank = 0; a.visitor.cards = [20];
    const own = a.owner.cash + a.owner.bank;
    drain(a.g.landOnFacility(a.visitor, a.f));
    expect(a.visitor.cards).not.toContain(20);
    expect(a.owner.cash + a.owner.bank).toBe(own);
    expect(a.jq.s.study[a.visitor.id]).toBe(STUDY_DAYS);
    const b = scene(13, T_XUAN, 2);
    b.visitor.traffic = 2; b.g.diceTotal = 12; b.visitor.cash = 100; b.visitor.bank = 0; b.visitor.cards = [19];
    drain(b.g.landOnFacility(b.visitor, b.f));
    expect(b.visitor.cards).not.toContain(19);
    expect(b.jq.s.study[b.visitor.id]).toBe(0);
    const framed = b.g.players.filter(q => b.jq.s.study[q.id] > 0);
    expect(framed.length).toBeLessThanOrEqual(1);
    if (framed.length) expect(framed[0].id).not.toBe(b.owner.id);
  });

  it('人民公園: the owner draws a good card, anyone else a bad card, an ally nothing', () => {
    const a = scene(20, 0, 1);
    const goodBefore = a.jq.s.good.next, badBefore = a.jq.s.bad.next;
    a.owner.node = a.visitor.node;
    const og = drain(a.g.landOnFacility(a.owner, a.f)).out;
    expect(a.jq.s.good.next).toBe((goodBefore + 1) % 8);
    expect(og.some(s => s.t === 'fx' && s.kind === 'jq-card' && s.data?.good === true)).toBe(true);
    const vb = drain(a.g.landOnFacility(a.visitor, a.f)).out;
    expect(a.jq.s.bad.next).toBe((badBefore + 1) % 8);
    expect(vb.some(s => s.t === 'fx' && s.kind === 'jq-card' && s.data?.good === false)).toBe(true);
    a.owner.ally = a.visitor.id + 1; a.visitor.ally = a.owner.id + 1;
    const n = a.jq.s.bad.next;
    drain(a.g.landOnFacility(a.visitor, a.f));
    expect(a.jq.s.bad.next).toBe(n);
  });

  it('every park card does what it says without hanging', () => {
    for (const [i, c] of [...JQ_PARK_GOOD, ...JQ_PARK_BAD].entries()) {
      const a = scene(30 + i, 0, 1);
      const good = JQ_PARK_GOOD.includes(c), deck = good ? a.jq.s.good : a.jq.s.bad, list = good ? JQ_PARK_GOOD : JQ_PARK_BAD;
      deck.deck = [list.indexOf(c), ...deck.deck.filter(x => x !== list.indexOf(c))]; deck.next = 0;
      const who = good ? a.owner : a.visitor;
      who.node = a.visitor.node; who.cards = [3];
      const before = JSON.stringify([who.cash, who.bank, who.points, who.cards, who.tools, who.stay, who.prison, who.hospital, a.owner.cash]);
      const out = drain(a.g.landOnFacility(who, a.f)).out;
      expect(out.some(s => s.t === 'fx' && s.kind === 'event-result'), c.id).toBe(true);
      const after = JSON.stringify([who.cash, who.bank, who.points, who.cards, who.tools, who.stay, who.prison, who.hospital, a.owner.cash]);
      // (the hospital wheel may stop on 0, a god may spare: then nothing changed)
      if (c.id !== 'jq-pb-capsize') expect(after, c.id).not.toBe(before);
    }
  });

  it('computers build each of the five facilities about a fifth of the time (own stream), never the 加油站', () => {
    const g = new Game(settings(40), board()), jq = jqRules(g)!;
    const count: Record<number, number> = {};
    for (let i = 0; i < 2000; i++) { const t = jq.aiFacility(g, g.players[i % 4]); count[t] = (count[t] ?? 0) + 1; }
    expect(Object.keys(count).map(Number).sort((a, b) => a - b)).toEqual([...JQ_FAC_TYPES].sort((a, b) => a - b));
    for (const t of JQ_FAC_TYPES) { expect(count[t]).toBeGreaterThan(300); expect(count[t]).toBeLessThan(500); }
    expect(count[3]).toBeUndefined();
  });

  it('every news and fate card can happen (its preconditions set up) and shows its board', () => {
    for (const [i, c] of [...JQ_NEWS, ...JQ_FATE].entries()) {
      const g = new Game(settings(60 + i, [0, 4, 9, 2]), board()), jq = jqRules(g)!;
      for (const q of g.players) { q.placed = true; q.whoPlays = 2; q.cash = 30000; q.bank = 20000; q.cards = [3, 5]; q.tools[0] = 1; }
      const [p, q] = g.players;
      g.players[3].traffic = 1;   // a rider (批林批孔)
      p.node = g.board.nodes.find(n => n.ref > 2000 && n.ref < 4000)!.id;
      // something to act on: built lots, a park, someone in hospital, an own empty lot, walkers and a child
      for (const l of g.board.lands.slice(0, 20)) { l.owner = 2; l.level = 2; }
      g.board.lands[30].owner = 1; g.board.lands[30].level = 0;
      const park: Facility = g.board.facilities[1]; park.owner = 2; park.type = 0; park.level = 1;
      q.hospital = 2;
      const out = drain(c.kind === 'news' ? jq.runNews(g, p, c) : jq.runFate(g, p, c));
      expect(out.value, c.id).toBe(true);
      expect(out.out.some(s => s.t === 'fx' && (s.kind === 'news' || s.kind === 'fate') && s.data?.local === (c.pic ?? c.id)), c.id).toBe(true);
    }
  });

  it('上山下鄉 / 下放五七幹校: away as 下鄉中 / 下放中 instead of 消失中', () => {
    const g = new Game(settings(90, [0, 4, 9, 2]), board()), jq = jqRules(g)!;
    for (const q of g.players) { q.placed = true; q.whoPlays = 2; }
    drain(jq.runNews(g, g.players[0], JQ_NEWS.find(c => c.id === 'jq-n-zhiqing')!));
    const kid = g.players[2];
    expect(kid.vanish & 0x3f).toBe(3);
    expect(jq.vanishLabel(g, kid)).toBe('下鄉中');
    expect(g.players[0].vanish).toBe(0);
  });

  it('a year of computers: all five facilities, 宣傳站 verdicts, park cards, the decks, the 學習班; nothing hangs', () => {
    const kinds: Record<string, number> = {}, types: Record<number, number> = {};
    for (const seed of [1, 2, 3]) {
      const g = new Game({ ...settings(seed), traffic: 1 }, board());
      expect(g.rules).toBeInstanceOf(JiqingRules);
      let steps = 0;
      run(g, 365, s => { steps++; if (s.t === 'fx') kinds[s.kind] = (kinds[s.kind] ?? 0) + 1; });
      expect(steps).toBeGreaterThan(1000);
      expect(g.daysElapsed >= 365 || !!g.over, `seed ${seed}: day ${g.daysElapsed}`).toBe(true);
      for (const f of g.board.facilities) if (f.level) { types[f.type] = (types[f.type] ?? 0) + 1; expect([...JQ_FAC_TYPES] as number[]).toContain(f.type); }
    }
    for (const k of ['news', 'fate', 'event-result', 'jq-card', 'jq-verdict', 'jq-study']) expect(kinds[k] ?? 0, k).toBeGreaterThan(0);
    expect(Object.keys(types).length).toBeGreaterThanOrEqual(4);
  }, 300_000);

  it('a saved game plays on the same as the unsaved one', () => {
    const g = new Game(settings(11), board());
    run(g, 60);
    const save = saveGame(g);
    expect(save.mapRules).toBeTruthy();
    const h = (x: Game) => { const c = createHash('sha256'); run(x, 120, s => c.update(JSON.stringify(s))); return c.digest('hex'); };
    const a = loadGame(JSON.parse(JSON.stringify(save)), board());
    const b = loadGame(JSON.parse(JSON.stringify(save)), board());
    expect(jqRules(a)!.s).toEqual(jqRules(g)!.s);
    expect(h(a)).toBe(h(b));
  }, 120_000);

  it('the same seed plays the same game (派對模式 lockstep: no Math.random, no clock)', () => {
    const h = () => { const g = new Game(settings(77), board()); const c = createHash('sha256'); run(g, 120, s => c.update(JSON.stringify(s))); return c.digest('hex'); };
    const real = Math.random;
    const a = h();
    Math.random = () => 0.123;
    try { expect(h()).toBe(a); } finally { Math.random = real; }
  }, 120_000);
});

void ({} as Player);
