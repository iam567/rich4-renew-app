/**
 * 派對模式's chat (the user 2026-10-19: text only, quick phrases, mute someone, a kick needs two others agreeing).
 * `inline`: in the room before the game (the last lines and the input under the seats). In the game: a 💬 button on
 * the map opens the panel (history, quick phrases, input, the players with 靜音 and 請出); new lines pop up at the
 * top for a few seconds (not from someone muted).
 */
import { flagHtml, placeName } from './region-flag';
import type { MapInfo } from './assets';
import { openMapSheet } from './party-maps';
import { bars, grade, NetHud } from './party-hud';
import { ASSETS } from './assets';
import { audio } from './audio';
import { contactLabel, type ChatLine, type Room } from './party-net';
import { showContact } from './party-card';
import './party.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PHRASES = ['你好！', '快點啦～', '哈哈哈', '謝謝老闆！', '我要破產了…', '手下留情！', '再來一局！'];

/**
 * The reaction stickers (the user 2026-10-19: 「專屬的表情包」): each character's own eight (tools/tycoon-art/party_icons.py),
 * sent as a line `[s:key]` and shown as the sender's character's picture.
 */
export const STICKERS: [string, string][] = [['good', '讚'], ['laugh', '大笑'], ['cry', '大哭'], ['angry', '生氣'], ['party', '慶祝'], ['rich', '發財'], ['please', '拜託'], ['shock', '嚇到']];
const PARTY_ART = `${ASSETS}/maps/remake/party`;
const stickerOf = (t: string) => /^\[s:([a-z]+)\]$/.exec(t)?.[1];
const stickerSrc = (c: number, key: string) => `${PARTY_ART}/sticker-${c}-${key}.webp`;
const stickerImg = (c: number, key: string, cls: string) => `<img class="${cls}" src="${stickerSrc(c, key)}" alt="${esc(STICKERS.find(s => s[0] === key)?.[1] ?? '')}">`;

/**
 * 嘲諷 (the user 2026-10-22: no effect on the game, only an animation popping up on the taunted player's screen): a
 * line `[t:<target id>:<n>]` sent like a chat line (so muting the sender mutes it too). The taunted phone plays the
 * sender's character in one of four taunting poses (party_icons.py prep-taunts) with the words; the others see a
 * short line. One every 15 s from a phone.
 */
export const TAUNTS: [pose: string, text: string][] = [
  ['tongue', '略略略～追不到我吧！'], ['tongue', '你的錢包在哭泣喔～'], ['point', '就這點本事嗎？'], ['point', '下一個破產的就是你！'],
  ['yawn', '快點擲啦，我等到睡著了'], ['yawn', '認輸吧，還來得及'], ['beckon', '有種來踩我的地啊！'], ['beckon', '這條街遲早是我的！'],
];
const TAUNT_GAP = 15000;
const tauntOf = (t: string) => { const m = /^\[t:([^:\]]+):(\d+)\]$/.exec(t); return m && TAUNTS[+m[2]] ? { target: m[1], n: +m[2] } : null; };
const tauntSrc = (c: number, pose: string) => `${PARTY_ART}/taunt-${c}-${pose}.webp`;
/** The taunting picture; a character without its taunt art yet shows its 大笑 sticker. */
const tauntImg = (c: number, pose: string, cls: string) => `<img class="${cls}" src="${tauntSrc(c, pose)}" alt="" onerror="this.onerror=null;this.src='${stickerSrc(c, 'laugh')}'">`;

function lineHtml(l: ChatLine, face: (c: number) => string, nameOf: (id: string) => string = () => '對手'): string {
  if (l.character < 0) return `<div class="pc-line sys">${esc(l.text)}</div>`;
  const tt = tauntOf(l.text);
  if (tt) return `<div class="pc-line taunt"><img src="${face(l.character)}" alt=""><b>${esc(l.name)}</b><span>嘲諷 ${esc(nameOf(tt.target))}：「${esc(TAUNTS[tt.n][1])}」</span></div>`;
  const st = stickerOf(l.text);
  if (st) return `<div class="pc-line"><img src="${face(l.character)}" alt=""><b>${esc(l.name)}</b>${stickerImg(l.character, st, 'pc-stk')}</div>`;
  return `<div class="pc-line"><img src="${face(l.character)}" alt=""><b>${esc(l.name)}</b><span>${esc(l.text)}</span></div>`;
}

/** The chat inside the room screen (party.ts): the last lines, quick phrases, an input. */
export function inlineChat(room: Room, face: (c: number) => string): { el: HTMLElement; draw: () => void } {
  const el = document.createElement('div');
  el.className = 'pc-inline';
  el.innerHTML = `<div class="pc-log"></div><div class="pc-phrases">${PHRASES.slice(0, 4).map(p => `<button class="chip" data-say="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <form class="pc-form"><input maxlength="40" placeholder="說點什麼…（最多40字）"><button class="candy opt">送出</button></form>`;
  const log = el.querySelector<HTMLElement>('.pc-log')!;
  const draw = () => { log.innerHTML = room.chat.filter(l => !room.muted.has(l.from)).slice(-4).map(l => lineHtml(l, face, id => room.nameOf(id))).join('') || '<div class="pc-line sys">在這裡和大家打招呼</div>'; };
  draw();
  el.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-say]'); if (b) { e.stopPropagation(); audio.ui('click'); room.say(b.dataset.say!); } });
  el.querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); const i = el.querySelector('input')!; room.say(i.value); i.value = ''; });
  el.addEventListener('click', e => e.stopPropagation());
  return { el, draw };
}


/** 托管 from the bar (main.ts): this phone's seat handed to the computer, or back from the next turn. */
export interface AutoControl { state(): 'manual' | 'auto' | 'pending' | 'back'; toggle(): void }

type View = 'chat' | 'quick' | 'emoji' | 'taunt' | 'people' | 'votes';

/**
 * 派對模式's own row of buttons under the toolbar (the user 2026-10-19: the toolbar itself stays as it is): 💬 chat
 * (history and typing, unread count), ⚡ quick phrases, 😀 reactions, 👥 the players (region, host, online or gone,
 * mute, 請出 votes; n/m online), 🗳 the votes going on (lit while there are any), 🤖 托管 on / off. New lines pop up on
 * the map for a few seconds (not from someone muted); a reaction pops up big.
 */
export class PartyBar {
  readonly el = document.createElement('div');
  private pops = document.createElement('div');
  private panel: HTMLElement | null = null;
  private view: View | null = null;
  private unread = 0;
  /** When this phone may taunt again. */
  private tauntAt = 0;
  private tauntTarget = '';
  private hud: NetHud;

  constructor(private stage: HTMLElement, private room: Room, private face: (c: number) => string, private maps: MapInfo[], private auto: AutoControl) {
    this.el.className = 'party-bar';
    // The icons drawn like the toolbar's (party_icons.py): normal, and lit (-h) when pressed, open or on.
    const icon = (k: string, title: string, extra = '') => `<button data-v="${k}" title="${title}"><img class="pb-n" src="${PARTY_ART}/icon-${k}.webp" alt=""><img class="pb-h" src="${PARTY_ART}/icon-${k}-h.webp" alt="">${extra}</button>`;
    this.el.innerHTML = icon('chat', '聊天', '<i hidden></i>') + icon('quick', '快捷語') + icon('emoji', '表情') + icon('taunt', '嘲諷') +
      icon('people', '玩家', '<em></em>') + icon('votes', '投票', '<i hidden></i>') + icon('auto', '托管', '<em class="pb-tag"></em>') +
      `<button data-v="gift" class="pb-gift" title="送禮物"><img src="${PARTY_ART}/cheer-redpack.webp" alt=""></button>` +
      '<button data-v="net" title="延遲面板"><span class="pb-net"></span><em></em></button>' +
      // 暫離 (保留席位, the user 2026-11-03): the seat kept 10 minutes, spectators can't take it meanwhile
      '<button data-v="away" class="pb-away" title="暫離（保留席位 10 分鐘）"><b>暫離</b><em></em></button>';
    this.hud = new NetHud(stage, room, face);
    this.el.addEventListener('click', e => {
      e.stopPropagation();
      const v = (e.target as HTMLElement).closest<HTMLElement>('[data-v]')?.dataset.v;
      if (!v) return;
      audio.ui('click');
      if (v === 'auto') { this.auto.toggle(); this.refresh(); return; }
      if (v === 'gift') { this.onGift(); return; }
      if (v === 'net') { this.hud.toggle(); this.refresh(); return; }
      if (v === 'away') {
        const on = this.room.reservedTill <= Date.now();
        this.room.reserve(on);
        // 暫離 also puts this phone's seat on 托管 (the computer plays it while you are gone)
        if (on && this.auto.state() === 'manual') this.auto.toggle();
        this.refresh(); return;
      }
      this.toggle(v as View);
    });
    this.pops.className = 'pc-pops';
    stage.append(this.pops);
    room.onChat = l => this.arrive(l);
    room.onVotes = () => { this.refresh(); if (this.panel) this.draw(); };
    room.onLobby = () => { this.refresh(); if (this.panel) this.draw(); };
    room.onNet = () => { this.hud.draw(); this.refresh(); };
    room.onMapVote = () => this.drawMapVote();
    this.refresh();
    this.timer = window.setInterval(() => this.refresh(), 1000);
    this.drawMapVote();
  }
  private timer = 0;
  /** The 送禮物 button (spectate.ts PlayerGifts). */
  onGift: () => void = () => {};
  /** The banner of a 換地圖 vote going on, and what closes the sheet picking one. */
  private voteBox: HTMLElement | null = null;
  private closeSheet: () => void = () => {};

  /** The vote going on: who proposed what, and 同意 / 不同意 for a player who has not answered. */
  private drawMapVote() {
    const v = this.room.mapVote;
    if (!v) { this.voteBox?.remove(); this.voteBox = null; return; }
    if (!this.voteBox) {
      const b = document.createElement('div');
      b.className = 'pc-mapvote';
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.addEventListener('click', e => {
        e.stopPropagation();
        const y = (e.target as HTMLElement).closest<HTMLElement>('[data-yes]');
        if (!y) return;
        audio.ui(y.dataset.yes === '1' ? 'yes' : 'no');
        this.room.voteMap(y.dataset.yes === '1');
        y.parentElement!.innerHTML = '<em>等待其他人…</em>';
      });
      this.voteBox = b;
      this.stage.append(b);
    }
    const name = this.maps.find(m => m.id === v.map)?.name ?? '';
    this.voteBox.innerHTML = `<b>${esc(this.room.nameOf(v.by))} 提議換到「${esc(name)}」</b><span>${v.keep ? '保留現在的錢（土地、股票、卡片、道具清零）' : '重新開局'}・同意 ${v.yes.length}/${v.need}</span>
      <div>${v.yes.includes(this.room.myId) ? '<em>等待其他人…</em>' : '<button class="chip on" data-yes="1">同意</button><button class="chip" data-yes="0">不同意</button>'}</div>`;
  }

  /** A line of this phone's own at the top of the map for a few seconds (how a share order went). */
  pop(text: string) {
    const pop = document.createElement('div');
    pop.className = 'pc-pop';
    pop.textContent = text;
    this.pops.append(pop);
    while (this.pops.children.length > 3) this.pops.firstElementChild!.remove();
    setTimeout(() => { pop.classList.add('out'); setTimeout(() => pop.remove(), 400); }, 5000);
  }

  /** The buttons' counts and states. */
  refresh() {
    const r = this.room, q = (v: string) => this.el.querySelector<HTMLElement>(`[data-v=${v}]`)!;
    const dot = q('chat').querySelector('i')!; dot.hidden = !this.unread; dot.textContent = String(Math.min(this.unread, 9));
    const online = r.members.filter(m => !m.away).length;
    q('people').querySelector('em')!.textContent = `${online}/${r.members.length}`;
    const votes = [...r.votes.values()].filter(v => v.size).length;
    const vb = q('votes'); vb.classList.toggle('lit', votes > 0);
    const vd = vb.querySelector('i')!; vd.hidden = !votes; vd.textContent = String(votes);
    const st = this.auto.state(), ab = q('auto');
    ab.classList.toggle('lit', st !== 'manual');
    ab.title = st === 'auto' ? '取消托管' : st === 'pending' ? '托管中…' : st === 'back' ? '下回合恢復手動' : '托管';
    ab.querySelector('em')!.textContent = st === 'auto' ? '托管中' : st === 'pending' ? '等待中' : st === 'back' ? '下回合' : '';
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-v]')) b.classList.toggle('on', b.dataset.v === this.view);
    // 延遲: this phone's round trip to the host (the host: its own way to the relay), lit while the panel shows.
    const link = r.link(), nb = q('net');
    const g = link.via === 'host' ? grade(link.relay || null) : grade(link.rtt, !r.connected());
    nb.querySelector('.pb-net')!.innerHTML = bars(link.via === 'host' && !link.relay ? 'good' : g);
    nb.querySelector('em')!.textContent = !r.connected() ? '斷線' : link.via === 'host' ? '房主' : link.rtt === null ? '' : `${link.rtt}`;
    nb.classList.toggle('lit', this.hud.shown);
    const left = this.room.reservedTill - Date.now(), aw = q('away');
    aw.classList.toggle('lit', left > 0);
    aw.querySelector('em')!.textContent = left > 0 ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : '';
    aw.querySelector('b')!.textContent = left > 0 ? '保留中' : '暫離';
    // the 玩家 panel follows who watches and the switches
    const sig = `${r.allowWatch}${r.allowTake}${r.watcherList.map(w => w.id).join()}`;
    if (sig !== this.watchSig) { this.watchSig = sig; if (this.view === 'people') this.draw(); }
  }

  private arrive(l: ChatLine) {
    if (this.panel && this.view === 'chat') this.draw(); else if (l.from !== this.room.myId) this.unread++;
    this.refresh();
    if (this.room.muted.has(l.from)) return;
    const tt = tauntOf(l.text);
    if (tt && tt.target === this.room.myId) { this.taunted(l, tt.n); return; }
    if (this.panel && this.view === 'chat') return;
    const pop = document.createElement('div');
    const st = stickerOf(l.text), big = !!st;
    pop.className = `pc-pop${big ? ' big' : ''}`;
    pop.innerHTML = st ? `<b>${esc(l.name)}</b>${stickerImg(l.character, st, 'pc-stk-big')}` : lineHtml(l, this.face, id => this.room.nameOf(id));
    this.pops.append(pop);
    while (this.pops.children.length > 3) this.pops.firstElementChild!.remove();
    setTimeout(() => { pop.classList.add('out'); setTimeout(() => pop.remove(), 400); }, big ? 3000 : 5000);
  }

  /** This phone's player was taunted: the sender's character pops up big, taunting, with the words (a tap closes it). */
  private taunted(l: ChatLine, n: number) {
    const [pose, text] = TAUNTS[n];
    this.stage.querySelector('.pt-taunt')?.remove();
    const el = document.createElement('div');
    el.className = `pt-taunt ${pose}`;
    el.innerHTML = `<div class="ptt-rays"></div><div class="ptt-who"><img src="${this.face(l.character)}" alt=""><b>${esc(l.name)}</b> 嘲諷你！</div>
      ${tauntImg(l.character, pose, 'ptt-img')}<div class="ptt-say">${esc(text)}</div>`;
    el.addEventListener('pointerdown', e => { e.stopPropagation(); el.classList.add('out'); setTimeout(() => el.remove(), 300); });
    this.stage.append(el);
    this.stage.classList.remove('pt-shake'); void this.stage.offsetWidth; this.stage.classList.add('pt-shake');
    audio.ui('no');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); this.stage.classList.remove('pt-shake'); }, 3200);
  }

  private toggle(v: View) {
    if (this.view === v) { this.close(); return; }
    this.view = v;
    if (v === 'chat') this.unread = 0;
    if (!this.panel) {
      const p = document.createElement('div');
      p.addEventListener('click', e => e.stopPropagation());
      p.addEventListener('pointerdown', e => e.stopPropagation());
      this.panel = p;
      this.stage.append(p);
    }
    this.draw();
    this.refresh();
  }

  private watchSig = '';
  private close() { this.panel?.remove(); this.panel = null; this.view = null; this.refresh(); }

  private draw() {
    const p = this.panel!, r = this.room, v = this.view!;
    const small = v !== 'chat';
    p.className = `pc-panel${small ? ' small' : ''}`;
    const others = r.members.filter(m => m.id !== r.myId);
    const head = (t: string) => `<div class="pc-head"><b>${t}</b><button class="pc-x" data-a="close">✕</button></div>`;
    if (v === 'quick') p.innerHTML = `${head('快捷語')}<div class="pc-phrases big">${PHRASES.map(t => `<button class="chip" data-say="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
    else if (v === 'emoji') {
      const mine = r.members.find(m => m.id === r.myId)?.character ?? 0;
      p.innerHTML = `${head('表情')}<div class="pc-emojis">${STICKERS.map(([k, t]) => `<button data-say="[s:${k}]" title="${t}">${stickerImg(mine, k, '')}</button>`).join('')}</div>`;
    }
    else if (v === 'taunt') {
      const mine = r.members.find(m => m.id === r.myId)?.character ?? 0;
      const others = r.members.filter(m => m.id !== r.myId && !m.away);
      if (!others.some(m => m.id === this.tauntTarget)) this.tauntTarget = others[0]?.id ?? '';
      const wait = Math.ceil((this.tauntAt - Date.now()) / 1000);
      p.innerHTML = `${head('嘲諷')}${others.length ? `<div class="pc-tt-who">${others.map(m => `<button class="chip${m.id === this.tauntTarget ? ' on' : ''}" data-tt="${m.id}"><img src="${this.face(m.character)}" alt="">${esc(m.name)}</button>`).join('')}</div>
        <div class="pc-tt-lines">${TAUNTS.map(([pose, t], k) => `<button class="chip" data-taunt="${k}"${wait > 0 ? ' disabled' : ''}>${tauntImg(mine, pose, 'pc-tt-img')}<span>${esc(t)}</span></button>`).join('')}</div>
        <p class="pc-note">${wait > 0 ? `${wait} 秒後可以再嘲諷` : '選一位對手和一句話：對方畫面上會跳出你的嘲諷動畫（不影響遊戲）'}</p>` : '<p class="pc-note">沒有在線的對手</p>'}`;
      if (wait > 0) setTimeout(() => { if (this.view === 'taunt') this.draw(); }, Math.min(wait, 1) * 1000);
    }
    else if (v === 'chat') {
      p.innerHTML = `${head('聊天')}<div class="pc-log">${r.chat.filter(l => !r.muted.has(l.from)).slice(-40).map(l => lineHtml(l, this.face, id => r.nameOf(id))).join('') || '<div class="pc-line sys">還沒有訊息</div>'}</div>
        <div class="pc-phrases">${PHRASES.map(t => `<button class="chip" data-say="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <form class="pc-form"><input maxlength="40" placeholder="說點什麼…（最多40字）"><button class="candy opt">送出</button></form>`;
      const log = p.querySelector<HTMLElement>('.pc-log')!; log.scrollTop = log.scrollHeight;
      p.querySelector('form')!.onsubmit = e => { e.preventDefault(); const i = p.querySelector('input')!; r.say(i.value); i.value = ''; };
    } else if (v === 'people') {
      p.innerHTML = `${head(`玩家（${r.members.filter(m => !m.away).length}/${r.members.length} 在線）`)}<div class="pc-people">${r.members.map(m => {
        const me = m.id === r.myId, votes = r.votes.get(m.id)?.size ?? 0, isHost = m.id === r.members[0]?.id, voted = r.votes.get(m.id)?.has(r.myId);
        return `<div class="pc-person${m.away ? ' away' : ''}"><img src="${this.face(m.character)}" alt="" data-who="${esc(m.id)}"><b><i class="pc-dot${m.away ? ' off' : ''}"></i>${flagHtml(m)}${esc(m.name)}${me ? '<small>你</small>' : ''}${isHost ? '<small>房主</small>' : ''}${placeName(m) ? `<small>${esc(placeName(m))}</small>` : ''}${m.away ? '<small>斷線中</small>' : ''}${m.contact ? `<small class="pc-contact" data-who="${esc(m.id)}">${esc(contactLabel(m.contact))}</small>` : ''}</b>
          ${me ? '<span></span><span></span>' : `<button class="chip${r.muted.has(m.id) ? ' on' : ''}" data-mute="${m.id}">${r.muted.has(m.id) ? '已靜音' : '靜音'}</button>
          ${r.protectedId(m.id) ? '<button class="chip" disabled>首富・不能請出</button>' : `<button class="chip${voted ? ' on' : ''}" data-kick="${m.id}"${voted ? ' disabled' : ''}>請出 ${votes}/2</button>`}`}</div>`;
      }).join('')}</div><p class="pc-note">請出某人（房主也可以）需要另外兩位玩家同意；總資產最多的玩家不能被請出。被請出的人由電腦接手繼續玩（土地不拍賣），房主走了由下一位接任</p>
      <div class="pc-watch"><button class="chip${r.allowWatch ? ' on' : ''}" data-ws="watch">圍觀：${r.allowWatch ? '開放' : '關閉'}</button><button class="chip${r.allowTake ? ' on' : ''}" data-ws="take">接手：${r.allowTake ? '允許' : '不允許'}</button></div>
      ${r.watcherList.length ? `<div class="pc-watchers">${r.watcherList.map(w => `<div><b>${flagHtml(w)}${esc(w.name)}<small>觀眾</small></b><button class="chip" data-out="${esc(w.id)}">請離開</button></div>`).join('')}</div>` : ''}`;
    } else {
      const list = [...r.votes.entries()].filter(([, s]) => s.size);
      p.innerHTML = `${head('投票')}${list.length ? `<div class="pc-votes">${list.map(([target, s]) => {
        const voted = s.has(r.myId), mine = target === r.myId;
        return `<div class="pc-vote"><b>請出 ${esc(r.nameOf(target))}</b><span>${s.size}/2 票・${[...s].map(id => esc(r.nameOf(id))).join('、')}</span>
          ${mine ? '<em>大家在投你</em>' : r.protectedId(target) ? '<em>首富・不能請出</em>' : `<button class="chip${voted ? ' on' : ''}" data-kick="${target}"${voted ? ' disabled' : ''}>${voted ? '已投票' : '我也同意'}</button>`}</div>`;
      }).join('')}</div>` : '<p class="pc-note">現在沒有進行中的投票</p>'}<p class="pc-note">要發起請出，請到「玩家」按「請出」</p><div class="pc-watch"><button class="chip" data-a="mappick">提議換地圖</button></div>`;
      void others;
    }
    p.onclick = e => {
      e.stopPropagation();
      const t = e.target as HTMLElement;
      const say = t.closest<HTMLElement>('[data-say]'), mute = t.closest<HTMLElement>('[data-mute]'), kick = t.closest<HTMLElement>('[data-kick]');
      if (t.closest('[data-a=close]')) { audio.ui('no'); this.close(); return; }
      const who = t.closest<HTMLElement>('[data-who]')?.dataset.who;
      if (who) { const m = r.members.find(x => x.id === who); if (m) { audio.ui('click'); showContact(this.stage, m, this.face(m.character)); } return; }
      if (t.closest('[data-a=mappick]')) {
        audio.ui('click'); this.close();
        this.closeSheet = openMapSheet(document.body, this.maps, Number(r.map), (map, keep) => r.proposeMap(map, keep));
        return;
      }
      const ws = t.closest<HTMLElement>('[data-ws]'), out = t.closest<HTMLElement>('[data-out]');
      if (ws) { audio.ui('click'); r.setWatch(ws.dataset.ws === 'watch' ? { watch: !r.allowWatch } : { take: !r.allowTake }); return; }
      if (out && confirm('請這位觀眾離開？這局他不能再回來圍觀')) { audio.ui('click'); r.sendAway(out.dataset.out!); return; }
      if (say) { audio.ui('click'); r.say(say.dataset.say!); if (v === 'quick' || v === 'emoji') this.close(); return; }
      if (mute) { audio.ui('click'); r.toggleMute(mute.dataset.mute!); this.draw(); return; }
      const tt = t.closest<HTMLElement>('[data-tt]'), taunt = t.closest<HTMLButtonElement>('[data-taunt]');
      if (tt) { audio.ui('click'); this.tauntTarget = tt.dataset.tt!; this.draw(); return; }
      if (taunt && !taunt.disabled && this.tauntTarget && Date.now() >= this.tauntAt) {
        audio.ui('click'); this.tauntAt = Date.now() + TAUNT_GAP;
        r.say(`[t:${this.tauntTarget}:${taunt.dataset.taunt}]`); this.close(); return;
      }
      if (kick && confirm(`發起請出 ${r.nameOf(kick.dataset.kick!)}？需要另外兩位玩家同意`)) { audio.ui('click'); r.vote(kick.dataset.kick!); }
    };
  }

  /** The 延遲 panel is shown (the heads' ping tags go with it). */
  get netShown(): boolean { return this.hud.shown; }

  destroy() { this.closeSheet(); clearInterval(this.timer); this.el.remove(); this.pops.remove(); this.panel?.remove(); this.voteBox?.remove(); this.hud.destroy(); }
}
