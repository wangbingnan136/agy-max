import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, posix } from 'node:path';
import { ensureLocalPublicKey, withSshAskpass } from './ssh-vault.mjs';

const MAX_DIR_ENTRIES = 400;
const MAX_TEXT_PREVIEW_BYTES = 196608;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_NOTEBOOK_BYTES = 5 * 1024 * 1024;
const MAX_NOTEBOOK_CELLS = 60;
const JOB_ID_RE = /^[a-zA-Z0-9_-]{4,48}$/;
// The connection dropped during the SSH handshake (busy gateway, flaky network): the remote command never started.
const HANDSHAKE_DROP_RE = /kex_exchange_identification|ssh_exchange_identification|banner exchange/i;
// A bare "Connection reset/closed by … port N" also appears when the link drops mid-command.
const CONNECTION_DROP_RE = /Connection (?:closed|reset) by \S+ port \d+/i;
// Newer scp speaks SFTP; servers whose sshd has no sftp subsystem reject it this way.
const SFTP_MISSING_RE = /subsystem request failed|scp: Connection closed/i;

const IMAGE_MIMES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
});

export function shQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

export function resolveRemotePathExpr(remotePath = '', fallback = '$HOME') {
  const raw = String(remotePath || '').trim();
  if (!raw || raw === '~' || raw === '~/') return `"${fallback === '$HOME' ? '$HOME' : fallback}"`;
  if (raw.startsWith('~/')) return `"$HOME/"${shQuote(raw.slice(2))}`;
  return shQuote(raw);
}

export function makeRemoteUri(hostId, absPosixPath) {
  const clean = String(absPosixPath || '/').startsWith('/') ? String(absPosixPath) : `/${absPosixPath}`;
  const encoded = clean.split('/').map(seg => encodeURIComponent(seg)).join('/');
  return `agy-ssh://${encodeURIComponent(hostId)}${encoded}`;
}

export function parseRemoteUri(uri) {
  const raw = String(uri || '').trim();
  if (!raw.startsWith('agy-ssh://')) return null;
  const rest = raw.slice('agy-ssh://'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return { hostId: decodeURIComponent(rest), path: '/' };
  const hostId = decodeURIComponent(rest.slice(0, slash));
  const path = rest.slice(slash).split('/').map(seg => {
    try { return decodeURIComponent(seg); } catch { return seg; }
  }).join('/') || '/';
  return { hostId, path };
}

function controlSocketPath(host) {
  const key = `${host.id || ''}|${host.configAlias || ''}|${host.user || ''}|${host.host || ''}|${host.port || 22}|${host.proxyJump || ''}`;
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 14);
  return join(tmpdir(), `agy-ssh-${digest}.sock`);
}

export function buildSshArgs(host, {
  platform = process.platform,
  hasPassword = false,
  useControlMaster = platform !== 'win32',
  interactive = false,
  connectTimeoutSec = 10
} = {}) {
  const args = [];
  if (interactive) args.push('-tt');
  else args.push('-T');

  args.push(
    '-o', `ConnectTimeout=${connectTimeoutSec}`,
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'LogLevel=ERROR'
  );

  if (hasPassword) {
    args.push('-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=1');
  } else {
    args.push('-o', 'BatchMode=yes');
  }

  if (useControlMaster && platform !== 'win32') {
    const sock = controlSocketPath(host);
    args.push('-o', 'ControlMaster=auto', '-o', 'ControlPersist=600', '-o', `ControlPath=${sock}`);
  } else {
    args.push('-o', 'ControlMaster=no');
  }

  const useAliasDirectly = Boolean(host.configAlias && (!host.host || host.host === host.configAlias));
  if (!useAliasDirectly) {
    if (host.port && Number(host.port) !== 22) args.push('-p', String(host.port));
    if (host.identityFile) args.push('-i', host.identityFile, '-o', 'IdentitiesOnly=yes');
    if (host.proxyJump) args.push('-J', host.proxyJump);
  } else {
    if (host.port && Number(host.port) > 0 && Number(host.port) !== 22) args.push('-p', String(host.port));
    if (host.identityFile) args.push('-i', host.identityFile, '-o', 'IdentitiesOnly=yes');
    if (host.proxyJump) args.push('-J', host.proxyJump);
  }

  const target = useAliasDirectly
    ? host.configAlias
    : (host.user ? `${host.user}@${host.host}` : host.host);
  args.push('--', target);
  return { args, target };
}

export function buildScpArgs(host, {
  platform = process.platform,
  hasPassword = false,
  useControlMaster = platform !== 'win32',
  recursive = false,
  connectTimeoutSec = 10
} = {}) {
  const args = [];
  if (recursive) args.push('-r');
  args.push(
    '-o', `ConnectTimeout=${connectTimeoutSec}`,
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'LogLevel=ERROR'
  );
  if (hasPassword) args.push('-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=1');
  else args.push('-o', 'BatchMode=yes');

  if (useControlMaster && platform !== 'win32') {
    args.push('-o', 'ControlMaster=auto', '-o', 'ControlPersist=600', '-o', `ControlPath=${controlSocketPath(host)}`);
  } else {
    args.push('-o', 'ControlMaster=no');
  }

  const useAliasDirectly = Boolean(host.configAlias && (!host.host || host.host === host.configAlias));
  if (host.port && Number(host.port) !== 22) args.push('-P', String(host.port));
  if (host.identityFile) args.push('-i', host.identityFile, '-o', 'IdentitiesOnly=yes');
  if (host.proxyJump) args.push('-J', host.proxyJump);

  const target = useAliasDirectly
    ? host.configAlias
    : (host.user ? `${host.user}@${host.host}` : host.host);
  return { args, target };
}

function cleanSshError(stderr, fallback = 'SSH 连接失败') {
  const text = String(stderr || '').trim();
  if (!text) return fallback;
  if (/Permission denied/i.test(text)) return 'SSH 认证失败（密钥或密码不正确）';
  if (HANDSHAKE_DROP_RE.test(text)) return 'SSH 握手被中途断开（网络或网关瞬时故障，稍后重试即可，不需要重装公钥）';
  if (CONNECTION_DROP_RE.test(text)) return 'SSH 连接中途断开（远端命令可能已开始执行，未自动重试；请先确认远端状态再决定是否重跑）';
  if (/Connection refused/i.test(text)) return '服务器拒绝连接（请检查 IP 与端口）';
  if (/Operation timed out|Connection timed out/i.test(text)) return '连接服务器超时（请检查网络、防火墙或代理）';
  if (/Could not resolve hostname/i.test(text)) return '无法解析主机域名';
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) return '远程主机指纹发生变化，请核实 ~/.ssh/known_hosts';
  return text.split(/\r?\n/).filter(Boolean).slice(-2).join(' | ').slice(0, 300);
}

function parseNotebookCells(rawJson) {
  const parsed = JSON.parse(rawJson);
  const rawCells = Array.isArray(parsed?.cells) ? parsed.cells : [];
  const cells = [];
  for (let i = 0; i < rawCells.length && cells.length < MAX_NOTEBOOK_CELLS; i++) {
    const c = rawCells[i];
    if (!c || typeof c !== 'object') continue;
    const cellType = c.cell_type === 'markdown' ? 'markdown' : 'code';
    const source = Array.isArray(c.source) ? c.source.join('') : String(c.source || '');
    const outputs = [];
    if (Array.isArray(c.outputs)) {
      for (const out of c.outputs.slice(0, 6)) {
        if (typeof out?.text === 'string') outputs.push(out.text);
        else if (Array.isArray(out?.text)) outputs.push(out.text.join(''));
        else if (out?.data?.['text/plain']) {
          const plain = out.data['text/plain'];
          outputs.push(Array.isArray(plain) ? plain.join('') : String(plain));
        }
      }
    }
    cells.push({
      index: i + 1,
      type: cellType,
      executionCount: Number.isInteger(c.execution_count) ? c.execution_count : null,
      source: source.slice(0, 16000),
      output: outputs.join('\n').slice(0, 8000)
    });
  }
  return { cells, totalCells: rawCells.length };
}

function parsePorcelainGitStatus(rawStdout, rootDir, hostId) {
  const lines = String(rawStdout || '').split(/\r?\n/);
  let branch = '';
  let ahead = 0;
  let behind = 0;
  const files = [];
  let staged = 0;
  let modified = 0;
  let untracked = 0;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const head = line.slice(3).trim();
      const [branchPart, trackPart = ''] = head.split('...');
      branch = branchPart.replace(/^No commits yet on /, '').trim();
      const aheadM = trackPart.match(/ahead (\d+)/);
      const behindM = trackPart.match(/behind (\d+)/);
      if (aheadM) ahead = Number(aheadM[1]) || 0;
      if (behindM) behind = Number(behindM[1]) || 0;
      continue;
    }
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    let relPath = line.slice(3).trim();
    if (relPath.includes(' -> ')) relPath = relPath.split(' -> ').pop().trim();
    relPath = relPath.replace(/^"(.*)"$/, '$1');
    let status = 'M';
    if (x === '?' && y === '?') {
      status = '??';
      untracked++;
    } else {
      if (x !== ' ' && x !== '?') staged++;
      if (y !== ' ' && y !== '?') modified++;
      status = `${x}${y}`.trim() || 'M';
    }
    const absPath = posix.join(rootDir || '/', relPath);
    files.push({
      path: relPath,
      status,
      uri: makeRemoteUri(hostId, absPath)
    });
  }

  return {
    ok: true,
    isRepo: true,
    remote: true,
    hostId,
    repoRoot: rootDir,
    repoUri: makeRemoteUri(hostId, rootDir),
    branch: branch || 'HEAD',
    ahead,
    behind,
    clean: files.length === 0,
    counts: { total: files.length, staged, modified, untracked },
    files: files.slice(0, 200),
    truncated: files.length > 200
  };
}

export function createSshRunner({
  store,
  spawnProcess = spawn,
  platform = process.platform,
  env = process.env,
  home = homedir(),
  retryDelayMs = 5000
} = {}) {
  const sshBin = env.ANTIGRAVITY_SSH_BIN || (platform === 'win32' ? 'ssh.exe' : 'ssh');
  const scpBin = env.ANTIGRAVITY_SCP_BIN || (platform === 'win32' ? 'scp.exe' : 'scp');
  const statuses = new Map();
  const terminals = new Map();

  function getHostRecord(hostOrId) {
    if (hostOrId && typeof hostOrId === 'object') return hostOrId;
    const host = store?.getHost?.(hostOrId);
    if (!host) throw new Error(`找不到 SSH 主机: ${String(hostOrId || '')}`);
    return host;
  }

  function resolvePassword(host, passwordOverride = '') {
    if (typeof passwordOverride === 'string' && passwordOverride.length > 0) return passwordOverride;
    if (!host?.id) return '';
    if (host.authType !== 'password' && !host.hasPassword) return '';
    const res = store?.vault?.readPassword?.(host.id);
    return res?.ok && res.exists ? res.password : '';
  }

  function setStatus(hostId, patch) {
    if (!hostId) return;
    const prev = statuses.get(hostId) || { status: 'offline', homeDir: '', hostname: '', os: '', latencyMs: null, lastSeenMs: 0, lastError: '' };
    statuses.set(hostId, { ...prev, ...patch });
  }

  function getStatus(hostId) {
    return statuses.get(hostId) || { status: 'offline', homeDir: '', hostname: '', os: '', latencyMs: null, lastSeenMs: 0, lastError: '' };
  }

  function getAllStatuses() {
    return Object.fromEntries(statuses.entries());
  }

  // Only a handshake drop with no start marker seen is retried: the remote command provably never ran.
  async function execRaw(hostOrId, remoteCommand, options = {}) {
    try {
      return await execOnce(hostOrId, remoteCommand, options);
    } catch (error) {
      if (!error?.transient) throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, retryDelayMs));
      return execOnce(hostOrId, remoteCommand, options);
    }
  }

  async function execOnce(hostOrId, remoteCommand, {
    stdin = null,
    timeoutMs = 30000,
    maxBytes = 8 * 1024 * 1024,
    passwordOverride = '',
    binaryStdout = false
  } = {}) {
    const host = getHostRecord(hostOrId);
    const password = resolvePassword(host, passwordOverride);
    const { args } = buildSshArgs(host, { platform, hasPassword: Boolean(password) });
    // Login shells may print from rc files (.zshenv, .bashrc) before our command runs.
    // Everything before this per-call marker is that noise, never our output.
    const marker = `__AGY_BEGIN_${randomBytes(8).toString('hex')}__`;
    args.push(`printf '%s\\n' '${marker}'; ${remoteCommand}`);

    return withSshAskpass(password, askEnv => new Promise((resolvePromise, rejectPromise) => {
      const started = Date.now();
      let settled = false;
      const outChunks = [];
      const errChunks = [];
      let outLen = 0;
      let errLen = 0;
      let truncated = false;

      const child = spawnProcess(sshBin, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...env, ...askEnv }
      });

      const timer = timeoutMs > 0 ? setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch {}
        const err = new Error(`SSH 执行超时 (${Math.round(timeoutMs / 1000)}s)`);
        setStatus(host.id, { status: 'error', lastError: err.message });
        rejectPromise(err);
      }, timeoutMs) : null;
      timer?.unref?.();

      child.stdout?.on('data', chunk => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (outLen < maxBytes) {
          const take = Math.min(buf.length, maxBytes - outLen);
          outChunks.push(take === buf.length ? buf : buf.subarray(0, take));
          outLen += take;
          if (take < buf.length) truncated = true;
        } else {
          truncated = true;
        }
      });

      child.stderr?.on('data', chunk => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (errLen < 65536) {
          errChunks.push(buf);
          errLen += buf.length;
        }
      });

      child.on('error', err => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        const msg = err.code === 'ENOENT' ? '系统未安装 OpenSSH 客户端（ssh）' : `SSH 启动失败: ${err.message}`;
        setStatus(host.id, { status: 'error', lastError: msg });
        rejectPromise(new Error(msg));
      });

      child.on('close', code => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        let stdoutBuf = Buffer.concat(outChunks);
        const markerBuf = Buffer.from(`${marker}\n`, 'utf8');
        const markerAt = stdoutBuf.indexOf(markerBuf);
        if (markerAt >= 0) stdoutBuf = stdoutBuf.subarray(markerAt + markerBuf.length);
        const stderr = Buffer.concat(errChunks).toString('utf8');
        const durationMs = Date.now() - started;
        if (code === 255) {
          const msg = cleanSshError(stderr, `无法连接到 ${host.name || host.host}`);
          setStatus(host.id, { status: 'offline', lastError: msg });
          const err = new Error(msg);
          // Our marker is printed right before the command, so seeing it means the command may have run.
          err.transient = markerAt < 0 && HANDSHAKE_DROP_RE.test(stderr) && !/Permission denied/i.test(stderr);
          rejectPromise(err);
          return;
        }
        setStatus(host.id, { status: 'connected', lastSeenMs: Date.now(), lastError: '' });
        resolvePromise({
          code: code ?? 0,
          stdout: binaryStdout ? stdoutBuf : stdoutBuf.toString('utf8'),
          stderr,
          truncated,
          durationMs
        });
      });

      child.stdin?.on('error', () => {});
      if (stdin !== null && stdin !== undefined) {
        child.stdin?.end(Buffer.isBuffer(stdin) ? stdin : Buffer.from(String(stdin), 'utf8'));
      } else {
        child.stdin?.end();
      }
    }), { platform });
  }

  async function testConnection(hostOrId, { passwordOverride = '' } = {}) {
    const host = getHostRecord(hostOrId);
    setStatus(host.id, { status: 'connecting', lastError: '' });
    const started = Date.now();
    const probe = [
      'printf "HOME=%s\\n" "$HOME"',
      'printf "HOSTNAME=%s\\n" "$(hostname 2>/dev/null || true)"',
      'printf "UNAME=%s\\n" "$(uname -sm 2>/dev/null || true)"',
      'printf "PY3=%s\\n" "$(command -v python3 2>/dev/null || true)"',
      'printf "GIT=%s\\n" "$(command -v git 2>/dev/null || true)"',
      'printf "RG=%s\\n" "$(command -v rg 2>/dev/null || true)"'
    ].join('; ');
    const res = await execRaw(host, `sh -lc ${shQuote(probe)}`, { timeoutMs: 15000, passwordOverride });
    if (res.code !== 0) {
      const msg = cleanSshError(res.stderr, '远端连通性检测失败');
      setStatus(host.id, { status: 'error', lastError: msg });
      throw new Error(msg);
    }
    const info = {};
    for (const line of String(res.stdout || '').split(/\r?\n/)) {
      const idx = line.indexOf('=');
      if (idx > 0) info[line.slice(0, idx)] = line.slice(idx + 1).trim();
    }
    const latencyMs = Date.now() - started;
    const summary = {
      ok: true,
      hostId: host.id,
      homeDir: info.HOME || '/',
      hostname: info.HOSTNAME || host.host,
      os: info.UNAME || 'Linux',
      hasPython3: Boolean(info.PY3),
      hasGit: Boolean(info.GIT),
      hasRg: Boolean(info.RG),
      latencyMs
    };
    setStatus(host.id, {
      status: 'connected',
      homeDir: summary.homeDir,
      hostname: summary.hostname,
      os: summary.os,
      latencyMs,
      lastSeenMs: Date.now(),
      lastError: ''
    });
    return summary;
  }

  async function disconnect(hostOrId) {
    const host = getHostRecord(hostOrId);
    if (platform !== 'win32') {
      const sock = controlSocketPath(host);
      if (existsSync(sock)) {
        const target = host.configAlias || (host.user ? `${host.user}@${host.host}` : host.host);
        await new Promise(resolveDone => {
          const child = spawnProcess(sshBin, ['-O', 'exit', '-S', sock, '--', target], {
            stdio: 'ignore',
            windowsHide: true
          });
          child.on('close', () => resolveDone());
          child.on('error', () => resolveDone());
        });
      }
    }
    setStatus(host.id, { status: 'offline' });
    return { ok: true, hostId: host.id };
  }

  async function installPublicKey(hostOrId, { passwordOverride = '' } = {}) {
    const host = getHostRecord(hostOrId);
    // One key per server, so revoking or leaking one never touches the others.
    const label = host.configAlias || (host.host ? `${host.host}${host.port && Number(host.port) !== 22 ? `-${host.port}` : ''}` : '') || host.name || host.id;
    const slug = String(label || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 48) || 'host';
    const keyInfo = ensureLocalPublicKey({ home, platform, keyName: `agy-${slug}_ed25519` });
    const script = [
      'set -e',
      'KEY=$(cat)',
      'mkdir -p "$HOME/.ssh"',
      'chmod 700 "$HOME/.ssh"',
      'touch "$HOME/.ssh/authorized_keys"',
      'chmod 600 "$HOME/.ssh/authorized_keys"',
      'grep -qxF "$KEY" "$HOME/.ssh/authorized_keys" || printf "%s\\n" "$KEY" >> "$HOME/.ssh/authorized_keys"'
    ].join('; ');
    const res = await execRaw(host, `sh -c ${shQuote(script)}`, {
      stdin: `${keyInfo.publicKey}\n`,
      timeoutMs: 15000,
      passwordOverride
    });
    if (res.code !== 0) {
      throw new Error(cleanSshError(res.stderr, '安装 SSH 免密公钥失败'));
    }
    return { ok: true, publicKeyPath: keyInfo.publicKeyPath, privateKeyPath: keyInfo.privateKeyPath, created: keyInfo.created };
  }

  async function listDir(hostOrId, rootDir = '', relPath = '', { passwordOverride = '' } = {}) {
    const host = getHostRecord(hostOrId);
    const cleanRel = String(relPath || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    if (cleanRel.split('/').includes('..')) throw new Error('不允许跨目录访问');
    const pyScript = `
import json, os, sys
root = os.path.expanduser(sys.argv[1] or '~')
rel = sys.argv[2]
target = os.path.normpath(os.path.join(root, rel)) if rel else os.path.normpath(root)
if not os.path.isdir(target):
    print(json.dumps({"ok": False, "error": "目录不存在: " + target}))
    sys.exit(0)
items = []
for name in os.listdir(target):
    full = os.path.join(target, name)
    try:
        st = os.stat(full)
        is_dir = os.path.isdir(full)
        items.append({"name": name, "path": full, "isDirectory": is_dir, "size": 0 if is_dir else st.st_size, "mtimeMs": int(st.st_mtime * 1000)})
    except OSError:
        continue
items.sort(key=lambda x: (0 if x["isDirectory"] else 1, x["name"].lower()))
truncated = len(items) > ${MAX_DIR_ENTRIES}
print(json.dumps({"ok": True, "rootDir": os.path.normpath(root), "dirPath": target, "entries": items[:${MAX_DIR_ENTRIES}], "truncated": truncated}))
`.trim();
    const fallbackSh = `
DIR=${resolveRemotePathExpr(rootDir)}; [ -n ${shQuote(cleanRel)} ] && DIR="$DIR/"${shQuote(cleanRel)}
[ -d "$DIR" ] || { printf 'ERR:目录不存在\\n'; exit 0; }
printf 'ROOT:%s\\n' "$(cd ${resolveRemotePathExpr(rootDir)} 2>/dev/null && pwd || echo "$DIR")"
printf 'DIR:%s\\n' "$(cd "$DIR" 2>/dev/null && pwd || echo "$DIR")"
ls -1Ap "$DIR" 2>/dev/null | head -n ${MAX_DIR_ENTRIES}
`.trim();
    const cmd = `if command -v python3 >/dev/null 2>&1; then python3 -c ${shQuote(pyScript)} ${shQuote(rootDir || '~')} ${shQuote(cleanRel)}; else ${fallbackSh}; fi`;
    const res = await execRaw(host, cmd, { timeoutMs: 15000, passwordOverride });
    const out = String(res.stdout || '').trim();
    if (out.startsWith('{')) {
      const parsed = JSON.parse(out);
      if (!parsed.ok) throw new Error(parsed.error || '读取远端目录失败');
      return {
        ok: true,
        hostId: host.id,
        rootDir: parsed.rootDir,
        dirPath: parsed.dirPath,
        relPath: cleanRel,
        truncated: Boolean(parsed.truncated),
        entries: parsed.entries.map(item => ({
          ...item,
          relPath: cleanRel ? `${cleanRel}/${item.name}` : item.name,
          uri: makeRemoteUri(host.id, item.path)
        }))
      };
    }
    if (out.startsWith('ERR:')) throw new Error(out.slice(4));
    const lines = out.split(/\r?\n/);
    const resolvedRoot = (lines.find(l => l.startsWith('ROOT:')) || '').slice(5) || rootDir || '/';
    const resolvedDir = (lines.find(l => l.startsWith('DIR:')) || '').slice(4) || resolvedRoot;
    const rawNames = lines.filter(l => l && !l.startsWith('ROOT:') && !l.startsWith('DIR:'));
    const entries = rawNames.map(entry => {
      const isDirectory = entry.endsWith('/');
      const name = isDirectory ? entry.slice(0, -1) : entry;
      const fullPath = posix.join(resolvedDir, name);
      return {
        name,
        path: fullPath,
        relPath: cleanRel ? `${cleanRel}/${name}` : name,
        uri: makeRemoteUri(host.id, fullPath),
        isDirectory,
        size: 0,
        mtimeMs: 0
      };
    }).sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    return { ok: true, hostId: host.id, rootDir: resolvedRoot, dirPath: resolvedDir, relPath: cleanRel, truncated: false, entries };
  }

  async function searchFiles(hostOrId, rootDir = '', { query = '', mode = 'files', glob = '', maxResults = 120 } = {}) {
    const host = getHostRecord(hostOrId);
    const q = String(query || '').trim();
    if (!q) return { ok: true, entries: [], matches: [] };
    const limit = Math.max(1, Math.min(200, Number(maxResults) || 120));

    if (mode === 'files') {
      const pyScript = `
import json, os, sys
root = os.path.normpath(os.path.expanduser(sys.argv[1] or '~'))
q = sys.argv[2].lower()
limit = int(sys.argv[3])
skip = {'.git','node_modules','__pycache__','.venv','venv','.next','.nuxt','target','.cache','.pytest_cache'}
entries = []
scanned = 0
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in skip]
    for name in filenames:
        scanned += 1
        if scanned > 10000:
            break
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, root).replace('\\\\', '/')
        if q in rel.lower():
            entries.append({"name": name, "relPath": rel, "path": full, "isDirectory": False})
            if len(entries) >= limit:
                break
    if scanned > 10000 or len(entries) >= limit:
        break
print(json.dumps({"ok": True, "rootDir": root, "entries": entries}))
`.trim();
      const res = await execRaw(host, `python3 -c ${shQuote(pyScript)} ${shQuote(rootDir || '~')} ${shQuote(q)} ${limit}`, { timeoutMs: 20000 });
      if (res.code === 0 && String(res.stdout || '').trim().startsWith('{')) {
        const parsed = JSON.parse(res.stdout.trim());
        return {
          ok: true,
          rootDir: parsed.rootDir,
          entries: (parsed.entries || []).map(item => ({ ...item, uri: makeRemoteUri(host.id, item.path) }))
        };
      }
      const fallback = `ROOT=${resolveRemotePathExpr(rootDir)}; find "$ROOT" -maxdepth 6 \\( -name .git -o -name node_modules -o -name __pycache__ \\) -prune -o -iname ${shQuote(`*${q}*`)} -print 2>/dev/null | head -n ${limit}`;
      const fb = await execRaw(host, fallback, { timeoutMs: 20000 });
      const entries = String(fb.stdout || '').split(/\r?\n/).filter(Boolean).map(full => ({
        name: posix.basename(full),
        relPath: full,
        path: full,
        uri: makeRemoteUri(host.id, full),
        isDirectory: false
      }));
      return { ok: true, entries };
    }

    if (mode === 'glob') {
      const cmd = `ROOT=${resolveRemotePathExpr(rootDir)}; cd "$ROOT" 2>/dev/null || exit 1; if command -v rg >/dev/null 2>&1; then rg --files -g ${shQuote(q)} | head -n ${limit}; else find . -maxdepth 8 \\( -name .git -o -name node_modules \\) -prune -o -path ${shQuote(`*${q}*`)} -print | sed 's|^\\./||' | head -n ${limit}; fi`;
      const res = await execRaw(host, cmd, { timeoutMs: 20000 });
      const files = String(res.stdout || '').split(/\r?\n/).filter(Boolean);
      return { ok: true, files, count: files.length };
    }

    const fixedFlag = mode === 'regex' ? '' : '-F';
    const rgGlob = glob ? `-g ${shQuote(glob)}` : '';
    const cmd = `ROOT=${resolveRemotePathExpr(rootDir)}; cd "$ROOT" 2>/dev/null || exit 1; if command -v rg >/dev/null 2>&1; then rg -n --no-heading --color=never ${fixedFlag} ${rgGlob} --max-count 20 ${shQuote(q)} . 2>/dev/null | head -n ${limit}; else grep -rn ${fixedFlag} --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=__pycache__ ${shQuote(q)} . 2>/dev/null | head -n ${limit}; fi`;
    const res = await execRaw(host, cmd, { timeoutMs: 25000 });
    const matches = String(res.stdout || '').split(/\r?\n/).filter(Boolean).map(line => {
      const m = line.match(/^(?:\.\/)?([^:]+):(\d+):(.*)$/);
      if (!m) return { file: '', line: 0, text: line };
      return { file: m[1], line: Number(m[2]) || 0, text: m[3].slice(0, 400) };
    });
    return { ok: true, matches, count: matches.length };
  }

  async function readFile(hostOrId, filePath, { startLine = null, endLine = null, maxBytes = MAX_TEXT_PREVIEW_BYTES, rawNotebook = false } = {}) {
    const host = getHostRecord(hostOrId);
    const parsedUri = parseRemoteUri(filePath);
    const targetPath = parsedUri ? parsedUri.path : String(filePath || '').trim();
    if (!targetPath) throw new Error('缺少远端文件路径');
    const ext = extname(targetPath).toLowerCase();
    const isImage = Boolean(IMAGE_MIMES[ext]);
    const byteCap = isImage ? MAX_IMAGE_BYTES : (ext === '.ipynb' ? MAX_NOTEBOOK_BYTES : maxBytes);

    const pyScript = `
import base64, json, os, sys
p = os.path.normpath(os.path.expanduser(sys.argv[1]))
cap = int(sys.argv[2])
s_line = int(sys.argv[3]) if sys.argv[3] else None
e_line = int(sys.argv[4]) if sys.argv[4] else None
is_img = sys.argv[5] == '1'
if not os.path.isfile(p):
    print(json.dumps({"ok": False, "error": "文件不存在或不是普通文件: " + p}))
    sys.exit(0)
st = os.stat(p)
size = st.st_size
mtime = int(st.st_mtime * 1000)
if is_img:
    if size > cap:
        print(json.dumps({"ok": True, "kind": "binary", "path": p, "name": os.path.basename(p), "size": size, "mtimeMs": mtime, "tooLarge": True}))
        sys.exit(0)
    with open(p, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('ascii')
    print(json.dumps({"ok": True, "kind": "image", "path": p, "name": os.path.basename(p), "size": size, "mtimeMs": mtime, "dataBase64": b64}))
    sys.exit(0)
with open(p, 'rb') as f:
    sample = f.read(min(size, 4096))
if b'\\x00' in sample:
    print(json.dumps({"ok": True, "kind": "binary", "path": p, "name": os.path.basename(p), "size": size, "mtimeMs": mtime}))
    sys.exit(0)
with open(p, 'rb') as f:
    raw = f.read(cap + 1)
truncated = len(raw) > cap
text = raw[:cap].decode('utf-8', errors='replace')
lines = text.splitlines()
total = len(lines)
if s_line is not None or e_line is not None:
    lo = max(1, s_line or 1)
    hi = min(total, e_line or total)
    sliced = '\\n'.join(lines[lo-1:hi])
    print(json.dumps({"ok": True, "kind": "text", "path": p, "name": os.path.basename(p), "size": size, "mtimeMs": mtime, "content": sliced, "startLine": lo, "endLine": hi, "totalLines": total, "truncated": truncated or hi < total, "editable": False}))
else:
    print(json.dumps({"ok": True, "kind": "text", "path": p, "name": os.path.basename(p), "size": size, "mtimeMs": mtime, "content": text, "startLine": 1, "endLine": total, "totalLines": total, "truncated": truncated, "editable": not truncated}))
`.trim();

    const res = await execRaw(
      host,
      `python3 -c ${shQuote(pyScript)} ${shQuote(targetPath)} ${byteCap} ${shQuote(startLine ?? '')} ${shQuote(endLine ?? '')} ${isImage ? '1' : '0'}`,
      { timeoutMs: 25000, maxBytes: 12 * 1024 * 1024 }
    );

    if (res.code === 0 && String(res.stdout || '').trim().startsWith('{')) {
      const parsed = JSON.parse(res.stdout.trim());
      if (!parsed.ok) throw new Error(parsed.error || '读取远端文件失败');
      const uri = makeRemoteUri(host.id, parsed.path);
      if (parsed.kind === 'image') {
        const mimeType = IMAGE_MIMES[ext] || 'application/octet-stream';
        return { ...parsed, uri, mimeType, dataUrl: `data:${mimeType};base64,${parsed.dataBase64}` };
      }
      if (parsed.kind === 'text' && ext === '.ipynb' && !rawNotebook && !parsed.truncated && startLine == null && endLine == null) {
        try {
          const nb = parseNotebookCells(parsed.content);
          return { ...parsed, uri, kind: 'notebook', cells: nb.cells, totalCells: nb.totalCells, editable: false };
        } catch { /* Fall back to raw text if malformed JSON. */ }
      }
      return { ...parsed, uri };
    }

    // Pure POSIX fallback when python3 is absent on remote server
    const fallbackCmd = `P=${resolveRemotePathExpr(targetPath)}; [ -f "$P" ] || { printf '__AGY_ERR__:文件不存在\\n'; exit 0; }; head -c ${byteCap} "$P"`;
    const fb = await execRaw(host, fallbackCmd, { timeoutMs: 20000, maxBytes: byteCap + 4096 });
    const text = String(fb.stdout || '');
    if (text.startsWith('__AGY_ERR__:')) throw new Error(text.slice(12).trim());
    const lines = text.split(/\r?\n/);
    return {
      ok: true,
      kind: 'text',
      path: targetPath,
      name: posix.basename(targetPath),
      uri: makeRemoteUri(host.id, targetPath),
      size: Buffer.byteLength(text, 'utf8'),
      mtimeMs: 0,
      content: text,
      startLine: 1,
      endLine: lines.length,
      totalLines: lines.length,
      truncated: fb.truncated,
      editable: !fb.truncated
    };
  }

  async function writeFile(hostOrId, filePath, content, { append = false, expectedMtimeMs = null, overwrite = true } = {}) {
    const host = getHostRecord(hostOrId);
    const parsedUri = parseRemoteUri(filePath);
    const targetPath = parsedUri ? parsedUri.path : String(filePath || '').trim();
    if (!targetPath) throw new Error('缺少远端文件路径');

    const pyScript = `
import json, os, sys, tempfile
p = os.path.normpath(os.path.expanduser(sys.argv[1]))
append = sys.argv[2] == '1'
overwrite = sys.argv[3] == '1'
exp_mtime = int(sys.argv[4]) if sys.argv[4] else None
data = sys.stdin.buffer.read()
exists = os.path.exists(p)
if exists and not overwrite and not append:
    print(json.dumps({"ok": False, "error": "文件已存在"}))
    sys.exit(0)
if exists and exp_mtime is not None:
    cur = int(os.stat(p).st_mtime * 1000)
    if abs(cur - exp_mtime) > 1500:
        print(json.dumps({"ok": False, "conflict": True, "mtimeMs": cur, "error": "远端文件已被其他操作修改"}))
        sys.exit(0)
os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
if append:
    with open(p, 'ab') as f:
        f.write(data)
else:
    fd, tmp = tempfile.mkstemp(prefix='.agy-write-', dir=os.path.dirname(p) or '.')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
        os.replace(tmp, p)
    except Exception:
        try: os.unlink(tmp)
        except OSError: pass
        raise
st = os.stat(p)
print(json.dumps({"ok": True, "path": p, "size": st.st_size, "mtimeMs": int(st.st_mtime * 1000)}))
`.trim();

    const res = await execRaw(
      host,
      `python3 -c ${shQuote(pyScript)} ${shQuote(targetPath)} ${append ? '1' : '0'} ${overwrite ? '1' : '0'} ${shQuote(expectedMtimeMs ?? '')}`,
      { stdin: Buffer.from(String(content ?? ''), 'utf8'), timeoutMs: 25000 }
    );
    if (res.code === 0 && String(res.stdout || '').trim().startsWith('{')) {
      const parsed = JSON.parse(res.stdout.trim());
      if (!parsed.ok) {
        const err = new Error(parsed.error || '写入远端文件失败');
        if (parsed.conflict) err.conflict = true;
        throw err;
      }
      return { ...parsed, uri: makeRemoteUri(host.id, parsed.path) };
    }
    const op = append ? '>>' : '>';
    const fb = await execRaw(
      host,
      `P=${resolveRemotePathExpr(targetPath)}; mkdir -p "$(dirname "$P")" && cat ${op} "$P"`,
      { stdin: Buffer.from(String(content ?? ''), 'utf8'), timeoutMs: 25000 }
    );
    if (fb.code !== 0) throw new Error(cleanSshError(fb.stderr, '写入远端文件失败'));
    return { ok: true, path: targetPath, uri: makeRemoteUri(host.id, targetPath), size: Buffer.byteLength(String(content ?? ''), 'utf8'), mtimeMs: Date.now() };
  }

  async function editFile(hostOrId, filePath, target, replacement, { replaceAll = false } = {}) {
    const host = getHostRecord(hostOrId);
    const parsedUri = parseRemoteUri(filePath);
    const targetPath = parsedUri ? parsedUri.path : String(filePath || '').trim();
    if (!targetPath) throw new Error('缺少远端文件路径');
    if (typeof target !== 'string' || !target) throw new Error('target 不能为空');

    const pyScript = `
import json, os, sys, tempfile
payload = json.loads(sys.stdin.read())
p = os.path.normpath(os.path.expanduser(payload['path']))
old = payload['target']
new = payload['replacement']
all_flag = bool(payload.get('replaceAll'))
if not os.path.isfile(p):
    print(json.dumps({"ok": False, "error": "文件不存在: " + p}))
    sys.exit(0)
with open(p, 'r', encoding='utf-8') as f:
    text = f.read()
count = text.count(old)
if count == 0:
    print(json.dumps({"ok": False, "error": "未在远端文件中找到匹配的目标文本"}))
    sys.exit(0)
updated = text.replace(old, new) if all_flag else text.replace(old, new, 1)
replaced = count if all_flag else 1
fd, tmp = tempfile.mkstemp(prefix='.agy-edit-', dir=os.path.dirname(p) or '.')
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(updated)
    os.replace(tmp, p)
except Exception:
    try: os.unlink(tmp)
    except OSError: pass
    raise
st = os.stat(p)
print(json.dumps({"ok": True, "path": p, "replacements": replaced, "totalMatches": count, "mtimeMs": int(st.st_mtime * 1000)}))
`.trim();

    const payload = JSON.stringify({ path: targetPath, target, replacement: String(replacement ?? ''), replaceAll: Boolean(replaceAll) });
    const res = await execRaw(host, `python3 -c ${shQuote(pyScript)}`, { stdin: payload, timeoutMs: 25000 });
    if (res.code !== 0 || !String(res.stdout || '').trim().startsWith('{')) {
      throw new Error(cleanSshError(res.stderr, '编辑远端文件失败（需要远端具备 python3）'));
    }
    const parsed = JSON.parse(res.stdout.trim());
    if (!parsed.ok) throw new Error(parsed.error || '编辑远端文件失败');
    return { ...parsed, uri: makeRemoteUri(host.id, parsed.path) };
  }

  /**
   * Executes a command on the Linux server using a persistent detached job wrapper.
   * Fast commands complete in one SSH round-trip; long-running jobs (e.g. GPU training)
   * stay alive in the background across pauses or network drops and can be tailed anytime.
   */
  async function runCommand(hostOrId, { command, cwd = '', waitMs = 15000, background = false } = {}) {
    const host = getHostRecord(hostOrId);
    const cmdText = String(command || '').trim();
    if (!cmdText) throw new Error('命令不能为空');
    const jobId = `job-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    const waitSec = background ? 0 : Math.max(1, Math.min(120, Math.ceil((Number(waitMs) || 15000) / 1000)));
    const cwdExpr = resolveRemotePathExpr(cwd);

    const script = `
set -u
JOB_DIR="/tmp/agy-ssh-jobs/${jobId}"
mkdir -p "$JOB_DIR"
TARGET_DIR=${cwdExpr}
[ -d "$TARGET_DIR" ] || TARGET_DIR="$HOME"
cat > "$JOB_DIR/cmd.sh"
chmod +x "$JOB_DIR/cmd.sh"
printf '%s\\n' "$TARGET_DIR" > "$JOB_DIR/cwd"
date +%s > "$JOB_DIR/started_at"
(
  cd "$TARGET_DIR" || exit 1
  sh -l "$JOB_DIR/cmd.sh"
  EC=$?
  printf '%s\\n' "$EC" > "$JOB_DIR/exit_code"
) > "$JOB_DIR/output.log" 2>&1 < /dev/null &
PID=$!
printf '%s\\n' "$PID" > "$JOB_DIR/pid"
WAIT_TICKS=${waitSec * 5}
ELAPSED=0
while [ "$ELAPSED" -lt "$WAIT_TICKS" ] && [ ! -f "$JOB_DIR/exit_code" ]; do
  if ! kill -0 "$PID" 2>/dev/null; then
    break
  fi
  sleep 0.2 2>/dev/null || sleep 1
  ELAPSED=$((ELAPSED + 1))
done
if [ -f "$JOB_DIR/exit_code" ]; then
  EC=$(cat "$JOB_DIR/exit_code" 2>/dev/null || echo 0)
  printf '__AGY_STATE__:DONE:%s:%s:%s\\n' "$PID" "$EC" "$TARGET_DIR"
  tail -c 65536 "$JOB_DIR/output.log" 2>/dev/null || true
else
  printf '__AGY_STATE__:RUNNING:%s:-1:%s\\n' "$PID" "$TARGET_DIR"
  tail -n 60 "$JOB_DIR/output.log" 2>/dev/null || true
fi
`.trim();

    const started = Date.now();
    const res = await execRaw(host, `sh -c ${shQuote(script)}`, {
      stdin: `${cmdText}\n`,
      timeoutMs: Math.max(20000, waitSec * 1000 + 15000)
    });
    const raw = String(res.stdout || '');
    const nl = raw.indexOf('\n');
    const header = (nl >= 0 ? raw.slice(0, nl) : raw).trim();
    const body = nl >= 0 ? raw.slice(nl + 1) : '';
    const m = header.match(/^__AGY_STATE__:(DONE|RUNNING):(\d+):(-?\d+):(.*)$/);
    if (!m) {
      return {
        ok: res.code === 0,
        jobId,
        background: false,
        running: false,
        exitCode: res.code,
        output: raw || res.stderr,
        durationMs: Date.now() - started
      };
    }
    const isRunning = m[1] === 'RUNNING';
    return {
      ok: true,
      jobId,
      pid: Number(m[2]),
      exitCode: isRunning ? null : Number(m[3]),
      cwd: m[4],
      background: isRunning,
      running: isRunning,
      output: body,
      logPath: `/tmp/agy-ssh-jobs/${jobId}/output.log`,
      durationMs: Date.now() - started
    };
  }

  async function jobStatus(hostOrId, jobId, { tailLines = 80 } = {}) {
    const host = getHostRecord(hostOrId);
    const id = String(jobId || '').trim();
    if (!JOB_ID_RE.test(id)) throw new Error('无效的远端任务 ID');
    const lines = Math.max(1, Math.min(500, Number(tailLines) || 80));
    const script = `
JOB_DIR="/tmp/agy-ssh-jobs/${id}"
[ -d "$JOB_DIR" ] || { printf '__AGY_JOB__:MISSING\\n'; exit 0; }
PID=$(cat "$JOB_DIR/pid" 2>/dev/null || echo 0)
CWD=$(cat "$JOB_DIR/cwd" 2>/dev/null || echo "")
STARTED=$(cat "$JOB_DIR/started_at" 2>/dev/null || echo 0)
if [ -f "$JOB_DIR/exit_code" ]; then
  EC=$(cat "$JOB_DIR/exit_code" 2>/dev/null || echo 0)
  printf '__AGY_JOB__:DONE:%s:%s:%s:%s\\n' "$PID" "$EC" "$STARTED" "$CWD"
elif [ "$PID" -gt 0 ] && kill -0 "$PID" 2>/dev/null; then
  printf '__AGY_JOB__:RUNNING:%s:-1:%s:%s\\n' "$PID" "$STARTED" "$CWD"
else
  printf '__AGY_JOB__:EXITED:%s:-1:%s:%s\\n' "$PID" "$STARTED" "$CWD"
fi
tail -n ${lines} "$JOB_DIR/output.log" 2>/dev/null || true
`.trim();
    const res = await execRaw(host, `sh -c ${shQuote(script)}`, { timeoutMs: 15000 });
    const raw = String(res.stdout || '');
    const nl = raw.indexOf('\n');
    const header = (nl >= 0 ? raw.slice(0, nl) : raw).trim();
    const body = nl >= 0 ? raw.slice(nl + 1) : '';
    if (header === '__AGY_JOB__:MISSING') return { ok: false, exists: false, jobId: id, error: '未找到该远端后台任务' };
    const m = header.match(/^__AGY_JOB__:(DONE|RUNNING|EXITED):(\d+):(-?\d+):(\d+):(.*)$/);
    if (!m) return { ok: false, jobId: id, error: '无法解析任务状态', output: raw };
    const state = m[1].toLowerCase();
    return {
      ok: true,
      exists: true,
      jobId: id,
      status: state,
      running: state === 'running',
      pid: Number(m[2]),
      exitCode: state === 'done' ? Number(m[3]) : null,
      startedAtSec: Number(m[4]),
      cwd: m[5],
      logPath: `/tmp/agy-ssh-jobs/${id}/output.log`,
      output: body
    };
  }

  async function listJobs(hostOrId) {
    const host = getHostRecord(hostOrId);
    const script = `
[ -d /tmp/agy-ssh-jobs ] || exit 0
for d in /tmp/agy-ssh-jobs/job-*; do
  [ -d "$d" ] || continue
  id=$(basename "$d")
  pid=$(cat "$d/pid" 2>/dev/null || echo 0)
  started=$(cat "$d/started_at" 2>/dev/null || echo 0)
  cwd=$(cat "$d/cwd" 2>/dev/null || echo "")
  cmd=$(head -n 1 "$d/cmd.sh" 2>/dev/null | cut -c1-120)
  if [ -f "$d/exit_code" ]; then
    st="done:$(cat "$d/exit_code" 2>/dev/null || echo 0)"
  elif [ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null; then
    st="running"
  else
    st="exited"
  fi
  printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$id" "$st" "$pid" "$started" "$cwd" "$cmd"
done
`.trim();
    const res = await execRaw(host, `sh -c ${shQuote(script)}`, { timeoutMs: 15000 });
    const jobs = String(res.stdout || '').split(/\r?\n/).filter(Boolean).map(line => {
      const [id, st = '', pid = '0', started = '0', cwd = '', cmd = ''] = line.split('\t');
      const [status, ec] = st.split(':');
      return {
        jobId: id,
        status,
        running: status === 'running',
        exitCode: ec !== undefined ? Number(ec) : null,
        pid: Number(pid) || 0,
        startedAtSec: Number(started) || 0,
        cwd,
        command: cmd
      };
    }).sort((a, b) => b.startedAtSec - a.startedAtSec);
    return { ok: true, jobs };
  }

  async function killJob(hostOrId, jobId) {
    const host = getHostRecord(hostOrId);
    const id = String(jobId || '').trim();
    if (!JOB_ID_RE.test(id)) throw new Error('无效的远端任务 ID');
    const script = `
JOB_DIR="/tmp/agy-ssh-jobs/${id}"
[ -f "$JOB_DIR/pid" ] || { printf 'MISSING\\n'; exit 0; }
PID=$(cat "$JOB_DIR/pid")
kill -TERM "$PID" 2>/dev/null || true
sleep 0.3 2>/dev/null || true
kill -0 "$PID" 2>/dev/null && kill -KILL "$PID" 2>/dev/null || true
printf 'KILLED:%s\\n' "$PID"
`.trim();
    const res = await execRaw(host, `sh -c ${shQuote(script)}`, { timeoutMs: 10000 });
    const out = String(res.stdout || '').trim();
    if (out === 'MISSING') return { ok: false, error: '任务不存在' };
    return { ok: true, jobId: id, result: out };
  }

  async function gitStatus(hostOrId, rootDir = '') {
    const host = getHostRecord(hostOrId);
    const cmd = `DIR=${resolveRemotePathExpr(rootDir)}; [ -d "$DIR" ] || { printf '__NOT_REPO__\\n'; exit 0; }; TOP=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || { printf '__NOT_REPO__\\n'; exit 0; }; printf '__TOP__:%s\\n' "$TOP"; git -C "$TOP" status --porcelain=v1 -b -uall 2>/dev/null`;
    const res = await execRaw(host, `sh -c ${shQuote(cmd)}`, { timeoutMs: 15000 });
    const out = String(res.stdout || '');
    if (!out || out.startsWith('__NOT_REPO__')) return { ok: true, isRepo: false, remote: true };
    const nl = out.indexOf('\n');
    const first = (nl >= 0 ? out.slice(0, nl) : out).trim();
    if (!first.startsWith('__TOP__:')) return { ok: true, isRepo: false, remote: true };
    const top = first.slice(8).trim();
    const porcelain = nl >= 0 ? out.slice(nl + 1) : '';
    return parsePorcelainGitStatus(porcelain, top, host.id);
  }

  async function gitDiff(hostOrId, rootDir = '', relPath = '', status = '') {
    const host = getHostRecord(hostOrId);
    const cleanRel = String(relPath || '').replaceAll('\\', '/').replace(/^\/+/, '');
    if (!cleanRel || cleanRel.split('/').includes('..')) throw new Error('无效的相对文件路径');
    const isUntracked = status === '??';
    const cmd = isUntracked
      ? `DIR=${resolveRemotePathExpr(rootDir)}; TOP=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || exit 1; head -c 196608 "$TOP/"${shQuote(cleanRel)}`
      : `DIR=${resolveRemotePathExpr(rootDir)}; TOP=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || exit 1; git -C "$TOP" diff HEAD -- ${shQuote(cleanRel)} 2>/dev/null || git -C "$TOP" diff -- ${shQuote(cleanRel)} 2>/dev/null`;
    const res = await execRaw(host, `sh -c ${shQuote(cmd)}`, { timeoutMs: 15000, maxBytes: 256 * 1024 });
    const diff = isUntracked
      ? String(res.stdout || '').split(/\r?\n/).map(line => `+${line}`).join('\n')
      : String(res.stdout || '');
    return {
      ok: true,
      path: cleanRel,
      status: status || 'M',
      diff,
      truncated: Boolean(res.truncated)
    };
  }

  async function transfer(hostOrId, { direction, localPath, remotePath, passwordOverride = '' }) {
    const host = getHostRecord(hostOrId);
    if (!['upload', 'download'].includes(direction)) throw new Error('direction 必须为 upload 或 download');
    const cleanLocal = String(localPath || '').trim();
    const cleanRemote = String(remotePath || '').trim();
    if (!cleanLocal || !cleanRemote) throw new Error('必须同时提供 localPath 与 remotePath');

    const password = resolvePassword(host, passwordOverride);
    let recursive = false;
    if (direction === 'upload') {
      if (!existsSync(cleanLocal)) throw new Error(`本机文件或目录不存在: ${cleanLocal}`);
      recursive = statSync(cleanLocal).isDirectory();
    } else {
      mkdirSync(dirname(cleanLocal), { recursive: true });
      const check = await execRaw(host, `[ -d ${resolveRemotePathExpr(cleanRemote)} ] && echo DIR || echo FILE`, { timeoutMs: 10000, passwordOverride });
      recursive = String(check.stdout || '').trim() === 'DIR';
    }

    const { args, target } = buildScpArgs(host, { platform, hasPassword: Boolean(password), recursive });
    const remoteSpec = `${target}:${cleanRemote}`;
    const fullArgs = direction === 'upload' ? [...args, '--', cleanLocal, remoteSpec] : [...args, '--', remoteSpec, cleanLocal];

    const runScp = legacy => withSshAskpass(password, askEnv => new Promise((resolvePromise, rejectPromise) => {
      const started = Date.now();
      let stderr = '';
      const child = spawnProcess(scpBin, legacy ? ['-O', ...fullArgs] : fullArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...env, ...askEnv }
      });
      child.stderr?.on('data', c => { if (stderr.length < 4096) stderr += String(c); });
      child.on('error', err => rejectPromise(new Error(err.code === 'ENOENT' ? '系统未安装 scp 客户端' : `传输启动失败: ${err.message}`)));
      child.on('close', code => {
        if (code !== 0) {
          const err = new Error(cleanSshError(stderr, `${direction === 'upload' ? '上传' : '下载'}失败 (exit ${code})`));
          err.sftpMissing = !legacy && SFTP_MISSING_RE.test(stderr);
          rejectPromise(err);
          return;
        }
        resolvePromise({
          ok: true,
          direction,
          hostId: host.id,
          localPath: cleanLocal,
          remotePath: cleanRemote,
          recursive,
          legacyProtocol: legacy,
          durationMs: Date.now() - started
        });
      });
    }), { platform });

    try {
      return await runScp(false);
    } catch (error) {
      if (!error?.sftpMissing) throw error;
      return runScp(true);
    }
  }

  function startTerminal(hostOrId, { cwd = '', cols = 100, rows = 28, onData = () => {}, onExit = () => {} } = {}) {
    const host = getHostRecord(hostOrId);
    const password = resolvePassword(host);
    if (password) {
      throw new Error('内置交互终端暂建议先点击「一键配置免密公钥」以使用 SSH 密钥直连');
    }
    const termId = `term-${randomBytes(6).toString('hex')}`;
    const { args } = buildSshArgs(host, { platform, hasPassword: false, useControlMaster: false, interactive: true });
    const startDir = resolveRemotePathExpr(cwd);
    const initCmd = `cd ${startDir} 2>/dev/null || cd "$HOME"; export TERM=xterm-256color COLUMNS=${Number(cols) || 100} LINES=${Number(rows) || 28}; exec "\${SHELL:-/bin/bash}" -l`;
    args.push(initCmd);

    const child = spawnProcess(sshBin, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    });

    const session = {
      id: termId,
      hostId: host.id,
      child,
      buffer: '',
      closed: false
    };
    terminals.set(termId, session);

    const pushChunk = chunk => {
      const text = String(chunk || '');
      session.buffer = (session.buffer + text).slice(-65536);
      onData(text);
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', pushChunk);
    child.stderr?.on('data', pushChunk);
    child.on('close', code => {
      session.closed = true;
      terminals.delete(termId);
      onExit(code ?? 0);
    });
    child.on('error', err => {
      pushChunk(`\r\n[SSH 终端错误] ${err.message}\r\n`);
      session.closed = true;
      terminals.delete(termId);
      onExit(1);
    });

    return { ok: true, termId, hostId: host.id };
  }

  function writeTerminal(termId, data) {
    const session = terminals.get(termId);
    if (!session || session.closed) throw new Error('终端会话已关闭');
    session.child.stdin?.write(String(data ?? ''));
    return { ok: true };
  }

  function closeTerminal(termId) {
    const session = terminals.get(termId);
    if (!session) return { ok: true };
    session.closed = true;
    terminals.delete(termId);
    try { session.child.stdin?.end(); } catch {}
    try { session.child.kill(); } catch {}
    return { ok: true };
  }

  function closeAll() {
    for (const id of [...terminals.keys()]) closeTerminal(id);
  }

  return {
    getStatus,
    getAllStatuses,
    testConnection,
    disconnect,
    installPublicKey,
    listDir,
    searchFiles,
    readFile,
    writeFile,
    editFile,
    runCommand,
    jobStatus,
    listJobs,
    killJob,
    gitStatus,
    gitDiff,
    transfer,
    startTerminal,
    writeTerminal,
    closeTerminal,
    closeAll
  };
}
