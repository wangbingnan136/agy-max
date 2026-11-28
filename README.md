<div align="center">
  <img src="assets/logo.svg" width="72" height="72" alt="Antigravity Max Logo" />
  <h1>Antigravity Max (<code>agy-max</code>)</h1>
  <p><strong>Antigravity 2.0 满血原生全能工作台增强插件（已全面适配最新版 Antigravity 2.35.1+）</strong></p>
  <p>按需模块化（1 核心 + 8 模块，装你要的） / 默认内置 <code>agy-fast</code> 加速引擎（可随时关闭） / 原生辅助侧栏文件结构 / 类 Codex 全套工作流 / 侧栏拖动移动会话与 /btw 子对话树 / 多语言汉化 / 上下文与用量看板 / 可选：Prism 光学美化、多账号切换、免 TUN 代理、单窗口 SSH 远程项目</p>
  <!-- plugin-badges:start -->
  <p>
    <a href="https://github.com/wangbingnan136/agy-max/releases"><img src="https://img.shields.io/github/v/release/wangbingnan136/agy-max?label=Release&color=4f46e5" height="20" alt="Release" /></a>
    <a href="https://github.com/wangbingnan136/agy-max/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/wangbingnan136/agy-max/ci.yml?label=CI" height="20" alt="CI" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/wangbingnan136/agy-max?label=License&color=16a34a" height="20" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/Antigravity-2.35.1+-0f172a" height="20" alt="Antigravity 2.35.1+" />
    <img src="https://img.shields.io/badge/Node.js-%3E%3D22.13-339933" height="20" alt="Node.js >= 22.13" />
    <img src="https://img.shields.io/badge/Platform-macOS%20(Tested)%20%7C%20Win%20%2F%20Linux%20(Untested)-475569" height="20" alt="Platform" />
  </p>
  <!-- plugin-badges:end -->
  <p>
    <strong>简体中文</strong> |
    <a href="README_EN.md">English</a>
  </p>
  <p>
    <a href="#开源来源与致谢">开源来源与致谢</a> |
    <a href="#界面预览">界面预览</a> |
    <a href="#主要功能">主要功能</a> |
    <a href="#安装与卸载">安装与卸载</a> |
    <a href="#配置说明">配置说明</a> |
    <a href="#更新日志">更新日志</a>
  </p>
</div>

<p align="center">
  <img src="docs/images/hero-workspace.png" alt="Antigravity Max 使用界面" width="100%" />
</p>

> **设计定位与开源来源说明**：`Antigravity Max` 面向追求「开箱即满血」体验的重度开发者独立维护。本项目底层调试挂载与遥测底座衍生自 [WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools)（MIT），光学主题与工作台交互设计借鉴自 [RMvdesi/obsidian-prism](https://github.com/RMvdesi/obsidian-prism)，并默认内置集成了 [INK-Q/agy-fast](https://github.com/INK-Q/agy-fast)（MIT，可在设置页一键关闭）。完整归属见下方 [开源来源与致谢](#开源来源与致谢)。

---

## 开源来源与致谢

本项目站在社区优秀开源项目肩膀上独立演进，特此向原作者们致谢：

| 来源仓库 | 关系与借鉴内容 | 许可与说明 |
| --- | --- | --- |
| **[WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools)** | **核心底座衍生**：本机 CDP 零侵入调试挂载、本地 SQLite/JSONL 会话遥测与 53 周看板、多语言汉化底座、会话分支与原位编辑、系统凭据库多账号切换、免 TUN 独立代理及 WSL2 桥接 | MIT License（安装 `agy-max` 时自动停用旧版并无损继承原有设置与账号） |
| **[RMvdesi/obsidian-prism](https://github.com/RMvdesi/obsidian-prism)** | **交互与光学规格借鉴**：深浅光学配色体系、场景一键预设、水波试管上下文指示器、推理档位滑杆、长代码折叠、行内步骤 Diff、会话文件夹与桌宠理念 | 基于公开功能规格独立净室重实现（详见 [docs/PRISM_COMPATIBILITY.md](docs/PRISM_COMPATIBILITY.md)） |
| **[INK-Q/agy-fast](https://github.com/INK-Q/agy-fast)** | **默认内置加速套件**：内置打包 `batch_search`、`apply_edits`、`quick_outline`、`read_slices`、`run_checks` 与 `SessionStart` 启动快照，大幅减少 Agent 工具往返轮次与 Token 消耗 | MIT License（默认自动部署启用，可在 **Antigravity Max -> 设置 -> 会话增强** 随时一键关闭） |

在此基础上，`Antigravity Max` 进一步自研整合了**输入框下置 Git 与遥测状态栏、本地 + SSH 历史全文搜索（`⌘+⌥+F`）、运行中会话铃铛与侧栏「优先事项」、`/goal` 常驻目标栏与实时编辑抽屉、完整工具链 Markdown 复制、外部编辑器行列直达及 SSH 连接命令粘贴解析**等全套类 Codex 重度工程流特性。也感谢 [LINUX DO](https://linux.do) 社区在日常工具折腾与开源交流中提供的启发。

---

## 界面预览

<table>
  <tr>
    <th width="50%">输入框下置状态条与上下文监控</th>
    <th width="50%">右侧任务进度与当前额度</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-composer.png" alt="上下文窗口与生成速度" width="100%" />
      <p>在输入框下置状态条集中查看 Git 状态胶囊、上下文占用圆环（或水波试管）、缓存复用与实时生成速度。</p>
    </td>
    <td>
      <img src="docs/images/card-overview-panel.png" alt="右侧任务进度与当前额度" width="100%" />
      <p>在右侧概览查看当前运行阶段、每步耗时和各模型组剩余额度，点击标题可折叠收起。</p>
    </td>
  </tr>
  <tr>
    <th>用量概览（浅色）</th>
    <th>用量概览（深色）</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-dashboard-light.png" alt="用量概览浅色主题" width="100%" />
      <p>默认按本轮周限额周期统计请求次数、Token、缓存命中率、参考费用、53 周热力图和模型健康状态。</p>
    </td>
    <td>
      <img src="docs/images/card-dashboard-dark.png" alt="用量概览深色主题" width="100%" />
      <p>随客户端切换浅色和深色主题，对比各模型的 Token 与费用占比、缓存命中率和平均速度。</p>
    </td>
  </tr>
  <tr>
    <th>请求记录与缓存异常</th>
    <th>多账号切换与额度（可选模块）</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-requests.png" alt="请求记录与缓存异常" width="100%" />
      <p>按账号、模型、会话和状态筛选单次请求，标出短间隔内异常掉缓存的记录，排除冷启动与上下文压缩误报。</p>
    </td>
    <td>
      <img src="docs/images/card-accounts.png" alt="多账号切换与额度管理" width="100%" />
      <p>安装「多账号切换」模块后，通过系统凭据管理器本地保存和切换多个 Google 账号，集中查看 5 小时和周限额。</p>
    </td>
  </tr>
  <tr>
    <th>多语言与光学设置</th>
    <th>免 TUN 独立代理（可选模块）</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-settings.png" alt="多语言与显示设置" width="100%" />
      <p>支持简/繁/粤/英/日多语言切换，设置按分类筛选；安装「界面与光学」模块后可用场景预设、光学主题与用户消息气泡着色。</p>
    </td>
    <td>
      <img src="docs/images/card-proxy.png" alt="免 TUN 独立代理设置" width="100%" />
      <p>安装「免 TUN 独立代理」模块后，单独为 Antigravity 配置 HTTP 或 SOCKS5 代理，内置连通性测试与强制 HTTP/1.1。</p>
    </td>
  </tr>
</table>

---

## 主要功能

默认只装 4 个常用模块，开箱即用；另外 4 个可选模块在 **Antigravity Max -> 模块** 页随时一键安装或卸载。没装的模块不加载、不占内存，也不显示多余设置。

### 通用底座

- **按需模块化（1 个核心 + 8 个模块）**：所有模块共用一个轻量核心和一条调试连接。安装时优先从 GitHub Release 下载并做 SHA-256 校验，断网时自动改用安装包里自带的离线副本；卸载时可选保留配置（下次装回自动恢复）或彻底清除，彻底清除会一并删掉系统钥匙串里该模块保存的账号凭据和 SSH 密码。从 v1.4.x 升级会自动保留你正在用的可选模块。开发者把独立子包放到 `~/.gemini/config/plugins/agy-<模块名>` 即可优先以本地开发模式挂载。
- **全面适配最新版 Antigravity（`2.35.1+`）**：深度适配最新客户端的侧栏项目置顶、路由加载时序与右侧原生辅助侧栏（`sidePanelV2`）架构，消除新版客户端冷启动白屏与组件挂载异常；带 Windows + WSL2（NAT / Mirrored）兼容代码。
- **默认内置 `agy-fast` 极速引擎（可随时关闭）**：无需单独安装，装好 `Antigravity Max` 即自动部署并启用内置 `agy-fast`（提供并发批量搜索、符号大纲、多文件原子修改与启动快照）；不想使用时可在「设置 -> 会话增强 -> 内置 agy-fast 加速引擎」一键关闭，保留用户自定义 `*.local.md` 规则不丢失。
- **应用内一键更新**：「设置 -> 版本更新」里检查更新、阅读发布说明并一键自动更新，安装包经 SHA-256 校验，启动失败自动回滚旧版。

### 默认模块

- **统计与额度：上下文、速度与本地用量看板**：输入框下方实时显示上下文窗口占用（缓存复用、压缩次数、Orchestrator 分模型进度）与生成速度（只算生成阶段的 `tok/s`、首字延迟、模型/工具耗时和参考费用）；在右侧辅助侧栏 **插件 -> Antigravity Max** 打开完整看板，提供 53 周热力图、请求记录、短间隔掉缓存标红、报错复制与配额估算。
- **对话交互增强：分支、编辑、移动与子对话树**：从任意历史回答或会话菜单完整分支新会话（支持含子智能体会话）；在原位置编辑已发消息重发；把会话直接拖到侧栏其他项目或移出项目；`/btw` 侧边提问收在主对话下方，可折叠、可独立成主对话；整段或截至指定轮次复制完整会话 Markdown（含工具参数、结果与长文本补全，兼容 SSH）；`/goal` 目标常驻栏与实时编辑抽屉、`[Image #N]` 行内图片芯片、推理档位滑杆与按模型记忆、长代码块折叠、行内步骤 Git Diff、侧栏悬停大纲、Chat 文件夹（Beta）、务实编码模式与 `/code-review` 只读审查技能。
- **工作区与会话导航：类 Codex 旗舰工作流**：毫秒级本地与 SSH 历史会话全文搜索（`⌘+⌥+F` / `Ctrl+Alt+F` 直达匹配轮次并一键复制代码或命令）、顶部搜索会话按钮右侧运行中会话铃铛与带时间窗持久化的侧栏「优先事项」视图、已归档会话一键批量管理、项目置顶、输入框底栏无锁 Git 状态与只读 Unified Diff 胶囊（`+X / -Y`）。
- **工作区与会话导航：原生辅助侧栏「文件结构」与外部编辑器行列直达**：在客户端右侧原生辅助侧栏集成「**文件结构**」标签页（支持实时筛选、逐层目录树、代码 / 图片 / `.ipynb` 预览，文本文件可直接原地编辑并 `⌘S` 保存，未绑定工作区的对话也可直接选择文件夹或挂载最近项目）；右键消息文件链接或文件树可一键引用到输入框、在 `Cursor` / `VS Code` / `Windsurf` / `Zed` / `Kiro` 中打开并直达指定行列（都没装时自动用系统自带文本编辑器打开）、定位文件夹或复制路径（支持 Windows 局域网 NAS / SMB）。
- **多语言与市场汉化**：覆盖侧栏、常用菜单、权限弹窗、模型说明、设置页与 Swarm 面板的简/繁/粤/英/日五语界面，插件市场英文介绍自动翻译并本地缓存，不改动聊天正文与代码块。

### 可选模块（默认不安装）

- **界面与光学：Prism 光学美化**：四套深浅光学配色、场景一键预设（`Native` / `Ultra` / `Focus` / `Eco`）、强调色与圆角、代码字体、水波试管上下文指示器、流光墨迹与对话光环、平滑光标、像素桌宠与用户消息气泡着色（详见 [docs/PRISM_COMPATIBILITY.md](docs/PRISM_COMPATIBILITY.md)）。
- **多账号切换**：基于系统钥匙串 / 凭据管理器隔离多个 Google 账号，侧栏快捷切号，支持额度耗尽自动切号与防串号校验。
- **免 TUN 独立代理**：无需全局 TUN 即可单独为 Antigravity 注入 HTTP/SOCKS5 代理，内置连通性测试，并可选开启 `GODEBUG=http2client=0` 缓解空闲断连。
- **SSH 远端工程：单窗口 SSH 远程项目**：在「创建项目 -> 远程 -> `+ Add Resource`」添加 SSH 服务器，远程项目与本地项目在同一窗口平级共存，本机 AI 直接操作远端（读写改搜、远端终端、不断流后台长任务、远程文件树与 Git Diff、跨机文件互传）；粘贴 `ssh -p 2222 user@host` 自动解析填入（自动丢弃末尾密码防误交）；远端执行边界钩子防止 AI 误在本机执行命令。

---

## 安装与卸载

> 环境与平台说明：已全面适配最新版 Antigravity（`2.35.1+`），请先安装并启动过一次客户端。**因为作者日常主要在 macOS 上使用和开发，目前仅在 macOS 上完整跑通并实测；Windows、Linux 和 WSL2 的脚本与兼容代码都保留在仓库里，但暂时还没有做严格测试，正常情况下应该也能用（遇到问题欢迎反馈或提 PR）。** 优先使用本机 Node.js `>= 22.13`，没有时自动使用客户端自带的 `agy-node`，无需 `npm install` 或管理员权限。若已装有 `agy-powertools`，安装时会自动停用旧版并无损迁移设置与多账号配置；若本机已有用户自行安装的 `agy-fast`，也会智能兼容不破坏原有自定义规则。

### 方式一：一句话发给 Agent 自动安装（最推荐）

点右上角复制按钮，直接粘贴发给 Antigravity（或 Claude Code / Codex）即可全自动装好：

```text
请帮我安装 Antigravity Max（https://github.com/wangbingnan136/agy-max）：先阅读仓库内的 docs/INSTALL_AGENT.md，按统一安装脚本静默安装，保留现有聊天记录与配置，不要强关当前窗口，装完核对版本并提醒我重启即可。
```

详细执行规范见 [Agent 安装指南](docs/INSTALL_AGENT.md)。

### 老用户升级：一句话发给 Agent（v1.4.1 及更早版本）

v1.4.2 起安装包结构变了，旧版插件的应用内更新只会显示「打开下载页」，没有一键更新。把下面这句话复制给 Antigravity（或 Claude Code / Codex），它会帮你覆盖安装到最新版：

```text
请帮我把 Antigravity Max 升级到最新版（https://github.com/wangbingnan136/agy-max）：从 Releases 下载最新版 ZIP 并解压，先阅读仓库里的 docs/INSTALL_AGENT.md，然后用统一安装脚本直接覆盖安装。千万不要先卸载。保留现有聊天记录、设置、多账号和 SSH 项目，不要强关当前窗口。装完核对已安装版本和 Release 最新版本号一致，再提醒我完全退出并重启 Antigravity。
```

**直接覆盖安装，千万不要先卸载。** 先卸载会删掉个人设置，新版就认不出你是老用户，之前用过的 SSH、多账号等可选模块不会自动装回。升级这一次之后，后续版本都能在应用内一键更新。

### 方式二：命令行安装

从 [Releases](https://github.com/wangbingnan136/agy-max/releases) 下载最新 ZIP 解压（或克隆本仓库），在项目目录运行：

```sh
# macOS（主力实测） / Linux / WSL2（未做严格测试）
sh ./install.sh
```

```powershell
# Windows PowerShell（未做严格测试）
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

覆盖安装会保留已有设置，不会强制关闭客户端。完成当前任务后重启 Antigravity，打开右侧辅助侧栏，在 **插件** 里选择 **Antigravity Max** 即可使用。首次安装默认只装 4 个常用模块，界面与光学、多账号、代理和 SSH 远端工程到 **模块** 页按需安装。macOS 会自动在 `~/Applications/Antigravity (Max).app` 生成带原版图标的启动器，拖入 Dock 替代原图标即可。

### 更新与卸载

- **应用内更新**：打开 **Antigravity Max -> 设置 -> 版本更新**，点击 **检查更新** 或 **自动更新** 即可自动完成 SHA-256 校验与替换，启动失败会自动回滚旧版。
- **从 v1.4.1 及更早版本升级**：v1.4.2 起安装包结构变了，旧版的应用内更新会显示「打开下载页」。请用上面「老用户升级」那句话，或按方式二直接覆盖安装一次，**不要先卸载**（个人设置、账号和 SSH 项目都会保留，用过的可选模块会自动装回），之后恢复应用内更新。
- **安装或卸载模块**：打开 **Antigravity Max -> 模块**，点击对应模块的安装或卸载。卸载时默认保留配置，勾选「同时清除」会删除该模块的本地配置与系统钥匙串里的凭据，不可恢复。
- **卸载**：运行 `sh ./uninstall.sh`（macOS / Linux / WSL2）或 `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1`（Windows）。末尾加 `--keep-settings` 可保留个人配置。卸载时会自动清理本插件托管的组件，同时完整保留你之前独立安装的插件、聊天记录和账号。

---

## 配置说明

所有选项都在 **Antigravity Max -> 设置** 里实时生效并自动保存（支持分类筛选、场景预设、**内置 `agy-fast` 一键开关**、脱敏 JSON 导出导入以及底部恢复默认设置）。设置页只显示已安装模块的选项；想用的功能找不到时，先去 **模块** 页把对应模块装上。

<details>
<summary><strong>展开查看常用环境变量与数据目录</strong></summary>

| 名称 / 路径 | 说明 |
| --- | --- |
| `ANTIGRAVITY_USER_DATA_DIR` | 使用独立客户端配置目录时指定自定义用户数据目录 |
| `ANTIGRAVITY_CDP_PORT_FILE` | 显式指定 `DevToolsActivePort` 绝对路径（兼容 `AGY_BROWSER_ACTIVE_PORT_FILE`） |
| `~/.gemini/config/plugins/agy-max/` | 主插件程序、工作台与内置套件目录 |
| `~/.gemini/config/plugins/agy-fast/` | 内置 `agy-fast` 加速引擎挂载目录（关闭开关后自动停用卸载） |
| `~/.gemini/antigravity/plugin_data/agy-max/` | 个人设置、目标记录、账号元数据、配额采样和参考单价缓存目录 |
| `~/.gemini/antigravity/plugin_data/agy-max/modules/` | 已安装模块的程序文件；安装清单为同级的 `modules-manifest.json` |
| `~/.gemini/antigravity/plugin_data/agy-max/module_data/` | 卸载模块时保留的配置快照，重新安装时自动恢复 |
| `~/.gemini/config/plugins/agy-<模块名>/` | 本地开发模式：放入独立模块子包后优先于已安装版本挂载 |

</details>

---

## 更新日志

### v1.4.3
- **把侧栏会话拖进输入框即可引用**（感谢 @andrew05060414，PR #31）：像 Codex 一样，把左侧会话拖到输入框，松手就插入原生 `@` 会话引用；客户端不支持时退回为 `[标题](conversation://…)` 链接，不会覆盖已写的草稿。
- **开启「重塑输入框卡片」后语音按钮恢复正常**（感谢 @andrew05060414，PR #30）：语音模式按钮不再变形错位，浅色模式下听写按钮的录音高亮不再消失。
- **修复模型菜单变透明**：关掉「推理档位滑块」但保留「记忆推理档位」时，模型菜单不再透明、点不动。
- **一个模块出错不再拖垮整个界面**：每个模块的界面脚本单独检查、单独运行，出错只在控制台记下是哪个模块。
- **模块安装更稳**：替换模块时先备份旧版，Windows 上文件被占用会重试，失败自动还原；模块清单暂时读不出来时不再把卸载过的模块装回来；下载边下边检查 16 MB 上限；不兼容当前核心版本的模块会被拒绝并提示原因。
- **卸载模块时「同时清除」更彻底也更安全**：会一并删除该模块的数据文件（如 `chat-flow-tree.json`、`goals.json`）；钥匙串凭据删除失败时保留记录并提示，不再留下找不回的凭据。命令行完整卸载也会清除钥匙串里的账号凭据和 SSH 密码。
- **只改过圆角、帧率等外观设置的老用户**，升级后也会自动装回「界面与光学」模块。
- **SSH 中途断线不会重复执行命令**：只有确认远端命令还没开始时才自动重试一次；命令执行中断线会提示先确认远端状态。
- **SSH 远端执行边界更严**：不认识的本地工具只要带有项目外的路径就会被拦截；钩子收到损坏的输入时直接拦截；SSH 模块被卸载后，拦截提示会引导重新安装模块，而不是让你用已经不存在的工具。
- **统计更准**：非流式返回的回复不再把 tok/s 和峰值速度顶高。
- **汉化不再改写会话标题**：比如标题 “Details for x.md” 不会被显示成 “x.md 详情”。
- **侧栏和 /btw 更快**：注释文件按修改时间缓存，不再每次全部重读；拖动移动会话保存失败时，失败的移动不会在下次保存时被悄悄写进磁盘。

### v1.4.2
- **按需模块化（1 个核心 + 8 个模块）**：功能拆成 8 个可热插拔模块，默认装 4 个（统计与额度、对话交互增强、工作区与会话导航、多语言）；界面与光学、多账号切换、免 TUN 代理、SSH 远端工程改为在 **Antigravity Max -> 模块** 页按需安装。安装包经 SHA-256 校验，断网时自动改用内置离线包；卸载时可选保留或彻底清除该模块的配置与凭据（包括系统钥匙串里保存的账号和 SSH 密码）。从 v1.4.x 升级会自动保留你正在用的可选模块。
- **侧栏拖动移动会话与 /btw 子对话树**：把会话直接拖到其他项目或移出项目；/btw 侧边提问收在主对话下方，可折叠，也可独立成主对话。
- **推理档位弹层更干净**：修复打开模型菜单或拖动推理档位时原生模型列表闪一下的问题。
- **设置里的「全部」页换成「版本更新」**：在这里检查更新、一键自动更新，并直接阅读发布说明。
- **统计更准更稳**：速度改为只算生成阶段的 tok/s；会话数据库被占用或扫描出错时，用量不再清零或倒退；完整看板移到右侧栏插件页；修复粘贴行内图片时卡死。
- **SSH 更稳更安全**：远端登录脚本打印的内容不再混进读文件和命令结果；钩子出错、项目标记文件损坏或拿不到当前目录时，远端执行边界一律拦截；钩子不再执行当前目录里的同名脚本；新增真实 sshd 端到端测试。
- **macOS 钥匙串能完整保存大凭据**：超过约 2 KB 的账号凭据以前会被截断，现在能完整保存。
- **翻译与上游同步**：补齐 Antigravity 2.35.x 新增界面文字的翻译；内置 `agy-fast` 升级到 `v0.3.2`。
- **从 v1.4.1 及更早版本升级需要手动重装一次**：新版安装包结构变了，旧版的应用内更新会显示「打开下载页」。请用上面的安装命令或 Release 里的 ZIP 重装一次（个人设置、账号和 SSH 项目都会保留），之后的版本恢复应用内更新。升级后请完全退出 Antigravity（macOS 用 `⌘Q`）再重新打开。

### v1.4.1
- **SSH 连接更稳**：SSH 握手被中途断开（`kex_exchange_identification`、`Connection closed/reset by ... port N`）时自动重试一次。命令此时还没开始执行，重试不会让它跑两次；一直握手失败时会提示是网络或网关问题，不再误导为密钥错误；密码或密钥认证失败不会重试。
- **传文件兼容没有 sftp 的服务器**：服务器的 sshd 没开 sftp 子系统导致 `scp` 失败时，自动改用旧版 scp 协议（`scp -O`）重传。
- **一键免密为每台服务器单独生成密钥**：改为生成 `~/.ssh/agy-<主机>_ed25519` 并让该主机指向它，不再复用默认的 `id_ed25519`；配置了密钥文件的主机会带上 `IdentitiesOnly=yes`，避免 ssh-agent 里密钥太多、把服务器允许的认证次数用光。
- **修复图片右键菜单弹不出来**：`[Image #N]` 图片芯片会吞掉所有鼠标按键，右键时只出现悬停预览，菜单不出来。现在芯片只拦截左键，在芯片文字上右键也能正常弹出图片菜单（复制图片等）。
- **下线本地壁纸**：实机效果几乎看不见，让外壳变透明的样式还会把聊天区挤成中间一条，因此整块删除：「本地壁纸 (Beta)」设置卡片、壁纸图层与透明外壳样式、`wallpaperEnabled / Opacity / Blur / Dim` 四个设置项。旧设置文件里残留的壁纸设置读取时会自动忽略，不会报错。
- **升级提示**：本版改动了注入客户端的前端脚本，升级后请完全退出 Antigravity（macOS 用 `⌘Q`）再重新打开，只刷新页面不会生效。

### v1.4.0
- **单窗口「SSH 远程项目」（本机大脑 + 远程执行）**：在「创建项目 → 远程 → `+ Add Resource`」新增 `SSH 服务器` 入口，左侧栏以带连接状态圆点的云+终端图标与本地项目平级共存，彻底免去远端二次授权与独立窗口（与官方原生 OpenSSH 和平共处）。支持读取 `~/.ssh/config`、粘贴 `ssh -p ...` 自动解析、密码加密入系统钥匙串与一键配免密公钥、迷你远端目录树选目录、换绑主机保留完整聊天记录、删除绑定不碰远端文件；内置 `agy-ssh-projects` MCP 服务端（支持读写改搜、看远端图片与 `.ipynb`、不断流后台长任务与显式跨机互传）、远端执行边界与项目级 Skill/插件能力范围钩子，并全链路打通右侧远程文件树、远程 Git 状态与 Diff、跨机文件互传弹窗及内置交互式 `SSH 终端`。
- **行内图片引用芯片与高清灯箱**：在输入框和消息气泡中以 `[Image #N]` 行内芯片直观引用图片，悬停预览缩略图、点击打开高清灯箱，发送与编辑重发时自动按正文顺序对齐图片附件、清理已删除芯片并向模型注入跨回合图片映射。
- **长用户消息展开/折叠切换**：当发送的长消息被原生界面折叠截断时，气泡下方自动显示「展开 / 收起」切换按钮，一键查看完整内容而不影响 Agent 回复展示。
- **插件市场动态中文翻译**：在插件市场与插件详情页新增动态翻译开关，自动将插件目录与介绍翻译为中文并本地缓存，支持随界面语言即时切换。
- **Windows 11 深度兼容与安全加固**：修复 Windows 11 凭据管理器错误处理、SSH 路径反斜杠解析、回环 CDP WebSocket 免代理直连、IPv6 `NO_PROXY`、安装/卸载竞态重试与重启代理保留；CI 新增 Windows Node 24 矩阵、PowerShell 安装冒烟测试及仓库自动化安全检查（CodeQL / Scorecard / `security:check`）。
- **双语官方展示页与上游体验同步**：新增双语产品展示站与 GitHub Pages 部署，同步 `agy-powertools`、`agy-fast 0.3.1` 与 Prism 壁纸、光学主题、推理档位滑杆及侧栏菜单定位修复。

### v1.3.0
- **「文件结构」支持原地编辑代码与文本文件**：在右侧文件结构预览中点击铅笔即可直接编辑 `md` / `py` / `js` / `ts` 等 UTF-8 文本文件，`⌘S` / `Ctrl+S` 保存；保存前自动比对修改时间，若文件已被 Agent 或其他程序改动会先询问是否覆盖，并以临时文件原子替换、保留 CRLF 换行；超过 192 KB 或非 UTF-8 编码的文件保持只读。
- **外部编辑器新增 `Kiro` 与系统文本编辑器兜底**：「首选外部编辑器」新增 `Kiro` 与「系统文本编辑器」（macOS 默认文本编辑器、Windows 记事本、Linux 常见桌面编辑器或 `xdg-open`）；未安装任何 IDE 时自动回退到系统自带编辑器，文件夹交由系统文件管理器打开。
- **`/goal` 悬浮目标胶囊与暂停续跑**：重新设计悬浮目标胶囊与行内验收清单，用户中止或流异常结束时自动暂停目标，点击「继续」即自动派发续跑回合。
- **辅助侧栏与插件页修复**：新建会话即可使用辅助侧栏「文件结构」，并兼容 `plugin://` 侧车页面宿主。

### v1.2.0
- **全面适配最新版 Antigravity（`2.35.1+`）与启动稳定性升级**：完整适配新版客户端的侧栏项目置顶、路由过渡时序与 `Antigravity Helper.app` 包路径识别，彻底解决新版客户端下的冷启动白屏（React `#311` 与空路由匹配自动恢复）。
- **原生辅助侧栏集成「文件结构」标签页**：在右侧原生辅助侧栏（`Toggle Side Panel`）新增「文件结构」入口与独立标签页，支持筛选项目目录、预览代码 / 图片 / `.ipynb`，未关联工作区时可一键选择本地文件夹或挂载最近使用的项目。
- **优先事项时间窗持久化与已归档会话批量管理**：侧栏「优先事项」支持自定义时间范围筛选与本地磁盘持久化；新增类 Codex 已归档会话管理器，支持一键批量还原或彻底删除。
- **上下文压缩即时投影与全链路安全性能加固**：`/compact` 压缩后立即投影最新上下文占用与明细；超 12 个会话数据库时启用增量 SQLite 缓存加速看板；全面加固回环地址免代理直连、IPC 信封隔离、Git 符号链接边界与多账号防误切保护。

### v1.1.0
- **默认内置 `agy-fast` 加速引擎**：随安装包内置 [INK-Q/agy-fast](https://github.com/INK-Q/agy-fast)（`v0.3.1`），安装后默认自动部署启用，并在「设置 -> 会话增强」新增 **内置 agy-fast 加速引擎** 开关，支持随时一键停用或恢复（自动保留自定义 `*.local.md` 规则并兼容用户独立安装目录）。
- **完善开源来源与致谢公示**：在双语 README 顶部导览、独立致谢章节、第三方声明 [lib/vendor/NOTICE.txt](lib/vendor/NOTICE.txt) 与应用内「设置 -> 关于」页面清晰列出对 [WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools)、[RMvdesi/obsidian-prism](https://github.com/RMvdesi/obsidian-prism) 与 [INK-Q/agy-fast](https://github.com/INK-Q/agy-fast) 的借鉴与集成说明。

### v1.0.0
- **独立品牌首发 (`Antigravity Max` / `agy-max`)**：确立全能工作台产品路线，支持一键无感接管旧版 `agy-powertools` 并自动迁移本地设置、目标记录与系统凭据库多账号配置。
- **输入框下置状态条 + 类 Codex 工作流 + Prism 光学工作台**：整合下置 Git 状态胶囊与上下文/速度遥测、全文会话搜索（`⌘+⌥+F`）、运行中会话铃铛与侧栏「优先事项」、`/goal` 常驻目标栏、深浅光学主题、水波试管、推理档位滑杆、SSH 命令粘贴、多账号切换与免 TUN 独立代理。

---

## 协议与链接

- **开源协议**：[MIT License](LICENSE)（第三方组件声明见 [lib/vendor/NOTICE.txt](lib/vendor/NOTICE.txt)）
- **社区交流**：[LINUX DO](https://linux.do)
- **问题反馈**：[GitHub Issues](https://github.com/wangbingnan136/agy-max/issues)（提交时请附上操作系统、Antigravity 版本和插件版本）
