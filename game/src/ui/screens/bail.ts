/**
 * Hospital and prison visits (docs/rules/06 §9.5, ui_hospital.asm / ui_prison.asm): the hospital corridor with
 * the nurse and eight beds (Panel #65), the prison wall with eight cells (Panel #63). Players lie in the left
 * column / top row, the thief, robber, hooligan and spy in the right column / bottom row. Tap someone to bail
 * them out; the answer is the same option value the plain dialog returned (player id, NPC actor 4..7, or -1).
 */
import type { Ask, Option } from '../../core/types';
import { NPC_NAMES } from '../../core/modules/places';
import { askScreens, type ScreenContext } from './registry';
import { charName, el, esc, openScene, type Scene } from './place-scene';
import { audio, Theme } from '../audio';
import './bail.css';

type Choose = Extract<Ask, { t: 'choose' }>;

/** Slot of actor 0..7 (hospital: 147×102 beds; prison: 121×137 cells). */
const HOSPITAL_SLOTS = [[297, 1], [297, 121], [297, 241], [297, 361], [481, 1], [481, 121], [481, 241], [481, 361]];
const PRISON_SLOTS = [[33, 24], [185, 24], [336, 24], [487, 24], [33, 183], [185, 183], [336, 183], [487, 183]];
const LINES = {
  hello: '您好！請問您要替誰\n辦理出院手續？',
  prison: '探監時間到了。\n要保釋誰呢？',
  poor: '抱歉！你的點數不足！',
  okHospital: 'ＯＫ！您的朋友已經\n可以出院了！',
  okPrison: '手續辦好了，\n可以出獄了！',
  byeHospital: '要保重身體喔！',
  byePrison: '下次再來探望吧！',
};
/** NPC thank-you lines (`_special_player_strings`, actor 4..7). */
const THANKS = ['謝謝你！你真是我的\n再生父母！', '我先走了！大恩大德\n來日再報！', '太感激了！我一定會\n報答你的！', '受人點水之恩，\n必當湧泉以報！'];
/** Their voices (#0123-#0126). */
const THANKS_VOICE = [124, 125, 123, 126];

function bailScreen(ctx: ScreenContext, a: Choose): Promise<number> {
  const g = ctx.game, me = g.players[a.p];
  const prison = a.title.includes('監');
  const place = prison ? 'prison' : 'hospital';
  const A = prison ? 63 : 65;
  const slots = prison ? PRISON_SLOTS : HOSPITAL_SLOTS;
  const byValue = new Map<number, Option>(a.options.map(o => [o.value, o]));
  // Actors: players 0..n-1, NPCs from npcBase (4..7 with up to 4 players). In 大富豪模式 (twelve players) whoever is
  // inside takes the eight places in turn (docs/rules/17 §8); otherwise each actor has its own bed / cell.
  const isP = (v: number) => v < g.npcBase;
  const npc = (v: number) => v - g.npcBase;
  const price = (v: number) => (isP(v) ? 30 : 300);
  const nameOf = (v: number) => (isP(v) ? charName(ctx, v) : NPC_NAMES[npc(v)]);
  const daysOf = (v: number) => (isP(v) ? (g.players[v][place] & 0x7f) + 1 : 0);
  const actors = g.npcBase === 4 ? [0, 1, 2, 3, 4, 5, 6, 7] : a.options.map(o => o.value).slice(0, 8);
  const slotOf = (v: number) => (g.npcBase === 4 ? v : actors.indexOf(v));
  // The hospital plays MIDI16, the prison MIDI15 (ui_hospital.asm:1529, ui_prison.asm:917).
  audio.theme(prison ? Theme.prison : Theme.hospital);
  return new Promise(resolve => {
    let pick = -1, busy = false;
    let say: (t: string) => void = () => {};
    let moveSay: (at: number[], arch: number, frame: number) => void = () => {};
    let setButtons: (mode: 'idle' | 'confirm' | 'none') => void = () => {};
    let nurse: HTMLImageElement | null = null;
    const sprites = new Map<number, HTMLElement[]>();
    let tip: HTMLElement | null = null;
    // Portrait: the scene cropped to what matters (hospital: nurse and beds; prison: the cells), the talk under it.
    const [cx0, cw] = prison ? [28, 584] : [96, 544];
    const scene = openScene(ctx, `bl-scene ${place}`, p => (p ? [cw, 760] : [640, 480]), s => {
      const P = s.portrait;
      sprites.clear();
      if (P) { s.box('bl-panel', 0, 480, cw, 280); s.layer = s.box('bl-world', -cx0, 0, 640, 480); }
      s.box('bl-dark', 0, 0, 640, 480);
      s.art('Panel', A, 0, 0, 0, 'bl-bg');
      // Who is inside: players by character (#65.14+c in bed / #63.5+c behind bars), NPCs by actor.
      for (let k = 0; k < 8; k++) {
        const v = actors[k] ?? -1;
        const [x, y] = slots[k];
        const o = byValue.get(v);
        if (!o) { if (prison) s.art('Panel', 63, 4, x, y, 'bl-empty'); continue; }
        const frame = isP(v) ? (prison ? 5 : 14) + g.players[v].character : (prison ? 13 : 22) + npc(v) + 4;
        const parts: HTMLElement[] = [];
        const who = s.art('Panel', A, frame, x, y, `bl-who${o.disabled ? ' poor' : ''}`);
        if (who) parts.push(who);
        if (prison) { const bars = s.art('Panel', 63, 3, x, y, 'bl-bars'); if (bars) parts.push(bars); }
        // Name plate on the bed / under the cell, with days left and the bail price.
        const plate = prison ? s.box('bl-plate', x + 4, y + 112, 113, 24) : s.box('bl-plate', x + 44, y + 74, 100, 24);
        plate.innerHTML = `<b>${esc(nameOf(v))}</b>${isP(v) ? `<i>${daysOf(v)}天</i>` : ''}`;
        parts.push(plate);
        const hit = prison ? s.box('bl-hit', x, y, 121, 137) : s.box('bl-hit', x, y, 147, 102);
        hit.dataset.v = String(v);
        hit.onclick = () => tap(v);
        parts.push(hit);
        sprites.set(v, parts);
      }
      // Nurse (#65.4 at (104,110)) and her speech box (#65.2 at (8,8)); prison: message box #63.1.
      if (!prison) nurse = s.art('Panel', 65, 4, 104, 110, 'bl-nurse pl-bob');
      const box = P ? s.box(`bl-say big${prison ? ' prison' : ''}`, 16, 494, cw - 32, 128, '', s.stage)
        : prison ? s.box('bl-say prison', 196, 312, 248, 110) : s.box('bl-say', 8, 8, 280, 100);
      const pic = ctx.bank.art('Panel', prison ? 63 : 65, prison ? 1 : 2);
      if (pic) box.style.backgroundImage = `url('${pic.src}')`;
      const text = el('div', 'bl-say-text');
      box.append(text);
      moveSay = (at, arch, frame) => {
        if (P) return;
        Object.assign(box.style, { left: `${at[0]}px`, top: `${at[1]}px`, width: '248px', height: '110px' });
        box.classList.add('bl-cloud');
        const art = ctx.bank.art('Panel', arch, frame);
        if (art) box.style.backgroundImage = `url('${art.src}')`;
      };
      say = t => { if (!THANKS.includes(t)) void audio.say(t); text.textContent = t; box.classList.remove('pl-pop'); void box.offsetWidth; box.classList.add('pl-pop'); };
      // Points plate (#65.30 at (8,432) / #63.21 at (542,432)), the player's points right-aligned in it.
      const [px, py] = prison ? [P ? cx0 + cw - 98 : 542, 432] : [P ? cx0 + 8 : 8, 432];
      s.art('Panel', A, prison ? 21 : 30, px, py);
      s.box('bl-points', px + 30, py + 8, 56, 26, String(me.points)).title = '你的點數';
      // Controls: in landscape on the floor / wall, in portrait on the panel under the scene.
      const ctl = P ? s.box('bl-ctl', 0, 630, cw, 130, '', s.stage) : s.box('bl-ctl-l', prison ? 20 : 104, prison ? 436 : 432, prison ? 420 : 180, 44);
      if (P) ctl.innerHTML = `<div class="bl-help">點選${prison ? '牢房' : '病床'}裡的人來保釋　玩家 30 點・${NPC_NAMES[0]}等 300 點</div>`;
      const row = el('div', 'bl-row');
      ctl.append(row);
      setButtons = mode => {
        row.replaceChildren();
        const btn = (cls: string, label: string, fn: () => void) => { const b = el('button', `candy ${cls}`, label); b.onclick = fn; row.append(b); };
        if (mode === 'idle') btn('ghost', '離開', leave);
        if (mode === 'confirm') { btn('yes', `保釋（${price(pick)}點）`, confirm); btn('no', '取消', cancel); }
      };
      setButtons(pick >= 0 ? 'confirm' : 'idle');
      if (pick >= 0) showTip(s, pick); else say(prison ? LINES.prison : LINES.hello);
    });
    /** The hover tooltip of the original (#65.3 at (slot.x - 80, slot.y) / #63.2 at (slot.x + 20, slot.y + 120)). */
    function showTip(s: Scene, v: number) {
      tip?.remove();
      tip = null;
      for (const [k, parts] of sprites) for (const p of parts) p.classList.toggle('bl-on', k === v);
      // Prison bottom row: the tooltip would cover the message box; the message says the same.
      if (prison && slotOf(v) >= 4) return;
      const [x, y] = slots[slotOf(v)];
      const [tx, ty] = prison ? [x + 20, y + 120] : [x - 80, y];
      tip = s.box(`bl-tip pl-pop ${prison ? 'prison' : ''}`, tx, ty, prison ? 100 : 98, 95,
        `<b>${esc(nameOf(v))}</b><span>保釋點數</span><span>${price(v)}點</span>`);
      const pic = ctx.bank.art('Panel', prison ? 63 : 65, prison ? 2 : 3);
      if (pic) tip.style.backgroundImage = `url('${pic.src}')`;
    }
    function tap(v: number) {
      if (busy) return;
      const o = byValue.get(v);
      if (!o) return;
      if (o.disabled || me.points < price(v)) { pick = -1; tip?.remove(); setButtons('idle'); say(LINES.poor); return; }
      pick = v;
      showTip(scene, v);
      const days = isP(v) ? `還剩${daysOf(v)}天・` : '';
      say(`要保釋${nameOf(v)}嗎？\n${days}保釋點數${price(v)}點`);
      setButtons('confirm');
    }
    function cancel() {
      pick = -1; tip?.remove(); tip = null;
      for (const parts of sprites.values()) for (const p of parts) p.classList.remove('bl-on');
      setButtons('idle');
      say(prison ? LINES.prison : LINES.hello);
    }
    async function confirm() {
      if (busy || pick < 0) return;
      busy = true;
      const v = pick;
      setButtons('none');
      tip?.remove();
      // The bed / cell empties; an NPC walks out (#64 at (420,450) / (365,450)) and thanks the visitor.
      for (const p of sprites.get(v) ?? []) p.classList.add('bl-gone');
      if (prison) scene.art('Panel', 63, 4, slots[slotOf(v)][0], slots[slotOf(v)][1], 'bl-empty pl-pop');
      if (!isP(v)) {
        scene.art('Panel', 64, npc(v), prison ? 365 : 420, 450, 'bl-free pl-pop');
        // The thank-you goes in the small cloud (#63.1 / #65.1) near the cells (prison (210,150), hospital (200,200)).
        moveSay(prison ? [178, 136] : [130, 150], prison ? 63 : 65, 1);
        say(THANKS[npc(v)]);
        void audio.voice(THANKS_VOICE[npc(v)]);
      } else say(prison ? LINES.okPrison : LINES.okHospital);
      await scene.wait(1800);
      scene.close();
      audio.restore();
      resolve(v);
    }
    async function leave() {
      if (busy) return;
      busy = true;
      setButtons('none');
      // The nurse sees you off (#65.9 at (91,112)).
      if (nurse) { nurse.dataset.x = '91'; nurse.dataset.y = '112'; scene.swap(nurse, 'Panel', 65, 9); }
      say(prison ? LINES.byePrison : LINES.byeHospital);
      await scene.wait(prison ? 700 : 1200);
      scene.close();
      audio.restore();
      resolve(-1);
    }
  });
}

askScreens['choose:bail'] = (ctx, a) => bailScreen(ctx, a as Choose);
