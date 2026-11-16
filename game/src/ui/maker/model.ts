/**
 * 自建地圖 (the user 2026-11-11): a player's own map, as data — a grid of cells, each holding one ground. What the map
 * looks like (the irregular coast and edges, the mixed textures, the beach, the woods) is worked out from this every
 * time it is drawn (ground-gl.ts), so the data stays small and every phone draws the same picture from the same seed.
 *
 * Kept on this phone in localStorage: an index of the maps (name, size, changed) and each map's own record.
 * Later layers (lasso shapes, roads, squares, lots, buildings) join the record as they are built.
 */
import type { MapSwitches } from '../../core/types';

/** The grounds, in the atlas's order (tools/tycoon-art/maker_terrain.py GROUNDS); a cell holds one of these ids. */
export const GROUNDS = [
  { key: 'deep-sea', name: '深海' }, { key: 'shallow-sea', name: '淺海' }, { key: 'lake', name: '湖水' },
  { key: 'beach', name: '沙灘' }, { key: 'grass', name: '草地' }, { key: 'forest', name: '樹林' },
  { key: 'flowers', name: '花叢' }, { key: 'mud', name: '泥地' }, { key: 'snow', name: '雪地' },
  { key: 'ice', name: '冰面' }, { key: 'desert', name: '沙漠' }, { key: 'red-earth', name: '紅土' },
  { key: 'rock', name: '岩石' }, { key: 'gravel', name: '碎石' }, { key: 'stone-brick', name: '石磚' },
  { key: 'asphalt', name: '柏油' }, { key: 'flagstone', name: '石板' }, { key: 'farmland', name: '農田' },
] as const;
export const G = Object.fromEntries(GROUNDS.map((g, i) => [g.key, i])) as Record<(typeof GROUNDS)[number]['key'], number>;
/** Water grounds: the sea's edge against land gets the beach, the surf and the shallows by itself. */
export const isWater = (g: number) => g <= G.lake;

/** One map cell in world pixels (a square of the walk, as the original's ~48 px step). */
export const CELL = 48;
/** The size sliders' range, in cells (台灣 is about 48 × 48). */
export const SIZE_MIN = 16, SIZE_MAX = 96;

/**
 * The road's squares (the user: squares on the grid, straight 8-direction steps like the originals): each on a cell,
 * linked to its neighbours along the road. `ev` its event (EVENTS), `style` the road's look from it (ROAD_STYLES).
 */
export interface MkNode { id: number; cx: number; cy: number; links: number[]; ev: number; style: number }
/**
 * A lot beside the road: on its own cell(s), bought from the square(s) it belongs to. `kind` 0 a small lot (one cell,
 * one square), 1 a large plot (2 × 2 cells, two squares). `price` one of LAND_PRICES / PLOT_PRICES.
 */
export interface MkLot { id: number; kind: 0 | 1 | 2; cx: number; cy: number; nodes: number[]; price: number; name: string; /** its street (MkStreet.id) */ street?: number; /** 微調 (layers.lotGeom): moved along / across its road (world px), turned (radians), sized (×). */ adj?: MkAdj; /** 強制放置: drawn on its own cell(s), wherever its squares are. */ free?: boolean; /** 企業大樓 (kind 2): its company's category (COMPANY_KINDS) and look (an original map sprite). */ co?: number; style?: number }
export interface MkAdj { u: number; v: number; a: number; s: number }
/**
 * A street (the user 2026-11-12): small lots that belong together — one name, one base price — as the originals' streets
 * (the game counts a street by its lots' shared name: owning the whole street raises the tolls).
 */
export interface MkStreet { id: number; name: string; price: number }
/**
 * A landmark, building or decoration: a sprite (maps/remake/sprites/<res>, eight facings drawn) standing at a world
 * point — turned to one of its eight facings and scaled (the user 2026-11-12: 「可以旋轉，可以放大縮小」).
 */
export interface MkThing { res: number; x: number; y: number; s: number; face: number }

/** The squares' events: the original codes (docs/rules/01), the pad (map#24 frame) each shows. */
export const EVENTS = [
  { ev: 0, name: '普通格', pad: -1 }, { ev: 14, name: '銀行', pad: 26 }, { ev: 15, name: '道具店', pad: 28 },
  { ev: 2, name: '新聞', pad: 2 }, { ev: 3, name: '命運', pad: 4 }, { ev: 13, name: '卡片', pad: 24 },
  { ev: 9, name: '樂透', pad: 16 }, { ev: 16, name: '魔法屋', pad: 30 }, { ev: 10, name: '50 點券', pad: 18 },
  { ev: 11, name: '30 點券', pad: 20 }, { ev: 12, name: '10 點券', pad: 22 }, { ev: 6, name: '小遊戲 1', pad: 10 },
  { ev: 7, name: '小遊戲 2', pad: 14 }, { ev: 8, name: '小遊戲 3', pad: 12 }, { ev: 1, name: '公園', pad: 0 },
  { ev: 5, name: '醫院', pad: 8 }, { ev: 4, name: '監獄', pad: 6 },
] as const;
/**
 * The event pads' size in a player's map against the originals' (the user 2026-11-12: a pad 2½ squares wide covered
 * the squares and lots beside it; the originals left 80 px round a pad, the editor's grid only 48).
 */
export const PAD_SCALE = 0.58;
/** A pad's width on the map in world px as the game draws it (124 screen px at the view's 1.2175 scale). */
export const PAD_W = (124 * PAD_SCALE) / 1.2175;
export const evInfo = (ev: number) => EVENTS.find(e => e.ev === ev) ?? EVENTS[0];
/** The roads' looks: surface, verge and markings (drawn as bands along the road, round at every bend). */
export const ROAD_STYLES = [
  { name: '公路', surface: '#6d7076', verge: '#3f4146', edge: '#f4f4f0', mid: '#ffffff', dash: [14, 12] },
  { name: '柏油路', surface: '#3d4046', verge: '#26282c', edge: '#f4f4f0', mid: '#f5c542', dash: [] as number[], double: true },
  { name: '泥路', surface: '#b98a55', verge: '#7a5634', edge: '', mid: '', dash: [] as number[] },
  { name: '鄉間小路', surface: '#c9a46a', verge: '#5f8f3a', edge: '', mid: '#6fae45', dash: [] as number[] },
  { name: '碎石路', surface: '#a7a39a', verge: '#6d6a63', edge: '', mid: '', dash: [] as number[] },
  { name: '石板路', surface: '#b9b2a6', verge: '#7b7468', edge: '#8e877b', mid: '', dash: [] as number[] },
  { name: '木棧道', surface: '#a8743f', verge: '#5d3c1d', edge: '#7a4f28', mid: '', dash: [] as number[] },
] as const;
export const LAND_PRICES = [500, 800, 1000, 1500, 2000, 2500];
/**
 * 企業大樓 (the user 2026-11-16: 「自製地圖上沒有建保險公司、修電腦、加油站、出國觀光機場…這些上市公司的選項」, 還有
 * 建設公司; several looks to choose from): a 2 × 2 plot on two squares holding one of the originals' companies — stopping
 * there pays its fee to the largest shareholder, who gets the company's own service (docs/rules/02 §5). `cat` the
 * company category, `fee` / `value` the original maps' record of it, `styles` the buildings it can look like (map
 * sprites: the record's resource, drawn as map#resource+38), the first the default.
 */
export const COMPANY_KINDS = [
  { cat: 4, name: '保險公司', firm: '保險公司', what: '停下買保險（轉盤天數）付保險費；大股東免費加保險', fee: 750, value: 400000, styles: [134, 137, 148, 162, 185] },
  { cat: 3, name: '電腦公司', firm: '電腦公司', what: '停下付電腦費（每天累計）', fee: 150, value: 2400000, styles: [135, 138] },
  { cat: 6, name: '加油站', firm: '石油公司', what: '開車、騎車停下付加油費', fee: 500, value: 120000, styles: [143] },
  { cat: 5, name: '汽車公司', firm: '汽車公司', what: '開車、騎車停下付修車費', fee: 700, value: 270000, styles: [141] },
  { cat: 1, name: '航空公司', firm: '航空公司', what: '停下出國觀光幾天，付旅遊費', fee: 2500, value: 244000, styles: [140] },
  { cat: 11, name: '建設公司', firm: '建設公司', what: '停下替自己的地加蓋一層，付工程費；大股東免費加蓋', fee: 5000, value: 244000, styles: [136] },
] as const;
export const companyKind = (cat: number | undefined) => COMPANY_KINDS.find(k => k.cat === cat);
/** The looks' names (the original map each comes from). */
export const STYLE_NAMES: Record<number, string> = { 134: '臺灣', 137: '日本', 148: '星際', 162: '恐龍', 185: '武俠', 135: '日本', 138: '美國', 143: '中國', 141: '日本', 140: '美國', 136: '日本' };
export const PLOT_PRICES = [4000, 5000, 6000];

/**
 * The map's light (the user 2026-11-12: the shadows were far too heavy; make them adjustable): the shadow falls toward
 * `angle` (degrees, 0 = right, 90 = down), `length` world px long, `soft` 0 hard .. 1 soft, `strength` 0 none .. 1 dark;
 * `rim` the line along every border between grounds, 0 none .. 1 dark.
 */
export interface MkLight { angle: number; length: number; soft: number; strength: number; rim: number }
export const DEFAULT_LIGHT: MkLight = { angle: 50, length: 7, soft: 0.7, strength: 0.35, rim: 0.35 };

/**
 * The ground textures' look (the user 2026-11-12: far too big; sliders for the size, the angle and the randomness):
 * `size` one texture tile in world px (a cell is 48), `angle` degrees, `random` 0 one tile repeated .. 1 four tiles mixed.
 */
export interface MkTex { size: number; angle: number; random: number }
export const DEFAULT_TEX: MkTex = { size: 52, angle: 0, random: 0.7 };

/**
 * 樹林's look (the user 2026-11-12: keep both, the randomness adjustable; ui/maker/woods.ts): `mode` 0 trees planted one
 * by one, 1 the forest texture alone; `density` how many of a cell's places hold a tree, `size` the trees' size,
 * `spread` how far sizes differ, `colour` how far greens differ, `strays` trees just outside the wood (all 0..1 but
 * size, 0.6..1.6); `seed` 重新隨機.
 */
export interface MkWood { mode: 0 | 1; density: number; size: number; spread: number; colour: number; strays: number; seed: number }
export const DEFAULT_WOOD: MkWood = { mode: 0, density: 0.75, size: 1, spread: 0.6, colour: 0.6, strays: 0.4, seed: 1 };

export interface MakerMap {
  v: 1;
  id: string;
  name: string;
  w: number;
  h: number;
  /** The noise seed: the coast and every edge come from it, the same on every phone. */
  seed: number;
  /** The ground the map started with (the eraser paints it back). */
  base: number;
  /** One ground id per cell, row by row. */
  cells: Uint8Array;
  /** The shadows' settings (DEFAULT_LIGHT when missing). */
  light?: MkLight;
  /** The map's own news and fate cards (ui/maker/deck.ts; none or empty: the original decks). */
  deck?: { news: string[]; fate: string[]; words?: Record<string, string> };
  /** The ground textures' size, angle and randomness (DEFAULT_TEX when missing). */
  tex?: MkTex;
  /** 股票: the stock table used as the template (0..7) and the map's own names by slot ('' or missing: the table's). */
  stocks?: { group: number; names: string[] };
  /** 特殊規則 (rules.ts): the rules the map's maker switched on. */
  switches?: MapSwitches;
  /** playHash of the map when its maker last won a game on it (see cleared). */
  cleared?: string;
  /** Its id in the 地圖庫 once sent there (library.ts). */
  published?: string;
  /** A map taken from the 地圖庫: its id there and its maker. */
  from?: { id: string; author: string };
  /** 樹林's look (DEFAULT_WOOD when missing). */
  wood?: MkWood;
  nodes: MkNode[];
  lots: MkLot[];
  streets: MkStreet[];
  things: MkThing[];
  /** The next id for a square / a lot. */
  nextId: number;
  created: number;
  changed: number;
}

/**
 * A map's state as its maker sees it (the user 2026-11-13: which maps were tried out and may go to the library):
 * 已發布, 可發布 (a 試玩 passed, nothing changed since) or 未試玩 — the tag's text and its class.
 */
/**
 * The sample map 梨園萊陽 (editor/maker_laiyang.py) and every map made from it keep its noise seed: such a map may be
 * played and edited but never sent to 創作樂園 (the user 2026-11-13: or the library fills with copies of it). The
 * server refuses it too (tools/party-relay/maps.mjs).
 */
export const SAMPLE_SEED = 2026108;
export const fromSample = (m: { seed?: number }) => m.seed === SAMPLE_SEED;
/**
 * Only a map of one's own goes to 創作樂園 (the user 2026-11-13): one made with 新建地圖 or 隨機創建. The sample, and a
 * map taken from 創作樂園 (`from`) and whatever is edited from them, may be played and changed but not sent; the server
 * knows them by their seed too.
 */
export const notOwn = (m: { seed?: number; from?: unknown }) => fromSample(m) || !!m.from;

/** A map's name at most this long (the user 2026-11-13: on one line everywhere). */
export const NAME_MAX = 7;

export const mapStatus = (e: { won?: boolean; pub?: boolean }): [string, string] => (e.pub ? ['已發布', 'pub'] : e.won ? ['試玩通過・可發布', 'won'] : ['未試玩', 'new']);
export const mapStatusTag = (e: { won?: boolean; pub?: boolean }) => { const [t, c] = mapStatus(e); return `<em class="mk-st ${c}">${t}</em>`; };

/**
 * A map's small picture (the user 2026-11-13: 我的地圖 should show the map): a JPEG data: URL kept beside the map,
 * made when the editor closes (editor.ts) or taken with a map from 創作樂園 (library.ts).
 */
const THUMB = (id: string) => `rich4.maker.thumb.${id}`;
export const loadThumb = (id: string): string | null => { try { return localStorage.getItem(THUMB(id)); } catch { return null; } };
export const dropThumb = (id: string) => { try { localStorage.removeItem(THUMB(id)); } catch { /* none */ } };
export const saveThumb = (id: string, url: string) => { try { localStorage.setItem(THUMB(id), url); } catch { /* not kept: the map matters more */ } };

export interface MapEntry { id: string; name: string; w: number; h: number; changed: number; won?: boolean; pub?: boolean; by?: string }

const INDEX = 'rich4.maker.index';
const KEY = (id: string) => `rich4.maker.map.${id}`;

export function newMap(name: string, w: number, h: number, base: number): MakerMap {
  const now = Date.now();
  return { v: 1, id: now.toString(36) + Math.random().toString(36).slice(2, 6), name, w, h, seed: (Math.random() * 1e9) >>> 0, base,
    cells: new Uint8Array(w * h).fill(base), nodes: [], lots: [], streets: [], things: [], nextId: 1, created: now, changed: now };
}

/** Cells as text: run-length pairs (ground, count) in base64 — a painted map is mostly long runs. */
function packCells(c: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < c.length;) {
    let n = 1;
    while (i + n < c.length && c[i + n] === c[i] && n < 255) n++;
    out.push(c[i], n);
    i += n;
  }
  let s = '';
  for (const b of out) s += String.fromCharCode(b);
  return btoa(s);
}
function unpackCells(t: string, size: number): Uint8Array {
  const s = atob(t), c = new Uint8Array(size);
  let k = 0;
  for (let i = 0; i + 1 < s.length; i += 2) { c.fill(s.charCodeAt(i), k, k + s.charCodeAt(i + 1)); k += s.charCodeAt(i + 1); }
  return c;
}

export function listMaps(): MapEntry[] {
  try { return (JSON.parse(localStorage.getItem(INDEX) ?? '[]') as MapEntry[]).sort((a, b) => b.changed - a.changed); } catch { return []; }
}

/**
 * What the game plays on the map — its size, squares, lots, streets, cards and stocks; not its looks — as a short
 * fingerprint: a win counts for the map only while this stays the same (the user 2026-11-12: 「必須得親自在這個地圖裡玩
 * 贏一局…才有權利上傳」).
 */
export function playHash(m: MakerMap): string {
  // (a lot's 微調 is its look only)
  // (特殊規則 joined the list later: only when there are some, so the wins before it stand)
  const s = JSON.stringify([m.w, m.h, m.nodes, m.lots.map(({ adj: _a, style: _s, ...l }) => l), m.streets, m.deck ?? null, m.stocks ?? null, ...(m.switches ? [m.switches] : [])]);
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b + c, 0x5bd1e995) ^ (b >>> 15); }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
/** Whether the map's maker has won on it as it is now. */
export const cleared = (m: MakerMap) => !!m.cleared && m.cleared === playHash(m);

/** The map as it is saved and sent: the cells packed (RLE, base64). */
export const savedForm = (m: MakerMap) => ({ ...m, cells: packCells(m.cells) });

export function saveMap(m: MakerMap): boolean {
  m.changed = Date.now();
  try {
    localStorage.setItem(KEY(m.id), JSON.stringify(savedForm(m)));
    const list = listMaps().filter(e => e.id !== m.id);
    list.unshift({ id: m.id, name: m.name, w: m.w, h: m.h, changed: m.changed, ...(cleared(m) ? { won: true } : {}), ...(m.published ? { pub: true } : {}), ...(m.from ? { by: m.from.author } : {}) });
    localStorage.setItem(INDEX, JSON.stringify(list));
    return true;
  } catch { return false; }
}

/** A map from its saved text form (localStorage, a sample, later a download). */
export function parseMap(r: { v?: number; w: number; h: number; cells: string } | null): MakerMap | null {
  if (!r || r.v !== 1) return null;
  return { nodes: [], lots: [], streets: [], things: [], nextId: 1, ...(r as object), cells: unpackCells(r.cells, r.w * r.h) } as unknown as MakerMap;
}

export function loadMap(id: string): MakerMap | null {
  try { return parseMap(JSON.parse(localStorage.getItem(KEY(id)) ?? 'null')); } catch { return null; }
}

/** The map last open in the editor (offered first: 「繼續上次的地圖」). */
const LAST = 'rich4.maker.last';
export function lastMap(): string | null { try { return localStorage.getItem(LAST); } catch { return null; } }
export function setLastMap(id: string) { try { localStorage.setItem(LAST, id); } catch { /* nothing kept */ } }

export function deleteMap(id: string) {
  try {
    localStorage.removeItem(KEY(id));
    localStorage.removeItem(THUMB(id));
    localStorage.setItem(INDEX, JSON.stringify(listMaps().filter(e => e.id !== id)));
  } catch { /* nothing kept */ }
}
