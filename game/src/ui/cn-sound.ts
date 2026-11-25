/**
 * 長安's sound effects (tools/tycoon-art/changan_sfx.py → maps/remake/changan/sfx/<name>.m4a): played on the game's
 * own audio graph (audio.ambience(), so the effects volume and mute apply), decoded once and kept. `loop` returns a stop
 * function (the gambling hall's murmur).
 */
import { audio } from './audio';
import { ASSETS } from './assets';

export type CnSound = 'crow' | 'flap' | 'peck' | 'kick' | 'whoosh' | 'special' | 'ko' | 'cheer' | 'boo' | 'rattle' | 'land' | 'coins' | 'hall';
const bufs = new Map<CnSound, Promise<AudioBuffer | null>>();
function load(ctx: AudioContext, name: CnSound) {
  let b = bufs.get(name);
  if (!b) {
    b = fetch(`${ASSETS}/maps/remake/changan/sfx/${name}.m4a`).then(r => r.arrayBuffer()).then(a => ctx.decodeAudioData(a)).catch(() => null);
    bufs.set(name, b);
  }
  return b;
}
/** Loads the named sounds ahead (a screen opening), so the first hit is on time. */
export function cnPreload(...names: CnSound[]) { const a = audio.ambience(); if (a) for (const n of names) void load(a.ctx, n); }

export function cnSound(name: CnSound, volume = 1, loop = false): () => void {
  const a = audio.ambience();
  if (!a) return () => {};
  let src: AudioBufferSourceNode | null = null, stopped = false;
  void load(a.ctx, name).then(buf => {
    if (!buf || stopped) return;
    src = a.ctx.createBufferSource(); src.buffer = buf; src.loop = loop;
    const g = a.ctx.createGain(); g.gain.value = volume;
    src.connect(g).connect(a.out); src.start();
  });
  return () => { stopped = true; try { src?.stop(); } catch { /* ended */ } };
}
