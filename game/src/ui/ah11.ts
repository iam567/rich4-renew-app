/**
 * The APARTMENT HOTEL 11 towers: five landmark buildings (map sprites 2611..2615, remake/sprites/26NN) that stand
 * here and there on open ground of 日本 (map 2) and the five cities 東京..沖繩 (100..104). Decoration only: no
 * record, no rule, nothing saved. Where they stand is picked from the free spots found offline (ah11-spots.ts,
 * editor/ah11_spots.py) with a little PRNG of the game's own seed (never the game's rng), so the same game shows the
 * same towers after a reload, and each new game other ones. Spots where a tower would cover or hide a fork's arrow
 * (fork-arrows.ts) are passed over; plants on a tower's plinth are left out (`ah11Hides`).
 */
import { worldSize } from '../core/board';
import type { Game } from '../core/game';
import { ASSETS, type MapSprites } from './assets';
import { AH11_SPOTS } from './ah11-spots';
import { forkSpot } from './fork-arrows';
import type { SpriteBank } from './sprites';

export interface Ah11 { x: number; y: number; res: number; facing: number }
interface Decor { x: number; y: number }

const RES = [2611, 2612, 2613, 2614, 2615];
/** A plant this close (Chebyshev, map px) to a tower is on its plinth (editor/ah11_spots.py HIDE). */
const PLANT_CLEAR = 72;
/** The tower on screen (zoom 1, from its frames): half its width, how far it rises above / reaches below its anchor. */
const TOWER = { w: 66, up: 125, down: 50 };

let done: Promise<void> | null = null;
let ready = false;

/** Registers the five towers' sprites once (before a board is drawn); without them no tower is placed. */
export function prepareAh11(bank: SpriteBank): Promise<void> {
  done ??= (async () => {
    const out: MapSprites = {};
    await Promise.all(RES.map(async res => {
      try {
        const r = await fetch(`${ASSETS}/maps/remake/sprites/${res}/frames.json`);
        if (r.ok) out[`map/${res}`] = { dir: `remake/sprites/${res}`, frames: await r.json() };
      } catch { /* not installed: no towers */ }
    }));
    ready = RES.every(res => out[`map/${res}`]);
    if (ready) bank.addMapSprites(out);
  })();
  return done;
}

/** mulberry32 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Screen offset of a map point in view rotation r (board-view's projection at zoom 1, docs/rules/08 §4.3). */
const ROT = Array.from({ length: 8 }, (_, r) => { const th = (-22.5 + 45 * r) * Math.PI / 180; return [Math.cos(th), Math.sin(th)]; });
function screenAt(x: number, y: number, r: number): [number, number] {
  const [c, s] = ROT[r];
  return [1.2175 * (c * x - s * y), 1.2175 * Math.SQRT1_2 * (s * x + c * y)];
}

/** Whether a tower at (x, y) would stand on or hide (in any view rotation) the point (ax, ay). */
function covers(x: number, y: number, ax: number, ay: number): boolean {
  for (let r = 0; r < 8; r++) {
    const [tx, ty] = screenAt(x, y, r), [sx, sy] = screenAt(ax, ay, r);
    if (Math.abs(sx - tx) < TOWER.w && sy > ty - TOWER.up && sy < ty + TOWER.down) return true;
  }
  return false;
}

const cache = new WeakMap<Game, Ah11[]>();

/**
 * The towers of a game: 3–5 of its map's free spots (one more on a bigger map), each a different building until all
 * five are used, facing a random side. Computed once per game. `decor`: the map's plants (the fork arrows' spots
 * are found among them, as the board finds them).
 */
export function ah11Placements(game: Game, decor: Decor[] = []): Ah11[] {
  const hit = cache.get(game);
  if (hit) return hit;
  const spots = ready ? AH11_SPOTS[game.settings.mapId] ?? [] : [];
  const out: Ah11[] = [];
  if (spots.length) {
    const b = game.board;
    const arrows = b.nodes.filter(n => n.adjacent.filter(Boolean).length >= 3).map(n => forkSpot(b, n, decor));
    const free = spots.filter(([x, y]) => !arrows.some(a => covers(x, y, a.x, a.y)));
    const rnd = prng((game.settings.seed ^ 0xa11a11) >>> 0);
    // Shuffle, then take spots far from those already taken first (spread over the map), the rest after.
    const order = free.map(s => ({ s, k: rnd() })).sort((p, q) => p.k - q.k).map(p => p.s);
    const big = worldSize(b) > 2304;
    const want = Math.min(order.length, 3 + Math.floor(rnd() * 3) + (big ? 1 : 0));
    const taken: [number, number][] = [];
    for (const far of [420, 260, 0]) {
      for (const s of order) {
        if (taken.length >= want) break;
        if (!taken.includes(s) && taken.every(t => Math.hypot(t[0] - s[0], t[1] - s[1]) >= far)) taken.push(s);
      }
    }
    let bag: number[] = [];
    for (const [x, y] of taken) {
      if (!bag.length) bag = RES.map(r => ({ r, k: rnd() })).sort((p, q) => p.k - q.k).map(p => p.r);
      out.push({ x, y, res: bag.pop()!, facing: 2 * Math.floor(rnd() * 4) });
    }
  }
  cache.set(game, out);
  return out;
}

/** Whether a plant stands on a tower's plinth (the board leaves it out). */
export function ah11Hides(towers: Ah11[], d: Decor): boolean {
  return towers.some(t => Math.max(Math.abs(t.x - d.x), Math.abs(t.y - d.y)) <= PLANT_CLEAR);
}
