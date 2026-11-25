/** Starts the error log (log.ts) before the game's own modules run, so an error while they load is in it too. */
import { Capacitor } from '@capacitor/core';
import { startLog } from './log';

let plat = 'web';
try { plat = Capacitor.getPlatform(); } catch { /* web */ }
if (typeof window !== 'undefined') startLog(`v${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '?'} ${plat} ${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio} ${typeof navigator === 'undefined' ? '' : navigator.userAgent}`);
