/**
 * The twelve characters' templates (docs/rules/07 §1; rich4_characters.c).
 * loanRatio (+24), cashRatio (+25), stockRatio (+26) and personality (+23) drive the computer players.
 */
export interface Character {
  id: number;
  name: string;
  female: boolean;
  /** 0 乖宝宝, 1 普通人, 2 大老奸 */
  personality: 0 | 1 | 2;
  loanRatio: number;
  cashRatio: number;
  stockRatio: number;
  /** Ownership colour 0xRRGGBB. */
  color: number;
}

export const CHARACTERS: readonly Character[] = [
  { id: 0, name: '約翰喬', female: false, personality: 2, loanRatio: 60, cashRatio: 50, stockRatio: 30, color: 0x946126 },
  { id: 1, name: '沙隆巴斯', female: false, personality: 1, loanRatio: 100, cashRatio: 40, stockRatio: 45, color: 0xbdc3c6 },
  { id: 2, name: '忍太郎', female: false, personality: 2, loanRatio: 0, cashRatio: 70, stockRatio: 0, color: 0x41323b },
  { id: 3, name: '錢夫人', female: true, personality: 2, loanRatio: 100, cashRatio: 60, stockRatio: 30, color: 0xc626c3 },
  { id: 4, name: '阿土伯', female: false, personality: 1, loanRatio: 50, cashRatio: 40, stockRatio: 25, color: 0xc5b830 },
  { id: 5, name: '莎拉公主', female: true, personality: 1, loanRatio: 75, cashRatio: 70, stockRatio: 30, color: 0xed9d9d },
  { id: 6, name: '宮本寶藏', female: false, personality: 1, loanRatio: 100, cashRatio: 50, stockRatio: 20, color: 0x00f038 },
  { id: 7, name: '糖糖', female: true, personality: 0, loanRatio: 0, cashRatio: 40, stockRatio: 35, color: 0xffffa0 },
  { id: 8, name: '烏咪', female: true, personality: 0, loanRatio: 0, cashRatio: 60, stockRatio: 20, color: 0xe77c08 },
  { id: 9, name: '孫小美', female: true, personality: 0, loanRatio: 50, cashRatio: 50, stockRatio: 0, color: 0xcc1a20 },
  { id: 10, name: '小丹尼', female: false, personality: 1, loanRatio: 30, cashRatio: 55, stockRatio: 15, color: 0x2017fe },
  { id: 11, name: '金貝貝', female: true, personality: 2, loanRatio: 80, cashRatio: 80, stockRatio: 0, color: 0x0ebdbd },
];
