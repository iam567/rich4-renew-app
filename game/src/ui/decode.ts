/**
 * Picture decoding off the main thread. The board draws hundreds of large WebP frames; an `<img>` keeps them
 * encoded until drawn (or drops the decoded copy under memory pressure), and the canvas then decodes them there
 * and then on the main thread: 10–60 ms stalls exactly while the camera moves or the dice tumble. Here a small
 * worker turns the fetched file into an `ImageBitmap` — already decoded, optionally scaled down to what the
 * screen can show, optionally cropped to its visible pixels — and hands it back.
 *
 * Every request ends: a worker that does not answer within `WORKER_MS` (WKWebView builds whose workers cannot
 * decode, a worker that died) is given up for that picture, which is then decoded on the main thread; after a few
 * such failures the workers are not used any more. A fetch that does not answer within `FETCH_MS` fails.
 */

import { watch } from './watchdog';

export type Pic = ImageBitmap | HTMLImageElement | HTMLCanvasElement;
export interface Size { w: number; h: number }
/** A picture cropped to its visible pixels: `x, y` its place in the full `fw`×`fh` decoded picture. */
export interface Cropped { pic: Pic; x: number; y: number; w: number; h: number; fw: number; fh: number }

/**
 * The worker: decode (scaled when asked; without the resize options, which some engines reject, it scales on an
 * OffscreenCanvas), then, when asked, crop to the box of pixels with alpha > 8.
 */
const SRC = `
const scaled = async (blob, w, h) => {
  if (!w) return createImageBitmap(blob);
  try { return await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }); }
  catch (e) {
    const full = await createImageBitmap(blob);
    if (typeof OffscreenCanvas !== 'function') return full;
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(full, 0, 0, w, h);
    full.close();
    return createImageBitmap(c);
  }
};
const crop = async b => {
  const W = b.width, H = b.height;
  if (typeof OffscreenCanvas !== 'function') return { b, x: 0, y: 0 };
  const c = new OffscreenCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(b, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let j = 0; j < H; j++) {
    const row = j * W * 4;
    for (let i = 0; i < W; i++) if (d[row + i * 4 + 3] > 8) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; y1 = j; }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
  // A pixel of margin so smoothing at the edge is not cut.
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(W - 1, x1 + 1); y1 = Math.min(H - 1, y1 + 1);
  if (x0 === 0 && y0 === 0 && x1 === W - 1 && y1 === H - 1) return { b, x: 0, y: 0 };
  const out = await createImageBitmap(b, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  b.close();
  return { b: out, x: x0, y: y0 };
};
self.onmessage = async e => {
  const { id, blob, w, h, cut } = e.data;
  try {
    let b = await scaled(blob, w, h);
    const fw = b.width, fh = b.height;
    let x = 0, y = 0;
    if (cut) ({ b, x, y } = await crop(b));
    self.postMessage({ id, b, x, y, fw, fh }, [b]);
  } catch (err) { self.postMessage({ id, err: String(err) }); }
};`;

/** A worker and its queue: at most `IN_FLIGHT` requests are posted at a time, so a request's time limit counts from
 * when the worker gets it, not from when it was queued behind a long clip. */
interface Lane { w: Worker; busy: number; queue: (() => void)[] }
const IN_FLIGHT = 2;
/** One lane for sprites, one for the ground, one for clips, so a burst of one never holds up another. */
const lanes = new Map<string, Lane | null>();
/** Worker failures (no answer in time, or an error the main thread then did not have); at 3 they are given up. */
let failures = 0;
let seq = 0;
interface Reply { b: ImageBitmap; x: number; y: number; fw: number; fh: number }
const waiting = new Map<number, { ok: (r: Reply) => void; no: (e: Error) => void }>();

const WORKER_MS = 8000, FETCH_MS = 15000;

function lane(name: string): Lane | null {
  if (failures >= 3) return null;
  if (lanes.has(name)) return lanes.get(name)!;
  let l: Lane | null = null;
  try {
    if (typeof Worker === 'function' && typeof createImageBitmap === 'function') {
      const url = URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = (e: MessageEvent<{ id: number; b?: ImageBitmap; err?: string; x?: number; y?: number; fw?: number; fh?: number }>) => {
        const p = waiting.get(e.data.id);
        if (!p) { e.data.b?.close(); return; }
        waiting.delete(e.data.id);
        if (e.data.b) p.ok({ b: e.data.b, x: e.data.x ?? 0, y: e.data.y ?? 0, fw: e.data.fw ?? e.data.b.width, fh: e.data.fh ?? e.data.b.height });
        else p.no(new Error(e.data.err ?? 'decode'));
      };
      w.onerror = () => {
        failures = 3;
        const all = [...waiting.values()];
        waiting.clear();
        for (const p of all) p.no(new Error('worker'));
        // Whatever is still queued goes to the main thread (the lane is no longer used).
        lanes.set(name, null);
        if (l) for (const post of l.queue.splice(0)) post();
      };
      l = { w, busy: 0, queue: [] };
    }
  } catch { l = null; }
  lanes.set(name, l);
  return l;
}

async function fetchBlob(url: string): Promise<Blob> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), FETCH_MS);
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error(`無法載入 ${url}`);
    return await r.blob();
  } finally { clearTimeout(timer); }
}

/** One worker request; rejects when the worker fails or does not answer in time. */
function ask(l: Lane, url: string, blob: Blob, size: Size | undefined, cut: boolean): Promise<Reply> {
  return watch(`decode ${url.split('/').slice(-2).join('/')}`, new Promise<Reply>((ok, no) => {
    const post = () => {
      l.busy++;
      const id = ++seq;
      const next = () => { l.busy--; l.queue.shift()?.(); };
      const timer = setTimeout(() => { if (waiting.delete(id)) { next(); no(new Error('worker timeout')); } }, WORKER_MS);
      waiting.set(id, { ok: r => { clearTimeout(timer); next(); ok(r); }, no: e => { clearTimeout(timer); next(); no(e); } });
      l.w.postMessage({ id, blob, w: size?.w, h: size?.h, cut });
    };
    if (l.busy < IN_FLIGHT) post(); else l.queue.push(post);
  }));
}

/** The picture at `url`, decoded (and scaled to `size` when given), as an `ImageBitmap` where possible. */
export async function decodeImage(url: string, size?: Size, laneName = 'sprite'): Promise<Pic> {
  const blob = await fetchBlob(url);
  const l = lane(laneName);
  if (l) {
    try {
      return (await ask(l, url, blob, size, false)).b;
    } catch {
      // The worker could not decode it in time: this thread does; when that works the worker was the problem.
      const pic = await onMain(blob, size);
      failures++;
      return pic;
    }
  }
  return onMain(blob, size);
}

/**
 * Like `decodeImage`, cropped to the visible pixels (the big clips are mostly transparent: a robot worker frame
 * shows on 16 % of its square). Without a worker the picture is not cropped.
 */
export async function decodeCropped(url: string, size?: Size, laneName = 'clip'): Promise<Cropped> {
  const blob = await fetchBlob(url);
  const l = lane(laneName);
  if (l) {
    try {
      const r = await ask(l, url, blob, size, true);
      return { pic: r.b, x: r.x, y: r.y, w: r.b.width, h: r.b.height, fw: r.fw, fh: r.fh };
    } catch { failures++; }
  }
  const pic = await onMain(blob, size), { w, h } = picSize(pic);
  return { pic, x: 0, y: 0, w, h, fw: w, fh: h };
}

async function onMain(blob: Blob, size?: Size): Promise<Pic> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, size ? { resizeWidth: size.w, resizeHeight: size.h, resizeQuality: 'high' } : undefined);
    } catch { /* below */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    if (!size) return img;
    const c = document.createElement('canvas');
    c.width = size.w; c.height = size.h;
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, size.w, size.h);
    return typeof createImageBitmap === 'function' ? await createImageBitmap(c) : c;
  } finally { URL.revokeObjectURL(url); }
}

/** Frees a decoded picture now rather than at the next garbage collection. */
export const releasePic = (p: CanvasImageSource) => {
  if (typeof ImageBitmap !== 'undefined' && p instanceof ImageBitmap) p.close();
  else if (p instanceof HTMLImageElement) p.src = '';
  else if (p instanceof HTMLCanvasElement) p.width = p.height = 0;
};

/** Pixel size of any drawable picture. */
export function picSize(p: CanvasImageSource): Size {
  const i = p as { naturalWidth?: number; naturalHeight?: number; width: number | SVGAnimatedLength; height: number | SVGAnimatedLength };
  const w = i.naturalWidth || (typeof i.width === 'number' ? i.width : 0), h = i.naturalHeight || (typeof i.height === 'number' ? i.height : 0);
  return { w, h };
}
