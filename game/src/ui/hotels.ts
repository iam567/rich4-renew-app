/**
 * The 旅館's levels 4 and 5 on every map (the user 2026-10-19: 「全局酒店四五級全換成這個」), redrawn after the user's
 * photos (tools/tycoon-art/hotels.py): level 4 the dark APARTMENT HOTEL 11 tower with its sign over the lobby, level 5
 * the tall taupe tower with the big sign on its roof. Their sprites (remake/sprites/2604, 2605) are registered once,
 * before a board is drawn; the board draws them in place of each stage's own level 4 and 5 pictures.
 */
import { ASSETS, type MapSprites } from './assets';
import type { SpriteBank } from './sprites';

const LEVELS = [4, 5];
const res = (level: number) => 2600 + level;
let done: Promise<void> | null = null;
const ready = new Set<number>();

export function prepareHotels(bank: SpriteBank): Promise<void> {
  done ??= (async () => {
    const out: MapSprites = {};
    await Promise.all(LEVELS.map(async level => {
      try {
        const r = await fetch(`${ASSETS}/maps/remake/sprites/${res(level)}/frames.json`);
        if (r.ok) { out[`map/${res(level)}`] = { dir: `remake/sprites/${res(level)}`, frames: await r.json() }; ready.add(level); }
      } catch { /* not installed: the original pictures */ }
    }));
    bank.addMapSprites(out);
  })();
  return done;
}

/**
 * The original theme maps keep their own hotels (issue #3, the user 2026-10-22: 星座, 武侠, 恐龍 and the fourth themed
 * map — maps 4..7, the original's second stage): a hotel there is part of the theme.
 */
const THEMED_MAPS = new Set([4, 5, 6, 7]);

/** The redrawn hotel's sprite for a 旅館 (facility type 1) of level 4 or 5 on `mapId`, else null. */
export function hotelSprite(fa: { type: number; level: number }, mapId: number): number | null {
  if (THEMED_MAPS.has(mapId)) return null;
  return fa.type === 1 && ready.has(fa.level) ? res(fa.level) : null;
}
