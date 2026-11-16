/**
 * 重慶's own news and fate (docs/rules/33 §5, the user 2026-11-09): 18 news (5 good, 13 bad) and 22 fate (7 good, 15
 * bad), drawn mixed with the original decks by their counts (core/chongqing.ts). No card is lost and nobody stands
 * still (「丟卡的這種不要有…原地休息的…沒啥意義」). Each card has its own picture: maps/remake/events/<id>.webp
 * (tools/still-redraw/chongqing-events/events.py).
 */
export interface CqCard { id: string; kind: 'news' | 'fate'; good: 0 | 1; head: string; text: string }

const N = (id: string, good: 0 | 1, head: string, text: string): CqCard => ({ id, kind: 'news', good, head, text });
const F = (id: string, good: 0 | 1, head: string, text: string): CqCard => ({ id, kind: 'fate', good, head, text });

/** `{x}` fills in amounts and names. */
export const CQ_NEWS: CqCard[] = [
  N('cq-n-hotpotfest', 1, '火鍋節開幕', '重慶火鍋節開幕！\n每棟房子收入{amount}元'),
  N('cq-n-hongyadong', 1, '洪崖洞夜景爆紅', '洪崖洞夜景爆紅，遊客擠爆！\n大型用地每級收入{amount}元'),
  N('cq-n-lightrail', 1, '輕軌新線通車', '輕軌新線通車！\n{street}地價上漲20%'),
  N('cq-n-changan', 1, '長安汽車新車熱賣', '長安汽車新車熱賣！\n股價連漲兩天'),
  N('cq-n-newyear', 1, '解放碑跨年夜', '解放碑跨年夜，大家發紅包！\n每人收到{amount}元'),
  N('cq-n-heat', 0, '高溫限電', '山城高溫限電！\n每棟房子按等級交電費'),
  N('cq-n-flood', 0, '長江汛期漲水', '長江汛期漲水！\n一層江邊有房子被淹，降一級'),
  N('cq-n-fog', 0, '大霧封江', '大霧封江，輪渡停航！\n一層的大型用地按等級賠錢'),
  N('cq-n-roadworks', 0, '山城修路', '山城修路，生意難做！\n{street}地價下跌20%'),
  N('cq-n-proptax', 0, '房產調控', '房產調控！\n地主按房產價值交2%'),
  N('cq-n-jam', 0, '黃桷灣立交大堵車', '黃桷灣立交大堵車！\n每人交擁堵費{amount}元'),
  N('cq-n-landslide', 0, '暴雨山體滑坡', '暴雨山體滑坡！\n二層有房子受損，降一級'),
  N('cq-n-nightmarket', 0, '夜市整治', '夜市整治！\n大型用地每級罰款{amount}元'),
  N('cq-n-stocks', 0, '本地股集體跳水', '重慶本地股集體跳水！\n全部股票連跌兩天'),
  N('cq-n-oldestate', 0, '老舊小區改造', '老舊小區改造攤派！\n每棟房子按等級出錢'),
  N('cq-n-expropriate', 0, '舊城改造徵收', '舊城改造徵收！\n{name}的{street}地被收回\n補償{amount}元'),
  N('cq-n-bankfall', 0, '江岸塌方', '江岸塌方！\n{name}的{street}地塌了，變回空地'),
  N('cq-n-illegal', 0, '違建拆除', '違建拆除！\n{name}的{street}整塊拆除收回'),
];

export const CQ_FATE: CqCard[] = [
  F('cq-f-bangbang', 1, '棒棒軍幫你扛行李', '棒棒軍幫你扛行李\n直接送上一層！'),
  F('cq-f-hotpot', 1, '吃到正宗老火鍋', '吃到正宗老火鍋\n得30點券'),
  F('cq-f-ciqikou', 1, '磁器口淘到寶', '磁器口淘到寶\n得到一張卡片'),
  F('cq-f-shortcut', 1, '8D立交抄近路', '8D立交抄近路\n瞬間到了另一個路口'),
  F('cq-f-lottery', 1, '中了福彩', '中了福彩！\n得{amount}元'),
  F('cq-f-spicycontest', 1, '吃辣大賽冠軍', '吃辣大賽拿了冠軍！\n獎金{amount}元'),
  F('cq-f-hotpotboss', 1, '火鍋店老闆認出你', '火鍋店老闆認出你是老顧客\n免單還送50點券'),
  F('cq-f-lost8d', 0, '在8D城市迷路', '在8D城市迷路\n走著走著換了一層'),
  F('cq-f-spicyhosp', 0, '特辣火鍋硬撐', '本地人請你吃特辣火鍋\n你硬撐到住院2天'),
  F('cq-f-shibati', 0, '爬十八梯累癱', '爬十八梯累癱\n找人按摩花了{amount}元'),
  F('cq-f-redlight', 0, '闖紅燈', '闖紅燈被罰\n罰款{amount}元'),
  F('cq-f-wrongtrain', 0, '大霧坐錯輕軌', '大霧坐錯輕軌\n打車回來花了{amount}元'),
  F('cq-f-bangbangdown', 0, '被棒棒軍坑了', '被棒棒軍坑了\n扛到下一層'),
  F('cq-f-ankle', 0, '爬坡崴了腳', '爬坡崴了腳\n住院1天'),
  F('cq-f-mahjong', 0, '打麻將輸了', '打麻將輸了\n輸掉{amount}元'),
  F('cq-f-motortaxi', 0, '坐摩的被宰', '坐摩的被司機宰了一刀\n花了{amount}元'),
  F('cq-f-noodle', 0, '重慶小麵三勺辣子', '重慶小麵加了三勺辣子\n辣到失聲，扣20點券'),
  F('cq-f-crackdown', 0, '掃黑除惡', '掃黑除惡，被抓了典型\n行政拘留5天'),
  F('cq-f-ninegrid', 0, '九宮格特辣鍋底', '外地朋友挑戰九宮格特辣鍋底\n辣到住院3天'),
  F('cq-f-lazichicken', 0, '辣子雞吃太多', '辣子雞吃太多上火\n去醫院輸液1天'),
  F('cq-f-suanlafen', 0, '酸辣粉辣到狂灌冰粉', '酸辣粉辣到狂灌冰粉\n一碗接一碗，花了{amount}元'),
  F('cq-f-maoxuewang', 0, '毛血旺辣得滿頭大汗', '吃毛血旺辣得滿頭大汗\n錢包掉進鍋裡，損失{amount}元'),
];

/** The original decks' sizes (docs/rules/33 §5: mixed by their counts). */
export const ORIGINAL_NEWS = 36;
export const ORIGINAL_FATE = 37;

export const CQ_ID_BASE = 5000;
export const CQ_CARDS: CqCard[] = [...CQ_NEWS, ...CQ_FATE];
export const cqCardById = (id: number): CqCard | undefined => (id >= CQ_ID_BASE ? CQ_CARDS[id - CQ_ID_BASE] : undefined);
