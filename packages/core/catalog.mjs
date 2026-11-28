export const CORE_API_VERSION = 1;

export const MODULE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'telemetry',
    order: 10,
    defaultInstalled: true,
    category: 'core-pack',
    displayName: Object.freeze({ 'zh-CN': '统计与额度', 'zh-TW': '統計與額度', en: 'Telemetry & Quota' }),
    description: Object.freeze({
      'zh-CN': '上下文圆环、首字延迟 TTFT、纯流式 tok/s 速度码表、单账号剩余额度与 53 周用量看板。',
      'zh-TW': '上下文圓環、首字延遲 TTFT、純流式 tok/s 速度碼表、單帳號剩餘額度與 53 週用量看板。',
      en: 'Context ring, TTFT, pure decode tok/s dial, single-account quota countdowns, and 53-week usage dashboard.'
    }),
    settingsKeys: Object.freeze([
      'overviewRange', 'contextRing', 'speedStats', 'composerIndicatorTone',
      'composerIndicatorCompact', 'composerQuota', 'composerQuotaWindow',
      'progress', 'overviewQuota', 'subagentTelemetry', 'timing', 'toolDetails'
    ]),
    clientHelpers: Object.freeze(['dashboard.mjs', 'cache.mjs', 'account-helpers.mjs']),
    clientScripts: Object.freeze(['calendar-vendor.js']),
    dataFiles: Object.freeze(['pricing.json', 'quota-samples.json', 'account-timeline.json'])
  }),
  Object.freeze({
    id: 'chat-flow',
    order: 20,
    defaultInstalled: true,
    category: 'core-pack',
    displayName: Object.freeze({ 'zh-CN': '对话交互增强', 'zh-TW': '對話互動增強', en: 'Chat Flow Enhancements' }),
    description: Object.freeze({
      'zh-CN': '灵活移动会话所属项目、/btw 侧边子对话树、原位消息编辑、行内图片胶囊、分支会话、复制 Markdown、/goal 目标栏、代码块折叠与行内 Diff。',
      'zh-TW': '靈活移動會話所屬專案、/btw 側邊子對話樹、原位訊息編輯、行內圖片膠囊、分支會話、複製 Markdown、/goal 目標欄、程式碼塊摺疊與行內 Diff。',
      en: 'Flexible project move, nested /btw side-chat tree, in-place message editing, inline image chips, branching, Markdown copy, /goal bar, code folding, and inline diff.'
    }),
    settingsKeys: Object.freeze([
      'compact', 'keepTurnOutline', 'keepOverviewOpen', 'pinOverview', 'responseBranch',
      'conversationMove', 'btwSubtree',
      'copySessionMarkdown', 'messageEdit', 'inlineImages', 'goalBar',
      'stageUpdates', 'efficientIO', 'pragmaticCoding', 'effortSlider',
      'effortMemory', 'codeBlockFold', 'railHoverOutline', 'inlineStepDiff',
      'omniViewer', 'linkTarget', 'quickContextMenu', 'contextLimit',
      'betaThinkingTranslate', 'betaThinkingEngine', 'betaThinkingDisplay', 'betaThinkingTrigger',
      'betaComposerPredict', 'betaAiModel', 'betaAiTranslateModel', 'betaAiPredictModel',
      'chatModeBeta', 'homeStudio'
    ]),
    clientHelpers: Object.freeze([]),
    clientScripts: Object.freeze(['native-inline-images.js', 'prism-workbench.js', 'native-chat-tree.js', 'native-beta-ai.js']),
    dataFiles: Object.freeze(['chat-flow-tree.json', 'goals.json', 'ai-providers.json', 'thinking-translate-cache.json'])
  }),
  Object.freeze({
    id: 'workspace-nav',
    order: 30,
    defaultInstalled: true,
    category: 'core-pack',
    displayName: Object.freeze({ 'zh-CN': '工作区与会话导航', 'zh-TW': '工作區與會話導覽', en: 'Workspace & Navigation' }),
    description: Object.freeze({
      'zh-CN': '右侧辅助侧栏文件树、输入框 Git 状态胶囊、历史会话全文搜索、项目置顶与优先事项铃铛。',
      'zh-TW': '右側輔助側欄檔案樹、輸入框 Git 狀態膠囊、歷史會話全文搜尋、專案置頂與優先事項鈴鐺。',
      en: 'Side-panel File Tree, composer Git pill, full-text session search, project pinning, and active-sessions bell.'
    }),
    settingsKeys: Object.freeze([
      'auxFileTree', 'gitStatusPill', 'fileContextMenu', 'externalEditor',
      'sessionSearch', 'sessionSearchShortcut', 'sidebarProjectPin',
      'sidebarProjectLimit', 'sidebarFocusBell', 'priorityWindow',
      'priorityMaxItems', 'priorityVisibleRows', 'taskbarBadge', 'agyFast'
    ]),
    clientHelpers: Object.freeze([]),
    clientScripts: Object.freeze(['aux-file-tree.js']),
    dataFiles: Object.freeze(['priority.json', 'recent-workspaces.json'])
  }),
  Object.freeze({
    id: 'i18n',
    order: 40,
    defaultInstalled: true,
    category: 'core-pack',
    displayName: Object.freeze({ 'zh-CN': '多语言与市场汉化', 'zh-TW': '多語言與市場漢化', en: 'Localization & Marketplace i18n' }),
    description: Object.freeze({
      'zh-CN': '客户端常用原生菜单简繁英日粤本地化、Swarm 面板汉化与插件市场英文描述自动翻译。',
      'zh-TW': '客戶端常用原生選單簡繁英日粵本地化、Swarm 面板漢化與外掛市場英文描述自動翻譯。',
      en: 'Multilingual UI localization, Swarm board translation, and automatic Marketplace catalog translation.'
    }),
    settingsKeys: Object.freeze(['language', 'marketplaceTranslate']),
    clientHelpers: Object.freeze(['zh-tw.mjs']),
    clientScripts: Object.freeze(['native-i18n.js']),
    dataFiles: Object.freeze(['marketplace-i18n-cache.json'])
  }),
  Object.freeze({
    id: 'optics',
    order: 50,
    defaultInstalled: false,
    category: 'optional-pack',
    displayName: Object.freeze({ 'zh-CN': '界面与光学', 'zh-TW': '介面與光學', en: 'Interface & Optics' }),
    description: Object.freeze({
      'zh-CN': '场景预设、黑曜石/暖色调色板、流光墨迹、对话光环、平滑光标、电子宠物与用户气泡配色。',
      'zh-TW': '場景預設、黑曜石/暖色調色盤、流光墨跡、對話光環、平滑游標、電子寵物與使用者氣泡配色。',
      en: 'Scene presets, optical palettes, stream ink, conversation aura, smooth caret, desktop mascots, and bubble tinting.'
    }),
    settingsKeys: Object.freeze([
      'userBubbleTint', 'userBubblePreset', 'userBubbleColor',
      'themePalette', 'lightThemePreset', 'accentTone', 'cornerStyle',
      'codeFont', 'codeLigatures', 'ambientIntensity', 'sidebarCompact',
      'sidebarNavFold', 'composerRestyle', 'placeholderStyle', 'logoInk',
      'motionLevel', 'targetFps', 'contextStyle', 'smoothCaret',
      'scrollBottomMotion', 'streamInk', 'convAura', 'prismRim',
      'homeRipple', 'mascotMode'
    ]),
    clientHelpers: Object.freeze([]),
    clientScripts: Object.freeze(['prism-optics.js'])
  }),
  Object.freeze({
    id: 'accounts',
    order: 60,
    defaultInstalled: false,
    category: 'optional-pack',
    displayName: Object.freeze({ 'zh-CN': '多账号切换', 'zh-TW': '多帳號切換', en: 'Multi-Account Switcher' }),
    description: Object.freeze({
      'zh-CN': '通过系统原生钥匙串安全备份多个账号凭据，支持侧栏快捷切号与额度耗尽自动切换。',
      'zh-TW': '透過系統原生鑰匙圈安全備份多個帳號憑據，支援側欄快捷切號與額度耗盡自動切換。',
      en: 'Back up and switch multiple accounts via OS keyring with sidebar quick switcher and auto-switch on quota exhaustion.'
    }),
    settingsKeys: Object.freeze([
      'multiAccount', 'accountSwitcher', 'autoSwitchAccount',
      'accountViewMode', 'accountQuotaWindow'
    ]),
    clientHelpers: Object.freeze(['account-helpers.mjs']),
    clientScripts: Object.freeze([]),
    dataFiles: Object.freeze(['accounts.json'])
  }),
  Object.freeze({
    id: 'proxy',
    order: 70,
    defaultInstalled: false,
    category: 'optional-pack',
    displayName: Object.freeze({ 'zh-CN': '免 TUN 独立代理', 'zh-TW': '免 TUN 獨立代理', en: 'Standalone Proxy (No-TUN)' }),
    description: Object.freeze({
      'zh-CN': '为客户端单独注入 HTTP/SOCKS5 代理与连通性探测，支持禁用 Go HTTP/2 缓解 EOF 断连。',
      'zh-TW': '為客戶端單獨注入 HTTP/SOCKS5 代理與連通性探測，支援停用 Go HTTP/2 緩解 EOF 斷連。',
      en: 'Per-app HTTP/SOCKS5 proxy injection, connectivity probe, and HTTP/1.1 fallback to mitigate idle EOF drops.'
    }),
    settingsKeys: Object.freeze(['proxyEnabled', 'proxyUrl', 'proxyBypass', 'proxyForceHttp1']),
    clientHelpers: Object.freeze([]),
    clientScripts: Object.freeze([])
  }),
  Object.freeze({
    id: 'ssh-remote',
    order: 80,
    defaultInstalled: false,
    category: 'optional-pack',
    displayName: Object.freeze({ 'zh-CN': 'SSH 远端工程', 'zh-TW': 'SSH 遠端工程', en: 'Single-Window SSH Projects' }),
    description: Object.freeze({
      'zh-CN': '单窗口挂载远程 Linux 服务器目录、SFTP/SCP 文件互传、远端终端与粘贴 SSH 命令自动解析。',
      'zh-TW': '單視窗掛載遠端 Linux 伺服器目錄、SFTP/SCP 檔案互傳、遠端終端機與貼上 SSH 命令自動解析。',
      en: 'Mount remote SSH folders in one window with file transfer, remote terminal, SSH paste parser, and isolated MCP tools.'
    }),
    settingsKeys: Object.freeze(['sshCommandPaste']),
    inlineModuleScripts: Object.freeze(['native-ssh-paste.mjs']),
    clientHelpers: Object.freeze([]),
    clientScripts: Object.freeze(['native-ssh-projects.js']),
    dataFiles: Object.freeze(['ssh-projects']),
    hasMcp: true,
    hasBoundaryHook: true
  })
]);

export const MODULE_BY_ID = new Map(MODULE_CATALOG.map(entry => [entry.id, entry]));
export const ALL_MODULE_IDS = Object.freeze(MODULE_CATALOG.map(entry => entry.id));
export const DEFAULT_MODULE_IDS = Object.freeze(MODULE_CATALOG.filter(entry => entry.defaultInstalled).map(entry => entry.id));
export const OPTIONAL_MODULE_IDS = Object.freeze(MODULE_CATALOG.filter(entry => !entry.defaultInstalled).map(entry => entry.id));

export function isKnownModuleId(id) {
  return typeof id === 'string' && MODULE_BY_ID.has(id);
}

// coreRange in module.json uses the minimal form `>=X.Y.Z` (or an exact `X.Y.Z`), compared against the core version.
export function coreRangeSatisfied(range, coreVersion) {
  if (range === undefined || range === null || range === '') return true;
  const parse = v => {
    const m = String(v || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
    return m ? m.slice(1, 4).map(Number) : null;
  };
  const m = String(range).trim().match(/^(>=)?\s*(\S+)$/);
  const want = m ? parse(m[2]) : null;
  const have = parse(coreVersion);
  if (!want || !have) return false;
  const cmp = have[0] - want[0] || have[1] - want[1] || have[2] - want[2];
  return m[1] ? cmp >= 0 : cmp === 0;
}

const sameSetting = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

// `defaults` are the core DEFAULT_SETTINGS; v1.4.x stored settings as full objects, so any optics key that
// differs from its default means optics was in use.
export function detectLegacyUsedOptionalModules(rawSettings = {}, { hasSavedAccounts = false, hasSavedSsh = false, defaults = null } = {}) {
  const detected = new Set();
  const s = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const usedOptics = (
    (s.themePalette && s.themePalette !== 'native') ||
    (s.motionLevel && s.motionLevel !== 'off') ||
    s.userBubbleTint === true ||
    (s.mascotMode && s.mascotMode !== 'off') ||
    s.composerRestyle === true ||
    s.sidebarCompact === true ||
    s.sidebarNavFold === true ||
    s.streamInk === true ||
    s.convAura === true ||
    s.prismRim === true ||
    s.homeRipple === true ||
    s.smoothCaret === true ||
    s.contextStyle === 'vial' ||
    (s.accentTone && s.accentTone !== 'follow') ||
    (s.codeFont && s.codeFont !== 'default') ||
    s.codeLigatures === true ||
    Boolean(defaults && MODULE_BY_ID.get('optics').settingsKeys.some(key => key in s && key in defaults && !sameSetting(s[key], defaults[key])))
  );
  if (usedOptics) detected.add('optics');
  if (s.multiAccount === true || hasSavedAccounts) detected.add('accounts');
  if (s.proxyEnabled === true || (typeof s.proxyUrl === 'string' && s.proxyUrl.trim() !== '')) detected.add('proxy');
  if (hasSavedSsh) detected.add('ssh-remote');
  return [...detected];
}
