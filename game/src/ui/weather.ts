/**
 * Daily weather (the remake's addition, docs/rules/16-weather.md): one weather a day per map, from the map's real
 * climate (climate.ts) and the calendar. Purely cosmetic: nothing in the rules reads it.
 *
 * Deterministic and stateless: a day's weather is a hash of the game seed, the map and the date, so a loaded game,
 * a replay and every screen show the same sky, and the rules' rand() is never touched. Nothing is saved.
 * Weather keeps a little memory (a rainy spell, a snowy week): with PERSIST chance a day repeats yesterday's kind,
 * otherwise it is drawn fresh from the month's odds — which leaves each month's long-run mix unchanged.
 */
import { addDays, daysInMonth, month as monthOf, serial, year as yearOf, type PackedDate } from '../core/date';
import { CLIMATES, climateOf, type Climate } from './climate';

export type WeatherKind = 'sunny' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog' | 'typhoon';
export const WEATHER_KINDS: readonly WeatherKind[] = ['sunny', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'typhoon'];
export const WEATHER_NAME: Record<WeatherKind, string> = {
  sunny: '晴', cloudy: '多雲', rain: '雨', storm: '雷雨', snow: '雪', fog: '霧', typhoon: '颱風',
};

export interface Weather {
  kind: WeatherKind;
  /** 0..1: drizzle → downpour, flurries → blizzard, a few clouds → a full sky. */
  intensity: number;
  /** Wind direction over the map, radians in world space (the rain slants and the clouds drift with it). */
  wind: number;
}

/** Chance that a day keeps yesterday's kind (spells of rain or snow). */
const PERSIST = 0.35;
/** How far back a spell is followed before a fresh draw. */
const MAX_SPELL = 6;

/** 32-bit mix of the inputs (murmur3 finaliser over a running hash); independent of the rules' Rng. */
function hash(seed: number, map: number, dayNo: number, salt: number): number {
  let h = (seed ^ 0x5bd1e995) >>> 0;
  for (const v of [map, dayNo, salt]) {
    h = Math.imul(h ^ (v >>> 0), 0xcc9e2d51) >>> 0;
    h = ((h << 15) | (h >>> 17)) >>> 0;
    h = (Math.imul(h, 0x1b873593) + 0xe6546b64) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The odds of each kind on a day of month `m` (1..12) of year `y` in a climate, summing to 1. Days per month from
 * the table become per-day chances: typhoon and snow first, thunderstorms (not in snowy months: thunder there is
 * snow thunder), the remaining wet days rain, then fog; overcast days that were not wet are cloudy, the rest sunny.
 */
export function monthOdds(c: Climate, m: number, y = 2001): Record<WeatherKind, number> {
  const i = m - 1, dm = daysInMonth(y, m);
  const typhoon = c.typhoon[i], snow = c.snow[i], wetDays = c.rain[i];
  const snowShare = wetDays > 0 ? Math.min(1, snow / wetDays) : snow > 0 ? 1 : 0;
  const storm = Math.max(0, c.thunder[i] * (1 - snowShare) - typhoon * 0.5);
  const rain = Math.max(0, wetDays - snow - storm - typhoon);
  const fog = c.fog[i];
  let wet = typhoon + snow + storm + rain + fog;
  const k = wet > dm * 0.95 ? (dm * 0.95) / wet : 1;
  wet *= k;
  const cloudy = Math.max(0, Math.min(c.overcast[i] - 0.8 * wetDays, (dm - wet) * 0.85));
  const sunny = Math.max(0, dm - wet - cloudy);
  return {
    sunny: sunny / dm, cloudy: cloudy / dm, rain: (rain * k) / dm, storm: (storm * k) / dm,
    snow: (snow * k) / dm, fog: (fog * k) / dm, typhoon: (typhoon * k) / dm,
  };
}

const oddsCache = new Map<string, Record<WeatherKind, number>>();
function odds(c: Climate, id: string, m: number, y: number) {
  const key = `${id}|${m}|${m === 2 ? daysInMonth(y, 2) : 0}`;
  let o = oddsCache.get(key);
  if (!o) { o = monthOdds(c, m, y); oddsCache.set(key, o); }
  return o;
}

function fresh(c: Climate, id: string, seed: number, mapId: number, n: number, d: PackedDate): Weather {
  const m = monthOf(d), o = odds(c, id, m, yearOf(d));
  let u = hash(seed, mapId, n, 1), kind: WeatherKind = 'sunny';
  for (const k of WEATHER_KINDS) { if (u < o[k]) { kind = k; break; } u -= o[k]; }
  return { kind, intensity: intensityOf(c, kind, m, hash(seed, mapId, n, 2)), wind: hash(seed, mapId, n, 3) * Math.PI * 2 };
}

/** How strong: heavy rain days in the table's share are downpours; storms and typhoons are strong. */
function intensityOf(c: Climate, kind: WeatherKind, m: number, u: number): number {
  const i = m - 1;
  switch (kind) {
    case 'rain': {
      const heavy = c.rain[i] > 0 ? Math.min(0.9, c.heavy[i] / c.rain[i]) : 0.3;
      return u < heavy ? 0.7 + 0.3 * (u / heavy) : 0.2 + 0.45 * ((u - heavy) / (1 - heavy));
    }
    case 'storm': return 0.75 + 0.25 * u;
    case 'typhoon': return 0.9 + 0.1 * u;
    case 'snow': {
      // Where most snow days bring real snowfall (札幌), heavier snow is more common.
      const deep = Math.min(0.8, c.snow[i] / 30);
      return 0.25 + 0.75 * Math.pow(u, 1.4 - deep);
    }
    case 'fog': return 0.55 + 0.45 * u;
    case 'cloudy': return 0.45 + 0.55 * u;
    default: return u;
  }
}

/** A day's weather on a map, or null when the map has none (the theme maps 4–7). */
export function weatherOf(seed: number, mapId: number, date: PackedDate): Weather | null {
  const id = climateOf(mapId);
  if (!id) return null;
  const c = CLIMATES[id];
  let n = serial(date), steps = 0;
  // Walk back while each day keeps yesterday's kind, draw the first day of the spell fresh, then carry its kind
  // forward day by day (a kind a day cannot have — snow carried into a month that never has it — restarts fresh).
  while (steps < MAX_SPELL && hash(seed, mapId, n, 0) < PERSIST) { n -= 1; steps++; }
  let w = fresh(c, id, seed, mapId, n, addDays(date, -steps));
  for (let k = steps - 1; k >= 0; k--) {
    const d = addDays(date, -k), dn = n + steps - k, m = monthOf(d);
    w = odds(c, id, m, yearOf(d))[w.kind] <= 0 ? fresh(c, id, seed, mapId, dn, d)
      : { kind: w.kind, intensity: intensityOf(c, w.kind, m, hash(seed, mapId, dn, 2)), wind: w.wind + (hash(seed, mapId, dn, 4) - 0.5) * 0.8 };
  }
  return w;
}

/** A weather shown instead of the day's on every screen (debugging, screenshots); undefined: none. */
let override: Weather | null | undefined;
export function overrideWeather(w: Weather | null | undefined) { override = w; for (const f of listeners) f(); }

/** The weather of a game today: what the map, the calendar and the outdoor scenes all show. */
export function todayWeather(game: { settings: { seed: number; mapId: number }; date: PackedDate }): Weather | null {
  if (override !== undefined) return climateOf(game.settings.mapId) ? override : null;
  return weatherOf(game.settings.seed, game.settings.mapId, game.date);
}

// ------------------------------------------------------------------ setting

/** 天氣 setting: 0 on (picture and sound), 1 picture only, 2 off. Kept in localStorage for every game. */
export const WEATHER_MODES = ['開', '只有畫面', '關'] as const;
const KEY = 'rich4.weather';
export function weatherMode(): number {
  try { const v = Number(localStorage.getItem(KEY) ?? 0); return v === 1 || v === 2 ? v : 0; } catch { return 0; }
}
const listeners = new Set<() => void>();
export function setWeatherMode(v: number) {
  try { localStorage.setItem(KEY, String(v)); } catch { /* not kept */ }
  for (const f of listeners) f();
}
export function onWeatherMode(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }

// ------------------------------------------------------------------ calendar icon

/**
 * Small toy-style icon (inline SVG, 48×48 viewBox): fat outlines and soft fills like the original's panel art.
 */
export function weatherIcon(kind: WeatherKind): string {
  const O = 'stroke="#2a1d10" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
  const cloud = (fill: string, y = 0) =>
    `<path ${O} fill="${fill}" d="M12 ${33 + y}h25a7 7 0 0 0 0-14 9 9 0 0 0-17-3 7 7 0 0 0-8 6.5 5.5 5.5 0 0 0 0 10.5z"/>`;
  const sun = (cx: number, cy: number, r: number) => {
    let rays = '';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, x1 = cx + Math.cos(a) * (r + 3), y1 = cy + Math.sin(a) * (r + 3), x2 = cx + Math.cos(a) * (r + 8), y2 = cy + Math.sin(a) * (r + 8);
      rays += `<line ${O} x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#e06a10"/>`;
    }
    return `${rays}<circle ${O} cx="${cx}" cy="${cy}" r="${r}" fill="#ffd23f"/><circle cx="${cx - r * 0.35}" cy="${cy - r * 0.35}" r="${r * 0.3}" fill="#fff6c0"/>`;
  };
  const drops = (c: string, n: number) => Array.from({ length: n }, (_, i) => {
    const x = 15 + i * (20 / Math.max(1, n - 1));
    return `<path stroke="${c}" stroke-width="3" stroke-linecap="round" d="M${x + 2} 37l-3 7"/>`;
  }).join('');
  const flakes = [16, 25, 34].map((x, i) => `<g stroke="#5a7fb0" stroke-width="2" stroke-linecap="round" transform="translate(${x} ${40 + (i % 2) * 3})"><path d="M0-4v8M-3.5-2l7 4M-3.5 2l7-4"/></g>`).join('');
  let body = '';
  switch (kind) {
    case 'sunny': body = sun(24, 24, 10); break;
    case 'cloudy': body = `${sun(31, 15, 7)}${cloud('#f4f6fa', 2)}`; break;
    case 'rain': body = `${cloud('#dfe5ee', -4)}${drops('#2f7fe0', 3)}`; break;
    case 'storm': body = `${cloud('#8d97a8', -4)}<path ${O} fill="#ffd23f" d="M24 29l-5 9h5l-3 8 9-11h-5l3-6z"/>`; break;
    case 'snow': body = `${cloud('#ffffff', -6)}${flakes}`; break;
    case 'fog': body = `${sun(24, 16, 7)}<g stroke="#8a96a6" stroke-width="3.2" stroke-linecap="round" fill="none"><path d="M8 28q4-3 8 0t8 0 8 0 8 0"/><path d="M8 35q4-3 8 0t8 0 8 0 8 0"/><path d="M12 42q4-3 8 0t8 0 8 0"/></g>`; break;
    case 'typhoon': body = `<g fill="none" ${O}><path stroke="#2f7fe0" stroke-width="4" d="M24 24m-3 0a3 3 0 1 1 6 0c0 7-9 12-15 9M24 24c0-7 9-12 15-9"/></g><circle ${O} cx="24" cy="24" r="4" fill="#bfe0ff"/>`; break;
  }
  return `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">${body}</svg>`;
}
