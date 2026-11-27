import { homedir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSshProjectsStore } from '../lib/ssh-projects.mjs';
import { createSshRunner } from '../lib/ssh-runner.mjs';
import { isSshModuleInstalled } from '../packages/core/module-registry.mjs';

const isInstalledPluginRuntime = (() => {
  try {
    return resolve(fileURLToPath(import.meta.url)).startsWith(join(resolve(homedir()), '.gemini', 'config', 'plugins'));
  } catch {
    return false;
  }
})();

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'agy-ssh-projects', version: '1.4.2' };

const store = createSshProjectsStore();
const runner = createSshRunner({ store });

const TOOLS = [
  {
    name: 'ssh_project_info',
    description: 'Inspect the active SSH Project, target Linux host, working directory, connection status, and running background jobs.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Optional SSH Project ID. Omit to auto-detect from current workspace.' },
        workspacePath: { type: 'string', description: 'Optional local proxy workspace path.' }
      }
    }
  },
  {
    name: 'ssh_run_command',
    description: 'Execute a shell command on the remote Linux SSH Project server. Long-running commands (e.g. GPU training) automatically stay alive as detached background jobs so you can monitor or check back later.',
    inputSchema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string', description: 'Shell command to execute on the Linux server.' },
        cwd: { type: 'string', description: 'Optional remote working directory (defaults to the SSH Project remoteDir or server $HOME).' },
        waitMs: { type: 'integer', description: 'Milliseconds to wait before returning a detached background job handle (default 15000).' },
        background: { type: 'boolean', description: 'Set true to immediately launch in the background without waiting.' },
        projectId: { type: 'string' },
        workspacePath: { type: 'string' }
      }
    }
  },
  {
    name: 'ssh_job_status',
    description: 'Check status and recent output logs of a background remote job (or list all jobs on the host when jobId is omitted).',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Remote job ID returned by ssh_run_command. Omit to list all jobs.' },
        tailLines: { type: 'integer', description: 'Number of tail log lines to fetch (default 80).' },
        projectId: { type: 'string' },
        workspacePath: { type: 'string' }
      }
    }
  },
  {
    name: 'ssh_job_kill',
    description: 'Stop a running background remote job by jobId.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: {
        jobId: { type: 'string' },
        projectId: { type: 'string' },
        workspacePath: { type: 'string' }
      }
    }
  },
  {
    name: 'ssh_read_file',
    description: 'Read a remote file on the SSH server: supports code/text (with optional line ranges), images (returned as multimodal image content so you can view plots/charts directly), and Jupyter notebooks.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Absolute remote path, ~/path, or path relative to the SSH Project remoteDir.' },
        startLine: { type: 'integer' },
        endLine: { type: 'integer' },
        rawNotebook: { type: 'boolean', description: 'Set true to read raw .ipynb JSON text instead of parsed cells.' },
        projectId: { type: 'string' },
        workspacePath: { type: 'string' }
      }
    }
  },
  {
    name: 'ssh_write_file',
    description: 'Create, overwrite, or append to a file on the remote Linux server.',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean' },
        overwrite: { type: 'boolean' },
        projectId: { type: 'string' },
        workspacePath: { type: 'string' }
      }
    }
  },
  {
    name: 'ssh_edit_file',
    description: 'Perform an exact string replacement inside a file on the remote Linux server.',
    inputSchema: {
      type: 'object',
      required: ['path', 'target', 'replacement'],
      properties: {
        path: { type: 'string' },
        target: { type: 'string' },
        replacement: { type: 'string' },
        replaceAll: { type: 'boolean' },
        projectId: { type: 'string' },
        workspacePath: { type: 'string' }
      }
    }
  },
  {
    name: 'ssh_list_dir',
    description: 'List files and subdirectories inside a remote directory on the SSH server.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Remote directory path (defaults to the SSH Project remoteDir).' },
        projectId: { type: 'string' },
        workspacePath: { type: 'string' }
      }
    }
  },
  {
    name: 'ssh_search',
    description: 'Search files or content on the remote Linux server (text, regex, glob, or filename filter).',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        mode: { type: 'string', enum: ['text', 'regex', 'glob', 'files'] },
        path: { type: 'string', description: 'Remote root directory to search (defaults to SSH Project remoteDir).' },
        glob: { type: 'string', description: 'Optional file glob filter for text/regex search (e.g. *.py).' },
        maxResults: { type: 'integer' },
        projectId: { type: 'string' },
        workspacePath: { type: 'string' }
      }
    }
  },
  {
    name: 'ssh_transfer',
    description: 'Explicit cross-machine transfer between the local computer and the remote SSH server (upload local -> remote, or download remote -> local).',
    inputSchema: {
      type: 'object',
      required: ['direction', 'localPath', 'remotePath'],
      properties: {
        direction: { type: 'string', enum: ['upload', 'download'] },
        localPath: { type: 'string', description: 'Absolute path on the local computer.' },
        remotePath: { type: 'string', description: 'Path on the remote SSH server (absolute, ~/..., or relative to project remoteDir).' },
        projectId: { type: 'string' },
        workspacePath: { type: 'string' }
      }
    }
  }
];

function resolveProjectContext(args = {}) {
  if (args.projectId) {
    const byId = store.getProject(args.projectId) || store.findProjectByNativeId(args.projectId);
    if (byId) return byId;
    throw new Error(`找不到 SSH 项目: ${args.projectId}`);
  }
  const candidates = [args.workspacePath, process.env.AGY_WORKSPACE_PATH, process.cwd()].filter(Boolean);
  for (const dir of candidates) {
    const found = store.findProjectByWorkspace(dir);
    if (found) return found;
  }
  const all = store.listProjects();
  if (all.length === 1) return all[0];
  throw new Error('未能自动识别当前 SSH 项目，请在参数中传入 projectId（可先调用 ssh_project_info 查看列表）');
}

function resolveRemoteTargetPath(project, rawPath = '') {
  const clean = String(rawPath || '').trim();
  const base = project.remoteDir || '';
  if (!clean) return base || '~';
  if (clean.startsWith('/') || clean.startsWith('~/') || clean === '~' || clean.startsWith('agy-ssh://')) return clean;
  if (!base || base === '~') return `~/${clean}`;
  return posix.join(base, clean);
}

async function callTool(name, args = {}) {
  if (name === 'ssh_project_info') {
    let project = null;
    try { project = resolveProjectContext(args); } catch {}
    if (!project) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ projects: store.listProjects().map(p => ({ id: p.id, name: p.name, host: p.host?.name || p.hostId, remoteDir: p.remoteDir || '~' })) }, null, 2)
        }]
      };
    }
    const jobs = await runner.listJobs(project.hostId).catch(() => ({ ok: false, jobs: [] }));
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          project: { id: project.id, name: project.name, remoteDir: project.remoteDir || '~', capabilityScope: project.capabilityScope },
          host: project.host ? { id: project.host.id, name: project.host.name, host: project.host.host, user: project.host.user, port: project.host.port } : null,
          status: runner.getStatus(project.hostId),
          jobs: jobs.jobs || []
        }, null, 2)
      }]
    };
  }

  const project = resolveProjectContext(args);
  if (!project.host) throw new Error(`SSH 项目「${project.name}」绑定的主机不存在`);

  if (name === 'ssh_run_command') {
    const cwd = resolveRemoteTargetPath(project, args.cwd || '');
    const res = await runner.runCommand(project.hostId, {
      command: args.command,
      cwd,
      waitMs: args.waitMs,
      background: Boolean(args.background)
    });
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }

  if (name === 'ssh_job_status') {
    const res = args.jobId
      ? await runner.jobStatus(project.hostId, args.jobId, { tailLines: args.tailLines })
      : await runner.listJobs(project.hostId);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }

  if (name === 'ssh_job_kill') {
    const res = await runner.killJob(project.hostId, args.jobId);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }

  if (name === 'ssh_read_file') {
    const targetPath = resolveRemoteTargetPath(project, args.path);
    const res = await runner.readFile(project.hostId, targetPath, {
      startLine: args.startLine ?? null,
      endLine: args.endLine ?? null,
      rawNotebook: Boolean(args.rawNotebook)
    });
    if (res.kind === 'image' && res.dataBase64) {
      return {
        content: [
          { type: 'text', text: `Remote image ${res.path} (${res.size} bytes, ${res.mimeType})` },
          { type: 'image', data: res.dataBase64, mimeType: res.mimeType }
        ]
      };
    }
    if (res.kind === 'notebook' && Array.isArray(res.cells)) {
      const rendered = res.cells.map(c => `### Cell ${c.index} (${c.type})\n${c.source}${c.output ? `\n--- Output ---\n${c.output}` : ''}`).join('\n\n');
      return { content: [{ type: 'text', text: `Notebook ${res.path} (${res.totalCells} cells)\n\n${rendered}` }] };
    }
    if (res.kind === 'binary') {
      return { content: [{ type: 'text', text: JSON.stringify({ path: res.path, kind: 'binary', size: res.size, tooLarge: Boolean(res.tooLarge) }) }] };
    }
    const header = `File: ${res.path} (lines ${res.startLine}-${res.endLine} of ${res.totalLines}${res.truncated ? ', truncated' : ''})`;
    return { content: [{ type: 'text', text: `${header}\n${res.content}` }] };
  }

  if (name === 'ssh_write_file') {
    const targetPath = resolveRemoteTargetPath(project, args.path);
    const res = await runner.writeFile(project.hostId, targetPath, args.content, {
      append: Boolean(args.append),
      overwrite: args.overwrite !== false
    });
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }

  if (name === 'ssh_edit_file') {
    const targetPath = resolveRemoteTargetPath(project, args.path);
    const res = await runner.editFile(project.hostId, targetPath, args.target, args.replacement, {
      replaceAll: Boolean(args.replaceAll)
    });
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }

  if (name === 'ssh_list_dir') {
    const targetDir = resolveRemoteTargetPath(project, args.path || '');
    const res = await runner.listDir(project.hostId, targetDir, '');
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }

  if (name === 'ssh_search') {
    const targetDir = resolveRemoteTargetPath(project, args.path || '');
    const res = await runner.searchFiles(project.hostId, targetDir, {
      query: args.query,
      mode: args.mode || 'text',
      glob: args.glob || '',
      maxResults: args.maxResults
    });
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }

  if (name === 'ssh_transfer') {
    const remotePath = resolveRemoteTargetPath(project, args.remotePath);
    const res = await runner.transfer(project.hostId, {
      direction: args.direction,
      localPath: args.localPath,
      remotePath
    });
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
  }

  throw new Error(`未知工具: ${name}`);
}

function sendMessage(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handleRequest(req) {
  const { id, method, params } = req || {};
  if (!method) return;
  try {
    if (method === 'initialize') {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO
        }
      });
      return;
    }
    if (method === 'notifications/initialized') return;
    if (method === 'ping') {
      if (id !== undefined) sendMessage({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    if (method === 'tools/list') {
      const active = !isInstalledPluginRuntime || isSshModuleInstalled();
      sendMessage({ jsonrpc: '2.0', id, result: { tools: active ? TOOLS : [] } });
      return;
    }
    if (method === 'tools/call') {
      if (isInstalledPluginRuntime && !isSshModuleInstalled()) {
        throw new Error('SSH 远端工程模块 (ssh-remote) 当前未安装，请在右侧栏「插件 -> Antigravity Max -> 模块」中一键安装后再使用。');
      }
      const result = await callTool(params?.name, params?.arguments || {});
      sendMessage({ jsonrpc: '2.0', id, result });
      return;
    }
    if (id !== undefined) {
      sendMessage({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (error) {
    if (id !== undefined) {
      if (method === 'tools/call') {
        sendMessage({
          jsonrpc: '2.0',
          id,
          result: { isError: true, content: [{ type: 'text', text: error?.message || String(error) }] }
        });
      } else {
        sendMessage({ jsonrpc: '2.0', id, error: { code: -32000, message: error?.message || String(error) } });
      }
    }
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  for (;;) {
    const nl = buffer.indexOf('\n');
    if (nl < 0) break;
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      void handleRequest(parsed);
    } catch { /* Ignore malformed line. */ }
  }
});
process.stdin.on('end', () => { runner.closeAll(); process.exit(0); });
process.on('SIGINT', () => { runner.closeAll(); process.exit(0); });
process.on('SIGTERM', () => { runner.closeAll(); process.exit(0); });
