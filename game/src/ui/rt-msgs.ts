/**
 * 即時制's message box (the user 2026-11-08: like an online game's — a small box of text lines): what happens — a
 * line, a fate card, a fee, what was got — one line each, the newest at the bottom; the box keeps the last hundred
 * and scrolls up for them, its top fading out. This player's always; the others' when their face under the box is lit
 * (a tap on a face turns them on or off: one, several, 全部 or none), with their name in their colour.
 */
const KEEP = 100;
const WATCH_KEY = 'rich4.rt.watch';
/** Each kind's title colour (the user 2026-11-08: not all white, so the kinds tell apart); traditional or simplified. */
const TITLE_COLOR: [RegExp, string][] = [
  [/命[運运]/, '#ff8ad8'], [/新[聞闻]/, '#62d8ff'], [/卡片/, '#ffab4a'], [/道具/, '#7dff7a'], [/[點点]券/, '#ffe14a'],
  [/魔法/, '#c9a2ff'], [/拉霸/, '#ffd34d'], [/[來来]襲|[來来]袭/, '#ff5a4a'],
];
/** An untitled line's text colour by what it says: paying red, getting green, a god purple. */
const TEXT_COLOR: [RegExp, string][] = [
  [/附身|作祟|神/, '#e3c6ff'], [/付|[罚罰]|失去|扣|[缴繳]|[损損]失|破[产產]/, '#ffb4aa'], [/得到|[获獲]得|收到|[赚賺]/, '#b9ffb0'],
];
const colorOf = (table: [RegExp, string][], s: string) => table.find(([re]) => re.test(s))?.[1];
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface RtPeople { me: number; players: { id: number; face: string; name: string; color: string }[] }

export class RtMsgs {
  readonly el = document.createElement('div');
  private readonly log = document.createElement('div');
  private readonly faces = document.createElement('div');
  private readonly watched: Set<number>;
  private readonly others: RtPeople['players'];
  private last = '';

  constructor(parent: HTMLElement, private readonly people: RtPeople) {
    this.others = people.players.filter(p => p.id !== people.me);
    this.el.className = 'rt-msgs';
    this.log.className = 'rt-log';
    this.faces.className = 'rt-watch';
    let saved: number[] = [];
    try { saved = JSON.parse(localStorage.getItem(WATCH_KEY) ?? '[]') as number[]; } catch { /* none */ }
    this.watched = new Set(saved.filter(id => this.others.some(o => o.id === id)));
    this.el.append(this.log, this.faces);
    this.drawFaces();
    // the box scrolls by finger and wheel; a face turns on or off (the map under them gets nothing)
    for (const ev of ['pointerdown', 'wheel', 'touchstart'] as const) this.el.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    this.faces.onclick = e => {
      e.stopPropagation();
      const face = (e.target as HTMLElement).closest<HTMLElement>('[data-who]');
      if (!face) return;
      const id = Number(face.dataset.who);
      if (id < 0) { if (this.watched.size === this.others.length) this.watched.clear(); else for (const o of this.others) this.watched.add(o.id); }
      else if (this.watched.has(id)) this.watched.delete(id); else this.watched.add(id);
      try { localStorage.setItem(WATCH_KEY, JSON.stringify([...this.watched])); } catch { /* not kept */ }
      this.drawFaces();
    };
    parent.append(this.el);
  }

  private drawFaces() {
    if (!this.others.length) { this.faces.hidden = true; return; }
    const all = this.watched.size === this.others.length;
    this.faces.innerHTML = `<span>看</span>${this.others.map(o => `<button class="${this.watched.has(o.id) ? 'on' : ''}" data-who="${o.id}" title="${esc(o.name)}"><img src="${o.face}" alt=""></button>`).join('')}<button class="all${all ? ' on' : ''}" data-who="-1">全部</button>`;
  }

  /** Whether player p's messages are shown (this player's always). */
  watching(p: number): boolean { return p === this.people.me || this.watched.has(p); }

  /** One line: `title` in 【】 (命運, 點券 …), the text (its lines joined), `who` the player it is about (another's name shown). */
  push(text: string, title = '', who = -1) {
    const t = text.trim().replace(/\s*\n+\s*/g, '　');
    if (!t) return;
    const key = `${who}|${title}|${t}`;
    if (key === this.last) return; // the same line again (a line repeated by the rules): once
    this.last = key;
    const owner = this.people.players.find(x => x.id === who);
    const p = who !== this.people.me ? owner : undefined;
    const line = document.createElement('div');
    line.className = 'rt-line';
    // whose: a stripe in their colour (and another's name); what: the title's colour, else the text's
    if (owner) line.style.borderLeftColor = owner.color;
    const tc = title ? colorOf(TITLE_COLOR, title) : undefined, xc = title ? undefined : colorOf(TEXT_COLOR, t);
    line.innerHTML = `${p ? `<b style="color:${p.color}">${esc(p.name)}</b>` : ''}${title ? `<i${tc ? ` style="color:${tc}"` : ''}>【${esc(title)}】</i>` : ''}${xc ? `<span style="color:${xc}">${esc(t)}</span>` : esc(t)}`;
    // keep the reader's place when they scrolled up; else follow the newest
    const atEnd = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 8;
    this.log.append(line);
    while (this.log.children.length > KEEP) this.log.firstElementChild!.remove();
    if (atEnd) this.log.scrollTop = this.log.scrollHeight;
  }

  remove() { this.el.remove(); }
}
