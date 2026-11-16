/**
 * 圍觀's switches (the user 2026-11-04): a player may close 圍觀 or 接手 and send a spectator away, and everyone sees
 * what the player at the wheel is doing. Over the in-memory PeerJS.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('peerjs', () => import('./peerjs-mock'));

import { pack } from '../core/date';
import type { Ask } from '../core/types';
import { askDoing, LOCAL_DOING } from './party-doing';
import { Room, startMsg } from './party-net';

const settle = async (ms = 0) => { for (let k = 0; k < 20; k++) await Promise.resolve(); if (ms) await new Promise(r => setTimeout(r, ms)); for (let k = 0; k < 20; k++) await Promise.resolve(); };
const open: Room[] = [];
const room = (character: number) => { const r = new Room({ name: `p${character}`, character }, '0.8.0'); open.push(r); return r; };

beforeAll(() => { vi.stubGlobal('window', globalThis); });
afterEach(() => { for (const r of open.splice(0)) r.close(); });

async function game() {
  const host = room(0), guest = room(1);
  const code = await host.create('2', true);
  await guest.join(code);
  await settle(5);
  host.setRules({ dropIn: 1 });
  await settle(5);
  host.seatOpen = seat => seat > 1;
  host.start(startMsg(host, 4, pack(2026, 11, 3), 7));
  await settle(5);
  return { host, guest, code };
}
const line = (r: Room, part: string) => r.chat.some(l => l.text.includes(part));

describe('圍觀 and 接手 switches', () => {
  it('a guest closes 圍觀: every phone knows, a new spectator is refused, one already there stays', async () => {
    const { host, guest, code } = await game();
    const first = room(2);
    await first.watch(code);
    await settle(5);
    expect(host.watcherList.map(w => w.id)).toEqual([first.myId]);
    guest.setWatch({ watch: false });
    await settle(5);
    expect(host.allowWatch).toBe(false);
    expect(guest.allowWatch).toBe(false);
    expect(line(host, '關閉了圍觀')).toBe(true);
    await expect(room(3).watch(code)).rejects.toThrow('沒有開放圍觀');
    expect(host.watchCount).toBe(1);
  });

  it('接手 closed: no seats for a spectator, no 途中加入', async () => {
    const { host, guest, code } = await game();
    expect(host.freeSeats().length).toBeGreaterThan(0);
    const w = room(2);
    await w.watch(code);
    await settle(5);
    guest.setWatch({ take: false });
    await settle(5);
    expect(host.freeSeats()).toEqual([]);
    expect(host.vacantSeats()).toEqual([]);
    expect(w.vacant).toEqual([]);
    const seat = 2;
    w.take(seat);
    await settle(5);
    expect(host.started!.seats[w.myId]).toBeUndefined();
    guest.setWatch({ take: true });
    await settle(5);
    expect(host.vacantSeats().length).toBeGreaterThan(0);
  });

  it('a spectator sent away leaves, is named in the chat and does not come back', async () => {
    // one install: its id is kept in the phone's storage
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } });
    const { host, guest, code } = await game();
    const w = room(2);
    let said = '';
    w.onStatus = t => { said = t; };
    await w.watch(code);
    await settle(5);
    const id = w.myId;
    guest.sendAway(id);
    await settle(5);
    expect(said).toContain('離開圍觀');
    expect(host.watchCount).toBe(0);
    expect(line(host, '離開了')).toBe(true);
    expect(host.watcherList).toEqual([]);
    // the same install on a new connection (a new Room has a new id)
    await expect(room(2).watch(code)).rejects.toThrow('離開圍觀');
    expect(host.watchCount).toBe(0);
    vi.unstubAllGlobals(); vi.stubGlobal('window', globalThis);
  });

  it('a spectator can neither switch nor send away', async () => {
    const { host, code } = await game();
    const a = room(2), b = room(3);
    await a.watch(code); await b.watch(code);
    await settle(5);
    a.setWatch({ watch: false });
    a.sendAway(b.myId);
    await settle(5);
    expect(host.allowWatch).toBe(true);
    expect(host.watchCount).toBe(2);
  });

  it('a player hears the switches the host set', async () => {
    const { host, guest } = await game();
    host.setWatch({ take: false });
    await settle(5);
    expect(guest.allowTake).toBe(false);
  });
});

describe('what a player is doing', () => {
  it('a window opened on one phone reaches the others; only for its own seat, only known windows', async () => {
    const { host, guest, code } = await game();
    const w = room(2);
    await w.watch(code);
    await settle(5);
    guest.doing(1, 'info');
    await settle(5);
    expect(host.doings.get(1)).toBe('info');
    expect(w.doings.get(1)).toBe('info');
    guest.doing(1, '');
    await settle(5);
    expect(host.doings.has(1)).toBe(false);
    guest.doing(0, 'map'); // not its seat
    guest.doing(1, 'anything');
    await settle(5);
    expect(host.doings.size).toBe(0);
  });

  it('every question reads as something', () => {
    const q = (s: object) => askDoing(s as Ask);
    expect(q({ t: 'stock-market', p: 0 })).toBe('正在看股票');
    expect(q({ t: 'choose', p: 0, title: '使用卡片', options: [], cancellable: true, layout: 'cards' })).toBe('正在挑卡片');
    expect(q({ t: 'choose', p: 0, title: '道具', options: [], cancellable: true, layout: 'tiles' })).toBe('正在挑道具');
    expect(q({ t: 'yesno', p: 0, kind: 'buy-land', text: '' })).toBe('正在考慮買地');
    expect(q({ t: 'turn', p: 0, maxDice: 1, canUseCard: true, canUseTool: true })).toBe('正在想下一步');
    expect(LOCAL_DOING.info).toBe('正在查看玩家資料');
  });
});
