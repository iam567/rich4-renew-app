import { describe, expect, it } from 'vitest';
import { eraText } from './jq-theme';
import { toSimplified } from './zh-hans';

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
    expect(eraText('董事長阿土伯 請付3000元電腦費')).toBe('阿土伯同志 請付3000元收音機修理費');
    expect(eraText('收音機修理費')).toBe('收音機修理費');
    expect(eraText('11月份 銀行結算')).toBe('十一月份 先進工作者評比');
    expect(eraText('本月冠軍是．．。')).toBe('本月勞動模範\n是……');
    expect(eraText('改變命運的機會')).toBe('改變命運的機會');
  });

  // Issue #9: the page's text is renamed again every time it changes (this pass and 简体's MutationObserver), so a
  // rename must come to rest. 工程費 → 基建工程費 grew 「基建基建基建…工程费」 for good in 简体 and froze the page.
  it('every rename comes to rest, in 繁體 and through 简体 (no text grows without end)', () => {
    expect(eraText('董事長阿土伯 請付3000元工程費')).toBe('阿土伯同志 請付3000元基建工程費');
    for (const s of ['工程費', '基建工程費', '工程费', '基建工程费', '阿土伯付給孫小美\n\n工程費\n3,000 元', '公園', '公园', '醫院', '医院', '探監', '股票', '電腦費', '修車費', '保險費', '旅遊費']) {
      for (const hans of [false, true]) {
        let x = hans ? toSimplified(s) : s;
        const seen: string[] = [];
        for (let i = 0; i < 6; i++) { seen.push(x); const y = eraText(x); x = hans ? toSimplified(y) : y; }
        expect(seen.slice(2).every(v => v === x), `${s} (${hans ? '简体' : '繁體'}): ${seen.join(' → ')}`).toBe(true);
        expect(x.length).toBeLessThan(s.length + 12);
      }
    }
    expect(toSimplified(eraText(toSimplified('工程費')))).toBe('基建工程费');
  });
});
