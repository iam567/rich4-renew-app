# 36 错误记录（log，iPhone）

用户 2026-11-25：「最好加一个错误 log 记录功能，万一有闪退，你一连上数据线就能读取出来是什么原因，log 保存 24 小时就行」「我主要是 iOS」。安卓版、桌面版不写记录文件，游戏不受影响。

- 只存在手机里，不上传；游戏里没有任何开关、界面。存在 App 自己的 `Library/rich4-log/`，每小时一个文件，超过 24 小时的自动删（`ui/log.ts` oldLogs、`NativeLog.start`）。服务器地址不写进去（`redact`）。
- `w-*.log`（网页，`ui/log.ts`，`ui/log-start.ts` 在游戏代码之前启动）：START（这次启动，上一次是正常离开、后台结束还是在前台被切断）、ERR / ERROR / WARN（报错、控制台）、STEP（游戏走的每一步）、BEAT（30 秒一次：地图、第几天、轮到谁、在等什么、占多少内存）、HIDE / SHOW / BYE（到后台、回来、离开；到后台时记最后 2 秒点了几下、点在哪）、STALL（画面卡住超过 3 秒）。
- `n-*.log`（App 外壳，`AppDelegate.swift` NativeLog）：LAUNCH、BACK / FRONT / INACTIVE / QUIT、MEMORY-WARNING、HEAT、CRASH（未捕获异常；系统 MetricKit 在下次启动时给的崩溃堆栈）、HANG。
- 网页进程被系统关掉：有 START 但前面没有 LAUNCH、也没有 BYE。
- **读取**：手机接数据线、解锁，在 `game` 里 `npm run log`（`--tail 80` 再看最后 80 条）。脚本还读系统自己的崩溃报告（App、WebContent、JetsamEvent 里跟游戏有关的）。全部存到 `.cache/phone-log/`（不进仓库）。只对从这台电脑装的 App 有效。
