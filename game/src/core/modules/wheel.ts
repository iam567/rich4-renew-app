/**
 * The wheel (转盘) for hotel days, shopping multiplier, travel days and insurance days — docs/rules/02 §4.4,
 * 09 §6.5. `fcn_0044090e(kind, name)` sets up the screen (rich4.asm:21331-21429) and `fcn_0043f7c6(kind)` runs it
 * (rich4.asm:19951-20208). This file replays that loop frame by frame, so the result, and the single rand() call
 * it makes, are the original's.
 *
 * One frame per ≥ 36 ms (timeGetTime). The cell 0..11 lives at 0x48c50c; Panel#(68 + kind) frame cell + 2 shows it
 * (the wheel turns 30° clockwise per cell; the cell under the angel's wand, at about two o'clock, is the result).
 *   start: cell = rand() % 12 (the only rand() call); the loop sound Effect#52 starts.
 *   1 spinning: every frame the wheel moves on one cell (fcn_0043f127(0)). A human's click / key release
 *     (WM_LBUTTONUP, WM_RBUTTONUP, WM_KEYUP) ends it; for a computer, an autopilot human or a sleepwalker (current
 *     player +21 > 1 or +55 ≠ 0) it ends by itself when the frame counter reaches 40 (frame 39 counting from 0).
 *   2 stop pressed: the angel turns to Panel#(68 + kind).1, sound UI[1] = Effect#1; the wheel does not move.
 *   3 slowing down: the wheel moves on one cell after 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4 frames (12 cells, one
 *     full turn), then every 5, 5, 5, 6, 6, 6 … frames until it reaches a numbered cell (not 0xff), and stops
 *     there: the loop sound stops.
 *   5 the result stays up 40 frames (a human's click ends it early), then the screen closes.
 * So the result is the first numbered cell at or after (start + stop) % 12, `stop` being the frame of state 2.
 */

/** One frame of the original loop: ≥ 36 ms (0x24). */
export const WHEEL_FRAME_MS = 36;
/** Frame in which a computer stops the wheel: the counter reaches 40 during frame 39 (frames count from 0). */
export const WHEEL_AUTO_STOP = 39;
/** Frames the result stays up (state 5). */
export const WHEEL_HOLD_FRAMES = 40;

/** What each wheel decides (the `kind` argument). */
export const WheelKind = { travel: 0, hotel: 1, shopping: 2, insurance: 3 } as const;

/** Cells of each wheel, ref_00475d0c (12 bytes per kind, 0xff = between two numbers). */
export const WHEEL_CELLS: readonly (readonly number[])[] = [
  [1, 0xff, 0, 0xff, 1, 0xff, 2, 0xff, 3, 0xff, 2, 0xff],
  [0xff, 0xff, 1, 0xff, 0xff, 4, 0xff, 3, 0xff, 0xff, 2, 0xff],
  [1, 0xff, 6, 0xff, 5, 0xff, 4, 0xff, 3, 0xff, 2, 0xff],
  [5, 0xff, 3, 0xff, 30, 0xff, 20, 0xff, 15, 0xff, 10, 0xff],
];

/** The message box text by kind (0x475cf8, Big5 0x465210 …); `%s` is the owner's or the company's name. */
export const WHEEL_TEXT = ['%s\n\n送您出國旅遊...', '%s的旅館\n\n請進來休息...', '%s的購物中心\n\n您的消費倍數為...', '%s\n\n您的投保天數為...'];

export interface WheelRun {
  kind: number;
  /** rand() % 12: the cell before frame 0. */
  start: number;
  /** Frame of state 2 (the stop was pressed). */
  stop: number;
  /** Cell 0..11 shown after each frame 0 .. `end`. */
  cells: number[];
  /** Frame in which the wheel came to rest (state 5). */
  result: number;
  /** Last frame (state 5 ends). */
  end: number;
  /** The resting cell and its number. */
  cell: number;
  value: number;
}

/**
 * Runs `fcn_0043f7c6`. `start` is rand() % 12; `stop` the frame of state 2: WHEEL_AUTO_STOP for a computer, else the
 * frame after the one during which the human tapped (≥ 1).
 */
export function runWheel(kind: number, start: number, stop: number = WHEEL_AUTO_STOP): WheelRun {
  const table = WHEEL_CELLS[kind & 3];
  stop = Number.isFinite(stop) ? Math.max(1, Math.floor(stop)) : WHEEL_AUTO_STOP;
  let cell = ((Math.floor(start) % 12) + 12) % 12;
  const first = cell;
  const cells: number[] = [];
  // ebx state, [esp+0x2c] last move, [esp+0x34] frames per move, [esp+0x30] moves left at that pace, ebp counter.
  let state = 1, last = 0, pace = 1, left = 3, held = 0, result = -1;
  for (let f = 0; ; f++) {
    if (state === 1 && f >= stop) state = 2;
    switch (state) {
      case 1: cell = (cell + 1) % 12; break;
      case 2: state = 3; last = f; pace = 1; left = 3; break;
      case 3:
        if (f - last !== pace) break;
        cell = (cell + 1) % 12;
        last = f;
        if (--left === 0) { left = 3; pace++; }
        if (pace >= 5 && table[cell] !== 0xff) { state = 5; result = f; held = 0; }
        break;
      case 5: if (++held === WHEEL_HOLD_FRAMES) state = 6; break;
    }
    cells.push(cell);
    if (state === 6) return { kind, start: first, stop, cells, result, end: f, cell, value: table[cell] };
  }
}

/** The number a wheel stops on, without the frames (the first numbered cell at or after start + stop). */
export function wheelValue(kind: number, start: number, stop: number = WHEEL_AUTO_STOP): number {
  const table = WHEEL_CELLS[kind & 3];
  let cell = (start + stop) % 12;
  while (table[cell] === 0xff) cell = (cell + 1) % 12;
  return table[cell];
}
