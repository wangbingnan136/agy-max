import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createPriorityStore } from '../lib/priority.mjs';

const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');

function page(ready = false) {
  const callbacks = new Map();
  const nodes = [];
  const node = () => ({
    dataset: {}, isConnected: false,
    append(child) { child.isConnected = true; },
    setAttribute() {}, addEventListener() {}, remove() { this.isConnected = false; }
  });
  const attrs = new Set();
  const document = {
    readyState: ready ? 'complete' : 'loading',
    head: ready ? node() : null, body: ready ? node() : null,
    documentElement: { toggleAttribute(name, force) { if (force === undefined ? !attrs.has(name) : force) attrs.add(name); else attrs.delete(name); }, removeAttribute(name) { attrs.delete(name); }, hasAttribute(name) { return attrs.has(name); } },
    createElement() { const element = node(); nodes.push(element); return element; },
    addEventListener(event, callback) { if (!callbacks.has(event)) callbacks.set(event, []); callbacks.get(event).push(callback); },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  const context = vm.createContext({
    document, location: { pathname: '/' }, AbortController,
    React: { createElement() { return {}; } }, ReactDOM: { createRoot() { throw new Error('No DOM roots expected'); } }, HC() {},
    __agyNativeAdapter: { wrap() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
  });
  return { context, document, nodes, callbacks, node };
}

test('SSH command paste observes setting changes without reinstalling its listener', async () => {
  const p = page(true);
  const settings = { enabled: true, sshCommandPaste: true };
  p.context.__agyInstalledModules = ['telemetry', 'chat-flow', 'workspace-nav', 'i18n', 'ssh-remote'];
  p.context.__agyInitialSettings = settings;
  let change, enabled, installs = 0;
  p.context.__agyPanels = env => { change = env.change; };
  p.context.installSshCommandPaste = (_document, options) => { enabled = options.enabled; installs++; };
  p.context.__agyPowertoolsHost = raw => {
    const { id, method, payload } = JSON.parse(raw);
    if (method === 'settings.set') Object.assign(settings, payload.settings);
    queueMicrotask(() => p.context.__agyPowertoolsReceive?.(id, { ...settings }));
  };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(enabled(), true);
  await change({ sshCommandPaste: false });
  assert.equal(enabled(), false);
  await change({ sshCommandPaste: true });
  assert.equal(enabled(), true);
  assert.equal(installs, 1);
  p.context.__agyPowertools.dispose();
});

test('new-document injection waits for head and body and initializes exactly once', () => {
  const p = page();
  vm.runInContext(source, p.context);
  vm.runInContext(source, p.context);
  assert.equal(p.nodes.length, 0);
  assert.equal(p.context.__agyPowertools, undefined);
  assert.equal(p.callbacks.get('DOMContentLoaded').length, 1);
  p.document.head = p.node(); p.document.body = p.node();
  p.callbacks.get('DOMContentLoaded')[0]();
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(p.context.__agyPowertoolsPending, undefined);
  assert.equal(p.nodes.length, 1);
  vm.runInContext(source, p.context);
  assert.equal(p.nodes.length, 1);
});

test('already-loaded injection initializes with only the 4 default modules and disposes cleanly', () => {
  const p = page(true);
  let panelEnv = null;
  p.context.__agyPanels = env => { panelEnv = env; };
  vm.runInContext(source, p.context);
  assert.equal(p.callbacks.has('DOMContentLoaded'), false);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(panelEnv.activeModuleCount(), 4);
  for (const coreId of ['telemetry', 'chat-flow', 'workspace-nav', 'i18n']) assert.equal(panelEnv.hasModule(coreId), true);
  for (const optId of ['optics', 'accounts', 'proxy', 'ssh-remote']) assert.equal(panelEnv.hasModule(optId), false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-keep-outline'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(p.context.__agyPowertools, undefined);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-keep-outline'), false);
  assert.ok(p.nodes.every(n => !n.isConnected));
});

test('new chat titlebar toggle has non-draggable styling and shares platform detection with native panels', () => {
  for (const [platform, isMac] of [['Win32', false], ['Linux x86_64', false], ['MacIntel', true]]) {
    const p = page(true);
    p.context.navigator = { platform };
    p.context.__agyPanels = env => { assert.equal(env.isMac, isMac); };
    vm.runInContext(source, p.context);
    assert.ok(p.nodes.some(node => /\[data-testid="agy-new-chat-aux-toggle"\]\{-webkit-app-region:no-drag;app-region:no-drag\}/.test(node.textContent)));
    p.context.__agyPowertools.dispose();
  }
});

test('multi-pane conversations with multiple composers stay healthy without triggering reload loops', () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-1';
  const renderedRings = [];
  p.context.ReactDOM = { createRoot(mount) { renderedRings.push(mount); return { render() {}, unmount() {} }; } };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const makeComposerTrigger = () => {
    const parent = { insertBefore(child) { child.isConnected = true; } };
    return { isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? {} : null };
  };
  const twoTriggers = [makeComposerTrigger(), makeComposerTrigger()];
  let ringNodes = [{}, {}];
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return twoTriggers;
    if (sel === '[data-testid="agy-context-ring-trigger"]') return ringNodes;
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true };
  vm.runInContext(source, p.context);
  assert.equal(renderedRings.length, 2);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  p.context.__agyPowertools.dispose();
});

test('side-question and split-pane composers fetch and render independent context and telemetry per cascadeId', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/main-conv';
  const renderedByMount = new Map();
  const mountOrder = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.ReactDOM = {
    createRoot(mount) {
      mountOrder.push(mount);
      return {
        render(el) { renderedByMount.set(mount, el); },
        unmount() {}
      };
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const makeComposerTrigger = cid => {
    const parent = { insertBefore(child) { child.isConnected = true; } };
    const card = { cid };
    return { cid, isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  };
  const mainTrigger = makeComposerTrigger('main-conv');
  const btwTrigger = makeComposerTrigger('btw-conv');
  p.context.__agyNativeAdapter.composerCascadeId = el => el?.cid || '';
  const stateRequests = [];
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, contextRing: true, speedStats: true }));
      return;
    }
    if (req.method === 'state') {
      stateRequests.push(req.payload.conversationId);
      const reply = req.payload.conversationId === 'btw-conv'
        ? { conversationId: 'btw-conv', contextWindow: { usedPercent: 80.4, usedTokens: 632000, maxTokens: 786432, categories: [] }, telemetry: { tps: 38, latestTps: 60.4 }, turns: [], requests: [] }
        : { conversationId: 'main-conv', contextWindow: { usedPercent: 78.2, usedTokens: 615000, maxTokens: 786432, categories: [] }, telemetry: { tps: 38, latestTps: 51.7 }, turns: [], requests: [] };
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, reply));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [mainTrigger, btwTrigger];
    if (sel === '[data-testid="agy-context-ring-trigger"]') return [{}, {}];
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true, speedStats: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 40));
  assert.ok(stateRequests.includes('main-conv'));
  assert.ok(stateRequests.includes('btw-conv'));
  assert.equal(mountOrder.length, 2);
  const mainData = renderedByMount.get(mountOrder[0])?.props?.data;
  const btwData = renderedByMount.get(mountOrder[1])?.props?.data;
  assert.equal(mainData?.conversationId, 'main-conv');
  assert.equal(mainData?.contextWindow?.usedPercent, 78.2);
  assert.equal(btwData?.conversationId, 'btw-conv');
  assert.equal(btwData?.contextWindow?.usedPercent, 80.4);
  assert.equal(btwData?.telemetry?.latestTps, 60.4);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  p.context.__agyPowertools.dispose();
});

test('accountSwitcher respects multiAccount master switch, toggles native settings hide attr, and cleans up on dispose', () => {
  const pOff = page(true);
  const offMounts = [];
  const offSettingsBtn = { isConnected: true, parentElement: { insertBefore(node) { node.isConnected = true; offMounts.push(node); } } };
  pOff.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  pOff.context.__agyNativeAdapter.installPage = () => true;
  pOff.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} });
  pOff.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? offSettingsBtn : null;
  pOff.context.__agyInstalledModules = ['telemetry', 'chat-flow', 'workspace-nav', 'i18n', 'accounts'];
  pOff.context.__agyInitialSettings = { enabled: true, multiAccount: false, accountSwitcher: true };
  vm.runInContext(source, pOff.context);
  assert.equal(offMounts.length, 0);
  assert.equal(pOff.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
  pOff.context.__agyPowertools.dispose();

  const p = page(true);
  const mountedNodes = [];
  const settingsBtn = {
    isConnected: true,
    parentElement: {
      children: [],
      insertBefore(node, before) {
        node.isConnected = true;
        mountedNodes.push({ node, before });
      }
    }
  };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({
    Page: () => null,
    Sidebar: () => null,
    AccountSwitcher: () => null,
    dispose() {}
  });
  p.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? settingsBtn : null;
  p.context.__agyInstalledModules = ['telemetry', 'chat-flow', 'workspace-nav', 'i18n', 'accounts'];
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, accountSwitcher: true };
  vm.runInContext(source, p.context);
  assert.equal(mountedNodes.length, 1);
  assert.equal(mountedNodes[0].node.dataset.agyPowertoolsRoot, 'account-switcher');
  assert.equal(mountedNodes[0].before, settingsBtn);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(mountedNodes[0].node.isConnected, false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
});

test('renderRoot does not repeatedly call insertBefore when before equals existing mount', () => {
  const p = page(true);
  let insertCount = 0;
  const card = { isConnected: true, nextSibling: null };
  const parent = {
    insertBefore(node) {
      insertCount++;
      node.isConnected = true;
      card.nextSibling = node;
    }
  };
  card.parentElement = parent;
  const modelTrigger = {
    isConnected: true,
    parentElement: parent,
    nextSibling: null,
    closest: sel => sel === '.surface-composer-card' ? card : null
  };
  let observerCb = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  let scheduled = null;
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.document.querySelectorAll = sel => sel === '[data-testid="model-selector-trigger"]' ? [modelTrigger] : [];
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  assert.equal(insertCount, 1);
  // Trigger a second mount cycle after card.nextSibling points to entry.mount
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(insertCount, 1);
  p.context.__agyPowertools.dispose();
});

test('right-sidebar plugin slot mounts full panel dynamically without touching left sidebar or flickering', () => {
  const p = page(true);
  const leftChildren = [];
  const navContainer = {
    isConnected: true,
    insertBefore(node) { leftChildren.push(node); }
  };
  const custLink = { id: 'cust', isConnected: true, parentElement: navContainer, nextSibling: null };
  let auxSlots = [];
  let auxInsertCount = 0;
  let observerCb = null;
  let scheduled = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.document.querySelector = sel => {
    if (sel === 'a[href="/customizations"]') return custLink;
    if (sel === '[data-testid="sidebar-navigation-items"]') return navContainer;
    return null;
  };
  p.document.querySelectorAll = sel => sel === '[data-testid="sidecar-iframe-slot"]' ? auxSlots : [];
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  assert.equal(leftChildren.length, 0);

  // User clicks Plugins -> Antigravity Max in right sidebar -> sidecar-iframe-slot mounts
  const slotChildren = [];
  const slot = {
    isConnected: true,
    getAttribute: name => name === 'data-sidecar-id' ? 'agy-max/inspector' : null,
    setAttribute() {},
    removeAttribute() {},
    insertBefore(node) {
      auxInsertCount++;
      node.isConnected = true;
      node.nextSibling = null;
      slotChildren.push(node);
    }
  };
  auxSlots = [slot];
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(leftChildren.length, 0);
  assert.equal(slotChildren.length, 1);
  assert.equal(slotChildren[0].dataset.agyPowertoolsRoot, 'aux-management');
  const countAfterMount = auxInsertCount;

  // Next mount tick must be a no-op (no flicker loop)
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(auxInsertCount, countAfterMount);

  p.context.__agyPowertools.dispose();
  assert.equal(slotChildren[0].isConnected, false);
});

test('cold-start proxy prompt banner appears on mismatch, handles unreachable port, dismisses, and cleans up on dispose', async () => {
  const p = page(true);
  const bodyChildren = [];
  const makeEl = () => {
    const listeners = new Map();
    const el = {
      dataset: {},
      children: [],
      isConnected: false,
      textContent: '',
      append(...items) {
        for (const item of items) {
          item.isConnected = true;
          this.children.push(item);
        }
      },
      setAttribute() {},
      addEventListener(type, fn) { listeners.set(type, fn); },
      click() { listeners.get('click')?.(); },
      remove() {
        this.isConnected = false;
        const idx = bodyChildren.indexOf(this);
        if (idx >= 0) bodyChildren.splice(idx, 1);
      }
    };
    return el;
  };
  p.document.createElement = () => makeEl();
  p.document.body = {
    append(el) { el.isConnected = true; bodyChildren.push(el); }
  };

  const sent = [];
  p.context.__agyPowertoolsHost = payload => {
    const req = JSON.parse(payload);
    sent.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' });
      } else if (req.method === 'proxy.status') {
        p.context.__agyPowertoolsReceive(req.id, {
          configured: true,
          configuredUrl: 'http://127.0.0.1:7897',
          configuredDisplayUrl: 'http://127.0.0.1:7897',
          configuredForceHttp1: false,
          active: false,
          mismatch: true,
          reason: 'not-applied',
          canRelaunch: true
        });
      } else if (req.method === 'proxy.relaunch') {
        p.context.__agyPowertoolsReceive(req.id, req.payload.force
          ? { ok: true, relaunching: true, proxyActive: true }
          : { ok: false, portUnreachable: true, message: '代理端口 127.0.0.1:7897 无法连接' });
      }
    });
  };
  p.context.__agyInstalledModules = ['telemetry', 'chat-flow', 'workspace-nav', 'i18n', 'proxy'];
  p.context.__agyInitialSettings = { enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setTimeout(resolve, 20));

  const findBanner = () => bodyChildren.find(el => el.dataset.testid === 'agy-proxy-prompt-banner');
  const findBtn = (banner, testId) => banner?.children?.flatMap(c => c.children || []).find(b => b.dataset?.testid === testId);

  let banner = findBanner();
  assert.ok(banner);
  assert.ok(banner.children[0].textContent.includes('http://127.0.0.1:7897'));
  assert.equal(banner.children[0].textContent.includes('\u00b7'), false);

  // Clicking relaunch when port is closed warns instead of restarting immediately
  findBtn(banner, 'agy-proxy-banner-relaunch').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  banner = findBanner();
  assert.ok(banner);
  assert.ok(banner.children[0].textContent.includes('无法连接'));
  assert.ok(findBtn(banner, 'agy-proxy-banner-force'));

  // Dismiss removes banner cleanly
  findBtn(banner, 'agy-proxy-banner-dismiss').click();
  assert.equal(findBanner(), undefined);

  p.context.__agyPowertools.dispose();
  assert.equal(bodyChildren.some(el => el.dataset.testid === 'agy-proxy-prompt-banner'), false);
});

test('native-bindings resolves 2.34.0 notification hook without type:"add" and stays optional when absent', () => {
  const bindingsSource = readFileSync(new URL('../lib/native-bindings.js', import.meta.url), 'utf8');
  const makeEnv = (toastHook, jcImpl = null) => {
    const Sy = () => null; Sy.displayName = 'CompactTooltipBaseUi';
    const ctx = vm.createContext({
      React: {},
      createFileRoute: () => opts => opts,
      HC: () => ({ defaultOpen: 1, matchTriggerWidth: 1, disableMobileSheet: 1 }),
      IC: () => ({ startDragTracking: 1, tag: 'popover-trigger-element', asChild: 1 }),
      JC: jcImpl || (() => ({ scrollContainerClassName: 1, arrowNavigable: 1, matchTriggerWidth: 1 })),
      KC: () => ({ asChild: 1, isMobile: 1, setIsOpen: 1 }),
      GC: () => ({ tooltipPlace: 1, secondaryAction: 1, tag: 'main-row-trigger' }),
      Uy: () => ({ paddingClassName: 1, computedAriaLabel: 1, asChild: 1 }),
      XP: () => ({ onCheckedChange: 1, desc: 'aria-describedby', role:"switch" }),
      UP: ({label: a}) => ({ rightElement: a, extraContent: 1, descriptionId: 1 }),
      TP: () => 'agy-card bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border',
      VP: () => ({ headerRight: 1, defaultCollapsed: 1, forceExpanded: 1 }),
      dq: ({name: a}) => ({ cls: 'google-symbols', kind: 'Icon', a }),
      k0: ({trigger: a}) => ({ triggerVisible: a, onCollapseComplete: 1, defaultExpanded: 1 }),
      Sy,
      kT: () => ({ ownsHighlight: 1, onHighlightExit: 1, onSearchQueryChange: 1 }),
      lT: () => ({ asChild: 1, openOnHover: 1, closeDelay: 1, attr: "data-no-drag" }),
      mT: () => ({ collisionBoundary: 1, pad: 1, alignOffset: 1, keepMounted: 1 }),
      nT: () => ({ highlighted: 1, selected: 1, action: 1, description: 1, managedHighlight: 1 }),
      HU: s => s.sourceTrajectoryStepInfo?.stepIndex,
      Kc: x => x,
      resolveFn: () => { const c = Kc(Proto.CascadeConfigSchema, { lookupCustomModelInfo: 1, customModelInfoOverride: 1, checkpointConfig: void 0 }); return c; },
      segmentFn: () => ({ getStepRendererConfig: 1, hasBeenCollapsed: 1, leadingSteps: 1 }),
      menuFn: function m(a,{onRenameClick:b}) { return { b, onRestoreClick: 1, onCreateGroup: 1 }; },
      Proto: { CascadeConfigSchema: {} },
      Wb: x => { const o = Object.create(null); o.$typeName=x.members+'oneof'; return o; },
      IJ: s => { const x = {}; x._dirtyElements=1; x._dirtyLeaves=1; x._parsed=!0; return JSON.parse(s); },
      LN: s => JSON.stringify({ version:1, singleParagraph: s, type:"root" }),
      ...(toastHook ? { kn: toastHook } : {})
    });
    // Ensure resolveFn contains exact matcher literal checkpointConfig=void 0
    vm.runInContext(`resolveFn = function(checkpointConfig=void 0){ const x=Kc(Proto.CascadeConfigSchema, checkpointConfig); return { lookupCustomModelInfo: x, customModelInfoOverride: 1 }; };`, ctx);
    vm.runInContext(bindingsSource, ctx);
    return ctx.__agyResolveNativeBindings([]);
  };

  // 2.34.0 style (action creator Mqa instead of inline type:"add")
  const toast234 = function () { return ({ autoDismissMs: m, plainTextFallback: p, primaryActionLabel: l }) => b.showNotification({ primaryActionLabel: l, autoDismissMs: m, plainTextFallback: p }); };
  const resolved234 = makeEnv(toast234);
  assert.equal(resolved234.names.um, 'kn');
  assert.equal(resolved234.bindings.um, toast234);

  // Absent toast hook degrades gracefully without throwing
  const resolvedNoToast = makeEnv(null);
  assert.equal(resolvedNoToast.bindings.um, undefined);

  // 2.35.0 style JC (scrollContainerClassName removed, keeps arrowNavigable + matchTriggerWidth + collisionAvoidance / contentRef.current=)
  const jc235 = function LQ({ arrowNavigable: l, matchTriggerWidth: k, collisionAvoidance: n }) { const y = { contentRef: {} }; y.contentRef.current = l || k || n; return y; };
  const resolved235 = makeEnv(toast234, jc235);
  assert.equal(resolved235.names.JC, 'JC');
  assert.equal(resolved235.bindings.JC, jc235);
});

test('overview mounts both progress and overviewQuota in stable order without insertBefore ping-pong', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-ov';
  const children = [];
  let insertCount = 0;
  const syncSiblings = () => {
    for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
  };
  const overview = {
    isConnected: true,
    insertBefore(node, before) {
      insertCount++;
      const idx = children.indexOf(node);
      if (idx >= 0) children.splice(idx, 1);
      node.isConnected = true;
      if (before && children.includes(before)) children.splice(children.indexOf(before), 0, node);
      else children.push(node);
      syncSiblings();
    }
  };
  let observerCb = null;
  let scheduled = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, Progress: () => null, OverviewQuota: () => null, dispose() {} });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, progress: true, overviewQuota: true }));
      return;
    }
    if (req.method === 'state') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-ov', turns: [], requests: [], progress: { status: 'complete', tasks: [] } }));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.document.querySelector = sel => sel === '[data-testid="overview-panel"]' ? overview : null;
  p.context.__agyInitialSettings = { enabled: true, progress: true, overviewQuota: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(children.map(c => c.dataset.agyPowertoolsRoot).join(','), 'progress,overview-quota');
  const stableCount = insertCount;
  // Re-trigger mount cycles multiple times -> zero extra insertBefore mutations
  for (let i = 0; i < 4; i++) {
    observerCb?.([{ target: { closest: () => null } }]);
    scheduled?.();
  }
  assert.equal(insertCount, stableCount);
  p.context.__agyPowertools.dispose();
});

test('startAddAccount awaits active sync and calls accounts.completeAdd, and refreshAccount skips quota.observe on credentialMismatch', async () => {
  const p = page(true);
  let capturedEnv = null;
  let currentEmail = 'alpha@example.com';
  const calls = [];
  let mismatchNextSync = false;
  let quotaRemaining = 0.9;

  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({
    email: currentEmail,
    name: currentEmail.split('@')[0],
    plan: 'Google AI Ultra',
    planId: 'g1-ultra-tier'
  });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({
      response: {
        groups: [{
          displayName: 'Gemini Models',
          buckets: [{ bucketId: 'gemini-5h', window: '5h', remaining: { case: 'remainingFraction', value: quotaRemaining }, resetTime: null }]
        }]
      }
    })
  });
  p.context.__agyNativeAdapter.startAccountLogin = async () => {
    currentEmail = 'beta@example.com';
    return { ok: true, email: currentEmail };
  };
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' });
      } else if (req.method === 'accounts.autoSwitchCandidate') {
        p.context.__agyPowertoolsReceive(req.id, { candidate: { id: 'acct-a', email: 'alpha@example.com', name: 'Alpha' }, cooldownRemainingMs: 0 });
      } else if (req.method === 'accounts.prepareAdd') {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, backedUpId: 'acct-a', prevCredHash: 'HASH_A', activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'alpha@example.com', hasCredential: true }] });
      } else if (req.method === 'accounts.syncActive') {
        if (mismatchNextSync) {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [{ id: 'acct-b', email: 'beta@example.com', hasCredential: true }],
            credentialMismatch: { uiEmail: 'beta@example.com', credentialEmail: 'alpha@example.com' }
          });
        } else {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [
              { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
              { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
            ]
          });
        }
      } else if (req.method === 'accounts.completeAdd') {
        p.context.__agyPowertoolsReceive(req.id, {
          ok: true,
          relaunching: false,
          manualRestartRequired: true,
          account: { id: 'acct-b', email: 'beta@example.com', name: 'beta' },
          activeId: 'acct-b',
          accounts: [
            { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
            { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
          ]
        });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInstalledModules = ['telemetry', 'chat-flow', 'workspace-nav', 'i18n', 'accounts'];
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(capturedEnv);

  // Even when the newly signed-in account has a depleted bucket and autoSwitchAccount is enabled,
  // startAddAccount suppresses auto-switch so it never races with completeAdd / relaunch.
  quotaRemaining = 0;
  const addRes = await capturedEnv.startAddAccount('Backup');
  assert.equal(addRes.ok, true);
  assert.equal(addRes.manualRestartRequired, true);
  assert.equal(calls.some(c => c.method === 'accounts.autoSwitchCandidate'), false);
  assert.equal(p.context.document.querySelector('[data-testid="agy-autoswitch-banner"]'), null);
  quotaRemaining = 0.9;
  const methods = calls.map(c => c.method);
  const prepIdx = methods.indexOf('accounts.prepareAdd');
  const syncIdx = methods.lastIndexOf('accounts.syncActive');
  const completeIdx = methods.indexOf('accounts.completeAdd');
  assert.ok(prepIdx >= 0 && syncIdx > prepIdx && completeIdx > syncIdx, `Expected prepareAdd -> syncActive -> completeAdd, got ${methods.join(',')}`);
  const completeCall = calls[completeIdx];
  assert.equal(completeCall.payload.email, 'beta@example.com');
  assert.equal(completeCall.payload.prevEmail, 'alpha@example.com');
  assert.equal(completeCall.payload.prevCredHash, 'HASH_A');
  assert.equal(completeCall.payload.relaunch, true);

  // When syncActive reports credentialMismatch, refreshAccount MUST NOT call quota.observe
  const beforeObserve = calls.filter(c => c.method === 'quota.observe').length;
  mismatchNextSync = true;
  await capturedEnv.refreshAccountQuotas('acct-b');
  const afterObserve = calls.filter(c => c.method === 'quota.observe').length;
  assert.equal(afterObserve, beforeObserve);

  p.context.__agyPowertools.dispose();
});

test('sidebar bell switches to most recent running session, toggles Priority view, and search shortcut ignores terminal focus', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/idle-conv';
  const renderedTrees = new Map();
  p.context.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useSyncExternalStore: () => 0,
    useEffect: () => {},
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useRef: v => ({ current: v })
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(tree) { renderedTrees.set(mount.dataset?.agyPowertoolsRoot, tree); },
        unmount() { renderedTrees.delete(mount.dataset?.agyPowertoolsRoot); }
      };
    }
  };

  const navigated = [];
  let jumpedTurn = null;
  p.context.__agyNativeAdapter = {
    wrap: el => el,
    installPage: () => true,
    router: () => ({
      navigate: async arg => {
        navigated.push(arg);
        if (arg?.params?.cascadeId) p.context.location.pathname = `/c/${arg.params.cascadeId}`;
      },
      subscribe: () => () => {}
    }),
    navigateTurn: turn => { jumpedTurn = turn; return true; },
    conversationDirectory: () => ({
      running: [
        { id: 'run-latest', title: 'Train A100 model', projectId: 'p-ml', projectName: 'FlowIE', running: true, updatedAtMs: 2000 },
        { id: 'run-older', title: 'Check logs', projectId: 'p-ops', projectName: 'ops', running: true, updatedAtMs: 1000 },
        ...Array.from({ length: 10 }, (_, i) => ({ id: `run-extra-${i}`, running: true, updatedAtMs: 100 - i }))
      ],
      unread: [],
      projects: [],
      byId: {},
      subagentIds: []
    })
  };

  let capturedEnv = null;
  p.context.__agyPanels = env => { capturedEnv = env; return { Page: () => null, Sidebar: () => null, dispose() {} }; };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, sidebarFocusBell: true, sessionSearch: true, sessionSearchShortcut: true }));
    } else if (req.method === 'settings.set') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, req.payload.settings));
    }
  };

  const headerChildren = [];
  const syncHeaderSiblings = () => {
    for (let i = 0; i < headerChildren.length; i++) headerChildren[i].nextSibling = headerChildren[i + 1] || null;
  };
  const headerRow = {
    insertBefore(child, before) {
      child.isConnected = true;
      const existing = headerChildren.indexOf(child);
      if (existing >= 0) headerChildren.splice(existing, 1);
      const idx = before ? headerChildren.indexOf(before) : -1;
      if (idx >= 0) headerChildren.splice(idx, 0, child);
      else headerChildren.push(child);
      syncHeaderSiblings();
    }
  };
  const afterSearch = { id: 'after-search', isConnected: true, parentElement: headerRow, nextSibling: null };
  const searchBtn = { id: 'search', isConnected: true, parentElement: headerRow, nextSibling: afterSearch };
  headerChildren.push(searchBtn, afterSearch);
  syncHeaderSiblings();
  const navBlockParent = { insertBefore(child) { child.isConnected = true; } };
  const navBlock = { isConnected: true, parentElement: navBlockParent, nextSibling: null };
  const sidebarEl = {
    querySelector: sel => {
      if (sel.includes('Search')) return searchBtn;
      if (sel === '[data-testid="sidebar-navigation-items"]') return navBlock;
      return null;
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  p.document.querySelector = sel => {
    if (sel.includes('Open Conversation Picker')) return searchBtn;
    if (sel.includes('Sidebar')) return sidebarEl;
    return null;
  };

  p.context.__agyInitialSettings = { enabled: true, sidebarFocusBell: true, sessionSearch: true, sessionSearchShortcut: true };
  vm.runInContext(source, p.context);

  const bellFnTree = renderedTrees.get('sidebar-bell');
  assert.ok(bellFnTree);
  assert.deepEqual(headerChildren.map(c => c.id || c.dataset?.agyPowertoolsRoot), ['search', 'sidebar-bell', 'after-search']);
  const bellRendered = bellFnTree.type(bellFnTree.props);
  assert.equal(bellRendered.props['data-testid'], 'agy-sidebar-bell-btn');

  // First click switches to run-latest and opens Priority panel
  bellRendered.props.onClick({ preventDefault() {}, stopPropagation() {} });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(navigated[0].params.cascadeId, 'run-latest');
  assert.ok(renderedTrees.has('sidebar-focus'));

  // Bell dot is for unread finished replies only: 12 running sessions with nothing unread leave it off
  const bellAfterSync = bellFnTree.type(bellFnTree.props);
  assert.match(bellAfterSync.props.title, /12/);
  assert.equal(bellAfterSync.children.some(c => c?.props?.['data-testid'] === 'agy-sidebar-bell-dot'), false);

  // Priority actions render real SVG, and promoted rows stay visible in the native list.
  const focusTree = renderedTrees.get('sidebar-focus');
  const renderFocus = () => focusTree.type(focusTree.props);
  const [focusHeader, focusList] = renderFocus().children;
  assert.equal(renderFocus().children.some(c => c?.type === 'style'), false);
  assert.equal(focusList.props['data-testid'], 'agy-priority-list');
  assert.equal(focusList.props.tabIndex, 0);
  const rows = focusList.children[0];
  // Default max items displayed in Priority is 5 (even when 12 sessions are running; bell still tracks all 12)
  assert.equal(rows.length, 5);
  assert.equal(rows.at(-1).props['data-conversation-id'], 'run-extra-2');
  const css = p.nodes.find(n => Object.hasOwn(n.dataset, 'agyDensityStyle')).textContent;
  assert.match(css, /\.agy-priority-list\{[^}]*max-block-size:min\(calc\(var\(--agy-priority-visible-rows,5\) \* var\(--agy-priority-row-height\)\),36vh\);overflow-y:auto/);
  assert.equal(focusList.props.style['--agy-priority-visible-rows'], 5);
  for (const count of [3, 4, 5]) {
    await capturedEnv.change({ priorityVisibleRows: count });
    const list = renderFocus().children[1];
    assert.equal(list.props.style['--agy-priority-visible-rows'], count);
    assert.equal(list.children[0].length, 5);
  }
  const sliders = focusHeader.children[1];
  const icon = sliders.children[0];
  assert.equal(icon.type(icon.props).type, 'svg');
  sliders.props.onClick({ preventDefault() {}, stopPropagation() {} });
  const menu = renderFocus().children[0].children[2];
  assert.equal(menu.children[0].props['data-testid'], 'agy-priority-window-group');
  assert.equal(menu.children[1].props['data-testid'], 'agy-priority-max-group');
  assert.equal(menu.children[3].props['data-testid'], 'agy-sidebar-next-running-btn');
  assert.equal(menu.children[4].props['data-testid'], 'agy-priority-clear-read');
  assert.equal(menu.children[4].props.disabled, true);
  // Expanding max items via the Priority popover immediately shows up to 10 / 12 items
  const max10Btn = menu.children[1].children[1].children.find(b => b.props['data-testid'] === 'agy-priority-max-10');
  max10Btn.props.onClick();
  assert.equal(renderFocus().children[1].children[0].length, 10);
  const max20Btn = renderFocus().children[0].children[2].children[1].children[1].children.find(b => b.props['data-testid'] === 'agy-priority-max-20');
  max20Btn.props.onClick();
  assert.equal(renderFocus().children[1].children[0].length, 12);

  // Cmd+Opt+F triggers Session Search unless inside .xterm terminal
  const keyHandlers = p.callbacks.get('keydown') || [];
  let prevented = false;
  for (const fn of keyHandlers) {
    fn({ metaKey: true, altKey: true, shiftKey: false, code: 'KeyF', key: 'ƒ', target: { closest: sel => sel.includes('.xterm') ? {} : null }, preventDefault() { prevented = true; }, stopPropagation() {} });
  }
  assert.equal(prevented, false);
  for (const fn of keyHandlers) {
    fn({ metaKey: true, altKey: true, shiftKey: false, code: 'KeyF', key: 'ƒ', target: { closest: () => null }, preventDefault() { prevented = true; }, stopPropagation() {} });
  }
  assert.equal(prevented, true);
  assert.equal(capturedEnv.consumeRequestedTab(), 'search');

  // Right-clicking a Priority item opens its native row menu, anchored at the cursor until the menu closes
  let watcher = null, kebabClicks = 0, expanded = 'false';
  p.context.MutationObserver = class { constructor(cb) { watcher = cb; } observe() {} disconnect() { watcher = null; } };
  p.context.DOMRect = class { constructor(x, y) { Object.assign(this, { x, y, width: 0, height: 0 }); } };
  p.context.CSS = { escape: s => s };
  const kebab = { getAttribute: () => expanded, click() { kebabClicks++; expanded = 'true'; } };
  const nativeRow = { querySelector: sel => sel.includes('More options') ? kebab : {} };
  const baseQuery = p.document.querySelector;
  p.document.querySelector = sel => sel === '.agy-sidebar-row a[href^="/c/run-older"]' ? { closest: () => nativeRow } : baseQuery(sel);
  let ctxPrevented = false;
  for (const fn of p.callbacks.get('contextmenu')) {
    fn({ clientX: 120, clientY: 340, target: { closest: sel => sel.includes('agy-sidebar-focus-item') ? { dataset: { conversationId: 'run-older' } } : null }, preventDefault() { ctxPrevented = true; }, stopPropagation() {} });
  }
  assert.equal(ctxPrevented, true);
  assert.equal(kebabClicks, 1);
  assert.deepEqual({ ...kebab.getBoundingClientRect() }, { x: 120, y: 340, width: 0, height: 0 });
  expanded = 'false';
  watcher();
  assert.equal(Object.hasOwn(kebab, 'getBoundingClientRect'), false);
  p.document.querySelector = baseQuery;

  // jumpToSearchHit navigates to target conversation and scrolls to matched turn
  capturedEnv.jumpToSearchHit({ conversationId: 'run-older', projectId: 'p-ops', stepIndexStart: 14 });
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(JSON.parse(JSON.stringify(jumpedTurn)), { stepIndexStart: 14 });

  p.context.__agyPowertools.dispose();
});

test('Priority view records conversations within selected past time window whether completed or not, defaults to max 5, and survives force-close reopen', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agy-priority-test-'));
  try {
    const priorityStore = createPriorityStore(tmp);
    const t0 = 1_700_000_000_000;
    const records = {
      'chat-focused': { id: 'chat-focused', title: 'Focused task', projectName: 'proj1', running: true, unread: false, updatedAtMs: t0 - 10_000 },
      'chat-bg': { id: 'chat-bg', title: 'Background task', projectName: 'proj2', running: true, unread: false, updatedAtMs: t0 - 5_000 },
      'done-recent': { id: 'done-recent', title: 'Completed 10m ago', projectName: 'proj1', running: false, unread: false, updatedAtMs: t0 - 10 * 60 * 1000 },
      'done-2d': { id: 'done-2d', title: 'Completed 2d ago', projectName: 'proj3', running: false, unread: false, updatedAtMs: t0 - 2 * 24 * 3600 * 1000 }
    };

    const bootSession = ({ initialPriority, emptySummaries = false, windowSetting = '15m' }) => {
      const p = page(true);
      p.context.ReactDOM = { createRoot: () => ({ render() {}, unmount() {} }) };
      p.context.document.hasFocus = () => true;
      p.context.location.pathname = '/c/chat-focused';
      // Fresh empty localStorage simulating a brand-new random localhost port after Force Quit!
      const memStorage = new Map();
      p.context.localStorage = {
        getItem: k => memStorage.get(k) ?? null,
        setItem: (k, v) => memStorage.set(k, String(v))
      };
      p.context.__agyPowertoolsHost = raw => {
        const req = JSON.parse(raw);
        if (req.method === 'priority.save') {
          const payload = req.payload || req;
          const saved = priorityStore.save('local', { open: payload.open, entries: payload.entries });
          queueMicrotask(() => p.context.__agyPowertoolsReceive?.(req.id, saved));
        } else if (req.method === 'settings.get') {
          queueMicrotask(() => p.context.__agyPowertoolsReceive?.(req.id, { enabled: true, sidebarFocusBell: true, priorityWindow: windowSetting, priorityMaxItems: 5 }));
        }
      };
      p.context.__agyNativeAdapter = {
        wrap: el => el,
        installPage: () => true,
        onEditChange: () => () => {},
        onGoalDetected: () => () => {},
        executionState: id => id === 'chat-bg' && records['chat-bg'].waiting ? { live: { waiting: true } } : null,
        conversationDirectory: () => emptySummaries
          ? { running: [], unread: [], byId: {}, projects: [], subagentIds: [] }
          : {
              running: Object.values(records).filter(r => r.running),
              unread: Object.values(records).filter(r => r.unread),
              byId: { ...records },
              projects: [],
              subagentIds: []
            }
      };
      p.context.__agyInitialSettings = { enabled: true, sidebarFocusBell: true, priorityWindow: windowSetting, priorityMaxItems: 5 };
      if (initialPriority) p.context.__agyInitialPriorityState = initialPriority;
      vm.runInContext(source, p.context);
      return p;
    };

    // 1. With 15m window: running chats + completed chat from 10m ago ARE recorded; 2d-ago chat is excluded
    records['chat-bg'].waiting = true;
    const p1 = bootSession({ initialPriority: priorityStore.get('local'), windowSetting: '15m' });
    const pt1 = p1.context.__agyPowertools;
    let snap = pt1.syncPriorityItems({ now: t0, activeId: 'chat-focused', focused: true });
    assert.deepEqual(
      Array.from(snap.items, i => `${i.id}:${i.attentionState}`),
      ['chat-bg:waiting', 'chat-focused:active', 'done-recent:idle']
    );

    // 2. Simulate user opening Priority panel and Antigravity being FORCE-CLOSED (no dispose, port changes on reopen, summaries still loading at 0ms!)
    priorityStore.save('local', { open: true });
    records['chat-bg'].waiting = false;
    records['chat-bg'].running = false;
    records['chat-focused'].running = false;

    const pReopenBoot = bootSession({
      initialPriority: priorityStore.get('local'),
      emptySummaries: true,
      windowSetting: '24h'
    });
    assert.equal(priorityStore.get('local').open, true);
    const bootSnap = pReopenBoot.context.__agyPowertools.syncPriorityItems({ now: t0 + 3000, activeId: 'chat-focused', focused: true });
    // Nothing is wiped on Force Quit reopen even before trajectorySummaries finishes loading!
    assert.deepEqual(
      Array.from(bootSnap.items, i => `${i.id}:${i.attentionState}`),
      ['chat-bg:unread', 'chat-focused:idle', 'done-recent:idle']
    );
    pReopenBoot.context.__agyPowertools.dispose();

    // 3. Selecting 3d window includes completed chats from 2 days ago as well
    const p3d = bootSession({ initialPriority: priorityStore.get('local'), windowSetting: '3d' });
    snap = p3d.context.__agyPowertools.syncPriorityItems({ now: t0 + 5000, activeId: 'chat-focused', focused: true });
    assert.deepEqual(
      Array.from(snap.items, i => `${i.id}:${i.attentionState}`),
      ['chat-bg:unread', 'chat-focused:idle', 'done-recent:idle', 'done-2d:idle']
    );

    // 4. Reading chat-bg turns it idle; "Clear read chats" sweeps all idle items in one click
    p3d.context.location.pathname = '/c/chat-bg';
    snap = p3d.context.__agyPowertools.syncPriorityItems({ now: t0 + 10_000, activeId: 'chat-bg', focused: true });
    assert.equal(snap.items.every(i => i.attentionState === 'idle'), true);
    p3d.context.__agyPowertools.clearReadPriorityChats(t0 + 11_000);
    snap = p3d.context.__agyPowertools.syncPriorityItems({ now: t0 + 11_000, activeId: 'other', focused: true });
    assert.equal(snap.items.length, 0);

    // 5. Next run of a cleared chat still brings it back immediately
    records['chat-bg'].running = true;
    snap = p3d.context.__agyPowertools.syncPriorityItems({ now: t0 + 12_000, activeId: 'other', focused: true });
    assert.deepEqual(Array.from(snap.items, i => i.id), ['chat-bg']);

    pt1.dispose();
    p3d.context.__agyPowertools.dispose();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('composer under-card status strip mounts outside .surface-composer-card after card and renders Git + telemetry cleanly', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-under';
  const renderedByMount = new Map();
  p.context.React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({
      type,
      props: { ...(props || {}), children: children.length <= 1 ? children[0] : children },
      children
    }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: v => ({ current: v })
  };
  p.context.HC = ({ children }) => children;
  p.context.IC = ({ children }) => children;
  p.context.JC = ({ children: _c, ...props }) => ({ type: 'PopoverContent', props, children: [] });
  p.context.Uy = ({ children, ...props }) => ({ type: 'Button', props, children: Array.isArray(children) ? children : [children] });
  p.context.__agyNativeAdapter = {
    wrap: el => el,
    composerCascadeId: () => 'conv-under',
    workspaceUri: (_cid, src) => src === card ? 'file:///repo' : ''
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(el) { renderedByMount.set(mount, el); },
        unmount() { renderedByMount.delete(mount); }
      };
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });

  const makeContainer = () => {
    const children = [];
    const syncSiblings = () => {
      for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
    };
    return {
      children,
      insertBefore(node, before) {
        const cur = children.indexOf(node);
        if (cur !== -1) children.splice(cur, 1);
        const idx = before ? children.indexOf(before) : -1;
        if (idx === -1) children.push(node);
        else children.splice(idx, 0, node);
        node.parentElement = this;
        node.isConnected = true;
        syncSiblings();
      }
    };
  };

  const inputBox = makeContainer();
  const footerRow = makeContainer();
  const card = { isConnected: true, parentElement: null, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  inputBox.insertBefore(card, null);
  const modelTrigger = { isConnected: true, parentElement: null, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  footerRow.insertBefore(modelTrigger, null);

  p.document.querySelector = sel => sel === '.surface-composer-card' ? card : null;
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [modelTrigger];
    if (sel === '[data-testid="agy-context-ring-trigger"]') return [{}];
    return [];
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'git.status') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {
        isRepo: true, branch: 'feat/composer-under-strip', changedCount: 2, additions: 1604, deletions: 310, files: []
      }));
      return;
    }
    if (req.method === 'state') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {
        conversationId: 'conv-under',
        goal: { text: 'Ship clean UI', status: 'active' },
        contextWindow: { usedPercent: 64, usedTokens: 128000, maxTokens: 200000, categories: [] },
        telemetry: { tps: 29.5, latestTps: 29.5 },
        turns: [], requests: []
      }));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true, speedStats: true, gitStatusPill: true, goalBar: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 40));

  // composer footer row stays untouched; inputBox holds [goal-bar, card, ring(under-strip)]
  assert.equal(footerRow.children.length, 1);
  assert.deepEqual(
    inputBox.children.map(n => n === card ? 'card' : n.dataset?.agyPowertoolsRoot),
    ['goal-bar', 'card', 'ring']
  );
  const ringMount = inputBox.children[2];
  assert.equal(ringMount.className, 'block w-full');

  // Evaluate rendered NativeEntry tree to verify left Git + right Context/Speed under-strip structure
  const rootEl = renderedByMount.get(ringMount);
  const stripTree = rootEl.type(rootEl.props);
  assert.equal(stripTree.props['data-testid'], 'agy-composer-under-strip');
  const flatText = [];
  const testIds = [];
  const walk = node => {
    if (node == null || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') { flatText.push(String(node)); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === 'function') { walk(node.type(node.props || {})); return; }
    if (node.props?.['data-testid']) testIds.push(node.props['data-testid']);
    (node.children || []).forEach(walk);
  };
  walk(stripTree);
  assert.ok(testIds.includes('agy-git-status-trigger'));
  assert.ok(testIds.includes('agy-context-ring-trigger'));
  assert.ok(testIds.includes('agy-speed-stats-trigger'));
  const joined = flatText.join(' ');
  assert.ok(joined.includes('feat/composer-under-strip'));
  assert.ok(joined.includes('+1604'));
  assert.ok(joined.includes('-310'));
  assert.ok(joined.includes('上下文 '));
  assert.ok(joined.includes('64%'));
  assert.ok(joined.includes('29.5 tok/s'));
  assert.equal(joined.includes('\u00b7'), false);

  // Empty state (no telemetry, no git repo) returns null so no empty padding bar renders
  const emptyResult = rootEl.type({ data: null, conversationId: '', source: {} });
  assert.equal(emptyResult, null);

  p.context.__agyPowertools.dispose();
});

test('native-ui MutationObserver ignores streaming .xterm/[data-markdown-root] mutations and prunes detached changedLabels', async () => {
  const p = page(true);
  let observerCb = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  let scheduledCount = 0;
  let scheduledFn = null;
  p.context.setTimeout = (fn, ms) => {
    if (ms === 24) {
      scheduledCount++;
      scheduledFn = fn;
    }
    return scheduledCount;
  };
  p.context.clearTimeout = () => {};
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.HU = meta => meta?.idx ?? 0;
  p.context.__agyNativeAdapter.fiber = () => ({
    memoizedProps: { container: { steps: [{ step: { case: 'userInput' }, metadata: { idx: 0 } }] } },
    return: null
  });
  p.context.__agyInitialSettings = { enabled: true, timing: true };

  // Set up one worked-for label to populate changedLabels
  const workedLabel = {
    textContent: 'Worked for 3s',
    isConnected: true
  };
  const nativeWorked = {
    isConnected: true,
    attrs: new Map(),
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    removeAttribute(k) { this.attrs.delete(k); },
    querySelectorAll: sel => (sel === 'span' ? [workedLabel] : [])
  };
  let responses = [{
    isConnected: true,
    firstChild: null,
    children: [],
    insertBefore(child) { child.isConnected = true; },
    closest: () => null,
    querySelector: sel => (sel === '[data-testid="worked-for-collapsible"]' ? nativeWorked : null),
    querySelectorAll: () => []
  }];
  p.context.location.pathname = '/c/conv-stream';
  p.document.querySelectorAll = sel => (sel === '[data-testid="agent-response"]' ? responses : []);
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, timing: true }));
      return;
    }
    if (req.method === 'state') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {
        conversationId: 'conv-stream',
        contextWindow: { usedPercent: 10, usedTokens: 1000, maxTokens: 10000, categories: [] },
        telemetry: {},
        turns: [{ turnNumber: 1, stepIndexStart: 0, stepIndexEnd: 1, status: 'completed', completedAtIso: '2026-01-01T00:00:00Z', durationMs: 4200 }],
        requests: []
      }));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };

  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(workedLabel.textContent, '用时 4秒');

  // Mutations inside .xterm or [data-markdown-root] must NOT schedule mount()
  const beforeCount = scheduledCount;
  observerCb([
    { target: { closest: sel => (sel.includes('.xterm') ? {} : null) } },
    { target: { closest: sel => (sel.includes('[data-markdown-root]') ? {} : null) } }
  ]);
  assert.equal(scheduledCount, beforeCount, 'Mutations inside .xterm and [data-markdown-root] must be skipped');

  // Mutations outside excluded subtrees still schedule mount()
  observerCb([{ target: { closest: () => null } }]);
  assert.equal(scheduledCount, beforeCount + 1);

  // Detach workedLabel and run mount(); changedLabels prunes it so dispose() does not keep/touch it
  workedLabel.isConnected = false;
  nativeWorked.isConnected = false;
  responses = [];
  scheduledFn();
  workedLabel.isConnected = true; // Flip back to observe whether dispose() still holds a reference
  p.context.__agyPowertools.dispose();
  assert.equal(workedLabel.textContent, '用时 4秒', 'Pruned detached label must no longer be retained in changedLabels');
});

test('RPC envelope isolates sequence id and method from colliding payload fields like thought.profiles.delete({ id })', async () => {
  const p = page(true);
  p.context.__agyNativeAdapter.installPage = () => true;
  let capturedEnv = null;
  const envelopes = [];
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const env = JSON.parse(raw);
    envelopes.push(env);
    queueMicrotask(() => {
      if (env.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(env.id, { enabled: true });
      } else if (env.method === 'thought.profiles.delete') {
        p.context.__agyPowertoolsReceive(env.id, { ok: true, deletedId: env.payload.id, echoedMethod: env.payload.method });
      } else {
        p.context.__agyPowertoolsReceive(env.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  assert.ok(capturedEnv);

  const reply = await capturedEnv.request('thought.profiles.delete', { id: 'prof_abc123', method: 'COLLIDING' });
  assert.deepEqual(JSON.parse(JSON.stringify(reply)), { ok: true, deletedId: 'prof_abc123', echoedMethod: 'COLLIDING' });
  const delEnv = envelopes.find(e => e.method === 'thought.profiles.delete');
  assert.ok(delEnv);
  assert.equal(Number.isInteger(delEnv.id), true);
  assert.equal(delEnv.method, 'thought.profiles.delete');
  assert.deepEqual(delEnv.payload, { id: 'prof_abc123', method: 'COLLIDING' });

  p.context.__agyPowertools.dispose();
});

test('SidebarFocusPanel preserves identical hook order across visible/hidden transitions and skips prefetch when hidden', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/idle-conv';
  const renderedTrees = new Map();
  let hookTrace = [];
  let effectFns = [];
  p.context.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useSyncExternalStore: () => { hookTrace.push('useSyncExternalStore'); return 0; },
    useEffect: (fn, deps) => { hookTrace.push(`useEffect:${deps?.length ?? 0}`); effectFns.push(fn); },
    useState: init => { hookTrace.push('useState'); return [typeof init === 'function' ? init() : init, () => {}]; },
    useRef: v => { hookTrace.push('useRef'); return { current: v }; }
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(tree) { renderedTrees.set(mount.dataset?.agyPowertoolsRoot, tree); },
        unmount() { renderedTrees.delete(mount.dataset?.agyPowertoolsRoot); }
      };
    }
  };
  const stateRequests = [];
  p.context.__agyNativeAdapter = {
    wrap: el => el,
    installPage: () => true,
    router: () => ({ navigate: async () => {}, subscribe: () => () => {} }),
    conversationDirectory: () => ({
      running: [{ id: 'run-1', title: 'Task 1', running: true, updatedAtMs: 1000 }],
      unread: [],
      projects: [],
      byId: { 'run-1': { id: 'run-1', title: 'Task 1', running: true, updatedAtMs: 1000 } },
      subagentIds: []
    })
  };
  let capturedEnv = null;
  p.context.__agyPanels = env => { capturedEnv = env; return { Page: () => null, Sidebar: () => null, dispose() {} }; };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'state') stateRequests.push(req.payload.conversationId);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { enabled: true, sidebarFocusBell: true });
      else if (req.method === 'settings.set') p.context.__agyPowertoolsReceive(req.id, req.payload.settings);
      else p.context.__agyPowertoolsReceive(req.id, { conversationId: req.payload.conversationId || '', turns: [], requests: [] });
    });
  };
  const headerChildren = [];
  const headerRow = { insertBefore(child) { child.isConnected = true; headerChildren.push(child); } };
  const searchBtn = { id: 'search', isConnected: true, parentElement: headerRow, nextSibling: null };
  const navBlock = { isConnected: true, parentElement: { insertBefore(child) { child.isConnected = true; } }, nextSibling: null };
  const sidebarEl = { querySelector: sel => sel === '[data-testid="sidebar-navigation-items"]' ? navBlock : null };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  p.document.querySelector = sel => sel.includes('Open Conversation Picker') ? searchBtn : sel.includes('Sidebar') ? sidebarEl : null;
  p.context.__agyInitialSettings = { enabled: true, sidebarFocusBell: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));

  // Click bell to mount SidebarFocusPanel
  const bellTree = renderedTrees.get('sidebar-bell');
  bellTree.type(bellTree.props).props.onClick({ preventDefault() {}, stopPropagation() {} });
  const focusTree = renderedTrees.get('sidebar-focus');
  assert.ok(focusTree);

  const renderWithStrictHooks = () => {
    hookTrace = [];
    effectFns = [];
    const out = focusTree.type(focusTree.props);
    return { out, hooks: [...hookTrace], effects: [...effectFns] };
  };

  // Visible render
  const openRender = renderWithStrictHooks();
  assert.ok(openRender.out);
  assert.deepEqual(openRender.hooks, ['useSyncExternalStore', 'useEffect:2']);
  stateRequests.length = 0;
  for (const fn of openRender.effects) fn();
  assert.ok(stateRequests.includes('run-1'));

  // Toggle sidebarFocusBell off -> hidden render MUST execute exact same hook signature and skip prefetch
  await capturedEnv.change({ sidebarFocusBell: false });
  const hiddenRender = renderWithStrictHooks();
  assert.equal(hiddenRender.out, null);
  assert.deepEqual(hiddenRender.hooks, openRender.hooks);
  stateRequests.length = 0;
  for (const fn of hiddenRender.effects) fn();
  assert.equal(stateRequests.length, 0);

  // Toggle enabled off -> hidden render still executes exact same hook signature
  await capturedEnv.change({ enabled: false });
  const disabledRender = renderWithStrictHooks();
  assert.equal(disabledRender.out, null);
  assert.deepEqual(disabledRender.hooks, openRender.hooks);
  assert.equal(p.context.__agyPowertools.status.healthy, true);

  p.context.__agyPowertools.dispose();
});

test('refresh does not lock settingsLoaded=true if applyOptions throws before mount completes', async () => {
  const p = page(true);
  let intervalCb = null;
  p.context.setInterval = cb => { intervalCb = cb; return 1; };
  let settingsGetCount = 0;
  let shouldFailApply = false;
  let appliedLimit = 0;
  p.context.__agyNativeAdapter = {
    wrap: el => el,
    setContextLimit(limit) {
      if (shouldFailApply) throw new Error('transient apply failure');
      appliedLimit = limit;
    }
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      settingsGetCount++;
      shouldFailApply = settingsGetCount === 1;
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, contextLimit: 500000 }));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.context.__agyInitialSettings = { enabled: true, contextLimit: 0 };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(settingsGetCount, 1);
  assert.equal(appliedLimit, 0);

  // Next refresh tick retries settings.get because settingsLoaded was NOT prematurely set to true
  await intervalCb();
  assert.equal(settingsGetCount, 2);
  assert.equal(appliedLimit, 500000);

  // Subsequent refresh tick sees settingsLoaded=true and does not re-fetch settings.get
  await intervalCb();
  assert.equal(settingsGetCount, 2);

  p.context.__agyPowertools.dispose();
});

test('ComposerGoalBar renders floating pill with checklist progress and expands GoalInlineDeck in-place without body drawer', async () => {
  const p = page(true);
  p.context.navigator = { platform: 'Win32' };
  p.context.location.pathname = '/c/conv-goal-ui';
  const renderedByMount = new Map();
  let stateSlots = [];
  let slotCursor = 0;
  const evalTree = rootEl => {
    slotCursor = 0;
    const walk = node => {
      if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return node;
      if (Array.isArray(node)) return node.map(walk);
      if (typeof node.type === 'function') {
        return walk(node.type(node.props || {}));
      }
      return { ...node, children: (node.children || []).map(walk) };
    };
    return walk(rootEl);
  };
  const findByTestId = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const child of node) { const hit = findByTestId(child, id); if (hit) return hit; }
      return null;
    }
    if (node.props?.['data-testid'] === id) return node;
    return findByTestId(node.children || [], id);
  };

  p.context.React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({
      type,
      props: { ...(props || {}), children: children.length <= 1 ? children[0] : children },
      children
    }),
    useState: init => {
      const idx = slotCursor++;
      if (!(idx in stateSlots)) stateSlots[idx] = typeof init === 'function' ? init() : init;
      const setVal = next => { stateSlots[idx] = typeof next === 'function' ? next(stateSlots[idx]) : next; };
      return [stateSlots[idx], setVal];
    },
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: v => ({ current: v })
  };
  p.context.HC = ({ children }) => children;
  p.context.Uy = ({ children, ...props }) => ({ type: 'Button', props, children: Array.isArray(children) ? children : [children] });
  p.context.getComputedStyle = () => ({ display: 'flex' });

  const makeContainer = () => {
    const children = [];
    return {
      children,
      insertBefore(node, before) {
        const cur = children.indexOf(node);
        if (cur !== -1) children.splice(cur, 1);
        const idx = before ? children.indexOf(before) : -1;
        if (idx === -1) children.push(node); else children.splice(idx, 0, node);
        node.parentElement = this;
        node.isConnected = true;
      }
    };
  };
  const inputBox = makeContainer();
  const footerRow = makeContainer();
  const card = { isConnected: true, parentElement: null, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  inputBox.insertBefore(card, null);
  const modelTrigger = { isConnected: true, parentElement: null, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  footerRow.insertBefore(modelTrigger, null);

  let bodyAppends = 0;
  p.document.body.insertBefore = () => { bodyAppends++; };
  p.document.querySelector = sel => sel === '.surface-composer-card' ? card : null;
  p.document.querySelectorAll = sel => sel === '[data-testid="model-selector-trigger"]' ? [modelTrigger] : [];

  let savedPayloads = [];
  let goalState = {
    text: '重构配额模块并补齐测试',
    status: 'active',
    startedAtMs: Date.now() - 85000,
    updatedAtMs: Date.now() - 10000,
    stepIndex: 3,
    checklist: [
      { id: 'c1', text: '补齐 429 退避逻辑', done: true },
      { id: 'c2', text: '通过全量单元测试', done: false }
    ],
    guardrails: ['run_tests']
  };

  let resumedInvocations = [];
  let syncedGoals = [];
  let mockRunning = false;
  p.context.__agyNativeAdapter = {
    wrap: el => el,
    composerCascadeId: () => 'conv-goal-ui',
    executionState: () => ({ conversationId: 'conv-goal-ui', status: mockRunning ? 2 : 1, lastStepIndex: 4, terminationReason: mockRunning ? 0 : 2 }),
    setConversationGoal(cid, g) { syncedGoals.push([cid, g?.status || null]); },
    async resumeGoalInvocation(cid, prompt) { resumedInvocations.push([cid, prompt, syncedGoals.at(-1)?.[1]]); return true; }
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(el) { renderedByMount.set(mount, el); },
        unmount() { renderedByMount.delete(mount); }
      };
    }
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, goalBar: true }));
      return;
    }
    if (req.method === 'state') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {
        conversationId: 'conv-goal-ui',
        goal: goalState,
        turns: [{ stepIndexStart: 3, stepIndexEnd: 4, status: 'complete' }],
        requests: []
      }));
      return;
    }
    if (req.method === 'goal.save') {
      savedPayloads.push(req.payload);
      goalState = { ...goalState, text: req.payload.text, checklist: req.payload.checklist || [], guardrails: req.payload.guardrails || [], updatedAtMs: Date.now() };
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { ok: true, goal: goalState }));
      return;
    }
    if (req.method === 'goal.setStatus') {
      goalState = {
        ...goalState,
        status: req.payload.status,
        ...(req.payload.status === 'active' && Number.isInteger(req.payload.currentStepIndex) ? { activeAfterStepIndex: req.payload.currentStepIndex } : {}),
        updatedAtMs: Date.now()
      };
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { ok: true, goal: goalState }));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.context.__agyInitialSettings = { enabled: true, goalBar: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 40));

  const goalMount = inputBox.children[0];
  assert.equal(goalMount.dataset.agyPowertoolsRoot, 'goal-bar');
  const pillTree = evalTree(renderedByMount.get(goalMount));
  assert.equal(pillTree.props['data-testid'], 'agy-goal-bar');
  assert.equal(pillTree.props.className, 'agy-goal-bar');
  // Collapsed floating pill hides destructive clear button and displays checklist 1/2 chip
  assert.equal(findByTestId(pillTree, 'agy-goal-clear-btn'), null);
  const checkChip = findByTestId(pillTree, 'agy-goal-checklist-chip');
  assert.ok(checkChip);
  assert.equal(checkChip.children[0], '✓ 1/2');

  // Clicking edit button expands GoalInlineDeck directly inside the goal-bar slot (zero document.body drawer)
  stateSlots = [];
  findByTestId(pillTree, 'agy-goal-edit-btn').props.onClick();
  assert.equal(bodyAppends, 0);
  const deckTree = evalTree(renderedByMount.get(goalMount));
  assert.equal(deckTree.props['data-testid'], 'agy-goal-editor');
  assert.ok(deckTree.props.className.includes('agy-goal-deck'));
  assert.ok(findByTestId(deckTree, 'agy-goal-textarea'));
  assert.ok(findByTestId(deckTree, 'agy-goal-checklist'));
  assert.ok(findByTestId(deckTree, 'agy-goal-guardrails'));
  assert.ok(findByTestId(deckTree, 'agy-goal-clear-btn'));

  // Toggle minimal_diff guardrail + type pending checklist item + click Save -> persists both and collapses back to pill
  const guardrailWrap = findByTestId(deckTree, 'agy-goal-guardrails');
  const minDiffBtn = guardrailWrap.children.flat(Infinity).find(btn => btn?.props?.['data-guardrail-id'] === 'minimal_diff');
  minDiffBtn.props.onClick();
  findByTestId(deckTree, 'agy-goal-checklist-input').props.onChange({ target: { value: '检查无多余文件改动' } });
  const dirtyDeck = evalTree(renderedByMount.get(goalMount));
  const saveBtn = findByTestId(dirtyDeck, 'agy-goal-save-btn');
  assert.equal(saveBtn.props.disabled, false);
  assert.deepEqual(saveBtn.children, ['保存 Ctrl+S']);
  saveBtn.props.onClick();
  await new Promise(r => setTimeout(r, 30));

  assert.equal(savedPayloads.length, 1);
  assert.equal(savedPayloads[0].checklist.length, 3);
  assert.equal(savedPayloads[0].checklist[2].text, '检查无多余文件改动');
  assert.deepEqual(savedPayloads[0].guardrails, ['run_tests', 'minimal_diff']);

  stateSlots = [];
  const collapsedAgain = evalTree(renderedByMount.get(goalMount));
  assert.equal(collapsedAgain.props['data-testid'], 'agy-goal-bar');

  // Pause goal -> renders ▶ 继续 button; clicking ▶ 继续 while idle first arms active goal on adapter then dispatches resumeGoalInvocation
  findByTestId(collapsedAgain, 'agy-goal-pause-btn').props.onClick();
  await new Promise(r => setTimeout(r, 30));
  stateSlots = [];
  const pausedPill = evalTree(renderedByMount.get(goalMount));
  assert.equal(pausedPill.props['data-paused'], 'true');
  assert.equal(resumedInvocations.length, 0);

  findByTestId(pausedPill, 'agy-goal-pause-btn').props.onClick();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(resumedInvocations.length, 1);
  assert.deepEqual(resumedInvocations[0], ['conv-goal-ui', '继续推进当前目标', 'active']);

  // If a turn is already running when user clicks ▶ 继续, status flips to active without sending a duplicate message
  findByTestId(evalTree(renderedByMount.get(goalMount)), 'agy-goal-pause-btn').props.onClick();
  await new Promise(r => setTimeout(r, 30));
  mockRunning = true;
  findByTestId(evalTree(renderedByMount.get(goalMount)), 'agy-goal-pause-btn').props.onClick();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(resumedInvocations.length, 1);

  p.context.__agyPowertools.dispose();
});

test('idle state polls with an identical reply do not re-render; a changed reply does', async () => {
  const p = page(true);
  let intervalCb = null;
  p.context.setInterval = cb => { intervalCb = cb; return 1; };
  p.context.location = { pathname: '/c/conv-1' };
  p.context.__agyNativeAdapter.installPage = () => true;
  let reply = { conversationId: 'conv-1', turns: [], requests: [], settings: { enabled: true } };
  let env = null;
  p.context.__agyPanels = e => { env = e; return { Page: () => null, Sidebar: () => null, dispose() {} }; };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    const out = req.method === 'state' ? JSON.parse(JSON.stringify(reply)) : req.method === 'settings.get' ? { enabled: true } : {};
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, out));
  };
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  const tick = async () => { await intervalCb(); await new Promise(r => setImmediate(r)); };
  await new Promise(r => setImmediate(r));
  await tick();
  const settled = env.revision();
  await tick();
  await tick();
  assert.equal(env.revision(), settled);
  reply = { ...reply, requests: [{ id: 'r1' }] };
  await tick();
  assert.ok(env.revision() > settled);
  p.context.__agyPowertools.dispose();
});

test('right-clicking a chat image opens the image menu; icons and file links do not', async () => {
  const p = page(true);
  const rendered = [];
  p.context.ReactDOM = { createRoot() { return { render(tree) { rendered.push(tree); }, unmount() {} }; } };
  p.context.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: v => [v, () => {}], useLayoutEffect() {}, useEffect() {} };
  p.context.__agyNativeAdapter = { wrap: tree => tree, installPage: () => true };
  p.context.window = { addEventListener() {} };
  for (const name of ['IC', 'JC', 'KC', 'GC', 'dq']) p.context[name] = name;
  p.context.__agyInitialSettings = { enabled: true, fileContextMenu: true };
  p.document.body.appendChild = node => { node.isConnected = true; };
  p.context.__agyPowertoolsHost = raw => { const req = JSON.parse(raw); queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, req.method === 'settings.get' ? { enabled: true, fileContextMenu: true } : {})); };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  const img = src => ({ currentSrc: src, getAttribute: () => src });
  const target = (image, inStep = true, fileLink = false) => ({
    closest: sel => sel.includes('file://') ? (fileLink ? { getAttribute: () => 'https://not-a-file' } : null) : sel.startsWith('[data-testid="user-input-step"]') ? (inStep ? {} : null) : sel === 'img' ? image : null
  });
  const fire = t => { let prevented = false; for (const fn of p.callbacks.get('contextmenu')) fn({ clientX: 10, clientY: 20, target: t, preventDefault() { prevented = true; }, stopPropagation() {} }); return prevented; };
  assert.equal(fire(target(img('blob:https://x/1'))), true);
  // A right click on the label part of an inline image chip (no <img> under the pointer) still opens the menu.
  const chipImg = img('blob:https://x/chip');
  const chipTarget = { closest: sel => sel.includes('file://') ? null : sel.startsWith('[data-testid="user-input-step"]') ? {} : sel === 'img' ? null : sel.includes('agy-inline-image-chip') ? { querySelector: () => chipImg } : null };
  assert.equal(fire(chipTarget), true);
  assert.equal(rendered.at(-1).type.name, 'ImageContextMenu');
  const menuTree = rendered.at(-1);
  const menu = menuTree.type(menuTree.props).children[1];
  assert.equal(menu.props['data-testid'], 'agy-image-context-menu');
  assert.deepEqual(menu.children.map(c => c.children[0].props['data-testid']), ['agy-image-attach-chat', 'agy-image-copy', 'agy-image-save']);
  const before = rendered.length;
  assert.equal(fire(target(img('https://x/symbols-icons/close.svg'))), false);
  assert.equal(fire(target(img('blob:https://x/2'), false)), false);
  assert.equal(fire(target(img('blob:https://x/3'), true, true)), false);
  assert.equal(rendered.length, before);
  p.context.__agyPowertools.dispose();
});

test('response toolbar Copy writes only the final answer and dispose restores clipboard.writeText', async () => {
  const p = page(true);
  const written = [];
  const clipboard = { writeText: async text => { written.push(text); } };
  const nativeWrite = clipboard.writeText;
  p.context.navigator = { clipboard };
  p.context.__agyNativeAdapter = { wrap() {}, installPage: () => true, finalResponseText: () => 'final answer' };
  p.context.__agyInitialSettings = { enabled: true };
  p.context.__agyPowertoolsHost = raw => { const req = JSON.parse(raw); queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, req.method === 'settings.get' ? { enabled: true } : {})); };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  const click = inToolbar => { for (const fn of p.callbacks.get('click')) fn({ target: { closest: sel => inToolbar && sel.includes('cascade-system-message-toolbar') ? {} : null } }); };
  click(true);
  await clipboard.writeText('progress note\n\nfinal answer');
  click(false);
  await clipboard.writeText('user copied this');
  assert.deepEqual(written, ['final answer', 'user copied this']);
  p.context.__agyPowertools.dispose();
  assert.equal(clipboard.writeText, nativeWrite);
});

test('mounts full Antigravity Max panel in right-sidebar plugin slot without injecting left-sidebar link', async () => {
  const p = page(true);
  const mountedRoots = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  p.context.ReactDOM = {
    createRoot(mount) {
      const rec = { mount, tree: null, unmounted: false };
      mountedRoots.push(rec);
      return { render(el) { rec.tree = el; }, unmount() { rec.unmounted = true; } };
    }
  };
  let auxOpened = 0, navCalls = 0, panelEnv = null;
  const PageComp = function FullMaxPage() {};
  const SidebarComp = function LegacyLeftSidebar() {};
  p.context.__agyPanels = env => { panelEnv = env; return { Page: PageComp, Sidebar: SidebarComp, dispose() {} }; };
  p.context.__agyNativeAdapter = {
    wrap: el => el,
    installPage: () => true,
    openMaxSidecarPane: () => { auxOpened++; return true; },
    router: () => ({ navigate() { navCalls++; } })
  };
  const leftCustomizations = { isConnected: true, parentElement: { insertBefore() { throw new Error('Must not inject into left sidebar'); } }, nextSibling: null };
  const slotAttrs = new Map([['data-sidecar-id', 'agy-max/inspector'], ['data-sidecar-url', 'plugin://agy-max--inspector-52150/']]);
  const auxSlot = {
    isConnected: true,
    getAttribute: name => slotAttrs.get(name) ?? null,
    setAttribute: (name, val) => slotAttrs.set(name, val),
    removeAttribute: name => slotAttrs.delete(name),
    insertBefore(child) { child.isConnected = true; }
  };
  p.document.querySelector = sel => sel.includes('/customizations') ? leftCustomizations : null;
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="sidecar-iframe-slot"]') return [auxSlot];
    if (sel === '[data-agy-max-aux-host]') return slotAttrs.has('data-agy-max-aux-host') ? [auxSlot] : [];
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true };
  p.context.__agyPowertoolsHost = raw => { const req = JSON.parse(raw); queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, req.method === 'settings.get' ? { enabled: true } : {})); };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));

  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(slotAttrs.has('data-agy-max-aux-host'), true);
  assert.equal(mountedRoots.length, 1);
  assert.equal(mountedRoots[0].mount.dataset.agyPowertoolsRoot, 'aux-management');
  assert.equal(mountedRoots[0].tree.type, PageComp);

  // Programmatic openManagementTab opens the right-sidebar plugin tab instead of navigating away
  panelEnv.openManagementTab('search');
  assert.equal(auxOpened, 1);
  assert.equal(navCalls, 0);

  // Turning master switch off keeps aux-management mounted so user can re-enable from Settings
  await panelEnv.change({ enabled: false });
  assert.equal(mountedRoots[0].unmounted, false);

  p.context.__agyPowertools.dispose();
  assert.equal(mountedRoots[0].unmounted, true);
  assert.equal(slotAttrs.has('data-agy-max-aux-host'), false);
});

test('keepOverviewOpen preserves aux pane between existing chats, never auto-opens on new blank chats, and ignores Max sidecar-only tab', async () => {
  const p = page(true);
  p.context.setTimeout = setTimeout;
  p.context.clearTimeout = clearTimeout;
  p.context.location = { pathname: '/c/chat-a', search: '' };
  p.context.URLSearchParams = URLSearchParams;

  const routerListeners = new Map();
  let auxOpen = true;
  let overviewVisible = true;
  let maxSidecarVisible = false;
  let toggleAuxCalls = 0;

  p.document.querySelector = sel => {
    if (sel.includes('data-side-panel-open="true"')) return auxOpen ? {} : null;
    if (sel.includes('data-agy-max-aux-host')) return maxSidecarVisible ? {} : null;
    if (sel === '[data-testid="overview-panel"]') return overviewVisible ? {} : null;
    return null;
  };

  p.context.__agyNativeAdapter = {
    wrap: el => el,
    installPage: () => true,
    toggleAuxPane: () => { toggleAuxCalls++; auxOpen = !auxOpen; return true; },
    router: () => ({
      subscribe(ev, fn) {
        if (!routerListeners.has(ev)) routerListeners.set(ev, []);
        routerListeners.get(ev).push(fn);
        return () => {};
      }
    })
  };
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.context.__agyInitialSettings = { enabled: true, keepOverviewOpen: true };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => p.context.__agyPowertoolsReceive?.(req.id, req.method === 'settings.get' ? { enabled: true, keepOverviewOpen: true } : {}));
  };

  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 15));

  const navigate = async (pathname, search, nextAuxOpen, nextOverview, nextMaxSidecar) => {
    for (const fn of routerListeners.get('onBeforeNavigate') || []) {
      fn({ toLocation: { pathname, searchStr: search } });
    }
    p.context.location.pathname = pathname;
    p.context.location.search = search;
    auxOpen = nextAuxOpen;
    overviewVisible = nextOverview;
    maxSidecarVisible = nextMaxSidecar;
    for (const fn of routerListeners.get('onResolved') || []) fn();
    await new Promise(r => setTimeout(r, 15));
  };

  // 1. Clicking new-conversation from an open-Overview chat must NOT force-open sidebar on '/'
  for (const fn of p.callbacks.get('click') || []) {
    fn({ type: 'click', target: { closest: sel => sel.includes('new-conversation') ? { getAttribute: () => '/?project=p1' } : null } });
  }
  await navigate('/', '?project=p1', false, false, false);
  assert.equal(toggleAuxCalls, 0, 'new conversation route must not auto-open right sidebar');

  // 2. Sending the first message from a closed new-chat draft into /c/chat-fresh keeps sidebar closed
  await navigate('/c/chat-fresh', '', false, false, false);
  assert.equal(toggleAuxCalls, 0, 'fresh chat created from closed draft must keep sidebar closed');

  // 3. Existing chat with Overview open -> another existing chat DOES carry Overview open
  auxOpen = true;
  overviewVisible = true;
  for (const fn of p.callbacks.get('click') || []) {
    fn({ type: 'click', target: { closest: sel => sel === 'a[href^="/c/"]' ? { getAttribute: () => '/c/chat-b' } : null } });
  }
  await navigate('/c/chat-b', '', false, false, false);
  assert.equal(toggleAuxCalls, 1, 'switching between existing chats should carry open Overview');

  // 4. Existing chat where ONLY Antigravity Max sidecar tab is visible does NOT carry open state into /c/chat-c
  auxOpen = true;
  overviewVisible = false;
  maxSidecarVisible = true;
  for (const fn of p.callbacks.get('click') || []) {
    fn({ type: 'click', target: { closest: sel => sel === 'a[href^="/c/"]' ? { getAttribute: () => '/c/chat-c' } : null } });
  }
  await navigate('/c/chat-c', '', false, false, false);
  assert.equal(toggleAuxCalls, 1, 'Max sidecar-only right pane must not auto-open sidebar on next chat');

  p.context.__agyPowertools.dispose();
});

test('sidebar bell closes Priority panel without navigating away and supports Shift-click quiet open', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/chat-reading';
  const renderedTrees = new Map();
  const navigated = [];
  p.context.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useSyncExternalStore: (_sub, snap) => snap(),
    useEffect: () => {},
    useRef: v => ({ current: v })
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(el) { renderedTrees.set(mount.dataset.agyPowertoolsRoot, el); },
        unmount() { renderedTrees.delete(mount.dataset.agyPowertoolsRoot); }
      };
    }
  };
  p.context.__agyNativeAdapter = {
    wrap: el => el,
    installPage: () => true,
    onEditChange: () => () => {},
    onGoalDetected: () => () => {},
    router: () => ({ navigate: async opts => { navigated.push(opts); } }),
    conversationDirectory: () => ({
      running: [{ id: 'run-bg', title: 'Background Task', projectId: 'p1', projectName: 'proj', updatedAtMs: 2000 }],
      unread: [],
      projects: [],
      byId: { 'run-bg': { id: 'run-bg', title: 'Background Task', projectId: 'p1', projectName: 'proj', running: true, updatedAtMs: 2000 } },
      subagentIds: []
    })
  };
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => p.context.__agyPowertoolsReceive?.(req.id, req.method === 'settings.get' ? { enabled: true, sidebarFocusBell: true } : {}));
  };
  const headerRow = { insertBefore(child) { child.isConnected = true; } };
  const searchBtn = { isConnected: true, parentElement: headerRow, nextSibling: null };
  const navBlock = { isConnected: true, parentElement: { insertBefore(child) { child.isConnected = true; } }, nextSibling: null };
  const sidebarEl = { querySelector: sel => sel.includes('Search') ? searchBtn : sel === '[data-testid="sidebar-navigation-items"]' ? navBlock : null };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  p.document.querySelector = sel => sel.includes('Open Conversation Picker') ? searchBtn : sel.includes('Sidebar') ? sidebarEl : null;
  p.context.__agyInitialSettings = { enabled: true, sidebarFocusBell: true };

  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 10));

  const renderBell = () => {
    const t = renderedTrees.get('sidebar-bell');
    return t.type(t.props);
  };

  // Shift+click opens Priority quietly without navigating away
  renderBell().props.onClick({ shiftKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(navigated.length, 0, 'Shift-click should open Priority without jumping away');
  assert.equal(renderBell().props['aria-pressed'], true);

  // Clicking bell again to CLOSE Priority must NEVER navigate away even when active chat != running[0]
  renderBell().props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(navigated.length, 0, 'closing Priority panel must not hijack current conversation');
  assert.equal(renderBell().props['aria-pressed'], false);

  // Plain click when closed opens Priority and jumps to running session as designed
  renderBell().props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(navigated.length, 1);
  assert.equal(navigated[0].params.cascadeId, 'run-bg');

  p.context.__agyPowertools.dispose();
});
