/**
 * The wealth / poverty gods' slot machine (拉霸), docs/rules/06 §5.7: `fcn_00440706(type − 1)` sets up the
 * screen and `fcn_0043f23e((type − 1 & 1) ^ 1)` runs it (rich4.asm:19522-19950). This file replays that loop
 * frame by frame, so the amount, and the number of rand() calls it makes, are the original's.
 *
 * The loop runs one frame per ≥ 30 ms (timeGetTime). Four reel positions 0..19 live at 0x48c504 (position 2k
 * shows digit k centred, odd positions are half-way between two digits). States (esi):
 *   1 spinning: every 10th frame all four positions are re-drawn as rand() % 10 × 2 + 1; every frame each
 *     spinning reel moves on one position. A human's click / key release (WM_LBUTTONUP, WM_RBUTTONUP,
 *     WM_KEYUP) ends it; for a computer, an autopilot human or a sleepwalker (current player +21 > 1 or
 *     +55 ≠ 0) it ends by itself when the frame counter reaches 40.
 *   2 lever pulled (Panel#67.3, sound UI[1] = Effect#1); the counter restarts. No more re-draws from here.
 *   3 four frames, then the lever goes back up (#67.2).
 *   4..7 the reels stop one by one from the right (`fcn_0043ef3e(n, mask, k)`): reel 4 − k starts slowing
 *     down on the first frame its position is odd, then moves one more position after 1, 2, … 7 frames and
 *     stays on the even position it reaches.
 *   8 result: the loop sound (Effect#51) stops, the message box shows "%d元"; the counter restarts.
 *   9 40 more frames, then the screen closes.
 * The small gods (types 1 and 5) use three reels (1..3: hundreds, tens, ones, 0..999); the big ones (2 and 6)
 * four (0..3, thousands first, 0..9999). Reel 0 is re-drawn (rand() is called four times) even when unused.
 */

/** Frames per second of the original loop: one frame per ≥ 30 ms. */
export const SLOT_FRAME_MS = 30;
/** Frame in which a computer pulls the lever: the counter reaches 40 during frame 39 (frames count from 0). */
export const SLOT_AUTO_PULL = 39;
/** Frames the result stays up (state 9). */
export const SLOT_RESULT_FRAMES = 40;

export interface SlotRun {
  /** Four reels (big gods) or three. */
  big: boolean;
  /** Frame in which the lever was pulled (state 2). */
  pull: number;
  /** Reel positions 0..19 of reels 0..3 after each frame was drawn, frame 0 .. `end`. */
  reels: number[][];
  /** Frame in which the lever goes back up. */
  leverUp: number;
  /** Frame in which reel i (0..3) came to rest; -1 for reel 0 of a three-reel machine. */
  stopped: number[];
  /** Frame in which the amount is shown (state 8). */
  result: number;
  /** Last frame (state 9 ends). */
  end: number;
  /** Digits shown, reels 0..3 (reel 0 only counts for the big gods). */
  digits: number[];
  amount: number;
  /** rand() calls made. */
  randCalls: number;
}

/**
 * Runs `fcn_0043f23e`. `pull` is the frame in which the lever is pulled: SLOT_AUTO_PULL for a computer, else the
 * frame after the one during which the human tapped (≥ 1). `rand` is the game's rand().
 */
export function runSlotMachine(rand: () => number, big: boolean, pull: number = SLOT_AUTO_PULL): SlotRun {
  pull = Number.isFinite(pull) ? Math.max(1, Math.floor(pull)) : SLOT_AUTO_PULL;
  const first = big ? 0 : 1; // fcn_0043ef3e's edi: the leftmost reel drawn
  const pos = [0, 0, 0, 0];
  // The slow-down counters 0x475d5c / 0x475d5d and the reel being stopped 0x475d5e (statics in the original; they
  // are back to 0 / 0 after every run and 0x475d5e never equals the first reel asked for, so a run starts clean).
  let slow = 0, tick = 0, stopping = 0;
  let calls = 0;
  /** fcn_0043ef3e(first, mask, k): draws the reels in `mask`; k ≠ 0 slows reel 4 − k down. True once it rests. */
  const draw = (mask: number, k: number): boolean => {
    if (k) {
      let go = slow !== 0;
      if (stopping !== k && pos[4 - k] & 1) { slow = 1; tick = 0; stopping = k; go = true; }
      if (go) {
        if (slow <= tick) { tick = 0; slow++; }
        tick++;
      }
    }
    for (let r = 3, bit = 1; r >= first; r--, bit <<= 1) {
      if (!(mask & bit)) continue;
      if (4 - r === k && slow > tick) continue;
      pos[r] = pos[r] + 1 >= 20 ? 0 : pos[r] + 1;
    }
    if (slow === 8) { slow = 0; tick = 0; return true; }
    return false;
  };

  const reels: number[][] = [];
  const stopped = [-1, -1, -1, -1];
  let state = 1, count = 0, leverUp = -1, result = -1, amount = 0;
  for (let f = 0; ; f++) {
    if (state < 3 && count % 10 === 0) {
      for (let r = 0; r < 4; r++) { pos[r] = (rand() % 10) * 2 + 1; calls++; }
    }
    count++;
    if (state === 1 && f >= pull) state = 2;
    switch (state) {
      case 1: draw(15, 0); break;
      case 2: draw(15, 0); state = 3; count = 0; break;
      case 3: draw(15, 0); if (count === 4) { state = 4; leverUp = f; } break;
      case 4: if (draw(15, 1)) { state = 5; stopped[3] = f; } break;
      case 5: if (draw(14, 2)) { state = 6; stopped[2] = f; } break;
      case 6: if (draw(12, 3)) { state = big ? 7 : 8; stopped[1] = f; } break;
      case 7: if (draw(8, 4)) { state = 8; stopped[0] = f; } break;
      case 8:
        amount = (pos[2] >> 1) * 10 + (pos[3] >> 1) + (pos[1] >> 1) * 100 + (big ? (pos[0] >> 1) * 1000 : 0);
        state = 9; count = 0; result = f;
        break;
      case 9: if (count === SLOT_RESULT_FRAMES) state = 10; break;
    }
    reels.push([...pos]);
    if (state >= 10) {
      return { big, pull, reels, leverUp, stopped, result, end: f, digits: pos.map(p => p >> 1), amount, randCalls: calls };
    }
  }
}

/**
 * The remake's house rule (not in the original): all reels showing the same digit (豹子, e.g. 333 or 6666) double
 * the amount, all sevens (777 / 7777) triple it — for the wealth gods' gift and the poverty gods' payment alike.
 */
export function slotBonus(digits: number[]): number {
  if (digits.length < 2 || digits.some(d => d !== digits[0])) return 1;
  return digits[0] === 7 ? 3 : 2;
}
