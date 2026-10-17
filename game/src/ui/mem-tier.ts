/**
 * How much decoded picture memory this device may hold, as one of three tiers. A phone's web view is killed when
 * it uses too much memory (WKWebView's limit on a 2–3 GB iPhone is a few hundred MB for everything), and decoded
 * pictures are most of what the game holds: the ground preview and tiles, the board's sprite frames, the big
 * effect clips. Each tier sets their limits; the map's loading screen preloads only what the first view needs
 * within them and the rest streams in as before.
 *
 * Detection: `navigator.deviceMemory` where the browser has it (Chrome, Android: GB, rounded down, capped at 8);
 * on iOS, which has no such number, the screen (an iPhone up to the 8 Plus / SE size is a 2–3 GB phone) and
 * otherwise the middle tier; a desktop browser without the number is high. `localStorage['rich4.memTier']`
 * (low / mid / high) overrides it, for tests and for a player whose phone struggles.
 */

export type TierName = 'low' | 'mid' | 'high';

export interface MemTier {
  name: TierName;
  /** Decoded high-resolution ground tiles together (bytes). */
  groundBytes: number;
  /** Longest side the 1× ground preview is decoded at (px); a bigger map's preview is scaled down to it. */
  previewMax: number;
  /** Most pixels per original pixel a ground tile is decoded at (the files hold 3). */
  tilePx: number;
  /** Whether the tiles where the camera is about to glide are decoded ahead of it (else when it arrives). */
  prefetch: boolean;
  /** Extra device px round the first view whose tiles the loading screen also waits for. */
  preloadRing: number;
  /** Tiles decoded at once. */
  tileParallel: number;
  /** Most device pixels per original pixel the board's sprite frames are kept at (the redraws hold 4). */
  spritePx: number;
  /**
   * Decoded map sprites the board keeps (bytes: buildings, landscapes, plants, event pads); beyond it the ones not
   * drawn for a while are released and decoded again when seen. The figures and the dice are always kept.
   */
  spriteBytes: number;
  /** CSS px beyond the first view whose map sprites the loading screen preloads (within 3/4 of `spriteBytes`). */
  spriteAhead: number;
  /** Views' worth of drawn ground chunks kept (the view and the ring round it count as one). */
  chunkViews: number;
  /** Effect clips: decoded bytes and count kept (pinned ones aside), and their scale cap (× original px). */
  clipBytes: number;
  clipCount: number;
  clipScale: number;
  /** 歌舞伎町's passers-by on the sidewalks (docs/rules/21 §8.1), the cyclists among them, the cars on the avenues at
   * once and the crows (§8.3). */
  walkers: number;
  bikes: number;
  vehicles: number;
  crows: number;
}

const MB = 1024 * 1024;
export const TIERS: Record<TierName, MemTier> = {
  low: { name: 'low', groundBytes: 24 * MB, previewMax: 1536, tilePx: 1.5, prefetch: false, preloadRing: 0, tileParallel: 2,
    spritePx: 1.5, spriteBytes: 32 * MB, spriteAhead: 160, chunkViews: 1, clipBytes: 32 * MB, clipCount: 3, clipScale: 1, walkers: 30, bikes: 2, vehicles: 4, crows: 2 },
  mid: { name: 'mid', groundBytes: 48 * MB, previewMax: 2304, tilePx: 2.25, prefetch: true, preloadRing: 256, tileParallel: 2,
    spritePx: 2, spriteBytes: 80 * MB, spriteAhead: 1200, chunkViews: 2, clipBytes: 64 * MB, clipCount: 4, clipScale: 1.5, walkers: 60, bikes: 4, vehicles: 7, crows: 3 },
  // The limits the game had before the tiers (2026-10-17), with a cap on the map sprites.
  high: { name: 'high', groundBytes: 100 * MB, previewMax: 4096, tilePx: 3, prefetch: true, preloadRing: 512, tileParallel: 3,
    spritePx: 4, spriteBytes: 192 * MB, spriteAhead: Infinity, chunkViews: 2, clipBytes: 128 * MB, clipCount: 6, clipScale: 4, walkers: 100, bikes: 6, vehicles: 10, crows: 4 },
};

const KEY = 'rich4.memTier';

/** The tier this device gets without an override. */
export function detectTier(): TierName {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { deviceMemory?: number };
  const gb = typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : 0;
  if (gb) return gb <= 2 ? 'low' : gb <= 4 ? 'mid' : 'high';
  const ua = nav.userAgent ?? '';
  const touch = (nav.maxTouchPoints ?? 0) > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
  const scr = typeof screen !== 'undefined' ? screen : { width: 0, height: 0 };
  const long = Math.max(scr.width || 0, scr.height || 0), dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  if (ios) {
    // iPhone 6s … 8 Plus, SE: 2–3 GB (the SE 3 has 4 GB on the same small screen; low is safe there too).
    if (long && long <= 736) return 'low';
    // A non-Retina iPad (iPad 2 / mini 1): 512 MB – 1 GB.
    if (dpr < 2) return 'low';
    return 'mid';
  }
  if (!touch) return 'high';
  // A touch device that does not say: few cores is an old phone.
  const cores = nav.hardwareConcurrency ?? 0;
  return cores && cores <= 4 ? 'low' : 'mid';
}

let current: MemTier | null = null;

/** The device's memory tier (the override first). */
export function memTier(): MemTier {
  if (current) return current;
  let name: TierName | null = null;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'mid' || v === 'high') name = v;
  } catch { /* no storage */ }
  current = TIERS[name ?? detectTier()];
  return current;
}
