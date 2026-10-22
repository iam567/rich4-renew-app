/**
 * The right-hand column of the original screen (docs/rules/09 §3-§4): the player panel with its four tabs and
 * the calendar. Both are laid out in original pixels (200×280 and 200×200) and scaled as a whole.
 */
import { blindsTag, chipMode } from './finale';
import { kbPanelTags } from './kabukicho'; // 歌舞伎町's signs (docs/rules/21)
import { jqPanelTags, jqRules, shownWeekday, shownYear } from './jiqing'; // 激情歲月's 學習班 sign, the year from 1966 (docs/rules/24)
import { CHARACTERS, playerName } from '../core/characters';
import { day, month, weekday, year, daysInMonth, pack } from '../core/date';
import type { Game } from '../core/game';
import type { SpriteBank } from './sprites';
import { todayWeather, WEATHER_NAME, weatherIcon, weatherMode } from './weather';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
// 大富翁城's finale shows chips (docs/rules/19 §2, ui/finale.ts).
const money = (n: number) => (chipMode() ? `${Math.trunc(n / 100).toLocaleString('en-US')}籌碼` : `$${Math.trunc(n).toLocaleString('en-US')}`);
/** NPCs by actor id − npcBase (actors 4..7 and the doll 8 with up to 4 players; 12..16 in 大富豪模式). */
const NPC_NAMES = ['小偷', '強盜', '流氓', '間諜', '機器娃娃'];
const TABS = ['資金', '地產', '股票', '其他'];
/** Centre of each tab's coloured face in Panel#0 (y; x is 184), measured on the redraw: the faces are slanted and
 * sit left of the 24 px column, so the labels are centred on them rather than on the 70 px bands. */
const TAB_MID = [38, 106, 175, 243];
const ROWS = [['現　金', '存　款', '總資產'], ['土　地', '連鎖店', '設　施'], ['總市值', '成　本', '經營權'], ['點　券', '貸　款', '保險期']];
/** Month → season photo (0x475218): 0 spring, 1 summer, 2 autumn, 3 winter. */
const SEASON = [3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];
/** Top of the three value bands in the redrawn panel art (measured; the original's are at 96/160/224). */
const BANDS = [97, 155, 213];
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** A long name (派對模式's own names, up to 7 characters) gets smaller to stay on its line; the characters' are unchanged. */
const fit = (name: string, width: number, size: number) => { const n = [...name].length, px = Math.min(size, Math.floor(width / Math.max(1, n))); return px < size ? ` style="font-size:${px}px"` : ''; };

export class PlayerPanel {
  readonly el: HTMLElement;
  /** Each player remembers their own tab (0x48be24). */
  private tabs: number[] = [0, 0, 0, 0];
  private shown = -1;
  /** 視窗組 2: the 200×80 panel with only cash and deposit (09 §4.4). */
  compact = false;

  constructor(readonly game: Game, readonly bank: SpriteBank) {
    this.el = document.createElement('div');
    this.el.className = 'pp';
    this.el.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!t || !this.game.isPlayerId(this.shown)) return;
      this.tabs[this.shown] = Number(t.dataset.tab);
      this.update();
    });
  }

  /** Shows the current actor (a robot doll shows its owner; NPCs get the plain panel). */
  update() {
    const g = this.game;
    let who = g.current;
    if (who === g.dollId) who = (g.places as unknown as { dollOwner?: number }).dollOwner ?? -1;
    this.shown = who;
    if (!g.isPlayerId(who) || !g.players[who]) { this.npc(g.current); return; }
    const p = g.players[who], ch = CHARACTERS[p.character], tab = this.tabs[who] ?? 0;
    this.el.classList.toggle('compact', this.compact);
    if (this.compact) {
      const bg = this.bank.art('Panel', 0, 4), face = this.bank.art('Data', 2, p.character);
      this.el.innerHTML = `${bg ? `<img class="pp-bg" src="${bg.src}" alt="">` : ''}
        <div class="pp-face small" style="--c:${hex(ch.color)}">${face ? `<img src="${face.src}" alt="">` : ''}</div>
        <div class="pp-cname"${fit(playerName(p), 116, 18)}>${playerName(p)}</div><div class="pp-cbar" style="--c:${hex(ch.color)}"></div>
        <div class="pp-cl" style="top:36px">現金</div><div class="pp-cv" style="top:34px">${money(p.cash)}</div>
        <div class="pp-cl" style="top:56px">存款</div><div class="pp-cv" style="top:54px">${money(p.bank)}</div>`;
      return;
    }
    const bg = this.bank.art('Panel', 0, tab);
    const values = this.values(who, tab);
    const loanDays = tab === 3 && p.loan ? Math.max(0, Math.round((serial(p.loanDue) - serial(g.date)))) : 0;
    const face = this.bank.art('Data', 2, p.character);
    this.el.innerHTML = `
      ${bg ? `<img class="pp-bg" src="${bg.src}" alt="">` : ''}
      <div class="pp-face" style="--c:${hex(ch.color)}">${face ? `<img src="${face.src}" alt="">` : ''}</div>
      <div class="pp-name"${fit(playerName(p), 96, 21)}>${playerName(p)}</div>
      <div class="pp-bar" style="--c:${hex(ch.color)}"></div>
      ${p.ally ? `<div class="pp-ally" title="同盟">${this.mini(g.players[p.ally - 1]?.character ?? 0)}</div>` : ''}
      ${p.autopilot ? '<div class="pp-auto">托管中</div>' : ''}
      ${kbPanelTags(g, p)}${jqPanelTags(g, p)}
      ${g.world ? g.world.hooks.overlordTitles(p).map((t, i) => `<div class="pp-overlord" style="--i:${i}">${t}</div>`).join('') : ''}
      ${ROWS[tab].map((label, i) => `<div class="pp-row" style="top:${BANDS[i]}px">
        <span class="pp-label">${label}${i === 1 && loanDays ? `<em>${loanDays}天</em>` : ''}</span><span class="pp-value${values[i].length > 11 ? ' longer' : values[i].length > 8 ? ' long' : ''}">${values[i]}</span></div>`).join('')}
      <div class="pp-price">物價指數 ${g.priceIndex}${blindsTag()}</div>
      ${TABS.map((t, i) => `<button class="pp-tab${i === tab ? ' on' : ''}" data-tab="${i}" style="top:${TAB_MID[i] - 35}px">${t.split('').join('<br>')}</button>`).join('')}`;
  }

  private mini(character: number): string {
    const f = this.bank.art('Data', 2, character);
    return f ? `<img src="${f.src}" alt="">` : '';
  }

  private npc(actor: number) {
    const bg = this.bank.art('Panel', 0, 5);
    this.el.innerHTML = `${bg ? `<img class="pp-bg" src="${bg.src}" alt="">` : ''}<div class="pp-name npc">${NPC_NAMES[actor - this.game.npcBase] ?? ''}</div>`;
  }

  /** The three numbers of a tab (09 §4.3). */
  private values(who: number, tab: number): string[] {
    const g = this.game, p = g.players[who], me = who + 1;
    // 大富豪模式: every city's properties and the nationwide market (docs/rules/17 §12).
    const boards = g.boards();
    if (tab === 0) return [money(p.cash), money(p.bank), money(g.wealth(p))];
    if (tab === 1) {
      const lands = boards.flatMap(b => b.lands.filter(l => l.owner === me)), facs = boards.flatMap(b => b.facilities.filter(f => f.owner === me));
      return [String(lands.length + facs.length), String(lands.filter(l => l.chain).length), String(facs.filter(f => f.level).length)];
    }
    if (tab === 2) {
      let value = 0, cost = 0;
      for (const m of g.markets()) {
        const st = m as unknown as { holdings: { shares: number; avgCost: number }[][]; stocks: { price: number }[] };
        const h = st.holdings[who] ?? [];
        h.forEach((x, i) => { value = Math.trunc(value + x.shares * (st.stocks[i]?.price ?? 0)); cost = Math.trunc(cost + x.shares * x.avgCost); });
      }
      return [money(value), money(cost), String(boards.reduce((n, b) => n + b.companies.filter(c => c.controller === me).length, 0))];
    }
    return [String(p.points), money(p.loan), `${p.insurance & 0x7f}天`];
  }
}

const serial = (d: number) => Date.UTC(year(d), month(d) - 1, day(d)) / 86400000;

export class Calendar {
  readonly el: HTMLElement;
  /** RICH4.CFG +12: 0 day view, 1 month view. */
  private monthView = false;

  constructor(readonly game: Game, readonly bank: SpriteBank) {
    this.el = document.createElement('div');
    this.el.className = 'cal';
    try { this.monthView = localStorage.getItem('rich4.calendar') === 'month'; } catch { /* default */ }
    this.el.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-view]');
      if (!t) return;
      this.monthView = t.dataset.view === 'month';
      try { localStorage.setItem('rich4.calendar', this.monthView ? 'month' : 'day'); } catch { /* not kept */ }
      this.update();
    });
  }

  update() {
    if (jqRules(this.game)) { this.tearOff(); return; }
    const d = this.game.date, m = month(d), w = weekday(d), red = w === 0;
    const photo = this.bank.art('Panel', 2, (this.monthView ? 4 : 0) + SEASON[m - 1]);
    let body = '';
    if (this.monthView) {
      const first = weekday(pack(year(d), m, 1)), n = daysInMonth(year(d), m);
      for (let i = 1; i <= n; i++) {
        const cell = first + i - 1, x = 30 + 23 * (cell % 7), y = 98 + 14 * Math.floor(cell / 7);
        body += `<span class="cal-d${cell % 7 === 0 ? ' red' : ''}${i === day(d) ? ' today' : ''}" style="left:${x}px;top:${y}px">${i}</span>`;
      }
    } else {
      body = `<div class="cal-wd${red ? ' red' : ''}">${WEEKDAYS[w].split('').join('<br>')}</div>
        <div class="cal-day${red ? ' red' : ''}">${day(d)}</div>`;
    }
    const sun = this.bank.art('Panel', 2, this.monthView ? 9 : 8), moon = this.bank.art('Panel', 2, this.monthView ? 10 : 11);
    // Today's weather (the remake's addition, docs/rules/16): a small toy icon with its name; none on the theme maps.
    const wx = weatherMode() === 2 ? null : todayWeather(this.game);
    const wxBox = wx ? `<div class="cal-wx${this.monthView ? ' month' : ''}" data-wx="${wx.kind}" title="今日天氣：${WEATHER_NAME[wx.kind]}">${weatherIcon(wx.kind)}<span>${WEATHER_NAME[wx.kind]}</span></div>` : '';
    this.el.innerHTML = `${photo ? `<img class="cal-bg" src="${photo.src}" alt="">` : ''}
      ${this.monthView ? '' : `${sun ? `<img class="cal-icon" src="${sun.src}" style="left:22px;top:20px" alt="">` : ''}${moon ? `<img class="cal-icon" src="${moon.src}" style="left:52px;top:21px" alt="">` : ''}`}
      <button class="cal-hit" data-view="day" style="left:8px" aria-label="日視圖"></button>
      <button class="cal-hit" data-view="month" style="left:38px" aria-label="月視圖"></button>
      <div class="cal-year">${shownYear(this.game, d)}</div><div class="cal-month">${m}月</div>${body}${wxBox}`;
  }

  /**
   * 激情歲月 (docs/rules/24 §11): a 1970s tear-off desk calendar instead of the photo calendar — a red header with the
   * year and the month, the big day, the weekday (of the shown year: 1966-10-22 is a Saturday), today's weather; the
   * month view a plain grid under the header. A tap anywhere switches the views. Only shown: the rules' dates are the game's.
   */
  private tearOff() {
    const g = this.game, d = g.date, m = month(d), y = shownYear(g, d), w = shownWeekday(g, d), red = w === 0;
    const wx = weatherMode() === 2 ? null : todayWeather(g);
    const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
    let body = '';
    if (this.monthView) {
      const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), n = new Date(Date.UTC(y, m, 0)).getUTCDate();
      body = `<div class="tc-grid">${['日', '一', '二', '三', '四', '五', '六'].map((h, i) => `<b class="${i ? '' : 'red'}">${h}</b>`).join('')}${
        '<i></i>'.repeat(first)}${Array.from({ length: n }, (_, i) => { const c = (first + i) % 7; return `<span class="${c ? '' : 'red'}${i + 1 === day(d) ? ' today' : ''}">${i + 1}</span>`; }).join('')}</div>`;
    } else {
      body = `<div class="tc-day${red ? ' red' : ''}">${day(d)}</div><div class="tc-wd${red ? ' red' : ''}">${WEEKDAYS[w]}</div>
        ${wx ? `<div class="tc-wx" data-wx="${wx.kind}" title="今日天氣：${WEATHER_NAME[wx.kind]}">${weatherIcon(wx.kind)}<span>${WEATHER_NAME[wx.kind]}</span></div>` : ''}`;
    }
    this.el.innerHTML = `<div class="tc${this.monthView ? ' month' : ''}"><i class="tc-rings"></i><div class="tc-head"><b>${y}</b><span>${CN[m]}月</span></div>${body}
      <button class="cal-hit tc-hit" data-view="${this.monthView ? 'day' : 'month'}" aria-label="${this.monthView ? '日視圖' : '月視圖'}"></button></div>`;
  }
}

/**
 * Portrait only (the remake's addition): the 200×80 corner under the right-hand widget otherwise stays empty, so
 * it holds the other widget at 80×80 (style.css) and this card beside it — today's date, weekday, weather and the
 * price index, in the panel's parchment look. 全部 shows both widgets already, and the card takes the whole corner.
 * Rewritten only when one of its values changes (it follows the HUD's refresh, never a frame loop).
 */
export class SideToday {
  readonly el: HTMLElement;
  private last = '';

  constructor(readonly game: Game) {
    this.el = document.createElement('div');
    this.el.className = 'st';
  }

  update() {
    const g = this.game, d = g.date, w = jqRules(g) ? shownWeekday(g, d) : weekday(d);
    const wx = weatherMode() === 2 ? null : todayWeather(g);
    const html = `${wx ? `<div class="st-wx" data-wx="${wx.kind}" title="今日天氣：${WEATHER_NAME[wx.kind]}">${weatherIcon(wx.kind)}<span>${WEATHER_NAME[wx.kind]}</span></div>` : ''}
      <div class="st-date">${month(d)}月${day(d)}日</div><div class="st-wd${w === 0 ? ' red' : ''}">${WEEKDAYS[w]}</div>
      <div class="st-price">物價指數 <b>${g.priceIndex}</b></div>`;
    if (html === this.last) return;
    this.last = html;
    this.el.classList.toggle('nowx', !wx);
    this.el.innerHTML = html;
  }
}
