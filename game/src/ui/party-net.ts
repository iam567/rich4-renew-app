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
import type { GameSettings, StockOrder } from '../core/types';
import { LEVERAGE } from '../core/modules/stocks';
import { LOCAL_DOING } from './party-doing';
import { cleanCc } from './region-flag';
import { deviceId } from './party-presence';
import { FINALE_MAP } from '../core/casino-rules';
import { RT_LENGTHS, rtMapOk } from '../core/realtime';
import { directLine, freshId, netConfig, openNet, refusalWhy, type NetConn, type NetPeer } from './net-peer';
import { claimRoomCode } from './private-server';
import { gameEnd, postChat, reportCtx, reportParty } from './party-report';
import { CHARACTERS } from '../core/characters';
import { hostMismatch, levelNote, partyVersion, refuseGuest, refuseLate, roomLevel, statsByVersion, verKey, verOf } from './party-version';

/** This app's version in 派對模式 (party-version.ts; null only when a dev test plays an old phone). */
export const PARTY_VERSION = partyVersion();

// v2 (2026-10-22): with the heartbeat (issue #4); phones of v1 have their own rooms and list.
const PREFIX = 'rich4-party-v2-';
// v2 (2026-10-20): the list also counts private rooms and seekers; older versions keep their own list (v1).
export const LOBBY = `${PREFIX}lobby-v2`;
const roomId = (code: string) => `${PREFIX}room-${code}`;
/** Where this device keeps its seat in the last party game (issue #50). */
const SEAT_KEY = 'rich4.party.seat';
/** The 私服 (its address) of the room `code` this device had a seat in within the last 12 hours, or '' (issue #50 on a 私服). */
export function rememberedServer(code: string): string {
  try {
    const x = JSON.parse(localStorage.getItem(SEAT_KEY) ?? 'null') as { code: string; at: number; srv?: string } | null;
    return x && x.code === code && Date.now() - x.at < 12 * 3600_000 && typeof x.srv === 'string' ? x.srv : '';
  } catch { return ''; }
}

/** `nick`: the name the player gave themself (the user 2026-10-19); `name` is it or the character's. */
export interface Member { id: string; name: string; character: number; region?: string; /** Its country by the address (region-flag.ts). */ cc?: string; nick?: string; /** In the game: its phone is gone (the host tells everyone). */ away?: boolean; /** 聯絡方式 the player chose to show the room (the user 2026-11-08). */ contact?: Contact; /** Its app's version (1.2.0 on: versions of a family play together, core/compat.ts). */ ver?: string }

/** 聯絡方式 (the user 2026-11-08): so players who liked a game together can meet again without asking. */
export interface Contact { k: string; v: string }
export const CONTACT_KINDS: readonly [string, string][] = [['wechat', '微信'], ['line', 'LINE'], ['ig', 'IG'], ['tg', 'Telegram']];
export const CONTACT_MAX = 40;
/** A contact as kept and shown: a known kind, no markup characters, trimmed, at most CONTACT_MAX characters; else none. */
export function cleanContact(x: unknown): Contact | undefined {
  const o = (x ?? {}) as { k?: unknown; v?: unknown };
  if (!CONTACT_KINDS.some(([k]) => k === o.k)) return undefined;
  const v = [...String(o.v ?? '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim()].slice(0, CONTACT_MAX).join('');
  return v ? { k: o.k as string, v } : undefined;
}
export const contactLabel = (c: Contact) => `${CONTACT_KINDS.find(([k]) => k === c.k)?.[1] ?? ''}：${c.v}`;

/** A nickname as kept and shown: no markup characters, trimmed, at most NICK_MAX characters. */
export const NICK_MAX = 7;
export const cleanNick = (s: unknown) => [...String(s ?? '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim()].slice(0, NICK_MAX).join('');
/** The member's shown name: the nickname, else the character's. */
const named = (m: Member) => { m.contact = cleanContact(m.contact); if (!m.contact) delete m.contact; m.nick = cleanNick(m.nick) || undefined; m.name = m.nick || CHARACTERS[m.character]?.name || '玩家'; return m; };
/** Players in a room (the user 2026-10-19: eight; the game's NPCs come after them, core/game.ts npcBase). */
export const ROOM_MAX = 8;

/** A room in the list. `private`: a 私享 room counted only (its code is a random token, never shown or joinable). */
export interface RoomInfo {
  code: string; host: string; character: number; map: string; players: number; max: number; at: number; region?: string; cc?: string; private?: boolean;
  /** The host's app version (v0.7.4 on; none: older). */ ver?: string;
  /** 等待時間 in seconds and 電腦難度 (AI_LEVELS index), shown in the list (the user 2026-11-03: a quick room's players should know before they join; none: an older host). */
  turn?: number; ai?: number;
  /** 挑戰模式 on (PARTY_CHALLENGE index; none: off or an older host), a tag in the list (the user 2026-11-03: some won't play it). */
  ch?: number;
  /** 途中加入: the room allows it; `playing`: its game is going on, `free` computers' seats still to take. */
  drop?: boolean; playing?: boolean; free?: number;
  /** 圍觀: how many watch the game (a room listed while playing can be watched). */
  watch?: number;
  /** 圍觀 turned off by the players: no 圍觀 button in the list. */
  nowatch?: boolean;
  /** 即時制 (測試版): a tag in the list. */
  rt?: boolean;
}
/** The title button's figures (the user 2026-10-20): 私享 rooms open now, and people waiting for partners (the players
 * in shared rooms not started, plus those looking at 「尋找夥伴」). */
export interface LobbyStats { privateRooms: number; waiting: number }
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
    'Asia/Saigon': '越南', 'America/New_York': '美國', 'America/Detroit': '美國', 'America/Chicago': '美國', 'America/Denver': '美國', 'America/Phoenix': '美國',
    'America/Los_Angeles': '美國', 'America/Anchorage': '美國', 'Pacific/Honolulu': '美國', 'America/Toronto': '加拿大', 'America/Vancouver': '加拿大',
    'America/Edmonton': '加拿大', 'America/Winnipeg': '加拿大', 'America/Halifax': '加拿大', 'Europe/London': '英國', 'Europe/Berlin': '德國', 'Europe/Paris': '法國',
    'Europe/Amsterdam': '荷蘭', 'Pacific/Auckland': '紐西蘭',
  };
  if (exact[tz]) return exact[tz];
  const area = tz.split('/')[0];
  return ({ Asia: '亞洲', Europe: '歐洲', America: '美洲', Australia: '澳洲', Pacific: '大洋洲', Africa: '非洲' } as Record<string, string>)[area] ?? '';
}
/**
 * The room's rules (issue #31): the host picks them in the room, every phone keeps them (a new host after a hand-over
 * goes on with them) and a joining phone gets them with the room; the game starts with them (StartMsg.settings).
 * Indexes into core/types.ts FUNDS, LAND_LIMIT_MONTHS, DAY_LIMITS, VICTORY_MULTIPLES (labels: rule-options.ts).
 */
export interface PartyRules {
  fundIndex: number; traffic: 0 | 1 | 2; landLimitIndex: number; daysLimitIndex: number; victoryIndex: number;
  /**
   * 挑戰模式 (docs/rules/30, the user 2026-11-03: online too): 0 off, 1 a task card a month, 2 two a month, 3 the next
   * when one is done (settings.monthTasks); none on 大富翁城. (Before: the old star mode's deadline, never started online.)
   */
  challenge: number;
  /** 延遲上限 (the user 2026-11-03): PING_LIMITS[i] ms; a phone slower than that can't join (0: no limit). */
  maxPing: number;
  /** 等待時間 (the user 2026-11-03): TURN_SECONDS[i] seconds for each of a player's decisions. */
  turnSec: number;
  /** 電腦難度 of the computers filling the seats (the user 2026-11-03): 0 簡單, 1 中等, 2 困難 (as before), 3 地獄. */
  aiLevel: number;
  /**
   * 途中加入 (the user 2026-11-03): 1 — the game may start with one player and the computers; whoever joins later
   * takes a computer's seat over at its next turn (settings.dropIn, the 'seat' question); 0 off.
   */
  dropIn: number;
  /** 玩法 (docs/rules/31, the user 2026-11-07): 0 回合制, 1 即時制（測試版）; its length RT_LENGTHS[rtLen]. */
  realtime: number;
  rtLen: number;
  /**
   * 追加玩法 (the user 2026-11-08: what the original never had, each the host's to turn on or off, new ones added here
   * later): a bit for each of EXTRAS, on when set; all on by default.
   */
  extras: number;
  /**
   * 遊戲節奏 (docs/rules/36, the user 2026-11-23): 0 慢節奏, 2 快節奏 (settings.pace); none 原版 (so the rules of every
   * room before it, and their tests, are as they were). A room with an older phone plays 原版 (compat 'pace').
   */
  pace?: number;
}
/** 追加玩法's switches: the bit, the name on the room screen, and the game setting that turns it off. */
export const EXTRAS = [
  { bit: 1, name: '股票槓桿', off: 'noLeverage', desc: '股市可以開 2、3、5 倍槓桿，做多或做空，虧光保證金就爆倉' },
  { bit: 2, name: '乞丐復活', off: 'noBeggar', turnBased: true, desc: '真人玩家破產後當乞丐繼續走，碰到人就要錢，要到 5 萬元東山再起（只在回合制）' },
  { bit: 4, name: '破產清算', off: 'noLiquidate', desc: '真人玩家錢不夠付時，可以先把股票和地產全部賣掉換錢（地產半價賣給銀行），賣完還不夠才破產' },
  { bit: 8, name: '小遊戲搗亂', off: 'noHeckle', turnBased: true, desc: '有人玩小遊戲時，其他玩家和觀眾都能看到他的畫面，還能點畫面搗亂（扔番茄、放假記號、丟炸彈），每人 2 秒一次（只在回合制）' },
] as const;
const ALL_EXTRAS = EXTRAS.reduce((a, x) => a | x.bit, 0);
export const AI_LEVELS = ['簡單', '中等', '困難', '地獄'];
/** 等待時間's choices: quick players 10 s, patient ones up to 60 s (the clock as it always was). */
export const TURN_SECONDS = [10, 20, 30, 40, 50, 60];
/** 延遲上限's choices in ms (0: 不限). */
export const PING_LIMITS = [0, 150, 250, 400];
/** 挑戰模式's choices (as the new game's). */
export const PARTY_CHALLENGE = ['關', '每月1張', '每月2張', '完成就抽'];
/** As every 派對模式 game started before the rules could be picked: 20萬, 步行, no limits. */
export const DEFAULT_RULES: Readonly<PartyRules> = { fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, challenge: 0, maxPing: 0, turnSec: 5, aiLevel: 2, dropIn: 0, realtime: 0, rtLen: 0, extras: ALL_EXTRAS };
/** Rules as kept: each a whole number in its range, else the default. */
export function cleanRules(r: unknown): PartyRules {
  const o = (r ?? {}) as Record<string, unknown>;
  const at = (k: Exclude<keyof PartyRules, 'pace'>, n: number) => { const v = o[k]; return Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? v as number : DEFAULT_RULES[k]; };
  return { fundIndex: at('fundIndex', 6), traffic: at('traffic', 3) as 0 | 1 | 2, landLimitIndex: at('landLimitIndex', 6), daysLimitIndex: at('daysLimitIndex', 6), victoryIndex: at('victoryIndex', 6), challenge: at('challenge', PARTY_CHALLENGE.length), maxPing: at('maxPing', PING_LIMITS.length), turnSec: at('turnSec', TURN_SECONDS.length), aiLevel: at('aiLevel', AI_LEVELS.length), dropIn: at('dropIn', 2), realtime: at('realtime', 2), rtLen: at('rtLen', RT_LENGTHS.length), extras: at('extras', ALL_EXTRAS + 1), ...(o.pace === 0 || o.pace === 2 ? { pace: o.pace } : {}) };
}
/** Host: the room's next game on `map` (換地圖): the same seats and rules, a new seed; `players` as they are now. */
export function nextGameMsg(r: Room, players: GameSettings['players'], map: number, seed: number): StartMsg | null {
  const st = r.started;
  if (!st) return null;
  const { monthTasks, ...settings } = st.settings;
  void monthTasks;
  return { settings: { ...settings, mapId: map, players, seed, ...(r.rules.challenge && map !== FINALE_MAP ? { monthTasks: r.rules.challenge as 1 | 2 | 3 } : {}) }, seats: st.seats };
}
/** What the host sends when the game starts. */
export interface StartMsg { settings: import('../core/types').GameSettings; seats: Record<string, number> }
/**
 * Host: the game every phone plays — the room's players (seat = place in the list), computers up to `fill` players
 * (4 or 8; 0: none), the room's map and rules.
 */
/** The game's level (core/compat.ts): the oldest version among its phones. */
const level = (r: Room) => { const l = roomLevel(r.members.map(m => m.ver)); return l ? { level: l } : {}; };

export function startMsg(r: Room, fill: number, startDate: number, seed: number): StartMsg {
  const used = new Set(r.members.map(m => m.character));
  const cpus = fill ? [0, 4, 3, 1, 2, 5, 6, 7, 8, 10, 11, 9].filter(c => !used.has(c)).slice(0, Math.max(0, fill - r.members.length)) : [];
  const players = [...r.members.map(m => ({ character: m.character, human: true, ...(m.nick ? { nick: m.nick } : {}) })), ...cpus.map(c => ({ character: c, human: false }))];
  // 挑戰模式 is the task cards and 獎勵卡 (docs/rules/30; never 大富翁城); the limits are the room's, not the game's.
  const { challenge, maxPing, turnSec, aiLevel, dropIn, realtime, rtLen, extras, pace, ...rules } = r.rules;
  const off = Object.fromEntries(EXTRAS.filter(x => !(extras & x.bit)).map(x => [x.off, true]));
  void maxPing; void turnSec;
  // 即時制 (docs/rules/31): standard maps only; no 挑戰模式, no 途中加入, no day or money target
  const rt = realtime && rtMapOk(Number(r.map));
  const tasks = challenge && !rt && Number(r.map) !== FINALE_MAP ? { monthTasks: challenge as 1 | 2 | 3 } : {};
  return { settings: { mapId: Number(r.map), players, ...rules, ...(rt ? { daysLimitIndex: 0, victoryIndex: 0, realtime: { length: RT_LENGTHS[rtLen] * 60_000 } } : {}),
    aiLevel: aiLevel as 0 | 1 | 2 | 3, ...(pace === 0 || pace === 2 ? { pace: pace as 0 | 2 } : {}), ...tasks, ...(dropIn && !rt ? { dropIn: true } : {}), ...off, ...level(r), startDate, seed, party: true }, seats: Object.fromEntries(r.members.map((m, i) => [m.id, i])) };
}

type Msg =
  | { t: 'hi'; name: string; character: number; have?: number; gen?: number; region?: string; cc?: string; prev?: string; nick?: string; contact?: Contact; /** v0.7.4 on (party-version.ts). */ ver?: string; /** 圍觀: a spectator, and its install's id (one sent away stays away with a new connection). */ watch?: boolean; dev?: string }
  | { t: 'char'; character: number; nick?: string; contact?: Contact }
  | { t: 'lobby'; members: Member[]; map: string; shared: boolean; /** The host's version (v0.7.4 on). */ ver?: string; /** The room's rules (issue #31; none: the defaults). */ rules?: PartyRules }
  | { t: 'start'; start: StartMsg }
  /** 途中加入: the game's seats changed (a player joined for a computer's seat). */
  | { t: 'seats'; seats: Record<string, number> }
  /** Back to a game after the app was closed (issue #50): the game, the newest turn's snapshot and its question number. */
  | { t: 'resume'; start: StartMsg; save?: string; seq: number; /** 圍觀: this phone only watches. */ watch?: boolean; gen?: number }
  /** A gift (撒花, 扔雞蛋 …) from a spectator or a waiting player, passed on by the host to everyone with the sender's name. */
  | { t: 'cheer'; kind: string; name?: string; from?: string; player?: boolean }
  /** 等待中下單: all the orders of this phone not yet filled (sent again each turn, for a new host). */
  | { t: 'orders'; list: StockOrder[]; g?: number }
  /** 圍觀: how many watch now (the host to everyone). */
  | { t: 'watchers'; n: number; /** Who watches, and the players' switches (圍觀, 接手) and those sent away (the user 2026-11-04). */ who?: { id: string; name: string; cc?: string; region?: string }[]; watch?: boolean; take?: boolean; out?: string[] }
  /** A player turns 圍觀 or 接手 on or off (to the host). */
  | { t: 'watchset'; watch?: boolean; take?: boolean }
  /** A player sends a spectator away (to the host). */
  | { t: 'unwatch'; id: string }
  /** What a player does on their own phone (a LOCAL_DOING key, '': nothing), to the host and on to everyone. */
  | { t: 'doing'; seat: number; key: string }
  /** 小遊戲搗亂: what the phone playing a 小遊戲 draws (mini-games.ts MiniFrame), to the host and on to everyone. */
  | { t: 'mframe'; seat: number; f: unknown }
  /** 小遊戲搗亂: someone watching taps the picture (to the host; on to everyone with the name). */
  | { t: 'heckle'; seat: number; x: number; y: number; name?: string }
  /** 接手: the seats a spectator may take now (the host to the spectators, every heartbeat). */
  | { t: 'vacant'; seats: { seat: number; name: string }[] }
  /** 接手: a spectator takes that seat (first come). */
  | { t: 'take'; seat: number }
  /** 保留席位 (暫離): a player keeps the seat for 10 minutes; spectators can't take it meanwhile (off: false). */
  | { t: 'reserve'; on: boolean }
  | { t: 'ans'; seq: number; v: unknown; u?: boolean; /** Which game of the room (換地圖): an answer of the one before is dropped. */ g?: number }
  /** 即時制 (docs/rules/31): a guest's input (an answer, a card opened …) for the host to put into its next tick. */
  | { t: 'rtin'; in: unknown; g?: number }
  /** 換地圖 passed: the room's next game (the host to everyone), the room stays connected. */
  | { t: 'restart'; start: StartMsg; gen: number }
  /** 換地圖: a player proposes it, a player answers (to the host); the vote as it stands (the host to everyone). */
  | { t: 'mapask'; map: number; keep: boolean }
  | { t: 'mapyes'; yes: boolean }
  | { t: 'mapvote'; vote: MapVote | null }
  | { t: 'log'; from: number; answers: [unknown, boolean][]; total: number }
  | { t: 'digest'; seq: number; h: number; g?: number }
  | { t: 'chat'; line: ChatLine }
  | { t: 'vote'; target: string; voter: string }
  | { t: 'votes'; target: string; voters: string[] }
  | { t: 'kicked'; id: string; seat?: number }
  | { t: 'bye'; why?: string; /** v0.7.4 on: the host's version, and `version` when that is why. */ ver?: string; reason?: 'version' | 'ping' }
  /** The heartbeat; `at` (v0.9.2 on) is answered with a pong: the round trip. */
  | { t: 'ping'; at?: number }
  | { t: 'pong'; at: number }
  /** The host's table of everyone's connection, every heartbeat. */
  | { t: 'net'; rows: NetRow[] };

/** 換地圖 (the user 2026-11-04): `keep` the money goes along, else everything starts again; `yes` who agreed, of `need` phones. */
export interface MapVote { map: number; keep: boolean; by: string; yes: string[]; need: number }

/** One player's connection (the 延遲 panel): round trip to the host in ms (null: not measured yet / gone), which way. */
export interface NetRow { id: string; rtt: number | null; via: 'vps' | 'p2p' | 'host'; away?: boolean }
/** The middle of the newest round trips. */
const median = (a: number[]) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Where the phones find a way to each other (2026-10-20): Google's STUN, and our own relay (TURN, coturn on the user's
 * Tokyo VPS game.flj.info = 154.205.139.82, /game/turn there) for networks that cannot connect directly (mobile data, company Wi-Fi). PeerJS's free
 * relay is gone. The relay only carries the game's answers and the chat; it is rate- and quota-limited on the server.
 * Issue #12 (2026-10-26): two free public STUN servers that answer from mainland China too (bilibili's, Xiaomi's;
 * both checked to answer a binding request), for networks or proxies that drop Google's. The network check
 * (party-check.ts) gathers with this same list.
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.chat.bilibili.com:3478', 'stun:stun.miwifi.com:3478'] },
  { urls: 'stun:game.flj.info:3478' },
  { urls: ['turn:game.flj.info:3478?transport=udp', 'turn:game.flj.info:3478?transport=tcp'], username: 'rich4', credential: '29e57ad82edb53b7f8dde103' },
];
const PEER_OPTS = { debug: 0, config: { iceServers: ICE_SERVERS } };

netConfig.peerOpts = PEER_OPTS;

/**
 * This phone on the network (net-peer.ts: the VPS relay when it answers, else PeerJS) under `id` or a fresh one;
 * null when the id is taken (another phone has it) or nothing answers.
 */
const open = (id?: string): Promise<NetPeer | null> => openNet(id ?? freshId(PREFIX), !!id);
/** A room's own connection: on 線路二 when this device chose it (the list stays as it is: everybody finds it). */
const openRoom = (id?: string): Promise<NetPeer | null> => openNet(id ?? freshId(PREFIX), !!id, undefined, directLine());
const connect = (peer: NetPeer, id: string): Promise<NetConn | null> => peer.dial(id);

/** The 「尋找夥伴」 list: held by whichever phone has the LOBBY id (see the header). */
export class Lobby {
  rooms = new Map<string, RoomInfo>();
  onRooms: (rooms: RoomInfo[]) => void = () => {};
  private peer: NetPeer | null = null;
  private holder: NetPeer | null = null;
  private conns = new Set<NetConn>();
  private toHolder: NetConn | null = null;
  private timer = 0;
  private closed = false;
  private mine: RoomInfo | null = null;
  /** This phone looks at 「尋找夥伴」 (counted as waiting for partners). */
  seeking = false;
  /** Seekers by connection (the holder's bookkeeping), last seen and their version (none: an old phone). */
  private seekers = new Map<NetConn, { at: number; ver?: string }>();
  stats: LobbyStats = { privateRooms: 0, waiting: 0 };
  onStats: (s: LobbyStats) => void = () => {};

  /**
   * `ver`: this phone's version (party-version.ts). The list is shared by every version (an old phone may hold it):
   * the rooms carry their version (party.ts shows another's 「版本不同」), and the title's figures count this
   * version's only — the holder sends them for each version (`byVer`); an old holder sends only the total.
   */
  constructor(readonly ver: string | null = PARTY_VERSION) {}

  /** Starts watching (and announcing `room` every 8 s while set). */
  async start(room?: RoomInfo, seeking = false): Promise<void> {
    this.mine = room ?? null;
    this.seeking = seeking;
    void this.loop();
  }
  announce(room: RoomInfo | null) { this.mine = room; this.push(); }

  private all(): RoomInfo[] {
    const now = Date.now();
    for (const [k, r] of this.rooms) if (now - r.at > 25000) this.rooms.delete(k);
    return [...this.rooms.values()].sort((a, b) => b.at - a.at);
  }
  /** The shared rooms (private ones are only counted). */
  private list(): RoomInfo[] { return this.all().filter(r => !r.private); }
  private count(): LobbyStats {
    const now = Date.now();
    for (const [c, s] of this.seekers) if (!c.open || now - s.at > 25000) this.seekers.delete(c);
    const rooms = this.all();
    return {
      privateRooms: rooms.filter(r => r.private).length,
      waiting: rooms.filter(r => !r.private).reduce((a, r) => a + r.players, 0) + this.seekers.size + (this.seeking ? 1 : 0),
    };
  }
  /** The figures for each version (count() first: it drops the stale seekers). */
  private countByVer(): Record<string, LobbyStats> {
    return statsByVersion(this.all(), [...[...this.seekers.values()].map(s => s.ver), ...(this.seeking ? [this.ver] : [])]);
  }
  /** This phone's figures from the holder's: its version's (an old holder: the total; an old test phone: the total). */
  private mineOf(stats: LobbyStats, byVer?: Record<string, LobbyStats>): LobbyStats {
    if (this.ver === null || !byVer) return stats;
    return byVer[verKey(this.ver)] ?? byVer[this.ver] ?? { privateRooms: 0, waiting: 0 };
  }
  private push() {
    if (this.holder) {
      if (this.mine) this.rooms.set(this.mine.code, { ...this.mine, ...(this.ver ? { ver: this.ver } : {}), at: Date.now() });
      const rooms = this.list(), stats = this.count(), byVer = this.ver === null ? undefined : this.countByVer();
      for (const c of this.conns) c.open && c.send(byVer ? { t: 'rooms', rooms, stats, byVer } : { t: 'rooms', rooms, stats });
      this.onRooms(rooms);
      const own = this.mineOf(stats, byVer);
      this.stats = own; this.onStats(own);
    } else if (this.toHolder?.open) {
      const ver = this.ver ?? undefined;
      this.toHolder.send(this.mine ? { t: 'room', room: { ...this.mine, ...(ver ? { ver } : {}), at: Date.now() } } : { t: 'list', seek: this.seeking, ...(ver ? { ver } : {}) });
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
          c.on('data', d => {
            const m = d as { t: string; rooms?: RoomInfo[]; stats?: LobbyStats; byVer?: Record<string, LobbyStats> };
            if (m.t === 'rooms' && m.rooms) { this.rooms = new Map(m.rooms.map(r => [r.code, r])); this.onRooms(this.list()); }
            if (m.t === 'rooms' && m.stats) { const own = this.mineOf(m.stats, m.byVer); this.stats = own; this.onStats(own); }
          });
          c.on('close', () => { this.toHolder = null; });
        } else {
          const h = await open(LOBBY);
          if (h) {
            this.holder = h;
            h.on('connection', c2 => {
              this.conns.add(c2);
              c2.on('data', d => {
                const m = d as { t: string; room?: RoomInfo; code?: string; seek?: boolean; ver?: string };
                if (m.t === 'room' && m.room) this.rooms.set(m.room.code, { ...m.room, at: Date.now() });
                if (m.t === 'room-off' && m.code) this.rooms.delete(m.code);
                if (m.t === 'list') { if (m.seek) this.seekers.set(c2, { at: Date.now(), ver: typeof m.ver === 'string' ? m.ver : undefined }); else this.seekers.delete(c2); }
                this.push();
              });
              c2.on('close', () => { this.conns.delete(c2); this.seekers.delete(c2); });
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
  /** The rules the host picked (issue #31), kept on every phone. */
  rules: PartyRules = { ...DEFAULT_RULES };
  started: StartMsg | null = null;
  /**
   * Issue #50 (a player whose app closed came back with the room code and was a stranger): every phone keeps the game
   * as it was when the newest turn began (a save, core/save.ts) and the number of the next question then; the host
   * gives a returning player that and the answers since, and that phone plays on from there.
   */
  private snap: { seq: number; save: string } | null = null;
  /** A returning phone's start: the snapshot to load and the question number it begins at (main.ts takes it). */
  resume: { save: string; seq: number } | null = null;
  /** The player seats this phone plays. */
  mine = new Set<number>();
  onLobby: () => void = () => {};
  onStart: (s: StartMsg) => void = () => {};
  /** 途中加入: the game's seats changed (the lobby list's free seats). */
  onSeats: () => void = () => {};
  /** 圍觀 (the user 2026-11-03): this phone only watches the game (no seat, no answers). */
  watching = false;
  /** Host: the spectators' connections; everyone: how many watch now. */
  private watchers = new Set<string>();
  watchCount = 0;
  onWatchers: () => void = () => {};
  /** The players' switches (the user 2026-11-04), known to every phone so a new host keeps them. */
  allowWatch = true;
  allowTake = true;
  /** Who watches now (names for the 玩家 panel), and the spectators sent away: they do not come back this game. */
  watcherList: { id: string; name: string; cc?: string; region?: string }[] = [];
  private sentAway = new Set<string>();
  /** seat → the LOCAL_DOING key its player has open. */
  doings = new Map<number, string>();
  /** A cheer arrived (or this phone's own): kind, the sender's name, whether a player of the game sent it. */
  onCheer: (kind: string, name: string, player: boolean) => void = () => {};
  /** 小遊戲搗亂: a picture of a 小遊戲 being played (seat), and a 搗亂 sent at one. */
  onMiniFrame: (seat: number, f: unknown) => void = () => {};
  onHeckle: (seat: number, x: number, y: number, name: string) => void = () => {};
  /** 接手 (the user 2026-11-03): the seats spectators may take now (the host's list), and this phone's notice. */
  vacant: { seat: number; name: string }[] = [];
  onVacant: () => void = () => {};
  /** Host: since when each player's phone is gone, and until when a seat is kept (暫離, 10 minutes). */
  private awaySince = new Map<string, number>();
  private reservedUntil = new Map<string, number>();
  /** This phone keeps its seat (暫離) until then. */
  reservedTill = 0;
  /** Host: each spectator's name and character (for the members list when one takes a seat). */
  private watcherInfo = new Map<string, { name: string; character: number; nick?: string; region?: string; cc?: string }>();
  /** Host: when each spectator may cheer again (one every 5 s), and anyone in the room (one effect at a time). */
  private cheerAt = new Map<string, number>();
  private heckleAt = new Map<string, number>();
  private roomCheerAt = 0;
  onStatus: (text: string) => void = () => {};
  /** Chat (the user 2026-10-19: text only; a sender can be muted on this phone). */
  chat: ChatLine[] = [];
  onChat: (line: ChatLine) => void = () => {};
  muted = new Set<string>();
  /** Kick votes: target → voters; two others agreeing send anyone (the host too) away. */
  votes = new Map<string, Set<string>>();
  onVotes: () => void = () => {};
  /**
   * The seat with the most assets right now (several on a tie), set by the game screen: it cannot be voted out (the
   * user 2026-10-22: a few players agreeing to send the richest away would only start a fight).
   */
  richest: (seat: number) => boolean = () => false;
  /** Whether `id` cannot be voted out now (the game going on, and its player the richest). */
  protectedId(id: string): boolean {
    const seat = this.started?.seats[id];
    return seat !== undefined && this.richest(seat);
  }
  /**
   * 途中加入: whether the seat `seat` is a computer's still in the game (set by the game screen: not bankrupt, not a
   * human's); the seats a joining player may take.
   */
  seatOpen: (seat: number) => boolean = () => false;
  /** The room is closed (the game over, or left). */
  onClose: () => void = () => {};
  /** 途中加入: the computers' seats nobody has taken yet. */
  freeSeats(): number[] {
    if (!this.started || !this.rules.dropIn || !this.allowTake) return [];
    const taken = new Set(Object.values(this.started.seats));
    return this.started.settings.players.map((_, i) => i).filter(i => !taken.has(i) && this.seatOpen(i));
  }
  /**
   * The host's answer to a computer's 'seat' question (途中加入): the player who took that seat and is here, else 0.
   * Worked out from the seats alone, so a new host (a hand-over) answers the same.
   */
  seatAnswer(seat: number): { nick: string } | 0 {
    const id = this.started ? Object.keys(this.started.seats).find(k => this.started!.seats[k] === seat) : undefined;
    if (!id) return 0;
    const m = this.members.find(x => x.id === id);
    const here = id === this.myId || !!this.guests.get(id)?.open;
    return m && here && !m.away ? { nick: m.name } : 0;
  }
  /** Seats of players sent away: the host answers them for the computer (托管 at their next turn). */
  kickedSeats = new Set<number>();
  /** This phone was sent away (the game screen goes back to the title). */
  kicked = false;
  /** This phone and the room's host have different versions (party-version.ts): it left; the reason went to onStatus. */
  refused = false;
  /** join(): waiting for the host's first answer (its `lobby`, or a `bye`); called with '' or the reason to fail. */
  private replied: ((why: string) => void) | null = null;
  private kickedIds = new Set<string>();

  private peer: NetPeer | null = null;
  private guests = new Map<string, NetConn>();
  /**
   * The heartbeat (issue #4: a phone that quits without a word left everyone 「等待 … 操作」 for good — a closed app's
   * connection may never report closing): host and guests ping each other every PING_MS; a side silent for
   * SILENT_MS counts as gone at once (a guest: dropped, its seat played by the computer after the 10 s rule; the host:
   * the hand-over starts).
   */
  private static readonly PING_MS = 3000;
  private static readonly SILENT_MS = 10000;
  private lastSeen = new Map<string, number>();
  private hostSeen = 0;
  /** Round trips (ms, the newest few): the host's to each guest, a guest's to the host. */
  private rtts = new Map<string, number[]>();
  private hostRtts: number[] = [];
  /** Everyone's connection (the host's table; a guest's own row from its own measure). */
  net: NetRow[] = [];
  onNet: () => void = () => {};
  private beat = 0;
  private toHost: NetConn | null = null;
  private lostHost = '';
  private rejoining = false;
  private log: [unknown, boolean][] = [];
  private waiters = new Map<number, (v: unknown) => void>();
  private digests = new Map<number, number>();
  private closed = false;
  myId = '';

  /** `ver`: this phone's version, sent and checked in the handshake (party-version.ts); null only in a dev test of an old phone. */
  constructor(readonly me: { name: string; character: number; region?: string; cc?: string; nick?: string; contact?: Contact }, readonly ver: string | null = PARTY_VERSION) {}

  /** Host: a new room; resolves with its code. */
  async create(map: string, shared: boolean): Promise<string> {
    this.map = map; this.shared = shared;
    let peer: NetPeer | null = null;
    // 4 digits while they are easy to find free; when the room codes get crowded (the user 2026-11-04: what if there
    // are more than 10 000 rooms?), 5 and then 6 digits — 9 000 + 90 000 + 900 000 rooms open at once.
    // 私服 (private-server.ts): 6 digits, claimed with ours too, so the code alone finds the room from anywhere
    const srv = netConfig.server;
    for (let k = 0; k < 12 && !peer; k++) {
      const digits = srv ? 6 : k < 6 ? 4 : k < 9 ? 5 : 6, low = 10 ** (digits - 1);
      const code = String(low + Math.floor(Math.random() * 9 * low));
      peer = await openRoom(roomId(code));
      if (!peer && refusalWhy()) break; // a 私服 saying no (full, its password …): no use trying other codes
      if (peer && srv && !await claimRoomCode(code, srv.addr)) { peer.destroy(); peer = null; continue; }
      if (peer) this.code = code;
    }
    if (!peer) throw new Error(refusalWhy() || '無法建立房間（網路連不上）');
    this.members = [named({ id: peer.id, ...this.me, ...(this.ver ? { ver: this.ver } : {}) })];
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
  private becomeHost(peer: NetPeer) {
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
    this.ownerSays(peer);
    peer.on('disconnected', () => { if (!this.closed && this.host) peer.reconnect(); });
    // Back from the background with the room's id taken by a new host: join it as a guest.
    peer.on('error', e => { if (!this.closed && this.host && (e as { type?: string }).type === 'unavailable-id') void this.demote(); });
    for (const w of this.hostWaiters.splice(0)) w();
    for (const w of this.connWaiters.splice(0)) w();
    this.remember();
  }

  /** The lost host's old id → the key its seat was kept under (gone-…), for when that phone comes back. */
  private goneOf = new Map<string, string>();
  /** A player's peer id changed (a phone that became the host, or came back with a new connection). */
  private rename(prev: string, id: string) {
    // The id may still be the lost host's (a new host takes over the room's id): that member and seat are kept apart
    // first, as gone — they used to be overwritten, so the old host's seat counted as connected and nobody played it
    // (issue #4: everyone waited 「等待 … 操作」 after the host quit).
    if (id !== prev) {
      const gone = `gone-${id}-${Date.now()}`;
      if (this.started && id in this.started.seats) this.goneOf.set(id, gone);
      for (const m of this.members) if (m.id === id) { m.id = gone; m.away = true; }
      if (this.started && id in this.started.seats) { this.started.seats[gone] = this.started.seats[id]; delete this.started.seats[id]; }
    }
    for (const m of this.members) if (m.id === prev) m.id = id;
    if (this.started && prev in this.started.seats) { this.started.seats[id] = this.started.seats[prev]; delete this.started.seats[prev]; }
  }

  /** The game as a turn begins (main.ts at each turn): kept for a player who comes back (issue #50). */
  snapshot(seq: number, save: () => string) { if (this.started) this.snap = { seq, save: save() }; }

  /** This phone's seat in a started game, kept on the device so the room code brings it back (issue #50). */
  private remember() {
    if (!this.started) return;
    // (on a 私服 its address too: the code brings the player back there even when ours cannot be reached)
    try { localStorage.setItem(SEAT_KEY, JSON.stringify({ code: this.code, id: this.myId, at: Date.now(), ...(netConfig.server ? { srv: netConfig.server.addr } : {}) })); } catch { /* not kept */ }
  }
  /** The peer id this phone had in the room `code` (a game within the last 12 hours), if any. */
  private remembered(code: string): string | undefined {
    try {
      const x = JSON.parse(localStorage.getItem(SEAT_KEY) ?? 'null') as { code: string; id: string; at: number } | null;
      return x && x.code === code && Date.now() - x.at < 12 * 3600_000 ? x.id : undefined;
    } catch { return undefined; }
  }

  /** 圍觀: watches the game in the room with that code (it must have started). */
  async watch(code: string): Promise<void> { this.watching = true; return this.join(code); }

  /** Guest: joins the room with that code. */
  async join(code: string): Promise<void> {
    this.code = code;
    const peer = await openRoom();
    if (!peer) throw new Error(refusalWhy() || '網路連不上');
    this.asGuest(peer);
    if (!(await this.reach())) throw new Error('連不上這個房間\n（房間碼不對，或兩邊的網路無法直接連線：可以試試連同一個 Wi-Fi）');
    if (this.ver === null) return; // (a dev test of an old phone: it did not wait)
    // The host's first answer: its room (with its version: the same one, or the mismatch is shown), or why not.
    const why = await new Promise<string>(resolve => {
      this.replied = resolve;
      setTimeout(() => resolve('房間沒有回應，請再試一次'), 12000);
    });
    this.replied = null;
    if (why) { this.close(); throw new Error(why); }
  }

  private asGuest(peer: NetPeer) {
    this.peer = peer;
    this.host = false;
    this.myId = peer.id;
    this.remember();
    this.ownerSays(peer);
    peer.on('disconnected', () => { if (!this.closed && !this.host) peer.reconnect(); });
  }

  /** A 私服's owner sends this phone away (管理頁: 踢人, 封禁, 關閉房間): it leaves the room with the reason. */
  private ownerSays(peer: NetPeer) {
    peer.on('error', e => { if (!this.closed && this.peer === peer && (e.type === 'kicked' || e.type === 'banned' || e.type === 'password')) this.leaveRefused(refusalWhy() || e.why || '你被服主請出了這個私服'); });
  }

  /** A host whose room id another phone has taken over: a guest of the new host. */
  private async demote() {
    const prev = this.myId;
    for (const c of this.guests.values()) c.close();
    this.guests.clear();
    this.peer?.destroy();
    this.peer = null;
    const peer = await openRoom();
    if (!peer || this.closed) return;
    this.asGuest(peer);
    await this.reach(prev);
    if (!this.toHost) void this.rejoin();
  }

  private async reach(prev?: string): Promise<boolean> {
    const c = this.peer && await connect(this.peer, roomId(this.code));
    if (!c) return false;
    this.toHost = c;
    this.hostSeen = Date.now();
    this.startBeat();
    c.on('data', d => {
      this.hostSeen = Date.now();
      const m = d as Msg;
      if (m.t === 'ping') { if (m.at !== undefined) c.send({ t: 'pong', at: m.at } satisfies Msg); return; }
      if (m.t === 'pong') { this.hostRtts = [...this.hostRtts.slice(-4), Math.max(1, Date.now() - m.at)]; return; }
      this.fromHost(m);
    });
    c.on('close', () => { if (this.toHost === c) { this.toHost = null; if (!this.closed && !this.host) void this.rejoin(); } });
    // A phone with no game here yet that played in this room before says who it was (issue #50).
    prev ??= this.started ? undefined : this.remembered(this.code);
    c.send({ t: 'hi', name: this.me.name, character: this.me.character, region: this.me.region, cc: this.me.cc, nick: this.me.nick, contact: this.me.contact, have: this.started ? this.log.length : undefined, gen: this.gen, prev, ...(this.ver !== null ? { ver: this.ver } : {}), ...(this.watching ? { watch: true, dev: deviceId() } : {}) } satisfies Msg);
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
    const lostName = this.nameOf(lost); // (before a take-over renames the ids)
    this.onStatus('與房主的連線中斷，重新連線中…');
    if (this.started) void reportParty('drop', `與房主（${lostName}）的連線中斷`, { seq: this.log.length });
    for (let k = 0; !this.closed && !this.toHost && !this.host; k++) {
      await wait(Math.min(2000 + k * 1000, 6000));
      if (this.closed || this.host) break;
      if (await this.reach()) break;
      const next = this.members.find(x => x.id !== lost);
      if (next?.id === this.myId && k >= 1) {
        const p = await openRoom(roomId(this.code));
        if (p) { this.becomeHost(p); this.onStatus(''); this.heard({ from: '', name: '系統', character: -1, text: '你成為新的房主', at: Date.now() }); void reportParty('host', `${this.nameOf(this.myId)} 成為新的房主（原房主 ${lostName} 斷線）`, { seq: this.log.length }); break; }
      }
    }
    this.lostHost = '';
    this.rejoining = false;
    if (this.toHost) this.onStatus('');
  }

  private guest(c: NetConn) {
    this.lastSeen.set(c.peer, Date.now());
    this.startBeat();
    /** Another version's phone: told why, nothing more taken from it. */
    let refused = false;
    c.on('data', d => {
      const m = d as Msg;
      if (refused) return;
      this.lastSeen.set(c.peer, Date.now());
      if (m.t === 'ping') { if (m.at !== undefined) c.send({ t: 'pong', at: m.at } satisfies Msg); return; }
      if (m.t === 'pong') { this.rtts.set(c.peer, [...(this.rtts.get(c.peer) ?? []).slice(-4), Math.max(1, Date.now() - m.at)]); return; }
      if (this.kickedIds.has(c.peer)) { c.send({ t: 'bye', why: '你已被投票請出房間' } satisfies Msg); return; }
      if (m.t === 'hi' && this.ver !== null) {
        // The version check (party-version.ts): another version (or an old phone, which sends none) is refused.
        const no = refuseGuest(this.ver, m.ver, named({ id: '', name: m.name, character: m.character, nick: m.nick }).name);
        if (no) {
          refused = true;
          this.lastSeen.delete(c.peer);
          c.send({ t: 'bye', why: no.why, ver: this.ver, reason: 'version' } satisfies Msg);
          this.heard({ from: '', name: '系統', character: -1, text: no.line, at: Date.now() });
          setTimeout(() => { try { c.close(); } catch { /* already closed */ } }, 1500);
          return;
        }
        // A game going on at a newer level than this phone (core/compat.ts): it could not play it the same way.
        const lv = this.started?.settings.level ?? (this.started ? this.ver : undefined), t = verOf(m.ver);
        const late = lv && t ? refuseLate(lv, t) : null;
        if (late) {
          refused = true;
          this.lastSeen.delete(c.peer);
          c.send({ t: 'bye', why: late, ver: this.ver, reason: 'version' } satisfies Msg);
          setTimeout(() => { try { c.close(); } catch { /* already closed */ } }, 1500);
          return;
        }
      }
      if (m.t === 'hi' && (m.watch || (this.started && m.have === undefined && !(m.prev && m.prev in this.started.seats) && !(this.rules.dropIn && this.freeSeats().length)))) {
        // 圍觀: a spectator — asked for, or a phone with no seat coming into a game going on (a room code typed after
        // the start). It gets the game from the newest turn and every answer from then on; it never answers.
        if (!this.started) { c.send({ t: 'bye', why: '這局還沒開始，可以直接加入房間' } satisfies Msg); return; }
        if (this.sentAway.has(c.peer) || (m.prev && this.sentAway.has(m.prev)) || (m.dev && this.sentAway.has(m.dev))) { c.send({ t: 'bye', why: '玩家請你離開圍觀了' } satisfies Msg); return; }
        if (!this.allowWatch && m.have === undefined) { c.send({ t: 'bye', why: '這局的玩家沒有開放圍觀' } satisfies Msg); return; }
        this.guests.set(c.peer, c);
        this.catchUp(c, m);
        if (m.dev) this.watcherDevs.set(c.peer, m.dev);
        this.watcherNames.set(c.peer, named({ id: c.peer, name: m.name, character: m.character, nick: m.nick }).name);
        this.watcherInfo.set(c.peer, { name: m.name, character: m.character, nick: m.nick, region: m.region, cc: cleanCc(m.cc) });
        this.addWatcher(c.peer, m.have);
        if (m.have === undefined) {
          const snap = this.snap;
          c.send({ t: 'resume', start: this.started, gen: this.gen, save: snap?.save, seq: snap?.seq ?? 0, watch: true } satisfies Msg);
          const from = snap?.seq ?? 0;
          c.send({ t: 'log', from, answers: this.log.slice(from), total: this.log.length } satisfies Msg);
        } else {
          const from = Math.min(m.have, this.log.length);
          c.send({ t: 'log', from, answers: this.log.slice(from), total: this.log.length } satisfies Msg);
        }
        return;
      }
      if (m.t === 'hi') {
        if (m.prev && this.kickedIds.has(m.prev)) { c.send({ t: 'bye', why: '你已被投票請出房間' } satisfies Msg); return; }
        // (issue #100: the old host back after the room passed on asks with the room's id — this host's own now; its
        // seat is the gone one, not this host's, which it used to take over)
        if (m.prev) { const was = m.prev === this.myId ? this.goneOf.get(m.prev) : m.prev; if (was) { this.rename(was, c.peer); if (was !== m.prev) this.goneOf.delete(m.prev); } }
        this.guests.set(c.peer, c);
        this.catchUp(c, m);
        if (this.started && m.have === undefined && m.prev && c.peer in this.started.seats) {
          // Back after its app closed (issue #50): its seat again, the game from the newest turn's snapshot and the
          // answers since (the computer played its seat meanwhile, 托管: cancelled at its next turn as usual).
          const snap = this.snap;
          c.send({ t: 'resume', start: this.started, gen: this.gen, save: snap?.save, seq: snap?.seq ?? 0 } satisfies Msg);
          const from = snap?.seq ?? 0;
          c.send({ t: 'log', from, answers: this.log.slice(from), total: this.log.length } satisfies Msg);
          for (const x of this.members) if (x.id === c.peer) x.away = false; this.awaySince.delete(c.peer); this.reservedUntil.delete(c.peer);
          this.lobbyChanged();
          this.onStatus('');
          this.heard({ from: '', name: '系統', character: -1, text: `${this.nameOf(c.peer)} 回到遊戲`, at: Date.now() });
          return;
        }
        if (this.started && m.have === undefined && this.rules.dropIn) {
          // 途中加入 (the user 2026-11-03): a computer's seat for the newcomer — it takes it over at that computer's
          // next turn (the 'seat' question); meanwhile it watches the game from the newest turn on (as issue #50).
          const seat = this.freeSeats()[0];
          if (seat === undefined) { c.send({ t: 'bye', why: '這局已經沒有電腦的位置可以接手了' } satisfies Msg); return; }
          const who = named({ id: c.peer, name: m.name, character: m.character, region: m.region, cc: cleanCc(m.cc), nick: m.nick, contact: m.contact, ver: verOf(m.ver) ?? undefined });
          if (!this.members.some(x => x.id === c.peer)) this.members.push(who);
          this.started.seats[c.peer] = seat;
          const seats: Msg = { t: 'seats', seats: this.started.seats };
          for (const [id, g] of this.guests) if (id !== c.peer && g.open) g.send(seats);
          const snap = this.snap;
          c.send({ t: 'resume', start: this.started, gen: this.gen, save: snap?.save, seq: snap?.seq ?? 0 } satisfies Msg);
          const from = snap?.seq ?? 0;
          c.send({ t: 'log', from, answers: this.log.slice(from), total: this.log.length } satisfies Msg);
          this.lobbyChanged();
          this.onSeats();
          const line: ChatLine = { from: '', name: '系統', character: -1, text: `${who.name} 加入遊戲，將接手一位電腦`, at: Date.now() };
          this.heard(line);
          return;
        }
        if (this.started && m.have === undefined) {
          // A phone with no game and no seat here (another device, or its seat forgotten): it would wait for a start
          // that never comes.
          c.send({ t: 'bye', why: '這局遊戲已經開始了，無法加入\n（原本在這局的玩家，請用同一台裝置輸入房間碼回到遊戲）' } satisfies Msg);
          return;
        }
        if (this.started) {
          // Back after a drop, or to a new host: what it missed; it sends back what this phone lacks.
          const from = Math.min(m.have ?? 0, this.log.length);
          c.send({ t: 'log', from, answers: this.log.slice(from), total: this.log.length } satisfies Msg);
          if (!this.members.some(x => x.id === c.peer)) this.members.push(named({ id: c.peer, name: m.name, character: m.character, region: m.region, cc: cleanCc(m.cc), nick: m.nick, contact: m.contact, ver: verOf(m.ver) ?? undefined }));
          for (const x of this.members) if (x.id === c.peer) x.away = false; this.awaySince.delete(c.peer); this.reservedUntil.delete(c.peer);
          this.lobbyChanged();
          this.onStatus('');
          return;
        }
        if (!this.members.some(x => x.id === c.peer)) {
          if (this.members.length >= ROOM_MAX) { c.send({ t: 'bye' } satisfies Msg); return; }
          this.members.push(named({ id: c.peer, name: m.name, character: this.freeCharacter(m.character, c.peer), region: m.region, cc: cleanCc(m.cc), nick: m.nick, contact: m.contact, ver: verOf(m.ver) ?? undefined }));
        }
        this.lobbyChanged();
      } else if (m.t === 'char') {
        const x = this.members.find(y => y.id === c.peer);
        if (x && !this.started) { x.character = this.freeCharacter(m.character, c.peer); x.nick = m.nick; }
        // the contact may change during the game too
        if (x) { x.contact = m.contact; named(x); this.lobbyChanged(); }
      } else if (m.t === 'cheer') {
        this.cheered(c.peer, m.kind);
      } else if (m.t === 'heckle') {
        this.heckled(c.peer, m.seat, m.x, m.y);
      } else if (m.t === 'take') {
        this.takeSeat(c.peer, m.seat);
      } else if (m.t === 'reserve' && !this.watchers.has(c.peer)) {
        if (m.on) this.reservedUntil.set(c.peer, Date.now() + Room.RESERVE_MS); else this.reservedUntil.delete(c.peer);
      } else if (this.watchers.has(c.peer)) {
        // a spectator neither answers, nor chats, nor votes
      } else if (m.t === 'watchset') {
        this.setWatch(m, c.peer);
      } else if (m.t === 'unwatch') {
        this.sendAway(m.id, c.peer);
      } else if (m.t === 'orders') {
        if ((m.g ?? 0) === this.gen) this.heardOrders(c.peer, m.list);
      } else if (m.t === 'doing') {
        if (this.started?.seats[c.peer] === m.seat) this.doing(m.seat, m.key);
      } else if (m.t === 'mframe') {
        if (this.started?.seats[c.peer] === m.seat) this.miniFrame(m.seat, m.f, c.peer);
      } else if (m.t === 'mapask') {
        this.proposeMap(m.map, m.keep, c.peer);
      } else if (m.t === 'mapyes') {
        this.voteMap(m.yes, c.peer);
      } else if (m.t === 'rtin') {
        if ((m.g ?? 0) === this.gen) this.onRtInput(c.peer, m.in);
      } else if (m.t === 'ans') {
        // 即時制: the log is the host's ticks only; a guest never writes into it
        if ((m.g ?? 0) === this.gen && !this.started?.settings.realtime) this.record(m.seq, m.u ? undefined : m.v, true);
      } else if (m.t === 'chat') {
        this.heard({ ...m.line, from: c.peer });
      } else if (m.t === 'vote') {
        this.voted(m.target, c.peer);
      }
    });
    c.on('close', () => this.dropGuest(c));
  }

  /** A guest's connection closed, or it went silent (heartbeat): it is gone until it comes back. */
  private dropGuest(c: NetConn) {
    if (this.guests.get(c.peer) !== c) return;
    this.guests.delete(c.peer);
    this.lastSeen.delete(c.peer);
    try { c.close(); } catch { /* already closed */ }
    if (this.watchers.delete(c.peer)) { this.cheerAt.delete(c.peer); this.watchersChanged(); return; }
    if (!this.started) { this.members = this.members.filter(x => x.id !== c.peer); this.lobbyChanged(); }
    else if (!this.closed) { this.awaySince.set(c.peer, Date.now()); for (const x of this.members) if (x.id === c.peer) x.away = true; this.lobbyChanged(); this.onStatus('有玩家斷線，等待他回來…'); void reportParty('drop', `${this.nameOf(c.peer)} 斷線（房主這邊看到）`, { seq: this.log.length }); }
  }

  freeCharacter(want: number, id: string): number {
    const used = new Set(this.members.filter(x => x.id !== id).map(x => x.character));
    let c = want;
    for (let k = 0; k < 12 && used.has(c); k++) c = (c + 1) % 12;
    return c;
  }

  private lobbyChanged() {
    const m: Msg = { t: 'lobby', members: this.members, map: this.map, shared: this.shared, rules: this.rules, ...(this.ver !== null ? { ver: this.ver } : {}) };
    for (const c of this.guests.values()) c.open && c.send(m);
    this.noteLevel(roomLevel(this.members.map(x => x.ver)));
    this.onLobby();
  }
  private levelSaid = '';
  /** Different versions in the room (core/compat.ts): this phone is told once what its version has that the game goes without. */
  private noteLevel(level: string | undefined) {
    const text = this.ver === null ? '' : levelNote(level, this.ver);
    if (text && text !== this.levelSaid) this.heard({ from: '', name: '系統', character: -1, text, at: Date.now() });
    this.levelSaid = text;
  }
  setMap(map: string) { this.map = map; this.lobbyChanged(); }
  /** Host, before the game: changes the rules; everyone sees them. */
  setRules(rules: Partial<PartyRules>) {
    if (!this.host || this.started) return;
    this.rules = cleanRules({ ...this.rules, ...rules });
    this.lobbyChanged();
  }
  /** This phone's character and nickname (in the room, before the game). */
  setCharacter(c: number, nick = this.me.nick) {
    this.me.character = c; this.me.nick = cleanNick(nick) || undefined;
    if (this.host) { const x = this.members[0]; x.character = this.freeCharacter(c, x.id); x.nick = this.me.nick; named(x); this.lobbyChanged(); }
    else this.toHost?.send({ t: 'char', character: c, nick: this.me.nick, contact: this.me.contact } satisfies Msg);
  }
  /** This phone's 聯絡方式 (none: not shown), for everyone in the room; in the game too. */
  setContact(c: Contact | undefined) {
    this.me.contact = cleanContact(c);
    const x = this.members.find(y => y.id === this.myId);
    if (this.host) { if (x) { x.contact = this.me.contact; named(x); this.lobbyChanged(); } }
    else this.toHost?.send({ t: 'char', character: this.me.character, nick: this.me.nick, contact: this.me.contact } satisfies Msg);
  }

  private fromHost(m: Msg) {
    if (m.t === 'lobby') {
      // The host's version (an old host sends none): another one, and this phone leaves with the reason.
      const bad = this.ver !== null ? hostMismatch(this.ver, m.ver) : null;
      if (bad) { this.leaveRefused(bad); return; }
      this.members = m.members; this.map = m.map; this.shared = m.shared; this.rules = cleanRules(m.rules);
      if (!this.started) this.noteLevel(roomLevel(this.members.map(x => x.ver)));
      this.onLobby(); this.onVotes();
      this.replied?.('');
    }
    else if (m.t === 'start') { this.begin(m.start); }
    else if (m.t === 'seats') { if (this.started) { this.started.seats = m.seats; this.reseat(); this.onSeats(); } }
    else if (m.t === 'resume') { if (!this.started) { if (m.watch) this.watching = true; this.gen = m.gen ?? 0; this.resume = m.save ? { save: m.save, seq: m.seq } : null; this.begin(m.start); } this.replied?.(''); }
    else if (m.t === 'cheer') this.onCheer(m.kind, m.name ?? '觀眾', !!m.player);
    else if (m.t === 'watchers') {
      this.watchCount = m.n; this.watcherList = m.who ?? []; this.allowWatch = m.watch !== false; this.allowTake = m.take !== false; this.sentAway = new Set(m.out ?? []);
      this.onWatchers();
    }
    else if (m.t === 'doing') this.noteDoing(m.seat, m.key);
    else if (m.t === 'mframe') this.onMiniFrame(m.seat, m.f);
    else if (m.t === 'heckle') this.onHeckle(m.seat, m.x, m.y, m.name ?? '觀眾');
    else if (m.t === 'vacant') { this.vacant = m.seats; this.onVacant(); }
    else if (m.t === 'ans') { if ((m.g ?? 0) === this.gen) this.record(m.seq, m.u ? undefined : m.v, false); }
    else if (m.t === 'restart') this.restarted(m.start, m.gen);
    else if (m.t === 'mapvote') { this.mapVote = m.vote; this.onMapVote(); }
    else if (m.t === 'log') {
      m.answers.forEach(([v, u], k) => this.record(m.from + k, u ? undefined : v, false));
      // This phone has answers the (new) host lacks: send them on.
      for (let seq = m.total; seq < this.log.length; seq++) { const e = this.log[seq]; if (e) this.toHost?.send({ t: 'ans', seq, v: e[0] ?? null, u: e[1] } satisfies Msg); }
    }
    else if (m.t === 'digest') { if ((m.g ?? 0) === this.gen) this.digests.set(m.seq, m.h); }
    else if (m.t === 'net') { this.net = m.rows.map(r => (r.id === this.myId ? { ...r, rtt: median(this.hostRtts) ?? r.rtt } : r)); this.onNet(); }
    else if (m.t === 'chat') this.heard(m.line);
    else if (m.t === 'votes') { this.votes.set(m.target, new Set(m.voters)); this.onVotes(); }
    else if (m.t === 'kicked') this.away(m.id, m.seat);
    else if (m.t === 'bye') {
      if (m.reason === 'version' && this.ver !== null) { this.leaveRefused(m.why ?? hostMismatch(this.ver ?? '', m.ver) ?? '版本不同'); return; }
      if (m.reason === 'ping') { this.leaveRefused(m.why ?? '網路延遲太高'); return; }
      if (m.why && /離開圍觀/.test(m.why)) { this.leaveRefused(m.why); return; }
      this.kicked = /請出/.test(m.why ?? '');
      if (this.replied) this.replied(m.why ?? '房間已滿'); else this.onStatus(m.why ?? '房間已滿');
      this.close();
    }
  }
  /** Not the host's version: this phone leaves, the reason shown (join() fails with it, or onStatus). */
  private leaveRefused(why: string) {
    this.refused = true;
    if (this.replied) this.replied(why); else this.onStatus(why);
    this.close();
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

  // ---------------------------------------------------------------- 換地圖 (the user 2026-11-04)

  /** Which game of this room: each 換地圖 starts the next one, the question numbers from 0 again. */
  gen = 0;
  /** The vote going on (every phone). */
  mapVote: MapVote | null = null;
  onMapVote: () => void = () => {};
  /** The next game started: the game screen plays it, the room stays. */
  onRestart: (s: StartMsg) => void = () => {};
  /** Host: the next game on `map` (set by the game screen, which has the money). */
  nextGame: (map: number, keep: boolean) => StartMsg | null = () => null;
  /** A map's name for the chat (set by the game screen). */
  mapTitle: (map: number) => string = () => '';
  private mapTimer: ReturnType<typeof setTimeout> | undefined;
  /** No new vote before this (a vote that failed). */
  private mapAfter = 0;
  static readonly MAP_VOTE_MS = 60_000;
  static readonly MAP_AGAIN_MS = 30_000;

  /** The phones that vote: the players connected now (not the spectators). */
  private voters(): string[] { return Object.keys(this.started?.seats ?? {}).filter(id => id === this.myId || this.guests.get(id)?.open); }
  private tellMapVote() {
    const m: Msg = { t: 'mapvote', vote: this.mapVote };
    for (const c of this.guests.values()) { try { if (c.open) c.send(m); } catch { /* closing */ } }
    this.onMapVote();
  }
  private endMapVote(why: string) {
    clearTimeout(this.mapTimer);
    this.mapVote = null;
    this.mapAfter = Date.now() + Room.MAP_AGAIN_MS;
    this.heard({ from: '', name: '系統', character: -1, text: why, at: Date.now() });
    this.tellMapVote();
  }
  /** A player proposes the map; the one who proposes agrees. */
  proposeMap(map: number, keep: boolean, by = this.myId) {
    if (!this.host) { this.toHost?.send({ t: 'mapask', map, keep } satisfies Msg); return; }
    if (!this.started || this.mapVote || Date.now() < this.mapAfter || !(by in this.started.seats) || !this.mapTitle(map)) return;
    this.mapVote = { map, keep, by, yes: [by], need: this.voters().length };
    this.heard({ from: '', name: '系統', character: -1, text: `${this.nameOf(by)} 提議換到「${this.mapTitle(map)}」（${keep ? '保留現在的錢' : '重新開局'}）`, at: Date.now() });
    this.mapTimer = setTimeout(() => { if (this.mapVote) this.endMapVote('換地圖沒有在時間內全員同意，繼續這一局'); }, Room.MAP_VOTE_MS);
    this.tellMapVote();
    this.settleMapVote();
  }
  /** A player answers: one no ends it. */
  voteMap(yes: boolean, by = this.myId) {
    if (!this.host) { this.toHost?.send({ t: 'mapyes', yes } satisfies Msg); return; }
    const v = this.mapVote;
    if (!v || v.yes.includes(by) || !this.voters().includes(by)) return;
    if (!yes) { this.endMapVote(`${this.nameOf(by)} 不同意換地圖，繼續這一局`); return; }
    v.yes.push(by);
    this.tellMapVote();
    this.settleMapVote();
  }
  /** Everyone connected agreed: the next game. */
  private settleMapVote() {
    const v = this.mapVote;
    if (!v) return;
    const voters = this.voters();
    v.need = voters.length;
    if (!voters.every(id => v.yes.includes(id))) return;
    clearTimeout(this.mapTimer);
    this.mapVote = null;
    this.tellMapVote();
    const s = this.nextGame(v.map, v.keep);
    if (!s) return;
    this.heard({ from: '', name: '系統', character: -1, text: `全員同意，換到「${this.mapTitle(v.map)}」`, at: Date.now() });
    const gen = this.gen + 1, m: Msg = { t: 'restart', start: s, gen };
    for (const c of this.guests.values()) { try { if (c.open) c.send(m); } catch { /* closing */ } }
    this.restarted(s, gen);
  }
  /** The next game of this room: what the last one left is forgotten, the connections stay. */
  private restarted(s: StartMsg, gen: number) {
    if (gen <= this.gen) return;
    this.gen = gen;
    this.log = [];
    this.snap = null;
    this.resume = null;
    this.waiters.clear();
    this.digests.clear();
    this.doings.clear();
    this.myOrders = [];
    this.heardList.clear();
    this.filledTo.clear();
    this.mapVote = null;
    this.map = String(s.settings.mapId);
    this.started = s;
    this.mine = new Set(Object.entries(s.seats).filter(([id]) => id === this.myId).map(([, seat]) => seat));
    this.remember();
    this.onMapVote();
    this.onRestart(s);
  }
  /** Host: a phone back from a game before 換地圖 gets the one going on, from its first question. */
  private catchUp(c: NetConn, m: { have?: number; gen?: number }) {
    if (!this.started || m.have === undefined || (m.gen ?? 0) === this.gen) return;
    c.send({ t: 'restart', start: this.started, gen: this.gen } satisfies Msg);
    m.have = 0;
  }

  /** Host: starts the game for everyone. */
  start(s: StartMsg) {
    const m: Msg = { t: 'start', start: s };
    for (const c of this.guests.values()) c.open && c.send(m);
    this.begin(s);
  }
  private begin(s: StartMsg) {
    this.started = s;
    this.noteLevel(s.settings.level);
    reportCtx.room = this.code;
    this.mine = new Set(Object.entries(s.seats).filter(([id]) => id === this.myId).map(([, seat]) => seat));
    this.remember();
    this.onStart(s);
  }

  /** An answer to the game's question number `seq` (from this phone, or arriving). */
  private record(seq: number, v: unknown, fromGuest: boolean) {
    if (seq < this.log.length && this.log[seq] !== undefined) return;
    this.log[seq] = [v, v === undefined];
    if (this.host && fromGuest) {
      const m: Msg = { t: 'ans', seq, v: v ?? null, u: v === undefined, g: this.gen };
      for (const c of this.guests.values()) c.open && c.send(m);
    }
    this.waiters.get(seq)?.(v);
    this.waiters.delete(seq);
  }
  /** This phone answered question `seq` (one of its seats, or a seat sent away when it hosts). */
  answer(seq: number, v: unknown) {
    this.record(seq, v, false);
    const m: Msg = { t: 'ans', seq, v: v ?? null, u: v === undefined, g: this.gen };
    if (this.host) { for (const c of this.guests.values()) c.open && c.send(m); }
    else this.toHost?.send(m);
  }
  /** 即時制: an input of this phone for the host's next tick (the host takes its own at once). */
  rtInput(x: unknown) {
    if (this.host) this.onRtInput(this.myId, x);
    else this.toHost?.send({ t: 'rtin', in: x, g: this.gen } satisfies Msg);
  }
  /** 即時制 (host): an input arrived (a guest's, or this phone's): set by the game's clock. */
  onRtInput: (from: string, x: unknown) => void = () => {};
  /** Entry `seq` of the log if it is there (即時制 reads its ticks without waiting). */
  peek(seq: number): { v: unknown } | null {
    const e = this.log[seq];
    return e ? { v: e[1] ? undefined : e[0] } : null;
  }
  /** How many log entries this phone has (即時制: ticks). */
  get logLength(): number { return this.log.length; }

  /** The answer to question `seq` of another phone's seat. */
  wait(seq: number): Promise<unknown> {
    const have = this.log[seq];
    if (have) return Promise.resolve(have[1] ? undefined : have[0]);
    return new Promise(resolve => this.waiters.set(seq, resolve));
  }

  /** Each turn: the host sends its game's digest; a guest compares (true while they agree). */
  digest(seq: number, h: number): boolean {
    if (this.host) { const m: Msg = { t: 'digest', seq, h, g: this.gen }; for (const c of this.guests.values()) c.open && c.send(m); return true; }
    const theirs = this.digests.get(seq);
    return theirs === undefined || theirs === h;
  }

  // ---------------------------------------------------------------- chat, mute, kick votes

  /** Sends a line (at most 40 characters). */
  say(text: string) {
    const t = /^\[t:[^\]]+\]$/.test(text) ? text.slice(0, 80) : text.trim().slice(0, 40); // a taunt names its target's id
    if (!t) return;
    const mine = this.members.find(x => x.id === this.myId);
    const line: ChatLine = { from: this.myId, name: mine?.name ?? this.me.name, character: mine?.character ?? this.me.character, text: t, at: Date.now() };
    void postChat(this.code, t);
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
    if (this.protectedId(target)) {
      // The richest can't be sent away: its votes are dropped, everyone is told.
      this.votes.delete(target);
      for (const c of this.guests.values()) c.open && c.send({ t: 'votes', target, voters: [] } satisfies Msg);
      this.onVotes();
      const line: ChatLine = { from: '', name: '系統', character: -1, text: `${this.nameOf(target)}目前總資產最多，不能被請出`, at: Date.now() };
      this.heard(line);
      for (const c of this.guests.values()) c.open && c.send({ t: 'chat', line } satisfies Msg);
      return;
    }
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

  // ---------------------------------------------------------------- 圍觀 (the user 2026-11-03)

  /** Host: a spectator came (or came back); everyone hears how many watch now. */
  private addWatcher(id: string, have?: number) {
    this.watchers.add(id);
    // its name, for its cheers (from the hi: kept with the connection's id)
    this.watchersChanged();
    if (have === undefined) this.heard({ from: '', name: '系統', character: -1, text: `有人進來圍觀（${this.watchers.size} 人在看）`, at: Date.now() });
  }
  private watcherNames = new Map<string, string>();
  private watcherDevs = new Map<string, string>();
  private watchersChanged() {
    this.tellWatchers();
    this.onWatchers();
    this.onSeats();
  }
  /** Host: everyone hears who watches and the switches (also every heartbeat: a phone back in the game learns them). */
  private tellWatchers() {
    this.watchCount = this.watchers.size;
    this.watcherList = [...this.watchers].slice(0, 20).map(id => { const w = this.watcherInfo.get(id); return { id, name: this.watcherNames.get(id) ?? '觀眾', cc: w?.cc, region: w?.region }; });
    const m: Msg = { t: 'watchers', n: this.watchCount, who: this.watcherList, watch: this.allowWatch, take: this.allowTake, out: [...this.sentAway] };
    for (const c of this.guests.values()) { try { if (c.open) c.send(m); } catch { /* closing */ } }
  }
  /** A player turns 圍觀 or 接手 on or off (the host applies it; everyone reads who did in the chat). */
  setWatch(o: { watch?: boolean; take?: boolean }, by = this.myId) {
    if (!this.host) { this.toHost?.send({ t: 'watchset', ...o } satisfies Msg); return; }
    const who = this.nameOf(by);
    if (typeof o.watch === 'boolean' && o.watch !== this.allowWatch) { this.allowWatch = o.watch; this.heard({ from: '', name: '系統', character: -1, text: `${who} ${o.watch ? '開放' : '關閉'}了圍觀`, at: Date.now() }); }
    if (typeof o.take === 'boolean' && o.take !== this.allowTake) { this.allowTake = o.take; this.heard({ from: '', name: '系統', character: -1, text: `${who} ${o.take ? '允許' : '不允許'}別人接手`, at: Date.now() }); }
    this.watchersChanged();
    const v: Msg = { t: 'vacant', seats: this.vacantSeats() };
    for (const id of this.watchers) { const c = this.guests.get(id); try { if (c?.open) c.send(v); } catch { /* closing */ } }
  }
  /** A player sends a spectator away: it leaves and does not come back this game. */
  sendAway(id: string, by = this.myId) {
    if (!this.host) { this.toHost?.send({ t: 'unwatch', id } satisfies Msg); return; }
    if (!this.watchers.has(id)) return;
    const name = this.watcherNames.get(id) ?? '觀眾', c = this.guests.get(id);
    this.sentAway.add(id);
    const dev = this.watcherDevs.get(id);
    if (dev) this.sentAway.add(dev);
    this.watchers.delete(id);
    try { if (c?.open) c.send({ t: 'bye', why: '玩家請你離開圍觀了' } satisfies Msg); } catch { /* closing */ }
    this.heard({ from: '', name: '系統', character: -1, text: `${this.nameOf(by)} 請觀眾 ${name} 離開了`, at: Date.now() });
    this.watchersChanged();
  }
  /** This phone's player opened a window of LOCAL_DOING ('': closed it): the others see it on their waiting line. */
  doing(seat: number, key: string) {
    if (key && !(key in LOCAL_DOING)) return;
    this.noteDoing(seat, key);
    const m: Msg = { t: 'doing', seat, key };
    if (!this.host) { this.toHost?.send(m); return; }
    for (const c of this.guests.values()) { try { if (c.open) c.send(m); } catch { /* closing */ } }
  }
  private noteDoing(seat: number, key: string) { if (key) this.doings.set(seat, key); else this.doings.delete(seat); }
  /**
   * 小遊戲搗亂: this phone's player plays a 小遊戲 — its picture to everyone (by the host). `from`: the guest it came
   * from (not sent back). A picture over 12 kB is dropped (the stream is the game's least need).
   */
  miniFrame(seat: number, f: unknown, from?: string) {
    let text = '';
    try { text = JSON.stringify(f); } catch { return; }
    if (text.length > 12_000) return;
    const m: Msg = { t: 'mframe', seat, f };
    if (!this.host) { this.toHost?.send(m); return; }
    for (const [id, c] of this.guests) { if (id === from) continue; try { if (c.open) c.send(m); } catch { /* closing */ } }
    if (from) this.onMiniFrame(seat, f);
  }
  /** 小遊戲搗亂: this phone taps the 小遊戲 `seat` plays. */
  heckle(seat: number, x: number, y: number) {
    if (this.host) this.heckled(this.myId, seat, x, y);
    else this.toHost?.send({ t: 'heckle', seat, x, y } satisfies Msg);
  }
  /** Host: a 搗亂 (a player of the game or a spectator, not the one playing; every 2 s each), passed to everyone. */
  private heckled(id: string, seat: number, x: number, y: number) {
    const player = this.started?.seats[id] !== undefined;
    if (!this.started || (!player && !this.watchers.has(id)) || this.started.seats[id] === seat) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(seat)) return;
    const now = Date.now();
    if (now < (this.heckleAt.get(id) ?? 0)) return;
    this.heckleAt.set(id, now + 1800);
    const name = player ? this.nameOf(id) : this.watcherNames.get(id) ?? '觀眾';
    const m: Msg = { t: 'heckle', seat, x: Math.round(x), y: Math.round(y), name };
    for (const c of this.guests.values()) { try { if (c.open) c.send(m); } catch { /* closing */ } }
    this.onHeckle(seat, m.x, m.y, name);
  }
  /** Host: a gift of a spectator or a player of the game (rate-limited), passed to everyone. */
  private cheered(id: string, kind: string) {
    const player = this.started?.seats[id] !== undefined;
    if ((!player && !this.watchers.has(id)) || !/^[a-z]{2,12}$/.test(kind)) return;
    // one every 5 s each, and one at a time in the room (more are dropped, never queued: the game comes first)
    const now = Date.now();
    if (now < (this.cheerAt.get(id) ?? 0) || now < this.roomCheerAt) return;
    this.cheerAt.set(id, now + 5000);
    this.roomCheerAt = now + 2200;
    const name = player ? this.nameOf(id) : this.watcherNames.get(id) ?? '觀眾';
    const m: Msg = { t: 'cheer', kind, name, from: id, player };
    for (const c of this.guests.values()) { try { if (c.open) c.send(m); } catch { /* closing */ } }
    this.onCheer(kind, name, player);
  }

  // ---------------------------------------------------------------- 等待中下單 (the user 2026-11-07)

  /** The most orders a phone may have waiting. */
  static readonly MAX_ORDERS = 6;
  /** This phone's orders not yet filled. */
  myOrders: StockOrder[] = [];
  /** They changed (placed, cancelled, filled). */
  onOrders: () => void = () => {};
  /** Host: each phone's orders as it last sent them. */
  private heardList = new Map<string, StockOrder[]>();
  /** Each seat's newest order filled (every phone keeps this from the answers, so a new host knows it too). */
  private filledTo = new Map<number, number>();

  /** Places an order for this phone's `seat`; false when too many wait. */
  placeOrder(seat: number, slot: number, buy: boolean, n: number, more: { lev?: number; close?: number } = {}): boolean {
    if (this.myOrders.length >= Room.MAX_ORDERS) return false;
    const newest = Math.max(this.filledTo.get(seat) ?? 0, ...this.myOrders.map(o => o.id));
    this.myOrders.push({ id: Math.max(Date.now(), newest + 1), seat, slot, buy, n, ...more });
    this.sendOrders();
    this.onOrders();
    return true;
  }
  cancelOrder(id: number) {
    this.myOrders = this.myOrders.filter(o => o.id !== id);
    this.sendOrders();
    this.onOrders();
  }
  /** To the host: all of this phone's orders, as they stand. */
  sendOrders() {
    if (this.host) this.heardOrders(this.myId, this.myOrders);
    else this.toHost?.send({ t: 'orders', list: this.myOrders, g: this.gen } satisfies Msg);
  }
  /** Each turn: a new host has not heard them yet. */
  resendOrders() { if (this.myOrders.length) this.sendOrders(); }
  /** Host: a phone's orders; only for its own seat, whole numbers, and only as many as a phone may have. */
  private heardOrders(id: string, list: unknown) {
    const seat = this.started?.seats[id];
    if (seat === undefined || !Array.isArray(list)) return;
    const good = (list as StockOrder[]).filter(o => o?.seat === seat && Number.isInteger(o.id) && Number.isInteger(o.slot) && Number.isInteger(o.n) && o.n > 0
      && (o.lev === undefined || LEVERAGE.includes(o.lev)) && (o.close === undefined || Number.isInteger(o.close)));
    this.heardList.set(id, good.slice(0, Room.MAX_ORDERS));
  }
  /** Host: the answer to the game's 'orders' question: what waits, oldest first, each once. */
  takeOrders(): StockOrder[] {
    const all = [...this.heardList.values()].flat().filter(o => o.id > (this.filledTo.get(o.seat) ?? 0)).sort((a, b) => a.id - b.id);
    this.heardList.clear();
    return all;
  }
  /** Every phone: the answer came (the game fills them now). */
  ordersFilled(list: unknown) {
    if (!Array.isArray(list) || !list.length) return;
    for (const o of list as StockOrder[]) this.filledTo.set(o.seat, Math.max(this.filledTo.get(o.seat) ?? 0, o.id));
    const left = this.myOrders.filter(o => o.id > (this.filledTo.get(o.seat) ?? 0));
    if (left.length === this.myOrders.length) return;
    this.myOrders = left;
    this.onOrders();
  }
  /** 保留席位: how long a player's seat is kept for them (暫離). */
  static readonly RESERVE_MS = 10 * 60_000;
  /** A seat is free for a spectator once its phone has been gone this long (a short drop is not leaving). */
  static readonly VACANT_AFTER_MS = 30_000;
  /**
   * Host: the seats a spectator may take now — a player sent away, or gone for 30 s and not 暫離 (保留席位); with
   * 途中加入, the computers' seats nobody has taken.
   */
  vacantSeats(): { seat: number; name: string }[] {
    const s = this.started;
    if (!s || !this.allowTake) return [];
    const now = Date.now(), out: { seat: number; name: string }[] = [];
    const seatName = (seat: number) => { const p = s.settings.players[seat]; return (p?.nick || CHARACTERS[p?.character ?? 0]?.name) ?? '玩家'; };
    for (const [id, seat] of Object.entries(s.seats)) {
      if (id === this.myId || !this.seatOpen(seat) && !this.seatHuman(seat)) continue;
      if (this.kickedSeats.has(seat)) { out.push({ seat, name: seatName(seat) }); continue; }
      const gone = !this.guests.get(id)?.open, since = this.awaySince.get(id);
      if (gone && since !== undefined && now - since >= Room.VACANT_AFTER_MS && !((this.reservedUntil.get(id) ?? 0) > now)) out.push({ seat, name: seatName(seat) });
    }
    for (const seat of this.freeSeats()) out.push({ seat, name: seatName(seat) });
    return out;
  }
  /** The player at `seat` (the flag beside the name). */
  seatMember(seat: number): Member | undefined {
    const id = Object.keys(this.started?.seats ?? {}).find(k => this.started!.seats[k] === seat);
    return this.members.find(m => m.id === id);
  }
  /** Whether `seat` is a human's seat still in the game (set by the game screen). */
  seatHuman: (seat: number) => boolean = () => false;
  /** Host: a spectator takes a free seat (the first to ask); everyone gets the new seats. */
  private takeSeat(id: string, seat: number) {
    if (!this.started || !this.watchers.has(id) || !this.vacantSeats().some(v => v.seat === seat)) return;
    const was = this.vacantSeats().find(v => v.seat === seat)!.name;
    for (const [k, v] of Object.entries(this.started.seats)) if (v === seat) delete this.started.seats[k];
    this.started.seats[id] = seat;
    this.kickedSeats.delete(seat);
    this.watchers.delete(id);
    const info = this.watcherInfo.get(id) ?? { name: '觀眾', character: 0 };
    if (!this.members.some(x => x.id === id)) this.members.push(named({ id, ...info }));
    const m: Msg = { t: 'seats', seats: this.started.seats };
    for (const c of this.guests.values()) { try { if (c.open) c.send(m); } catch { /* closing */ } }
    this.heard({ from: '', name: '系統', character: -1, text: `觀眾 ${this.nameOf(id)} 接手了 ${was}`, at: Date.now() });
    this.watchersChanged();
    this.lobbyChanged();
  }
  /** 接手: this spectator asks for a free seat. */
  take(seat: number) { if (this.watching) this.toHost?.send({ t: 'take', seat } satisfies Msg); }
  /** 保留席位 (暫離) for this phone's seat: kept 10 minutes (or off). */
  reserve(on: boolean) {
    this.reservedTill = on ? Date.now() + Room.RESERVE_MS : 0;
    if (this.host) { if (on) this.reservedUntil.set(this.myId, this.reservedTill); else this.reservedUntil.delete(this.myId); }
    else this.toHost?.send({ t: 'reserve', on } satisfies Msg);
  }
  /** The seats changed: this phone's seats again (a spectator that took one plays from now on). */
  private reseat() {
    if (!this.started) return;
    this.mine = new Set(Object.entries(this.started.seats).filter(([id]) => id === this.myId).map(([, seat]) => seat));
    if (this.mine.size) this.watching = false;
  }
  /** A spectator or a waiting player sends a gift (the host passes it on; the sender's screen plays it when it comes back). */
  cheer(kind: string) { if (this.host) this.cheered(this.myId, kind); else this.toHost?.send({ t: 'cheer', kind } satisfies Msg); }

  /** Host: a guest slower than the room's 延遲上限 is told why and leaves (before the game). */
  private tooSlow(c: NetConn, ms: number, limit: number) {
    const name = this.nameOf(c.peer);
    try { c.send({ t: 'bye', why: `你的網路延遲 ${ms} ms，超過房主設定的 ${limit} ms\n換個網路（例如 Wi-Fi）再試試`, reason: 'ping' } satisfies Msg); } catch { /* closing */ }
    setTimeout(() => this.dropGuest(c), 800);
    this.lastSeen.set(c.peer, Date.now());
    this.rtts.delete(c.peer);
    this.heard({ from: '', name: '系統', character: -1, text: `${name} 的網路延遲 ${ms} ms，超過上限，無法加入`, at: Date.now() });
  }

  /** Host: everyone's connection now, kept and sent to all (the 延遲 panel). */
  private tableNet() {
    const rows: NetRow[] = this.members.map(m => {
      if (m.id === this.myId) return { id: m.id, rtt: this.peer?.relayRtt || null, via: 'host' as const };
      const c = this.guests.get(m.id);
      return { id: m.id, rtt: c?.open ? median(this.rtts.get(m.id) ?? []) : null, via: c?.via ?? 'p2p', ...(m.away || !c?.open ? { away: true } : {}) };
    });
    this.net = rows;
    const msg: Msg = { t: 'net', rows };
    for (const c of this.guests.values()) { try { if (c.open) c.send(msg); } catch { /* closing */ } }
    this.onNet();
  }
  /** This phone's way to the room: 'host', 'vps' or 'p2p', and its round trip to the host (null: not yet). */
  link(): { via: 'host' | 'vps' | 'p2p'; rtt: number | null; relay: number } {
    if (this.host) return { via: 'host', rtt: 0, relay: this.peer?.relayRtt ?? 0 };
    return { via: this.toHost?.via ?? 'p2p', rtt: this.toHost?.open ? median(this.hostRtts) : null, relay: this.peer?.relayRtt ?? 0 };
  }

  /** Every PING_MS: ping the other side(s); whoever has been silent for SILENT_MS is taken as gone. */
  private startBeat() {
    if (this.beat) return;
    this.beat = window.setInterval(() => {
      if (this.closed) { clearInterval(this.beat); this.beat = 0; return; }
      const now = Date.now(), ping: Msg = { t: 'ping', at: now };
      if (this.host) {
        const limit = this.started ? 0 : PING_LIMITS[this.rules.maxPing] ?? 0;
        for (const c of [...this.guests.values()]) {
          if (now - (this.lastSeen.get(c.peer) ?? now) > Room.SILENT_MS) { this.dropGuest(c); continue; }
          // 延遲上限 (before the game only: in it nobody is sent away for a slow moment): three measures over it.
          const r = this.rtts.get(c.peer) ?? [], mid = median(r);
          if (limit && r.length >= 3 && mid !== null && mid > limit) { this.tooSlow(c, mid, limit); continue; }
          try { if (c.open) c.send(ping); } catch { /* closing */ }
        }
        this.tableNet();
        if (this.started) this.tellWatchers();
        if (this.started && this.watchers.size) {
          const v: Msg = { t: 'vacant', seats: this.vacantSeats() };
          for (const id of this.watchers) { const c = this.guests.get(id); try { if (c?.open) c.send(v); } catch { /* closing */ } }
        }
      } else if (this.toHost) {
        const c = this.toHost;
        if (now - this.hostSeen > Room.SILENT_MS) {
          this.toHost = null;
          try { c.close(); } catch { /* already closed */ }
          if (!this.closed) void this.rejoin();
        } else { try { if (c.open) c.send(ping); } catch { /* closing */ } }
      }
    }, Room.PING_MS);
  }

  close() {
    if (!this.closed) this.onClose();
    gameEnd('quit', this.kicked ? 'kicked' : 'left');
    this.closed = true;
    if (this.beat) { clearInterval(this.beat); this.beat = 0; }
    for (const c of this.guests.values()) c.close();
    this.toHost?.close();
    this.peer?.destroy();
  }
}
