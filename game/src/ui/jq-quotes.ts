/**
 * 毛主席語錄 before the characters' reaction lines on 激情歲月 (docs/rules/24 §7): 39 quotations, each checked word for
 * word against its source (§15), picked by the occasion; a speaker never says the same one twice in a row. The pick
 * uses the screen's own Math.random — never the game's rand() — so saves, replays and 派對模式's rules are untouched
 * (each phone may show another quotation). Shown in the speaker's cloud as a small red strip above the line
 * (ui/effects.ts cloud), the whole quotation in the log.
 */

/** The quotations (§7.2, the text as the game shows it; `…` where only a continuous part of the sentence is shown). */
export const QUOTES: string[] = [
  /* 1 */ '我們的同志在困難的時候，要看到成績，要看到光明，要提高我們的勇氣。',
  /* 2 */ '因為我們是為人民服務的，所以，我們如果有缺點，就不怕別人批評指出。',
  /* 3 */ '下定決心，不怕犧牲，排除萬難，去爭取勝利。',
  /* 4 */ '革命不是請客吃飯……',
  /* 5 */ '沒有調查，沒有發言權。',
  /* 6 */ '一切反動派都是紙老虎。',
  /* 7 */ '房子是應該經常打掃的，不打掃就會積滿了灰塵；臉是應該經常洗的，不洗也就會灰塵滿面。',
  /* 8 */ '人民，只有人民，才是創造世界歷史的動力。',
  /* 9 */ '全心全意地為人民服務，一刻也不脫離群眾……',
  /* 10 */ '一個人能力有大小，但只要有這點精神，就是一個高尚的人……',
  /* 11 */ '槍桿子裡面出政權。',
  /* 12 */ '讀書是學習，使用也是學習，而且是更重要的學習。',
  /* 13 */ '學習的敵人是自己的滿足，要認真學習一點東西，必須從不自滿開始。',
  /* 14 */ '共產黨員應是實事求是的模範……',
  /* 15 */ '我們共產黨人好比種子，人民好比土地。',
  /* 16 */ '不打無準備之仗，不打無把握之仗……',
  /* 17 */ '群眾是真正的英雄，而我們自己則往往是幼稚可笑的……',
  /* 18 */ '我們的責任，是向人民負責。',
  /* 19 */ '放在自己力量的基點上，叫做自力更生。',
  /* 20 */ '務必使同志們繼續地保持謙虛、謹慎、不驕、不躁的作風……',
  /* 21 */ '從群眾中來，到群眾中去。',
  /* 22 */ '要提倡勤儉建國。',
  /* 23 */ '我們應當相信群眾，我們應當相信黨，這是兩條根本的原理。',
  /* 24 */ '敵進我退，敵駐我擾，敵疲我打，敵退我追。',
  /* 25 */ '虛心使人進步，驕傲使人落後，我們應當永遠記住這個真理。',
  /* 26 */ '世界是你們的，也是我們的，但是歸根結底是你們的。',
  /* 27 */ '世上無難事，只要肯登攀。',
  /* 28 */ '可上九天攬月，可下五洋捉鱉……',
  /* 29 */ '一萬年太久，只爭朝夕。',
  /* 30 */ '不到長城非好漢。',
  /* 31 */ '發展體育運動，增強人民體質。',
  /* 32 */ '知識青年到農村去，接受貧下中農的再教育，很有必要。',
  /* 33 */ '赤腳醫生就是好。',
  /* 34 */ '備戰、備荒、為人民。',
  /* 35 */ '深挖洞，廣積糧，不稱霸。',
  /* 36 */ '抓革命，促生產。',
  /* 37 */ '農業學大寨。',
  /* 38 */ '工業學大慶。',
  /* 39 */ '好好學習，天天向上。',
];

/** The occasions (§7.2 「用在」) and their quotations (1-based numbers of QUOTES). */
const BY: Record<string, number[]> = {
  pay: [1, 18, 22, 4, 19],
  receive: [8, 6, 20, 38],
  lucky: [20, 25, 13, 27],
  bad: [1, 3, 27, 29],
  spared: [9, 23],
  build: [15, 36, 37],
  attacked: [5, 24, 2],
  prison: [7, 29, 13],
  hospital: [10, 3, 31, 33],
  sleep: [29, 12],
  win: [20, 25],
  lose: [17, 26, 19],
  tool: [11, 16, 28, 24],
  card: [6, 16, 21, 14],
  study: [12, 13, 39, 7],
};

/** The occasion of an event line (EVENT_LINES' 27 slots, docs/rules/11 §1.3). */
export function eventOccasion(slot: number): string {
  if (slot <= 2) return 'lucky';
  if (slot <= 5) return 'bad';
  if (slot <= 8) return 'receive';
  if (slot <= 11) return 'pay';
  if (slot <= 14) return 'spared';
  if (slot <= 17) return 'build';
  if (slot === 18) return 'attacked';
  if (slot === 19) return 'prison';
  if (slot === 20) return 'hospital';
  if (slot <= 22) return 'sleep';
  if (slot === 23) return 'lucky';
  if (slot === 24) return 'win';
  return 'lose';
}

const lastBy = new Map<number, number>();
/** A quotation for `speaker` (a character) on `occasion`, never the one they said last. */
export function pickQuote(speaker: number, occasion: string): string {
  const list = BY[occasion] ?? BY.bad;
  const last = lastBy.get(speaker);
  const pool = list.length > 1 ? list.filter(n => n !== last) : list;
  const n = pool[Math.floor(Math.random() * pool.length)];
  lastBy.set(speaker, n);
  return QUOTES[n - 1];
}

/** The strip's words: 「毛主席教導我們：」 and a continuous part of the quotation that fits `max` characters (cut with …… ). */
export function quoteStrip(q: string, max: number): string {
  const body = q.length <= max ? q : `${q.slice(0, Math.max(4, max - 2)).replace(/[，、；：]$/, '')}……`;
  return body;
}
