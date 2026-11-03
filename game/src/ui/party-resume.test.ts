/**
 * 派對模式: a player whose app closed comes back with the room code (issue #50) — its seat again, the newest turn's
 * snapshot and the answers since. Over the in-memory PeerJS (peerjs-mock.ts).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('peerjs', () => import('./peerjs-mock'));

import { pack } from '../core/date';
import { Room, startMsg, type StartMsg } from './party-net';

const settle = async () => { for (let k = 0; k < 40; k++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); for (let k = 0; k < 40; k++) await Promise.resolve(); };
const open: Room[] = [];
const room = (character: number) => { const r = new Room({ name: `p${character}`, character }, '0.9.1'); open.push(r); return r; };
const store = new Map<string, string>();

beforeAll(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
});
afterEach(() => { for (const r of open.splice(0)) r.close(); store.clear(); });

describe('派對模式: back after the app closed (issue #50)', () => {
  it('the same device, the same room code: its seat, the snapshot and the answers since', async () => {
    const host = room(0);
    const code = await host.create('2', false);
    const g = room(3);
    await g.join(code); await settle();
    host.start(startMsg(host, 4, pack(2026, 11, 2), 77));
    await settle();
    const seat = [...g.mine][0];
    expect(seat).toBe(1);
    // A few answers, a turn's snapshot at question 2, more answers.
    host.answer(0, 'a'); host.answer(1, 'b');
    host.snapshot(2, () => '{"save":1}');
    host.answer(2, 'c'); host.answer(3, 'd');
    await settle();
    // The guest's app closes; the same device opens it again and types the code.
    g.close(); await settle();
    const g2 = room(3);
    let started: StartMsg | null = null;
    await g2.join(code); await settle();
    g2.onStart = s => { started = s; };
    if (g2.started) g2.onStart(g2.started);
    expect(started).not.toBeNull();
    expect(g2.resume).toEqual({ save: '{"save":1}', seq: 2 });
    expect([...g2.mine]).toEqual([seat]);
    expect(await g2.wait(2)).toBe('c');
    expect(await g2.wait(3)).toBe('d');
    // The host counts the seat as connected again, one member for it.
    expect(host.ownerConnected(seat)).toBe(true);
    expect(host.members.filter(m => m.character === 3).length).toBe(1);
  });

  it('a stranger with the room code of a game going on is told it started, and gets no seat', async () => {
    const host = room(0);
    const code = await host.create('2', false);
    const g = room(3);
    await g.join(code); await settle();
    host.start(startMsg(host, 4, pack(2026, 11, 2), 5));
    await settle();
    store.clear(); // another device
    const s = room(5);
    await expect(s.join(code)).rejects.toThrow('已經開始');
    await settle();
    expect(s.started).toBeNull();
    expect(s.resume).toBeNull();
  });
});
