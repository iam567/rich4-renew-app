/**
 * 即時制's quick drawers (the user 2026-11-08: no opening the card screen and choosing every time): a small tab on the
 * map's edge — 卡片 on the left, 道具 on the right — opens the first twelve cards / tools of this player's hand; a tap
 * uses that one (the game's own card or tool flow, its first choice answered with it) and the drawer closes again.
 */
export interface QuickItem { value: number; name: string; icon: string | null; badge?: string }

export class RtQuick {
  readonly el = document.createElement('div');
  private readonly tab = document.createElement('button');
  private readonly list = document.createElement('div');
  private key = '';

  constructor(parent: HTMLElement, side: 'left' | 'right', label: string, private readonly items: () => QuickItem[], onPick: (v: number) => void) {
    this.el.className = `rt-quick ${side}`;
    this.tab.className = 'rt-quick-tab';
    this.tab.innerHTML = side === 'left' ? `${label}<i>▶</i>` : `<i>◀</i>${label}`;
    this.list.className = 'rt-quick-list';
    this.el.append(this.tab, this.list);
    // the map under it gets nothing
    for (const ev of ['pointerdown', 'touchstart', 'wheel'] as const) this.el.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    this.tab.onclick = e => { e.stopPropagation(); this.toggle(); };
    this.list.onclick = e => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
      if (!b) return;
      this.toggle(false);
      onPick(Number(b.dataset.v));
    };
    parent.append(this.el);
  }

  get open(): boolean { return this.el.classList.contains('open'); }

  toggle(on = !this.open) {
    if (on) for (const o of document.querySelectorAll('.rt-quick.open')) if (o !== this.el) o.classList.remove('open'); // one drawer at a time
    this.el.classList.toggle('open', on);
    if (on) this.refresh();
  }

  /** Redraws the open drawer when the hand changed. */
  refresh() {
    if (!this.open) return;
    const items = this.items();
    const key = JSON.stringify(items);
    if (key === this.key) return;
    this.key = key;
    this.list.innerHTML = items.length
      ? items.map(it => `<button data-v="${it.value}" title="${it.name}">${it.icon ? `<img src="${it.icon}" alt="">` : ''}<span>${it.name}</span>${it.badge ? `<em>${it.badge}</em>` : ''}</button>`).join('')
      : '<p>沒有</p>';
  }

  remove() { this.el.remove(); }
}
