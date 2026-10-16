import { describe, expect, it } from 'vitest';
import { boardVoice, characterVoice, voiceOf } from './audio';
import { holidayMusic } from './holidays';
import { pack } from '../core/date';
import { EVENT_LINES } from './lines';

describe('voices (docs/rules/12 §3)', () => {
  it('finds the screens\' lines by their text, also filled-in ones', () => {
    expect(voiceOf('歡迎光臨\n道具店！')).toBe(5);
    expect(voiceOf('現在馬上為您\n開出這一期的\n號碼……')).toBe(18);
    expect(voiceOf('嗨！\n又到了每月\n十五號樂透\n開獎時間∼')).toBe(17);
    expect(voiceOf('底價12000元\n請意者出價。')).toBe(132);
    expect(voiceOf('沒有這句')).toBeUndefined();
  });
  it('gives each character its own voice for the same slot', () => {
    expect(characterVoice(0, EVENT_LINES[0][14])).toBe(1064);
    expect(characterVoice(1, EVENT_LINES[1][0])).toBe(1077);
  });
  it('numbers the news and fate boards', () => {
    expect(boardVoice('news', 4, 0)).toBe(153);
    expect(boardVoice('fate', 12, 0)).toBe(197);
    expect(boardVoice('fate', 33, 2)).toBe(226);
  });
});

describe('holiday music (01 §4.4)', () => {
  it('plays MIDI14-1 on 12/25 for one day on the four original maps', () => {
    expect(holidayMusic(pack(2026, 12, 25), 3)).toEqual({ music: 13, days: 1 });
    expect(holidayMusic(pack(2026, 12, 25), 5)).toBeNull();
  });
  it('plays MIDI14-2 for three days from the lunar new year in Taiwan and China', () => {
    expect(holidayMusic(pack(2026, 2, 17), 0)).toEqual({ music: 14, days: 3 });
    expect(holidayMusic(pack(2026, 2, 17), 2)).toBeNull();
    expect(holidayMusic(pack(2026, 2, 18), 1)).toBeNull();
  });
});
