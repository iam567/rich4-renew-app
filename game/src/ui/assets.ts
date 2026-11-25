/** Loads the locally linked game data and art (see scripts/link-assets.mjs). */
import { parseBoard, type Board, type RawMap } from '../core/board';
import type { CqLevels } from './chongqing';

export const ASSETS = `${import.meta.env.BASE_URL}assets`;

/**
 * `url(…)` for a CSS custom property set from script: the address made absolute first. A relative url() in a custom
 * property resolves against the stylesheet that uses var(), not the page — in the app (base './') the bundled CSS sits in
 * assets/, so `./assets/…` became assets/assets/… and 清明上河's painted boards, buttons and tags were missing on the phone.
 */
export const cssUrl = (src: string) => `url('${new URL(src, document.baseURI).href}')`;

/**
 * A map of the list. `kind`: 'orig' the eight original maps (map-N.json), 'custom' the 自製地圖: the remake's own maps
 * (maps/remake/index.json: 東京, 大阪, 札幌, 九州, 沖繩, 大富翁城, with their own `data` / `image` paths). The old
 * workshop maps (editor/export_custom.py, maps/custom/index.json) are no longer offered (2026-10-17): they are listed
 * `hidden`, known only so saved games on them still load and show their name. `hidden`: not offered for a new game.
 */
export interface MapInfo { id: number; name: string; thumbnail: string; custom: boolean; kind: 'orig' | 'custom'; data?: string; image?: string; hidden?: boolean;
  /** Its pictures are not on this device (FULL_ONLY): shown, not playable. */
  lacks?: boolean }

/**
 * Maps whose pictures come with the 1.3 installer only, never with an in-game update (some 240 MB; the user 2026-11-25:
 * 「只更新程序，然後提示想要玩新地圖需要自行去github下載完整版1.3.0」): a picture of each that only a full install has (the
 * publisher leaves the maps' files out, scripts/publish-update.mjs FULL_ONLY).
 */
export const FULL_ONLY: Record<number, string> = { 110: 'remake/changan/magic/t7.webp', 111: 'remake/qingming/liangshan-flag.webp' };
export const fullOnlyMsg = (name: string) => `「${name}」要有完整版 1.3.0 才能玩\n請到 GitHub 下載 1.3.0 安裝包直接安裝（存檔會保留）`;
const lacking = new Set<number>();
let looked: Promise<void> | null = null;
/** Looks once which of them are not here (a picture that cannot be had at once counts as here). */
function lookFull(): Promise<void> {
  return (looked ??= Promise.all(Object.entries(FULL_ONLY).map(([id, pic]) => new Promise<void>(done => {
    const img = new Image(), t = setTimeout(done, 4000);
    img.onload = () => { clearTimeout(t); done(); };
    img.onerror = () => { clearTimeout(t); lacking.add(Number(id)); done(); };
    img.src = `${ASSETS}/maps/${pic}`;
  }))).then(() => {}));
}
/** Whether the map cannot be played on this device for want of its pictures. */
export const mapLacks = (id: number): boolean => lacking.has(id);

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
  // The 原版地圖's illustrated postcards (tools/tycoon-art/map_thumbs.py build-orig, the user 2026-11-03) where installed.
  let postcards: number[] = [];
  try { postcards = (await json<{ ids: number[] }>(`${ASSETS}/maps/remake/orig-postcards.json`)).ids ?? []; } catch { /* the plain board pictures */ }
  // 「地图05 · 星座主题」 → 「星座」 everywhere (the user 2026-11-17: 原來那個名實在太長了)
  const short = (n: string) => n.replace(/^地[圖图]\s*\d+\s*[・·•‧]\s*/, '').replace(/主[題题]$/, '');
  const list: MapInfo[] = m.maps.map(x => ({ id: x.id, name: short(x.name), custom: false, kind: 'orig',
    thumbnail: postcards.includes(x.id) ? `${ASSETS}/maps/remake/orig-${x.id}-postcard.webp` : `${ASSETS}/maps/${x.thumbnail}` }));
  // The remake's own maps (ids 8..999) are the 自製地圖 list (their `replaces` named the workshop map whose slot they took).
  try {
    const r = await json<{ maps: { id: number; name: string; thumbnail: string; data: string; image: string; replaces?: number[]; hidden?: boolean }[] }>(`${ASSETS}/maps/remake/index.json`);
    for (const x of r.maps) {
      // `hidden`: a map only 大富豪模式 uses (大富翁城, its finale, docs/rules/19) is known but not offered.
      list.push({ id: x.id, name: x.name, thumbnail: `${ASSETS}/maps/${x.thumbnail}`, custom: true, kind: 'custom', data: x.data, image: x.image, ...(x.hidden ? { hidden: true } : {}) });
    }
  } catch { /* none installed */ }
  // Maps made in the workshop (editor/export_custom.py, ids from 1000): never offered any more, the 自製地圖 are the
  // remake's six; kept hidden so saved games on them still load (where their files are installed).
  try {
    const c = await json<{ maps: { id: number; name: string; thumbnail: string }[] }>(`${ASSETS}/maps/custom/index.json`);
    for (const x of c.maps) list.push({ id: x.id, name: x.name, thumbnail: `${ASSETS}/maps/${x.thumbnail}`, custom: true, kind: 'custom', hidden: true });
  } catch { /* no custom maps exported */ }
  await lookFull();
  for (const x of list) if (mapLacks(x.id)) x.lacks = true;
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
  /** Sidewalk paths of the decorative passers-by, each a list of [x, y] map points (歌舞伎町, docs/rules/21 §8.1). */
  walkers?: [number, number][][];
  /**
   * A stacked map's levels (重慶, ui/chongqing.ts): `ground` is then the river island under every plate, and `plates`
   * the pictures of the plates (by level, transparent round each plate), drawn by the board in level order.
   */
  levels?: CqLevels;
  plates?: Record<number, HTMLImageElement>;
  /** 重慶: each plate's side wall, a strip repeated along its edge (remake/chongqing/wall-<level>.webp; none if missing). */
  walls?: Record<number, HTMLImageElement>;
  /** 自建地圖: each landscape's size (1 when missing). */
  landscapeScale?: number[];
  /** 自建地圖: the event pads' size against the originals' (1 when missing). */
  padScale?: number;
  /**
   * Tall pieces open a hole round an actor behind them (挖洞, board-view.ts revealSprite): only the maps that ask for it
   * (the user 2026-11-19: 「先只針對以後的新地圖打開」 — 長安 and the dynasty maps with their city walls).
   */
  reveal?: boolean;
  /** 官方地圖's own event pads by square (自建地圖 format, MakerMap.pads): the picture drawn instead of map#24's. */
  padImages?: Record<number, HTMLImageElement>;
  /** 官方地圖 in the editor's format: its passers-by's sprites (they walk `walkers`, ui/mk-street.ts). */
  walkerKinds?: number[];
  walkerHot?: [number, number, number, number][];
  /** Parts of the map with walkers of their own: [x0, y0, x1, y1, kinds] (MakerMap.crowd.areas). */
  walkerAreas?: [number, number, number, number, number[]][];
  /** 官方地圖 in the editor's format: the buildings players put up (MakerMap.builds). */
  builds?: { lots: number[][]; fac: Record<string, number[]>; chain?: number };
  /** An official map's look and words (長安: 'changan', ui/cn-theme.ts): its place screens, names and money unit. */
  theme?: string;
}

/** A decoration; `s` its size (自建地圖's pieces may be scaled; 1 when missing). */
export interface MapDecor { x: number; y: number; res: number; s?: number }

/**
 * 自建地圖's 試玩 (ui/maker/compile.ts): a map made in the editor, its records and its ground picture, known by its id
 * for this run of the app (never saved with a game list).
 */
type MakerRaw = RawMap & { sprites?: MapSprites; decorations?: MapDecor[]; step_marks?: boolean; landscape_scale?: number[]; pad_scale?: number; reveal?: boolean; pad_images?: Record<number, string>; walkers?: [number, number][][]; walker_kinds?: number[]; walker_hot?: [number, number, number, number][]; walker_areas?: [number, number, number, number, number[]][]; build_sprites?: { lots: number[][]; fac: Record<string, number[]>; chain?: number }; theme?: string };
const makerMaps = new Map<number, { raw: MakerRaw; ground: HTMLImageElement; won?: () => void; name?: string }>();
/**
 * `won`: called when a human wins a game alone on it (自建地圖: only a map its maker has won may go to the 地圖庫);
 * `name`: the map's own (the boot screen, the results; a 地圖庫 map's as the library has it).
 */
export function registerMakerMap(id: number, raw: MakerRaw, ground: HTMLImageElement, won?: () => void, name?: string) {
  makerMaps.set(id, { raw, ground, won, name });
}
/** A player's map's name, when the id is one (none: not a player's map). */
export const makerName = (id: number) => makerMaps.get(id)?.name;
export function makerWon(id: number) { makerMaps.get(id)?.won?.(); }

/** An official map's own pads, loaded (one picture per file; a failed one is left out: map#24's pad shows there). */
async function padPics(urls: Record<number, string>): Promise<Record<number, HTMLImageElement>> {
  const files = new Map<string, Promise<HTMLImageElement | null>>();
  const one = (u: string) => {
    let p = files.get(u);
    if (!p) { p = new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = u; }); files.set(u, p); }
    return p;
  };
  const out: Record<number, HTMLImageElement> = {};
  await Promise.all(Object.entries(urls).map(async ([k, u]) => { const im = await one(u); if (im) out[Number(k)] = im; }));
  return out;
}

export async function loadMap(id: number): Promise<MapArt> {
  const mk = makerMaps.get(id);
  if (mk) return { board: parseBoard(mk.raw), ground: mk.ground, sprites: mk.raw.sprites ?? {}, decor: mk.raw.decorations ?? [], stepMarks: !!mk.raw.step_marks, ...(mk.raw.landscape_scale?.length ? { landscapeScale: mk.raw.landscape_scale } : {}), ...(mk.raw.pad_scale ? { padScale: mk.raw.pad_scale } : {}), ...(mk.raw.reveal ? { reveal: true } : {}), ...(mk.raw.pad_images ? { padImages: await padPics(mk.raw.pad_images) } : {}), ...(mk.raw.walker_kinds?.length ? { walkers: mk.raw.walkers ?? [], walkerKinds: mk.raw.walker_kinds, walkerHot: mk.raw.walker_hot ?? [], ...(mk.raw.walker_areas ? { walkerAreas: mk.raw.walker_areas } : {}) } : {}), ...(mk.raw.build_sprites ? { builds: mk.raw.build_sprites } : {}), ...(mk.raw.theme ? { theme: mk.raw.theme } : {}) };
  let entry = known.find(m => m.id === id);
  if (!entry && id >= 8 && id < 1000) { await mapList().catch(() => []); entry = known.find(m => m.id === id); }
  if (FULL_ONLY[id]) { await lookFull(); if (mapLacks(id)) throw new Error(fullOnlyMsg(entry?.name ?? '這張地圖')); }
  const base = id >= 1000 ? `${ASSETS}/maps/custom/${id}` : `${ASSETS}/maps/map-${id}`;
  const data = entry?.data ? `${ASSETS}/maps/${entry.data}` : `${base}.json`;
  const pic = entry?.image ? `${ASSETS}/maps/${entry.image}` : `${base}.png`;
  const raw = await json<RawMap & { sprites?: MapSprites; decorations?: MapDecor[]; step_marks?: boolean; walkers?: [number, number][][]; levels?: CqLevels; reveal?: boolean }>(data);
  const lv = raw.levels;
  if (lv) {   // 重慶: the river island and the three plates
    const [ground, ...plates] = await Promise.all(['base', '1', '2', '3'].map(k => image(`${ASSETS}/maps/${lv.layers[k]}`)));
    const walls = await Promise.all([1, 2, 3].map(k => image(`${ASSETS}/maps/remake/chongqing/wall-${k}.webp`).catch(() => null)));
    return { board: parseBoard(raw), ground, sprites: raw.sprites ?? {}, decor: raw.decorations ?? [], stepMarks: !!raw.step_marks,
      levels: lv, plates: { 1: plates[0], 2: plates[1], 3: plates[2] },
      walls: Object.fromEntries(walls.flatMap((w, i) => (w ? [[i + 1, w]] : []))) };
  }
  // an official map made in the editor and exported as a map file (長安, maker/compile.ts officialFiles — the user
  // 2026-11-19: 「作為和東京大阪那些正式地圖一樣，點擊就開始遊戲」): its pieces' sizes, its pads (paths from maps/),
  // its passers-by, the buildings players put up and its look
  const mr = raw as MakerRaw;
  const pads = mr.pad_images ? Object.fromEntries(Object.entries(mr.pad_images).map(([k, p]) => [k, /^(https?:|\/)/.test(p) ? p : `${ASSETS}/maps/${p}`])) : null;
  return { board: parseBoard(raw), ground: await image(pic), sprites: raw.sprites ?? {}, decor: raw.decorations ?? [], stepMarks: !!raw.step_marks,
    ...(raw.walkers?.length ? { walkers: raw.walkers } : {}), ...(raw.reveal ? { reveal: true } : {}),
    ...(mr.landscape_scale?.length ? { landscapeScale: mr.landscape_scale } : {}), ...(mr.pad_scale ? { padScale: mr.pad_scale } : {}),
    ...(pads ? { padImages: await padPics(pads) } : {}),
    ...(mr.walker_kinds?.length ? { walkerKinds: mr.walker_kinds, walkerHot: mr.walker_hot ?? [], ...(mr.walker_areas ? { walkerAreas: mr.walker_areas } : {}) } : {}),
    ...(mr.build_sprites ? { builds: mr.build_sprites } : {}), ...(mr.theme ? { theme: mr.theme } : {}) };
}

/**
 * Only a map's records (no ground picture): 大富豪模式 builds all five cities' rules from these and loads the art
 * of the city on screen only (docs/rules/17 §12). Includes the JSON's optional `tycoon` overlay.
 */
export async function loadMapData(id: number): Promise<RawMap & { tycoon?: unknown }> {
  const mk = makerMaps.get(id);
  if (mk) return mk.raw;
  let entry = known.find(m => m.id === id);
  if (!entry && id >= 8 && id < 1000) { await mapList().catch(() => []); entry = known.find(m => m.id === id); }
  const base = id >= 1000 ? `${ASSETS}/maps/custom/${id}` : `${ASSETS}/maps/map-${id}`;
  return json(entry?.data ? `${ASSETS}/maps/${entry.data}` : `${base}.json`);
}

/**
 * The original pictures' file type: 'png' as extracted, 'webp' in the app (scripts/bundle-assets.mjs converts them,
 * losslessly, and says so in orig/manifest.json `ext`). For the frames the game names itself rather than by the manifest.
 */
export let origExt = 'png';
export function setOrigExt(ext: string | undefined) { origExt = ext === 'webp' ? 'webp' : 'png'; }

/** HD portrait for a character (Data.mkf #2, aligned 4x; WebP in the app), falling back to the original. */
export async function portrait(character: number): Promise<HTMLImageElement> {
  const n = String(character).padStart(3, '0');
  for (const url of [`${ASSETS}/hd/Data/0002-SMP/frame-${n}.webp`, `${ASSETS}/hd/Data/0002-SMP/frame-${n}.png`]) {
    try { return await image(url); } catch { /* the next */ }
  }
  return image(`${ASSETS}/orig/Data/0002-SMP/frame-${n}.${origExt}`);
}
