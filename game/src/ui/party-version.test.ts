/**
 * 派對模式's version check (party-version.ts, issue #8): the texts, and the handshake between rooms of the same or
 * different versions over an in-memory PeerJS (the message layer mocked: every send arrives as a copy, in order).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('peerjs', () => {
  type H = Record<string, ((...a: unknown[]) => void)[]>;
  const emit = (h: H, ev: string, ...a: unknown[]) => { for (const f of [...(h[ev] ?? [])]) f(...a); };
  class Conn {
    open = false; other: Conn | null = null; h: H = {};
    constructor(readonly peer: string) {}
    on(ev: string, f: (...a: unknown[]) => void) { (this.h[ev] ??= []).push(f); return this; }
    send(d: unknown) {
      if (!this.open) return;
      const o = this.other!, copy = structuredClone(d);
      queueMicrotask(() => { if (o.open) emit(o.h, 'data', copy); });
    }
    close() {
      if (!this.open) return;
      this.open = false; emit(this.h, 'close');
      const o = this.other!;
      if (o.open) { o.open = false; queueMicrotask(() => emit(o.h, 'close')); }
    }
  }
  const peers = new Map<string, Peer>();
  let n = 0;
  class Peer {
    id: string; h: H = {}; destroyed = false; conns: Conn[] = [];
    constructor(id?: unknown) {
      this.id = typeof id === 'string' ? id : `peer-${++n}`;
      queueMicrotask(() => {
        if (peers.has(this.id)) { emit(this.h, 'error', { type: 'unavailable-id' }); return; }
        peers.set(this.id, this); emit(this.h, 'open', this.id);
      });
    }
    on(ev: string, f: (...a: unknown[]) => void) { (this.h[ev] ??= []).push(f); return this; }
    connect(id: string) {
      const a = new Conn(id);
      queueMicrotask(() => {
        const t = peers.get(id);
        if (!t || t.destroyed || this.destroyed) { emit(this.h, 'error', { type: 'peer-unavailable' }); return; }
        const b = new Conn(this.id);
        a.other = b; b.other = a; a.open = b.open = true;
        this.conns.push(a); t.conns.push(b);
        emit(t.h, 'connection', b);
        emit(a.h, 'open');
      });
      return a;
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (peers.get(this.id) === this) peers.delete(this.id);
      for (const c of this.conns) c.close();
    }
    reconnect() {}
  }
  return { default: Peer };
});

import { Lobby, Room, type RoomInfo } from './party-net';
import { hostMismatch, refuseGuest, sameVersion, statsByVersion } from './party-version';

const settle = async (ms = 0) => { for (let k = 0; k < 20; k++) await Promise.resolve(); if (ms) await new Promise(r => setTimeout(r, ms)); for (let k = 0; k < 20; k++) await Promise.resolve(); };
const me = (character: number, nick?: string) => ({ name: nick ?? `p${character}`, character, nick });
const open: { close(): void }[] = [];
const room = (ver: string | null, character = 0, nick?: string) => { const r = new Room(me(character, nick), ver); open.push(r); return r; };

beforeAll(() => { vi.stubGlobal('window', globalThis); });
afterEach(() => { for (const r of open.splice(0)) r.close(); });

describe('version texts', () => {
  it('the same version joins; another one is told both versions and where to get the newest', () => {
    expect(refuseGuest('0.7.4', '0.7.4', '阿土伯')).toBeNull();
    const r = refuseGuest('0.7.4', '0.7.2', '阿土伯')!;
    expect(r.why).toContain('版本不同：房主是 v0.7.4，你是 v0.7.2');
    expect(r.why).toContain('到下載頁下載最新版本');
    expect(r.line).toBe('阿土伯的版本是 v0.7.2，和你的 v0.7.4 不同，無法加入');
  });
  it('an old phone (no version) is told its version is too old, in words its own screen shows (請出)', () => {
    const r = refuseGuest('0.7.4', undefined, '孫小美')!;
    expect(r.why).toMatch(/太舊/); expect(r.why).toMatch(/請出/);
    expect(r.line).toBe('孫小美的版本太舊，和你的 v0.7.4 不同，無法加入');
  });
  it('no server is named', () => {
    for (const t of [refuseGuest('0.7.4', '0.7.2', 'x')!.why, refuseGuest('0.7.4', null, 'x')!.why, hostMismatch('0.7.4', undefined)!, hostMismatch('0.7.4', '0.7.5')!])
      expect(t).not.toMatch(/https?:|\.(com|info|net|org|pro)|github/i);
  });
  it('a guest checks the host: the same, another, none (an old host)', () => {
    expect(hostMismatch('0.7.4', '0.7.4')).toBeNull();
    expect(hostMismatch('0.7.4', '0.7.5')).toContain('房主是 v0.7.5，你是 v0.7.4');
    expect(hostMismatch('0.7.4', undefined)).toContain('房主的版本太舊');
  });
  it('the list counts each version apart; old rooms are another version', () => {
    const r = (players: number, ver?: string, priv = false): RoomInfo => ({ code: String(Math.random()), host: '', character: 0, map: '', players, max: 8, at: Date.now(), ver, private: priv });
    const by = statsByVersion([r(2, '0.7.4'), r(1, '0.7.4', true), r(3, '0.7.2'), r(1)], ['0.7.4', undefined, '0.7.2']);
    expect(by['0.7.4']).toEqual({ privateRooms: 1, waiting: 3 });
    expect(by['0.7.2']).toEqual({ privateRooms: 0, waiting: 4 });
    expect(by['']).toEqual({ privateRooms: 0, waiting: 2 });
    expect(sameVersion(r(1, '0.7.4'), '0.7.4')).toBe(true);
    expect(sameVersion(r(1), '0.7.4')).toBe(false);
    expect(sameVersion(r(1, '0.7.2'), '0.7.4')).toBe(false);
  });
});

describe('the handshake (mocked PeerJS)', () => {
  it('the same version joins as before', async () => {
    const host = room('0.7.4', 0);
    const code = await host.create('2', false);
    const g = room('0.7.4', 3);
    await g.join(code);
    await settle();
    expect(host.members.map(m => m.character)).toEqual([0, 3]);
    expect(g.members.length).toBe(2);
    expect(g.refused || host.refused).toBe(false);
  });

  it('another version is refused with a message on both sides', async () => {
    const host = room('0.7.4', 0);
    const code = await host.create('2', false);
    const g = room('0.7.2', 3, '小美');
    await expect(g.join(code)).rejects.toThrow(/版本不同：房主是 v0\.7\.4，你是 v0\.7\.2。\n請兩邊都到下載頁下載最新版本後再連線/);
    expect(g.refused).toBe(true);
    await settle();
    expect(host.members.length).toBe(1);
    expect(host.chat.map(l => l.text)).toContain('小美的版本是 v0.7.2，和你的 v0.7.4 不同，無法加入');
  });

  it('an old phone (sends no version) is refused, and its own (old) screen gets the reason', async () => {
    const host = room('0.7.4', 0);
    const code = await host.create('2', false);
    const old = room(null, 5);
    const status: string[] = [];
    old.onStatus = t => status.push(t);
    await old.join(code); // an old phone does not wait for the answer
    await settle();
    expect(status.join()).toMatch(/版本太舊/);
    expect(old.kicked).toBe(true); // what makes v0.7.3's room screen show the text (party.ts onStatus)
    expect(host.members.length).toBe(1);
    expect(host.chat.some(l => /版本太舊，和你的 v0\.7\.4 不同，無法加入/.test(l.text))).toBe(true);
  });

  it('a new phone joining an old host (which ignores the version) leaves with the reason instead of waiting', async () => {
    const old = room(null, 0);
    const code = await old.create('2', false);
    const g = room('0.7.4', 3);
    await expect(g.join(code)).rejects.toThrow(/房主的版本太舊/);
    expect(g.refused).toBe(true);
    await settle();
    expect(old.members.length).toBe(1); // its connection closed: the old host drops it again
  });

  it('a full room still says so', async () => {
    const host = room('0.7.4', 0);
    const code = await host.create('2', false);
    for (let k = 1; k < 8; k++) await room('0.7.4', k).join(code);
    await settle();
    expect(host.members.length).toBe(8);
    await expect(room('0.7.4', 9).join(code)).rejects.toThrow('房間已滿');
  });

  it('host migration: the next player takes the room over; the others reconnect to it', async () => {
    const host = room('0.7.4', 0);
    const code = await host.create('2', false);
    const a = room('0.7.4', 1), b = room('0.7.4', 2);
    await a.join(code); await settle();
    await b.join(code); await settle();
    const lines: string[] = [];
    a.onChat = l => lines.push(l.text);
    host.close();
    for (let k = 0; k < 40 && !(a.host && a.members.filter(m => !m.away).length === 2 && b.connected()); k++) await settle(250);
    expect(a.host).toBe(true);
    expect(lines).toContain('你成為新的房主');
    expect(b.connected()).toBe(true);
    expect(b.refused).toBe(false);
    expect(a.members.filter(m => !m.away).map(m => m.character).sort()).toEqual([1, 2]); // (the lost host's seat stays, away)
  }, 20000);
});

describe('the room list (mocked PeerJS)', () => {
  it("each version's figures; an old holder's total", async () => {
    const holder = new Lobby('0.7.4'); open.push(holder);
    const mine: RoomInfo = { code: '1234', host: 'x', character: 0, map: 'm', players: 2, max: 8, at: Date.now(), ver: '0.7.4' };
    await holder.start(mine);
    await settle(10);
    const other = new Lobby('0.7.2'); open.push(other);
    await other.start(undefined, true);
    await settle(10);
    const oldSeeker = new Lobby(null); open.push(oldSeeker);
    await oldSeeker.start(undefined, true);
    await settle(10);
    expect(holder.stats).toEqual({ privateRooms: 0, waiting: 2 });
    expect(other.stats).toEqual({ privateRooms: 0, waiting: 1 });
    expect(oldSeeker.stats.waiting).toBe(4); // an old phone: everyone, as before
    expect([...other.rooms.values()].map(r => r.ver)).toEqual(['0.7.4']); // listed, shown 「版本不同」 (party.ts)
  });
});
