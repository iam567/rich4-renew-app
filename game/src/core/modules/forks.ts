/**
 * 岔路箭頭 — the remake's per-player fork choices (docs/rules/14-forks-and-junctions.md).
 *
 * The original picks a random exit every time anyone reaches a fork (01 §6.2, rich4.asm:5975-6013), so a player
 * cannot know or plan the way. The remake decides it in advance, for each player separately: at every fork each
 * player holds a choice, and the map shows the current player's arrows. As a player walks out of a fork, that
 * player's choice there is decided again with the one rand() the original spends on that step.
 *
 *  - Fork: a square with 3 or 4 neighbours where, arriving along at least one of them, two or more ways stay open
 *    (never straight back, never through a slot closed by its one-way bit).
 *  - Choice (since 2026-10-18, 14 §2): a number 0..5. The ways out (open, not the way in) are sorted by their turn
 *    angle from the arriving direction (map space), leftmost first; the walker takes way `choice % count`. With 2
 *    ways out (a 3-way fork) that is even = the left one, odd = the right one; with 3 (a crossroads) 0/3 left,
 *    1/4 straight on, 2/5 right. So from any side every real road is equally likely, as the original's
 *    `rand() % candidates` is (the earlier 直走/左轉/右轉 rule chose one road of a T twice as often as the other).
 *  - Players (0..3) follow their own choice and redraw it (choice = rand() % 6); the robot doll follows its owner's
 *    choices without redrawing them; NPCs ignore them and pick at random as in the original.
 *  - Starting choices come from their own stream (game seed), so every new game has its own arrows and a new game
 *    spends no extra rand(); they are saved with the game.
 */
import type { BoardNode } from '../board';
import type { Game } from '../game';
import { Rng, daySeed } from '../rng';

const START_SALT = 0x0f0e5a;

/** The earlier relative choices (kept for `Forks.legacy`): 0 直走 / 1 左轉 / 2 右轉. */
export const Turn = { Straight: 0, Left: 1, Right: 2 } as const;
/** Choices are 0..CHOICES-1: a multiple of 2 and 3, so `choice % ways` is even for 2 and for 3 ways out. */
export const CHOICES = 6;
/** Saved with the choices; a save without it holds the earlier relative choices and starts afresh. */
export const FORKS_VERSION = 2;

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
 * a turn with nothing ahead) with choice `c`: the ways out sorted left to right by turn angle, way `c % count`.
 * `legacy`: the earlier rule, `c` = 0 直走 / 1 左轉 / 2 右轉 (a tie for straight goes right). Dead end: back.
 */
export function resolveTurn(n: BoardNode, byId: (id: number) => BoardNode, from: number, c: number, dir = 0, legacy = false): number {
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
  if (!legacy) return sorted[((c % sorted.length) + sorted.length) % sorted.length].id;
  if (c === Turn.Left) return sorted[0].id;
  if (c === Turn.Right) return sorted[sorted.length - 1].id;
  // Straight: the smallest turn; a tie goes right (the larger angle).
  return sorted.reduce((best, w) => (Math.abs(w.d) < Math.abs(best.d) - 1e-9 || (Math.abs(Math.abs(w.d) - Math.abs(best.d)) <= 1e-9 && w.d > best.d) ? w : best)).id;
}

export class Forks {
  /**
   * Test hook only (never a setting): the rule before 2026-10-18 (relative 直走/左轉/右轉, rand() % 3), so the
   * goldens taken before can still be replayed bit for bit (regional-golden.test.ts).
   */
  static legacy = false;
  /** Per player (index 0..3): fork square id → choice 0..5 (see the file header). Saved with the game. */
  choices: Record<number, number>[] = [];
  /** FORKS_VERSION of `choices` (absent in a legacy run, so its saves stay as they were). */
  v?: number;

  constructor(readonly g: Game) {}

  /** Starting choices, players in order, forks in id order, from a stream of their own (no rand() of the rules). */
  init(): void {
    const rng = new Rng(daySeed((this.g.settings.seed ^ START_SALT) >>> 0, 0));
    const forks = this.g.board.nodes.filter(isFork), k = Forks.legacy ? 3 : CHOICES;
    this.choices = this.g.players.map(() => {
      const c: Record<number, number> = {};
      for (const n of forks) c[n.id] = rng.below(k);
      return c;
    });
    if (Forks.legacy) delete this.v; else this.v = FORKS_VERSION;
  }

  /**
   * Called after a save is loaded (`saved`: the save's own forks record). A save from before per-player choices
   * (one shared `arrows` map), or with the earlier relative choices (no `v`), starts from the seed's choices.
   */
  afterLoad(saved?: Record<string, unknown>): void {
    const self = this as unknown as { arrows?: unknown };
    if (self.arrows !== undefined) delete self.arrows;
    const stale = !Forks.legacy && saved !== undefined && saved.v !== FORKS_VERSION;
    if (stale || !Array.isArray(this.choices) || this.choices.length !== this.g.players.length) this.init();
  }

  /** Fork squares, id order. */
  forks(): BoardNode[] {
    return this.g.board.nodes.filter(n => this.choices[0]?.[n.id] !== undefined);
  }

  isFork(at: number): boolean { return this.choices[0]?.[at] !== undefined; }

  choice(p: number, at: number): number { return this.choices[p]?.[at] ?? 0; }

  /** Where player `p` (or the doll of owner `p`) standing on fork `at`, come from `from`, goes. Changes nothing. */
  follow(p: number, at: number, from: number): number {
    const g = this.g;
    return resolveTurn(g.node(at), id => g.node(id), from, this.choice(p, at), g.players[p]?.dir ?? 0, Forks.legacy);
  }

  /** Player `p` walks out of fork `at`: their own choice, then that choice is drawn again with this step's rand(). */
  pass(p: number, at: number, from: number): number {
    const next = this.follow(p, at, from);
    this.choices[p][at] = this.g.rng.below(Forks.legacy ? 3 : CHOICES);
    return next;
  }

  /**
   * Player `p`'s way out of every fork on the road ahead, as it will happen: walks their route from where they
   * stand by their own choices, up to the first fork they would reach a second time (by then they have drawn a new
   * choice there) or `limit` steps. Map fork id → the neighbour they will step to. Forks not on that walk: none.
   * `ways`, when given, gets each of those forks' number of ways out from the side they arrive on (1 = no real
   * choice there, e.g. a prison spur passed on the main road).
   */
  plan(p: number, limit = 600, ways?: Map<number, number>): Map<number, number> {
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
        ways?.set(at, openExits(n).filter(x => x !== from).length);
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
