/**
 * Saved games (docs/rules/07 §5). The original dumps its globals into SAVE0..5.DAT; the remake keeps the
 * same slots (0 = automatic, 1..5 manual) and stores the whole rules state as plain data.
 *
 * A save is taken at the start of a player's turn (the turn menu), so loading resumes at that menu. The
 * remake also keeps the random generator state, which the original reseeds from the clock instead.
 */
import type { Board } from './board';
import { Game } from './game';
import { STOCK_TABLE } from './modules/stocks';
import { daySeed } from './rng';
import type { GameSettings, Player } from './types';
import type { FinaleState } from './finale';
import { World, type TickerLine, type TycoonSettings } from './world';
import { attachLedger, Ledger, ledgerOf, type LedgerData } from './stats';

export const SAVE_VERSION = 1;

const MODULES = ['stocks', 'cards', 'tools', 'objects', 'events', 'places', 'blackMarket', 'forks'] as const;
/** Module fields not saved: the time machine's snapshots are memory only, as in the original. */
const SKIP = new Set(['g', 'snapshots']);

export interface SaveData {
  version: number;
  savedAt: number;
  settings: GameSettings;
  board: Board;
  players: Player[];
  game: {
    date: number; daysElapsed: number; monthsElapsed: number; priceIndex: number; current: number;
    diceTotal: number; lotteryPool: number; rng: number; rngSalt?: number;
  };
  modules: Record<string, Record<string, unknown>>;
  /** The statistics ledger (core/stats.ts), when the game kept one; older saves have none. */
  stats?: LedgerData;
  /** The map's own rules state (歌舞伎町, core/kabukicho.ts); no other map has one. */
  mapRules?: unknown;
}

const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** A pool slot that wrapped below 0 in an older save (255, 254 …: see Cards.receive) means none left. */
function repairCardPool(g: { cards: { remaining: number[] } }) {
  const r = g.cards.remaining;
  for (let i = 0; i < r.length; i++) if (r[i] > 100) r[i] = 0;
}

export function saveGame(g: Game): SaveData {
  const modules: SaveData['modules'] = {};
  for (const name of MODULES) {
    const mod = g[name] as unknown as Record<string, unknown>, out: Record<string, unknown> = {};
    for (const k of Object.keys(mod)) if (!SKIP.has(k) && typeof mod[k] !== 'function') out[k] = plain(mod[k]);
    modules[name] = out;
  }
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    settings: plain(g.settings),
    board: plain(g.board),
    players: plain(g.players),
    game: {
      date: g.date, daysElapsed: g.daysElapsed, monthsElapsed: g.monthsElapsed, priceIndex: g.priceIndex,
      current: g.current, diceTotal: g.diceTotal, lotteryPool: g.lotteryPool, rng: g.rng.seed,
      ...(g.rngSalt ? { rngSalt: g.rngSalt } : {}),
    },
    modules,
    ...(g.stats ? { stats: g.stats.save() } : {}),
    ...(g.rules?.saveState ? { mapRules: plain(g.rules.saveState()) } : {}),
  };
}

/**
 * Takes the names of the stocks and companies from the map as it is now (a remake city that got its own local firms
 * after the game was saved, editor/city_companies.py). Saves keep stock and company state by slot / record, so only
 * names move, and only when the map still has the saved records (same theme slot, companies with the same stock slots
 * and categories).
 */
export function adoptMapNames(g: Game, map: Board): void {
  const b = g.board;
  if (map.mapId !== b.mapId || map.companies.length !== b.companies.length) return;
  if (map.companies.some((c, i) => c.stockSlot !== b.companies[i].stockSlot || c.category !== b.companies[i].category)) return;
  map.companies.forEach((c, i) => { b.companies[i].name = c.name; });
  const group = (((b.mapId | 0) % 8) + 8) % 8;
  if (map.stockNames) b.stockNames = [...map.stockNames];
  else delete b.stockNames;
  g.stocks.stocks.forEach((s, i) => { s.name = map.stockNames?.[i] || STOCK_TABLE[group][i]?.name || s.name; });
}

/**
 * Rebuilds a game from a save; `run()` then continues with the saved actor's turn. With `map` (the map as loaded now)
 * the stock and company names are the map's (adoptMapNames).
 */
export function loadGame(s: SaveData, map?: Board): Game {
  if (s.version !== SAVE_VERSION) throw new Error('存檔版本不符');
  const g = new Game(s.settings, s.board);
  // Board records keep their object identity (modules hold no references to them), so copying fields is enough.
  Object.assign(g.board, plain(s.board));
  s.players.forEach((p, i) => Object.assign(g.players[i], plain(p)));
  Object.assign(g, {
    date: s.game.date, daysElapsed: s.game.daysElapsed, monthsElapsed: s.game.monthsElapsed, priceIndex: s.game.priceIndex,
    current: s.game.current, diceTotal: s.game.diceTotal, lotteryPool: s.game.lotteryPool,
  });
  g.rng.reseed(s.game.rng);
  g.rngSalt = s.game.rngSalt ?? 0;
  for (const name of MODULES) Object.assign(g[name] as unknown as object, plain(s.modules[name] ?? {}));
  repairCardPool(g);
  g.forks.afterLoad(s.modules.forks);
  if (map) adoptMapNames(g, map);
  if (s.stats) attachLedger(g.players, Ledger.load(s.stats, g.players.length));
  if (s.mapRules !== undefined) g.rules?.loadState?.(plain(s.mapRules));
  return g;
}

// ---------------------------------------------------------------- 大富豪模式 (docs/rules/17 §13)

/**
 * A world save: the twelve players once, each city's board, engine fields and modules (as a normal save has them),
 * and the world's own state (calendar, turn, random stream, ticker log, the fallen rivals, the assets history).
 * `settings.mapId` is the city shown when it was saved, so the save list can name it.
 */
export interface WorldSaveData {
  version: number;
  kind: 'tycoon';
  savedAt: number;
  settings: TycoonSettings & { mapId: number };
  players: Player[];
  cities: { board: Board; game: SaveData['game']; modules: SaveData['modules'] }[];
  world: {
    date: number; daysElapsed: number; monthsElapsed: number; priceIndex: number; current: number; rng: number; rngSalt?: number;
    landed: boolean[]; log: TickerLine[]; fallen: World['fallen']; history: World['history']; visited: number[][];
    lastTrip?: number[]; lastFrom?: number[]; wantedFrom?: number[][]; overlords?: number[];
    /** The cities share one card pool (17 §3.10); older saves kept one per city. */
    sharedPool?: boolean;
    /** 大富翁城, the finale (docs/rules/19): set once it has started (the sixth city is in `cities` then). */
    finale?: FinaleState;
  };
  /** The statistics ledger (core/stats.ts), when the world kept one; older saves have none. */
  stats?: LedgerData;
}

export const isWorldSave = (s: unknown): s is WorldSaveData => !!s && (s as { kind?: string }).kind === 'tycoon';

function cityState(g: Game): WorldSaveData['cities'][number] {
  const modules: SaveData['modules'] = {};
  for (const name of MODULES) {
    const mod = g[name] as unknown as Record<string, unknown>, out: Record<string, unknown> = {};
    for (const k of Object.keys(mod)) if (!SKIP.has(k) && typeof mod[k] !== 'function') out[k] = plain(mod[k]);
    modules[name] = out;
  }
  return {
    board: plain(g.board),
    game: {
      date: g.date, daysElapsed: g.daysElapsed, monthsElapsed: g.monthsElapsed, priceIndex: g.priceIndex,
      current: g.current, diceTotal: g.diceTotal, lotteryPool: g.lotteryPool, rng: g.rng.seed,
    },
    modules,
  };
}

export function saveWorld(w: World): WorldSaveData {
  w.mask(w.view());
  const view = w.view();
  return {
    version: SAVE_VERSION,
    kind: 'tycoon',
    savedAt: Date.now(),
    settings: { ...plain(w.settings), mapId: w.mapId(Math.max(0, view)) },
    // `placed` is stored as "landed" (the cities' view of it is restored on load), so a save does not depend on
    // which city was on screen.
    players: plain(w.players).map((p, i) => ({ ...p, placed: w.landed[i] })),
    cities: w.cities.map(cityState),
    world: {
      date: w.date, daysElapsed: w.daysElapsed, monthsElapsed: w.monthsElapsed, priceIndex: w.priceIndex,
      current: w.current, rng: w.rng.seed, ...(w.rngSalt ? { rngSalt: w.rngSalt } : {}), landed: [...w.landed], log: plain(w.log), fallen: plain(w.fallen),
      history: plain(w.history), visited: plain(w.visited), lastTrip: [...w.lastTrip], lastFrom: [...w.lastFrom], wantedFrom: plain(w.wantedFrom), overlords: [...w.overlords], sharedPool: true,
      ...(w.finale.active ? { finale: w.finale.save() } : {}),
    },
    ...(ledgerOf(w.players) ? { stats: ledgerOf(w.players)!.save() } : {}),
  };
}

/**
 * Rebuilds a world; `run()` resumes at the saved turn menu. With `maps` (the cities as loaded now, by index) the
 * stock and company names follow the maps (adoptMapNames).
 */
export function loadWorld(s: WorldSaveData, maps?: Board[]): World {
  if (s.version !== SAVE_VERSION || s.kind !== 'tycoon') throw new Error('存檔版本不符');
  const { mapId: _shown, ...settings } = s.settings;
  const w = new World(settings, s.cities.map(c => c.board));
  s.players.forEach((p, i) => {
    const q = w.players[i];
    delete q.trip;
    Object.assign(q, plain(p));
    while (q.tools.length < 16) q.tools.push(0); // saves from before the lab tools 14-16 (17 §3.6)
  });
  s.cities.forEach((c, i) => {
    const g = w.cities[i];
    Object.assign(g.board, plain(c.board));
    Object.assign(g, {
      date: c.game.date, daysElapsed: c.game.daysElapsed, monthsElapsed: c.game.monthsElapsed, priceIndex: c.game.priceIndex,
      current: c.game.current, diceTotal: c.game.diceTotal, lotteryPool: c.game.lotteryPool,
    });
    g.rng.reseed(c.game.rng);
    for (const name of MODULES) Object.assign(g[name] as unknown as object, plain(c.modules[name] ?? {}));
    repairCardPool(g);
    g.forks.afterLoad(c.modules.forks);
    if (maps?.[i]) adoptMapNames(g, maps[i]);
  });
  const x = s.world;
  Object.assign(w, {
    date: x.date, daysElapsed: x.daysElapsed, monthsElapsed: x.monthsElapsed, priceIndex: x.priceIndex, current: x.current,
    landed: [...x.landed], log: plain(x.log), fallen: plain(x.fallen), history: plain(x.history), visited: plain(x.visited),
    lastTrip: [...(x.lastTrip ?? [])], lastFrom: [...(x.lastFrom ?? [])], wantedFrom: plain(x.wantedFrom ?? w.players.map(() => [])), overlords: [...(x.overlords ?? [])],
  });
  w.rng.reseed(x.rng);
  w.rngSalt = x.rngSalt ?? 0;
  for (const c of w.cities) c.rngSalt = w.rngSalt;
  w.finale.restore(x.finale);
  // One nationwide card pool (17 §3.10): the cities' saved copies are the same array again (an older save's own pools
  // are added up); each city's 通緝卡 follows wantedFrom.
  w.sharePool(x.sharedPool ? 'saved' : 'merge');
  w.syncWanted();
  w.resumeAtTurn = true;
  w.mask(w.view());
  if (s.stats) attachLedger(w.players, Ledger.load(s.stats, w.players.length));
  return w;
}

/**
 * A loaded game rolls differently from the last time it was played from that save (issue #5: 「反復讀一個存檔後，每次擲出的
 * 骰子數完全一樣」 — the original reseeds from the clock when loading, rich4_save_files.asm). `salt` comes from the screen
 * (crypto random); the rules stay deterministic from here on, so a game can still be replayed from the new save.
 */
export function reshuffleGame(g: Game, salt: number): void {
  g.rngSalt = (salt >>> 0) || 1;
  g.rng.reseed(daySeed((g.rollSeed() ^ 0x51ed5eed) >>> 0, g.daysElapsed));
}
export function reshuffleWorld(w: World, salt: number): void {
  w.rngSalt = (salt >>> 0) || 1;
  w.rng.reseed(daySeed((w.settings.seed ^ w.rngSalt) >>> 0, w.daysElapsed));
  w.cities.forEach((c, i) => { c.rngSalt = w.rngSalt; c.rng.reseed(daySeed((w.citySeed(i) ^ w.rngSalt) >>> 0, w.daysElapsed)); });
}
