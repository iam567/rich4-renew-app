/**
 * Traditional (Taiwan) → Simplified (mainland) Chinese for the 简体 display (lang.ts): OpenCC's `tw2s` chain from
 * opencc-js 1.4.2 (code MIT, dictionary data Apache-2.0 from opencc-data, see node_modules/opencc-js/LICENSES): CJK
 * compatibility forms are normalised, the text is split on the TSPhrases words, then Taiwan variants go back to
 * OpenCC's standard forms (TWVariantsRev + phrases) and those become Simplified (TSPhrases + TSCharacters), so
 * 乾坤 stays 乾坤 while 乾淨 becomes 干净. Only these five tables are bundled (about 75 KB), in a chunk loaded when
 * 简体 is chosen. Display only: the game's data, saves and rules never see the result.
 */
import { ConverterFactory, Trie } from 'opencc-js/core';
import CJK from 'opencc-js/dict/CJK_Compatibility_Ideographs';
import TW_VARIANTS_REV_PHRASES from 'opencc-js/dict/TWVariantsRevPhrases';
import TW_VARIANTS_REV from 'opencc-js/dict/TWVariantsRev';
import TS_PHRASES from 'opencc-js/dict/TSPhrases';
import TS_CHARACTERS from 'opencc-js/dict/TSCharacters';

/**
 * The game's own corrections, applied last:
 * - 牠 (Taiwan's "it" for animals) is a variant the mainland writes 它.
 */
const OVERRIDES = '牠 它';

/**
 * TWVariantsRev turns Taiwan's 么 into 幺; the game's Traditional text never uses 么 itself, but 麼 becomes 么, so
 * keeping that entry would turn an already converted 怎么 into 怎幺 on a second pass. Dropping it keeps the
 * conversion idempotent.
 */
const TW_VARIANTS = TW_VARIANTS_REV.split('|').filter(e => !e.startsWith('么 ')).join('|');

/**
 * Words of the history banks (長安, 清明上河) the tables get wrong, or change again on a second pass: 畢昇's own 昇, 著稱 /
 * 著錄, the place 乾縣, 目乾連, and 「於」＋「戲曲」 (not the old exclamation). Each also as it comes out, so it rests there.
 */
const PHRASES = `${TS_PHRASES}|${['畢昇 毕昇', '著稱 著称', '著錄 著录', '乾縣 乾县', '乾連 乾连', '於戲曲 于戏曲', '于闐 于阗']
  .flatMap(x => { const [a, b] = x.split(' '); return [`${a} ${b}`, `${b} ${b}`]; }).join('|')}`;

/** (the first step would make their 著 a 着) */
const VARIANT_PHRASES = `${TW_VARIANTS_REV_PHRASES}|著稱 著稱|著錄 著錄|著称 著称|著录 著录`;

const normalize = ConverterFactory([CJK]);
const segmenter = new Trie();
segmenter.loadDict(PHRASES);
const chain = ConverterFactory([VARIANT_PHRASES, TW_VARIANTS], [PHRASES, TS_CHARACTERS], [OVERRIDES]);

/** Converts one string (no cache; lang.ts caches). */
export function toSimplified(s: string): string {
  return segmenter.segment(normalize(s)).map(chain).join('');
}
