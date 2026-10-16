/** Loads the locally linked game data and art (see scripts/link-assets.mjs). */
import { parseBoard, type Board, type RawMap } from '../core/board';

export const ASSETS = `${import.meta.env.BASE_URL}assets`;

/**
 * A map of the list. `kind`: 'orig' the eight original maps (map-N.json), 'custom' the 自製地圖: the remake's own maps
 * first (maps/remake/index.json, e.g. 東京 by editor/build_tokyo.py, with their own `data` / `image` paths), then the
 * workshop maps (editor/export_custom.py). `hidden`: not offered for a new game (a remake map took its place) but still
 * known, so saved games on it load and show its name.
 */
export interface MapInfo { id: number; name: string; thumbnail: string; custom: boolean; kind: 'orig' | 'custom'; data?: string; image?: string; hidden?: boolean }

const images = new Map<string, Promise<HTMLImageElement>>();
export function image(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`無法載入素材 ${url}`));
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`無法載入 ${url}（請先執行 npm run assets）`);
  return r.json() as Promise<T>;
}

export async function mapList(): Promise<MapInfo[]> {
  const m = await json<{ maps: { id: number; name: string; thumbnail: string }[] }>(`${ASSETS}/maps/maps.json`);
  const list: MapInfo[] = m.maps.map(x => ({ id: x.id, name: x.name, thumbnail: `${ASSETS}/maps/${x.thumbnail}`, custom: false, kind: 'orig' }));
  // The remake's own maps (ids 8..999) lead the 自製地圖 list; each may replace a workshop map in the list.
  const replaced = new Set<number>();
  try {
    const r = await json<{ maps: { id: number; name: string; thumbnail: string; data: string; image: string; replaces?: number[] }[] }>(`${ASSETS}/maps/remake/index.json`);
    for (const x of r.maps) {
      list.push({ id: x.id, name: x.name, thumbnail: `${ASSETS}/maps/${x.thumbnail}`, custom: true, kind: 'custom', data: x.data, image: x.image });
      for (const id of x.replaces ?? []) replaced.add(id);
    }
  } catch { /* none installed */ }
  // Maps made in the workshop (editor/export_custom.py); ids from 1000 so saved games keep pointing at them.
  try {
    const c = await json<{ maps: { id: number; name: string; thumbnail: string }[] }>(`${ASSETS}/maps/custom/index.json`);
    for (const x of c.maps) list.push({ id: x.id, name: x.name, thumbnail: `${ASSETS}/maps/${x.thumbnail}`, custom: true, kind: 'custom', hidden: replaced.has(x.id) });
  } catch { /* no custom maps exported */ }
  known = list;
  return list;
}

let known: MapInfo[] = [];

/** Sprites a map brings along (08 §3.4: landscapes whose resource the original archives do not have). */
export type MapSprites = Record<string, { dir: string; frames: { file: string; width: number; height: number; anchor_x: number; anchor_y: number }[] }>;

export interface MapArt {
  board: Board;
  /** The 2304×2304 top-down ground texture; the view projects it obliquely. */
  ground: HTMLImageElement;
  /** Extra sprites by "archive/NNNN", frames at 4× like the HD redraws (paths relative to maps/). */
  sprites: MapSprites;
  /**
   * Decorations: plants and the like that only dress the ground (no rules, not map records), each a map sprite
   * whose frames are the seasons (spring, summer, autumn, winter; fewer frames: the last one stands in).
   */
  decor: MapDecor[];
  /** Draw a notch across both road edges halfway between squares (the remake's own maps), whatever the ground style. */
  stepMarks: boolean;
}

export interface MapDecor { x: number; y: number; res: number }

export async function loadMap(id: number): Promise<MapArt> {
  let entry = known.find(m => m.id === id);
  if (!entry && id >= 8 && id < 1000) { await mapList().catch(() => []); entry = known.find(m => m.id === id); }
  const base = id >= 1000 ? `${ASSETS}/maps/custom/${id}` : `${ASSETS}/maps/map-${id}`;
  const data = entry?.data ? `${ASSETS}/maps/${entry.data}` : `${base}.json`;
  const pic = entry?.image ? `${ASSETS}/maps/${entry.image}` : `${base}.png`;
  const raw = await json<RawMap & { sprites?: MapSprites; decorations?: MapDecor[]; step_marks?: boolean }>(data);
  return { board: parseBoard(raw), ground: await image(pic), sprites: raw.sprites ?? {}, decor: raw.decorations ?? [], stepMarks: !!raw.step_marks };
}

/**
 * Only a map's records (no ground picture): 大富豪模式 builds all five cities' rules from these and loads the art
 * of the city on screen only (docs/rules/17 §12). Includes the JSON's optional `tycoon` overlay.
 */
export async function loadMapData(id: number): Promise<RawMap & { tycoon?: unknown }> {
  let entry = known.find(m => m.id === id);
  if (!entry && id >= 8 && id < 1000) { await mapList().catch(() => []); entry = known.find(m => m.id === id); }
  const base = id >= 1000 ? `${ASSETS}/maps/custom/${id}` : `${ASSETS}/maps/map-${id}`;
  return json(entry?.data ? `${ASSETS}/maps/${entry.data}` : `${base}.json`);
}

/** HD portrait for a character (Data.mkf #2, aligned 4x), falling back to the original. */
export async function portrait(character: number): Promise<HTMLImageElement> {
  const n = String(character).padStart(3, '0');
  try { return await image(`${ASSETS}/hd/Data/0002-SMP/frame-${n}.png`); }
  catch { return image(`${ASSETS}/orig/Data/0002-SMP/frame-${n}.png`); }
}
