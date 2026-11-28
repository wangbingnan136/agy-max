import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const betaAiSource = readFileSync(new URL('../packages/chat-flow/native-beta-ai.js', import.meta.url), 'utf8');
const panelsSource = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
const prismPanelsSource = readFileSync(new URL('../lib/prism-panels.js', import.meta.url), 'utf8');
const nativeUiSource = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');

function createMiniDom() {
  const listeners = new Map();
  const makeEl = (tag = 'div', attrs = {}) => {
    const attrMap = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      style: {},
      className: attrs.class || '',
      children: [],
      childNodes: [],
      parentElement: null,
      isConnected: true,
      _text: '',
      get textContent() {
        if (this.childNodes.length === 0) return this._text;
        return this.childNodes.map(c => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
      },
      set textContent(v) {
        this._text = String(v ?? '');
        this.children.length = 0;
        this.childNodes.length = 0;
      },
      get firstChild() { return this.childNodes[0] || null; },
      get nextSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.childNodes.indexOf(this);
        return idx >= 0 ? (this.parentElement.childNodes[idx + 1] || null) : null;
      },
      get nextElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx >= 0 ? (this.parentElement.children[idx + 1] || null) : null;
      },
      setAttribute(k, v) {
        if (k === 'class') this.className = String(v);
        attrMap.set(k, String(v));
      },
      getAttribute(k) { return attrMap.has(k) ? attrMap.get(k) : null; },
      hasAttribute(k) { return attrMap.has(k); },
      removeAttribute(k) { attrMap.delete(k); },
      appendChild(child) {
        if (child.parentElement) child.remove();
        child.parentElement = this;
        child.ownerDocument = doc;
        child.isConnected = this.isConnected;
        this.childNodes.push(child);
        if (child.nodeType === 1) this.children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        if (!ref) return this.appendChild(child);
        if (child.parentElement) child.remove();
        child.parentElement = this;
        child.ownerDocument = doc;
        child.isConnected = this.isConnected;
        const cIdx = this.childNodes.indexOf(ref);
        if (cIdx >= 0) this.childNodes.splice(cIdx, 0, child);
        else this.childNodes.push(child);
        if (child.nodeType === 1) {
          const eIdx = this.children.indexOf(ref);
          if (eIdx >= 0) this.children.splice(eIdx, 0, child);
          else this.children.push(child);
        }
        return child;
      },
      removeChild(child) {
        const ci = this.childNodes.indexOf(child);
        if (ci >= 0) this.childNodes.splice(ci, 1);
        const ei = this.children.indexOf(child);
        if (ei >= 0) this.children.splice(ei, 1);
        child.parentElement = null;
        child.isConnected = false;
        return child;
      },
      remove() {
        if (this.parentElement) this.parentElement.removeChild(this);
        this.isConnected = false;
      },
      contains(other) {
        for (let cur = other; cur; cur = cur.parentElement) {
          if (cur === this) return true;
        }
        return false;
      },
      matches(sel) {
        return String(sel).split(',').map(s => s.trim()).filter(Boolean).some(part => matchSingle(this, part));
      },
      closest(sel) {
        for (let cur = this; cur; cur = cur.parentElement) {
          if (cur.nodeType === 1 && cur.matches(sel)) return cur;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = node => {
          for (const ch of node.children) {
            if (ch.matches(sel)) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      addEventListener(type, fn) {
        if (!this._ev) this._ev = new Map();
        if (!this._ev.has(type)) this._ev.set(type, []);
        this._ev.get(type).push(fn);
      },
      dispatchEvent(evt) {
        const list = this._ev?.get(evt.type) || [];
        for (const fn of list) fn(evt);
        return true;
      }
    };
    return el;
  };

  function matchSimpleAtom(el, atom) {
    if (!atom) return false;
    if (atom === '*') return true;
    let rest = atom;
    const tagMatch = rest.match(/^[a-zA-Z0-9-]+/);
    if (tagMatch) {
      if (el.tagName !== tagMatch[0].toUpperCase()) return false;
      rest = rest.slice(tagMatch[0].length);
    }
    for (const cls of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      const classes = String(el.className || '').split(/\s+/);
      if (!classes.includes(cls[1])) return false;
    }
    for (const attr of rest.matchAll(/\[([a-zA-Z0-9_-]+)(?:(\*=|=)"([^"]*)")?\]/g)) {
      const [, name, op, val] = attr;
      if (!op) {
        if (!el.hasAttribute(name)) return false;
      } else if (op === '=') {
        if (el.getAttribute(name) !== val) return false;
      } else if (op === '*=') {
        if (!String(el.getAttribute(name) || '').includes(val)) return false;
      }
    }
    return true;
  }

  function matchSingle(el, part) {
    if (part.includes(' ')) {
      const segs = part.split(/\s+/).filter(Boolean);
      if (!matchSimpleAtom(el, segs.at(-1))) return false;
      let cur = el.parentElement;
      for (let i = segs.length - 2; i >= 0; i--) {
        while (cur && !matchSimpleAtom(cur, segs[i])) cur = cur.parentElement;
        if (!cur) return false;
        cur = cur.parentElement;
      }
      return true;
    }
    return matchSimpleAtom(el, part);
  }

  const head = makeEl('head');
  const body = makeEl('body');
  const doc = {
    head,
    body,
    documentElement: makeEl('html'),
    activeElement: null,
    createElement: tag => makeEl(tag),
    createTextNode: value => ({ nodeType: 3, nodeValue: String(value ?? ''), parentElement: null, remove() {} }),
    querySelectorAll: sel => [...head.querySelectorAll(sel), ...body.querySelectorAll(sel)],
    querySelector: sel => head.querySelector(sel) || body.querySelector(sel),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    fire(type, evt) {
      for (const fn of [...(listeners.get(type) || [])]) fn(evt);
    }
  };
  head.ownerDocument = doc;
  body.ownerDocument = doc;
  return { doc, makeEl };
}

test('native-beta-ai translates thinking blocks without touching responses, and suppresses ghost text when inline image chips or convo-drop are active', async () => {
  const { doc, makeEl } = createMiniDom();
  const ctx = vm.createContext({ document: doc, console, setTimeout, clearTimeout });
  vm.runInContext(betaAiSource, ctx);

  // Build conversation view with 1 user turn, 1 agent response + thinking collapsible, and 1 composer
  const convView = makeEl('div', { 'data-testid': 'conversation-view' });
  const userStep = makeEl('div', { 'data-testid': 'user-input-step' });
  const userBubble = makeEl('div', { 'data-testid': 'user-message-bubble' });
  userBubble.textContent = '帮我检查代理模块';
  userStep.appendChild(userBubble);

  const agentResp = makeEl('div', { 'data-testid': 'agent-response' });
  const thinkWrap = makeEl('div');
  const thinkTrigger = makeEl('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' });
  thinkTrigger.textContent = 'Thought for 3s';
  const thinkBody = makeEl('div');
  const thinkMd = makeEl('div', { 'data-markdown-root': 'true' });
  const thinkP = makeEl('p');
  thinkP.textContent = 'Checking proxy socket state before retrying.';
  thinkMd.appendChild(thinkP);
  thinkBody.appendChild(thinkMd);
  thinkWrap.appendChild(thinkTrigger);
  thinkWrap.appendChild(thinkBody);

  const answerText = makeEl('div', { 'data-testid': 'planner-response-text' });
  answerText.textContent = '代理模块检查完毕。';
  agentResp.appendChild(thinkWrap);
  agentResp.appendChild(answerText);

  const composerCard = makeEl('div', { class: 'surface-composer-card' });
  const editorWrap = makeEl('div', { 'data-testid': 'agent-input-box' });
  const editor = makeEl('div', { contenteditable: 'true', role: 'textbox' });
  editorWrap.appendChild(editor);
  composerCard.appendChild(editorWrap);

  convView.appendChild(userStep);
  convView.appendChild(agentResp);
  convView.appendChild(composerCard);
  doc.body.appendChild(convView);

  let opts = {
    enabled: true,
    language: 'zh-CN',
    betaThinkingTranslate: true,
    betaThinkingEngine: 'free',
    betaThinkingDisplay: 'replace',
    betaThinkingTrigger: 'auto',
    betaComposerPredict: true,
    betaAiModel: 'prov_1::gpt-4o-mini'
  };
  let running = true;
  let insertedByAdapter = '';
  const rpcCalls = [];

  const ctrl = ctx.__agyBetaAi.mountBetaAi({
    document: doc,
    window: { getComputedStyle: () => ({ display: 'block', fontSize: '14px' }), setTimeout, clearTimeout },
    adapter: { setComposerText(_target, text) { insertedByAdapter = text; editor.textContent = text; } },
    options: () => opts,
    currentId: () => 'conv-1',
    isTurnRunning: () => running,
    request: async (method, payload) => {
      rpcCalls.push({ method, payload });
      if (method === 'beta.translateThinking') {
        ctx.__agyBetaTranslateDelta?.(payload.reqId, '正在检查代理嵌套状态…');
        return { ok: true, text: '正在重试前检查代理套接字状态。', engineUsed: 'free' };
      }
      if (method === 'beta.predictIntent') {
        return { ok: true, suggestion: '顺便把单元测试跑一下' };
      }
      return { ok: true };
    }
  });

  // Wait for async translation RPC
  await new Promise(r => setTimeout(r, 25));

  // Stylesheet includes studio placeholder suppression rule
  const styleText = doc.head.children[0]?.textContent || '';
  assert.ok(styleText.includes('[data-placeholder]::after{opacity:0!important;content:none!important}'));

  // Thinking block is translated, while agent final response is completely untouched
  const translatedRoot = thinkBody.querySelector('[data-agy-translate-root="thinking"]');
  assert.ok(translatedRoot, 'expected thinking translation root');
  assert.ok(translatedRoot.textContent.includes('正在重试前检查代理套接字状态。'));
  assert.equal(answerText.textContent, '代理模块检查完毕。');

  // Guard 1: If an inline image chip is inside editor, finishing turn MUST NOT show ghost text
  const chip = makeEl('span', { class: 'agy-inline-img-chip' });
  chip.textContent = '图片 1';
  editor.appendChild(chip);
  running = false;
  ctrl.sync();
  await new Promise(r => setTimeout(r, 25));
  assert.equal(doc.body.querySelector('[data-testid="agy-composer-ghost-text"]'), null);

  // Guard 2: Remove chip, trigger user-focus prediction -> mounts ghost text -> Tab accepts via adapter without auto-sending
  chip.remove();
  doc.activeElement = editor;
  doc.fire('pointerdown', { button: 0, target: editor, isTrusted: true });
  await new Promise(r => setTimeout(r, 25));
  const ghost = doc.body.querySelector('[data-testid="agy-composer-ghost-text"]');
  assert.ok(ghost, 'expected ghost overlay on empty composer');
  assert.equal(ghost.getAttribute('data-agy-ghost-phase'), 'ready');
  assert.ok(ghost.textContent.includes('顺便把单元测试跑一下'));

  let prevented = false;
  doc.fire('keydown', {
    key: 'Tab',
    target: editor,
    isTrusted: true,
    preventDefault() { prevented = true; },
    stopPropagation() {}
  });
  assert.equal(prevented, true);
  assert.equal(insertedByAdapter, '顺便把单元测试跑一下');
  assert.equal(doc.body.querySelector('[data-testid="agy-composer-ghost-text"]'), null);

  ctrl.dispose();
  assert.equal(thinkBody.querySelector('[data-agy-translate-root="thinking"]'), null);
});

test('Settings & Page persist tab memory in localStorage, render 4-protocol AI provider settings with zero middle dots, and native-ui pins Overview & renders Md3WavyBar', async () => {
  const storage = new Map();
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  };

  // State-capable mini React harness for panels testing
  let states = [];
  let cursor = 0;
  const h = (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false)
  });
  const R = {
    Fragment: Symbol('Fragment'),
    createElement: h,
    useState(init) {
      const idx = cursor++;
      if (!(idx in states)) states[idx] = typeof init === 'function' ? init() : init;
      const set = next => { states[idx] = typeof next === 'function' ? next(states[idx]) : next; };
      return [states[idx], set];
    },
    useEffect() {},
    useRef: v => ({ current: v }),
    useMemo: fn => fn(),
    useId: () => 'id-1',
    useSyncExternalStore: (_sub, get) => get()
  };
  const renderTree = (Comp, props = {}) => {
    cursor = 0;
    const node = Comp(props);
    return expand(node);
  };
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') {
      return expand(node.type({ ...(node.props || {}), children: node.children }));
    }
    return { ...node, children: (node.children || []).map(expand) };
  };
  const collectText = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(collectText).join(' ');
    return (node.children || []).map(collectText).join(' ');
  };
  const findByTestId = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) { const f = findByTestId(item, id); if (f) return f; }
      return null;
    }
    if (node.props?.['data-testid'] === id) return node;
    for (const ch of node.children || []) {
      const f = findByTestId(ch, id);
      if (f) return f;
    }
    return null;
  };

  const SimpleWrap = ({ children, ...rest }) => h('div', rest, ...(Array.isArray(children) ? children : [children]));
  const panelCtx = vm.createContext({
    React: R,
    localStorage,
    document: { head: { append() {} }, createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, remove() {} }) },
    HC: SimpleWrap, IC: SimpleWrap, JC: SimpleWrap, KC: SimpleWrap, GC: SimpleWrap,
    Uy: ({ children, ...p }) => h('button', p, ...(Array.isArray(children) ? children : [children])),
    XP: p => h('input', { type: 'checkbox', ...p }),
    UP: ({ label, description, rightElement, ...p }) => h('div', p, label, description, rightElement),
    TP: SimpleWrap, VP: SimpleWrap,
    dq: ({ name }) => h('span', null, name),
    k0: SimpleWrap, Sy: SimpleWrap,
    kT: SimpleWrap, lT: SimpleWrap, mT: SimpleWrap, nT: SimpleWrap
  });
  vm.runInContext(prismPanelsSource, panelCtx);
  vm.runInContext(panelsSource, panelCtx);

  let curOpts = {
    enabled: true,
    language: 'zh-CN',
    sessionSearch: true,
    composerQuota: true,
    composerQuotaWindow: 'auto',
    composerIndicatorTone: 'muted',
    composerIndicatorCompact: true,
    pinOverview: true,
    betaThinkingTranslate: true,
    betaThinkingEngine: 'free',
    betaThinkingDisplay: 'bilingual',
    betaThinkingTrigger: 'auto',
    betaComposerPredict: true
  };
  const changes = [];
  const makePanels = () => panelCtx.__agyPanels({
    t: s => s,
    version: '1.4.3',
    defaults: curOpts,
    hasModuleCenter: true,
    hasModule: () => true,
    activeModuleCount: () => 8,
    modules: () => [],
    options: () => curOpts,
    state: () => ({ contextWindow: { maxTokens: 200000 } }),
    dashboard: () => null,
    account: () => null,
    estimates: () => [],
    settingsError: () => '',
    change: patch => { changes.push(patch); curOpts = { ...curOpts, ...patch }; },
    loadDashboard: async () => {},
    betaProviders: () => [{ id: 'prov_1', name: 'My Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', models: ['claude-3-5-haiku'] }],
    subscribe: () => () => {},
    revision: () => 1
  });

  // 1. Page & Settings remember last active tab across fresh instances via localStorage
  storage.set('agy-max:page-tab', 'settings');
  storage.set('agy-max:settings-cat', 'thought');
  states = [];
  const p1 = makePanels();
  const pageTree = renderTree(p1.Page);
  assert.ok(findByTestId(pageTree, 'agy-beta-ai-settings'), 'restored settings -> thought (AI Assist) directly from localStorage');
  assert.ok(findByTestId(pageTree, 'agy-ai-providers-list'), 'rendered saved Anthropic provider row');
  assert.equal(collectText(pageTree).includes('\u00b7'), false, 'must never contain middle dot separator');

  // Telemetry category exposes quiet/compact composer controls & quota window selector
  storage.set('agy-max:settings-cat', 'telemetry');
  states = [];
  const p2 = makePanels();
  const telTree = renderTree(p2.Settings);
  assert.ok(findByTestId(telTree, 'agy-setting-row-composerIndicatorTone'));
  assert.ok(findByTestId(telTree, 'agy-setting-row-composerIndicatorCompact'));
  assert.ok(findByTestId(telTree, 'agy-setting-row-composerQuota'));
  assert.ok(findByTestId(telTree, 'agy-setting-row-composerQuotaWindow'));

  // 2. Verify native-ui.js pinOverview narrow-window breakpoint override & Md3WavyBar quota trigger
  let overviewBp = 'small';
  const callbacks = new Map();
  const mounted = [];
  const customizeTrigger = { isConnected: true, parentElement: { insertBefore(m) { m.isConnected = true; } } };
  const overviewPanel = {
    isConnected: true,
    insertBefore() {},
    querySelector: s => (s === '[data-testid="overview-panel-customize-trigger"]' ? customizeTrigger : null)
  };
  const composerCard = { isConnected: true, parentElement: { insertBefore(m) { m.isConnected = true; } }, nextSibling: null, querySelector: () => null };
  const modelTrigger = { isConnected: true, textContent: 'Gemini 4 Carbon', closest: s => (s === '.surface-composer-card' ? composerCard : null) };
  const uiDoc = {
    readyState: 'complete',
    title: 'Antigravity',
    head: { append() {} },
    body: {},
    documentElement: {
      style: { setProperty() {}, removeProperty() {} },
      toggleAttribute() {},
      removeAttribute() {}
    },
    createElement: () => ({ dataset: {}, style: {}, remove() {} }),
    addEventListener(type, fn) {
      if (!callbacks.has(type)) callbacks.set(type, []);
      callbacks.get(type).push(fn);
    },
    querySelector(sel) {
      if (sel === '[data-testid="overview-panel"]') return overviewPanel;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-testid="model-selector-trigger"]') return [modelTrigger];
      return [];
    }
  };
  const uiCtx = vm.createContext({
    document: uiDoc,
    window: { addEventListener() {} },
    location: { pathname: '/c/conv-pin', search: '' },
    navigator: { userAgent: 'Antigravity/2.35.2' },
    MutationObserver: class { observe() {} disconnect() {} },
    AbortController, URL, URLSearchParams, queueMicrotask, console,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    React: { createElement: h, Fragment: R.Fragment, useState: v => [typeof v === 'function' ? v() : v, () => {}], useEffect() {}, useId: () => 'id-1', useSyncExternalStore: (_s, g) => g() },
    __agyDashboard: { cacheObservation: () => null },
    ReactDOM: {
      createRoot(mount) {
        const rec = { mount, tree: null };
        mounted.push(rec);
        return { render(el) { rec.tree = el; }, unmount() {} };
      }
    },
    HC: SimpleWrap, IC: SimpleWrap, JC: SimpleWrap, KC: SimpleWrap, GC: SimpleWrap,
    Uy: ({ children, ...p }) => h('button', p, ...(Array.isArray(children) ? children : [children])),
    dq: ({ name }) => h('span', null, name),
    k0: SimpleWrap, Sy: SimpleWrap,
    __agyInitialSettings: {
      enabled: true,
      pinOverview: true,
      composerQuota: true,
      composerQuotaWindow: 'auto',
      composerIndicatorTone: 'muted',
      composerIndicatorCompact: true
    },
    __agyNativeAdapter: {
      wrap: el => el,
      installPage: () => true,
      composerCascadeId: () => 'conv-pin',
      overview: () => ({
        cascadeId: 'conv-pin',
        hostMounted: true,
        presentation: 'docked',
        breakpoint: overviewBp,
        isPanelVisible: false,
        setBreakpoint(nextBp) { overviewBp = nextBp; }
      }),
      service: () => ({
        retrieveUserQuotaSummary: async () => ({
          response: {
            groups: [{
              displayName: 'Gemini Models',
              buckets: [
                { bucketId: 'gemini-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.72 } },
                { bucketId: 'gemini-weekly', window: 'weekly', remaining: { case: 'remainingFraction', value: 0.18 } }
              ]
            }]
          }
        })
      })
    },
    __agyPowertoolsHost(raw) {
      const req = JSON.parse(raw);
      queueMicrotask(() => uiCtx.__agyPowertoolsReceive(req.id, req.method === 'settings.get'
        ? uiCtx.__agyInitialSettings
        : { conversationId: 'conv-pin', contextWindow: { usedPercent: 91, categories: [] }, telemetry: { latestTps: 88 }, turns: [] }));
    }
  });
  vm.runInContext(nativeUiSource, uiCtx);
  await new Promise(r => setTimeout(r, 30));

  // pinOverview promoted narrow 'small' breakpoint to 'medium' and mounted OverviewPinButton
  assert.equal(overviewBp, 'medium');
  const pinMount = mounted.find(m => m.mount.dataset.agyPowertoolsRoot === 'overview-pin');
  assert.ok(pinMount, 'expected overview-pin button root');
  const pinRendered = expand(pinMount.tree);
  assert.equal(findByTestId(pinRendered, 'agy-overview-pin-btn')?.props['aria-pressed'], true);

  // Composer strip rendered muted + compact indicators AND auto-selected lower weekly quota (18%) with Md3WavyBar
  const ringMount = mounted.find(m => m.mount.dataset.agyPowertoolsRoot === 'ring');
  assert.ok(ringMount, 'expected composer under-strip root');
  const stripTree = expand(ringMount.tree);
  const ctxTrigger = findByTestId(stripTree, 'agy-context-ring-trigger');
  assert.equal(ctxTrigger.props['data-indicator-tone'], 'muted');
  assert.equal(ctxTrigger.props['data-indicator-compact'], 'true');
  assert.equal(ctxTrigger.props.style.color, undefined, 'muted mode suppresses red/yellow warning color');

  const quotaTrigger = findByTestId(stripTree, 'agy-composer-quota-trigger');
  assert.ok(quotaTrigger, 'expected composer quota trigger');
  assert.equal(quotaTrigger.props['data-window'], 'weekly');
  assert.equal(quotaTrigger.props['data-percent'], '18');
  assert.ok(findByTestId(stripTree, 'agy-md3-wavy-bar'), 'expected Material 3 wavy quota bar inside popover');
  assert.ok(findByTestId(stripTree, 'agy-composer-quota-win-picker'), 'expected independent window picker inside popover');

  uiCtx.__agyPowertools.dispose();
});

test('Settings enforces two-step confirmation on reset and supports cross-category keyword search', () => {
  const storage = new Map([['agy-max:settings-cat', 'telemetry']]);
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v))
  };
  let states = [];
  let cursor = 0;
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(c => c != null && c !== false) });
  const R = {
    createElement: h,
    Fragment: ({ children }) => children,
    useState(init) {
      const idx = cursor++;
      if (!(idx in states)) states[idx] = typeof init === 'function' ? init() : init;
      return [states[idx], v => { states[idx] = typeof v === 'function' ? v(states[idx]) : v; }];
    },
    useSyncExternalStore: (_s, g) => g(),
    useEffect() {},
    useRef: v => ({ current: v })
  };
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type({ ...(node.props || {}), children: node.children }));
    return { ...node, children: (node.children || []).map(expand) };
  };
  const renderTree = (Comp, props = {}) => { cursor = 0; return expand(Comp(props)); };
  const findByTestId = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) { const f = findByTestId(item, id); if (f) return f; }
      return null;
    }
    if (node.props?.['data-testid'] === id) return node;
    for (const ch of node.children || []) { const f = findByTestId(ch, id); if (f) return f; }
    return null;
  };
  const SimpleWrap = ({ children, ...rest }) => h('div', rest, ...(Array.isArray(children) ? children : [children]));
  const panelCtx = vm.createContext({
    React: R,
    localStorage,
    setTimeout,
    clearTimeout,
    document: { head: { append() {} }, createElement: () => ({ dataset: {}, style: {}, setAttribute() {}, remove() {} }) },
    HC: SimpleWrap, IC: SimpleWrap, JC: SimpleWrap, KC: SimpleWrap, GC: SimpleWrap,
    Uy: ({ children, ...p }) => h('button', p, ...(Array.isArray(children) ? children : [children])),
    XP: p => h('input', { type: 'checkbox', ...p }),
    UP: ({ label, description, rightElement, ...p }) => h('div', p, label, description, rightElement),
    TP: SimpleWrap, VP: SimpleWrap,
    dq: ({ name }) => h('span', null, name),
    k0: SimpleWrap, Sy: SimpleWrap,
    kT: SimpleWrap, lT: SimpleWrap, mT: SimpleWrap, nT: SimpleWrap
  });
  vm.runInContext(prismPanelsSource, panelCtx);
  vm.runInContext(panelsSource, panelCtx);

  const defaults = { enabled: true, language: 'zh-CN', keepOverviewOpen: true, proxyEnabled: false, composerQuota: false };
  let curOpts = { ...defaults, composerQuota: true };
  const changes = [];
  const panels = panelCtx.__agyPanels({
    t: s => s,
    version: '1.4.3',
    defaults,
    hasModuleCenter: true,
    hasModule: () => true,
    activeModuleCount: () => 8,
    modules: () => [],
    options: () => curOpts,
    state: () => ({ contextWindow: { maxTokens: 200000 } }),
    dashboard: () => null,
    account: () => null,
    estimates: () => [],
    settingsError: () => '',
    change: patch => { changes.push(patch); curOpts = { ...curOpts, ...patch }; },
    loadDashboard: async () => {},
    betaProviders: () => [],
    subscribe: () => () => {},
    revision: () => 1
  });

  // 1. Two-step reset confirmation prevents accidental one-click wipe
  let tree = renderTree(panels.Settings);
  const resetBtn1 = findByTestId(tree, 'agy-settings-reset-btn');
  assert.ok(resetBtn1);
  assert.equal(resetBtn1.props['data-confirm'], undefined);
  resetBtn1.props.onClick();
  assert.equal(changes.length, 0, 'first click must only arm confirmation');

  tree = renderTree(panels.Settings);
  assert.equal(findByTestId(tree, 'agy-settings-reset-btn').props['data-confirm'], 'true');
  const cancelBtn = findByTestId(tree, 'agy-settings-reset-cancel');
  assert.ok(cancelBtn, 'armed state should show cancel button');
  cancelBtn.props.onClick();
  assert.equal(changes.length, 0, 'canceling reset must not apply defaults');

  tree = renderTree(panels.Settings);
  assert.equal(findByTestId(tree, 'agy-settings-reset-btn').props['data-confirm'], undefined);
  findByTestId(tree, 'agy-settings-reset-btn').props.onClick();
  tree = renderTree(panels.Settings);
  findByTestId(tree, 'agy-settings-reset-btn').props.onClick();
  assert.equal(changes.length, 1, 'second click confirms and restores defaults');
  assert.deepEqual(JSON.parse(JSON.stringify(changes[0])), defaults);

  // 2. Typing into settings search expands across categories (excluding About release notes)
  tree = renderTree(panels.Settings);
  const searchInput = findByTestId(tree, 'agy-settings-search');
  assert.ok(searchInput);
  searchInput.props.onChange({ target: { value: '代理' } });
  tree = renderTree(panels.Settings);
  assert.equal(findByTestId(tree, 'agy-settings-sections').props['data-searching'], 'true');
  assert.ok(findByTestId(tree, 'agy-setting-row-proxyEnabled'), 'cross-category search exposes proxy section');
  assert.ok(findByTestId(tree, 'agy-setting-row-keepOverviewOpen'), 'cross-category search exposes display section');
  assert.equal(findByTestId(tree, 'agy-setting-row-project'), null, 'search excludes About updates card');
  assert.ok(findByTestId(tree, 'agy-settings-search-clear'));

  // Escape clears search back to active category
  findByTestId(tree, 'agy-settings-search').props.onKeyDown({ key: 'Escape', stopPropagation() {} });
  tree = renderTree(panels.Settings);
  assert.equal(findByTestId(tree, 'agy-settings-sections').props['data-searching'], undefined);
  assert.equal(findByTestId(tree, 'agy-setting-row-proxyEnabled'), null);

  // 3. DOM search filter accurately matches multi-token queries, hides non-matching rows/sections, and resets cleanly
  const makeEl = (attrs = {}, textContent = '', children = []) => {
    const map = new Map(Object.entries(attrs));
    return {
      children,
      textContent,
      getAttribute: k => map.get(k) ?? null,
      setAttribute: (k, v) => map.set(k, String(v)),
      removeAttribute: k => map.delete(k),
      querySelector: sel => {
        if (sel === '.agy-card') return children.find(c => c.getAttribute('class') === 'agy-card') || null;
        if (sel === '[data-testid^="agy-setting-row-"]') return children.find(c => String(c.getAttribute('data-testid') || '').startsWith('agy-setting-row-')) || null;
        return null;
      }
    };
  };
  const rowBell = makeEl({ 'data-testid': 'agy-setting-row-sidebarFocusBell' }, '侧栏运行中会话铃铛 展开优先事项');
  const rowTint = makeEl({ 'data-testid': 'agy-setting-row-userBubbleTint' }, '用户消息气泡着色 气泡底色');
  const cardDisplay = makeEl({ class: 'agy-card' }, '', [rowBell, rowTint]);
  const secDisplay = makeEl({ 'data-agy-settings-section': '界面与显示' }, '', [cardDisplay]);

  const rowProxy = makeEl({ 'data-testid': 'agy-setting-row-proxyEnabled' }, '启用本地代理 HTTP SOCKS5');
  const cardProxy = makeEl({ class: 'agy-card' }, '', [rowProxy]);
  const secProxy = makeEl({ 'data-agy-settings-section': '网络代理' }, '', [cardProxy]);

  const allNodes = [secDisplay, cardDisplay, rowBell, rowTint, secProxy, cardProxy, rowProxy];
  const mockRoot = {
    querySelectorAll: sel => {
      if (sel === '[data-agy-search-hidden="1"]') return allNodes.filter(n => n.getAttribute('data-agy-search-hidden') === '1');
      if (sel === '[data-agy-settings-section]') return [secDisplay, secProxy];
      return [];
    }
  };

  assert.equal(panels.applySettingsSearchDom(mockRoot, '侧栏 铃铛'), 1);
  assert.equal(rowBell.getAttribute('data-agy-search-hidden'), null);
  assert.equal(rowTint.getAttribute('data-agy-search-hidden'), '1');
  assert.equal(secDisplay.getAttribute('data-agy-search-hidden'), null);
  assert.equal(secProxy.getAttribute('data-agy-search-hidden'), '1');

  assert.equal(panels.applySettingsSearchDom(mockRoot, '不存在的关键词xyz'), 0);
  assert.equal(secDisplay.getAttribute('data-agy-search-hidden'), '1');
  assert.equal(secProxy.getAttribute('data-agy-search-hidden'), '1');

  assert.equal(panels.applySettingsSearchDom(mockRoot, ''), null);
  assert.equal(allNodes.every(n => n.getAttribute('data-agy-search-hidden') == null), true);
});
