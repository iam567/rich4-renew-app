/**
 * The PC / Mac app's window from the game's settings (issue #72): 全螢幕 or 視窗, and 結束遊戲 (no way out once full
 * screen). The app's own bridge (desktop/preload.cjs `window`); an older app without it: the page's own full screen.
 */
type DesktopWindow = { isFullScreen(): Promise<boolean>; setFullScreen(on: boolean): Promise<boolean>; quit(): Promise<boolean> };
const api = () => (globalThis as { rich4Desktop?: { window?: DesktopWindow } }).rich4Desktop;

/** Whether this is the PC / Mac app. */
export const isDesktop = () => !!api();

let full = false;
async function refresh() {
  const w = api()?.window;
  try { full = w ? await w.isFullScreen() : !!document.fullscreenElement; } catch { /* as it was */ }
}
if (isDesktop()) { void refresh(); window.addEventListener('resize', () => void refresh()); }

/** Full screen now (as last seen: F11 / Alt+Enter change it too). */
export const desktopFull = () => full;

export async function setDesktopFull(on: boolean) {
  const w = api()?.window;
  try {
    if (w) await w.setFullScreen(on);
    else if (on) await document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen();
    full = on;
  } catch { await refresh(); }
}

/** Closes the app. */
export function quitDesktop() {
  const w = api()?.window;
  if (w) void w.quit(); else window.close();
}
