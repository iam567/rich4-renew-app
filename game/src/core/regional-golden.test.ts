import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { Game, REMAKE_FREE_BUILD, REMAKE_HOTEL } from './game';
import { pack } from './date';
import { saveGame } from './save';
import { Forks } from './modules/forks';
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

/**
 * Hashes with the construction company's free floors on large plots too (REMAKE_FREE_BUILD, the user 2026-10-18;
 * docs/rules/02 §5): with them off every map gives the hashes below (HOTEL), checked by the second test. Four maps
 * changed: 2 (day 193), 100 東京 (days 152, 187) and 101 大阪 (days 73, 124) only in the fireworks flag of a floor
 * that topped a property out on the second step (everything else bit for bit); 102 札幌 from day 17, where the
 * computer's free floors went on an empty large plot (#4005) instead of its level-2 facility.
 */
const GOLDEN: Record<number, string> = {
  0: 'ff64da19cc51dc47', 1: 'f0246854a78ee808', 2: 'e3fcb95c703f1d06', 3: '3531ca59818d688a', 4: '7e01b1cee5d1146e',
  5: 'd21d73aecf156451', 6: '3c325285a23ded9b', 7: '8f129350179c3558', 100: '886c4fd637afada1', 101: 'b5bc53d6150f8a55',
  102: '33d99b88ea6f0bc5', 103: 'fc429a45646aaf27', 104: '2e436d9ef29514b5',
};

/**
 * Before REMAKE_FREE_BUILD: hashes with the fork choices of 2026-10-18 (docs/rules/14 §2) and the remake's hotel
 * rules of the same day (REMAKE_HOTEL: 免費卡 / 嫁禍卡 on a stay, 土地公 at check-out; docs/rules/02 §4.3, 06 §5.5).
 * Maps 0, 7, 102 and 103 changed with the hotel rules (a stay framed or a hotel taken at check-out in those runs);
 * with them off every map gives the fork-rule hashes below (FORKS_ONLY), checked by the third test.
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

  it('with the free floors on large plots off every map plays as with the hotel rules', () => {
    REMAKE_FREE_BUILD.on = false;
    try {
      const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
      for (const id of MAPS) expect(got[id], `map ${id} (free floors on large plots off)`).toBe(HOTEL[id]);
    } finally { REMAKE_FREE_BUILD.on = true; }
  }, 120_000);

  it('with the hotel rules off (and the free floors on large plots) every map plays as with the fork rule alone', () => {
    REMAKE_HOTEL.on = false; REMAKE_FREE_BUILD.on = false;
    try {
      const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
      for (const id of MAPS) expect(got[id], `map ${id} (hotel rules off)`).toBe(FORKS_ONLY[id]);
    } finally { REMAKE_HOTEL.on = true; REMAKE_FREE_BUILD.on = true; }
  }, 120_000);

  it('with the earlier fork rule (and the remake rules above off) every map still plays bit for bit as before 2026-10-18', () => {
    Forks.legacy = true; REMAKE_HOTEL.on = false; REMAKE_FREE_BUILD.on = false;
    try {
      const got = Object.fromEntries(MAPS.map(id => [id, goldenRun(id, 200)]));
      for (const id of MAPS) expect(got[id], `map ${id} (legacy forks)`).toBe(LEGACY[id]);
    } finally { Forks.legacy = false; REMAKE_HOTEL.on = true; REMAKE_FREE_BUILD.on = true; }
  }, 120_000);
});
