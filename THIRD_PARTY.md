# 来源与署名

- **mytbk/rich4**：https://github.com/mytbk/rich4 ，作者 Iru Cai 及该仓库贡献者。以原样 Git 子模块保存，许可证见 `upstream/rich4/COPYING`（GPL v3）和各文件头。提取器调用其 `csrc/mkf/mkf_decompress.c`；地图字段、事件及股票机制研究引用其反汇编、C代码与格式文档。子模块内第三方文件保留原通知。
- **Pillow**：图像处理依赖，通过 pip 安装，未复制其源码。
- **Wine / WineskinCX**：本地试玩运行环境。实验 macOS 启动包沿用 WS11WineCX64Bit22.1.1-13；源代码参考 https://github.com/Gcenx/winecx 和 https://www.codeweavers.com/crossover/source 。打包脚本要求显式提供现有引擎目录，保留其第三方文件。
- **cnc-ddraw**：https://github.com/FunkyFr3sh/cnc-ddraw ，MIT。原游戏在 macOS 测试时使用 v7.1.0.0 的 GDI 窗口模式；Git 源码不含 DLL；实验启动包保留现有兼容 DLL。
- **大富翁4原游戏资源**：地形、图标、建筑、音视频等来自用户本地游戏文件，提取产物不存入 Git；本仓库不对这些资源作开源授权。

上游确切提交由 Git 子模块指针固定。更新必须显式执行并提交指针变化，不能把上游代码误记为本项目原创。
