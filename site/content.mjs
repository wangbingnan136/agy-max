export const REPO_SLUG = 'wangbingnan136/agy-max';
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const INSTALL_GUIDE_URL = `${REPO_URL}/blob/main/docs/INSTALL_AGENT.md`;
export const PRISM_DOC_URL = `${REPO_URL}/blob/main/docs/PRISM_COMPATIBILITY.md`;
export const NOTICE_URL = `${REPO_URL}/blob/main/lib/vendor/NOTICE.txt`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

export const SCREENSHOT_ASSETS = [
  { id: 'hero', file: 'hero-workspace.png' },
  { id: 'composer', file: 'card-composer.png' },
  { id: 'overview', file: 'card-overview-panel.png' },
  { id: 'dash-light', file: 'card-dashboard-light.png' },
  { id: 'dash-dark', file: 'card-dashboard-dark.png' },
  { id: 'requests', file: 'card-requests.png' },
  { id: 'accounts', file: 'card-accounts.png' },
  { id: 'settings', file: 'card-settings.png' },
  { id: 'proxy', file: 'card-proxy.png' }
];

export const SITE_CONTENT = {
  zh: {
    lang: 'zh-CN',
    title: 'Antigravity Max — Antigravity 2.0 满血原生全能工作台',
    description:
      'Antigravity 2.0 满血原生全能工作台增强插件：1 个核心 + 8 个按需模块，默认内置 agy-fast 加速引擎、原生辅助侧栏文件结构与原地编辑、类 Codex 工作流、侧栏拖动移动会话、本地 53 周用量看板；Prism 光学主题、多账号切换、免 TUN 代理与单窗口 SSH 远程项目按需安装。',
    brand: 'Antigravity Max',
    altLangLabel: 'EN',
    altLangHref: '../',
    nav: [
      { label: '实拍预览', href: '#screenshots' },
      { label: '核心能力', href: '#capabilities' },
      { label: '按需模块', href: '#modules' },
      { label: '快速安装', href: '#install' },
      { label: '更新日志', href: '#changelog' }
    ],
    themeToggleLabel: '切换浅色或深色主题',
    installNavCta: '安装',
    hero: {
      badge: '已全面适配 Antigravity 2.35.1+',
      badgeNote: '零侵入本地插件',
      titleLine1: 'Antigravity 2.0 满血原生工作台',
      titleLine2: '装上即全能',
      lead: '1 个核心 + 8 个模块，装你要的功能：默认内置 agy-fast 加速引擎、右侧原生文件结构与原地编辑、类 Codex 旗舰工作流、侧栏拖动移动会话与本地用量看板；Prism 光学、多账号、免 TUN 代理与 SSH 远程项目随时按需安装。',
      primaryCta: '复制一句话，让 Agent 自动装好',
      primaryCtaCopied: '已复制安装指令，直接发给 Agent',
      secondaryLink: '查看命令行与 ZIP 安装',
      metaLicense: 'MIT 开源',
      metaPlatform: 'macOS 主力实测 | 含 Win / Linux / WSL2 兼容脚本',
      tabs: [
        { id: 'workbench', label: '工作台与文件树' },
        { id: 'telemetry', label: '用量看板与缓存' },
        { id: 'optics', label: 'Prism 光学试色' }
      ]
    },
    demo: {
      windowTitle: 'Antigravity Max — agy-max',
      searchHint: '⌘⌥F 搜索会话',
      bellLabel: '运行中 2',
      sidebarPriorityTitle: '优先事项',
      sidebarPriorityItems: [
        { title: '修复冷启动路由与侧栏挂载', meta: '运行中', active: true, badge: 'live' },
        { title: 'prod-gpu-01 训练日志排查', meta: 'SSH', active: false, badge: 'ssh' }
      ],
      sidebarFoldersTitle: '工作区与文件夹',
      sidebarFolders: [
        { name: 'agy-max', count: '6', active: true },
        { name: 'gpu-cluster-scripts', count: 'SSH', active: false },
        { name: '归档会话管理', count: '14', active: false }
      ],
      goalLabel: '/goal 目标进行中',
      goalText: '在右侧原生侧栏支持 UTF-8 文件原地编辑与保存冲突校验',
      goalStepsDone: '3 / 4',
      chatUserPrompt: '在文件结构预览里加一个原地编辑模式，保存前先比对修改时间防覆盖。',
      chatThought: '已定位 aux-file-tree.js 并检查 mtime 冲突保护路径',
      chatReply: '已为右侧「文件结构」预览接入原地编辑与原子落盘：按 ⌘S 会先核对磁盘修改时间，若已被其他程序改动会先弹窗确认。',
      diffFiles: '2 个文件已变更',
      composerPlaceholder: '继续对话，或输入 /goal、/code-review、/compact...',
      gitBranch: 'main',
      contextModeLabel: '切换圆环 / 水波试管',
      contextRingName: '圆环',
      contextVialName: '水波试管',
      contextUsed: '68%',
      contextDetail: '缓存复用 97.4%',
      speedValue: '148 tok/s',
      sidePanelTabs: ['概览', '文件结构'],
      fileTreeTitle: '文件结构',
      editBtn: '原地编辑',
      saveBtn: '保存 ⌘S',
      savedToast: '已比对修改时间并原子保存',
      editorHint: 'UTF-8 文本可直接改写，>192 KB 自动只读',
      telemetryStats: [
        { label: '本周请求', value: '312', sub: '含 SSH 远端会话' },
        { label: '缓存命中率', value: '97.4%', sub: '排除冷启动与压缩误报' },
        { label: '平均速度', value: '148 tok/s', sub: '首字延迟 1.8s' },
        { label: '短间隔掉缓存', value: '2 次', sub: '已自动标红可定位' }
      ],
      heatmapTitle: '53 周本地会话热力图',
      heatmapSub: '纯本地 SQLite 只读解析，不上传任何对话内容',
      anomalyTitle: '缓存异常追踪',
      anomalyRow: '14:22:08  |  agy-max  |  间隔 42s 缓存跌至 11%  |  疑似系统提示词变动',
      opticsTitle: '点击实时预览 Antigravity Max 内置的四套 Prism 光学配色',
      opticsSub: '以下为插件内置的真实配色方案。在「模块」页装上「界面与光学」后，到「设置 -> 界面与光学」一键生效，并可与水波试管自由组合。',
      palettes: [
        { id: 'crystal', name: 'Crystal 晶透', desc: '清爽蓝灰纸面，白天编码久看不累', mode: '浅色' },
        { id: 'obsidian', name: 'Obsidian 黑曜', desc: '深邃低眩光暗底，高亮钴蓝焦点', mode: '深色' },
        { id: 'alabaster', name: 'Alabaster 石膏', desc: '温润纸白质感，柔和赤陶强调色', mode: '浅色' },
        { id: 'warm', name: 'Warm 暖炭', desc: '低蓝光暖灰深底，夜间柔和护眼', mode: '深色' }
      ],
      gaugeToggleTitle: '上下文指示器形态',
      presetTitle: '场景预设',
      presets: ['Native 原生', 'Ultra 全开', 'Focus 专注', 'Eco 轻量']
    },
    screenshots: {
      heading: '真实客户端界面一览',
      subheading: '以下 9 张全部为 Antigravity 2.35.1+ 真实截图，点击图片可全屏放大查看细节。',
      zoomHint: '点击大图放大查看',
      closeLabel: '关闭预览',
      items: [
        {
          id: 'hero',
          tab: '完整工作台',
          title: '全能原生工作台总览',
          caption: '在不破坏 Antigravity 原生简洁结构的前提下，整合下置状态条、右侧原生辅助侧栏与多语言汉化。'
        },
        {
          id: 'composer',
          tab: '下置状态条',
          title: '输入框下置 Git 与遥测状态条',
          caption: '输入框下方集中呈现 Git 变更胶囊、上下文圆环或水波试管、缓存复用率与实时生成速度。'
        },
        {
          id: 'overview',
          tab: '右侧任务进度',
          title: '右侧概览任务阶段与当前额度',
          caption: '实时查看每步工具耗时、运行阶段和各模型组剩余配额，标题栏一键折叠不占空间。'
        },
        {
          id: 'dash-light',
          tab: '用量看板 (浅色)',
          title: '本地用量概览与 53 周热力图（浅色）',
          caption: '按周限额周期汇总请求数、Token、缓存命中率、参考费用、53 周活跃热力图与模型健康度。'
        },
        {
          id: 'dash-dark',
          tab: '用量看板 (深色)',
          title: '本地用量概览与模型对比（深色）',
          caption: '自动跟随客户端深浅主题，对比不同模型的 Token 占比、费用构成与平均吞吐速度。'
        },
        {
          id: 'requests',
          tab: '请求与掉缓存',
          title: '单次请求日志与异常掉缓存标红',
          caption: '按账号、模型、会话和状态筛选，自动标出短间隔异常掉缓存记录，排除冷启动与压缩误报。'
        },
        {
          id: 'accounts',
          tab: '多账号额度',
          title: '系统凭据库多账号切换与额度管理',
          caption: '可选模块「多账号切换」：通过系统原生钥匙串/凭据管理器隔离多个 Google 账号，集中查看 5 小时和周限额。'
        },
        {
          id: 'settings',
          tab: '多语言与光学',
          title: '五语界面与 Prism 光学设置面板',
          caption: '支持简/繁/粤/英/日切换、按分类筛选设置、内置 agy-fast 开关与脱敏配置备份还原；装上「界面与光学」模块后可用场景预设与光学配色。'
        },
        {
          id: 'proxy',
          tab: '免 TUN 代理',
          title: '免 TUN 应用级独立代理',
          caption: '可选模块「免 TUN 独立代理」：无需全局 TUN，单独为 Antigravity 注入 HTTP / SOCKS5 代理，内置连通性测试与强制 HTTP/1.1。'
        }
      ]
    },
    capabilities: {
      heading: '为重度工程流重做每一处高频细节',
      subheading: '从减少 Agent 工具往返，到原生文件树原地编辑与跨机 SSH 协作，每一项都能直接在日常开发中省下实打实的时间。',
      cards: [
        {
          id: 'fast',
          title: '默认内置 agy-fast 极速引擎',
          desc: '装好即自动部署并发批量搜索、大纲提取、多文件原子修改与启动快照，大幅压缩工具往返轮次；不需要时可在设置页一键关闭，保留自定义规则。'
        },
        {
          id: 'filetree',
          title: '原生辅助侧栏「文件结构」与原地编辑',
          desc: '直接融入客户端右侧原生侧栏，支持实时过滤、代码 / 图片 / Notebook 预览与 ⌘S 原地编辑保存；右键可直达 Cursor / VS Code / Windsurf / Zed / Kiro 指定行列。'
        },
        {
          id: 'codex',
          title: '全套类 Codex 旗舰工作流',
          desc: '毫秒级本地 + SSH 历史会话全文搜索（⌘+⌥+F）、运行中会话铃铛与侧栏「优先事项」、把会话拖到其他项目、/btw 子对话树、/goal 悬浮目标胶囊与断点续跑、已归档会话批量管理与完整 Markdown 导出。'
        },
        {
          id: 'prism',
          title: 'Prism 光学主题与水波试管（可选模块）',
          desc: '装上「界面与光学」即可使用 Crystal / Obsidian / Alabaster / Warm 四套光学配色、场景预设与水波试管上下文指示器；推理档位滑杆记忆、长代码折叠与行内 Diff 默认就有。'
        },
        {
          id: 'telemetry',
          title: '53 周本地用量看板与掉缓存诊断',
          desc: '纯本地只读解析 SQLite 与 JSONL 会话，追踪缓存复用率、首字延迟、纯生成阶段 tok/s 和参考费用，精准标红短间隔内异常掉缓存的请求；数据库被占用时用量不清零、不倒退。'
        },
        {
          id: 'ssh-proxy',
          title: 'SSH 远程项目、多账号与免 TUN 代理（可选模块）',
          desc: '单窗口挂载远程服务器目录，本机 AI 直接读写和执行；粘贴 ssh -p 2222 user@host 自动解析并丢弃末尾密码防误交；系统凭据库多账号切换与免 TUN 代理同样按需安装。'
        }
      ],
      visuals: {
        fastBefore: '常规串行工具调用',
        fastAfter: '内置 agy-fast 并发批处理',
        fastSwitch: '设置页可随时一键开关',
        fileTreeSave: 'mtime 冲突保护',
        codexSearch: '找到 18 条匹配轮次  |  12ms',
        codexBell: '2 个任务运行中',
        codexGoal: '/goal 悬浮胶囊支持暂停续跑',
        telemetryRate: '缓存复用率',
        telemetryAlert: '短间隔掉缓存已标红',
        sshInput: 'ssh -p 2222 root@gpu-01 MyPass',
        sshParsed: '自动提取 root@gpu-01:2222',
        sshDropped: '已丢弃末尾密码',
        proxyTag: 'HTTP / SOCKS5 免 TUN',
        keyringTag: '系统钥匙串隔离'
      }
    },
    modules: {
      heading: '按需模块：装你要的功能',
      subheading: '1 个轻量核心 + 8 个可热插拔模块。默认只装 4 个常用模块，其余在「Antigravity Max -> 模块」页一键安装或卸载；没装的模块不加载、不占内存，也不显示多余设置。',
      defaultTitle: '默认安装',
      defaultBadge: '默认',
      optionalTitle: '按需安装',
      optionalBadge: '可选',
      points: ['GitHub Release 下载并做 SHA-256 校验', '断网自动改用内置离线副本', '卸载可保留配置或连同钥匙串凭据彻底清除', '从 v1.4.x 升级自动保留在用模块', 'agy-<模块名> 本地开发目录优先挂载']
    },
    credits: {
      heading: '开源透明，站在社区巨人的肩膀上',
      subheading: '零侵入挂载、MIT 开源、所有统计均在本地完成；清晰致谢每一份上游灵感与集成套件。',
      pillars: [
        {
          title: '为什么做成原生插件，而不是重造套壳？',
          body: '紧跟 Antigravity 2.35.1+ 官方原生能力和更新节奏，不用在「官方新特性」和「顺手的工作流」之间二选一。安装过程不改写客户端安装包，随时可一键还原或保留设置卸载。'
        },
        {
          title: '本地优先，敏感能力按需安装',
          body: '会话遥测、全文检索与文件编辑全部在本机完成，不向任何第三方服务器上传聊天内容。多账号切换、免 TUN 代理与 SSH 远程项目是可选模块，不装就不加载；凭据由操作系统原生钥匙串托管，卸载时可连同钥匙串里的凭据一起清除。'
        }
      ],
      tableTitle: '开源来源与致谢',
      upstreams: [
        {
          name: 'WhiteBr1ck/agy-powertools',
          url: 'https://github.com/WhiteBr1ck/agy-powertools',
          role: '核心底座衍生（MIT）',
          desc: '本机 CDP 挂载、SQLite/JSONL 遥测与 53 周看板、多语言底座、会话分支、系统凭据库多账号与免 TUN 代理。安装 agy-max 可无损自动迁移旧版设置。'
        },
        {
          name: 'RMvdesi/obsidian-prism',
          url: 'https://github.com/RMvdesi/obsidian-prism',
          role: '光学与交互规格借鉴（净室重实现）',
          desc: '四套深浅光学配色理念、场景预设、水波试管上下文指示器、推理档位滑杆、长代码折叠、行内 Diff 与工作台交互灵感。'
        },
        {
          name: 'INK-Q/agy-fast',
          url: 'https://github.com/INK-Q/agy-fast',
          role: '默认内置加速套件（MIT）',
          desc: '内置打包 batch_search、apply_edits、quick_outline、read_slices、run_checks 与 SessionStart 启动快照，可在设置页随时一键关闭。'
        }
      ],
      communityNote: '同时感谢 LINUX DO 社区在日常开发工具折腾与开源交流中提供的启发。',
      noticeLink: '查看第三方许可声明 (NOTICE.txt)'
    },
    install: {
      heading: '10 秒安装，无感接管旧配置',
      subheading: '优先复用本机 Node.js >= 22.13 或客户端自带 agy-node，无需 npm install 与管理员权限。',
      agentBadge: '最推荐',
      agentTitle: '方式一：一句话发给 Agent 全自动安装',
      agentDesc: '复制下面这段提示词，直接发给 Antigravity（或 Claude Code / Codex），它会自动阅读安装规范、静默完成安装并保留你的所有聊天记录与设置：',
      agentPrompt:
        '请帮我安装 Antigravity Max（https://github.com/wangbingnan136/agy-max）：先阅读仓库内的 docs/INSTALL_AGENT.md，按统一安装脚本静默安装，保留现有聊天记录与配置，不要强关当前窗口，装完核对版本并提醒我重启即可。',
      copyBtn: '复制提示词',
      copiedBtn: '已复制',
      cliTitle: '方式二：命令行与 Release ZIP 安装',
      cliDesc: '从 GitHub Releases 下载最新 ZIP 解压（或克隆仓库），在项目根目录运行对应脚本；覆盖安装会保留已有设置，应用内支持 SHA-256 校验更新与失败自动回滚。从 v1.4.1 及更早版本升级到 v1.4.2，请用这种方式重装一次。',
      platforms: [
        {
          name: 'macOS',
          status: '主力实测',
          statusTone: 'tested',
          cmd: 'sh ./install.sh',
          note: '自动在 ~/Applications/Antigravity (Max).app 生成带原版图标的启动器。'
        },
        {
          name: 'Windows PowerShell',
          status: '含兼容脚本（待更多实测）',
          statusTone: 'community',
          cmd: 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1',
          note: '含 Windows + WSL2（NAT / Mirrored）桥接兼容代码，欢迎反馈体验。'
        },
        {
          name: 'Linux / WSL2',
          status: '含兼容脚本（待更多实测）',
          statusTone: 'community',
          cmd: 'sh ./install.sh',
          note: '卸载可运行 sh ./uninstall.sh，加 --keep-settings 保留个人偏好。'
        }
      ],
      copyCmdLabel: '复制命令',
      links: [
        { label: '前往 GitHub Releases 下载 ZIP', href: RELEASES_URL },
        { label: '阅读 Agent 安装规范', href: INSTALL_GUIDE_URL },
        { label: '查看 Prism 兼容说明', href: PRISM_DOC_URL }
      ]
    },
    changelog: {
      heading: '更新日志',
      subheading: '保持与 Antigravity 最新版本同步演进，每次发布均附带 SHA-256 校验与单元测试。',
      allReleasesLabel: '在 GitHub 查看全部版本',
      entries: [
        {
          version: 'v1.4.3',
          tag: '最新',
          title: '拖会话进输入框即可引用、语音按钮修复与一轮稳定性加固',
          highlights: [
            '把侧栏会话拖进输入框即可插入原生 @ 会话引用；开启「重塑输入框卡片」后语音按钮不再变形、录音高亮不再消失（感谢社区贡献者 @andrew05060414）。',
            '修复关闭推理档位滑块后模型菜单变透明；一个模块的界面脚本出错不再拖垮整个界面。',
            '模块替换先备份并在失败时还原，清单读不出时不再装回已卸载的模块，「同时清除」会删除模块数据文件，钥匙串删除失败时保留记录并提示。',
            'SSH 中途断线不再重复执行命令，远端执行边界更严；非流式回复不再顶高 tok/s；汉化不再改写会话标题。'
          ]
        },
        {
          version: 'v1.4.2',
          tag: '',
          title: '按需模块化、侧栏拖动移动会话、/btw 子对话树与「版本更新」页',
          highlights: [
            '拆成 1 个核心 + 8 个可热插拔模块：默认装 4 个常用模块，界面与光学、多账号、代理、SSH 远端工程在「Antigravity Max -> 模块」页按需安装（SHA-256 校验、断网用离线包、卸载可保留或清除数据）。从 v1.4.x 升级会保留你在用的模块。',
            '把会话拖到其他项目即可移动；/btw 侧边提问收在主对话下方并可折叠；调推理档位时原生模型列表不再闪烁。',
            '设置里的「全部」页换成「版本更新」，可一键自动更新并阅读发布说明；速度改为只算生成阶段的 tok/s，数据库被占用时用量不再清零或倒退。',
            'SSH 远端执行边界更安全、远端输出更干净，macOS 钥匙串完整保存大凭据，内置 agy-fast 升级到 v0.3.2。从 v1.4.1 及更早版本升级需手动重装一次，之后恢复应用内更新。'
          ]
        },
        {
          version: 'v1.4.1',
          tag: '',
          title: 'SSH 连接与传文件更稳、图片右键菜单修复、下线本地壁纸',
          highlights: [
            'SSH 握手被中途断开时自动重试一次（命令尚未执行，不会重复运行）；持续失败会提示是网络或网关问题，不再误报为密钥错误。',
            '服务器没有 sftp 子系统时，传文件自动改用旧版 scp 协议；一键免密改为给每台服务器单独生成密钥，并启用 IdentitiesOnly 防止认证次数被用光。',
            '修复 [Image #N] 图片芯片吞掉右键、图片右键菜单弹不出来的问题。',
            '下线几乎看不见、还会挤压聊天布局的本地壁纸功能，旧设置中的壁纸项自动忽略。升级后需完全退出并重新打开 Antigravity。'
          ]
        },
        {
          version: 'v1.4.0',
          tag: '',
          title: '单窗口 SSH 远程项目、行内图片引用芯片、插件市场动态翻译与 Win11 深度兼容',
          highlights: [
            '在「创建项目 -> 远程 -> + Add Resource」新增 SSH 服务器入口，单窗口免远端二次授权管理 Linux 服务器，打通内置 MCP、不断流后台长任务、远端看图/Notebook、项目级 Skill/插件筛选、远程文件树与 Git Diff、跨机互传及内置终端。',
            '新增 [Image #N] 行内图片引用芯片与高清灯箱，以及长用户消息气泡「展开 / 收起」切换，阅读与发图更顺手。',
            '插件市场与详情页支持动态中文翻译与本地缓存，随语言设置即时切换。',
            '全面加固 Windows 11 凭据库、SSH 路径解析、回环免代理直连与安装竞态重试，并同步最新上游 Prism 与工作台体验修复。'
          ]
        },
        {
          version: 'v1.3.0',
          tag: '',
          title: '文件树原地编辑、Kiro / 系统编辑器兜底与 /goal 暂停续跑',
          highlights: [
            '右侧原生「文件结构」支持原地编辑 UTF-8 代码与文本文件，⌘S / Ctrl+S 保存前自动比对修改时间防覆盖，采用临时文件原子替换并保留 CRLF 换行。',
            '首选外部编辑器新增 Kiro 与「系统文本编辑器」兜底，未装任何 IDE 时自动用系统自带编辑器打开文件、文件管理器打开目录。',
            '重构 /goal 悬浮目标胶囊与行内验收清单，中止或流异常时自动暂停，点「继续」自动派发续跑回合。',
            '修复新建会话的辅助侧栏文件树挂载，兼容 plugin:// 侧车页面宿主。'
          ]
        },
        {
          version: 'v1.2.0',
          tag: '',
          title: '全面适配 Antigravity 2.35.1+ 与原生辅助侧栏「文件结构」',
          highlights: [
            '深度适配新版客户端侧栏置顶、路由过渡时序与 Helper 包路径，根治新版冷启动白屏与 React #311。',
            '右侧原生辅助侧栏集成「文件结构」标签页，支持实时过滤、代码 / 图片 / .ipynb 预览以及未绑定工作区时挂载文件夹。',
            '侧栏「优先事项」支持时间窗持久化，新增类 Codex 已归档会话批量还原与删除管理器。',
            '/compact 后即时投影上下文占用，超 12 个会话库启用增量 SQLite 缓存并加固回环代理与多账号防护。'
          ]
        },
        {
          version: 'v1.1.0',
          tag: '',
          title: '默认内置 agy-fast 加速引擎与完整开源致谢公示',
          highlights: [
            '随安装包内置 INK-Q/agy-fast，安装后自动部署启用，并在设置页提供一键开关且保留自定义 *.local.md 规则。',
            '在双语文档、NOTICE.txt 与应用内「关于」页完善开源来源与第三方许可致谢。'
          ]
        },
        {
          version: 'v1.0.0',
          tag: '',
          title: 'Antigravity Max 独立品牌首发',
          highlights: [
            '确立全能工作台路线，支持一键无损接管旧版 agy-powertools 配置、目标记录与系统凭据库多账号。',
            '整合输入框下置 Git 与遥测状态条、⌘+⌥+F 全文会话搜索、Prism 光学主题、水波试管、SSH 命令粘贴解析与免 TUN 独立代理。'
          ]
        }
      ]
    },
    footer: {
      license: 'MIT 开源协议',
      links: [
        { label: 'GitHub', href: REPO_URL },
        { label: 'Releases', href: RELEASES_URL },
        { label: '反馈问题', href: ISSUES_URL },
        { label: '第三方声明', href: NOTICE_URL },
        { label: 'English', href: '../' }
      ]
    }
  },

  en: {
    lang: 'en',
    title: 'Antigravity Max — All-in-One Native Workbench for Antigravity 2.0',
    description:
      'Flagship native workbench plugin for Antigravity 2.0: 1 core + 8 on-demand modules with the built-in agy-fast accelerator, native Side Panel File Tree with inline editing, Codex-style workflow suite, drag-to-move conversations, and a local 53-week dashboard; Prism optics, multi-account switcher, no-TUN proxy, and single-window SSH projects install on demand.',
    brand: 'Antigravity Max',
    altLangLabel: '中文',
    altLangHref: './zh/',
    nav: [
      { label: 'Screenshots', href: '#screenshots' },
      { label: 'Capabilities', href: '#capabilities' },
      { label: 'Modules', href: '#modules' },
      { label: 'Install', href: '#install' },
      { label: 'Changelog', href: '#changelog' }
    ],
    themeToggleLabel: 'Toggle light or dark theme',
    installNavCta: 'Install',
    hero: {
      badge: 'Ready for Antigravity 2.35.1+',
      badgeNote: 'Non-invasive local plugin',
      titleLine1: 'The flagship native workbench',
      titleLine2: 'for Antigravity 2.0',
      lead: 'One core, eight modules, only what you use: the built-in agy-fast accelerator, native Side Panel File Tree with inline editing, Codex-style search & goals workflow, drag-to-move conversations, and local usage telemetry, plus Prism optics, multi-account, no-TUN proxy, and SSH projects whenever you want them.',
      primaryCta: 'Copy one-line prompt for your Agent',
      primaryCtaCopied: 'Prompt copied — paste it to your Agent',
      secondaryLink: 'View CLI & ZIP install',
      metaLicense: 'MIT Open Source',
      metaPlatform: 'Tested on macOS | Win / Linux / WSL2 scripts included',
      tabs: [
        { id: 'workbench', label: 'Workbench & File Tree' },
        { id: 'telemetry', label: 'Dashboard & Cache' },
        { id: 'optics', label: 'Live Prism Optics' }
      ]
    },
    demo: {
      windowTitle: 'Antigravity Max — agy-max',
      searchHint: '⌘⌥F Search chats',
      bellLabel: '2 Active',
      sidebarPriorityTitle: 'Priority',
      sidebarPriorityItems: [
        { title: 'Cold-start router & side panel fix', meta: 'Running', active: true, badge: 'live' },
        { title: 'prod-gpu-01 training log audit', meta: 'SSH', active: false, badge: 'ssh' }
      ],
      sidebarFoldersTitle: 'Workspaces & Folders',
      sidebarFolders: [
        { name: 'agy-max', count: '6', active: true },
        { name: 'gpu-cluster-scripts', count: 'SSH', active: false },
        { name: 'Archived chats', count: '14', active: false }
      ],
      goalLabel: '/goal Active',
      goalText: 'Add inline UTF-8 text editing with mtime conflict checks inside Side Panel File Tree',
      goalStepsDone: '3 / 4',
      chatUserPrompt: 'Add inline editing to the File Tree preview and verify mtime before overwriting.',
      chatThought: 'Mapped aux-file-tree.js and wired atomic temp-file replacement',
      chatReply: 'Inline editing is live in the right File Tree tab. Pressing ⌘S compares disk mtime first and asks before overwriting external changes.',
      diffFiles: '2 files changed',
      composerPlaceholder: 'Continue chatting, or run /goal, /code-review, /compact...',
      gitBranch: 'main',
      contextModeLabel: 'Switch Ring / Liquid Vial',
      contextRingName: 'Ring',
      contextVialName: 'Liquid Vial',
      contextUsed: '68%',
      contextDetail: '97.4% cache hit',
      speedValue: '148 tok/s',
      sidePanelTabs: ['Overview', 'File Tree'],
      fileTreeTitle: 'File Tree',
      editBtn: 'Edit inline',
      saveBtn: 'Save ⌘S',
      savedToast: 'Verified mtime and saved atomically',
      editorHint: 'Edit UTF-8 text in place; files >192 KB stay read-only',
      telemetryStats: [
        { label: 'Weekly calls', value: '312', sub: 'Local + SSH transcripts' },
        { label: 'Cache hit rate', value: '97.4%', sub: 'Cold starts filtered out' },
        { label: 'Avg speed', value: '148 tok/s', sub: '1.8s time to first token' },
        { label: 'Cache drops', value: '2 flagged', sub: 'Short-interval alerts' }
      ],
      heatmapTitle: '53-week local activity heatmap',
      heatmapSub: 'Read-only local SQLite parsing — zero telemetry leaves your machine',
      anomalyTitle: 'Cache anomaly detector',
      anomalyRow: '14:22:08  |  agy-max  |  42s gap dropped to 11%  |  System prompt changed',
      opticsTitle: 'Preview all four built-in Prism optical palettes live',
      opticsSub: 'Real palettes bundled in Antigravity Max. Install the Interface & Optics module, then switch them live in Settings -> Interface & Optics and pair freely with the Ring or Liquid Vial gauge.',
      palettes: [
        { id: 'crystal', name: 'Crystal', desc: 'Crisp cool paper tone built for bright daylight sessions', mode: 'Light' },
        { id: 'obsidian', name: 'Obsidian', desc: 'Low-glare dark slate anchored by cobalt focus accents', mode: 'Dark' },
        { id: 'alabaster', name: 'Alabaster', desc: 'Warm editorial paper with muted terracotta highlights', mode: 'Light' },
        { id: 'warm', name: 'Warm Charcoal', desc: 'Soft low-blue dark canvas for late-night coding', mode: 'Dark' }
      ],
      gaugeToggleTitle: 'Context indicator style',
      presetTitle: 'Scene presets',
      presets: ['Native', 'Ultra', 'Focus', 'Eco']
    },
    screenshots: {
      heading: 'Real screenshots, zero mockups',
      subheading: 'Every screen below is captured directly from Antigravity 2.35.1+. Click any preview to inspect full resolution.',
      zoomHint: 'Click preview to zoom',
      closeLabel: 'Close lightbox',
      items: [
        {
          id: 'hero',
          tab: 'Full Workbench',
          title: 'All-in-one native workbench overview',
          caption: 'Integrates the under-card status strip, native right Side Panel, and clean localization without altering Antigravity’s native core.'
        },
        {
          id: 'composer',
          tab: 'Composer Strip',
          title: 'Under-card Git & telemetry status strip',
          caption: 'See Git diff counts, context ring or liquid vial, cache reuse, and live generation speed right below the composer.'
        },
        {
          id: 'overview',
          tab: 'Overview Panel',
          title: 'Live execution steps and remaining quota',
          caption: 'Track active stages, per-step timings, and remaining quotas per model group in a collapsible right Overview card.'
        },
        {
          id: 'dash-light',
          tab: 'Dashboard (Light)',
          title: 'Local usage dashboard & 53-week heatmap (Light)',
          caption: 'Summarizes weekly requests, tokens, cache hit rate, reference cost, 53-week activity heatmap, and model health.'
        },
        {
          id: 'dash-dark',
          tab: 'Dashboard (Dark)',
          title: 'Local usage dashboard & model breakdown (Dark)',
          caption: 'Follows dark mode automatically, comparing token share, estimated cost, cache efficiency, and throughput across models.'
        },
        {
          id: 'requests',
          tab: 'Requests & Cache',
          title: 'Per-request log & cache-drop flagging',
          caption: 'Filter by account, model, chat, and status while flagging short-interval cache drops without false positives from cold starts.'
        },
        {
          id: 'accounts',
          tab: 'Multi-Account',
          title: 'OS-keyring multi-account & quota switcher',
          caption: 'Optional Multi-Account Switcher module: isolate and switch multiple Google accounts locally via system keyrings with unified 5-hour and weekly quota visibility.'
        },
        {
          id: 'settings',
          tab: 'Languages & Optics',
          title: 'Five-language UI & Prism optical settings',
          caption: 'Switch UI languages, filter settings by category, toggle the built-in agy-fast accelerator, and back up sanitized JSON live; scene presets and optical themes arrive with the Interface & Optics module.'
        },
        {
          id: 'proxy',
          tab: 'No-TUN Proxy',
          title: 'App-scoped HTTP / SOCKS5 proxy',
          caption: 'Optional Standalone Proxy module: route only Antigravity without a system TUN driver, with connectivity tests and Force HTTP/1.1.'
        }
      ]
    },
    capabilities: {
      heading: 'Rebuilt around every high-frequency coding loop',
      subheading: 'From cutting agent tool round trips to editing project files in place and inspecting SSH sessions, every module earns its seat in daily engineering.',
      cards: [
        {
          id: 'fast',
          title: 'Built-in agy-fast accelerator (toggleable)',
          desc: 'Auto-deploys batched search, symbol outlines, atomic multi-file edits, concurrent checks, and startup snapshots out of the box. Turn off anytime in Settings without losing *.local.md rules.'
        },
        {
          id: 'filetree',
          title: 'Native Side Panel File Tree & inline edit',
          desc: 'Lives inside Antigravity’s native right Side Panel with instant filtering, code / image / notebook previews, ⌘S inline editing, and exact line:col jumps into Cursor, VS Code, Windsurf, Zed, or Kiro.'
        },
        {
          id: 'codex',
          title: 'Codex-style flagship workflow suite',
          desc: 'Millisecond local + SSH full-text chat search (⌘+⌥+F), active-sessions bell with persisted Priority list, drag conversations between projects, nested /btw side chats, floating /goal tracker with resume, archived chats manager, and full tool-chain Markdown export.'
        },
        {
          id: 'prism',
          title: 'Prism optics & liquid vial gauge (optional module)',
          desc: 'Install Interface & Optics for four optical palettes (Crystal, Obsidian, Alabaster, Warm), scene presets, and the liquid vial context indicator; per-model reasoning slider memory, code folding, and inline step diffs ship by default.'
        },
        {
          id: 'telemetry',
          title: '53-week local dashboard & cache alerts',
          desc: 'Read-only local SQLite and JSONL analytics tracking cache hit rate, TTFT, decode-phase tok/s, reference cost, and short-interval cache anomalies; a locked database never zeroes or rolls back usage.'
        },
        {
          id: 'ssh-proxy',
          title: 'SSH projects, multi-account & no-TUN proxy (optional modules)',
          desc: 'Mount remote server folders in one window and let the local AI read, write, and run there; paste ssh -p 2222 user@host to auto-fill host and port while stripping trailing passwords; OS-keyring multi-account and app-scoped proxy install on demand too.'
        }
      ],
      visuals: {
        fastBefore: 'Serial tool round trips',
        fastAfter: 'Built-in agy-fast batching',
        fastSwitch: 'One-click toggle in Settings',
        fileTreeSave: 'mtime safety guard',
        codexSearch: '18 matching turns  |  12ms',
        codexBell: '2 tasks running',
        codexGoal: '/goal pill with auto-pause & resume',
        telemetryRate: 'Cache reuse',
        telemetryAlert: 'Short-gap cache drop flagged',
        sshInput: 'ssh -p 2222 root@gpu-01 MyPass',
        sshParsed: 'Parsed root@gpu-01:2222',
        sshDropped: 'Password stripped',
        proxyTag: 'HTTP / SOCKS5 no-TUN',
        keyringTag: 'OS keyring isolated'
      }
    },
    modules: {
      heading: 'Modules: install only what you use',
      subheading: 'One lightweight core plus eight hot-pluggable modules. Four everyday modules ship by default; install or remove the rest from Antigravity Max -> Modules. Modules you skip never load, use no memory, and add no settings.',
      defaultTitle: 'Installed by default',
      defaultBadge: 'Default',
      optionalTitle: 'Install on demand',
      optionalBadge: 'Optional',
      points: ['SHA-256 verified downloads from GitHub Releases', 'Bundled offline copy when you are offline', 'Uninstall keeps settings or purges them with keychain credentials', 'Upgrades from v1.4.x keep the modules you use', 'agy-<module> Dev-Local folders mount first']
    },
    credits: {
      heading: 'Open source, built openly on community craft',
      subheading: 'Non-invasive mounting, MIT licensed, local-first privacy, and clear credit to every upstream project that shaped it.',
      pillars: [
        {
          title: 'Why a native plugin instead of a separate wrapper?',
          body: 'Staying natively inside Antigravity 2.35.1+ means you keep every upstream feature the day it ships while gaining an opinionated workbench. The installer never modifies the app binary and cleanly uninstalls anytime.'
        },
        {
          title: 'Local-first privacy, sensitive tools on demand',
          body: 'Telemetry, full-text search, and file previews run locally without sending conversations anywhere. Multi-account switching, no-TUN proxy, and SSH projects are optional modules that never load until you install them; credentials live in the OS keyring and can be purged with the module.'
        }
      ],
      tableTitle: 'Open-Source Origins & Credits',
      upstreams: [
        {
          name: 'WhiteBr1ck/agy-powertools',
          url: 'https://github.com/WhiteBr1ck/agy-powertools',
          role: 'Core foundation (MIT)',
          desc: 'Local CDP mounting, SQLite/JSONL telemetry & 53-week dashboard, multilingual base, session branching, OS-keyring multi-account, and no-TUN proxy with seamless migration.'
        },
        {
          name: 'RMvdesi/obsidian-prism',
          url: 'https://github.com/RMvdesi/obsidian-prism',
          role: 'Optical & UX inspiration (clean-room)',
          desc: 'Four optical palettes, scene presets, liquid vial context indicator, reasoning slider, code folding, inline step diffs, and workbench design language.'
        },
        {
          name: 'INK-Q/agy-fast',
          url: 'https://github.com/INK-Q/agy-fast',
          role: 'Bundled default accelerator (MIT)',
          desc: 'Bundles batch_search, apply_edits, quick_outline, read_slices, run_checks, and SessionStart snapshots out of the box with a one-click Settings toggle.'
        }
      ],
      communityNote: 'Also grateful to the LINUX DO community for everyday tooling ideas and open-source discussion.',
      noticeLink: 'Read third-party notices (NOTICE.txt)'
    },
    install: {
      heading: 'Install in 10 seconds, keep all your settings',
      subheading: 'Uses Node.js >= 22.13 or falls back to Antigravity’s bundled agy-node. Zero npm install and no admin privileges required.',
      agentBadge: 'Recommended',
      agentTitle: 'Option 1: One-line prompt for your Agent',
      agentDesc: 'Copy this prompt and send it to Antigravity (or Claude Code / Codex). It reads the guide, installs silently, and preserves your existing chats and preferences:',
      agentPrompt:
        'Please install Antigravity Max from https://github.com/wangbingnan136/agy-max : read docs/INSTALL_AGENT.md first, run the unified installer without closing my active window, keep my existing chats and settings intact, and verify the installed version when done.',
      copyBtn: 'Copy prompt',
      copiedBtn: 'Copied',
      cliTitle: 'Option 2: Command line & Release ZIP',
      cliDesc: 'Download and extract the latest ZIP from GitHub Releases (or clone the repo), then run the installer. Re-installing preserves preferences, and in-app updates verify SHA-256 with automatic rollback. Upgrading from v1.4.1 or earlier to v1.4.2 needs one reinstall this way.',
      platforms: [
        {
          name: 'macOS',
          status: 'Primary tested',
          statusTone: 'tested',
          cmd: 'sh ./install.sh',
          note: 'Generates ~/Applications/Antigravity (Max).app with the native icon for your Dock.'
        },
        {
          name: 'Windows PowerShell',
          status: 'Scripts included (untested)',
          statusTone: 'community',
          cmd: 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1',
          note: 'Includes Windows + WSL2 (NAT / Mirrored) compatibility scripts; feedback and PRs welcome.'
        },
        {
          name: 'Linux / WSL2',
          status: 'Scripts included (untested)',
          statusTone: 'community',
          cmd: 'sh ./install.sh',
          note: 'Uninstall via sh ./uninstall.sh, or pass --keep-settings to retain preferences.'
        }
      ],
      copyCmdLabel: 'Copy command',
      links: [
        { label: 'Download ZIP on GitHub Releases', href: RELEASES_URL },
        { label: 'Read Agent installation guide', href: INSTALL_GUIDE_URL },
        { label: 'View Prism compatibility notes', href: PRISM_DOC_URL }
      ]
    },
    changelog: {
      heading: 'Changelog',
      subheading: 'Continuously aligned with the latest Antigravity releases, shipped with SHA-256 bundles and unit tests.',
      allReleasesLabel: 'View all releases on GitHub',
      entries: [
        {
          version: 'v1.4.3',
          tag: 'Latest',
          title: 'Drag conversations into the composer, voice button fixes, and a round of hardening',
          highlights: [
            'Drop a sidebar conversation onto the composer to insert a native @ mention; with "Restyle composer card" on, voice buttons are no longer deformed and the recording highlight stays visible (thanks to community contributor @andrew05060414).',
            'Fixed the model menu turning invisible after disabling the effort slider; one module\'s broken client script no longer takes down the whole UI.',
            'Module replacement backs up and restores on failure, an unreadable manifest no longer reinstalls removed modules, "Also clear data" deletes module data files, and failed keychain deletions keep their records.',
            'An SSH drop mid-command never runs it twice and the execution boundary is stricter; non-streamed replies no longer inflate tok/s; localization leaves conversation titles alone.'
          ]
        },
        {
          version: 'v1.4.2',
          tag: '',
          title: 'Modular install, drag conversations between projects, nested /btw side chats, and an Updates tab',
          highlights: [
            'Split into 1 core + 8 hot-pluggable modules: 4 everyday modules by default, while Optics, Multi-Account, Proxy and SSH Projects install on demand from Antigravity Max -> Modules (SHA-256 verified, offline fallback, keep or purge data on uninstall). Upgrades from v1.4.x keep the modules you use.',
            'Drag a conversation onto another project; /btw side questions fold under their main conversation; the native model list no longer flashes when adjusting effort.',
            'The "All" settings tab became "Updates" with one-click auto-update and release notes; speed now counts decode-phase tok/s and usage stats never zero out or roll back on a locked database.',
            'Safer SSH boundary and cleaner remote output, full-size macOS Keychain secrets, and agy-fast v0.3.2. Upgrading from v1.4.1 or earlier needs one manual reinstall; in-app updates work again afterwards.'
          ]
        },
        {
          version: 'v1.4.1',
          tag: '',
          title: 'Sturdier SSH connections and transfers, image context menu fix, local wallpaper removed',
          highlights: [
            'A dropped SSH handshake is retried once (the command had not started, so it never runs twice); persistent failures are reported as network or gateway problems instead of a wrong key.',
            'Transfers fall back to the legacy scp protocol on servers without sftp, and one-click passwordless login now creates a dedicated key per server with IdentitiesOnly enabled.',
            'Fixed [Image #N] image chips swallowing right clicks, which kept the image context menu from opening.',
            'Removed the barely visible local wallpaper that squeezed the chat layout; leftover wallpaper settings are ignored. Fully quit and reopen Antigravity after upgrading.'
          ]
        },
        {
          version: 'v1.4.0',
          tag: '',
          title: 'Single-window SSH Remote Projects, inline image chips, dynamic marketplace translation & Win11 hardening',
          highlights: [
            'Added SSH Server under Create Project -> Remote -> + Add Resource for single-window Linux remote projects without remote re-auth, complete with built-in MCP, detached long-running jobs, remote image/notebook viewing, per-project Skill/Plugin scoping, remote File Tree & Git Diff, cross-machine transfers, and built-in SSH Terminal.',
            'Added [Image #N] inline image mention chips with lightbox navigation and a Show more / Show less toggle for long clamped user messages.',
            'Added dynamic Chinese translation with caching for the plugin marketplace catalog and detail views.',
            'Hardened Windows 11 Credential Manager, loopback CDP proxy bypass, SSH path handling, and staging retries, alongside upstream Prism and workbench fixes.'
          ]
        },
        {
          version: 'v1.3.0',
          tag: '',
          title: 'Inline File Tree editing, Kiro & system editor fallback, and /goal resume',
          highlights: [
            'Edit UTF-8 code and text files right inside the Side Panel File Tree preview; ⌘S / Ctrl+S verifies file mtime before atomic replacement and preserves CRLF line endings.',
            'Added Kiro and System text editor fallback to Preferred external editor so files still open cleanly even when no IDE is installed.',
            'Redesigned floating /goal pill and inline checklist with auto-pause on abort and one-click continuation turn dispatch.',
            'Fixed File Tree mounting in brand-new chats and added support for plugin:// sidecar page hosts.'
          ]
        },
        {
          version: 'v1.2.0',
          tag: '',
          title: 'Antigravity 2.35.1+ compatibility & native Side Panel File Tree',
          highlights: [
            'Adapted sidebar pinning, router lifecycle, and macOS Helper bundle paths to eliminate cold-start white screens and React #311 errors.',
            'Integrated a dedicated File Tree tab right inside Antigravity’s native right Side Panel with filtering, code / image / .ipynb previews, and folder mounting.',
            'Added persisted Priority time windows and a Codex-style archived chats manager with batch restore and deletion.',
            'Immediate post-/compact context projection, incremental SQLite caching for >12 session DBs, and loopback / multi-account hardening.'
          ]
        },
        {
          version: 'v1.1.0',
          tag: '',
          title: 'Bundled agy-fast accelerator & open-source attribution',
          highlights: [
            'Bundled INK-Q/agy-fast out of the box with a one-click Settings toggle that safely preserves custom *.local.md rules.',
            'Added clear open-source credits across bilingual docs, NOTICE.txt, and Settings -> About.'
          ]
        },
        {
          version: 'v1.0.0',
          tag: '',
          title: 'Initial Antigravity Max standalone release',
          highlights: [
            'Launched the all-in-one workbench with seamless settings, goals, and keyring migration from agy-powertools.',
            'Unified under-card Git & telemetry strip, ⌘+⌥+F full-text search, Prism optics, liquid vial gauge, SSH paste parsing, and no-TUN proxy.'
          ]
        }
      ]
    },
    footer: {
      license: 'MIT License',
      links: [
        { label: 'GitHub', href: REPO_URL },
        { label: 'Releases', href: RELEASES_URL },
        { label: 'Issues', href: ISSUES_URL },
        { label: 'Third-party notices', href: NOTICE_URL },
        { label: '简体中文', href: './zh/' }
      ]
    }
  }
};
