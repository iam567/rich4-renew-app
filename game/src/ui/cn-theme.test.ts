import { describe, expect, it } from 'vitest';
import { cnText } from './cn-theme';

// 長安's words (ui/cn-theme.ts): money in 文, the shops' prices in 點, places by their Tang names; idempotent.
describe('長安 words', () => {
  it('money', () => {
    expect(cnText('現金 50,000 元')).toBe('現金 50,000 文');
    expect(cnText('$50,000')).toBe('50,000 文');
    expect(cnText('存款 $55,000')).toBe('存款 55,000 文');
    expect(cnText('$200', '點')).toBe('200 點');
    expect(cnText('元宵節')).toBe('元宵節');
  });
  it('places, once only', () => {
    expect(cnText('去銀行存錢')).toBe('去櫃坊存錢');
    expect(cnText('櫃坊')).toBe('櫃坊');
    expect(cnText('黑市')).toBe('鬼市');
    expect(cnText('PASS')).toBe('不出價');
    for (const s of ['$1,000 元', '公園', '研究所', '集賢院']) expect(cnText(cnText(s))).toBe(cnText(s));
  });
});

// 清明上河's (Northern Song 汴京): the map's square names, 文, idempotent.
describe('清明上河 words', () => {
  const q = (s: string, unit = '文') => cnText(s, unit, 'qingming');
  it('places and money', () => {
    expect(q('去銀行存錢 $5,000')).toBe('去交子務存錢 5,000 文');
    expect(q('黑市')).toBe('鬼市子');
    expect(q('股市')).toBe('市易務');
    expect(q('公園')).toBe('瓦舍勾欄');
    expect(q('相國寺萬姓交易')).toBe('相國寺萬姓交易');
    for (const s of ['$1,000 元', '公園', '研究所', '書院', '道具店', '鬼市子', '醫院']) expect(q(q(s))).toBe(q(s));
  });
  it('長安 unchanged', () => expect(cnText('銀行')).toBe('櫃坊'));
});
