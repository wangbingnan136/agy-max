import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CHAT_FLOW_DEFAULTS, CHAT_FLOW_KEYS } from './settings.mjs';
import {
  createChatTreeStore,
  OUTSIDE_OF_PROJECT,
  patchProtoStringField
} from './conversation-tree-store.mjs';
import { registerModule } from './service.mjs';
import { fields, string } from '../../lib/protobuf.mjs';
import { createHookBus } from '../core/hook-bus.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nativeClientSource = readFileSync(join(REPO_ROOT, 'lib', 'native-client.js'), 'utf8');
const nativeUiSource = readFileSync(join(REPO_ROOT, 'lib', 'native-ui.js'), 'utf8');
const chatTreeSource = readFileSync(join(REPO_ROOT, 'packages', 'chat-flow', 'native-chat-tree.js'), 'utf8');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = process.getBuiltinModule?.('node:sqlite') || createRequire(import.meta.url)('node:sqlite'));
} catch {}

test('chat-flow package owns inline-images, workbench, and chat-tree scripts', () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, 'module.json'), 'utf8'));
  assert.equal(manifest.id, 'chat-flow');
  assert.equal(manifest.defaultInstalled, true);
  assert.deepEqual(manifest.clientScripts, ['native-inline-images.js', 'prism-workbench.js', 'native-chat-tree.js']);
  assert.equal(existsSync(join(import.meta.dirname, 'native-inline-images.js')), true);
  assert.equal(existsSync(join(import.meta.dirname, 'prism-workbench.js')), true);
  assert.equal(existsSync(join(import.meta.dirname, 'native-chat-tree.js')), true);
  assert.equal(CHAT_FLOW_DEFAULTS.inlineImages, true);
  assert.equal(CHAT_FLOW_DEFAULTS.conversationMove, true);
  assert.equal(CHAT_FLOW_DEFAULTS.btwSubtree, true);
  assert.ok(CHAT_FLOW_KEYS.includes('goalBar'));
  assert.ok(CHAT_FLOW_KEYS.includes('conversationMove'));
  assert.ok(CHAT_FLOW_KEYS.includes('btwSubtree'));
});

test('chat-flow tree store & RPCs persist project moves, SQLite metadata field 18, fold state, and aside detach', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-chat-tree-'));
  try {
    const dataDir = join(root, 'data');
    const appDir = join(root, 'app');
    mkdirSync(join(appDir, 'conversations'), { recursive: true });
    mkdirSync(join(appDir, 'annotations'), { recursive: true });
    writeFileSync(
      join(appDir, 'annotations', 'conv-main.pbtxt'),
      'title:"主对话"  side_question_cascade_ids:"btw-disk"  side_question_titles:{key:"btw-disk"  value:"后台生成的侧边对话概述"}\n',
      'utf8'
    );

    if (DatabaseSync) {
      const convDb = new DatabaseSync(join(appDir, 'conversations', 'conv-main.db'));
      convDb.exec('CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB);');
      const initialBlob = Buffer.concat([
        patchProtoStringField(Buffer.alloc(0), 7, 'file:///workspace/demo'),
        patchProtoStringField(Buffer.alloc(0), 18, 'proj-old')
      ]);
      convDb.prepare('INSERT INTO trajectory_metadata_blob (id, data) VALUES (?, ?)').run('main', initialBlob);
      convDb.close();

      const sumDb = new DatabaseSync(join(appDir, 'conversation_summaries.db'));
      sumDb.exec('CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT "");');
      sumDb.prepare('INSERT INTO conversation_summaries (conversation_id, project_id) VALUES (?, ?)').run('conv-main', 'proj-old');
      sumDb.close();
    }

    const store = createChatTreeStore(dataDir, { appDir });
    const movedToProj = store.moveProject('conv-main', 'proj-new');
    assert.equal(movedToProj.projectId, 'proj-new');

    if (DatabaseSync) {
      const convDb = new DatabaseSync(join(appDir, 'conversations', 'conv-main.db'), { readOnly: true });
      const blob = convDb.prepare('SELECT data FROM trajectory_metadata_blob WHERE id = ?').get('main').data;
      const decoded = fields(blob);
      assert.equal(string(decoded, 7), 'file:///workspace/demo');
      assert.equal(string(decoded, 18), 'proj-new');
      convDb.close();

      const sumDb = new DatabaseSync(join(appDir, 'conversation_summaries.db'), { readOnly: true });
      const sumRow = sumDb.prepare('SELECT project_id FROM conversation_summaries WHERE conversation_id = ?').get('conv-main');
      assert.equal(sumRow.project_id, 'proj-new');
      sumDb.close();
    }

    // Move to outside-of-project (belongs to no project)
    const movedOutside = store.moveProject('conv-main', '');
    assert.equal(movedOutside.projectId, OUTSIDE_OF_PROJECT);
    store.setFolded('conv-main', true);
    store.detachAside('btw-1');

    // Reload from disk and verify via registered chat-flow RPCs
    const curSettings = { ...CHAT_FLOW_DEFAULTS };
    const bus = createHookBus();
    await registerModule(bus, {
      pluginRoot: REPO_ROOT,
      dataDir,
      appDir,
      settings: { get: () => curSettings },
      remote: { markdown: async () => '' }
    });

    const { handled, reply: loaded } = await bus.dispatchRpc('chatTree.get', { method: 'chatTree.get' }, {});
    assert.equal(handled, true);
    assert.equal(loaded.projectOverrides['conv-main'], OUTSIDE_OF_PROJECT);
    assert.deepEqual(loaded.foldedAsides, ['conv-main']);
    assert.deepEqual(loaded.detachedAsides, ['btw-1']);
    assert.equal(loaded.btwMeta['btw-disk']?.parentId, 'conv-main');
    assert.equal(loaded.btwMeta['btw-disk']?.title, '后台生成的侧边对话概述');

    curSettings.conversationMove = false;
    await assert.rejects(
      () => bus.dispatchRpc('chatTree.moveProject', { conversationId: 'conv-main', projectId: 'proj-2' }, {}),
      /已关闭/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sidebar /btw child conversation tree nests under parent, preserves active child when folded, and supports detach & Codex project moves', async () => {
  const dispatched = [];
  const annotationUpdates = [];
  const forkedCalls = [];
  const deletedIds = [];
  const storeSubscribers = new Set();
  let activePath = '/c/main-1';

  const reduxState = {
    sidebarProjects: {
      projects: [
        { id: 'proj-vps', name: 'ubuntu - tencent-vps', folderUris: ['file:///srv/vps'] },
        { id: 'proj-web', name: 'web-frontend', folderUris: ['file:///srv/web'] },
        { id: 'proj-sidecar-1', name: 'agy-max/inspector', folderUris: ['file:///Users/demo/.gemini/antigravity/sidecar_data/agy-max'] },
        { id: 'proj-sidecar-2', name: 'swarm/swarm_board', folderUris: ['file:///tmp/swarm'] }
      ]
    },
    trajectorySummaries: {
      summaries: {
        'main-1': {
          summary: '确认运行中服务的源码路径',
          trajectoryType: 4,
          annotations: {
            sideQuestionCascadeIds: ['btw-1', 'btw-2'],
            sideQuestionTitles: {
              'btw-1': '目前这个2api的限流逻辑是什么',
              'btw-2': '第二个顺便问的问题'
            }
          },
          trajectoryMetadata: { projectId: 'proj-vps' }
        },
        'btw-1': {
          summary: '',
          trajectoryType: 22,
          createdTime: { seconds: 100 },
          annotations: {},
          trajectoryMetadata: { projectId: 'proj-vps' }
        },
        'btw-2': {
          summary: '',
          trajectoryType: 22,
          createdTime: { seconds: 200 },
          annotations: { sideQuestionCascadeIds: ['btw-nested'] },
          trajectoryMetadata: { projectId: 'proj-vps' }
        },
        'btw-nested': {
          summary: '嵌套侧边追问',
          trajectoryType: 22,
          createdTime: { seconds: 250 },
          annotations: {},
          trajectoryMetadata: { projectId: 'proj-vps' }
        },
        'loose-1': {
          summary: '独立测试对话',
          trajectoryType: 4,
          annotations: {},
          trajectoryMetadata: { projectId: OUTSIDE_OF_PROJECT }
        }
      }
    },
    sidePanelV2: {
      viewsByTreeKey: {
        'cascadeId:main-1': {
          tabs: [{ id: 'side_question__btw-new', content: { type: 'sideQuestionView', sideQuestionView: { cascadeId: 'btw-new', parentCascadeId: 'main-1' } } }]
        }
      }
    }
  };

  const mockStore = {
    getState: () => reduxState,
    subscribe(fn) {
      storeSubscribers.add(fn);
      return () => storeSubscribers.delete(fn);
    },
    dispatch(action) {
      dispatched.push(action);
      if (action.type === 'trajectorySummaries/applyStreamBatch') {
        for (const [cid, summaryProto] of action.payload.updates) {
          assert.equal(Array.isArray(summaryProto.workspaces), true, 'summaryProto.workspaces must be an array for byWorkspaceUri index');
          reduxState.trajectorySummaries.summaries[cid] = summaryProto;
        }
        for (const delId of action.payload.deletes) {
          delete reduxState.trajectorySummaries.summaries[delId];
        }
      }
      if (action.type === 'trajectorySummaries/applyOptimisticAnnotationBatch') {
        const { cascadeIds, annotations } = action.payload;
        for (const cid of cascadeIds) {
          const entry = reduxState.trajectorySummaries.summaries[cid];
          if (!entry) continue;
          entry.annotations ||= {};
          if (annotations.title !== undefined) entry.annotations.title = annotations.title;
          if (annotations.projectId !== undefined) {
            entry.trajectoryMetadata ||= {};
            entry.trajectoryMetadata.projectId = annotations.projectId;
          }
          if (annotations.removeSideQuestionCascadeId) {
            entry.annotations.sideQuestionCascadeIds = (entry.annotations.sideQuestionCascadeIds || [])
              .filter(x => x !== annotations.removeSideQuestionCascadeId);
          }
        }
      }
      if (action.type === 'multiConvoLayout/setLayoutFromUrl' && Array.isArray(action.payload?.ids) && action.payload.ids[0]) {
        reduxState.multiConvoLayout = {
          rootNode: { type: 'pane', id: 'pane-1', cascadeId: action.payload.ids[0] },
          focusedPaneId: 'pane-1'
        };
      }
      if (action.type === 'conversation/setCascadeId' && action.payload?.cascadeId) {
        reduxState.conversation = { convoState: { type: 'active', cascadeId: action.payload.cascadeId } };
      }
      // Match real Redux: store.dispatch() synchronously invokes all subscribers before returning!
      for (const sub of [...storeSubscribers]) sub();
    }
  };

  const mockService = {
    forkConversation: async req => {
      forkedCalls.push(req);
      const newId = `promoted-${req.sourceCascadeId}`;
      reduxState.trajectorySummaries.summaries[newId] = {
        summary: '',
        trajectoryType: 4,
        annotations: {},
        trajectoryMetadata: { projectId: 'proj-vps' }
      };
      return { newCascadeId: newId };
    },
    updateConversationAnnotations: async (ids, ann, merge) => {
      annotationUpdates.push({ ids, ann, merge });
    },
    deleteCascadeTrajectory: async id => {
      deletedIds.push(id);
      delete reduxState.trajectorySummaries.summaries[id];
    }
  };

  const rootAnchor = {
    __reactFiber$1: {
      tag: 10,
      type: {},
      memoizedProps: { value: { store: mockStore } },
      return: {
        tag: 10,
        type: {},
        memoizedProps: { value: mockService },
        return: null
      }
    }
  };

  const nativeSidebarItems = args => {
    const out = [];
    for (const g of args.groups || []) {
      out.push({ type: 'header', id: `header-${g.id}`, label: g.label });
      const limit = (args.onlyShowFirstFewConvos?.[g.id] ?? false) ? 1 : g.items.length;
      for (const it of g.items.slice(0, limit)) {
        out.push({ type: 'row', id: it.cascadeId, cascadeId: it.cascadeId, isIndented: g.id !== 'standalone', groupId: g.id });
      }
      if (g.items.length > limit) {
        out.push({ type: 'show-more', id: `show-more-${g.id}`, groupId: g.id, isIndented: true });
      }
    }
    return out;
  };

  const listeners = new Map();
  const dispatchedKeys = [];
  const projHeaders = [];
  const appendedBodyNodes = [];
  const rowWrappers = new Map();
  function makeRowWrap(cid, secId = 'proj-vps', top = 0, bottom = 32) {
    const attrs = new Map([
      ['data-sidebar-row-id', cid],
      ['data-sidebar-section-id', secId]
    ]);
    const children = [];
    const titleParent = {
      firstChild: { name: 'title' },
      insertBefore(node) { children.unshift(node); }
    };
    const rowInner = {
      querySelector(sel) { return sel === '.truncate' ? { parentElement: titleParent } : null; }
    };
    return {
      classList: { contains: () => true },
      getBoundingClientRect: () => ({ left: 0, right: 240, top, bottom, width: 240, height: bottom - top }),
      getAttribute: k => attrs.get(k) ?? null,
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: k => attrs.delete(k),
      querySelector(sel) {
        if (sel === '.agy-sidebar-row') return rowInner;
        if (sel === '[data-agy-btw-fold-btn="1"]') return children.find(c => !c.removed && c.attrs?.get('data-agy-btw-fold-btn') === '1') || null;
        return null;
      },
      appendChild(node) {
        children.push(node);
        return node;
      },
      closest(sel) {
        if (sel.includes('[data-sidebar-row-id]')) return this;
        return null;
      },
      _attrs: attrs,
      _children: children
    };
  }
  rowWrappers.set('main-1', makeRowWrap('main-1', 'proj-vps', 40, 72));
  rowWrappers.set('btw-1', makeRowWrap('btw-1', 'proj-vps', 74, 106));
  rowWrappers.set('btw-2', makeRowWrap('btw-2', 'proj-vps', 108, 140));
  rowWrappers.set('btw-nested', makeRowWrap('btw-nested', 'proj-vps', 142, 174));
  rowWrappers.set('loose-1', makeRowWrap('loose-1', 'standalone', 260, 292));

  const fakeDoc = {
    head: { appendChild() {} },
    body: { appendChild(el) { appendedBodyNodes.push(el); } },
    createElement(tag) {
      const attrs = new Map();
      const kids = [];
      const handlers = {};
      return {
        tag,
        attrs,
        style: {},
        textContent: '',
        className: '',
        setAttribute: (k, v) => attrs.set(k, String(v)),
        getAttribute: k => attrs.get(k) ?? null,
        removeAttribute: k => attrs.delete(k),
        append: (...nodes) => kids.push(...nodes),
        addEventListener: (ev, fn) => { handlers[ev] = fn; },
        querySelector: sel => {
          if (sel === '[data-agy-btw-count="1"]') return kids[1];
          if (sel === '[data-agy-pill-text="1"]') return kids[1];
          return null;
        },
        remove() {
          this.removed = true;
          const idx = appendedBodyNodes.indexOf(this);
          if (idx >= 0) appendedBodyNodes.splice(idx, 1);
        },
        _handlers: handlers
      };
    },
    addEventListener(ev, fn) { listeners.set(ev, fn); },
    removeEventListener(ev) { listeners.delete(ev); },
    dispatchEvent() {},
    // Simulate Antigravity's fullscreen pointer-drag-shield blocking elementFromPoint completely!
    elementFromPoint() { return { dataset: { testid: 'pointer-drag-shield' }, closest: () => null }; },
    querySelector(sel) {
      if (sel.includes('Message input')) return rootAnchor;
      if (sel === '[data-testid="pointer-drag-shield"]') {
        return appendedBodyNodes.find(n => n.getAttribute?.('data-testid') === 'pointer-drag-shield') || null;
      }
      if (sel.includes('conversation-list-sidebar')) {
        return { getBoundingClientRect: () => ({ left: 0, right: 260, top: 0, bottom: 600, width: 260, height: 600 }) };
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-sidebar-row-id]') return [...rowWrappers.values()];
      if (sel === '[data-testid="project-header"]') return projHeaders;
      if (sel === '[data-testid="pointer-drag-shield"]') {
        return appendedBodyNodes.filter(n => n.getAttribute?.('data-testid') === 'pointer-drag-shield');
      }
      if (sel === '[data-agy-project-drop-target="1"]') {
        return [...projHeaders, ...rowWrappers.values()].filter(el => el.getAttribute?.('data-agy-project-drop-target') === '1');
      }
      if (sel === '.surface-composer-card') {
        return composerCards;
      }
      return [];
    }
  };
  const composerCards = [];

  const fakeWin = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener(ev, fn) { listeners.set(ev, fn); },
    removeEventListener(ev) { listeners.delete(ev); },
    dispatchEvent(ev) { dispatchedKeys.push(ev.key); }
  };

  const rpcCalls = [];
  const navigations = [];
  const sandbox = vm.createContext({
    React: {
      Fragment: 'Fragment',
      useState: init => [init, () => {}],
      createElement: (type, props, ...ch) => ({ type, props, ch })
    },
    B: { createElement: (type, props, ...ch) => ({ type, props, ch }) },
    KeyboardEvent: class { constructor(type, init = {}) { this.type = type; this.key = init.key; } },
    YF: { ConversationAnnotationsSchema: { members: 1 } },
    Wb: (_schema, obj) => obj,
    I: {},
    tc: x => x,
    HU: () => 0,
    IJ: null,
    LN: null,
    VD: null,
    document: fakeDoc,
    window: fakeWin,
    location: { get pathname() { return activePath; }, search: '' },
    requestAnimationFrame: fn => { fn(); return 1; },
    cancelAnimationFrame() {},
    CSS: { escape: s => s },
    __agyNativeBindings: {
      names: { resolve: 'sjc', segment: 'Yyc', menu: 'lHc', sidebarItems: 'VWc' },
      dq: 'Icon'
    },
    VWc: nativeSidebarItems
  });
  sandbox.globalThis = sandbox;

  vm.runInContext(nativeClientSource, sandbox);
  vm.runInContext(chatTreeSource, sandbox);

  const adapter = sandbox.__agyNativeAdapter;
  const chatTree = sandbox.__agyCreateChatTree({
    adapter,
    request: async (method, payload) => {
      rpcCalls.push({ method, payload });
      if (method === 'chatTree.get') {
        return {
          projectOverrides: {},
          detachedAsides: [],
          btwMeta: {
            'btw-from-pbtxt': {
              parentId: 'main-1',
              title: '后台自动概述的侧边标题',
              hasBackendSummary: true,
              updatedAtSec: 1700000500,
              createdAtSec: 1700000400,
              stepCount: 4
            }
          }
        };
      }
      return { ok: true };
    },
    options: () => ({ enabled: true, conversationMove: true, btwSubtree: true }),
    currentId: () => activePath.replace('/c/', ''),
    navigateToConversation: async (newId, projectId) => { navigations.push({ newId, projectId }); activePath = `/c/${newId}`; },
    notify() {},
    uiText: zh => zh
  });

  chatTree.sync({ moveEnabled: true, btwEnabled: true });
  await new Promise(r => setImmediate(r));

  // 1. Verify /btw child rows (including flattened nested /btw) render directly beneath main-1
  const groups = [
    { id: 'proj-vps', label: 'ubuntu - tencent-vps', items: [{ cascadeId: 'main-1' }] },
    { id: 'standalone', label: 'Conversations', items: [{ cascadeId: 'loose-1' }] }
  ];
  const flat1 = sandbox.VWc({ groupBy: 'project', groups, onlyShowFirstFewConvos: {} });
  const rowIds1 = JSON.parse(JSON.stringify(
    flat1.filter(x => x.type === 'row').map(x => [x.cascadeId, Boolean(x.agyAside), x.agyParentId || ''])
  ));
  assert.deepEqual(rowIds1, [
    ['main-1', false, ''],
    ['btw-1', true, 'main-1'],
    ['btw-2', true, 'main-1'],
    ['btw-from-pbtxt', true, 'main-1'],
    ['btw-nested', true, 'main-1'],
    ['loose-1', false, '']
  ]);
  // Backend AI summary from pbtxt & sideQuestionTitles hydrated into Redux summaries with IDLE status (even when missing from summaries DB)
  assert.equal(reduxState.trajectorySummaries.summaries['btw-1'].annotations.title, '目前这个2api的限流逻辑是什么');
  assert.equal(reduxState.trajectorySummaries.summaries['btw-from-pbtxt'].summary, '后台自动概述的侧边标题');
  assert.equal(reduxState.trajectorySummaries.summaries['btw-from-pbtxt'].status, 1);
  assert.equal(reduxState.trajectorySummaries.summaries['btw-from-pbtxt'].notFullyIdle, false);
  // Regression guard: never override @tanstack/react-virtual's inline position:absolute on [data-sidebar-row-id]
  assert.equal(/\[data-sidebar-row-id\][^{]*\{\s*position:\s*relative\s*!important/.test(chatTreeSource), false);
  // Main conversation row mounts a left-gutter fold chevron (without shifting title), and child row gets right-indented project marker
  assert.equal(rowWrappers.get('main-1').getAttribute('data-agy-btw-parent'), '1');
  assert.equal(rowWrappers.get('main-1').getAttribute('data-agy-btw-project-parent'), '1');
  assert.equal(rowWrappers.get('main-1').getAttribute('data-agy-btw-folded'), '0');
  const foldBtn = rowWrappers.get('main-1').querySelector('[data-agy-btw-fold-btn="1"]');
  assert.ok(foldBtn, 'Expected fold toggle button on main-1');
  assert.equal(foldBtn.getAttribute('data-folded'), '0');
  assert.equal(foldBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(rowWrappers.get('btw-1').getAttribute('data-agy-btw-child'), '1');
  assert.equal(rowWrappers.get('btw-1').getAttribute('data-agy-btw-project-row'), '1');

  // Clicking the fold button folds all /btw child rows under main-1 and persists via chatTree.setFolded; clicking again unfolds them
  foldBtn._handlers.click({ preventDefault() {}, stopPropagation() {} });
  await new Promise(r => setImmediate(r));
  assert.equal(foldBtn.getAttribute('data-folded'), '1');
  assert.equal(foldBtn.getAttribute('aria-expanded'), 'false');
  assert.ok(rpcCalls.some(c => c.method === 'chatTree.setFolded' && c.payload.parentConversationId === 'main-1' && c.payload.folded === true));
  const flatFolded = sandbox.VWc({ groupBy: 'project', groups, onlyShowFirstFewConvos: {} });
  assert.deepEqual(
    JSON.parse(JSON.stringify(flatFolded.filter(x => x.type === 'row').map(x => x.cascadeId))),
    ['main-1', 'loose-1']
  );

  foldBtn._handlers.click({ preventDefault() {}, stopPropagation() {} });
  await new Promise(r => setImmediate(r));
  assert.equal(foldBtn.getAttribute('data-folded'), '0');
  const flatUnfolded = sandbox.VWc({ groupBy: 'project', groups, onlyShowFirstFewConvos: {} });
  assert.equal(flatUnfolded.filter(x => x.type === 'row').length, 6);

  // 2. Sidecar internal projects (agy-max/inspector, swarm/swarm_board) are filtered out of movableProjects
  const movableIds = Array.from(adapter.movableProjects().map(p => p.id));
  assert.deepEqual(movableIds, ['proj-vps', 'proj-web']);

  // 3. Main conversation right-click menu stays clean without any "移动到项目" submenu (pure drag-and-drop!)
  const mainMenu = chatTree.extendConversationMenu('main-1', {}, [
    { id: 'rename', label: 'Rename' },
    { id: 'pin', label: 'Pin' },
    { id: 'agy-pin-project', label: 'Pin Entire Project' },
    { id: 'mark-read', label: 'Mark Unread' }
  ]);
  assert.deepEqual(Array.from(mainMenu.map(x => x.id)), ['rename', 'pin', 'agy-pin-project', 'mark-read']);

  // 4. Geometry-based sidebar drag-and-drop works even when pointer-drag-shield blocks elementFromPoint:
  //    - Dragging loose-1 over proj-vps header highlights header, shows cursor pill, dispatches Escape to cancel native reorder, and moves to proj-vps!
  const projHeaderBtn = {
    _attrs: new Map([['data-project-label', 'ubuntu - tencent-vps']]),
    __reactFiber$1: { memoizedProps: { projectId: 'proj-vps' }, return: null },
    getBoundingClientRect: () => ({ left: 4, right: 236, top: 8, bottom: 38, width: 232, height: 30 }),
    setAttribute(k, v) { this._attrs.set(k, v); },
    getAttribute(k) { return this._attrs.get(k) ?? null; },
    removeAttribute(k) { this._attrs.delete(k); }
  };
  projHeaders.push(projHeaderBtn);

  listeners.get('pointerdown')({ button: 0, clientX: 40, clientY: 270, target: rowWrappers.get('loose-1') });
  listeners.get('pointermove')({ buttons: 1, clientX: 45, clientY: 22 });
  assert.equal(projHeaderBtn.getAttribute('data-agy-project-drop-target'), '1');
  assert.equal(appendedBodyNodes.length, 1);
  assert.equal(appendedBodyNodes[0].getAttribute('data-testid'), 'agy-drag-move-pill');
  listeners.get('pointerup')({});
  await new Promise(r => setImmediate(r));
  assert.ok(dispatchedKeys.includes('Escape'));
  assert.equal(projHeaderBtn.getAttribute('data-agy-project-drop-target'), null);
  assert.equal(appendedBodyNodes.length, 0);
  assert.equal(adapter.conversationProjectId('loose-1'), 'proj-vps');

  //    - Dragging main-1 onto standalone row loose-1 (or standalone section) moves it to OUTSIDE_OF_PROJECT, then back onto proj-vps row!
  await chatTree.moveConversation('main-1', OUTSIDE_OF_PROJECT);
  assert.equal(adapter.conversationProjectId('main-1'), OUTSIDE_OF_PROJECT);
  listeners.get('pointerdown')({ button: 0, clientX: 40, clientY: 270, target: rowWrappers.get('main-1') });
  listeners.get('pointermove')({ buttons: 1, clientX: 42, clientY: 90 }); // hits btw-1 row inside proj-vps!
  listeners.get('pointerup')({});
  await new Promise(r => setImmediate(r));
  assert.equal(adapter.conversationProjectId('main-1'), 'proj-vps');

  // 4b. Anti-freeze guards:
  //     - HTML5 dragstart on sidebar row is prevented so browser never hijacks pointerup
  //     - Window blur mid-drag aborts native Vad shield, clears cursor:grabbing, and removes orphaned pointer-drag-shield
  //     - mouseup fallback commits move even when OS drops pointerup
  let dragPrevented = false;
  listeners.get('dragstart')({ target: rowWrappers.get('loose-1'), preventDefault() { dragPrevented = true; } });
  assert.equal(dragPrevented, true);

  await chatTree.moveConversation('loose-1', OUTSIDE_OF_PROJECT);
  assert.equal(adapter.conversationProjectId('loose-1'), OUTSIDE_OF_PROJECT);
  listeners.get('pointerdown')({ button: 0, clientX: 40, clientY: 270, target: rowWrappers.get('loose-1') });
  // Simulate Antigravity's Vad mounting pointer-drag-shield + cursor:grabbing once drag crosses threshold:
  const stuckShield = fakeDoc.createElement('div');
  stuckShield.setAttribute('data-testid', 'pointer-drag-shield');
  appendedBodyNodes.push(stuckShield);
  fakeDoc.body.style = { cursor: 'grabbing', userSelect: 'none' };
  listeners.get('pointermove')({ buttons: 1, clientX: 45, clientY: 22 });
  assert.equal(projHeaderBtn.getAttribute('data-agy-project-drop-target'), '1');
  listeners.get('blur')({});
  assert.equal(projHeaderBtn.getAttribute('data-agy-project-drop-target'), null);
  assert.equal(appendedBodyNodes.length, 0, 'Both drag pill and orphaned pointer-drag-shield must be cleaned up on blur');
  assert.equal(fakeDoc.body.style.cursor, '');

  listeners.get('pointerdown')({ button: 0, clientX: 40, clientY: 270, target: rowWrappers.get('loose-1') });
  listeners.get('pointermove')({ buttons: 1, clientX: 45, clientY: 22 });
  // Simulate macOS trackpad dropping pointerup and only firing mouseup:
  listeners.get('mouseup')({});
  await new Promise(r => setImmediate(r));
  assert.equal(adapter.conversationProjectId('loose-1'), 'proj-vps');

  // 4c. activateConversationPane dispatches multiConvoLayout/setLayoutFromUrl + conversation/setCascadeId
  //     EVEN AFTER projectOverrides is non-empty (regression guard against synchronous store.subscribe recursion!)
  assert.ok(rpcCalls.some(c => c.method === 'chatTree.moveProject' && c.payload.conversationId === 'loose-1' && c.payload.projectId === 'proj-vps'));
  assert.equal(adapter.activateConversationPane('btw-1'), true);
  assert.equal(reduxState.multiConvoLayout?.rootNode?.cascadeId, 'btw-1');
  assert.equal(reduxState.conversation?.convoState?.cascadeId, 'btw-1');
  assert.equal(adapter.activateConversationPane('main-1'), true);
  assert.equal(reduxState.multiConvoLayout?.rootNode?.cascadeId, 'main-1');
  assert.equal(reduxState.conversation?.convoState?.cascadeId, 'main-1');

  // 5. /btw child menu offers "独立为主对话" (detach) instead of top-level Move to Project
  const childMenu = chatTree.extendConversationMenu('btw-1', {}, [{ id: 'rename', label: 'Rename' }]);
  assert.equal(childMenu.some(x => x.id === 'agy-move-to-project'), false);
  const detachItem = childMenu.find(x => x.id === 'agy-btw-detach');
  assert.ok(detachItem);
  await detachItem.onClick();
  assert.equal(forkedCalls.length, 1);
  assert.equal(forkedCalls[0].sourceCascadeId, 'btw-1');
  assert.ok(deletedIds.includes('btw-1'));
  assert.equal(navigations.at(-1)?.newId, 'promoted-btw-1');

  // 6. Newly created /btw conversation auto-closes cramped right sideQuestionView tab & navigates main pane when idle
  activePath = '/c/main-1';
  reduxState.trajectorySummaries.summaries['btw-new'] = {
    summary: '新发起的侧边对话',
    trajectoryType: 22,
    annotations: {},
    trajectoryMetadata: { projectId: OUTSIDE_OF_PROJECT }
  };
  reduxState.trajectorySummaries.summaries['main-1'].annotations.sideQuestionCascadeIds.push('btw-new');
  for (const sub of storeSubscribers) sub();
  await new Promise(r => setImmediate(r));
  assert.ok(dispatched.some(a => a.type === 'sidePanelV2/closeTabs' && a.payload.tabIds.includes('side_question__btw-new')));
  assert.equal(activePath, '/c/btw-new');

  // 7. Dragging any sidebar conversation (including /btw child rows, even with moveEnabled=false) into a composer card
  //    highlights the card, shows reference pill, attaches reference, suppresses click navigation, and supports HTML5 drop
  const attachedConvos = [];
  adapter.attachConversationToComposer = async (info, card) => {
    attachedConvos.push({ ...info, card });
    return { ok: true, mode: 'mention' };
  };
  const composerCard = fakeDoc.createElement('div');
  composerCard.getBoundingClientRect = () => ({ left: 360, right: 920, top: 580, bottom: 720, width: 560, height: 140 });
  composerCards.push(composerCard);

  chatTree.sync({ enabled: true, moveEnabled: false, btwEnabled: true });
  activePath = '/c/main-1';
  listeners.get('pointerdown')({ button: 0, clientX: 40, clientY: 120, target: rowWrappers.get('btw-2') });
  listeners.get('pointermove')({ buttons: 1, clientX: 520, clientY: 640 });
  assert.equal(composerCard.getAttribute('data-agy-convo-drop-target'), '1');
  assert.equal(appendedBodyNodes.length, 1);
  assert.match(appendedBodyNodes[0].querySelector('[data-agy-pill-text="1"]').textContent, /^松手引用「/);
  listeners.get('pointerup')({});
  await new Promise(r => setImmediate(r));
  assert.equal(composerCard.getAttribute('data-agy-convo-drop-target'), null);
  assert.equal(attachedConvos.length, 1);
  assert.equal(attachedConvos[0].id, 'btw-2');

  // Trailing click right after composer drop is swallowed and must not activate btw-2 pane
  let clickStopped = false;
  listeners.get('click')({
    target: rowWrappers.get('btw-2'),
    preventDefault() {},
    stopPropagation() { clickStopped = true; },
    stopImmediatePropagation() { clickStopped = true; }
  });
  assert.equal(clickStopped, true);
  assert.notEqual(reduxState.conversation?.convoState?.cascadeId, 'btw-2');

  // HTML5 draggable="true" row (chatModeBeta) is not blocked on dragstart and drops cleanly via text/agy-conversation-id
  rowWrappers.get('loose-1').setAttribute('draggable', 'true');
  let html5Prevented = false;
  listeners.get('dragstart')({ target: rowWrappers.get('loose-1'), preventDefault() { html5Prevented = true; } });
  assert.equal(html5Prevented, false);
  const dt = {
    types: ['text/agy-conversation-id'],
    dropEffect: 'none',
    getData: k => (k === 'text/agy-conversation-id' ? 'loose-1' : '')
  };
  listeners.get('dragover')({ clientX: 500, clientY: 640, dataTransfer: dt, preventDefault() {} });
  assert.equal(composerCard.getAttribute('data-agy-convo-drop-target'), '1');
  listeners.get('drop')({ clientX: 500, clientY: 640, dataTransfer: dt, preventDefault() {}, stopPropagation() {} });
  await new Promise(r => setImmediate(r));
  assert.equal(composerCard.getAttribute('data-agy-convo-drop-target'), null);
  assert.equal(attachedConvos.length, 2);
  assert.equal(attachedConvos[1].id, 'loose-1');

  // Disabling chat-flow unmounts listeners cleanly
  chatTree.sync({ enabled: false, moveEnabled: false, btwEnabled: false });
  assert.equal(listeners.has('pointerdown'), false);
  assert.equal(listeners.has('drop'), false);

  chatTree.dispose();
  adapter.dispose();
});

test('extendedMenu nests Copy Conversation as Markdown inside the native Copy submenu', () => {
  const nodes = [];
  const mkNode = () => ({
    dataset: {},
    isConnected: false,
    append(c) { c.isConnected = true; },
    setAttribute() {},
    addEventListener() {},
    remove() { this.isConnected = false; }
  });
  const doc = {
    readyState: 'complete',
    head: mkNode(),
    body: mkNode(),
    documentElement: { toggleAttribute() {}, removeAttribute() {}, hasAttribute: () => false },
    createElement() { const n = mkNode(); nodes.push(n); return n; },
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const ctx = vm.createContext({
    document: doc,
    location: { pathname: '/' },
    AbortController,
    React: { createElement: (t, p, ...c) => ({ t, p, c }) },
    ReactDOM: { createRoot() { throw new Error('unused'); } },
    HC() {},
    dq: ({ name }) => ({ icon: name }),
    lHc: () => [
      { id: 'rename', label: 'Rename' },
      {
        id: 'copy',
        type: 'submenu',
        label: 'Copy',
        items: [
          { id: 'copy-0', label: 'Conversation Name' },
          { id: 'copy-1', label: 'Conversation ID' }
        ]
      },
      { id: 'split', type: 'submenu', label: 'Split', items: [] }
    ],
    __agyNativeBindings: { names: { menu: 'lHc' } },
    __agyNativeAdapter: { wrap() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {}
  });
  vm.runInContext(nativeUiSource, ctx);
  const menuItems = ctx.lHc('conv-123', {});
  // Top-level menu does NOT have duplicate agy-copy-session-md
  assert.equal(menuItems.some(it => it.id === 'agy-copy-session-md'), false);
  // Instead it is nested cleanly inside the Copy submenu!
  const copySub = menuItems.find(it => it.id === 'copy');
  assert.ok(copySub);
  assert.ok(copySub.items.some(it => it.id === 'agy-copy-session-md'));
  ctx.__agyPowertools.dispose();
});

test('corrupt state file is backed up and starts empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-ct-corrupt-'));
  try {
    writeFileSync(join(dir, 'chat-flow-tree.json'), '{not json');
    const store = createChatTreeStore(dir);
    assert.deepEqual(store.get().projectOverrides, {});
    const backups = readdirSync(dir).filter(f => f.startsWith('chat-flow-tree.json.corrupt-'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), '{not json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unreadable state file does not wipe saved state on write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-ct-ebusy-'));
  try {
    const filePath = join(dir, 'chat-flow-tree.json');
    // A directory where the file should be makes readFileSync fail with a non-ENOENT error (EISDIR), like EBUSY/EACCES.
    mkdirSync(filePath);
    const store = createChatTreeStore(dir);
    assert.deepEqual(store.get().projectOverrides, {});
    assert.throws(() => store.moveProject('conv-1', 'proj-1'));
    assert.throws(() => store.setFolded('conv-1', true));

    rmSync(filePath, { recursive: true, force: true });
    writeFileSync(filePath, JSON.stringify({ projectOverrides: { 'conv-1': 'proj-1' } }));
    // The failed read was not cached as an empty state, so the saved override is visible again.
    assert.equal(store.get().projectOverrides['conv-1'], 'proj-1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('patchProtoStringField rejects malformed blobs and keeps other fields intact', () => {
  // Field 18, wire type 2, claims 5 bytes but only 1 follows.
  assert.throws(() => patchProtoStringField(Buffer.from([0x92, 0x01, 0x05, 0x61]), 18, 'x'), /overruns/);
  // Truncated varint tag.
  assert.throws(() => patchProtoStringField(Buffer.from([0x80]), 18, 'x'), /truncated/);
  // Unsupported wire type 3 (start group).
  assert.throws(() => patchProtoStringField(Buffer.from([0x0b]), 18, 'x'), /wire type 3/);

  const base = Buffer.concat([
    Buffer.from([0x08, 0x2a]),
    patchProtoStringField(Buffer.alloc(0), 7, 'file:///workspace/demo'),
    patchProtoStringField(Buffer.alloc(0), 18, 'proj-old')
  ]);
  const patched = patchProtoStringField(base, 18, 'proj-new');
  assert.deepEqual(patched.subarray(0, 2), Buffer.from([0x08, 0x2a]));
  const decoded = fields(patched);
  assert.equal(string(decoded, 7), 'file:///workspace/demo');
  assert.equal(string(decoded, 18), 'proj-new');
});
