/**
 * 派對模式's screens (v0.5.0, the user 2026-10-19): 「建立房間」 (私享: a room code for friends; 共享: also listed in
 * 「尋找夥伴」), 「進入房間」 (type the code), 「尋找夥伴」 (the shared rooms). The room shows its code, the players
 * (tap your face to change character), the map, computers to fill up to four, and the host's 「開始遊戲」. The game
 * itself runs in main.ts with the room (party-net.ts: lockstep answers).
 */
import { CHARACTERS } from '../core/characters';
import { today } from '../core/date';
import type { GameSettings } from '../core/types';
import type { MapInfo } from './assets';
import { audio } from './audio';
import { Lobby, Room, type RoomInfo, type StartMsg } from './party-net';
import type { SpriteBank } from './sprites';
import './party.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const KEY = 'rich4.party.character';
const myCharacter = () => { try { const v = Number(localStorage.getItem(KEY)); return v >= 0 && v < 12 ? v : 9; } catch { return 9; } };
const keepCharacter = (c: number) => { try { localStorage.setItem(KEY, String(c)); } catch { /* not kept */ } };

export interface PartyDeps {
  app: HTMLElement; bank: SpriteBank; maps: MapInfo[];
  /** Starts the game with the room (main.ts). */
  play: (settings: GameSettings, room: Room) => void;
  back: () => void;
}

export function openParty(d: PartyDeps): void {
  const face = (c: number) => d.bank.art('Data', 2, c)?.src ?? '';
  const maps = d.maps.filter(m => !m.hidden && (m.kind === 'orig' || m.kind === 'custom'));
  const overlay = document.createElement('div');
  overlay.className = 'slots-overlay pt-ov';
  const box = document.createElement('div');
  box.className = 'msg sheet pt';
  overlay.append(box);
  d.app.append(overlay);
  let lobby: Lobby | null = null, room: Room | null = null;
  const leave = () => { lobby?.close(); lobby = null; if (room && !room.started) room.close(); room = null; overlay.remove(); };
  const show = (title: string, html: string) => { box.innerHTML = `<div class="ribbon">${esc(title)}</div>${html}`; };
  const fail = (e: unknown) => { audio.ui('error'); home(`<p class="pt-err">${esc((e as Error)?.message ?? '連線失敗')}</p>`); };

  function home(note = '') {
    lobby?.close(); lobby = null; room?.close(); room = null;
    show('派對模式', `<p class="pt-lead">和朋友各用自己的手機，一起玩同一局</p>${note}
      <div class="pt-menu">
        <button class="candy yes" data-a="create">建立房間<small>私享房間碼，或公開找夥伴</small></button>
        <button class="candy opt" data-a="join">進入房間<small>輸入朋友的房間碼</small></button>
        <button class="candy opt" data-a="find">尋找夥伴<small>加入想找人一起玩的房間</small></button>
      </div>
      <div class="choices"><button class="candy ghost" data-a="back">返回</button></div>`);
  }

  function create() {
    let shared = false, map = maps[0]?.id ?? 0;
    const render = () => show('建立房間', `
      <div class="pt-row"><b>房間</b><div class="chips"><button class="chip${shared ? '' : ' on'}" data-shared="0">私享（房間碼）</button><button class="chip${shared ? ' on' : ''}" data-shared="1">共享（公開找夥伴）</button></div></div>
      <div class="pt-row"><b>地圖</b><div class="chips pt-maps">${maps.map(m => `<button class="chip${m.id === map ? ' on' : ''}" data-map="${m.id}">${esc(m.name)}</button>`).join('')}</div></div>
      <div class="choices"><button class="candy ghost" data-a="home">返回</button><button class="candy yes" data-a="open">建立</button></div>`);
    render();
    box.onclick = async e => {
      const t = e.target as HTMLElement;
      const s = t.closest<HTMLElement>('[data-shared]'), mp = t.closest<HTMLElement>('[data-map]'), a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (s) { audio.ui('click'); shared = s.dataset.shared === '1'; render(); return; }
      if (mp) { audio.ui('click'); map = Number(mp.dataset.map); render(); return; }
      if (a === 'home') { audio.ui('no'); home(); box.onclick = menu; return; }
      if (a === 'open') {
        audio.ui('yes');
        show('建立房間', '<p class="pt-lead">建立房間中…</p>');
        const r = new Room({ name: CHARACTERS[myCharacter()].name, character: myCharacter() });
        room = r;
        try { await r.create(String(map), shared); } catch (err) { fail(err); box.onclick = menu; return; }
        if (shared) { lobby = new Lobby(); void lobby.start(info(r)); }
        roomView(r);
      }
    };
  }
  const mapName = (id: string) => maps.find(m => String(m.id) === id)?.name ?? '';
  const info = (r: Room): RoomInfo => ({ code: r.code, host: r.members[0]?.name ?? '', character: r.members[0]?.character ?? 0, map: mapName(r.map), players: r.members.length, max: 4, at: Date.now() });

  function roomView(r: Room) {
    let fill = true;
    const render = () => {
      if (!r.code) return;
      const seats = [...r.members.map(m => ({ m, cpu: false })), ...(fill ? Array.from({ length: Math.max(0, 4 - r.members.length) }, () => ({ m: null, cpu: true })) : [])];
      show(r.shared ? '共享房間' : '私享房間', `
        <div class="pt-code"><small>房間碼</small><b>${r.code}</b>${r.shared ? '<em>已公開在「尋找夥伴」</em>' : '<em>把房間碼告訴朋友</em>'}</div>
        <div class="pt-seats">${seats.map(x => x.m
          ? `<div class="pt-seat${x.m.id === r.myId ? ' me' : ''}" ${x.m.id === r.myId ? 'data-a="char"' : ''}><img src="${face(x.m.character)}" alt=""><b>${esc(CHARACTERS[x.m.character].name)}</b><small>${x.m.id === r.myId ? '你・點我換角色' : '玩家'}</small></div>`
          : '<div class="pt-seat cpu"><span>電腦</span></div>').join('')}</div>
        <div class="pt-row"><b>地圖</b><span class="pt-map">${esc(mapName(r.map))}</span></div>
        ${r.host ? `<div class="pt-row"><b>空位</b><div class="chips"><button class="chip${fill ? ' on' : ''}" data-fill="1">電腦補滿4人</button><button class="chip${fill ? '' : ' on'}" data-fill="0">只有玩家</button></div></div>` : ''}
        <p class="pt-wait">${r.host ? (r.members.length < 2 ? '等待朋友加入…' : `${r.members.length} 位玩家，可以開始了`) : '等待房主開始遊戲…'}</p>
        <div class="choices"><button class="candy ghost" data-a="home">${r.host ? '解散房間' : '離開房間'}</button>${r.host ? `<button class="candy yes" data-a="go"${r.members.length < 2 ? ' disabled' : ''}>開始遊戲</button>` : ''}</div>`);
    };
    r.onLobby = () => { render(); lobby?.announce(info(r)); };
    r.onStatus = t => { if (t && !r.started) { audio.ui('error'); home(`<p class="pt-err">${esc(t)}</p>`); box.onclick = menu; } };
    r.onStart = (s: StartMsg) => { lobby?.close(); lobby = null; overlay.remove(); d.play(s.settings, r); };
    render();
    box.onclick = e => {
      const t = e.target as HTMLElement, a = t.closest<HTMLElement>('[data-a]')?.dataset.a, f = t.closest<HTMLElement>('[data-fill]');
      if (f) { audio.ui('click'); fill = f.dataset.fill === '1'; render(); return; }
      if (a === 'char') {
        audio.ui('click');
        const mine = r.members.find(m => m.id === r.myId)!;
        const next = r.freeCharacter((mine.character + 1) % 12, r.myId);
        keepCharacter(next);
        r.setCharacter(next);
        return;
      }
      if (a === 'home') { audio.ui('no'); home(); box.onclick = menu; return; }
      if (a === 'go' && r.host && r.members.length >= 2) {
        audio.ui('yes');
        const used = new Set(r.members.map(m => m.character));
        const cpus = fill ? [0, 4, 3, 1, 2, 5, 6, 7, 8, 10, 11, 9].filter(c => !used.has(c)).slice(0, Math.max(0, 4 - r.members.length)) : [];
        const players = [...r.members.map(m => ({ character: m.character, human: true })), ...cpus.map(c => ({ character: c, human: false }))];
        const settings: GameSettings = { mapId: Number(r.map), players, fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: today(), seed: (Math.random() * 2 ** 32) >>> 0 };
        r.start({ settings, seats: Object.fromEntries(r.members.map((m, i) => [m.id, i])) });
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
    const r = new Room({ name: CHARACTERS[myCharacter()].name, character: myCharacter() });
    room = r;
    try { await r.join(code); } catch (err) { fail(err); box.onclick = menu; return; }
    roomView(r);
  }

  function find() {
    show('尋找夥伴', '<p class="pt-lead">正在找想一起玩的人…</p>');
    lobby = new Lobby();
    const render = (rooms: RoomInfo[]) => show('尋找夥伴', `
      ${rooms.length ? `<div class="pt-rooms">${rooms.map(x => `<button class="pt-room" data-code="${x.code}"${x.players >= x.max ? ' disabled' : ''}>
        <img src="${face(x.character)}" alt=""><span><b>${esc(x.host)} 的房間</b><small>${esc(x.map)}・${x.players}/${x.max} 人</small></span><em>${x.players >= x.max ? '已滿' : '加入'}</em></button>`).join('')}</div>`
        : '<p class="pt-lead">目前沒有人在找夥伴<br>可以自己建一個共享房間，等別人加入</p>'}
      <div class="choices"><button class="candy ghost" data-a="home">返回</button><button class="candy opt" data-a="create">建立共享房間</button></div>`);
    lobby.onRooms = rooms => { if (lobby) render(rooms); };
    void lobby.start();
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
  home();
  box.onclick = menu;
}
