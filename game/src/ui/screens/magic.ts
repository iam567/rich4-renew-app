/**
 * The magic house (docs/rules/06 §6, rich4_magic_house.asm): the magic circle (Panel #18.0) with its twelve
 * symbols, the hooded fortune teller (#18.1) whose crystal ball shows the chosen group (#18.11 + group), the
 * ornate name labels (#18.6/7/9/10) and the closing spell (FLC Panel #20). The answer is the magic index 0..11,
 * as the plain dialog returned.
 */
import { eraLine } from '../era-line';
import type { Ask } from '../../core/types';
import { MAGIC_GROUPS, MAGIC_NAMES } from '../../core/modules/places';
import { askScreens, fxScreens, type ScreenContext } from './registry';
import { resultBox } from './event-result';
import { charColor, el, esc, face, openScene, type Scene } from './place-scene';
import { audio, Sfx, Theme } from '../audio';
import { phrases } from '../text';
import { centreWords } from '../bubble-text';
import './magic.css';

type Choose = Extract<Ask, { t: 'choose' }>;

/** Symbol centres (`ref_004756e8`) and name labels {frame, x, y} (`_rich4_magic_house_function_info`), magic 0..11. */
const SYMBOLS: [number, number][] = [[322, 91], [414, 82], [453, 157], [509, 242], [458, 314], [415, 387], [322, 394], [239, 393], [188, 316], [131, 222], [184, 161], [225, 83]];
const LABELS: [number, number, number][] = [[9, 208, 167], [10, 510, 150], [7, 545, 88], [7, 568, 147], [7, 550, 234], [7, 510, 320], [7, 422, 320], [6, 134, 318], [6, 92, 250], [6, 72, 130], [6, 77, 85], [9, 122, 154]];
/** The teller's names for the twelve groups (#46-#57). */
const GROUP_LINES = ['財產最多的人', '土地最多的人', '房屋最多的人', '現金最多的人', '存款最多的人', '點券最多的人', '走路的人', '騎機車的人', '開汽車的人', '神明附身的人', '所有男生', '所有女生'];
const LINES = {
  intro: ['進來魔法屋，就得\n完全照我的指示！', '我選出符合條件的人。', '你來決定他們的命運∼'],
  turn: '嘿∼輪到你了！',
  spell: '天靈靈地靈靈∼',
};

/**
 * The spell over the circle (in place of FLC Panel#20, 1750 ms): a ring of runes turns in, the hexagram traces
 * itself in light from its six points, sparks spiral into the centre, the circle flares and everything whites
 * out (the original's frame 20, where `white` is called), then holds.
 */
function spell(s: Scene, alive: () => boolean, white: () => void): Promise<void> {
  const box = s.box('mg-spell', 0, 0, 640, 480);
  const cv = document.createElement('canvas');
  box.append(cv);
  const r = box.getBoundingClientRect(), k = Math.min(3, Math.max(1, (r.width / 640) * (window.devicePixelRatio || 1)));
  cv.width = Math.round(640 * k); cv.height = Math.round(480 * k);
  const c = cv.getContext('2d')!;
  const CX = 322, CY = 238, R = 206, RING = 222, T = 1750;
  const tri = (a0: number) => [0, 1, 2].map(i => { const a = a0 + i * Math.PI * 2 / 3; return [CX + Math.cos(a) * R, CY + Math.sin(a) * R]; });
  const tris = [tri(-Math.PI / 2), tri(Math.PI / 2)];
  const sparks = Array.from({ length: 90 }, (_, i) => ({ a: Math.random() * Math.PI * 2, d: 120 + Math.random() * 150, t0: 250 + Math.random() * 800, sp: 0.6 + Math.random() * 0.8, hue: i % 3 }));
  const runes = '✦✧◇◆✶✷✸✹✺❂☽☾✡⚝'.split('');
  let whited = false;
  return new Promise(done => {
    const t0 = performance.now();
    const frame = (now: number) => {
      if (!alive()) { done(); return; }
      const t = now - t0;
      c.setTransform(k, 0, 0, k, 0, 0);
      c.clearRect(0, 0, 640, 480);
      c.globalCompositeOperation = 'lighter';
      // Rune ring, turning and brightening.
      const ring = Math.min(1, t / 500);
      c.save(); c.translate(CX, CY); c.rotate(t / 900);
      c.strokeStyle = `rgba(255, 214, 120, ${0.55 * ring})`; c.lineWidth = 2.2; c.shadowColor = '#ffcf5a'; c.shadowBlur = 16;
      c.beginPath(); c.arc(0, 0, RING, 0, Math.PI * 2 * ring); c.stroke();
      c.beginPath(); c.arc(0, 0, RING - 14, 0, Math.PI * 2 * ring); c.stroke();
      c.font = '15px serif'; c.fillStyle = `rgba(255, 236, 170, ${0.9 * ring})`; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; if (a > Math.PI * 2 * ring) break; c.save(); c.rotate(a); c.translate(0, -(RING - 7)); c.fillText(runes[i % runes.length], 0, 0); c.restore(); }
      c.restore();
      // Hexagram traced from its points.
      const trace = Math.min(1, Math.max(0, (t - 150) / 650));
      c.lineCap = 'round'; c.shadowColor = '#fff1b0'; c.shadowBlur = 22;
      for (const pts of tris) {
        for (let e = 0; e < 3; e++) {
          const [ax, ay] = pts[e], [bx, by] = pts[(e + 1) % 3], q = trace;
          c.strokeStyle = 'rgba(255, 246, 200, .95)'; c.lineWidth = 4.5;
          c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + (bx - ax) * q, ay + (by - ay) * q); c.stroke();
          if (q < 1) { c.fillStyle = '#fff'; c.beginPath(); c.arc(ax + (bx - ax) * q, ay + (by - ay) * q, 6, 0, Math.PI * 2); c.fill(); }
        }
      }
      // Points of the star light up as the trace leaves them.
      if (trace > 0) for (const pts of tris) for (const [x, y] of pts) {
        const g = c.createRadialGradient(x, y, 0, x, y, 30); g.addColorStop(0, `rgba(255, 255, 230, ${0.9 * trace})`); g.addColorStop(1, 'rgba(255, 200, 80, 0)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, 30, 0, Math.PI * 2); c.fill();
      }
      // Sparks spiralling into the centre.
      c.shadowBlur = 10;
      for (const p of sparks) {
        const u = (t - p.t0) / (600 / p.sp);
        if (u < 0 || u > 1) continue;
        const a = p.a + u * 2.4, d = p.d * (1 - u);
        const x = CX + Math.cos(a) * d, y = CY + Math.sin(a) * d * 0.95;
        c.fillStyle = ['rgba(255, 230, 140, .95)', 'rgba(190, 160, 255, .95)', 'rgba(140, 230, 255, .95)'][p.hue];
        c.shadowColor = c.fillStyle as string;
        c.beginPath(); c.arc(x, y, 2.6 * (1 - u * 0.5), 0, Math.PI * 2); c.fill();
      }
      // The centre swells, then the flare whites everything out.
      const core = Math.max(0, Math.min(1, (t - 600) / 700));
      if (core > 0) {
        const rad = 30 + core * 260, g = c.createRadialGradient(CX, CY, 0, CX, CY, rad);
        g.addColorStop(0, `rgba(255, 255, 255, ${0.95 * core})`); g.addColorStop(0.4, `rgba(255, 236, 160, ${0.6 * core})`); g.addColorStop(1, 'rgba(255, 180, 80, 0)');
        c.fillStyle = g; c.beginPath(); c.arc(CX, CY, rad, 0, Math.PI * 2); c.fill();
      }
      c.globalCompositeOperation = 'source-over'; c.shadowBlur = 0;
      const wash = Math.max(0, Math.min(1, (t - 1250) / 250));
      if (wash > 0) { c.fillStyle = `rgba(255, 255, 255, ${wash})`; c.fillRect(0, 0, 640, 480); }
      if (wash >= 1 && !whited) { whited = true; white(); }
      if (t >= T) { done(); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/**
 * The magic circle. `auto` is a computer's (or autopilot's) choice: the same scene plays by itself, the teller
 * names the group, the symbol lights up with who chose it, and the spell is cast; a tap speeds it up.
 */
function magicScreen(ctx: ScreenContext, a: Choose, auto?: number): Promise<number> {
  const g = ctx.game;
  const text = a.text ?? '';
  const group = Math.max(0, MAGIC_GROUPS.findIndex(n => text.includes(`對象：${n}`)));
  const names = (text.match(/（(.*)）/)?.[1] ?? '').split('、').filter(Boolean);
  const targets = g.players.filter(q => names.includes(nameOf(ctx, q.id)));
  // The magic house plays MIDI08 (rich4_magic_house.asm:2269).
  audio.theme(Theme.magic);
  return new Promise(resolve => {
    let phase: 'intro' | 'pick' | 'cast' = 'intro';
    let pick = -1;
    let token = 0;
    let skipIntro = false;
    let castBtn: HTMLButtonElement | null = null;
    let cast = () => {};
    let choose = (_i: number) => {};
    const scene = openScene(ctx, 'mg-scene', p => (p ? [640, 760] : [640, 480]), async s => {
      const run = ++token;
      const P = s.portrait;
      const alive = () => run === token && !s.closed;
      s.art('Panel', 18, 0, 0, 0, 'mg-bg');
      // The redrawn circle (2026-10-15) has 魔法屋 / MAGIC painted on its plaques (the original's top one read 1998).
      const banners: HTMLElement[] = [];
      const syms = SYMBOLS.map(([x, y], i) => {
        const glow = s.box('mg-glow', x - 34, y - 34, 68, 68);
        const img = s.art('Panel', 18, 23 + i, x, y, 'mg-sym');
        const hit = s.box('mg-hit', x - 40, y - 40, 80, 80);
        hit.dataset.i = String(i);
        hit.title = MAGIC_NAMES[i];
        hit.onclick = () => choose(i);
        return { glow, img, hit };
      });
      let label: HTMLElement | null = null;
      const showLabel = (i: number) => {
        label?.remove();
        const [f, x, y] = LABELS[i];
        const art = ctx.bank.art('Panel', 18, f);
        label = s.box(`mg-label f${f} pl-pop`, x - (art?.ax ?? 71), y - (art?.ay ?? 60), art?.w ?? 142, art?.h ?? 120, `<span>${esc(MAGIC_NAMES[i])}</span>`);
        if (art) label.style.backgroundImage = `url('${art.src}')`;
        centreWords(label.querySelector('span')!, `Panel/18/${f}`);
        syms.forEach((sy, k) => { sy.img?.classList.toggle('on', k === i); sy.glow.classList.toggle('on', k === i); });
      };
      // The teller (#18.1 at (241,140)); the group appears in her crystal ball at (326,296).
      let teller = s.art('Panel', 18, 1, 241, 140, 'mg-teller');
      let ball: HTMLImageElement | null = null;
      const showGroup = () => { ball?.remove(); ball = s.art('Panel', 18, 11 + group, 326, 296, 'mg-ball pl-pop'); };
      // Her lines in the remake's message box (style.css .msg, the teller's name on the ribbon) where the original drew
      // its board #18.8 centred on (320,384).
      const balloon = s.box('msg scene-msg mg-say', 320 - 150, 384 - 64, 300, 128, '<div class="ribbon">占卜師</div><div class="scene-msg-text"></div>');
      const sayText = balloon.querySelector<HTMLElement>('.scene-msg-text')!;
      // The balloon covers the lower symbols: while picking it goes away after the line, as the original's does.
      let said = 0;
      const say = (t: string) => {
        const n = ++said;
        void audio.say(t); // the teller's lines are voiced (#0037-#0057)
        sayText.innerHTML = phrases(eraLine(t)); balloon.hidden = false;
        balloon.classList.remove('pl-pop'); void balloon.offsetWidth; balloon.classList.add('pl-pop');
        if (phase === 'pick') void s.sleep(2000).then(() => { if (n === said && phase === 'pick') balloon.hidden = true; });
      };
      // Who the group is: faces of the targets (not drawn by the original, which shows only the icon).
      // More than four (大富豪模式's eleven rivals): a grid of smaller faces, names beside them in portrait.
      const manyWho = targets.length > 4;
      const who = P ? s.box(`mg-who${manyWho ? ' many' : ''}`, 20, 492, 600, 112) : s.box(`mg-who${manyWho ? ' many' : ''}`, 8, 8, manyWho ? 236 : 196, 70);
      if (manyWho) who.style.height = 'auto';
      const whoHtml = () => `<b>${esc(GROUP_LINES[group])}</b><span class="mg-faces">${targets.map(q =>
        `<span class="mg-face" style="--c:${charColor(ctx, q.id)}" title="${esc(nameOf(ctx, q.id))}">${face(ctx, q.character)}${P ? `<i>${esc(nameOf(ctx, q.id))}</i>` : ''}</span>`).join('')}</span>`;
      who.innerHTML = phase === 'intro' ? '' : whoHtml();
      who.hidden = phase === 'intro';
      castBtn = el('button', 'candy yes mg-cast');
      castBtn.textContent = '施法！';
      castBtn.hidden = pick < 0 || phase !== 'pick';
      Object.assign(castBtn.style, P ? { left: '170px', top: '640px', width: '300px' } : { left: '506px', top: '426px' });
      castBtn.onclick = () => cast();
      s.stage.append(castBtn);
      const doCast = async () => {
        if (!alive()) return;
        // Arms raised (#18.2 at (182,142)), the line, then the circle flares (FLC #20, 25 frames).
        teller?.remove();
        teller = s.art('Panel', 18, 2, 182, 142, 'mg-teller');
        showGroup();
        say(LINES.spell);
        await s.wait(1400);
        if (!alive()) return;
        // The original plays the 640×480 FLC Panel#20 (25 × 70 ms, Effect#59) that flares the circle and whites
        // out at frame 20; its low-resolution frames are replaced by the same flare drawn live, sharp at any size.
        audio.sfx(Sfx.deathSummon);
        for (const b of banners) b.classList.add('over');
        await spell(s, alive, () => { for (const b of banners) b.classList.add('fade'); });
        if (!alive()) return;
        s.close();
        audio.restore();
        resolve(pick);
      };
      cast = () => { if (phase === 'pick' && pick >= 0) { phase = 'cast'; if (castBtn) castBtn.hidden = true; label?.remove(); void doCast(); } };
      choose = (i: number) => {
        if (phase !== 'pick') { if (phase === 'intro') skipIntro = true; return; }
        // First tap shows the name label, a second tap on the same symbol (or 施法！) casts it.
        if (pick === i) { cast(); return; }
        audio.sfx(Sfx.magic); // a symbol (MAGIC table 0x4757e7: Effect#39)
        pick = i;
        showLabel(i);
        if (auto !== undefined) { say(`${nameOf(ctx, a.p)}選擇了\n「${MAGIC_NAMES[i]}」`); return; }
        say(`「${MAGIC_NAMES[i]}」\n就決定是這個嗎？`);
        if (castBtn) castBtn.hidden = false;
      };
      // A computer picks by itself: the symbol and who chose it, a moment to read, then the spell.
      const autoPick = async () => {
        if (auto === undefined || phase !== 'pick') return;
        await s.wait(skipIntro ? 300 : 700);
        if (!alive() || phase !== 'pick') return;
        choose(auto);
        await s.wait(skipIntro ? 900 : 1800);
        if (alive()) cast();
      };
      if (phase === 'cast') { void doCast(); return; }
      if (phase === 'pick') { showGroup(); if (pick >= 0) choose(pick); else if (auto === undefined) say(LINES.turn); else void autoPick(); return; }
      // Intro: three lines (a tap skips them), the eyes glow, the group appears in the ball.
      // A computer's turn skips the last line («you decide their fate»), which talks to the player.
      for (const line of auto === undefined ? LINES.intro : LINES.intro.slice(0, 2)) {
        if (skipIntro) break;
        say(line);
        await s.wait(1500);
        if (!alive()) return;
      }
      const glowEyes = s.box('mg-eyes pl-pop', 296, 194, 40, 18);
      await s.wait(skipIntro ? 300 : 900);
      if (!alive()) return;
      glowEyes.remove();
      showGroup();
      say(`${GROUP_LINES[group]}`);
      who.innerHTML = whoHtml();
      who.hidden = false;
      who.classList.add('pl-pop');
      await s.wait(1300);
      if (!alive()) return;
      phase = 'pick';
      if (auto === undefined) say(LINES.turn); else void autoPick();
    });
    // Taps on the scene during the intro skip it (as a left click does in the original).
    scene.root.addEventListener('pointerdown', () => { if (phase === 'intro') skipIntro = true; });
  });
}

const nameOf = (ctx: ScreenContext, p: number): string => ctx.game.name(p);

askScreens['choose:magic'] = (ctx, a) => magicScreen(ctx, a as Choose);

// A human chose on the screen above; a computer's choice plays the same scene by itself before the magic works.
// Then, for everyone, a notice of which spell was cast on whom (the scene goes by fast), before it works.
fxScreens['magic'] = async (ctx, fx) => {
  const g = ctx.game, p = g.players[fx.p ?? -1], d = fx.data as { group: number; magic: number; targets: number[] } | undefined;
  if (!p || !d) return;
  if (!g.isHuman(p)) {
    const names = d.targets.map(t => nameOf(ctx, t)).join('、');
    const ask: Choose = { t: 'choose', p: p.id, title: '魔法屋', text: `對象：${MAGIC_GROUPS[d.group]}（${names}）`,
      options: MAGIC_NAMES.map((label, value) => ({ label, value })), cancellable: false, screen: 'magic' };
    await magicScreen(ctx, ask, d.magic);
  }
  await spellNotice(ctx, p.id, d);
};

/** Bad for whoever it hits (the header colour); 存入所有現金, 就地加蓋房屋, 得一張卡片 are good. */
const GOOD_SPELLS = new Set([4, 5, 6]);

/** 「X 在魔法屋對 Y、Z 施展了「…」」: the result box, at least 2 s, a tap closes it after that. */
function spellNotice(ctx: ScreenContext, caster: number, d: { group: number; magic: number; targets: number[] }): Promise<void> {
  const spellName = MAGIC_NAMES[d.magic] ?? '';
  const whom = d.targets.length ? d.targets.map(t => nameOf(ctx, t)).join('、') : '無人';
  return resultBox(ctx, {
    fx: GOOD_SPELLS.has(d.magic) ? 'card-good' : 'card-bad', title: '魔法屋', tag: spellName,
    head: `${nameOf(ctx, caster)}對${MAGIC_GROUPS[d.group]}（${whom}）施展「${spellName}」`,
    lines: d.targets.map(t => ({ p: t, text: `中了「${spellName}」` })),
  });
}
