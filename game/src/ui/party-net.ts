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
 * Every phone is a host-in-waiting (the user 2026-10-19: "connected, everyone is the host"): every phone keeps every
 * answer and the room's members; when the host leaves (voted out, or gone), the next player in the list takes the
 * room's id over and the others reconnect to it, sending what it lacks. A player voted out (two others agreeing — the
 * host too) leaves; in a game the computer takes the seat over (托管 at its next turn).
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

export interface Member { id: string; name: string; character: number; region?: string }
export interface RoomInfo { code: string; host: string; character: number; map: string; players: number; max: number; at: number; region?: string }
export interface ChatLine { from: string; name: string; character: number; text: string; at: number }

/**
 * The player's region from the phone's time zone (the user 2026-10-19: the region only, no IP lookup — nothing is
 * sent anywhere to find it): a country or area, never a city.
 */
export function myRegion(): string {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch { /* unknown */ }
  const exact: Record<string, string> = {
    'Asia/Tokyo': '日本', 'Asia/Taipei': '台灣', 'Asia/Shanghai': '中國大陸', 'Asia/Chongqing': '中國大陸', 'Asia/Harbin': '中國大陸',
    'Asia/Urumqi': '中國大陸', 'Asia/Hong_Kong': '香港', 'Asia/Macau': '澳門', 'Asia/Seoul': '韓國', 'Asia/Singapore': '新加坡',
    'Asia/Kuala_Lumpur': '馬來西亞', 'Asia/Bangkok': '泰國', 'Asia/Manila': '菲律賓', 'Asia/Ho_Chi_Minh': '越南', 'Asia/Jakarta': '印尼',
  };
  if (exact[tz]) return exact[tz];
  const area = tz.split('/')[0];
  return ({ Asia: '亞洲', Europe: '歐洲', America: '美洲', Australia: '澳洲', Pacific: '大洋洲', Africa: '非洲' } as Record<string, string>)[area] ?? '';
}
/** What the host sends when the game starts. */
export interface StartMsg { settings: import('../core/types').GameSettings; seats: Record<string, number> }

type Msg =
  | { t: 'hi'; name: string; character: number; have?: number; region?: string; prev?: string }
  | { t: 'char'; character: number }
  | { t: 'lobby'; members: Member[]; map: string; shared: boolean }
  | { t: 'start'; start: StartMsg }
  | { t: 'ans'; seq: number; v: unknown; u?: boolean }
  | { t: 'log'; from: number; answers: [unknown, boolean][]; total: number }
  | { t: 'digest'; seq: number; h: number }
  | { t: 'chat'; line: ChatLine }
  | { t: 'vote'; target: string; voter: string }
  | { t: 'votes'; target: string; voters: string[] }
  | { t: 'kicked'; id: string; seat?: number }
  | { t: 'bye'; why?: string };

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

/** One room: the host's side or a guest's (and a guest that becomes the host). */
export class Room {
  code = '';
  host = false;
  /** The players; [0] is the host. */
  members: Member[] = [];
  map = '';
  shared = false;
  started: StartMsg | null = null;
  /** The player seats this phone plays. */
  mine = new Set<number>();
  onLobby: () => void = () => {};
  onStart: (s: StartMsg) => void = () => {};
  onStatus: (text: string) => void = () => {};
  /** Chat (the user 2026-10-19: text only; a sender can be muted on this phone). */
  chat: ChatLine[] = [];
  onChat: (line: ChatLine) => void = () => {};
  muted = new Set<string>();
  /** Kick votes: target → voters; two others agreeing send anyone (the host too) away. */
  votes = new Map<string, Set<string>>();
  onVotes: () => void = () => {};
  /** Seats of players sent away: the host answers them for the computer (托管 at their next turn). */
  kickedSeats = new Set<number>();
  /** This phone was sent away (the game screen goes back to the title). */
  kicked = false;
  private kickedIds = new Set<string>();

  private peer: Peer | null = null;
  private guests = new Map<string, DataConnection>();
  private toHost: DataConnection | null = null;
  private lostHost = '';
  private rejoining = false;
  private log: [unknown, boolean][] = [];
  private waiters = new Map<number, (v: unknown) => void>();
  private digests = new Map<number, number>();
  private closed = false;
  myId = '';

  constructor(readonly me: { name: string; character: number; region?: string }) {}

  /** Host: a new room; resolves with its code. */
  async create(map: string, shared: boolean): Promise<string> {
    this.map = map; this.shared = shared;
    let peer: Peer | null = null;
    for (let k = 0; k < 6 && !peer; k++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      peer = await open(roomId(code));
      if (peer) this.code = code;
    }
    if (!peer) throw new Error('無法建立房間（網路連不上）');
    this.members = [{ id: peer.id, ...this.me }];
    this.becomeHost(peer);
    return this.code;
  }

  /** Host: whether the phone playing `seat` is connected now (this phone's own seats always are). */
  ownerConnected(seat: number): boolean {
    const id = this.started ? Object.keys(this.started.seats).find(k => this.started!.seats[k] === seat) : undefined;
    return !id || id === this.myId || !!this.guests.get(id)?.open;
  }
  /** This phone reaches the room (the host, or a guest with its host connection up). */
  connected(): boolean { return this.host || !!this.toHost?.open; }
  private connWaiters: (() => void)[] = [];
  untilConnected(): Promise<void> { return this.connected() ? Promise.resolve() : new Promise(r => this.connWaiters.push(r)); }
  private hostWaiters: (() => void)[] = [];
  /** Resolves when this phone becomes the host (a hand-over): it then answers the seats sent away. */
  untilHost(): Promise<void> { return this.host ? Promise.resolve() : new Promise(r => this.hostWaiters.push(r)); }

  /** The room's id is this phone's: it hosts. */
  private becomeHost(peer: Peer) {
    const prev = this.myId;
    this.peer?.destroy();
    this.peer = peer;
    this.host = true;
    this.toHost = null;
    this.myId = peer.id;
    if (prev && prev !== peer.id) this.rename(prev, peer.id);
    const me = this.members.find(x => x.id === this.myId);
    if (me) this.members = [me, ...this.members.filter(x => x !== me)];
    peer.on('connection', c => this.guest(c));
    peer.on('disconnected', () => { if (!this.closed && this.host) peer.reconnect(); });
    // Back from the background with the room's id taken by a new host: join it as a guest.
    peer.on('error', e => { if (!this.closed && this.host && (e as { type?: string }).type === 'unavailable-id') void this.demote(); });
    for (const w of this.hostWaiters.splice(0)) w();
    for (const w of this.connWaiters.splice(0)) w();
  }

  /** A player's peer id changed (a phone that became the host, or came back with a new connection). */
  private rename(prev: string, id: string) {
    for (const m of this.members) if (m.id === prev) m.id = id;
    if (this.started && prev in this.started.seats) { this.started.seats[id] = this.started.seats[prev]; delete this.started.seats[prev]; }
  }

  /** Guest: joins the room with that code. */
  async join(code: string): Promise<void> {
    this.code = code;
    const peer = await open();
    if (!peer) throw new Error('網路連不上');
    this.asGuest(peer);
    if (!(await this.reach())) throw new Error('找不到這個房間');
  }

  private asGuest(peer: Peer) {
    this.peer = peer;
    this.host = false;
    this.myId = peer.id;
    peer.on('disconnected', () => { if (!this.closed && !this.host) peer.reconnect(); });
  }

  /** A host whose room id another phone has taken over: a guest of the new host. */
  private async demote() {
    const prev = this.myId;
    for (const c of this.guests.values()) c.close();
    this.guests.clear();
    this.peer?.destroy();
    this.peer = null;
    const peer = await open();
    if (!peer || this.closed) return;
    this.asGuest(peer);
    await this.reach(prev);
    if (!this.toHost) void this.rejoin();
  }

  private async reach(prev?: string): Promise<boolean> {
    const c = this.peer && await connect(this.peer, roomId(this.code));
    if (!c) return false;
    this.toHost = c;
    c.on('data', d => this.fromHost(d as Msg));
    c.on('close', () => { if (this.toHost === c) { this.toHost = null; if (!this.closed && !this.host) void this.rejoin(); } });
    c.send({ t: 'hi', name: this.me.name, character: this.me.character, region: this.me.region, have: this.started ? this.log.length : undefined, prev } satisfies Msg);
    for (const w of this.connWaiters.splice(0)) w();
    return true;
  }

  /**
   * The host is gone (the phone slept, the network dropped, it was voted out): try it again; the next player in the
   * list (after the lost host) takes the room's id over when it is free, and the others reconnect to it.
   */
  private async rejoin() {
    if (this.rejoining) return;
    this.rejoining = true;
    const lost = this.lostHost || this.members[0]?.id || '';
    this.onStatus('與房主的連線中斷，重新連線中…');
    for (let k = 0; !this.closed && !this.toHost && !this.host; k++) {
      await wait(Math.min(2000 + k * 1000, 6000));
      if (this.closed || this.host) break;
      if (await this.reach()) break;
      const next = this.members.find(x => x.id !== lost);
      if (next?.id === this.myId && k >= 1) {
        const p = await open(roomId(this.code));
        if (p) { this.becomeHost(p); this.onStatus(''); this.heard({ from: '', name: '系統', character: -1, text: '你成為新的房主', at: Date.now() }); break; }
      }
    }
    this.lostHost = '';
    this.rejoining = false;
    if (this.toHost) this.onStatus('');
  }

  private guest(c: DataConnection) {
    c.on('data', d => {
      const m = d as Msg;
      if (this.kickedIds.has(c.peer)) { c.send({ t: 'bye', why: '你已被投票請出房間' } satisfies Msg); return; }
      if (m.t === 'hi') {
        if (m.prev && this.kickedIds.has(m.prev)) { c.send({ t: 'bye', why: '你已被投票請出房間' } satisfies Msg); return; }
        if (m.prev) this.rename(m.prev, c.peer);
        this.guests.set(c.peer, c);
        if (this.started) {
          // Back after a drop, or to a new host: what it missed; it sends back what this phone lacks.
          const from = Math.min(m.have ?? 0, this.log.length);
          c.send({ t: 'log', from, answers: this.log.slice(from), total: this.log.length } satisfies Msg);
          if (!this.members.some(x => x.id === c.peer)) this.members.push({ id: c.peer, name: m.name, character: m.character, region: m.region });
          this.lobbyChanged();
          this.onStatus('');
          return;
        }
        if (!this.members.some(x => x.id === c.peer)) {
          if (this.members.length >= 4) { c.send({ t: 'bye' } satisfies Msg); return; }
          this.members.push({ id: c.peer, name: m.name, character: this.freeCharacter(m.character, c.peer), region: m.region });
        }
        this.lobbyChanged();
      } else if (m.t === 'char') {
        const x = this.members.find(y => y.id === c.peer);
        if (x) { x.character = this.freeCharacter(m.character, c.peer); this.lobbyChanged(); }
      } else if (m.t === 'ans') {
        this.record(m.seq, m.u ? undefined : m.v, true);
      } else if (m.t === 'chat') {
        this.heard({ ...m.line, from: c.peer });
      } else if (m.t === 'vote') {
        this.voted(m.target, c.peer);
      }
    });
    c.on('close', () => {
      if (this.guests.get(c.peer) !== c) return;
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
    if (m.t === 'lobby') { this.members = m.members; this.map = m.map; this.shared = m.shared; this.onLobby(); this.onVotes(); }
    else if (m.t === 'start') { this.begin(m.start); }
    else if (m.t === 'ans') this.record(m.seq, m.u ? undefined : m.v, false);
    else if (m.t === 'log') {
      m.answers.forEach(([v, u], k) => this.record(m.from + k, u ? undefined : v, false));
      // This phone has answers the (new) host lacks: send them on.
      for (let seq = m.total; seq < this.log.length; seq++) { const e = this.log[seq]; if (e) this.toHost?.send({ t: 'ans', seq, v: e[0] ?? null, u: e[1] } satisfies Msg); }
    }
    else if (m.t === 'digest') this.digests.set(m.seq, m.h);
    else if (m.t === 'chat') this.heard(m.line);
    else if (m.t === 'votes') { this.votes.set(m.target, new Set(m.voters)); this.onVotes(); }
    else if (m.t === 'kicked') this.away(m.id, m.seat);
    else if (m.t === 'bye') { this.kicked = /請出/.test(m.why ?? ''); this.onStatus(m.why ?? '房間已滿'); this.close(); }
  }

  /** Someone was voted out (told by the host): this phone leaves, or forgets them (the host's leaving starts the hand-over). */
  private away(id: string, seat?: number) {
    this.votes.delete(id);
    if (id === this.myId) { this.kicked = true; this.onStatus('你已被投票請出房間'); this.close(); return; }
    if (seat !== undefined) this.kickedSeats.add(seat);
    if (id === this.members[0]?.id) this.lostHost = id;
    this.members = this.members.filter(x => x.id !== id);
    this.onVotes(); this.onLobby();
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
  /** This phone answered question `seq` (one of its seats, or a seat sent away when it hosts). */
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

  // ---------------------------------------------------------------- chat, mute, kick votes

  /** Sends a line (at most 40 characters). */
  say(text: string) {
    const t = text.trim().slice(0, 40);
    if (!t) return;
    const mine = this.members.find(x => x.id === this.myId);
    const line: ChatLine = { from: this.myId, name: mine?.name ?? this.me.name, character: mine?.character ?? this.me.character, text: t, at: Date.now() };
    if (this.host) this.heard(line);
    else { this.toHost?.send({ t: 'chat', line } satisfies Msg); this.heard(line, false); }
  }
  /** A line arrived (the host passes it on). */
  private heard(line: ChatLine, relay = true) {
    if (this.chat.some(l => l.from === line.from && l.at === line.at && l.text === line.text)) return;
    this.chat.push(line);
    if (this.chat.length > 100) this.chat.shift();
    if (this.host && relay && line.from) { const m: Msg = { t: 'chat', line }; for (const [id, c] of this.guests) if (id !== line.from && c.open) c.send(m); }
    if (!this.muted.has(line.from)) this.onChat(line);
  }
  toggleMute(id: string) { if (this.muted.has(id)) this.muted.delete(id); else this.muted.add(id); }

  /** This phone votes to send `target` away (anyone else, the host too). */
  vote(target: string) {
    if (target === this.myId) return;
    if (this.host) this.voted(target, this.myId);
    else this.toHost?.send({ t: 'vote', target, voter: this.myId } satisfies Msg);
  }
  /** Host: counts a vote (even against itself); two others agreeing send the player away. */
  private voted(target: string, voter: string) {
    if (!this.host || voter === target || !this.members.some(x => x.id === target)) return;
    const v = this.votes.get(target) ?? new Set<string>();
    v.add(voter);
    this.votes.set(target, v);
    const m: Msg = { t: 'votes', target, voters: [...v] };
    for (const c of this.guests.values()) c.open && c.send(m);
    this.onVotes();
    if (v.size >= 2) this.kick(target);
  }
  private kick(id: string) {
    const seat = this.started ? this.started.seats[id] : undefined, name = this.nameOf(id);
    this.kickedIds.add(id);
    const note = `${name}被投票請出房間${seat !== undefined ? '，由電腦接手' : ''}`;
    if (id === this.myId) {
      // The host itself: everyone is told, then this phone leaves; the next player takes the room over.
      this.heard({ from: '', name: '系統', character: -1, text: note, at: Date.now() });
      const m: Msg = { t: 'kicked', id, seat };
      for (const c of this.guests.values()) c.open && c.send(m);
      this.kicked = true;
      setTimeout(() => { this.onStatus('你已被投票請出房間'); this.close(); }, 600);
      return;
    }
    this.votes.delete(id);
    if (seat !== undefined) this.kickedSeats.add(seat);
    const m: Msg = { t: 'kicked', id, seat };
    for (const c of this.guests.values()) c.open && c.send(m);
    const c = this.guests.get(id);
    setTimeout(() => c?.close(), 500);
    this.guests.delete(id);
    this.members = this.members.filter(x => x.id !== id);
    this.heard({ from: '', name: '系統', character: -1, text: note, at: Date.now() });
    this.onVotes();
    this.lobbyChanged();
  }
  nameOf(id: string) { return this.members.find(x => x.id === id)?.name ?? '玩家'; }

  close() {
    this.closed = true;
    for (const c of this.guests.values()) c.close();
    this.toHost?.close();
    this.peer?.destroy();
  }
}
