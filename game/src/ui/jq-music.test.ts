import { describe, expect, it } from 'vitest';
import { BGM, THEMES, Theme, bgmCount, musicName } from './audio';
import { CN_THEME, CN_TRACKS, JQ_FANFARE, JQ_TRACKS, QM_THEME, QM_TRACKS, jqMusicQuality, musicSetFor } from './jq-music';

describe('激情歲月 own music (docs/rules/24 §16)', () => {
  it('is used only on 激情歲月 in a normal game: every other map and mode keeps the original music', () => {
    for (const id of [0, 1, 2, 3, 4, 5, 6, 7, 100, 101, 102, 103, 104, 105, 106, 108, 200, -1]) {
      expect(musicSetFor(id)).toBeNull();
      expect(musicSetFor(id, { on: true })).toBeNull();
      expect(musicSetFor(id, { tycoon: true, on: true })).toBeNull();
    }
    expect(musicSetFor(107, { tycoon: true, on: true })).toBeNull(); // never in 大富豪模式
  });
  it('plays the original music on 激情歲月 too when 專屬音樂 is off', () => {
    expect(musicSetFor(107, { on: false })).toBeNull();
  });
  it('rotates the five era tracks with the march first when on (the default)', () => {
    const set = musicSetFor(107)!; // no stored setting: on
    expect(set.tracks.map(t => t.name)).toEqual([...JQ_TRACKS]);
    expect(JQ_TRACKS[0]).toBe('jq-march');
    expect(bgmCount(set)).toBe(5);
    expect([0, 1, 2, 3, 4, 5].map(index => musicName(set, { kind: 'bgm', index }))).toEqual([...JQ_TRACKS, 'jq-march']);
    expect(set.tracks.every(t => /\/maps\/remake\/jiqing\/music\/jq-[a-z-]+\.m4a$/.test(t.url))).toBe(true);
    // every screen keeps its original theme (the shop, the lottery and the results share theme 6)
    for (let i = 0; i < THEMES.length; i++) expect(musicName(set, { kind: 'theme', index: i })).toBe(THEMES[i]);
    expect(musicName(set, { kind: 'theme', index: Theme.shop })).toBe(THEMES[6]);
    expect(musicName(set, { kind: 'fanfare', index: -1 })).toBe(JQ_FANFARE);
  });
  it('leaves the original rotation untouched without a set', () => {
    expect(bgmCount(null)).toBe(8);
    for (let i = 0; i < 8; i++) expect(musicName(null, { kind: 'bgm', index: i })).toBe(BGM[i]);
    for (let i = 0; i < THEMES.length; i++) expect(musicName(null, { kind: 'theme', index: i })).toBe(THEMES[i]);
  });
  it('音質: the loudspeaker files by default, the clean ones (names of their own) for 清晰, same order and count', () => {
    expect(jqMusicQuality()).toBe(0); // no stored setting: 大喇叭
    const horn = musicSetFor(107, { on: true })!, clean = musicSetFor(107, { on: true, clean: true })!;
    expect(horn.tracks.map(t => t.name)).toEqual([...JQ_TRACKS]);
    expect(clean.tracks.map(t => t.name)).toEqual(JQ_TRACKS.map(n => `${n}-clean`));
    expect(clean.fanfare?.name).toBe(`${JQ_FANFARE}-clean`);
    expect(clean.tracks.every(t => /\/maps\/remake\/jiqing\/music\/jq-[a-z-]+-clean\.m4a$/.test(t.url))).toBe(true);
    expect(musicSetFor(107, { on: false, clean: true })).toBeNull();
    expect(musicSetFor(0, { on: true, clean: true })).toBeNull();
  });
});

describe('清明上河 own music (map 111)', () => {
  it('rotates its six Song pieces, its jingle and its screens\' pieces; 長安 keeps its own', () => {
    const qm = musicSetFor(111)!, cn = musicSetFor(110)!;
    expect(qm.tracks.map(t => t.name)).toEqual([...QM_TRACKS]);
    expect(bgmCount(qm)).toBe(6);
    expect(qm.tracks.every(t => /\/maps\/remake\/qingming\/music\/qm-[a-z-]+\.m4a$/.test(t.url))).toBe(true);
    expect(qm.fanfare?.name).toBe('qm-fanfare');
    for (const [k, i] of Object.entries(QM_THEME)) {
      expect(i).toBeGreaterThanOrEqual(THEMES.length);
      expect(musicName(qm, { kind: 'theme', index: i })).toBe(`qm-${k}`);
    }
    // cn-exam.ts asks for CN_THEME.exam: the Song piece on 清明上河, the Tang one on 長安
    expect(musicName(qm, { kind: 'theme', index: CN_THEME.exam })).toBe('qm-exam');
    expect(musicName(cn, { kind: 'theme', index: CN_THEME.exam })).toBe('cn-exam');
    expect(cn.tracks.map(t => t.name)).toEqual([...CN_TRACKS]);
    expect(musicSetFor(111, { on: false })).toBeNull();
    expect(musicSetFor(111, { tycoon: true, on: true })).toBeNull();
  });
});
