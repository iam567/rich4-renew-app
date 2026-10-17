/**
 * 大富豪模式 titles and endings (docs/rules/17 §11): the award each time a rival goes bankrupt (11 tiers, the medal
 * rising from bronze to the crown of 首富大富豪), the winner's results (podium, the human's total assets month by
 * month, the order the rivals fell, lots by city, cities visited) and the losing screen.
 */
import { CHARACTERS } from '../core/characters';
import { format } from '../core/date';
import { TITLES, type World } from '../core/world';
import { EVENT_LINES } from './lines';
import { EVENT_VOICE } from './voices';
import { audio, Sfx, Theme } from './audio';
import { fxScreens, type ScreenContext } from './screens/registry';
import { CITY_COLORS } from './tycoon';
import { showResults, type ResultsAction } from './results';
import { worldResults } from '../core/stats';
import { phrases } from './text';
import './tycoon-ending.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const money = (n: number) => `$${Math.trunc(n).toLocaleString('en-US')}`;

/** Medal tier by rank 1..11: bronze, silver, gold, platinum, crown. */
export const tier = (rank: number) => (rank >= 11 ? 'crown' : rank >= 10 ? 'platinum' : rank >= 7 ? 'gold' : rank >= 4 ? 'silver' : 'bronze');
/** The human's boast after a rival falls (the character's own lines: 這是我應得的, 我真佩服自己, 我是個大地主 …). */
const BOAST = [6, 15, 16, 17, 1, 0, 6, 15, 16, 17, 7];

function face(ctx: ScreenContext, character: number, cls = ''): string {
  const f = ctx.bank.art('Data', 2, character);
  return `<span class="te-face ${cls}" style="--c:${hex(CHARACTERS[character].color)}">${f ? `<img src="${f.src}" alt="">` : ''}</span>`;
}

function say(character: number, k: number): string {
  const text = EVENT_LINES[character]?.[k] ?? '';
  void audio.voice(EVENT_VOICE[character]?.[k]);
  return text;
}

/** A layer over the whole game screen, closed by a tap (after `min` ms) or after `max` ms. */
function cover(ctx: ScreenContext, cls: string, html: string, min: number, max: number): Promise<void> {
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.className = `te-cover ${cls}`;
    root.innerHTML = html;
    (ctx.shell ?? ctx.area).append(root);
    const t0 = performance.now();
    let done = false;
    const close = () => { if (done) return; done = true; root.classList.add('out'); setTimeout(() => root.remove(), 300); resolve(); };
    root.addEventListener('click', () => { if (performance.now() - t0 > min) close(); });
    setTimeout(close, max);
  });
}

const confetti = (n: number) => Array.from({ length: n }, (_, i) =>
  `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.18}s;--h:${(i * 53) % 360}"></i>`).join('');

/** The award (tycoon-title fx): medal with the tier, the title, the fallen rival greyed, the human's boast. */
fxScreens['tycoon-title'] = async (ctx, s) => {
  const d = (s.data ?? {}) as { title?: string; rank?: number; left?: number; fallen?: number };
  const rank = d.rank ?? 1, t = tier(rank), g = ctx.game;
  const me = g.players[s.p ?? 0], fallen = d.fallen !== undefined ? g.players[d.fallen] : undefined;
  audio.sfx(Sfx.fireworks);
  const line = say(me.character, BOAST[(rank - 1) % BOAST.length]);
  await cover(ctx, `te-award ${t}`, `<div class="te-rays"></div><div class="te-confetti">${confetti(rank >= 7 ? 36 : 18)}</div>
    <div class="te-award-box">
      ${fallen ? `<div class="te-fallen">${face(ctx, fallen.character, 'grey')}<span>${esc(CHARACTERS[fallen.character].name)}破產了</span></div>` : ''}
      <div class="te-medal ${t}"><b>${rank}</b></div>
      <div class="te-sub">獲得新稱號</div>
      <div class="te-title">${[...(d.title ?? '')].map((c, i) => `<span style="--i:${i}">${esc(c)}</span>`).join('')}</div>
      <div class="te-me">${face(ctx, me.character)}${line ? `<span class="te-bubble">${esc(line)}</span>` : ''}</div>
      <div class="te-left">還剩 ${d.left ?? 0} 位對手 · 第 ${rank} / 11 個稱號</div>
    </div>`, 900, 4200 * Math.max(0.7, ctx.scale()));
};

/** The human's total assets by month (and now), with the eleven rivals faint behind it. */
function curve(w: World): string {
  const h = w.human();
  if (!h) return '';
  const pts = [...w.history.map(x => x.wealth), w.players.map(p => (p.bankrupt ? 0 : w.wealth(p)))];
  if (pts.length < 2) pts.unshift(w.players.map(() => w.fund));
  const W = 520, H = 170, max = Math.max(1, ...pts.flat());
  const x = (i: number) => 8 + (i / (pts.length - 1)) * (W - 16), y = (v: number) => H - 10 - (v / max) * (H - 24);
  const path = (k: number) => pts.map((row, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(row[k] ?? 0).toFixed(1)}`).join('');
  const rivals = w.players.filter(p => p !== h).map(p => `<path d="${path(p.id)}" class="riv" style="stroke:${hex(CHARACTERS[p.character].color)}"/>`).join('');
  return `<svg class="te-curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${rivals}<path d="${path(h.id)}" class="me"/>
    <text x="10" y="16">${money(max)}</text></svg>`;
}

function stats(ctx: ScreenContext, w: World): string {
  const h = w.human()!, me = h.id + 1;
  const lots = w.cities.map((c, i) => ({ i, n: c.board.lands.filter(l => l.owner === me).length + c.board.facilities.filter(f => f.owner === me).length }));
  const fell = w.fallen.filter(f => f.p !== h.id).map((f, k) => `<div class="te-fell">${face(ctx, w.players[f.p].character, 'grey')}
    <b>${k + 1}</b><span>${esc(w.name(f.p))}</span><small>第${f.day + 1}天・${esc(w.cityName(f.map))}</small></div>`).join('');
  const visited = w.cities.map((_c, i) => `<span class="te-city${w.visited[h.id].includes(i) ? ' on' : ''}" style="--cc:${CITY_COLORS[w.mapId(i)]}">${esc(w.cityName(i))}</span>`).join('');
  return `<div class="te-stats">
    <h4>總資產走勢</h4>${curve(w)}
    <h4>對手破產順序</h4><div class="te-fells">${fell || '<p class="te-none">沒有對手破產</p>'}</div>
    <div class="te-row"><div><h4>各城地產</h4><div class="te-lots">${lots.map(l => `<span style="--cc:${CITY_COLORS[w.mapId(l.i)]}">${esc(w.cityName(l.i))} <b>${l.n}</b></span>`).join('')}</div></div>
    <div><h4>去過的城市</h4><div class="te-cities">${visited}</div></div></div></div>`;
}

/**
 * The end of a world: the winner's podium or the losing scene, inside the results screen (results.ts) with the ranking
 * of all twelve, everyone's statistics and this world's curve, rivals' fall, lots by city and cities visited. Resolves
 * with the player's choice (「下一局」 when `next` started a new game, else 「回到主畫面」).
 */
export async function tycoonEnding(ctx: ScreenContext, w: World, winner: number, next?: () => Promise<boolean>): Promise<ResultsAction> {
  const h = w.human();
  if (!h) return 'home';
  const won = winner === h.id;
  audio.theme(won ? Theme.ending : Theme.bankrupt, true);
  const ch = h.character;
  const line = say(ch, won ? 24 : 25);
  const rank = w.players.filter(p => !p.bankrupt).length + 1;
  const second = w.fallen[w.fallen.length - 1], third = w.fallen[w.fallen.length - 2];
  const hero = won
    ? `<div class="te-hero won"><div class="te-crown"></div><div class="te-big">${esc(TITLES[TITLES.length - 1])}</div>
        <div class="te-podium">
          ${second ? `<div class="p2">${face(ctx, w.players[second.p].character, 'grey')}<b>2</b></div>` : ''}
          <div class="p1">${face(ctx, ch)}<b>1</b></div>
          ${third ? `<div class="p3">${face(ctx, w.players[third.p].character, 'grey')}<b>3</b></div>` : ''}
        </div>
        ${line ? `<span class="te-bubble te-say">${esc(line)}</span>` : ''}
        <div class="te-sub">${phrases(`${CHARACTERS[ch].name}獲勝，11 位對手全部破產！（${format(w.date)}，第 ${w.daysElapsed + 1} 天）`)}</div></div>`
    : `<div class="te-hero lost"><div class="te-big">破產了……</div>
        <div class="te-lost">${face(ctx, ch, 'grey')}<span class="te-bubble">${esc(line)}</span></div>
        <div class="te-sub">${phrases(`${CHARACTERS[ch].name}是第 ${rank} 名・撐了 ${w.daysElapsed + 1} 天・${w.fallen.filter(f => f.p !== h.id).length} 位對手比你先倒下`)}</div></div>`;
  return showResults(ctx.bank, ctx.shell ?? ctx.area, worldResults(w, winner), {
    mapName: w.finale.active ? '大富豪模式・大富翁城' : '大富豪模式', hero, extra: stats(ctx, w), cls: `te-end-rs ${won ? 'won' : 'lost'}`, next,
  });
}
