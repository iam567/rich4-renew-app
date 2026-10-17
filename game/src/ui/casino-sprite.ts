/**
 * 大富翁城's game halls on the board (docs/rules/19): facility types 5..9 (輪盤館, 二十一點館, 百家樂館, 德州撲克館,
 * 骰寶館) are drawn with map/16t1..16t5 by level, t = type − 5 (1601.., 1611.., 1621.., 1631.., 1641..).
 */
export const HALL_FIRST = 5, HALL_LAST = 9;
export const hallSprite = (type: number, level: number) => 1600 + (type - HALL_FIRST) * 10 + Math.max(1, Math.min(5, level));

/** Called once when the first hall is drawn (screens/casino.ts preloads its table art then, long before a visit). */
export const hallSeen: { fn?: () => void } = {};

/** The sprite of a hall at its level (null for the original facility types). */
export function casinoSprite(fa: { type: number; level: number }): number | null {
  if (!(fa.type >= HALL_FIRST && fa.type <= HALL_LAST && fa.level)) return null;
  if (hallSeen.fn) { const fn = hallSeen.fn; hallSeen.fn = undefined; setTimeout(fn, 0); }
  return hallSprite(fa.type, fa.level);
}
