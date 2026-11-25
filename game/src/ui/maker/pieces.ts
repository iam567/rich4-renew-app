/**
 * The pieces' tabs and kinds (the user 2026-11-17: 地面 道路 格子 地標 建築 植被 裝飾; 地標 by continent, 建築 酒店 / 小屋 /
 * 特色, 植被 熱帶 / 溫帶 / 沙漠 / 海灘, 裝飾 人物 / 動物 (dinosaurs too) / 車輛 / 小物). Sorted by the sprite's group (the
 * hundreds of its number) and, where a group mixes kinds, piece by piece (looked over 2026-11-17).
 *
 * The original game's own map sprites (the eight original maps' houses, shops, parks, landmarks, dinosaurs; the user
 * 2026-11-17: 老版本的地圖素材都放進素材庫) are pieces too: ORIG_BASE + their resource number (hd/map/0201-SPR → 8201),
 * drawn from the redrawn hd frames the game already carries — the duplicates (the same picture under another number) left out.
 */
import { ASSETS } from '../assets';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const PIECE_TABS = {
  地標: ['亞洲', '歐洲', '美洲', '非洲', '大洋洲'],
  建築: ['酒店', '小屋', '特色'],
  植被: ['熱帶', '溫帶', '沙漠', '海灘'],
  裝飾: ['人物', '動物', '車輛', '小物'],
} as const;
export type PieceTab = keyof typeof PIECE_TABS;
export type PieceKind = (typeof PIECE_TABS)[PieceTab][number];
export const TAB_OF_KIND = Object.fromEntries(Object.entries(PIECE_TABS).flatMap(([t, ks]) => ks.map(k => [k, t]))) as Record<PieceKind, PieceTab>;

// ---------------------------------------------------------------- the original game's sprites
export const ORIG_BASE = 8000;
export const isOrig = (res: number) => res >= ORIG_BASE && res < ORIG_BASE + 1000;
/** The original's sprites offered (hd/map/<n>-SPR), each picture once. */
const ORIG_DUPES = new Set([74, 75, 76, 77, 78, 80, 81, 82, 86, 121, 138, 155, 157, 161, 163, 164, 165, 166, 167, 168, 169, 170, 171]);
export const ORIG_PIECES = [25, ...range(39, 43), ...range(45, 73), ...range(79, 87), 89, ...range(93, 121), 124, 127, 128, ...range(132, 154), ...range(155, 157), ...range(161, 178), ...range(183, 189), ...range(191, 203)]
  .filter(n => !ORIG_DUPES.has(n)).map(n => ORIG_BASE + n);
const O = (...n: number[]) => n.map(x => ORIG_BASE + x);
const ORIG_KIND = new Map<number, PieceKind>([
  ...O(25, 187, 188, 189, 191, 192, 193, 194, 195, 196, 197).map(r => [r, '美洲'] as [number, PieceKind]),
  ...O(89, 109).map(r => [r, '酒店'] as [number, PieceKind]),
  ...O(79, 83, 84, 85, 87, 93, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 115, 116, 117, 118, 119, 120, 149, 156, 176, 177, 178, 183, 198, 199, 200)
    .map(r => [r, '特色'] as [number, PieceKind]),
  ...O(141, 142, 143, 145, 201, 202, 203).map(r => [r, '動物'] as [number, PieceKind]),
]);

// ---------------------------------------------------------------- the remake's sprites
const PEOPLE = new Set([1705, 1766, 1768, 1769, ...range(1801, 1806), ...range(1905, 1910), ...range(3401, 3407), ...range(3419, 3428)]);
const ANIMALS = new Set([1324, 1911, 2419, 2420, 3429]);
const VEHICLES = new Set([1018, 1021, 1116, 1117, 1319, 1762, ...range(1901, 1904), 1906, 1907, 2423, 2424, 2429, 2503, 2504, ...range(3411, 3418), 3514, 3515]);
/** Food, signs, props among the landmarks and the plants. */
const PROPS = new Set([1019, 1020, 1113, 1114, 1115, 1118, ...range(1217, 1220), ...range(1320, 1323), ...range(1410, 1414), 1761, 1764, 1767,
  ...range(2117, 2131), 2312, 3221, 3222, 3223, 3501, 3816, 3817, 3974, 4013, 4014]);
const BEACH = new Set([1315, 1415, 1416, 2417, 2418, 2421, 2422, ...range(2425, 2428), 2430, 2431, 2432, 2442]);
const TROPICAL = new Set([...range(2301, 2303), 2313, ...range(2401, 2416), ...range(2433, 2448), 2528, 4007, 4008, 4208]);
const DESERT = new Set([2438, 2448]);
const TEMPERATE = new Set([1022, 3801]);
const HOTELS = new Set([2604, 2605, ...range(2611, 2615), 2624, 2625]);
/** Not landmarks among the cities' and 重慶's groups: their stations, prisons, hospitals, greenhouses … */
const SPECIAL = new Set([...range(1501, 1503), 1221, 1222, 3810, 3815, 3950, 4119, ...range(3205, 3231).filter(n => ![3206, 3209, 3212].includes(n))]);
/** 重慶 (39) and 歌舞伎町 (17): their landmarks; the rest of those groups are streets of houses and shops. */
const CITY_LANDMARKS = new Set([1751, 1752, 1753, ...range(3901, 3920)]);

/** A piece's kind (and so its tab: TAB_OF_KIND). */
export function kindOf(id: number): PieceKind {
  if (isOrig(id)) return ORIG_KIND.get(id) ?? '小屋';
  if (PEOPLE.has(id)) return '人物';
  if (ANIMALS.has(id)) return '動物';
  if (VEHICLES.has(id)) return '車輛';
  if (PROPS.has(id)) return '小物';
  if (BEACH.has(id)) return '海灘';
  if (DESERT.has(id)) return '沙漠';
  if (TROPICAL.has(id)) return '熱帶';
  if (TEMPERATE.has(id)) return '溫帶';
  if (HOTELS.has(id)) return '酒店';
  if (SPECIAL.has(id) && !CITY_LANDMARKS.has(id)) return '特色';
  if (CITY_LANDMARKS.has(id)) return '亞洲';
  const g = Math.floor(id / 100);
  if ([20, 21, 23, 40, 42].includes(g) || (id >= 2517 && id <= 2532) || (id >= 3517 && id <= 3532)) return '溫帶';
  if ([19, 24, 25, 34, 35].includes(g)) return '小物';
  if (g === 16) return '特色';
  if ([17, 18, 26, 27, 28, 29, 30, 31, 33, 36, 39, 41].includes(g)) return '小屋';
  // 10–15 the five cities, 32 激情歲月, 38 萊陽 (and new groups: their own kind, see NEW_GROUPS)
  return NEW_GROUPS[g] ?? '亞洲';
}

/**
 * Groups of pieces made for a kind (the world's landmarks and the rest, 2026-11-17 on, tools/tycoon-art/world_pieces.py):
 * group → kind. 49 the desert's houses, 50 its plants, landforms and ruins, 53 animals and dinosaurs.
 */
export const NEW_GROUPS: Record<number, PieceKind> = {
  43: '亞洲', 44: '歐洲', 45: '美洲', 46: '非洲', 47: '大洋洲',
  48: '酒店', 49: '小屋', 50: '沙漠', 51: '海灘', 52: '人物', 53: '動物', 54: '車輛',
};

/** The pieces of a kind: the remake's in the groups' order (萊陽's and the new ones first), then the original's. */
const ORDER = [38, 10, 11, 12, 13, 14, 15, 32, 33, 26, 27, 28, 29, 30, 31, 36, 16, 17, 18, 39, 41, 42, 20, 21, 23, 24, 25, 19, 34, 35, 40];
export function piecesOf(all: number[], kind: PieceKind): number[] {
  const groups = [...Object.keys(NEW_GROUPS).map(Number), ...ORDER];
  const rest = all.filter(id => !isOrig(id) && !groups.includes(Math.floor(id / 100)));
  return [...groups.flatMap(g => all.filter(id => Math.floor(id / 100) === g)), ...rest, ...all.filter(isOrig)].filter(id => kindOf(id) === kind);
}

/** Where a piece's frames are, from the assets' root: the remake's own sprites, or the original's redrawn ones. */
export const pieceDir = (res: number) => (isOrig(res) ? `hd/map/${String(res - ORIG_BASE).padStart(4, '0')}-SPR` : `maps/remake/sprites/${res}`);
/** Its first frame, for the strip of pieces. */
export const pieceThumb = (res: number) => `${ASSETS}/${pieceDir(res)}/frame-000.webp`;

let origFrames: Promise<Record<string, { frames: { file: string; width: number; height: number; anchor_x: number; anchor_y: number }[] }>> | null = null;
/** A piece's frames (frames.json; the original's from the hd manifest). */
export async function pieceFrames(res: number): Promise<{ file: string; width: number; height: number; anchor_x: number; anchor_y: number }[]> {
  if (!isOrig(res)) {
    const j = await fetch(`${ASSETS}/maps/remake/sprites/${res}/frames.json`).then(r => r.json());
    return Array.isArray(j) ? j : j.frames;
  }
  origFrames ??= fetch(`${ASSETS}/hd/manifest-hd.json`).then(r => r.json()).then(j => j.resources);
  const e = (await origFrames)[`map/${String(res - ORIG_BASE).padStart(4, '0')}`];
  if (!e?.frames?.length) throw new Error('no frames');
  return e.frames.map(f => ({ file: f.file, width: f.width, height: f.height, anchor_x: f.anchor_x, anchor_y: f.anchor_y }));
}
