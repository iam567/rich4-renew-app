/**
 * 換地圖 (the user 2026-11-04): in the game, all the players connected agree, and the same room plays the next game on
 * another map — starting over, or with the money kept. Over the in-memory PeerJS.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('peerjs', () => import('./peerjs-mock'));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../core/board';
import { pack } from '../core/date';
import { Game, keptMoney } from '../core/game';
import { nextGameMsg, Room, startMsg, type StartMsg } from './party-net';

const settle = async (ms = 5) => { for (let k = 0; k < 20; k++) await Promise.resolve(); await new Promise(r => setTimeout(r, ms)); for (let k = 0; k < 20; k++) await Promise.resolve(); };
const open: Room[] = [];
const room = (character: number) => { const r = new Room({ name: `p${character}`, character }, '0.8.0'); open.push(r); return r; };

beforeAll(() => { vi.stubGlobal('window', globalThis); });
afterEach(() => { for (const r of open.splice(0)) r.close(); });

/** A host and two guests in a game; each phone counts the next games it plays. */
async function game() {
  const host = room(0), a = room(1), b = room(2);
  const code = await host.create('2', true);
  await a.join(code); await b.join(code);
  await settle();
  host.start(startMsg(host, 4, pack(2026, 11, 3), 7));
  await settle();
  const got: StartMsg[][] = [[], [], []];
  [host, a, b].forEach((r, i) => { r.onRestart = s => got[i].push(s); r.mapTitle = id => `地圖${id}`; });
  host.nextGame = (map, keep) => nextGameMsg(host, host.started!.settings.players.map(p => ({ ...p, ...(keep ? { keep: { cash: 1, bank: 2 } } : {}) })), map, 99);
  return { host, a, b, code, got };
}

describe('換地圖', () => {
  it('passes only when everyone agrees: all phones start the next game, the room stays', async () => {
    const { host, a, b, got } = await game();
    a.proposeMap(3, false);
    await settle();
    expect(b.mapVote?.yes).toEqual([a.myId]);
    expect(b.mapVote?.need).toBe(3);
    host.voteMap(true);
    await settle();
    expect(got[0].length).toBe(0);
    b.voteMap(true);
    await settle();
    expect(got.map(g => g.length)).toEqual([1, 1, 1]);
    expect(got[1][0].settings.mapId).toBe(3);
    expect(got[2][0].settings.seed).toBe(99);
    expect(a.gen).toBe(1);
    expect(b.map).toBe('3');
    expect(host.mapVote).toBeNull();
    expect(a.connected()).toBe(true);
    expect(b.started?.seats).toEqual(host.started?.seats);
  });

  it('one no ends it and the game goes on; another vote waits a while', async () => {
    const { host, a, b, got } = await game();
    a.proposeMap(3, true);
    await settle();
    b.voteMap(false);
    await settle();
    expect(host.mapVote).toBeNull();
    expect(a.mapVote).toBeNull();
    expect(got[0].length).toBe(0);
    expect(host.gen).toBe(0);
    expect(host.chat.some(l => l.text.includes('不同意'))).toBe(true);
    host.proposeMap(4, false);
    await settle();
    expect(host.mapVote).toBeNull();
  });

  it('a player gone does not hold it up; a spectator neither votes nor proposes', async () => {
    const { host, a, b, code, got } = await game();
    const w = room(3);
    await w.watch(code);
    await settle();
    w.proposeMap(3, false);
    await settle();
    expect(host.mapVote).toBeNull();
    a.proposeMap(3, false);
    await settle();
    w.voteMap(true);
    await settle();
    expect(host.mapVote?.yes.length).toBe(1);
    b.close();
    await settle();
    host.voteMap(true);
    await settle();
    expect(got[0].length).toBe(1);
  });

  it('an unknown map is no vote', async () => {
    const { host, a } = await game();
    host.mapTitle = () => '';
    a.proposeMap(999, false);
    await settle();
    expect(host.mapVote).toBeNull();
  });

  it('the money kept goes along in the settings', async () => {
    const { host, a, b, got } = await game();
    host.proposeMap(3, true);
    await settle();
    a.voteMap(true); b.voteMap(true);
    await settle();
    expect(got[2][0].settings.players[0].keep).toEqual({ cash: 1, bank: 2 });
  });

  it('an answer of the game before never reaches the next one', async () => {
    const { host, a, b } = await game();
    a.answer(0, 'old');
    await settle();
    host.proposeMap(3, false);
    await settle();
    a.voteMap(true); b.voteMap(true);
    await settle();
    // the phone still on the last game's question 5 when the next game began
    (a as unknown as { gen: number }).gen = 0;
    a.answer(5, 'late');
    (a as unknown as { gen: number }).gen = 1;
    await settle();
    let heard = false;
    void host.wait(5).then(() => { heard = true; });
    await settle();
    expect(heard).toBe(false);
    a.answer(5, 'new');
    await settle();
    expect(await host.wait(5)).toBe('new');
  });
});

describe('a phone away during 換地圖', () => {
  it('is sent the game going on, from its first question', async () => {
    const { host, a, b, code } = await game();
    void code;
    host.proposeMap(3, false);
    await settle();
    a.voteMap(true); b.voteMap(true);
    await settle();
    const sent: { t: string; gen?: number }[] = [];
    const conn = { send: (m: { t: string; gen?: number }) => sent.push(m) };
    const back = { have: 40, gen: 0 };
    (host as unknown as { catchUp(c: unknown, m: unknown): void }).catchUp(conn, back);
    expect(sent.map(m => [m.t, m.gen])).toEqual([['restart', 1]]);
    expect(back.have).toBe(0);
    // already on this game: nothing
    sent.length = 0;
    const same = { have: 40, gen: 1 };
    (host as unknown as { catchUp(c: unknown, m: unknown): void }).catchUp(conn, same);
    expect(sent).toEqual([]);
    expect(same.have).toBe(40);
  });
});

describe('the money kept', () => {
  it('reaches the next game; the others start from the fund', () => {
    const board = parseBoard(JSON.parse(readFileSync(fileURLToPath(new URL('../../../editor/site/assets/map-2.json', import.meta.url)), 'utf8')) as RawMap);
    const g = new Game({ mapId: 2, players: [{ character: 0, human: true, keep: { cash: 12345, bank: 678 } }, { character: 1, human: true }], fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 3), seed: 1, party: true }, board);
    expect([g.players[0].cash, g.players[0].bank]).toEqual([12345, 678]);
    expect(g.players[1].cash + g.players[1].bank).toBe(g.fund);
  });
  it('cash and deposits less the loan; never less than a tenth of the fund', () => {
    expect(keptMoney({ cash: 90000, bank: 50000, loan: 0 }, 200000)).toEqual({ cash: 90000, bank: 50000 });
    expect(keptMoney({ cash: 90000, bank: 50000, loan: 40000 }, 200000)).toEqual({ cash: 90000, bank: 10000 });
    expect(keptMoney({ cash: 90000, bank: 0, loan: 60000 }, 200000)).toEqual({ cash: 30000, bank: 0 });
    expect(keptMoney({ cash: -500, bank: 0, loan: 80000 }, 200000)).toEqual({ cash: 0, bank: 20000 });
  });
});
