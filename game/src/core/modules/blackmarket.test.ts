import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { pack } from '../date';
import type { Flow } from '../flow';
import { Game } from '../game';
import type { Answer, GameSettings, Step } from '../types';
import { CARD_PRICE_FACTOR, LAND_MULTIPLE, MAX_LISTINGS, TOOL_PRICES } from './blackmarket';
import { CARDS } from './cards';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));

function makeGame(seed = 1): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(2), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 2, players: [0, 1, 3, 4].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
  };
  const g = new Game(settings, board);
  for (const p of g.players) { p.whoPlays = 2; p.placed = true; }
  return g;
}

function drive<T>(flow: Flow<T>, answers: Answer[] = []): { result: T; steps: Step[] } {
  const steps: Step[] = [];
  let r = flow.next();
  while (!r.done) {
    steps.push(r.value);
    r = flow.next('ask' in r.value ? answers.shift() : undefined);
  }
  return { result: r.value, steps };
}

describe.skipIf(!existsSync(mapFile(2)))('black market (docs/rules/10)', () => {
  it('stocks a tool and a card each month at the black-market prices, at most six listings', () => {
    const g = makeGame(), bm = g.blackMarket;
    drive(bm.monthly());
    const [tool, card] = bm.listings;
    expect(tool.kind).toBe('tool');
    expect(tool.base).toBe(TOOL_PRICES[tool.id - 1]);
    expect(card.kind).toBe('card');
    expect(card.base).toBe(CARDS[card.id - 1].price * CARD_PRICE_FACTOR);
    for (let m = 0; m < 6; m++) { g.daysElapsed += 30; drive(bm.monthly()); }
    expect(bm.listings.length).toBe(MAX_LISTINGS);
  });

  it('offers a lot unowned for three months in a row at 50× its price, and drops it once sold', () => {
    const g = makeGame(), bm = g.blackMarket;
    for (const l of g.board.lands) l.owner = 1;
    const lot = g.board.lands[5];
    lot.owner = 0;
    for (let m = 0; m < 2; m++) { drive(bm.monthly()); g.daysElapsed += 30; }
    expect(bm.listings.some(l => l.kind === 'land')).toBe(false);
    drive(bm.monthly());
    const listed = bm.listings.find(l => l.kind === 'land')!;
    expect(listed.id).toBe(lot.id);
    expect(listed.base).toBe(lot.price * LAND_MULTIPLE);
    lot.owner = 2; // bought on the board
    g.daysElapsed += 30;
    drive(bm.monthly());
    expect(bm.listings.some(l => l.kind === 'land' && l.id === lot.id)).toBe(false);
  });

  it('sells for cash only, within the holding limits and the tool supply', () => {
    const g = makeGame(), bm = g.blackMarket, p = g.players[0];
    bm.listings = [{ kind: 'tool', id: 8, base: 10000, since: g.date }, { kind: 'card', id: 3, base: 35000, since: g.date }];
    p.cash = 5000; p.bank = 1_000_000;
    expect(drive(bm.buy(p, 0)).result).toBe(false); // the deposit does not count
    p.cash = 50_000;
    const supply = g.tools.shopStock[7], held = p.tools[7];
    expect(drive(bm.buy(p, 0)).result).toBe(true);
    expect(p.cash).toBe(40_000);
    expect(p.tools[7]).toBe(held + 1);
    expect(g.tools.shopStock[7]).toBe(supply - 1);
    p.cards = new Array(15).fill(1);
    expect(drive(bm.buy(p, 0)).result).toBe(false); // hand full
    expect(bm.listings.length).toBe(1);
  });

  it('a computer buys under the same conditions, keeping its reserve', () => {
    const g = makeGame(), bm = g.blackMarket, p = g.players[1];
    bm.listings = [{ kind: 'tool', id: 13, base: 300000, since: g.date }, { kind: 'tool', id: 9, base: 30000, since: g.date }];
    p.cash = 100_000; // 30 % of the 200,000 fund (60,000) is kept: only the 30,000 worker fits
    const before = p.tools[8];
    drive(bm.aiTurn(p));
    expect(p.tools[8]).toBe(before + 1);
    expect(p.cash).toBe(70_000);
    expect(bm.listings.map(l => l.id)).toEqual([13]);
  });
});
