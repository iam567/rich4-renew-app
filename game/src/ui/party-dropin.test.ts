/**
 * 派對模式's 途中加入 (the user 2026-11-03): a room with it starts with one player and computers; a phone joining the
 * game going on gets a computer's seat, the game from the newest turn, and takes the seat over at that computer's
 * next turn (the host's answer to the 'seat' question, the same on every phone). Over the in-memory PeerJS.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('peerjs', () => import('./peerjs-mock'));

import { parseBoard, type RawMap } from '../core/board';
import { pack } from '../core/date';
import { Game, type Flow } from '../core/game';
import { Room, startMsg, type StartMsg } from './party-net';

const settle = async (ms = 0) => { for (let k = 0; k < 20; k++) await Promise.resolve(); if (ms) await new Promise(r => setTimeout(r, ms)); for (let k = 0; k < 20; k++) await Promise.resolve(); };
const open: Room[] = [];
const room = (character: number, nick?: string) => { const r = new Room({ name: `p${character}`, character, nick }, '0.8.0'); open.push(r); return r; };
const mapFile = fileURLToPath(new URL('../../../editor/site/assets/map-2.json', import.meta.url));

beforeAll(() => { vi.stubGlobal('window', globalThis); });
afterEach(() => { for (const r of open.splice(0)) r.close(); });

describe('途中加入 in the room', () => {
  it('one player starts with three computers; a phone joining later gets a computer seat and the game', async () => {
    const host = room(0);
    const code = await host.create('2', true);
    host.setRules({ dropIn: 1 });
    const s = startMsg(host, 4, pack(2026, 11, 3), 7);
    expect(s.settings.dropIn).toBe(true);
    expect(s.settings.players.filter(p => p.human).length).toBe(1);
    host.seatOpen = seat => seat > 0;
    host.start(s);
    expect(host.freeSeats()).toEqual([1, 2, 3]);
    // nobody yet: a computer's seat question is answered 0
    expect(host.seatAnswer(1)).toBe(0);
    const late = room(5, '阿明');
    let got: StartMsg | null = null;
    late.onStart = st => { got = st; };
    await late.join(code); await settle();
    expect(got).not.toBeNull();
    expect(late.mine.size).toBe(1);
    const seat = [...late.mine][0];
    expect(seat).toBe(1);
    expect(host.started!.seats[late.myId]).toBe(1);
    expect(host.freeSeats()).toEqual([2, 3]);
    expect(host.seatAnswer(1)).toEqual({ nick: '阿明' });
  });

  it('without 途中加入 a phone arriving after the start watches instead (圍觀)', async () => {
    const host = room(0);
    const code = await host.create('2', true);
    const g = room(3);
    await g.join(code); await settle();
    host.start(startMsg(host, 4, pack(2026, 11, 3), 7));
    const late = room(5);
    let got: StartMsg | null = null;
    late.onStart = st => { got = st; };
    await late.join(code); await settle();
    expect(got).not.toBeNull();
    expect(late.watching).toBe(true);
    expect(late.mine.size).toBe(0);
    expect(host.watchCount).toBe(1);
    expect(late.watchCount).toBe(1);
  });
});

describe('圍觀 (spectators)', () => {
  it('a spectator cheers (rate-limited, passed to everyone); takes a seat left by a player voted out; 暫離 keeps a seat', async () => {
    const host = room(0);
    const code = await host.create('2', true);
    const a = room(3), b = room(4);
    await a.join(code); await b.join(code); await settle();
    host.start(startMsg(host, 4, pack(2026, 11, 3), 7));
    await settle();
    host.seatOpen = () => false;
    host.seatHuman = seat => seat <= 2;
    const fan = room(6, '粉絲');
    await fan.watch(code); await settle();
    expect(fan.watching).toBe(true);
    const heard: string[] = [];
    host.onCheer = (k, n) => heard.push(`host ${k} ${n}`);
    a.onCheer = (k, n) => heard.push(`a ${k} ${n}`);
    fan.cheer('flower'); await settle();
    fan.cheer('egg'); await settle();     // within 5 s: dropped
    expect(heard).toEqual(['host flower 粉絲', 'a flower 粉絲']);
    // a spectator never answers for a seat
    expect(host.vacantSeats()).toEqual([]);
    // b is gone for over 30 s, but on 暫離: still kept
    b.reserve(true); await settle();
    const priv = host as unknown as { awaySince: Map<string, number>; guests: Map<string, { open: boolean }> };
    const bid = b.myId;
    priv.awaySince.set(bid, Date.now() - 60_000);
    const conn = priv.guests.get(bid)!; Object.defineProperty(conn, 'open', { get: () => false, configurable: true });
    expect(host.vacantSeats().map(v => v.seat)).toEqual([]);
    // without 暫離 the seat is free; the spectator takes it (first come)
    (host as unknown as { reservedUntil: Map<string, number> }).reservedUntil.delete(bid);
    const seatB = host.started!.seats[bid];
    expect(host.vacantSeats().map(v => v.seat)).toEqual([seatB]);
    fan.take(seatB); await settle();
    expect(host.started!.seats[fan.myId]).toBe(seatB);
    expect(bid in host.started!.seats).toBe(false);
    expect(fan.watching).toBe(false);
    expect(fan.mine.has(seatB)).toBe(true);
    expect(host.watchCount).toBe(0);
  });
});

describe.skipIf(!existsSync(mapFile))('途中加入 in the game', () => {
  it("a computer's seat taken over at its turn: a human from then on, its money and lots kept", () => {
    const settings = { mapId: 2, players: [{ character: 0, human: true }, { character: 4, human: false }, { character: 9, human: false }, { character: 11, human: false }],
      fundIndex: 1, traffic: 0 as const, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 3), seed: 9, party: true, dropIn: true, aiLevel: 2 as const };
    const g = new Game(settings, parseBoard(JSON.parse(readFileSync(mapFile, 'utf8')) as RawMap));
    const flow: Flow = g.run();
    let r = flow.next(), seatAsks = 0, took = false, askedAfter = 0, steps = 0;
    while (!r.done && g.daysElapsed < 12 && ++steps < 200000) {
      const s = r.value as { ask?: boolean; t: string; p?: number; action?: string };
      if ('ask' in s) {
        if (s.t === 'seat') {
          seatAsks++;
          // day 4: a player joins for seat 1
          if (s.p === 1 && g.daysElapsed >= 3 && !took) { took = true; const cash = g.players[1].cash; r = flow.next({ nick: '阿明' }); expect(g.players[1].human).toBe(true); expect(g.players[1].nick).toBe('阿明'); expect(g.players[1].cash).toBe(cash); continue; }
          r = flow.next(0); continue;
        }
        if (s.p === 1) askedAfter++;
        // every human question: let the computer play it (托管 at the turn)
        r = flow.next(s.t === 'turn' ? { action: 'autopilot' } : s.t === 'auto-turn' ? 0 : undefined);
        continue;
      }
      r = flow.next();
    }
    expect(seatAsks).toBeGreaterThan(5);
    expect(took).toBe(true);
    expect(askedAfter).toBeGreaterThan(0);
  });
});
