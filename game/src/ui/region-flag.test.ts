import { afterEach, describe, expect, it, vi } from 'vitest';
import { myRegion } from './party-net';
import atlas from './flags/atlas.json';
import { cleanCc, flagHtml, placeName } from './region-flag';

afterEach(() => { vi.restoreAllMocks(); });

const inZone = (timeZone: string) => vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({ resolvedOptions: () => ({ timeZone }) } as Intl.DateTimeFormat);

describe('the flag beside a name', () => {
  it('any country by its code, in the right place on the picture', () => {
    expect(flagHtml({ cc: 'TW' })).toContain('title="台灣"');
    expect(flagHtml({ cc: 'CN' })).toContain('title="中國大陸"');
    expect(flagHtml({ cc: 'BR' })).toContain('rflag');
    expect(flagHtml({ cc: 'AD' })).toContain('background-position:0.000% 0.000%');
    expect(flagHtml({ cc: 'ZW' })).not.toBe(flagHtml({ cc: 'AD' }));
    for (const c of atlas.codes.match(/../g)!) expect(flagHtml({ cc: c.toUpperCase() }), c).toContain('rflag');
  });
  it('the address wins over the time zone; without it the time zone; else nothing', () => {
    expect(flagHtml({ cc: 'JP', region: '台灣' })).toBe(flagHtml({ cc: 'JP' }));
    expect(flagHtml({ region: '台灣' })).toContain('background-position');
    expect(flagHtml({ region: '亞洲' })).toBe('');
    expect(flagHtml({})).toBe('');
    expect(flagHtml(undefined)).toBe('');
    expect(placeName({ cc: 'HK', region: '日本' })).toBe('香港');
    expect(placeName({ region: '亞洲' })).toBe('亞洲');
  });
  it('台灣 by who looks: the Chinese flag in mainland China, its own elsewhere', () => {
    const seen = (cc: string, zone = 'Asia/Tokyo') => {
      vi.stubGlobal('localStorage', { getItem: () => cc, setItem: () => {} });
      inZone(zone);
      return { flag: flagHtml({ cc: 'TW' }), name: placeName({ cc: 'TW' }) };
    };
    const at = (cc: string) => /background-position:[^"]+/.exec(flagHtml({ cc }))![0];
    vi.stubGlobal('localStorage', { getItem: () => 'JP', setItem: () => {} });
    inZone('Asia/Tokyo');
    const tw = at('TW');
    const cn = at('CN');
    expect(seen('CN').flag).toContain(cn);
    expect(seen('CN').name).toBe('中國台灣');
    expect(seen('JP', 'Asia/Shanghai').flag).toContain(cn); // a VPN: the time zone tells
    expect(seen('TW', 'Asia/Taipei').flag).toContain(tw);
    expect(seen('TW', 'Asia/Shanghai').flag).toContain(tw); // the address in 台灣 wins over a Shanghai clock
    expect(seen('TW', 'Asia/Shanghai').name).toBe('台灣');
    expect(seen('TW', 'Asia/Taipei').name).toBe('台灣');
    expect(seen('US', 'America/New_York').flag).toContain(tw);
    expect(seen('CN').flag).not.toContain(tw);
    // only 台灣's player changes
    seen('CN');
    expect(flagHtml({ cc: 'JP' })).toContain(at('JP'));
    vi.unstubAllGlobals();
  });
  it('a bad code is no code (it goes into the page)', () => {
    expect(cleanCc('tw')).toBeUndefined();
    expect(cleanCc('"><')).toBeUndefined();
    expect(flagHtml({ cc: '"><b' })).toBe('');
  });
  it('American and European time zones name the country', () => {
    inZone('America/Los_Angeles'); expect(myRegion()).toBe('美國');
    inZone('America/Toronto'); expect(myRegion()).toBe('加拿大');
    inZone('Europe/London'); expect(myRegion()).toBe('英國');
    inZone('Asia/Shanghai'); expect(myRegion()).toBe('中國大陸');
    inZone('America/Bogota'); expect(myRegion()).toBe('美洲');
  });
});
