/**
 * 派對模式's screens (v0.5.0, the user 2026-10-19): 「建立房間」 (私享: a room code for friends; 共享: also listed in
 * 「尋找夥伴」), 「進入房間」 (type the code), 「尋找夥伴」 (the shared rooms). The room shows its code, the players
 * (tap your face to change character), the map, computers to fill up to four or eight (at most eight players), and the host's 「開始遊戲」. The game
 * itself runs in main.ts with the room (party-net.ts: lockstep answers).
 */
import { CHARACTERS } from '../core/characters';
import { today } from '../core/date';
import type { GameSettings } from '../core/types';
import type { MapInfo } from './assets';
import { audio } from './audio';
import { AI_LEVELS, cleanNick, Lobby, myRegion, NICK_MAX, PARTY_VERSION, Room, ROOM_MAX, startMsg, TURN_SECONDS, type PartyRules, type RoomInfo, type StartMsg } from './party-net';
import { pingText, rowGrade } from './party-hud';
import { headLine, inParty, lastHeadCount, onHeadCount, type HeadCount } from './party-presence';
import { setReportName, watchErrors } from './party-report';
import { RULE_ITEMS, RULE_LABELS } from './rule-options';
import { sameVersion, verOf } from './party-version';
import { inlineChat } from './party-chat';
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
const keepNick = (s: string) => { try { localStorage.setItem(NICK_KEY, s); } catch { /* not kept */ } };
const newRoom = () => new Room({ name: myNick() || CHARACTERS[myCharacter()].name, character: myCharacter(), region: myRegion(), nick: myNick() || undefined });

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
function rulesHtml(rules: PartyRules, host: boolean): string {
  return `<div class="pt-tiles">${SET_KEYS.map(k => {
    const v = SET_ITEMS(k)[rules[k]];
    // .pt-tin: laid out by the tile's own width (party.css): one line where it fits, else the label above.
    return `<div class="pt-tile"><div class="pt-tin"><span>${SET_LABEL(k)}</span>${host
      ? `<div class="pt-step"><button data-rule="${k}" data-d="-1" aria-label="上一個">‹</button><b>${v}</b><button data-rule="${k}" data-d="1" aria-label="下一個">›</button></div>`
      : `<b>${v}</b>`}</div></div>`;
  }).join('')}</div>`;
}
/** A row of choices (空位, 電腦難度): chips for the host, the value for everyone else. */
function choiceRow(label: string, items: { v: number; text: string }[], on: number, host: boolean, attr: string): string {
  return `<div class="pt-choice"><div class="pt-cin"><span>${label}</span>${host
    ? `<div class="pt-seg">${items.map(x => `<button class="${x.v === on ? 'on' : ''}" data-${attr}="${x.v}">${x.text}</button>`).join('')}</div>`
    : `<b>${items.find(x => x.v === on)?.text ?? ''}</b>`}</div></div>`;
}

/** A listed room's 等待時間 and 電腦難度 as tags (a quick room in yellow, 地獄 in red); none from an older host. */
function roomTags(x: RoomInfo): string {
  const t = Number.isFinite(x.turn) ? Math.trunc(x.turn as number) : 0, ai = Number.isInteger(x.ai) ? (x.ai as number) : -1;
  if (!t && ai < 0) return '';
  return `<i class="pt-rtags">${t ? `<i class="pt-rtag${t <= 20 ? ' quick' : ''}">每步 ${t} 秒</i>` : ''}${ai >= 0 && AI_LEVELS[ai] ? `<i class="pt-rtag${ai === 3 ? ' hell' : ''}">電腦${AI_LEVELS[ai]}</i>` : ''}</i>`;
}

/** The maps as picture cards, a page at a time (the user 2026-11-03: the name buttons were a jumble). */
const MAP_PAGE = 6;
function mapCards(maps: MapInfo[], selected: number, page: number): string {
  const pages = Math.max(1, Math.ceil(maps.length / MAP_PAGE)), pg = Math.min(page, pages - 1);
  return `<div class="pt-mgrid">${maps.slice(pg * MAP_PAGE, pg * MAP_PAGE + MAP_PAGE).map(m => `<button class="pt-mcard${m.id === selected ? ' on' : ''}" data-map="${m.id}">
      <img src="${m.thumbnail}" alt="" loading="lazy"><span>${esc(shortName(m.name))}</span></button>`).join('')}</div>
    <div class="pt-pager"><button data-mp="-1"${pg === 0 ? ' disabled' : ''} aria-label="上一頁">‹</button><span>${pg + 1} / ${pages}</span><button data-mp="1"${pg >= pages - 1 ? ' disabled' : ''} aria-label="下一頁">›</button></div>`;
}
/** 「地圖05・星座主題」 → 「星座主題」 (the number says nothing on a picture card). */
const shortName = (n: string) => n.replace(/^地[圖图]\s*\d+\s*[・·•‧]\s*/, '');

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
  const counted = (n: HeadCount | null) => { if (n) for (const el of box.querySelectorAll<HTMLElement>('.pt-online')) { el.hidden = false; el.textContent = `派對模式現在 ${headLine(n)}`; } };
  const stopCount = onHeadCount(counted);
  const show = (title: string, html: string) => { box.classList.remove('pt-roomv'); box.innerHTML = `<div class="ribbon">${esc(title)}</div>${html}`; counted(lastHeadCount()); };
  const fail = (e: unknown) => { audio.ui('error'); home(`<p class="pt-err">${esc((e as Error)?.message ?? '連線失敗').replace(/\n/g, '<br>')}</p>`); };

  function home(note = '') {
    lobby?.close(); lobby = null; room?.close(); room = null;
    inParty('menu');
    show('派對模式', `<p class="pt-lead">和朋友各用自己的手機，一起玩同一局</p><p class="pt-online" hidden></p>${note}
      <div class="pt-menu">
        <button class="candy yes" data-a="create">建立房間<small>私享房間碼，或公開到遊戲大廳</small></button>
        <button class="candy opt" data-a="join">進入房間<small>輸入朋友的房間碼</small></button>
        <button class="candy opt" data-a="find">遊戲大廳<small>看看大家開的房間，加入一起玩</small></button>
      </div>
      <div class="choices"><button class="candy ghost" data-a="back">返回</button></div>`);
  }

  function create() {
    let shared = false, map = maps[0]?.id ?? 0, page = 0;
    const render = () => show('建立房間', `
      <div class="pt-types">
        <button class="pt-type${shared ? '' : ' on'}" data-shared="0"><b>私享房間</b><small>憑房間碼才能進來</small></button>
        <button class="pt-type${shared ? ' on' : ''}" data-shared="1"><b>公開房間</b><small>大家都能從大廳加入</small></button>
      </div>
      <div class="pt-sec">選擇地圖</div>
      ${mapCards(maps, map, page)}
      <div class="choices"><button class="candy ghost" data-a="home">返回</button><button class="candy yes" data-a="open">建立房間</button></div>`);
    // both kinds side by side even on a 320 px phone: their words shrink to the card
    const draw = () => { render(); shrinkText(box, '.pt-type b, .pt-type small', 8); };
    draw();
    box.onclick = async e => {
      const t = e.target as HTMLElement;
      const s2 = t.closest<HTMLElement>('[data-shared]'), mp = t.closest<HTMLElement>('[data-map]'), pg = t.closest<HTMLElement>('[data-mp]'), a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (s2) { audio.ui('click'); shared = s2.dataset.shared === '1'; draw(); return; }
      if (mp) { audio.ui('click'); map = Number(mp.dataset.map); draw(); return; }
      if (pg && !(pg as HTMLButtonElement).disabled) { audio.ui('click'); page = Math.max(0, page + Number(pg.dataset.mp)); draw(); return; }
      if (a === 'home') { audio.ui('no'); home(); box.onclick = menu; return; }
      if (a === 'open') {
        audio.ui('yes');
        show('建立房間', '<p class="pt-lead">建立房間中…</p>');
        const r = newRoom();
        room = r;
        try { await r.create(String(map), shared); } catch (err) { fail(err); box.onclick = menu; return; }
        // Every open room is in the list: a shared one to join, a private one only counted (the title's figures).
        lobby = new Lobby(); void lobby.start(info(r));
        roomView(r);
      }
    };
  }
  const mapName = (id: string) => maps.find(m => String(m.id) === id)?.name ?? '';
  /** A private room's token in the list (never its code). */
  const token = `p-${Math.random().toString(36).slice(2, 10)}`;
  const info = (r: Room): RoomInfo => r.shared ? infoShared(r) : { ...infoShared(r), code: token, host: '', map: '', private: true };
  const infoShared = (r: Room): RoomInfo => ({ code: r.code, host: r.members[0]?.name ?? '', character: r.members[0]?.character ?? 0, map: mapName(r.map), players: r.members.length, max: ROOM_MAX, at: Date.now(), region: r.members[0]?.region, ...(r.ver ? { ver: r.ver } : {}),
    turn: TURN_SECONDS[r.rules.turnSec], ai: r.rules.aiLevel });

  function roomView(r: Room) {
    inParty('room');
    /** Computers up to this many players (4 or 8), or 0: players only. */
    let fill = 4;
    show(r.shared ? '共享房間' : '私享房間', `<div class="pt-dyn"></div>
      <div class="pt-row pt-me"><b>名字</b><input class="pt-nick" maxlength="${NICK_MAX}" enterkeyhint="done" value="${esc(myNick())}"></div>
      <p class="pt-hint">可以自己取名（最多 ${NICK_MAX} 字），遊戲中大家看到的就是這個名字</p>
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
    const chat = inlineChat(r, face);
    box.querySelector('.pt-chat')!.append(chat.el);
    r.onChat = () => chat.draw();
    const render = () => {
      const dyn = box.querySelector('.pt-dyn'), acts = box.querySelector('.pt-acts');
      if (!r.code || !dyn || !acts) return;
      const host = r.members[0]?.id === r.myId;
      const mine = r.members.find(m => m.id === r.myId);
      if (mine) nick.placeholder = CHARACTERS[mine.character].name;
      if (fill && fill <= r.members.length) fill = fill === 4 ? 0 : fill; // 補滿4人 with four players already: players only
      const seats = [...r.members.map(m => ({ m, cpu: false })), ...(fill ? Array.from({ length: Math.max(0, fill - r.members.length) }, () => ({ m: null, cpu: true })) : [])];
      // Two halves (side by side on a landscape phone, one under the other otherwise): who and where / the settings.
      dyn.innerHTML = `<div class="pt-half">
        <div class="pt-code"><small>房間碼</small><b>${r.code}</b>${r.shared ? '<em>已公開在「遊戲大廳」</em>' : '<em>把房間碼告訴朋友</em>'}</div>
        <div class="pt-seats${seats.length > 4 ? " many" : ""}">${seats.map((x, i) => {
          if (!x.m) return '<div class="pt-seat cpu"><span>電腦</span></div>';
          const me = x.m.id === r.myId, votes = r.votes.get(x.m.id), voted = votes?.has(r.myId);
          return `<div class="pt-seat${me ? ' me' : ''}" ${me ? 'data-a="char"' : ''}><img src="${face(x.m.character)}" alt=""><b>${esc(x.m.name)}</b>
            <small class="pt-role">${me ? '點我換角色' : `${x.m.nick ? `${esc(CHARACTERS[x.m.character].name)}・` : ''}${i === 0 ? '房主' : '玩家'}`}</small>
            <small class="pt-ping" data-pid="${esc(x.m.id)}"></small>
            ${me ? '' : `<button class="chip pt-kick${voted ? ' on' : ''}" data-kick="${x.m.id}"${voted ? ' disabled' : ''}>請出 ${votes?.size ?? 0}/2</button>`}</div>`;
        }).join('')}</div>
        <div class="pt-mapline">${(m => m ? `<img src="${m.thumbnail}" alt="">` : '')(maps.find(m => String(m.id) === r.map))}<span>地圖</span><b>${esc(mapName(r.map))}</b></div></div>
        <div class="pt-half">${rulesHtml(r.rules, host)}
        ${host ? choiceRow('空位', [...(r.members.length < 4 ? [{ v: 4, text: '電腦補滿4人' }] : []), { v: 8, text: '電腦補滿8人' }, { v: 0, text: '只有玩家' }], fill, true, 'fill') : ''}
        ${choiceRow('電腦難度', AI_LEVELS.map((text, v) => ({ v, text })), r.rules.aiLevel, host, 'ai')}
        <p class="pt-wait">${host ? (r.members.length < 2 ? '等待朋友加入…' : `${r.members.length} 位玩家，可以開始了`) : '等待房主開始遊戲…'}</p></div>`;
      acts.innerHTML = `<button class="candy ghost" data-a="home">${host ? '解散房間' : '離開房間'}</button>${host ? `<button class="candy yes" data-a="go"${r.members.length < 2 ? ' disabled' : ''}>開始遊戲</button>` : ''}`;
      shrinkText(dyn, '.pt-seat b, .pt-seat small.pt-role', 8); // one line each, smaller where the seat is narrow
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
    r.onLobby = () => { render(); pings(); if (r.members[0]?.id === r.myId) lobby?.announce(info(r)); };
    r.onVotes = () => render();
    r.onStatus = t => { if (t && !r.started && (r.kicked || r.refused || /滿/.test(t))) { audio.ui('error'); home(`<p class="pt-err">${esc(t).replace(/\n/g, '<br>')}</p>`); box.onclick = menu; } };
    r.onStart = (s: StartMsg) => { lobby?.close(); lobby = null; overlay.remove(); stopCount(); inParty('game'); d.play(s.settings, r); };
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
      if (k) { if (confirm(`發起請出 ${r.nameOf(k.dataset.kick!)}？需要另外兩位玩家同意`)) { audio.ui('click'); r.vote(k.dataset.kick!); } return; }
      if (f) { audio.ui('click'); fill = Number(f.dataset.fill); render(); return; }
      if (a === 'char') {
        audio.ui('click');
        const mine = r.members.find(m => m.id === r.myId)!;
        const next = r.freeCharacter((mine.character + 1) % 12, r.myId);
        keepCharacter(next);
        r.setCharacter(next, cleanNick(nick.value));
        return;
      }
      if (a === 'home') { audio.ui('no'); home(); box.onclick = menu; return; }
      if (a === 'go' && r.members[0]?.id === r.myId && r.members.length >= 2) {
        audio.ui('yes');
        r.start(startMsg(r, fill, today(), (Math.random() * 2 ** 32) >>> 0));
      }
    };
  }

  function join(code = '') {
    show('進入房間', `<p class="pt-lead">輸入朋友的 4 位數房間碼</p>
      <input class="pt-input" inputmode="numeric" maxlength="4" pattern="[0-9]*" value="${esc(code)}" placeholder="0000">
      <div class="choices"><button class="candy ghost" data-a="home">返回</button><button class="candy yes" data-a="enter">進入</button></div>`);
    const input = box.querySelector<HTMLInputElement>('.pt-input')!;
    input.focus();
    box.onclick = async e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'home') { audio.ui('no'); home(); box.onclick = menu; return; }
      if (a === 'enter') {
        const c = input.value.trim();
        if (!/^\d{4}$/.test(c)) { audio.ui('error'); input.focus(); return; }
        await enter(c);
      }
    };
  }
  async function enter(code: string) {
    audio.ui('yes');
    show('進入房間', `<p class="pt-lead">連線到房間 ${esc(code)}…</p>`);
    const r = newRoom();
    room = r;
    try { await r.join(code); } catch (err) { fail(err); box.onclick = menu; return; }
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
        const other = !sameVersion(x, PARTY_VERSION), full = x.players >= x.max;
        return `<button class="pt-room${other ? ' other' : ''}"${other ? '' : ` data-code="${x.code}"`}${full || other ? ' disabled' : ''}>
        <img src="${face(x.character)}" alt=""><span><b>${esc(x.host)} 的房間</b><small>${esc(x.map)}・${x.players}/${x.max} 人${other ? `・${verOf(x.ver) ? `v${esc(verOf(x.ver)!)}` : '舊版'}` : ''}</small>${roomTags(x)}</span><em>${other ? '版本不同' : full ? '已滿' : '加入'}</em></button>`;
      }).join('')}</div>`
        : '<p class="pt-lead">大廳裡現在沒有房間<br>可以自己建一個共享房間，等別人加入</p>'}
      <div class="choices"><button class="candy ghost" data-a="home">返回</button><button class="candy opt" data-a="create">建立共享房間</button></div>`);
    };
    lobby.onRooms = rooms => { if (lobby) render(rooms); };
    void lobby.start(undefined, true);
    setTimeout(() => { if (lobby && !box.querySelector('.pt-rooms, .pt-room')) render([]); }, 6000);
    box.onclick = async e => {
      const t = e.target as HTMLElement, r = t.closest<HTMLElement>('[data-code]'), a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (r) { lobby?.close(); lobby = null; await enter(r.dataset.code!); return; }
      if (a === 'home') { audio.ui('no'); home(); box.onclick = menu; }
      if (a === 'create') { audio.ui('click'); lobby?.close(); lobby = null; create(); }
    };
  }

  const menu = (e: Event) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'back') { audio.ui('no'); leave(); d.back(); }
    if (a === 'create') { audio.ui('click'); create(); }
    if (a === 'join') { audio.ui('click'); join(); }
    if (a === 'find') { audio.ui('click'); find(); }
  };
  // First of all: can this phone play online (party-check.ts)?
  async function check() {
    show('派對模式', '<p class="pt-lead">檢查網路環境中…</p><div class="pt-spin"></div>');
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
