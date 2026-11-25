/**
 * 長安's 「穿越到開元盛世」 intro (the user 2026-11-19: 「開場動畫沒有啊？」), as 激情歲月's (jq-intro.ts): when a new game on
 * the map starts (not a loaded one; 系統 can replay it), about 9 s at the game speed, a tap skips it. Today's board
 * drifts closer and ink spreads over it; an ink-wash whirl turns while the year in the corner runs back from 2026 to
 * 732 (開元二十年); every player's portrait (the original pictures, never redrawn) is pulled in and comes out on a round
 * silk fan (團扇) with a joke about the Tang; the whirl opens into a painting of Chang'an unrolled between two rollers, a
 * drum and a bell, the title 「長安」 — 開元盛世. Only the screen: the game waits and its state does not change.
 * 清明上河 plays the same opening with its own set (SETS.qingming): 汴京's 虹橋 painting, 宣和二年, the Song quips.
 */
import { CHARACTERS, playerName } from '../../core/characters';
import type { Game } from '../../core/game';
import type { SpriteBank } from '../sprites';
import { audio } from '../audio';
import { hiss, sweep } from '../jq-loudspeaker';
import { ASSETS } from '../assets';
import './cn-intro.css';

/** Each map's opening: its pictures, title, the year the counter runs back to, its era's name for it, the quips. */
interface IntroSet { art: string; title: string; sub: string; year: number; era: string; eraSmall: string; quips: Record<number, string> }
const SETS: Record<'changan' | 'qingming', IntroSet> = {
  changan: {
    art: `${ASSETS}/maps/remake/changan/intro`, title: '開元盛世', sub: '長安・公元七三二年', year: 732, era: '開元', eraSmall: '二十年',
    /** Each character's line on arriving in the Tang (humour first, the user: 「娛樂性也要有」). */
    quips: {
      0: '這身圓領袍還挺合身',
      1: '胡商的酒肆在哪？來杯葡萄酒！',
      2: '忍者裝怎麼變成不良人的衣服了？',
      3: '我的名牌包呢？怎麼變成錢袋了！',
      4: '這年頭種田要交租庸調啊',
      5: '本公主的皇冠……換成步搖了？',
      6: '我的武士刀變成唐橫刀了！',
      7: '這髮髻好重啊',
      8: '喵～長安的魚好便宜',
      9: '走，去曲江看賽龍舟！',
      10: '手機呢？怎麼變成算籌了？',
      11: '我的金幣全換成開元通寶了？',
    },
  },
  // 清明上河 (the user 2026-11-23: 「也沒有開場穿越動畫」): 汴京 in 宣和二年 (1120) — the 《清明上河圖》's city and the
  // years of 宋江's 梁山泊; the quips in Song / 水滸 flavour.
  qingming: {
    art: `${ASSETS}/maps/remake/qingming/intro`, title: '清明上河', sub: '汴京・宣和二年（公元一一二〇年）', year: 1120, era: '宣和', eraSmall: '二年',
    quips: {
      0: '換上斗笠，俺也是梁山好漢了！',
      1: '市舶司在哪？我的香料要報關！',
      2: '時遷兄，飛簷走壁我也會！',
      3: '樊樓的酒菜，給我全上一遍！',
      4: '這年頭還要還青苗錢啊',
      5: '本公主要去金明池看龍舟爭標！',
      6: '我要上景陽岡會一會那隻大蟲',
      7: '虹橋上人好多，尾巴要被踩到了！',
      8: '喵～汴河的魚好肥',
      9: '走，去瓦子看雜劇！',
      10: '手機呢？怎麼變成一疊交子了？',
      11: '我的金幣全換成宣和通寶了？',
    },
  },
};

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A drum beat (a falling low tone and a thud of noise) and a temple bell (a few slow-dying partials). */
function drum(ctx: AudioContext, out: AudioNode, t: number, v = 0.5) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.55);
  hiss(ctx, out, t, 0.08, v * 0.25);
}
function bell(ctx: AudioContext, out: AudioNode, t: number) {
  for (const [f, v, d] of [[196, 0.18, 4], [392.5, 0.08, 3], [588, 0.05, 2.2], [823, 0.03, 1.4]] as const) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    o.connect(g).connect(out); o.start(t); o.stop(t + d);
  }
}

/**
 * Plays the intro over `shell`; resolves when it is over or skipped. `pace`: the game speed's time scale; `theme`: the
 * map's set (長安's, or 清明上河's 「汴京・宣和二年」).
 */
export function playCnIntro(shell: HTMLElement, game: Game, bank: SpriteBank, pace: number, theme: 'changan' | 'qingming' = 'changan'): Promise<void> {
  const k = Math.max(0.6, Math.min(1, pace));
  const S = SETS[theme], ART = S.art, QUIPS = S.quips;
  const root = document.createElement('div');
  root.className = `cn-intro ci-${theme}`;
  root.dataset.noera = '';   // its words are its own (the theme's rewrite leaves them)
  // (every player: when a new game begins nobody has landed yet — whoPlays is still 0 for the computers)
  const players = game.players.filter(p => !p.bankrupt).slice(0, 8);
  const fans = players.map((p, i) => {
    const ch = CHARACTERS[p.character], a = ch ? bank.art('Data', 2, ch.id) : null;
    const ang = (i / Math.max(1, players.length)) * Math.PI * 2 - Math.PI / 2;
    return `<div class="ci-fan" style="--x:${Math.cos(ang).toFixed(3)};--y:${Math.sin(ang).toFixed(3)};--i:${i}">
      <div class="ci-silk">${a ? `<img src="${a.src}" alt="">` : ''}</div><i class="ci-handle"></i><span class="ci-name">${esc(playerName(p))}</span>
      <div class="ci-say">${esc(QUIPS[p.character] ?? '這是哪一年？')}</div></div>`;
  }).join('');
  root.innerHTML = `
    <div class="ci-ink"></div>
    <div class="ci-vortex"><img src="${ART}/vortex.webp" alt=""></div>
    <div class="ci-fans">${fans}</div>
    <div class="ci-scroll"><div class="ci-paint"><img src="${ART}/city.webp" alt=""></div><i class="ci-rod l"></i><i class="ci-rod r"></i></div>
    <div class="ci-title"><div class="ci-name-big">${S.title}</div><div class="ci-sub">${S.sub}</div></div>
    <div class="ci-year"><small>公元</small><b>2026</b><small>年</small></div>
    <div class="ci-skip">點一下跳過</div>`;
  shell.append(root);
  const year = root.querySelector<HTMLElement>('.ci-year b')!, yearBox = root.querySelector<HTMLElement>('.ci-year')!;
  const a = audio.ambience();
  return new Promise<void>(resolve => {
    let done = false, roll = 0;
    const timers: number[] = [];
    const at = (s: number, f: () => void) => timers.push(window.setTimeout(() => { if (!done) f(); }, s * 1000 * k));
    const finish = () => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      clearInterval(roll);
      shell.classList.remove('ci-zoom');
      root.classList.add('out');
      setTimeout(() => { root.remove(); resolve(); }, 450);
    };
    root.addEventListener('pointerup', finish);
    root.style.setProperty('--k', String(k));
    // 0–1.4 s: today's board drifts closer; the ink starts to spread from the middle.
    shell.classList.add('ci-zoom');
    root.classList.add('p0');
    // 1.4–3.4 s: the ink covers it, the whirl turns, the year runs back (to 732 / 1120).
    at(1.4, () => {
      root.classList.add('p1');
      if (a) { sweep(a.ctx, a.out, a.ctx.currentTime, 1600, 90, 2 * k, 0.05, 'triangle'); hiss(a.ctx, a.out, a.ctx.currentTime, 1.8 * k, 0.05); }
      let y = 2026;
      const by = Math.ceil((2026 - S.year) / 30);
      roll = window.setInterval(() => { y = Math.max(S.year, y - by); year.textContent = String(y); if (y === S.year) clearInterval(roll); }, (1900 * k) / 30);
    });
    // 3.4–6 s: the players pulled in one by one, out on round silk fans, each with a line.
    at(3.4, () => root.classList.add('p2'));
    const step = 2.4 / Math.max(1, players.length);
    players.forEach((_, i) => at(3.4 + i * step, () => {
      root.querySelectorAll('.ci-fan')[i]?.classList.add('on');
      if (a) sweep(a.ctx, a.out, a.ctx.currentTime, 700, 1900, 0.22, 0.05);
    }));
    // 6–7.6 s: the whirl opens, the painting of the city unrolls, the drums; 7.6–9.4 s: the title, the bell.
    at(6, () => {
      root.classList.add('p3'); shell.classList.remove('ci-zoom');
      year.textContent = String(S.year); yearBox.classList.add('tang');
      yearBox.innerHTML = `<b>${S.era}</b><small>${S.eraSmall}</small>`;
      if (a) { const t = a.ctx.currentTime; [0, 0.32, 0.64, 0.86].forEach((d, i) => drum(a.ctx, a.out, t + d * k, i === 3 ? 0.7 : 0.45)); }
    });
    at(7.6, () => { root.classList.add('p4'); if (a) bell(a.ctx, a.out, a.ctx.currentTime); });
    at(9.6, finish);
  });
}
