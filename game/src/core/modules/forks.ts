/**
 * 岔路箭頭 — the remake's per-player fork choices (docs/rules/14-forks-and-junctions.md).
 *
 * The original picks a random exit every time anyone reaches a fork (01 §6.2, rich4.asm:5975-6013), so a player
 * cannot know or plan the way. The remake decides it in advance, for each player separately: at every fork each
 * player holds a choice relative to the way they arrive, 直走 / 左轉 / 右轉 (never back), and the map shows the
 * current player's arrows. As a player walks out of a fork, that player's choice there is decided again with the
 * one rand() the original spends on that step.
 *
 *  - Fork: a square with 3 or 4 neighbours where, arriving along at least one of them, two or more ways stay open
 *    (never straight back, never through a slot closed by its one-way bit).
 *  - Turning: the ways out (open, not the way in) sorted by their turn angle from the arriving direction (map
 *    space): 左轉 = the leftmost of them, 右轉 = the rightmost, 直走 = the one closest to straight on (a tie: the
 *    right one). So every choice always names a road: at a T met from its stem 直走 is the nearer side (the right
 *    on a tie); met along its bar 左轉 or 右轉 may be straight on, whichever way is leftmost / rightmost.
 *  - Players (0..3) follow their own choice and redraw it (choice = rand() % 3); the robot doll follows its owner's
 *    choices without redrawing them; NPCs ignore them and pick at random as in the original.
 *  - Starting choices come from their own stream (game seed), so a new game spends no extra rand().
 */
import type { BoardNode } from '../board';
import type { Game } from '../game';
import { Rng, daySeed } from '../rng';

const START_SALT = 0x0f0e5a;

export const Turn = { Straight: 0, Left: 1, Right: 2 } as const;
export const TURN_NAMES = ['直走', '左轉', '右轉'];

/** Ways out of a square, as the movement rule allows them (not counting the way in): non-empty, not closed. */
export function openExits(n: BoardNode): number[] {
  return n.adjacent.filter((a, j) => a && !(n.oneWay & (8 >> j)));
}

/** A square where some way in leaves two or more ways out. */
export function isFork(n: BoardNode): boolean {
  const near = n.adjacent.filter(Boolean), open = openExits(n);
  return near.length >= 3 && near.some(m => open.filter(x => x !== m).length >= 2);
}

/** Map angle (x right, y down) of a facing 0..7 (01 §6.3: 0 down, 2 right, 4 up, 6 left). */
const dirAngle = (dir: number) => ((2 - dir) * Math.PI) / 4;

/**
 * The way out of fork `n` for a walker arriving from `from` (heading `dir` when `from` is no neighbour, e.g. 0 after
 * a turn with nothing ahead) with relative choice `turn`. Dead end: back.
 */
export function resolveTurn(n: BoardNode, byId: (id: number) => BoardNode, from: number, turn: number, dir = 0): number {
  const ways = openExits(n).filter(a => a !== from);
  if (!ways.length) return from;
  if (ways.length === 1) return ways[0];
  const f = from && n.adjacent.includes(from) ? byId(from) : null;
  const heading = f ? Math.atan2(n.y - f.y, n.x - f.x) : dirAngle(dir);
  // Turn angle of each way: negative = left (anticlockwise on the map / screen), positive = right.
  const turnOf = (id: number) => {
    const m = byId(id);
    let d = Math.atan2(m.y - n.y, m.x - n.x) - heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const sorted = ways.map(id => ({ id, d: turnOf(id) })).sort((a, b) => a.d - b.d || a.id - b.id);
  if (turn === Turn.Left) return sorted[0].id;
  if (turn === Turn.Right) return sorted[sorted.length - 1].id;
  // Straight: the smallest turn; a tie goes right (the larger angle).
  return sorted.reduce((best, w) => (Math.abs(w.d) < Math.abs(best.d) - 1e-9 || (Math.abs(Math.abs(w.d) - Math.abs(best.d)) <= 1e-9 && w.d > best.d) ? w : best)).id;
}

export class Forks {
  /** Per player (index 0..3): fork square id → 0 直走 / 1 左轉 / 2 右轉. Saved with the game. */
  choices: Record<number, number>[] = [];

  constructor(readonly g: Game) {}

  /** Starting choices, players in order, forks in id order, from a stream of their own (no rand() of the rules). */
  init(): void {
    const rng = new Rng(daySeed((this.g.settings.seed ^ START_SALT) >>> 0, 0));
    const forks = this.g.board.nodes.filter(isFork);
    this.choices = this.g.players.map(() => {
      const c: Record<number, number> = {};
      for (const n of forks) c[n.id] = rng.below(3);
      return c;
    });
  }

  /** Called after a save is loaded: a save from before per-player choices (one shared `arrows` map) starts afresh. */
  afterLoad(): void {
    const self = this as unknown as { arrows?: unknown };
    if (self.arrows !== undefined) delete self.arrows;
    if (!Array.isArray(this.choices) || this.choices.length !== this.g.players.length) this.init();
  }

  /** Fork squares, id order. */
  forks(): BoardNode[] {
    return this.g.board.nodes.filter(n => this.choices[0]?.[n.id] !== undefined);
  }

  isFork(at: number): boolean { return this.choices[0]?.[at] !== undefined; }

  choice(p: number, at: number): number { return this.choices[p]?.[at] ?? Turn.Straight; }

  /** Where player `p` (or the doll of owner `p`) standing on fork `at`, come from `from`, goes. Changes nothing. */
  follow(p: number, at: number, from: number): number {
    const g = this.g;
    return resolveTurn(g.node(at), id => g.node(id), from, this.choice(p, at), g.players[p]?.dir ?? 0);
  }

  /** Player `p` walks out of fork `at`: their own choice, then that choice is drawn again with this step's rand(). */
  pass(p: number, at: number, from: number): number {
    const next = this.follow(p, at, from);
    this.choices[p][at] = this.g.rng.below(3);
    return next;
  }

  /**
   * Player `p`'s way out of every fork on the road ahead, as it will happen: walks their route from where they
   * stand by their own choices, up to the first fork they would reach a second time (by then they have drawn a new
   * choice there) or `limit` steps. Map fork id → the neighbour they will step to. Forks not on that walk: none.
   */
  plan(p: number, limit = 600): Map<number, number> {
    const g = this.g, q = g.players[p], out = new Map<number, number>();
    if (!q || !q.placed) return out;
    let at = q.node, from = q.lastNode;
    for (let i = 0; i < limit; i++) {
      const n = g.node(at);
      if (!n) break;
      let next: number;
      if (this.isFork(at)) {
        if (out.has(at)) break;
        next = this.follow(p, at, from);
        out.set(at, next);
      } else {
        const ways = openExits(n).filter(a => a !== from);
        if (ways.length > 1) break;           // a fork-like square without choices (should not happen): stop
        next = ways[0] ?? from;
      }
      if (!next) break;
      from = at; at = next;
    }
    return out;
  }
}
