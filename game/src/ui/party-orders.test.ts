/**
 * 等待中下單 (the user 2026-11-07) and 等待時送禮物 over the in-memory PeerJS: orders reach the host, are answered once,
 * and survive being sent again; a player of the game may send gifts like a spectator.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('peerjs', () => import('./peerjs-mock'));

import { pack } from '../core/date';
import { Room, startMsg } from './party-net';

const settle = async (ms = 5) => { for (let k = 0; k < 20; k++) await Promise.resolve(); await new Promise(r => setTimeout(r, ms)); for (let k = 0; k < 20; k++) await Promise.resolve(); };
const open: Room[] = [];
const room = (character: number) => { const r = new Room({ name: `p${character}`, character }, '0.8.0'); open.push(r); return r; };

beforeAll(() => { vi.stubGlobal('window', globalThis); });
afterEach(() => { for (const r of open.splice(0)) r.close(); });

async function game() {
  const host = room(0), a = room(1), b = room(2);
  const code = await host.create('2', true);
  await a.join(code); await b.join(code);
  await settle();
  host.start(startMsg(host, 4, pack(2026, 11, 3), 7));
  await settle();
  return { host, a, b, seat: (r: Room) => [...r.mine][0] };
}

describe('等待中下單', () => {
  it('reaches the host, oldest first, and is answered once', async () => {
    const { host, a, b, seat } = await game();
    expect(a.placeOrder(seat(a), 1, true, 100)).toBe(true);
    await settle(2);
    expect(b.placeOrder(seat(b), 2, false, 50)).toBe(true);
    await settle(2);
    host.placeOrder(seat(host), 3, true, 10);
    await settle();
    const list = host.takeOrders();
    expect(list.map(o => o.slot)).toEqual([1, 2, 3]);
    expect(host.takeOrders()).toEqual([]);
    for (const r of [host, a, b]) r.ordersFilled(list);
    expect([host, a, b].map(r => r.myOrders.length)).toEqual([0, 0, 0]);
  });

  it('an order sent again after it was filled is not filled twice', async () => {
    const { host, a, seat } = await game();
    a.placeOrder(seat(a), 1, true, 100);
    await settle();
    const stale = [...a.myOrders];
    const list = host.takeOrders();
    host.ordersFilled(list);
    // the answer has not reached this phone yet: it sends what it still thinks waits
    a.resendOrders();
    await settle();
    expect(host.takeOrders()).toEqual([]);
    a.ordersFilled(list);
    expect(a.myOrders).toEqual([]);
    expect(stale.length).toBe(1);
  });

  it('a cancelled order is gone, and only so many may wait', async () => {
    const { host, a, seat } = await game();
    for (let k = 0; k < Room.MAX_ORDERS; k++) expect(a.placeOrder(seat(a), k, true, 10)).toBe(true);
    expect(a.placeOrder(seat(a), 9, true, 10)).toBe(false);
    a.cancelOrder(a.myOrders[0].id);
    await settle();
    expect(host.takeOrders().map(o => o.slot)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a phone cannot order for another seat', async () => {
    const { host, a, b, seat } = await game();
    a.placeOrder(seat(b), 1, true, 100);
    await settle();
    expect(host.takeOrders()).toEqual([]);
  });

  it('a new host hears the orders on the next turn and knows what was filled', async () => {
    const { host, a, b, seat } = await game();
    a.placeOrder(seat(a), 1, true, 100);
    await settle();
    const first = host.takeOrders();
    for (const r of [host, a, b]) r.ordersFilled(first);
    a.placeOrder(seat(a), 2, true, 100);
    await settle();
    expect(a.myOrders.length).toBe(1);
    expect(b.takeOrders()).toEqual([]);
  });
});

describe('等待時送禮物', () => {
  it('a player of the game sends a gift, everyone hears who, once in a while', async () => {
    const { host, a, b } = await game();
    const heard: [string, string, boolean][][] = [[], [], []];
    [host, a, b].forEach((r, i) => { r.onCheer = (k, n, p) => heard[i].push([k, n, p]); });
    a.cheer('tomato');
    await settle();
    expect(heard.map(h => h.length)).toEqual([1, 1, 1]);
    expect(heard[2][0]).toEqual(['tomato', host.nameOf(a.myId), true]);
    a.cheer('rose');
    await settle();
    expect(heard[1].length).toBe(1);
  });

  it('the host sends one too', async () => {
    const { host, a } = await game();
    const got: string[] = [];
    a.onCheer = k => got.push(k);
    host.cheer('clap');
    await settle();
    expect(got).toEqual(['clap']);
  });
});
