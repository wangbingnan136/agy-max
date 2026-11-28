import { join } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createOmniGateway, resolveSafeDiffPath } from './omni-gateway.mjs';
import { exportSanitizedSettings, importSanitizedSettings } from './settings.mjs';

const realpathCanonical = typeof realpathSync.native === 'function' ? realpathSync.native : realpathSync;
const routes = new Set(['settings.export', 'settings.import', 'chatFolders.get', 'chatFolders.save', 'diff.inline']);

export const PORTABLE_SETTINGS_KEYS = new Set([
  // Language & UI layout / telemetry display
  'language', 'marketplaceTranslate', 'overviewRange', 'priorityVisibleRows', 'priorityWindow', 'priorityMaxItems', 'sidebarProjectLimit', 'sidebarProjectPin', 'auxFileTree',
  'compact', 'userBubbleTint', 'userBubblePreset', 'userBubbleColor',
  'contextRing', 'speedStats', 'composerIndicatorTone', 'composerIndicatorCompact', 'composerQuota', 'composerQuotaWindow', 'gitStatusPill', 'timing', 'toolDetails',
  'responseBranch', 'conversationMove', 'btwSubtree', 'copySessionMarkdown', 'messageEdit', 'goalBar',
  'sessionSearch', 'sessionSearchShortcut', 'sidebarFocusBell',
  'progress', 'overviewQuota', 'subagentTelemetry',
  'keepTurnOutline', 'keepOverviewOpen', 'pinOverview', 'taskbarBadge',
  // Optics & motion
  'themePalette', 'lightThemePreset', 'accentTone', 'cornerStyle',
  'codeFont', 'codeLigatures', 'ambientIntensity',
  'sidebarCompact', 'sidebarNavFold', 'composerRestyle', 'placeholderStyle', 'logoInk',
  'motionLevel', 'targetFps', 'contextStyle', 'smoothCaret', 'scrollBottomMotion',
  'streamInk', 'convAura', 'prismRim', 'homeRipple', 'mascotMode',
  // Workbench
  'effortSlider', 'effortMemory', 'codeBlockFold', 'railHoverOutline',
  'inlineStepDiff', 'omniViewer', 'linkTarget', 'quickContextMenu',
  // Studio
  'homeStudio', 'chatModeBeta'
]);

function filterPortableSettings(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (PORTABLE_SETTINGS_KEYS.has(key)) out[key] = value;
  }
  return out;
}

export function createPrismService({ settings, dataDir, workspaceOf }) {
  const files = createOmniGateway(dataDir);

  return {
    handles: method => routes.has(method),
    async request(payload, { remoteWindow = false } = {}) {
      const opts = settings.get();
      if (!opts.enabled) throw new Error('Antigravity Max 已关闭');
      switch (payload.method) {
        case 'settings.export': {
          const bundle = exportSanitizedSettings(opts);
          bundle.settings = filterPortableSettings(bundle.settings);
          return { bundle };
        }
        case 'settings.import': {
          const patch = filterPortableSettings(importSanitizedSettings(payload.bundle, opts));
          if (!Object.keys(patch).length) throw new Error('没有可以导入的设置');
          return { patch };
        }
        case 'chatFolders.get':
        case 'chatFolders.save':
          if (!opts.chatModeBeta) throw new Error('Chat 模式未开启');
          return payload.method === 'chatFolders.get' ? files.chatFoldersGet() : files.chatFoldersSave(payload);
        case 'diff.inline': {
          if (!opts.inlineStepDiff || remoteWindow) throw new Error('当前窗口不支持行内差异');
          const { conversationId, path } = payload;
          if (typeof conversationId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(conversationId) || typeof path !== 'string' || !path || path.length > 4096) throw new Error('会话或文件路径无效');
          const workspace = workspaceOf(conversationId);
          if (typeof workspace !== 'string' || !/^file:\/\/\//i.test(workspace)) throw new Error('未找到本地工作区');
          let rootPath;
          try {
            const parsedWs = new URL(workspace);
            parsedWs.search = '';
            parsedWs.hash = '';
            const rawRoot = fileURLToPath(parsedWs);
            rootPath = rawRoot === '/' || /^[A-Za-z]:[\\/]$/.test(rawRoot) ? rawRoot : rawRoot.replace(/[\\/]+$/, '');
          } catch {
            throw new Error('未找到本地工作区');
          }
          let rootStat;
          try {
            rootStat = lstatSync(rootPath);
          } catch {
            throw new Error('未找到本地工作区');
          }
          if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('不支持符号链接工作区');
          const root = realpathCanonical(rootPath);
          let gitStat;
          try {
            gitStat = lstatSync(join(root, '.git'));
          } catch {
            throw new Error('行内差异需要普通 Git 仓库');
          }
          if (!gitStat.isDirectory()) throw new Error('行内差异需要普通 Git 仓库');
          const target = resolveSafeDiffPath(root, path);
          return files.inlineDiff({ workspaceUri: root, path: target.relPath, safeRead: true });
        }
        default: throw new Error('不支持的操作');
      }
    }
  };
}
