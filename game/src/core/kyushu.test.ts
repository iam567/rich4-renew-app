import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { companyOf, facilityOf, landOf, nodeById, parseBoard, worldSize, type Board, type RawMap } from './board';
import { Game } from './game';
import { pack } from './date';
import { loadGame, saveGame } from './save';
import type { GameSettings } from './types';

// The remake's 九州 map (editor/build_kyushu.py → editor/site/assets/remake/kyushu.json): the biggest map, a 3456×3456
// world (the others: 2304), built like 東京 / 大阪 (editor/city_*.py); its rules are also checked by editor/kyushu_audit.py.
const dir = '../../../editor/site/assets/remake/';
const file = fileURLToPath(new URL(dir + 'kyushu.json', import.meta.url));
const have = existsSync(file);
const load = (f = file): Board => parseBoard(JSON.parse(readFileSync(f, 'utf8')) as RawMap);
const KYUSHU = 103;
// 東京's mix scaled to 213 squares (kyushu_layout.EVENT_MIX): news, fate, prison, hospital, three mini games, lotto,
// coupons 50 / 30 / 10, card, bank, item shop, magic house.
const MIX: Record<number, number> = { 2: 6, 3: 6, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 3, 10: 1, 11: 3, 12: 6, 13: 3, 14: 3, 15: 4, 16: 3 };

/** Moves allowed by the movement rule (01 §6.2): never straight back, not through a closed slot, back at a dead end. */
function moves(b: Board, node: number, last: number): number[] {
  const n = nodeById(b, node);
  const c = n.adjacent.filter((a, j) => a && a !== last && !(n.oneWay & (8 >> j)));
  return c.length ? c : [last];
}

function settings(seed: number): GameSettings {
  return {
    mapId: KYUSHU, players: [2, 5, 7, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 16), seed,
  };
}

function events(b: Board) {
  const ev = b.nodes.filter(n => n.event);
  const pairs = new Set<string>();
  for (const n of ev) for (const a of n.adjacent.filter(Boolean)) if (nodeById(b, a).event) pairs.add([n.id, a].sort((x, y) => x - y).join('-'));
  const mix: Record<number, number> = {};
  for (const n of ev) mix[n.event] = (mix[n.event] ?? 0) + 1;
  return { pairs: [...pairs], mix };
}

describe.skipIf(!have)('九州 map', () => {
  it('is the biggest map: a 3456 px world, 213 squares (under the original engine\'s 255), well-formed records', () => {
    const b = load();
    expect(worldSize(b)).toBe(3456);
    expect(b.mapId).toBe(2); // built on the Japan slot: its houses and stock table
    expect(b.nodes).toHaveLength(213);
    expect(b.nodes.length).toBeLessThanOrEqual(255);
    expect(b.lands).toHaveLength(117);
    expect(b.facilities).toHaveLength(11);
    expect(b.companies).toHaveLength(6);
    expect(b.landscapes).toHaveLength(33);
    b.nodes.forEach((n, i) => expect(n.id).toBe(i + 1));
    for (const n of b.nodes) {
      expect(n.x).toBeGreaterThan(60); expect(n.y).toBeGreaterThan(60);
      expect(n.x).toBeLessThan(3456 - 60); expect(n.y).toBeLessThan(3456 - 60);
      for (const a of n.adjacent.filter(Boolean)) expect(nodeById(b, a).adjacent).toContain(n.id);
      expect(n.adjacent.filter(Boolean).length).toBeLessThanOrEqual(4);
      if (n.ref > 2000 && n.ref < 4000) expect(landOf(b, n)).toBeDefined();
      if (n.ref > 4000 && n.ref < 6000) expect(facilityOf(b, n)).toBeDefined();
      if (n.ref > 6000 && n.ref < 8000) expect(companyOf(b, n)).toBeDefined();
    }
    b.lands.forEach((_, i) => expect(b.nodes.filter(n => n.ref === 2001 + i)).toHaveLength(1));
    b.facilities.forEach((_, i) => expect(b.nodes.filter(n => n.ref === 4001 + i)).toHaveLength(2));
    b.companies.forEach((_, i) => expect(b.nodes.some(n => n.ref === 6001 + i)).toBe(true));
    expect(b.nodes.filter(n => n.ref === 8001 && n.event === 5)).toHaveLength(1);
    expect(b.nodes.filter(n => n.event === 4)).toHaveLength(1);
    expect(b.nodes.filter(n => n.ref === 8002)).toHaveLength(1);
    expect(new Set(b.companies.map(c => c.stockSlot))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    const streets = new Map<string, number>();
    for (const l of b.lands) streets.set(l.name, (streets.get(l.name) ?? 0) + 1);
    for (const [, k] of streets) { expect(k).toBeGreaterThanOrEqual(3); expect(k).toBeLessThanOrEqual(5); }
    // 熊本: spine × loop north and south × 豐肥 road — a real crossroads.
    expect(b.nodes.filter(n => n.adjacent.filter(Boolean).length === 4).length).toBeGreaterThanOrEqual(1);
  });

  it('spaces its squares like the originals, so the remote-control dice can be counted', () => {
    const b = load();
    const icon = (aux: number): [number, number] | null => {
      if (!aux) return null;
      const f = aux - 1;
      if (f >= 32) return [44, 32];
      if (f >= 18 && f <= 23) return [46, 34];
      if (f >= 10 && f <= 15) return [62, 47];
      return [124, 92];
    };
    const big = (n: { aux: number }) => { const s = icon(n.aux); return !!s && s[0] >= 62; };
    const S = 1.2175, K = Math.SQRT1_2;
    const proj = (x: number, y: number, r: number) => {
      const th = (-22.5 + 45 * r) * Math.PI / 180;
      return [S * (x * Math.cos(th) - y * Math.sin(th)), S * K * (x * Math.sin(th) + y * Math.cos(th))];
    };
    const water: number[] = [];
    for (const n of b.nodes) {
      for (const id of n.adjacent.filter(a => a > n.id)) {
        const m = nodeById(b, id), d = Math.hypot(n.x - m.x, n.y - m.y);
        const [lo, hi] = n.noDrop || m.noDrop ? [54, 78] : big(n) || big(m) ? [62, 84] : !n.aux && !m.aux ? [44, 64] : [44, 72];
        expect(d, `step ${n.id}-${m.id}`).toBeGreaterThanOrEqual(lo);
        expect(d, `step ${n.id}-${m.id}`).toBeLessThanOrEqual(hi);
        if (n.noDrop || m.noDrop) water.push(d);
      }
      for (const m of b.nodes) if (m.id > n.id) expect(Math.hypot(n.x - m.x, n.y - m.y), `${n.id}/${m.id}`).toBeGreaterThanOrEqual(44);
      const s = icon(n.aux);
      if (!s || !big(n)) continue;
      for (let r = 0; r < 8; r++) {
        const [sx, sy] = proj(n.x, n.y, r);
        for (const m of b.nodes) {
          if (m === n) continue;
          const [mx, my] = proj(m.x, m.y, r);
          expect(Math.hypot((mx - sx) / (s[0] / 2), (my - sy) / (s[1] / 2)), `${m.id} under ${n.id} r${r}`).toBeGreaterThanOrEqual(1);
        }
      }
    }
    // Two speedboat crossings (有明海 熊本港–島原, the mouth of 錦江灣): water steps of about 66 px.
    expect(water.length).toBeGreaterThanOrEqual(8);
    for (const d of water) expect(Math.abs(d - 66)).toBeLessThan(9);
  });

  it("puts one bank in each region, every one on a junction and the bank company's square (docs/rules/14 §4)", () => {
    const b = load();
    const banks = b.nodes.filter(n => n.event === 14);
    expect(banks).toHaveLength(3);
    const g = new Game(settings(1), b);
    for (const n of banks) {
      expect(n.adjacent.filter(Boolean).length).toBeGreaterThanOrEqual(3);
      expect(companyOf(b, n)?.category, 'the bank company (富士銀行)').toBe(7);
      expect(g.forks.isFork(n.id)).toBe(true);
    }
    // ...and the crossroads (熊本) holds one.
    expect(banks.some(n => n.adjacent.filter(Boolean).length === 4)).toBe(true);
  });

  it("spreads its events: 東京's mix scaled up, no two side by side; the item shops are the department store", () => {
    const b = load();
    const { pairs, mix } = events(b);
    expect(pairs, 'adjacent event squares').toEqual([]);
    expect(mix).toEqual(MIX);
    const shops = b.nodes.filter(n => n.event === 15);
    for (const n of shops) expect(companyOf(b, n)?.category, `shop ${n.id} (the department store)`).toBe(10);
    // the big, easy-to-use events sit on junctions where they can: banks, an item shop, a news square
    const junction = (n: { adjacent: number[] }) => n.adjacent.filter(Boolean).length >= 3;
    expect(b.nodes.filter(n => junction(n) && [2, 14, 15].includes(n.event)).length).toBeGreaterThanOrEqual(5);
  });

  it('keeps its plants (decorations) off the route', () => {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { decorations?: { x: number; y: number; res: number }[] };
    const b = load();
    expect(raw.decorations?.length ?? 0).toBeGreaterThan(200);
    // one expect per kind of clearance (830 plants × 213 squares: checking each pair with expect() is slow)
    const near: string[] = [];
    for (const d of raw.decorations ?? []) {
      for (const n of b.nodes) if (Math.hypot(d.x - n.x, d.y - n.y) <= 40) near.push(`plant ${d.x},${d.y} / square ${n.id}`);
      for (const l of b.lands) if (Math.hypot(d.x - l.x, d.y - l.y) <= 30) near.push(`plant ${d.x},${d.y} / lot ${l.id}`);
    }
    expect(near).toEqual([]);
  });

  it('lets a walker reach every square from anywhere, and leave the prison', () => {
    const b = load();
    const prison = b.nodes.find(n => n.ref === 8002)!.id;
    for (const start of [1, prison]) {
      const first = nodeById(b, start).adjacent.find(Boolean)!;
      const seen = new Set<string>(), nodes = new Set<number>();
      const todo: [number, number][] = [[start, first], [start, 0]];
      while (todo.length) {
        const [n, last] = todo.pop()!, k = `${n}/${last}`;
        if (seen.has(k)) continue;
        seen.add(k); nodes.add(n);
        for (const m of moves(b, n, last)) todo.push([m, n]);
      }
      const spur = new Set<number>([prison]);
      for (let grew = true; grew;) {
        grew = false;
        for (const n of b.nodes) if (!spur.has(n.id) && n.event !== 4 && n.adjacent.some(a => spur.has(a))) { spur.add(n.id); grew = true; }
      }
      const want = start === prison ? b.nodes.length : b.nodes.length - spur.size;
      expect(spur.size).toBeLessThan(6);
      expect(nodes.size).toBeGreaterThanOrEqual(want);
    }
  });

  it('shows fork arrows that are the way each player really goes (docs/rules/14)', () => {
    const g = new Game(settings(77), load());
    const flow = g.run();
    let plan: Map<number, number> | null = null, mover = -1, checked = 0;
    for (let r = flow.next(); !r.done && g.daysElapsed < 250 && !g.over; r = flow.next()) {
      const s = r.value;
      if ('ask' in s) throw new Error('computer players never ask');
      if (s.t === 'dice') { mover = s.p; plan = g.forks.plan(s.p); }
      else if (s.t === 'turn' || s.t === 'teleport') plan = null;
      else if (s.t === 'step' && plan && s.p === mover && plan.has(s.from)) {
        expect(s.to, `player ${s.p} out of fork ${s.from}`).toBe(plan.get(s.from));
        plan.delete(s.from);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('plays 200 days with four computers (three games), landing on every kind of square, and saves and loads', () => {
    const landed = new Set<number>(), events = new Set<number>(), bought = new Set<string>();
    for (const seed of [11, 22, 33]) {
      const game = new Game(settings(seed), load());
      const flow = game.run();
      let saved = false;
      for (let r = flow.next(); !r.done && game.daysElapsed < 200; r = flow.next()) {
        const s = r.value;
        if ('ask' in s) throw new Error('computer players never ask: ' + JSON.stringify(s));
        if (s.t === 'step' && s.left === 0) { landed.add(s.to); events.add(game.node(s.to).event); }
        if (s.t === 'buy') bought.add(`${s.kind}${s.id}`);
        for (const p of game.players) { expect(p.cash).toBeGreaterThanOrEqual(0); expect(p.bank).toBeGreaterThanOrEqual(0); }
        if (!saved && game.daysElapsed === 100 && s.t === 'turn') {
          saved = true;
          const copy = loadGame(JSON.parse(JSON.stringify(saveGame(game))));
          expect(copy.board.lands.map(l => l.owner)).toEqual(game.board.lands.map(l => l.owner));
          expect(worldSize(copy.board)).toBe(3456);
          expect(copy.mapSlot).toBe(2);
        }
      }
      expect(saved).toBe(true);
      expect(game.daysElapsed >= 200 || !!game.over).toBe(true);
    }
    const b = load();
    for (const e of new Set(b.nodes.map(n => n.event))) expect(events, `event ${e}`).toContain(e);
    expect(landed.size).toBeGreaterThan(b.nodes.length * 0.8);
    expect([...bought].filter(k => k.startsWith('land')).length).toBeGreaterThan(b.lands.length * 0.6);
    expect([...bought].filter(k => k.startsWith('facility')).length).toBeGreaterThanOrEqual(6);
  });
});
