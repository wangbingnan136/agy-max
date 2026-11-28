import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync,mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import vm from'node:vm';
import{toZhTw}from'../lib/zh-tw.mjs';
import{renderAuxPaneHtml}from'../lib/sidecar-ui.mjs';
import{formatRelativeTime,formatResetCountdown}from'../lib/account-helpers.mjs';
import{createSettingsStore}from'../lib/settings.mjs';
test('native settings translations preserve product names and English input terminology',()=>{
 const document={nodeType:9,createTreeWalker:()=>({nextNode:()=>null}),querySelectorAll:()=>[]};
 const context=vm.createContext({document,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){} disconnect(){}}});
 vm.runInContext(readFileSync('packages/i18n/native-i18n.js','utf8'),context);const t=context.__agyI18n.t;
 assert.equal(t('Interface Layout','zh-CN'),'界面布局');assert.equal(t('Queued Messages','zh-CN'),'后续消息');assert.equal(t('输入','en'),'Input');
 assert.equal(t('Google AI Ultra','zh-CN'),'Google AI Ultra');assert.equal(t('Google Sans','zh-CN'),'Google Sans');assert.equal(t('Ctrl','zh-CN'),'Ctrl');
 assert.equal(t('Your Plan: Google AI Ultra','zh-CN'),'当前套餐：Google AI Ultra');
 assert.equal(t('You have used some of your weekly limit, it will fully refresh in 3 days, 11 hours.','zh-CN'),'周额度将在 3 天 11 小时后重置。');
 assert.equal(t('Quote','zh-CN'),'引用');assert.equal(t('Ask /btw','zh-CN'),'顺便问 /btw');
 assert.equal(t('Local Permissions','zh-CN'),'本地权限');assert.equal(t('Every command requires approval.','zh-CN'),'每条命令均需批准。');
 assert.equal(t('Ask before sensitive operations.','zh-CN'),'执行敏感操作前询问。');assert.equal(t('Run all commands without restrictions.','zh-CN'),'无限制运行所有命令。');
 assert.equal(t('Background Tasks','zh-CN'),'后台任务');assert.equal(t('See all (6)','zh-CN'),'查看全部 (6)');
 assert.equal(t('See all','zh-CN'),'查看全部');assert.equal(t('Conversation Name','zh-CN'),'会话名称');assert.equal(t('Conversation ID','zh-CN'),'会话 ID');assert.equal(t('Project Name','zh-CN'),'项目名称');
 assert.equal(t('Split Right','zh-CN'),'向右拆分');assert.equal(t('Split Down','zh-CN'),'向下拆分');assert.equal(t('Replace with New','zh-CN'),'替换为新会话');
 assert.equal(t('Search or enter a URL','zh-CN'),'搜索或输入网址');assert.equal(t('Open File','zh-CN'),'打开文件');
 assert.equal(t('Side Question','zh-CN'),'侧边对话');assert.equal(t('New Side Question','zh-CN'),'新建侧边对话');
 assert.equal(t('Ask a side question without interrupting the main conversation','zh-CN'),'发起侧边对话，不打断主对话');
 assert.equal(t('12 files changed','zh-CN'),'12 个文件已更改');assert.equal(t('1 file changed','zh-CN'),'1 个文件已更改');
 assert.equal(t('5h limit','zh-CN'),'5 小时限额');assert.equal(t('55% left','zh-CN'),'剩余 55%');assert.equal(t('100% left','zh-CN'),'剩余 100%');
 assert.equal(t('Resets in 5d 1h','zh-CN'),'5 天 1 小时后重置');assert.equal(t('Resets in 3h 33m','zh-CN'),'3 小时 33 分钟后重置');
 assert.equal(t('Pull Requests','zh-CN'),'Pull Requests');assert.equal(t('14m ago','zh-CN'),'14m ago');
 assert.equal(t('Turbo','zh-CN'),'Turbo');assert.equal(t('当前会话','en'),'Current conversation');
 assert.equal(t('Pinned','zh-CN'),'置顶');assert.equal(t('Pinned Conversations','zh-CN'),'置顶');
 assert.equal(t('Pin Project','zh-CN'),'置顶项目');assert.equal(t('Unpin Project','zh-CN'),'取消置顶项目');
 assert.equal(t('Pin Entire Project','zh-CN'),'置顶所属项目');
 assert.equal(t('Show 3 More','zh-CN'),'展开显示');assert.equal(t('Show Less','zh-CN'),'收起');
});

test('Traditional Chinese (zh-TW) uses Taiwan IT terminology, converts UI strings cleanly, and persists in settings',()=>{
  const document={nodeType:9,createTreeWalker:()=>({nextNode:()=>null}),querySelectorAll:()=>[]};
  const context=vm.createContext({document,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){} disconnect(){}},__agyToZhTw:toZhTw});
  vm.runInContext(readFileSync('packages/i18n/native-i18n.js','utf8'),context);
  const t=context.__agyI18n.t;
  assert.equal(t('Settings','zh-TW'),'設定');
  assert.equal(t('Context window','zh-TW'),'上下文視窗');
  assert.equal(t('Cache hit','zh-TW'),'快取命中');
  assert.equal(t('Open File','zh-TW'),'開啟檔案');
  assert.equal(t('Restore defaults','zh-TW'),'恢復預設設定');
  assert.equal(t('Every command requires approval.','zh-TW'),'每條命令均需批准。');
  assert.equal(t('Background Tasks','zh-TW'),'背景任務');
  assert.equal(t('Your Plan: Google AI Ultra','zh-TW'),'目前方案：Google AI Ultra');
  assert.equal(t('Resets in 3h 33m','zh-TW'),'3 小時 33 分鐘後重置');
  assert.equal(t('Thinking effort','zh-CN'),'思考深度');
  assert.equal(t('Thinking effort','zh-TW'),'思考深度');
  assert.equal(t('View Usage','zh-CN'),'查看用量');
  assert.equal(t('Promote to Conversation','zh-CN'),'提升为正式会话');
  assert.equal(t('Promote to Conversation','zh-TW'),'提升為正式會話');
  assert.equal(t('Carries out the plan: searches, edits, builds, and tests. Pick a faster, cheaper model.','zh-TW'),'負責執行計畫，包括檢索、編輯、構建與測試，建議選擇更快、更省的模型。');
  assert.equal(t('Delete Conversation','zh-CN'),'删除会话');
  assert.equal(t('Delete Conversation','zh-TW'),'刪除會話');
  assert.equal(t('Are you sure you want to delete this conversation? This action cannot be undone.','zh-TW'),'確定要刪除此會話嗎？此操作無法撤銷。');
  assert.equal(t('Minimize','zh-TW'),'最小化');
  assert.equal(t('Maximize','zh-TW'),'最大化');
  assert.equal(t('Create Project','zh-TW'),'建立專案');
  assert.equal(t('Command Palette','zh-TW'),'命令面板');
  assert.equal(t('This computer','zh-TW'),'本機');
  assert.equal(t('Input Box','zh-TW'),'輸入框');
  assert.equal(t('Queued messages','zh-TW'),'後續訊息');
  assert.equal(t('Choose which key sends a message in the chat composer.','zh-TW'),'選擇在聊天輸入框中傳送訊息的按鍵。');
  assert.equal(t('Controls how much time and quota the model spends reasoning before responding. Higher effort improves accuracy on hard problems, at the cost of slower responses and higher quota use.','zh-CN'),'控制模型在回复前投入多少时间与额度进行推理。更高的思考深度可提升复杂问题的准确度，但会增加响应耗时与额度消耗。');
  assert.equal(toZhTw('复制文件并恢复默认设置，助手回复缓存异常'), '複製檔案並恢復預設設定，助手回覆快取異常');
  assert.equal(toZhTw('按实际规划 / 执行模型计价'), '按實際規劃 / 執行模型計價');
  assert.equal(formatRelativeTime(0, 30000, 'zh-TW'), '剛剛');
  assert.equal(formatRelativeTime(0, 120000, 'zh-TW'), '2 分鐘前');
  assert.equal(formatResetCountdown(7200000, 0, 'zh-TW'), '2 小時後重置');
  const html=renderAuxPaneHtml({version:'2.13.1',language:'zh-TW'});
  assert.match(html,/<html lang="zh-TW">/);
  assert.ok(html.includes('需要重啟 Antigravity 以啟用 Antigravity Max 外掛'));
  assert.ok(html.includes('檢查外掛更新'));
  // Ensure settings store accepts zh-TW
  const dir=mkdtempSync(join(tmpdir(),'agy-lang-tw-'));
  try{
    const store=createSettingsStore(dir);
    assert.equal(store.set({language:'zh-TW'}).language,'zh-TW');
    assert.equal(store.get().language,'zh-TW');
  }finally{rmSync(dir,{recursive:true,force:true});}
  // Ensure no common simplified-only glyphs remain across UI source files after toZhTw
  const simplifiedOnly=/[万与个为义于产仅从仓们价优会传体余侧关内写准减凑凭击划则刚创删务动区协单占却历压参发变号后听启周响唤围图圆场声处备头夹实审对导将尝尽层带帮并广库应开异强归当录径忆态总战执扩扬抢护报担拦择挂换据数断无旧时昵显暂机权条来栏树样档检汇没洁浅测浏滚满点热状独环现电监盘码确碍离积称稳筛签简类紧级线组细织终结给络绝统继续缓编缩网联脑范营补装观规视览触计订认让议记许设访证识诊试话询该详语误说请读调败账费资转轮软载较辅辑输边过运这进远违连迟适选遥邮采钟钥钮链销错键长闭问闲间阅队阶际险随隐静页顶项顺顿预频题额风馈驻验骤麦标彻]/;
  for(const file of ['packages/i18n/native-i18n.js','lib/native-panels.js','lib/native-ui.js','packages/workspace-nav/aux-file-tree.js','lib/sidecar-ui.mjs']){
    const converted=toZhTw(readFileSync(file,'utf8')).replace(/简体中文|批准/g,'');
    const leftover=converted.match(simplifiedOnly);
    assert.equal(leftover,null,`Unexpected simplified glyph ${leftover?.[0]} in ${file}`);
  }
});

test('Swarm UI strings translate cleanly in zh-CN and zh-TW without middle dots and protect post bodies', () => {
  const document = { nodeType: 9, createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [] };
  const context = vm.createContext({ document, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: class { observe() {} disconnect() {} }, __agyToZhTw: toZhTw });
  vm.runInContext(readFileSync('packages/i18n/native-i18n.js', 'utf8'), context);
  const t = context.__agyI18n.t;
  assert.equal(t('Board', 'zh-CN'), '讨论板');
  assert.equal(t('Board', 'zh-TW'), '討論板');
  assert.equal(t('Members', 'zh-CN'), '成员');
  assert.equal(t('Members', 'zh-TW'), '成員');
  assert.equal(t('Graph', 'zh-CN'), '关系图');
  assert.equal(t('Graph', 'zh-TW'), '關係圖');
  assert.equal(t('From anyone', 'zh-CN'), '来自任意成员');
  assert.equal(t('To anyone', 'zh-TW'), '提及任意成員');
  assert.equal(t('Hide inactive', 'zh-CN'), '隐藏非活跃');
  assert.equal(t('Export GIF', 'zh-TW'), '匯出 GIF'.replace('匯', '導'));
  assert.equal(t('No swarm in this conversation', 'zh-CN'), '当前会话暂无蜂群');
  assert.equal(t('Copy to clipboard', 'zh-TW'), '複製到剪貼簿');
  assert.equal(t('Attach to chat', 'zh-CN'), '引用到输入框');
  assert.equal(t('Attach to chat', 'zh-TW'), '引用到輸入框');
  const ovLabel = t(`overview \u00b7 from the narrator\u2019s notes`, 'zh-CN');
  assert.equal(ovLabel, '概览 - 来自旁白笔记');
  assert.equal(ovLabel.includes('\u00b7'), false);
  assert.equal(t(`overview \u00b7 from the narrator's notes`, 'zh-TW'), '概覽 - 來自旁白筆記');
  assert.equal(t('For most deep reasoning and complex problems', 'zh-CN'), '适用于深度推理与复杂问题');
  assert.equal(t('For most deep reasoning and complex problems', 'zh-TW'), '適用於深度推理與複雜問題');
  assert.equal(t('Notice', 'zh-CN'), '提示');
  assert.equal(t('Offloads routine steps to a faster executor. Same quality, fewer tokens used.', 'zh-CN'), '将常规步骤分流给更快的执行模型，保持同等质量同时减少 Token 消耗。');
  assert.equal(t('Copy Project Name', 'zh-CN'), '复制项目名称');
  assert.equal(t('Project Settings', 'zh-TW'), '專案設定');
  assert.equal(t('Reveal in Finder', 'zh-CN'), '在访达中显示');
  assert.equal(t('Reveal in Finder', 'zh-TW'), '在Finder中顯示');
  assert.equal(t('Show in File Explorer', 'zh-TW'), '在檔案總管中顯示');
  assert.equal(t('Delete Project', 'zh-CN'), '删除项目');
  assert.equal(t('Yes, allow this time', 'zh-CN'), '是，仅本次允许');
  assert.equal(t('Yes, and always allow in this conversation', 'zh-TW'), '是，並在本會話中始終允許');
  assert.equal(t('Yes, save rule globally', 'zh-CN'), '是，全局保存此规则');
  assert.equal(t('(tell the agent what to do instead)', 'zh-CN'), '（告诉智能体改用什么方式处理）');
  assert.equal(t('Yes, always allow downloads from github.com', 'zh-CN'), '是，始终允许从 github.com 下载');
  assert.equal(t('Yes, and always allow \'npm test\' in this conversation', 'zh-CN'), '是，并在本会话中始终允许 \'npm test\'');
  assert.equal(t('Thought for 14s', 'zh-CN'), '思考了 14 秒');
  assert.equal(t('Thought for 14s', 'zh-TW'), '思考了 14 秒');
  assert.equal(t('Step 2 of 5', 'zh-CN'), '第 2 / 5 步');
  assert.equal(t('Chat Layout', 'zh-TW'), '聊天佈局'.replace('佈', '布'));
  assert.equal(t('Tool Permissions', 'zh-TW'), '工具權限');
  assert.equal(t('Confirm Undo', 'zh-CN'), '确认撤回');
  assert.equal(t('Available AI Credits: 250', 'zh-CN'), '可用 AI 积分：250');
  assert.equal(t('12 tools', 'zh-TW'), '12 個工具');
  assert.equal(t('Show more (4)', 'zh-CN'), '显示更多 (4)');
  assert.equal(t('Swarm', 'zh-CN'), 'Swarm');
  assert.equal(t('Open this pane from a conversation to see its swarm. Swarms started there appear here automatically; start one with', 'zh-CN'), '请在具体会话中打开此面板以查看蜂群。该会话中启动的蜂群会自动显示在这里；输入');
  assert.equal(t('12 posts', 'zh-CN'), '12 条动态');
  assert.equal(t('4 members', 'zh-TW'), '4 名成員');
  assert.equal(t('3 of 5 tasks done', 'zh-CN'), '已完成 3 / 5 项任务');
  assert.equal(t('Waiting on @coordinator', 'zh-CN'), '等待 @coordinator');
  assert.equal(t('Working for @lead', 'zh-CN'), '正为 @lead 处理');
  assert.equal(t('@worker-1 ran out of quota', 'zh-CN'), '@worker-1 额度已耗尽');
  assert.equal(t('@worker-2 looks stuck', 'zh-TW'), '@worker-2 疑似卡住');
  assert.equal(t('Go to #14 on the Board', 'zh-CN'), '在讨论板查看 #14');
  assert.equal(t('Exporting 45%', 'zh-CN'), '正在导出 45%');
  const coordSummary = t(`Coordinator \u00b7 3 of 5 done \u00b7 Needs you`, 'zh-CN');
  assert.equal(coordSummary, '协调者 3 / 5 已完成 需要你处理');
  assert.equal(coordSummary.includes('\u00b7'), false);
  const readSummary = t(`read #12 \u00b7 updated 2m ago`, 'zh-CN');
  assert.equal(readSummary, '已读至 #12 更新于 2m ago');
  assert.equal(readSummary.includes('\u00b7'), false);
  assert.equal(t('Load older messages', 'zh-CN'), '加载更早的消息');
  assert.equal(t('Prevent sleep', 'zh-CN'), '防止休眠');
  assert.equal(t('Context and quota indicator', 'zh-TW'), '上下文與額度指示器');
  assert.equal(t('Delete Permanently', 'zh-TW'), '永久刪除');
  assert.equal(t('Archived Only', 'zh-CN'), '仅显示已归档');
  assert.equal(t('Archived Only', 'zh-TW'), '僅顯示已歸檔');
  assert.equal(t('Restore Conversation', 'zh-CN'), '还原会话');
  assert.equal(t('Restore Conversation', 'zh-TW'), '還原會話');
  const i18nSrc = readFileSync('packages/i18n/native-i18n.js', 'utf8');
  assert.ok(i18nSrc.includes('.post-body') && i18nSrc.includes('#ov-frame'));
});

test('native-i18n preserves dynamic title/placeholder updates and handles ja/yue languages and localStorage restoration', () => {
  const makeEl = (attrs = {}) => {
    const map = new Map(Object.entries(attrs));
    return {
      nodeType: 1,
      isConnected: true,
      closest: () => null,
      getAttribute: k => (map.has(k) ? map.get(k) : null),
      hasAttribute: k => map.has(k),
      setAttribute: (k, v) => { map.set(k, String(v)); },
      removeAttribute: k => { map.delete(k); }
    };
  };

  let observerCb = null;
  const copyBtn = makeEl({ title: 'Copy' });
  const searchInput = makeEl({ placeholder: 'Search' });
  const textNode = {
    nodeType: 3,
    nodeValue: 'Settings',
    isConnected: true,
    parentElement: { closest: () => null }
  };
  const body = {
    nodeType: 1,
    isConnected: true,
    closest: () => null,
    getAttribute: () => null,
    hasAttribute: () => false,
    setAttribute() {},
    removeAttribute() {},
    querySelectorAll: () => [copyBtn, searchInput]
  };
  const document = {
    nodeType: 9,
    body,
    createTreeWalker: () => {
      let done = false;
      return { nextNode: () => (done ? null : ((done = true), textNode)) };
    },
    querySelectorAll: () => [copyBtn, searchInput]
  };
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); }
  };
  const context = vm.createContext({
    document,
    localStorage,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      constructor(cb) { observerCb = cb; }
      observe() {}
      disconnect() {}
    },
    __agyToZhTw: toZhTw
  });
  vm.runInContext(readFileSync('packages/i18n/native-i18n.js', 'utf8'), context);
  const { t } = context.__agyI18n;
  const loc = context.__agyLocalization;

  // Initial zh-CN translation
  assert.equal(copyBtn.getAttribute('title'), '复制');
  assert.equal(searchInput.getAttribute('placeholder'), '搜索');
  assert.equal(textNode.nodeValue, '设置');

  // External React update: title changes from "Copy" -> "Copied"
  copyBtn.setAttribute('title', 'Copied');
  observerCb([{ type: 'attributes', target: copyBtn, attributeName: 'title' }]);
  assert.equal(copyBtn.getAttribute('title'), '已复制');
  assert.equal(copyBtn.getAttribute('data-agy-original-title'), 'Copied');

  // External React update: title changes to untranslated dynamic string
  copyBtn.setAttribute('title', 'Copy /tmp/demo.txt');
  observerCb([{ type: 'attributes', target: copyBtn, attributeName: 'title' }]);
  assert.equal(copyBtn.getAttribute('title'), 'Copy /tmp/demo.txt');
  assert.equal(copyBtn.hasAttribute('data-agy-original-title'), false);

  // External React update: placeholder changes from "Search" -> "Search conversations..."
  searchInput.setAttribute('placeholder', 'Search conversations...');
  observerCb([{ type: 'attributes', target: searchInput, attributeName: 'placeholder' }]);
  assert.equal(searchInput.getAttribute('placeholder'), '搜索会话…');

  // ja acts as English passthrough in t(), textNode(), and attributes()
  assert.equal(t('Settings', 'ja'), 'Settings');
  assert.equal(t('输入', 'ja'), 'Input');
  loc.apply('ja');
  assert.equal(textNode.nodeValue, 'Settings');
  assert.equal(searchInput.getAttribute('placeholder'), 'Search conversations...');
  assert.equal(store.get('agy-powertools-language'), 'ja');

  // yue uses Traditional Chinese mapping in t(), textNode(), and attributes()
  assert.equal(t('Settings', 'yue'), '設定');
  assert.equal(t('Open File', 'yue'), '開啟檔案');
  loc.apply('yue');
  assert.equal(textNode.nodeValue, '設定');
  assert.equal(searchInput.getAttribute('placeholder'), '搜尋會話…');
  assert.equal(store.get('agy-powertools-language'), 'yue');

  loc.dispose();
  assert.equal(textNode.nodeValue, 'Settings');
  assert.equal(searchInput.getAttribute('placeholder'), 'Search conversations...');
  assert.equal(searchInput.hasAttribute('data-agy-original-placeholder'), false);

  // Re-initialize from localStorage restores both 'ja' and 'yue'
  for (const savedLang of ['ja', 'yue']) {
    store.set('agy-powertools-language', savedLang);
    const freshCtx = vm.createContext({
      document,
      localStorage,
      NodeFilter: { SHOW_TEXT: 4 },
      MutationObserver: class { observe() {} disconnect() {} },
      __agyToZhTw: toZhTw
    });
    vm.runInContext(readFileSync('packages/i18n/native-i18n.js', 'utf8'), freshCtx);
    assert.equal(freshCtx.__agyLocalization.language, savedLang);
    freshCtx.__agyLocalization.dispose();
  }
});

test('localizer leaves sidebar conversation titles (user content) untranslated', () => {
  const node = (value, matches = []) => ({ nodeValue: value, parentElement: { closest: sel => matches.some(m => sel.split(',').includes(m)) ? {} : null } });
  const nodes = [node('Details for x.md', ['[data-testid="conversation-title"]']), node('Settings', ['a[href^="/c/"] .truncate']), node('Details for x.md', ['[data-testid="conversation-row-sidebar"] .truncate']), node('Details for x.md')];
  const document = { nodeType: 9, body: { nodeType: 1, getAttribute: () => null, closest: () => null, querySelectorAll: () => [] }, createTreeWalker: () => { let i = 0; return { nextNode: () => nodes[i++] || null }; }, querySelectorAll: () => [] };
  const context = vm.createContext({ document, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: class { observe() {} disconnect() {} }, __agyToZhTw: toZhTw });
  vm.runInContext(readFileSync('packages/i18n/native-i18n.js', 'utf8'), context);
  const loc = context.__agyI18n.localizer();
  loc.apply('zh-CN', true);
  assert.deepEqual(nodes.map(n => n.nodeValue), ['Details for x.md', 'Settings', 'Details for x.md', 'x.md 详情']);
  loc.dispose();
});

test('localizer leaves code editors, diff viewers and terminals untranslated', () => {
  const node = (value, matches = []) => ({ nodeValue: value, parentElement: { closest: sel => matches.some(m => sel.split(',').includes(m)) ? {} : null } });
  const nodes = [node('Settings', ['.monaco-editor']), node('Settings', ['.monaco-diff-editor']), node('Settings', ['[data-testid*="diff"]']), node('Settings', ['.xterm']), node('Settings', ['.view-lines']), node('Settings')];
  const document = { nodeType: 9, body: { nodeType: 1, getAttribute: () => null, closest: () => null, querySelectorAll: () => [] }, createTreeWalker: () => { let i = 0; return { nextNode: () => nodes[i++] || null }; }, querySelectorAll: () => [] };
  const context = vm.createContext({ document, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: class { observe() {} disconnect() {} }, __agyToZhTw: toZhTw });
  vm.runInContext(readFileSync('packages/i18n/native-i18n.js', 'utf8'), context);
  const loc = context.__agyI18n.localizer();
  loc.apply('zh-CN', true);
  assert.deepEqual(nodes.map(n => n.nodeValue), ['Settings', 'Settings', 'Settings', 'Settings', 'Settings', '设置']);
  loc.dispose();
});

test('marketplace dynamic translation batches descriptions on /customizations, preserves plugin names, and toggles zh-CN/zh-TW/en losslessly', async () => {
  const makeNode = (value, { className = '', matches = [], fontWeight = '400', attrs = {} } = {}) => {
    const attrMap = new Map(Object.entries(attrs));
    const el = {
      nodeType: 1,
      className,
      childElementCount: 0,
      isConnected: true,
      closest: sel => matches.some(m => sel.split(',').map(s => s.trim()).includes(m)) ? {} : null,
      getAttribute: k => (attrMap.has(k) ? attrMap.get(k) : null),
      hasAttribute: k => attrMap.has(k),
      setAttribute: (k, v) => { attrMap.set(k, String(v)); },
      removeAttribute: k => { attrMap.delete(k); },
      __fontWeight: fontWeight
    };
    return { nodeType: 3, nodeValue: value, isConnected: true, parentElement: el };
  };

  // Static shelf headers + dynamic plugin titles + dynamic descriptions
  const shelfFeatured = makeNode('Featured');
  const shelfDevTools = makeNode('Developer Tools');
  const shelfProdDesc = makeNode('Plan work, track issues, sign documents, and manage your notes and files.', { className: 'text-muted-foreground' });
  const titleContext7 = makeNode('Context7', { className: 'font-semibold' });
  const titleGoogleDocs = makeNode('Google Docs', { className: 'text-sm' });
  const titleAtlassian = makeNode('Atlassian Teamwork Graph CLI', { className: 'text-sm' });
  const publisherSlug = makeNode('By antigravity-plugins-official', { className: 'text-muted-foreground' });
  const sidebarChatTitle = makeNode('Fix production authentication flow now.', { matches: ['aside'] });
  const descDocs = makeNode('Read, draft, and edit docs.', { className: 'text-xs text-muted-foreground' });
  const descNewPlugin = makeNode('Query live traces, evaluate prompts, and monitor production agents.', { className: 'text-xs text-muted-foreground' });
  const descTruncated = makeNode('Build applications and shell workflows with the ...', { className: 'text-xs text-muted-foreground' });
  const descAlreadyZh = makeNode('飞书多维表格操作：建表、字段、记录与视图管理。', { className: 'text-xs text-muted-foreground' });

  const allNodes = [
    shelfFeatured, shelfDevTools, shelfProdDesc,
    titleContext7, titleGoogleDocs, titleAtlassian, publisherSlug, sidebarChatTitle,
    descDocs, descNewPlugin, descTruncated, descAlreadyZh
  ];

  const storage = new Map();
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); }
  };
  const location = { pathname: '/customizations' };
  const document = {
    nodeType: 9,
    body: { nodeType: 1, getAttribute: () => null, closest: () => null, querySelectorAll: () => [] },
    createTreeWalker: () => {
      let idx = 0;
      return { nextNode: () => allNodes[idx++] || null };
    },
    querySelectorAll: () => []
  };

  const batchCalls = [];
  const context = vm.createContext({
    document,
    location,
    localStorage,
    setTimeout,
    clearTimeout,
    getComputedStyle: el => ({ fontWeight: el.__fontWeight || '400' }),
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    __agyToZhTw: toZhTw
  });
  vm.runInContext(readFileSync('packages/i18n/native-i18n.js', 'utf8'), context);
  const loc = context.__agyLocalization;

  // Static dictionary items translated immediately in 0ms
  assert.equal(shelfFeatured.nodeValue, '精选推荐');
  assert.equal(shelfDevTools.nodeValue, '开发者工具');
  assert.equal(shelfProdDesc.nodeValue, '规划工作、跟踪问题、签署文档，并管理笔记与文件。');

  // Wire dynamic batch translator
  loc.configureMarketplace({
    enabled: true,
    translateBatch: async texts => {
      batchCalls.push([...texts]);
      return {
        ok: true,
        translations: {
          'Read, draft, and edit docs.': '阅读、起草和编辑文档。',
          'Query live traces, evaluate prompts, and monitor production agents.': '查询实时链路追踪、评估提示词并监控生产环境插件。',
          'Build applications and shell workflows with the ...': '使用该平台构建应用程序与 Shell 工作流…'
        }
      };
    }
  });

  await new Promise(r => setTimeout(r, 90));

  // Only the 3 real English descriptions were sent in 1 single batch call
  assert.equal(batchCalls.length, 1);
  assert.deepEqual(batchCalls[0].sort(), [
    'Build applications and shell workflows with the ...',
    'Query live traces, evaluate prompts, and monitor production agents.',
    'Read, draft, and edit docs.'
  ]);

  // Plugin names, publisher slug, sidebar, and already-Chinese skill remain untouched
  assert.equal(titleContext7.nodeValue, 'Context7');
  assert.equal(titleGoogleDocs.nodeValue, 'Google Docs');
  assert.equal(titleAtlassian.nodeValue, 'Atlassian Teamwork Graph CLI');
  assert.equal(publisherSlug.nodeValue, 'By antigravity-plugins-official');
  assert.equal(sidebarChatTitle.nodeValue, 'Fix production authentication flow now.');
  assert.equal(descAlreadyZh.nodeValue, '飞书多维表格操作：建表、字段、记录与视图管理。');

  // Dynamic descriptions translated + original English preserved as hover tooltip
  assert.equal(descDocs.nodeValue, '阅读、起草和编辑文档。');
  assert.equal(descDocs.parentElement.getAttribute('title'), 'Read, draft, and edit docs.');
  assert.equal(descNewPlugin.nodeValue, '查询实时链路追踪、评估提示词并监控生产环境插件。');
  assert.equal(descTruncated.nodeValue, '使用该平台构建应用程序与 Shell 工作流…');

  // Switch to Traditional Chinese (zh-TW): converts both static and dynamic in 0ms without extra RPC
  loc.apply('zh-TW');
  assert.equal(batchCalls.length, 1);
  assert.equal(shelfFeatured.nodeValue, '精選推薦');
  assert.equal(shelfProdDesc.nodeValue, '規劃工作、跟蹤問題、簽署文檔，並管理筆記與檔案。');
  assert.equal(descNewPlugin.nodeValue, '查詢實時鏈路追蹤、評估提示詞並監控生產環境外掛。');

  // Foreign user switches to English (en): restores exact original English & removes hover tooltip in 0ms
  loc.apply('en');
  assert.equal(batchCalls.length, 1);
  assert.equal(shelfFeatured.nodeValue, 'Featured');
  assert.equal(descDocs.nodeValue, 'Read, draft, and edit docs.');
  assert.equal(descDocs.parentElement.hasAttribute('title'), false);
  assert.equal(descNewPlugin.nodeValue, 'Query live traces, evaluate prompts, and monitor production agents.');

  // Switch back to Simplified Chinese (zh-CN): instant memory cache hit, 0 extra RPC
  loc.apply('zh-CN');
  assert.equal(batchCalls.length, 1);
  assert.equal(descDocs.nodeValue, '阅读、起草和编辑文档。');

  // Independent toggle off keeps static UI Chinese ("精选推荐") while restoring dynamic descriptions to English
  loc.configureMarketplace({ enabled: false });
  assert.equal(shelfFeatured.nodeValue, '精选推荐');
  assert.equal(descDocs.nodeValue, 'Read, draft, and edit docs.');
  assert.equal(descDocs.parentElement.hasAttribute('title'), false);

  loc.dispose();
});

test('marketplace translation works inside data-testid="sidebar-split" > .agy-sheet and plugin detail markdown while skipping <title> and left sidebar', async () => {
  const makeSheetNode = (value, { inSheet = true, inSidebar = false, inTitle = false, inMarkdownP = false, inCardTitleLink = false, className = '' } = {}) => {
    const attrMap = new Map();
    const el = {
      nodeType: 1,
      className,
      childElementCount: inMarkdownP ? 1 : 0,
      isConnected: true,
      closest: sel => {
        const parts = sel.split(',').map(s => s.trim());
        if (inTitle && (parts.includes('title') || parts.includes('head'))) return {};
        if (inSidebar && (parts.includes('[data-testid="sidebar-navigation-items"]') || parts.includes('[data-testid="conversation-row-sidebar"]'))) return {};
        if (inCardTitleLink && parts.includes('[data-testid="customization-card"] a')) return {};
        if (inSheet && parts.includes('.agy-sheet')) return {};
        if (inMarkdownP && (parts.includes('[data-markdown-root]') || parts.includes('p'))) return {};
        if (parts.includes('[data-testid*="sidebar"]')) return {}; // Simulates outer sidebar-split wrapper!
        return null;
      },
      getAttribute: k => (attrMap.has(k) ? attrMap.get(k) : null),
      hasAttribute: k => attrMap.has(k),
      setAttribute: (k, v) => { attrMap.set(k, String(v)); },
      removeAttribute: k => { attrMap.delete(k); }
    };
    return { nodeType: 3, nodeValue: value, isConnected: true, parentElement: el };
  };

  const docTitle = makeSheetNode('(1) Antigravity', { inSheet: false, inTitle: true });
  const leftSidebarRow = makeSheetNode('Investigate cloud risk from your IDE', { inSheet: false, inSidebar: true });
  const lowercasePluginLinkTitle = makeSheetNode('cobrief procurement helper', { inSheet: true, inCardTitleLink: true });
  const cardLookerDesc = makeSheetNode('Connect to your managed Looker MCP server to explore data.', { inSheet: true, className: 'text-sm text-muted-foreground truncate' });
  const detailReadmeProse = makeSheetNode('Pull version-specific documentation and code examples directly into ', { inSheet: true, inMarkdownP: true });
  const seeMoreShelf = makeSheetNode('See more in Developer Tools', { inSheet: true });

  const allNodes = [docTitle, leftSidebarRow, lowercasePluginLinkTitle, cardLookerDesc, detailReadmeProse, seeMoreShelf];
  const document = {
    nodeType: 9,
    body: { nodeType: 1, getAttribute: () => null, closest: () => null, querySelectorAll: () => [] },
    querySelector: sel => (sel.includes('.agy-sheet') ? {} : null),
    createTreeWalker: () => {
      let idx = 0;
      return { nextNode: () => allNodes[idx++] || null };
    },
    querySelectorAll: () => []
  };

  const batchCalls = [];
  const context = vm.createContext({
    document,
    location: { pathname: '/customizations/marketplaces/google3/plugins/looker' },
    setTimeout,
    clearTimeout,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    __agyToZhTw: toZhTw
  });
  vm.runInContext(readFileSync('packages/i18n/native-i18n.js', 'utf8'), context);
  const loc = context.__agyLocalization;

  assert.equal(seeMoreShelf.nodeValue, '查看更多 开发者工具');

  loc.configureMarketplace({
    enabled: true,
    translateBatch: async texts => {
      batchCalls.push([...texts]);
      return {
        ok: true,
        translations: {
          'Connect to your managed Looker MCP server to explore data.': '连接到托管的 Looker MCP 服务器以探索数据。',
          'Pull version-specific documentation and code examples directly into': '直接将特定版本的文档与代码示例拉取到'
        }
      };
    }
  });

  await new Promise(r => setTimeout(r, 90));

  assert.equal(batchCalls.length, 1);
  assert.equal(docTitle.nodeValue, '(1) Antigravity');
  assert.equal(leftSidebarRow.nodeValue, 'Investigate cloud risk from your IDE');
  assert.equal(lowercasePluginLinkTitle.nodeValue, 'cobrief procurement helper');
  assert.equal(cardLookerDesc.nodeValue, '连接到托管的 Looker MCP 服务器以探索数据。');
  assert.equal(detailReadmeProse.nodeValue, '直接将特定版本的文档与代码示例拉取到 ');
  loc.dispose();
});

test('plugin detail translates suggested prompt buttons, skill row descriptions, and footer disclaimer while preserving slash commands and MCP CLI args', async () => {
  const makeDetailNode = (value, { className = '', inPromptBtn = false, inGenericBtn = false, isDocRowTitle = false, isDisclaimer = false } = {}) => {
    const attrMap = new Map();
    const promptBtnObj = { matches: sel => sel === '[data-testid="plugin-suggested-prompt-row"]' };
    const genericBtnObj = { matches: () => false };
    const el = {
      nodeType: 1,
      className,
      childElementCount: isDisclaimer ? 1 : 0,
      isConnected: true,
      matches: sel => (isDisclaimer && sel === '[data-testid="third-party-tools-disclaimer"]'),
      closest: sel => {
        const parts = sel.split(',').map(s => s.trim());
        if (isDocRowTitle && parts.includes('[data-testid="doc-row-title"]')) return {};
        if (parts.includes('.agy-sheet')) return {};
        if (parts.includes('button') || parts.includes('[role="button"]')) {
          if (inPromptBtn) return promptBtnObj;
          if (inGenericBtn) return genericBtnObj;
        }
        return null;
      },
      getAttribute: k => (attrMap.has(k) ? attrMap.get(k) : null),
      hasAttribute: k => attrMap.has(k),
      setAttribute: (k, v) => { attrMap.set(k, String(v)); },
      removeAttribute: k => { attrMap.delete(k); }
    };
    return { nodeType: 3, nodeValue: value, isConnected: true, parentElement: el };
  };

  const suggestedPrompt = makeDetailNode('Resize this Canva design for Instagram and LinkedIn', { className: 'text-foreground min-w-0 flex-1', inPromptBtn: true });
  const skillSlug = makeDetailNode('/canva-brand-check', { className: 'font-medium text-foreground', inGenericBtn: true, isDocRowTitle: true });
  const skillDesc = makeDetailNode('Check a Canva design against a brand kit and report where it diverges.', { className: 'text-muted-foreground truncate', inGenericBtn: true });
  const mcpCmd = makeDetailNode('npx -y @canva/cli-mcp --port 3000', { className: 'text-muted-foreground truncate' });
  const actionBtn = makeDetailNode('Sign in to Canva account', { className: 'agy-button', inGenericBtn: true });
  const stdDisclaimer = makeDetailNode('Google does not control the availability or functionality of third party developer tools. Your data from third party developer tools connected to your Antigravity instance may be shared with Google. Google will protect any such data in accordance with the Google Privacy Policy, found here: ', { className: 'text-sm text-muted-foreground', isDisclaimer: true });

  const allNodes = [suggestedPrompt, skillSlug, skillDesc, mcpCmd, actionBtn, stdDisclaimer];
  const document = {
    nodeType: 9,
    body: { nodeType: 1, getAttribute: () => null, closest: () => null, querySelectorAll: () => [] },
    querySelector: sel => (sel.includes('.agy-sheet') ? {} : null),
    createTreeWalker: () => {
      let idx = 0;
      return { nextNode: () => allNodes[idx++] || null };
    },
    querySelectorAll: () => []
  };

  const batchCalls = [];
  const context = vm.createContext({
    document,
    location: { pathname: '/customizations/marketplaces/google3/plugins/canva' },
    setTimeout,
    clearTimeout,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    __agyToZhTw: toZhTw
  });
  vm.runInContext(readFileSync('packages/i18n/native-i18n.js', 'utf8'), context);
  const loc = context.__agyLocalization;

  assert.ok(stdDisclaimer.nodeValue.startsWith('Google 不控制第三方开发者工具的可用性或功能。'));
  assert.ok(stdDisclaimer.nodeValue.endsWith(' '));

  loc.configureMarketplace({
    enabled: true,
    translateBatch: async texts => {
      batchCalls.push([...texts]);
      return {
        ok: true,
        translations: {
          'Resize this Canva design for Instagram and LinkedIn': '针对 Instagram 和 LinkedIn 调整此 Canva 设计的尺寸',
          'Check a Canva design against a brand kit and report where it diverges.': '对照品牌规范检查 Canva 设计并报告不一致之处。'
        }
      };
    }
  });

  await new Promise(r => setTimeout(r, 90));

  assert.equal(batchCalls.length, 1);
  assert.deepEqual(batchCalls[0].sort(), [
    'Check a Canva design against a brand kit and report where it diverges.',
    'Resize this Canva design for Instagram and LinkedIn'
  ]);
  assert.equal(suggestedPrompt.nodeValue, '针对 Instagram 和 LinkedIn 调整此 Canva 设计的尺寸');
  assert.equal(skillSlug.nodeValue, '/canva-brand-check');
  assert.equal(skillDesc.nodeValue, '对照品牌规范检查 Canva 设计并报告不一致之处。');
  assert.equal(mcpCmd.nodeValue, 'npx -y @canva/cli-mcp --port 3000');
  assert.equal(actionBtn.nodeValue, 'Sign in to Canva account');
  loc.dispose();
});
