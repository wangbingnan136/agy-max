import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSshProjectsStore, normalizeCapabilityScope, readSshProjectMarker, sshProjectMarkerFileExists } from './ssh-projects.mjs';
import { isSshModuleInstalled } from '../packages/core/module-registry.mjs';

const SSH_MCP_ID = 'agy-ssh-projects';

// Allowlist model (upstream research 2026-11-27, item 2): inside an SSH project every
// non-SSH tool is classified. Anything carrying a path argument is path-checked no matter
// what it is called; unclassified tools without paths fall back to `ask`, never silent allow.
export const LOCAL_EXEC_TOOLS = new Set(['run_command', 'send_command_input']);
export const LOCAL_WRITE_TOOLS = new Set(['write_file', 'write_to_file', 'edit_file', 'replace_file_content', 'multi_replace_file_content', 'delete_file']);
export const LOCAL_READ_TOOLS = new Set(['read_file', 'view_file', 'view_file_outline', 'view_code_item', 'list_dir', 'list_directory', 'find_by_name', 'grep_search', 'codebase_search']);
export const SAFE_TOOLS = new Set([
  'search_web', 'read_url_content', 'view_content_chunk',
  'task_boundary', 'notify_user', 'command_status',
  'update_focus', 'update_steps', 'ask_question', 'search_marketplace', 'list_plugin_accounts',
  'generate_image', 'list_resources', 'read_resource'
]);
const SAFE_PREFIXES = ['browser_'];
const PATH_ARG_RE = /(path|paths|file|files|dir|dirs|directory|directories|cwd|uri|uris)$/i;
// Values that name a local location no matter which argument carries them.
const ABS_PATH_VALUE_RE = /^(?:\/|~(?:[\\/]|$)|[a-zA-Z]:[\\/]|\\\\|file:\/\/)/;
// With ssh-remote uninstalled (data kept) the boundary still holds, but the ssh_* tools are gone.
const MODULE_MISSING_HINT = 'SSH 远端工程模块（SSH Projects）当前未安装或已停用，ssh_* 工具不可用。请在 Antigravity Max → 模块 中重新安装「SSH 远端工程 / SSH Projects」模块后再操作该项目。';

function sshToolsInstalled(home) {
  try { return isSshModuleInstalled({ home }); } catch { return false; }
}

function isPathInside(rootDir, targetPath, platform = process.platform) {
  if (!rootDir || !targetPath) return false;
  const norm = p => {
    const abs = resolve(p);
    return platform === 'win32' ? abs.toLowerCase() : abs;
  };
  const rel = relative(norm(rootDir), norm(targetPath));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function extractSkillOrPluginFromPath(targetPath, { home = homedir(), platform = process.platform } = {}) {
  const cfgRoot = join(home, '.gemini', 'config');
  const skillsRoot = join(cfgRoot, 'skills');
  const pluginsRoot = join(cfgRoot, 'plugins');
  const builtinRoot = join(home, '.gemini', 'antigravity', 'builtin', 'skills');
  if (isPathInside(builtinRoot, targetPath, platform)) return { kind: 'builtin-skill', name: '' };
  if (isPathInside(skillsRoot, targetPath, platform)) {
    const rel = relative(resolve(skillsRoot), resolve(targetPath)).replaceAll('\\', '/');
    const name = rel.split('/').filter(Boolean)[0] || '';
    return { kind: 'skill', name };
  }
  if (isPathInside(pluginsRoot, targetPath, platform)) {
    const rel = relative(resolve(pluginsRoot), resolve(targetPath)).replaceAll('\\', '/');
    const parts = rel.split('/').filter(Boolean);
    const pluginName = parts[0] || '';
    const skillName = parts[1] === 'skills' ? (parts[2] || '') : '';
    return { kind: 'plugin', pluginName, skillName };
  }
  return null;
}

function extractMcpServer(toolName, args = {}) {
  if (toolName === 'call_mcp_tool') {
    return String(args.ServerName || args.serverName || '').trim();
  }
  if (toolName.startsWith('mcp_')) {
    // Format: mcp_<server>_<tool> (server names may contain hyphens or underscores like agy-fast_fast)
    const rest = toolName.slice(4);
    if (rest.startsWith(`${SSH_MCP_ID}_`)) return SSH_MCP_ID;
    if (rest.startsWith('agy-fast_fast_')) return 'agy-fast';
    const idx = rest.indexOf('_');
    return idx > 0 ? rest.slice(0, idx) : rest;
  }
  return '';
}

function collectPathArgs(args = {}) {
  const out = [];
  const push = value => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
  };
  for (const [key, value] of Object.entries(args)) {
    if (!PATH_ARG_RE.test(key)) continue;
    if (Array.isArray(value)) value.forEach(push);
    else push(value);
  }
  return out;
}

// Every string anywhere in the args (nested too) that looks like an absolute local path.
function collectPathLikeValues(value, out = [], depth = 0) {
  if (depth > 8) return out;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (ABS_PATH_VALUE_RE.test(trimmed)) out.push(trimmed);
  } else if (Array.isArray(value)) {
    for (const item of value) collectPathLikeValues(item, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectPathLikeValues(item, out, depth + 1);
  }
  return out;
}

function toLocalPath(raw, baseDir, home = homedir()) {
  if (raw.startsWith('file://')) {
    try { return fileURLToPath(raw); } catch { return raw; }
  }
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) return join(home, raw.slice(2));
  return isAbsolute(raw) || !baseDir ? raw : resolve(baseDir, raw);
}

function resolveProjectFromHookPayload(payload = {}) {
  const candidates = [
    payload.cwd,
    ...(Array.isArray(payload.workspacePaths) ? payload.workspacePaths : [])
  ].filter(Boolean);
  for (const candidate of candidates) {
    const marker = readSshProjectMarker(candidate);
    if (!marker) continue;
    let project = null;
    try {
      const store = createSshProjectsStore({ dataDir: marker.dataDir });
      project = store.getProject(marker.projectId);
    } catch {}
    const hostLabel = project?.host?.name || project?.host?.host || marker.hostLabel || marker.hostId;
    return {
      projectId: project?.id || marker.projectId,
      name: project?.name || marker.name || hostLabel,
      hostId: project?.hostId || marker.hostId,
      hostLabel,
      host: project?.host || null,
      remoteDir: project?.remoteDir ?? marker.remoteDir ?? '',
      capabilityScope: normalizeCapabilityScope(project?.capabilityScope || marker.capabilityScope),
      workspaceDir: marker.workspaceDir
    };
  }
  return null;
}

function formatHostSpec(ctx) {
  if (!ctx.host) return ctx.hostLabel;
  const user = ctx.host.user ? `${ctx.host.user}@` : '';
  const port = ctx.host.port && ctx.host.port !== 22 ? `:${ctx.host.port}` : '';
  return `${ctx.host.name} (${user}${ctx.host.host}${port})`;
}

function checkLocalPath(targetPath, mode, { ctx, artifactDir, hostDesc, remoteRoot, home, platform, sshTools }) {
  if (artifactDir && isPathInside(artifactDir, targetPath, platform)) return null;
  if (mode === 'read') {
    if (ctx.workspaceDir && isPathInside(ctx.workspaceDir, targetPath, platform)) return null;
    const cap = extractSkillOrPluginFromPath(targetPath, { home, platform });
    if (cap) {
      if (cap.kind === 'builtin-skill' || ctx.capabilityScope.mode !== 'selected') return null;
      if (cap.kind === 'skill' && cap.name && !ctx.capabilityScope.allowedSkills.includes(cap.name)) {
        return {
          decision: 'deny',
          reason: `当前 SSH 项目「${ctx.name}」的能力范围未启用 Skill「${cap.name}」，可在 SSH 项目设置中勾选启用。`
        };
      }
      if (cap.kind === 'plugin' && cap.pluginName && cap.pluginName !== 'agy-max') {
        const pluginAllowed = ctx.capabilityScope.allowedPlugins.includes(cap.pluginName);
        const skillAllowed = cap.skillName && ctx.capabilityScope.allowedSkills.includes(cap.skillName);
        if (!pluginAllowed && !skillAllowed) {
          return {
            decision: 'deny',
            reason: `当前 SSH 项目「${ctx.name}」的能力范围未启用插件「${cap.pluginName}」，可在 SSH 项目设置中勾选启用。`
          };
        }
      }
      return null;
    }
    return {
      decision: 'deny',
      reason: `当前为 SSH 项目「${ctx.name}」（${hostDesc}:${remoteRoot}），禁止直接读取本机磁盘文件（${targetPath}）。${sshTools ? `请改用 ssh_read_file / ssh_list_dir / ssh_search（projectId: "${ctx.projectId}"）；如需上传本机文件到服务器，请使用 ssh_transfer。` : MODULE_MISSING_HINT}`
    };
  }
  return {
    decision: 'deny',
    reason: `当前为 SSH 项目「${ctx.name}」（${hostDesc}:${remoteRoot}），禁止直接修改本机文件。${sshTools ? `请改用 ssh_write_file / ssh_edit_file（projectId: "${ctx.projectId}"）；如需回传文件到本机，请使用 ssh_transfer。` : MODULE_MISSING_HINT}`
  };
}

export function evaluateSshBoundaryHook(payload = {}, { home = homedir(), platform = process.platform, sshToolsAvailable } = {}) {
  const event = String(payload.hookEventName || '').trim();
  const passThrough = () => (event === 'PreToolUse' ? { decision: 'allow' } : {});
  const ctx = resolveProjectFromHookPayload(payload);
  if (!ctx) {
    // A marker file that is present but unreadable is still an SSH project: fail closed, never allow.
    const candidates = [payload.cwd, ...(Array.isArray(payload.workspacePaths) ? payload.workspacePaths : [])];
    if (candidates.some(candidate => sshProjectMarkerFileExists(candidate))) {
      return event === 'PreToolUse'
        ? { decision: 'deny', reason: '当前目录位于 SSH 项目内，但项目标记文件（.agy-ssh-project.json）无法解析，无法确认远端边界，已为安全起见拦截本次工具调用。请在 agy-max 中重新保存该 SSH 项目以修复标记文件。' }
        : {};
    }
    return passThrough();
  }

  const remoteRoot = ctx.remoteDir || '~';
  const hostDesc = formatHostSpec(ctx);
  const sshTools = typeof sshToolsAvailable === 'boolean' ? sshToolsAvailable : sshToolsInstalled(home);

  if (event === 'SessionStart') {
    const scopeLines = ctx.capabilityScope.mode === 'selected'
      ? [
          `- 本项目能力范围（仅允许使用以下本机扩展）：`,
          `  - 允许的 Skills: ${ctx.capabilityScope.allowedSkills.length ? ctx.capabilityScope.allowedSkills.join(', ') : '（无）'}`,
          `  - 允许的 Plugins/MCP: ${ctx.capabilityScope.allowedPlugins.length ? ctx.capabilityScope.allowedPlugins.join(', ') : '（无，仅保留 SSH 工具）'}`,
          `  - 严禁读取或调用上述清单之外的 Skill 或第三方插件工具。`
        ]
      : ['- 本项目能力范围：全部继承本机 Skills 与插件。'];

    const message = [
      `[Antigravity Max SSH Project Context]`,
      `当前会话属于 SSH 远程项目「${ctx.name}」（projectId: ${ctx.projectId}）。`,
      `- 目标 Linux 主机：${hostDesc}`,
      `- 远端工作目录：${remoteRoot}`,
      `- 远端执行边界（ADR-0002）：`,
      ...(sshTools
        ? [`  - 所有代码读取/编辑/写入/搜索与命令执行必须调用 agy-ssh-projects MCP 工具（ssh_read_file / ssh_edit_file / ssh_write_file / ssh_list_dir / ssh_search / ssh_run_command / ssh_job_status / ssh_job_kill），并传入 projectId: "${ctx.projectId}"。`]
        : [`  - ${MODULE_MISSING_HINT}`]),
      `  - 禁止对本机项目目录执行普通本地 run_command / read_file / edit_file / write_file（仅对话 artifact 目录与允许的本地 Skill 文档除外）。`,
      ...(sshTools
        ? [
            `  - 如需在本机与服务器之间上传或下载文件，请显式调用 ssh_transfer。`,
            `  - ssh_read_file 原生支持读取远端图片与 .ipynb Notebook，可直接查看服务器生成的图表。`
          ]
        : []),
      ...scopeLines
    ].join('\n');

    return {
      injectSteps: [
        { systemMessage: { systemMessage: message } }
      ]
    };
  }

  if (event === 'PreToolUse') {
    const toolName = String(payload.toolCall?.name || '').trim();
    const args = payload.toolCall?.args && typeof payload.toolCall.args === 'object' ? payload.toolCall.args : {};
    const artifactDir = String(payload.artifactDirectoryPath || '').trim();

    if (!toolName) return passThrough();

    // Always allow our own SSH project MCP tools (remote permissions follow native conversation policy)
    if (toolName.startsWith(`mcp_${SSH_MCP_ID}_`) || toolName.startsWith('ssh_')) return passThrough();
    const mcpServer = extractMcpServer(toolName, args);
    if (mcpServer === SSH_MCP_ID) return passThrough();

    // Block local shell execution inside SSH projects
    if (LOCAL_EXEC_TOOLS.has(toolName)) {
      return {
        decision: 'deny',
        reason: `当前为 SSH 项目「${ctx.name}」（${hostDesc}:${remoteRoot}），禁止直接运行本机命令。${sshTools ? `请改用 ssh_run_command（projectId: "${ctx.projectId}"）；如需本机与服务器互传文件，请使用 ssh_transfer。` : MODULE_MISSING_HINT}`
      };
    }

    // Local agy-fast operates on local disk, so redirect inside SSH projects
    if (mcpServer === 'agy-fast') {
      return {
        decision: 'deny',
        reason: `当前为 SSH 项目「${ctx.name}」，agy-fast 仅作用于本机磁盘。${sshTools ? `请改用 ssh_search / ssh_read_file / ssh_edit_file / ssh_run_command（projectId: "${ctx.projectId}"）。` : MODULE_MISSING_HINT}`
      };
    }

    // Enforce project capability scope on third-party MCP plugins (their args are not local paths)
    if (mcpServer) {
      if (ctx.capabilityScope.mode === 'selected') {
        const allowed = ctx.capabilityScope.allowedPlugins.some(item => item === mcpServer || mcpServer.startsWith(`${item}_`) || mcpServer.startsWith(`${item}-`));
        if (!allowed) {
          return {
            decision: 'deny',
            reason: `当前 SSH 项目「${ctx.name}」的能力范围未启用插件/MCP「${mcpServer}」，可在 SSH 项目设置中勾选启用。`
          };
        }
      }
      return passThrough();
    }

    const isWrite = LOCAL_WRITE_TOOLS.has(toolName);
    const isKnown = isWrite || LOCAL_READ_TOOLS.has(toolName) || SAFE_TOOLS.has(toolName)
      || SAFE_PREFIXES.some(prefix => toolName.startsWith(prefix));
    // Unknown tools may name a location in any argument (dest, target, nested options):
    // every absolute path among them is checked, not only the path-named ones.
    const rawPaths = collectPathArgs(args);
    if (!isKnown) rawPaths.push(...collectPathLikeValues(args));
    const paths = [...new Set(rawPaths)].map(p => toLocalPath(p, ctx.workspaceDir, home));
    const pathCtx = { ctx, artifactDir, hostDesc, remoteRoot, home, platform, sshTools };

    // Writes must name a target we can verify; otherwise deny
    if (isWrite && paths.length === 0) return checkLocalPath('', 'write', pathCtx);

    // Path-check every tool that touches local paths, regardless of its name
    for (const targetPath of paths) {
      const verdict = checkLocalPath(targetPath, isWrite ? 'write' : 'read', pathCtx);
      if (verdict) return verdict;
    }

    if (isKnown) return passThrough();
    // Unknown tool: allowed only because every path it names is inside an allowed location.
    if (paths.length > 0) return passThrough();

    // Unclassified tool with no verifiable path: ask instead of silently allowing
    return {
      decision: 'ask',
      reason: `当前为 SSH 项目「${ctx.name}」，工具「${toolName}」不在 agy-max 远端边界白名单内，需要你确认后才能在本机执行。`
    };
  }

  return passThrough();
}
