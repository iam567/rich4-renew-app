import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { DOOR_STEP, Game, REMAKE_CARD_POOL, REMAKE_FREE_BUILD, REMAKE_HOTEL } from './game';
import { pack } from './date';
import { saveGame } from './save';
import { REMAKE_CARD_SUPPLY } from './modules/cards';
import { Forks } from './modules/forks';
import { REMAKE_AI_ONE_CARD } from './modules/tools';
import type { GameSettings } from './types';

/**
 * Normal mode stays the original (docs/rules/18 §1): the 大富豪模式 local news / fate and the world-wide decks must not
 * touch a normal game. Every map (the eight originals and the five remake cities, which a normal game can also play)
 * runs 200 computer days from a fixed seed; the hash of every step and of the final save must equal the hashes taken
 * before the local events were added (2026-10-16, commit 5cdb6a8 + the working tree then).
 *
 * 2026-10-18 the fork choices changed on purpose (docs/rules/14 §2: every real road equally likely, 0..5 instead of
 * the relative 直走/左轉/右轉), which changes every path and so every hash: `GOLDEN` was taken once then. With the
 * test hook `Forks.legacy` (the earlier rule) the runs must still give the hashes taken before, bit for bit — the
 * proof that nothing but the fork choices changed.
 *
 * 2026-10-22 the release from the hospital / prison changed on purpose (GitHub issue #2; docs/rules/06 §9.3.1): the one
 * released walks out onto the door square first and that square is resolved (a mine there sends them back in), as the
 * original's who_plays 0x10 step does. Every map's hash changed: on all of them the 'leave-hospital' / 'leave-prison'
 * event now comes at the walk out (after the 'turn' event) instead of at the turn start, and on all but 100 東京 the
 * runs then differ (a mine, a god, a time bomb on a door square, a carried bomb counting the walk-out step). `GOLDEN`
 * was taken again then; with the test hook `DOOR_STEP` off every map gives the hashes taken before (ONE_CARD), and the
 * further tests below turn it off too — the proof that nothing but the release changed.
 */
const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };
const mapFile = (id: number) => fileURLToPath(new URL(id >= 100 ? `../../../editor/site/assets/remake/${KEYS[id]}.json` : `../../../editor/site/assets/map-${id}.json`, import.meta.url));
const MAPS = [0, 1, 2, 3, 4, 5, 6, 7, 100, 101, 102, 103, 104];
const have = MAPS.every(id => existsSync(mapFile(id)));

export function goldenRun(mapId: number, days: number): string {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 9000 + mapId,
  };
  const game = new Game(settings, board);
  const h = createHash('sha256');
  const flow = game.run();
  let boards = 0;
  for (let r = flow.next(); !r.done && game.daysElapsed < days; r = flow.next()) {
    const s = r.value as { t?: string; kind?: string };
    if (s.t === 'fx' && (s.kind === 'news' || s.kind === 'fate')) boards++;
    // The lab's line names its owner since 2026-10-18 (「X的Y開發完成！」, the user): the wording only, hashed as before.
    const say = r.value as { t?: string; text?: string };
    if (say.t === 'say' && say.text && /開發完成！$/.test(say.text)) { h.update(JSON.stringify({ ...say, text: say.text.replace(/^.+?的(?=[^的]+開發完成！$)/, '') })); continue; }
    h.update(JSON.stringify(r.value));
  }
  // The run must really cover the days and draw news and fate (else the hash proves nothing).
  if (!game.over && game.daysElapsed < days) throw new Error(`map ${mapId}: only ${game.daysElapsed} days`);
  if (boards < 5) throw new Error(`map ${mapId}: only ${boards} news / fate boards`);
  if (process.env.RICH4_PRINT_GOLDEN) console.log(mapId, game.daysElapsed, boards, !!game.over);
  const save = saveGame(game) as unknown as Record<string, unknown>;
  delete save.savedAt;
  h.update(JSON.stringify(save));
  return h.digest('hex').slice(0, 16);
}

/** Hashes with the walk out of the hospital / prison onto the door square (DOOR_STEP, 2026-10-22, issue #2). */
const GOLDEN: Record<number, string> = {
  0: '97a67828cad8a731', 1: 'b991e6216bfd844c', 2: '2619bcb644c36d24', 3: 'c6613ce9f78f8925', 4: 'ca625138d6bc7d25',
  5: '7780a6cbf7941d44', 6: '79fb33090daf03b0', 7: '4e55a87a04404326', 100: '080f2b186fcfa504', 101: '2690839886b9a9b9',
  102: '6e57556a29412ec0', 103: '3715540a1c34196c', 104: '83bed89b24d5bd5d',
};

/**
 * Before DOOR_STEP (the GOLDEN of 2026-10-19 to 2026-10-21): hashes with the computer buying at most one copy of each
 * card per shop visit (REMAKE_AI_ONE_CARD, the user 2026-10-19; docs/rules/05 §10.2). Every map but 5 and 100 東京
 * changed (a computer bought a second copy there); with it off every map gives the hashes below (CARD_SUPPLY),
 * checked by the third test.
 */
const ONE_CARD: Record<number, string> = {
  0: 'e4d97f7dcf97b2a1', 1: '839e37c9749bdfed', 2: '8029ac451da73f4a', 3: '3847d9339f293381', 4: 'dacacfce21273218',
  5: 'b23b5f88b3913d53', 6: '4717d843c10d42cc', 7: 'fbc0eec86fe619b4', 100: 'cff54e1e7cf1b3a3', 101: '67bd4827025f8489',
  102: 'f6ff562ee131cd4e', 103: '5d85c5989bca43fa', 104: '47f91258b25626f2',
};

/**
 * Hashes with the remake's copies per card (REMAKE_CARD_SUPPLY, the user 2026-10-19; docs/rules/04 §1): every map's
 * pool differs from day one, so every hash changed. With the original copies every map gives the hashes below
 * (CARD_POOL), checked by the fourth test.
 */
const CARD_SUPPLY: Record<number, string> = {
  0: '3ee254372c8f6c42', 1: '9e27482c05e1ecf1', 2: 'c835a5214aa866fb', 3: '9ca87d7996071b2d', 4: 'a999b750a731a053',
  5: 'b23b5f88b3913d53', 6: '2634aa66c04ebef6', 7: '6a487ce7b1ea11ea', 100: 'cff54e1e7cf1b3a3', 101: '740ca5fbd2abeb5a',
  102: '6e7c3c5ff1d8ca5e', 103: '46fc42cc85c4c9c3', 104: '53cd9bcad31bbfa7',
};

/**
 * Hashes with the card pool that stops at 0 (REMAKE_CARD_POOL, 2026-10-19; docs/rules/04 §2.1): the original's byte
 * wrapped a card handed out when none was left to 255 copies, which then filled the whole draw pool (the user's
 * shelves and draws were all 均富卡). Two maps hit it in these runs: 3 and 100 東京. With it off every map gives the
 * hashes below (FREE_BUILD), checked by the fifth test.
 */
const CARD_POOL: Record<number, string> = {
  0: 'ff64da19cc51dc47', 1: 'f0246854a78ee808', 2: 'e3fcb95c703f1d06', 3: '402fe158a58989ee', 4: '7e01b1cee5d1146e',
  5: 'd21d73aecf156451', 6: '3c325285a23ded9b', 7: '8f129350179c3558', 100: '4d0f94de316caeff', 101: 'b5bc53d6150f8a55',
  102: '33d99b88ea6f0bc5', 103: 'fc429a45646aaf27', 104: '2e436d9ef29514b5',
};

/**
 * Hashes with the construction company's free floors on large plots too (REMAKE_FREE_BUILD, the user 2026-10-18;
 * docs/rules/02 §5): with them off every map gives the hashes below (HOTEL), checked by the sixth test. Four maps
 * changed: 2 (day 193), 100 東京 (days 152, 187) and 101 大阪 (days 73, 124) only in the fireworks flag of a floor
 * that topped a property out on the second step (everything else bit for bit); 102 札幌 from day 17, where the
 * computer's free floors went on an empty large plot (#4005) instead of its level-2 facility.
 */
const FREE_BUILD: Record<number, string> = {
  0: 'ff64da19cc51dc47', 1: 'f0246854a78ee808', 2: 'e3fcb95c703f1d06', 3: '3531ca59818d688a', 4: '7e01b1cee5d1146e',
  5: 'd21d73aecf156451', 6: '3c325285a23ded9b', 7: '8f129350179c3558', 100: '886c4fd637afada1', 101: 'b5bc53d6150f8a55',
  102: '33d99b88ea6f0bc5', 103: 'fc429a45646aaf27', 104: '2e436d9ef29514b5',
};

/**
 * Before REMAKE_FREE_BUILD: hashes with the fork choices of 2026-10-18 (docs/rules/14 §2) and the remake's hotel
 * rules of the same day (REMAKE_HOTEL: 免費卡 / 嫁禍卡 on a stay, 土地公 at check-out; docs/rules/02 §4.3, 06 §5.5).
 * Maps 0, 7, 102 and 103 changed with the hotel rules (a stay framed or a hotel taken at check-out in those runs);
 * with them off every map gives the fork-rule hashes below (FORKS_ONLY), checked by the seventh test.
 */
const HOTEL: Record<number, string> = {
  0: 'ff64da19cc51dc47', 1: 'f0246854a78ee808', 2: 'bda32fecd5e7d8d1', 3: '3531ca59818d688a', 4: '7e01b1cee5d1146e',
  5: 'd21d73aecf156451', 6: '3c325285a23ded9b', 7: '8f129350179c3558', 100: '85ddb441591645bf', 101: 'e7b047bbe7fc0067',
  102: 'c21cd9facece35d5', 103: 'fc429a45646aaf27', 104: '2e436d9ef29514b5',
};

/** The fork-rule hashes of 2026-10-18 before the hotel rules (REMAKE_HOTEL off). */
const FORKS_ONLY: Record<number, string> = {
  0: '1ec7b32d388daaf6', 1: 'f0246854a78ee808', 2: 'bda32fecd5e7d8d1', 3: '3531ca59818d688a', 4: '7e01b1cee5d1146e',
  5: 'd21d73aecf156451', 6: '3c325285a23ded9b', 7: '80b147d1bcc5e179', 100: '85ddb441591645bf', 101: 'e7b047bbe7fc0067',
  102: '292bc4eba5631a1f', 103: 'c6d0981b302b83fb', 104: '2e436d9ef29514b5',
};

/** Hashes taken before the regional events existed, with the earlier fork rule (`Forks.legacy`). */
const LEGACY: Record<number, string> = {
  0: '897efe927eed0cdc', 1: 'f9fc6f63f125f531', 2: '0ced4144f7a073b8', 3: '2fe8ea37cebb1349', 4: '2eb7120b12b7b482',
  5: 'd86c865fcf563ada', 6: '52dd1728be1481bd', 7: 'b40755b198f271f4', 100: 'f9d23758716ca428', 101: '2910bb8883533e34',
  102: 'c1539c9b48b6f16e', 103: '3017f90d8f361881', 104: 'ae6f0403ac401dbc',
};

describe.skipIf(!have)('normal mode is unchanged by 大富豪模式 local events', () => {
  it('every map plays bit for bit as before', () => {
    const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
    if (process.env.RICH4_PRINT_GOLDEN) console.log(JSON.stringify(got));
    for (const id of MAPS) expect(got[id], `map ${id}`).toBe(GOLDEN[id]);
  }, 120_000);

  it('with the earlier release from the hospital / prison every map plays bit for bit as before 2026-10-22', () => {
    DOOR_STEP.on = false;
    try {
      const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
      for (const id of MAPS) expect(got[id], `map ${id} (door step off)`).toBe(ONE_CARD[id]);
    } finally { DOOR_STEP.on = true; }
  }, 120_000);

  it('with the computer buying as in the original every map plays as with the remake copies per card', () => {
    DOOR_STEP.on = false; REMAKE_AI_ONE_CARD.on = false;
    try {
      const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
      for (const id of MAPS) expect(got[id], `map ${id} (computer buys every copy)`).toBe(CARD_SUPPLY[id]);
    } finally { DOOR_STEP.on = true; REMAKE_AI_ONE_CARD.on = true; }
  }, 120_000);

  it('with the original copies per card every map plays as with the card pool fix', () => {
    DOOR_STEP.on = false; REMAKE_AI_ONE_CARD.on = false; REMAKE_CARD_SUPPLY.on = false;
    try {
      const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
      for (const id of MAPS) expect(got[id], `map ${id} (original copies)`).toBe(CARD_POOL[id]);
    } finally { DOOR_STEP.on = true; REMAKE_AI_ONE_CARD.on = true; REMAKE_CARD_SUPPLY.on = true; }
  }, 120_000);

  it('with the card pool wrapping as in the original every map plays as with the free floors', () => {
    DOOR_STEP.on = false; REMAKE_AI_ONE_CARD.on = false; REMAKE_CARD_SUPPLY.on = false; REMAKE_CARD_POOL.on = false;
    try {
      const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
      for (const id of MAPS) expect(got[id], `map ${id} (card pool wraps)`).toBe(FREE_BUILD[id]);
    } finally { DOOR_STEP.on = true; REMAKE_AI_ONE_CARD.on = true; REMAKE_CARD_SUPPLY.on = true; REMAKE_CARD_POOL.on = true; }
  }, 120_000);

  it('with the free floors on large plots off every map plays as with the hotel rules', () => {
    DOOR_STEP.on = false; REMAKE_AI_ONE_CARD.on = false; REMAKE_CARD_SUPPLY.on = false; REMAKE_CARD_POOL.on = false; REMAKE_FREE_BUILD.on = false;
    try {
      const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
      for (const id of MAPS) expect(got[id], `map ${id} (free floors on large plots off)`).toBe(HOTEL[id]);
    } finally { DOOR_STEP.on = true; REMAKE_AI_ONE_CARD.on = true; REMAKE_CARD_SUPPLY.on = true; REMAKE_CARD_POOL.on = true; REMAKE_FREE_BUILD.on = true; }
  }, 120_000);

  it('with the hotel rules off (and the free floors on large plots) every map plays as with the fork rule alone', () => {
    DOOR_STEP.on = false; REMAKE_AI_ONE_CARD.on = false; REMAKE_CARD_SUPPLY.on = false; REMAKE_CARD_POOL.on = false; REMAKE_HOTEL.on = false; REMAKE_FREE_BUILD.on = false;
    try {
      const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
      for (const id of MAPS) expect(got[id], `map ${id} (hotel rules off)`).toBe(FORKS_ONLY[id]);
    } finally { DOOR_STEP.on = true; REMAKE_AI_ONE_CARD.on = true; REMAKE_CARD_SUPPLY.on = true; REMAKE_CARD_POOL.on = true; REMAKE_HOTEL.on = true; REMAKE_FREE_BUILD.on = true; }
  }, 120_000);

  it('with the earlier fork rule (and the remake rules above off) every map still plays bit for bit as before 2026-10-18', () => {
    Forks.legacy = true; DOOR_STEP.on = false; REMAKE_AI_ONE_CARD.on = false; REMAKE_CARD_SUPPLY.on = false; REMAKE_CARD_POOL.on = false; REMAKE_HOTEL.on = false; REMAKE_FREE_BUILD.on = false;
    try {
      const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
      for (const id of MAPS) expect(got[id], `map ${id} (legacy forks)`).toBe(LEGACY[id]);
    } finally { Forks.legacy = false; DOOR_STEP.on = true; REMAKE_AI_ONE_CARD.on = true; REMAKE_CARD_SUPPLY.on = true; REMAKE_CARD_POOL.on = true; REMAKE_HOTEL.on = true; REMAKE_FREE_BUILD.on = true; }
  }, 120_000);
});
