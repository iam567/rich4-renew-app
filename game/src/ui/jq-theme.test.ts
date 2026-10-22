import { describe, expect, it } from 'vitest';
import { eraText } from './jq-theme';

// 激情歲月's words on screen (docs/rules/24 §3; the user 2026-10-22: every form of address is 同志).
describe('激情歲月 words', () => {
  it('renames the places once (the era words stay as they are)', () => {
    expect(eraText('樂透')).toBe('有獎銷售');
    expect(eraText('人民公園')).toBe('人民公園');
    expect(eraText('公園')).toBe('人民公園');
    expect(eraText('中國人民銀行的人民銀行支行')).toBe('中國人民銀行的人民銀行支行');
    expect(eraText('存入銀行')).toBe('存入人民銀行');
    expect(eraText('第一汽車製造廠')).toBe('第一汽車製造廠');
    expect(eraText('得到點券10點')).toBe('得到票證10點');
    for (const s of ['樂透', '股市', '監獄', '機車', '公園', '新聞']) expect(eraText(eraText(s))).toBe(eraText(s));
  });
  it('calls everyone 同志', () => {
    expect(eraText('董事長阿土伯 請付3000元加油費')).toBe('阿土伯同志 請付3000元加油費');
    expect(eraText('歡迎董事長光臨')).toBe('同志，你好！');
    expect(eraText('孫小美您好')).toBe('孫小美同志，你好！');
    expect(eraText('謝謝老闆！')).toBe('謝謝同志！');
    expect(eraText('董事長慢走！')).toBe('同志慢走！');
    expect(eraText('歡迎光臨\n道具店！')).toBe('同志，要貨不？\n噓……小聲點！');
    expect(eraText('收音機廠董事長，坐牢5天')).toBe('收音機廠的負責同志，關牛棚5天');
    expect(eraText('命運')).toBe('大字報');
    expect(eraText('11月份 銀行結算')).toBe('十一月份 先進工作者評比');
    expect(eraText('本月冠軍是．．。')).toBe('本月勞動模範\n是……');
    expect(eraText('改變命運的機會')).toBe('改變命運的機會');
  });
});
