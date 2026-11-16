/**
 * The small flag beside an online player's name (the user 2026-11-04: every country, by the address). The relay answers
 * /where with this address's country (geo.mjs; the address is not kept), kept on the phone; a phone that never got an
 * answer goes by party-net.ts myRegion, its time zone. The flags: flag-icons (MIT, flags/LICENSE) on one picture
 * (scripts/flag-atlas.mjs), so a version does not download 250 files.
 *
 * 台灣's player by who looks (the user 2026-11-04: 「誰也不得罪」): a phone in mainland China sees the Chinese flag and
 * 中國台灣, every other phone 台灣's own flag. Looked at in this order: an address in 台灣 is never mainland, whatever
 * the time zone; an address in mainland China is; any other address goes by the time zone (a VPN changes the address).
 */
import atlasUrl from './flags/atlas.webp';
import atlas from './flags/atlas.json';
import { relays } from './net-peer';

const KEY = 'rich4.party.cc';
const ZONE_CODES: Readonly<Record<string, string>> = {
  中國大陸: 'CN', 台灣: 'TW', 香港: 'HK', 澳門: 'MO', 日本: 'JP', 韓國: 'KR', 美國: 'US', 加拿大: 'CA', 英國: 'GB', 澳洲: 'AU', 紐西蘭: 'NZ',
  新加坡: 'SG', 馬來西亞: 'MY', 泰國: 'TH', 菲律賓: 'PH', 越南: 'VN', 印尼: 'ID', 德國: 'DE', 法國: 'FR', 荷蘭: 'NL',
};
/** Named as the game names them (Intl's are longer). */
const NAMES: Readonly<Record<string, string>> = { CN: '中國大陸', TW: '台灣', HK: '香港', MO: '澳門' };

export const cleanCc = (cc: unknown) => (typeof cc === 'string' && /^[A-Z]{2}$/.test(cc) ? cc : undefined);
/** This phone's country as last heard. */
export const myCountry = () => { try { return cleanCc(localStorage.getItem(KEY)); } catch { return undefined; } };

/** Asks the relay where this phone is now (kept for the next room; no answer: as it was). */
export async function findCountry(): Promise<void> {
  try {
    const url = (await relays())[0];
    if (!url) return;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`${url.replace(/^ws/, 'http').replace(/\/+$/, '')}/where`, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    const cc = cleanCc(((await r.json()) as { cc?: unknown }).cc);
    if (cc) localStorage.setItem(KEY, cc);
  } catch { /* the time zone's, or the last one */ }
}

const CHINA_ZONES = new Set(['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Harbin', 'Asia/Urumqi']);
/** Whether this phone is in mainland China. */
function inMainland(): boolean {
  const cc = myCountry();
  if (cc === 'TW') return false;
  if (cc === 'CN') return true;
  try { return CHINA_ZONES.has(Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''); } catch { return false; }
}

interface Where { cc?: string; region?: string }
const codeOf = (w?: Where) => cleanCc(w?.cc) ?? ZONE_CODES[w?.region ?? ''];

/** The country or area's name: Intl's for a country code, else the time zone's region. */
export function placeName(w?: Where): string {
  const cc = cleanCc(w?.cc);
  if (codeOf(w) === 'TW' && inMainland()) return '中國台灣';
  if (!cc) return w?.region ?? '';
  if (NAMES[cc]) return NAMES[cc];
  try { return new Intl.DisplayNames(['zh-Hant'], { type: 'region' }).of(cc) ?? w?.region ?? ''; } catch { return w?.region ?? ''; }
}

/** The flag as HTML ('' when there is none: an unknown place, or a time zone as wide as 亞洲). */
export function flagHtml(w?: Where): string {
  const code = codeOf(w), cc = code === 'TW' && inMainland() ? 'CN' : code, at = cc ? atlas.codes.match(/../g)!.indexOf(cc.toLowerCase()) : -1;
  if (at < 0) return '';
  const x = (at % atlas.cols) / (atlas.cols - 1) * 100, y = Math.floor(at / atlas.cols) / (atlas.rows - 1) * 100;
  return `<i class="rflag" title="${placeName(w)}" style="background-image:url(${atlasUrl});background-size:${atlas.cols * 100}% ${atlas.rows * 100}%;background-position:${x.toFixed(3)}% ${y.toFixed(3)}%"></i>`;
}
