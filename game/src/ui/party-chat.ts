/**
 * 派對模式's chat (the user 2026-10-19: text only, quick phrases, mute someone, a kick needs two others agreeing).
 * `inline`: in the room before the game (the last lines and the input under the seats). In the game: a 💬 button on
 * the map opens the panel (history, quick phrases, input, the players with 靜音 and 請出); new lines pop up at the
 * top for a few seconds (not from someone muted).
 */
import { audio } from './audio';
import type { ChatLine, Room } from './party-net';
import './party.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PHRASES = ['你好！', '快點啦～', '哈哈哈', '謝謝老闆！', '我要破產了…', '手下留情！', '再來一局！'];

function lineHtml(l: ChatLine, face: (c: number) => string): string {
  if (l.character < 0) return `<div class="pc-line sys">${esc(l.text)}</div>`;
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

/** In the game: the 💬 button, the panel and the pop-ups, on the stage. */
export class GameChat {
  private btn = document.createElement('button');
  private pops = document.createElement('div');
  private panel: HTMLElement | null = null;
  private unread = 0;

  constructor(private stage: HTMLElement, private room: Room, private face: (c: number) => string) {
    this.btn.className = 'pc-btn';
    this.btn.innerHTML = '💬<i hidden></i>';
    this.btn.onclick = e => { e.stopPropagation(); audio.ui('click'); this.open(); };
    this.pops.className = 'pc-pops';
    stage.append(this.btn, this.pops);
    room.onChat = l => this.arrive(l);
    room.onVotes = () => this.panel && this.drawPanel();
  }

  private arrive(l: ChatLine) {
    if (this.panel) { this.drawPanel(); return; }
    this.unread++;
    const dot = this.btn.querySelector('i')!; dot.hidden = false; dot.textContent = String(Math.min(this.unread, 9));
    const pop = document.createElement('div');
    pop.className = 'pc-pop';
    pop.innerHTML = lineHtml(l, this.face);
    this.pops.append(pop);
    while (this.pops.children.length > 3) this.pops.firstElementChild!.remove();
    setTimeout(() => { pop.classList.add('out'); setTimeout(() => pop.remove(), 400); }, 5000);
  }

  private open() {
    this.unread = 0;
    this.btn.querySelector('i')!.hidden = true;
    this.pops.replaceChildren();
    const p = document.createElement('div');
    p.className = 'pc-panel';
    p.addEventListener('click', e => e.stopPropagation());
    p.addEventListener('pointerdown', e => e.stopPropagation());
    this.panel = p;
    this.stage.append(p);
    this.drawPanel();
  }

  private drawPanel() {
    const p = this.panel!, r = this.room;
    const others = r.members.filter(m => m.id !== r.myId);
    p.innerHTML = `<div class="pc-head"><b>聊天</b><button class="pc-x" data-a="close">✕</button></div>
      <div class="pc-log">${r.chat.filter(l => !r.muted.has(l.from)).slice(-30).map(l => lineHtml(l, this.face)).join('') || '<div class="pc-line sys">還沒有訊息</div>'}</div>
      <div class="pc-phrases">${PHRASES.map(t => `<button class="chip" data-say="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <form class="pc-form"><input maxlength="40" placeholder="說點什麼…（最多40字）"><button class="candy opt">送出</button></form>
      ${others.length ? `<div class="pc-people">${others.map(m => {
        const votes = r.votes.get(m.id)?.size ?? 0, isHost = m.id === r.members[0]?.id, voted = r.votes.get(m.id)?.has(r.myId);
        return `<div class="pc-person"><img src="${this.face(m.character)}" alt=""><b>${esc(m.name)}${isHost ? '<small>房主</small>' : ''}${m.region ? `<small>${esc(m.region)}</small>` : ''}</b>
          <button class="chip${r.muted.has(m.id) ? ' on' : ''}" data-mute="${m.id}">${r.muted.has(m.id) ? '已靜音' : '靜音'}</button>
          <button class="chip${voted ? ' on' : ''}" data-kick="${m.id}"${voted ? ' disabled' : ''}>請出 ${votes}/2</button></div>`;
      }).join('')}</div><p class="pc-note">請出某人（房主也可以）需要另外兩位玩家同意；被請出的人由電腦接手，房主走了由下一位接任</p>` : ''}`;
    const log = p.querySelector<HTMLElement>('.pc-log')!;
    log.scrollTop = log.scrollHeight;
    p.querySelector('form')!.onsubmit = e => { e.preventDefault(); const i = p.querySelector('input')!; r.say(i.value); i.value = ''; };
    p.onclick = e => {
      e.stopPropagation();
      const t = e.target as HTMLElement;
      const say = t.closest<HTMLElement>('[data-say]'), mute = t.closest<HTMLElement>('[data-mute]'), kick = t.closest<HTMLElement>('[data-kick]');
      if (t.closest('[data-a=close]')) { audio.ui('no'); p.remove(); this.panel = null; return; }
      if (say) { audio.ui('click'); r.say(say.dataset.say!); return; }
      if (mute) { audio.ui('click'); r.toggleMute(mute.dataset.mute!); this.drawPanel(); return; }
      if (kick && confirm(`發起請出 ${r.nameOf(kick.dataset.kick!)}？需要另外兩位玩家同意`)) { audio.ui('click'); r.vote(kick.dataset.kick!); }
    };
  }

  destroy() { this.btn.remove(); this.pops.remove(); this.panel?.remove(); }
}
