import test, { mock } from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createHookBus } from '../packages/core/hook-bus.mjs';
import { nativeSource } from '../lib/native-host.mjs';
import { createSettingsStore, DEFAULT_SETTINGS } from '../lib/settings.mjs';
import { ALL_MODULE_IDS, DEFAULT_MODULE_IDS } from '../packages/core/catalog.mjs';
import { collectModuleBundle, encodeModuleBundle, moduleReleaseName, sha256Hex } from '../packages/core/module-bundle.mjs';
import { createModuleRegistry } from '../packages/core/module-registry.mjs';
import { buildAllModuleSeeds } from '../scripts/build-seeds.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'agy-mod-arch-'));
  const home = join(root, 'home');
  const dataDir = join(home, '.gemini', 'antigravity', 'plugin_data', 'agy-max');
  mkdirSync(join(home, '.gemini', 'config', 'plugins'), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  return { root, home, dataDir, clean: () => rmSync(root, { recursive: true, force: true }) };
}

test('fresh install pre-installs only the 4 core modules and excludes optional module bytes from nativeSource', () => {
  buildAllModuleSeeds(REPO_ROOT);
  const s = makeSandbox();
  try {
    const settingsStore = createSettingsStore(s.dataDir);
    const registry = createModuleRegistry({
      home: s.home,
      pluginRoot: REPO_ROOT,
      dataDir: s.dataDir,
      settingsStore,
      defaultSettings: DEFAULT_SETTINGS,
      version: '1.4.1'
    });

    assert.deepEqual(registry.activeIds(), DEFAULT_MODULE_IDS);
    for (const optId of ['optics', 'accounts', 'proxy', 'ssh-remote']) {
      assert.equal(registry.isActive(optId), false);
      assert.equal(existsSync(join(s.dataDir, 'modules', optId)), false);
    }

    const leanSrc = nativeSource('https://127.0.0.1:5000', [], {
      activeModules: registry.activeIds(),
      modulesCatalog: registry.listModules(),
      resolveModuleDir: id => registry.moduleDir(id)
    });
    assert.equal(leanSrc.includes('function createOptics'), false);
    assert.equal(leanSrc.includes('globalThis.__agyCreateSshProjects ='), false);
    assert.equal(leanSrc.includes('function installSshCommandPaste'), false);
    assert.equal(leanSrc.includes('__agyInlineImages'), true);
    assert.equal(leanSrc.includes('__agyCreateAuxFileTree'), true);

    const leanHash = leanSrc.match(/__agyNativeBuildHash="([0-9a-f]+)"/)?.[1];
    const withOpticsSrc = nativeSource('https://127.0.0.1:5000', [], {
      activeModules: [...registry.activeIds(), 'optics'],
      resolveModuleDir: id => registry.moduleDir(id)
    });
    const opticsHash = withOpticsSrc.match(/__agyNativeBuildHash="([0-9a-f]+)"/)?.[1];
    assert.notEqual(leanHash, opticsHash);
    assert.equal(withOpticsSrc.includes('function createOptics'), true);
  } finally {
    s.clean();
  }
});

test('online SHA-256 verified module download, offline seed fallback, and data-preserving vs purge uninstall', async () => {
  const s = makeSandbox();
  try {
    const settingsStore = createSettingsStore(s.dataDir);
    const opticsBundle = collectModuleBundle(join(REPO_ROOT, 'packages', 'optics'), '1.4.1', { repoRoot: REPO_ROOT });
    const opticsGz = encodeModuleBundle(opticsBundle);
    const opticsAsset = moduleReleaseName('optics', '1.4.1');
    const opticsSha = sha256Hex(opticsGz);

    let networkMode = 'ok';
    const fetcher = async url => {
      if (networkMode === 'offline') throw new Error('connect ETIMEDOUT');
      if (String(url).endsWith('.sha256')) {
        return { ok: true, text: async () => `${networkMode === 'tampered' ? '0'.repeat(64) : opticsSha}  ${opticsAsset}\n` };
      }
      return {
        ok: true,
        url: 'https://objects.githubusercontent.com/release-asset',
        arrayBuffer: async () => opticsGz
      };
    };

    const changes = [];
    const registry = createModuleRegistry({
      home: s.home,
      pluginRoot: REPO_ROOT,
      dataDir: s.dataDir,
      settingsStore,
      defaultSettings: DEFAULT_SETTINGS,
      version: '1.4.1',
      githubUrl: 'https://github.com/wangbingnan136/agy-max',
      fetcher,
      onModulesChanged: evt => { changes.push(`${evt.action}:${evt.id}`); }
    });

    // 1. Online verified install
    const resOnline = await registry.installModule('optics');
    assert.equal(resOnline.delivery, 'online');
    assert.equal(registry.isActive('optics'), true);
    assert.equal(existsSync(join(s.dataDir, 'modules', 'optics', 'prism-optics.js')), true);

    // 2. Offline resilient fallback to local dormant seed (solves no-network proxy bootstrap)
    networkMode = 'offline';
    const resSeed = await registry.installModule('proxy');
    assert.equal(resSeed.delivery, 'seed');
    assert.equal(registry.isActive('proxy'), true);

    // 3. Tampered online checksum is rejected and safely falls back to verified local seed
    networkMode = 'tampered';
    const resTamperFallback = await registry.installModule('accounts');
    assert.equal(resTamperFallback.delivery, 'seed');
    assert.equal(registry.isActive('accounts'), true);

    // 4. Customize optics settings, then uninstall WITHOUT purge -> settings snapshot preserved & restored on reinstall
    settingsStore.set({ themePalette: 'obsidian', userBubbleTint: true, userBubbleColor: '#336699' });
    await registry.uninstallModule('optics', { purgeData: false });
    assert.equal(registry.isActive('optics'), false);
    assert.equal(registry.listModules().find(m => m.id === 'optics').hasSavedData, true);

    settingsStore.set({ themePalette: 'native', userBubbleTint: false });
    await registry.installModule('optics', { preferSeed: true });
    assert.equal(settingsStore.get().themePalette, 'obsidian');
    assert.equal(settingsStore.get().userBubbleTint, true);
    assert.equal(settingsStore.get().userBubbleColor, '#336699');

    // 5. Uninstall WITH purgeData: true -> snapshot wiped & settings reset to defaults
    await registry.uninstallModule('optics', { purgeData: true });
    assert.equal(registry.isActive('optics'), false);
    assert.equal(registry.listModules().find(m => m.id === 'optics').hasSavedData, false);
    assert.equal(settingsStore.get().themePalette, 'native');
    assert.equal(settingsStore.get().userBubbleTint, false);
    assert.ok(changes.includes('install:optics'));
    assert.ok(changes.includes('uninstall:optics'));
  } finally {
    s.clean();
  }
});

test('Scheme C dev-local directory takes priority and v1.4.x upgrade keeps the optional modules in use', async () => {
  const s = makeSandbox();
  try {
    // Simulate a v1.4.x user who had proxy, multi-account and SSH projects before upgrading
    writeFileSync(join(s.dataDir, 'settings.json'), JSON.stringify({
      enabled: true,
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:7897',
      multiAccount: true
    }));
    writeFileSync(join(s.dataDir, 'accounts.json'), JSON.stringify({
      activeId: 'acc-1',
      accounts: [{ id: 'acc-1', email: 'user@example.com' }]
    }));
    // ssh-projects stores hosts as an id-keyed object, not an array
    mkdirSync(join(s.dataDir, 'ssh-projects'), { recursive: true });
    writeFileSync(join(s.dataDir, 'ssh-projects', 'hosts.json'), JSON.stringify({ format: 1, hosts: { 'host-1': { id: 'host-1' } } }));

    // Place a standalone Dev-Local plugin at ~/.gemini/config/plugins/agy-optics
    const devOpticsDir = join(s.home, '.gemini', 'config', 'plugins', 'agy-optics');
    mkdirSync(devOpticsDir, { recursive: true });
    writeFileSync(join(devOpticsDir, 'module.json'), JSON.stringify({ id: 'optics', version: '1.4.1', clientScripts: ['prism-optics.js'] }));
    writeFileSync(join(devOpticsDir, 'prism-optics.js'), '/* custom-dev-optics-marker */');

    const settingsStore = createSettingsStore(s.dataDir);
    const registry = createModuleRegistry({
      home: s.home,
      pluginRoot: REPO_ROOT,
      dataDir: s.dataDir,
      settingsStore,
      defaultSettings: DEFAULT_SETTINGS,
      version: '1.4.1'
    });

    const list = registry.listModules();
    const byId = new Map(list.map(m => [m.id, m]));
    assert.equal(byId.get('proxy').active, true);
    assert.equal(byId.get('accounts').active, true);
    assert.equal(byId.get('accounts').hasSavedData, true);
    assert.equal(byId.get('ssh-remote').active, true);
    assert.equal(byId.get('ssh-remote').hasSavedData, true);
    assert.equal(registry.isActive('telemetry'), true);
    assert.equal(byId.get('optics').active, true);
    assert.equal(byId.get('optics').source, 'dev-local');
    assert.equal(byId.get('optics').localPath, devOpticsDir);

    const devSrc = nativeSource('https://127.0.0.1:5000', [], {
      activeModules: registry.activeIds(),
      resolveModuleDir: id => registry.moduleDir(id)
    });
    assert.ok(devSrc.includes('custom-dev-optics-marker'));

    // Dev-local directory cannot be deleted by store uninstall
    await assert.rejects(() => registry.uninstallModule('optics'), /本地开发目录挂载/);
    assert.equal(existsSync(join(devOpticsDir, 'prism-optics.js')), true);
  } finally {
    s.clean();
  }
});

test('ModulesCenter UI renders active/inactive cards, dev-local badges, and hides uninstalled settings sections', () => {
  const panelsSrc = readFileSync(join(REPO_ROOT, 'lib', 'native-panels.js'), 'utf8');
  const prismPanelsSrc = readFileSync(join(REPO_ROOT, 'lib', 'prism-panels.js'), 'utf8');
  let stateSlots = [];
  let hookIdx = 0;
  const R = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat() };
    },
    useState(init) {
      const i = hookIdx++;
      if (!(i in stateSlots)) stateSlots[i] = typeof init === 'function' ? init() : init;
      return [stateSlots[i], next => { stateSlots[i] = typeof next === 'function' ? next(stateSlots[i]) : next; }];
    },
    useEffect() {},
    useRef: v => ({ current: v }),
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useSyncExternalStore: (_, get) => get()
  };
  const h = R.createElement;
  const activeSet = new Set(['telemetry', 'chat-flow', 'workspace-nav', 'i18n']);
  const mockCatalog = [
    { id: 'telemetry', active: true, source: 'store', bytes: 51000, displayName: { 'zh-CN': '统计与额度' }, description: { 'zh-CN': '统计说明' } },
    { id: 'optics', active: false, source: 'none', bytes: 0, hasSavedData: true, displayName: { 'zh-CN': '界面与光学' }, description: { 'zh-CN': '光学说明' } },
    { id: 'ssh-remote', active: true, source: 'dev-local', localPath: '/dev/agy-ssh-remote', bytes: 32000, displayName: { 'zh-CN': 'SSH 远端工程' }, description: { 'zh-CN': 'SSH 说明' } }
  ];

  const ctx = vm.createContext({
    React: R,
    document: { head: { append() {} }, createElement: () => ({ dataset: {}, remove() {} }) },
    location: { pathname: '/' },
    Intl,
    __agyDashboard: { dateRange: () => ({ start: 0, end: 1 }), summarizeRequests: () => ({ requests: [], models: [], points: [] }), distributionModels: () => [], subscriptionIdentity: () => ({ family: 'pro', style: 'pro', label: 'Pro' }) },
    Uy: p => h('button', p, p.children),
    UP: p => h('div', { 'data-testid': p['data-testid'] }, p.label, p.rightElement),
    TP: p => h('div', null, p.children),
    VP: p => h('section', null, p.title, p.children),
    XP: p => h('input', p),
    dq: p => h('span', p),
    kT: p => h('div', null, p.children),
    lT: p => h('div', null, p.children),
    mT: p => h('div', null, p.children),
    nT: p => h('div', null, p.children),
    Wz: p => h('div', { 'data-testid': 'modal' }, p.children)
  });
  vm.runInContext(prismPanelsSrc, ctx);
  vm.runInContext(panelsSrc, ctx);

  const panels = ctx.__agyPanels({
    t: s => s,
    version: '1.4.1',
    defaults: DEFAULT_SETTINGS,
    options: () => ({ ...DEFAULT_SETTINGS, enabled: true }),
    hasModuleCenter: true,
    hasModule: id => activeSet.has(id),
    modules: () => mockCatalog,
    loadModules: async () => mockCatalog,
    settingsError: () => '',
    state: () => null,
    dashboard: () => null,
    capabilities: () => ({}),
    subscribe: () => () => {},
    revision: () => 1
  });

  function renderTree(node) {
    if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return String(node || '');
    if (Array.isArray(node)) return node.map(renderTree).join(' ');
    if (typeof node.type === 'function') return renderTree(node.type({ ...(node.props || {}), children: node.children }));
    return [node.props?.['data-testid'] || '', ...(node.children || []).map(renderTree)].join(' ');
  }

  hookIdx = 0; stateSlots = [];
  const modHtml = renderTree(h(panels.ModulesCenter));
  assert.ok(modHtml.includes('agy-module-card-optics'));
  assert.ok(modHtml.includes('agy-module-install-optics'));
  assert.ok(modHtml.includes('未加载 (已保留配置)'));
  assert.ok(modHtml.includes('agy-module-dev-ssh-remote'));

  hookIdx = 0; stateSlots = [];
  const settingsDefaultUpdates = renderTree(h(panels.Settings));
  assert.equal(settingsDefaultUpdates.includes('agy-settings-cat-all'), false);
  assert.equal(settingsDefaultUpdates.includes('agy-settings-cat-updates'), true);
  assert.equal(settingsDefaultUpdates.includes('agy-auto-update'), true);
  assert.equal(settingsDefaultUpdates.includes('agy-settings-cat-optics'), false);
  assert.equal(settingsDefaultUpdates.includes('agy-setting-row-userBubbleTint'), false);
  assert.equal(settingsDefaultUpdates.includes('agy-setting-row-contextRing'), false);

  hookIdx = 0; stateSlots = [false, 'telemetry'];
  const settingsTelemetry = renderTree(h(panels.Settings));
  assert.equal(settingsTelemetry.includes('agy-setting-row-contextRing'), true);
  assert.equal(settingsTelemetry.includes('agy-auto-update'), false);

  activeSet.add('optics');
  hookIdx = 0; stateSlots = [false, 'optics'];
  const settingsWithOptics = renderTree(h(panels.Settings));
  assert.equal(settingsWithOptics.includes('agy-settings-cat-optics'), true);
  assert.equal(settingsWithOptics.includes('agy-setting-row-userBubbleTint'), true);
});

test('all package manifests, module sources, and build scripts contain zero middle-dot characters (U+00B7)', () => {
  const filesToCheck = [join(REPO_ROOT, 'scripts', 'build-seeds.mjs'), join(REPO_ROOT, 'tests', 'modular-architecture.test.mjs')];
  for (const dirName of ['core', ...ALL_MODULE_IDS]) {
    const pkgDir = join(REPO_ROOT, 'packages', dirName);
    for (const entry of readdirSync(pkgDir)) {
      if (/\.(?:m?js|json)$/.test(entry)) filesToCheck.push(join(pkgDir, entry));
    }
  }
  for (const file of filesToCheck) {
    const content = readFileSync(file, 'utf8');
    assert.equal(content.includes('\u00b7'), false, `Unexpected middle dot in ${file}`);
  }
});

test('all unpacked module bundles load service.mjs cleanly outside repo tree with zero parent-relative imports', async () => {
  buildAllModuleSeeds(REPO_ROOT);
  for (const modId of ALL_MODULE_IDS) {
    const pkgDir = join(REPO_ROOT, 'packages', modId);
    for (const entry of readdirSync(pkgDir)) {
      if (!/\.(?:m?js)$/.test(entry) || /\.test\.m?js$/.test(entry)) continue;
      const src = readFileSync(join(pkgDir, entry), 'utf8');
      assert.equal(/(?:from|import)\s*\(?['"]\.\.\//.test(src), false, `Parent-relative import forbidden in ${modId}/${entry}`);
    }
  }

  const s = makeSandbox();
  try {
    const settingsStore = createSettingsStore(s.dataDir);
    const registry = createModuleRegistry({
      home: s.home,
      pluginRoot: REPO_ROOT,
      dataDir: s.dataDir,
      settingsStore,
      defaultSettings: DEFAULT_SETTINGS,
      version: '1.4.1'
    });
    for (const optId of ['optics', 'accounts', 'proxy', 'ssh-remote']) {
      await registry.installModule(optId, { preferSeed: true });
    }
    const bus = createHookBus();
    const coreCtx = {
      pluginRoot: REPO_ROOT,
      dataDir: s.dataDir,
      appDir: join(s.home, '.gemini', 'antigravity'),
      settings: settingsStore,
      remote: {},
      parseSessionData: () => ({ turns: [], requests: [], executions: [] }),
      marketplaceTranslator: { translate: async items => items },
      triggerRelaunch: () => ({ scheduled: false }),
      isRelaunchPending: () => false
    };
    for (const modId of ALL_MODULE_IDS) {
      const modDir = registry.moduleDir(modId);
      assert.ok(modDir && modDir.startsWith(s.dataDir), `Expected ${modId} unpacked under dataDir, got ${modDir}`);
      const entryPath = join(modDir, 'service.mjs');
      if (existsSync(entryPath)) {
        const mod = await import(pathToFileURL(entryPath).href);
        if (typeof mod.registerModule === 'function') {
          await mod.registerModule(bus, coreCtx);
        }
      }
    }
  } finally {
    s.clean();
  }
});

test('syncIntegrations: true initializes without recursion and toggles SSH MCP + boundary hook cleanly', async () => {
  const s = makeSandbox();
  try {
    const installedDir = join(s.home, '.gemini', 'config', 'plugins', 'agy-max');
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(join(installedDir, 'plugin.json'), JSON.stringify({ id: 'agy-max', version: '1.4.1' }));
    writeFileSync(join(installedDir, 'mcp_config.json'), JSON.stringify({ mcpServers: { stale: { command: 'node' } } }));
    writeFileSync(join(installedDir, 'hooks.json'), JSON.stringify({
      'agy-max-telemetry': { enabled: false },
      'agy-max-ssh-boundary': { enabled: true }
    }));

    const settingsStore = createSettingsStore(s.dataDir);
    const registry = createModuleRegistry({
      home: s.home,
      pluginRoot: REPO_ROOT,
      installedPluginDir: installedDir,
      dataDir: s.dataDir,
      settingsStore,
      defaultSettings: DEFAULT_SETTINGS,
      version: '1.4.1',
      syncIntegrations: true
    });

    assert.deepEqual(registry.activeIds(), DEFAULT_MODULE_IDS);
    assert.equal(registry.isActive('i18n'), true);
    assert.equal(registry.isActive('ssh-remote'), false);

    const mcpInitial = JSON.parse(readFileSync(join(installedDir, 'mcp_config.json'), 'utf8'));
    const hooksInitial = JSON.parse(readFileSync(join(installedDir, 'hooks.json'), 'utf8'));
    assert.deepEqual(mcpInitial, { mcpServers: {} });
    assert.equal(hooksInitial['agy-max-ssh-boundary'].enabled, false);

    await registry.installModule('ssh-remote', { preferSeed: true });
    assert.equal(registry.isActive('ssh-remote'), true);
    const mcpWithSsh = JSON.parse(readFileSync(join(installedDir, 'mcp_config.json'), 'utf8'));
    const hooksWithSsh = JSON.parse(readFileSync(join(installedDir, 'hooks.json'), 'utf8'));
    assert.ok(mcpWithSsh.mcpServers['agy-ssh-projects']);
    assert.equal(hooksWithSsh['agy-max-ssh-boundary'].enabled, true);

    await registry.uninstallModule('ssh-remote');
    assert.equal(registry.isActive('ssh-remote'), false);
    const mcpAfterUninstall = JSON.parse(readFileSync(join(installedDir, 'mcp_config.json'), 'utf8'));
    const hooksAfterUninstall = JSON.parse(readFileSync(join(installedDir, 'hooks.json'), 'utf8'));
    assert.deepEqual(mcpAfterUninstall, { mcpServers: {} });
    assert.equal(hooksAfterUninstall['agy-max-ssh-boundary'].enabled, false);
  } finally {
    s.clean();
  }
});

test('concurrent installs keep both modules, online modules refresh on core upgrade, purge clears keychain secrets, saved SSH data keeps the boundary on', async () => {
  const s = makeSandbox();
  try {
    const installedDir = join(s.home, '.gemini', 'config', 'plugins', 'agy-max');
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(join(installedDir, 'plugin.json'), '{}');
    writeFileSync(join(installedDir, 'mcp_config.json'), JSON.stringify({ mcpServers: {} }));
    writeFileSync(join(installedDir, 'hooks.json'), JSON.stringify({ 'agy-max-ssh-boundary': { enabled: false } }));
    const assets = Object.fromEntries(['proxy', 'accounts'].map(id => [
      moduleReleaseName(id, '1.4.0'),
      encodeModuleBundle(collectModuleBundle(join(REPO_ROOT, 'packages', id), '1.4.0', { repoRoot: REPO_ROOT }))
    ]));
    let releaseAccounts;
    const accountsGate = new Promise(resolve => { releaseAccounts = resolve; });
    const fetcher = async url => {
      const name = String(url).split('/').pop();
      if (name.endsWith('.sha256')) return { ok: true, text: async () => `${sha256Hex(assets[name.slice(0, -7)])}  ${name.slice(0, -7)}\n` };
      if (name.includes('accounts')) await accountsGate;
      return { ok: true, url: 'https://objects.githubusercontent.com/asset', arrayBuffer: async () => assets[name] };
    };
    const removed = { accounts: [], ssh: [] };
    const vaults = { accounts: { removeSaved: id => (removed.accounts.push(id), { ok: true }) }, ssh: { removePassword: id => (removed.ssh.push(id), { ok: true, status: 'missing' }) } };
    const make = version => createModuleRegistry({
      home: s.home, pluginRoot: REPO_ROOT, installedPluginDir: installedDir, dataDir: s.dataDir,
      settingsStore: createSettingsStore(s.dataDir), defaultSettings: DEFAULT_SETTINGS,
      version, githubUrl: 'https://github.com/owner/repo', fetcher, syncIntegrations: true, vaults
    });

    const old = make('1.4.0');
    const slowInstall = old.installModule('accounts');
    await old.installModule('proxy');
    releaseAccounts();
    assert.equal((await slowInstall).delivery, 'online');
    assert.equal(old.isActive('proxy'), true);
    assert.equal(old.isActive('accounts'), true);

    const upgraded = make('1.4.2');
    upgraded.ensureInitialized();
    const receipt = JSON.parse(readFileSync(join(s.dataDir, 'modules', 'proxy', '.agy-module-receipt.json'), 'utf8'));
    assert.notEqual(receipt.onlineInstalled, true);
    assert.ok(receipt.seedSha256);

    writeFileSync(join(s.dataDir, 'accounts.json'), JSON.stringify({ activeId: 'acc-1', accounts: [{ id: 'acc-1', email: 'a@example.com' }, { id: 'acc-2', email: 'b@example.com' }] }));
    await upgraded.uninstallModule('accounts', { purgeData: true });
    assert.deepEqual(removed.accounts, ['acc-1', 'acc-2']);

    mkdirSync(join(s.dataDir, 'ssh-projects'), { recursive: true });
    writeFileSync(join(s.dataDir, 'ssh-projects', 'hosts.json'), JSON.stringify({ format: 1, hosts: { 'host-1': { id: 'host-1' } } }));
    make('1.4.2').ensureInitialized();
    const hooksWithData = JSON.parse(readFileSync(join(installedDir, 'hooks.json'), 'utf8'));
    assert.equal(hooksWithData['agy-max-ssh-boundary'].enabled, true);
    assert.deepEqual(JSON.parse(readFileSync(join(installedDir, 'mcp_config.json'), 'utf8')), { mcpServers: {} });
    await make('1.4.2').uninstallModule('ssh-remote', { purgeData: true });
    assert.deepEqual(removed.ssh, ['host-1']);
    assert.equal(JSON.parse(readFileSync(join(installedDir, 'hooks.json'), 'utf8'))['agy-max-ssh-boundary'].enabled, false);
  } finally {
    s.clean();
  }
});

function makeRegistry(s, extra = {}) {
  return createModuleRegistry({
    home: s.home,
    pluginRoot: REPO_ROOT,
    dataDir: s.dataDir,
    settingsStore: createSettingsStore(s.dataDir),
    defaultSettings: DEFAULT_SETTINGS,
    version: '1.4.1',
    ...extra
  });
}

test('each module client script is isolated: syntax errors are replaced by a logged stub and runtime throws are caught per module', () => {
  const s = makeSandbox();
  try {
    const devOptics = join(s.home, '.gemini', 'config', 'plugins', 'agy-optics');
    mkdirSync(devOptics, { recursive: true });
    writeFileSync(join(devOptics, 'module.json'), JSON.stringify({ id: 'optics', version: '1.4.1' }));
    writeFileSync(join(devOptics, 'prism-optics.js'), '(() => { const broken = ;');
    const devNav = join(s.home, '.gemini', 'config', 'plugins', 'agy-workspace-nav');
    mkdirSync(devNav, { recursive: true });
    writeFileSync(join(devNav, 'module.json'), JSON.stringify({ id: 'workspace-nav', version: '1.4.1' }));
    writeFileSync(join(devNav, 'aux-file-tree.js'), "throw new Error('boom-nav');");
    const registry = makeRegistry(s);
    const src = nativeSource('https://127.0.0.1:5000', [], {
      activeModules: registry.activeIds(),
      resolveModuleDir: id => registry.moduleDir(id)
    });
    assert.doesNotThrow(() => new vm.Script(src));
    assert.ok(!src.includes('const broken = ;'));
    assert.ok(src.includes('console.error("[agy-max] module \\"optics\\" client script prism-optics.js failed"'));
    assert.ok(src.includes("try{\nthrow new Error('boom-nav');\n}catch(error){console.error(\"[agy-max] module \\\"workspace-nav\\\" client script aux-file-tree.js failed\",error);}"));
    // Sibling modules still ship their code.
    assert.ok(src.includes('__agyCreateWorkbench'));
  } finally {
    s.clean();
  }
});

test('an unreadable module manifest is not treated as first install and is left untouched', async () => {
  const s = makeSandbox();
  try {
    const registry = makeRegistry(s);
    registry.ensureInitialized();
    await registry.uninstallModule('i18n');
    const manifestPath = join(s.dataDir, 'modules-manifest.json');
    writeFileSync(manifestPath, '{"format":1,"installed":[');
    const again = makeRegistry(s);
    assert.equal(again.isActive('i18n'), false);
    assert.equal(again.isActive('telemetry'), true);
    assert.equal(readFileSync(manifestPath, 'utf8'), '{"format":1,"installed":[');
  } finally {
    s.clean();
  }
});

test('module replace keeps the old directory when the swap rename stays locked and retries transient locks', async () => {
  const s = makeSandbox();
  const realRename = fs.renameSync;
  try {
    const registry = makeRegistry(s);
    await registry.installModule('proxy', { preferSeed: true });
    const marker = join(s.dataDir, 'modules', 'proxy', 'old-marker.txt');
    writeFileSync(marker, 'old');
    const lockedError = code => Object.assign(new Error(`${code}: locked`), { code });

    mock.method(fs, 'renameSync', (from, to) => {
      if (/\.stage-proxy-[^/\\]+$/.test(String(from))) throw lockedError('EPERM');
      return realRename(from, to);
    });
    syncBuiltinESMExports();
    await assert.rejects(() => registry.installModule('proxy', { preferSeed: true }), /EPERM/);
    mock.restoreAll();
    syncBuiltinESMExports();
    assert.equal(readFileSync(marker, 'utf8'), 'old');
    assert.equal(registry.isActive('proxy'), true);
    assert.deepEqual(readdirSync(join(s.dataDir, 'modules')).filter(n => n.startsWith('.')), []);

    let failures = 1;
    mock.method(fs, 'renameSync', (from, to) => {
      if (/\.stage-proxy-[^/\\]+$/.test(String(from)) && failures-- > 0) throw lockedError('EBUSY');
      return realRename(from, to);
    });
    syncBuiltinESMExports();
    await registry.installModule('proxy', { preferSeed: true });
    mock.restoreAll();
    syncBuiltinESMExports();
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(join(s.dataDir, 'modules', 'proxy', 'module.json')), true);
    assert.deepEqual(readdirSync(join(s.dataDir, 'modules')).filter(n => n.startsWith('.')), []);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    s.clean();
  }
});

test('module download enforces the 16MB cap while streaming and from Content-Length, then falls back to the seed', async () => {
  const s = makeSandbox();
  try {
    const asset = moduleReleaseName('optics', '1.4.1');
    let pulled = 0;
    let mode = 'stream';
    const fetcher = async url => {
      if (String(url).endsWith('.sha256')) return { ok: true, text: async () => `${'a'.repeat(64)}  ${asset}\n` };
      if (mode === 'header') {
        return {
          ok: true,
          headers: new Headers({ 'content-length': String(64 * 1024 * 1024) }),
          body: { async *[Symbol.asyncIterator]() { pulled++; yield new Uint8Array(1); } },
          arrayBuffer: async () => { throw new Error('body must not be read'); }
        };
      }
      return {
        ok: true,
        headers: new Headers(),
        body: { async *[Symbol.asyncIterator]() { for (let i = 0; i < 64; i++) { pulled++; yield new Uint8Array(1024 * 1024); } } },
        arrayBuffer: async () => { throw new Error('body must be streamed'); }
      };
    };
    const registry = makeRegistry(s, { githubUrl: 'https://github.com/owner/repo', fetcher });
    assert.equal((await registry.installModule('optics')).delivery, 'seed');
    assert.ok(pulled <= 17, `pulled ${pulled} chunks`);
    pulled = 0;
    mode = 'header';
    assert.equal((await registry.installModule('optics')).delivery, 'seed');
    assert.equal(pulled, 0);
  } finally {
    s.clean();
  }
});

test('coreRange is enforced at install and load time', async () => {
  const s = makeSandbox();
  try {
    const devProxy = join(s.home, '.gemini', 'config', 'plugins', 'agy-proxy');
    mkdirSync(devProxy, { recursive: true });
    writeFileSync(join(devProxy, 'module.json'), JSON.stringify({ id: 'proxy', version: '9.0.0', coreRange: '>=9.0.0' }));
    const registry = makeRegistry(s);
    const proxy = registry.listModules().find(m => m.id === 'proxy');
    assert.equal(proxy.installed, true);
    assert.equal(proxy.active, false);
    assert.match(proxy.error, /核心版本 >=9\.0\.0/);
    assert.equal(registry.activeIds().includes('proxy'), false);
    assert.equal(registry.isActive('telemetry'), true);

    const oldCore = makeRegistry(s, { version: '1.3.9' });
    await assert.rejects(() => oldCore.installModule('accounts', { preferSeed: true }), /核心版本 >=1\.4\.0/);
    assert.equal(existsSync(join(s.dataDir, 'modules', 'accounts')), false);
  } finally {
    s.clean();
  }
});

test('purge removes the module data files and v1.4.x optics users are detected from any non-default optics setting', async () => {
  const s = makeSandbox();
  try {
    writeFileSync(join(s.dataDir, 'settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, targetFps: 60 }));
    const registry = makeRegistry(s);
    assert.equal(registry.isActive('optics'), true);

    for (const name of ['chat-flow-tree.json', 'goals.json', 'priority.json']) writeFileSync(join(s.dataDir, name), '{}');
    await registry.uninstallModule('workspace-nav');
    assert.equal(existsSync(join(s.dataDir, 'priority.json')), true);
    await registry.uninstallModule('chat-flow', { purgeData: true });
    assert.equal(existsSync(join(s.dataDir, 'chat-flow-tree.json')), false);
    assert.equal(existsSync(join(s.dataDir, 'goals.json')), false);
    assert.equal(existsSync(join(s.dataDir, 'settings.json')), true);
  } finally {
    s.clean();
  }
  const fresh = makeSandbox();
  try {
    writeFileSync(join(fresh.dataDir, 'settings.json'), JSON.stringify(DEFAULT_SETTINGS));
    assert.equal(makeRegistry(fresh).isActive('optics'), false);
  } finally {
    fresh.clean();
  }
});

test('purge keeps the credential index file and reports failures when keychain removal fails', async () => {
  const s = makeSandbox();
  try {
    writeFileSync(join(s.dataDir, 'accounts.json'), JSON.stringify({ accounts: [{ id: 'acc-1' }, { id: 'acc-2' }] }));
    mkdirSync(join(s.dataDir, 'ssh-projects'), { recursive: true });
    writeFileSync(join(s.dataDir, 'ssh-projects', 'hosts.json'), JSON.stringify({ format: 1, hosts: { 'host-1': {} } }));
    const vaults = {
      accounts: { removeSaved: id => (id === 'acc-2' ? { ok: false, error: 'keychain locked' } : { ok: true }) },
      ssh: { removePassword: () => { throw new Error('secret-tool missing'); } }
    };
    const registry = makeRegistry(s, { vaults });
    await registry.installModule('accounts', { preferSeed: true });
    await registry.installModule('ssh-remote', { preferSeed: true });

    const acc = await registry.uninstallModule('accounts', { purgeData: true });
    assert.deepEqual(acc.credentialFailures, [{ id: 'acc-2', error: 'keychain locked' }]);
    assert.equal(existsSync(join(s.dataDir, 'accounts.json')), true);
    assert.equal(registry.isActive('accounts'), false);

    const ssh = await registry.uninstallModule('ssh-remote', { purgeData: true });
    assert.deepEqual(ssh.credentialFailures, [{ id: 'host-1', error: 'secret-tool missing' }]);
    assert.equal(existsSync(join(s.dataDir, 'ssh-projects', 'hosts.json')), true);
    assert.equal(registry.isActive('ssh-remote'), false);

    // Removal reported as "missing" counts as success and the data is purged.
    await registry.installModule('accounts', { preferSeed: true });
    const ok = await makeRegistry(s, { vaults: { accounts: { removeSaved: () => ({ ok: true, status: 'missing' }) } } }).uninstallModule('accounts', { purgeData: true });
    assert.equal(ok.credentialFailures, undefined);
    assert.equal(existsSync(join(s.dataDir, 'accounts.json')), false);
  } finally {
    s.clean();
  }
});
