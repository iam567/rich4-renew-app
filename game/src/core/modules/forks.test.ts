import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Board, type BoardNode, type RawMap } from '../board';
import { pack } from '../date';
import { Game } from '../game';
import { Rng } from '../rng';
import { loadGame, saveGame } from '../save';
import type { GameSettings } from '../types';
import { Forks, Turn, isFork, resolveTurn } from './forks';

// 岔路箭頭, per player (docs/rules/14-forks-and-junctions.md).
const asset = (f: string) => fileURLToPath(new URL(`../../../../editor/site/assets/${f}`, import.meta.url));
const FILES: Record<number, string> = { 100: 'remake/tokyo.json', 101: 'remake/osaka.json', 7: 'map-7.json', 5: 'map-5.json', 1: 'map-1.json' };
const have = (id: number) => existsSync(asset(FILES[id]));
const board = (id: number): Board => parseBoard(JSON.parse(readFileSync(asset(FILES[id]), 'utf8')) as RawMap);

function settings(mapId: number, seed: number): GameSettings {
  return {
    mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 16), seed,
  };
}

/**
 * Plays a computer-only game. Right before every throw (the 'dice' event, after cards and tools) the moving player's
 * plan — what the arrows on the screen show — is taken; every step out of a fork while that throw is walked must go
 * where the plan said.
 */
function playChecked(g: Game, days: number) {
  const flow = g.run();
  let plan: Map<number, number> | null = null, mover = -1;
  let checked = 0, redrawn = 0;
  const before = g.forks.choices.map(c => ({ ...c }));
  for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; r = flow.next()) {
    const s = r.value;
    if ('ask' in s) throw new Error('computer players never ask');
    if (s.t === 'dice') { mover = s.p; plan = g.forks.plan(s.p); }
    else if (s.t === 'turn' || s.t === 'teleport') plan = null;
    else if (s.t === 'step' && plan && s.p === mover && plan.has(s.from)) {
      expect(s.to, `player ${s.p} out of fork ${s.from}`).toBe(plan.get(s.from));
      plan.delete(s.from);      // a second visit would use the redrawn choice
      checked++;
    }
  }
  g.forks.choices.forEach((c, p) => { for (const k of Object.keys(c)) if (c[+k] !== before[p][+k]) redrawn++; });
  return { checked, redrawn };
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

describe('fork choices: relative turns', () => {
  const b = crossroad(), by = (id: number) => b.nodes[id - 1], mid = b.nodes[0];

  it('maps 直走 / 左轉 / 右轉 at a crossroad from every approach', () => {
    // Coming up from the south (4): straight north (2), left west (5), right east (3).
    expect([Turn.Straight, Turn.Left, Turn.Right].map(t => resolveTurn(mid, by, 4, t))).toEqual([2, 5, 3]);
    // From the west (5), heading east: straight 3, left north 2, right south 4.
    expect([Turn.Straight, Turn.Left, Turn.Right].map(t => resolveTurn(mid, by, 5, t))).toEqual([3, 2, 4]);
    // From the north (2), heading south: straight 4, left east 3, right west 5.
    expect([Turn.Straight, Turn.Left, Turn.Right].map(t => resolveTurn(mid, by, 2, t))).toEqual([4, 3, 5]);
    // Never back, whatever the choice.
    for (const from of [2, 3, 4, 5]) for (const t of [0, 1, 2]) expect(resolveTurn(mid, by, from, t)).not.toBe(from);
  });

  it('T junction: from the stem 直走 takes the right (a tie); along the bar 左轉/右轉 may be straight on', () => {
    const t = crossroad();
    // Remove the north arm: square 1 is a T with arms west (5), east (3) and the stem south (4).
    t.nodes[0].adjacent = [3, 4, 5, 0];
    const by2 = (id: number) => t.nodes[id - 1], T = t.nodes[0];
    expect(isFork(T)).toBe(true);
    expect([Turn.Straight, Turn.Left, Turn.Right].map(k => resolveTurn(T, by2, 4, k))).toEqual([3, 5, 3]);
    // Along the bar from the west, heading east: ways east (straight) and south (right).
    expect([Turn.Straight, Turn.Left, Turn.Right].map(k => resolveTurn(T, by2, 5, k))).toEqual([3, 3, 4]);
    // From the east, heading west: ways west (straight) and south (left).
    expect([Turn.Straight, Turn.Left, Turn.Right].map(k => resolveTurn(T, by2, 3, k))).toEqual([5, 4, 5]);
  });

  it('closed slots are never taken; with no neighbour behind, the facing gives the heading', () => {
    const c = crossroad();
    c.nodes[0].oneWay = 8 >> 1;            // slot 1 (east) closed when leaving the middle square
    const by3 = (id: number) => c.nodes[id - 1];
    for (const from of [2, 4, 5, 0]) for (const k of [0, 1, 2]) expect(resolveTurn(c.nodes[0], by3, from, k, 4)).not.toBe(3);
    // No way in (0), facing up (4): straight north, left west.
    expect(resolveTurn(mid, by, 0, Turn.Straight, 4)).toBe(2);
    expect(resolveTurn(mid, by, 0, Turn.Left, 4)).toBe(5);
  });

  it('each player has their own choices; walking out redraws only that player\'s, with one rand()', () => {
    const g = shell(crossroad());
    const f = new Forks(g);
    Object.assign(g, { forks: f });
    f.init();
    expect(Object.keys(f.choices[0]).map(Number)).toEqual([1, 2, 3, 4, 5]);
    f.choices[0][1] = Turn.Left; f.choices[1][1] = Turn.Right;
    expect(f.follow(0, 1, 4)).toBe(5);
    expect(f.follow(1, 1, 4)).toBe(3);
    const other = { ...f.choices[1] }, twin = new Rng(g.rng.seed);
    expect(f.pass(0, 1, 4)).toBe(5);
    expect(f.choices[0][1]).toBe(twin.rand() % 3);
    expect(g.rng.seed).toBe(twin.seed);
    expect(f.choices[1]).toEqual(other);
  });
});

describe.skipIf(!have(100) || !have(7) || !have(5))('fork choices on maps', () => {
  it('starting choices depend only on the seed and spend no rand() of the rules', () => {
    const a = new Game(settings(100, 7), board(100)), b = new Game(settings(100, 7), board(100));
    expect(a.forks.choices).toEqual(b.forks.choices);
    expect(a.forks.choices).toHaveLength(4);
    expect(Object.keys(a.forks.choices[0]).length).toBeGreaterThanOrEqual(6);
    expect(a.forks.choices[0]).not.toEqual(a.forks.choices[1]);
    expect(new Game(settings(100, 8), board(100)).forks.choices).not.toEqual(a.forks.choices);
    const before = a.rng.seed;
    a.forks.init();
    expect(a.rng.seed).toBe(before);
    expect(a.forks.choices).toEqual(b.forks.choices);
  });

  it('the arrows shown (the plan) are what every player does, over long computer games', () => {
    const maps = [100, 7, 5, 1, ...(have(101) ? [101] : [])];
    for (const mapId of maps) {
      const g = new Game(settings(mapId, 30 + mapId), board(mapId));
      if (mapId === 7 || mapId === 5) expect(g.board.nodes.filter(n => n.adjacent.filter(Boolean).length === 4).every(n => g.forks.isFork(n.id))).toBe(true);
      const { checked, redrawn } = playChecked(g, 300);
      expect(checked, `map ${mapId}`).toBeGreaterThan(mapId === 1 ? 0 : 40);
      if (mapId !== 1) expect(redrawn, `map ${mapId}`).toBeGreaterThan(0);
    }
  });

  it('choices are saved per player; a loaded game goes on the same; an old save gets fresh choices', () => {
    const a = new Game(settings(100, 21), board(100)), fa = a.run();
    for (let r = fa.next(); !r.done; r = fa.next()) if (!('ask' in r.value) && r.value.t === 'turn' && a.daysElapsed >= 30) break;
    const saved = JSON.parse(JSON.stringify(saveGame(a)));
    expect(saved.modules.forks.choices).toEqual(a.forks.choices);
    const b = loadGame(saved), fb = b.run();
    fb.next();
    const log = (g: Game, f: Generator) => {
      const out: string[] = [];
      for (let r = f.next(); !r.done && g.daysElapsed < 60; r = f.next()) out.push(JSON.stringify(g.forks.choices));
      return out;
    };
    expect(log(b, fb)).toEqual(log(a, fa));
    // A save from before per-player choices (one shared arrow map) starts from the seed's choices.
    saved.modules.forks = { arrows: { 1: 2 } };
    const old = loadGame(saved);
    expect(old.forks.choices).toEqual(new Game(settings(100, 21), board(100)).forks.choices);
    expect((old.forks as unknown as { arrows?: unknown }).arrows).toBeUndefined();
  });
});
