import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { devToolsPortFile } from './paths.mjs';
import { createNativeDeclarationCache } from './native-cache.mjs';
import { checkForUpdates, projectInfo } from './updates.mjs';
import { startUpdate, updateStatus } from './update-manager.mjs';
export { declaredNativeNames } from './native-cache.mjs';
import { createSettingsStore, DEFAULT_SETTINGS, exportSanitizedSettings, importSanitizedSettings, SCENE_PRESETS } from './settings.mjs';
import { PORTABLE_SETTINGS_KEYS } from './prism-service.mjs';
import { syncBundledAgyFast } from './agy-fast-bundle.mjs';
import { installationPaths } from './lifecycle.mjs';
import { isRemoteSshEnvironment, scheduleRelaunchWithDebugPort } from './launcher.mjs';
import { createRemoteTelemetryBridge, parseSshWindowTitle } from './ssh-remote.mjs';
import { createWslCdpBridge, isWslEnvironment } from './wsl.mjs';
import { loopbackHttpRequest } from './runtime-control.mjs';
import { ALL_MODULE_IDS, DEFAULT_MODULE_IDS, MODULE_CATALOG } from '../packages/core/catalog.mjs';
import { createHookBus } from '../packages/core/hook-bus.mjs';
import { createModuleRegistry } from '../packages/core/module-registry.mjs';

const nativeFetch = globalThis.fetch;
const isLoopbackHost = host => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host || '').toLowerCase());
export function ensureLoopbackNoProxyEnv(env = process.env) {
  const entries = String(env.no_proxy || env.NO_PROXY || '').split(',').map(value => value.trim()).filter(Boolean);
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
    if (!entries.some(entry => entry.toLowerCase() === host)) entries.push(host);
  }
  env.NO_PROXY = env.no_proxy = entries.join(',');
}
ensureLoopbackNoProxyEnv();

// Node's global dispatcher can capture the proxy configuration before this module runs.
// Give Undici a direct HTTP upgrade while leaving WebSocket validation and framing to it.
const loopbackWebSocketDispatcher = {
  dispatch({ origin, path, method, headers, upgrade }, handler) {
    const url = new URL(origin);
    let upgradedSocket;
    const req = httpRequest({
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port,
      path,
      method,
      headers: { ...headers, connection: 'Upgrade', upgrade },
      agent: false
    });
    req.on('error', error => handler.onError(error));
    req.on('response', res => {
      res.destroy();
      handler.onError(new Error(`WebSocket upgrade returned HTTP ${res.statusCode}`));
    });
    req.on('upgrade', (res, socket, head) => {
      upgradedSocket = socket;
      // Preserve frames that arrived in the same packet as the response headers.
      if (head.length) socket.unshift(head);
      handler.onUpgrade(res.statusCode, res.rawHeaders.map(value => Buffer.from(value, 'latin1')), socket);
    });
    handler.onConnect(reason => {
      if (upgradedSocket) upgradedSocket.destroy();
      else req.destroy(reason);
    });
    req.end();
    return true;
  }
};
async function fetchCdpTargets(host, port, timeoutMs) {
  const cleanHost = String(host || '127.0.0.1').replace(/^\[|\]$/g, '');
  if (globalThis.fetch === nativeFetch && isLoopbackHost(host)) {
    const res = await loopbackHttpRequest({ host: cleanHost, port, path: '/json/list', timeoutMs });
    if (!res.ok) throw new Error(`调试接口返回异常 (${res.status})`);
    return res.json();
  }
  const urlHost = cleanHost.includes(':') ? `[${cleanHost}]` : cleanHost;
  const res = await fetch(`http://${urlHost}:${port}/json/list`, { signal: AbortSignal.timeout(timeoutMs) });
  if (res.ok === false) throw new Error(`调试接口返回异常 (${res.status})`);
  return res.json();
}

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'native-ui.js');
const HUB_TITLE_RE = /(?:(?:^| - |\(\d+\) )Antigravity(?:\s*(?:\([^)]+\)|\[[^\]]+\]))?|(?:\s|^)(?:\((?:SSH|WSL):\s*[^)]+\)|\[(?:SSH|WSL):\s*[^\]]+\]))$/;
const HUB_PATH_RE = /^\/(?:c\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}|powertools|customizations|automations)(?:\/|$)/;
const SWARM_TARGET_RE = /^plugin:\/\/swarm--swarm_board-/i;
const isLoopbackHttpsPage = target => {
  try {
    const url = new URL(target.url);
    return target.type === 'page' && url.protocol === 'https:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch { return false; }
};
export const isHubTarget = target => {
  if (!isLoopbackHttpsPage(target)) return false;
  try {
    return HUB_TITLE_RE.test(target.title || '') || HUB_PATH_RE.test(new URL(target.url).pathname);
  } catch { return false; }
};
export const isSwarmTarget = target => target?.type === 'iframe' && SWARM_TARGET_RE.test(target?.url || '');

export function connectCdp(url) {
  ensureLoopbackNoProxyEnv();
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const socket = endpoint.protocol === 'ws:' && isLoopbackHost(endpoint.hostname)
      ? new WebSocket(url, { dispatcher: loopbackWebSocketDispatcher })
      : new WebSocket(url);
    const pending = new Map();
    let sequence = 0;
    const listeners = new Set();
    const timeout = setTimeout(() => { socket.close(); reject(new Error('调试接口连接超时')); }, 4000);
    const close = () => {
      clearTimeout(timeout);
      reject(new Error('调试接口已断开'));
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('调试接口已断开')); }
      pending.clear();
    };
    socket.addEventListener('error', event => {
      clearTimeout(timeout);
      reject(new Error('调试接口不可用', { cause: event.error }));
    });
    socket.addEventListener('close', close);
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const p = pending.get(message.id);
      if (p) {
        clearTimeout(p.timer); pending.delete(message.id);
        if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
      } else for (const listener of listeners) listener(message);
    });
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve({
        socket,
        onEvent: listener => listeners.add(listener),
        send(method, params = {}) {
          if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('调试接口已断开'));
          return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timeoutMs = ['Page.captureScreenshot', 'Runtime.evaluate'].includes(method) ? 15000 : 5000;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
            try {
              socket.send(JSON.stringify({ id, method, params }));
            } catch (error) {
              clearTimeout(timer);
              pending.delete(id);
              reject(error);
            }
          });
        }
      });
    });
  });
}

export function findIdentifier(result, keys = ['conversationId', 'conversation_id', 'cascadeId', 'cascade_id']) {
  if (!result || typeof result !== 'object') return null;
  for (const key of keys) if (typeof result[key] === 'string' && result[key]) return result[key];
  for (const value of Object.values(result)) {
    if (value && typeof value === 'object') { const id = findIdentifier(value, keys); if (id) return id; }
  }
  return null;
}

const nativeDeclarations=createNativeDeclarationCache();
const pluginVersion=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;

const pluginRootDir = resolve(dirname(scriptPath), '..');

function resolveModuleAssetPath(moduleId, fileName, resolveModuleDir) {
  const customDir = typeof resolveModuleDir === 'function' ? resolveModuleDir(moduleId) : '';
  if (customDir) {
    const fromMod = join(customDir, fileName);
    if (existsSync(fromMod)) return fromMod;
  }
  const fromPkg = join(pluginRootDir, 'packages', moduleId, fileName);
  if (existsSync(fromPkg)) return fromPkg;
  return join(dirname(scriptPath), fileName);
}

function readNativeScripts({ activeModules = DEFAULT_MODULE_IDS, resolveModuleDir = null } = {}) {
  const activeSet = new Set(Array.isArray(activeModules) ? activeModules : DEFAULT_MODULE_IDS);
  const helperPairs = [];
  const seenHelpers = new Set();
  for (const mod of MODULE_CATALOG) {
    if (!activeSet.has(mod.id)) continue;
    for (const helperName of mod.clientHelpers || []) {
      if (seenHelpers.has(helperName)) continue;
      seenHelpers.add(helperName);
      helperPairs.push([mod.id, helperName]);
    }
  }
  const helpers = helperPairs
    .map(([modId, name]) => readFileSync(resolveModuleAssetPath(modId, name, resolveModuleDir), 'utf8').replaceAll('export function', 'function'))
    .join('\n');
  const bindings = [
    readFileSync(join(dirname(scriptPath), 'native-bindings.js'), 'utf8'),
    readFileSync(join(pluginRootDir, 'packages', 'core', 'client-bus.js'), 'utf8')
  ].join('\n');

  const inlineModuleParts = [];
  for (const mod of MODULE_CATALOG) {
    if (!activeSet.has(mod.id)) continue;
    for (const inl of mod.inlineModuleScripts || []) {
      inlineModuleParts.push(readFileSync(resolveModuleAssetPath(mod.id, inl, resolveModuleDir), 'utf8').replaceAll('export function', 'function'));
    }
  }

  const orderedScripts = [
    readFileSync(join(dirname(scriptPath), 'native-client.js'), 'utf8')
  ];
  const byId = id => activeSet.has(id)
    ? (MODULE_CATALOG.find(m => m.id === id)?.clientScripts || []).map(name => readFileSync(resolveModuleAssetPath(id, name, resolveModuleDir), 'utf8'))
    : [];
  orderedScripts.push(
    ...byId('chat-flow').filter((_, i) => i === 0),
    ...byId('i18n'),
    ...byId('telemetry'),
    readFileSync(join(dirname(scriptPath), 'prism-panels.js'), 'utf8'),
    ...byId('optics'),
    ...byId('chat-flow').slice(1),
    readFileSync(join(dirname(scriptPath), 'prism-integration.js'), 'utf8'),
    readFileSync(join(dirname(scriptPath), 'native-panels.js'), 'utf8'),
    ...byId('workspace-nav'),
    ...byId('ssh-remote'),
    readFileSync(join(dirname(scriptPath), 'native-ui.js'), 'utf8')
  );
  const scripts = [...inlineModuleParts, ...orderedScripts].join('\n');
  const buildHash = createHash('sha256').update(JSON.stringify([[...activeSet].sort(), helpers, bindings, scripts])).digest('hex').slice(0, 12);
  return { helpers, bindings, scripts, buildHash, activeList: [...activeSet] };
}

export function nativeSource(origin, declaredNames = [], { priorityState = null, activeModules = DEFAULT_MODULE_IDS, modulesCatalog = null, resolveModuleDir = null } = {}) {
  const aliases=['B','HC','IC','JC','KC','GC','Uy','XP','UP','TP','VP','dq','k0','Sy','kT','lT','mT','nT','um','HU','I','tc','Wb','IJ','LN','VD','Wz','YF','MUa','Gy','Shd'];
  const { helpers, bindings, scripts, buildHash, activeList } = readNativeScripts({ activeModules, resolveModuleDir });
  const initialPriority = priorityState && typeof priorityState === 'object' ? priorityState : { open: false, entries: [] };
  return `if(location.origin===${JSON.stringify(origin)} && window===window.top && (globalThis.__agyPowertools?.version!==${JSON.stringify(pluginVersion)}||globalThis.__agyPowertools?.buildHash!==${JSON.stringify(buildHash)}||globalThis.__agyPowertools?.status?.healthy===false) && !globalThis.__agyNativeBootPending){
globalThis.__agyNativeBuildHash=${JSON.stringify(buildHash)};
globalThis.__agyInstalledModules=${JSON.stringify(activeList)};
globalThis.__agyInitialModulesCatalog=${JSON.stringify(Array.isArray(modulesCatalog) ? modulesCatalog : null)};
globalThis.__agyNativeDefaults=${JSON.stringify(DEFAULT_SETTINGS)};
globalThis.__agyScenePresets=${JSON.stringify(SCENE_PRESETS)};
globalThis.__agyInitialSettings=${JSON.stringify(createSettingsStore().get())};
globalThis.__agyInitialPriorityState=${JSON.stringify(initialPriority)};
globalThis.__agyProject=${JSON.stringify(projectInfo())};
(()=>{${helpers}
globalThis.__agyToZhTw=typeof toZhTw==='function'?toZhTw:(s=>s);
globalThis.__agyDashboard=typeof modelIdentity==='function'?{modelIdentity,timestampToMs,resolveWeeklyQuotaWindow,dateRange,summarizeRequests,subscriptionIdentity,cacheObservation,distributionModels,annotateCacheAnomalies}:null;
globalThis.__agyAccounts=typeof quotaGroupMeta==='function'?{quotaGroupMeta,accountBucketStatus,summarizeAccountQuota,formatRelativeTime,formatResetCountdown,formatCompactCountdown,accountInitials,selectAutoSwitchCandidate}:null;})();
${bindings}
globalThis.__agyNativeBootPending=true;
(()=>{
let retries=0;
const deadline=Date.now()+15000;
function boot(){
  const missing=[];
  if(!document.head)missing.push('document.head');
  if(!document.body)missing.push('document.body');
  if(typeof globalThis.ReactDOM?.createRoot!=='function')missing.push('ReactDOM.createRoot');
  if(typeof globalThis.createFileRoute!=='function')missing.push('createFileRoute');
  if(!document.getElementById?.('root')?.firstElementChild)missing.push('DOM #root');
  if(missing.length){
    if(retries++<150&&Date.now()<deadline){setTimeout(boot,100);return;}
    delete globalThis.__agyNativeBootPending;
    globalThis.__agyCompatibilityError='Missing host bindings: '+missing.join(', ');
    console.error(globalThis.__agyCompatibilityError);
    return;
  }
  try {
    globalThis.__agyPowertools?.dispose();
    const resolved=globalThis.__agyResolveNativeBindings(${JSON.stringify(declaredNames)});
    globalThis.__agyNativeBindings=resolved.bindings;
    globalThis.__agyNativeBindingNames=resolved.names;
    delete globalThis.__agyCompatibilityError;
    (function({${aliases.join(',')}}){
${scripts}
    })(resolved.bindings);
  } catch(error) {
    globalThis.__agyCompatibilityError=error.message;
    console.error(error);
  } finally {
    delete globalThis.__agyNativeBootPending;
  }
}
boot();
})();
}`;
}

export function swarmI18nSource(settingsObj = createSettingsStore().get(), { resolveModuleDir = null } = {}) {
  const zhTw = readFileSync(resolveModuleAssetPath('i18n', 'zh-tw.mjs', resolveModuleDir), 'utf8').replaceAll('export function', 'function');
  const i18n = readFileSync(resolveModuleAssetPath('i18n', 'native-i18n.js', resolveModuleDir), 'utf8');
  const initial = {
    enabled: settingsObj?.enabled !== false,
    language: ['zh-CN', 'zh-TW', 'en'].includes(settingsObj?.language) ? settingsObj.language : 'zh-CN'
  };
  return `if(/^plugin:\\/\\/swarm--swarm_board-/i.test(location.href)){\nglobalThis.__agyInitialSettings=${JSON.stringify(initial)};\n(()=>{${zhTw}\nglobalThis.__agyToZhTw=toZhTw;})();\n${i18n}\nglobalThis.__agyLocalization?.apply(globalThis.__agyInitialSettings.enabled?globalThis.__agyInitialSettings.language:'en',false);\n}`;
}

const isTransientTimeoutError = error => {
  const name = error?.name || '';
  const code = error?.code || error?.cause?.code || '';
  return name === 'TimeoutError' || name === 'AbortError' || code === 'ABORT_ERR' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT';
};

async function forEachTarget(targets, visit) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(targets.length, 4) }, async () => {
    while (next < targets.length) await visit(targets[next++]);
  }));
}

// The inspector's status callback projects the legacy fields. Publish the latest
// diagnostics separately so its in-process Web UI can include them in the response.
export let nativeMountDiagnostics;

export function startNativeIntegration({ parseSessionData, portFile, onStatus = console.log, onMissingDebugPort, onDebugPortReady, connect=connectCdp,discover=nativeDeclarations, remoteTelemetry, marketplaceTranslator, wsl = isWslEnvironment(), createCdpBridge = createWslCdpBridge, moduleRegistryOverride = null }) {
  const paths = installationPaths();
  const dataDir = paths.data;
  const settings = createSettingsStore();
  const appDir = process.env.ANTIGRAVITY_APP_DATA_DIR || join(homedir(), '.gemini', 'antigravity');
  const remote = remoteTelemetry ?? createRemoteTelemetryBridge({ onStatus: message => status(message) });
  let wslBridge = null, usingWslBridge = false;
  let relaunchPendingUntil = 0;
  const triggerRelaunch = (options = undefined) => {
    if (Date.now() < relaunchPendingUntil) throw new Error('正在重启 Antigravity，请稍候');
    const res = scheduleRelaunchWithDebugPort({ dataDir, home: paths.home, ...(options || {}) });
    relaunchPendingUntil = Date.now() + 10000;
    return res;
  };
  const activePortFile = devToolsPortFile({portFile});
  const clients = new Map();
  const swarmClients = new Map();
  let stopped = false, polling = false, lastStatus = '', debugPortReached = false, lastPageTargets = [];
  let portReachable = false, matchedTargets = 0, mountErrors = new Map(), publishedDiagnostics;
  const status = message => { if (message !== lastStatus) { lastStatus = message; onStatus(`[native-ui] ${message}`); } };

  const bus = createHookBus();
  const loadedModules = new Map();
  let syncingModules = null;

  const moduleRegistry = moduleRegistryOverride || createModuleRegistry({
    home: paths.home,
    pluginRoot: pluginRootDir,
    installedPluginDir: paths.installed,
    dataDir,
    settingsStore: settings,
    defaultSettings: DEFAULT_SETTINGS,
    version: pluginVersion,
    githubUrl: projectInfo()?.githubUrl || '',
    syncIntegrations: resolve(paths.installed) === pluginRootDir && existsSync(join(paths.installed, 'plugin.json')),
    onModulesChanged: async () => {
      await ensureModulesLoaded();
      await pushHotReloadToClients();
    }
  });

  const coreCtx = {
    home: paths.home,
    pluginRoot: pluginRootDir,
    dataDir,
    appDir,
    settings,
    remote,
    parseSessionData,
    marketplaceTranslator,
    triggerRelaunch,
    isRelaunchPending: () => Date.now() < relaunchPendingUntil
  };

  async function ensureModulesLoaded() {
    if (syncingModules) return syncingModules;
    syncingModules = (async () => {
      const wantIds = new Set(moduleRegistry.activeIds());
      for (const [id] of [...loadedModules]) {
        if (!wantIds.has(id)) {
          await bus.unload(id);
          loadedModules.delete(id);
        }
      }
      for (const id of wantIds) {
        const modDir = moduleRegistry.moduleDir(id) || join(pluginRootDir, 'packages', id);
        const prevDir = loadedModules.get(id);
        if (prevDir === modDir) continue;
        if (prevDir) await bus.unload(id);
        const entryPath = join(modDir, 'service.mjs');
        // One broken module must not take down every RPC (including modules.uninstall and update.install).
        try {
          if (existsSync(entryPath)) {
            const mod = await import(pathToFileURL(entryPath).href);
            if (typeof mod.registerModule === 'function') {
              await mod.registerModule(bus, coreCtx);
            }
          }
        } catch (error) {
          status(`模块 ${id} 加载失败: ${error?.message || error}`);
          try { await bus.unload(id); } catch {}
        }
        loadedModules.set(id, modDir);
      }
    })().finally(() => { syncingModules = null; });
    return syncingModules;
  }

  function buildClientSource(origin, declaredNames, sshHost = '') {
    const activeModules = moduleRegistry.activeIds();
    const priorityState = activeModules.includes('workspace-nav')
      ? bus.runSync('priority.initialState', { open: false, entries: [] }, { sshHost })
      : { open: false, entries: [] };
    return nativeSource(origin, declaredNames, {
      priorityState,
      activeModules,
      modulesCatalog: moduleRegistry.listModules(),
      resolveModuleDir: id => moduleRegistry.moduleDir(id)
    });
  }

  async function pushHotReloadToClients() {
    if (stopped) return;
    for (const client of [...clients.values()]) {
      try {
        if (!client.origin || !Array.isArray(client.declaredNames)) continue;
        const nextSource = buildClientSource(client.origin, client.declaredNames, client.sshHost);
        try {
          if (client.scriptId) await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId });
          const installed = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: nextSource });
          client.scriptId = installed?.identifier || '';
        } catch {}
        await client.send('Runtime.evaluate', { expression: nextSource });
      } catch {}
    }
    if (!moduleRegistry.isActive('i18n')) {
      for (const swarmClient of [...swarmClients.values()]) {
        try {
          if (swarmClient.scriptId) await swarmClient.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: swarmClient.scriptId });
          await swarmClient.send('Runtime.evaluate', { expression: 'globalThis.__agyLocalization?.dispose()' });
        } catch {}
      }
    }
  }

  const syncSwarmLanguage = () => {
    if (!moduleRegistry.isActive('i18n')) return;
    const cur = settings.get();
    const lang = cur.enabled ? cur.language : 'en';
    for (const swarmClient of swarmClients.values()) {
      void swarmClient.send('Runtime.evaluate', {
        expression: `globalThis.__agyLocalization?.apply(${JSON.stringify(lang)},false)`
      }).catch(() => {});
    }
  };
  const attachSwarm = async target => {
    if (!moduleRegistry.isActive('i18n')) return;
    const client = await connect(target.webSocketDebuggerUrl);
    client.endpoint = target.webSocketDebuggerUrl;
    client.url = target.url;
    swarmClients.set(target.id, client);
    client.socket.addEventListener('close', () => { if (swarmClients.get(target.id) === client) swarmClients.delete(target.id); });
    const source = swarmI18nSource(settings.get(), { resolveModuleDir: id => moduleRegistry.moduleDir(id) });
    try {
      await client.send('Page.enable');
      const installed = await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
      client.scriptId = installed?.identifier || '';
    } catch { /* Some iframe targets do not support Page.addScriptToEvaluateOnNewDocument. */ }
    const result = await client.send('Runtime.evaluate', { expression: source });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text);
  };
  const filterPortableSettings = obj => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      if (PORTABLE_SETTINGS_KEYS.has(k)) out[k] = v;
    }
    return out;
  };
  const initializeClient = async (target, client) => {
    await ensureModulesLoaded();
    const origin = new URL(target.url).origin;
    const mainFrame = (await client.send('Page.getFrameTree')).frameTree.frame.id;
    const contexts = new Set();
    const resolveHost = async () => {
      if (client.sshHost) return client.sshHost;
      if (client.sshKind !== 'ssh') return '';
      try {
        const res = await client.send('Runtime.evaluate', {
          expression: `(async()=>{let sshHost='';const ssh=globalThis.sshRemote;if(ssh?.kind==='ssh'&&typeof ssh.getState==='function'){try{const st=await ssh.getState();if(typeof st?.currentHost==='string')sshHost=st.currentHost.trim();}catch{}}return{sshHost,title:typeof document!=='undefined'?document.title||'':''};})()`,
          awaitPromise: true,
          returnByValue: true
        });
        const v = res.result?.value;
        const found = (v && typeof v === 'object' && v.sshHost ? String(v.sshHost).trim() : '')
          || (v && typeof v === 'object' ? parseSshWindowTitle(v.title) : '');
        if (found) client.sshHost = found;
      } catch { /* Keep unresolved if renderer is navigating. */ }
      return client.sshHost || '';
    };
    client.onEvent(async event => {
      if (event.method === 'Runtime.executionContextCreated') {
        const context = event.params.context;
        if (context.origin === origin && context.auxData?.isDefault && context.auxData.frameId === mainFrame) contexts.add(context.id);
        return;
      }
      if (event.method === 'Runtime.executionContextDestroyed') { contexts.delete(event.params.executionContextId); return; }
      if (event.method === 'Runtime.executionContextsCleared') { contexts.clear(); return; }
      if (event.method !== 'Runtime.bindingCalled' || event.params.name !== '__agyPowertoolsHost') return;
      if (!contexts.has(event.params.executionContextId)) return;
      let envelope;
      // 2 MiB leaves room for a JSON-escaped 512 KB file save from the file tree.
      try { if (event.params.payload.length > 2 * 1024 * 1024) return; envelope = JSON.parse(event.params.payload); } catch { return; }
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return;
      const rpcId = Number.isInteger(envelope.__rpcId) ? envelope.__rpcId : envelope.id;
      const rpcMethod = typeof envelope.__rpcMethod === 'string' ? envelope.__rpcMethod : envelope.method;
      if (!Number.isInteger(rpcId) || typeof rpcMethod !== 'string') return;
      const hasIsolatedPayload = Boolean(
        envelope.payload && typeof envelope.payload === 'object' && !Array.isArray(envelope.payload)
        && (Number.isInteger(envelope.__rpcId) || Object.keys(envelope).every(key => key === 'id' || key === 'method' || key === 'payload'))
      );
      const request = hasIsolatedPayload ? { ...envelope.payload, method: rpcMethod } : { ...envelope, method: rpcMethod };
      let reply;
      try {
        await ensureModulesLoaded();
        const alwaysAllowed = ['settings.get', 'settings.set', 'settings.export', 'settings.import', 'modules.list', 'modules.install', 'modules.uninstall', 'update.check', 'update.install', 'update.status'];
        if (!settings.get().enabled && !alwaysAllowed.includes(request.method)) throw new Error('Antigravity Max 已关闭');
        if (request.method === 'settings.get') reply = settings.get();
        else if (request.method === 'settings.set') {
          reply = settings.set(request.settings);
          if (request.settings && (Object.hasOwn(request.settings, 'agyFast') || Object.hasOwn(request.settings, 'enabled'))) {
            try { syncBundledAgyFast({ enabled: Boolean(reply.enabled && reply.agyFast && moduleRegistry.isActive('workspace-nav')) }); } catch {}
          }
          syncSwarmLanguage();
        }
        else if (request.method === 'settings.export') {
          if (!settings.get().enabled) throw new Error('Antigravity Max 已关闭');
          const bundle = exportSanitizedSettings(settings.get());
          bundle.settings = filterPortableSettings(bundle.settings);
          reply = { bundle };
        }
        else if (request.method === 'settings.import') {
          if (!settings.get().enabled) throw new Error('Antigravity Max 已关闭');
          const patch = filterPortableSettings(importSanitizedSettings(request.bundle, settings.get()));
          if (!Object.keys(patch).length) throw new Error('没有可以导入的设置');
          reply = { patch };
        }
        else if (request.method === 'modules.list') {
          reply = { ok: true, modules: moduleRegistry.listModules(), activeIds: moduleRegistry.activeIds() };
        }
        else if (request.method === 'modules.install') {
          reply = await moduleRegistry.installModule(request.id, { preferSeed: request.preferSeed === true });
        }
        else if (request.method === 'modules.uninstall') {
          reply = await moduleRegistry.uninstallModule(request.id, { purgeData: request.purgeData === true });
        }
        else if (request.method === 'update.check') reply = await checkForUpdates({ currentVersion: pluginVersion });
        else if (request.method === 'update.install') reply = await startUpdate({ currentVersion: pluginVersion, expectedVersion: request.version });
        else if (request.method === 'update.status') reply = updateStatus();
        else if (request.method === 'ssh.saveConfigHost') {
          if (!moduleRegistry.isActive('ssh-remote')) throw new Error('SSH 远端工程模块未安装');
          const dispatchedSsh = await bus.dispatchRpc(request.method, request, { resolveHost, sshKind: client.sshKind });
          if (!dispatchedSsh.handled) throw new Error('不支持的操作');
          reply = dispatchedSsh.reply;
        }
        else {
          const dispatched = await bus.dispatchRpc(request.method, request, { resolveHost, sshKind: client.sshKind });
          if (dispatched.handled) reply = dispatched.reply;
          else throw new Error('不支持的操作');
        }
      } catch (error) { reply = { error: error.message }; }
      try {
        await client.send('Runtime.evaluate', {
          expression: `globalThis.__agyPowertoolsReceive?.(${JSON.stringify(rpcId)},${JSON.stringify(reply)})`,
          contextId: event.params.executionContextId
        });
      } catch { /* Navigation invalidates the old context. */ }
    });
    await client.send('Runtime.enable');
    await client.send('Runtime.addBinding', { name: '__agyPowertoolsHost' });
    const agent = await client.send('Runtime.evaluate', {
      expression: `(async()=>{const ua=navigator.userAgent||'';const ssh=globalThis.sshRemote;let sshHost='';if(ssh?.kind==='ssh'&&typeof ssh.getState==='function'){try{const st=await ssh.getState();if(typeof st?.currentHost==='string')sshHost=st.currentHost.trim();}catch{}}const isHub=Boolean(/Antigravity\\//.test(ua)||globalThis.electronNative||globalThis.sshRemote||globalThis.createFileRoute);return{ua,isHub,sshKind:ssh?.kind||'',sshHost,title:typeof document!=='undefined'?document.title||'':''};})()`,
      awaitPromise: true,
      returnByValue: true
    });
    const probe = agent.result?.value;
    if (probe && typeof probe === 'object' && probe.isHub === false) {
      throw new Error('调试目标不是 Antigravity 主窗口');
    }
    const ua = typeof probe === 'string' ? probe : (probe && typeof probe === 'object' ? String(probe.ua || '') : '');
    const version = ua.match(/Antigravity\/([0-9.]+)/)?.[1] || 'unknown';
    client.sshKind = probe && typeof probe === 'object' ? String(probe.sshKind || '') : '';
    client.sshHost = (probe && typeof probe === 'object' && probe.sshHost ? String(probe.sshHost).trim() : '')
      || parseSshWindowTitle(target.title)
      || (probe && typeof probe === 'object' ? parseSshWindowTitle(probe.title) : '');
    const fallbackFetch = async (_origin, reqHeaders = {}) => {
      const fetchInit = reqHeaders && Object.keys(reqHeaders).length ? `,${JSON.stringify({ headers: reqHeaders })}` : '';
      const fetched = await client.send('Runtime.evaluate', {
        expression: `fetch('/main.js'${fetchInit}).then(async r=>({status:r.status,source:r.ok?await r.text():'',headers:{etag:r.headers.get('etag')||undefined,'last-modified':r.headers.get('last-modified')||undefined}}))`,
        awaitPromise: true, returnByValue: true
      });
      if (fetched.exceptionDetails || !fetched.result?.value) throw new Error('页面上下文读取原生界面组件失败');
      return fetched.result.value;
    };
    const isRemoteTarget = Boolean(client.sshHost || client.sshKind === 'ssh');
    client.declaredNames = await discover(origin, {
      version,
      fallbackFetch,
      ...(isRemoteTarget ? { cacheScope: 'ssh', preferFallback: true } : usingWslBridge ? { preferFallback: true } : {})
    });
    const source = buildClientSource(origin, client.declaredNames, client.sshHost);
    client.origin = origin;
    client.endpoint=target.webSocketDebuggerUrl;
    await client.send('Page.enable');
    const installed = await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
    client.scriptId = installed.identifier;
    const result = await client.send('Runtime.evaluate', { expression: source });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  };
  const attach = async target => {
    const client = await connect(target.webSocketDebuggerUrl);
    let handedOff = false;
    try {
      await initializeClient(target, client);
      if (stopped) return;
      if (client.socket.readyState != null && client.socket.readyState !== WebSocket.OPEN) {
        throw new Error('调试接口已断开');
      }
      client.socket.addEventListener('close', () => {
        if (clients.get(target.id) === client) clients.delete(target.id);
      });
      clients.set(target.id, client);
      handedOff = true;
    } finally {
      if (!handedOff) client.socket.close();
    }
    status('已接入原生输入框');
  };
  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const port = Number(readFileSync(activePortFile, 'utf8').split('\n')[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('调试端口不可用');
      let targets;
      let directErr = null;
      if (!usingWslBridge) {
        try {
          targets = await fetchCdpTargets('127.0.0.1', port, wsl ? 1500 : 5000);
        } catch (err) {
          directErr = err;
          if (!wsl) throw err;
        }
      }
      if (!targets && wsl) {
        try {
          if (!wslBridge) wslBridge = createCdpBridge();
          const ep = await wslBridge.endpointFor(port);
          const rawTargets = await fetchCdpTargets(ep.host, ep.port, 5000);
          if (!Array.isArray(rawTargets)) throw new Error('调试接口返回格式异常');
          targets = wslBridge.rewriteTargets(rawTargets, port);
          usingWslBridge = true;
        } catch (bridgeErr) {
          usingWslBridge = false;
          throw directErr || bridgeErr;
        }
      }
      if (!Array.isArray(targets)) throw new Error('调试接口返回格式异常');
      debugPortReached = true;
      portReachable = true;
      try { onDebugPortReady?.(); } catch {}
      const hubs = targets.filter(t => isHubTarget(t) || (isLoopbackHttpsPage(t) && clients.get(t.id)?.origin === new URL(t.url).origin));
      lastPageTargets = targets.filter(isLoopbackHttpsPage).map(t => ({ title: String(t.title || ''), matched: hubs.includes(t) }));
      matchedTargets = hubs.length;
      const nextMountErrors = new Map();
      await forEachTarget(hubs, async target => {
        if (stopped) return;
        let client = clients.get(target.id);
        try {
          if(client&&(client.origin!==new URL(target.url).origin||client.endpoint!==target.webSocketDebuggerUrl)){
            client.socket.close();clients.delete(target.id);client=null;
          }
          if (!client) await attach(target);
          else if (Date.now() >= (client.retryAfter || 0)) {
            // A live CDP connection does not guarantee that its renderer survived or matches current buildHash.
            await ensureModulesLoaded();
            const { buildHash } = readNativeScripts({
              activeModules: moduleRegistry.activeIds(),
              resolveModuleDir: id => moduleRegistry.moduleDir(id)
            });
            const result = await client.send('Runtime.evaluate', {
              expression: `location.origin===${JSON.stringify(client.origin)} && (!globalThis.__agyPowertools||globalThis.__agyPowertools.buildHash!==${JSON.stringify(buildHash)}||globalThis.__agyPowertools.status?.healthy===false) && !globalThis.__agyNativeBootPending && !globalThis.__agyPowertoolsPending && document.readyState!=='loading'`,
              returnByValue: true
            });
            if (result.result?.value === true) {
              const nextSource = buildClientSource(client.origin, client.declaredNames, client.sshHost);
              try {
                if (client.scriptId) await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId });
                const installed = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: nextSource });
                client.scriptId = installed?.identifier || '';
              } catch {}
              const restored = await client.send('Runtime.evaluate', { expression: nextSource });
              if (restored.exceptionDetails) throw new Error(restored.exceptionDetails.text);
              client.retryAfter = Date.now() + 15000;
              status('已热更新原生控件');
            }
          }
        } catch (error) {
          clients.get(target.id)?.socket.close();
          clients.delete(target.id);
          nextMountErrors.set(target.id, error.message);
          status(error.message);
        }
      });
      mountErrors = new Map(hubs.filter(target => nextMountErrors.has(target.id)).map(target => [target.id, nextMountErrors.get(target.id)]));
      const ids = new Set(hubs.map(t => t.id));
      for (const [id, client] of clients) if (!ids.has(id)) { client.socket.close(); clients.delete(id); }
      const swarms = moduleRegistry.isActive('i18n') ? targets.filter(isSwarmTarget) : [];
      await forEachTarget(swarms, async target => {
        if (stopped) return;
        let swarmClient = swarmClients.get(target.id);
        try {
          if (swarmClient && (swarmClient.url !== target.url || swarmClient.endpoint !== target.webSocketDebuggerUrl)) {
            swarmClient.socket.close(); swarmClients.delete(target.id); swarmClient = null;
          }
          if (!swarmClient) await attachSwarm(target);
          else {
            const cur = settings.get();
            const wantLang = cur.enabled ? cur.language : 'en';
            const check = await swarmClient.send('Runtime.evaluate', {
              expression: `({ready:Boolean(globalThis.__agyLocalization),lang:globalThis.__agyLocalization?.language||''})`,
              returnByValue: true
            });
            const v = check?.result?.value;
            if (!v?.ready) {
              await swarmClient.send('Runtime.evaluate', { expression: swarmI18nSource(cur, { resolveModuleDir: id => moduleRegistry.moduleDir(id) }) });
            } else if (v.lang !== wantLang) {
              await swarmClient.send('Runtime.evaluate', { expression: `globalThis.__agyLocalization?.apply(${JSON.stringify(wantLang)},false)` });
            }
          }
        } catch { swarmClients.get(target.id)?.socket.close(); swarmClients.delete(target.id); }
      });
      const swarmIds = new Set(swarms.map(t => t.id));
      for (const [id, swarmClient] of swarmClients) if (!swarmIds.has(id)) { swarmClient.socket.close(); swarmClients.delete(id); }
      if (!hubs.length) status('等待 Antigravity 窗口');
    } catch (error) {
      portReachable = false;
      matchedTargets = 0;
      mountErrors = new Map();
      lastPageTargets = [];
      status('等待 Antigravity 本地调试接口');
      if (!debugPortReached && !clients.size && !isTransientTimeoutError(error)) {
        try { onMissingDebugPort?.(); } catch {}
      }
    }
    finally { polling = false; }
  };
  const timer = setInterval(poll, 4000);
  const initialPoll=poll();
  const stop = async ({purge=false}={}) => {
    stopped = true; clearInterval(timer);
    if (nativeMountDiagnostics === publishedDiagnostics) nativeMountDiagnostics = undefined;
    for (const client of clients.values()) {
      try {
        await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId });
        if(purge)await client.send('Runtime.evaluate',{expression:`(async()=>{if(location.pathname==='/powertools')await globalThis.__agyNativeAdapter?.router()?.navigate({to:'/customizations'});localStorage.removeItem('agy-powertools-language');localStorage.removeItem('agy-marketplace-i18n-v1');localStorage.removeItem('agy-marketplace-i18n-v2');})()`,awaitPromise:true});
        await client.send('Runtime.evaluate', { expression: 'globalThis.__agyPowertools?.dispose()' });
      } catch {}
      client.socket.close();
    }
    clients.clear();
    for (const swarmClient of swarmClients.values()) {
      try {
        if (swarmClient.scriptId) await swarmClient.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: swarmClient.scriptId });
        await swarmClient.send('Runtime.evaluate', { expression: 'globalThis.__agyLocalization?.dispose()' });
      } catch {}
      swarmClient.socket.close();
    }
    swarmClients.clear();
    await wslBridge?.close?.();
    wslBridge = null;
    await bus.clear();
    loadedModules.clear();
    await remote?.close?.();
  };
  stop.fork = async (conversationId, stepIndex = -1) => {
    for (const client of clients.values()) {
      const result = await client.send('Runtime.evaluate', {
        expression: `globalThis.__agyNativeAdapter.fork(${JSON.stringify(conversationId)},${JSON.stringify(stepIndex)})`,
        awaitPromise: true, returnByValue: true
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    throw new Error('请先打开 Antigravity 会话窗口');
  };
  stop.ready=initialPoll;
  stop.check=poll;
  stop.health=async()=>{
    await initialPoll;
    const entries = [...clients];
    const discovery = { portReachable, matchedTargets, pageTargets: lastPageTargets };
    const failures = new Map(mountErrors);
    const results = new Map();
    await forEachTarget(entries, async ([id, client]) => {
      try {
        const result = await client.send('Runtime.evaluate', {
          expression: `({version:globalThis.__agyPowertools?.version,healthy:globalThis.__agyPowertools?.status?.healthy,mounted:globalThis.__agyPowertools?.status?.mounted,conversationId:globalThis.__agyPowertools?.status?.conversationId||'',compatibilityError:globalThis.__agyCompatibilityError||'',renderError:globalThis.__agyPowertools?.status?.error||'',bootPending:Boolean(globalThis.__agyNativeBootPending||globalThis.__agyPowertoolsPending||document.readyState==='loading'),clientVersion:navigator.userAgent.match(/Antigravity\\/([0-9.]+)/)?.[1]||''})`,
          returnByValue: true
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        results.set(id, result.result?.value);
      } catch (error) {
        failures.set(id, error.message);
      }
    });
    let compatibilityError = '', clientVersion = '', mountedCount = 0;
    const windows = [];
    for (const [id, client] of entries) {
      if (!results.has(id)) continue;
      const value = results.get(id);
      const healthy = Boolean(value?.version === pluginVersion && value?.healthy);
      if (value?.clientVersion && !clientVersion) clientVersion = String(value.clientVersion);
      if (healthy) mountedCount++;
      else if (value?.compatibilityError || !value?.bootPending) {
        if (value?.compatibilityError && !compatibilityError) compatibilityError = String(value.compatibilityError);
        failures.set(id, value?.compatibilityError || value?.renderError || '原生界面尚未挂载');
      }
      windows.push({
        sshHost: client.sshHost || null,
        healthy,
        mounted: Number(value?.mounted) || 0,
        conversationId: String(value?.conversationId || '')
      });
    }
    const diagnostics = {
      portReachable: discovery.portReachable,
      matchedTargets: discovery.matchedTargets,
      mountedCount: discovery.portReachable ? mountedCount : 0,
      failedCount: discovery.portReachable ? failures.size : 0,
      firstError: discovery.portReachable ? failures.values().next().value || '' : ''
    };
    if (!stopped) nativeMountDiagnostics = publishedDiagnostics = diagnostics;
    return {
      healthy: mountedCount > 0,
      compatibilityError: mountedCount ? '' : compatibilityError,
      clientVersion,
      connected: entries.length > 0,
      windows,
      pageTargets: discovery.pageTargets,
      ...diagnostics
    };
  };
  return stop;
}
