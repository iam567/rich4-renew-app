/**
 * The results screen (docs/rules/20 §4) at the end of every game: classic maps, 大富豪模式 (its 首富大富豪 ending puts
 * its podium and curve in here, tycoon-ending.ts) and 大富翁城. The winner with the portrait, the ranking of everyone,
 * the statistics ledger of the chosen player (core/stats.ts), and 「儲存到相簿」 / 「分享」 (a picture drawn by
 * results-card.ts), 「下一局」 (pick the next map, next-game.ts) and 「回到主畫面」.
 */
import { CHARACTERS } from '../core/characters';
import { format } from '../core/date';
import { cardName } from '../core/modules/cards';
import { OBJECT_NAMES } from '../core/modules/objects';
import { TOOLS } from '../core/modules/tools';
import { sum, type GameResults, type PlayerResult } from '../core/stats';
import type { MapInfo } from './assets';
import { audio, Sfx } from './audio';
import { drawOpponents, type RunRecord } from './next-game';
import { drawResultsCard, statIcon, type StatIcon } from './results-card';
import { saveImage, shareImage } from './share';
import type { SpriteBank } from './sprites';
import './results.css';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
export const money = (n: number) => Math.trunc(n).toLocaleString('en-US');
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
/** Facility types (02 §4, 大富翁城's halls 5..9). */
export const FACILITY_NAMES = ['公園', '旅館', '購物中心', '加油站', '研究所', '輪盤館', '二十一點館', '百家樂館', '德州撲克館', '骰寶館'];
const toolName = (id: number) => TOOLS.find(t => t.id === id)?.name ?? `道具${id}`;

const icon = (name: StatIcon, cls = 'rs-ic') => `<img class="${cls}" src="${statIcon(name)}" alt="" onerror="this.remove()">`;

export interface ResultsOptions {
  /** The map's name (or 大富豪模式's). */
  mapName: string;
  /** Replaces the winner banner (大富豪模式's podium / losing scene). */
  hero?: string;
  /** More of the screen under the player's statistics (大富豪模式's curve, rivals' fall, lots by city). */
  extra?: string;
  /** Extra class on the cover (won / lost …). */
  cls?: string;
  /**
   * 「下一局」 (shown when given): picks the next map over the results; true when a new game starts (the results go),
   * false to stay on the results.
   */
  next?: () => Promise<boolean>;
}

export type ResultsAction = 'next' | 'home';

/** The player shown first: the human (the one who won when several), else the winner. */
export function featured(r: GameResults): PlayerResult {
  return r.players.find(p => p.human && p.winner) ?? r.players.find(p => p.human) ?? r.players[0];
}

function face(bank: SpriteBank, character: number, cls = ''): string {
  const f = bank.art('Data', 2, character);
  return `<span class="rs-face ${cls}" style="--c:${hex(CHARACTERS[character].color)}">${f ? `<img src="${f.src}" alt="">` : ''}</span>`;
}

const top = (m: Record<number, number>, name: (id: number) => string, n = 4) => Object.entries(m).filter(([, v]) => v > 0)
  .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0])).slice(0, n).map(([id, v]) => `<span class="rs-chip">${esc(name(Number(id)))}<b>×${v}</b></span>`).join('');

/** The statistics of one player as tiles and chips. */
export function statTiles(x: PlayerResult, cityNames?: string[]): string {
  const s = x.stats;
  const tile = (ic: StatIcon, label: string, value: string, sub = '', cls = '') =>
    // The icon beside the label; the wide tile (總資產) has it big on the left.
    cls.includes('wide')
      ? `<div class="rs-tile ${cls}">${icon(ic)}<div class="rs-tile-text"><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div></div>`
      : `<div class="rs-tile ${cls}"><div class="rs-tile-text"><small>${icon(ic, 'rs-ic label')}${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div></div>`;
  const facs = Object.entries(s.facilitiesBuilt).filter(([, v]) => v > 0).map(([t, v]) => `${FACILITY_NAMES[Number(t)] ?? '設施'}${v > 1 ? `×${v}` : ''}`).join('、');
  const tiles = [
    tile('assets', '總資產', money(x.assets), `最高 ${money(Math.max(s.maxAssets, x.assets))}`, 'wide'),
    tile('money', '現金＋存款', money(s.finalCash + s.finalBank), s.finalLoan ? `貸款 ${money(s.finalLoan)}` : ''),
    tile('land', '買地', `${s.landsBought} 塊`, s.landSpent ? `花 ${money(s.landSpent)}` : ''),
    tile('build', '蓋房', `${s.buildings} 次`, `共加 ${s.levelsAdded} 級`),
    tile('facility', '大型設施', `${sum(s.facilitiesBuilt)} 座`, facs || (s.plotsBought ? `買下 ${s.plotsBought} 塊用地` : '')),
    tile('stock', '股票獲利', signed(s.stockProfit), `未實現 ${signed(s.unrealized)}`, s.stockProfit > 0 ? 'up' : s.stockProfit < 0 ? 'down' : ''),
    tile('toll-in', '過路費收入', money(s.tollsReceived), `${s.tollsReceivedCount} 次`, s.tollsReceived ? 'up' : ''),
    tile('toll-out', '過路費支出', money(s.tollsPaid), `${s.tollsPaidCount} 次`, s.tollsPaid ? 'down' : ''),
    tile('cards', '卡片', `用 ${sum(s.cardsUsed)}`, `買 ${sum(s.cardsBought)}`),
    tile('tools', '道具', `用 ${sum(s.toolsUsed)}`, `買 ${sum(s.toolsBought)}`),
    tile('lucky', '幸運事件', `${s.lucky}`, '', 'up'),
    tile('unlucky', '倒楣事件', `${s.unlucky}`, '', 'down'),
    tile('rivals', '打倒對手', `${s.rivalsBankrupted}`),
    tile('confine', '住院／坐牢', `${s.hospitalDays}／${s.prisonDays} 天`),
    tile('lottery', '樂透', `中 ${s.lotteryWins} 次`, s.lotteryPrize ? money(s.lotteryPrize) : ''),
    tile('minigame', '小遊戲', `${s.miniGames} 場`, s.miniGamePoints ? `${s.miniGamePoints} 點券` : ''),
    // 大富豪模式: cities visited and 霸主 titles held.
    ...(cityNames ? [tile('cities', '去過城市', `${s.cities.length} 座`, s.trips ? `旅行 ${s.trips} 次` : ''),
      tile('crown', '城市霸主', `${s.overlordCities.length} 座`, s.overlordCities.map(i => cityNames[i] ?? '').join('、'))] : []),
    ...(s.casinoGames ? [tile('casino', '賭場', `贏 ${s.casinoWins}／${s.casinoGames}`, signed(s.casinoNet), s.casinoNet > 0 ? 'up' : s.casinoNet < 0 ? 'down' : '')] : []),
  ].join('');
  const gods = top(s.gods, id => OBJECT_NAMES[id - 1] ?? '神明', 6);
  const cards = top(s.cardsUsed, cardName), tools = top(s.toolsUsed, toolName);
  const cities = cityNames && s.cities.length ? s.cities.map(i => `<span class="rs-chip city">${esc(cityNames[i] ?? '')}</span>`).join('') : '';
  const titles = x.titles.map(t => `<span class="rs-chip title">${esc(t)}</span>`).join('');
  const row = (ic: StatIcon, label: string, html: string) => (html ? `<div class="rs-row"><b>${icon(ic, 'rs-ic small')}${label}</b><div>${html}</div></div>` : '');
  return `<div class="rs-tiles">${tiles}</div>${row('crown', '稱號', titles)}${row('cities', '去過的城市', cities)}${row('gods', '神明附身', gods)}${row('cards', '常用卡片', cards)}${row('tools', '常用道具', tools)}`;
}

function rankRow(bank: SpriteBank, x: PlayerResult, on: boolean): string {
  const ch = CHARACTERS[x.character];
  const line = x.bankrupt ? `第 ${x.fellDay + 1} 天破產` : `地 ${x.lots}・房 ${x.houses}級${x.plots ? `・大型 ${x.plots}` : ''}`;
  return `<button class="rs-rank-row${on ? ' on' : ''}${x.winner ? ' win' : ''}${x.bankrupt ? ' out' : ''}" data-p="${x.p}" style="--c:${hex(ch.color)}">
    <i class="rs-medal r${Math.min(4, x.rank)}">${x.rank}</i>${face(bank, x.character, x.bankrupt ? 'grey' : '')}
    <span class="rs-who"><b>${esc(ch.name)}${x.human ? '<sup>玩家</sup>' : ''}</b><small>${line}</small></span>
    <span class="rs-assets">${x.bankrupt ? '—' : money(x.assets)}</span></button>`;
}

function defaultHero(bank: SpriteBank, r: GameResults, o: ResultsOptions): string {
  const w = r.players.find(p => p.winner), me = featured(r);
  const who = w ?? me, ch = CHARACTERS[who.character];
  const lost = !w || (!w.human && r.players.some(p => p.human));
  const title = w ? `${ch.name}獲勝！` : '遊戲結束';
  return `<div class="rs-hero${lost ? ' lost' : ''}">
    <div class="rs-hero-face">${w ? '<i class="rs-crown"></i>' : ''}${face(bank, who.character, w ? 'big' : 'big grey')}</div>
    <div class="rs-hero-text"><div class="rs-title">${esc(title)}</div>
      <div class="rs-sub">${icon('days', 'rs-ic small')}${esc(o.mapName)}・${r.days} 天・${format(r.date)}${lost && me.human ? `・你是第 ${me.rank} 名` : ''}</div></div></div>`;
}

const confetti = (n: number) => Array.from({ length: n }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 9) * 0.21}s;--h:${(i * 53) % 360}"></i>`).join('');

/** Shows the results over `root`; resolves with the player's choice, the results taken down. */
export function showResults(bank: SpriteBank, root: HTMLElement, r: GameResults, o: ResultsOptions): Promise<ResultsAction> {
  let sel = featured(r).p;
  const won = r.players.some(p => p.winner && p.human);
  const cover = document.createElement('div');
  cover.className = `rs-cover ${o.cls ?? ''}${won ? ' won' : ''}`;
  cover.innerHTML = `${won ? `<div class="rs-confetti">${confetti(40)}</div>` : ''}<div class="msg rs-box">
    <div class="ribbon">遊戲結算</div>
    <div class="rs-body">
      <section class="rs-side">${o.hero ?? defaultHero(bank, r, o)}<div class="rs-rank"></div></section>
      <section class="rs-detail"><div class="rs-detail-head"></div><div class="rs-stats"></div>${o.extra ? `<div class="rs-extra">${o.extra}</div>` : ''}</section>
    </div>
    <div class="rs-actions">
      <button class="candy ghost" data-a="save">儲存到相簿</button><button class="candy ghost" data-a="share">分享</button>
      ${o.next ? '<button class="candy yes" data-a="next">下一局</button>' : ''}<button class="candy" data-a="home">回到主畫面</button>
    </div></div><div class="rs-toast"></div>`;
  root.append(cover);
  const rank = cover.querySelector<HTMLElement>('.rs-rank')!, head = cover.querySelector<HTMLElement>('.rs-detail-head')!;
  const stats = cover.querySelector<HTMLElement>('.rs-stats')!;
  const render = () => {
    rank.innerHTML = r.players.map(x => rankRow(bank, x, x.p === sel)).join('');
    const x = r.players.find(q => q.p === sel)!, ch = CHARACTERS[x.character];
    head.innerHTML = `${face(bank, x.character, 'small')}<b>${esc(ch.name)}的成績</b><span>第 ${x.rank} 名</span>`;
    stats.innerHTML = statTiles(x, r.cityNames);
  };
  render();
  const fit = () => cover.classList.toggle('land', cover.clientWidth > cover.clientHeight);
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(cover);
  let toastTimer = 0;
  const toast = (text: string) => {
    const t = cover.querySelector<HTMLElement>('.rs-toast')!;
    t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove('show'), 2200);
  };
  if (won) audio.sfx(Sfx.fireworks);
  return new Promise(resolve => {
    let busy = false;
    cover.addEventListener('click', async e => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>('[data-p]');
      if (row) { audio.ui('click'); sel = Number(row.dataset.p); render(); return; }
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (!a || busy) return;
      if (a === 'save' || a === 'share') {
        busy = true; audio.ui('click');
        try {
          const canvas = await drawResultsCard(r, { mapName: o.mapName, featured: r.players.find(q => q.p === sel)!, faceSrc: c => bank.art('Data', 2, c)?.src });
          const name = `rich4-${Date.now()}`;
          if (a === 'save') toast((await saveImage(canvas, name)) === 'saved' ? '已儲存到相簿' : '已下載圖片');
          else {
            const res = await shareImage(canvas, name, `大富翁4・${o.mapName}・${r.days} 天`);
            if (res === 'downloaded') toast('已下載圖片');
          }
        } catch (err) {
          toast(/DENIED|權限/.test(String((err as Error)?.message ?? err)) ? '沒有相簿權限，請到設定開啟' : '無法完成，請再試一次');
        }
        busy = false;
        return;
      }
      audio.ui('yes');
      if (a === 'next' && o.next) {
        busy = true;
        const go = await o.next();
        busy = false;
        if (!go) return;
      }
      ro.disconnect();
      cover.remove();
      resolve(a === 'next' ? 'next' : 'home');
    });
  });
}

/** The next map and the drawn opponents, or null (back to the results). */
export interface NextPick { mapId: number; opponents: number[] }

/**
 * 「下一局」's map picker over `root`: the eight original maps and the 自製地圖, maps cleared in this run stamped
 * 「已通關」, three random opponents shown (and drawn again on request) for the human characters `humans`.
 */
export function pickNextMap(bank: SpriteBank, root: HTMLElement, maps: MapInfo[], current: number, run: RunRecord, humans: number[]): Promise<NextPick | null> {
  const list = maps.filter(m => !m.hidden);
  let kind: MapInfo['kind'] = list.find(m => m.id === current)?.kind ?? 'orig';
  // The next map in the list after the one just played, as the original's stage goes on to its next map.
  const same = list.filter(m => m.kind === kind), at = same.findIndex(m => m.id === current);
  let mapId = same.length ? same[(at + 1) % same.length].id : list[0]?.id ?? current;
  const roll = () => drawOpponents(humans, run.defeated, Math.random);
  let opponents = roll();
  const sheet = document.createElement('div');
  sheet.className = 'rs-next';
  const render = () => {
    const shown = list.filter(m => m.kind === kind);
    sheet.innerHTML = `<div class="msg sheet rs-next-box"><div class="ribbon">下一局</div>
      <div class="chips rs-next-tabs"><button class="chip${kind === 'orig' ? ' on' : ''}" data-k="orig">原版地圖</button><button class="chip${kind === 'custom' ? ' on' : ''}" data-k="custom">自製地圖</button></div>
      <div class="rs-maps">${shown.map(m => `<button class="rs-map${m.id === mapId ? ' on' : ''}" data-m="${m.id}"><img src="${m.thumbnail}" alt=""><span>${esc(m.name)}</span>${run.cleared.includes(m.id) ? '<i class="rs-stamp">已通關</i>' : m.id === current ? '<i class="rs-stamp now">剛玩過</i>' : ''}</button>`).join('')}</div>
      <div class="rs-vs"><div class="rs-vs-side">${humans.map(c => face(bank, c)).join('')}</div><b>VS</b><div class="rs-vs-side">${opponents.map(c => face(bank, c, run.defeated.includes(c) ? 'beaten' : '')).join('')}</div>
        <button class="chip" data-reroll="1">重新抽選</button></div>
      <p class="rs-next-note">沿用這一局的設定（資金、行進方式、土地權限、遊戲時間、勝利條件）</p>
      <div class="choices"><button class="candy ghost" data-back="1">返回</button><button class="candy yes" data-go="1">開始遊戲</button></div></div>`;
  };
  render();
  root.append(sheet);
  return new Promise(resolve => {
    sheet.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      const d = t.dataset;
      audio.sfx(d.go ? 2 : d.back ? 4 : 1);
      if (d.back) { sheet.remove(); resolve(null); return; }
      if (d.go) { sheet.remove(); resolve({ mapId, opponents }); return; }
      if (d.k) { kind = d.k as MapInfo['kind']; const first = list.find(m => m.kind === kind); if (first && !list.some(m => m.id === mapId && m.kind === kind)) mapId = first.id; }
      if (d.m) mapId = Number(d.m);
      if (d.reroll) opponents = roll();
      render();
    });
  });
}
