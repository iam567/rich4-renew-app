/**
 * 長安's magic house, 玄都觀 (the user 2026-11-19: 「魔法屋要全部重建，這太亂七八糟了」「放的該放的位置」; the mock approved
 * 2026-11-20): a calm Tang altar hall, the twelve spells as one set of talisman tokens evenly on a ring round the
 * hall's bronze 八卦 disc, each with its name plate under it; the disc shows whom the 道長 picked (天機所示) and their
 * faces; the 道長's lines in a drawn frame, 施法 beside it (landscape) or under it (portrait). The same steps as the
 * original screen (ui/screens/magic.ts): the intro lines, the group, a tap picks a token, a second tap or 施法 casts;
 * a computer's choice plays by itself. The answer is the magic index 0..11. 清明上河's 上清宮 is the same screen with its
 * own hall and talismans (o.theme 'qingming').
 */
import { fitOverlay } from './bank';
import { audio, Sfx, Theme } from '../audio';
import { ASSETS } from '../assets';
import { CHARACTERS } from '../../core/characters';
import { MAGIC_NAMES } from '../../core/modules/places';
import type { Player } from '../../core/types';
import type { ScreenContext } from './registry';
import './cn-ui.css';
import './cn-magic.css';

/** The hall and the twelve talismans: 長安's 玄都觀, or 清明上河's 上清宮 (tools/tycoon-art/qingming_places.py). */
const artOf = (theme: 'changan' | 'qingming') => `${ASSETS}/maps/remake/${theme}/magic`;
const TEMPLE = { changan: '玄都觀', qingming: '上清宮' };
const LINES = {
  intro: ['進了{T}，就得\n完全照本道的指示！', '本道替你選出\n符合條件的人。', '你來決定他們的命運∼'],
  turn: '輪到你了，請選一道符！',
  spell: '天靈靈，地靈靈∼',
};
/** Stage sizes and the ring (stage px; the mock's): landscape, portrait. */
const LAYOUT = {
  wide: { W: 1280, H: 960, bg: [-80, 0, 1440, 960], cx: 640, cy: 345, rx: 450, ry: 290, tok: 100, lab: 54 },
  tall: { W: 1280, H: 1520, bg: [-500, 0, 2280, 1520], cx: 640, cy: 575, rx: 510, ry: 460, tok: 132, lab: 72 },
};

export interface CnMagicOpts { group: string; targets: Player[]; hint: boolean; auto?: number; caster: number; theme?: 'changan' | 'qingming' }

export function cnMagicScreen(ctx: ScreenContext, o: CnMagicOpts): Promise<number> {
  const ART = artOf(o.theme ?? 'changan'), temple = TEMPLE[o.theme ?? 'changan'];
  audio.theme(Theme.magic);
  return new Promise(resolve => {
    let phase: 'intro' | 'pick' | 'cast' = 'intro', pick = -1, skip = false, closed = false, ready = false;
    // (the first fit runs inside fitOverlay, before the scene is filled: place() only once `ready`)
    const ov = fitOverlay(ctx.shell, 'cnm-ov', tall => (tall ? [LAYOUT.tall.W, LAYOUT.tall.H] : [LAYOUT.wide.W, LAYOUT.wide.H]), tall => { if (ready) place(tall); }, 0);
    ov.scene.classList.add('cn-scene', 'cnm-scene');
    const faces = o.targets.map(q => {
      const ch = CHARACTERS[q.character], a = ch ? ctx.bank.art('Data', 2, ch.id) : null;
      return `<span class="cnm-face">${a ? `<img src="${a.src}" alt="">` : '<i></i>'}<b>${esc(ctx.game.name(q.id))}</b></span>`;
    }).join('');
    ov.scene.innerHTML = `
      <div class="cnm-bg" style="background-image:url(${ART}/hall.webp)"></div><div class="cnm-dim"></div>
      <div class="cnm-ring"><div class="cnm-path"></div></div>
      <div class="cnm-oracle" hidden><div class="cnm-halo"></div><div class="cnm-tag">－ 天機所示 －</div>
        <div class="cnm-who">${esc(o.group)}</div>${o.hint && faces ? `<div class="cnm-faces">${faces}</div>` : ''}</div>
      <div class="cn-frame cnm-say"><div class="cnm-rib">道長</div><div class="cn-lbl cnm-line"></div></div>
      <div class="cnm-go"><button class="cn-btn cnm-cast" hidden>施　法</button></div>
      <div class="cnm-flash"></div>`;
    const $ = <T extends HTMLElement = HTMLElement>(s: string) => ov.scene.querySelector<T>(s)!;
    const ring = $('.cnm-ring'), line = $('.cnm-line'), castBtn = $<HTMLButtonElement>('.cnm-cast'), oracle = $('.cnm-oracle');
    const toks = MAGIC_NAMES.map((name, i) => {
      const t = document.createElement('button');
      t.className = 'cnm-tok';
      t.innerHTML = `<img src="${ART}/t${i}.webp" alt="">`;
      t.title = name;
      t.onclick = e => { e.stopPropagation(); choose(i); };
      const l = document.createElement('div');
      l.className = 'cnm-nm';
      l.textContent = name;
      ring.append(t, l);
      return { t, l };
    });
    function place(tall: boolean) {
      const L = tall ? LAYOUT.tall : LAYOUT.wide;
      const bg = $('.cnm-bg');
      Object.assign(bg.style, { left: `${L.bg[0]}px`, top: `${L.bg[1]}px`, width: `${L.bg[2]}px`, height: `${L.bg[3]}px` });
      Object.assign(ring.style, { left: `${L.cx}px`, top: `${L.cy}px` });
      Object.assign($('.cnm-path').style, { left: `${-L.rx}px`, top: `${-L.ry}px`, width: `${2 * L.rx}px`, height: `${2 * L.ry}px` });
      toks.forEach(({ t, l }, i) => {
        const a = (-90 + i * 30) * Math.PI / 180, x = L.rx * Math.cos(a), y = L.ry * Math.sin(a);
        Object.assign(t.style, { left: `${x - L.tok / 2}px`, top: `${y - L.tok / 2}px`, width: `${L.tok}px`, height: `${L.tok}px` });
        Object.assign(l.style, { left: `${x}px`, top: `${y + L.lab + (i === pick ? 10 : 0)}px` });
      });
    }
    ready = true;
    place(ov.isTall());
    const say = (t: string) => { line.innerHTML = esc(t).replace(/\n/g, '<br>'); line.parentElement!.animate([{ transform: 'scale(.96)' }, { transform: 'scale(1)' }], { duration: 160 }); };
    const wait = (ms: number) => new Promise<void>(r => setTimeout(r, skip && phase === 'intro' ? Math.min(ms, 250) : ms * ctx.scale()));
    const select = (i: number) => {
      pick = i;
      toks.forEach(({ t, l }, k) => { t.classList.toggle('on', k === i); l.classList.toggle('on', k === i); });
      place(ov.isTall());
    };
    const choose = (i: number) => {
      if (phase !== 'pick' || (o.auto !== undefined && i !== o.auto)) { if (phase === 'intro') skip = true; return; }
      if (pick === i && o.auto === undefined) { void cast(); return; }
      audio.sfx(Sfx.magic);
      select(i);
      if (o.auto !== undefined) { say(`${ctx.game.name(o.caster)}選擇了\n「${MAGIC_NAMES[i]}」`); return; }
      say(`「${MAGIC_NAMES[i]}」\n就決定是這道符嗎？`);
      castBtn.hidden = false;
    };
    const cast = async () => {
      if (phase !== 'pick' || pick < 0) return;
      phase = 'cast';
      castBtn.hidden = true;
      say(LINES.spell);
      audio.sfx(Sfx.deathSummon);
      ov.scene.classList.add('casting');
      await new Promise(r => setTimeout(r, Math.max(900, 1700 * ctx.scale())));
      finish(pick);
    };
    const finish = (v: number) => {
      if (closed) return;
      closed = true;
      ov.close();
      audio.restore();
      resolve(v);
    };
    castBtn.onclick = e => { e.stopPropagation(); void cast(); };
    ov.root.addEventListener('pointerdown', () => { if (phase === 'intro') skip = true; });
    void (async () => {
      for (const t of o.auto === undefined ? LINES.intro : LINES.intro.slice(0, 2)) {
        if (skip) break;
        say(t.replace('{T}', temple));
        await wait(1500);
      }
      oracle.hidden = false;
      oracle.animate([{ opacity: 0, transform: 'translateX(-50%) scale(.6)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], { duration: 350, easing: 'ease-out' });
      say(o.group);
      await wait(1300);
      phase = 'pick';
      if (o.auto === undefined) { say(LINES.turn); return; }
      await wait(700);
      choose(o.auto);
      await wait(1800);
      void cast();
    })();
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
