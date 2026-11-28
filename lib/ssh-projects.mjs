import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { pluginDataDir } from './paths.mjs';
import { deriveHostAlias, parseOpenSshCommand } from './ssh-config.mjs';
import { createSshCredentialVault } from './ssh-vault.mjs';

export const SSH_PROJECT_MARKER = '.agy-ssh-project.json';
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const SAFE_HOST_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$|^\[[0-9A-Fa-f:.]+(?:%[A-Za-z0-9._-]+)?\]$/;
const SAFE_USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:@[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;

function readJsonSafe(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(tmp, filePath);
  } catch (error) {
    try { unlinkSync(tmp); } catch {}
    throw error;
  }
}

export function normalizeRemoteDir(raw = '') {
  const value = String(raw || '').trim();
  if (!value || value === '~' || value === '~/') return '';
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('远端目录包含非法字符');
  if (value.startsWith('~/')) return value.replace(/\/+$/, '');
  if (!value.startsWith('/')) throw new Error('远端目录须为绝对路径或以 ~/ 开头');
  return value.length > 1 ? value.replace(/\/+$/, '') : '/';
}

export function normalizeCapabilityScope(scope = {}) {
  const mode = scope?.mode === 'selected' ? 'selected' : 'all';
  const cleanList = list => [...new Set((Array.isArray(list) ? list : [])
    .map(item => String(item || '').trim())
    .filter(item => item && item.length <= 128 && !/[\x00-\x1f\x7f]/.test(item)))];
  return {
    mode,
    allowedSkills: cleanList(scope?.allowedSkills),
    allowedPlugins: cleanList(scope?.allowedPlugins)
  };
}

/**
 * Parses standard OpenSSH config (`~/.ssh/config`) host blocks for quick-picking.
 */
export function parseSshConfigHosts(content = '') {
  const lines = String(content || '').split(/\r?\n/);
  const hosts = [];
  let current = null;
  const flush = () => {
    if (current && current.aliases.length) {
      for (const alias of current.aliases) {
        if (!alias || /[*?!]/.test(alias)) continue;
        hosts.push({
          alias,
          host: current.hostName || alias,
          user: current.user || '',
          port: current.port || 22,
          identityFile: current.identityFile || '',
          proxyJump: current.proxyJump || ''
        });
      }
    }
    current = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.+)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const val = match[2].trim().replace(/^"(.*)"$/, '$1');
    if (key === 'host') {
      flush();
      current = { aliases: val.split(/\s+/).filter(Boolean), hostName: '', user: '', port: 0, identityFile: '', proxyJump: '' };
      continue;
    }
    if (key === 'match') {
      flush();
      continue;
    }
    if (!current) continue;
    if (key === 'hostname' && !current.hostName) current.hostName = val;
    else if (key === 'user' && !current.user) current.user = val;
    else if (key === 'port' && !current.port) {
      const p = Number(val);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) current.port = p;
    } else if (key === 'identityfile' && !current.identityFile) current.identityFile = val;
    else if (key === 'proxyjump' && !current.proxyJump) current.proxyJump = val;
  }
  flush();
  const seen = new Set();
  return hosts.filter(item => {
    if (seen.has(item.alias)) return false;
    seen.add(item.alias);
    return true;
  });
}

export function listSshConfigHosts({ home = homedir() } = {}) {
  const configPath = join(home, '.ssh', 'config');
  try {
    const st = lstatSync(configPath, { throwIfNoEntry: false });
    if (!st || !st.isFile()) return [];
    return parseSshConfigHosts(readFileSync(configPath, 'utf8'));
  } catch {
    return [];
  }
}

export function discoverLocalCapabilities({ home = homedir() } = {}) {
  const cfgRoot = join(home, '.gemini', 'config');
  const skills = [];
  const plugins = [];

  const skillsDir = join(cfgRoot, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const skillFile = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      let description = '';
      try {
        const text = readFileSync(skillFile, 'utf8').slice(0, 1024);
        const m = text.match(/description:\s*>?-?\s*\n?\s*([^\n]+)/);
        if (m) description = m[1].trim().replace(/^["']|["']$/g, '').slice(0, 120);
      } catch {}
      skills.push({ id: entry.name, name: entry.name, description, path: skillFile });
    }
  }

  const pluginsDir = join(cfgRoot, 'plugins');
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name === 'agy-max') continue;
      const manifestPath = join(pluginsDir, entry.name, 'plugin.json');
      let displayName = entry.name;
      let description = '';
      try {
        if (existsSync(manifestPath)) {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
          displayName = String(manifest.displayName || manifest.name || entry.name);
          description = String(manifest.description || '').slice(0, 120);
        }
      } catch {}
      plugins.push({ id: entry.name, name: displayName, description, kind: 'plugin' });
    }
  }

  const mcpConfigPath = join(cfgRoot, 'mcp_config.json');
  if (existsSync(mcpConfigPath)) {
    try {
      const cfg = JSON.parse(readFileSync(mcpConfigPath, 'utf8'));
      const servers = cfg?.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
      for (const serverName of Object.keys(servers).sort()) {
        if (serverName === 'agy-ssh-projects' || plugins.some(p => p.id === serverName)) continue;
        plugins.push({ id: serverName, name: serverName, description: 'MCP Server', kind: 'mcp' });
      }
    } catch {}
  }

  return { skills, plugins };
}

export function normalizeWorkspacePath(dirOrUri) {
  const raw = String(dirOrUri || '').trim();
  if (!raw) return '';
  if (/^file:\/\//i.test(raw)) {
    try {
      return resolve(fileURLToPath(raw));
    } catch {
      return '';
    }
  }
  return resolve(raw);
}

/**
 * Fast O(1) lookup used by hooks and MCP server to identify whether a local directory
 * or file URI belongs to an agy-max SSH Project proxy workspace.
 */
export function readSshProjectMarker(dirOrUri) {
  const dir = normalizeWorkspacePath(dirOrUri);
  if (!dir) return null;
  let cur = dir;
  for (let depth = 0; depth < 6 && cur; depth++) {
    const markerPath = join(cur, SSH_PROJECT_MARKER);
    if (existsSync(markerPath)) {
      const data = readJsonSafe(markerPath, null);
      if (data && data.format === 1 && typeof data.projectId === 'string') {
        return { ...data, workspaceDir: cur, markerPath };
      }
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

// readSshProjectMarker skips unreadable markers, so a null result must check this to fail closed.
export function sshProjectMarkerFileExists(dirOrUri) {
  let cur = normalizeWorkspacePath(dirOrUri);
  for (let depth = 0; depth < 6 && cur; depth++) {
    if (existsSync(join(cur, SSH_PROJECT_MARKER))) return true;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

export function createSshProjectsStore({
  dataDir = join(pluginDataDir(), 'ssh-projects'),
  home = homedir(),
  vault = createSshCredentialVault()
} = {}) {
  const hostsFile = join(dataDir, 'hosts.json');
  const projectsFile = join(dataDir, 'projects.json');
  const workspacesRoot = join(dataDir, 'workspaces');

  function loadHostsMap() {
    const parsed = readJsonSafe(hostsFile, { format: 1, hosts: {} });
    return parsed?.hosts && typeof parsed.hosts === 'object' ? parsed.hosts : {};
  }

  function saveHostsMap(hosts) {
    writeJsonAtomic(hostsFile, { format: 1, hosts });
  }

  function loadProjectsMap() {
    const parsed = readJsonSafe(projectsFile, { format: 1, projects: {} });
    return parsed?.projects && typeof parsed.projects === 'object' ? parsed.projects : {};
  }

  function saveProjectsMap(projects) {
    writeJsonAtomic(projectsFile, { format: 1, projects });
  }

  function writeProjectMarker(project, host) {
    if (!project?.proxyWorkspaceDir) return;
    mkdirSync(project.proxyWorkspaceDir, { recursive: true });
    writeJsonAtomic(join(project.proxyWorkspaceDir, SSH_PROJECT_MARKER), {
      format: 1,
      projectId: project.id,
      nativeProjectId: project.nativeProjectId || '',
      name: project.name,
      hostId: project.hostId,
      hostLabel: host?.name || host?.configAlias || host?.host || project.hostId,
      remoteDir: project.remoteDir || '',
      capabilityScope: normalizeCapabilityScope(project.capabilityScope),
      dataDir,
      updatedAtMs: Date.now()
    });
  }

  function syncMarkersForHost(hostId) {
    const hosts = loadHostsMap();
    const host = hosts[hostId];
    if (!host) return;
    const projects = loadProjectsMap();
    for (const proj of Object.values(projects)) {
      if (proj.hostId === hostId) writeProjectMarker(proj, host);
    }
  }

  function listHosts() {
    const hosts = loadHostsMap();
    return Object.values(hosts)
      .map(h => ({
        ...h,
        hasPassword: h.authType === 'password' ? Boolean(h.hasPassword || vault.hasPassword(h.id)) : false
      }))
      .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0) || a.name.localeCompare(b.name));
  }

  function getHost(hostId) {
    const hosts = loadHostsMap();
    const h = hosts[String(hostId || '').trim()];
    if (!h) return null;
    return {
      ...h,
      hasPassword: h.authType === 'password' ? Boolean(h.hasPassword || vault.hasPassword(h.id)) : false
    };
  }

  function upsertHost(input = {}) {
    const hosts = loadHostsMap();
    let parsed = null;
    if (typeof input.rawCommand === 'string' && input.rawCommand.trim()) {
      parsed = parseOpenSshCommand(input.rawCommand);
      if (!parsed || !parsed.valid) throw new Error('无法解析 SSH 命令，请检查格式（如 ssh -p 22 root@host）');
    }

    const existingId = String(input.id || '').trim();
    const existing = existingId && hosts[existingId] ? hosts[existingId] : null;
    const configAlias = String(input.configAlias ?? existing?.configAlias ?? '').trim();
    const hostName = String(input.host ?? parsed?.host ?? existing?.host ?? configAlias).trim();
    const user = String(input.user ?? parsed?.user ?? existing?.user ?? '').trim();
    const rawPort = input.port ?? parsed?.port ?? existing?.port ?? 22;
    const port = Number(rawPort || 22);
    const identityFile = String(input.identityFile ?? parsed?.identityFile ?? existing?.identityFile ?? '').trim();
    const proxyJump = String(input.proxyJump ?? parsed?.proxyJump ?? existing?.proxyJump ?? '').trim();
    const authType = ['key', 'password', 'config'].includes(input.authType)
      ? input.authType
      : (input.password ? 'password' : existing?.authType || (configAlias && !input.host ? 'config' : 'key'));

    if (!configAlias && (!hostName || !SAFE_HOST_RE.test(hostName))) throw new Error('无效的 SSH 主机地址');
    if (user && !SAFE_USER_RE.test(user)) throw new Error('无效的 SSH 用户名');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口必须在 1 到 65535 之间');

    const id = existing
      ? existing.id
      : (existingId && SAFE_ID_RE.test(existingId) ? existingId : `host-${randomUUID().slice(0, 8)}`);
    const name = String(input.name || '').trim() || existing?.name || configAlias || deriveHostAlias(hostName, port, user);

    let hasPassword = Boolean(existing?.hasPassword);
    if (typeof input.password === 'string' && input.password.length > 0 && input.savePassword !== false) {
      const saved = vault.savePassword(id, input.password, { user: user || 'ssh' });
      if (!saved.ok) throw new Error(saved.error || '保存 SSH 密码到系统钥匙串失败');
      hasPassword = true;
    } else if (input.clearPassword || authType === 'key') {
      if (input.clearPassword) {
        // Keep the flag (and the secret's only pointer) unless the keychain item is really gone.
        const removed = vault.removePassword(id);
        if (!removed?.ok) throw new Error(removed?.error || '从系统钥匙串删除 SSH 密码失败');
        hasPassword = false;
      }
    }

    const now = Date.now();
    const record = {
      id,
      name,
      configAlias,
      host: hostName,
      user,
      port,
      authType,
      identityFile,
      proxyJump,
      hasPassword,
      createdAtMs: existing?.createdAtMs || now,
      updatedAtMs: now
    };
    hosts[id] = record;
    saveHostsMap(hosts);
    syncMarkersForHost(id);
    return record;
  }

  function deleteHost(hostId, { force = false } = {}) {
    const id = String(hostId || '').trim();
    const hosts = loadHostsMap();
    if (!hosts[id]) return { ok: true, deleted: false };
    const projects = loadProjectsMap();
    const bound = Object.values(projects).filter(p => p.hostId === id);
    if (bound.length && !force) {
      throw new Error(`仍有 ${bound.length} 个 SSH 项目绑定到此主机，请先换绑或移除项目`);
    }
    // Drop the record only once its saved password is gone, or the secret is orphaned for good.
    const removed = vault.removePassword(id);
    if (!removed?.ok && (hosts[id].hasPassword || hosts[id].authType === 'password')) {
      throw new Error(removed?.error || '从系统钥匙串删除 SSH 密码失败，已保留该主机');
    }
    delete hosts[id];
    saveHostsMap(hosts);
    return { ok: true, deleted: true, id };
  }

  function listProjects() {
    const projects = loadProjectsMap();
    const hosts = loadHostsMap();
    return Object.values(projects)
      .map(p => ({
        ...p,
        workspaceUri: p.proxyWorkspaceDir ? pathToFileURL(p.proxyWorkspaceDir).href : '',
        host: hosts[p.hostId] || null
      }))
      .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0) || a.name.localeCompare(b.name));
  }

  function getProject(projectId) {
    const id = String(projectId || '').trim();
    const projects = loadProjectsMap();
    const p = projects[id];
    if (!p) return null;
    const hosts = loadHostsMap();
    return {
      ...p,
      workspaceUri: p.proxyWorkspaceDir ? pathToFileURL(p.proxyWorkspaceDir).href : '',
      host: hosts[p.hostId] || null
    };
  }

  function findProjectByNativeId(nativeProjectId) {
    const nid = String(nativeProjectId || '').trim();
    if (!nid) return null;
    const projects = loadProjectsMap();
    const found = Object.values(projects).find(p => p.nativeProjectId === nid || p.id === nid);
    return found ? getProject(found.id) : null;
  }

  function findProjectByWorkspace(dirOrUri) {
    const marker = readSshProjectMarker(dirOrUri);
    if (marker?.projectId) {
      const live = getProject(marker.projectId);
      if (live) return live;
    }
    const targetDir = normalizeWorkspacePath(dirOrUri);
    if (!targetDir) return null;
    const projects = loadProjectsMap();
    const norm = p => (process.platform === 'win32' ? p.toLowerCase() : p);
    const targetNorm = norm(targetDir);
    for (const proj of Object.values(projects)) {
      if (!proj.proxyWorkspaceDir) continue;
      const rootNorm = norm(resolve(proj.proxyWorkspaceDir));
      if (targetNorm === rootNorm || targetNorm.startsWith(`${rootNorm}/`) || targetNorm.startsWith(`${rootNorm}\\`)) {
        return getProject(proj.id);
      }
    }
    return null;
  }

  function createProject({ name = '', hostId, remoteDir = '', nativeProjectId = '', capabilityScope } = {}) {
    const hosts = loadHostsMap();
    const host = hosts[String(hostId || '').trim()];
    if (!host) throw new Error('指定的 SSH 主机不存在');
    const cleanDir = normalizeRemoteDir(remoteDir);
    const id = randomUUID();
    const dirBase = cleanDir ? cleanDir.split('/').filter(Boolean).pop() : '';
    const displayName = String(name || '').trim() || (dirBase ? `${host.name} · ${dirBase}` : host.name);
    const proxyWorkspaceDir = join(workspacesRoot, id);
    const now = Date.now();
    const project = {
      id,
      nativeProjectId: String(nativeProjectId || id).trim(),
      name: displayName,
      hostId: host.id,
      remoteDir: cleanDir,
      proxyWorkspaceDir,
      capabilityScope: normalizeCapabilityScope(capabilityScope),
      createdAtMs: now,
      updatedAtMs: now
    };
    mkdirSync(proxyWorkspaceDir, { recursive: true });
    writeProjectMarker(project, host);
    const projects = loadProjectsMap();
    projects[id] = project;
    saveProjectsMap(projects);
    return getProject(id);
  }

  function updateProject(projectId, patch = {}) {
    const id = String(projectId || '').trim();
    const projects = loadProjectsMap();
    const prev = projects[id];
    if (!prev) throw new Error('SSH 项目不存在');
    const hosts = loadHostsMap();
    const nextHostId = patch.hostId !== undefined ? String(patch.hostId || '').trim() : prev.hostId;
    if (!hosts[nextHostId]) throw new Error('目标 SSH 主机不存在');
    const nextRemoteDir = patch.remoteDir !== undefined ? normalizeRemoteDir(patch.remoteDir) : prev.remoteDir;
    const nextName = patch.name !== undefined && String(patch.name).trim() ? String(patch.name).trim() : prev.name;
    const nextNativeId = patch.nativeProjectId !== undefined && String(patch.nativeProjectId).trim()
      ? String(patch.nativeProjectId).trim()
      : prev.nativeProjectId;
    const nextScope = patch.capabilityScope !== undefined
      ? normalizeCapabilityScope(patch.capabilityScope)
      : normalizeCapabilityScope(prev.capabilityScope);

    const updated = {
      ...prev,
      name: nextName,
      hostId: nextHostId,
      remoteDir: nextRemoteDir,
      nativeProjectId: nextNativeId,
      capabilityScope: nextScope,
      updatedAtMs: Date.now()
    };
    projects[id] = updated;
    saveProjectsMap(projects);
    writeProjectMarker(updated, hosts[nextHostId]);
    return getProject(id);
  }

  function rebindProjectHost(projectId, newHostId, { remoteDir } = {}) {
    return updateProject(projectId, {
      hostId: newHostId,
      ...(remoteDir !== undefined ? { remoteDir } : {})
    });
  }

  /**
   * Deletes ONLY the local project binding and local proxy marker folder.
   * NEVER touches any files on the remote server and ALWAYS preserves the SSH Host.
   */
  function deleteProject(projectId) {
    const id = String(projectId || '').trim();
    const projects = loadProjectsMap();
    const prev = projects[id];
    if (!prev) return { ok: true, deleted: false };
    delete projects[id];
    saveProjectsMap(projects);
    if (prev.proxyWorkspaceDir && prev.proxyWorkspaceDir.startsWith(workspacesRoot)) {
      try { rmSync(prev.proxyWorkspaceDir, { recursive: true, force: true }); } catch {}
    }
    return { ok: true, deleted: true, id, hostPreserved: true };
  }

  return {
    dataDir,
    workspacesRoot,
    vault,
    listHosts,
    getHost,
    upsertHost,
    deleteHost,
    listProjects,
    getProject,
    findProjectByNativeId,
    findProjectByWorkspace,
    createProject,
    updateProject,
    rebindProjectHost,
    deleteProject,
    listConfigHosts: () => listSshConfigHosts({ home }),
    discoverCapabilities: () => discoverLocalCapabilities({ home })
  };
}
