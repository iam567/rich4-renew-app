/**
 * Screen orientation chosen in the settings (the remake's addition): 自動 follows the phone, 橫屏 / 豎屏 lock the
 * app. In the iOS app the lock turns the interface even while the phone's own rotation lock is on, because the app
 * then supports only that orientation. In a browser it works only where the page may lock (Android in full
 * screen); elsewhere the layout keeps following the window.
 */
import { ScreenOrientation } from '@capacitor/screen-orientation';

export const ORIENTATIONS = ['自動', '橫屏', '豎屏'];
const KEY = 'rich4.orientation';

export function orientationMode(): number {
  try { const v = Number(localStorage.getItem(KEY) ?? 0); return v === 1 || v === 2 ? v : 0; } catch { return 0; }
}

export async function setOrientation(mode: number): Promise<void> {
  try { localStorage.setItem(KEY, String(mode)); } catch { /* not kept */ }
  await applyOrientation(mode);
}

export async function applyOrientation(mode = orientationMode()): Promise<void> {
  try {
    if (mode === 0) await ScreenOrientation.unlock();
    else await ScreenOrientation.lock({ orientation: mode === 1 ? 'landscape' : 'portrait' });
  } catch { /* the browser refuses outside full screen */ }
}
