/**
 * 即時制 (測試版, docs/rules/31; the user 2026-11-07): everyone plays at once. Each player has a lane of their own: their
 * turn (Game.turnStart + playerTurn, the turn-based game's own flow) begins as soon as their cooldown is over, and
 * lanes run side by side on one logical clock in milliseconds. A lane sleeps after each event for the time the screen
 * takes to show it (a square walked, the dice, a message), waits without limit on its player's questions, and the
 * calendar turns every DAY ms on a lane of its own; the NPCs walk on another.
 *
 * Everything happens in the order of (time, lane): given the same answers at the same logical times, every phone
 * plays the same game. The game's few per-turn fields (whose turn it is, the dice total …) are switched with the lane.
 */
import type { Flow } from './flow';
import type { Game } from './game';
import { Rng } from './rng';
import type { Answer, Ask, Player, Step } from './types';

/** The clock (the user 2026-11-07: a day is one turn of the clock hand, 12 s; stays 6 s a day; 2 s between moves). */
export const RT = {
  day: 12_000,
  /** A day of a stay (旅館, 監獄, 醫院, 冬眠 …): one turn of a staying player. */
  stay: 6_000,
  /** After a move, before the next one may begin. */
  cool: 2_000,
  /**
   * A computer's cooldown, a human's on 托管 or dropped too (the user 2026-11-08: a computer buys and skips at once,
   * so it waits longer than a hand): from … to (ms), drawn each time, by 電腦難度 (Game.aiLevel: 簡單, 中等, 困難,
   * 地獄 — the user 2026-11-08: the harder, the quicker).
   */
  aiCool: [[5_000, 6_000], [4_000, 5_000], [3_500, 5_000], [2_500, 4_000]] as const,
  /** A little more for a computer, from … to (ms), so the computers do not all move at the same moment. */
  aiReact: [0, 500] as const,
  /** The NPCs (財神's walkers, the police …) take a turn this often. */
  npc: 6_000,
  /** After a card or a tool used outside one's turn, before the next (the user 2026-11-07: no rapid fire). */
  cardCool: 5_000,
  /** A lot two players reached: the first has it this long, then the others may buy too (the user 2026-11-07). */
  lock: 5_000,
  /** A locked missile falls this long after the lock (the target hears it coming, the user 2026-11-07). */
  missile: 3_000,
  /** A wheel (旅遊, 旅館, 購物, 保險) turns this long, the player's and a computer's alike (the user 2026-11-08). */
  wheel: 1_500,
  /** A player who has not moved this long after their turn opened rolls by themselves (the user 2026-11-08: no camping). */
  move: 30_000,
  /** A shop, the bank, the magic house or the lottery: left by themselves after this long (the user 2026-11-08). */
  indoors: 20_000,
};

/** What the rules ask of the clock (Game.rt): the lots being decided on, the time. */
export interface RtHooks {
  /** Who else is deciding on property `ref` and still has the first claim (player id), or -1. */
  heldBy(ref: number, p: number): number;
  /** p starts deciding on `ref` (the first to come keeps it RT.lock ms). */
  claim(ref: number, p: number): void;
  /** p has decided. */
  release(ref: number, p: number): void;
  /**
   * p comes into the market: false when not yet allowed — once between two rolls and a day after leaving it (the user
   * 2026-11-08: no sitting in the market instead of playing the board).
   */
  marketIn(p: number): boolean;
  /** p left the market. */
  marketOut(p: number): void;
  /**
   * A human enters (+1) or leaves (-1) a screen that hides the board: a shop, the bank, the magic house, the lottery
   * (Game.indoors).
   */
  indoors(p: number, d: 1 | -1): void;
  /** p is in one now (the user 2026-11-08: they cannot see it coming; 「購物中」 over their head). */
  isIndoors(p: number): boolean;
  /** Out of reach of others' cards, magic and missiles: indoors, or hit enough since their last roll (RT_HITS). */
  isShielded(p: number): boolean;
  /** p (a human) was hit by someone else's card, magic or missile. */
  struck(p: number): void;
}

/**
 * How often a human may be hit by others' cards, magic and missiles between two of their own rolls, by 電腦難度
 * (the user 2026-11-08: a casual game — 簡單 once, 中等 twice, 困難 and 地獄 no limit; 派對模式 no limit whatever the
 * level). Then 「保護中」 till they roll. (購物中 holds online too.)
 */
export const RT_HITS = [1, 2, Infinity, Infinity];

/** 即時制's lengths in minutes, 0 無限制 (the user 2026-11-07: 20 by default, 無限制 always there). */
export const RT_LENGTHS = [20, 15, 0];
/** 即時制 only on the standard maps (the user 2026-11-07: not 歌舞伎町 106, 激情歲月 107; 大富翁城 105 neither). */
export const rtMapOk = (mapId: number) => mapId !== 105 && mapId !== 106 && mapId !== 107;

/**
 * Walking pace in world px per ms (the user 2026-11-08: an RPG's walk — everyone at their own steady pace): on foot,
 * scooter, car (the board's own speeds 8 : 12 : 16), a square (about 55 px) in about 0.23 s on foot.
 */
export const RT_PACE = [0.24, 0.36, 0.48, 0.24];

/** What each event takes on the screen (ms): the lane waits this long before going on. (Steps: Realtime.cost.) */
export function stepCost(s: Step): number {
  switch (s.t) {
    case 'dice': return 1_200;
    case 'step': case 'actor-step': return 230;
    case 'say': return s.text ? 1_000 : 0;
    case 'buy': case 'build': return 500;
    case 'pay': return 300;
    case 'teleport': case 'airdrop': return 300;
    case 'fx': return s.kind === 'rt-wait' ? 250 : s.kind === 'wheel' ? RT.wheel : 400;
    default: return 0;
  }
}

/** An event as the clock gave it: when, on which lane, how long it takes, and for a question its id (answers name it). */
export interface RtEvent { at: number; lane: number; step: Step; id?: number; ms?: number }

interface Ctx { current: number; diceTotal: number; checkedIn: boolean; remoteDice: number; pending: 'none' | 'depart' | 'land'; skip: boolean }

interface Lane {
  /** The player, or -1 (the calendar), -2 (the NPCs). */
  p: number;
  /** A player's second lane: a card, a tool or the market opened outside their turn. */
  side?: boolean;
  flow: Flow | null;
  /** When the running flow goes on (Infinity while it waits for an answer). */
  wake: number;
  /** When an idle lane starts its next turn (Infinity: never again). */
  ready: number;
  /** The open question: its id, and the answer once given. */
  ask: { id: number; q: Ask } | null;
  /** When the open question is answered by itself (RT.move, RT.indoors; Infinity: never). */
  deadline: number;
  answer: Answer;
  started: number;
  /** This turn rolled or walked (else it was a day of a stay, or the landing). */
  moved: boolean;
  ctx: Ctx;
}

export interface RealtimeOptions {
  /** The game's length in ms; 0 無限制 (the user: default 20 minutes, 無限制 always offered). */
  length: number;
}

export class Realtime {
  /** The logical clock (ms since the start). */
  now = 0;
  private readonly lanes: Lane[] = [];
  private nextDay: number = RT.day;
  private nextNpc: number = RT.npc;
  private askId = 0;
  private broke = 0;
  /** The computers' reaction times: their own sequence, so the game's dice never depend on them (docs: fair random). */
  private readonly react: Rng;
  private out: RtEvent[] = [];
  /** Each player's second lane (cards, tools, the market at any time). */
  private readonly sides: Lane[] = [];
  /** When each player may use a card or a tool outside their turn again. */
  private readonly cardReady: number[] = [];
  /** The lots being decided on: who came first and when. */
  /** Rolls so far, by player, and each one's last market visit: the roll count then and the day they left (RtHooks.marketIn). */
  private readonly rolled: number[] = [];
  private readonly market: { roll: number; left: number }[] = [];
  /** Screens that hide the board, open per player (RtHooks.indoors). */
  private readonly inside: number[] = [];
  private readonly insideSince: number[] = [];
  private readonly insideTold: number[] = [];
  /** Hits taken since each player's last roll (RtHooks.struck). */
  private readonly hits: number[] = [];
  private readonly claims = new Map<number, { p: number; at: number; deciding: Set<number> }>();

  constructor(readonly g: Game, readonly opts: RealtimeOptions) {
    // a loaded game: the clock goes on from where it was saved (every turn starts anew)
    const t = Math.max(0, g.rtNow || 0);
    this.now = t;
    this.nextDay = (Math.floor(t / RT.day) + 1) * RT.day;
    this.nextNpc = (Math.floor(t / RT.npc) + 1) * RT.npc;
    this.react = new Rng((g.settings.seed ^ 0x52ea17) >>> 0);
    // mini games give a random result (the user 2026-11-07): nobody plays them, as with 「動畫過程」 off
    g.animation = false;
    const ctx = (): Ctx => ({ current: 0, diceTotal: 0, checkedIn: false, remoteDice: 0, pending: 'none', skip: false });
    g.players.forEach((_, i) => this.lanes.push({ p: i, flow: null, wake: Infinity, ready: t + 100 * i, ask: null, deadline: Infinity, answer: undefined, started: 0, moved: false, ctx: { ...ctx(), current: i } }));
    this.lanes.push({ p: -1, flow: null, wake: Infinity, ready: Infinity, ask: null, deadline: Infinity, answer: undefined, started: 0, moved: false, ctx: ctx() });
    this.lanes.push({ p: -2, flow: null, wake: Infinity, ready: Infinity, ask: null, deadline: Infinity, answer: undefined, started: 0, moved: false, ctx: ctx() });
    this.broke = g.players.filter(p => p.bankrupt).length;
    g.players.forEach((_, i) => {
      this.sides.push({ p: i, side: true, flow: null, wake: Infinity, ready: Infinity, ask: null, deadline: Infinity, answer: undefined, started: 0, moved: false, ctx: { ...ctx(), current: i } });
      this.cardReady.push(0);
    });
    g.rt = {
      marketIn: p => {
        const k = this.rolled[p] ?? 0, m = this.market[p];
        if (m && (m.roll === k || g.daysElapsed <= m.left)) return false;
        this.market[p] = { roll: k, left: Infinity };
        return true;
      },
      marketOut: p => { const m = this.market[p]; if (m) m.left = g.daysElapsed; },
      indoors: (p, d) => {
        if (d > 0 && !this.inside[p]) this.insideSince[p] = this.now;
        this.inside[p] = Math.max(0, (this.inside[p] ?? 0) + d);
      },
      isIndoors: p => (this.inside[p] ?? 0) > 0,
      isShielded: p => (this.inside[p] ?? 0) > 0 || (this.hits[p] ?? 0) >= this.hitLimit(),
      struck: p => {
        const q = g.players[p];
        if (!q || !g.isHuman(q)) return;
        this.hits[p] = (this.hits[p] ?? 0) + 1;
        if (this.hits[p] === this.hitLimit()) this.out.push({ at: this.now, lane: p, step: { t: 'fx', kind: 'rt-shield', p } });
      },
      heldBy: (ref, p) => {
        const c = this.claims.get(ref);
        return c && c.p !== p && c.deciding.has(c.p) && this.now < c.at + RT.lock ? c.p : -1;
      },
      claim: (ref, p) => {
        const c = this.claims.get(ref);
        if (c && c.deciding.size) c.deciding.add(p); else this.claims.set(ref, { p, at: this.now, deciding: new Set([p]) });
      },
      release: (ref, p) => {
        const c = this.claims.get(ref);
        if (!c) return;
        c.deciding.delete(p);
        if (!c.deciding.size) this.claims.delete(ref);
      },
    };
  }

  /**
   * p opens a card, a tool or the market outside their own turn menu (the user 2026-11-07: cards at any time, 5 s
   * between two). Returns 0 when it opened, else the ms to wait (Infinity: not now — already open, out of the game).
   */
  act(p: number, kind: 'card' | 'tool' | 'stock'): number {
    const g = this.g, q = g.players[p], side = this.sides[p];
    if (!q || q.bankrupt || !q.placed || side.flow || g.over) return Infinity;
    if (kind !== 'stock' && this.now < this.cardReady[p]) return this.cardReady[p] - this.now;
    const before = q.cards.length + q.tools.reduce((a, b) => a + b, 0);
    side.ctx.current = p;
    side.flow = (function* (): Flow {
      if (kind === 'card') yield* g.cards.humanUse(q);
      else if (kind === 'tool') yield* g.tools.humanUse(q, [8]); // 遙控骰子 only when rolling (the user)
      else { yield* g.stocks.humanMarket(q); if (!g.over) yield* g.financeRecall(); }
    })();
    side.started = this.now;
    side.moved = false;
    side.answer = undefined;
    side.wake = this.now;
    // the cooldown starts when a card or a tool was really used: `ready` holds the count before, checked at the end
    side.ready = before;
    this.resume(side);
    return 0;
  }

  /** Whether p's second lane is open (a card, a tool or the market outside the turn). */
  acting(p: number): boolean { return !!this.sides[p]?.flow; }

  /** When p may use a card or a tool outside their turn again (ms of the clock). */
  cardReadyAt(p: number): number { return this.cardReady[p] ?? 0; }

  /** The questions waiting for an answer: lane, id and the question. */
  asks(): { lane: number; id: number; q: Ask; side: boolean }[] {
    return [...this.lanes, ...this.sides].flatMap(l => (l.ask ? [{ lane: l.p, id: l.ask.id, q: l.ask.q, side: !!l.side }] : []));
  }

  /** Whether player p's lane is in a turn (walking, deciding) — not waiting for its cooldown or a stay. */
  busy(p: number): boolean { return !!this.lanes[p]?.flow; }

  /**
   * The time limit on p's open question (RT.move, RT.indoors): when it answers itself, its whole length, and which one;
   * null when there is none.
   */
  limitOf(p: number): { at: number; total: number; what: 'move' | 'decide' | 'indoors' } | null {
    const l = this.lanes[p];
    if (!l?.ask || !Number.isFinite(l.deadline)) return null;
    const indoors = !!this.inside[p] && l.deadline === (this.insideSince[p] ?? 0) + RT.indoors;
    return { at: l.deadline, total: indoors ? RT.indoors : RT.move, what: indoors ? 'indoors' : l.moved ? 'decide' : 'move' };
  }

  /** RT_HITS by the game's 電腦難度; 派對模式 none (the user 2026-11-08: online, as many hits as come). */
  private hitLimit(): number {
    const s = this.g.settings;
    if (s.party) return Infinity;
    return RT_HITS[s.challenge ? 2 : s.aiLevel ?? 0] ?? Infinity;
  }

  /** p was hit enough since their last roll: others cannot reach them till they roll (「保護中」). */
  guarded(p: number): boolean { return (this.hits[p] ?? 0) >= this.hitLimit(); }

  /** When player p's next turn may begin (ms); Infinity when never. */
  readyAt(p: number): number { return this.lanes[p]?.ready ?? Infinity; }

  /** Answers question `id` at the clock's present time; false when it is no longer open (answered, or gone). */
  answer(id: number, a: Answer): boolean {
    const l = [...this.lanes, ...this.sides].find(x => x.ask?.id === id);
    if (!l) return false;
    l.ask = null;
    l.answer = a;
    l.wake = this.now;
    return true;
  }

  /** Runs everything due up to `to` (ms) and returns what happened, in order. */
  advance(to: number): RtEvent[] {
    this.out = [];
    const g = this.g;
    for (let guard = 0; !g.over && guard < 100_000; guard++) {
      const t = this.due();
      if (t.at > to) break;
      this.now = Math.max(this.now, t.at);
      if (t.kind === 'end') { this.timeUp(); break; }
      if (t.kind === 'day') { this.nextDay += RT.day; this.startSystem(-1, g.dailySettlement()); continue; }
      if (t.kind === 'npc') { this.nextNpc += RT.npc; this.startSystem(-2, this.npcs()); continue; }
      const l = t.lane < this.lanes.length ? this.lanes[t.lane] : this.sides[t.lane - this.lanes.length];
      if (!l.flow) this.startTurn(l);
      else if (l.ask) this.timeout(l);
      else this.resume(l);
    }
    if (!g.over && this.now < to) this.now = to;
    return this.out;
  }

  /** The next thing due: a lane going on, a turn starting, the calendar, the NPCs, the end. */
  private due(): { at: number; kind: 'lane' | 'day' | 'npc' | 'end'; lane: number } {
    let best = { at: Infinity, kind: 'lane' as 'lane' | 'day' | 'npc' | 'end', lane: -1 };
    const take = (at: number, kind: typeof best.kind, lane = -1) => { if (at < best.at) best = { at, kind, lane }; };
    if (this.opts.length > 0) take(this.opts.length, 'end');
    // the calendar first at the same moment, then the NPCs, then the players by seat
    const cal = this.lanes[this.lanes.length - 2], npc = this.lanes[this.lanes.length - 1];
    if (!cal.flow) take(this.nextDay, 'day');
    if (!npc.flow) take(this.nextNpc, 'npc');
    this.lanes.forEach((l, i) => take(l.flow ? (l.ask ? l.deadline : l.wake) : l.ready, 'lane', i));
    this.sides.forEach((l, i) => { if (l.flow && !l.ask) take(l.wake, 'lane', this.lanes.length + i); });
    return best;
  }

  private startSystem(who: -1 | -2, flow: Flow) {
    const l = this.lanes[this.lanes.length + who];
    l.flow = flow; l.wake = this.now; l.answer = undefined;
    this.resume(l);
  }

  /** The NPCs' turns (Game.loop's places.npcTurn for each active one). */
  private *npcs(): Flow {
    const g = this.g;
    for (let i = g.npcBase; i < g.npcBase + 4 && !g.over; i++) {
      if (!g.places.npcActive(i)) continue;
      g.current = i;
      yield* g.places.npcTurn(i);
    }
  }

  private startTurn(l: Lane) {
    const g = this.g, p = g.players[l.p];
    if (p.bankrupt) { l.ready = Infinity; return; }
    l.started = this.now;
    l.moved = false;
    l.answer = undefined;
    l.ctx.current = l.p;
    l.flow = this.turn(l, p);
    l.wake = this.now;
    this.resume(l);
  }

  /** One turn of a player: the turn-based game's start of turn and the turn itself. */
  private *turn(_l: Lane, p: Player): Flow {
    const g = this.g;
    yield* g.turnStart(p);
    if (g.over) return;
    yield* g.playerTurn(p);
  }

  /** Goes on with a lane until it has to wait: for the screen, for an answer, or its turn is over. */
  private resume(l: Lane) {
    const g = this.g;
    this.swapIn(l);
    try {
      for (let n = 0; n < 10_000; n++) {
        const a = l.answer;
        l.answer = undefined;
        const r = l.flow!.next(a);
        if (r.done) { this.finished(l); return; }
        const s = r.value;
        const lane = l.p;
        if ('ask' in s) {
          l.ask = { id: ++this.askId, q: s as Ask };
          l.wake = Infinity;
          l.deadline = this.deadline(l);
          this.out.push({ at: this.now, lane, step: s, id: l.ask.id });
          return;
        }
        const c = (l.p >= 0 && !l.side) || l.p === -2 ? this.cost(s) : s.t === 'fx' && s.kind === 'rt-wait' ? 250 : 0;
        this.out.push({ at: this.now, lane, step: s, ...(c ? { ms: c } : {}) });
        if ((s.t === 'dice' || s.t === 'step') && s.p === l.p) l.moved = true;
        if (s.t === 'dice' && s.p >= 0) { this.rolled[s.p] = (this.rolled[s.p] ?? 0) + 1; this.hits[s.p] = 0; }
        g.stats?.observe(s, g);
        this.afterStep(l);
        if (g.over) { l.flow = null; return; }
        if (c > 0) { l.wake = this.now + c; return; }
      }
      throw new Error('即時制: a lane never stopped');
    } finally {
      this.swapOut(l);
    }
  }

  /**
   * When a human's open question answers itself: their turn's first move within RT.move of its start, any question
   * after it (buy this lot? …) within RT.move of its asking, a shop (the bank, the magic house, the lottery) within
   * RT.indoors of going in. Infinity off their own turn (a card, a tool, the market on the second lane).
   */
  private deadline(l: Lane): number {
    if (l.p < 0 || l.side || !this.g.isHuman(this.g.players[l.p])) return Infinity;
    let d = l.moved ? this.now + RT.move : l.started + RT.move;
    if (this.inside[l.p]) d = Math.min(d, (this.insideSince[l.p] ?? this.now) + RT.indoors);
    return d;
  }

  /** A question's time is up: no answer (the turn rolls the dice, a shop is left), and the screen is told why. */
  private timeout(l: Lane) {
    const q = l.ask!.q, indoors = !!this.inside[l.p] && this.now >= (this.insideSince[l.p] ?? 0) + RT.indoors;
    l.ask = null;
    l.deadline = Infinity;
    l.answer = undefined;
    // (no answer: the turn's own question rolls the dice, any other is closed — a card screen, then the turn's question
    // again, at once; told once: at the roll, or once a visit)
    const tell = indoors ? this.insideTold[l.p] !== this.insideSince[l.p] : q.t === 'turn' || l.moved;
    if (indoors) this.insideTold[l.p] = this.insideSince[l.p];
    if (tell) this.out.push({ at: this.now, lane: l.p, step: { t: 'fx', kind: 'rt-timeout', p: l.p, data: { what: indoors ? 'indoors' : l.moved ? 'decide' : 'move' } } });
    this.resume(l);
  }

  /** How long an event holds its lane: a square walked by its length at the walker's pace (sqrt: the same on every phone). */
  private cost(s: Step): number {
    if (s.t !== 'step' && s.t !== 'actor-step') return stepCost(s);
    const a = this.g.board.nodes.find(n => n.id === s.from), b = this.g.board.nodes.find(n => n.id === s.to);
    if (!a || !b) return stepCost(s);
    const dx = a.x - b.x, dy = a.y - b.y;
    const pace = s.t === 'step' ? RT_PACE[(this.g.players[s.p]?.traffic ?? 0) & 3] : RT_PACE[0];
    return Math.round(Math.min(700, Math.max(120, Math.sqrt(dx * dx + dy * dy) / pace)));
  }

  /** A lane's flow is over: its next turn after the cooldown (a staying player: after a day of the stay). */
  private finished(l: Lane) {
    l.flow = null;
    l.wake = Infinity;
    if (l.side) {
      const q = this.g.players[l.p], now = q.cards.length + q.tools.reduce((a, b) => a + b, 0);
      if (now < l.ready) this.cardReady[l.p] = this.now + RT.cardCool;
      l.ready = Infinity;
      return;
    }
    if (l.p < 0) return;
    const p = this.g.players[l.p];
    if (p.bankrupt || !p.whoPlays && p.placed) { l.ready = Infinity; return; }
    if (!l.moved) { l.ready = Math.max(this.now, l.started + RT.stay); return; }
    if (this.g.isHuman(p)) { l.ready = this.now + RT.cool; return; }
    const draw = ([lo, hi]: readonly [number, number]) => lo + this.react.below(hi - lo + 1);
    l.ready = this.now + draw(RT.aiCool[this.g.aiLevel(p)] ?? RT.aiCool[1]) + draw(RT.aiReact);
  }

  /**
   * After any event: each new bankruptcy doubles the price index (the user 2026-11-07); a bankrupt player's lane stops
   * — another lane's at once (its turn is cut where it waits), the running one when its flow ends (the bankruptcy itself
   * runs in it to the end).
   */
  private afterStep(running: Lane) {
    const g = this.g, n = g.players.filter(p => p.bankrupt).length;
    if (n <= this.broke) return;
    for (let k = this.broke; k < n; k++) g.priceIndex *= 2;
    this.broke = n;
    for (const l of [...this.lanes, ...this.sides]) {
      if (l.p < 0 || l === running || !g.players[l.p].bankrupt) continue;
      if (l.flow) { this.swapOut(running); this.swapIn(l); try { l.flow.return(undefined); } finally { this.swapOut(l); this.swapIn(running); } }
      l.flow = null; l.ask = null; l.wake = Infinity; l.ready = Infinity;
    }
  }

  /** The time is up: the richest still in the game wins. */
  private timeUp() {
    const g = this.g;
    for (const l of [...this.lanes, ...this.sides]) { if (l.flow) { this.swapIn(l); try { l.flow.return(undefined); } finally { this.swapOut(l); } } l.flow = null; l.ask = null; }
    let best: Player | null = null, w = -Infinity;
    for (const p of g.living()) { const x = g.wealth(p); if (!p.bankrupt && x > w) { best = p; w = x; } }
    if (!best) return;
    const flow = g.finishNow(best.id);
    for (let r = flow.next(); !r.done; r = flow.next()) this.out.push({ at: this.now, lane: best.id, step: r.value });
  }

  // ------------------------------------------------------------------ the per-turn fields, per lane

  private swapIn(l: Lane) {
    const g = this.g, c = l.ctx, t = g.tools as unknown as { remoteDice: number; pending: Ctx['pending']; skipNextStore: boolean };
    g.current = c.current; g.diceTotal = c.diceTotal; g.checkedIn = c.checkedIn;
    t.remoteDice = c.remoteDice; t.pending = c.pending; t.skipNextStore = c.skip;
  }

  private swapOut(l: Lane) {
    const g = this.g, c = l.ctx, t = g.tools as unknown as { remoteDice: number; pending: Ctx['pending']; skipNextStore: boolean };
    c.current = g.current; c.diceTotal = g.diceTotal; c.checkedIn = g.checkedIn;
    c.remoteDice = t.remoteDice; c.pending = t.pending; c.skip = t.skipNextStore;
  }
}
