// SSH boundary hook entry point.
// Fail-closed (upstream research 2026-11-27, item 1): if the boundary logic cannot be
// loaded or throws, a dependency-free marker probe decides. Inside an SSH project the tool
// call is denied; ordinary local workspaces keep working. Mirrors the official SDK
// policy.py "failing closed" behaviour.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '.agy-ssh-project.json';

function toDir(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('file://')) {
    try { return resolve(fileURLToPath(value)); } catch { return ''; }
  }
  return resolve(value);
}

export function probeSshMarker(payload = {}) {
  const candidates = [payload.cwd, ...(Array.isArray(payload.workspacePaths) ? payload.workspacePaths : [])];
  for (const candidate of candidates) {
    let cur = toDir(candidate);
    for (let depth = 0; depth < 6 && cur; depth++) {
      const markerPath = join(cur, MARKER);
      if (existsSync(markerPath)) {
        try {
          const data = JSON.parse(readFileSync(markerPath, 'utf8'));
          if (data && data.format === 1 && typeof data.projectId === 'string') return data;
        } catch {
          // An unreadable marker still means "this is an SSH project"
          return { projectId: '' };
        }
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return null;
}

export function failClosedResult(event, payload, error) {
  if (event !== 'PreToolUse') return {};
  let marker = null;
  try { marker = probeSshMarker(payload); } catch { marker = { projectId: '' }; }
  if (!marker) return { decision: 'allow' };
  const detail = error?.message || String(error || 'unknown error');
  return {
    decision: 'deny',
    reason: `agy-max SSH 边界钩子出错（${detail}），为安全起见已拦截本次工具调用。请改用 ssh_* 工具${marker.projectId ? `（projectId: "${marker.projectId}"）` : ''}，或重新安装 agy-max 后再试。`
  };
}

export async function runHook(raw, cliEvent) {
  let payload = {};
  try {
    payload = JSON.parse(raw || '{}');
  } catch (error) {
    // Unparseable payload: cwd is unknown and `ask` becomes allow under auto-approve, so fail closed.
    return cliEvent === 'PreToolUse'
      ? { decision: 'deny', reason: `agy-max SSH 边界钩子无法解析输入（${error?.message || error}），无法确认是否位于 SSH 项目内，已为安全起见拦截本次工具调用。请重试；如持续出现，请重新安装 agy-max。` }
      : {};
  }
  if (!payload || typeof payload !== 'object') payload = {};
  if (!payload.hookEventName && cliEvent) payload.hookEventName = cliEvent;
  const event = String(payload.hookEventName || cliEvent || '');
  // No cwd (e.g. empty stdin): judge by the process cwd and fail closed inside an SSH project.
  if (!payload.cwd && !(Array.isArray(payload.workspacePaths) && payload.workspacePaths.length)) {
    const fallback = { ...payload, cwd: process.cwd() };
    if (probeSshMarker(fallback)) return failClosedResult(event, fallback, new Error('hook 输入缺少 cwd'));
  }
  try {
    const { evaluateSshBoundaryHook } = await import('../lib/ssh-boundary.mjs');
    let result = evaluateSshBoundaryHook(payload);
    if (!result || typeof result !== 'object') result = event === 'PreToolUse' ? null : {};
    if (event === 'PreToolUse' && !result?.decision) {
      throw new Error('boundary evaluator returned no decision');
    }
    return result;
  } catch (error) {
    process.stderr.write(`SSH boundary hook: ${error?.message || error}\n`);
    return failClosedResult(event, payload, error);
  }
}

function sameFile(a, b) {
  if (!a || !b) return false;
  try { return realpathSync(a) === realpathSync(b); } catch { return resolve(a) === resolve(b); }
}

// Installed copies may be reached through symlinks; the ESM loader reports the realpath.
const isMain = sameFile(process.argv[1], fileURLToPath(import.meta.url));
if (isMain) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', async () => {
    const result = await runHook(raw, process.argv[2] || '');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  });
}
