/**
 * 大富豪模式 local news and fate (docs/rules/18, the remake's addition): ten news and ten fate events per city, five
 * good and five bad each, in Traditional Chinese (the 簡繁 switch converts them). Data only; the rules that run them
 * are in ./regional-events.ts, the pictures are maps/remake/events/<id>.webp (tools/still-redraw/regional-events).
 *
 * Money is × the price index F at the moment (as every original amount). `{s6}` in a text is the name of the city's
 * local stock in slot 6 (editor/city_companies.py), `{street}` / `{lot}` the street or lot hit, `{n}` a count.
 * Effects reuse what the engine already does: money, hospital / prison days, a turn standing still, cards, tools,
 * points, building levels on this city's lots, a street's land price, this city's stocks and companies.
 */
import type { WeatherKind } from '../../ui/weather';

export type Tone = 'good' | 'bad';
export type RegionalKind = 'news' | 'fate';

/** What a fate event does to the player who drew it. Amounts × F. */
export type FateEffect =
  | { t: 'gain'; amount: number }                    // cash in (god luck "gain": void / double)
  | { t: 'fine'; amount: number }                    // paid to the lottery pool (luck "loss": waived / doubled; insurance refunds)
  | { t: 'hospital'; days: number }                  // luck "misfortune", pardon / frame cards, then the hospital
  | { t: 'prison'; days: number }                    // the same, prison
  | { t: 'stay' }                                    // luck "misfortune"; stands still one turn
  | { t: 'card'; id: number; n?: number }            // a card (id 1..30; 0 = one drawn from the pool), n times
  | { t: 'tool'; id: number }                        // a tool (05 §1 id), up to the 9 held
  | { t: 'points'; amount: number }                  // 點券 (negative: lost, not below 0)
  | { t: 'upgrade' }                                 // one of the player's buildings in this city one level up, free
  | { t: 'repair'; perLevel: number; cap: number }   // repairs: perLevel × the player's building levels here, capped
  | { t: 'lose-card' };                              // a random card of the player's goes back to the pool

/** What a news event does in its city. Amounts × F. */
export type NewsEffect =
  | { t: 'stay'; who: 'all' | 'walk' | 'ride' }                          // locals on the road stand still one turn
  | { t: 'per-lot'; amount: number; cap: number }                        // each owner: ± amount per built lot here, capped
  | { t: 'per-level'; amount: number; cap: number }                      // each owner pays amount per building level here
  | { t: 'value-tax'; percent: number; cap: number }                     // each owner pays % of the property value here
  | { t: 'facility'; amount: number; cap: number; hotels?: boolean }     // owners of large plots: ± amount per level
  | { t: 'damage'; lots: number; levels: number }                        // random built lots here lose levels
  | { t: 'area'; radius: number }                                        // every building around a random property −1
  | { t: 'stocks'; slots: number[] | 'all'; up: boolean; days: number }  // this city's stocks forced ±10 % for days
  | { t: 'company'; delta: number; up: boolean }                         // a random local company's surplus ± and its stock
  | { t: 'street'; factor: number }                                      // a random street's land price × factor
  | { t: 'everyone'; amount: number }                                    // every local player ± amount
  | { t: 'top-owner'; amount: number }                                   // the biggest landowner of this city gets amount
  | { t: 'renovate' }                                                    // a random built lot here one level up, free
  | { t: 'cards-all' }                                                   // every local player draws a card
  | { t: 'one-hospital'; days: number }                                  // one random local on the road to hospital
  | { t: 'typhoon' };                                                    // locals stand still and one building −1

export interface Condition {
  /** Months (1..12) the event can happen in. */
  months?: number[];
  /** Today's weather of the city (ui/weather.ts weatherOf: a pure function of seed, map and date). */
  weather?: WeatherKind[];
}

interface Base { id: string; map: number; tone: Tone; head: string; text: string; when?: Condition }
export type RegionalEvent =
  | (Base & { kind: 'fate'; effect: FateEffect })
  | (Base & { kind: 'news'; category: string; effect: NewsEffect });

const WET: WeatherKind[] = ['rain', 'storm', 'typhoon'];
const SNOW: WeatherKind[] = ['snow'];
const WINTER = [11, 12, 1, 2, 3];

const n = (map: number, id: string, tone: Tone, category: string, head: string, text: string, effect: NewsEffect, when?: Condition): RegionalEvent =>
  ({ id, map, kind: 'news', tone, category, head, text, effect, ...(when ? { when } : {}) });
const f = (map: number, id: string, tone: Tone, head: string, text: string, effect: FateEffect, when?: Condition): RegionalEvent =>
  ({ id, map, kind: 'fate', tone, head, text, effect, ...(when ? { when } : {}) });

const TOKYO = 100, OSAKA = 101, SAPPORO = 102, KYUSHU = 103, OKINAWA = 104;

export const REGIONAL_EVENTS: RegionalEvent[] = [
  // ------------------------------------------------------------------ 東京: high land prices, high stakes (bad 60 %)
  n(TOKYO, 'tokyo-n-akiba', 'good', '財經新聞', '秋葉原電器街大特賣', '秋葉原電器街週末大特賣，人潮擠爆\n{s6}、{s8}股價連漲2天', { t: 'stocks', slots: [6, 8], up: true, days: 2 }),
  n(TOKYO, 'tokyo-n-hanami', 'good', '社會新聞', '上野公園櫻花盛開', '上野公園櫻花滿開，賞花人潮帶旺商圈\n東京地主每棟房屋收入{amount}元', { t: 'per-lot', amount: 600, cap: 6000 }, { months: [3, 4] }),
  n(TOKYO, 'tokyo-n-redevelop', 'good', '政府公告', '都心再開發計畫通過', '都心再開發計畫通過\n{street}地價上漲20％', { t: 'street', factor: 1.2 }),
  n(TOKYO, 'tokyo-n-dome', 'good', '社會新聞', '巨蛋演唱會連開三場', '巨蛋演唱會連開三場，飯店商場客滿\n東京大型用地每級收入{amount}元', { t: 'facility', amount: 1000, cap: 5000 }),
  n(TOKYO, 'tokyo-n-tourists', 'good', '財經新聞', '訪日觀光客創新高', '訪日觀光客創新高\n東京在地企業盈餘大增，股價上漲', { t: 'company', delta: 20000, up: true }),
  n(TOKYO, 'tokyo-n-rush', 'bad', '路況報導', '通勤電車大誤點', '尖峰時段電車大誤點，全城交通癱瘓\n在東京的人停留一回合', { t: 'stay', who: 'all' }),
  n(TOKYO, 'tokyo-n-proptax', 'bad', '政府公告', '加徵都心固定資產稅', '都廳加徵都心固定資產稅\n東京地主繳交地產價值的3％', { t: 'value-tax', percent: 3, cap: 15000 }),
  n(TOKYO, 'tokyo-n-guerrilla', 'bad', '氣象報導', '游擊豪雨，地下街淹水', '游擊豪雨襲擊都心，地下街淹水\n兩棟房屋受損', { t: 'damage', lots: 2, levels: 1 }, { weather: WET }),
  n(TOKYO, 'tokyo-n-quake', 'bad', '氣象報導', '首都圈強烈地震', '首都圈發生強烈地震\n{lot}一帶的房屋各降一級', { t: 'area', radius: 120 }),
  n(TOKYO, 'tokyo-n-crash', 'bad', '財經新聞', '東京股市閃電崩跌', '東京股市閃電崩跌\n東京12支股票連跌2天', { t: 'stocks', slots: 'all', up: false, days: 2 }),

  f(TOKYO, 'tokyo-f-dome', 'good', '巨蛋演唱會打工', '到巨蛋演唱會打工，領到加班費{amount}元', { t: 'gain', amount: 5000 }),
  f(TOKYO, 'tokyo-f-tuna', 'good', '豐洲鮪魚競標', '在豐洲市場標到頂級鮪魚，轉手賺了{amount}元', { t: 'gain', amount: 6000 }),
  f(TOKYO, 'tokyo-f-robot', 'good', '秋葉原新玩具', '在秋葉原買到最新型的機器娃娃', { t: 'tool', id: 1 }),
  f(TOKYO, 'tokyo-f-omikuji', 'good', '淺草寺抽到大吉', '淺草寺抽到大吉籤，獲得免罪卡', { t: 'card', id: 21 }),
  f(TOKYO, 'tokyo-f-esports', 'good', '電玩大賽奪冠', '參加秋葉原電玩大賽奪冠，獲得{amount}點券', { t: 'points', amount: 150 }),
  f(TOKYO, 'tokyo-f-crush', 'bad', '擠電車被擠傷', '尖峰時間擠電車被擠傷，住院3天', { t: 'hospital', days: 3 }),
  f(TOKYO, 'tokyo-f-ginza', 'bad', '銀座酒店被當肥羊', '在銀座酒店被當肥羊，酒錢付了{amount}元', { t: 'fine', amount: 10000 }),
  f(TOKYO, 'tokyo-f-shinjuku', 'bad', '新宿車站迷路', '在新宿車站的迷宮裡迷路，停留一回合', { t: 'stay' }),
  f(TOKYO, 'tokyo-f-pickpocket', 'bad', '澀谷路口被扒', '在澀谷十字路口被扒，掉了一張卡片', { t: 'lose-card' }),
  f(TOKYO, 'tokyo-f-party', 'bad', '街頭狂歡鬧事', '在澀谷街頭狂歡鬧事，被拘留3天', { t: 'prison', days: 3 }),

  // ------------------------------------------------------------------ 大阪: 食い倒れ, festivals, merchants (bad 55 %)
  n(OSAKA, 'osaka-n-tenjin', 'good', '社會新聞', '天神祭船渡御', '天神祭船渡御萬人空巷\n在大阪的人每人收到祭典紅包{amount}元', { t: 'everyone', amount: 1500 }, { months: [6, 7, 8] }),
  n(OSAKA, 'osaka-n-expo', 'good', '財經新聞', '博覽會帶動灣區開發', '博覽會帶動灣區開發\n大阪12支股票上漲一成', { t: 'stocks', slots: 'all', up: true, days: 1 }),
  n(OSAKA, 'osaka-n-kuromon', 'good', '政府公告', '黑門市場人潮回流', '黑門市場人潮回流\n表揚大阪第一大地主，獎金{amount}元', { t: 'top-owner', amount: 6000 }),
  n(OSAKA, 'osaka-n-arcade', 'good', '政府公告', '商店街整修補助', '商店街拱廊整修補助\n{lot}的房屋免費加蓋一層', { t: 'renovate' }),
  n(OSAKA, 'osaka-n-shopping', 'good', '社會新聞', '心齋橋觀光客爆買', '心齋橋觀光客爆買\n大阪地主每棟房屋收入{amount}元', { t: 'per-lot', amount: 300, cap: 3000 }),
  n(OSAKA, 'osaka-n-fans', 'bad', '路況報導', '球迷跳河慶祝奪冠', '在地球隊奪冠，球迷跳進道頓堀慶祝\n交通癱瘓，在大阪的人停留一回合', { t: 'stay', who: 'all' }),
  n(OSAKA, 'osaka-n-signboard', 'bad', '氣象報導', '強風吹落巨型招牌', '強風豪雨，道頓堀巨型招牌掉落\n{lot}的房屋受損', { t: 'damage', lots: 1, levels: 1 }, { weather: WET }),
  n(OSAKA, 'osaka-n-appliance', 'bad', '財經新聞', '家電大廠財報虧損', '家電大廠財報虧損\n{s6}、{s8}股價連跌2天', { t: 'stocks', slots: [6, 8], up: false, days: 2 }),
  n(OSAKA, 'osaka-n-subside', 'bad', '社會新聞', '港區地層下陷', '港區地層下陷調查出爐\n{street}地價下跌15％', { t: 'street', factor: 0.85 }),
  n(OSAKA, 'osaka-n-flu', 'bad', '社會新聞', '流感大流行', '流感大流行\n在大阪的人每人付醫藥費{amount}元', { t: 'everyone', amount: -2500 }),

  f(OSAKA, 'osaka-f-takoyaki', 'good', '章魚燒副業', '章魚燒攤副業生意興隆，賺了{amount}元', { t: 'gain', amount: 5000 }),
  f(OSAKA, 'osaka-f-kushikatsu', 'good', '串炸店第一萬名客人', '成為新世界串炸店的第一萬名客人，獎金{amount}元', { t: 'gain', amount: 3000 }),
  f(OSAKA, 'osaka-f-manzai', 'good', '漫才表演大受歡迎', '上台表演漫才大受歡迎，觀眾送你兩張卡片', { t: 'card', id: 0, n: 2 }),
  f(OSAKA, 'osaka-f-bargain', 'good', '日本橋殺價成功', '在日本橋電器街殺價成功，買到便宜的遙控骰子', { t: 'tool', id: 8 }),
  f(OSAKA, 'osaka-f-billiken', 'good', '摸福神腳底許願', '摸了通天閣福神的腳底許願，房子免費加蓋一層', { t: 'upgrade' }),
  f(OSAKA, 'osaka-f-kuidaore', 'bad', '道頓堀吃到倒', '在道頓堀吃到倒，花了{amount}元', { t: 'fine', amount: 7000 }),
  f(OSAKA, 'osaka-f-dive', 'bad', '跳道頓堀被帶走', '跳進道頓堀慶祝，被警察帶走拘留2天', { t: 'prison', days: 2 }),
  f(OSAKA, 'osaka-f-queue', 'bad', '主題樂園大排長龍', '主題樂園大排長龍，排到天黑，停留一回合', { t: 'stay' }),
  f(OSAKA, 'osaka-f-okonomi', 'bad', '大阪燒燙傷', '煎大阪燒時燙傷了手，住院2天', { t: 'hospital', days: 2 }),
  f(OSAKA, 'osaka-f-haggle', 'bad', '被大嬸殺價殺到賠本', '在商店街擺攤被大嬸殺價殺到賠本，損失{amount}元', { t: 'fine', amount: 5000 }),

  // ------------------------------------------------------------------ 札幌: snow, beer, crab (bad 40 %)
  n(SAPPORO, 'sapporo-n-yukimatsuri', 'good', '社會新聞', '札幌雪祭開幕', '札幌雪祭開幕，觀光客湧入大通公園\n札幌地主每棟房屋收入{amount}元', { t: 'per-lot', amount: 700, cap: 7000 }, { months: [1, 2] }),
  n(SAPPORO, 'sapporo-n-beer', 'good', '財經新聞', '啤酒花園開幕', '大通啤酒花園開幕，大排長龍\n{s9}股價連漲3天', { t: 'stocks', slots: [9], up: true, days: 3 }, { months: [6, 7, 8, 9] }),
  n(SAPPORO, 'sapporo-n-harvest', 'good', '社會新聞', '北海道農產大豐收', '北海道農產大豐收，農協發放紅利\n在札幌的人每人得到{amount}元', { t: 'everyone', amount: 2500 }),
  n(SAPPORO, 'sapporo-n-ski', 'good', '社會新聞', '滑雪季國際遊客湧入', '粉雪季開跑，國際滑雪客湧入\n札幌大型用地每級收入{amount}元', { t: 'facility', amount: 1200, cap: 7000 }, { months: [12, 1, 2, 3] }),
  n(SAPPORO, 'sapporo-n-shinkansen', 'good', '政府公告', '新幹線延伸札幌動工', '北海道新幹線延伸札幌正式動工\n{street}地價上漲20％', { t: 'street', factor: 1.2 }),
  n(SAPPORO, 'sapporo-n-avalanche', 'bad', '氣象報導', '大雪崩，房屋被壓毀', '連日大雪引發雪崩\n兩棟房屋被積雪壓毀，各降一級', { t: 'damage', lots: 2, levels: 1 }, { weather: SNOW }),
  n(SAPPORO, 'sapporo-n-blizzard', 'bad', '路況報導', '暴風雪封路', '暴風雪封鎖道路，全城停擺\n在札幌的人停留一回合', { t: 'stay', who: 'all' }, { weather: SNOW }),
  n(SAPPORO, 'sapporo-n-snowfee', 'bad', '政府公告', '加收除雪費', '除雪費用暴增，市府加收除雪費\n札幌地主每級房屋繳交{amount}元', { t: 'per-level', amount: 300, cap: 4000 }, { months: WINTER }),
  n(SAPPORO, 'sapporo-n-warehouse', 'bad', '財經新聞', '暴雪壓垮倉庫', '暴雪壓垮倉庫，在地企業虧損\n股價下跌', { t: 'company', delta: -10000, up: false }),
  n(SAPPORO, 'sapporo-n-bear', 'bad', '社會新聞', '棕熊闖入市區', '棕熊闖入郊區住宅區\n{street}地價下跌15％', { t: 'street', factor: 0.85 }),

  f(SAPPORO, 'sapporo-f-ramen', 'good', '拉麵大胃王奪冠', '在拉麵橫丁大胃王比賽奪冠，獎金{amount}元', { t: 'gain', amount: 5000 }),
  f(SAPPORO, 'sapporo-f-crab', 'good', '捕到大帝王蟹', '出海捕到大帝王蟹，賣了{amount}元', { t: 'gain', amount: 6000 }),
  f(SAPPORO, 'sapporo-f-icesculpt', 'good', '冰雕比賽得獎', '參加冰雕比賽得獎，獲得{amount}點券', { t: 'points', amount: 120 }),
  f(SAPPORO, 'sapporo-f-onsen-bear', 'good', '溫泉巧遇冬眠熊', '在定山溪溫泉巧遇冬眠中的熊，獲得冬眠卡', { t: 'card', id: 15 }),
  f(SAPPORO, 'sapporo-f-envelope', 'good', '大通公園撿到紅包', '在大通公園的雪堆裡撿到紅包，裡面有{amount}元', { t: 'gain', amount: 3000 }),
  f(SAPPORO, 'sapporo-f-roofsnow', 'bad', '屋頂積雪滑落', '屋頂積雪滑落被壓傷，住院3天', { t: 'hospital', days: 3 }, { weather: SNOW }),
  f(SAPPORO, 'sapporo-f-festival-fee', 'bad', '冰雪節報名費', '參加冰雪節，報名費加上裝備花了{amount}元', { t: 'fine', amount: 3000 }, { months: [1, 2] }),
  f(SAPPORO, 'sapporo-f-susukino', 'bad', '薄野喝到天亮', '在薄野喝到天亮，酒錢{amount}元', { t: 'fine', amount: 4000 }),
  f(SAPPORO, 'sapporo-f-slip', 'bad', '雪地滑倒', '在結冰的路上滑倒，停留一回合', { t: 'stay' }, { weather: SNOW }),
  f(SAPPORO, 'sapporo-f-pipes', 'bad', '水管結冰爆裂', '水管結冰爆裂，札幌的房屋每級修理費{amount}元', { t: 'repair', perLevel: 500, cap: 4000 }, { months: WINTER }),

  // ------------------------------------------------------------------ 九州: volcanoes, onsen, 屋台, typhoons (bad 50 %)
  n(KYUSHU, 'kyushu-n-yatai', 'good', '社會新聞', '博多屋台街大排長龍', '博多屋台街觀光客大排長龍\n九州地主每棟房屋收入{amount}元', { t: 'per-lot', amount: 500, cap: 5000 }),
  n(KYUSHU, 'kyushu-n-lantern', 'good', '財經新聞', '長崎燈會開幕', '長崎燈會開幕，觀光收入增加\n在地企業盈餘大增，股價上漲', { t: 'company', delta: 20000, up: true }, { months: [1, 2] }),
  n(KYUSHU, 'kyushu-n-chips', 'good', '政府公告', '半導體工廠進駐熊本', '半導體大廠進駐熊本\n{street}地價上漲20％', { t: 'street', factor: 1.2 }),
  n(KYUSHU, 'kyushu-n-train', 'good', '社會新聞', '觀光列車週年抽獎', '九州觀光列車週年慶\n在九州的人每人抽一張卡片', { t: 'cards-all' }),
  n(KYUSHU, 'kyushu-n-cars', 'good', '財經新聞', '汽車工廠增產', '九州汽車工廠增產\n{s5}、{s9}股價連漲2天', { t: 'stocks', slots: [5, 9], up: true, days: 2 }),
  n(KYUSHU, 'kyushu-n-sakurajima', 'bad', '氣象報導', '櫻島火山噴發', '櫻島火山噴發，火山灰覆蓋全城\n九州地主每級房屋清潔費{amount}元', { t: 'per-level', amount: 200, cap: 3000 }),
  n(KYUSHU, 'kyushu-n-typhoon', 'bad', '氣象報導', '颱風登陸九州', '強烈颱風登陸九州\n{lot}一帶的房屋各降一級', { t: 'area', radius: 150 }, { weather: ['typhoon'] }),
  n(KYUSHU, 'kyushu-n-landslide', 'bad', '氣象報導', '豪雨引發土石流', '豪雨引發土石流\n{lot}的房屋降兩級', { t: 'damage', lots: 1, levels: 2 }, { weather: WET }),
  n(KYUSHU, 'kyushu-n-aso', 'bad', '社會新聞', '阿蘇火山噴煙', '阿蘇火山噴煙，周邊旅館停業\n九州大型用地每級損失{amount}元', { t: 'facility', amount: -800, cap: 5000 }),
  n(KYUSHU, 'kyushu-n-power', 'bad', '政府公告', '電費調漲', '燃料費高漲，電費調漲\n在九州的人每人多繳{amount}元', { t: 'everyone', amount: -1000 }),

  f(KYUSHU, 'kyushu-f-beppu', 'good', '別府溫泉泡湯', '在別府溫泉泡湯，神清氣爽，獲得{amount}點券', { t: 'points', amount: 100 }),
  f(KYUSHU, 'kyushu-f-janken', 'good', '屋台划拳贏了', '在中洲屋台跟老闆划拳贏了，獎金{amount}元', { t: 'gain', amount: 4000 }),
  f(KYUSHU, 'kyushu-f-castella', 'good', '長崎蛋糕伴手禮', '長崎蛋糕伴手禮生意興隆，賺了{amount}元', { t: 'gain', amount: 5000 }),
  f(KYUSHU, 'kyushu-f-arita', 'good', '有田燒古董是真品', '家裡的有田燒古董鑑定是真品，賣了{amount}元', { t: 'gain', amount: 6000 }),
  f(KYUSHU, 'kyushu-f-rebuild', 'good', '熊本重建補助', '熊本城下町重建補助，你的房子免費加蓋一層', { t: 'upgrade' }),
  f(KYUSHU, 'kyushu-f-aso-gas', 'bad', '阿蘇火山氣體', '登阿蘇火山吸到火山氣體，住院2天', { t: 'hospital', days: 2 }),
  f(KYUSHU, 'kyushu-f-delay', 'bad', '豪雨班機延誤', '豪雨班機延誤，困在機場，停留一回合', { t: 'stay' }, { weather: WET }),
  f(KYUSHU, 'kyushu-f-windmill', 'bad', '風車村玩過頭', '在荷蘭風車村玩過頭，花了{amount}元', { t: 'fine', amount: 5000 }),
  f(KYUSHU, 'kyushu-f-smuggle', 'bad', '幫人搬到走私貨', '在港口幫人搬貨，竟是走私品，坐牢3天', { t: 'prison', days: 3 }),
  f(KYUSHU, 'kyushu-f-donation', 'bad', '熊本城重建捐款', '熊本城重建募款，捐出{amount}點券', { t: 'points', amount: -100 }),

  // ------------------------------------------------------------------ 沖繩: resorts, the sea, typhoons (bad 30 %)
  n(OKINAWA, 'okinawa-n-resort', 'good', '社會新聞', '觀光旺季飯店客滿', '觀光旺季，度假飯店間間客滿\n沖繩旅館每級收入{amount}元', { t: 'facility', amount: 1200, cap: 6000, hotels: true }),
  n(OKINAWA, 'okinawa-n-aquarium', 'good', '社會新聞', '水族館鯨鯊寶寶誕生', '水族館鯨鯊寶寶誕生，觀光客大增\n沖繩地主每棟房屋收入{amount}元', { t: 'per-lot', amount: 500, cap: 5000 }),
  n(OKINAWA, 'okinawa-n-eisa', 'good', '社會新聞', '太鼓舞祭典登場', '全島太鼓舞祭典熱鬧登場\n在沖繩的人每人得到{amount}元', { t: 'everyone', amount: 1500 }, { months: [7, 8, 9] }),
  n(OKINAWA, 'okinawa-n-beer', 'good', '財經新聞', '夏季啤酒節', '夏季啤酒節開跑\n{s8}、{s2}股價連漲2天', { t: 'stocks', slots: [8, 2], up: true, days: 2 }, { months: [5, 6, 7, 8, 9, 10] }),
  n(OKINAWA, 'okinawa-n-newresort', 'good', '政府公告', '新度假區開發', '新度假區開發計畫通過\n{street}地價上漲20％', { t: 'street', factor: 1.2 }),
  n(OKINAWA, 'okinawa-n-typhoon', 'bad', '氣象報導', '颱風直撲沖繩', '颱風直撲沖繩，班機全數停飛\n在沖繩的人停留一回合，{lot}的房屋受損', { t: 'typhoon' }, { weather: ['typhoon'] }),
  n(OKINAWA, 'okinawa-n-rainy', 'bad', '社會新聞', '梅雨季遊客取消行程', '梅雨季遊客紛紛取消行程\n沖繩大型用地每級損失{amount}元', { t: 'facility', amount: -600, cap: 3000 }, { months: [5, 6] }),
  n(OKINAWA, 'okinawa-n-redsoil', 'bad', '財經新聞', '紅土流入海洋', '紅土流入海洋，珊瑚白化\n在地企業被罰款，股價下跌', { t: 'company', delta: -10000, up: false }),
  n(OKINAWA, 'okinawa-n-habu', 'bad', '社會新聞', '毒蛇出沒', '飯匙倩（毒蛇）在郊區出沒\n一人被咬傷，住院2天', { t: 'one-hospital', days: 2 }),
  n(OKINAWA, 'okinawa-n-salt', 'bad', '氣象報導', '海風鹽害', '海風鹽害腐蝕海邊房屋\n{lot}的房屋受損', { t: 'damage', lots: 1, levels: 1 }),

  f(OKINAWA, 'okinawa-f-resort', 'good', '度假村生意興隆', '投資的度假村生意興隆，盈利{amount}元', { t: 'gain', amount: 6000 }),
  f(OKINAWA, 'okinawa-f-wreck', 'good', '潛水找到沉船寶物', '潛水找到古代沉船寶物，賣了{amount}元', { t: 'gain', amount: 7000 }),
  f(OKINAWA, 'okinawa-f-bottle', 'good', '海灘撿到漂流瓶', '在海灘撿到漂流瓶，裡面是一張卡片', { t: 'card', id: 0 }),
  f(OKINAWA, 'okinawa-f-shisa', 'good', '風獅爺保佑', '在家門口擺了一對風獅爺，獲得天使卡', { t: 'card', id: 9 }),
  f(OKINAWA, 'okinawa-f-kokusai', 'good', '國際通擺攤', '在國際通擺攤賣紀念品，賺了{amount}元', { t: 'gain', amount: 4000 }),
  f(OKINAWA, 'okinawa-f-jellyfish', 'bad', '被水母螫傷', '浮潛時被水母螫傷，住院2天', { t: 'hospital', days: 2 }),
  f(OKINAWA, 'okinawa-f-flight', 'bad', '颱風班機停飛', '颱風來襲班機停飛，困在機場一回合', { t: 'stay' }, { weather: ['typhoon', 'storm'] }),
  f(OKINAWA, 'okinawa-f-sunburn', 'bad', '曬傷脫皮', '在海灘曬傷脫皮，買藥花了{amount}元', { t: 'fine', amount: 2000 }),
  f(OKINAWA, 'okinawa-f-wallet', 'bad', '浮潛弄丟錢包', '浮潛時弄丟了錢包，損失{amount}元', { t: 'fine', amount: 3000 }),
  f(OKINAWA, 'okinawa-f-awamori', 'bad', '泡盛喝太多', '泡盛喝太多，醉倒在路邊，停留一回合', { t: 'stay' }),
];

/** The share of bad events in a city's local draws (docs/rules/18 §3, the user's numbers; hidden from the player). */
export const BAD_SHARE: Record<number, number> = { 100: 0.6, 101: 0.55, 102: 0.4, 103: 0.5, 104: 0.3 };

/** Chance that a news / fate draw in a tycoon city is a local event instead of the world deck (18 §2). */
export const LOCAL_CHANCE = 0.4;

/** Board ids of the local events (the news / fate fx `id`): 1000 + index, past the originals' 0..36. */
export const REGIONAL_ID_BASE = 1000;
