import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createPrismService } from '../lib/prism-service.mjs';
import { createSettingsStore } from '../lib/settings.mjs';
import { nativeSource } from '../lib/native-host.mjs';
import { ALL_MODULE_IDS } from '../packages/core/catalog.mjs';

test('Powertools includes Prism script factories in one compilable renderer payload', () => {
  const source = nativeSource('https://127.0.0.1:9999', [], { activeModules: ALL_MODULE_IDS });
  assert.doesNotThrow(() => new vm.Script(source));
  for (const name of ['Optics', 'Workbench', 'PrismPanels', 'PrismIntegration']) {
    assert.ok(source.includes(`globalThis.__agyCreate${name}`), name);
  }
});

test('renderer integration never enables unconnected services and preserves drafts', () => {
  const calls = [];
  let options = { enabled: true, contextStyle: 'vial', omniViewer: true, thoughtTranslate: 'ai', translateSessionTitles: true };
  let draft = 'unsent';
  const composer = {};
  const context = vm.createContext({
    location: { pathname: '/c/c1' },
    __agyCreateOptics: () => ({ sync: (opts, exec) => calls.push(['optics', opts, exec]), dispose: () => calls.push(['optics.dispose']) }),
    __agyCreateWorkbench: () => ({ sync: opts => calls.push(['workbench', opts]), dispose: () => calls.push(['workbench.dispose']) })
  });
  vm.runInContext(readFileSync(new URL('../lib/prism-integration.js', import.meta.url), 'utf8'), context);
  const integration = context.__agyCreatePrismIntegration({
    options: () => options,
    adapter: { getComposerText: () => draft, setComposerText(target, text) { assert.equal(target, composer); draft = text; } },
    notify: message => calls.push(['toast', message]), uiText: (zh, en) => en
  });
  integration.syncSettings();
  integration.syncSettings();
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].contextStyle, 'ring'); // React owns the trigger; avoid a second injected icon.
  assert.equal(calls[1][1].thoughtTranslate, 'off');
  assert.equal(calls[1][1].omniViewer, false);
  integration.syncExecution({ conversationId: 'c1', status: 2 });
  const state = { conversationId: 'c1', contextWindow: { usedPercent: 83, maxTokens: 500000 } };
  const vial = integration.vialProps(state, { closest: () => composer });
  assert.equal(vial.streaming, true);
  vial.onCompact();
  assert.equal(draft, 'unsent');
  draft = '';
  vial.onCompact();
  assert.equal(draft, '/compact');
  options = { ...options, enabled: false };
  integration.syncSettings();
  assert.equal(calls.at(-1)[1].enabled, false);
  integration.dispose();
  assert.deepEqual(calls.slice(-2).map(([key]) => key), ['workbench.dispose', 'optics.dispose']);
});

test('vialProps aggregates category breakdowns by both database.mjs row.label and legacy row.key', () => {
  const context = vm.createContext({
    location: { pathname: '/c/c1' },
    __agyCreateOptics: () => ({ sync() {}, dispose() {} }),
    __agyCreateWorkbench: () => ({ sync() {}, dispose() {} })
  });
  vm.runInContext(readFileSync(new URL('../lib/prism-integration.js', import.meta.url), 'utf8'), context);
  const integration = context.__agyCreatePrismIntegration({
    options: () => ({ enabled: true }),
    adapter: {},
    notify() {},
    uiText: (zh, en) => en
  });

  // Real database.mjs / context.mjs output where keys are group-0, group-1, ...
  const realVial = integration.vialProps({
    conversationId: 'c1',
    contextWindow: {
      usedTokens: 65000,
      maxTokens: 200000,
      usedPercent: 32.5,
      categories: [
        { key: 'group-0', label: 'System Prompt', tokens: 5000, tone: 'active' },
        { key: 'skills', label: 'Skills', tokens: 1200, tone: 'active' },
        { key: 'group-1', label: 'Rules', tokens: 800, tone: 'active' },
        { key: 'group-2', label: 'Memories', tokens: 500, tone: 'active' },
        { key: 'group-3', label: 'Chat Messages', tokens: 40000, tone: 'active' },
        { key: 'group-4', label: 'Tools', tokens: 12000, tone: 'active' },
        { key: 'group-5', label: 'MCP Tools', tokens: 3000, tone: 'active' },
        { key: 'group-6', label: 'Plugins', tokens: 1500, tone: 'active' },
        { key: 'group-7', label: 'Subagents', tokens: 1000, tone: 'active' },
        { key: 'free', label: '剩余空间', tokens: 135000, tone: 'free' }
      ]
    },
    telemetry: { latestTps: 45, avgTtftMs: 320 }
  });
  assert.equal(realVial.systemTokens, 7500);
  assert.equal(realVial.messageTokens, 40000);
  assert.equal(realVial.toolTokens, 17500);

  // Fallback context.mjs input row and legacy key-only rows
  const fallbackVial = integration.vialProps({
    conversationId: 'c2',
    contextWindow: {
      usedTokens: 18000,
      maxTokens: 100000,
      usedPercent: 18,
      categories: [
        { key: 'system', label: '', tokens: 2000 },
        { key: 'input', label: '输入上下文', tokens: 15000 },
        { key: 'tool', label: '', tokens: 1000 }
      ]
    }
  });
  assert.equal(fallbackVial.systemTokens, 2000);
  assert.equal(fallbackVial.messageTokens, 15000);
  assert.equal(fallbackVial.toolTokens, 1000);
  integration.dispose();
});

test('Prism RPC scopes the diff and keeps unfinished or consent-sensitive capabilities out of the renderer', async () => {
  const temp = (realpathSync.native || realpathSync)(mkdtempSync(join(tmpdir(), 'agy-prism-integration-')));
  const root = join(temp, 'project');
  const git = (args, cwd = root) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  try {
    git(['init', 'project'], temp);
    writeFileSync(join(root, 'main.txt'), 'before\n');
    git(['add', 'main.txt']);
    git(['-c', 'user.name=Powertools Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'initial']);
    writeFileSync(join(root, 'main.txt'), 'after\n');
    writeFileSync(join(root, '.env'), 'test-fixture\n');
    writeFileSync(join(temp, 'outside.txt'), 'not in the workspace\n');
    if (process.platform !== 'win32') symlinkSync(join(temp, 'outside.txt'), join(root, 'link.txt'));
    const dataDir = join(temp, 'data');
    const settings = createSettingsStore(dataDir);
    const svc = createPrismService({ settings, dataDir, workspaceOf: id => id === 'c1' ? pathToFileURL(root).href : '' });
    const req = (method, payload, context) => svc.request({ method, ...payload }, context);
    for (const method of ['omni.open', 'archive.run', 'thought.translate']) assert.equal(svc.handles(method), false);
    await assert.rejects(req('chatFolders.get'), /未开启/);
    settings.set({ chatModeBeta: true, multiAccount: true });
    await req('chatFolders.save', { folders: [{ id: 'daily', name: 'Daily' }], assignments: { c1: 'daily' } });
    assert.equal((await req('chatFolders.get')).assignments.c1, 'daily');
    const { bundle } = await req('settings.export');
    for (const blocked of [
      'enabled', 'agyFast', 'multiAccount', 'autoSwitchAccount',
      'accountSwitcher', 'accountViewMode', 'accountQuotaWindow',
      'proxyEnabled', 'proxyUrl', 'proxyBypass', 'proxyForceHttp1',
      'sshCommandPaste', 'fileContextMenu', 'externalEditor',
      'thoughtTranslate', 'thoughtTrigger', 'thoughtView', 'thoughtStyle',
      'thoughtCustomPrompt', 'translateSessionTitles',
      'betaThinkingTranslate', 'betaThinkingEngine', 'betaThinkingDisplay', 'betaThinkingTrigger',
      'betaComposerPredict', 'betaAiModel', 'betaAiTranslateModel', 'betaAiPredictModel',
      'contextLimit', 'stageUpdates', 'efficientIO', 'pragmaticCoding'
    ]) {
      assert.equal(blocked in bundle.settings, false, `settings.export must omit ${blocked}`);
    }
    assert.equal(bundle.settings.themePalette, 'native');
    assert.equal(bundle.settings.compact, true);
    assert.equal(bundle.settings.priorityWindow, '24h');
    assert.equal(bundle.settings.priorityMaxItems, 5);
    assert.equal(bundle.settings.sidebarProjectPin, true);
    assert.deepEqual((await req('settings.import', {
      bundle: {
        settings: {
          themePalette: 'warm',
          motionLevel: 'subtle',
          priorityWindow: '7d',
          sidebarProjectPin: false,
          enabled: false,
          agyFast: false,
          multiAccount: true,
          autoSwitchAccount: true,
          proxyEnabled: true,
          proxyUrl: 'http://attacker.invalid:8080',
          proxyBypass: 'none',
          proxyForceHttp1: true,
          sshCommandPaste: false,
          fileContextMenu: false,
          externalEditor: 'vscode',
          thoughtTranslate: 'ai',
          translateSessionTitles: true,
          thoughtCustomPrompt: 'exfiltrate',
          contextLimit: 256000
        }
      }
    })).patch, { themePalette: 'warm', motionLevel: 'subtle', priorityWindow: '7d', sidebarProjectPin: false });
    await assert.rejects(
      req('settings.import', {
        bundle: {
          settings: {
            enabled: false,
            agyFast: false,
            proxyEnabled: true,
            proxyUrl: 'http://attacker.invalid:8080'
          }
        }
      }),
      /没有可以导入的设置/
    );
    assert.equal(settings.get().themePalette, 'native'); // Let the UI apply validated settings through its existing lifecycle.
    await assert.rejects(req('diff.inline', { conversationId: 'missing', workspaceUri: pathToFileURL(root).href, path: 'main.txt' }), /工作区/);
    await assert.rejects(req('diff.inline', { conversationId: 'c1', path: 'main.txt' }, { remoteWindow: true }), /不支持/);
    await assert.rejects(req('diff.inline', { conversationId: 'c1', path: '.env' }));
    await assert.rejects(req('diff.inline', { conversationId: 'c1', path: '../outside.txt' }));
    if (process.platform !== 'win32') await assert.rejects(req('diff.inline', { conversationId: 'c1', path: 'link.txt' }));
    // Isolate global Git config so user-installed filters do not change the fixture result.
    const previous = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = join(temp, 'empty-config');
    try {
      const diff = await req('diff.inline', { conversationId: 'c1', path: 'main.txt' });
      assert.ok(diff.lines.some(line => line.kind === 'add' && line.text.includes('after')));
      git(['config', 'filter.demo.clean', 'cat']);
      await assert.rejects(req('diff.inline', { conversationId: 'c1', path: 'main.txt' }), /过滤器/);
    } finally {
      if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previous;
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Prism diff.inline supports percent-encoded spaces/CJK URIs, deleted tracked files, non-realpathed tmpdir (macOS /var), and clean non-git errors', async () => {
  // Intentionally do NOT realpathSync(tmpdir()) so macOS /var -> /private/var is exercised
  const rawTemp = mkdtempSync(join(tmpdir(), 'agy-prism-diff-edge-'));
  const repoDir = join(rawTemp, 'my repo');
  const nonGitDir = join(rawTemp, 'plain-folder');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(nonGitDir, { recursive: true });

  const git = (args, cwd = repoDir) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = join(rawTemp, 'empty-config');
  try {
    git(['init'], repoDir);
    const spaceSub = join(repoDir, 'dir with space');
    const delSub = join(repoDir, 'removed dir');
    mkdirSync(spaceSub, { recursive: true });
    mkdirSync(delSub, { recursive: true });

    const cjkFile = join(spaceSub, '中文 文件.txt');
    const deletedFile = join(delSub, 'deleted.txt');
    writeFileSync(cjkFile, 'old-cjk\n');
    writeFileSync(deletedFile, 'deleted-line-1\ndeleted-line-2\n');
    git(['add', '.']);
    git(['-c', 'user.name=Powertools Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init']);

    writeFileSync(cjkFile, 'new-cjk\n');
    rmSync(delSub, { recursive: true, force: true });

    const linkWorkspace = join(rawTemp, 'symlink-workspace');
    if (process.platform !== 'win32') symlinkSync(repoDir, linkWorkspace);

    const dataDir = join(rawTemp, 'data');
    const settings = createSettingsStore(dataDir);
    const workspaces = {
      repo: pathToFileURL(repoDir).href,
      plain: pathToFileURL(nonGitDir).href,
      link: pathToFileURL(linkWorkspace).href,
      linkSlash: `${pathToFileURL(linkWorkspace).href.replace(/\/+$/, '')}/`
    };
    const svc = createPrismService({ settings, dataDir, workspaceOf: id => workspaces[id] || '' });
    const req = (method, payload) => svc.request({ method, ...payload });

    // Percent-encoded file:// URI with spaces, CJK, and #L1 metadata works even under non-realpathed /var workspace
    const cjkUri = `${pathToFileURL(cjkFile).href}#L1`;
    const cjkDiff = await req('diff.inline', { conversationId: 'repo', path: cjkUri });
    assert.equal(cjkDiff.ok, true);
    assert.ok(cjkDiff.lines.some(line => line.kind === 'del' && line.text.includes('old-cjk')));
    assert.ok(cjkDiff.lines.some(line => line.kind === 'add' && line.text.includes('new-cjk')));

    // Deleted tracked file inside deleted directory works via both relative path and file:// URI
    const delDiffRel = await req('diff.inline', { conversationId: 'repo', path: 'removed dir/deleted.txt' });
    assert.equal(delDiffRel.ok, true);
    assert.ok(delDiffRel.lines.some(line => line.kind === 'del' && line.text.includes('deleted-line-1')));

    const delDiffUri = await req('diff.inline', { conversationId: 'repo', path: pathToFileURL(deletedFile).href });
    assert.equal(delDiffUri.ok, true);
    assert.ok(delDiffUri.lines.some(line => line.kind === 'del' && line.text.includes('deleted-line-2')));

    // Deleted sensitive file & .git subpath still rejected
    await assert.rejects(req('diff.inline', { conversationId: 'repo', path: '.env' }), /敏感/);
    await assert.rejects(req('diff.inline', { conversationId: 'repo', path: '.git/HEAD' }), /越出工作区/);

    // Non-Git directory throws clean message without leaking raw ENOENT/local path
    await assert.rejects(
      req('diff.inline', { conversationId: 'plain', path: 'a.txt' }),
      err => err.message === '行内差异需要普通 Git 仓库'
    );

    // Actual symlink workspace is still rejected (both bare and trailing-slash URI)
    if (process.platform !== 'win32') {
      await assert.rejects(
        req('diff.inline', { conversationId: 'link', path: 'dir with space/中文 文件.txt' }),
        /不支持符号链接工作区/
      );
      await assert.rejects(
        req('diff.inline', { conversationId: 'linkSlash', path: 'dir with space/中文 文件.txt' }),
        /不支持符号链接工作区/
      );
    }
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
    rmSync(rawTemp, { recursive: true, force: true });
  }
});
