import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAppDataDir, listRecentConversations, resolveConversationId, parseSessionData, exportTranscript } from '../../lib/session-parser.mjs';
import { startNativeIntegration } from '../../lib/native-host.mjs';
import { serveRuntime } from '../../lib/runtime-control.mjs';
import { installationPaths } from '../../lib/lifecycle.mjs';
import { createSettingsStore } from '../../lib/settings.mjs';
import { clearAutoRelaunchAttempt, configureLaunchers, hasCustomLauncher, isRemoteSshEnvironment, manualLaunchCommand, maybePromptPostUpdateRelaunch, scheduleRelaunchWithDebugPort } from '../../lib/launcher.mjs';
import { startSidecarWebUi } from '../../lib/sidecar-ui.mjs';
import { DEFAULT_PROXY_BYPASS } from '../../lib/proxy.mjs';
import { checkForUpdates } from '../../lib/updates.mjs';
import { startUpdate, updateStatus } from '../../lib/update-manager.mjs';

export { getAppDataDir, listRecentConversations, resolveConversationId, parseSessionData, exportTranscript };

function isMain() {
  if (typeof import.meta.main === 'boolean') return import.meta.main;
  if (!process.argv[1]) return false;
  const canonical = path => {
    let absolute = resolve(path);
    try { absolute = realpathSync.native(absolute); } catch {}
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  };
  return canonical(fileURLToPath(import.meta.url)) === canonical(process.argv[1]);
}

if (isMain()) {
  for (const key of ['NO_PROXY', 'no_proxy']) {
    const entries = (process.env[key] || '').split(',').map(entry => entry.trim()).filter(Boolean);
    const seen = new Set(entries.map(entry => entry.toLowerCase()));
    process.env[key] = [...entries, ...DEFAULT_PROXY_BYPASS.split(',').filter(entry => !seen.has(entry))].join(',');
  }
  const paths = installationPaths();
  const settings = createSettingsStore();
  const remoteSsh = isRemoteSshEnvironment();
  let missingPortPolls = 0, shortcutsHealed = false, everConnectedDebugPort = false, shuttingDown = false;
  let cancelPostUpdatePrompt = null;
  const dismissPostUpdatePrompt = () => {
    try { cancelPostUpdatePrompt?.(); } catch {}
    cancelPostUpdatePrompt = null;
  };
  const stop = startNativeIntegration({
    parseSessionData,
    onDebugPortReady() {
      everConnectedDebugPort = true;
      missingPortPolls = 0;
      dismissPostUpdatePrompt();
      try { clearAutoRelaunchAttempt(paths.data); } catch {}
    },
    onMissingDebugPort() {
      if (shuttingDown || remoteSsh || everConnectedDebugPort) return;
      missingPortPolls++;
      if (!shortcutsHealed) {
        shortcutsHealed = true;
        if (!hasCustomLauncher(paths.data)) {
          try { configureLaunchers({ home: paths.home, dataDir: paths.data }); } catch {}
        }
      }
      if (missingPortPolls >= 3) {
        const current = settings.get();
        if (current.enabled !== false) {
          const promptRes = maybePromptPostUpdateRelaunch({
            dataDir: paths.data,
            installDir: paths.installed,
            language: current.language || 'zh-CN',
            home: paths.home
          });
          if (typeof promptRes?.cancel === 'function') {
            cancelPostUpdatePrompt = promptRes.cancel;
          }
        }
      }
    }
  });
  const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  const closeWebUi = await startSidecarWebUi({
    version,
    getStatus: async () => {
      const current = settings.get();
      const health = await stop.health();
      return {
        healthy: health.healthy,
        sidecarReady: true,
        compatibilityError: health.compatibilityError || '',
        clientVersion: health.clientVersion || '',
        connected: Boolean(health.connected),
        enabled: current.enabled !== false,
        language: current.language || 'zh-CN',
        platform: process.platform,
        macLauncherApp: process.platform === 'darwin' ? join(paths.home, 'Applications', 'Antigravity (Max).app') : '',
        mode: remoteSsh ? 'ssh-remote' : 'local',
        manualCommand: remoteSsh ? '' : manualLaunchCommand({ home: paths.home }),
        update: updateStatus()
      };
    },
    onRelaunch: () => remoteSsh ? { scheduled: false, reason: 'ssh-remote' } : scheduleRelaunchWithDebugPort({ dataDir: paths.data, home: paths.home }),
    onCheckUpdate: () => checkForUpdates({ currentVersion: version }),
    onInstallUpdate: ({ version: expectedVersion } = {}) => startUpdate({ currentVersion: version, expectedVersion }),
    onUpdateStatus: () => updateStatus()
  }).catch(error => {
    console.error('Sidecar Web UI startup failed:', error);
    return async () => {};
  });
  let stopping;
  function shutdown(options) {
    shuttingDown = true;
    dismissPostUpdatePrompt();
    stopping ??= Promise.resolve().then(async () => {
      try { await stop(options); } finally { await closeWebUi(); }
    });
    return stopping;
  }

  let closeRuntime;
  try {
    closeRuntime = await serveRuntime({
      directory: join(paths.data, 'runtime'),
      version,
      stop: shutdown,
      health: async () => ({ ...await stop.health(), sidecarReady: true })
    });
  } catch (error) {
    await shutdown();
    throw error;
  }

  for (const event of ['SIGINT', 'SIGTERM']) {
    process.on(event, () => {
      void shutdown().finally(closeRuntime).then(() => process.exit(0), error => {
        console.error('Sidecar shutdown failed:', error);
        process.exit(1);
      });
    });
  }
}
