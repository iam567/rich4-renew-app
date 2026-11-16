/**
 * 即時制's standings (the user 2026-11-08: everyone's money and rank at a glance, without opening a screen): a small
 * column at the map's top right, one row a player — rank, face, 現金 and 存款 in 萬 (the user: those two) — ranked by
 * total assets (who wins when the time is up), this player's row lit, a bankrupt one greyed at the bottom. Whenever
 * someone's cash and deposit change, the difference pops out of their row (+1,200 green, −800 red) and floats away
 * (the user: a little effect as the money moves). Someone held shows it on their face: ✚ 住院, 🔒 坐牢, ✈ 出國, 👽 外星人,
 * 🏨 旅館, 💤 冬眠, with the days left. A small arrow tucks the column into the edge and brings it back (kept).
 */
const FOLD_KEY = 'rich4.rt.rankFolded';
export interface RankPerson { id: number; face: string; color: string }

/** 123,456 → 12.3萬; 123,456,789 → 1.23億. */
export function shortMoney(n: number): string {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(a >= 1e9 ? 1 : 2)}億`;
  if (a >= 1e4) return `${s}${(a / 1e4).toFixed(a >= 1e6 ? 0 : 1)}萬`;
  return `${s}${Math.round(a)}`;
}

const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n) >= 1e5 ? shortMoney(Math.abs(n)) : Math.abs(n).toLocaleString('zh-Hant')}`;

interface Row { el: HTMLElement; rank: HTMLElement; money: HTMLElement; tag: HTMLElement; was: number | null; text: string }

export class RtRank {
  readonly el = document.createElement('div');
  private readonly rows = new Map<number, Row>();

  constructor(parent: HTMLElement, me: number, people: RankPerson[]) {
    this.el.className = 'rt-rank';
    const tog = document.createElement('button');
    tog.className = 'rt-rank-tog';
    const fold = (on: boolean) => {
      this.el.classList.toggle('folded', on);
      tog.textContent = on ? '◀ 排名' : '▶';
      try { localStorage.setItem(FOLD_KEY, on ? '1' : '0'); } catch { /* not kept */ }
    };
    tog.onclick = e => { e.stopPropagation(); fold(!this.el.classList.contains('folded')); };
    for (const ev of ['pointerdown', 'touchstart'] as const) tog.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    this.el.append(tog);
    let folded = false;
    try { folded = localStorage.getItem(FOLD_KEY) === '1'; } catch { /* open */ }
    fold(folded);
    for (const p of people) {
      const el = document.createElement('div');
      el.className = `rt-rk${p.id === me ? ' me' : ''}`;
      el.style.setProperty('--c', p.color);
      el.innerHTML = `<i></i><span class="rt-face"><img src="${p.face}" alt=""><u hidden></u></span><b></b>`;
      this.el.append(el);
      this.rows.set(p.id, { el, rank: el.querySelector('i')!, money: el.querySelector('b')!, tag: el.querySelector('u')!, was: null, text: '' });
    }
    parent.append(this.el);
  }

  /** Each player's total assets (the order), cash, deposit, whether out of the game, and where held (icon, days). */
  update(list: { id: number; total: number; cash: number; bank: number; out: boolean; beggar?: boolean; held?: [string, number] | null }[]) {
    // (派對模式's 乞丐: below the players, above who is out)
    const order = [...list].sort((a, b) => Number(a.out) - Number(b.out) || Number(!!a.beggar) - Number(!!b.beggar) || b.total - a.total);
    order.forEach((r, i) => {
      const row = this.rows.get(r.id);
      if (!row) return;
      const o = String(i);
      if (row.el.style.order !== o) row.el.style.order = o;
      const rank = r.out || r.beggar ? '–' : String(i + 1);
      if (row.rank.textContent !== rank) row.rank.textContent = rank;
      row.el.classList.toggle('out', r.out);
      const text = r.out ? '<small></small>破產' : r.beggar ? `<small>乞丐</small><br>${shortMoney(r.cash + r.bank)}` : `<small>現</small>${shortMoney(r.cash)}<br><small>存</small>${shortMoney(r.bank)}`;
      if (text !== row.text) { row.text = text; row.money.innerHTML = text; }
      const tag = r.held && !r.out ? `${r.held[0]}${r.held[1] ? r.held[1] : ''}` : '';
      if (row.tag.textContent !== tag) row.tag.textContent = tag;
      row.tag.hidden = !tag;
      row.tag.classList.toggle('cross', r.held?.[0] === '✚');
      // the money moved: the difference pops out of the row
      const now = r.cash + r.bank;
      if (row.was !== null && now !== row.was && !r.out) this.pop(row.el, now - row.was);
      row.was = now;
    });
  }

  private pop(row: HTMLElement, d: number) {
    const el = document.createElement('span');
    el.className = `rt-pop ${d > 0 ? 'up' : 'down'}`;
    el.textContent = signed(d);
    row.append(el);
    setTimeout(() => el.remove(), 1_300);
  }

  remove() { this.el.remove(); }
}
