/**
 * 大富翁城's casino games (docs/rules/19 §5, a remake addition for the finale of 大富豪模式): 輪盤 (European roulette),
 * 21點 (blackjack), 百家樂 (baccarat) and 德州撲克 (heads-up Texas hold'em against the banker), in simple standard
 * rules, and the computers' play. Pure functions over a random stream: the finale gives each visit its own stream
 * (core/finale.ts), so a visit plays the same however it is watched.
 *
 * Cards are numbers 0..51: rank = c % 13 (0 = 2 … 8 = 10, 9 = J, 10 = Q, 11 = K, 12 = A), suit = c / 13 (♠ ♥ ♦ ♣).
 * Each deal shuffles one fresh 52-card deck (Fisher–Yates with rand() % n).
 */
import type { Rng } from '../rng';

export type CasinoGame = 'roulette' | 'blackjack' | 'baccarat' | 'holdem' | 'sicbo';
export const CASINO_GAMES: CasinoGame[] = ['roulette', 'blackjack', 'baccarat', 'holdem', 'sicbo'];
export const GAME_NAMES: Record<CasinoGame, string> = { roulette: '輪盤', blackjack: '21點', baccarat: '百家樂', holdem: '德州撲克', sicbo: '骰寶' };

export const rank = (c: number) => c % 13;
export const suit = (c: number) => Math.floor(c / 13);
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];
export const cardText = (c: number) => `${SUITS[suit(c)]}${RANKS[rank(c)]}`;

/** A fresh shuffled deck (Fisher–Yates, rand() % n). */
export function deck(rng: Rng): number[] {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = rng.below(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

// ================================================================== 輪盤 roulette (European, one zero)

/** Red numbers of the European wheel. */
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
/** The wheel's pockets clockwise from 0 (for the screen). */
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

/**
 * A roulette bet: 'red' | 'black' | 'odd' | 'even' | 'low' (1–18) | 'high' (19–36) pay 1:1, 'dozen' (n = 1..3: 1–12,
 * 13–24, 25–36) pays 2:1, 'number' (n = 0..36) pays 35:1. Zero loses every outside bet.
 */
export type RouletteBet = { kind: 'red' | 'black' | 'odd' | 'even' | 'low' | 'high' } | { kind: 'dozen'; n: number } | { kind: 'number'; n: number };
export const BET_NAMES: Record<RouletteBet['kind'], string> = { red: '紅', black: '黑', odd: '單', even: '雙', low: '小(1–18)', high: '大(19–36)', dozen: '打', number: '單號' };

export function rouletteOdds(bet: RouletteBet): number {
  return bet.kind === 'number' ? 35 : bet.kind === 'dozen' ? 2 : 1;
}

export function rouletteWins(bet: RouletteBet, n: number): boolean {
  if (bet.kind === 'number') return n === bet.n;
  if (n === 0) return false;
  switch (bet.kind) {
    case 'red': return RED.has(n);
    case 'black': return !RED.has(n);
    case 'odd': return n % 2 === 1;
    case 'even': return n % 2 === 0;
    case 'low': return n <= 18;
    case 'high': return n >= 19;
    case 'dozen': return Math.ceil(n / 12) === bet.n;
  }
}

export interface RouletteResult { game: 'roulette'; bet: RouletteBet; number: number; win: boolean; net: number }

/** One spin: the pocket is rand() % 37. `net` before the casino's cap. */
export function playRoulette(rng: Rng, stake: number, bet: RouletteBet): RouletteResult {
  const number = rng.below(37);
  const win = rouletteWins(bet, number);
  return { game: 'roulette', bet, number, win, net: win ? stake * rouletteOdds(bet) : -stake };
}

// ================================================================== 21點 blackjack

/** Hand value: aces count 11 while that does not bust; `soft` when an ace still counts 11. */
export function bjValue(hand: number[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of hand) {
    const r = rank(c);
    if (r === 12) { aces++; total += 11; } else total += r >= 8 ? 10 : r + 2;
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
export const isBlackjack = (hand: number[]) => hand.length === 2 && bjValue(hand).total === 21;

export type BjMove = 'hit' | 'stand' | 'double';

/**
 * Basic strategy for one deck, dealer stands on soft 17, no split (19 §6): hard 11 doubles; 10 doubles against
 * 2–9; 9 against 3–6; soft 13–18 double against 5–6 (soft 17–18 also against 3–4); soft 18 stands against 2–8;
 * hard 12 stands against 4–6, 13–16 against 2–6; 17 and more stand. A double only on the first two cards.
 */
export function bjBasic(hand: number[], up: number): BjMove {
  const { total, soft } = bjValue(hand);
  const d = bjValue([up]).total;           // 2..11
  const first = hand.length === 2;
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) return first && d >= 3 && d <= 6 ? 'double' : d <= 8 ? 'stand' : 'hit';
    if (first && total === 17 && d >= 3 && d <= 6) return 'double';
    if (first && total >= 13 && d >= 5 && d <= 6) return 'double';
    return 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return d <= 6 ? 'stand' : 'hit';
  if (total === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
  if (total === 11) return first ? 'double' : 'hit';
  if (total === 10) return first && d <= 9 ? 'double' : 'hit';
  if (total === 9) return first && d >= 3 && d <= 6 ? 'double' : 'hit';
  return 'hit';
}

export interface BjTable { deck: number[]; player: number[]; dealer: number[]; doubled: boolean; done: boolean }

/** The deal: player, dealer, player, dealer (the dealer's second card is the hole card). */
export function bjDeal(rng: Rng): BjTable {
  const d = deck(rng);
  const t: BjTable = { deck: d, player: [], dealer: [], doubled: false, done: false };
  t.player.push(d.pop()!); t.dealer.push(d.pop()!); t.player.push(d.pop()!); t.dealer.push(d.pop()!);
  // A natural on either side ends the hand at once.
  if (isBlackjack(t.player) || isBlackjack(t.dealer)) t.done = true;
  return t;
}

/** One move of the player; the hand is done on stand, double (one card) or 21 / bust. */
export function bjMove(t: BjTable, move: BjMove): void {
  if (t.done) return;
  if (move === 'double' && t.player.length !== 2) move = 'hit';
  if (move === 'stand') { t.done = true; return; }
  t.player.push(t.deck.pop()!);
  if (move === 'double') { t.doubled = true; t.done = true; return; }
  if (bjValue(t.player).total >= 21) t.done = true;
}

export interface BlackjackResult {
  game: 'blackjack'; player: number[]; dealer: number[]; doubled: boolean; moves: BjMove[];
  outcome: 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'dealer-blackjack'; net: number;
}

/**
 * The dealer draws to 17 (stands on soft 17), then the hand is settled: a natural pays 3:2, a double risks 2×.
 * `extra` is what the double adds (the stake; less when the visitor cannot cover it: doubling for less, 19 §5.1).
 */
export function bjSettle(t: BjTable, stake: number, moves: BjMove[], extra = stake): BlackjackResult {
  const pv = bjValue(t.player).total, bet = t.doubled ? stake + extra : stake;
  const res = (outcome: BlackjackResult['outcome'], net: number): BlackjackResult =>
    ({ game: 'blackjack', player: [...t.player], dealer: [...t.dealer], doubled: t.doubled, moves, outcome, net });
  const pBJ = isBlackjack(t.player), dBJ = isBlackjack(t.dealer);
  if (pBJ || dBJ) return pBJ && dBJ ? res('push', 0) : pBJ ? res('blackjack', Math.trunc(stake * 1.5)) : res('dealer-blackjack', -stake);
  if (pv > 21) return res('bust', -bet);
  while (bjValue(t.dealer).total < 17) t.dealer.push(t.deck.pop()!);
  const dv = bjValue(t.dealer).total;
  if (dv > 21 || pv > dv) return res('win', bet);
  if (pv === dv) return res('push', 0);
  return res('lose', -bet);
}

// ================================================================== 百家樂 baccarat

export type BaccaratBet = 'player' | 'banker' | 'tie';
export const BACCARAT_NAMES: Record<BaccaratBet, string> = { player: '閒', banker: '莊', tie: '和' };
const bacPoint = (c: number) => { const r = rank(c); return r >= 8 && r <= 11 ? 0 : r === 12 ? 1 : r + 2; };
export const bacTotal = (hand: number[]) => hand.reduce((s, c) => s + bacPoint(c), 0) % 10;

export interface BaccaratResult {
  game: 'baccarat'; bet: BaccaratBet; player: number[]; banker: number[]; pt: number; bt: number;
  winner: BaccaratBet; net: number;
}

/**
 * The standard tableau: two cards each (player, banker, player, banker); a natural 8 or 9 stops; the player draws on
 * 0–5; the banker without a player's third card draws on 0–5, else by the usual table (3: not on an 8; 4: on 2–7;
 * 5: on 4–7; 6: on 6–7; 7: stands; 0–2 draws). Player and banker bets pay 1:1 (the banker bet less a 5% commission,
 * rounded down), a tie pays 8:1 and pushes the player and banker bets.
 */
export function playBaccarat(rng: Rng, stake: number, bet: BaccaratBet): BaccaratResult {
  const d = deck(rng);
  const P = [d.pop()!], B = [d.pop()!];
  P.push(d.pop()!); B.push(d.pop()!);
  let pt = bacTotal(P), bt = bacTotal(B);
  if (pt < 8 && bt < 8) {
    let third = -1;
    if (pt <= 5) { third = d.pop()!; P.push(third); pt = bacTotal(P); }
    let draw: boolean;
    if (third < 0) draw = bt <= 5;
    else {
      const t = bacPoint(third);
      draw = bt <= 2 || (bt === 3 && t !== 8) || (bt === 4 && t >= 2 && t <= 7) || (bt === 5 && t >= 4 && t <= 7) || (bt === 6 && (t === 6 || t === 7));
    }
    if (draw) { B.push(d.pop()!); bt = bacTotal(B); }
  }
  const winner: BaccaratBet = pt > bt ? 'player' : bt > pt ? 'banker' : 'tie';
  let net: number;
  if (winner === 'tie') net = bet === 'tie' ? stake * 8 : 0;
  else if (bet === winner) net = bet === 'banker' ? Math.trunc(stake * 0.95) : stake;
  else net = -stake;
  return { game: 'baccarat', bet, player: P, banker: B, pt, bt, winner, net };
}

// ================================================================== 德州撲克 heads-up hold'em

export const HAND_NAMES = ['高牌', '一對', '兩對', '三條', '順子', '同花', '葫蘆', '四條', '同花順'];

/** Best five of the cards as a comparable score [category, tie-breaks…] and the five cards. */
export function bestHand(cards: number[]): { score: number[]; five: number[]; name: string } {
  let best: { score: number[]; five: number[] } | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const five = cards.filter((_, i) => i !== a && i !== b);
    if (five.length !== 5) continue;
    const score = scoreFive(five);
    if (!best || compare(score, best.score) > 0) best = { score, five };
  }
  if (!best) { const five = cards.slice(0, 5); best = { score: scoreFive(five), five }; }
  return { ...best, name: HAND_NAMES[best.score[0]] };
}

export function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? -1) - (b[i] ?? -1); if (d) return d; }
  return 0;
}

function scoreFive(five: number[]): number[] {
  const rs = five.map(rank).sort((x, y) => y - x);
  const flush = five.every(c => suit(c) === suit(five[0]));
  const uniq = [...new Set(rs)];
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (rs[0] - rs[4] === 4) straightHigh = rs[0];
    else if (rs[0] === 12 && rs[1] === 3) straightHigh = 3;         // A-2-3-4-5
  }
  const counts = new Map<number, number>();
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0]);
  const order = groups.map(g => g[0]);
  if (straightHigh >= 0 && flush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, ...order];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...order];
  if (flush) return [5, ...rs];
  if (straightHigh >= 0) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, ...order];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...order];
  if (groups[0][1] === 2) return [1, ...order];
  return [0, ...rs];
}

export interface HoldemTable { deck: number[]; hole: number[]; dealer: number[]; board: number[] }

/** Two cards each (player, dealer, player, dealer) and the flop. */
export function holdemDeal(rng: Rng): HoldemTable {
  const d = deck(rng);
  const t: HoldemTable = { deck: d, hole: [], dealer: [], board: [] };
  t.hole.push(d.pop()!); t.dealer.push(d.pop()!); t.hole.push(d.pop()!); t.dealer.push(d.pop()!);
  t.board.push(d.pop()!, d.pop()!, d.pop()!);
  return t;
}

/**
 * The computer's call after the flop (19 §6): it calls with any pair or better, a four-card flush or straight draw,
 * or a hole card of J or higher; it folds the rest (mostly weak unpaired hands).
 */
export function holdemCall(t: HoldemTable): boolean {
  const all = [...t.hole, ...t.board];
  if (bestHand(all).score[0] >= 1) return true;
  const suits = [0, 0, 0, 0];
  for (const c of all) suits[suit(c)]++;
  if (suits.some(s => s >= 4)) return true;
  const rs = new Set(all.map(rank));
  if (rs.has(12)) rs.add(-1);
  for (let lo = -1; lo <= 8; lo++) { let k = 0; for (let r = lo; r < lo + 5; r++) if (rs.has(r)) k++; if (k >= 4) return true; }
  return t.hole.some(c => rank(c) >= 9);
}

export interface HoldemResult {
  game: 'holdem'; hole: number[]; dealer: number[]; board: number[]; called: boolean;
  outcome: 'fold' | 'win' | 'lose' | 'push'; playerHand: string; dealerHand: string; net: number;
}

/**
 * Settles the hand: a fold loses the ante; a call puts in a second stake, the turn and the river come, and the
 * better five of seven wins both stakes 1:1 (a tie pushes). No qualifying hand for the banker (simple rules).
 * `extra` is the call (the stake; less when the visitor cannot cover it — all-in for the rest, 19 §5.1).
 */
export function holdemSettle(t: HoldemTable, stake: number, called: boolean, extra = stake): HoldemResult {
  if (!called) return { game: 'holdem', hole: t.hole, dealer: t.dealer, board: t.board, called, outcome: 'fold', playerHand: '', dealerHand: '', net: -stake };
  t.board.push(t.deck.pop()!, t.deck.pop()!);
  const p = bestHand([...t.hole, ...t.board]), d = bestHand([...t.dealer, ...t.board]);
  const c = compare(p.score, d.score);
  const outcome = c > 0 ? 'win' : c < 0 ? 'lose' : 'push';
  return { game: 'holdem', hole: t.hole, dealer: t.dealer, board: t.board, called, outcome, playerHand: p.name, dealerHand: d.name, net: outcome === 'win' ? stake + extra : outcome === 'lose' ? -(stake + extra) : 0 };
}

// ================================================================== 骰寶 sic bo (比大小)

export type SicboBet = 'big' | 'small';
export const SICBO_NAMES: Record<SicboBet, string> = { big: '大', small: '小' };
export interface SicboResult { game: 'sicbo'; bet: SicboBet; dice: number[]; total: number; triple: boolean; win: boolean; net: number }

/** Three dice in the cup (rand() % 6 + 1 each): 大 is 11–17, 小 4–10, 1:1; any triple (豹子) loses both. */
export function playSicbo(rng: Rng, stake: number, bet: SicboBet): SicboResult {
  const dice = [rng.below(6) + 1, rng.below(6) + 1, rng.below(6) + 1];
  const total = dice[0] + dice[1] + dice[2], triple = dice[0] === dice[1] && dice[1] === dice[2];
  const win = !triple && (bet === 'big' ? total >= 11 : total <= 10);
  return { game: 'sicbo', bet, dice, total, triple, win, net: win ? stake : -stake };
}

export type CasinoResult = RouletteResult | BlackjackResult | BaccaratResult | HoldemResult | SicboResult;

// ================================================================== the banker's big hands (19 §5.2)

/**
 * The banker's multiplier on what the visitor loses (no cap): 21點 dealer blackjack ×2, dealer 五小龍 (five cards,
 * not bust) ×3; 百家樂 the winning side's natural 8/9 ×2, its first two cards a pair ×3 (the larger when both);
 * 德州撲克 the dealer winning with 葫蘆 ×2, 四條 ×5, 同花順 ×10, 皇家同花順 all the visitor's money ('all').
 * 輪盤 the zero ×5; 骰寶 any triple ×10, three sixes all the visitor's money. 1 when the visitor did not lose or the hand is ordinary.
 */
export function bankerMultiplier(r: CasinoResult): { mult: number; all: boolean; why: string } {
  const none = { mult: 1, all: false, why: '' };
  if (r.net >= 0) return none;
  if (r.game === 'roulette') return r.number === 0 ? { mult: 5, all: false, why: '0號莊家通吃' } : none;
  if (r.game === 'sicbo') return !r.triple ? none : r.dice[0] === 6 ? { mult: 1, all: true, why: '三個6豹子' } : { mult: 10, all: false, why: `${r.dice[0]}${r.dice[0]}${r.dice[0]}豹子` };
  if (r.game === 'blackjack') {
    if (r.outcome === 'dealer-blackjack') return { mult: 2, all: false, why: '莊家黑傑克' };
    if (r.dealer.length >= 5 && bjValue(r.dealer).total <= 21 && r.outcome === 'lose') return { mult: 3, all: false, why: '莊家五小龍' };
    return none;
  }
  if (r.game === 'baccarat') {
    if (r.winner === 'tie') return none;
    const two = (r.winner === 'player' ? r.player : r.banker).slice(0, 2);
    const pair = rank(two[0]) === rank(two[1]), natural = bacTotal(two) >= 8;
    const side = r.winner === 'player' ? '閒' : '莊';
    return pair ? { mult: 3, all: false, why: `${side}家對子` } : natural ? { mult: 2, all: false, why: `${side}家天生${bacTotal(two)}點` } : none;
  }
  if (r.game === 'holdem') {
    if (r.outcome !== 'lose') return none;
    const best = bestHand([...r.dealer, ...r.board]).score;
    if (best[0] === 8 && best[1] === 12) return { mult: 1, all: true, why: '莊家皇家同花順' };
    if (best[0] === 8) return { mult: 10, all: false, why: '莊家同花順' };
    if (best[0] === 7) return { mult: 5, all: false, why: '莊家四條' };
    if (best[0] === 6) return { mult: 2, all: false, why: '莊家葫蘆' };
    return none;
  }
  return none;
}

/** The multiplier table for the screen (19 §5.2). */
export const BANKER_TABLE: Record<CasinoGame, string> = {
  roulette: '開出 0 號 莊家通吃 ×5',
  blackjack: '莊家黑傑克 ×2・莊家五小龍 ×3',
  baccarat: '贏的一方天生 8/9 點 ×2・前兩張對子 ×3',
  holdem: '莊家葫蘆 ×2・四條 ×5・同花順 ×10・皇家同花順 全部現金',
  sicbo: '豹子（三顆一樣）×10・三個6 全部現金',
};

// ================================================================== words for the screen and the ticker

const ROULETTE_WORDS: Record<RouletteBet['kind'], string> = { red: '紅', black: '黑', odd: '單', even: '雙', low: '小（1–18）', high: '大（19–36）', dozen: '', number: '' };

/** What the visitor bet on: 「押紅」「押 17 號」「押第 2 打」「押莊」「押大」; 21點 and 德州 just 「下注」. */
export function betLabel(r: CasinoResult): string {
  if (r.game === 'roulette') return r.bet.kind === 'number' ? `押 ${r.bet.n} 號` : r.bet.kind === 'dozen' ? `押第 ${r.bet.n} 打` : `押${ROULETTE_WORDS[r.bet.kind]}`;
  if (r.game === 'baccarat') return `押${BACCARAT_NAMES[r.bet]}`;
  if (r.game === 'sicbo') return `押${SICBO_NAMES[r.bet]}`;
  return '下注';
}

/** What happened at the table, before the money: 「開出 紅 23 → 押紅中，1 賠 1」「20 點對莊家 19 點 → 贏，1 賠 1」. */
export function tableLine(r: CasinoResult): string {
  switch (r.game) {
    case 'roulette': {
      const colour = r.number === 0 ? '' : RED.has(r.number) ? '紅 ' : '黑 ';
      return `開出 ${colour}${r.number} → ${betLabel(r)}${r.win ? `中，1 賠 ${rouletteOdds(r.bet)}` : '沒中'}`;
    }
    case 'blackjack': {
      const pv = bjValue(r.player).total, dv = bjValue(r.dealer).total, dbl = r.doubled ? '（加倍）' : '';
      const what = { blackjack: '黑傑克，1 賠 1.5', win: '贏，1 賠 1', push: '平手，退回', lose: '輸', bust: '爆牌，輸', 'dealer-blackjack': '莊家黑傑克，輸' }[r.outcome];
      if (r.outcome === 'bust') return `${pv} 點${dbl} → ${what}`;
      return dv > 21 ? `${pv} 點${dbl}，莊家 ${dv} 點爆牌 → ${what}` : `${pv} 點${dbl}對莊家 ${dv} 點 → ${what}`;
    }
    case 'baccarat': {
      const w = r.winner === 'tie' ? '和局' : `${BACCARAT_NAMES[r.winner]}贏`;
      const hit = r.winner === r.bet ? (r.bet === 'tie' ? '中，1 賠 8' : r.bet === 'banker' ? '中，1 賠 0.95' : '中，1 賠 1') : r.winner === 'tie' ? '退回' : '沒中';
      return `閒 ${r.pt} 點對莊 ${r.bt} 點，${w} → ${betLabel(r)}${hit}`;
    }
    case 'holdem':
      if (!r.called) return '棄牌 → 輸掉底注';
      return `${r.playerHand}對莊家${r.dealerHand} → ${r.outcome === 'win' ? '贏，兩份 1 賠 1' : r.outcome === 'lose' ? '輸兩份' : '平手，退回'}`;
    case 'sicbo':
      return r.triple ? `${r.dice.join('・')} 豹子 → 通殺` : `${r.dice.join('・')} = ${r.total} 點・${r.total >= 11 ? '大' : '小'} → ${betLabel(r)}${r.win ? '中，1 賠 1' : '沒中'}`;
  }
}

/**
 * The visit in one line with the arithmetic (the replay's caption, the ticker): the table, then the money —
 * 「… 贏 2,000（上限 10,000）」「… 莊家同花順 ×10 → 輸 30,000」, a win cut to the cap, a loss cut to what the visitor held.
 */
export function resultLine(r: CasinoResult, d: { net: number; cap: number; mult: number; all: boolean; why: string }, fmt: (n: number) => string, word = '現金'): string {
  const raw = r.net, net = d.net;
  let money: string;
  if (net > 0) money = raw > d.cap ? `贏 ${fmt(raw)}，超過上限以 ${fmt(d.cap)} 計` : `贏 ${fmt(net)}（上限 ${fmt(d.cap)}）`;
  else if (net < 0) {
    const full = d.all ? Infinity : -raw * d.mult;
    const big = d.why ? `${d.why}${d.all ? `：全部${word}` : ` ×${d.mult}`} → ` : '';
    money = `${big}輸 ${fmt(-net)}${!d.all && -net < full ? `（應輸 ${fmt(full)}，只有這些）` : ''}`;
  } else money = raw < 0 ? '輸了但不用付' : '不輸不贏';
  return `${tableLine(r)}，${money}`;
}

// ================================================================== gods at the tables (大富翁城, 19 §5.6)

/** The outcome a god forces on the visitor: 'win' (net > 0) or 'lose' (net < 0); null leaves the table alone. */
export type Rig = 'win' | 'lose' | null;
const fits = (net: number, rig: Rig) => (rig === 'win' ? net > 0 : rig === 'lose' ? net < 0 : true);
const RIG_TRIES = 600;

/**
 * Chances of a plain visit by game and bet (for 小福神 / 小衰神's ×1.5): exact for roulette, 骰寶 and 百家樂;
 * 21點 and 德州撲克 measured with the computers' strategy (400,000 hands each).
 */
export function baseOdds(game: CasinoGame, bet?: unknown): { win: number; lose: number } {
  switch (game) {
    case 'roulette': {
      const b = bet as RouletteBet | undefined, k = !b ? 18 : b.kind === 'number' ? 1 : b.kind === 'dozen' ? 12 : 18;
      return { win: k / 37, lose: 1 - k / 37 };
    }
    case 'sicbo': return { win: 105 / 216, lose: 111 / 216 };
    case 'baccarat': return bet === 'tie' ? { win: 0.0952, lose: 0.9048 } : bet === 'player' ? { win: 0.4462, lose: 0.4586 } : { win: 0.4586, lose: 0.4462 };
    case 'blackjack': return { win: 0.437, lose: 0.479 };
    case 'holdem': return { win: 0.445, lose: 0.523 };
  }
}

/** Plays a non-interactive game again until the god's outcome comes up (what is shown is a real spin / deal / shake). */
export function rigged<R extends { net: number }>(rig: Rig, play: () => R): R {
  let r = play();
  for (let i = 0; rig && !fits(r.net, rig) && i < RIG_TRIES; i++) r = play();
  return r;
}

const shuffle = (rng: Rng, a: number[]) => { for (let i = a.length - 1; i > 0; i--) { const j = rng.below(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** 21點's deal for a god: no dealer natural when it must win, no player natural when it must lose. */
export function bjDealFor(rng: Rng, rig: Rig): BjTable {
  let t = bjDeal(rng);
  for (let i = 0; i < RIG_TRIES; i++) {
    if (rig === 'win' && !isBlackjack(t.dealer)) break;
    if (rig === 'lose' && !isBlackjack(t.player)) break;
    if (!rig) break;
    t = bjDeal(rng);
  }
  return t;
}

/** Before a hit or a double under a god: the next card keeps a winner from busting, a loser from reaching 21. */
export function bjRigDraw(t: BjTable, rig: Rig): void {
  if (!rig || !t.deck.length) return;
  const ok = (c: number) => { const v = bjValue([...t.player, c]).total; return rig === 'win' ? v <= 21 : v !== 21; };
  const i = t.deck.length - 1;
  if (ok(t.deck[i])) return;
  const j = t.deck.findIndex(ok);
  if (j >= 0) [t.deck[i], t.deck[j]] = [t.deck[j], t.deck[i]];
}

/** 21點 settled for a god: the hole card and the dealer's draws (none seen yet) are dealt so the outcome is the god's. */
export function bjSettleFor(t: BjTable, stake: number, moves: BjMove[], extra: number, rig: Rig, rng: Rng): BlackjackResult {
  if (!rig) return bjSettle(t, stake, moves, extra);
  const unseen = [t.dealer[1], ...t.deck];
  let first: BlackjackResult | null = null;
  for (let i = 0; i < RIG_TRIES; i++) {
    const u = i === 0 ? [...unseen] : shuffle(rng, [...unseen]);
    const copy: BjTable = { ...t, dealer: [t.dealer[0], u[0]], deck: u.slice(1), player: [...t.player] };
    const r = bjSettle(copy, stake, moves, extra);
    first ??= r;
    if (fits(r.net, rig)) { Object.assign(t, { dealer: copy.dealer, deck: copy.deck }); return r; }
  }
  return first!;
}

/** 德州撲克's deal for a god: a hand worth calling when it must win (the computers call it; a human sees why). */
export function holdemDealFor(rng: Rng, rig: Rig): HoldemTable {
  let t = holdemDeal(rng);
  for (let i = 0; rig === 'win' && !holdemCall(t) && i < RIG_TRIES; i++) t = holdemDeal(rng);
  return t;
}

/** 德州撲克 settled for a god: the dealer's cards, the turn and the river (none seen yet) dealt for the god's outcome. */
export function holdemSettleFor(t: HoldemTable, stake: number, called: boolean, extra: number, rig: Rig, rng: Rng): HoldemResult {
  if (!rig || !called) return holdemSettle(t, stake, called, extra);
  const unseen = [...t.dealer, ...t.deck];
  let first: HoldemResult | null = null;
  for (let i = 0; i < RIG_TRIES; i++) {
    const u = i === 0 ? [...unseen] : shuffle(rng, [...unseen]);
    const copy: HoldemTable = { hole: [...t.hole], board: [...t.board], dealer: u.slice(0, 2), deck: u.slice(2) };
    const r = holdemSettle(copy, stake, called, extra);
    first ??= r;
    if (fits(r.net, rig)) { Object.assign(t, copy); return r; }
  }
  return first!;
}
