/**
 * 大富翁城 on screen (docs/rules/19): the map's records for the world (so the finale can start), the casino's five
 * level sprites, the city's tag colour, and the stock button greyed while the finale is on. The screens are in
 * screens/casino.ts (the tables, 莊家不在！), screens/finale-start.ts (最終決戰) and finale-ending.ts (results).
 */
import { parseBoard, type RawMap } from '../core/board';
import { FINALE_MAP, getFinaleBoard, setFinaleBoard } from '../core/finale';
import { hallSprite } from './casino-sprite';
import { applyOverlay } from '../core/world';
import type { Game } from '../core/game';
import '../core/casino-rules'; // registers map 105's rules for a normal game
import { ASSETS, loadMapData, type MapSprites } from './assets';
import type { SpriteBank } from './sprites';
import { CITY_COLORS, tycoon } from './tycoon';
import { FINALE_CHIP } from '../core/chips';
import './finale.css';

CITY_COLORS[FINALE_MAP] ??= '#d4a017';


/** Loads 大富翁城's records (once) and registers the halls' sprites; a missing map leaves the finale off. */
export async function prepareFinale(bank: SpriteBank): Promise<void> {
  if (!getFinaleBoard()) {
    try {
      const raw = await loadMapData(FINALE_MAP);
      setFinaleBoard(applyOverlay(parseBoard(raw as RawMap), undefined, FINALE_MAP));
    } catch { /* not installed: no finale */ }
  }
  const out: MapSprites = {};
  // The five halls' sprites; a hall whose art is not there yet borrows the golden palace's (百家樂館, 1621..).
  const frames = async (res: number) => {
    try { const r = await fetch(`${ASSETS}/maps/remake/sprites/${String(res).padStart(4, '0')}/frames.json`); return r.ok ? await r.json() : null; } catch { return null; }
  };
  await Promise.all([5, 6, 7, 8, 9].flatMap(t => [1, 2, 3, 4, 5].map(async k => {
    const res = hallSprite(t, k);
    let src = res, f = await frames(res);
    if (!f) { src = hallSprite(7, k); f = await frames(src); }
    if (f) out[`map/${String(res).padStart(4, '0')}`] = { dir: `remake/sprites/${String(src).padStart(4, '0')}`, frames: f };
  })));
  bank.addMapSprites(out);
}


/** 大富翁城 has no stock market (the finale's city and the normal map 105: their rules filter the decks). */
export function noStocks(game: Game | null | undefined): boolean {
  return !!(game?.rules as { finaleDeny?: unknown } | undefined)?.finaleDeny;
}

/** The toolbar on 大富翁城: the stock button greyed. */
export function finaleToolbar(toolbar: HTMLElement | null | undefined, game: Game | null | undefined): void {
  toolbar?.classList.toggle('finale', noStocks(game));
}

/** 大富翁城's finale plays in chips (19 §2): the screen shows money as 元 / 100 籌碼 there. */
export function chipMode(): boolean {
  const w = tycoon.world;
  return !!w?.finale.active && w.view() === w.finale.index;
}

/** The finale's blinds on the money panel (19 §5.5): 「・盲注 ×4」 from day 20 on; '' elsewhere. */
export function blindsTag(): string {
  const w = tycoon.world;
  if (!chipMode() || !w) return '';
  const m = w.finale.blind();
  return m > 1 ? `<b class="pp-blinds">・盲注 ×${m}</b>` : '';
}

/** Money as the screen shows it now: "1,234 籌碼" in the finale, else "12,345 元". */
export function fmtMoney(n: number, unit = true): string {
  return chipMode() ? `${Math.trunc(n / FINALE_CHIP).toLocaleString('en-US')}${unit ? ' 籌碼' : ''}` : `${Math.trunc(n).toLocaleString('en-US')}${unit ? ' 元' : ''}`;
}
