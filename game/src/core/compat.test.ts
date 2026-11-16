/** 不同版本聯機 (core/compat.ts): which versions play together and what a game at an older level goes without. */
import { describe, expect, it } from 'vitest';
import { cmpVer, family, lacking, oldest, ruleOn, together, type Change } from './compat';

const CH: Change[] = [{ id: 'a', since: '1.2.1', name: '甲' }, { id: 'b', since: '1.2.3', name: '乙' }];

describe('versions', () => {
  it('compares part by part as numbers', () => {
    expect(cmpVer('1.2.10', '1.2.9')).toBe(1);
    expect(cmpVer('1.0.1.5', '1.2.0')).toBe(-1);
    expect(cmpVer('1.2', '1.2.0')).toBe(0);
    expect(family('1.2.3')).toBe('1.2');
    expect(oldest(['1.2.3', '1.2.0', '1.2.10'])).toBe('1.2.0');
  });
  it('1.2.x play together; older ones only with their own version; big versions apart', () => {
    expect(together('1.2.0', '1.2.7')).toBe(true);
    expect(together('1.2.0', '1.2.0.1')).toBe(true);
    expect(together('1.1.2', '1.1.2')).toBe(true);
    expect(together('1.1.2', '1.2.0')).toBe(false);
    expect(together('1.1.1', '1.1.2')).toBe(false);
    expect(together('1.2.5', '1.3.0')).toBe(false);
    expect(together('1.3.0', '1.3.2')).toBe(true);
  });
  it('a game at an older level goes without the newer changes', () => {
    expect(lacking('1.2.0', '1.2.3', CH).map(c => c.id)).toEqual(['a', 'b']);
    expect(lacking('1.2.1', '1.2.3', CH).map(c => c.id)).toEqual(['b']);
    expect(lacking('1.2.3', '1.2.3', CH)).toEqual([]);
    expect(ruleOn('1.2.1', 'a', CH)).toBe(true);
    expect(ruleOn('1.2.1', 'b', CH)).toBe(false);
    expect(ruleOn(undefined, 'b', CH)).toBe(true);
    expect(ruleOn('1.2.0', 'unknown', CH)).toBe(true);
  });
});
