/**
 * 歌舞伎町's 柏青哥店 / 拉霸店 machines (docs/rules/21 §7, the remake's addition): a simplified Japanese pachinko and
 * pachislot, played with 點券. The human plays them on the screens (ui/screens/kb-pachinko.ts, kb-pachislot.ts) driving
 * the same machine objects with the same random stream; a computer's whole session is resolved at once (`aiSession`).
 * The numbers are the design's (editor/kabukicho_sim.py measured them): pachinko pays about 0.94 per ball at the
 * nails' sweet spot (0.81 off it), pachislot 0.970 per game; a session is at most 400 balls / 40 games (≈ 60 s).
 */
import type { Rng } from '../rng';

export type MachineKind = 'pachinko' | 'pachislot';

/** 10 點券 buy 250 balls / 50 medals; at most 5 buys a visit (§7.1). */
export const BUY_POINTS = 10;
export const BALLS_PER_BUY = 250;
export const MEDALS_PER_BUY = 50;
export const MAX_BUYS = 5;
/** Value at the exchange counter: 25 balls or 5 medals are worth 1 點券 (§7.4). */
export const BALLS_PER_POINT = 25;
export const MEDALS_PER_POINT = 5;
/** Cash for 1 點券 of value: 200 元 × the price index (§7.4). */
export const CASH_PER_POINT = 200;

const p = (rng: Rng) => rng.rand() / 32768;

// ------------------------------------------------------------------ pachinko (§7.2)

export const PACHI = { hit: 1 / 60, payout: 190, kakuhen: 0.5, jitan: 30, cap: 400, prize: 3 };

/** The start pocket's chance for one ball by launch strength (0..100) against the machine's sweet spot. */
export function startChance(strength: number, sweet: number): number {
  const d = Math.abs(strength - sweet);
  return d <= 5 ? 0.07 : d <= 12 ? 0.06 : 0.03;
}

/** One pachinko machine for one visit: the sweet spot of its nails and the ball count. */
export class Pachinko {
  balls = 0;
  bought = 0;
  fired = 0;
  spins = 0;
  firstHits = 0;
  hits = 0;
  /** 確變 / 時短 after the last hit (the screen's mode lamp). */
  mode: 'normal' | 'kakuhen' | 'jitan' = 'normal';
  readonly sweet: number;

  /** `hit`: the 大當たり chance (news 「新機上市」 makes it 1/40 for three days). */
  constructor(readonly rng: Rng, readonly maxBuys: number, readonly hit = PACHI.hit) {
    this.sweet = 55 + rng.below(21);
  }

  get done(): boolean { return this.fired >= PACHI.cap || (this.balls === 0 && this.bought >= this.maxBuys); }

  /** Buys 250 more balls (10 點券); false when the visit's buys are used up. */
  buy(): boolean {
    if (this.bought >= this.maxBuys) return false;
    this.bought += 1; this.balls += BALLS_PER_BUY;
    return true;
  }

  /**
   * Fires one ball at `strength`. Returns what happened: 'out' (lost), 'start' (into the start pocket: 3 balls back and
   * a reel spin that missed), or 'hit' with the chain (each 大當たり pays 190 balls; 確變 continues for sure, 時短 30
   * more spins at 1/60).
   */
  fire(strength: number): { kind: 'none' | 'out' | 'start' | 'hit'; chain: ('kakuhen' | 'jitan' | 'end')[]; reach: boolean } {
    if (this.done) return { kind: 'none', chain: [], reach: false };
    if (this.balls === 0 && !this.buy()) return { kind: 'none', chain: [], reach: false };
    this.balls -= 1; this.fired += 1;
    if (p(this.rng) >= startChance(strength, this.sweet)) return { kind: 'out', chain: [], reach: false };
    this.balls += PACHI.prize; this.spins += 1;
    if (p(this.rng) >= this.hit) return { kind: 'start', chain: [], reach: this.rng.below(8) === 0 };
    this.firstHits += 1;
    const chain: ('kakuhen' | 'jitan' | 'end')[] = [];
    for (;;) {
      this.hits += 1; this.balls += PACHI.payout;
      if (p(this.rng) < PACHI.kakuhen) { chain.push('kakuhen'); this.mode = 'kakuhen'; continue; }
      let again = false;
      for (let i = 0; i < PACHI.jitan; i++) if (p(this.rng) < this.hit) { again = true; break; }
      if (again) { chain.push('jitan'); this.mode = 'jitan'; continue; }
      chain.push('end'); this.mode = 'normal';
      break;
    }
    return { kind: 'hit', chain, reach: true };
  }
}

// ------------------------------------------------------------------ pachislot (§7.3)

export type Role = 'none' | 'replay' | 'bell' | 'cherry' | 'suika' | 'BIG' | 'REG';
export const SLOT_TABLE: { role: Role; p: number; pay: number }[] = [
  { role: 'replay', p: 1 / 7.3, pay: 3 }, { role: 'bell', p: 1 / 8, pay: 7 }, { role: 'cherry', p: 1 / 40, pay: 4 },
  { role: 'suika', p: 1 / 80, pay: 6 }, { role: 'BIG', p: 1 / 150, pay: 180 }, { role: 'REG', p: 1 / 300, pay: 75 },
];
export const SLOT_CAP = 40;
export const SLOT_BET = 3;

/** One pachislot machine for one visit. A bonus that was not lined up is kept for the next game (持ち越し). */
export class Pachislot {
  medals = 0;
  bought = 0;
  games = 0;
  big = 0;
  reg = 0;
  /** A bonus flag waiting to be lined up (light 目押し: the human stops the reels near the 7s). */
  pending: Role | null = null;

  /** `big`: the BIG chance (news 「全台設定6」 makes it 1/100 for three days). */
  constructor(readonly rng: Rng, readonly maxBuys: number, readonly bigChance = 1 / 150) {}

  get done(): boolean { return this.games >= SLOT_CAP || (this.medals < SLOT_BET && this.bought >= this.maxBuys); }

  buy(): boolean {
    if (this.bought >= this.maxBuys) return false;
    this.bought += 1; this.medals += MEDALS_PER_BUY;
    return true;
  }

  /** Starts a game: the internal lottery (the stops only line it up). Returns the role drawn, or null when it cannot. */
  start(): Role | null {
    if (this.done) return null;
    if (this.medals < SLOT_BET && !this.buy()) return null;
    this.medals -= SLOT_BET; this.games += 1;
    if (this.pending) return this.pending;
    const r = p(this.rng);
    let acc = 0;
    for (const e of SLOT_TABLE) { acc += e.role === 'BIG' ? this.bigChance : e.p; if (r < acc) { if (e.role === 'BIG' || e.role === 'REG') this.pending = e.role; return e.role; } }
    return 'none';
  }

  /** Ends the game: `lined` whether a pending bonus was lined up (always for the computer). Returns the medals paid. */
  settle(role: Role, lined = true): number {
    if (role === 'BIG' || role === 'REG') {
      if (!lined) return 0;
      this.pending = null;
      if (role === 'BIG') this.big += 1; else this.reg += 1;
    }
    const pay = SLOT_TABLE.find(e => e.role === role)?.pay ?? 0;
    this.medals += pay;
    return pay;
  }
}

// ------------------------------------------------------------------ the computer (§7.6)

/** What a computer's instant session came to (the result notice). */
export interface SessionResult {
  kind: MachineKind;
  buys: number;
  /** Balls / medals at the end (before the exchange). */
  left: number;
  /** pachinko: first hits and all hits; pachislot: BIG and REG. */
  a: number;
  b: number;
  /** Balls fired / games played. */
  played: number;
}

/**
 * A computer at a machine (§7.6): at most `buys` buys, the sweet spot / every bonus lined up; 收手 after a hit or a
 * bonus once 1.5× ahead of what it bought.
 */
export function aiSession(rng: Rng, kind: MachineKind, buys: number, boost = false): SessionResult {
  if (kind === 'pachinko') {
    const m = new Pachinko(rng, buys, boost ? 1 / 40 : PACHI.hit);
    m.buy();
    while (!m.done) {
      const r = m.fire(m.sweet);
      if (r.kind === 'none') break;
      if (r.kind === 'hit' && m.balls >= m.bought * BALLS_PER_BUY * 1.5) break;
    }
    return { kind, buys: m.bought, left: m.balls, a: m.firstHits, b: m.hits, played: m.fired };
  }
  const m = new Pachislot(rng, buys, boost ? 1 / 100 : 1 / 150);
  m.buy();
  while (!m.done) {
    const role = m.start();
    if (!role) break;
    m.settle(role, true);
    if ((role === 'BIG' || role === 'REG') && m.medals >= m.bought * MEDALS_PER_BUY * 1.5) break;
  }
  return { kind, buys: m.bought, left: m.medals, a: m.big, b: m.reg, played: m.games };
}

/** 點券 of value of what is left (the counter's unit), and the odd balls / medals (端玉: candy). */
export function prizeValue(kind: MachineKind, left: number): { points: number; odd: number } {
  const per = kind === 'pachinko' ? BALLS_PER_POINT : MEDALS_PER_POINT;
  return { points: Math.floor(left / per), odd: left % per };
}
