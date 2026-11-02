/**
 * 挑戰模式's screens (docs/rules/26 §4): the badge over the map (everyone's stars; tap for the task list), the task list
 * (at the start of a new game and from the badge) and the closing table of stars. The tracker is the game's own
 * (Game.challengeTracker); these only read it.
 */
import { CHALLENGE_TOTAL, CHALLENGE_WIN, fullStars, starsFor, type Challenge, type ChallengeTask } from '../core/challenge';
import { CHARACTERS, playerName } from '../core/characters';
import { month as monthOf } from '../core/date';
import type { Game } from '../core/game';
import { monthlyById, monthlyDesc, MONTHLY_RULE, type MonthlyTask } from '../core/monthly';
import { ASSETS } from './assets';
import { audio } from './audio';
import './challenge.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const color = (g: Game, p: number) => `#${CHARACTERS[g.players[p].character].color.toString(16).padStart(6, '0')}`;
const allOf = (g: Game, t: ChallengeTask) => (t.id === 'G33' || t.id === 'W01' ? g.board.companies.length : Infinity);
/** Stars of player `p` on task `t`. */
const starsOf = (g: Game, c: Challenge, t: ChallengeTask, p: number) => starsFor(t, c.own[p].best[t.id] ?? 0, allOf(g, t));

/** ★ for each star earned, ☆ for each one still open. */
const starRow = (got: number, full: number) => `<i class="chl-on">${'★'.repeat(got)}</i><i class="chl-off">${'☆'.repeat(Math.max(0, full - got))}</i>`;

/** The line under the title: how this game is won and how long it still runs. */
export function challengeGoal(g: Game): string {
  const years = g.settings.challengeYears ?? 0;
  const total = g.challengeTracker?.monthly ? `${CHALLENGE_TOTAL} 顆＋每月` : `共 ${CHALLENGE_TOTAL} 顆`;
  if (!years) return `先拿到 ${CHALLENGE_WIN} 顆星的人獲勝（${total}）`;
  const left = Math.max(0, years * 365 - g.daysElapsed);
  return `${years} 年內星最多的人獲勝・還剩 ${left} 天（${total}）`;
}

/** Stars by player and task, telling what was earned since the last look (挑戰模式's badge, a normal game's 圖鑑). */
export class StarWatch {
  private last: number[][];
  constructor(private g: Game) { this.last = this.table(); }

  private table(): number[][] {
    const c = this.g.challengeTracker!;
    return this.g.players.map(p => c.tasks.map(t => starsOf(this.g, c, t, p.id)));
  }

  /** The stars earned since the last call. */
  update(): { p: number; task: ChallengeTask; stars: number }[] {
    const c = this.g.challengeTracker!, now = this.table(), got: { p: number; task: ChallengeTask; stars: number }[] = [];
    now.forEach((row, p) => row.forEach((s, i) => { if (s > (this.last[p]?.[i] ?? 0)) got.push({ p, task: c.tasks[i], stars: s }); }));
    this.last = now;
    return got;
  }
}

// ---------------------------------------------------------------- 每月任務 (core/monthly.ts, docs/rules/27)

const MONTH_ART = `${ASSETS}/maps/remake/challenge`;
const money = (v: number) => (Math.abs(v) >= 10000 ? `${+(v / 10000).toFixed(1)} 萬` : `${v}`);

/** A month's card that ended or was taken: the card and who took it (none: nobody). */
export interface MonthResult { task: MonthlyTask; won: number[] }

/** What changed in the month's cards since the last look: a card taken or decided, a new card drawn. */
export class MonthWatch {
  private seq: number;
  private logged: number;
  /** Months already told (a 搶先 card taken in its month). */
  private told = new Set<number>();
  constructor(private g: Game) {
    const c = g.challengeTracker!;
    this.seq = c.month?.seq ?? -1;
    this.logged = c.monthLog.length;
    if (c.month?.done) this.told.add(c.month.seq);
  }

  update(): { results: MonthResult[]; drawn: boolean } {
    const c = this.g.challengeTracker!, results: MonthResult[] = [];
    for (const l of c.monthLog.slice(this.logged)) {
      const task = monthlyById.get(l.id);
      if (task && !this.told.has(l.seq)) results.push({ task, won: l.won });
      this.told.add(l.seq);
    }
    this.logged = c.monthLog.length;
    const m = c.month, task = c.monthTask();
    if (m && task && m.done && !this.told.has(m.seq)) { this.told.add(m.seq); results.push({ task, won: m.won }); }
    const drawn = !!m && m.seq !== this.seq;
    this.seq = m?.seq ?? this.seq;
    return { results, drawn };
  }
}

/** Player p's progress on the month's card, as shown: 搶先 a/goal, 比拼 the figure, 堅持 ✓ / ✗. */
function monthShown(g: Game, p: number): string {
  const c = g.challengeTracker!, t = c.monthTask()!, v = c.monthValue(g.players[p]);
  if (t.kind === 'keep') return v === 0 ? '✓' : '✗';
  const val = t.money ? money(v) : String(v);
  return val;
}

/** The month's card for the task list and the new month's notice: its picture, rule, goal, and everyone on it. */
export function monthCard(g: Game, face: (character: number) => string, big = false): HTMLElement {
  const c = g.challengeTracker!, m = c.month, t = c.monthTask(), el = document.createElement('div');
  el.className = `chl-month${big ? ' big' : ''}`;
  if (!m || !t) { el.innerHTML = '<p class="chl-month-none">本月任務：下個月 1 日抽第一張</p>'; return el; }
  const who = g.players.map(p => {
    const won = m.won.includes(p.id);
    return `<span class="${won ? 'got' : ''}" style="--c:${color(g, p.id)}"><img src="${face(p.character)}" alt="">${won ? '<i class="chl-on">★★★</i>' : m.done ? '' : esc(monthShown(g, p.id))}</span>`;
  }).join('');
  el.innerHTML = `<span class="chl-month-art"><img class="chl-month-pic" src="${MONTH_ART}/${t.id}.webp" alt="" onerror="this.style.visibility='hidden'"></span>
    <div class="chl-month-body"><small>本月任務・到 ${monthOf(g.date)} 月底${m.done ? '・已結束' : ''}</small>
      <b>${esc(t.name)}</b><p>${esc(monthlyDesc(t, c.monthGoal()))}</p><p class="chl-how">${esc(MONTHLY_RULE[t.kind])}</p>
      <div class="chl-who${g.players.length > 4 ? ' many' : ''}">${who}</div></div>`;
  return el;
}

/** A new month's notice: last month's result (if any) and the new card. */
export function monthNotice(g: Game, face: (character: number) => string, last: MonthResult[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'chl chl-notice';
  const names = (ids: number[]) => ids.map(i => esc(playerName(g.players[i]))).join('、');
  const lines = last.map(r => `<p class="chl-last">上月「${esc(r.task.name)}」${r.won.length ? `${names(r.won)} ★★★` : '沒人拿到'}</p>`).join('');
  root.innerHTML = lines;
  root.append(monthCard(g, face, true));
  return root;
}

/** The badge over the map: everyone's stars; a tap opens the task list. */
export class ChallengeBar {
  readonly el = document.createElement('div');
  readonly watch: StarWatch;
  onOpen: () => void = () => {};

  constructor(private g: Game, private face: (character: number) => string) {
    this.el.className = 'chb';
    this.el.innerHTML = '<button class="chb-badge"></button><button class="chb-month" hidden></button>';
    this.el.addEventListener('click', () => { audio.ui('click'); this.onOpen(); });
    this.watch = new StarWatch(g);
    this.update();
  }

  /** Redraws the badge; returns the stars earned since the last call, for the notes. */
  update(): { p: number; task: ChallengeTask; stars: number }[] {
    const g = this.g, c = g.challengeTracker!, got = this.watch.update();
    const b = this.el.querySelector('.chb-badge')!;
    b.classList.toggle('many', g.players.length > 4);
    b.innerHTML = `<b>★任務</b>${g.players.map(p => `<span style="--c:${color(g, p.id)}"><img src="${this.face(p.character)}" alt=""><em>${c.stars(p)}</em></span>`).join('')}`;
    const mb = this.el.querySelector<HTMLElement>('.chb-month')!, t = c.monthTask();
    mb.hidden = !t;
    if (t) { mb.classList.toggle('done', !!c.month?.done); mb.textContent = `本月：${t.name}${c.month?.done ? ' ✓' : ''}`; }
    return got;
  }
}

/** The task list: the goal, everyone's totals, then every task with its tiers and each player's stars. */
export function taskList(g: Game, face: (character: number) => string): HTMLElement {
  const c = g.challengeTracker!, root = document.createElement('div');
  root.className = 'chl';
  const players = g.players;
  const order = [...c.tasks].sort((a, b) => (a.map === -1 ? 0 : 1) - (b.map === -1 ? 0 : 1) || a.id.localeCompare(b.id));
  const head = `<p class="chl-goal">${esc(challengeGoal(g))}</p>
    <div class="chl-totals${players.length > 4 ? ' many' : ''}">${players.map(p => `<div style="--c:${color(g, p.id)}"><img src="${face(p.character)}" alt=""><b>${esc(playerName(p))}</b><em>★${c.stars(p)}</em></div>`).join('')}</div>
    ${c.monthly ? '<div class="chl-month-slot"></div>' : ''}`;
  const rows = order.map(t => {
    const full = fullStars(t);
    const how = t.once ? `可獲得 ${'★'.repeat(t.stars)}` : (t.tiers ?? []).map((x, i) => `${'★'.repeat(i + 1)} ${esc(x)}`).join('・');
    // Each player: the face and the stars earned (the full marks are on the name's line), all on the tiers' line.
    const who = players.map(p => { const s = starsOf(g, c, t, p.id); return `<span class="${s ? 'got' : ''}" style="--c:${color(g, p.id)}"><img src="${face(p.character)}" alt=""><i class="chl-on">${s ? `★${s}` : ''}</i></span>`; }).join('');
    const done = players.some(p => starsOf(g, c, t, p.id) >= full);
    return `<li class="${done ? 'done' : ''}"><div class="chl-name"><b>${esc(t.name)}</b>${t.map === -1 ? '' : '<small>本圖</small>'}<i>${'★'.repeat(full)}</i></div>
      <p class="chl-desc">${esc(t.desc)}</p><div class="chl-foot"><p class="chl-how">${how}</p><div class="chl-who${players.length > 4 ? ' many' : ''}">${who}</div></div></li>`;
  });
  // Pages, not a scrolled list (the user 2026-11-02: some devices don't scroll): as many tasks as fit, ‹ › or a swipe.
  root.innerHTML = `${head}<ul class="chl-list"></ul><div class="chl-nav"><button class="chip" data-p="-1">‹</button><span></span><button class="chip" data-p="1">›</button></div>`;
  root.querySelector('.chl-month-slot')?.replaceWith(monthCard(g, face));
  const list = root.querySelector<HTMLElement>('.chl-list')!, at = root.querySelector<HTMLElement>('.chl-nav span')!;
  let starts = [0], page = 0, size = '';
  /** Fills the list from task `from` until the next one would not fit; returns where the next page starts. */
  const fill = (from: number) => {
    list.innerHTML = '';
    let i = from;
    for (; i < rows.length; i++) {
      list.insertAdjacentHTML('beforeend', rows[i]);
      if (i > from && list.scrollHeight > list.clientHeight + 1) { list.lastElementChild!.remove(); break; }
    }
    return i;
  };
  const show = (n: number) => {
    page = Math.max(0, Math.min(starts.length - 1, n));
    fill(starts[page]);
    at.textContent = `${page + 1} / ${starts.length}`;
    root.querySelector<HTMLButtonElement>('[data-p="-1"]')!.disabled = page === 0;
    root.querySelector<HTMLButtonElement>('[data-p="1"]')!.disabled = page === starts.length - 1;
  };
  const paginate = () => {
    if (!list.clientHeight) return;
    const key = `${list.clientWidth}x${list.clientHeight}`;
    if (key === size) return;
    size = key;
    const first = starts[page] ?? 0;
    starts = [0];
    for (let i = fill(0); i < rows.length; i = fill(i)) starts.push(i);
    show(starts.filter(s => s <= first).length - 1);
  };
  new ResizeObserver(() => { if (root.isConnected) paginate(); }).observe(list);
  root.addEventListener('click', e => {
    const d = (e.target as HTMLElement).closest<HTMLElement>('[data-p]')?.dataset.p;
    if (d) { audio.ui('click'); show(page + Number(d)); }
  });
  let x0: number | null = null;
  list.addEventListener('pointerdown', e => { x0 = e.clientX; });
  list.addEventListener('pointerup', e => {
    if (x0 !== null && Math.abs(e.clientX - x0) > 40) { audio.ui('click'); show(page + (e.clientX < x0 ? 1 : -1)); }
    x0 = null;
  });
  return root;
}

/** The stars at the end, most first (the results screen follows). */
export function starTable(g: Game, winner: number, face: (character: number) => string): HTMLElement {
  const c = g.challengeTracker!, root = document.createElement('div');
  root.className = 'chl chl-end';
  const rank = [...g.players].sort((a, b) => c.stars(b) - c.stars(a) || g.wealth(b) - g.wealth(a));
  root.innerHTML = `<p class="chl-goal">${esc(winner >= 0 ? `${playerName(g.players[winner])} 獲勝！` : '挑戰結束')}</p>
    <ol class="chl-rank">${rank.map(p => {
      const done = c.tasks.filter(t => starsOf(g, c, t, p.id) >= fullStars(t)).length;
      return `<li class="${p.id === winner ? 'win' : ''}" style="--c:${color(g, p.id)}"><img src="${face(p.character)}" alt=""><b>${esc(playerName(p))}</b>
        <em>★ ${c.stars(p)}</em><small>完成 ${done}／${c.tasks.length} 個任務</small></li>`;
    }).join('')}</ol>`;
  return root;
}
