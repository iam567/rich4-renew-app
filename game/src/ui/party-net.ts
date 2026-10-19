/**
 * 派對模式's network (v0.5.0, the user 2026-10-19): friends play one game on their own phones, peer to peer (WebRTC
 * through PeerJS; its free public server only introduces the phones, the game's data goes phone to phone).
 *
 * Lockstep: every phone runs the same game from the same seed (the rules use only the game's own random stream), so
 * only the players' answers travel — a seat's owner sends each of its answers, numbered in the order the game asks;
 * the others wait for that number. The room's host relays (a star), keeps every answer, and sends a phone that comes
 * back after a drop (an iPhone in the background loses the connection) what it missed. Each turn the host also sends
 * a digest of the game; a phone whose game differs says so.
 *
 * Rooms: 「建立房間」 makes a room with a 4-digit code (私享: friends type the code in 「進入房間」); a 共享 room is also
 * listed in 「尋找夥伴」. That list needs no server of our own: one phone holds it (the peer id LOBBY); every shared
 * room and every phone looking at the list connects to it, and when it goes another one takes the id over and the
 * rooms announce themselves again.
 */
import Peer, { type DataConnection } from 'peerjs';

const PREFIX = 'rich4-party-v1-';
export const LOBBY = `${PREFIX}lobby`;
const roomId = (code: string) => `${PREFIX}room-${code}`;

export interface Member { id: string; name: string; character: number }
export interface RoomInfo { code: string; host: string; character: number; map: string; players: number; max: number; at: number }
/** What the host sends when the game starts. */
export interface StartMsg { settings: import('../core/types').GameSettings; seats: Record<string, number> }

type Msg =
  | { t: 'hi'; name: string; character: number; have?: number }
  | { t: 'char'; character: number }
  | { t: 'lobby'; members: Member[]; map: string; shared: boolean }
  | { t: 'start'; start: StartMsg }
  | { t: 'ans'; seq: number; v: unknown; u?: boolean }
  | { t: 'log'; from: number; answers: [unknown, boolean][] }
  | { t: 'digest'; seq: number; h: number }
  | { t: 'bye' };

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A PeerJS peer with a given id, or null when the id is taken (another phone has it). */
function open(id?: string): Promise<Peer | null> {
  return new Promise(resolve => {
    const p = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    let done = false;
    p.on('open', () => { if (!done) { done = true; resolve(p); } });
    p.on('error', e => {
      if (done) return;
      done = true;
      p.destroy();
      resolve((e as { type?: string }).type === 'unavailable-id' ? null : null);
    });
    setTimeout(() => { if (!done) { done = true; p.destroy(); resolve(null); } }, 12000);
  });
}

function connect(peer: Peer, id: string): Promise<DataConnection | null> {
  return new Promise(resolve => {
    const c = peer.connect(id, { reliable: true });
    let done = false;
    const fail = () => { if (!done) { done = true; c.close(); resolve(null); } };
    c.on('open', () => { if (!done) { done = true; resolve(c); } });
    c.on('error', fail);
    peer.on('error', e => { if ((e as { type?: string }).type === 'peer-unavailable') fail(); });
    setTimeout(fail, 10000);
  });
}

/** The 「尋找夥伴」 list: held by whichever phone has the LOBBY id (see the header). */
export class Lobby {
  rooms = new Map<string, RoomInfo>();
  onRooms: (rooms: RoomInfo[]) => void = () => {};
  private peer: Peer | null = null;
  private holder: Peer | null = null;
  private conns = new Set<DataConnection>();
  private toHolder: DataConnection | null = null;
  private timer = 0;
  private closed = false;
  private mine: RoomInfo | null = null;

  /** Starts watching (and announcing `room` every 8 s while set). */
  async start(room?: RoomInfo): Promise<void> {
    this.mine = room ?? null;
    void this.loop();
  }
  announce(room: RoomInfo | null) { this.mine = room; this.push(); }

  private list(): RoomInfo[] {
    const now = Date.now();
    for (const [k, r] of this.rooms) if (now - r.at > 25000) this.rooms.delete(k);
    return [...this.rooms.values()].sort((a, b) => b.at - a.at);
  }
  private push() {
    if (this.holder) {
      if (this.mine) this.rooms.set(this.mine.code, { ...this.mine, at: Date.now() });
      const rooms = this.list();
      for (const c of this.conns) c.open && c.send({ t: 'rooms', rooms });
      this.onRooms(rooms);
    } else if (this.toHolder?.open) {
      this.toHolder.send(this.mine ? { t: 'room', room: { ...this.mine, at: Date.now() } } : { t: 'list' });
    }
  }

  private async loop() {
    while (!this.closed) {
      if (!this.holder && !this.toHolder?.open) {
        // Join the list's holder, else become it.
        this.peer ??= await open();
        const c = this.peer && await connect(this.peer, LOBBY);
        if (c) {
          this.toHolder = c;
          c.on('data', d => { const m = d as { t: string; rooms?: RoomInfo[] }; if (m.t === 'rooms' && m.rooms) { this.rooms = new Map(m.rooms.map(r => [r.code, r])); this.onRooms(this.list()); } });
          c.on('close', () => { this.toHolder = null; });
        } else {
          const h = await open(LOBBY);
          if (h) {
            this.holder = h;
            h.on('connection', c2 => {
              this.conns.add(c2);
              c2.on('data', d => {
                const m = d as { t: string; room?: RoomInfo; code?: string };
                if (m.t === 'room' && m.room) this.rooms.set(m.room.code, { ...m.room, at: Date.now() });
                if (m.t === 'room-off' && m.code) this.rooms.delete(m.code);
                this.push();
              });
              c2.on('close', () => this.conns.delete(c2));
            });
            h.on('disconnected', () => { if (!this.closed) h.reconnect(); });
          }
        }
      }
      this.push();
      await wait(8000);
    }
  }

  close() {
    this.closed = true;
    if (this.mine && this.toHolder?.open) this.toHolder.send({ t: 'room-off', code: this.mine.code });
    clearTimeout(this.timer);
    this.toHolder?.close();
    this.holder?.destroy();
    this.peer?.destroy();
  }
}

/** One room: the host's side or a guest's. */
export class Room {
  code = '';
  host = false;
  members: Member[] = [];
  map = '';
  shared = false;
  started: StartMsg | null = null;
  /** The player seats this phone plays. */
  mine = new Set<number>();
  onLobby: () => void = () => {};
  onStart: (s: StartMsg) => void = () => {};
  onStatus: (text: string) => void = () => {};

  private peer: Peer | null = null;
  private guests = new Map<string, DataConnection>();
  private toHost: DataConnection | null = null;
  private log: [unknown, boolean][] = [];
  private waiters = new Map<number, (v: unknown) => void>();
  private digests = new Map<number, number>();
  private closed = false;
  myId = '';

  constructor(readonly me: { name: string; character: number }) {}

  /** Host: a new room; resolves with its code. */
  async create(map: string, shared: boolean): Promise<string> {
    this.host = true; this.map = map; this.shared = shared;
    for (let k = 0; k < 6 && !this.peer; k++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      this.peer = await open(roomId(code));
      if (this.peer) this.code = code;
    }
    if (!this.peer) throw new Error('無法建立房間（網路連不上）');
    this.myId = this.peer.id;
    this.members = [{ id: this.myId, ...this.me }];
    this.peer.on('connection', c => this.guest(c));
    this.peer.on('disconnected', () => { if (!this.closed) this.peer?.reconnect(); });
    return this.code;
  }

  /** Guest: joins the room with that code. */
  async join(code: string): Promise<void> {
    this.code = code;
    this.peer = await open();
    if (!this.peer) throw new Error('網路連不上');
    this.myId = this.peer.id;
    this.peer.on('disconnected', () => { if (!this.closed) this.peer?.reconnect(); });
    if (!(await this.reach())) throw new Error('找不到這個房間');
  }

  private async reach(): Promise<boolean> {
    const c = this.peer && await connect(this.peer, roomId(this.code));
    if (!c) return false;
    this.toHost = c;
    c.on('data', d => this.fromHost(d as Msg));
    c.on('close', () => { this.toHost = null; if (!this.closed) void this.rejoin(); });
    c.send({ t: 'hi', name: this.me.name, character: this.me.character, have: this.started ? this.log.length : undefined } satisfies Msg);
    return true;
  }

  /** A guest lost the host (the phone slept, the network dropped): tries again until it is back. */
  private async rejoin() {
    this.onStatus('與房主的連線中斷，重新連線中…');
    for (let k = 0; !this.closed && !this.toHost; k++) {
      await wait(Math.min(2000 + k * 1000, 8000));
      if (this.peer?.disconnected) this.peer.reconnect();
      if (this.peer && !this.peer.destroyed && await this.reach()) { this.onStatus(''); return; }
    }
  }

  private guest(c: DataConnection) {
    c.on('data', d => {
      const m = d as Msg;
      if (m.t === 'hi') {
        this.guests.set(c.peer, c);
        if (this.started) {
          // Back after a drop: what it missed.
          const from = m.have ?? 0;
          c.send({ t: 'log', from, answers: this.log.slice(from) } satisfies Msg);
          this.onStatus('');
          return;
        }
        if (!this.members.some(x => x.id === c.peer)) {
          if (this.members.length >= 4) { c.send({ t: 'bye' } satisfies Msg); return; }
          this.members.push({ id: c.peer, name: m.name, character: this.freeCharacter(m.character, c.peer) });
        }
        this.lobbyChanged();
      } else if (m.t === 'char') {
        const x = this.members.find(y => y.id === c.peer);
        if (x) { x.character = this.freeCharacter(m.character, c.peer); this.lobbyChanged(); }
      } else if (m.t === 'ans') {
        this.record(m.seq, m.u ? undefined : m.v, true);
      }
    });
    c.on('close', () => {
      this.guests.delete(c.peer);
      if (!this.started) { this.members = this.members.filter(x => x.id !== c.peer); this.lobbyChanged(); }
      else if (!this.closed) this.onStatus('有玩家斷線，等待他回來…');
    });
  }

  freeCharacter(want: number, id: string): number {
    const used = new Set(this.members.filter(x => x.id !== id).map(x => x.character));
    let c = want;
    for (let k = 0; k < 12 && used.has(c); k++) c = (c + 1) % 12;
    return c;
  }

  private lobbyChanged() {
    const m: Msg = { t: 'lobby', members: this.members, map: this.map, shared: this.shared };
    for (const c of this.guests.values()) c.open && c.send(m);
    this.onLobby();
  }
  setMap(map: string) { this.map = map; this.lobbyChanged(); }
  setCharacter(c: number) {
    if (this.host) { const x = this.members[0]; x.character = this.freeCharacter(c, x.id); this.lobbyChanged(); }
    else this.toHost?.send({ t: 'char', character: c } satisfies Msg);
  }

  private fromHost(m: Msg) {
    if (m.t === 'lobby') { this.members = m.members; this.map = m.map; this.shared = m.shared; this.onLobby(); }
    else if (m.t === 'start') { this.begin(m.start); }
    else if (m.t === 'ans') this.record(m.seq, m.u ? undefined : m.v, false);
    else if (m.t === 'log') m.answers.forEach(([v, u], k) => this.record(m.from + k, u ? undefined : v, false));
    else if (m.t === 'digest') this.digests.set(m.seq, m.h);
    else if (m.t === 'bye') { this.onStatus('房間已滿'); this.close(); }
  }

  /** Host: starts the game for everyone. */
  start(s: StartMsg) {
    const m: Msg = { t: 'start', start: s };
    for (const c of this.guests.values()) c.open && c.send(m);
    this.begin(s);
  }
  private begin(s: StartMsg) {
    this.started = s;
    this.mine = new Set(Object.entries(s.seats).filter(([id]) => id === this.myId).map(([, seat]) => seat));
    this.onStart(s);
  }

  /** An answer to the game's question number `seq` (from this phone, or arriving). */
  private record(seq: number, v: unknown, fromGuest: boolean) {
    if (seq < this.log.length && this.log[seq] !== undefined) return;
    this.log[seq] = [v, v === undefined];
    if (this.host && fromGuest) {
      const m: Msg = { t: 'ans', seq, v: v ?? null, u: v === undefined };
      for (const c of this.guests.values()) c.open && c.send(m);
    }
    this.waiters.get(seq)?.(v);
    this.waiters.delete(seq);
  }
  /** This phone answered question `seq` (one of its seats). */
  answer(seq: number, v: unknown) {
    this.record(seq, v, false);
    const m: Msg = { t: 'ans', seq, v: v ?? null, u: v === undefined };
    if (this.host) { for (const c of this.guests.values()) c.open && c.send(m); }
    else this.toHost?.send(m);
  }
  /** The answer to question `seq` of another phone's seat. */
  wait(seq: number): Promise<unknown> {
    const have = this.log[seq];
    if (have) return Promise.resolve(have[1] ? undefined : have[0]);
    return new Promise(resolve => this.waiters.set(seq, resolve));
  }

  /** Each turn: the host sends its game's digest; a guest compares (true while they agree). */
  digest(seq: number, h: number): boolean {
    if (this.host) { const m: Msg = { t: 'digest', seq, h }; for (const c of this.guests.values()) c.open && c.send(m); return true; }
    const theirs = this.digests.get(seq);
    return theirs === undefined || theirs === h;
  }

  close() {
    this.closed = true;
    for (const c of this.guests.values()) c.close();
    this.toHost?.close();
    this.peer?.destroy();
  }
}
