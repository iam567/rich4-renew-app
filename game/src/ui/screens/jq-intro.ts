/**
 * 激情歲月's 「穿越」 intro (docs/rules/24 §10): when a new game on the map starts (not a loaded one; 系統 can replay it),
 * about 9 s at the game speed, a tap skips it. The board of today drifts closer under a 2026 calendar; the picture
 * rewinds like a video tape (scan lines, colours going old) while the calendar runs back to 1966 round a time vortex;
 * every player's portrait (the original pictures, never redrawn) is pulled into the vortex and comes out as an old
 * photograph with a joke; the vortex opens into a red flag, the 廣播站's jingle sounds, the title card 「激情歲月 1966
 * 年・北京」. Only the screen: the game waits and its state does not change (派對模式: each phone plays its own).
 */
import { CHARACTERS, playerName } from '../../core/characters';
import type { Game } from '../../core/game';
import type { SpriteBank } from '../sprites';
import { audio } from '../audio';
import { hiss, Loudspeakers, sweep } from '../jq-loudspeaker';
import { JQ_ART } from './jq-fx';
import './jq-intro.css';

/** Each character's line on arriving in 1966 (§10). */
const QUIPS: Record<number, string> = {
  0: '這身中山裝還挺合身',
  1: '同志，請問黑市在哪？',
  2: '忍者裝怎麼變成綠軍裝了？',
  3: '我的名牌包呢？怎麼變成帆布包了！',
  4: '這年頭種田要記工分啊',
  5: '本公主的皇冠……換成軍帽了？',
  6: '我的武士刀被收繳了！',
  7: '紅領巾好帥！',
  8: '喵～這裡的糖要糧票嗎？',
  9: '我要當廣播體操標兵！',
  10: '紅領巾好帥！',
  11: '我的金幣全換成糧票了？',
};

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Plays the intro over `shell`; resolves when it is over or skipped. `pace`: the game speed's time scale. */
export function playJqIntro(shell: HTMLElement, game: Game, bank: SpriteBank, pace: number): Promise<void> {
  const k = Math.max(0.6, Math.min(1, pace));
  const root = document.createElement('div');
  root.className = 'jq-intro';
  const players = game.players.filter(p => p.whoPlays !== 0 || p.human).slice(0, 8);
  const photos = players.map((p, i) => {
    const ch = CHARACTERS[p.character], a = ch ? bank.art('Data', 2, ch.id) : null;
    const ang = (i / Math.max(1, players.length)) * Math.PI * 2 - Math.PI / 2;
    return `<div class="ji-photo" style="--x:${Math.cos(ang).toFixed(3)};--y:${Math.sin(ang).toFixed(3)};--i:${i}">
      <div class="ji-frame">${a ? `<img src="${a.src}" alt="">` : ''}<span>${esc(playerName(p))}</span></div>
      <div class="ji-say">${esc(QUIPS[p.character] ?? '這是哪一年？')}</div></div>`;
  }).join('');
  root.innerHTML = `
    <div class="ji-rewind"><img src="${JQ_ART('intro-rewind')}" alt=""><i class="ji-lines"></i></div>
    <div class="ji-vortex"><img src="${JQ_ART('intro-vortex')}" alt=""></div>
    <div class="ji-photos">${photos}</div>
    <div class="ji-flag"><img src="${JQ_ART('intro-flag')}" alt=""></div>
    <div class="ji-title"><div class="ji-banner">激情歲月</div><div class="ji-sub">1966 年・北京</div></div>
    <div class="ji-cal"><i></i><b>2026</b><span>年</span></div>
    <div class="ji-skip">點一下跳過</div>`;
  shell.append(root);
  const year = root.querySelector<HTMLElement>('.ji-cal b')!;
  const a = audio.ambience(), loud = new Loudspeakers();
  return new Promise<void>(resolve => {
    let done = false, roll = 0;
    const timers: number[] = [];
    const at = (s: number, f: () => void) => timers.push(window.setTimeout(() => { if (!done) f(); }, s * 1000 * k));
    const finish = () => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      clearInterval(roll);
      shell.classList.remove('ji-zoom');
      root.classList.add('out');
      setTimeout(() => { root.remove(); loud.close(); resolve(); }, 450);
    };
    root.addEventListener('pointerup', finish);
    root.style.setProperty('--k', String(k));
    // 0–1.5 s: today's board drifts closer under the 2026 calendar.
    shell.classList.add('ji-zoom');
    root.classList.add('p0');
    // 1.5–3.5 s: the tape rewinds, the colours go old, the calendar runs back to 1966 round the vortex.
    at(1.5, () => {
      root.classList.add('p1');
      if (a) { hiss(a.ctx, a.out, a.ctx.currentTime, 2.2 * k, 0.09); sweep(a.ctx, a.out, a.ctx.currentTime, 1400, 120, 2 * k, 0.05, 'sawtooth'); }
      let y = 2026;
      roll = window.setInterval(() => { y = Math.max(1966, y - 2); year.textContent = String(y); if (y === 1966) clearInterval(roll); }, (1900 * k) / 30);
    });
    // 3.5–6 s: the players are pulled in one by one and come out as old photographs, each with a line.
    at(3.5, () => root.classList.add('p2'));
    const step = 2.4 / Math.max(1, players.length);
    players.forEach((_, i) => at(3.5 + i * step, () => {
      root.querySelectorAll('.ji-photo')[i]?.classList.add('on');
      if (a) sweep(a.ctx, a.out, a.ctx.currentTime, 900, 2400, 0.25, 0.06);
    }));
    // 6–8 s: the vortex opens into a red flag, the 廣播站's jingle; 8–9 s: the title card.
    at(6, () => { root.classList.add('p3'); shell.classList.remove('ji-zoom'); loud.newsJingle(true); year.textContent = '1966'; });
    at(7.6, () => root.classList.add('p4'));
    at(9.4, finish);
  });
}
