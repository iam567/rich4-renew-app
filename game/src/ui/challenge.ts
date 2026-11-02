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
  }).join('');
  root.innerHTML = `${head}<ul class="chl-list">${rows}</ul>`;
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
