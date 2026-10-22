/**
 * 岔路箭頭 — the remake's per-player fork choices (docs/rules/14-forks-and-junctions.md).
 *
 * The original picks a random exit every time anyone reaches a fork (01 §6.2, rich4.asm:5975-6013), so a player
 * cannot know or plan the way. The remake decides it in advance, for each player separately, and the map shows the
 * current player's arrows.
 *
 *  - Fork: a square with 3 or 4 neighbours where, arriving along at least one of them, two or more ways stay open
 *    (never straight back, never through a slot closed by its one-way bit).
 *  - Since 2026-10-23 (14 §2, `FORK_LRU`): the least recently used road. Each player remembers, at each fork, the
 *    last time they used each of its roads (absolute neighbour squares), walking in or walking out (a per-player
 *    stamp). Walking out, they take among the open ways (not the way in) a road they have never used there, else the
 *    one used longest ago; ties go by that player's seeded order of the fork's roads (`order`, drawn per game from
 *    its own stream). So passing a fork once turns that player's arrow there to a road not walked yet, and every road
 *    gets its turn; it is fully determined by the state (party lockstep) and the arrows can show it many forks ahead.
 *    The step's rand() is still drawn (and not used), so the rest of the game spends rand() as before.
 *  - The rule of 2026-10-18 (14 §2, its own subsection; `FORK_LRU` off): a choice 0..5 per player and fork; the
 *    ways out sorted by their turn angle from the arriving direction, leftmost first, way `choice % count`; walking
 *    out redraws the choice with that step's rand() % 6.
 *  - Players (0..3) follow their own arrows; the robot doll follows its owner's without changing them; NPCs ignore
 *    them and pick at random as in the original. Route predictions walk the player's arrows as they will be.
 *  - The starting state comes from its own stream (game seed), so every new game has its own arrows and a new game
 *    spends no extra rand(); it is saved with the game.
 */
import type { BoardNode } from '../board';
import type { Game } from '../game';
import { Rng, daySeed } from '../rng';

const START_SALT = 0x0f0e5a;

/** The earlier relative choices (kept for `Forks.legacy`): 0 直走 / 1 左轉 / 2 右轉. */
export const Turn = { Straight: 0, Left: 1, Right: 2 } as const;
/** Choices are 0..CHOICES-1: a multiple of 2 and 3, so `choice % ways` is even for 2 and for 3 ways out. */
export const CHOICES = 6;
/** Saved with the 0..5 choices (FORK_LRU off); a save without it holds the earlier relative choices. */
export const CHOICES_VERSION = 2;
/** Saved with the least-recently-used state (`order`, `used`, `tick`); any other save starts that state afresh. */
export const FORKS_VERSION = 3;

/**
 * The least-recently-used rule (2026-10-23, docs/rules/14 §2). A test hook like DOOR_STEP, never a setting: with it
 * off a new game plays the 0..5 choices of 2026-10-18 bit for bit (regional-golden.test.ts).
 */
export const FORK_LRU = { on: true };

/**
 * A predicted walk of one player (route predictions, the robot doll, the arrows): `next` is the way out of a fork as
 * the player will take it, counting the passes made earlier on the same walk (a fork met again goes the way it then
 * will); `took` notes a pass made some other way (in from `from`, out to `to`). Nothing in the game changes.
 */
export interface ForkWalk {
  next(at: number, from: number): number;
  took(at: number, from: number, to: number): void;
}

/**
 * The least recently used of `ways`: one never used (no stamp) first, else the smallest stamp; ties by `order` (the
 * player's seeded order of the fork's roads), then by square id.
 */
export function leastRecent(ways: number[], used: Record<number, number> | undefined, order: number[] | undefined): number {
  const rank = (w: number) => { const i = order ? order.indexOf(w) : -1; return i < 0 ? 99 : i; };
  let best = ways[0];
  for (const w of ways.slice(1)) {
    const a = used?.[w] ?? 0, b = used?.[best] ?? 0;
    if (a < b || (a === b && (rank(w) < rank(best) || (rank(w) === rank(best) && w < best)))) best = w;
  }
  return best;
}

/** `used` (a fork's stamps) after a pass in from `from` (when it is one of the fork's roads), out to `to`. */
function stamp(n: BoardNode, used: Record<number, number>, from: number, to: number, tick: number): number {
  if (from && from !== to && n.adjacent.includes(from)) used[from] = ++tick;
  used[to] = ++tick;
  return tick;
}

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
  /** FORK_LRU off: per player (index 0..3), fork square id → choice 0..5 (see the file header). Saved with the game. */
  choices: Record<number, number>[] = [];
  /**
   * FORKS_VERSION (3) with the least-recently-used state, CHOICES_VERSION (2) with `choices`; absent in a legacy run
   * (so its saves stay as they were).
   */
  v?: number;
  /** FORK_LRU: per player, fork id → its open ways in that player's seeded order (ties of never / equally used). */
  declare order: Record<number, number[]>[];
  /** FORK_LRU: per player, fork id → (road, a neighbour square → the player's stamp of the last time they used it). */
  declare used: Record<number, Record<number, number>>[];
  /** FORK_LRU: per player, the last stamp given (two per walk out of a fork: the way in, then the way out). */
  declare tick: number[];

  constructor(readonly g: Game) {}

  /** The least-recently-used rule (14 §2) in this game: a game started (or loaded) with FORK_LRU on. */
  get lru(): boolean { return this.v === FORKS_VERSION; }

  /**
   * The starting state, players in order, forks in id order, from a stream of their own (no rand() of the rules):
   * FORK_LRU, each fork's open ways shuffled per player, nothing used yet; else a choice 0..5 (0..2 legacy) each.
   */
  init(): void {
    const self = this as unknown as Record<string, unknown>;
    for (const k of ['order', 'used', 'tick']) delete self[k];
    const rng = new Rng(daySeed((this.g.settings.seed ^ START_SALT) >>> 0, 0));
    const forks = this.g.board.nodes.filter(isFork);
    if (FORK_LRU.on && !Forks.legacy) {
      delete self.choices;
      this.v = FORKS_VERSION;
      this.order = this.g.players.map(() => {
        const o: Record<number, number[]> = {};
        for (const n of forks) {
          const ways = openExits(n);
          for (let i = ways.length - 1; i > 0; i--) { const j = rng.below(i + 1); [ways[i], ways[j]] = [ways[j], ways[i]]; }
          o[n.id] = ways;
        }
        return o;
      });
      this.used = this.g.players.map(() => ({}));
      this.tick = this.g.players.map(() => 0);
      return;
    }
    const k = Forks.legacy ? 3 : CHOICES;
    this.choices = this.g.players.map(() => {
      const c: Record<number, number> = {};
      for (const n of forks) c[n.id] = rng.below(k);
      return c;
    });
    if (Forks.legacy) delete this.v; else this.v = CHOICES_VERSION;
  }

  /**
   * Called after a save is loaded (`saved`: the save's own forks record). A save of another rule — one shared
   * `arrows` map (before per-player choices), the relative choices (no `v`), the 0..5 choices (v 2) — starts from
   * this game's seed: with FORK_LRU nothing used yet, every player's arrows by their seeded order (14 §2 item 9).
   */
  afterLoad(saved?: Record<string, unknown>): void {
    const self = this as unknown as { arrows?: unknown };
    if (self.arrows !== undefined) delete self.arrows;
    const want = Forks.legacy ? undefined : FORK_LRU.on ? FORKS_VERSION : CHOICES_VERSION;
    const stale = !Forks.legacy && saved !== undefined && saved.v !== want;
    const n = this.g.players.length;
    const ok = (x: unknown) => Array.isArray(x) && x.length === n;
    const short = this.lru ? !ok(this.order) || !ok(this.used) || !ok(this.tick) : !ok(this.choices);
    if (stale || short) this.init();
  }

  /** Fork squares, id order. */
  forks(): BoardNode[] {
    return this.g.board.nodes.filter(n => this.isFork(n.id));
  }

  isFork(at: number): boolean { return (this.lru ? this.order[0] : this.choices[0])?.[at] !== undefined; }

  /** FORK_LRU off: player p's choice 0..5 at fork `at`. */
  choice(p: number, at: number): number { return this.choices?.[p]?.[at] ?? 0; }

  /** What changes player p's arrows (for the screen's cache): the stamp (FORK_LRU), else the choices. */
  stateKey(p: number): string {
    return this.lru ? String(this.tick[p] ?? 0) : Object.values(this.choices?.[p] ?? {}).join('');
  }

  /** The way out of fork `at` from `from` for player p with their stamps there `used` (FORK_LRU). */
  private choose(p: number, at: number, from: number, used: Record<number, number> | undefined): number {
    const ways = openExits(this.g.node(at)).filter(a => a !== from);
    if (!ways.length) return from;
    return ways.length === 1 ? ways[0] : leastRecent(ways, used, this.order[p]?.[at]);
  }

  /** Where player `p` (or the doll of owner `p`) standing on fork `at`, come from `from`, goes. Changes nothing. */
  follow(p: number, at: number, from: number): number {
    const g = this.g;
    if (this.lru) return this.choose(p, at, from, this.used[p]?.[at]);
    return resolveTurn(g.node(at), id => g.node(id), from, this.choice(p, at), g.players[p]?.dir ?? 0, Forks.legacy);
  }

  /**
   * Player `p` walks out of fork `at`: by their own arrow, which `adjust` may still change (歌舞伎町's 黑幫 holder,
   * docs/rules/21 §4.1). FORK_LRU: the way in and the way really taken get the player's next stamps, and this step's
   * rand() is drawn (unused, as the original spends one here); else the choice there is drawn again with that rand().
   */
  pass(p: number, at: number, from: number, adjust?: (next: number) => number): number {
    let next = this.follow(p, at, from);
    if (!this.lru) {
      this.choices[p][at] = this.g.rng.below(Forks.legacy ? 3 : CHOICES);
      return adjust ? adjust(next) : next;
    }
    if (adjust) next = adjust(next);
    const used = (this.used[p] ??= {});
    this.tick[p] = stamp(this.g.node(at), (used[at] ??= {}), from, next, this.tick[p] ?? 0);
    this.g.rng.rand();
    return next;
  }

  /**
   * A predicted walk of player p from now on (route predictions, the robot doll, the arrows; see ForkWalk). FORK_LRU
   * counts the passes of the walk itself, so a fork met twice is gone through as it will be; FORK_LRU off the choices
   * stay as they stand (the 2026-10-18 rule redraws them with a rand() nobody can know, 14 §2).
   */
  walk(p: number): ForkWalk {
    if (!this.lru) return { next: (at, from) => this.follow(p, at, from), took: () => {} };
    const mine = new Map<number, Record<number, number>>();
    let t = this.tick[p] ?? 0;
    const took = (at: number, from: number, to: number) => {
      const used = { ...(mine.get(at) ?? this.used[p]?.[at]) };
      t = stamp(this.g.node(at), used, from, to, t);
      mine.set(at, used);
    };
    return {
      next: (at, from) => { const n = this.choose(p, at, from, mine.get(at) ?? this.used[p]?.[at]); took(at, from, n); return n; },
      took,
    };
  }

  /**
   * Player `p`'s way out of every fork on the road ahead, as it will happen: walks their route from where they
   * stand by their own arrows, up to `limit` steps, and gives each fork's way out at the first visit (map fork id →
   * the neighbour they will step to; forks not on that walk: none). FORK_LRU: later visits are known too (the walk
   * counts its own passes), so it goes on past them; FORK_LRU off it stops at the first fork met a second time (by
   * then the choice there has been drawn again). `ways`, when given, gets each fork's number of ways out from the side
   * they first arrive on (1 = no real choice there, e.g. a prison spur passed on the main road); `passes`, every walk
   * out of a fork in order.
   */
  plan(p: number, limit = 600, ways?: Map<number, number>, passes?: { at: number; to: number }[]): Map<number, number> {
    const g = this.g, q = g.players[p], out = new Map<number, number>();
    if (!q || !q.placed) return out;
    const walk = this.walk(p), lru = this.lru;
    let at = q.node, from = q.lastNode;
    for (let i = 0; i < limit; i++) {
      const n = g.node(at);
      if (!n) break;
      let next: number;
      if (this.isFork(at)) {
        if (!lru && out.has(at)) break;
        next = walk.next(at, from);
        if (!out.has(at)) {
          out.set(at, next);
          ways?.set(at, openExits(n).filter(x => x !== from).length);
        }
        passes?.push({ at, to: next });
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
