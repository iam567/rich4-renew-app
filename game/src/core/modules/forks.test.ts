import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Board, type BoardNode, type RawMap } from '../board';
import { pack } from '../date';
import { Game } from '../game';
import { Rng } from '../rng';
import { SmartAi } from '../smart-ai';
import { loadGame, saveGame } from '../save';
import type { GameSettings } from '../types';
import { CHOICES, CHOICES_VERSION, FORK_LRU, FORKS_VERSION, Forks, Turn, isFork, leastRecent, openExits, resolveTurn } from './forks';

// 岔路箭頭, per player (docs/rules/14-forks-and-junctions.md).
const asset = (f: string) => fileURLToPath(new URL(`../../../../editor/site/assets/${f}`, import.meta.url));
const FILES: Record<number, string> = { 100: 'remake/tokyo.json', 101: 'remake/osaka.json', 106: 'remake/kabukicho.json', 7: 'map-7.json', 5: 'map-5.json', 1: 'map-1.json' };
const have = (id: number) => existsSync(asset(FILES[id]));
const board = (id: number): Board => parseBoard(JSON.parse(readFileSync(asset(FILES[id]), 'utf8')) as RawMap);

function settings(mapId: number, seed: number): GameSettings {
  return {
    mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 16), seed,
  };
}

/** The fork state of a game, as saved (FORK_LRU: order, used, tick; off: choices). */
const forkState = (g: Game) => JSON.stringify(saveGame(g).modules.forks);

/**
 * Plays a computer-only game. Right before every throw (the 'dice' event, after cards and tools) the moving player's
 * plan — what the arrows on the screen show — is taken; every step out of a fork while that throw is walked must go
 * where the plan said. FORK_LRU: the plan's passes in order, a fork met twice included (its second way is known);
 * off: each fork's first pass only (a second visit uses the redrawn choice).
 */
function playChecked(g: Game, days: number) {
  const flow = g.run();
  let plan: Map<number, number> | null = null, passes: { at: number; to: number }[] = [], mover = -1;
  let checked = 0, again = 0, changed = 0;
  const before = forkState(g);
  for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; r = flow.next()) {
    const s = r.value;
    if ('ask' in s) throw new Error('computer players never ask');
    if (s.t === 'dice') { mover = s.p; passes = []; plan = g.forks.plan(s.p, 600, undefined, passes); }
    else if (s.t === 'turn' || s.t === 'teleport') plan = null;
    else if (s.t === 'step' && plan && s.p === mover && g.forks.isFork(s.from)) {
      if (g.forks.lru) {
        const next = passes.shift()!;
        expect([s.from, s.to], `player ${s.p} out of fork ${s.from}`).toEqual([next.at, next.to]);
        if (!plan.has(s.from)) again++;   // a fork met again on this throw: its second way was known too
        plan.delete(s.from);
        checked++;
      } else if (plan.has(s.from)) {
        expect(s.to, `player ${s.p} out of fork ${s.from}`).toBe(plan.get(s.from));
        plan.delete(s.from);      // a second visit would use the redrawn choice
        checked++;
      }
    }
  }
  if (forkState(g) !== before) changed++;
  return { checked, again, changed };
}

/** A small crossroad board: square 1 in the middle with four arms joined in a ring by corner squares. */
function crossroad(): Board {
  const at: [number, number][] = [[500, 500], [500, 440], [560, 500], [500, 560], [440, 500], [560, 440], [560, 560], [440, 560], [440, 440]];
  const links: Record<number, number[]> = { 1: [2, 3, 4, 5], 2: [1, 6, 9], 3: [1, 6, 7], 4: [1, 7, 8], 5: [1, 8, 9], 6: [2, 3], 7: [3, 4], 8: [4, 5], 9: [5, 2] };
  const nodes = at.map(([x, y], i): BoardNode => {
    const adjacent = [...links[i + 1]]; while (adjacent.length < 4) adjacent.push(0);
    return { id: i + 1, x, y, adjacent, ref: 0, aux: 0, event: 0, oneWay: 0, noDrop: false };
  });
  return { name: 'cross', mapId: 0, nodes, lands: [], facilities: [], companies: [], landscapes: [] };
}

/** A Game shell over a hand-made board, enough for the fork logic. */
function shell(b: Board, seed = 5, players = 2): Game {
  const g = Object.create(Game.prototype) as Game;
  Object.assign(g, { board: b, rng: new Rng(seed), settings: { seed }, players: Array.from({ length: players }, (_, id) => ({ id, dir: 0, placed: true, node: 1, lastNode: 4 })) });
  return g;
}

afterEach(() => { FORK_LRU.on = true; });

describe('fork choices: every real road equally likely', () => {
  const b = crossroad(), by = (id: number) => b.nodes[id - 1], mid = b.nodes[0];
  const all = (n: BoardNode, by2: (id: number) => BoardNode, from: number, dir = 0) => [0, 1, 2, 3, 4, 5].map(c => resolveTurn(n, by2, from, c, dir));

  it('a crossroad: the three ways left to right, choice % 3, from every approach', () => {
    // Coming up from the south (4): left west (5), straight north (2), right east (3).
    expect(all(mid, by, 4)).toEqual([5, 2, 3, 5, 2, 3]);
    // From the west (5), heading east: left north 2, straight 3, right south 4.
    expect(all(mid, by, 5)).toEqual([2, 3, 4, 2, 3, 4]);
    // From the north (2), heading south: left east 3, straight 4, right west 5.
    expect(all(mid, by, 2)).toEqual([3, 4, 5, 3, 4, 5]);
    // Never back, whatever the choice.
    for (const from of [2, 3, 4, 5]) for (let c = 0; c < CHOICES; c++) expect(resolveTurn(mid, by, from, c)).not.toBe(from);
  });

  it('a T junction: the two ways out, even = left, odd = right, from every side (no 2 : 1 bias any more)', () => {
    const t = crossroad();
    // Remove the north arm: square 1 is a T with arms west (5), east (3) and the stem south (4).
    t.nodes[0].adjacent = [3, 4, 5, 0];
    const by2 = (id: number) => t.nodes[id - 1], T = t.nodes[0];
    expect(isFork(T)).toBe(true);
    expect(all(T, by2, 4)).toEqual([5, 3, 5, 3, 5, 3]);
    // Along the bar from the west, heading east: straight east (3) is left of the right turn south (4).
    expect(all(T, by2, 5)).toEqual([3, 4, 3, 4, 3, 4]);
    // From the east, heading west: left south (4), straight west (5).
    expect(all(T, by2, 3)).toEqual([4, 5, 4, 5, 4, 5]);
  });

  it('closed slots are never taken; with no neighbour behind, the facing gives the heading', () => {
    const c = crossroad();
    c.nodes[0].oneWay = 8 >> 1;            // slot 1 (east) closed when leaving the middle square
    const by3 = (id: number) => c.nodes[id - 1];
    for (const from of [2, 4, 5, 0]) for (let k = 0; k < CHOICES; k++) expect(resolveTurn(c.nodes[0], by3, from, k, 4)).not.toBe(3);
    // No way in (0, a turn-around with nothing ahead), facing up (4): all four ways, west, north, east, south.
    expect(all(mid, by, 0, 4)).toEqual([5, 2, 3, 4, 5, 2]);
  });

  it('the earlier rule (Forks.legacy, a test hook) still maps 直走 / 左轉 / 右轉 as before', () => {
    expect([Turn.Straight, Turn.Left, Turn.Right].map(t => resolveTurn(mid, by, 4, t, 0, true))).toEqual([2, 5, 3]);
    const t = crossroad();
    t.nodes[0].adjacent = [3, 4, 5, 0];
    const by2 = (id: number) => t.nodes[id - 1];
    expect([Turn.Straight, Turn.Left, Turn.Right].map(k => resolveTurn(t.nodes[0], by2, 4, k, 0, true))).toEqual([3, 5, 3]);
  });

  it('FORK_LRU off: each player has their own choices; walking out redraws only that player\'s, with one rand() % 6', () => {
    FORK_LRU.on = false;
    const g = shell(crossroad());
    const f = new Forks(g);
    Object.assign(g, { forks: f });
    f.init();
    expect(Object.keys(f.choices[0]).map(Number)).toEqual([1, 2, 3, 4, 5]);
    f.choices[0][1] = 0; f.choices[1][1] = 2;
    expect(f.follow(0, 1, 4)).toBe(5);
    expect(f.follow(1, 1, 4)).toBe(3);
    const other = { ...f.choices[1] }, twin = new Rng(g.rng.seed);
    expect(f.pass(0, 1, 4)).toBe(5);
    expect(f.choices[0][1]).toBe(twin.rand() % CHOICES);
    expect(g.rng.seed).toBe(twin.seed);
    expect(f.choices[1]).toEqual(other);
    expect(f.v).toBe(CHOICES_VERSION);
  });
});

describe('least recently used road (FORK_LRU, 14 §2)', () => {
  /** The crossroad shell with its fork state, player 0 in the middle come from the south (4). */
  const lruShell = (seed = 5) => {
    const g = shell(crossroad(), seed);
    Object.assign(g, { forks: new Forks(g) });
    g.forks.init();
    return g;
  };

  it('the least recently used of the ways: never used first, then the oldest stamp, ties by the order', () => {
    expect(leastRecent([2, 3, 5], {}, [5, 3, 2, 4])).toBe(5);
    expect(leastRecent([2, 3, 5], { 5: 4 }, [5, 3, 2, 4])).toBe(3);
    expect(leastRecent([2, 3, 5], { 5: 4, 3: 2, 2: 7 }, [5, 3, 2, 4])).toBe(3);
    expect(leastRecent([2, 3], undefined, undefined)).toBe(2);
  });

  it('passing a crossroad again and again from one side takes each way in turn, then cycles in the same order', () => {
    const g = lruShell(), f = g.forks;
    expect(f.lru).toBe(true);
    const ways = Array.from({ length: 9 }, () => f.pass(0, 1, 4));
    expect(new Set(ways.slice(0, 3))).toEqual(new Set([2, 3, 5]));
    expect(ways.slice(3, 6)).toEqual(ways.slice(0, 3));
    expect(ways.slice(6, 9)).toEqual(ways.slice(0, 3));
    // The arrow turns as soon as the player has walked out: never the way just taken while another is unused.
    const h = lruShell();
    const first = h.forks.follow(0, 1, 4);
    h.forks.pass(0, 1, 4);
    expect(h.forks.follow(0, 1, 4)).not.toBe(first);
  });

  it('a T junction from the stem: left, right, left, right … (every road its turn, whatever the seed)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const t = crossroad();
      t.nodes[0].adjacent = [3, 4, 5, 0];
      const g = shell(t, seed);
      Object.assign(g, { forks: new Forks(g) });
      g.forks.init();
      const ways = Array.from({ length: 6 }, () => g.forks.pass(0, 1, 4));
      expect(new Set(ways.slice(0, 2))).toEqual(new Set([3, 5]));
      for (let i = 2; i < 6; i++) expect(ways[i]).toBe(ways[i - 2]);
    }
  });

  it('the road one came in by counts as used: the next arrow from another side points to a road not walked yet', () => {
    const g = lruShell(), f = g.forks;
    const out = f.pass(0, 1, 4);                       // in from the south, out to `out`
    const fromSide = [2, 3, 5].find(x => x !== out)!;   // then come in from one of the other two
    // Ways from there: not back; the south (4) and `out` are used, so the one never walked is taken.
    const fresh = [2, 3, 4, 5].find(x => x !== out && x !== 4 && x !== fromSide)!;
    expect(f.follow(0, 1, fromSide)).toBe(fresh);
  });

  it('one rand() per walk out of a fork, as the original; other players keep theirs; the order differs per seed and player', () => {
    const g = lruShell(), f = g.forks;
    const other = JSON.stringify(f.used[1]), twin = new Rng(g.rng.seed);
    const want = f.follow(0, 1, 4);
    expect(f.pass(0, 1, 4)).toBe(want);
    twin.rand();
    expect(g.rng.seed).toBe(twin.seed);
    expect(JSON.stringify(f.used[1])).toBe(other);
    expect(f.used[0][1]).toEqual({ 4: 1, [want]: 2 });
    expect(f.tick).toEqual([2, 0]);
    const orders = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(lruShell(i + 1).forks.order)));
    expect(orders.size).toBeGreaterThan(10);
  });

  it('the plan, the computer\'s route and the doll\'s / tools\' prediction all are the walk, forks met many times included', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const g = lruShell(seed), q = g.players[0];
      Object.assign(q, { node: 6, lastNode: 2 });
      const passes: { at: number; to: number }[] = [];
      const plan = g.forks.plan(0, 200, undefined, passes);
      const route = new SmartAi(g).route(q, 200);
      const peek: number[] = [];
      { let at = q.node, from = q.lastNode; const w = g.forks.walk(0); for (let i = 0; i < 200; i++) { const n = g.peekNext(0, at, from, w); from = at; at = n; peek.push(at); } }
      // Now really walk it.
      const walked: number[] = [], out: { at: number; to: number }[] = [];
      for (let i = 0; i < 200; i++) {
        const next = g.walkNext(0, q.node, q.lastNode);
        if (g.forks.isFork(q.node)) out.push({ at: q.node, to: next });
        q.lastNode = q.node; q.node = next;
        walked.push(next);
      }
      expect(route).toEqual(walked);
      expect(peek).toEqual(walked);
      expect(passes).toEqual(out.slice(0, passes.length));
      expect(passes.length).toBeGreaterThan(plan.size * 3);       // each fork many times over
      for (const [at, to] of plan) expect(out.find(x => x.at === at)!.to).toBe(to);
      // Every road of every fork got used.
      for (const n of g.forks.forks()) for (const w of openExits(n)) expect(g.forks.used[0][n.id]?.[w], `seed ${seed} fork ${n.id} road ${w}`).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!have(100) || !have(7) || !have(5))('fork choices on maps', () => {
  it('the starting state depends only on the seed and spends no rand() of the rules (both rules)', () => {
    for (const on of [true, false]) {
      FORK_LRU.on = on;
      const a = new Game(settings(100, 7), board(100)), b = new Game(settings(100, 7), board(100));
      expect(forkState(a)).toBe(forkState(b));
      expect(a.forks.lru).toBe(on);
      const per = on ? a.forks.order : a.forks.choices;
      expect(per).toHaveLength(4);
      expect(Object.keys(per[0]).length).toBeGreaterThanOrEqual(6);
      expect(per[0]).not.toEqual(per[1]);
      expect(forkState(new Game(settings(100, 8), board(100)))).not.toBe(forkState(a));
      const before = a.rng.seed;
      a.forks.init();
      expect(a.rng.seed).toBe(before);
      expect(forkState(a)).toBe(forkState(b));
    }
  });

  it('the arrows shown (the plan) are what every player does, over long computer games (both rules)', () => {
    const maps = [100, 7, 5, 1, ...(have(101) ? [101] : []), ...(have(106) ? [106] : [])];
    for (const on of [true, false]) {
      FORK_LRU.on = on;
      for (const mapId of maps) {
        const g = new Game(settings(mapId, 30 + mapId), board(mapId));
        if (mapId === 7 || mapId === 5) expect(g.board.nodes.filter(n => n.adjacent.filter(Boolean).length === 4).every(n => g.forks.isFork(n.id))).toBe(true);
        const r = playChecked(g, 300);
        expect(r.checked, `map ${mapId}`).toBeGreaterThan(mapId === 1 ? 0 : 40);
        if (mapId !== 1) expect(r.changed, `map ${mapId}`).toBeGreaterThan(0);
      }
    }
  });

  it('the state is saved per player; a loaded game goes on the same; an old save gets a fresh state (both rules)', () => {
    for (const on of [true, false]) {
      FORK_LRU.on = on;
      const a = new Game(settings(100, 21), board(100)), fa = a.run();
      for (let r = fa.next(); !r.done; r = fa.next()) if (!('ask' in r.value) && r.value.t === 'turn' && a.daysElapsed >= 30) break;
      const saved = JSON.parse(JSON.stringify(saveGame(a)));
      expect(saved.modules.forks.v).toBe(on ? FORKS_VERSION : CHOICES_VERSION);
      if (on) {
        expect(saved.modules.forks.used).toEqual(a.forks.used);
        expect(saved.modules.forks.tick.every((t: number) => t > 0)).toBe(true);
        expect(saved.modules.forks.choices).toBeUndefined();
      } else {
        expect(saved.modules.forks.choices).toEqual(a.forks.choices);
        expect(saved.modules.forks.used).toBeUndefined();
      }
      expect(forkState(loadGame(JSON.parse(JSON.stringify(saved))))).toBe(forkState(a));
      const b = loadGame(saved), fb = b.run();
      fb.next();
      const log = (g: Game, f: Generator) => {
        const out: string[] = [];
        for (let r = f.next(); !r.done && g.daysElapsed < 60; r = f.next()) out.push(JSON.stringify(r.value) + forkState(g));
        return out;
      };
      expect(log(b, fb)).toEqual(log(a, fa));
      const fresh = forkState(new Game(settings(100, 21), board(100)));
      // A save from before per-player choices (one shared arrow map) starts from the seed's state.
      saved.modules.forks = { arrows: { 1: 2 } };
      const old = loadGame(saved);
      expect(forkState(old)).toBe(fresh);
      expect((old.forks as unknown as { arrows?: unknown }).arrows).toBeUndefined();
      // A save with the earlier relative choices (no version) also starts from the seed's state.
      saved.modules.forks = { choices: [0, 1, 2, 3].map(() => ({ 10: 1, 16: 1 })) };
      expect(forkState(loadGame(saved))).toBe(fresh);
      // FORK_LRU: a save with the 0..5 choices (v 2, before 2026-10-23) gets nothing used yet, the seed's order.
      if (on) {
        saved.modules.forks = { choices: [0, 1, 2, 3].map(() => ({ 10: 1, 16: 1 })), v: CHOICES_VERSION };
        const conv = loadGame(saved);
        expect(forkState(conv)).toBe(fresh);
        expect(conv.forks.lru).toBe(true);
        expect(conv.forks.used.every(u => Object.keys(u).length === 0)).toBe(true);
      }
    }
  });

  it('派對模式 lockstep: the same seed walks the same ways on every phone (no Math.random, no clock)', () => {
    const party = (mapId: number) => {
      const g = new Game({ ...settings(mapId, 4242), party: true, players: [0, 4, 9, 11].map(character => ({ character, human: true })) }, board(mapId));
      g.animation = false;
      for (const p of g.players) p.autopilot = true;
      return g;
    };
    const hash = (g: Game, days: number) => {
      const h = createHash('sha256'), flow = g.run();
      for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; ) {
        h.update(JSON.stringify(r.value));
        const s = r.value as { t?: string };
        if ('ask' in s) { expect(s.t).toBe('auto-turn'); r = flow.next(0); } else r = flow.next();
      }
      return h.update(forkState(g)).digest('hex');
    };
    for (const mapId of [100, ...(have(106) ? [106] : [])]) {
      const a = hash(party(mapId), 150);
      const real = Math.random;
      Math.random = () => 0.123;
      try { expect(hash(party(mapId), 150), `map ${mapId}`).toBe(a); } finally { Math.random = real; }
    }
  });

  it('players walk the whole map: more of the road within 90 days than before, and every road of a fork they pass gets used', () => {
    const maps = [7, 100, ...(have(106) ? [106] : []), ...(have(101) ? [101] : [])];
    const play = (mapId: number, seed: number, days: number) => {
      const g = new Game(settings(mapId, 600 + seed), board(mapId)), flow = g.run();
      const seen = g.players.map(() => new Set<number>()), passes = g.players.map(() => new Map<number, number>());
      for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; r = flow.next()) {
        const s = r.value;
        if ('ask' in s) throw new Error('computer players never ask');
        if (s.t === 'step' && s.p < g.players.length) {
          seen[s.p].add(s.to);
          if (g.forks.isFork(s.from)) passes[s.p].set(s.from, (passes[s.p].get(s.from) ?? 0) + 1);
        }
      }
      const road = g.board.nodes.filter(n => n.adjacent.some(Boolean)).length;
      return { g, cover: g.players.filter(p => !p.bankrupt).map(p => seen[p.id].size / road), passes };
    };
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    for (const mapId of maps) {
      const cover = (on: boolean) => { FORK_LRU.on = on; return mean([1, 2, 3, 4, 5, 6].flatMap(seed => play(mapId, seed, 90).cover)); };
      const before = cover(false), now = cover(true);
      expect(now, `map ${mapId}: ${(100 * before).toFixed(1)}% → ${(100 * now).toFixed(1)}%`).toBeGreaterThan(before);
      // With FORK_LRU a player who has passed a fork as often as it has roads (and twice that) has used them all.
      for (const seed of [1, 2, 3]) {
        const { g, passes } = play(mapId, seed, 180);
        for (const p of g.players) for (const [at, k] of passes[p.id]) {
          const roads = openExits(g.node(at));
          if (k >= 2 * roads.length) for (const w of roads) expect(g.forks.used[p.id][at]?.[w], `map ${mapId} seed ${seed} player ${p.id} fork ${at} road ${w}`).toBeGreaterThan(0);
        }
      }
    }
  }, 60_000);

  it('every new game draws its own arrows: different seeds, different arrow sets, on every kind of map', () => {
    for (const mapId of [100, 7, 1, ...(have(106) ? [106] : []), ...(have(101) ? [101] : [])]) {
      const b = board(mapId);
      // What each fork's arrow says from every side, for player 0 (what the map shows once they get there).
      const arrows = (seed: number) => {
        const g = new Game(settings(mapId, seed), b);
        return g.forks.forks().map(n => n.adjacent.filter(Boolean).map(from => g.forks.follow(0, n.id, from)).join(',')).join(' ');
      };
      const sets = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(arrows));
      expect(sets.size, `map ${mapId}`).toBeGreaterThan(mapId === 1 ? 1 : 5);
      expect(arrows(4), `map ${mapId}`).toBe(arrows(4));     // the same seed, the same arrows
    }
  });

  it('starting arrows: every open way out of every fork about equally often over many games', () => {
    for (const mapId of [100, 7, ...(have(106) ? [106] : [])]) {
      const b = board(mapId), count = new Map<string, number>();
      const N = 600;
      for (let seed = 1; seed <= N; seed++) {
        const g = new Game(settings(mapId, seed), b);
        for (const n of g.forks.forks()) for (const from of n.adjacent.filter(Boolean)) {
          const k = `${n.id}<${from}>${g.forks.follow(0, n.id, from)}`;
          count.set(k, (count.get(k) ?? 0) + 1);
        }
      }
      const g = new Game(settings(mapId, 1), b);
      for (const n of g.forks.forks()) for (const from of n.adjacent.filter(Boolean)) {
        const ways = openExits(n).filter(x => x !== from);
        if (ways.length < 2) continue;
        for (const w of ways) {
          const share = (count.get(`${n.id}<${from}>${w}`) ?? 0) / N;
          expect(Math.abs(share - 1 / ways.length), `map ${mapId} fork ${n.id} from ${from} to ${w}`).toBeLessThan(0.08);
        }
      }
    }
  });
});
