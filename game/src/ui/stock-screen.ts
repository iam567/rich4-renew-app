/**
 * The stock market (docs/rules/09 §7.6): the price table (red up / green down, limit badges) and the holdings
 * table, a company page with the price chart, figures and shareholders, and buy / sell. Each trade is handed
 * back to the rules (stocks.humanMarket), which checks it.
 */
import { CHARACTERS, playerName } from '../core/characters';
import type { Game } from '../core/game';
import { formatPrice, Trend, trendOf, type Stock } from '../core/modules/stocks';
import type { World } from '../core/world';
import { audio, Sfx } from './audio';
import './fit-list.css';

const money = (n: number) => `$${Math.trunc(n).toLocaleString('en-US')}`;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
/** A player's colour as text on the dark blue sheet: dark ones (忍太郎, 小丹尼) lifted halfway to white. */
const onBlue = (c: number) => {
  const r = c >> 16, g = (c >> 8) & 0xff, b = c & 0xff;
  if (0.299 * r + 0.587 * g + 0.114 * b > 110) return hex(c);
  const up = (v: number) => Math.round(v + (255 - v) * 0.55);
  return hex((up(r) << 16) | (up(g) << 8) | up(b));
};
const signed = (v: number, ref: number) => (v > 0 ? '+' : v < 0 ? '−' : '±') + formatPrice(Math.abs(v)).replace(/^/, '') + (ref ? '' : '');

export type Trade = { slot: number; buy: boolean; n: number };

export class StockScreen {
  readonly el: HTMLElement;
  private view: 'prices' | 'holders' = 'prices';
  private selected = -1;
  private detail = -1;
  private trade: { buy: boolean; n: number } | null = null;
  done: (a: Trade | -1) => void = () => {};

  /**
   * 大富豪模式 (docs/rules/17 §5): the nationwide market, the five cities' 12 stocks each on a tab; a trade's slot is
   * city × 12 + the city's slot.
   */
  private city = 0;
  /**
   * 持股表 with more player columns than fit across (大富豪模式's twelve, or a narrow phone): the players a page at a
   * time with a pager (`hper` columns a page, 0 = all), never cut off.
   */
  private hpage = 0;
  private hper = 0;
  /** The 持股表 without 保留股份 / 累積盈餘 (left to 公司資訊), so the players get the room. */
  private lean = false;

  constructor(readonly game: Game, readonly p: number, readonly world?: World | null) {
    this.el = document.createElement('div');
    this.el.className = 'stk';
    if (world) { this.city = Math.max(0, world.cities.indexOf(game)); this.el.classList.add('world'); }
    this.el.addEventListener('click', e => this.click(e));
    this.render();
    let w = 0;
    new ResizeObserver(() => {
      // Turned or resized: the 持股表 works out its columns again.
      if (this.view === 'holders' && this.detail < 0 && Math.abs(this.el.clientWidth - w) > 1) { w = this.el.clientWidth; this.render(); } else this.fit();
    }).observe(this.el);
  }

  /** One page, no scrolling: the table's sizes step down (--k) until it fits; a tiny screen shrinks it as a whole. */
  private fit() {
    const el = this.el;
    if (!el.isConnected || !el.clientHeight) return;
    el.style.zoom = '';
    for (const k of [1, 0.92, 0.85, 0.78, 0.72]) {
      el.style.setProperty('--k', String(k));
      if (el.scrollHeight <= el.clientHeight + 0.5) return;
    }
    el.style.zoom = String(Math.max(0.6, el.clientHeight / el.scrollHeight));
  }

  /** The market shown: the game's, or the chosen city's in 大富豪模式. */
  private get market(): Game { return this.world ? this.world.cities[this.city] : this.game; }
  private get st() { return this.market.stocks as unknown as { stocks: Stock[]; holdings: { shares: number; avgCost: number }[][]; cursor: number }; }

  private company(slot: number) {
    const s = this.st.stocks[slot], b = this.market.board;
    return s.companyId ? b.companies[s.companyId - 1] : b.companies.find(c => c.stockSlot === slot);
  }

  private click(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!t) return;
    const a = t.dataset.a!, v = Number(t.dataset.v);
    // The stock screen (fcn_0042aaff): a bought / sold amount rings Effect#40 / #41, the amount keys beep (#7),
    // leaving cancels (#4), the rest click (#1).
    audio.sfx(a === 'ok' && this.trade ? (this.trade.buy ? Sfx.stockBuy : Sfx.stockSell) : a === 'n' || a === 'max' ? Sfx.key : a === 'exit' || a === 'cancel-trade' || a === 'back' ? 4 : 1);
    const s = this.selected >= 0 ? this.st.stocks[this.selected] : null;
    const me = this.game.players[this.p];
    if (a === 'city') { this.city = v; this.selected = -1; this.detail = -1; this.trade = null; this.hpage = 0; }
    else if (a === 'view') { this.view = this.view === 'prices' ? 'holders' : 'prices'; this.hpage = 0; }
    else if (a === 'hpage') { const n = this.holderCount(); this.hpage = Math.max(0, Math.min(Math.ceil(n / (this.hper || n)) - 1, this.hpage + v)); }
    else if (a === 'row') { if (this.selected === v) this.detail = v; else this.selected = v; }
    else if (a === 'detail' && this.selected >= 0) this.detail = this.selected;
    else if (a === 'back') { this.detail = -1; this.trade = null; }
    else if ((a === 'buy' || a === 'sell') && s) this.trade = { buy: a === 'buy', n: 0 };
    else if (a === 'n' && this.trade && s) {
      const max = this.max(this.trade.buy);
      this.trade.n = Math.max(0, Math.min(max, v === Infinity ? max : this.trade.n + v));
    } else if (a === 'max' && this.trade) this.trade.n = this.max(this.trade.buy);
    else if (a === 'ok' && this.trade && this.selected >= 0 && this.trade.n > 0) { this.done({ slot: (this.world ? this.city * 12 : 0) + this.selected, buy: this.trade.buy, n: this.trade.n }); return; }
    else if (a === 'cancel-trade') this.trade = null;
    else if (a === 'exit') { this.done(-1); return; }
    void me;
    this.render();
  }

  /** Buying is capped by the turn's volume and the deposit, selling by the shares held (03 §5.2). */
  private max(buy: boolean): number {
    const s = this.st.stocks[this.selected], me = this.game.players[this.p];
    if (!s) return 0;
    return buy ? Math.max(0, Math.min(s.turnQuota, Math.trunc(me.bank / s.price))) : this.st.holdings[this.p][this.selected].shares;
  }

  private trendClass(s: Stock): string {
    if (s.suspendDays) return 'halt';
    return ['up', 'limit-up', 'down', 'limit-down', 'flat'][trendOf(s)];
  }

  render() {
    const me = this.game.players[this.p];
    const head = `<div class="stk-bar">
      <button class="chip on" data-a="view">${this.view === 'prices' ? '持股表' : '股價表'}</button>
      <button class="chip" data-a="buy" ${this.selected < 0 ? 'disabled' : ''}>買進</button>
      <button class="chip" data-a="sell" ${this.selected < 0 || !this.st.holdings[this.p][this.selected]?.shares ? 'disabled' : ''}>賣出</button>
      <button class="chip" data-a="detail" ${this.selected < 0 ? 'disabled' : ''}>公司資訊</button>
      <span class="stk-bank">存款 ${money(me.bank)}</span></div>${this.world ? `<div class="stk-cities">${this.world.cities.map((_c, i) =>
        `<button class="chip${i === this.city ? ' on' : ''}" data-a="city" data-v="${i}">${this.world!.cityName(i)}${this.market.stocks.open() || i !== this.city ? '' : '（休市）'}</button>`).join('')}</div>` : ''}`;
    const draw = () => {
      const body = this.detail >= 0 ? this.company_page(this.detail) : this.view === 'prices' ? this.prices() : this.holders();
      this.el.innerHTML = `${head}${body}${this.trade ? this.tradeBox() : ''}`;
      this.fit();
    };
    this.hper = 0; this.lean = false;
    draw();
    // The 持股表 wider than the sheet: fewer player columns a page until it fits across.
    const wide = () => {
      const t = this.el.querySelector<HTMLElement>('.stk-table.holders');
      return !!t && this.el.clientWidth > 0 && t.getBoundingClientRect().right > this.el.getBoundingClientRect().right + 1;
    };
    if (this.view === 'holders' && this.detail < 0 && wide()) { this.lean = true; draw(); }
    if (this.view === 'holders' && this.detail < 0 && wide()) {
      // Every page must fit (names differ in width); the page asked for stays.
      const n = this.holderCount(), want = this.hpage;
      for (let per = n - 1; per >= 1; per--) {
        this.hper = per;
        let fits = true;
        for (let pg = 0; pg < Math.ceil(n / per) && fits; pg++) { this.hpage = pg; draw(); fits = !wide(); }
        if (fits || per === 1) break;
      }
      this.hpage = Math.min(want, Math.ceil(n / this.hper) - 1);
      draw();
    }
  }

  private prices(): string {
    const rows = this.st.stocks.map((s, i) => {
      const h = this.st.holdings[this.p][i], c = this.company(i);
      const cls = this.trendClass(s), diff = s.price - s.prevClose;
      return `<tr class="${cls}${i === this.selected ? ' sel' : ''}" data-a="row" data-v="${i}">
        <td class="nm${c && s.companyId ? ' hq' : ''}">${s.name}</td>
        <td class="px"><span>${formatPrice(s.price)}</span></td>
        <td class="chg">${s.suspendDays ? '' : signed(diff, 0)}</td>
        <td>${s.suspendDays ? '暫停交易' : s.turnQuota.toLocaleString('en-US')}</td>
        <td>${h.shares ? h.shares.toLocaleString('en-US') : ''}</td>
        <td>${h.shares ? h.avgCost.toFixed(2) : ''}</td></tr>`;
    }).join('');
    return `<table class="stk-table"><thead><tr><th>股票名稱</th><th>成交價</th><th>漲跌</th><th>交易量</th><th>持有股數</th><th>平均成本</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /** 12 players (大富豪模式): only those holding shares of this market get a column. */
  private holderPlayers() {
    const all = this.game.players;
    return all.length > 4 ? all.filter(q => this.st.holdings[q.id].some(h => h.shares > 0)) : all;
  }
  private holderCount() { return this.holderPlayers().length; }

  private holders(): string {
    const every = this.holderPlayers();
    const per = this.hper > 0 && this.hper < every.length ? this.hper : every.length;
    const pages = Math.max(1, Math.ceil(every.length / per));
    const page = Math.min(this.hpage, pages - 1);
    const ps = every.slice(page * per, (page + 1) * per);
    const extra = !this.lean;
    const pager = pages > 1 ? `<div class="fl-pager stk-hpager"><button type="button" class="fl-prev" data-a="hpage" data-v="-1"${page ? '' : ' disabled'} aria-label="上一頁">‹</button>
      <span class="fl-num">${page + 1} / ${pages}</span><button type="button" class="fl-next" data-a="hpage" data-v="1"${page < pages - 1 ? '' : ' disabled'} aria-label="下一頁">›</button></div>` : '';
    const rows = this.st.stocks.map((s, i) => {
      const c = this.company(i);
      const cells = ps.map(q => {
        const k = q.id, n = this.st.holdings[k][i].shares, ctl = c && c.controller === k + 1;
        return `<td${ctl ? ' class="ctl"' : ''}>${n ? n.toLocaleString('en-US') : ''}</td>`;
      }).join('');
      return `<tr class="${i === this.selected ? 'sel' : ''}" data-a="row" data-v="${i}"><td class="nm">${s.name}</td>${cells}${extra ? `
        <td>${c && s.companyId ? c.freeShares.toLocaleString('en-US') : ''}</td><td>${c && s.companyId ? money(c.fundB) : ''}</td>` : ''}</tr>`;
    }).join('');
    return `<table class="stk-table holders"><thead><tr><th>股票名稱</th>${ps.map(q => `<th style="color:${onBlue(CHARACTERS[q.character].color)}">${playerName(q)}</th>`).join('')}${extra ? '<th>保留股份</th><th>累積盈餘</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>${pager}`;
  }

  /** Oldest to newest daily closes from the 144-day ring. */
  private history(s: Stock): number[] {
    const out: number[] = [], cur = this.st.cursor ?? 0;
    for (let k = 0; k < 144; k++) { const v = s.history[(cur + k) % 144]; if (v) out.push(v); }
    if (!out.length || out[out.length - 1] !== s.price) out.push(s.price);
    return out;
  }

  /** Daily candles (open = previous close) with a 5-day average, red up / green down. */
  private chart(s: Stock): string {
    const h = this.history(s).slice(-60), W = 520, H = 190, pad = 8;
    if (h.length < 2) return '<div class="stk-chart empty">還沒有走勢資料</div>';
    const hi = Math.max(...h), lo = Math.min(...h), span = hi - lo || hi * 0.1 || 1;
    const y = (v: number) => pad + (hi - v) / span * (H - pad * 2);
    // A fixed 60-day window: candles keep their width, the newest on the right.
    const step = W / 60, bw = step * 0.62, x0 = W - h.length * step;
    let candles = '', ma = '';
    h.forEach((v, i) => {
      if (!i) return;
      const o = h[i - 1], up = v >= o, x = x0 + (i + 0.5) * step;
      const top = y(Math.max(o, v)), bot = y(Math.min(o, v));
      candles += `<rect x="${(x - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, bot - top).toFixed(1)}" class="${up ? 'u' : 'd'}"/>`;
    });
    h.forEach((_, i) => {
      if (i < 4) return;
      const avg = (h[i] + h[i - 1] + h[i - 2] + h[i - 3] + h[i - 4]) / 5;
      ma += `${ma ? 'L' : 'M'}${(x0 + (i + 0.5) * step).toFixed(1)} ${y(avg).toFixed(1)}`;
    });
    return `<svg class="stk-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line x1="0" x2="${W}" y1="${y(hi)}" y2="${y(hi)}" class="g"/><line x1="0" x2="${W}" y1="${y(lo)}" y2="${y(lo)}" class="g"/>
      ${candles}<path d="${ma}" class="ma"/>
      <text x="4" y="${y(hi) + 12}">${formatPrice(hi)}</text><text x="4" y="${y(lo) - 4}">${formatPrice(lo)}</text></svg>`;
  }

  private company_page(slot: number): string {
    const s = this.st.stocks[slot], c = this.company(slot), h = this.history(s), cls = this.trendClass(s);
    const avg = (n: number) => { const t = h.slice(-n); return t.reduce((a, b) => a + b, 0) / t.length; };
    const diff = s.price - s.prevClose, pct = s.prevClose ? diff / s.prevClose * 100 : 0;
    const total = 10000;
    const holders = this.game.players.map((q, k) => ({ q, n: this.st.holdings[k][slot].shares })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    const ctl = c && c.controller ? playerName(this.game.players[c.controller - 1]) : '無';
    const fig = (k: string, v: string, cls2 = '') => `<div class="stk-fig ${cls2}"><span>${k}</span><b>${v}</b></div>`;
    // 大富豪模式: up to twelve shareholders — in columns across the page, never past its bottom.
    const many = holders.length > 6 ? ' many' : '';
    return `<div class="stk-company${many}">
      <div class="stk-title"><b>${s.name}</b>${c && s.companyId ? `<span>經營者：${ctl}</span>` : '<span>未上市企業</span>'}<button class="chip" data-a="back">返回列表</button></div>
      ${this.chart(s)}
      <div class="stk-figs">
        ${fig('成交價', formatPrice(s.price), cls)}${fig('漲跌', s.suspendDays ? '暫停交易' : signed(diff, 0), cls)}${fig('漲跌幅', `${pct.toFixed(2)}%`, cls)}
        ${fig('交易量', s.turnQuota.toLocaleString('en-US'))}${fig('週均價', formatPrice(avg(7)))}${fig('月均價', formatPrice(avg(30)))}
        ${fig('歷史高價', formatPrice(Math.max(...h)))}${fig('歷史低價', formatPrice(Math.min(...h)))}
        ${c && s.companyId ? `${fig('本月盈餘', money(c.fundA))}${fig('累積盈餘', money(c.fundB))}${fig('保留股份', c.freeShares.toLocaleString('en-US'))}` : ''}
      </div>
      <div class="stk-holders${many}"><h4>股東</h4>${holders.length ? holders.map(({ q, n }) => {
        const ch = CHARACTERS[q.character], r = n / total * 100;
        return `<div class="stk-holder${c && c.controller === q.id + 1 ? ' ctl' : ''}" style="--c:${hex(ch.color)}">
          <span class="nm">${playerName(q)}${c && c.controller === q.id + 1 ? '<em>經營者</em>' : ''}</span>
          <span class="bar"><i style="width:${Math.min(100, r).toFixed(1)}%"></i></span><span class="n" title="${n.toLocaleString('en-US')} 股 · ${r.toFixed(1)}%">${many ? `${(n / 1000).toLocaleString('en-US')}千股 ${r.toFixed(0)}%` : `${n.toLocaleString('en-US')} 股 · ${r.toFixed(1)}%`}</span></div>`;
      }).join('') : '<p class="info-none">目前沒有玩家持股</p>'}</div></div>`;
  }

  private tradeBox(): string {
    const s = this.st.stocks[this.selected], t = this.trade!, max = this.max(t.buy);
    const limit = t.buy ? trendOf(s) === Trend.LimitUp : trendOf(s) === Trend.LimitDown;
    return `<div class="stk-trade"><div class="stk-trade-box">
      <h4>${t.buy ? '買進' : '賣出'} ${s.name}</h4>
      <p>每股 ${formatPrice(s.price)} 元 · 最多 ${max.toLocaleString('en-US')} 股${limit ? `<br><b class="warn">${t.buy ? '漲停無法買進！' : '跌停無法賣出！'}</b>` : ''}</p>
      <div class="stk-n">${[-1000, -100, -10].map(k => `<button class="chip" data-a="n" data-v="${k}">${k}</button>`).join('')}
        <b>${t.n.toLocaleString('en-US')}</b>${[10, 100, 1000].map(k => `<button class="chip" data-a="n" data-v="${k}">+${k}</button>`).join('')}
        <button class="chip" data-a="max">最多</button></div>
      <p>金額 ${money(t.n * s.price)}</p>
      <div class="choices"><button class="candy ghost" data-a="cancel-trade">取消</button><button class="candy ${t.buy ? 'yes' : 'no'}" data-a="ok" ${t.n > 0 && !limit ? '' : 'disabled'}>確定${t.buy ? '買進' : '賣出'}</button></div>
    </div></div>`;
  }
}
