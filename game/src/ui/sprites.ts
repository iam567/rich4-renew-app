/**
 * Sprite frames by original resource (archive + id), preferring the redrawn 4x frames (rich4-hd) and
 * falling back to the extracted originals (rich4-assets). Frames load on demand; `onLoad` asks for a redraw.
 */
import { ASSETS } from './assets';
import { decodeCropped, decodeImage, picSize, releasePic } from './decode';
import { memTier } from './mem-tier';

export type Archive = 'Data' | 'map' | 'Panel' | 'jump';

export interface Frame {
  /** The picture; a board frame may hold fewer pixels than `w`×`h` (scaled to what the screen shows). */
  img: CanvasImageSource;
  /** Size in the frame's own pixels (the redrawn file's), whatever `img` holds. */
  w: number;
  h: number;
  /** Anchor in the frame's own pixels. */
  ax: number;
  ay: number;
  /** Original-pixel size of one frame pixel: 1 for originals, 0.25 for 4x HD frames. */
  scale: number;
}

interface OrigEntry { id: number; type: string; file?: string; width?: number; height?: number; frames?: { frame: number; width: number; height: number; anchor_x: number; anchor_y: number; file?: string }[]; frames_dir?: string; frame_count?: number }
interface HdEntry {
  type: string; file?: string; width?: number; height?: number;
  frames: { frame: number; file: string; width: number; height: number; anchor_x: number; anchor_y: number }[];
  /** Where the frames are when not under hd/ (a map's own sprites). */
  dir?: string;
}

export class SpriteBank {
  private orig = new Map<string, OrigEntry>();
  private hd = new Map<string, HdEntry>();
  private outline = new Map<string, [number, number, number]>();
  private cache = new Map<string, Frame[] | 'loading' | 'missing'>();
  private tinted = new Map<string, HTMLCanvasElement>();
  /** Frames for the board, decoded off the main thread at the board's density (see `board`). */
  private boardCache = new Map<string, BoardEntry | Promise<Frame[] | null>>();
  /** Decoded bytes of the board's map sprites (`map/…`), which are released over the tier's budget (see `trimBoard`). */
  private mapBytes = 0;
  /** Device pixels per original pixel the board draws at (0: not known yet, keep full size). */
  private boardPx = 0;
  onLoad: () => void = () => {};

  static async create(): Promise<SpriteBank> {
    const bank = new SpriteBank();
    const get = (u: string) => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [orig, hd, outline] = await Promise.all([
      get(`${ASSETS}/orig/manifest.json`), get(`${ASSETS}/hd/manifest-hd.json`), get(`${ASSETS}/orig/outline-colors.json`),
    ]);
    if (!orig) throw new Error('找不到原版素材清單（請先執行 npm run assets）');
    for (const [archive, entries] of Object.entries(orig.archives as Record<string, OrigEntry[]>)) {
      for (const e of entries) bank.orig.set(`${archive.replace('.mkf', '')}/${String(e.id).padStart(4, '0')}`, e);
    }
    for (const [key, e] of Object.entries((hd?.resources ?? {}) as Record<string, HdEntry>)) if (e.frames?.length || e.file) bank.hd.set(key, e);
    for (const [key, rgb] of Object.entries((outline ?? {}) as Record<string, [number, number, number]>)) bank.outline.set(key, rgb);
    return bank;
  }

  private key(archive: Archive, id: number) { return `${archive}/${String(id).padStart(4, '0')}`; }

  /**
   * A map's own sprites (its landscapes beyond the original archives), 4× frames under `ASSETS/maps/<dir>/`.
   * They stay registered for later games; a key already known keeps the original.
   */
  addMapSprites(sprites: Record<string, { dir: string; frames: { file: string; width: number; height: number; anchor_x: number; anchor_y: number }[] }>) {
    for (const [key, s] of Object.entries(sprites)) {
      if (this.orig.has(key) || this.hd.has(key)) continue;
      this.hd.set(key, { type: 'SPR', dir: `${ASSETS}/maps/${s.dir}`, frames: s.frames.map((f, i) => ({ frame: i, ...f })) });
      this.cache.delete(key);
    }
  }

  /**
   * Where one frame's image lives, for HTML elements: the 4x redraw when there is one, else the original.
   * Sizes and anchors are in original pixels.
   */
  art(archive: Archive, id: number, frame = 0): { src: string; w: number; h: number; ax: number; ay: number; hd: boolean } | null {
    const key = this.key(archive, id);
    // Whole pictures (RAW16: card art, holiday photos) have one image and no frames.
    const hdEntry = this.hd.get(key), origEntry = this.orig.get(key);
    if (hdEntry?.file) return { src: `${ASSETS}/hd/${archive}/${hdEntry.file}`, w: (hdEntry.width ?? 0) / 4, h: (hdEntry.height ?? 0) / 4, ax: 0, ay: 0, hd: true };
    if (origEntry?.file && !origEntry.frames) {
      if (hdEntry?.frames?.length === 0 || !hdEntry) return { src: `${ASSETS}/orig/${archive}/${origEntry.file}`, w: origEntry.width ?? 0, h: origEntry.height ?? 0, ax: 0, ay: 0, hd: false };
    }
    const hd = hdEntry?.frames?.[frame];
    if (hd) {
      const e = this.hd.get(key)!;
      return { src: `${e.dir ?? `${ASSETS}/hd/${key}-${e.type}`}/${hd.file}`, w: hd.width / 4, h: hd.height / 4, ax: hd.anchor_x / 4, ay: hd.anchor_y / 4, hd: true };
    }
    const f = origEntry?.frames?.[frame];
    if (!f?.file) return null;
    return { src: `${ASSETS}/orig/${archive}/${f.file}`, w: f.width, h: f.height, ax: f.anchor_x, ay: f.anchor_y, hd: false };
  }

  /** The original frames' sizes and anchors (for rules that measure sprites, e.g. a mini game's catch box). */
  boxes(archive: Archive, id: number): { w: number; h: number; ax: number; ay: number }[] {
    return (this.orig.get(this.key(archive, id))?.frames ?? []).map(f => ({ w: f.width, h: f.height, ax: f.anchor_x, ay: f.anchor_y }));
  }

  /**
   * The board's device pixels per original pixel (zoom × backing-store ratio). Frames for the board are kept at
   * that density, rounded up to a quarter pixel (a phone needs 2 of the 4 redrawn pixels per original pixel:
   * a quarter of the memory, and nothing to decode while drawing). It only grows: a sharper view reloads.
   */
  setBoardDensity(px: number) {
    // Never sharper than the device's memory tier allows (ui/mem-tier.ts): a low-memory phone keeps 1.5.
    const b = Math.min(fitPx(px), fitPx(memTier().spritePx));
    if (b > this.boardPx) { this.boardPx = b; this.tinted.clear(); }
  }

  /**
   * Frames of a resource for drawing on the board at `mul` times the board's scale (the dice are drawn smaller),
   * or null while loading / when missing. Decoded pictures, so drawing them never decodes on the main thread.
   */
  board(archive: Archive, id: number, mul = 1): Frame[] | null {
    const key = `${this.key(archive, id)}@${mul}`, hit = this.boardCache.get(key);
    if (hit && !(hit instanceof Promise)) {
      hit.used = performance.now();
      if (hit.px < this.want(mul) && !hit.next) this.loadBoard(archive, id, mul, hit);
      return hit.frames;
    }
    if (!hit) void this.boardReady(archive, id, mul);
    return null;
  }

  /** The board's frames once loaded (for a caller that must not go on without them: the dice throw). */
  boardReady(archive: Archive, id: number, mul = 1): Promise<Frame[] | null> {
    const key = `${this.key(archive, id)}@${mul}`, hit = this.boardCache.get(key);
    if (hit instanceof Promise) return hit;
    if (hit) return Promise.resolve(hit.frames);
    return this.loadBoard(archive, id, mul);
  }

  private want(mul: number) { return fitPx((this.boardPx || memTier().spritePx) * mul); }

  /** Decoded board frames: how many and their bytes, and the map sprites' bytes (for checks). */
  boardMemory(): { frames: number; bytes: number; mapBytes: number; budget: number } {
    let frames = 0, bytes = 0;
    for (const v of this.boardCache.values()) {
      if (v instanceof Promise || !v.frames) continue;
      frames += v.frames.length; bytes += v.bytes;
    }
    return { frames, bytes, mapBytes: this.mapBytes, budget: memTier().spriteBytes };
  }

  /**
   * Over the tier's budget (ui/mem-tier.ts), the map sprites not drawn for the longest time go, as long as they
   * have not been drawn for `IDLE_MS`: they are decoded again when seen. The figures and the dice always stay.
   */
  private trimBoard() {
    const budget = memTier().spriteBytes;
    if (this.mapBytes <= budget) return;
    const now = performance.now();
    const old = [...this.boardCache].filter((e): e is [string, BoardEntry] => !(e[1] instanceof Promise) && e[1].map && !e[1].next && now - e[1].used > IDLE_MS)
      .sort((a, z) => a[1].used - z[1].used);
    for (const [key, e] of old) {
      if (this.mapBytes <= budget) break;
      this.boardCache.delete(key);
      this.mapBytes -= e.bytes;
      for (const f of e.frames ?? []) releasePic(f.img);
      const prefix = `${key.slice(0, key.indexOf('@'))}/`;
      for (const k of [...this.tinted.keys()]) if (k.startsWith(prefix)) { releasePic(this.tinted.get(k)!); this.tinted.delete(k); }
    }
  }

  /** Estimated decoded bytes of a resource's board frames at the board's density (before loading it). */
  estimate(archive: Archive, id: number, mul = 1): number {
    const key = this.key(archive, id), hd = this.hd.get(key);
    if (hd?.frames?.length) {
      const k = Math.min(1, this.want(mul) / 4);
      return hd.frames.reduce((s, f) => s + Math.round(f.width * k) * Math.round(f.height * k) * 4, 0);
    }
    return (this.orig.get(key)?.frames ?? []).reduce((s, f) => s + f.width * f.height * 4, 0);
  }

  /** Whether a resource's board frames are decoded at the board's density now. */
  boardHas(archive: Archive, id: number, mul = 1): boolean {
    const hit = this.boardCache.get(`${this.key(archive, id)}@${mul}`);
    return !!hit && !(hit instanceof Promise) && hit.px >= this.want(mul);
  }

  private loadBoard(archive: Archive, id: number, mul: number, stale?: BoardEntry): Promise<Frame[] | null> {
    const key = `${this.key(archive, id)}@${mul}`, px = this.want(mul);
    const p = this.load(archive, this.key(archive, id), px).catch(() => null).then(f => {
      // Gone meanwhile (released over the budget while a sharper copy loaded): the copy is not kept.
      const now = this.boardCache.get(key);
      if (stale && now !== stale) { if (f) for (const x of f) releasePic(x.img); return f; }
      // A view that grew sharper meanwhile asks again on the next draw.
      const frames = f ?? stale?.frames ?? null, bytes = frames ? frameBytes(frames) : 0;
      const isMap = archive === 'map';
      if (isMap) this.mapBytes += bytes - (stale?.bytes ?? 0);
      this.boardCache.set(key, { frames, px, used: performance.now(), bytes, map: isMap });
      if (isMap) this.trimBoard();
      this.onLoad();
      return f;
    });
    if (stale) stale.next = p; else this.boardCache.set(key, p);
    return p;
  }

  /** Frames of a resource, or null while loading / when missing. */
  frames(archive: Archive, id: number): Frame[] | null {
    const key = this.key(archive, id);
    const hit = this.cache.get(key);
    if (Array.isArray(hit)) return hit;
    if (hit) return null;
    void this.ready(archive, id);
    return null;
  }

  private pending = new Map<string, Promise<Frame[] | null>>();
  /** The frames once loaded and decoded, for a caller that must not go on without them (the dice throw). */
  ready(archive: Archive, id: number): Promise<Frame[] | null> {
    const key = this.key(archive, id), hit = this.cache.get(key);
    if (Array.isArray(hit)) return Promise.resolve(hit);
    if (hit === 'missing') return Promise.resolve(null);
    let p = this.pending.get(key);
    if (!p) {
      this.cache.set(key, 'loading');
      p = this.load(archive, key).then(f => { this.cache.set(key, f ?? 'missing'); this.pending.delete(key); this.onLoad(); return f; });
      this.pending.set(key, p);
    }
    return p;
  }

  /**
   * Loads a resource's frames. With `px` (device pixels per original pixel) they are decoded off the main thread
   * and scaled down to that density; without, they are `<img>` elements at full size (the HTML screens).
   */
  private async load(archive: Archive, key: string, px?: number): Promise<Frame[] | null> {
    const img = (url: string) => new Promise<HTMLImageElement>((ok, fail) => {
      // Decoded before first use: drawing a picture that is still encoded decodes it there and then, on the main
      // thread, which is a visible hitch on a phone each time a new sprite appears.
      const i = new Image(); i.decoding = 'async'; i.onload = () => { i.decode().then(() => ok(i), () => ok(i)); }; i.onerror = fail; i.src = url;
    });
    // Redrawn frames hold 4 pixels per original pixel; the board keeps `px` of them.
    const k = px ? Math.min(1, px / 4) : 1;
    const fit = (url: string, w: number, h: number) => (px ? decodeImage(url, k < 1 ? { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) } : undefined) : img(url));
    const hd = this.hd.get(key);
    if (hd) {
      try {
        const dir = hd.dir ?? `${ASSETS}/hd/${key}-${hd.type}`;
        // The dice (Panel#3..6) are drawn on big, mostly empty canvases (the tumble shows on 4–9 % of its frame):
        // the board keeps them cropped to their visible pixels, the frame's size and anchor following the crop.
        if (px && archive === 'Panel') {
          return await Promise.all(hd.frames.map(async f => {
            const c = await decodeCropped(`${dir}/${f.file}`, k < 1 ? { w: Math.max(1, Math.round(f.width * k)), h: Math.max(1, Math.round(f.height * k)) } : undefined, 'sprite');
            const u = f.width / c.fw, v = f.height / c.fh;
            return { img: c.pic, w: c.w * u, h: c.h * v, ax: f.anchor_x - c.x * u, ay: f.anchor_y - c.y * v, scale: 0.25 };
          }));
        }
        return await Promise.all(hd.frames.map(async f => ({ img: await fit(`${dir}/${f.file}`, f.width, f.height), w: f.width, h: f.height, ax: f.anchor_x, ay: f.anchor_y, scale: 0.25 })));
      } catch { /* fall back to the original */ }
    }
    const e = this.orig.get(key);
    if (!e) return null;
    if (e.type === 'FLC' && e.frames_dir && e.frame_count) {
      const frames: Frame[] = [];
      for (let i = 0; i < e.frame_count; i++) {
        const im = await img(`${ASSETS}/orig/${archive}/${e.frames_dir}/frame-${String(i).padStart(3, '0')}.png`);
        frames.push({ img: keyOut(im), w: im.width, h: im.height, ax: 0, ay: 0, scale: 1 });
      }
      return frames;
    }
    if (!e.frames) return null;
    // Original frames are small: decoded as they are.
    return Promise.all(e.frames.filter(f => f.file).map(async f => ({
      img: await (px ? decodeImage(`${ASSETS}/orig/${archive}/${f.file}`) : img(`${ASSETS}/orig/${archive}/${f.file}`)), w: f.width, h: f.height, ax: f.anchor_x, ay: f.anchor_y, scale: 1,
    })));
  }

  /** A frame with the resource's outline colour (palette entry 255) replaced by an owner colour, as the original does. */
  tint(archive: Archive, id: number, frame: Frame, index: number, rgb: number): CanvasImageSource {
    const outline = this.outline.get(this.key(archive, id));
    if (!outline) return frame.img;
    if (frame.scale !== 1) return rgb ? this.ring(archive, id, frame, index, rgb) : frame.img;
    const [r, g, b] = [rgb >> 16 & 255, rgb >> 8 & 255, rgb & 255];
    return this.recolor(`${this.key(archive, id)}/${index}/${rgb}`, frame, px => {
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] && px[i] === outline[0] && px[i + 1] === outline[1] && px[i + 2] === outline[2]) { px[i] = r; px[i + 1] = g; px[i + 2] = b; }
      }
    });
  }

  /**
   * The HD redraws have no palette outline to recolour, so the owner's colour is a ring around the picture
   * instead (about 1.5 original pixels wide, with a thin dark edge so light colours read on light ground).
   */
  private ring(archive: Archive, id: number, frame: Frame, index: number, rgb: number): CanvasImageSource {
    const im = frame.img, { w: W, h: H } = picSize(im);
    const key = `${this.key(archive, id)}/${index}/ring${rgb}/${W}`;
    let c = this.tinted.get(key);
    if (c) return c;
    const px = W / (frame.w * frame.scale), d = Math.max(2, Math.round(1.5 * px)), e = Math.max(1, Math.round(0.6 * px));
    const flat = (color: string) => {
      const f = document.createElement('canvas'); f.width = W; f.height = H;
      const x = f.getContext('2d')!; x.drawImage(im, 0, 0, W, H); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, W, H);
      return f;
    };
    const dark = flat('rgba(20, 20, 20, .85)'), own = flat(`#${rgb.toString(16).padStart(6, '0')}`);
    c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d')!;
    const around = (img: HTMLCanvasElement, r: number) => { for (let a = 0; a < 16; a++) x.drawImage(img, Math.round(Math.cos(a * Math.PI / 8) * r), Math.round(Math.sin(a * Math.PI / 8) * r)); };
    around(dark, d + e); around(own, d);
    x.drawImage(im, 0, 0, W, H);
    this.tinted.set(key, c);
    return c;
  }

  /** True when a resource's outline colour (palette 255) is the magenta placeholder rather than a real colour. */
  placeholderOutline(archive: Archive, id: number): boolean {
    const o = this.outline.get(this.key(archive, id));
    return !!o && o[0] > 200 && o[1] < 60 && o[2] > 200;
  }

  /** Hibernation look (08 §1.6): grey = (R+G+B+0x28)>>2 into red and green, blue at full. */
  frozen(archive: Archive, id: number, frame: Frame, index: number): CanvasImageSource {
    return this.recolor(`${this.key(archive, id)}/${index}/frozen`, frame, px => {
      for (let i = 0; i < px.length; i += 4) {
        const v = Math.min(255, (px[i] + px[i + 1] + px[i + 2] + 0x28) >> 2);
        px[i] = v; px[i + 1] = v; px[i + 2] = 255;
      }
    });
  }

  /** The frame's shape in one flat colour (surcharge / seizure diamonds). */
  silhouette(archive: Archive, id: number, frame: Frame, index: number, rgb: number): CanvasImageSource {
    const [r, g, b] = [rgb >> 16 & 255, rgb >> 8 & 255, rgb & 255];
    return this.recolor(`${this.key(archive, id)}/${index}/flat${rgb}`, frame, px => {
      for (let i = 0; i < px.length; i += 4) { px[i] = r; px[i + 1] = g; px[i + 2] = b; }
    });
  }

  private recolor(cacheKey: string, frame: Frame, edit: (px: Uint8ClampedArray) => void): HTMLCanvasElement {
    // The picture's own pixels (a board frame may be smaller than the frame).
    const { w, h } = picSize(frame.img);
    cacheKey += `/${w}`;
    let c = this.tinted.get(cacheKey);
    if (!c) {
      c = document.createElement('canvas');
      c.width = w || frame.w; c.height = h || frame.h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(frame.img, 0, 0, c.width, c.height);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      edit(data.data);
      ctx.putImageData(data, 0, 0);
      this.tinted.set(cacheKey, c);
    }
    return c;
  }
}

interface BoardEntry {
  frames: Frame[] | null;
  px: number;
  /** A sharper copy on its way. */
  next?: Promise<Frame[] | null>;
  /** When it was last drawn (performance.now()). */
  used: number;
  bytes: number;
  /** A map sprite (released over the budget); the figures and the dice are not. */
  map: boolean;
}

/** A map sprite not drawn for this long may be released over the budget (an effect holding its frames is over by then). */
const IDLE_MS = 8000;

const frameBytes = (frames: Frame[]) => frames.reduce((s, f) => { const { w, h } = picSize(f.img); return s + w * h * 4; }, 0);

/** Board density rounded up to a quarter pixel, within what the redraws hold (4). */
const fitPx = (px: number) => Math.min(4, Math.max(0.5, Math.ceil(px * 4 - 1e-6) / 4));

/** FLC frames keep the palette's key colour (index 0) as background: make it transparent. */
function keyOut(im: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height), px = data.data;
  const [r, g, b] = [px[0], px[1], px[2]];
  for (let i = 0; i < px.length; i += 4) if (px[i] === r && px[i + 1] === g && px[i + 2] === b) px[i + 3] = 0;
  ctx.putImageData(data, 0, 0);
  return c;
}
