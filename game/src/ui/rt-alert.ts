/**
 * 即時制's alerts (the user 2026-11-08: in a fast game the box at the bottom goes unread): what happens to this player
 * — got a card, a toll paid to them, a rival's card or magic on them, their lots lost or taken, a god on them and what
 * it does, a missile coming (3, 2, 1) — as a thin bar at the map's top (the user: narrow, not in the way), 2 s at most,
 * then it fades out; points 1 s. At most two at once, a new one pushing the oldest out.
 */
export type Tone = 'good' | 'bad' | 'info';

const LIFE = 2_000;
const MAX = 2;

export class RtAlert {
  readonly el = document.createElement('div');
  private last = '';
  private lastAt = 0;

  /** The standing line above the bars: where this player is held and for how long (住院 3 天 · 約 18 秒). */
  private readonly state = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.el.className = 'rt-alerts';
    this.state.className = 'rt-state';
    this.state.hidden = true;
    this.el.append(this.state);
    // a tap closes one sooner; the map under it gets nothing
    this.el.addEventListener('pointerdown', e => {
      const bar = (e.target as HTMLElement).closest<HTMLElement>('.rt-alert');
      if (!bar) return;
      e.stopPropagation();
      this.drop(bar);
    });
    parent.append(this.el);
  }

  /** One bar: `text`, `tone` its colour; `big` a number (points), shown 1 s. */
  push(text: string, tone: Tone = 'info', opts: { big?: boolean; ms?: number } = {}): HTMLElement | null {
    const t = text.trim();
    if (!t) return null;
    const now = performance.now();
    if (t === this.last && now - this.lastAt < 1500) return null; // the same news twice in a row: once
    this.last = t; this.lastAt = now;
    const bar = document.createElement('div');
    bar.className = `rt-alert ${tone}${opts.big ? ' big' : ''}`;
    bar.textContent = t;
    this.el.append(bar);
    // more than two: the oldest gives way, a plain one before a bad one (the user 2026-11-08: being sent to prison by a
    // rival's magic must not be pushed out by a few points)
    if (tone === 'bad') bar.classList.add('keep');
    const live = () => [...this.el.querySelectorAll<HTMLElement>('.rt-alert:not(.out)')];
    while (live().length > MAX) this.drop(live().find(x => x !== bar && !x.classList.contains('keep')) ?? live()[0]);
    setTimeout(() => this.drop(bar), opts.ms ?? (opts.big ? 1_000 : LIFE));
    return bar;
  }

  /**
   * A missile locked on this player: the bar counts down with it (the user 2026-11-08: who, and 3, 2, 1 till it
   * lands). `ms`: the time to the hit.
   */
  countdown(text: string, ms: number) {
    const n0 = Math.max(1, Math.round(ms / 1000));
    const bar = this.push(`${text}　${n0}`, 'bad', { ms: ms + 600 });
    if (!bar) return;
    bar.classList.add('count');
    for (let k = 1; k <= n0; k++) setTimeout(() => { if (bar.isConnected) bar.textContent = k < n0 ? `${text}　${n0 - k}` : `${text}　落下！`; }, k * 1000);
  }

  /** The standing line: shown while `text`, gone with null. */
  hold(text: string | null) {
    if (text === null) { if (!this.state.hidden) this.state.hidden = true; return; }
    if (this.state.textContent !== text) this.state.textContent = text;
    if (this.state.hidden) this.state.hidden = false;
  }

  private drop(bar: HTMLElement) {
    if (!bar.isConnected || bar.classList.contains('out')) return;
    bar.classList.add('out');
    setTimeout(() => bar.remove(), 450);
  }

  remove() { this.el.remove(); }
}

/** What each god does to whoever carries it (docs/rules/06 §5 table), for the alert when it comes on this player. */
export const GOD_EFFECT: Record<number, string> = {
  1: '對手各付你一筆錢，過路費減半',
  2: '拉霸得一筆錢，過路費全免',
  3: '得一張卡，買地蓋房再免費加蓋一層',
  4: '得兩張卡，買地蓋房再免費加蓋一層',
  5: '付每個對手一筆錢，過路費 ×1.5',
  6: '損失一筆錢，過路費 ×2',
  7: '丟一張卡，不能買地、不能蓋房',
  8: '丟一半的卡，不能買地、不能蓋房',
  9: '停在哪塊地，就幫它加蓋一層',
  10: '停在有房子的地，就拆掉一層',
  12: '停在哪塊地，就強佔哪塊地',
  15: '卡片道具全部清空，收不到過路費',
};
