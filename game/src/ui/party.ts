/**
 * 派對模式's screens (v0.5.0, the user 2026-10-19): 「建立房間」 (私享: a room code for friends; 共享: also listed in
 * 「尋找夥伴」), 「進入房間」 (type the code), 「尋找夥伴」 (the shared rooms). The room shows its code, the players
 * (tap your face to change character), the map, computers to fill up to four or eight (at most eight players), and the host's 「開始遊戲」. The game
 * itself runs in main.ts with the room (party-net.ts: lockstep answers).
 */
import { findCountry, flagHtml, myCountry } from './region-flag';
import { CHARACTERS } from '../core/characters';
import { today } from '../core/date';
import type { GameSettings } from '../core/types';
import type { MapInfo } from './assets';
import { audio } from './audio';
import { FINALE_MAP } from '../core/casino-rules';
import { AI_LEVELS, cleanContact, cleanNick, CONTACT_KINDS, CONTACT_MAX, EXTRAS, Lobby, myRegion, NICK_MAX, PARTY_CHALLENGE, PARTY_VERSION, Room, ROOM_MAX, startMsg, TURN_SECONDS, type Contact, type PartyRules, type RoomInfo, type StartMsg } from './party-net';
import { showContact } from './party-card';
import { persist } from './keepsake';
import { RT_LENGTHS, rtMapOk } from '../core/realtime';
import { pingText, rowGrade } from './party-hud';
import { headLine, inParty, lastHeadCount, onHeadCount, type HeadCount } from './party-presence';
import { directLine, lanHost, netConfig, setDirectLine, useLan } from './net-peer';
import { findLan, lanSupported, type LanServer } from './lan-find';
import { gameStart, setReportName, watchErrors } from './party-report';
import { RULE_ITEMS, RULE_LABELS } from './rule-options';
import { sameVersion, verOf } from './party-version';
import { inlineChat } from './party-chat';
import { mapCards } from './party-maps';
import { uiAlert, uiConfirm } from './dialog';
import { isLibKey, LIB_MAP_ID, libMapName, libPlayed, myLibMaps, PARTY_LIB_ON, readyLibMap, type PartyLibMap } from './maker';
import { checkNetwork } from './party-check';
import type { SpriteBank } from './sprites';
import './party.css';
import { shrinkText } from './text';
import { fitToScreen } from './saves';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const KEY = 'rich4.party.character';
const myCharacter = () => { try { const v = Number(localStorage.getItem(KEY)); return v >= 0 && v < 12 ? v : 9; } catch { return 9; } };
const keepCharacter = (c: number) => { try { localStorage.setItem(KEY, String(c)); } catch { /* not kept */ } };
/** The player's own name (the user 2026-10-19: 「可可愛愛小仙女」 for 孫小美), kept on the phone. */
const NICK_KEY = 'rich4.party.name';
const myNick = () => { try { return cleanNick(localStorage.getItem(NICK_KEY)); } catch { return ''; } };
const keepNick = (s: string) => { try { localStorage.setItem(NICK_KEY, s); } catch { /* not kept */ } persist(); };
/** 聯絡方式 (the user 2026-11-08), kept on the phone for every room. */
const CONTACT_KEY = 'rich4.party.contact';
const myContact = (): Contact | undefined => { try { return cleanContact(JSON.parse(localStorage.getItem(CONTACT_KEY) ?? 'null')); } catch { return undefined; } };
const keepContact = (c: Contact | undefined) => { try { if (c) localStorage.setItem(CONTACT_KEY, JSON.stringify(c)); else localStorage.removeItem(CONTACT_KEY); } catch { /* not kept */ } persist(); };


const newRoom = () => new Room({ name: myNick() || CHARACTERS[myCharacter()].name, character: myCharacter(), region: myRegion(), cc: myCountry(), nick: myNick() || undefined, contact: myContact() });

export interface PartyDeps {
  app: HTMLElement; bank: SpriteBank; maps: MapInfo[];
  /** Starts the game with the room (main.ts). */
  play: (settings: GameSettings, room: Room) => void;
  back: () => void;
}

/**
 * The room's settings (the user 2026-11-03): always shown as tiles — the new-game screen's five rules and 等待時間 in
 * the sixth place — the host with ‹ › on each, everyone else the values. No 模式 (online is 大富翁 only) and no
 * 延遲上限 any more.
 */
type SetKey = keyof typeof RULE_LABELS | 'turnSec';
const SET_KEYS: SetKey[] = ['fundIndex', 'traffic', 'landLimitIndex', 'daysLimitIndex', 'victoryIndex', 'turnSec'];
const SET_LABEL = (k: SetKey) => (k === 'turnSec' ? '等待時間' : RULE_LABELS[k]);
const SET_ITEMS = (k: SetKey): readonly string[] => (k === 'turnSec' ? TURN_SECONDS.map(s => `${s} 秒`) : RULE_ITEMS[k]);
function rulesHtml(rules: PartyRules, host: boolean, rt = false): string {
  // 即時制: no day or money target, no time per decision (docs/rules/31)
  const keys = rt ? SET_KEYS.filter(k => k !== 'daysLimitIndex' && k !== 'victoryIndex' && k !== 'turnSec') : SET_KEYS;
  return `<div class="pt-tiles">${keys.map(k => {
    const v = SET_ITEMS(k)[rules[k]];
    // .pt-tin: laid out by the tile's own width (party.css): one line where it fits, else the label above.
    return `<div class="pt-tile"><div class="pt-tin"><span>${SET_LABEL(k)}</span>${host
      ? `<div class="pt-step"><button data-rule="${k}" data-d="-1" aria-label="上一個">‹</button><b>${v}</b><button data-rule="${k}" data-d="1" aria-label="下一個">›</button></div>`
      : `<b>${v}</b>`}</div></div>`;
  }).join('')}</div>`;
}
/** 追加玩法 (party-net.ts EXTRAS) that apply to the room (乞丐 not in 即時制). */
const extrasFor = (rt: boolean) => EXTRAS.filter(x => !(rt && 'turnBased' in x && x.turnBased));
/**
 * 追加玩法's row (the user 2026-11-08: the new rules would not fit a row each): how many are on, a tap opens the window
 * with every one (extrasSheet) — switches for the host, what is on for everyone else.
 */
function extrasRow(on: number, rt: boolean): string {
  const list = extrasFor(rt), n = list.filter(x => on & x.bit).length;
  return `<div class="pt-choice hot${n ? ' on' : ''}"><div class="pt-cin"><span>追加玩法</span><div class="pt-seg"><button class="on" data-a="extras">已開 ${n}／${list.length} ›</button></div></div></div>`;
}
/** 追加玩法's window: each new rule, what it does, and its switch (the host's) or whether it is on. */
function extrasSheet(on: number, host: boolean, rt: boolean): string {
  return `<div class="msg sheet pt-ex"><b class="pt-ex-t">追加玩法</b><small class="pt-ex-s">${host ? '原版沒有的新玩法，房主可以一個一個開關' : '房主決定開哪些'}</small>
    ${extrasFor(rt).map(x => `<div class="pt-ex-row${on & x.bit ? ' on' : ''}"><div><b>${x.name}</b><small>${x.desc}</small></div>${host
      ? `<button class="pt-ex-sw${on & x.bit ? ' on' : ''}" data-ex="${x.bit}" aria-label="${on & x.bit ? '關閉' : '開啟'}${x.name}"><i></i></button>`
      : `<em>${on & x.bit ? '開' : '關'}</em>`}</div>`).join('')}
    <div class="choices"><button class="candy yes" data-a="extras-close">好</button></div></div>`;
}
/** A row of choices (空位, 電腦難度): chips for the host, the value for everyone else. */
function choiceRow(label: string, items: { v: number; text: string }[], on: number, host: boolean, attr: string, cls = ''): string {
  return `<div class="pt-choice${cls}"><div class="pt-cin"><span>${label}</span>${host
    ? `<div class="pt-seg">${items.map(x => `<button class="${x.v === on ? 'on' : ''}" data-${attr}="${x.v}">${x.text}</button>`).join('')}</div>`
    : `<b>${items.find(x => x.v === on)?.text ?? ''}</b>`}</div></div>`;
}

/**
 * A listed room's 挑戰模式, 等待時間 and 電腦難度 as tags (挑戰模式 in blue, a quick room in yellow, 地獄 in red; the user
 * 2026-11-03: who doesn't want 挑戰模式 sees it before joining); none from an older host.
 */
/** The room plays 即時制 (its rule on, on a standard map). */
const rtRoom = (r: Room) => !!r.rules.realtime && rtMapOk(Number(r.map));
/**
 * The note when a room turns to 即時制 (the user 2026-11-08): the author could not test it with friends; whoever can,
 * please do and report on GitHub. At the top, about 8 s; its × closes it sooner.
 */
function rtTesters() {
  document.querySelector('.pt-rt-note')?.remove();
  const el = document.createElement('div');
  el.className = 'pt-rt-note';
  el.innerHTML = '<button class="pt-rt-x" aria-label="關閉">×</button><b>即時制（測試版）</b>作者沒什麼朋友，派對模式的即時制沒辦法自己測試。有朋友的話，請大家一起幫忙試玩！遇到問題請到 GitHub 回報 issue 給 @iam567（iam567/rich4-renew-app）';
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 400); };
  el.querySelector<HTMLElement>('.pt-rt-x')!.onclick = e => { e.stopPropagation(); close(); };
  document.body.append(el);
  setTimeout(close, 8_000);
}

function roomTags(x: RoomInfo): string {
  const t = Number.isFinite(x.turn) ? Math.trunc(x.turn as number) : 0, ai = Number.isInteger(x.ai) ? (x.ai as number) : -1, ch = Number.isInteger(x.ch) && (x.ch as number) > 0;
  if (!t && ai < 0 && !ch && !x.drop && !x.rt) return '';
  return `<i class="pt-rtags">${x.rt ? '<i class="pt-rtag rt">即時制</i>' : ''}${x.drop ? '<i class="pt-rtag drop">可途中加入</i>' : ''}${ch ? '<i class="pt-rtag ch">挑戰模式</i>' : ''}${t ? `<i class="pt-rtag${t <= 20 ? ' quick' : ''}">每步 ${t} 秒</i>` : ''}${ai >= 0 && AI_LEVELS[ai] ? `<i class="pt-rtag${ai === 3 ? ' hell' : ''}">電腦${AI_LEVELS[ai]}</i>` : ''}</i>`;
}

/** 局域網房間: this is the PC version (its server, desktop/lan-relay.cjs). */
const desktopLan = () => (globalThis as { rich4Desktop?: { lan?: { start(): Promise<{ port: number; urls: string[] }> } } }).rich4Desktop?.lan;
export function openParty(d: PartyDeps): void {
  // Problem reports (party-report.ts): who this phone is, and program errors while in 派對模式.
  watchErrors();
  setReportName(myNick() || CHARACTERS[myCharacter()].name);
  const face = (c: number) => d.bank.art('Data', 2, c)?.src ?? '';
  const maps = d.maps.filter(m => !m.hidden && (m.kind === 'orig' || m.kind === 'custom'));
  const overlay = document.createElement('div');
  overlay.className = 'slots-overlay pt-ov';
  const box = document.createElement('div');
  box.className = 'msg sheet pt';
  overlay.append(box);
  d.app.append(overlay);
  fitToScreen(overlay, box); // a screen taller than the window shrinks instead of scrolling (saves.ts)
  let lobby: Lobby | null = null, room: Room | null = null;
  const leave = () => { lobby?.close(); lobby = null; if (room && !room.started) room.close(); room = null; overlay.remove(); stopCount(); inParty(null); };
  // 派對模式's head count (party-presence.ts): every 「.pt-online」 line on the screen shows the newest.
  // (the split in brackets is its own piece: on a narrow phone it goes onto a line of its own instead of past the box)
  const counted = (n: HeadCount | null) => {
    if (!n) return;
    const [head, split] = `派對模式現在 ${headLine(n)}`.split(/(?=（)/);
    for (const el of box.querySelectorAll<HTMLElement>('.pt-online')) {
      el.hidden = false;
      const parts = [head, split].filter(Boolean).map(t => { const sp = document.createElement('span'); sp.textContent = t; return sp; });
      el.replaceChildren(...parts);
    }
  };
  const stopCount = onHeadCount(counted);
  const show = (title: string, html: string) => { box.classList.remove('pt-roomv'); box.innerHTML = `<div class="ribbon">${esc(title)}</div>${html}`; counted(lastHeadCount()); };
  const fail = (e: unknown) => { audio.ui('error'); home(`<p class="pt-err">${esc((e as Error)?.message ?? '連線失敗').replace(/\n/g, '<br>')}</p>`); };

  function home(note = '') {
    lobby?.close(); lobby = null; room?.close(); room = null;
    inParty('menu');
    // 局域網房間 (the user 2026-11-08): the PC hosts, the phones on its Wi-Fi join; nobody from the internet
    const lanBtn = netConfig.lan || !lanSupported() ? '' : `<button class="candy opt" data-a="lan">局域網房間<small>${desktopLan() ? '這台電腦開房，或加入同一個 Wi-Fi 裡電腦的房間' : '手機不能開房：加入同一個 Wi-Fi 裡 Windows／Mac 版開的房間'}</small></button>`;
    show('派對模式', `<p class="pt-lead">${netConfig.lan ? '局域網模式：只有同一個 Wi-Fi 的人能加入' : '和朋友各用自己的手機，一起玩同一局'}</p><p class="pt-online" hidden></p>${note}
      <div class="pt-menu">${lanBtn}
        <button class="candy yes" data-a="create">建立房間<small>私享房間碼，或公開到遊戲大廳</small></button>
        <button class="candy opt" data-a="join">進入房間<small>輸入朋友的房間碼</small></button>
        <button class="candy opt" data-a="find">遊戲大廳<small>看看大家開的房間，加入一起玩</small></button>
      </div>
      ${netConfig.lan ? '<div class="pt-line"><button class="chip" data-a="internet">回到網路聯機</button></div>' : `<div class="pt-line"><span>聯機線路</span><button class="chip${directLine() ? '' : ' on'}" data-line="1">線路一</button><button class="chip${directLine() ? ' on' : ''}" data-line="2">線路二</button><small>卡頓或常斷線時可以換一條</small></div>`}
      <div class="choices"><button class="candy ghost" data-a="back">返回</button></div>
      <p class="pt-note">終於可以聯機了，但你還能找到之前和你一起玩的朋友嗎？</p>`);
  }

  function create() {
    let shared = false, map = maps[0]?.id ?? 0, page = 0, lib = '', mine: PartyLibMap[] = [];
    // 自建地圖 (the user 2026-11-12): the maps on this phone that are in the 地圖庫 — verified and published by their makers
    if (PARTY_LIB_ON) void myLibMaps().then(l => { mine = l; libMaps = l; if (box.querySelector('.pt-libsec')) draw(); });
    const render = () => show('建立房間', `
      <div class="pt-types">
        <button class="pt-type${shared ? '' : ' on'}" data-shared="0"><b>私享房間</b><small>憑房間碼才能進來</small></button>
        <button class="pt-type${shared ? ' on' : ''}" data-shared="1"><b>公開房間</b><small>大家都能從大廳加入</small></button>
      </div>
      <div class="pt-sec">選擇地圖</div>
      ${mapCards(maps, lib ? -1 : map, page)}
      ${!PARTY_LIB_ON ? '' : `<div class="pt-sec pt-libsec">自建地圖</div>
      ${mine.length ? `<div class="pt-mgrid">${mine.map(x => `<button class="pt-mcard${x.lib === lib ? ' on' : ''}" data-lib="${x.lib}">${x.thumb ? `<img src="${x.thumb}" alt="">` : '<img alt="">'}<span>${esc(x.name)}</span></button>`).join('')}</div>`
        : '<p class="pt-mapnote">在「自建地圖 → 創作樂園」裡打開一張地圖，按「加到派對模式」（最多 3 張），就會出現在這裡</p>'}`}
      <div class="choices"><button class="candy ghost" data-a="home">返回</button><button class="candy yes" data-a="open">建立房間</button></div>`);
    // both kinds side by side even on a 320 px phone: their words shrink to the card
    const draw = () => { render(); shrinkText(box, '.pt-type b, .pt-type small', 8); };
    draw();
    box.onclick = async e => {
      const t = e.target as HTMLElement;
      const s2 = t.closest<HTMLElement>('[data-shared]'), mp = t.closest<HTMLElement>('[data-map]'), pg = t.closest<HTMLElement>('[data-mp]'), a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (s2) { audio.ui('click'); shared = s2.dataset.shared === '1'; draw(); return; }
      if (mp) { audio.ui('click'); map = Number(mp.dataset.map); lib = ''; draw(); return; }
      const lb = t.closest<HTMLElement>('[data-lib]');
      if (lb) { audio.ui('click'); lib = lb.dataset.lib!; draw(); return; }
      if (pg && !(pg as HTMLButtonElement).disabled) { audio.ui('click'); page = Math.max(0, page + Number(pg.dataset.mp)); draw(); return; }
      if (a === 'home') { audio.ui('no'); home(); box.onclick = menu; return; }
      if (a === 'open') {
        audio.ui('yes');
        show('建立房間', '<p class="pt-lead">建立房間中…</p>');
        const r = newRoom();
        room = r;
        try { await r.create(lib ? `lib:${lib}` : String(map), shared); } catch (err) { fail(err); box.onclick = menu; return; }
        // Every open room is in the list: a shared one to join, a private one only counted (the title's figures).
        lobby = new Lobby(); void lobby.start(info(r));
        roomView(r);
      }
    };
  }
  const mapName = (id: string) => (isLibKey(id) ? libMapName(id) || '自建地圖' : maps.find(m => String(m.id) === id)?.name ?? '');
  /** The library maps this phone offered (their pictures for the room's map line). */
  let libMaps: PartyLibMap[] = [];
  const mapThumb = (id: string) => (isLibKey(id) ? libMaps.find(x => `lib:${x.lib}` === id)?.thumb : maps.find(m => String(m.id) === id)?.thumbnail);
  /** A private room's token in the list (never its code). */
  const token = `p-${Math.random().toString(36).slice(2, 10)}`;
  const info = (r: Room): RoomInfo => r.shared ? infoShared(r) : { ...infoShared(r), code: token, host: '', map: '', private: true };
  const infoShared = (r: Room): RoomInfo => ({ code: r.code, host: r.members[0]?.name ?? '', character: r.members[0]?.character ?? 0, map: mapName(r.map), players: r.members.length, max: ROOM_MAX, at: Date.now(), region: r.members[0]?.region, cc: r.members[0]?.cc, ...(r.ver ? { ver: r.ver } : {}),
    turn: TURN_SECONDS[r.rules.turnSec], ai: r.rules.aiLevel, ...(r.rules.challenge && Number(r.map) !== FINALE_MAP ? { ch: r.rules.challenge } : {}),
    ...(r.rules.dropIn && !rtRoom(r) ? { drop: true } : {}), ...(rtRoom(r) ? { rt: true } : {}), ...(r.started ? { playing: true, free: r.freeSeats().length, watch: r.watchCount, ...(r.allowWatch ? {} : { nowatch: true }) } : {}) });

  function roomView(r: Room) {
    inParty('room');
    /** Computers up to this many players (4 or 8), or 0: players only. */
    let fill = 4;
    show(r.shared ? '共享房間' : '私享房間', `<div class="pt-dyn"></div>
      <div class="pt-row pt-me"><b>名字</b><div class="pt-cin2"><input class="pt-nick" maxlength="${NICK_MAX}" enterkeyhint="done" value="${esc(myNick())}"><button class="chip pt-cbtn"></button></div></div>
      <p class="pt-hint">名字最多 ${NICK_MAX} 字；聯絡方式只有同房間的玩家點你的頭像才看得到</p>
      <div class="pt-chat"></div><div class="choices pt-acts"></div>`);
    box.classList.add('pt-roomv'); // the room's own layout (party.css: two halves on a landscape phone)
    // Own name: outside the part redrawn on every change, so typing is never interrupted.
    const nick = box.querySelector<HTMLInputElement>('.pt-nick')!;
    let nickTimer = 0;
    nick.oninput = () => {
      clearTimeout(nickTimer);
      nickTimer = window.setTimeout(() => {
        const v = cleanNick(nick.value);
        keepNick(v);
        setReportName(v || CHARACTERS[myCharacter()].name);
        const mine = r.members.find(m => m.id === r.myId);
        if (mine) r.setCharacter(mine.character, v);
      }, 400);
    };
    nick.onkeydown = e => { if (e.key === 'Enter') nick.blur(); };
    nick.onblur = () => { nick.value = cleanNick(nick.value); };
    // 聯絡方式 (the user 2026-11-08): a button by the name; its sheet picks the kind and takes the ID, kept on this phone
    const cbtn = box.querySelector<HTMLButtonElement>('.pt-cbtn')!;
    const showBtn = () => { const c = myContact(); cbtn.textContent = c ? `聯絡：${CONTACT_KINDS.find(([k]) => k === c.k)?.[1] ?? ''}` : '聯絡方式'; cbtn.classList.toggle('on', !!c); };
    showBtn();
    cbtn.onclick = e => {
      e.stopPropagation();
      audio.ui('click');
      const c = myContact(), ov = document.createElement('div');
      ov.className = 'slots-overlay pt-card-ov';
      ov.innerHTML = `<div class="msg sheet pt-card"><div class="ribbon">聯絡方式</div>
        <div class="pt-kinds"><button class="chip${c ? '' : ' on'}" data-k="">不公開</button>${CONTACT_KINDS.map(([k, n]) => `<button class="chip${c?.k === k ? ' on' : ''}" data-k="${k}">${n}</button>`).join('')}</div>
        <input class="pt-cv" maxlength="${CONTACT_MAX}" enterkeyhint="done" placeholder="你的 ID" value="${esc(c?.v ?? '')}">
        <p class="pt-card-c none">同房間的玩家點你的頭像就看得到</p>
        <div class="choices"><button class="candy ghost" data-a="close">取消</button><button class="candy yes" data-a="save">保存</button></div></div>`;
      let kind = c?.k ?? '';
      const cv = ov.querySelector<HTMLInputElement>('.pt-cv')!;
      cv.disabled = !kind;
      const save = () => {
        const next = kind ? cleanContact({ k: kind, v: cv.value }) : undefined;
        if (kind && !next) { audio.ui('error'); cv.focus(); return; }
        keepContact(next);
        r.setContact(next);
        audio.ui('yes');
        showBtn();
        ov.remove();
      };
      ov.addEventListener('pointerdown', ev => ev.stopPropagation());
      ov.onclick = ev => {
        ev.stopPropagation();
        const t = ev.target as HTMLElement, k = t.closest<HTMLElement>('[data-k]'), a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
        if (k) { audio.ui('click'); kind = k.dataset.k ?? ''; ov.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x === k)); cv.disabled = !kind; if (kind) cv.focus(); return; }
        if (a === 'save') { save(); return; }
        if (a === 'close' || t === ov) { audio.ui('no'); ov.remove(); }
      };
      cv.onkeydown = ev => { if (ev.key === 'Enter') { cv.blur(); save(); } };
      box.append(ov);
    };
    const chat = inlineChat(r, face);
    box.querySelector('.pt-chat')!.append(chat.el);
    r.onChat = () => chat.draw();
    let wasRt = false;
    const render = () => {
      const dyn = box.querySelector('.pt-dyn'), acts = box.querySelector('.pt-acts');
      if (!r.code || !dyn || !acts) return;
      // 即時制 just chosen (or a room joined with it): ask for testers (the user 2026-11-08)
      if (rtRoom(r) !== wasRt) { wasRt = rtRoom(r); if (wasRt) rtTesters(); }
      const host = r.members[0]?.id === r.myId;
      const mine = r.members.find(m => m.id === r.myId);
      if (mine) nick.placeholder = CHARACTERS[mine.character].name;
      if (fill && fill <= r.members.length) fill = fill === 4 ? 0 : fill; // 補滿4人 with four players already: players only
      if (r.rules.dropIn && !rtRoom(r) && !fill && r.members.length < 4) fill = 4; // 途中加入: computers keep the seats for whoever comes
      const seats = [...r.members.map(m => ({ m, cpu: false })), ...(fill ? Array.from({ length: Math.max(0, fill - r.members.length) }, () => ({ m: null, cpu: true })) : [])];
      // Two halves (side by side on a landscape phone, one under the other otherwise): who and where / the settings.
      dyn.innerHTML = `<div class="pt-half">
        <div class="pt-code"><small>房間碼</small><b class="${r.code.length > 4 ? 'long' : ''}">${r.code}</b>${netConfig.lan && lanHost.urls.length ? '' : r.shared ? '<em>已公開在「遊戲大廳」</em>' : '<em>把房間碼告訴朋友</em>'}</div>
        ${netConfig.lan && lanHost.urls.length && host ? `<div class="pt-lanqr"><small>同一個 Wi-Fi 的朋友打開大富翁4 App，派對模式 →「局域網房間」就搜得到這個房間<br><em>搜不到時手動輸入地址 <span>${esc(lanHost.urls[0].replace('http://', ''))}</span></em></small></div>` : ''}
        <div class="pt-seats${seats.length > 4 ? " many" : ""}">${seats.map((x, i) => {
          if (!x.m) return '<div class="pt-seat cpu"><span>電腦</span></div>';
          const me = x.m.id === r.myId, votes = r.votes.get(x.m.id), voted = votes?.has(r.myId);
          return `<div class="pt-seat${me ? ' me' : ''}" ${me ? 'data-a="char"' : `data-who="${esc(x.m.id)}"`}><img src="${face(x.m.character)}" alt=""><b>${flagHtml(x.m)}${esc(x.m.name)}</b>
            <small class="pt-role">${me ? '點我換角色' : `${x.m.nick ? `${esc(CHARACTERS[x.m.character].name)}・` : ''}${i === 0 ? '房主' : '玩家'}`}</small>
            <small class="pt-ping" data-pid="${esc(x.m.id)}"></small>
            ${me ? '' : `<button class="chip pt-kick${voted ? ' on' : ''}" data-kick="${x.m.id}"${voted ? ' disabled' : ''}>請出 ${votes?.size ?? 0}/2</button>`}</div>`;
        }).join('')}</div>
        <div class="pt-mapline">${(src => src ? `<img src="${src}" alt="">` : '')(mapThumb(r.map))}<span>地圖</span><b>${esc(mapName(r.map))}</b></div></div>
        <div class="pt-half">${rulesHtml(r.rules, host, rtRoom(r))}
        ${host ? choiceRow('空位', [...(r.members.length < 4 ? [{ v: 4, text: '電腦補滿4人' }] : []), { v: 8, text: '電腦補滿8人' }, ...(r.rules.dropIn ? [] : [{ v: 0, text: '只有玩家' }])], fill, true, 'fill') : ''}
        ${rtMapOk(Number(r.map)) ? choiceRow('玩法', [{ v: 0, text: '回合制' }, { v: 1, text: '即時制（測試版）' }], r.rules.realtime, host, 'rt', r.rules.realtime ? ' hot on' : ' hot') : ''}
        ${rtRoom(r) ? choiceRow('對局時間', RT_LENGTHS.map((m, v) => ({ v, text: m ? `${m} 分鐘` : '無限制' })), r.rules.rtLen, host, 'rl') : choiceRow('途中加入', [{ v: 0, text: '關' }, { v: 1, text: '開（可先開始）' }], r.rules.dropIn, host, 'di', r.rules.dropIn ? ' hot on' : ' hot')}
        ${choiceRow('電腦難度', AI_LEVELS.map((text, v) => ({ v, text })), r.rules.aiLevel, host, 'ai')}
        ${extrasRow(r.rules.extras, rtRoom(r))}
        ${Number(r.map) === FINALE_MAP || rtRoom(r) ? '' : choiceRow('挑戰模式', PARTY_CHALLENGE.map((text, v) => ({ v, text })), r.rules.challenge, host, 'ch', r.rules.challenge ? ' hot on' : ' hot')}
        <p class="pt-wait">${host ? (r.members.length < 2 && !r.rules.dropIn ? '等待朋友加入…' : r.members.length < 2 ? '可以先和電腦開始，朋友之後加入會接手電腦' : `${r.members.length} 位玩家，可以開始了`) : '等待房主開始遊戲…'}</p></div>`;
      const ready = r.members.length >= 2 || (!!r.rules.dropIn && !rtRoom(r));
      acts.innerHTML = `<button class="candy ghost" data-a="home">${host ? '解散房間' : '離開房間'}</button>${host ? `<button class="candy yes" data-a="go"${ready ? '' : ' disabled'}>開始遊戲</button>` : ''}`;
      shrinkText(dyn, '.pt-seat b, .pt-seat small.pt-role', 8); // one line each, smaller where the seat is narrow
      // 追加玩法's window, when open, follows the rules (the host's switches; a guest sees them change)
      const ex = box.querySelector<HTMLElement>('.pt-ex-ov');
      if (ex) ex.innerHTML = extrasSheet(r.rules.extras, host, rtRoom(r));
    };
    /** Each seat's ping (the host's table, every heartbeat): only the small lines, so nothing else jumps. */
    const pings = () => {
      for (const el of box.querySelectorAll<HTMLElement>('.pt-ping[data-pid]')) {
        const row = r.net.find(x => x.id === el.dataset.pid);
        const g = !row ? 'none' : rowGrade(row);
        el.className = `pt-ping ${g}`;
        // Only the round trip in ms (the user 2026-11-03: no region, server or way on screen); a host without one: nothing.
        el.textContent = !row || (row.via === 'host' && !row.rtt) ? '' : `延遲 ${pingText(row)}`;
      }
    };
    r.onNet = pings;
    r.onLobby = () => {
      render(); pings(); if (r.members[0]?.id === r.myId) lobby?.announce(info(r));
      // a library map: taken and built while the room waits (its name shows once it is here)
      if (isLibKey(r.map)) void readyLibMap(r.map.slice(4)).then(() => { if (!r.started) render(); }).catch(() => {});
    };
    r.onVotes = () => render();
    r.onStatus = t => { if (t && !r.started && (r.kicked || r.refused || /滿/.test(t))) { audio.ui('error'); home(`<p class="pt-err">${esc(t).replace(/\n/g, '<br>')}</p>`); box.onclick = menu; } };
    r.onStart = (s: StartMsg) => {
      // a library map: every phone builds it first (the host's and the guests' the same copy, party-lib.ts)
      if (s.settings.libMap && !s.settings.libReady) {
        const lib = s.settings.libMap;
        show('準備地圖', '<p class="pt-lead">下載自建地圖中…</p>');
        void readyLibMap(lib).then(() => { if (s.seats[r.myId] !== undefined) libPlayed(lib); r.onStart({ ...s, settings: { ...s.settings, libReady: true } }); })
          .catch(err => { audio.ui('error'); r.close(); home(`<p class="pt-err">${esc((err as Error).message)}</p>`); box.onclick = menu; });
        return;
      }
      // reports name this phone's player as the game shows it (the character may have changed in the room)
      setReportName(r.members.find(m => m.id === r.myId)?.name ?? (myNick() || CHARACTERS[myCharacter()].name));
      // 途中加入 (the user 2026-11-03): a shared room stays in 「遊戲大廳」 while it plays, with the computers' seats
      // still to take (the host announces it); gone when none is left or the room closes.
      // 圍觀 (the user 2026-11-03): every shared room stays listed while it plays, for spectators.
      if (r.host && r.shared && lobby) {
        const l = lobby;
        const tick = () => l.announce(info(r));
        r.onSeats = tick;
        const timer = window.setInterval(tick, 8000);
        r.onClose = () => { clearInterval(timer); l.close(); };
        setTimeout(tick, 1500);
      } else lobby?.close();
      if (s.seats[r.myId] !== undefined) gameStart(`${r.code}-${s.settings.seed}`, () => r.link().via, { map: s.settings.mapId, humans: s.settings.players.filter(p => p.human).length, total: s.settings.players.length });
      lobby = null; overlay.remove(); stopCount(); inParty('game'); d.play(s.settings, r);
    };
    render(); pings();
    // Back in a game already going (issue #50): the host sent it while joining, before this screen.
    if (r.started) r.onStart(r.started);
    box.onclick = e => {
      const t = e.target as HTMLElement, a = t.closest<HTMLElement>('[data-a]')?.dataset.a, f = t.closest<HTMLElement>('[data-fill]'), k = t.closest<HTMLElement>('[data-kick]');
      const rule = t.closest<HTMLElement>('[data-rule]')?.dataset;
      if (rule && r.host) {
        audio.ui('click');
        const key = rule.rule as SetKey, n = SET_ITEMS(key).length;
        r.setRules({ [key]: (r.rules[key] + Number(rule.d) + n) % n }); // → onLobby: redrawn here, sent to everyone
        return;
      }
      const ai = t.closest<HTMLElement>('[data-ai]')?.dataset.ai;
      if (ai !== undefined && r.host) { audio.ui('click'); r.setRules({ aiLevel: Number(ai) }); return; }
      const rtv = t.closest<HTMLElement>('[data-rt]')?.dataset.rt;
      if (rtv !== undefined && r.host) { audio.ui('click'); r.setRules({ realtime: Number(rtv) }); return; }
      const rl = t.closest<HTMLElement>('[data-rl]')?.dataset.rl;
      if (rl !== undefined && r.host) { audio.ui('click'); r.setRules({ rtLen: Number(rl) }); return; }
      const di = t.closest<HTMLElement>('[data-di]')?.dataset.di;
      if (di !== undefined && r.host) { audio.ui('click'); r.setRules({ dropIn: Number(di) }); return; }
      const ex = t.closest<HTMLElement>('[data-ex]')?.dataset.ex;
      if (ex !== undefined && r.host) { audio.ui('click'); r.setRules({ extras: r.rules.extras ^ Number(ex) }); return; }
      if (a === 'extras') {
        audio.ui('click');
        const ov = document.createElement('div');
        ov.className = 'slots-overlay pt-ex-ov';
        ov.innerHTML = extrasSheet(r.rules.extras, r.members[0]?.id === r.myId, rtRoom(r));
        box.append(ov);
        return;
      }
      if (a === 'extras-close' || t.classList.contains('pt-ex-ov')) { audio.ui('no'); box.querySelector('.pt-ex-ov')?.remove(); return; }
      const ch = t.closest<HTMLElement>('[data-ch]')?.dataset.ch;
      if (ch !== undefined && r.host) { audio.ui('click'); r.setRules({ challenge: Number(ch) }); return; }
      if (k) { const id = k.dataset.kick!; void uiConfirm(`發起請出 ${r.nameOf(id)}？需要另外兩位玩家同意`, '發起').then(ok => { if (ok) r.vote(id); }); return; }
      if (f) { audio.ui('click'); fill = Number(f.dataset.fill); render(); return; }
      const who = t.closest<HTMLElement>('[data-who]')?.dataset.who;
      if (who && !k) { const m = r.members.find(x => x.id === who); if (m) { audio.ui('click'); showContact(box, m, face(m.character)); } return; }
      if (a === 'char') {
        audio.ui('click');
        const mine = r.members.find(m => m.id === r.myId)!;
        const next = r.freeCharacter((mine.character + 1) % 12, r.myId);
        keepCharacter(next);
        r.setCharacter(next, cleanNick(nick.value));
        return;
      }
      if (a === 'home') { audio.ui('no'); home(); box.onclick = menu; return; }
      if (a === 'go' && r.members[0]?.id === r.myId && (r.members.length >= 2 || (r.rules.dropIn && !rtRoom(r)))) {
        audio.ui('yes');
        const s = startMsg(r, fill, today(), (Math.random() * 2 ** 32) >>> 0);
        if (!isLibKey(r.map)) { r.start(s); return; }
        // a library map: built here first, its cards and rules into the settings, the same id on every phone
        const lib = r.map.slice(4);
        void readyLibMap(lib).then(extra => { if (!r.started) r.start({ ...s, settings: { ...s.settings, ...extra, mapId: LIB_MAP_ID, libMap: lib } }); })
          .catch(err => { audio.ui('error'); void uiAlert((err as Error).message); });
      }
    };
  }

  function join(code = '') {
    show('進入房間', `<p class="pt-lead">輸入朋友的房間碼</p>
      <input class="pt-input" inputmode="numeric" maxlength="6" pattern="[0-9]*" value="${esc(code)}" placeholder="0000">
      <div class="choices"><button class="candy ghost" data-a="home">返回</button><button class="candy yes" data-a="enter">進入</button></div>`);
    const input = box.querySelector<HTMLInputElement>('.pt-input')!;
    input.focus();
    box.onclick = async e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'home') { audio.ui('no'); home(); box.onclick = menu; return; }
      if (a === 'enter') {
        const c = input.value.trim();
        if (!/^\d{4,6}$/.test(c)) { audio.ui('error'); input.focus(); return; }
        await enter(c);
      }
    };
  }
  async function enter(code: string, watch = false) {
    audio.ui('yes');
    // 取消 (the user 2026-11-16: a slow network or a far host kept one waiting here until the try gave up)
    show(watch ? '圍觀' : '進入房間', `<p class="pt-lead">${watch ? '進入圍觀' : '連線到房間'} ${esc(code)}…</p>
      <div class="choices"><button class="candy ghost" data-a="cancel">${watch ? '不看了' : '取消'}</button></div>`);
    const r = newRoom();
    room = r;
    box.onclick = e => {
      if ((e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a !== 'cancel' || room !== r) return;
      audio.ui('no');
      r.close();
      room = null;
      if (watch) find(); else { home(); box.onclick = menu; }
    };
    try { await (watch ? r.watch(code) : r.join(code)); } catch (err) { if (room === r) { fail(err); box.onclick = menu; } return; }
    if (room !== r) { r.close(); return; }
    roomView(r);
  }

  function find() {
    show('遊戲大廳', '<p class="pt-lead">正在找想一起玩的人…</p>');
    lobby = new Lobby();
    // Rooms of another version (v0.7.4 on, party-version.ts) are listed after this version's, 「版本不同」 and not joinable.
    const render = (all: RoomInfo[]) => {
      const rooms = [...all.filter(x => sameVersion(x, PARTY_VERSION)), ...all.filter(x => !sameVersion(x, PARTY_VERSION))];
      show('遊戲大廳', `<p class="pt-online" hidden></p>
      ${rooms.length ? `<div class="pt-rooms">${rooms.map(x => {
        // a game going on: 圍觀 always, 加入 while a computer's seat is left (途中加入)
        const other = !sameVersion(x, PARTY_VERSION), full = x.playing ? !x.free : x.players >= x.max;
        const what = x.playing ? `遊戲中${x.free ? `・可接手 ${x.free} 個電腦` : ''}${x.watch ? `・${x.watch} 人圍觀` : ''}` : `${x.players}/${x.max} 人`;
        const watchBtn = x.playing && !other && !x.nowatch ? `<i class="pt-watchbtn" data-watch="${x.code}">圍觀</i>` : '';
        return `<button class="pt-room${other ? ' other' : ''}${x.playing ? ' playing' : ''}"${other || (x.playing && !x.free) ? '' : ` data-code="${x.code}"`}${other ? ' disabled' : ''}>
        <img src="${face(x.character)}" alt=""><span><b>${flagHtml(x)}${esc(x.host)} 的房間</b><small>${esc(x.map)}・${what}${other ? `・${verOf(x.ver) ? `v${esc(verOf(x.ver)!)}` : '舊版'}` : ''}</small>${roomTags(x)}</span><i class="pt-roomgo">${watchBtn}${x.playing && !x.free ? '' : `<em>${other ? '版本不同' : full ? '已滿' : '加入'}</em>`}</i></button>`;
      }).join('')}</div>`
        : '<p class="pt-lead">大廳裡現在沒有房間<br>可以自己建一個共享房間，等別人加入</p>'}
      <div class="choices"><button class="candy ghost" data-a="home">返回</button><button class="candy opt" data-a="create">建立共享房間</button></div>`);
    };
    lobby.onRooms = rooms => { if (lobby) render(rooms); };
    void lobby.start(undefined, true);
    setTimeout(() => { if (lobby && !box.querySelector('.pt-rooms, .pt-room')) render([]); }, 6000);
    box.onclick = async e => {
      const t = e.target as HTMLElement, r = t.closest<HTMLElement>('[data-code]'), a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      const w = t.closest<HTMLElement>('[data-watch]');
      if (w) { e.stopPropagation(); lobby?.close(); lobby = null; await enter(w.dataset.watch!, true); return; }
      if (r) { lobby?.close(); lobby = null; await enter(r.dataset.code!); return; }
      if (a === 'home') { audio.ui('no'); home(); box.onclick = menu; }
      if (a === 'create') { audio.ui('click'); lobby?.close(); lobby = null; create(); }
    };
  }

  const menu = (e: Event) => {
    const line = (e.target as HTMLElement).closest<HTMLElement>('[data-line]');
    if (line) {
      audio.ui('click');
      setDirectLine(line.dataset.line === '2');
      box.querySelectorAll<HTMLElement>('[data-line]').forEach(b => b.classList.toggle('on', b === line));
      return;
    }
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'back') { audio.ui('no'); leave(); d.back(); }
    if (a === 'create') { audio.ui('click'); create(); }
    if (a === 'join') { audio.ui('click'); join(); }
    if (a === 'find') { audio.ui('click'); find(); }
    if (a === 'lan') { audio.ui('click'); lanMenu(); }
    if (a === 'internet') { audio.ui('click'); useLan(''); home(); }
  };
  const LAN_KEY = 'rich4.lan.addr';
  /**
   * 局域網房間 (the user 2026-11-08: the PC hosts; phones join with the app, never a browser): the PC may open one;
   * anyone joins one with the address and the room's code the PC shows.
   */
  function lanMenu(note = '') {
    let last = '', servers: LanServer[] = [], searching = true, gone = false;
    try { last = localStorage.getItem(LAN_KEY) ?? ''; } catch { /* none */ }
    const rooms = () => servers.flatMap(sv => sv.rooms.map(code => ({ sv, code })));
    const list = () => {
      const el = box.querySelector<HTMLElement>('.pt-lanlist');
      if (!el) return;
      const rs = rooms();
      el.innerHTML = rs.length ? rs.map(({ sv, code }) => `<button class="pt-lanroom" data-lr="${esc(sv.addr)}|${code}"><b>房間 ${code}</b><small>${esc(sv.host || sv.addr)}</small></button>`).join('')
        : `<p class="pt-note">${searching ? '正在搜尋同一個 Wi-Fi 裡的房間…' : servers.length ? '找到電腦，但它還沒開房' : '沒有找到房間：確認電腦已經開了局域網房間、手機和電腦連在同一個 Wi-Fi'}</p>`;
    };
    show('局域網房間', `<p class="pt-lead">和同一個 Wi-Fi 的朋友一起玩，不用外網，外面的人進不來</p>${note}
      ${desktopLan() ? '<div class="pt-menu"><button class="candy yes" data-a="lanhost">這台電腦開房<small>朋友在 App 裡就搜得到</small></button></div><div class="pt-sec">或者加入別人的房間</div>'
        // (the user 2026-11-15: say it — a phone cannot open the room, only the PC versions can)
        : '<p class="pt-note pt-lanwho">手機不能開局域網房間：要用 <b>Windows 或 Mac 版</b>的遊戲開房，手機在這裡加入。</p>'}
      <div class="pt-lanlist"></div>
      <div class="pt-lanjoin"><input class="pt-input" name="code" placeholder="或輸入房間碼" inputmode="numeric" maxlength="8" autocomplete="off"><button class="candy yes" data-a="lancode">加入</button></div>
      <details class="pt-lanman"><summary>搜不到？手動輸入電腦上顯示的地址</summary><input class="pt-input" name="addr" placeholder="例如 192.168.1.5:8842" value="${esc(last)}" inputmode="url" autocomplete="off"></details>
      <div class="choices"><button class="candy ghost" data-a="home">返回</button><button class="candy opt" data-a="lanfind">重新搜尋</button></div>`);
    list();
    const search = () => { searching = true; servers = []; list(); void findLan().then(found => { if (!gone) { servers = found; searching = false; list(); } }); };
    search();
    const go = (addr: string, code: string) => {
      gone = true;
      try { localStorage.setItem(LAN_KEY, addr); } catch { /* not kept */ }
      useLan(addr);
      box.onclick = menu;
      void enter(code);
    };
    box.onclick = e => {
      const t = e.target as HTMLElement, a = t.closest<HTMLElement>('[data-a]')?.dataset.a, lr = t.closest<HTMLElement>('[data-lr]')?.dataset.lr;
      if (lr) { audio.ui('click'); const [addr, code] = lr.split('|'); go(addr, code); return; }
      if (a === 'home') { audio.ui('no'); gone = true; home(); box.onclick = menu; return; }
      if (a === 'lanhost') { audio.ui('click'); gone = true; void hostLan(); return; }
      if (a === 'lanfind') { audio.ui('click'); search(); return; }
      if (a !== 'lancode') return;
      const code = box.querySelector<HTMLInputElement>('[name=code]')!.value.trim();
      if (!/^\d{1,8}$/.test(code)) { audio.ui('error'); return; }
      // the code among the rooms found, else the typed address
      const hit = rooms().find(x => x.code === code);
      let addr = hit?.sv.addr ?? box.querySelector<HTMLInputElement>('[name=addr]')!.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!hit && /^[\d.]+$/.test(addr)) addr += ':8842';
      if (!hit && !/^[A-Za-z0-9.-]+:\d{2,5}$/.test(addr)) {
        audio.ui('error');
        const p = box.querySelector<HTMLElement>('.pt-lanlist .pt-note');
        if (p) p.textContent = searching ? '還在搜尋，請稍等一下再按「加入」' : `沒有找到房間 ${code}：確認房間碼，或在下面手動輸入電腦的地址`;
        (box.querySelector('.pt-lanman') as HTMLDetailsElement | null)?.setAttribute('open', '');
        return;
      }
      go(addr, code);
    };
  }
  /** 局域網房間 on the PC: its server on (the firewall may ask once), this game on it, then a room as usual. */
  async function hostLan() {
    const lan = desktopLan();
    if (!lan) return;
    show('局域網房間', '<p class="pt-lead">開啟局域網房間中…</p><p class="pt-note">如果電腦跳出防火牆提示，請選「允許」</p><div class="pt-spin"></div>');
    box.onclick = null;
    try {
      const s = await lan.start();
      if (!s.urls.length) throw new Error('這台電腦沒有連上 Wi-Fi 或區域網路\n請先連上和手機同一個 Wi-Fi');
      lanHost.urls = s.urls;
      netConfig.relays = [`ws://127.0.0.1:${s.port}`];
      netConfig.lan = true;
    } catch (err) { fail(err); box.onclick = menu; return; }
    box.onclick = menu;
    create();
  }
  // First of all: can this phone play online (party-check.ts)?
  async function check() {
    // 局域網房間: no internet to check
    if (netConfig.lan) { home(); box.onclick = menu; return; }
    show('派對模式', '<p class="pt-lead">檢查網路環境中…</p><div class="pt-spin"></div>');
    void findCountry();
    box.onclick = null;
    const r = await checkNetwork();
    if (!overlay.isConnected) return;
    if (r.ok) { home(r.note ? `<p class="pt-note">${esc(r.note).replace(/\n/g, '<br>')}</p>` : ''); box.onclick = menu; return; }
    audio.ui('error');
    show(r.title, `<p class="pt-lead">${esc(r.text).replace(/\n/g, '<br>')}</p>
      <div class="choices"><button class="candy ghost" data-a="back">返回</button>${r.retry ? '<button class="candy yes" data-a="retry">重新檢查</button>' : ''}</div>`);
    box.onclick = e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'back') { audio.ui('no'); leave(); d.back(); }
      if (a === 'retry') { audio.ui('click'); void check(); }
    };
  }
  void check();
}
