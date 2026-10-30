/**
 * 查詢 — the player information screen (docs/rules/09 §7.10) with the original's three pages: assets, property
 * (filters 全部 / 住宅區 / 商業區 / 房屋 / 連鎖店) and stocks, for any player picked by tab.
 */
import { CHARACTERS, playerName } from '../core/characters';
import { day, month, year } from '../core/date';
import type { Game } from '../core/game';
import { TOOLS, TYCOON_TOOLS } from '../core/modules/tools';
import { itemIconSrc, itemText } from './screens/item-text';
import { cardName, handStacks, stackOf } from '../core/modules/cards';
import type { SpriteBank } from './sprites';
import { tycoon } from './tycoon';
import { shrinkText } from './text';

const money = (n: number) => `$${Math.trunc(n).toLocaleString('en-US')}`;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const LAND_STAGES = ['空　地', '平　房', '店　舖', '商　場', '商業大樓', '摩天大樓'];
const FACILITY_TYPES = ['公園', '旅館', '購物中心', '加油站', '研究所', '輪盤館', '二十一點館', '百家樂館', '德州撲克館', '骰寶館', '居酒屋', '陪酒店', '泡泡浴', '情人酒店']; // 5..9 大富翁城's halls (docs/rules/19), 10..13 歌舞伎町's shops (21)
const FILTERS = ['全部', '住宅區', '商業區', '房屋', '連鎖店'];
const PAGES = ['資產', '地產', '股票'];

export class InfoScreen {
  readonly el: HTMLElement;
  private who: number;
  private page = 0;
  private filter = 0;

  constructor(readonly game: Game, readonly bank: SpriteBank) {
    this.who = game.isPlayerId(game.current) ? game.current : Math.max(0, game.players.findIndex(q => q.human));
    this.el = document.createElement('div');
    this.el.className = 'info';
    this.el.addEventListener('click', e => {
      // A tool or card: what it does, in the line under the lists.
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-tool],[data-card]');
      if (item) {
        const tip = this.el.querySelector<HTMLElement>('.info-tip');
        const card = item.dataset.card !== undefined, id = Number(card ? item.dataset.card : item.dataset.tool);
        if (tip) tip.textContent = `${item.title}：${itemText(id, card)}`;
        return;
      }
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-who],[data-page],[data-filter],[data-sheet]');
      if (!t) return;
      if (t.dataset.who) this.who = Number(t.dataset.who);
      if (t.dataset.page) this.page = Number(t.dataset.page);
      if (t.dataset.filter) this.filter = Number(t.dataset.filter);
      if (t.dataset.who || t.dataset.page || t.dataset.filter) this.sheet = 0;
      if (t.dataset.sheet) this.sheet = Math.max(0, this.sheet + Number(t.dataset.sheet));
      this.render();
    });
    this.render();
    new ResizeObserver(() => this.fit()).observe(this.el);
  }

  /** Which page of a long list (地產 / 股票) is shown: everything is on one page, a long list in pages (‹ 1/3 ›). */
  private sheet = 0;

  /**
   * One page, no scrolling: a list longer than the room is split into pages of the rows that fit; the 資產 page
   * steps its sizes down (--k) and, only on a tiny screen, shrinks as a whole.
   */
  private fit() {
    const body = this.el.querySelector<HTMLElement>('.info-body');
    if (!body || !body.clientHeight) return;
    shrinkText(this.el, '.info-face-tab span, .info-tab, .info-page, .info-filter', 9);
    const inner = body.firstElementChild as HTMLElement | null;
    if (!inner) return;
    inner.style.zoom = '';
    const rows = [...body.querySelectorAll<HTMLElement>('tbody tr')];
    const pager = body.querySelector<HTMLElement>('.info-pager');
    if (rows.length && pager) {
      for (const r of rows) r.hidden = false;
      pager.hidden = true;
      const room = body.clientHeight - parseFloat(getComputedStyle(body).paddingTop) - parseFloat(getComputedStyle(body).paddingBottom);
      if (inner.offsetHeight <= room) { this.sheet = 0; return; }
      pager.hidden = false;
      const rowH = Math.max(...rows.map(r => r.offsetHeight)) || 24;
      const fixed = inner.offsetHeight - rows.reduce((h, r) => h + r.offsetHeight, 0);
      const per = Math.max(1, Math.floor((room - fixed) / rowH));
      const pages = Math.ceil(rows.length / per);
      this.sheet = Math.min(this.sheet, pages - 1);
      rows.forEach((r, i) => { r.hidden = Math.floor(i / per) !== this.sheet; });
      pager.innerHTML = `<button class="chip" data-sheet="-1"${this.sheet ? '' : ' disabled'}>‹</button><span>${this.sheet + 1} / ${pages}</span><button class="chip" data-sheet="1"${this.sheet < pages - 1 ? '' : ' disabled'}>›</button>`;
      if (inner.offsetHeight > room) inner.style.zoom = String(Math.max(0.6, room / inner.offsetHeight));
      return;
    }
    // 資產: both blocks at a step-down size, else one block at a time (‹ 1/2 ›), each stepped down again.
    const room = body.clientHeight - parseFloat(getComputedStyle(body).paddingTop) - parseFloat(getComputedStyle(body).paddingBottom);
    const tryK = (ks: number[]) => {
      // fits the height, and no figure runs into its neighbour (a narrow phone)
      const wide = () => [...inner.querySelectorAll<HTMLElement>('.info-cell')].every(c => c.offsetParent === null || c.scrollWidth <= c.clientWidth + 0.5);
      for (const k of ks) { inner.style.setProperty('--k', String(k)); if (inner.offsetHeight <= room + 0.5 && wide()) return true; }
      return false;
    };
    const blks = [...inner.querySelectorAll<HTMLElement>(':scope > .info-blk')];
    if (pager) pager.hidden = true;
    for (const b of blks) b.hidden = false;
    if (tryK([1, 0.92, 0.85])) { this.sheet = 0; return; }
    if (blks.length > 1 && pager) {
      this.sheet = Math.min(this.sheet, blks.length - 1);
      blks.forEach((b, i) => { b.hidden = i !== this.sheet; });
      pager.hidden = false;
      pager.innerHTML = `<button class="chip" data-sheet="-1"${this.sheet ? '' : ' disabled'}>‹</button><span>${this.sheet + 1} / ${blks.length}</span><button class="chip" data-sheet="1"${this.sheet < blks.length - 1 ? '' : ' disabled'}>›</button>`;
    }
    if (tryK([1, 0.92, 0.85, 0.78])) return;
    inner.style.zoom = String(Math.max(0.6, room / inner.offsetHeight));
  }

  private render() {
    const g = this.game, p = g.players[this.who], ch = CHARACTERS[p.character];
    const face = this.bank.art('Data', 2, p.character);
    const god = g.objects.godName(p), godSlot = p.god ? g.objects.slots[p.god - 1] : undefined;
    const godArt = godSlot ? this.bank.art('Data', 395 + godSlot.type, 0) : null;
    const w = tycoon.world;
    // 大富豪模式 (docs/rules/17 §12): twelve players as one strip of faces; who fell shows the order and its title.
    const tabs = w ? `<div class="info-faces">${g.players.map((q, i) => {
      const c = CHARACTERS[q.character], f = this.bank.art('Data', 2, q.character), k = w.fallen.findIndex(x => x.p === q.id);
      const fell = k >= 0 ? `<small>第${k + 1}位破產</small>` : '';
      return `<button class="info-face-tab${i === this.who ? ' on' : ''}${q.bankrupt ? ' out' : ''}${q.human ? ' me' : ''}" data-who="${i}" style="--c:${hex(c.color)}" title="${playerName(q)}">
        ${f ? `<img src="${f.src}" alt="">` : ''}<span>${playerName(q)}</span>${fell}</button>`;
    }).join('')}</div>` : g.players.map((q, i) => {
      const c = CHARACTERS[q.character];
      return `<button class="info-tab${i === this.who ? ' on' : ''}" data-who="${i}" style="--c:${hex(c.color)}">${playerName(q)}${q.bankrupt ? '<small>破產</small>' : ''}</button>`;
    }).join('');
    const side = `<div class="info-side${god ? ' with-god' : ''}">
      <div class="info-face" style="--c:${hex(ch.color)}">${face ? `<img src="${face.src}" alt="">` : ''}</div>
      ${w ? `<div class="info-where">${w.whereText(p)}</div>${w.overlordTitles(p).map(t => `<div class="info-where overlord">${t}</div>`).join('')}${p.human && w.fallen.some(x => x.title) ? `<div class="info-where gold">${w.fallen.filter(x => x.title).slice(-1)[0].title}</div>` : ''}` : ''}
      ${god ? `<div class="info-god">${godArt ? `<img src="${godArt.src}" alt="">` : ''}<span>${god}</span><small>${godSlot?.life ?? 0}天</small>${godSlot && g.rules?.godNote ? `<small class="info-god-note">${g.rules.godNote(godSlot.type).replace(/^：/, '賭場')}</small>` : ''}</div>` : ''}
      ${PAGES.map((t, i) => `<button class="info-page${i === this.page ? ' on' : ''}" data-page="${i}">${t}</button>`).join('')}</div>`;
    const body = this.page === 0 ? this.assets() : this.page === 1 ? this.property() : this.stocks();
    this.el.innerHTML = `<div class="info-tabs">${tabs}</div><div class="info-main">${side}<div class="info-body"><div class="info-inner">${body}</div></div></div>`;
    this.fit();
    // again once 简体 (lang.ts) has rewritten the new text, which can change its widths
    requestAnimationFrame(() => this.fit());
  }

  /** 資產: cash, deposit, loan, total; stock value, points, insurance, companies; property counts; tools; cards. */
  private assets(): string {
    const g = this.game, p = g.players[this.who], me = this.who + 1;
    // Every city's properties and the nationwide market in 大富豪模式 (one board and market otherwise).
    const boards = g.boards();
    const lands = boards.flatMap(b => b.lands.filter(l => l.owner === me)), facs = boards.flatMap(b => b.facilities.filter(f => f.owner === me));
    const stockValue = g.markets().reduce((v, m) => m.holdingsValue(v, p), 0);
    const companies = boards.reduce((n, b) => n + b.companies.filter(c => c.controller === me).length, 0);
    const cell = (label: string, value: string) => `<div class="info-cell"><span>${label}</span><b>${value}</b></div>`;
    // Every tool the player holds: the original 13, 大富豪模式's 14–16, the map's own (歌舞伎町 17, 18).
    const tools = [...TOOLS, ...(g.world ? TYCOON_TOOLS : []), ...(g.rules?.extraTools ?? [])].filter(t => p.tools[t.id - 1] > 0).map(t => {
      const src = itemIconSrc(this.bank, t.id);
      return `<span class="info-tool" data-tool="${t.id}" title="${t.name}">${src ? `<img src="${src}" alt="">` : t.name}<b>×${p.tools[t.id - 1]}</b></span>`;
    }).join('') || '<span class="info-none">沒有道具</span>';
    // 大富豪模式: a slot holds up to 3 of a card (「停留卡×3」).
    const cards = handStacks(p.cards, stackOf(g)).map(st => `<span class="info-card" data-card="${st.id}" title="${cardName(st.id)}">${cardName(st.id)}${st.n > 1 ? `<b>×${st.n}</b>` : ''}</span>`).join('') || '<span class="info-none">沒有卡片</span>';
    // Two blocks (the figures; 道具 and 卡片): on a small screen that cannot hold both, one at a time (fit()).
    return `<div class="info-blk"><div class="info-grid">
        ${cell('現金', money(p.cash))}${cell('股票', money(stockValue))}
        ${cell('存款', money(p.bank))}${cell('點券', String(p.points))}
        ${cell('貸款', money(p.loan))}${cell('保險', `${p.insurance & 0x7f}天`)}
        ${cell('總資產', money(g.wealth(p)))}${cell('企業', `×${companies}`)}
      </div>
      <div class="info-grid four">
        ${cell('土地', `×${lands.length + facs.length}`)}${cell('連鎖店', `×${lands.filter(l => l.chain).length}`)}
        ${cell('房屋', `×${lands.filter(l => l.level && !l.chain).length}`)}${cell('設施', `×${facs.filter(f => f.level).length}`)}
      </div></div>
      <div class="info-blk"><h4>道具</h4><div class="info-tools">${tools}</div>
      <h4>卡片</h4><div class="info-cards">${cards}</div><div class="info-tip">點一下道具或卡片看用途</div></div><div class="info-pager" hidden></div>`;
  }

  /** 地產: the owned lots and plots, filtered as in the original. */
  private property(): string {
    const g = this.game, me = this.who + 1, F = g.priceIndex;
    const lease = (d: number) => (d ? `${String(year(d) % 100).padStart(2, '0')}/${month(d)}/${day(d)}` : '無限期');
    type Row = { name: string; stage: string; price: number; fee: number; lease: string; facility: boolean };
    const rows: Row[] = [];
    const w = tycoon.world;
    for (const [ci, board] of (w ? w.cities.map(c => c.board) : [g.board]).entries()) {
    // 大富豪模式: grouped by city, a heading row before each city's.
    const start = rows.length;
    if (this.filter !== 2) {
      for (const l of board.lands) {
        if (l.owner !== me) continue;
        if (this.filter === 3 && (!l.level || l.chain)) continue;
        if (this.filter === 4 && !l.chain) continue;
        rows.push({
          name: l.name, stage: l.chain ? '連鎖店' : LAND_STAGES[l.level], price: (l.price + l.level * l.perLevel) * F,
          fee: l.chain ? 2000 * F : l.tolls[l.level] * F, lease: lease(l.expire), facility: false,
        });
      }
    }
    if (this.filter === 0 || this.filter === 2) {
      for (const f of board.facilities) {
        if (f.owner !== me) continue;
        rows.push({
          name: f.name, stage: f.level ? `${FACILITY_TYPES[f.type]}${f.level > 1 ? ` ${f.level}級` : ''}` : '空　地',
          price: f.price * F, fee: (f.fees[f.level] ?? 0) * F, lease: lease(f.expire), facility: true,
        });
      }
    }
    if (w && rows.length > start) rows.splice(start, 0, { name: w.cityName(ci), stage: '', price: -1, fee: 0, lease: '', facility: false });
    }
    const filters = FILTERS.map((t, i) => `<button class="info-filter${i === this.filter ? ' on' : ''}" data-filter="${i}">${t}</button>`).join('');
    const list = rows.length ? rows.map(r => r.price < 0 ? `<tr class="city"><td colspan="5">${r.name}</td></tr>` : `<tr class="${r.facility ? 'fac' : ''}"><td>${r.name}</td><td>${r.stage}</td><td>${money(r.price)}</td><td>${money(r.fee)}</td><td>${r.lease}</td></tr>`).join('')
      : '<tr><td colspan="5" class="info-none">沒有地產</td></tr>';
    return `<div class="info-filters">${filters}</div>
      <table class="info-table"><thead><tr><th>地名</th><th>開發狀況</th><th>價格</th><th>收費</th><th>租期</th></tr></thead><tbody>${list}</tbody></table><div class="info-pager" hidden></div>`;
  }

  /** 股票: the twelve stocks with shares held and their market value. */
  private stocks(): string {
    const w = tycoon.world;
    if (w) {
      // The nationwide market: the stocks this player holds, by city (all 60 would not fit one page).
      let total = 0;
      const rows = w.cities.flatMap((c, ci) => {
        const st = c.stocks as unknown as { stocks: { name: string; price: number }[]; holdings: { shares: number }[][] };
        const h = st.holdings[this.who] ?? [];
        return st.stocks.flatMap((s, i) => {
          const n = h[i]?.shares ?? 0;
          if (!n) return [];
          total += Math.trunc(n * s.price);
          return [`<tr><td><span class="info-city">${w.cityName(ci)}</span>${s.name}</td><td>${n.toLocaleString('en-US')}</td><td>${money(Math.trunc(n * s.price))}</td></tr>`];
        });
      });
      return `<table class="info-table stocks"><thead><tr><th>股票（全國股市）</th><th>張數</th><th>市值</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="3" class="info-none">沒有股票</td></tr>'}
        ${rows.length ? `<tr class="city"><td>合計</td><td></td><td>${money(total)}</td></tr>` : ''}</tbody></table><div class="info-pager" hidden></div>`;
    }
    const st = this.game.stocks as unknown as { stocks: { name: string; price: number }[]; holdings: { shares: number }[][] };
    const h = st.holdings[this.who] ?? [];
    const rows = st.stocks.map((s, i) => {
      const n = h[i]?.shares ?? 0;
      return `<tr${n ? '' : ' class="dim"'}><td>${s.name}</td><td>${n.toLocaleString('en-US')}</td><td>${money(Math.trunc(n * s.price))}</td></tr>`;
    }).join('');
    return `<table class="info-table stocks"><thead><tr><th>股票</th><th>張數</th><th>市值</th></tr></thead><tbody>${rows}</tbody></table><div class="info-pager" hidden></div>`;
  }
}
