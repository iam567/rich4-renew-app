/**
 * Climate tables for the remake's daily weather (docs/rules/16-weather.md; not in the original game).
 *
 * Every row is in DAYS PER MONTH (January … December), averaged over the years of the source:
 *  - rain:     days with precipitation ≥ 1.0 mm (rain or snow)
 *  - heavy:    days with ≥ 10 mm (how many rainy days are heavy)
 *  - thunder:  days with thunder heard (雷日数)
 *  - snow:     snow days, the mean of "snow observed" (雪日数) and "≥ 1 cm fell" — flurries count half
 *  - fog:      fog / mist days (JMA 霧日数 × 2: the JMA count is visibility < 1 km only)
 *  - overcast: days with mean cloud amount ≥ 8.5 (雲量 ≥ 8.5の日数); rainy days are mostly among them
 *  - typhoon:  days a typhoon blows over the map (JMA approach counts × a share, see below)
 *
 * Sources
 *  - 日本: 気象庁 平年値 1991–2020 (www.data.jma.go.jp/stats/etrn/view/nml_sfc_ym.php, views a1 降水量階級日数,
 *    a3 雲量・大気現象, a4 雪), stations 東京 47662, 大阪 47772, 札幌 47412, 福岡 47807, 熊本 47819, 鹿児島 47827,
 *    那覇 47936. Typhoons: 気象庁「台風の平年値」 monthly approach counts 1991–2020
 *    (www.data.jma.go.jp/yoho/typhoon/statistics/average/average.html): 沖縄 × 0.8, 九州 (北部/南部 mean) × 0.6,
 *    本土 × 0.25 for 東京/大阪, × 0.08 for 札幌.
 *  - 台灣: 中央氣象署 Taipei 1991–2020 normals (precipitation days ≥ 0.1 mm × 0.72 for ≥ 1 mm, sunshine %);
 *    thunder, fog and typhoon days are estimates (afternoon thunderstorms Jun–Aug, 3–4 typhoon warnings a year).
 *  - 中國大陸: mean of 北京, 上海 (徐家匯/閔行), 廣州 — China Meteorological Administration 1991–2020 normals
 *    (precipitation days ≥ 0.1 mm × 0.72, snowy days, sunshine %); thunder days estimated from annual totals
 *    (北京 ~35, 上海 ~30, 廣州 ~75 a year, Guangdong climate centre) spread over the warm months.
 *  - 美國: mean of New York (Central Park), Chicago (O'Hare), Los Angeles (Downtown) — NOAA 1991–2020 normals
 *    (precipitation days ≥ 0.01 in × 0.85, snowy days ≥ 0.1 in), NOAA 1961–1990 percent of possible sunshine;
 *    thunder days estimated from NOAA annual counts (~19, ~38, ~3).
 *  - Overcast days where only sunshine % is known: overcast / days = 0.17 + 1.55 × (0.62 − sunshine), clamped to
 *    0.03 … 0.85 (fitted to 東京: January 62 % sun ↔ 17 % overcast days, June 29 % ↔ 68 %). heavy = 0.35 × rain.
 *  - Workshop maps: a neutral temperate climate, the mean of 東京, 大阪, New York and 上海.
 *
 * The derivation script is reproduced in docs/rules/16-weather.md §3.
 */

export interface Climate {
  rain: number[]; heavy: number[]; thunder: number[]; snow: number[]; fog: number[]; overcast: number[]; typhoon: number[];
}

export type ClimateId = 'taiwan' | 'china' | 'japan' | 'usa' | 'tokyo' | 'osaka' | 'sapporo' | 'kyushu' | 'okinawa' | 'temperate';

export const CLIMATES: Record<ClimateId, Climate> = {
  /** 台灣 (map 0): Taipei. Grey, drizzly winters; afternoon thunderstorms in summer; typhoons Jul–Sep. */
  taiwan: {
    rain: [9.8, 8.6, 10.2, 10.4, 10.4, 11.3, 8.5, 10.5, 9.9, 9.2, 9, 9.4],
    heavy: [3.4, 3, 3.6, 3.7, 3.7, 4, 3, 3.7, 3.5, 3.2, 3.1, 3.3],
    thunder: [0.3, 0.8, 2, 3, 4.5, 6.5, 9, 9.5, 4.5, 0.8, 0.3, 0.2],
    snow: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    fog: [1.5, 1.5, 1.5, 1, 0.5, 0, 0, 0, 0, 0.2, 0.5, 1],
    overcast: [24, 21, 22.6, 22.3, 22.1, 20.9, 14.9, 13.4, 14.9, 19.7, 20.4, 23.5],
    typhoon: [0, 0, 0, 0, 0.1, 0.2, 0.8, 1, 0.8, 0.3, 0.1, 0],
  },
  /** 中國大陸 (map 1): 北京 + 上海 + 廣州. Dry sunny north in winter, wet thundery south in summer. */
  china: {
    rain: [4.7, 5.3, 7.1, 7.5, 8.3, 10.5, 9.9, 9.6, 7, 4.4, 4.3, 3.8],
    heavy: [1.6, 1.9, 2.5, 2.6, 2.9, 3.7, 3.5, 3.4, 2.5, 1.5, 1.5, 1.3],
    thunder: [0.2, 0.9, 2.3, 4.3, 6, 8, 10.2, 9.3, 4.2, 1, 0.3, 0.1],
    snow: [1.6, 1.4, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.6, 1.2],
    fog: [2.3, 2.3, 2.5, 1.5, 0.6, 0.3, 0.3, 0.4, 0.6, 1.2, 1.8, 2.3],
    overcast: [14.1, 14, 16, 15, 15, 16.4, 13.6, 12.5, 11.1, 10.1, 10.7, 11.4],
    typhoon: [0, 0, 0, 0, 0, 0.1, 0.3, 0.4, 0.3, 0.1, 0, 0],
  },
  /** 日本 (map 2): 札幌 + 東京 + 大阪 + 福岡 + 那覇, the whole country from snowy north to subtropical south. */
  japan: {
    rain: [9.6, 9.2, 10.6, 9.7, 9.6, 10.7, 9.7, 9.3, 10.4, 9.2, 9, 9],
    heavy: [2.6, 2.5, 3.7, 3.5, 4.1, 5.1, 4.4, 4.1, 4.8, 3.8, 2.9, 2.6],
    thunder: [0.4, 0.5, 0.9, 1.1, 1.4, 1.8, 2.9, 3.7, 2.4, 1, 0.7, 0.5],
    snow: [6.9, 6, 4.6, 1.3, 0, 0, 0, 0, 0, 0.2, 2.1, 5.5],
    fog: [0.1, 0.2, 0.2, 0.5, 0.6, 0.4, 0.2, 0, 0.1, 0.2, 0.2, 0.1],
    overcast: [11.8, 11.1, 12.2, 12.1, 14.4, 17.8, 15.2, 12, 12.1, 10.6, 10.2, 10.5],
    typhoon: [0, 0, 0, 0, 0.1, 0.2, 0.4, 0.6, 0.6, 0.3, 0, 0],
  },
  /** 美國 (map 3): New York + Chicago + Los Angeles. Snowy Midwest winters, thundery summers, sunny California. */
  usa: {
    rain: [7.9, 7.3, 7.6, 7.5, 7.3, 6.5, 5.8, 5.5, 5, 6.3, 6.2, 7.8],
    heavy: [2.8, 2.5, 2.7, 2.6, 2.6, 2.3, 2, 1.9, 1.8, 2.2, 2.2, 2.7],
    thunder: [0.3, 0.4, 1, 1.8, 2.7, 3.6, 3.9, 3.4, 1.9, 0.8, 0.4, 0.2],
    snow: [4.1, 3.2, 2, 0.4, 0, 0, 0, 0, 0, 0.1, 0.6, 2.7],
    fog: [1.5, 1.5, 1.5, 1.3, 1.5, 1.2, 0.7, 0.7, 0.7, 1.2, 1.3, 1.7],
    overcast: [7.7, 6.8, 6.4, 5.7, 5.8, 4.6, 3.2, 3, 4.5, 4.9, 9.8, 10.1],
    typhoon: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  /** 東京 (map 100): sunny dry winters, 梅雨 in June, thunder and typhoons late summer. */
  tokyo: {
    rain: [4.5, 5.2, 9.2, 9.5, 10.1, 11.6, 10.5, 7.9, 11, 10.5, 7.4, 5.2],
    heavy: [1.9, 2, 4, 4, 4.4, 5.4, 4.2, 3.8, 5.6, 5.3, 2.6, 1.8],
    thunder: [0.2, 0.2, 0.5, 1.1, 1.6, 1.2, 2.5, 3.2, 2.5, 0.8, 0.4, 0.2],
    snow: [1.8, 2.1, 0.8, 0.1, 0, 0, 0, 0, 0, 0, 0, 0.3],
    fog: [0, 0, 0, 0.8, 0.4, 0.2, 0.2, 0, 0.2, 0.2, 0.8, 0],
    overcast: [5.2, 7.3, 10.6, 12.1, 15.2, 20.5, 18.6, 14.8, 15.6, 14.8, 9.6, 5.9],
    typhoon: [0, 0, 0, 0, 0.1, 0.1, 0.2, 0.4, 0.5, 0.2, 0, 0],
  },
  /** 大阪 (map 101). */
  osaka: {
    rain: [5.6, 6.3, 9.1, 9.2, 9.5, 11.3, 10, 7.2, 9.5, 8.3, 6.2, 6.1],
    heavy: [1.5, 2.2, 3.9, 3.6, 4.2, 5.6, 5.2, 3.2, 4.6, 3.9, 2.5, 1.9],
    thunder: [0.4, 0.3, 0.6, 0.8, 1.4, 1.1, 3.1, 4.3, 2.9, 1, 0.6, 0.7],
    snow: [2.4, 2.9, 0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0.9],
    fog: [0.2, 0.4, 0.8, 0.4, 0.2, 0.4, 0.2, 0, 0.2, 0.4, 0.2, 0.4],
    overcast: [7.1, 8.3, 10.5, 10.5, 13.9, 18.9, 16.3, 10.8, 12.9, 10.6, 7.8, 6.2],
    typhoon: [0, 0, 0, 0, 0.1, 0.1, 0.2, 0.4, 0.5, 0.2, 0, 0],
  },
  /** 札幌 (map 102): snow on most days from December to March, no 梅雨. */
  sapporo: {
    rain: [18.3, 16, 13.9, 9.6, 8.5, 7.5, 7.7, 9.5, 10.2, 11.6, 14.6, 16],
    heavy: [3.3, 2.5, 2.1, 1.6, 1.8, 2, 2.9, 4.1, 4.1, 3.3, 3.7, 3.7],
    thunder: [0.3, 0.3, 0.4, 0.2, 0.6, 1, 1, 1.4, 1.3, 1.6, 0.7, 0.5],
    snow: [25.4, 21.9, 20.1, 6.3, 0.1, 0, 0, 0, 0, 1.1, 10.4, 23],
    fog: [0, 0.2, 0.2, 0.4, 0.8, 0.8, 0.4, 0.2, 0, 0.2, 0.2, 0],
    overcast: [16.8, 13.9, 13.9, 11.4, 13.6, 14.8, 17.1, 15.2, 11.2, 9.5, 12.9, 15.4],
    typhoon: [0, 0, 0, 0, 0, 0, 0.1, 0.1, 0.2, 0.1, 0, 0],
  },
  /** 九州 (map 103): 福岡 + 熊本 + 鹿兒島. Heavy 梅雨 rain, the most summer thunder, basin fog in 熊本. */
  kyushu: {
    rain: [8.1, 8.6, 10.8, 9.7, 9.1, 13.8, 11.6, 10.3, 9.7, 6.8, 8, 7.8],
    heavy: [2.4, 3.1, 4.7, 4.6, 4.5, 8.6, 6.8, 5.1, 4.8, 2.9, 3, 2.5],
    thunder: [0.6, 0.8, 1.5, 1.6, 1.3, 2.9, 5.8, 5.9, 3.1, 0.9, 1.3, 0.7],
    snow: [3.5, 2.4, 0.7, 0, 0, 0, 0, 0, 0, 0, 0, 2.2],
    fog: [0.7, 0.6, 0.5, 0.5, 0.8, 0.5, 0, 0, 0.1, 0.2, 0.7, 1.3],
    overcast: [10.7, 9.3, 10.9, 11, 13.5, 19.3, 15, 10.3, 11.6, 9.1, 8.6, 9],
    typhoon: [0, 0, 0, 0, 0.1, 0.2, 0.4, 0.6, 0.7, 0.3, 0, 0],
  },
  /** 沖繩 (map 104): 那覇. 梅雨 May–June, typhoons Jul–Oct, never snow. */
  okinawa: {
    rain: [10.2, 9.9, 10.9, 10.3, 11.4, 11.3, 9.4, 12.3, 11.8, 8.8, 8.2, 9.3],
    heavy: [3.8, 3.5, 4.5, 4.5, 6, 6.3, 3.8, 4.5, 5.2, 3.5, 3, 3.4],
    thunder: [0.3, 0.7, 1.5, 2, 2.1, 3.5, 2.7, 3.5, 2.4, 1, 0.4, 0.3],
    snow: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    fog: [0, 0, 0.2, 0.6, 1, 0.2, 0, 0, 0, 0, 0, 0],
    overcast: [16.4, 15.2, 14.9, 16.1, 17.2, 17, 8.7, 8.7, 8.6, 9, 11.6, 14],
    typhoon: [0, 0, 0, 0, 0.3, 0.5, 1.2, 1.8, 1.5, 0.9, 0.2, 0],
  },
  /** Workshop maps: 東京 + 大阪 + New York + 上海. */
  temperate: {
    rain: [6.7, 6.9, 9.2, 9.1, 9.4, 10.7, 9.6, 8.2, 8.8, 8.1, 7, 6.8],
    heavy: [2.3, 2.4, 3.6, 3.5, 3.7, 4.5, 3.9, 3.3, 3.8, 3.5, 2.5, 2.3],
    thunder: [0.2, 0.3, 0.8, 1.4, 2, 2.4, 4.3, 4.7, 2.5, 0.8, 0.4, 0.3],
    snow: [2.5, 2.5, 1.1, 0.1, 0, 0, 0, 0, 0, 0, 0.1, 1.1],
    fog: [1.2, 1.1, 1.2, 1.1, 0.8, 0.5, 0.3, 0.2, 0.4, 0.7, 1.1, 1.2],
    overcast: [9.8, 9.8, 11.3, 11, 13, 16.6, 13.3, 10.4, 12, 11, 10.9, 9.9],
    typhoon: [0, 0, 0, 0, 0, 0.1, 0.2, 0.3, 0.4, 0.1, 0, 0],
  },
};

/**
 * The climate of a map (the game's `settings.mapId`), or null for a map without weather: the four theme maps of the
 * original (4–7: 星座 / 武俠 / 恐龍 / 城市主題) are fantasy worlds and stay as they are.
 */
export function climateOf(mapId: number): ClimateId | null {
  switch (mapId) {
    case 0: return 'taiwan';
    case 1: return 'china';
    case 2: return 'japan';
    case 3: return 'usa';
    case 100: return 'tokyo';
    case 101: return 'osaka';
    case 102: return 'sapporo';
    case 103: return 'kyushu';
    case 104: return 'okinawa';
  }
  if (mapId >= 4 && mapId <= 7) return null;
  // Workshop maps (≥ 1000) and any later remake map without its own table.
  return 'temperate';
}
