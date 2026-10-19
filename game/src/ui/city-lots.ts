/**
 * The small lots' buildings of the five Japanese cities (the user 2026-10-19, tools/tycoon-art/city_lots.py): each city
 * its own local shops — 平房 one of six one-storey shops, 店舖 one of six two-storey shops, 商場 / 商業大樓 / 摩天大樓 one of
 * four mixed-tenant buildings of about 3, 4 and 5–6 floors. Which one a lot shows is drawn at random per lot and game
 * (stable over a reload); owned land without a house keeps the character's flag, a chain lot the original chain store.
 * Purely visual: the rules never see it. Sprites map/2701.. 東京, 2801.. 大阪, 2901.. 札幌, 3001.. 九州, 3101.. 沖繩.
 */
import type { Game } from '../core/game';
import { ASSETS, type MapSprites } from './assets';
import type { SpriteBank } from './sprites';

const BASE: Record<number, number> = { 100: 2700, 101: 2800, 102: 2900, 103: 3000, 104: 3100 };
/** The list positions (1-based) of each house level's styles in the city's 24. */
const TIERS: Record<number, number[]> = { 1: [1, 2, 3, 4, 5, 6], 2: [7, 8, 9, 10, 11, 12], 3: [13, 14, 15, 16], 4: [17, 18, 19, 20], 5: [21, 22, 23, 24] };
const ready = new Map<number, Set<number>>();
const loading = new Map<number, Promise<void>>();

/** Registers the city's lot sprites once (those installed). */
export function prepareCityLots(bank: SpriteBank, mapId: number): Promise<void> {
  const base = BASE[mapId];
  if (base === undefined) return Promise.resolve();
  let p = loading.get(mapId);
  if (!p) {
    p = (async () => {
      const out: MapSprites = {}, have = new Set<number>();
      await Promise.all(Array.from({ length: 24 }, (_, i) => i + 1).map(async n => {
        const res = base + n;
        try {
          const r = await fetch(`${ASSETS}/maps/remake/sprites/${res}/frames.json`);
          if (r.ok) { out[`map/${res}`] = { dir: `remake/sprites/${res}`, frames: await r.json() }; have.add(n); }
        } catch { /* not installed */ }
      }));
      bank.addMapSprites(out);
      ready.set(mapId, have);
    })();
    loading.set(mapId, p);
  }
  return p;
}

/** A small stable hash (lot, game seed) -> 0..2³²−1. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return h >>> 0;
}

/** The city's own building for a house lot (not a chain store), or null (another map, or its art not installed). */
export function cityLotSprite(game: Game, l: { id?: number; level: number; chain: number | boolean }): number | null {
  if (!l.level || l.chain) return null;
  const mapId = game.settings.mapId, base = BASE[mapId], have = ready.get(mapId);
  if (base === undefined || !have?.size) return null;
  const tier = TIERS[Math.max(1, Math.min(5, l.level))].filter(n => have.has(n));
  if (!tier.length) return null;
  return base + tier[hash(l.id ?? 0, game.settings.seed >>> 0) % tier.length];
}
