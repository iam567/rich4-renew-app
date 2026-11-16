/**
 * 重慶's 麻將館 聽牌 puzzle (docs/rules/33 §6.1): a 13-tile hand that is one tile from winning, and 8 candidate tiles of
 * which the waits are the right ones. Standard winning hands only (four sets and a pair; no seven pairs, no 十三么).
 *
 * Tiles are 0..26: 萬 1–9 (0..8), 條 1–9 (9..17), 筒 1–9 (18..26). A hand is made by building a whole winning hand of
 * 14 and taking one tile out (so it always waits on something), then kept only when its waits fit the level:
 *   1: two suits, 1 wait   2: two suits, 1–2 waits   3: two suits, 2 waits   4: 清一色, 2–3 waits   5: 清一色, 3+ waits
 */
import type { Rng } from '../rng';

export const TILE_IDS = [...'123456789'].map(n => `m${n}`).concat([...'123456789'].map(n => `s${n}`), [...'123456789'].map(n => `p${n}`));

export interface MjPuzzle { hand: number[]; waits: number[]; choices: number[] }

/** Whether 14 tiles (counts by kind) split into four sets and a pair. */
function complete(c: number[]): boolean {
  for (let i = 0; i < 27; i++) {
    if (c[i] < 2) continue;
    c[i] -= 2;
    const ok = sets(c);
    c[i] += 2;
    if (ok) return true;
  }
  return false;
}

function sets(c: number[]): boolean {
  const i = c.findIndex(n => n > 0);
  if (i < 0) return true;
  if (c[i] >= 3) { c[i] -= 3; const ok = sets(c); c[i] += 3; if (ok) return true; }
  if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    const ok = sets(c);
    c[i]++; c[i + 1]++; c[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/** The tiles that complete a 13-tile hand (a fifth copy cannot be drawn). */
export function waitsOf(hand: number[]): number[] {
  const c = new Array(27).fill(0);
  for (const t of hand) c[t]++;
  const out: number[] = [];
  for (let t = 0; t < 27; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    if (complete(c)) out.push(t);
    c[t]--;
  }
  return out;
}

const WANT: Record<number, [number, number]> = { 1: [1, 1], 2: [1, 2], 3: [2, 2], 4: [2, 3], 5: [3, 9] };

/** A puzzle for a 麻將館 of `level` (1..5). */
export function makePuzzle(r: Rng, level: number): MjPuzzle {
  const lv = Math.max(1, Math.min(5, level));
  const [lo, hi] = WANT[lv];
  const pure = lv >= 4;
  let best: MjPuzzle | null = null;
  for (let tries = 0; tries < 4000; tries++) {
    const suitA = r.below(3), suitB = (suitA + 1 + r.below(2)) % 3;
    const suit = () => (pure || r.below(2) === 0 ? suitA : suitB) * 9;
    const c = new Array(27).fill(0);
    const put = (t: number, n = 1) => { if (c[t] + n > 4) return false; c[t] += n; return true; };
    let ok = true;
    // four sets (runs more often: harder to read) and a pair
    for (let k = 0; k < 4 && ok; k++) {
      const s = suit();
      if (r.below(10) < 7) { const v = r.below(7); ok = put(s + v) && put(s + v + 1) && put(s + v + 2); }
      else ok = put(s + r.below(9), 3);
    }
    if (ok) { const s = suit(); ok = put(s + r.below(9), 2); }
    if (!ok) continue;
    const tiles: number[] = [];
    for (let t = 0; t < 27; t++) for (let n = 0; n < c[t]; n++) tiles.push(t);
    tiles.splice(r.below(tiles.length), 1);
    if (!pure && new Set(tiles.map(t => Math.floor(t / 9))).size < 2) continue;
    const waits = waitsOf(tiles);
    if (waits.length < lo || waits.length > hi || waits.length > 6) continue;
    best = { hand: tiles, waits, choices: [] };
    break;
  }
  if (!best) {   // never in practice: a fixed 清一色 hand waiting on 1-4-7
    best = { hand: [1, 2, 3, 3, 4, 5, 5, 6, 7, 8, 8, 9, 9].map(v => v - 1), waits: [], choices: [] };
    best.waits = waitsOf(best.hand);
  }
  // 8 candidates: every wait, the rest traps of the hand's own suits, near its tiles (they look right)
  const suits = [...new Set(best.hand.map(t => Math.floor(t / 9)))];
  const traps: number[] = [];
  for (const s of suits) for (let v = 0; v < 9; v++) { const t = s * 9 + v; if (!best.waits.includes(t)) traps.push(t); }
  const pool: number[] = [];
  while (pool.length < 8 - best.waits.length && traps.length) pool.push(traps.splice(r.below(traps.length), 1)[0]);
  const choices = [...best.waits, ...pool];
  for (let i = choices.length - 1; i > 0; i--) { const j = r.below(i + 1); [choices[i], choices[j]] = [choices[j], choices[i]]; }
  best.choices = choices;
  best.hand.sort((a, b) => a - b);
  return best;
}

/**
 * How a player did (§6.1): 1, 2 级 one right tile picked is right; from level 3 every wait and nothing else. 'right'
 * pays half, 'part' (some wait picked, not all, or a wrong one too) the toll, 'wrong' (no wait picked, or time out)
 * double.
 */
export function judge(level: number, waits: number[], picked: number[]): 'right' | 'part' | 'wrong' {
  const hit = picked.filter(t => waits.includes(t)).length, miss = picked.length - hit;
  if (!hit) return 'wrong';
  if (level <= 2) return 'right';
  return hit === waits.length && !miss ? 'right' : 'part';
}
