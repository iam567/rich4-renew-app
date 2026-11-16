/**
 * The pieces' kinds (the user 2026-11-12: buildings, plants, people, vehicles … each its own row, not all in one long
 * strip): 建築's 地標 / 房屋 (shops too) / 夜景 (casinos too), 裝飾's 植物 / 人物 (animals too) / 車輛 / 小物 — by the sprite's group (the hundreds of
 * its number), the groups that mix kinds sorted piece by piece (looked over 2026-11-12).
 */
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const PEOPLE = new Set([1705, 1802, 1905, 1908, 1909, 1910, 1911, ...range(3401, 3407), ...range(3419, 3429), 2419, 2420]);
const VEHICLES = new Set([...range(1901, 1904), 1906, 1907, ...range(3411, 3418), 2423, 2424, 2429, 2503, 2504, 3514, 3515]);
const PLANTS = new Set([...range(2401, 2416), 2426, ...range(2433, 2448), ...range(2517, 2532), 3501, ...range(3517, 3532)]);

export const BUILDING_KINDS = ['地標', '房屋', '夜景'] as const;
export const DECOR_KINDS = ['植物', '人物', '車輛', '小物'] as const;
export type PieceKind = (typeof BUILDING_KINDS)[number] | (typeof DECOR_KINDS)[number];

/** A piece's kind (its tab: one of BUILDING_KINDS → 建築, DECOR_KINDS → 裝飾). */
export function kindOf(id: number): PieceKind {
  if (PEOPLE.has(id)) return '人物';
  if (VEHICLES.has(id)) return '車輛';
  const g = Math.floor(id / 100);
  if ([20, 21, 23, 40, 42].includes(g) || PLANTS.has(id)) return '植物';
  if ([19, 24, 25, 34, 35].includes(g)) return '小物';
  if ([26, 27, 28, 29, 30, 31, 36].includes(g)) return '房屋';
  if ([16, 17, 18, 39, 41].includes(g)) return '夜景';
  return '地標';
}

/** The pieces of a kind, in the groups' order (萊陽's and the new plants first), each group's in number order. */
const ORDER = [38, 10, 11, 12, 13, 14, 15, 32, 33, 26, 27, 28, 29, 30, 31, 36, 16, 17, 18, 39, 41, 42, 20, 21, 23, 24, 25, 19, 34, 35, 40];
export const piecesOf = (all: number[], kind: PieceKind) =>
  ORDER.flatMap(g => all.filter(id => Math.floor(id / 100) === g && kindOf(id) === kind));
