/** 派對模式's network check (party-check.ts, issue #12): the servers it gathers with, and what it says. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('peerjs', () => ({ default: class {} }));

import { verdict } from './party-check';
import { ICE_SERVERS } from './party-net';

const urls = ICE_SERVERS.flatMap(s => (Array.isArray(s.urls) ? s.urls : [s.urls]));

describe('the network check (issue #12)', () => {
  it("gathers with the game's own servers: public STUN reachable from mainland China, our TURN over UDP and TCP, none of PeerJS's", () => {
    expect(urls).toContain('stun:stun.chat.bilibili.com:3478');
    expect(urls).toContain('stun:stun.miwifi.com:3478');
    expect(urls.some(u => u.startsWith('turn:') && u.endsWith('transport=udp'))).toBe(true);
    expect(urls.some(u => u.startsWith('turn:') && u.endsWith('transport=tcp'))).toBe(true);
    expect(urls.some(u => /peerjs/.test(u))).toBe(false);
  });
  it('a way out (STUN) plays; the relay only plays with a note', () => {
    expect(verdict(true, new Set(['host', 'srflx']))).toEqual({ ok: true });
    const r = verdict(true, new Set(['host', 'relay']));
    expect(r.ok && r.note).toMatch(/轉送/);
  });
  it("only the phone's own addresses: plays, on the same Wi-Fi only, and says a VPN may be why", () => {
    const r = verdict(true, new Set(['host']));
    expect(r.ok).toBe(true);
    expect(r.ok && r.note).toMatch(/只能和同一個 Wi-Fi 的人連線/);
    expect(r.ok && r.note).toMatch(/VPN/);
  });
  it('nothing at all, or no signalling server: refused, mentioning the VPN / proxy and UDP, no server named', () => {
    for (const r of [verdict(true, new Set()), verdict(false, new Set(['srflx']))]) {
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.text).toMatch(/VPN/); expect(r.text).toMatch(/UDP/);
      expect(r.text).not.toMatch(/flj|peerjs|google|\.com|\.info/i);
    }
  });
});
