/**
 * 派對模式's chat (the user 2026-10-19: text only, quick phrases, mute someone, a kick needs two others agreeing).
 * `inline`: in the room before the game (the last lines and the input under the seats). In the game: a 💬 button on
 * the map opens the panel (history, quick phrases, input, the players with 靜音 and 請出); new lines pop up at the
 * top for a few seconds (not from someone muted).
 */
import { ASSETS } from './assets';
import { audio } from './audio';
import type { ChatLine, Room } from './party-net';
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

function lineHtml(l: ChatLine, face: (c: number) => string): string {
  if (l.character < 0) return `<div class="pc-line sys">${esc(l.text)}</div>`;
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
  const draw = () => { log.innerHTML = room.chat.filter(l => !room.muted.has(l.from)).slice(-4).map(l => lineHtml(l, face)).join('') || '<div class="pc-line sys">在這裡和大家打招呼</div>'; };
  draw();
  el.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-say]'); if (b) { e.stopPropagation(); audio.ui('click'); room.say(b.dataset.say!); } });
  el.querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); const i = el.querySelector('input')!; room.say(i.value); i.value = ''; });
  el.addEventListener('click', e => e.stopPropagation());
  return { el, draw };
}


/** 托管 from the bar (main.ts): this phone's seat handed to the computer, or back from the next turn. */
export interface AutoControl { state(): 'manual' | 'auto' | 'pending' | 'back'; toggle(): void }

type View = 'chat' | 'quick' | 'emoji' | 'people' | 'votes';

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

  constructor(private stage: HTMLElement, private room: Room, private face: (c: number) => string, private auto: AutoControl) {
    this.el.className = 'party-bar';
    // The icons drawn like the toolbar's (party_icons.py): normal, and lit (-h) when pressed, open or on.
    const icon = (k: string, title: string, extra = '') => `<button data-v="${k}" title="${title}"><img class="pb-n" src="${PARTY_ART}/icon-${k}.webp" alt=""><img class="pb-h" src="${PARTY_ART}/icon-${k}-h.webp" alt="">${extra}</button>`;
    this.el.innerHTML = icon('chat', '聊天', '<i hidden></i>') + icon('quick', '快捷語') + icon('emoji', '表情') +
      icon('people', '玩家', '<em></em>') + icon('votes', '投票', '<i hidden></i>') + icon('auto', '托管', '<em class="pb-tag"></em>');
    this.el.addEventListener('click', e => {
      e.stopPropagation();
      const v = (e.target as HTMLElement).closest<HTMLElement>('[data-v]')?.dataset.v;
      if (!v) return;
      audio.ui('click');
      if (v === 'auto') { this.auto.toggle(); this.refresh(); return; }
      this.toggle(v as View);
    });
    this.pops.className = 'pc-pops';
    stage.append(this.pops);
    room.onChat = l => this.arrive(l);
    room.onVotes = () => { this.refresh(); if (this.panel) this.draw(); };
    room.onLobby = () => { this.refresh(); if (this.panel) this.draw(); };
    this.refresh();
    window.setInterval(() => this.refresh(), 1000);
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
  }

  private arrive(l: ChatLine) {
    if (this.panel && this.view === 'chat') this.draw(); else if (l.from !== this.room.myId) this.unread++;
    this.refresh();
    if (this.room.muted.has(l.from) || (this.panel && this.view === 'chat')) return;
    const pop = document.createElement('div');
    const st = stickerOf(l.text), big = !!st;
    pop.className = `pc-pop${big ? ' big' : ''}`;
    pop.innerHTML = st ? `<b>${esc(l.name)}</b>${stickerImg(l.character, st, 'pc-stk-big')}` : lineHtml(l, this.face);
    this.pops.append(pop);
    while (this.pops.children.length > 3) this.pops.firstElementChild!.remove();
    setTimeout(() => { pop.classList.add('out'); setTimeout(() => pop.remove(), 400); }, big ? 3000 : 5000);
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
    else if (v === 'chat') {
      p.innerHTML = `${head('聊天')}<div class="pc-log">${r.chat.filter(l => !r.muted.has(l.from)).slice(-40).map(l => lineHtml(l, this.face)).join('') || '<div class="pc-line sys">還沒有訊息</div>'}</div>
        <div class="pc-phrases">${PHRASES.map(t => `<button class="chip" data-say="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <form class="pc-form"><input maxlength="40" placeholder="說點什麼…（最多40字）"><button class="candy opt">送出</button></form>`;
      const log = p.querySelector<HTMLElement>('.pc-log')!; log.scrollTop = log.scrollHeight;
      p.querySelector('form')!.onsubmit = e => { e.preventDefault(); const i = p.querySelector('input')!; r.say(i.value); i.value = ''; };
    } else if (v === 'people') {
      p.innerHTML = `${head(`玩家（${r.members.filter(m => !m.away).length}/${r.members.length} 在線）`)}<div class="pc-people">${r.members.map(m => {
        const me = m.id === r.myId, votes = r.votes.get(m.id)?.size ?? 0, isHost = m.id === r.members[0]?.id, voted = r.votes.get(m.id)?.has(r.myId);
        return `<div class="pc-person${m.away ? ' away' : ''}"><img src="${this.face(m.character)}" alt=""><b><i class="pc-dot${m.away ? ' off' : ''}"></i>${esc(m.name)}${me ? '<small>你</small>' : ''}${isHost ? '<small>房主</small>' : ''}${m.region ? `<small>${esc(m.region)}</small>` : ''}${m.away ? '<small>斷線中</small>' : ''}</b>
          ${me ? '<span></span><span></span>' : `<button class="chip${r.muted.has(m.id) ? ' on' : ''}" data-mute="${m.id}">${r.muted.has(m.id) ? '已靜音' : '靜音'}</button>
          ${r.protectedId(m.id) ? '<button class="chip" disabled>首富・不能請出</button>' : `<button class="chip${voted ? ' on' : ''}" data-kick="${m.id}"${voted ? ' disabled' : ''}>請出 ${votes}/2</button>`}`}</div>`;
      }).join('')}</div><p class="pc-note">請出某人（房主也可以）需要另外兩位玩家同意；總資產最多的玩家不能被請出。被請出的人由電腦接手繼續玩（土地不拍賣），房主走了由下一位接任</p>`;
    } else {
      const list = [...r.votes.entries()].filter(([, s]) => s.size);
      p.innerHTML = `${head('投票')}${list.length ? `<div class="pc-votes">${list.map(([target, s]) => {
        const voted = s.has(r.myId), mine = target === r.myId;
        return `<div class="pc-vote"><b>請出 ${esc(r.nameOf(target))}</b><span>${s.size}/2 票・${[...s].map(id => esc(r.nameOf(id))).join('、')}</span>
          ${mine ? '<em>大家在投你</em>' : r.protectedId(target) ? '<em>首富・不能請出</em>' : `<button class="chip${voted ? ' on' : ''}" data-kick="${target}"${voted ? ' disabled' : ''}>${voted ? '已投票' : '我也同意'}</button>`}</div>`;
      }).join('')}</div>` : '<p class="pc-note">現在沒有進行中的投票</p>'}<p class="pc-note">要發起請出，請到「玩家」按「請出」</p>`;
      void others;
    }
    p.onclick = e => {
      e.stopPropagation();
      const t = e.target as HTMLElement;
      const say = t.closest<HTMLElement>('[data-say]'), mute = t.closest<HTMLElement>('[data-mute]'), kick = t.closest<HTMLElement>('[data-kick]');
      if (t.closest('[data-a=close]')) { audio.ui('no'); this.close(); return; }
      if (say) { audio.ui('click'); r.say(say.dataset.say!); if (v === 'quick' || v === 'emoji') this.close(); return; }
      if (mute) { audio.ui('click'); r.toggleMute(mute.dataset.mute!); this.draw(); return; }
      if (kick && confirm(`發起請出 ${r.nameOf(kick.dataset.kick!)}？需要另外兩位玩家同意`)) { audio.ui('click'); r.vote(kick.dataset.kick!); }
    };
  }

  destroy() { this.el.remove(); this.pops.remove(); this.panel?.remove(); }
}
