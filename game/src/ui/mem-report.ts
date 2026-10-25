/**
 * What the game holds in memory now, by kind (issues #7 / #13: Android closing the app while loading and late in a
 * game). `window.__rich4Mem()` in the console (set once a board shows).
 * Bytes are decoded sizes (4 per pixel, 4 per audio sample).
 */
import { audio } from './audio';
import { clipStats } from './effects';
import { memTier } from './mem-tier';
import type { BoardView } from './board-view';
import type { SpriteBank } from './sprites';

const MB = 1024 * 1024;
const mb = (n: number) => Math.round((n / MB) * 10) / 10;

export function memReport(bank: SpriteBank | null, view: BoardView | null): Record<string, unknown> {
  const s = bank?.memStats(), c = clipStats(), a = audio.memStats(), g = view?.groundTiles?.stats();
  let canvasPx = 0;
  const canvases = document.querySelectorAll('canvas');
  canvases.forEach(cv => { canvasPx += cv.width * cv.height; });
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  return {
    tier: memTier().key,
    jsHeapMB: mb(heap),
    boardSpritesMB: mb(s?.boardBytes ?? 0), boardFrames: s?.boardFrames ?? 0, mapSpritesMB: mb(s?.mapBytes ?? 0),
    fullFramesMB: mb(s?.fullBytes ?? 0), fullFrames: s?.fullFrames ?? 0, tintedMB: mb(s?.tintedBytes ?? 0), tinted: s?.tinted ?? 0,
    clipsMB: mb(c.bytes), clips: c.clips, pinnedClipsMB: mb(c.pinnedBytes),
    audioMB: mb(a.bytes), audioBuffers: a.buffers, musicMB: mb(a.musicBytes), musicTracks: a.music,
    groundTiles: g?.decoded ?? 0, groundTilePx: g?.px ?? 0,
    domCanvases: canvases.length, domCanvasMB: mb(canvasPx * 4), images: document.images.length,
  };
}
