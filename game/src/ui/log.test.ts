import { describe, expect, it } from 'vitest';
import { lastEnd, logFile, noise, oldLogs, redact, stamp } from './log';

describe('the error log', () => {
  it('names a file an hour', () => {
    const t = new Date(2026, 10, 5, 9, 3, 7, 45);
    expect(logFile(t)).toBe('w-20261105-09.log');
    expect(stamp(t)).toBe('11-05 09:03:07.045');
  });
  it('drops only log files older than 24 hours', () => {
    const now = new Date(2026, 10, 25, 12, 30);
    expect(oldLogs(['w-20261124-11.log', 'n-20261124-11.log', 'w-20261124-12.log', 'w-20261125-12.log', 'w-20261001-00.log', 'slot-0.json', 'current'], now))
      .toEqual(['w-20261124-11.log', 'n-20261124-11.log', 'w-20261001-00.log']);
  });
  it('keeps server addresses out, the page\'s own files in', () => {
    expect(redact('at https://play.example.com:8443/relay?x=1 and wss://1.2.3.4/a')).not.toMatch(/example|1\.2\.3\.4/);
    expect(redact('could not reach 10.20.30.40:8842')).not.toMatch(/10\.20/);
    expect(redact('capacitor://localhost/assets/index-1.js:3:4')).toBe('capacitor://localhost/assets/index-1.js:3:4');
    expect(redact('http://localhost/assets/a.js')).toBe('http://localhost/assets/a.js');
  });
  it('leaves out missing files and its own write errors, keeps a save that failed', () => {
    expect(noise('{"code":"OS-PLUG-FILE-0008","message":"readFile … does not exist"}')).toBe(true);
    expect(noise('{"code":"OS-PLUG-FILE-0013","message":"append rich4-log/w-1.log"}')).toBe(true);
    expect(noise('{"code":"OS-PLUG-FILE-0013","message":"write saves/slot-0.tmp.json"}')).toBe(false);
    expect(noise('[watchdog] no progress')).toBe(false);
  });
  it('tells a run cut off in front from one left or closed in the background', () => {
    expect(lastEnd('')).toBe('');
    expect(lastEnd('11-25 10:00:00.000 STEP a\n11-25 10:00:01.000 BYE no taps\n')).toContain('left normally');
    expect(lastEnd('11-25 10:00:00.000 STEP a\n11-25 10:00:01.000 HIDE 9 taps\n')).toContain('background');
    expect(lastEnd('11-25 10:00:00.000 HIDE x\n11-25 10:00:01.000 ERR boom\n    at f (a.js:1:2)\n')).toContain('CUT OFF in front at 11-25 10:00:01: ERR boom');
    expect(lastEnd('11-25 10:00:00.000 HIDE x\n11-25 10:00:01.000 BYE y\n11-25 10:00:02.000 SHOW ')).toContain('CUT OFF');
  });
});
