import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  ALL_MODULE_IDS,
  DEFAULT_MODULE_IDS,
  MODULE_BY_ID,
  MODULE_CATALOG,
  detectLegacyUsedOptionalModules,
  isKnownModuleId
} from './catalog.mjs';
import {
  collectModuleBundle,
  decodeModuleBundle,
  moduleReleaseName,
  moduleSeedName,
  sha256Hex,
  writeModuleBundle
} from './module-bundle.mjs';

const SSH_MCP_SERVER_CONFIG = Object.freeze({
  'agy-ssh-projects': {
    command: 'node',
    args: [
      '-e',
      "var f=require('fs'),p=require('path'),o=require('os'),u=require('url'),e=process.env,h='';try{h=o.homedir()}catch(x){}for(var d of[e.PLUGIN_ROOT,e.AGY_PLUGIN_ROOT,h?p.join(h,'.gemini','config','plugins','agy-max'):'']){if(d){var s=p.resolve(d,'scripts','ssh-mcp-server.mjs');if(f.existsSync(s)&&f.existsSync(p.resolve(d,'plugin.json'))){import(u.pathToFileURL(s).href);break;}}}"
    ]
  }
});

function writeAtomicJson(filePath, value, mode = 0o600) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = join(dirname(filePath), `.agy-mod-${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode });
    renameSync(tmp, filePath);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function assertSafeChild(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new Error('模块目录路径越界');
  }
  return resolvedTarget;
}

function directoryByteSize(dir) {
  let total = 0;
  try {
    const st = lstatSync(dir, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink() || !st.isDirectory()) return 0;
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const child = lstatSync(p, { throwIfNoEntry: false });
      if (!child || child.isSymbolicLink()) continue;
      if (child.isDirectory()) total += directoryByteSize(p);
      else if (child.isFile()) total += child.size;
    }
  } catch {}
  return total;
}

function hasNonEmptyArrayInJson(filePath, key) {
  const data = readJsonSafe(filePath, null);
  if (!data || typeof data !== 'object') return false;
  if (Array.isArray(data)) return data.length > 0;
  const value = data[key];
  // ssh-projects stores hosts/projects as id-keyed objects, accounts.json as an array.
  return Array.isArray(value) ? value.length > 0 : Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
}

async function downloadVerifiedBundle(id, version, githubUrl, fetcher) {
  if (!githubUrl || typeof fetcher !== 'function') return null;
  let parsedRepo;
  try { parsedRepo = new URL(githubUrl); } catch { return null; }
  if (parsedRepo.protocol !== 'https:' || parsedRepo.hostname !== 'github.com') return null;
  const repoPath = parsedRepo.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoPath)) return null;

  const assetName = moduleReleaseName(id, version);
  const baseUrl = `https://github.com/${repoPath}/releases/download/v${version}`;
  const sumRes = await fetcher(`${baseUrl}/${assetName}.sha256`, { signal: AbortSignal.timeout(6000), redirect: 'follow' });
  if (!sumRes?.ok) throw new Error(`HTTP ${sumRes?.status || 0}`);
  const sumText = (await sumRes.text()).trim();
  const match = sumText.match(/^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i);
  if (!match || match[2].trim() !== assetName) throw new Error('模块远程校验清单无效');
  const expectedSha = match[1].toLowerCase();

  const bundleRes = await fetcher(`${baseUrl}/${assetName}`, { signal: AbortSignal.timeout(12000), redirect: 'follow' });
  if (!bundleRes?.ok) throw new Error(`HTTP ${bundleRes?.status || 0}`);
  if (bundleRes.url) {
    const finalHost = new URL(bundleRes.url).hostname.toLowerCase();
    if (finalHost !== 'github.com' && !finalHost.endsWith('.githubusercontent.com')) {
      throw new Error('模块下载重定向域名不受信任');
    }
  }
  const MAX_MODULE_BYTES = 16 * 1024 * 1024;
  if (Number(bundleRes.headers?.get?.('content-length') || 0) > MAX_MODULE_BYTES) throw new Error('模块下载包过大');
  const buf = Buffer.from(await bundleRes.arrayBuffer());
  if (buf.length > MAX_MODULE_BYTES) throw new Error('模块下载包过大');
  if (sha256Hex(buf) !== expectedSha) throw new Error('模块下载包 SHA-256 校验失败');
  return decodeModuleBundle(buf, { expectedId: id, expectedVersion: version });
}

export function isSshModuleInstalled({ home = homedir() } = {}) {
  const root = join(resolve(home), '.gemini');
  const devManifest = join(root, 'config', 'plugins', 'agy-ssh-remote', 'module.json');
  const hostCfg = readJsonSafe(join(root, 'config', 'config.json'), {});
  if (existsSync(devManifest) && hostCfg?.plugins?.['agy-ssh-remote']?.enabled !== false) return true;
  const manifestPath = join(root, 'antigravity', 'plugin_data', 'agy-max', 'modules-manifest.json');
  const manifest = readJsonSafe(manifestPath, null);
  if (!manifest || !Array.isArray(manifest.installed)) {
    // Before the manifest is initialized, keep SSH tools for users upgrading with saved SSH projects.
    const sshData = join(root, 'antigravity', 'plugin_data', 'agy-max', 'ssh-projects');
    return hasNonEmptyArrayInJson(join(sshData, 'projects.json'), 'projects')
      || hasNonEmptyArrayInJson(join(sshData, 'hosts.json'), 'hosts');
  }
  return manifest.installed.includes('ssh-remote')
    && existsSync(join(root, 'antigravity', 'plugin_data', 'agy-max', 'modules', 'ssh-remote', 'module.json'));
}

export function syncRuntimeModuleIntegrations({ installedPluginDir, sshActive, boundaryActive = sshActive }) {
  if (!installedPluginDir || !existsSync(join(installedPluginDir, 'plugin.json'))) return;
  try {
    const mcpPath = join(installedPluginDir, 'mcp_config.json');
    if (existsSync(mcpPath) && !lstatSync(mcpPath).isSymbolicLink()) {
      const want = { mcpServers: sshActive ? SSH_MCP_SERVER_CONFIG : {} };
      const cur = readJsonSafe(mcpPath, null);
      if (JSON.stringify(cur) !== JSON.stringify(want)) {
        writeAtomicJson(mcpPath, want, 0o644);
      }
    }
    const hooksPath = join(installedPluginDir, 'hooks.json');
    if (existsSync(hooksPath) && !lstatSync(hooksPath).isSymbolicLink()) {
      const cur = readJsonSafe(hooksPath, null);
      if (cur && typeof cur === 'object' && cur['agy-max-ssh-boundary']) {
        const nextFlag = Boolean(boundaryActive);
        if (cur['agy-max-ssh-boundary'].enabled !== nextFlag) {
          writeAtomicJson(hooksPath, {
            ...cur,
            'agy-max-ssh-boundary': { ...cur['agy-max-ssh-boundary'], enabled: nextFlag }
          }, 0o644);
        }
      }
    }
  } catch { /* Never fail sidecar boot if installed dir is read-only. */ }
}

export function createModuleRegistry({
  home = homedir(),
  pluginRoot,
  installedPluginDir = '',
  dataDir = join(resolve(home), '.gemini', 'antigravity', 'plugin_data', 'agy-max'),
  settingsStore = null,
  defaultSettings = {},
  version = '1.4.2',
  githubUrl = '',
  fetcher = globalThis.fetch,
  syncIntegrations = false,
  onModulesChanged = null,
  vaults = null
} = {}) {
  const resolvedHome = resolve(home);
  const resolvedPluginRoot = resolve(pluginRoot || join(resolvedHome, '.gemini', 'config', 'plugins', 'agy-max'));
  const resolvedDataDir = resolve(dataDir);
  const modulesRoot = join(resolvedDataDir, 'modules');
  const moduleDataRoot = join(resolvedDataDir, 'module_data');
  const manifestPath = join(resolvedDataDir, 'modules-manifest.json');
  const pluginsParentDir = join(resolvedHome, '.gemini', 'config', 'plugins');
  const hostConfigPath = join(resolvedHome, '.gemini', 'config', 'config.json');

  function loadBundleFromSeedOrPackage(id) {
    const seedPath = join(resolvedPluginRoot, 'vendor', 'seeds', moduleSeedName(id));
    if (existsSync(seedPath)) {
      const st = lstatSync(seedPath);
      if (!st.isSymbolicLink() && st.isFile()) {
        return decodeModuleBundle(readFileSync(seedPath), { expectedId: id });
      }
    }
    const pkgDir = join(resolvedPluginRoot, 'packages', id);
    if (existsSync(join(pkgDir, 'module.json'))) {
      return collectModuleBundle(pkgDir, version);
    }
    throw new Error(`未找到模块 ${id} 的本地种子或源码包`);
  }

  function seedDigest(id) {
    const seedPath = join(resolvedPluginRoot, 'vendor', 'seeds', moduleSeedName(id));
    try {
      const st = lstatSync(seedPath, { throwIfNoEntry: false });
      if (st && !st.isSymbolicLink() && st.isFile()) return sha256Hex(readFileSync(seedPath));
    } catch {}
    return '';
  }

  function extractBundleAtomically(id, bundle, sourceSeedSha = '') {
    mkdirSync(modulesRoot, { recursive: true });
    const targetDir = assertSafeChild(modulesRoot, join(modulesRoot, id));
    const stageDir = assertSafeChild(modulesRoot, join(modulesRoot, `.stage-${id}-${randomUUID().slice(0, 8)}`));
    try {
      const receipt = writeModuleBundle(bundle, stageDir);
      if (sourceSeedSha) {
        writeAtomicJson(join(stageDir, '.agy-module-receipt.json'), { ...receipt, seedSha256: sourceSeedSha });
      }
      rmSync(targetDir, { recursive: true, force: true });
      renameSync(stageDir, targetDir);
      return receipt;
    } finally {
      if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
    }
  }

  function resolveDevLocalDir(id) {
    const candidate = join(pluginsParentDir, `agy-${id}`);
    try {
      const st = lstatSync(candidate, { throwIfNoEntry: false });
      if (!st || st.isSymbolicLink() || !st.isDirectory()) return '';
      const modJson = readJsonSafe(join(candidate, 'module.json'), null);
      if (modJson?.id !== id) return '';
      const hostCfg = readJsonSafe(hostConfigPath, {});
      if (hostCfg?.plugins?.[`agy-${id}`]?.enabled === false) return '';
      return candidate;
    } catch {
      return '';
    }
  }

  function readManifest() {
    const raw = readJsonSafe(manifestPath, null);
    if (!raw || raw.format !== 1 || !Array.isArray(raw.installed)) return null;
    return {
      format: 1,
      initializedVersion: String(raw.initializedVersion || version),
      migratedFromLegacy: Boolean(raw.migratedFromLegacy),
      installed: [...new Set(raw.installed.filter(isKnownModuleId))],
      explicitlyUninstalled: [...new Set((Array.isArray(raw.explicitlyUninstalled) ? raw.explicitlyUninstalled : []).filter(isKnownModuleId))]
    };
  }

  function saveManifest(next) {
    writeAtomicJson(manifestPath, {
      format: 1,
      initializedVersion: next.initializedVersion || version,
      migratedFromLegacy: Boolean(next.migratedFromLegacy),
      installed: [...new Set(next.installed.filter(isKnownModuleId))],
      explicitlyUninstalled: [...new Set((next.explicitlyUninstalled || []).filter(isKnownModuleId))],
      updatedAt: Date.now()
    });
  }

  let initializingManifest = null;

  function syncIntegrationsIfNeeded(manifest) {
    if (!syncIntegrations || !manifest) return;
    const targetDir = installedPluginDir || resolvedPluginRoot;
    syncRuntimeModuleIntegrations({
      installedPluginDir: targetDir,
      sshActive: Boolean(resolveModuleState('ssh-remote', manifest)?.active),
      // Keep the local-execution guard while saved SSH projects exist, even with the module uninstalled.
      boundaryActive: Boolean(resolveModuleState('ssh-remote', manifest)?.active) || hasSavedSshProjects()
    });
  }

  function ensureInitialized() {
    if (initializingManifest) return initializingManifest;
    let manifest = readManifest();
    if (!manifest) {
      // Upgraders from v1.4.x keep the optional modules they were using; fresh installs get the defaults only.
      const settingsPath = join(resolvedDataDir, 'settings.json');
      const legacyExtra = existsSync(settingsPath)
        ? detectLegacyUsedOptionalModules(readJsonSafe(settingsPath, {}), {
          hasSavedAccounts: hasNonEmptyArrayInJson(join(resolvedDataDir, 'accounts.json'), 'accounts'),
          hasSavedSsh: hasSavedSshProjects()
        })
        : [];
      const initialInstalled = [...new Set([...DEFAULT_MODULE_IDS, ...legacyExtra])];
      for (const id of initialInstalled) {
        const modDir = join(modulesRoot, id);
        const curSeedSha = seedDigest(id);
        const curReceipt = readJsonSafe(join(modDir, '.agy-module-receipt.json'), null);
        if (!existsSync(join(modDir, 'module.json')) || (curSeedSha && curReceipt?.seedSha256 && curReceipt.seedSha256 !== curSeedSha)) {
          try {
            extractBundleAtomically(id, loadBundleFromSeedOrPackage(id), curSeedSha);
          } catch {}
        }
      }
      manifest = {
        format: 1,
        initializedVersion: version,
        migratedFromLegacy: legacyExtra.length > 0,
        installed: initialInstalled,
        explicitlyUninstalled: []
      };
      saveManifest(manifest);
    } else {
      // Heal missing or outdated seed-backed module directories on version upgrade
      for (const id of manifest.installed) {
        const modDir = join(modulesRoot, id);
        const curSeedSha = seedDigest(id);
        const curReceipt = readJsonSafe(join(modDir, '.agy-module-receipt.json'), null);
        // Online installs carry no seed hash, so refresh them from the bundled seed once the core version moves on.
        const needsRefresh = !existsSync(join(modDir, 'module.json'))
          || (curReceipt?.onlineInstalled
            ? curReceipt.version !== version
            : Boolean(curSeedSha && curReceipt?.seedSha256 !== curSeedSha));
        if (needsRefresh) {
          try {
            extractBundleAtomically(id, loadBundleFromSeedOrPackage(id), curSeedSha);
          } catch {}
        }
      }
    }
    initializingManifest = manifest;
    try {
      syncIntegrationsIfNeeded(manifest);
    } finally {
      initializingManifest = null;
    }
    return manifest;
  }

  function resolveModuleState(id, manifest = ensureInitialized()) {
    const meta = MODULE_BY_ID.get(id);
    if (!meta) return null;
    const devDir = resolveDevLocalDir(id);
    if (devDir) {
      return {
        ...meta,
        installed: true,
        active: true,
        source: 'dev-local',
        dir: devDir,
        bytes: directoryByteSize(devDir),
        hasSavedData: hasSavedModuleData(id)
      };
    }
    const storeDir = join(modulesRoot, id);
    const inManifest = manifest.installed.includes(id) && existsSync(join(storeDir, 'module.json'));
    const receipt = inManifest ? readJsonSafe(join(storeDir, '.agy-module-receipt.json'), null) : null;
    return {
      ...meta,
      installed: inManifest,
      active: inManifest,
      source: inManifest ? 'store' : 'none',
      dir: inManifest ? storeDir : '',
      installedVersion: receipt?.version || (inManifest ? version : ''),
      bytes: inManifest ? (receipt?.totalBytes || directoryByteSize(storeDir)) : 0,
      hasSavedData: hasSavedModuleData(id)
    };
  }

  function hasSavedModuleData(id) {
    const modDataDir = join(moduleDataRoot, id);
    if (existsSync(join(modDataDir, 'settings.snapshot.json'))) return true;
    if (id === 'accounts' && hasNonEmptyArrayInJson(join(resolvedDataDir, 'accounts.json'), 'accounts')) return true;
    if (id === 'ssh-remote' && hasSavedSshProjects()) return true;
    return false;
  }

  function hasSavedSshProjects() {
    const sshDir = join(resolvedDataDir, 'ssh-projects');
    return hasNonEmptyArrayInJson(join(sshDir, 'projects.json'), 'projects') || hasNonEmptyArrayInJson(join(sshDir, 'hosts.json'), 'hosts');
  }

  function listModules() {
    const manifest = ensureInitialized();
    return MODULE_CATALOG.map(meta => {
      const st = resolveModuleState(meta.id, manifest);
      return {
        id: st.id,
        order: st.order,
        defaultInstalled: st.defaultInstalled,
        category: st.category,
        displayName: st.displayName,
        description: st.description,
        installed: st.installed,
        active: st.active,
        source: st.source,
        localPath: st.source === 'dev-local' ? st.dir : '',
        installedVersion: st.installedVersion || '',
        bytes: st.bytes,
        hasSavedData: st.hasSavedData
      };
    });
  }

  function activeIds() {
    const manifest = ensureInitialized();
    return ALL_MODULE_IDS.filter(id => resolveModuleState(id, manifest)?.active);
  }

  function isActive(id) {
    if (!isKnownModuleId(id)) return false;
    return Boolean(resolveModuleState(id)?.active);
  }

  function moduleDir(id) {
    if (!isKnownModuleId(id)) return '';
    return resolveModuleState(id)?.dir || '';
  }

  async function installModule(id, { preferSeed = false } = {}) {
    if (!isKnownModuleId(id)) throw new Error(`未知的模块标识: ${id}`);
    const manifest = ensureInitialized();
    const current = resolveModuleState(id, manifest);
    if (current.source === 'dev-local') {
      return { ok: true, id, delivery: 'dev-local', modules: listModules() };
    }
    let bundle = null;
    let delivery = 'seed';
    if (!preferSeed && githubUrl) {
      try {
        bundle = await downloadVerifiedBundle(id, version, githubUrl, fetcher);
        if (bundle) delivery = 'online';
      } catch {
        bundle = null;
      }
    }
    if (!bundle) {
      bundle = loadBundleFromSeedOrPackage(id);
      delivery = 'seed';
    }
    const extractedReceipt = extractBundleAtomically(id, bundle, delivery === 'seed' ? seedDigest(id) : '');
    if (delivery === 'online') {
      writeAtomicJson(join(modulesRoot, id, '.agy-module-receipt.json'), { ...extractedReceipt, onlineInstalled: true });
    }

    // Restore previously saved module settings snapshot if available
    const snapPath = join(moduleDataRoot, id, 'settings.snapshot.json');
    const savedPatch = readJsonSafe(snapPath, null);
    if (savedPatch && typeof savedPatch === 'object' && settingsStore?.set) {
      const meta = MODULE_BY_ID.get(id);
      const allowed = new Set(meta?.settingsKeys || []);
      const cleanPatch = {};
      for (const [k, v] of Object.entries(savedPatch)) {
        if (allowed.has(k)) cleanPatch[k] = v;
      }
      if (Object.keys(cleanPatch).length) settingsStore.set(cleanPatch);
    }

    // Re-read: another install/uninstall may have saved the manifest while this one was downloading.
    const latest = readManifest() || manifest;
    const nextInstalled = [...new Set([...latest.installed, id])];
    const nextUninstalled = latest.explicitlyUninstalled.filter(x => x !== id);
    const nextManifest = { ...latest, installed: nextInstalled, explicitlyUninstalled: nextUninstalled };
    saveManifest(nextManifest);
    syncIntegrationsIfNeeded(nextManifest);
    if (typeof onModulesChanged === 'function') await onModulesChanged({ action: 'install', id, activeIds: activeIds() });
    return { ok: true, id, delivery, modules: listModules() };
  }

  // Saved account and SSH secrets live in the OS keychain, keyed by ids that only the files deleted on purge remember.
  async function purgeModuleCredentials(id) {
    try {
      if (id === 'accounts') {
        const ids = (readJsonSafe(join(resolvedDataDir, 'accounts.json'), {})?.accounts || []).map(a => a?.id).filter(x => typeof x === 'string' && x);
        if (!ids.length) return;
        const vault = vaults?.accounts || (await import('../../lib/credential-vault.mjs')).createCredentialVault({ home: resolvedHome });
        for (const accountId of ids) { try { vault.removeSaved(accountId); } catch {} }
      }
      if (id === 'ssh-remote') {
        const hosts = readJsonSafe(join(resolvedDataDir, 'ssh-projects', 'hosts.json'), {})?.hosts;
        const ids = hosts && typeof hosts === 'object' ? Object.keys(hosts) : [];
        if (!ids.length) return;
        const vault = vaults?.ssh || (await import('../../lib/ssh-vault.mjs')).createSshCredentialVault();
        for (const hostId of ids) { try { vault.removePassword(hostId); } catch {} }
      }
    } catch { /* Purging local files must not fail because the keychain is unavailable. */ }
  }

  async function uninstallModule(id, { purgeData = false } = {}) {
    if (!isKnownModuleId(id)) throw new Error(`未知的模块标识: ${id}`);
    const manifest = ensureInitialized();
    const current = resolveModuleState(id, manifest);
    if (current.source === 'dev-local') {
      throw new Error(`该模块当前以本地开发目录挂载 (${current.dir})，请移出或禁用对应目录后再卸载`);
    }
    const meta = MODULE_BY_ID.get(id);
    const modDataDir = assertSafeChild(moduleDataRoot, join(moduleDataRoot, id));

    if (!purgeData && settingsStore?.get && meta?.settingsKeys?.length) {
      const curSettings = settingsStore.get();
      const snapshot = {};
      for (const key of meta.settingsKeys) {
        if (key in curSettings) snapshot[key] = curSettings[key];
      }
      writeAtomicJson(join(modDataDir, 'settings.snapshot.json'), snapshot);
    }

    const storeDir = assertSafeChild(modulesRoot, join(modulesRoot, id));
    rmSync(storeDir, { recursive: true, force: true });

    if (purgeData) {
      await purgeModuleCredentials(id);
      rmSync(modDataDir, { recursive: true, force: true });
      if (settingsStore?.set && meta?.settingsKeys?.length) {
        const resetPatch = {};
        for (const key of meta.settingsKeys) {
          if (key in defaultSettings) resetPatch[key] = defaultSettings[key];
        }
        if (Object.keys(resetPatch).length) settingsStore.set(resetPatch);
      }
      if (id === 'accounts') {
        rmSync(join(resolvedDataDir, 'accounts.json'), { force: true });
      }
      if (id === 'ssh-remote') {
        rmSync(join(resolvedDataDir, 'ssh-projects'), { recursive: true, force: true });
      }
    }

    const nextInstalled = manifest.installed.filter(x => x !== id);
    const nextUninstalled = [...new Set([...manifest.explicitlyUninstalled, id])];
    const nextManifest = { ...manifest, installed: nextInstalled, explicitlyUninstalled: nextUninstalled };
    saveManifest(nextManifest);
    syncIntegrationsIfNeeded(nextManifest);
    if (typeof onModulesChanged === 'function') await onModulesChanged({ action: 'uninstall', id, purgeData: Boolean(purgeData), activeIds: activeIds() });
    return { ok: true, id, purged: Boolean(purgeData), modules: listModules() };
  }

  return {
    ensureInitialized,
    listModules,
    activeIds,
    isActive,
    moduleDir,
    resolveModuleState,
    installModule,
    uninstallModule
  };
}
