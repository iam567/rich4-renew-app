/**
 * 挑戰模式's screens (docs/rules/26 §4): the badge over the map (everyone's stars; tap for the task list), the task list
 * (at the start of a new game and from the badge) and the closing table of stars. The tracker is the game's own
 * (Game.challengeTracker); these only read it.
 */
import { CHALLENGE_TOTAL, CHALLENGE_WIN, fullStars, starsFor, type Challenge, type ChallengeTask } from '../core/challenge';
import { CHARACTERS, playerName } from '../core/characters';
import type { Game } from '../core/game';
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
  if (!years) return `先拿到 ${CHALLENGE_WIN} 顆星的人獲勝（共 ${CHALLENGE_TOTAL} 顆）`;
  const left = Math.max(0, years * 365 - g.daysElapsed);
  return `${years} 年內星最多的人獲勝・還剩 ${left} 天（共 ${CHALLENGE_TOTAL} 顆）`;
}

/** The badge over the map: everyone's stars; a tap opens the task list. */
export class ChallengeBar {
  readonly el = document.createElement('div');
  onOpen: () => void = () => {};
  /** Stars by player and task at the last update, to tell what was just earned. */
  private last: number[][];

  constructor(private g: Game, private face: (character: number) => string) {
    this.el.className = 'chb';
    this.el.innerHTML = '<button class="chb-badge"></button>';
    this.el.addEventListener('click', () => { audio.ui('click'); this.onOpen(); });
    this.last = this.table();
    this.update();
  }

  private table(): number[][] {
    const c = this.g.challengeTracker!;
    return this.g.players.map(p => c.tasks.map(t => starsOf(this.g, c, t, p.id)));
  }

  /** Redraws the badge; returns the stars earned since the last call, for the notes. */
  update(): { p: number; task: ChallengeTask; stars: number }[] {
    const g = this.g, c = g.challengeTracker!;
    const now = this.table(), got: { p: number; task: ChallengeTask; stars: number }[] = [];
    now.forEach((row, p) => row.forEach((s, i) => { if (s > (this.last[p]?.[i] ?? 0)) got.push({ p, task: c.tasks[i], stars: s }); }));
    this.last = now;
    const b = this.el.querySelector('.chb-badge')!;
    b.innerHTML = `<b>★ 任務</b>${g.players.map(p => `<span style="--c:${color(g, p.id)}"><img src="${this.face(p.character)}" alt="">${c.stars(p)}</span>`).join('')}`;
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
    <div class="chl-totals">${players.map(p => `<div style="--c:${color(g, p.id)}"><img src="${face(p.character)}" alt=""><b>${esc(playerName(p))}</b><em>★ ${c.stars(p)}</em></div>`).join('')}</div>`;
  const rows = order.map(t => {
    const full = fullStars(t);
    const how = t.once ? `一次就${'★'.repeat(t.stars)}` : (t.tiers ?? []).map((x, i) => `${'★'.repeat(i + 1)} ${esc(x)}`).join('・');
    const who = players.map(p => { const s = starsOf(g, c, t, p.id); return `<span class="${s ? 'got' : ''}" style="--c:${color(g, p.id)}"><img src="${face(p.character)}" alt="">${starRow(s, full)}</span>`; }).join('');
    const done = players.some(p => starsOf(g, c, t, p.id) >= full);
    return `<li class="${done ? 'done' : ''}"><div class="chl-name"><b>${esc(t.name)}</b>${t.map === -1 ? '' : '<small>本圖</small>'}<i>${'★'.repeat(full)}</i></div>
      <p>${esc(t.desc)}</p>${how ? `<p class="chl-how">${how}</p>` : ''}<div class="chl-who">${who}</div></li>`;
  });
  // Pages, not a scrolled list (the user 2026-11-02: some devices don't scroll): as many tasks as fit, ‹ › or a swipe.
  root.innerHTML = `${head}<ul class="chl-list"></ul><div class="chl-nav"><button class="chip" data-p="-1">‹</button><span></span><button class="chip" data-p="1">›</button></div>`;
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
