/**
 * 字體 (設定, the user 2026-11-03: a few fonts to choose from). The chosen family comes first in every font list of
 * the game: CSS through `var(--ui-font)` (style.css :root), the canvases (cards, effects) through uiFont(). After it
 * the system's fonts fill in what it lacks ("PingFang SC" first: see style.css). All four are free to ship:
 * 粉圓 (jf open 粉圓, OFL; traditional only — simplified-only characters come from the system), 文楷 (LXGW WenKai TC,
 * OFL), 圓體 (Chiron GoRound TC, OFL), 系統 (the device's own: PingFang on Apple, Noto on Android). Kept on the device.
 */
import '@fontsource/lxgw-wenkai-tc/400.css';
import '@fontsource/chiron-goround-tc/400.css';

export const FONTS: readonly { label: string; family: string }[] = [
  { label: '粉圓', family: '"Huninn"' },
  { label: '文楷', family: '"LXGW WenKai TC"' },
  { label: '圓體', family: '"Chiron GoRound TC"' },
  { label: '系統', family: 'system-ui' },
];
const KEY = 'rich4.font';

export function fontMode(): number {
  try { const n = Number(localStorage.getItem(KEY) ?? 0); return Number.isInteger(n) && n >= 0 && n < FONTS.length ? n : 0; } catch { return 0; }
}
/** The chosen family, to put first in a font list. */
export const uiFont = () => FONTS[fontMode()].family;

/** Puts the chosen font on the page (at start and after a choice). */
export function applyFont() {
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--ui-font', uiFont());
}
export function setFont(i: number) {
  try { localStorage.setItem(KEY, String(i)); } catch { /* not kept */ }
  applyFont();
}
