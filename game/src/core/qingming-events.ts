/**
 * 清明上河's own news (小報) and fate (卦攤) decks — generated from docs/qingming-events.json (the user 2026-11-23), one
 * for one with 長安's (changan-events.ts): the same effects in Northern Song 汴京 words. Pictures:
 * maps/remake/events/<id>.webp. Do not edit by hand: tools/tycoon-art/qingming_eventpics.py ts.
 */
import type { CnEvent } from './changan-events';
export const QINGMING_NEWS: CnEvent[] = [
{
"id": "qm-n-lantern",
"tone": "good",
"head": "上元燈山五夜不禁",
"text": "正月十五上元節，宣德門前紮起燈山，汴京五夜不禁\n每人得到賞燈紅包{amount}文",
"effect": {
"t": "everyone",
"amount": 1500
},
"when": {
"months": [
1,
2
]
}
},
{
"id": "qm-n-qionglin",
"tone": "good",
"head": "新科進士瓊林賜宴",
"text": "新科進士瓊林苑賜宴，人人簪花，書坊趕印程文\n{s10}股價連漲2天",
"effect": {
"t": "stocks",
"slots": [
10
],
"up": true,
"days": 2
}
},
{
"id": "qm-n-harvest",
"tone": "good",
"head": "京畿五穀豐登",
"text": "京畿風調雨順，五穀豐登\n每人得到{amount}文",
"effect": {
"t": "everyone",
"amount": 2000
}
},
{
"id": "qm-n-ricedear",
"tone": "bad",
"head": "汴京米價騰貴",
"text": "京城米價騰貴，一斗米要好幾百文\n每人付米錢{amount}文",
"effect": {
"t": "everyone",
"amount": -1500
}
},
{
"id": "qm-n-haibo",
"tone": "good",
"head": "泉州海舶運香藥入京",
"text": "大食海商的海舶從泉州運來乳香、龍腦\n{s7}、{s9}股價連漲2天",
"effect": {
"t": "stocks",
"slots": [
7,
9
],
"up": true,
"days": 2
}
},
{
"id": "qm-n-goryeo",
"tone": "good",
"head": "高麗使臣入貢",
"text": "高麗使臣入京朝貢，帶來人參、松子和高麗紙\n每人抽一張卡片",
"effect": {
"t": "cards-all"
}
},
{
"id": "qm-n-painting",
"tone": "good",
"head": "《清明上河圖》進呈御覽",
"text": "翰林畫師張擇端進呈《清明上河圖》，官家大悅\n汴京在地商號盈餘大增，股價上漲",
"effect": {
"t": "company",
"delta": 20000,
"up": true
}
},
{
"id": "qm-n-cuju",
"tone": "good",
"head": "御前蹴鞠大賽",
"text": "御前蹴鞠大賽，齊雲社的高手大顯身手，聖上賞賜滿城\n每人得到賞錢{amount}文",
"effect": {
"t": "everyone",
"amount": 1000
}
},
{
"id": "qm-n-drought",
"tone": "bad",
"head": "京畿大旱",
"text": "京畿大旱，汴河水淺，茶貨運不進來\n{s1}、{s11}股價連跌2天",
"effect": {
"t": "stocks",
"slots": [
1,
11
],
"up": false,
"days": 2
}
},
{
"id": "qm-n-locusts",
"tone": "bad",
"head": "蝗蟲過境",
"text": "蝗蟲過境，遮天蔽日\n兩棟房屋受損，各降一級",
"effect": {
"t": "damage",
"lots": 2,
"levels": 1
}
},
{
"id": "qm-n-snow",
"tone": "bad",
"head": "汴京大雪",
"text": "汴京連降大雪，街巷積雪難行\n所有人停留一回合",
"effect": {
"t": "stay",
"who": "all"
},
"when": {
"months": [
12,
1,
2
]
}
},
{
"id": "qm-n-yellowriver",
"tone": "bad",
"head": "黃河決口",
"text": "黃河決口，大水漫過京畿\n{lot}的房屋受損",
"effect": {
"t": "damage",
"lots": 1,
"levels": 1
}
},
{
"id": "qm-n-quake",
"tone": "bad",
"head": "京師地震",
"text": "京師地震，屋瓦紛落\n{lot}一帶的房屋各降一級",
"effect": {
"t": "area",
"radius": 120
}
},
{
"id": "qm-n-genyue",
"tone": "good",
"head": "艮嶽落成",
"text": "官家的御苑艮嶽落成，奇石林立，四方來觀\n{street}地價上漲20％",
"effect": {
"t": "street",
"factor": 1.2
}
},
{
"id": "qm-n-jiaozi",
"tone": "good",
"head": "交子務增發交子",
"text": "交子務增發交子，市面錢法流通\n{s0}股價連漲3天",
"effect": {
"t": "stocks",
"slots": [
0
],
"up": true,
"days": 3
}
},
{
"id": "qm-n-parade",
"tone": "bad",
"head": "禁軍大閱封街",
"text": "禁軍在御街大閱操練，街口封道\n路上走路的人停留一回合",
"effect": {
"t": "stay",
"who": "walk"
}
},
{
"id": "qm-n-fanlou",
"tone": "good",
"head": "樊樓新酒上市",
"text": "樊樓新釀上市，三層五樓夜夜燈火通明\n{s2}股價連漲2天",
"effect": {
"t": "stocks",
"slots": [
2
],
"up": true,
"days": 2
}
},
{
"id": "qm-n-jinming",
"tone": "good",
"head": "金明池開池",
"text": "三月金明池開池，龍舟爭標，都人傾城往觀\n路上的人都掉頭去看龍舟",
"effect": {
"t": "turn-all"
},
"when": {
"months": [
3,
4
]
}
},
{
"id": "qm-n-cuju2",
"tone": "good",
"head": "相國寺萬姓交易",
"text": "大相國寺每月五次開放萬姓交易，百貨雲集\n每人得到{amount}文",
"effect": {
"t": "everyone",
"amount": 1200
}
},
{
"id": "qm-n-ruyao",
"tone": "good",
"head": "汝窯天青進御",
"text": "汝窯燒出雨過天青的瓷器進貢御前，官窯名聲大噪\n{s6}股價連漲2天",
"effect": {
"t": "stocks",
"slots": [
6
],
"up": true,
"days": 2
}
},
{
"id": "qm-n-dashi",
"tone": "good",
"head": "大食海商獻奇珍",
"text": "大食海商帶來各國奇珍\n每人得到一個道具",
"effect": {
"t": "tools-all"
}
},
{
"id": "qm-n-chanyuan",
"tone": "good",
"head": "宋遼互通榷場",
"text": "宋遼和好，邊境榷場互市，商旅不絕\n12支股票上漲一成",
"effect": {
"t": "stocks",
"slots": "all",
"up": true,
"days": 1
}
},
{
"id": "qm-n-outerwall",
"tone": "bad",
"head": "修築外城",
"text": "朝廷下令修築汴京外城\n地主繳交地產價值的3％",
"effect": {
"t": "value-tax",
"percent": 3,
"cap": 15000
}
},
{
"id": "qm-n-epidemic",
"tone": "bad",
"head": "京師時疫",
"text": "京師時疫流行，藥鋪大排長龍\n每人付醫藥費{amount}文",
"effect": {
"t": "everyone",
"amount": -2500
}
},
{
"id": "qm-n-bisheng",
"tone": "good",
"head": "畢昇活字印書",
"text": "畢昇造出泥活字，書坊印書又快又多\n每人抽一張卡片",
"effect": {
"t": "cards-all"
}
},
{
"id": "qm-n-silt",
"tone": "bad",
"head": "汴河淤淺",
"text": "汴河淤淺，漕船擱淺難行\n{s3}股價連跌2天",
"effect": {
"t": "stocks",
"slots": [
3
],
"up": false,
"days": 2
}
},
{
"id": "qm-n-fire",
"tone": "bad",
"head": "汴京大火",
"text": "汴京夜裡失火，延燒數百家\n兩棟房屋受損，各降一級",
"effect": {
"t": "damage",
"lots": 2,
"levels": 1
}
},
{
"id": "qm-n-dredge",
"tone": "good",
"head": "疏浚汴河",
"text": "朝廷疏浚汴河，虹橋兩岸更加熱鬧\n{street}地價上漲20％",
"effect": {
"t": "street",
"factor": 1.2
}
},
{
"id": "qm-n-irontower",
"tone": "good",
"head": "開寶寺鐵塔落成",
"text": "開寶寺琉璃塔落成，香火鼎盛\n{lot}的房屋免費加蓋一層",
"effect": {
"t": "renovate"
}
},
{
"id": "qm-n-mianyi",
"tone": "bad",
"head": "新法徵免役錢",
"text": "王安石變法，按戶徵收免役錢\n每人繳納免役錢{amount}文",
"effect": {
"t": "everyone",
"amount": -2000
}
},
{
"id": "qm-n-jin",
"tone": "bad",
"head": "金兵南下，攻入汴京",
"text": "金兵鐵騎南下，攻破汴京城門\n{lot}一帶燒殺一空，房屋土地全失，在場的人受傷住院",
"effect": {
"t": "orig",
"n": 4
}
},
{
"id": "qm-n-liao",
"tone": "bad",
"head": "遼國細作縱火",
"text": "遼國細作混進城裡，夜裡放火焚掠\n{lot}的房屋燒毀，地主失去這塊地",
"effect": {
"t": "orig",
"n": 5
}
},
{
"id": "qm-n-flood",
"tone": "bad",
"head": "汴河決堤",
"text": "連日暴雨，汴河決堤\n{lot}被沖成荒地，地主失去這塊地",
"effect": {
"t": "orig",
"n": 19
}
},
{
"id": "qm-n-auction",
"tone": "good",
"head": "開封府拍賣官地",
"text": "開封府將一塊官地公開拍賣，價高者得",
"effect": {
"t": "orig",
"n": 7
}
},
{
"id": "qm-n-amnesty",
"tone": "good",
"head": "郊祀大赦",
"text": "官家南郊祭天，大赦天下\n獄中的人全部提前出獄",
"effect": {
"t": "orig",
"n": 0
}
},
{
"id": "qm-n-qianyi",
"tone": "good",
"head": "名醫錢乙義診",
"text": "名醫錢乙入京義診\n住院的人全部提前出院",
"effect": {
"t": "orig",
"n": 2
}
},
{
"id": "qm-n-dali",
"tone": "bad",
"head": "大理寺加重刑期",
"text": "大理寺嚴辦，獄中的人刑期各加3天",
"effect": {
"t": "orig",
"n": 1
}
},
{
"id": "qm-n-noherbs",
"tone": "bad",
"head": "藥材短缺",
"text": "海舶未到，藥材短缺\n住院的人各多住3天",
"effect": {
"t": "orig",
"n": 3
}
},
{
"id": "qm-n-huqian",
"tone": "bad",
"head": "按戶徵錢",
"text": "朝廷按戶徵錢\n每人繳交現金的5％",
"effect": {
"t": "orig",
"n": 11
}
},
{
"id": "qm-n-shiyi",
"tone": "bad",
"head": "市易務徵收商稅",
"text": "市易務徵收商稅\n每人繳交股票市值的5％",
"effect": {
"t": "orig",
"n": 13
}
},
{
"id": "qm-n-haunted",
"tone": "bad",
"head": "凶宅鬧鬼，地價下跌",
"text": "坊間盛傳凶宅鬧鬼\n{street}地價下跌三成",
"effect": {
"t": "orig",
"n": 14
}
},
{
"id": "qm-n-charcoal",
"tone": "bad",
"head": "炭火失火",
"text": "冬日炭盆失火\n{lot}的房屋受損，降一級",
"effect": {
"t": "orig",
"n": 15
}
},
{
"id": "qm-n-gale",
"tone": "bad",
"head": "大風拔木",
"text": "狂風大作，拔木折屋\n{lot}一帶的房屋各降一級，所幸無人受傷",
"effect": {
"t": "orig",
"n": 20
}
},
{
"id": "qm-n-whirlwind",
"tone": "bad",
"head": "旋風捲屋",
"text": "一陣旋風捲過\n{lot}的房屋受損，降一級",
"effect": {
"t": "orig",
"n": 21
}
},
{
"id": "qm-n-rain",
"tone": "bad",
"head": "秋雨連綿",
"text": "秋雨連綿，道路泥濘\n路上走路的人停留一回合",
"effect": {
"t": "orig",
"n": 16
}
},
{
"id": "qm-n-procession",
"tone": "bad",
"head": "官家出巡封街",
"text": "官家駕幸金明池，御街封道\n騎車開車的人停留一回合",
"effect": {
"t": "orig",
"n": 17
}
},
{
"id": "qm-n-closemarket",
"tone": "bad",
"head": "市易務閉市十天",
"text": "市易務下令閉市整頓\n10天內不能買賣股票",
"effect": {
"t": "orig",
"n": 26
}
},
{
"id": "qm-n-panic",
"tone": "bad",
"head": "市肆恐慌，股價全跌",
"text": "謠言四起，市肆恐慌\n12支股票全部下跌",
"effect": {
"t": "orig",
"n": 24
}
},
{
"id": "qm-n-shutshop",
"tone": "bad",
"head": "行舖停業",
"text": "一家行舖被勒令停業\n該股暫停交易10天",
"effect": {
"t": "orig",
"n": 27
}
},
{
"id": "qm-n-usury",
"tone": "bad",
"head": "商號違法放債",
"text": "商號違法放高利貸，東家下獄",
"effect": {
"t": "orig",
"n": 29
}
},
{
"id": "qm-n-dye",
"tone": "bad",
"head": "染坊污染汴河",
"text": "染坊廢水污染汴河，開封府罰款",
"effect": {
"t": "orig",
"n": 30
}
},
{
"id": "qm-n-shengchen",
"tone": "bad",
"head": "生辰綱被劫",
"text": "押送的生辰綱在黃泥岡被一夥好漢劫走，商號虧損",
"effect": {
"t": "orig",
"n": 32
}
},
{
"id": "qm-n-logging",
"tone": "bad",
"head": "濫採花石",
"text": "商號為花石綱濫採山林，官府罰款",
"effect": {
"t": "orig",
"n": 33
}
},
{
"id": "qm-n-noise",
"tone": "bad",
"head": "作坊噪音擾民",
"text": "打鐵作坊日夜敲打，鄰里告官，商號受罰",
"effect": {
"t": "orig",
"n": 34
}
},
{
"id": "qm-n-seaprofit",
"tone": "good",
"head": "海舶貿易獲利",
"text": "海舶貿易大賺一筆，商號盈餘大增",
"effect": {
"t": "orig",
"n": 31
}
},
{
"id": "qm-n-topowner",
"tone": "good",
"head": "表揚汴京第一大地主",
"text": "開封府表揚汴京第一大地主\n地最多的人得到{amount}文",
"effect": {
"t": "orig",
"n": 8
}
},
{
"id": "qm-n-relief",
"tone": "good",
"head": "朝廷賑濟貧戶",
"text": "朝廷賑濟，補助土地最少的人\n得到{amount}文",
"effect": {
"t": "orig",
"n": 9
}
},
{
"id": "qm-n-fangtian",
"tone": "bad",
"head": "方田均稅",
"text": "朝廷丈量田畝，方田均稅\n每人繳交地產價值的5％",
"effect": {
"t": "orig",
"n": 12
}
},
{
"id": "qm-n-tight",
"tone": "bad",
"head": "交子鋪銀根吃緊",
"text": "交子鋪銀根吃緊\n15天內所有人都不能借錢",
"effect": {
"t": "orig",
"n": 22
}
},
{
"id": "qm-n-search",
"tone": "bad",
"head": "開封府搜查違禁",
"text": "開封府的公人滿城搜查違禁之物\n每人被沒收一個道具",
"effect": {
"t": "take-tools"
}
}
];
export const QINGMING_FATE: CnEvent[] = [
{
"id": "qm-f-drunkcrash",
"tone": "bad",
"head": "酒後駕車撞城牆",
"text": "在樊樓和李清照斗酒鬥詞，酒後駕車一頭撞上城牆\n座駕全毀",
"effect": {
"t": "wreck"
},
"only": "riding",
"pics": {
"car": "qm-f-drunkcrash-car",
"scooter": "qm-f-drunkcrash-scooter"
}
},
{
"id": "qm-f-mifu",
"tone": "good",
"head": "米芾拜石",
"text": "書畫家米芾看中你家院子裡的怪石，納頭便拜\n出重金買下，得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-fail",
"tone": "bad",
"head": "科場落第",
"text": "省試落第，只得再住一年汴京\n付房租{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-pass",
"tone": "good",
"head": "金榜題名",
"text": "金榜題名，御街誇官\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-brawl",
"tone": "bad",
"head": "酒後鬧事",
"text": "在瓦子裡喝醉鬧事，被開封府的公人拿下\n入獄2天",
"effect": {
"t": "prison",
"days": 2
}
},
{
"id": "qm-f-cujufall",
"tone": "bad",
"head": "蹴鞠摔傷",
"text": "踢蹴鞠太拚命，一個倒掛金鉤摔下來\n住院3天",
"effect": {
"t": "hospital",
"days": 3
}
},
{
"id": "qm-f-treasure",
"tone": "good",
"head": "海商識寶",
"text": "大食海商一眼看中你家祖傳的舊珠子\n以高價買下，得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-pickpocket",
"tone": "bad",
"head": "萬姓交易遭扒手",
"text": "大相國寺萬姓交易人多擁擠，錢袋被扒手摸走\n損失{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-guanpu",
"tone": "bad",
"head": "關撲輸錢",
"text": "街頭關撲，連擲幾把都是背字\n輸掉{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-irontower",
"tone": "good",
"head": "登鐵塔遠眺",
"text": "登上開寶寺鐵塔，汴京十萬人家盡收眼底\n得到{amount}點券",
"effect": {
"t": "points",
"amount": {
"min": 10,
"max": 100,
"step": 10
}
}
},
{
"id": "qm-f-purse",
"tone": "good",
"head": "拾得錢袋",
"text": "在虹橋邊拾得一袋銅錢，無人認領\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-niuer",
"tone": "bad",
"head": "被潑皮訛詐",
"text": "在天漢州橋遇上潑皮牛二糾纏，只好花錢消災\n損失{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-baihu",
"tone": "bad",
"head": "誤入白虎堂",
"text": "被人引著誤入白虎節堂，當場拿下\n入獄3天",
"effect": {
"t": "prison",
"days": 3
}
},
{
"id": "qm-f-shaobing",
"tone": "good",
"head": "炊餅出爐",
"text": "炊餅剛出爐，又香又軟，吃得心滿意足\n得到{amount}點券",
"effect": {
"t": "points",
"amount": {
"min": 10,
"max": 100,
"step": 10
}
}
},
{
"id": "qm-f-donkey",
"tone": "bad",
"head": "被驚驢撞翻",
"text": "一頭受驚的毛驢拉著車衝過來，把你撞翻\n住院2天",
"effect": {
"t": "hospital",
"days": 2
}
},
{
"id": "qm-f-fortune",
"tone": "good",
"head": "相國寺算命",
"text": "相國寺前的卦攤說你面有貴氣，送你一道符\n抽一張卡片",
"effect": {
"t": "card",
"id": 0
}
},
{
"id": "qm-f-alms",
"tone": "bad",
"head": "大相國寺布施",
"text": "到大相國寺上香，捐了香油錢\n付{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-xiaobao",
"tone": "good",
"head": "搶先讀小報",
"text": "從小報上搶先得知朝廷消息\n抽一張卡片",
"effect": {
"t": "card",
"id": 0
}
},
{
"id": "qm-f-zanhua",
"tone": "good",
"head": "瓊林宴簪花",
"text": "瓊林宴上官家賜花，簪在帽上好不風光\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-shuoshu",
"tone": "good",
"head": "瓦舍聽說書",
"text": "在桑家瓦子聽說書人講三分，聽得如痴如醉\n得到{amount}點券",
"effect": {
"t": "points",
"amount": {
"min": 10,
"max": 100,
"step": 10
}
}
},
{
"id": "qm-f-changting",
"tone": "bad",
"head": "長亭送別",
"text": "在城外長亭送別故友，把一張卡片送他當盤纏\n失去一張卡片",
"effect": {
"t": "lose-card"
}
},
{
"id": "qm-f-drunkwalk",
"tone": "bad",
"head": "樊樓吃醉了酒",
"text": "在樊樓喝得太多，走錯方向\n掉頭往回走",
"effect": {
"t": "turn"
}
},
{
"id": "qm-f-cricketwin",
"tone": "good",
"head": "鬥蟋蟀贏了",
"text": "押中了常勝將軍，滿場喝采\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-cricketlose",
"tone": "bad",
"head": "鬥蟋蟀輸了",
"text": "押錯了蟋蟀，血本無歸\n輸掉{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-snowcoal",
"tone": "bad",
"head": "大雪買炭",
"text": "一夜大雪，炭價大漲，只好高價買炭取暖\n付{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-shuiwu",
"tone": "bad",
"head": "稅務抽稅",
"text": "貨物過城門稅務，被抽了一筆稅\n付{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-huayuan",
"tone": "good",
"head": "畫作入選畫院",
"text": "你的畫被翰林畫院看中，官家御筆題字\n一棟房屋免費加蓋一層",
"effect": {
"t": "upgrade"
}
},
{
"id": "qm-f-leak",
"tone": "bad",
"head": "秋風屋漏",
"text": "秋風怒號，屋頂的瓦被吹走大半\n修繕費每級{amount}文",
"effect": {
"t": "repair",
"perLevel": 300,
"cap": 4000
}
},
{
"id": "qm-f-poem",
"tone": "bad",
"head": "題反詩被告",
"text": "酒後在酒樓牆上題詩，被人告成反詩，只得花錢打點\n損失{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-curio",
"tone": "good",
"head": "海商送奇物",
"text": "海商送你一件海外奇物\n得到一個道具",
"effect": {
"t": "tool",
"id": 0
}
},
{
"id": "qm-f-demolish",
"tone": "bad",
"head": "廂官勒令拆屋",
"text": "廂官說你家房子侵街違建，勒令拆除一棟\n按造價退還現錢",
"effect": {
"t": "orig",
"n": 0
}
},
{
"id": "qm-f-requisition",
"tone": "bad",
"head": "徵地修艮嶽",
"text": "朝廷徵用你的一塊空地堆放花石，修建艮嶽\n按地價補償現錢",
"effect": {
"t": "orig",
"n": 1
}
},
{
"id": "qm-f-fakeloan",
"tone": "bad",
"head": "被人冒名借錢",
"text": "有人冒你的名向交子鋪借錢，債算到你頭上",
"effect": {
"t": "orig",
"n": 2
}
},
{
"id": "qm-f-jiaozirefuse",
"tone": "bad",
"head": "交子兌不出錢",
"text": "交子兌不出錢，交子鋪拒絕往來一個月\n一個月內不能進交子鋪",
"effect": {
"t": "orig",
"n": 3
}
},
{
"id": "qm-f-default",
"tone": "bad",
"head": "違約交割",
"text": "行舖違約交割，損失一成股份",
"effect": {
"t": "orig",
"n": 8
}
},
{
"id": "qm-f-dumpshares",
"tone": "bad",
"head": "急賣股份",
"text": "急需用錢，股份全部賣掉換現錢",
"effect": {
"t": "orig",
"n": 9
}
},
{
"id": "qm-f-stolenride",
"tone": "bad",
"head": "座駕被盜",
"text": "停在虹橋邊的座駕被人偷走了",
"effect": {
"t": "orig",
"n": 10
}
},
{
"id": "qm-f-bianriver",
"tone": "bad",
"head": "掉進汴河",
"text": "走路不看路，從虹橋上掉進汴河\n住院3天",
"effect": {
"t": "orig",
"n": 12
}
},
{
"id": "qm-f-pawn",
"tone": "bad",
"head": "家道中落",
"text": "家道中落，卡片和道具全部送進解庫換成點券",
"effect": {
"t": "orig",
"n": 32
}
},
{
"id": "qm-f-coining",
"tone": "bad",
"head": "私鑄銅錢",
"text": "私鑄銅錢被查獲\n入獄5天",
"effect": {
"t": "orig",
"n": 34
}
},
{
"id": "qm-f-bribe",
"tone": "good",
"head": "買通交子鋪掌櫃",
"text": "買通交子鋪掌櫃，挪用他人存款一成",
"effect": {
"t": "orig",
"n": 4
}
},
{
"id": "qm-f-birthday",
"tone": "good",
"head": "做壽收禮",
"text": "做壽擺宴，賓客各送你一張卡片",
"effect": {
"t": "orig",
"n": 5
}
},
{
"id": "qm-f-legacy",
"tone": "good",
"head": "遠房叔父留下遺產",
"text": "遠房叔父過世，留給你一筆遺產\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-guanpuwin",
"tone": "good",
"head": "關撲大勝",
"text": "街頭關撲連擲幾把都是渾純，大贏一場\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-changping",
"tone": "good",
"head": "常平倉賑濟",
"text": "常平倉開倉賑濟\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-goryeo",
"tone": "bad",
"head": "隨海船去了高麗",
"text": "在碼頭看熱鬧，被拉上海船一路去了高麗\n消失3天",
"effect": {
"t": "orig",
"n": 6
}
},
{
"id": "qm-f-painting",
"tone": "bad",
"head": "被吸進畫裡",
"text": "盯著一幅長卷看得入迷，整個人被吸進畫裡\n消失3天",
"effect": {
"t": "orig",
"n": 7
}
},
{
"id": "qm-f-club",
"tone": "bad",
"head": "合會被倒",
"text": "參加的合會被會頭捲款逃走\n損失{amount}文",
"effect": {
"t": "fine",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-taixue",
"tone": "good",
"head": "太學上舍及第",
"text": "太學上舍考試優等，親友登門道賀\n得到{amount}文",
"effect": {
"t": "gain",
"amount": {
"min": 2000,
"max": 10000,
"step": 500
}
}
},
{
"id": "qm-f-ci",
"tone": "good",
"head": "樊樓題詞得賞",
"text": "在樊樓題了一闋詞，被貴人看中賞賜\n得到{amount}點券",
"effect": {
"t": "points",
"amount": {
"min": 10,
"max": 100,
"step": 10
}
}
}
];
