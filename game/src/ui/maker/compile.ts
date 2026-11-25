/**
 * 自建地圖's 試玩: the editor's map made into a map the game plays — the records the original stores (docs/rules/01
 * §1, 02 §0.3; as editor/city_build.py writes them for the remake's cities) and one ground picture (the live ground,
 * the roads and the lots' chalk outlines drawn into it). Registered with ui/assets.ts under a map id of its own for
 * this run of the app, then started like any game.
 */
import { pack } from '../../core/date';
import type { GameSettings } from '../../core/types';
import { parseBoard, type Board, type RawMap } from '../../core/board';
import { registerMakerMap, type MapDecor, type MapSprites } from '../assets';
import { gameDeck } from './deck';
import { gameSwitches } from './rules';
import { GroundGL } from './ground-gl';
import { companySlots, stockNames, TEMPLATE_COMPANIES, type CoBind } from './stocks';
import { drawWoodsFull } from './woods';
import { drawLots, drawRoads, facingTo, lotGeom, wx, wy, SPRITE_SCALE, type Frames } from './layers';
import { CELL, companyKind, evInfo, G, isWater, listMaps, loadMap, loadPaint, loadThumb, PAD_SCALE, padUrl, parseMap, playHash, saveMap, saveThumb, type MakerMap } from './model';
import { ASSETS } from '../assets';
import { isOrig, pieceDir, pieceFrames } from './pieces';
import { ConverterFactory } from 'opencc-js/core';
import ST_CHARACTERS from 'opencc-js/dict/STCharacters';

/** Event → its pad (map#24 frame + 1), as the originals (city_build.AUX). */
const AUX: Record<number, number> = { 1: 1, 2: 3, 3: 5, 4: 7, 5: 9, 6: 11, 7: 15, 8: 13, 9: 17, 10: 19, 11: 21, 12: 23, 13: 25, 14: 27, 15: 29, 16: 31 };
/** Land price → build cost per level, tolls for levels 0..5; plot price → fees (city_build.LAND_TIERS, FAC_TIERS). */
const LAND_TIERS: Record<number, [number, number[]]> = {
  500: [100, [100, 250, 700, 1800, 3500, 6600]], 800: [150, [150, 400, 1000, 2400, 5000, 9000]],
  1000: [200, [200, 500, 1200, 2800, 6000, 10000]], 1500: [300, [300, 750, 2000, 4800, 10000, 18000]],
  2000: [400, [400, 1000, 2400, 6000, 12500, 22000]], 2500: [500, [500, 1200, 3000, 7500, 16000, 30000]],
};
/** Any base price: the nearest tier's build cost and tolls, scaled (as editor/maker/compiler.py tier()). */
function tier(price: number): [number, number[]] {
  const base = Object.keys(LAND_TIERS).map(Number).reduce((a, b) => (Math.abs(b - price) < Math.abs(a - price) ? b : a));
  const [build, tolls] = LAND_TIERS[base];
  if (base === price) return [build, tolls];
  const sc = (v: number) => Math.max(10, Math.min(65535, Math.round((v * price) / base / 10) * 10));
  return [sc(build), tolls.map(sc)];
}
const FAC_TIERS: Record<number, number[]> = { 4000: [400, 1000, 2500, 5000, 8000], 5000: [500, 1200, 3000, 6000, 10000], 6000: [600, 1500, 4000, 8000, 12000] };

// ---------------------------------------------------------------- Big5 (the records keep names as the original did)
let big5: Map<string, [number, number]> | null = null;
/**
 * Issue #104 (a lot named in Simplified: 「水□广□」 on the board): the game's records keep names in Big5, which has no
 * Simplified-only characters (乐, 场 …) — such a character is written as its Traditional one (opencc's STCharacters,
 * its first choice). The names as written go with the records too (RawRecord.name) and are the ones shown.
 */
let s2t: ((s: string) => string) | null = null;
const traditional = (ch: string) => (s2t ??= ConverterFactory([ST_CHARACTERS]))(ch);

function big5Bytes(text: string, width: number): Uint8Array {
  if (!big5) {
    big5 = new Map();
    const dec = new TextDecoder('big5');
    for (let a = 0x81; a <= 0xfe; a++) for (const [lo, hi] of [[0x40, 0x7e], [0xa1, 0xfe]]) for (let b = lo; b <= hi; b++) {
      const ch = dec.decode(new Uint8Array([a, b]));
      if (ch.length === 1 && ch !== '�' && !big5.has(ch)) big5.set(ch, [a, b]);
    }
  }
  const out = new Uint8Array(width);
  let k = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const bytes = code < 0x80 ? [code] : big5.get(ch) ?? big5.get(traditional(ch)) ?? big5.get('□')!;
    if (k + bytes.length >= width) break;
    for (const v of bytes) out[k++] = v;
  }
  return out;
}

const hex = (b: Uint8Array) => Array.from(b, v => v.toString(16).padStart(2, '0')).join('');

const facing = facingTo;

/** The map's records: squares numbered 1.. in their order, lots and plots after them. */
/** An official map's own pads by board square (MapArt.padImages), none for a player's map. */
function padImages(m: MakerMap, ids: Map<number, number>): { pad_images?: Record<number, string> } {
  if (!m.pads) return {};
  const out: Record<number, string> = {};
  for (const n of m.nodes) { const u = padUrl(m, n, `${ASSETS}/maps/remake/maker`); if (u) out[ids.get(n.id)!] = u; }
  return { pad_images: out };
}

export function records(m: MakerMap): RawMap & { decorations: MapDecor[]; sprites: MapSprites; step_marks: boolean; landscape_scale: number[]; pad_scale: number } {
  const ids = new Map(m.nodes.map((n, i) => [n.id, i + 1]));
  const smalls = m.lots.filter(l => !l.kind), bigs = m.lots.filter(l => l.kind === 1);
  const landId = new Map(smalls.map((l, i) => [l.id, i + 1])), facId = new Map(bigs.map((l, i) => [l.id, i + 1]));
  const lotOf = new Map<number, (typeof m.lots)[number]>();
  for (const l of m.lots) for (const n of l.nodes) lotOf.set(n, l);
  const lotX = (l: (typeof m.lots)[number]) => Math.round(lotGeom(m, l).x), lotY = (l: (typeof m.lots)[number]) => Math.round(lotGeom(m, l).y);
  // a lot of a street takes the street's name and base price (the game knows a street by the shared name)
  const streetOf = new Map(m.streets.map(s => [s.id, s]));
  const nameOf = (l: (typeof m.lots)[number]) => (l.street !== undefined && streetOf.get(l.street)?.name) || l.name;
  const priceOf = (l: (typeof m.lots)[number]) => (l.street !== undefined && streetOf.get(l.street)?.price) || l.price;
  // the template's companies (stocks.ts TEMPLATE_COMPANIES; the user 2026-11-13: 萊陽商城's largest holder had no gift
  // at the 道具店, 萊陽農商行's no 融資): the bank on every 銀行 square, the department store on every 道具店, the
  // others with no square (the insurer pays the 理賠金); none has a building of its own on a player's map
  const toward = (l: (typeof m.lots)[number]) => {
    const ns = m.nodes.filter(n => l.nodes.includes(n.id));
    return facing(ns.reduce((s, n) => s + wx(n), 0) / ns.length, ns.reduce((s, n) => s + wy(n), 0) / ns.length, lotX(l), lotY(l));
  };
  // and the 企業大樓 (kind 2, the user 2026-11-16): each one company of the map on its own two squares (stocks.ts companySlots)
  const group = ((m.stocks?.group ?? 0) % 8 + 8) % 8, names = stockNames(m), binds = companySlots(m);
  const banks = m.nodes.filter(n => n.ev === 14 && !lotOf.has(n.id)), shops = m.nodes.filter(n => n.ev === 15 && !lotOf.has(n.id));
  const companies: { id: number; raw_hex: string }[] = [], coRef = new Map<number, number>();
  const at = banks[0] ?? shops[0] ?? m.nodes[0];
  const record = (slot: number, cat: number, value: number, fee: number, x: number, y: number, look = 0, face = 0) => {
    const id = companies.length + 1, b = new Uint8Array(52), v = new DataView(b.buffer);
    v.setInt16(0, x, true); v.setInt16(2, y, true);
    b.set(big5Bytes(names[slot] ?? '', 16), 4);
    b[0x19] = slot; b[0x1a] = cat; b[0x1b] = face;
    v.setUint16(0x20, look, true); v.setUint16(0x22, fee, true); v.setInt32(0x24, value, true);
    companies.push({ id, raw_hex: hex(b), ...(names[slot] ? { name: names[slot] } : {}) });
    return id;
  };
  const building = new Map([...binds].map(([lid, b]) => [b.tpl, lid]));
  const put = (lid: number, b: CoBind) => {
    const l = m.lots.find(x => x.id === lid)!, kind = companyKind(b.cat);
    // (an official map's own 企業大樓 — 長安's Tang buildings, map sprites ≥ 9000 — keep their sprite; pieces() registers it)
    const look = (l.style ?? 0) >= 9000 ? l.style! - 38 : kind?.styles.includes(l.style as never) ? l.style! : kind?.styles[0] ?? 0;
    const id = record(b.slot, b.cat, b.value, b.fee, lotX(l), lotY(l), look, toward(l));
    for (const n of l.nodes) coRef.set(n, 6000 + id);
  };
  TEMPLATE_COMPANIES[group].forEach(([slot, cat, value, fee], k) => {
    const lid = building.get(k);
    if (lid !== undefined) { put(lid, binds.get(lid)!); return; }
    const sq = cat === 7 ? banks : cat === 10 ? shops : [];
    const where = sq[0] ?? at;
    const id = record(slot, cat, value, fee, where ? wx(where) : 0, where ? wy(where) : 0);
    for (const n of sq) coRef.set(n.id, 6000 + id);
  });
  for (const [lid, b] of binds) if (b.tpl < 0) put(lid, b);
  const nodes = m.nodes.map((n, i) => {
    const lot = lotOf.get(n.id);
    let ref = 0, aux = 0;
    if (lot) ref = lot.kind === 2 ? coRef.get(n.id) ?? 0 : lot.kind ? 4000 + facId.get(lot.id)! : 2000 + landId.get(lot.id)!;
    if (n.ev === 5) ref = 8001;
    if (n.ev === 4) ref = 8002;
    if (!lot && coRef.has(n.id)) ref = coRef.get(n.id)!;
    if (n.ev) aux = AUX[n.ev] ?? 0; else if (!lot) aux = 33;
    const water = isWater(m.cells[Math.floor(n.cy + .5) * m.w + Math.floor(n.cx + .5)]);
    const status = (n.ev | (water ? 0x80000000 : 0)) >>> 0;
    const links = n.links.map(id => ids.get(id) ?? 0).filter(Boolean).slice(0, 4);
    while (links.length < 4) links.push(0);
    const name = lot ? (lot.kind === 2 ? names[binds.get(lot.id)?.slot ?? -1] ?? '' : nameOf(lot)) : n.ev ? evInfo(n.ev).name.replace(/\s/g, '') : '';
    const b = new Uint8Array(40), v = new DataView(b.buffer);
    v.setInt16(0, wx(n), true); v.setInt16(2, wy(n), true);
    b.set(big5Bytes(name, 20), 4);
    links.forEach((x, k) => v.setUint16(24 + k * 2, x, true));
    v.setUint16(32, ref, true); v.setUint16(34, aux, true); v.setUint32(36, status, true);
    return { id: i + 1, raw_hex: hex(b) };
  });
  const lands = smalls.map((l, i) => {
    const price = priceOf(l), [build, tolls] = tier(price);
    const b = new Uint8Array(52), v = new DataView(b.buffer);
    v.setInt16(0, lotX(l), true); v.setInt16(2, lotY(l), true);
    b.set(big5Bytes(nameOf(l), 16), 4);
    b[0x1b] = toward(l);
    v.setUint16(0x1c, price, true); v.setUint16(0x1e, build, true);
    tolls.forEach((t, k) => v.setUint16(0x20 + k * 2, t, true));
    return { id: i + 1, raw_hex: hex(b), ...(nameOf(l) ? { name: nameOf(l) } : {}) };
  });
  const facilities = bigs.map((l, i) => {
    const fees = FAC_TIERS[l.price] ?? FAC_TIERS[5000];
    const b = new Uint8Array(56), v = new DataView(b.buffer);
    v.setInt16(0, lotX(l), true); v.setInt16(2, lotY(l), true);
    b.set(big5Bytes(l.name, 16), 4);
    b[0x1b] = toward(l);
    v.setUint16(0x22, l.price, true); v.setUint16(0x24, fees[0], true);
    fees.forEach((f, k) => v.setUint16(0x26 + k * 2, f, true));
    return { id: i + 1, raw_hex: hex(b), ...(l.name ? { name: l.name } : {}) };
  });
  // (the world is square, its side the longer one: see squared)
  return { map_id: 0, name: m.name, width: Math.max(m.w, m.h) * CELL, nodes, lands, facilities, companies, landscapes: [], decorations: [], sprites: {}, step_marks: true, landscape_scale: [], pad_scale: PAD_SCALE, ...(m.reveal ? { reveal: true } : {}), ...padImages(m, ids), ...(m.crowd?.kinds.length ? { walkers: m.crowd.paths, walker_kinds: m.crowd.kinds, walker_hot: m.crowd.hot ?? [], ...(m.crowd.areas?.length ? { walker_areas: m.crowd.areas } : {}) } : {}), ...(m.builds ? { build_sprites: m.builds } : {}), ...(m.rules ? { theme: m.rules } : {}), ...(m.specials ? { specials: Object.fromEntries(Object.entries(m.specials).flatMap(([k, v]) => (ids.has(Number(k)) ? [[String(ids.get(Number(k))), v]] : []))) } : {}),
    stock_group: m.stocks?.group ?? 0, ...(m.stocks?.names.some(Boolean) || binds.size ? { stock_names: stockNames(m) } : {}) };
}

/** The pieces: buildings with eight facings as landscapes (turned, scaled), the rest (plants: seasons) as decorations. */
async function pieces(m: MakerMap, raw: ReturnType<typeof records>) {
  const res = [...new Set([...m.things.map(t => t.res), ...m.lots.filter(l => l.kind === 2 && (l.style ?? 0) >= 9000).map(l => l.style!), ...(m.crowd?.kinds ?? []), ...(m.crowd?.areas ?? []).flatMap(a => a[4]), ...(m.builds ? [...m.builds.lots.flat(), ...Object.values(m.builds.fac).flat(), ...(m.builds.chain ? [m.builds.chain] : [])] : [])])];
  const frames = new Map<number, Frames['frames']>();
  await Promise.all(res.map(r => pieceFrames(r).then(f => frames.set(r, f)).catch(() => {})));
  // (the dir from the maps' folder: the original's sprites are in hd/, beside it)
  for (const r of res) if (frames.has(r)) raw.sprites[`map/${r}`] = { dir: isOrig(r) ? `../${pieceDir(r)}` : `remake/sprites/${r}`, frames: frames.get(r)! };
  for (const t of m.things) {
    const f = frames.get(t.res);
    if (!f) continue;
    if (f.length >= 8) {
      const b = new Uint8Array(28), v = new DataView(b.buffer);
      v.setInt16(0, t.x, true); v.setInt16(2, t.y, true);
      v.setUint16(0x18, t.face, true); v.setUint16(0x1a, t.res - 38, true);
      raw.landscapes.push({ id: raw.landscapes.length + 1, raw_hex: hex(b) });
      raw.landscape_scale.push(t.s);
    } else raw.decorations.push({ x: t.x, y: t.y, res: t.res, ...(t.s !== 1 ? { s: t.s } : {}) });
  }
  void SPRITE_SCALE;
}

/**
 * The map made square for play (issue #95: a map taller than wide — the game's world, its camera and the minimap are
 * square, `width` a side — showed the minimap off and the view stopped short of the bottom): the short side filled out
 * with deep sea, right or below; every position stays where it was.
 */
function squared(m: MakerMap): MakerMap {
  if (m.w === m.h) return m;
  const S = Math.max(m.w, m.h), cells = new Uint8Array(S * S).fill(G['deep-sea']);
  for (let y = 0; y < m.h; y++) cells.set(m.cells.subarray(y * m.w, (y + 1) * m.w), y * S);
  return { ...m, w: S, h: S, cells };
}

/** The ground picture: the live ground at full size, the roads and the lots' outlines over it. */
export async function groundPicture(m: MakerMap): Promise<HTMLImageElement> {
  const W = m.w * CELL, H = m.h * CELL;
  const gl = await new Promise<GroundGL>((ok, fail) => {
    try { const g: GroundGL = new GroundGL(m, `${ASSETS}/maps/remake/maker/atlas.webp`, () => ok(g)); g.loaded.catch(fail); } catch (e) { fail(e); }
  });
  gl.grid = false;
  gl.canvas.width = W; gl.canvas.height = H;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  gl.draw(0, 0, 1);
  x.drawImage(gl.canvas, 0, 0);
  const paint = await loadPaint(m, `${ASSETS}/maps/remake/maker`);
  if (paint) x.drawImage(paint, 0, 0);   // (its own size: the map before squared() padded it)
  if (!paint) await drawWoodsFull(x, m);   // (an official map's painting has its own woods: the user saw cartoon trees over it)
  // the road textures load once; wait for them before drawing the roads for good
  await new Promise<void>(ok => { let n = 0; const tick = () => { drawRoads(document.createElement('canvas').getContext('2d')!, m, () => {}); if (++n > 20) ok(); else setTimeout(tick, 60); }; tick(); });
  drawRoads(x, m, () => {});
  // (an official map's 企業大樓 stands on ground of its own: no chalk frame round it — the user 2026-11-19: 「要是這些地方是
  // 公司的話，你就不要弄一個實心的地塊圍出來了」)
  drawLots(x, paint ? { ...m, lots: m.lots.filter(l => l.kind !== 2) } : m);
  const blob = await new Promise<Blob>((ok, fail) => c.toBlob(b => (b ? ok(b) : fail(new Error('ground'))), 'image/webp', 0.9));
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

/**
 * An official map made in the editor (長安, editor/maker_changan.py) as a classic map file for the 自製地圖 list (the user
 * 2026-11-19: 「不要走編輯器格式，而是作為和東京大阪那些正式地圖一樣，點擊就開始遊戲」): its records — the same as 試玩's,
 * the pads' pictures by path from maps/ — and its ground picture. The map id and the rules come from the list
 * (maps/remake/index.json, core MAP_RULES). Run in the dev page: tools/tycoon-art/export_official.mjs.
 */
export async function officialFiles(m: MakerMap, id: number): Promise<{ raw: ReturnType<typeof records>; ground: Blob }> {
  const raw = records(m);
  await pieces(m, raw);
  raw.map_id = id;
  const r = raw as ReturnType<typeof records> & { pad_images?: Record<number, string> };
  if (r.pad_images) for (const k of Object.keys(r.pad_images)) r.pad_images[Number(k)] = r.pad_images[Number(k)].replace(`${ASSETS}/maps/`, '');
  const img = await groundPicture(squared(m));
  const ground = await fetch(img.src).then(x => x.blob());
  return { raw, ground };
}

/**
 * The small pictures 我的地圖 lacks (maps made before pictures were kept, or never closed in the editor): drawn from the
 * ground picture one map after another, kept, and `got` called with each.
 */
let thumbing = false;
export async function makeThumbs(ids: string[], got: (id: string, url: string) => void) {
  if (thumbing) return;
  thumbing = true;
  try {
    for (const id of ids) {
      if (loadThumb(id)) continue;
      const m = loadMap(id);
      if (!m) continue;
      try {
        const img = await groundPicture(m), S = 200, c = document.createElement('canvas');
        c.width = c.height = S;
        const x = c.getContext('2d')!, k = Math.min(S / img.width, S / img.height);
        x.fillStyle = '#123a7a'; x.fillRect(0, 0, S, S);
        x.drawImage(img, (S - img.width * k) / 2, (S - img.height * k) / 2, img.width * k, img.height * k);
        URL.revokeObjectURL(img.src);
        const url = c.toDataURL('image/jpeg', 0.7);
        saveThumb(id, url); got(id, url);
      } catch { /* none this time */ }
    }
  } finally { thumbing = false; }
}

let nextPlayId = 5000;
/**
 * Builds the map for the game (its records, pieces and ground picture) under a new map id for this run of the app;
 * resolves with that id and what the game's settings take from the map (its own cards).
 */
export async function prepareMakerMap(m: MakerMap, at?: number): Promise<{ mapId: number; extra: Partial<GameSettings> }> {
  const raw = records(m);
  await pieces(m, raw);
  // (`at`: 派對模式's library map, the same id on every phone, party-lib.ts)
  const id = at ?? nextPlayId++;
  raw.map_id = id;
  // a win on it, the map as it was when the game began, marks the saved map 已通關 (whatever was changed meanwhile decides)
  const hash = playHash(m);
  registerMakerMap(id, raw, await groundPicture(squared(m)), () => {
    const cur = loadMap(m.id);
    if (cur && playHash(cur) === hash) { cur.cleared = hash; saveMap(cur); }
  }, m.name);
  const sw = gameSwitches(m);
  return { mapId: id, extra: { ...(gameDeck(m) ? { deck: gameDeck(m) } : {}), ...(sw ? { mapRules: sw } : {}), ...(m.rules ? { ruleSet: m.rules } : {}) } };
}

/**
 * A saved game on a player's map (the user 2026-11-15: an autosave gave 「讀取存檔失敗：Load failed」 — the map's id was
 * only the run's that began it): built again under the save's id from the map the save carries (GameSettings.myMap); a
 * save from before that finds the 我的地圖 map whose squares are where the save's are.
 */
export async function restoreMakerMap(s: GameSettings, board: Board): Promise<void> {
  const m = (s.myMap ? parseMap(s.myMap as never) : null) ?? mapOfBoard(board);
  if (!m) throw new Error('這局用的自建地圖已經刪除或改過了');
  await prepareMakerMap(m, s.mapId);
  if (s.mapId >= nextPlayId) nextPlayId = s.mapId + 1;
}
function mapOfBoard(b: Board): MakerMap | null {
  const key = (ns: { x: number; y: number }[]) => ns.map(n => `${n.x},${n.y}`).join(';');
  const want = key(b.nodes);
  for (const e of listMaps()) {
    const m = loadMap(e.id);
    try { if (m && key(parseBoard(records(m)).nodes) === want) return m; } catch { /* not this one */ }
  }
  return null;
}

/**
 * 試玩 (the user 2026-11-12: not a normal game): one human and `computers` computers (1-3), always 10 萬 and no 點券,
 * no saving (ui/main.ts, GameSettings.trial); the first bankruptcy lets the map be published.
 */
export async function playMap(m: MakerMap, start: (s: GameSettings) => void, computers = 3): Promise<void> {
  const { mapId: id, extra } = await prepareMakerMap(m);
  const today = new Date();
  start({
    mapId: id, players: [{ character: 0, human: true }, ...[4, 9, 11].slice(0, Math.max(1, Math.min(3, computers))).map(character => ({ character, human: false }))],
    fundIndex: 2, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, trial: true,
    startDate: pack(today.getFullYear(), today.getMonth() + 1, today.getDate()), seed: (Math.random() * 2 ** 32) >>> 0,
    ...extra,
  } as GameSettings);
}
