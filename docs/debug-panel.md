# Debug 面板（隱藏作弊板）

> 加入日期：2026-11-17。給主人自己玩用的隱藏面板，不影響一般玩家。

## 觸發方式

**快點 GO 按鈕 5 下（2 秒內）** → 右下角浮出半透明小面板。再點面板右上角的 **✕** 收起來。

- 連點 5 下才觸發，所以正常玩（按 GO 擲骰子）不會誤開。
- 觸發監聽在 GO 按鈕整個外框（`go.el`），不只按鈕本體。

## 功能

面板對「每個未破產的人類玩家」各有一組：

| 分組 | 按鈕 | 作用 |
|---|---|---|
| 金錢 | +10萬 / +100萬 / -10萬 | 直接改 `p.cash` |
| 分數 | +500分 / +5000分 | 改 `p.points`（買卡/買道具用，0xffff 取低 16 位） |
| 道具 | 13 種各一鍵 | 點一下該道具 +1（上限 9 個），顯示目前持有數 |
| 卡片 | ＋卡 / 清卡 | ＋卡：輸入卡片 ID 拿一張（清單會列出 ID 與卡名）；清卡：清空手牌 |
| 遙控骰 | 遙控骰 | 輸入 1-6，決定本回骰子 |
| 速度 | 速度:慢/中/快/極快 | 循環切換板面速度 |
| 清狀態 | 清狀態 | 一次清掉所有人類的 監獄/醫院/冬眠/烏龜/停留/夢遊 |
| 直接贏 | 直接贏 | 其他玩家全部破產、所有人類現金設成 999,999,999 |

## 實作細節

- **檔案**：`game/src/ui/debug-panel.ts` + `game/src/ui/debug-panel.css`
- **掛接**：`game/src/ui/main.ts`，在 `const go = new GoButton(...)` 之後：

  ```ts
  const dbg = new DebugPanel(game, view, () => hud.refresh());
  dbg.attachTap(go.el);
  ```

  第三參 `refresh` 綁 `hud.refresh()`，讓每次改動後 HUD 的錢/分數數字即時刷新。

- **遙控骰走原版路徑**：`g.tools.remoteDice = v; g.tools.pending = 'depart'`，跟「遙控骰子」道具（tool 8）同一條核心邏輯，不是亂改 `p.dice`，所以骰子動畫與後續回合流都正確。
- **速度走 `view.tickMs`**：對應 `main.ts` 的 `speeds` 表（慢 60 / 中 40 / 快 20 / 極快 10 ms），同時寫回 `localStorage.rich4.speed` 讓下次進遊戲保留。
- **卡片 ID 範圍**：`CARDS`(1-30) + `TYCOON_CARDS`(31-36) + `KB_CARDS`(37-38)，`ALL_CARDS` 合起來供輸入。
- **分數取低 16 位**：`p.points = (p.points + N) & 0xffff`，跟原版一致（分數是 16 位無號）。

## 驗證（2026-11-17）

- `npx tsc --noEmit` → 0 error
- `npm run build` → 成功
- `npm run test` → 279 過；7 個 fail 全是 `ENOENT: editor/site/assets/map-*.json`（原本就缺的 map 資源，需 `npm run assets`），與本批改動無關

## 後續可加的作弊（待做）

- 買下路上所有地 / 所有建築升滿
- 讓 AI 一直抽到壞卡（或好卡）
- 直接傳送到指定格
- 股票全部漲停/跌停
- 控制台入口：把 `dbg` 也放進 `window.__rich4`，方便 console 直接 `__rich4.dbg.toggle()`
