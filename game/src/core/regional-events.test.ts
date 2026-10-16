import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Board, type RawMap } from './board';
import { pack } from './date';
import type { Flow } from './flow';
import { Game } from './game';
import { Rng } from './rng';
import { saveWorld } from './save';
import type { Answer, Player, Step } from './types';
import { applyOverlay, TYCOON_MAPS, World, type TycoonOverlay, type TycoonSettings } from './world';
import {
  BAD_SHARE, choose, drawStream, eligible, LOCAL_CHANCE, pool, regional, REGIONAL_EVENTS, REGIONAL_ID_BASE, regionalDraw, runEvent,
} from './modules/regional-events';
import type { RegionalEvent } from './modules/regional-data';

// 大富豪模式 local news and fate (docs/rules/18).
const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };
const file = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/remake/${KEYS[id]}.json`, import.meta.url));
const have = TYCOON_MAPS.every(id => existsSync(file(id)));
const raw = (id: number) => JSON.parse(readFileSync(file(id), 'utf8')) as RawMap & { tycoon?: TycoonOverlay };
let cached: Board[] | null = null;
const boards = (): Board[] => (cached ??= TYCOON_MAPS.map(id => { const r = raw(id); return applyOverlay(parseBoard(r), r.tycoon, id); })).map(b => structuredClone(b));

function settings(seed: number, start = pack(2026, 10, 16)): TycoonSettings {
  return {
    mode: 'tycoon', maps: [...TYCOON_MAPS], players: Array.from({ length: 12 }, (_, i) => ({ character: i, human: false })),
    fundIndex: 1, traffic: 1, landLimitIndex: 0, startDate: start, seed,
  };
}

/** Runs a flow to its end; computers never ask (a question gets the headless answer). */
function drain<T>(flow: Flow<T>): { steps: Step[]; value: T } {
  const steps: Step[] = [];
  let a: Answer, r = flow.next();
  while (!r.done) { steps.push(r.value); a = 'ask' in r.value ? -1 : undefined; r = flow.next(a); }
  return { steps, value: r.value };
}

/** A world with players 0..3 standing on city `ci`'s road (placed, no gods, no cards). */
function cityWorld(ci: number, seed = 7) {
  const w = new World(settings(seed), boards());
  const g = w.cities[ci];
  const road = g.board.nodes.filter(n => (n.event === 0 || n.event === 1) && n.adjacent.some(Boolean));
  w.players.forEach((p, i) => {
    p.map = i < 4 ? ci : (ci + 1) % 5; p.trip = undefined; w.landed[p.id] = true;
    p.whoPlays = 2; p.cards = []; p.god = 0; p.luckMoney = 0; p.luckFate = 0; p.insurance = 0;
    p.node = road[i * 3].id; p.lastNode = road[i * 3].adjacent.find(Boolean)!;
  });
  w.mask(ci);
  return { w, g, p: w.players[0] };
}

const money = (p: Player) => p.cash + p.bank;
const levels = (g: Game) => g.board.lands.reduce((s, l) => s + l.level, 0) + g.board.facilities.reduce((s, f) => s + f.level, 0);

describe('local event data (18 §4)', () => {
  it('has ten news and ten fate per city, five good and five bad, unique ids, valid texts', () => {
    expect(REGIONAL_EVENTS).toHaveLength(100);
    expect(new Set(REGIONAL_EVENTS.map(e => e.id)).size).toBe(100);
    for (const map of TYCOON_MAPS) for (const kind of ['news', 'fate'] as const) {
      expect(pool(map, kind)).toHaveLength(10);
      expect(pool(map, kind, 'good')).toHaveLength(5);
      expect(pool(map, kind, 'bad')).toHaveLength(5);
      // Each tone has an event that needs no month or weather, so the city's luck weight always holds.
      for (const tone of ['good', 'bad'] as const) expect(pool(map, kind, tone).some(e => !e.when)).toBe(true);
    }
    for (const e of REGIONAL_EVENTS) {
      expect(e.id.startsWith(KEYS[e.map])).toBe(true);
      expect(e.head.length).toBeGreaterThan(2);
      for (const m of e.text.matchAll(/\{(\w+)\}/g)) expect(['amount', 'street', 'lot', 's2', 's5', 's6', 's8', 's9']).toContain(m[1]);
    }
    // The weights the user set: 東京 60 % bad, 沖繩 30 %; the others in between.
    expect(BAD_SHARE).toEqual({ 100: 0.6, 101: 0.55, 102: 0.4, 103: 0.5, 104: 0.3 });
  });
});

describe.skipIf(!have)('大富豪模式 local news and fate', () => {
  it('draws a local event with LOCAL_CHANCE and a bad one with the city\'s weight', () => {
    for (const [ci, map] of TYCOON_MAPS.entries()) {
      const { g, w } = cityWorld(ci);
      // Something for every event to act on: the first player owns built lots and facilities here.
      g.board.lands.slice(0, 8).forEach(l => { l.owner = 1; l.level = 2; });
      g.board.facilities.slice(0, 2).forEach(f => { f.owner = 2; f.level = 2; f.type = 1; });
      for (const kind of ['news', 'fate'] as const) {
        let local = 0, bad = 0;
        const N = 6000;
        for (let i = 0; i < N; i++) {
          g.daysElapsed = i;
          const p = w.players[i % 4];
          const e = choose(g, p, kind, drawStream(g, p, kind));
          if (!e) continue;
          local++;
          if (e.tone === 'bad') bad++;
          expect(e.map).toBe(map);
          expect(e.kind).toBe(kind);
        }
        expect(Math.abs(local / N - LOCAL_CHANCE), `${map} ${kind} local`).toBeLessThan(0.025);
        expect(Math.abs(bad / local - BAD_SHARE[map]), `${map} ${kind} bad`).toBeLessThan(0.03);
      }
    }
  });

  it('is deterministic: the same city, day, player and draw give the same choice; nothing reads the city rand()', () => {
    const a = cityWorld(2), b = cityWorld(2);
    const before = a.g.rng.seed;
    const pick = (x: typeof a) => Array.from({ length: 50 }, (_, i) => { x.g.daysElapsed = i; return choose(x.g, x.p, 'fate', drawStream(x.g, x.p, 'fate'))?.id ?? '-'; });
    expect(pick(a)).toEqual(pick(b));
    expect(a.g.rng.seed).toBe(before);
    // A second draw the same day by the same player is a different stream.
    a.g.daysElapsed = b.g.daysElapsed = 99;
    const first = drawStream(a.g, a.p, 'news').rand(), second = drawStream(a.g, a.p, 'news').rand();
    expect(first).toBe(drawStream(b.g, b.p, 'news').rand());
    expect(second).not.toBe(first);
  });

  it('respects months and today\'s weather', () => {
    const { g, p } = cityWorld(2);
    const festival = REGIONAL_EVENTS.find(e => e.id === 'sapporo-f-festival-fee')!;
    g.date = pack(2027, 2, 5); expect(eligible(g, p, festival)).toBe(true);
    g.date = pack(2027, 7, 5); expect(eligible(g, p, festival)).toBe(false);
    // 屋頂積雪滑落 only on a snowy day: in 札幌's winter most days snow, in summer none.
    const roof = REGIONAL_EVENTS.find(e => e.id === 'sapporo-f-roofsnow')!;
    const days = (m: number) => Array.from({ length: 28 }, (_, d) => { g.date = pack(2027, m, d + 1); return eligible(g, p, roof); }).filter(Boolean).length;
    expect(days(1)).toBeGreaterThan(10);
    expect(days(7)).toBe(0);
    // 沖繩's typhoon news never in a month without typhoons.
    const o = cityWorld(4);
    const typhoon = REGIONAL_EVENTS.find(e => e.id === 'okinawa-n-typhoon')!;
    o.g.board.lands[0].owner = 1; o.g.board.lands[0].level = 1;
    for (let d = 1; d <= 28; d++) { o.g.date = pack(2027, 2, d); expect(eligible(o.g, o.p, typhoon)).toBe(false); }
  });

  it('applies every event as its table says', () => {
    for (const e of REGIONAL_EVENTS) {
      const ci = TYCOON_MAPS.indexOf(e.map as typeof TYCOON_MAPS[number]);
      const { w, g, p } = cityWorld(ci, 31);
      const F = g.priceIndex = w.priceIndex = 2;
      const b = g.board;
      // Player 0 owns built lots (one street) and a hotel; player 1 owns two more lots; everyone holds cash.
      const street = b.lands.filter(l => l.name === b.lands[0].name);
      for (const l of [...street, ...b.lands.slice(10, 13)]) { l.owner = 1; l.level = 2; }
      for (const l of b.lands.slice(20, 22)) { l.owner = 2; l.level = 1; }
      b.facilities[0].owner = 1; b.facilities[0].level = 2; b.facilities[0].type = 1;
      for (const q of w.players) { q.cash = 500000; q.bank = 500000; }
      p.cards = [5, 6]; p.points = 300;
      g.date = pack(2027, 1, 10);
      const before = { money: w.players.map(money), levels: levels(g), cards: p.cards.length, tools: [...p.tools], points: p.points, pool: g.lotteryPool };
      const prices = b.lands.map(l => l.price);
      const fx = e.effect as { amount?: number; days?: number; id?: number; n?: number; slots?: number[] | 'all'; up?: boolean; delta?: number; factor?: number; lots?: number; levels?: number };
      const funds = b.companies.map(c => c.fundA);
      const { steps } = drain(runEvent(g, p, e as RegionalEvent, new Rng(5)));
      const board = steps.find(s => !('ask' in s) && s.t === 'fx' && s.kind === e.kind);
      expect(board && !('ask' in board) && board.t === 'fx' && board.data?.local, e.id).toBe(e.id);
      expect(board && !('ask' in board) && board.t === 'fx' && board.data?.id).toBe(REGIONAL_ID_BASE + REGIONAL_EVENTS.indexOf(e));
      const res = steps.find(s => !('ask' in s) && s.t === 'fx' && s.kind === 'event-result');
      expect(res, e.id).toBeTruthy();
      const d = (i: number) => money(w.players[i]) - before.money[i];
      const locals = w.players.slice(0, 4);
      switch (e.effect.t) {
        case 'gain': expect(d(0), e.id).toBe(fx.amount! * F); break;
        case 'fine': expect(d(0), e.id).toBe(-fx.amount! * F); expect(g.lotteryPool - before.pool).toBe(fx.amount! * F); break;
        case 'repair': expect(d(0), e.id).toBeLessThan(0); break;
        case 'hospital': expect(p.hospital, e.id).toBe(fx.days); break;
        case 'prison': expect(p.prison, e.id).toBe(fx.days); break;
        case 'stay': if (e.kind === 'fate') expect(p.stay, e.id).toBe(1); else for (const q of locals) expect(q.stay, e.id).toBe(1); break;
        case 'card': expect(p.cards.length - before.cards, e.id).toBe(fx.n ?? 1); if (fx.id) expect(p.cards).toContain(fx.id); break;
        case 'tool': expect(p.tools[fx.id! - 1] - before.tools[fx.id! - 1], e.id).toBe(1); break;
        case 'points': expect(p.points - before.points, e.id).toBe(fx.amount); break;
        case 'upgrade': case 'renovate': expect(levels(g) - before.levels, e.id).toBe(1); break;
        case 'lose-card': expect(before.cards - p.cards.length, e.id).toBe(1); break;
        case 'per-lot': case 'facility': {
          const sign = Math.sign(fx.amount!);
          expect(Math.sign(d(0)), e.id).toBe(sign);
          if (e.effect.t === 'per-lot') expect(Math.abs(d(1)), e.id).toBe(Math.min(e.effect.cap, Math.abs(fx.amount!) * 2) * F);
          break;
        }
        case 'per-level': {
          const own = (o: number) => b.lands.filter(l => l.owner === o).reduce((x, l) => x + l.level, 0) + b.facilities.filter(f => f.owner === o).reduce((x, f) => x + f.level, 0);
          expect(d(0), e.id).toBe(-Math.min(e.effect.cap, fx.amount! * own(1)) * F);
          expect(d(1), e.id).toBe(-Math.min(e.effect.cap, fx.amount! * own(2)) * F);
          break;
        }
        case 'value-tax': expect(d(0), e.id).toBeLessThan(0); break;
        case 'everyone': for (const [i] of locals.entries()) expect(d(i), e.id).toBe(fx.amount! * F); expect(d(6)).toBe(0); break;
        case 'top-owner': expect(d(0), e.id).toBe(fx.amount! * F); break;
        case 'damage': expect(before.levels - levels(g), e.id).toBeGreaterThanOrEqual(1); expect(before.levels - levels(g), e.id).toBeLessThanOrEqual(fx.lots! * fx.levels!); break;
        case 'area': case 'typhoon': expect(before.levels - levels(g), e.id).toBeGreaterThan(0); break;
        case 'stocks': {
          const slots = fx.slots === 'all' ? g.stocks.stocks.map((_, i) => i) : fx.slots!;
          for (const s of slots) expect(g.stocks.stocks[s].forced, e.id).toBe(fx.up ? (e.effect as { days: number }).days << 4 : (e.effect as { days: number }).days);
          break;
        }
        case 'company': expect(b.companies.some((c, i) => c.fundA - funds[i] === fx.delta), e.id).toBe(true); break;
        case 'street': {
          const changed = b.lands.filter((l, i) => l.price !== prices[i]);
          expect(changed.length, e.id).toBeGreaterThan(0);
          for (const l of changed) expect(Math.abs(l.price - Math.trunc(prices[l.id - 1] * fx.factor!)), e.id).toBeLessThanOrEqual(1);
          break;
        }
        case 'cards-all': for (const q of locals) expect(q.cards.length, e.id).toBeGreaterThan(0); break;
        case 'one-hospital': expect(locals.filter(q => q.hospital).length, e.id).toBe(1); break;
      }
      // Nobody's money goes below zero, nothing ends the game.
      for (const q of w.players) { expect(q.cash).toBeGreaterThanOrEqual(0); expect(q.bank).toBeGreaterThanOrEqual(0); }
    }
  });

  it('uses one nationwide news deck and one fate deck (the first city\'s)', () => {
    const { w } = cityWorld(3);
    const decks = w.cities.map(c => [c.events.newsNext, c.events.fateNext]);
    expect(decks.every(([n, f]) => n === 0 && f === 0)).toBe(true);
    const g = w.cities[3], p = w.players[0];
    for (let i = 0; i < 5; i++) { g.events.drawNews(); g.events.drawFate(p); }
    expect(w.cities[0].events.newsNext).toBeGreaterThan(0);
    expect(w.cities[0].events.fateNext).toBeGreaterThan(0);
    expect(w.cities.slice(1).every(c => c.events.newsNext === 0 && c.events.fateNext === 0)).toBe(true);
  });

  it('never runs in a normal game', () => {
    const b = boards()[0];
    const g = new Game({ mapId: 100, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 1 }, b);
    const { value } = drain(regionalDraw(g, g.players[0], 'news'));
    expect(value).toBe(false);
  });

  it('long all-computer worlds with the local events stay balanced (no runaway money)', () => {
    const run = (seed: number, on: boolean) => {
      regional.enabled = on;
      const fired = regional.fired;
      try {
        const w = new World(settings(seed, pack(2026, 11, 1)), boards());
        const flow = w.run();
        for (let r = flow.next(); !r.done && w.daysElapsed < 240 && !w.over; r = flow.next('ask' in r.value ? -1 : undefined)) { /* play */ }
        for (const p of w.players) { expect(p.cash).toBeGreaterThanOrEqual(0); expect(p.bank).toBeGreaterThanOrEqual(0); }
        // Total assets of all twelve (bankrupt: 0), the bankruptcies and the price index.
        const wealth = w.players.reduce((s, p) => s + (p.bankrupt ? 0 : w.wealth(p)), 0);
        const out = { local: regional.fired - fired, wealth, broke: w.players.filter(p => p.bankrupt).length, pi: w.priceIndex, fp: JSON.stringify(saveWorld(w).players) };
        if (process.env.RICH4_BALANCE) console.log(seed, on ? 'on' : 'off', out.local, Math.round(wealth / 1000), out.broke, out.pi);
        return out;
      } finally { regional.enabled = true; }
    };
    // Twelve worlds (six were within noise of the bound once 大富豪模式 shops had no stock, 17 §3.10).
    const seeds = [77, 177, 277, 377, 477, 577, 677, 777, 877, 977, 1077, 1177];
    const on = seeds.map(s => run(s, true)), off = seeds.map(s => run(s, false));
    expect(run(77, true).fp).toBe(on[0].fp); // deterministic with the events on
    const sum = (xs: { [k: string]: number | string }[], k: string) => xs.reduce((a, x) => a + Number(x[k]), 0);
    expect(sum(on, 'local')).toBeGreaterThan(seeds.length * 25);
    // The world's total assets with local events stay within a fifth of those without; bankruptcies and prices alike.
    expect(sum(on, 'wealth') / sum(off, 'wealth')).toBeGreaterThan(0.8);
    expect(sum(on, 'wealth') / sum(off, 'wealth')).toBeLessThan(1.2);
    expect(Math.abs(sum(on, 'broke') - sum(off, 'broke'))).toBeLessThanOrEqual(seeds.length * 1.5);
    expect(sum(on, 'pi')).toBeLessThanOrEqual(sum(off, 'pi') + seeds.length);
  }, 240_000);
});
