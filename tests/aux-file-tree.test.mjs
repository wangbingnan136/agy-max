import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createWorkspaceExplorer } from '../lib/workspace-explorer.mjs';
import { nativeSource } from '../lib/native-host.mjs';
import { DEFAULT_SETTINGS } from '../lib/settings.mjs';
import { toZhTw } from '../lib/zh-tw.mjs';

const auxTreeSource = readFileSync(new URL('../packages/workspace-nav/aux-file-tree.js', import.meta.url), 'utf8');

function findByTestId(node, id) {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.['data-testid'] === id) return node;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const hit = findByTestId(child, id);
      if (hit) return hit;
    }
  }
  return null;
}

function findAllByTestId(node, id, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.props?.['data-testid'] === id) out.push(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) findAllByTestId(child, id, out);
  }
  return out;
}

function collectText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  if (typeof node === 'object' && Array.isArray(node.children)) return node.children.map(collectText).join(' ');
  return '';
}

function createAuxTreeHarness({ conversationId = 'conv-1', workspaceUri = '', recentWorkspaces = [], requestHandler = async () => ({}), confirm } = {}) {
  let stateSlots = [];
  let hookIdx = 0;
  let effects = [];
  const rootAttrs = new Map([['data-agy-right-rail', '1'], ['data-agy-right-rail-open', '1']]);
  const customSidePanels = new Map();
  const contextMenus = [];
  const attachedFiles = [];
  const listeners = new Set();

  const R = {
    createElement(type, props, ...children) {
      const flat = [];
      const push = item => {
        if (Array.isArray(item)) item.forEach(push);
        else if (item !== null && item !== undefined && item !== false) flat.push(item);
      };
      children.forEach(push);
      return { type, props: props || {}, children: flat };
    },
    useState(init) {
      const i = hookIdx++;
      if (!(i in stateSlots)) stateSlots[i] = typeof init === 'function' ? init() : init;
      const setState = next => {
        stateSlots[i] = typeof next === 'function' ? next(stateSlots[i]) : next;
      };
      return [stateSlots[i], setState];
    },
    useCallback(fn) { return fn; },
    useRef(init) {
      const i = hookIdx++;
      if (!(i in stateSlots)) stateSlots[i] = { current: init };
      return stateSlots[i];
    },
    useEffect(fn, deps) {
      const i = hookIdx++;
      const prev = stateSlots[i];
      const changed = !Array.isArray(deps) || !Array.isArray(prev) || deps.length !== prev.length || deps.some((v, idx) => !Object.is(v, prev[idx]));
      stateSlots[i] = deps;
      if (changed) effects.push(fn);
    }
  };

  const doc = {
    documentElement: {
      setAttribute(k, v) { rootAttrs.set(k, v); },
      removeAttribute(k) { rootAttrs.delete(k); }
    },
    head: { appendChild() {} },
    querySelectorAll() { return []; },
    createElement(tag) {
      return { tag, style: {}, setAttribute() {}, remove() {} };
    }
  };

  const env = {
    options: () => ({ ...DEFAULT_SETTINGS }),
    uiText: (zh, en) => zh || en,
    currentId: () => conversationId,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    adapter: {
      workspaceUri: () => workspaceUri,
      recentWorkspaces: () => recentWorkspaces,
      attachFileToComposer: async item => { attachedFiles.push(item); },
      setCustomSidePanel(key, descriptor) {
        if (descriptor) customSidePanels.set(key, descriptor);
        else customSidePanels.delete(key);
        return true;
      }
    },
    request: (method, payload) => requestHandler(method, payload),
    showFileContextMenu: info => contextMenus.push(info),
    notify() {}
  };

  const context = vm.createContext({
    React: R,
    document: doc,
    setTimeout,
    clearTimeout,
    decodeURIComponent,
    confirm
  });
  vm.runInContext(auxTreeSource, context);
  const auxTree = context.__agyCreateAuxFileTree(env);

  async function render() {
    const descriptor = customSidePanels.get(auxTree.PANE_KEY);
    const Pane = descriptor?.Content || auxTree.FileTreePane;
    hookIdx = 0;
    effects = [];
    Pane({});
    const pendingEffects = [...effects];
    effects = [];
    for (const eff of pendingEffects) eff();
    await new Promise(r => setTimeout(r, 10));
    hookIdx = 0;
    effects = [];
    return Pane({});
  }

  return {
    auxTree,
    render,
    rootAttrs,
    customSidePanels,
    contextMenus,
    attachedFiles,
    setConversation(nextId, nextWsUri = '') {
      conversationId = nextId;
      workspaceUri = nextWsUri;
      for (const fn of listeners) fn();
    }
  };
}

test('workspace-explorer lists directories folders-first, filters files, previews code/notebooks, and enforces workspace containment', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-explorer-'));
  try {
    const dataDir = join(root, 'data');
    const appDir = join(root, 'app');
    const homeDir = join(root, 'home');
    const projDir = join(homeDir, 'projects', 'demo-multimodal');
    const outsideDir = join(root, 'outside');
    const sshDir = join(homeDir, '.ssh');

    mkdirSync(join(projDir, 'experiment', 'fold1'), { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(join(projDir, 'README.md'), '# Demo Project\nHello world\n');
    writeFileSync(join(projDir, 'experiment', 'fold1', 'summary.ipynb'), JSON.stringify({
      cells: [
        { cell_type: 'markdown', source: ['## Ablation Summary\n'] },
        { cell_type: 'code', execution_count: 2, source: ['print(0.952)\n'], outputs: [{ text: ['0.952\n'] }] }
      ]
    }));
    writeFileSync(join(projDir, 'experiment', 'fold1', 'report.pdf'), '%PDF-1.4 binary mock');
    writeFileSync(join(outsideDir, 'secret.txt'), 'outside secret');
    writeFileSync(join(sshDir, 'id_ed25519'), 'PRIVATE KEY');

    try {
      symlinkSync(outsideDir, join(projDir, 'escape-link'), 'dir');
    } catch { /* Symlinks on restricted Windows setups are optional. */ }

    const runCommand = async (cmd, args) => {
      const commandLine = `${cmd} ${(args || []).join(' ')}`;
      if (
        commandLine.includes('choose folder') ||
        commandLine.includes('FolderBrowserDialog') ||
        commandLine.includes('--directory')
      ) {
        return { ok: true, code: 0, stdout: `${projDir}\n`, stderr: '' };
      }
      return { ok: false, code: 1, stdout: '', stderr: 'User canceled (-128)' };
    };

    const explorer = createWorkspaceExplorer({
      dataDir,
      appDir,
      homeDir,
      platform: process.platform,
      runCommand
    });

    for (const targetPlatform of ['darwin', 'win32', 'linux']) {
      const crossExplorer = createWorkspaceExplorer({
        dataDir: join(root, `data-${targetPlatform}`),
        appDir,
        homeDir,
        platform: targetPlatform,
        runCommand
      });
      const crossPicked = await crossExplorer.pickFolder();
      assert.equal(crossPicked.cancelled, false);
      assert.equal(crossPicked.name, 'demo-multimodal');
    }

    const picked = await explorer.pickFolder();
    assert.equal(picked.cancelled, false);
    assert.equal(picked.name, 'demo-multimodal');

    const recents = explorer.recentWorkspaces();
    assert.equal(recents.length, 1);
    assert.equal(recents[0].name, 'demo-multimodal');

    const dirListing = explorer.listDir({ rootUri: picked.uri });
    assert.deepEqual(
      dirListing.entries.map(e => `${e.isDirectory ? 'd' : 'f'}:${e.name}`),
      ['d:experiment', 'f:README.md']
    );

    assert.throws(() => explorer.listDir({ rootUri: picked.uri, relPath: '../../outside' }), /超出当前工作区|不存在/);
    assert.throws(() => explorer.mountWorkspace(sshDir), /敏感/);

    const searched = explorer.searchFiles({ rootUri: picked.uri, query: 'summary' });
    assert.equal(searched.entries.length, 1);
    assert.equal(searched.entries[0].relPath, 'experiment/fold1/summary.ipynb');

    const textPrev = explorer.readFilePreview({
      rootUri: picked.uri,
      fileUri: pathToFileURL(join(projDir, 'README.md')).href
    });
    assert.equal(textPrev.kind, 'text');
    assert.match(textPrev.content, /Demo Project/);
    assert.equal(textPrev.editable, true);

    const readmePath = join(projDir, 'README.md');
    const readmeUri = pathToFileURL(readmePath).href;
    const stale = explorer.writeTextFile({ rootUri: picked.uri, fileUri: readmeUri, content: '# Mine\n', expectedMtimeMs: textPrev.mtimeMs - 1000 });
    assert.equal(stale.conflict, true);
    assert.match(readFileSync(readmePath, 'utf8'), /Demo Project/);
    const saved = explorer.writeTextFile({ rootUri: picked.uri, fileUri: readmeUri, content: '# Mine\n', expectedMtimeMs: textPrev.mtimeMs });
    assert.equal(saved.ok, true);
    assert.equal(readFileSync(readmePath, 'utf8'), '# Mine\n');
    assert.equal(explorer.writeTextFile({ rootUri: picked.uri, fileUri: readmeUri, content: '# Forced\n', expectedMtimeMs: 0, overwrite: true }).ok, true);
    assert.equal(readFileSync(readmePath, 'utf8'), '# Forced\n');
    assert.throws(() => explorer.writeTextFile({ rootUri: picked.uri, fileUri: pathToFileURL(join(outsideDir, 'secret.txt')).href, content: 'x', overwrite: true }), /不在当前已授权/);
    assert.equal(readFileSync(join(outsideDir, 'secret.txt'), 'utf8'), 'outside secret');

    writeFileSync(join(projDir, 'gbk.txt'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
    assert.equal(explorer.readFilePreview({ rootUri: picked.uri, fileUri: pathToFileURL(join(projDir, 'gbk.txt')).href }).editable, false);

    const nbPrev = explorer.readFilePreview({
      rootUri: picked.uri,
      fileUri: searched.entries[0].uri
    });
    assert.equal(nbPrev.kind, 'notebook');
    assert.equal(nbPrev.cells.length, 2);
    assert.match(nbPrev.cells[1].output, /0\.952/);

    const binPrev = explorer.readFilePreview({
      rootUri: picked.uri,
      fileUri: pathToFileURL(join(projDir, 'experiment', 'fold1', 'report.pdf')).href
    });
    assert.equal(binPrev.kind, 'binary');

    assert.throws(() => explorer.readFilePreview({
      rootUri: picked.uri,
      fileUri: pathToFileURL(join(outsideDir, 'secret.txt')).href
    }), /不在当前已授权/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('aux-file-tree removes legacy right-rail attributes, registers into native customSidePanels, and browses/previews files', async () => {
  assert.equal(/^\s*(?:import|export)\b/m.test(auxTreeSource), false);
  assert.equal(auxTreeSource.includes('\u00b7'), false);
  assert.equal(toZhTw(auxTreeSource).includes('\u00b7'), false);

  const bundled = nativeSource('https://127.0.0.1:41234', ['a']);
  assert.ok(bundled.includes('__agyCreateAuxFileTree'));
  assert.equal(bundled.includes('__agyCreateRightRail'), false);

  const demoUri = 'file:///Users/test/demo-repo';
  const h = createAuxTreeHarness({
    workspaceUri: '',
    recentWorkspaces: [{ uri: demoUri, path: '/Users/test/demo-repo', name: 'demo-repo', updatedAtMs: 100 }],
    requestHandler: async (method, payload) => {
      if (method === 'workspace.recent') return { ok: true, workspaces: payload.clientWorkspaces };
      if (method === 'workspace.mount') return { ok: true, uri: payload.uri, name: 'demo-repo', path: '/Users/test/demo-repo' };
      if (method === 'workspace.listDir') {
        return {
          ok: true,
          rootUri: demoUri,
          rootName: 'demo-repo',
          rootPath: '/Users/test/demo-repo',
          entries: [
            { name: 'experiment', relPath: 'experiment', uri: `${demoUri}/experiment`, isDirectory: true },
            { name: 'summary.ipynb', relPath: 'summary.ipynb', uri: `${demoUri}/summary.ipynb`, isDirectory: false }
          ]
        };
      }
      if (method === 'workspace.readFile') {
        return {
          ok: true,
          kind: 'text',
          name: 'summary.ipynb',
          path: '/Users/test/demo-repo/summary.ipynb',
          uri: payload.fileUri,
          size: 42,
          content: 'notebook preview text'
        };
      }
      if (method === 'file.attach') {
        return { ok: true, uri: payload.uri };
      }
      return { ok: true };
    }
  });

  // Cleans up any legacy right-rail attributes and registers native aux-pane entry
  assert.equal(h.rootAttrs.has('data-agy-right-rail'), false);
  assert.equal(h.rootAttrs.has('data-agy-right-rail-open'), false);
  h.auxTree.sync({ enabled: true });
  const descriptor = h.customSidePanels.get('agyFileTree');
  assert.ok(descriptor);
  assert.equal(descriptor.icon, 'folder');
  assert.equal(descriptor.plusMenuEntry?.label, '文件结构');
  assert.equal(descriptor.plusMenuEntry?.icon, 'folder');
  assert.equal(descriptor.hideFindInPane, true);

  // Unlinked conversation renders folder picker + recent projects inside the aux pane
  let tree = await h.render();
  assert.ok(findByTestId(tree, 'agy-ftree-pick-folder'));
  const recentBtn = findByTestId(tree, 'agy-ftree-recent-item');
  assert.ok(recentBtn);
  assert.match(collectText(recentBtn), /demo-repo/);

  // Mounting a recent project displays filter input + folder-first file tree
  await recentBtn.props.onClick();
  tree = await h.render();
  assert.ok(findByTestId(tree, 'agy-ftree-filter'));
  const fileRows = findAllByTestId(tree, 'agy-ftree-file-row');
  assert.equal(fileRows.length, 1);
  assert.match(collectText(fileRows[0]), /summary\.ipynb/);

  // Right-click triggers native file context menu
  fileRows[0].props.onContextMenu({
    clientX: 120,
    clientY: 200,
    currentTarget: {},
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(h.contextMenus.length, 1);
  assert.equal(h.contextMenus[0].uri, `${demoUri}/summary.ipynb`);

  // Clicking file row opens inline preview and supports attaching to chat
  await fileRows[0].props.onClick();
  tree = await h.render();
  const previewNode = findByTestId(tree, 'agy-ftree-preview');
  assert.ok(previewNode);
  assert.match(collectText(previewNode), /notebook preview text/);
  findByTestId(tree, 'agy-ftree-preview-attach').props.onClick({ currentTarget: {} });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(h.attachedFiles.length, 1);

  // Disabling or disposing removes the entry from customSidePanels cleanly
  h.auxTree.sync({ enabled: false });
  assert.equal(h.customSidePanels.has('agyFileTree'), false);
  h.auxTree.sync({ enabled: true });
  assert.equal(h.customSidePanels.has('agyFileTree'), true);

  // New conversation ('') mounting a folder carries it forward when the first message creates /c/conv-new
  const draftHarness = createAuxTreeHarness({
    conversationId: '',
    workspaceUri: '',
    recentWorkspaces: [{ uri: demoUri, path: '/Users/test/demo-repo', name: 'demo-repo', updatedAtMs: 100 }],
    requestHandler: async (method, payload) => {
      if (method === 'workspace.recent') return { ok: true, workspaces: payload.clientWorkspaces };
      if (method === 'workspace.mount') return { ok: true, uri: payload.uri, name: 'demo-repo', path: '/Users/test/demo-repo' };
      if (method === 'workspace.listDir') {
        return {
          ok: true,
          rootUri: demoUri,
          rootName: 'demo-repo',
          rootPath: '/Users/test/demo-repo',
          entries: [{ name: 'README.md', relPath: 'README.md', uri: `${demoUri}/README.md`, isDirectory: false }]
        };
      }
      return { ok: true };
    }
  });
  draftHarness.auxTree.sync({ enabled: true });
  let draftTree = await draftHarness.render();
  await findByTestId(draftTree, 'agy-ftree-recent-item').props.onClick();
  draftTree = await draftHarness.render();
  assert.ok(findByTestId(draftTree, 'agy-ftree-filter'));
  draftHarness.setConversation('conv-created-from-draft', '');
  draftTree = await draftHarness.render();
  assert.ok(findByTestId(draftTree, 'agy-ftree-filter'));

  h.auxTree.dispose();
  assert.equal(h.customSidePanels.has('agyFileTree'), false);
});

test('aux-file-tree edits text files inline, keeps CRLF, and asks before overwriting outside changes', async () => {
  const demoUri = 'file:///Users/test/demo-repo';
  const writes = [];
  const h = createAuxTreeHarness({
    workspaceUri: demoUri,
    confirm: () => true,
    requestHandler: async (method, payload) => {
      if (method === 'workspace.listDir') {
        return { ok: true, rootUri: demoUri, rootName: 'demo-repo', entries: [{ name: 'a.py', relPath: 'a.py', uri: `${demoUri}/a.py`, isDirectory: false }] };
      }
      if (method === 'workspace.readFile') {
        return { ok: true, kind: 'text', name: 'a.py', path: '/Users/test/demo-repo/a.py', uri: payload.fileUri, size: 14, mtimeMs: 5, editable: true, content: 'x = 1\r\ny = 2\r\n' };
      }
      if (method === 'workspace.writeFile') {
        writes.push(payload);
        return writes.length === 1 ? { ok: false, conflict: true, mtimeMs: 9 } : { ok: true, mtimeMs: 10, size: 15 };
      }
      return { ok: true };
    }
  });
  h.auxTree.sync({ enabled: true });
  let tree = await h.render();
  await findAllByTestId(tree, 'agy-ftree-file-row')[0].props.onClick();
  tree = await h.render();
  findByTestId(tree, 'agy-ftree-preview-edit').props.onClick();
  tree = await h.render();
  assert.equal(findByTestId(tree, 'agy-ftree-editor').props.value, 'x = 1\ny = 2\n');
  assert.equal(findByTestId(tree, 'agy-ftree-preview-save').props.disabled, true);

  findByTestId(tree, 'agy-ftree-editor').props.onChange({ target: { value: 'x = 42\ny = 2\n' } });
  tree = await h.render();
  assert.equal(findByTestId(tree, 'agy-ftree-preview-save').props.disabled, false);

  // Cmd+S: the first write reports an outside change, confirm() approves, so it retries with overwrite.
  let prevented = false;
  findByTestId(tree, 'agy-ftree-editor').props.onKeyDown({ metaKey: true, key: 's', preventDefault() { prevented = true; }, stopPropagation() {} });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(prevented, true);
  assert.deepEqual(writes.map(w => w.overwrite), [false, true]);
  assert.equal(writes[0].content, 'x = 42\r\ny = 2\r\n');
  assert.equal(writes[0].expectedMtimeMs, 5);

  tree = await h.render();
  assert.ok(findByTestId(tree, 'agy-ftree-editor'));
  assert.equal(findByTestId(tree, 'agy-ftree-preview-save').props.disabled, true);
});

test('aux-file-tree reuses Windows drive cache keys, renders malformed escapes, and searches Windows paths', async () => {
  const requests = [];
  const h = createAuxTreeHarness({
    workspaceUri: 'file:///C:/broken%name',
    async requestHandler(method, payload) {
      requests.push({ method, payload });
      return { ok: true, entries: [] };
    }
  });
  h.auxTree.sync({ enabled: true });
  let tree = await h.render();
  assert.match(JSON.stringify(tree), /broken%name/);
  h.setConversation('conv-1', 'file:///c:/broken%name');
  tree = await h.render();
  assert.equal(requests.filter(({ method }) => method === 'workspace.listDir').length, 1);
  findByTestId(tree, 'agy-ftree-filter').props.onChange({ target: { value: 'src\\lib\\target.ts' } });
  await h.render();
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.deepEqual(JSON.parse(JSON.stringify(requests.find(({ method }) => method === 'workspace.searchFiles').payload)), {
    rootUri: 'file:///c:/broken%name', query: 'src/lib/target.ts'
  });
});

test('aux-file-tree saves LF-dominant mixed text without converting LF lines to CRLF', async () => {
  const workspaceUri = 'file:///C:/repo';
  const writes = [];
  const h = createAuxTreeHarness({
    workspaceUri,
    async requestHandler(method, payload) {
      if (method === 'workspace.listDir') {
        return { ok: true, entries: [{ name: 'mixed.txt', relPath: 'mixed.txt', uri: workspaceUri + '/mixed.txt' }] };
      }
      if (method === 'workspace.readFile') {
        return { ok: true, kind: 'text', name: 'mixed.txt', uri: payload.fileUri, editable: true, content: 'one\r\ntwo\nthree\n' };
      }
      if (method === 'workspace.writeFile') writes.push(payload.content);
      return { ok: true };
    }
  });
  h.auxTree.sync({ enabled: true });
  let tree = await h.render();
  findByTestId(tree, 'agy-ftree-file-row').props.onClick();
  tree = await h.render();
  findByTestId(tree, 'agy-ftree-preview-edit').props.onClick();
  tree = await h.render();
  findByTestId(tree, 'agy-ftree-editor').props.onChange({ target: { value: 'one\ntwo\nupdated\n' } });
  tree = await h.render();
  findByTestId(tree, 'agy-ftree-preview-save').props.onClick();
  await h.render();
  assert.deepEqual(writes, ['one\ntwo\nupdated\n']);
});

test('aux-file-tree registers unapproved host workspace via workspace.recent and retries listDir seamlessly', async () => {
  const workspaceUri = 'file:///Users/dev/older-project';
  let authorized = false;
  const calls = [];
  const h = createAuxTreeHarness({
    workspaceUri,
    async requestHandler(method, payload) {
      calls.push(method);
      if (method === 'workspace.recent') {
        assert.equal(payload.clientWorkspaces[0].uri, workspaceUri);
        authorized = true;
        return { ok: true, workspaces: [{ uri: workspaceUri, name: 'older-project' }] };
      }
      if (method === 'workspace.listDir') {
        if (!authorized) throw new Error('工作区尚未授权，请先挂载该文件夹');
        return { ok: true, entries: [{ name: 'index.mjs', relPath: 'index.mjs', uri: `${workspaceUri}/index.mjs` }] };
      }
      return { ok: true };
    }
  });
  h.auxTree.sync({ enabled: true });
  const tree = await h.render();
  assert.deepEqual(calls, ['workspace.listDir', 'workspace.recent', 'workspace.listDir']);
  assert.ok(findByTestId(tree, 'agy-ftree-file-row'));
});

test('aux-file-tree preserves expandedDirs across conversations in the same workspace and resets on workspace switch', async () => {
  const repoAUpper = 'file:///C:/Projects/demo-app';
  const repoALower = 'file:///c:/Projects/demo-app';
  const repoB = 'file:///C:/Projects/other-app';
  const h = createAuxTreeHarness({
    conversationId: 'conv-1',
    workspaceUri: repoAUpper,
    async requestHandler(method, payload) {
      if (method === 'workspace.listDir') {
        if (payload.relPath === 'src') {
          return {
            ok: true,
            entries: [{ name: 'index.ts', relPath: 'src/index.ts', uri: `${payload.rootUri}/src/index.ts`, isDirectory: false }]
          };
        }
        return {
          ok: true,
          entries: [{ name: 'src', relPath: 'src', uri: `${payload.rootUri}/src`, isDirectory: true }]
        };
      }
      return { ok: true };
    }
  });
  h.auxTree.sync({ enabled: true });
  let tree = await h.render();
  const dirRow1 = findByTestId(tree, 'agy-ftree-dir-row');
  assert.equal(dirRow1.props['aria-expanded'], false);

  // Expand src/ in conv-1
  dirRow1.props.onClick();
  tree = await h.render();
  assert.equal(findByTestId(tree, 'agy-ftree-dir-row').props['aria-expanded'], true);
  assert.match(collectText(findByTestId(tree, 'agy-ftree-file-row')), /index\.ts/);

  // Switch to conv-2 in the SAME workspace (even with lowercase Windows drive letter) -> stays expanded
  h.setConversation('conv-2', repoALower);
  tree = await h.render();
  assert.equal(findByTestId(tree, 'agy-ftree-dir-row').props['aria-expanded'], true);
  assert.match(collectText(findByTestId(tree, 'agy-ftree-file-row')), /index\.ts/);

  // Switch to conv-3 in a DIFFERENT workspace -> resets expandedDirs cleanly
  h.setConversation('conv-3', repoB);
  tree = await h.render();
  assert.equal(findByTestId(tree, 'agy-ftree-dir-row').props['aria-expanded'], false);
});
