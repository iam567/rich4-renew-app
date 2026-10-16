/**
 * The original's C runtime rand() (docs/rules/01 §5.1, 07 "随机数"): state = state × 1103515245 + 12345,
 * result = (state >> 16) & 0x7fff, so 0..32767.
 *
 * The original reseeds from GetTickCount() every game day, which makes a game impossible to replay.
 * The remake reseeds from the game seed and the day number instead: same rules, reproducible games.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 0..32767, like rand(). */
  rand(): number {
    this.state = (Math.imul(this.state, 1103515245) + 12345) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }

  /** rand() % n, the original's way of picking among n options (keeps its slight modulo bias). */
  below(n: number): number {
    return this.rand() % n;
  }

  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  /** Internal state, for saving a game. */
  get seed(): number {
    return this.state;
  }
}

/** Deterministic daily seed: mixes the game seed and the day count (splitmix32-style). */
export function daySeed(gameSeed: number, day: number): number {
  let z = (gameSeed + Math.imul(day + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}
