/**
 * 小事件's move engine, shared by 開元盛世 (core/changan.ts MOVES) and 清明上河 (core/qingming-moves.ts QM_MOVES): an
 * exact stop on a 'move' square draws one event of the map's list at random — moves only, never money, 點券, the hospital
 * or the prison (the user 2026-11-23), the steps 1–6. A move that ends on a square stops there as usual (a lot to buy, a
 * toll …); another 小事件 square reached that way does nothing.
 *   fwd / back   walk n squares on / back the way the player came (facing kept)
 *   spin         n squares on or back (even chance), facing kept
 *   turnwalk     turn round and walk n squares the other way (the new way kept)
 *   dice         roll again (as many dice as one rides with) and walk on; n: that many throws
 *   turn         turn round: the next turn goes back the other way
 *   lot          walk on to the next lot nobody owns (at most 40 squares; none: one step)
 *   cross        walk on to the next crossroads; crossback: back to the last one
 *   wind         a whirlwind: blown onto a random free square far away
 *   swap         trade places with the nearest rival on the road (none: one step on)
 * `text`'s {n} is the steps drawn.
 *
 * A map keeps the moves to a part of it through MoveArea (清明上河: 梁山 and the town); the walk goes step by step as a
 * throw's does, the map's own step hook included (清明上河's 金沙灘 ends it).
 */
import { Game } from './game';
import type { BoardNode } from './board';
import type { Flow } from './flow';
import type { Player } from './types';

export type MoveKind = 'fwd' | 'back' | 'spin' | 'turnwalk' | 'dice' | 'turn' | 'lot' | 'cross' | 'crossback' | 'wind' | 'swap';
export interface MoveEvent { id: string; head: string; text: string; t: MoveKind; lo?: number; hi?: number }

/** A map's limits on the moves (all optional: 長安 has none). */
export interface MoveArea {
  /** The events that may be drawn for p where it stands (default: the whole list). */
  pool?(g: Game, p: Player, list: MoveEvent[]): MoveEvent[];
  /** The whirlwind's square (default: Game.randomFreeNode away from p). */
  windTo?(g: Game, p: Player): BoardNode;
  /** Whether p may trade places with q (default: anyone on the road). */
  swapOk?(g: Game, p: Player, q: Player): boolean;
}

export class MoveEngine {
  /** A 小事件 move in progress: the square it ends on is a stop, but another 小事件 there does nothing. */
  moving = false;
  /** `set`: the card's picture folder for the screen (maps/remake/<set>/moves; none: changan). */
  constructor(readonly list: MoveEvent[], readonly area: MoveArea = {}, readonly set?: string) {}

  *move(g: Game, p: Player): Flow {
    const list = this.area.pool ? this.area.pool(g, p, this.list) : this.list;
    const e = list[g.rng.below(list.length)];
    const lo = e.lo ?? 1, n = lo + g.rng.below((e.hi ?? lo) - lo + 1);
    const data: Record<string, unknown> = { id: e.id, head: e.head, text: e.text.replace('{n}', String(n)), n, t: e.t, human: g.isHuman(p) };
    if (this.set) data.set = this.set;
    yield { t: 'fx', kind: 'cn-move', p: p.id, data: data as never };
    let land = true;
    if (e.t === 'fwd') yield* this.walk(g, p, n, false);
    else if (e.t === 'back') yield* this.walk(g, p, n, true);
    else if (e.t === 'spin') yield* this.walk(g, p, n, g.rng.below(2) === 1);
    else if (e.t === 'turnwalk') {
      g.places.turnAround(p);
      yield { t: 'fx', kind: 'turn-around', p: p.id };
      yield* this.walk(g, p, n, false);
    } else if (e.t === 'turn') {
      g.places.turnAround(p);
      yield { t: 'fx', kind: 'turn-around', p: p.id };
      yield* g.say(p.id, `${g.name(p.id)}掉頭了`);
      land = false;
    } else if (e.t === 'dice') {
      let steps = 0;
      for (let k = 0; k < n; k++) {
        const values = Array.from({ length: Math.max(1, p.dice) }, () => g.rng.rand() % 6 + 1);
        yield { t: 'dice', p: p.id, values };
        steps += values.reduce((x, y) => x + y, 0);
      }
      yield* this.walk(g, p, steps, false);
    } else if (e.t === 'lot' || e.t === 'cross' || e.t === 'crossback') {
      const back = e.t === 'crossback';
      if (back) g.places.turnAround(p);
      let at = p.node, from = p.lastNode, k = 0;
      for (; k < 40; k++) {
        const next = g.peekNext(p.id, at, from);
        from = at; at = next;
        const sq = g.node(at), r = sq.ref;
        if (e.t !== 'lot' ? sq.adjacent.filter(Boolean).length > 2
          : r > 2000 && r < 4000 ? g.board.lands[r - 2001]?.owner === 0 : r > 4000 && r < 6000 ? g.board.facilities[r - 4001]?.owner === 0 : false) break;
      }
      if (back) g.places.turnAround(p);
      yield* this.walk(g, p, k < 40 ? k + 1 : 1, back);
    } else if (e.t === 'wind') {
      const to = this.area.windTo ? this.area.windTo(g, p) : g.randomFreeNode(g.node(p.node));
      yield { t: 'fx', kind: 'cn-whirlwind', p: p.id, data: { from: p.node, to: to.id } };
      p.lastNode = to.adjacent.find(a => a && a !== p.lastNode) ?? to.adjacent.find(Boolean) ?? to.id;
      p.node = to.id;
      yield { t: 'teleport', p: p.id, node: to.id };
      yield* g.say(p.id, `${g.name(p.id)}被旋風吹走了`);
    } else if (e.t === 'swap') {
      const here = g.node(p.node);
      const q = g.players.filter(o => o.id !== p.id && o.placed && o.whoPlays && !o.bankrupt && !g.offRoad(o) && o.node !== p.node && (!this.area.swapOk || this.area.swapOk(g, p, o)))
        .sort((a, b) => Math.hypot(g.node(a.node).x - here.x, g.node(a.node).y - here.y) - Math.hypot(g.node(b.node).x - here.x, g.node(b.node).y - here.y) || a.id - b.id)[0];
      if (!q) yield* this.walk(g, p, 1, false);
      else {
        [p.node, q.node] = [q.node, p.node];
        [p.lastNode, q.lastNode] = [q.lastNode, p.lastNode];
        [p.dir, q.dir] = [q.dir, p.dir];
        yield { t: 'teleport', p: p.id, node: p.node };
        yield { t: 'teleport', p: q.id, node: q.node };
        yield* g.say(p.id, `${g.name(p.id)}和${g.name(q.id)}換了位置`);
        land = false;
      }
    }
    if (!land || g.over || !p.whoPlays || g.offRoad(p)) return;
    this.moving = true;
    try { yield* g.land(p); } finally { this.moving = false; }
  }

  /**
   * `n` squares on (or back the way the player came), step by step as a throw walks — the forks by the player's own
   * arrows, the bank's cash machine passed, roadblocks, mines, gods and the time bomb on the way as on any walk, then the
   * map's own step hook (清明上河: 金沙灘 ends the walk) — facing kept. The square it ends on is then a stop like any
   * (move: Game.land).
   */
  *walk(g: Game, p: Player, n: number, back: boolean): Flow {
    if (back) g.places.turnAround(p);
    let left = n;
    while (left > 0 && !g.over && p.whoPlays && !g.offRoad(p)) {
      const next = g.walkNext(p.id, p.node, p.lastNode);
      const from = g.node(p.node), to = g.node(next);
      p.lastNode = p.node; p.node = next;
      p.dir = Game.direction(to.x - from.x, to.y - from.y);
      left -= 1;
      yield { t: 'step', p: p.id, from: from.id, to: to.id, dir: p.dir, left };
      // passing the bank: its cash machine, as on a throw's walk (Game.stepDone)
      if (to.event === 14 && left !== 0 && !p.sleepwalk && g.objects.at(to.id)?.type !== 16 && !g.isBeggar(p) && !g.bankClosed()) {
        yield* g.atm(p);
        if (g.over || !p.whoPlays) return;
      }
      left = yield* g.objects.step(p, left);
      if (g.rules?.step && !g.over && p.whoPlays) left = yield* g.rules.step(g, p, left);
    }
    if (back && !g.offRoad(p)) g.places.turnAround(p);
  }
}
