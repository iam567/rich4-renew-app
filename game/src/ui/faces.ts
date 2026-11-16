/**
 * The speech cloud's redrawn expression faces (docs/rules/15 §6): maps/remake/faces/<character>-<expression>.webp,
 * 256 px on the long side, eight expressions per character (reactions.ts `Expr`; tools/tycoon-art/face_art.py).
 * Loaded ahead for the players in the game; until one is there the cloud draws the original's face.
 */
import { ASSETS } from './assets';

const FACES = 8;
const cache = new Map<string, HTMLImageElement | null>();

function load(character: number, expr: number): HTMLImageElement | null {
  const key = `${character}-${expr}`;
  if (cache.has(key)) return cache.get(key)!;
  const img = new Image();
  img.decoding = 'async';
  cache.set(key, null);
  img.onload = () => { img.decode().then(() => cache.set(key, img), () => cache.set(key, img)); };
  img.src = `${ASSETS}/maps/remake/faces/${key}.webp`;
  return null;
}

/** Starts loading every expression of these characters. */
export function preloadFaces(characters: readonly number[]) {
  for (const c of new Set(characters)) for (let e = 0; e < FACES; e++) load(c, e);
}

/** The redrawn face when it is loaded (and starts loading it when not). */
export function faceImage(character: number, expr: number): HTMLImageElement | null {
  if (character < 0 || character > 11 || expr < 0 || expr >= FACES) return null;
  return load(character, expr);
}
