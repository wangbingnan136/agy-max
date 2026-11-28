import { existsSync, readFileSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import tls from 'node:tls';

export const DEFAULT_PROXY_BYPASS = 'localhost,127.0.0.1,::1,[::1]';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:']);
const UNSAFE_CHARS = /[\x00-\x1f\x7f\s'"`\\;$|&<>]/;
const UNSAFE_BYPASS_CHARS = /[\x00-\x1f\x7f'"`\\$|&<>]/;
const REQUIRED_LOOPBACK = DEFAULT_PROXY_BYPASS.split(',');

export function normalizeProxyUrl(raw = '') {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > 256 || UNSAFE_CHARS.test(trimmed)) return null;
  let parsed;
  try { parsed = new URL(trimmed); } catch { return null; }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  if (!parsed.hostname) return null;
  if (parsed.pathname && parsed.pathname !== '/') return null;
  if (parsed.search || parsed.hash) return null;
  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return null;
  }
  const auth = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
    : '';
  const host = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[')
    ? `[${parsed.hostname}]`
    : parsed.hostname;
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${auth}${host}${port}`;
}

export function maskProxyUrl(raw = '') {
  const normalized = normalizeProxyUrl(raw);
  if (!normalized) return String(raw || '').trim();
  try {
    const parsed = new URL(normalized);
    if (!parsed.username && !parsed.password) return normalized;
    const host = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[')
      ? `[${parsed.hostname}]`
      : parsed.hostname;
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//***@${host}${port}`;
  } catch {
    return normalized;
  }
}

export function isValidProxyUrl(raw = '') {
  if (typeof raw !== 'string') return false;
  if (!raw.trim()) return true;
  return normalizeProxyUrl(raw) !== null;
}

export function normalizeProxyBypass(raw = '') {
  if (typeof raw !== 'string') return null;
  if (raw.length > 512 || UNSAFE_BYPASS_CHARS.test(raw)) return null;
  const parts = raw
    .split(/[,;\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
  const seen = new Set();
  const ordered = [];
  const push = item => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return;
    seen.add(key);
    ordered.push(item);
  };
  for (const required of REQUIRED_LOOPBACK) push(required);
  for (const part of parts) push(part);
  return ordered.join(',');
}

export function isValidProxyBypass(raw = '') {
  return normalizeProxyBypass(raw) !== null;
}

export function chromiumProxyArgs(spec) {
  if (!spec?.enabled || !spec.url) return [];
  const parsed = new URL(spec.url);
  // Chromium expects socks5:// (remote DNS by default) and does not recognize socks5h://.
  const scheme = parsed.protocol === 'socks5h:' ? 'socks5:' : parsed.protocol;
  const host = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[')
    ? `[${parsed.hostname}]`
    : parsed.hostname;
  const port = parsed.port ? `:${parsed.port}` : '';
  const server = `${scheme}//${host}${port}`;
  const bypassItems = (spec.bypass || DEFAULT_PROXY_BYPASS)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => (item === '::1' ? '[::1]' : item));
  return [
    `--proxy-server=${server}`,
    `--proxy-bypass-list=${[...new Set(bypassItems)].join(';')}`
  ];
}

export function proxySpecFromSettings(settings = {}) {
  const url = normalizeProxyUrl(settings.proxyUrl || '') || '';
  const bypass = normalizeProxyBypass(settings.proxyBypass ?? DEFAULT_PROXY_BYPASS) || DEFAULT_PROXY_BYPASS;
  const forceHttp1 = Boolean(settings.proxyForceHttp1);
  const enabled = Boolean(settings.proxyEnabled && url);
  const specKey = enabled ? `${url}|${bypass}|${forceHttp1 ? 'h1' : 'auto'}` : '';
  return {
    enabled,
    url,
    displayUrl: maskProxyUrl(url),
    bypass,
    forceHttp1,
    specKey
  };
}

function hasHttp2ClientDisabled(godebug = '') {
  return String(godebug || '')
    .split(',')
    .map(token => token.trim())
    .includes('http2client=0');
}

export function inspectProxyRuntime(settings = {}, env = process.env) {
  const spec = proxySpecFromSettings(settings);
  const managedSpec = typeof env?.AGY_POWERTOOLS_PROXY_SPEC === 'string'
    ? env.AGY_POWERTOOLS_PROXY_SPEC.trim()
    : '';
  const rawRunningUrl = env?.HTTPS_PROXY || env?.https_proxy || env?.HTTP_PROXY || env?.http_proxy || env?.ALL_PROXY || env?.all_proxy || '';
  const activeUrl = normalizeProxyUrl(rawRunningUrl) || '';
  const activeForceHttp1 = hasHttp2ClientDisabled(env?.GODEBUG || '');
  const managedByPowertools = Boolean(managedSpec);

  if (!spec.enabled) {
    if (managedByPowertools) {
      return {
        configured: false,
        configuredUrl: spec.url,
        configuredDisplayUrl: spec.displayUrl,
        configuredBypass: spec.bypass,
        configuredForceHttp1: spec.forceHttp1,
        active: Boolean(activeUrl),
        activeUrl,
        activeDisplayUrl: maskProxyUrl(activeUrl),
        activeForceHttp1,
        managedByPowertools: true,
        mismatch: true,
        reason: 'needs-disable'
      };
    }
    return {
      configured: false,
      configuredUrl: spec.url,
      configuredDisplayUrl: spec.displayUrl,
      configuredBypass: spec.bypass,
      configuredForceHttp1: spec.forceHttp1,
      active: Boolean(activeUrl),
      activeUrl,
      activeDisplayUrl: maskProxyUrl(activeUrl),
      activeForceHttp1,
      managedByPowertools: false,
      mismatch: false,
      reason: 'disabled'
    };
  }

  const exactManagedMatch = managedByPowertools && managedSpec === spec.specKey;
  const activeBypass = normalizeProxyBypass(env?.no_proxy || env?.NO_PROXY || '');
  const bypassMatches = activeBypass !== null
    && activeBypass.toLowerCase().split(',').sort().join(',') === spec.bypass.toLowerCase().split(',').sort().join(',');
  const envMatch = Boolean(activeUrl) && activeUrl === spec.url && bypassMatches && (!spec.forceHttp1 || activeForceHttp1);

  if (exactManagedMatch || (!managedByPowertools && envMatch)) {
    return {
      configured: true,
      configuredUrl: spec.url,
      configuredDisplayUrl: spec.displayUrl,
      configuredBypass: spec.bypass,
      configuredForceHttp1: spec.forceHttp1,
      active: true,
      activeUrl: activeUrl || spec.url,
      activeDisplayUrl: maskProxyUrl(activeUrl || spec.url),
      activeForceHttp1: managedByPowertools ? spec.forceHttp1 : activeForceHttp1,
      managedByPowertools,
      mismatch: false,
      reason: 'active'
    };
  }

  const reason = managedByPowertools || activeUrl ? 'config-changed' : 'not-applied';
  return {
    configured: true,
    configuredUrl: spec.url,
    configuredDisplayUrl: spec.displayUrl,
    configuredBypass: spec.bypass,
    configuredForceHttp1: spec.forceHttp1,
    active: Boolean(activeUrl),
    activeUrl,
    activeDisplayUrl: maskProxyUrl(activeUrl),
    activeForceHttp1,
    managedByPowertools,
    mismatch: true,
    reason
  };
}

function defaultPortForProtocol(protocol) {
  if (protocol === 'https:') return 443;
  if (protocol === 'socks5:' || protocol === 'socks5h:') return 1080;
  return 80;
}

export function checkProxyPortOpen(rawUrl, timeoutMs = 800) {
  const normalized = normalizeProxyUrl(rawUrl);
  if (!normalized) {
    return Promise.resolve({ ok: false, reachable: false, error: '代理地址格式无效' });
  }
  const parsed = new URL(normalized);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const port = parsed.port ? Number(parsed.port) : defaultPortForProtocol(parsed.protocol);
  const startedAt = Date.now();

  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ...result, latencyMs: Date.now() - startedAt, host, port });
    };
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, reachable: true }));
    socket.once('timeout', () => finish({ ok: false, reachable: false, error: `代理端口 ${host}:${port} 连接超时，请确认代理软件已启动` }));
    socket.once('error', err => finish({ ok: false, reachable: false, error: `代理端口 ${host}:${port} 无法连接（${err.code || err.message}），请确认代理软件已启动` }));
  });
}

function probeHttpConnect(parsed, { host, port, targetHost, targetPort, timeoutMs }) {
  return new Promise(resolve => {
    let settled = false;
    const startedAt = Date.now();
    const finish = result => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ...result, latencyMs: Date.now() - startedAt });
    };
    const connectOpts = { host, port };
    const socket = parsed.protocol === 'https:'
      ? tls.connect({ ...connectOpts, servername: host })
      : net.createConnection(connectOpts);
    socket.setTimeout(timeoutMs);

    const onConnected = () => {
      const headers = [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`,
        'Proxy-Connection: keep-alive'
      ];
      if (parsed.username || parsed.password) {
        const creds = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
        headers.push(`Proxy-Authorization: Basic ${Buffer.from(creds, 'utf8').toString('base64')}`);
      }
      socket.write(headers.join('\r\n') + '\r\n\r\n');
    };

    if (parsed.protocol === 'https:') socket.once('secureConnect', onConnected);
    else socket.once('connect', onConnected);

    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString('latin1');
      const idx = buffer.indexOf('\r\n');
      if (idx === -1) {
        if (buffer.length > 4096) finish({ ok: false, reachable: true, tunnelOk: false, error: '代理返回了无效的响应头' });
        return;
      }
      const statusLine = buffer.slice(0, idx).trim();
      const match = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})(?:\s+(.*))?$/i);
      if (!match) {
        finish({ ok: false, reachable: true, tunnelOk: false, error: `代理响应异常：${statusLine.slice(0, 64)}` });
        return;
      }
      const code = Number(match[1]);
      if (code >= 200 && code < 300) {
        finish({ ok: true, reachable: true, tunnelOk: true, statusCode: code });
      } else if (code === 407) {
        finish({ ok: false, reachable: true, tunnelOk: false, statusCode: code, error: '代理需要身份验证（HTTP 407）' });
      } else {
        finish({ ok: false, reachable: true, tunnelOk: false, statusCode: code, error: `代理拒绝转发目标地址（HTTP ${code}）` });
      }
    });

    socket.once('timeout', () => finish({ ok: false, reachable: false, tunnelOk: false, error: `代理连接超时（${host}:${port}）` }));
    socket.once('error', err => finish({ ok: false, reachable: false, tunnelOk: false, error: `无法连接代理 ${host}:${port}（${err.code || err.message}）` }));
    socket.once('end', () => finish({ ok: false, reachable: true, tunnelOk: false, error: '代理提前断开了连接' }));
  });
}

function probeSocks5Connect(parsed, { host, port, targetHost, targetPort, timeoutMs }) {
  return new Promise(resolve => {
    let settled = false;
    const startedAt = Date.now();
    const hasAuth = Boolean(parsed.username || parsed.password);
    const finish = result => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ...result, latencyMs: Date.now() - startedAt });
    };
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);

    let stage = 'greeting';
    let buf = Buffer.alloc(0);

    const sendConnect = () => {
      stage = 'connect';
      const domainBytes = Buffer.from(targetHost, 'ascii');
      const req = Buffer.alloc(7 + domainBytes.length);
      req[0] = 0x05;
      req[1] = 0x01; // CONNECT
      req[2] = 0x00;
      req[3] = 0x03; // DOMAINNAME
      req[4] = domainBytes.length;
      domainBytes.copy(req, 5);
      req.writeUInt16BE(targetPort, 5 + domainBytes.length);
      socket.write(req);
    };

    socket.once('connect', () => {
      const methods = hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
      socket.write(methods);
    });

    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greeting' && buf.length >= 2) {
        const ver = buf[0], method = buf[1];
        buf = buf.subarray(2);
        if (ver !== 0x05) {
          finish({ ok: false, reachable: true, tunnelOk: false, error: '目标端口不是有效的 SOCKS5 代理' });
          return;
        }
        if (method === 0x00) {
          sendConnect();
        } else if (method === 0x02 && hasAuth) {
          stage = 'auth';
          const u = Buffer.from(decodeURIComponent(parsed.username), 'utf8');
          const p = Buffer.from(decodeURIComponent(parsed.password), 'utf8');
          const authBuf = Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]);
          socket.write(authBuf);
        } else {
          finish({ ok: false, reachable: true, tunnelOk: false, error: 'SOCKS5 代理需要用户名密码认证或不支持当前认证方式' });
          return;
        }
      }
      if (stage === 'auth' && buf.length >= 2) {
        const status = buf[1];
        buf = buf.subarray(2);
        if (status !== 0x00) {
          finish({ ok: false, reachable: true, tunnelOk: false, error: 'SOCKS5 代理认证失败' });
          return;
        }
        sendConnect();
      }
      if (stage === 'connect' && buf.length >= 4) {
        const ver = buf[0], rep = buf[1];
        if (ver !== 0x05) {
          finish({ ok: false, reachable: true, tunnelOk: false, error: 'SOCKS5 代理返回格式异常' });
          return;
        }
        if (rep === 0x00) {
          finish({ ok: true, reachable: true, tunnelOk: true });
        } else {
          finish({ ok: false, reachable: true, tunnelOk: false, error: `SOCKS5 转发失败（错误码 0x${rep.toString(16).padStart(2, '0')}）` });
        }
      }
    });

    socket.once('timeout', () => finish({ ok: false, reachable: false, tunnelOk: false, error: `代理连接超时（${host}:${port}）` }));
    socket.once('error', err => finish({ ok: false, reachable: false, tunnelOk: false, error: `无法连接代理 ${host}:${port}（${err.code || err.message}）` }));
    socket.once('end', () => finish({ ok: false, reachable: true, tunnelOk: false, error: 'SOCKS5 代理提前断开了连接' }));
  });
}

export async function probeProxyConnectivity(rawUrl, {
  timeoutMs = 4500,
  targetHost = 'daily-cloudcode-pa.googleapis.com',
  targetPort = 443
} = {}) {
  const normalized = normalizeProxyUrl(rawUrl);
  if (!normalized) {
    return { ok: false, reachable: false, tunnelOk: false, error: '代理地址无效，请使用 http://、https:// 或 socks5:// 开头', url: '' };
  }
  const parsed = new URL(normalized);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const port = parsed.port ? Number(parsed.port) : defaultPortForProtocol(parsed.protocol);
  const res = parsed.protocol === 'socks5:' || parsed.protocol === 'socks5h:'
    ? await probeSocks5Connect(parsed, { host, port, targetHost, targetPort, timeoutMs })
    : await probeHttpConnect(parsed, { host, port, targetHost, targetPort, timeoutMs });
  return { ...res, url: maskProxyUrl(normalized) };
}

const CROSS_ORIGIN_STRIP_HEADERS = new Set([
  'authorization',
  'x-goog-api-key',
  'ocp-apim-subscription-key',
  'ocp-apim-subscription-region',
  'x-api-key',
  'api-key',
  'cookie',
  'proxy-authorization'
]);

function ipv4ToInt(ip) {
  const raw = String(ip || '');
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = ((value << 8) | n) >>> 0;
  }
  return value >>> 0;
}

function globMatchesHost(pattern, host) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(host);
}

export function shouldBypassProxy(url, bypassCsv = DEFAULT_PROXY_BYPASS) {
  let parsed;
  try {
    parsed = url instanceof URL ? url : new URL(String(url));
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')) {
    return true;
  }
  const targetPort = parsed.port ? String(parsed.port) : (parsed.protocol === 'http:' ? '80' : '443');
  const rules = String(bypassCsv || '')
    .split(/[,;\s]+/)
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  for (const rawRule of rules) {
    if (rawRule === '*') return true;
    let ruleHost = rawRule;
    let rulePort = '';
    if (!ruleHost.includes('/')) {
      const m = ruleHost.match(/^(\[[^\]]+\]|[^:]+):(\d{1,5})$/);
      if (m) {
        ruleHost = m[1];
        rulePort = m[2];
      }
    }
    ruleHost = ruleHost.replace(/^\[|\]$/g, '');
    if (!ruleHost) continue;
    if (rulePort && rulePort !== targetPort) continue;
    if (ruleHost.includes('/')) {
      const segments = ruleHost.split('/');
      if (segments.length !== 2) continue;
      const [base, prefixStr] = segments;
      if (!/^\d{1,2}$/.test(prefixStr)) continue;
      const prefix = Number(prefixStr);
      const targetInt = ipv4ToInt(host);
      const baseInt = ipv4ToInt(base);
      if (targetInt !== null && baseInt !== null && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) {
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        if ((targetInt & mask) === (baseInt & mask)) return true;
      }
      continue;
    }
    if (ruleHost.startsWith('*.')) {
      const suffix = ruleHost.slice(2);
      if (suffix && host.endsWith(`.${suffix}`)) return true;
      continue;
    }
    if (ruleHost.startsWith('.')) {
      const suffix = ruleHost.slice(1);
      if (suffix && (host === suffix || host.endsWith(`.${suffix}`))) return true;
      continue;
    }
    if (ruleHost.includes('*')) {
      if (globMatchesHost(ruleHost, host)) return true;
      continue;
    }
    if (host === ruleHost) return true;
  }
  return false;
}

export function resolveEffectiveProxyConfig({ home = homedir(), env = process.env, dataDir } = {}) {
  try {
    const resolvedDataDir = dataDir || join(home, '.gemini', 'antigravity', 'plugin_data', 'agy-max');
    const settingsPath = join(resolvedDataDir, 'settings.json');
    if (existsSync(settingsPath)) {
      const saved = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (saved?.proxyEnabled && saved?.proxyUrl) {
        const normalized = normalizeProxyUrl(saved.proxyUrl);
        if (normalized) {
          return {
            proxyUrl: normalized,
            bypass: normalizeProxyBypass(saved.proxyBypass ?? DEFAULT_PROXY_BYPASS) || DEFAULT_PROXY_BYPASS
          };
        }
      }
    }
  } catch {}
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const raw = env?.[key];
    if (typeof raw === 'string' && raw.trim()) {
      const normalized = normalizeProxyUrl(raw);
      if (normalized) {
        const envBypass = typeof env?.NO_PROXY === 'string' && env.NO_PROXY.trim()
          ? env.NO_PROXY
          : (typeof env?.no_proxy === 'string' && env.no_proxy.trim() ? env.no_proxy : DEFAULT_PROXY_BYPASS);
        return {
          proxyUrl: normalized,
          bypass: normalizeProxyBypass(envBypass) || `${DEFAULT_PROXY_BYPASS},${envBypass}`
        };
      }
    }
  }
  return { proxyUrl: '', bypass: DEFAULT_PROXY_BYPASS };
}

export function resolveEffectiveProxyUrl({ home = homedir(), env = process.env, dataDir } = {}) {
  return resolveEffectiveProxyConfig({ home, env, dataDir }).proxyUrl;
}

function openHttpConnectTunnel(parsedProxy, { host, port, targetHost, targetPort, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('已取消'));
      return;
    }
    let settled = false;
    const socket = parsedProxy.protocol === 'https:'
      ? tls.connect({ host, port, servername: host })
      : net.createConnection({ host, port });
    const onAbort = () => done(signal.reason || new Error('已取消'));
    const done = (err, sock) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (err) { try { socket.destroy(); } catch {} reject(err); }
      else resolve(sock);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(timeoutMs);
    const onConnected = () => {
      const lines = [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`,
        'Proxy-Connection: keep-alive'
      ];
      if (parsedProxy.username || parsedProxy.password) {
        const creds = `${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password)}`;
        lines.push(`Proxy-Authorization: Basic ${Buffer.from(creds, 'utf8').toString('base64')}`);
      }
      socket.write(lines.join('\r\n') + '\r\n\r\n');
    };
    if (parsedProxy.protocol === 'https:') socket.once('secureConnect', onConnected);
    else socket.once('connect', onConnected);
    let headerBuf = Buffer.alloc(0);
    const onData = chunk => {
      headerBuf = Buffer.concat([headerBuf, chunk]);
      const endIdx = headerBuf.indexOf('\r\n\r\n');
      if (endIdx === -1) {
        if (headerBuf.length > 8192) done(new Error('代理响应头过大'));
        return;
      }
      socket.off('data', onData);
      const statusLine = headerBuf.subarray(0, headerBuf.indexOf('\r\n')).toString('latin1').trim();
      const match = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})/i);
      const code = match ? Number(match[1]) : 0;
      if (code < 200 || code >= 300) {
        done(new Error(`代理拒绝连接 (HTTP ${code || 'invalid'})`));
        return;
      }
      const leftover = headerBuf.subarray(endIdx + 4);
      if (leftover.length) socket.unshift(leftover);
      socket.setTimeout(0);
      done(null, socket);
    };
    socket.on('data', onData);
    socket.once('timeout', () => done(new Error('代理连接超时')));
    socket.once('error', err => done(err));
    socket.once('end', () => done(new Error('代理提前断开连接')));
  });
}

function openSocks5Tunnel(parsedProxy, { host, port, targetHost, targetPort, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('已取消'));
      return;
    }
    let settled = false;
    const hasAuth = Boolean(parsedProxy.username || parsedProxy.password);
    const socket = net.createConnection({ host, port });
    const onAbort = () => done(signal.reason || new Error('已取消'));
    const done = (err, sock) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (err) { try { socket.destroy(); } catch {} reject(err); }
      else resolve(sock);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(timeoutMs);
    let stage = 'greeting';
    let buf = Buffer.alloc(0);
    const sendConnect = () => {
      stage = 'connect';
      const domain = Buffer.from(targetHost, 'ascii');
      const req = Buffer.alloc(7 + domain.length);
      req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x03; req[4] = domain.length;
      domain.copy(req, 5);
      req.writeUInt16BE(targetPort, 5 + domain.length);
      socket.write(req);
    };
    socket.once('connect', () => {
      socket.write(hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
    });
    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greeting' && buf.length >= 2) {
        const ver = buf[0], method = buf[1];
        buf = buf.subarray(2);
        if (ver !== 0x05) { done(new Error('SOCKS5 代理响应无效')); return; }
        if (method === 0x00) sendConnect();
        else if (method === 0x02 && hasAuth) {
          stage = 'auth';
          const u = Buffer.from(decodeURIComponent(parsedProxy.username), 'utf8');
          const p = Buffer.from(decodeURIComponent(parsedProxy.password), 'utf8');
          socket.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
        } else { done(new Error('SOCKS5 代理认证方式不支持')); return; }
      }
      if (stage === 'auth' && buf.length >= 2) {
        const status = buf[1];
        buf = buf.subarray(2);
        if (status !== 0x00) { done(new Error('SOCKS5 代理认证失败')); return; }
        sendConnect();
      }
      if (stage === 'connect' && buf.length >= 4) {
        if (buf[0] !== 0x05 || buf[1] !== 0x00) { done(new Error(`SOCKS5 转发失败 (0x${buf[1].toString(16)})`)); return; }
        const atyp = buf[3];
        const needed = atyp === 1 ? 10 : atyp === 4 ? 22 : atyp === 3 ? (buf.length >= 5 ? 7 + buf[4] : 999) : 999;
        if (buf.length < needed) return;
        const leftover = buf.subarray(needed);
        socket.off('data', onData);
        if (leftover.length) socket.unshift(leftover);
        socket.setTimeout(0);
        done(null, socket);
      }
    };
    socket.on('data', onData);
    socket.once('timeout', () => done(new Error('SOCKS5 代理超时')));
    socket.once('error', err => done(err));
    socket.once('end', () => done(new Error('SOCKS5 代理提前断开')));
  });
}

function toRequestBodyBuffer(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8');
  return Buffer.from(String(body), 'utf8');
}

function normalizeRequestHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function' && typeof headers.entries === 'function') {
    for (const [k, v] of headers.entries()) {
      if (v !== undefined && v !== null) out[String(k)] = String(v);
    }
    return out;
  }
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (Array.isArray(entry) && entry.length >= 2 && entry[1] !== undefined && entry[1] !== null) {
        out[String(entry[0])] = String(entry[1]);
      }
    }
    return out;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

function decorateProxyHeaders(rawHeaders) {
  const headers = { ...(rawHeaders || {}) };
  const getVal = name => {
    const key = String(name || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(headers, key)) return null;
    const v = headers[key];
    if (v === undefined) return null;
    return Array.isArray(v) ? v.join(', ') : String(v);
  };
  Object.defineProperties(headers, {
    get: { value: getVal, enumerable: false, configurable: true },
    has: { value: name => getVal(name) !== null, enumerable: false, configurable: true },
    getSetCookie: {
      value() {
        const v = headers['set-cookie'];
        return Array.isArray(v) ? [...v] : (typeof v === 'string' ? [v] : []);
      },
      enumerable: false,
      configurable: true
    },
    entries: {
      value: function* () {
        for (const [k, v] of Object.entries(headers)) {
          yield [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')];
        }
      },
      enumerable: false,
      configurable: true
    },
    keys: {
      value: function* () {
        for (const k of Object.keys(headers)) yield k;
      },
      enumerable: false,
      configurable: true
    },
    values: {
      value: function* () {
        for (const [, v] of headers.entries()) yield v;
      },
      enumerable: false,
      configurable: true
    },
    forEach: {
      value(cb, thisArg) {
        for (const [k, v] of headers.entries()) cb.call(thisArg, v, k, headers);
      },
      enumerable: false,
      configurable: true
    },
    [Symbol.iterator]: {
      value() { return headers.entries(); },
      enumerable: false,
      configurable: true
    }
  });
  return headers;
}

function toWebBodyStream(res, tlsSocket) {
  const webBody = Readable.toWeb(res);
  Object.defineProperties(webBody, {
    destroyed: {
      get: () => Boolean(res.destroyed || tlsSocket.destroyed),
      enumerable: false,
      configurable: true
    },
    socket: {
      get: () => res.socket || tlsSocket,
      enumerable: false,
      configurable: true
    }
  });
  return webBody;
}

export async function httpsRequestThroughProxy(targetUrl, proxyUrl, {
  method = 'GET',
  headers = {},
  body = undefined,
  redirect = 'follow',
  timeoutMs = 45000,
  signal,
  maxRedirects = 6,
  tlsOptions
} = {}) {
  const parsedProxy = new URL(proxyUrl);
  const proxyHost = parsedProxy.hostname.replace(/^\[|\]$/g, '');
  const proxyPort = parsedProxy.port ? Number(parsedProxy.port) : defaultPortForProtocol(parsedProxy.protocol);
  let currentUrl = String(targetUrl);
  let reqMethod = String(method || 'GET').toUpperCase();
  let reqHeaders = normalizeRequestHeaders(headers);
  let bodyBuf = ['GET', 'HEAD'].includes(reqMethod) ? null : toRequestBodyBuffer(body);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (signal?.aborted) throw (signal.reason || new Error('已取消'));
    const parsedTarget = new URL(currentUrl);
    if (parsedTarget.protocol !== 'https:') {
      const err = new Error('仅支持 HTTPS 地址');
      err.noFallback = true;
      throw err;
    }
    const targetHost = parsedTarget.hostname.replace(/^\[|\]$/g, '');
    const targetPort = parsedTarget.port ? Number(parsedTarget.port) : 443;
    const rawSocket = (parsedProxy.protocol === 'socks5:' || parsedProxy.protocol === 'socks5h:')
      ? await openSocks5Tunnel(parsedProxy, { host: proxyHost, port: proxyPort, targetHost, targetPort, timeoutMs, signal })
      : await openHttpConnectTunnel(parsedProxy, { host: proxyHost, port: proxyPort, targetHost, targetPort, timeoutMs, signal });
    if (signal?.aborted) {
      try { rawSocket.destroy(); } catch {}
      throw (signal.reason || new Error('已取消'));
    }
    const tlsSocket = tls.connect({ ...(tlsOptions || {}), socket: rawSocket, servername: targetHost });
    await new Promise((resolve, reject) => {
      let settled = false;
      const onTlsErr = err => {
        cleanup();
        try { tlsSocket.destroy(); } catch {}
        if (!settled) { settled = true; reject(err); }
      };
      const onSecureConnect = () => {
        cleanup();
        tlsSocket.off('error', onTlsErr);
        if (!settled) { settled = true; resolve(); }
      };
      const onAbort = () => {
        cleanup();
        try { tlsSocket.destroy(); } catch {}
        if (!settled) { settled = true; reject(signal.reason || new Error('已取消')); }
      };
      const timer = setTimeout(() => {
        cleanup();
        try { tlsSocket.destroy(); } catch {}
        if (!settled) { settled = true; reject(new Error('TLS 握手超时')); }
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        tlsSocket.off('secureConnect', onSecureConnect);
      };
      tlsSocket.once('error', onTlsErr);
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      tlsSocket.once('secureConnect', onSecureConnect);
    });
    const agent = new https.Agent({ keepAlive: false });
    agent.createConnection = () => tlsSocket;
    let req;
    let resRef = null;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      signal?.removeEventListener('abort', onAbort);
      try { agent.destroy(); } catch {}
    };
    const onAbort = () => {
      const err = signal.reason || new Error('请求超时');
      if (resRef && !resRef.destroyed) {
        try { resRef.destroy(err); } catch {}
      }
      try { req?.destroy(err); } catch {}
      try { tlsSocket.destroy(); } catch {}
      cleanup();
    };
    const outHeaders = { ...reqHeaders };
    const hasHeader = name => Object.keys(outHeaders).some(k => k.toLowerCase() === name);
    if (!hasHeader('user-agent')) outHeaders['User-Agent'] = 'agy-max';
    if (!hasHeader('connection')) outHeaders.Connection = 'close';
    if (bodyBuf !== null && !hasHeader('content-length') && !hasHeader('transfer-encoding')) {
      outHeaders['Content-Length'] = String(bodyBuf.length);
    }
    const res = await new Promise((resolve, reject) => {
      let settled = false;
      req = https.request({
        hostname: targetHost,
        port: targetPort,
        path: parsedTarget.pathname + parsedTarget.search,
        method: reqMethod,
        headers: outHeaders,
        agent
      });
      req.on('error', err => {
        cleanup();
        try { tlsSocket.destroy(); } catch {}
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      req.once('response', response => {
        resRef = response;
        response.once('error', cleanup);
        if (!settled) {
          settled = true;
          resolve(response);
        }
      });
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
      if (bodyBuf && bodyBuf.length) req.write(bodyBuf);
      req.end();
    });
    const status = res.statusCode || 0;
    if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirect !== 'manual') {
      res.resume();
      cleanup();
      try { tlsSocket.destroy(); } catch {}
      if (redirect === 'error') {
        const err = new Error('不允许重定向');
        err.noFallback = true;
        throw err;
      }
      const nextUrl = new URL(res.headers.location, currentUrl);
      if (nextUrl.origin !== parsedTarget.origin) {
        for (const k of Object.keys(reqHeaders)) {
          if (CROSS_ORIGIN_STRIP_HEADERS.has(k.toLowerCase())) {
            delete reqHeaders[k];
          }
        }
      }
      if ((status === 303 && reqMethod !== 'GET' && reqMethod !== 'HEAD') || ([301, 302].includes(status) && reqMethod === 'POST')) {
        reqMethod = 'GET';
        bodyBuf = null;
        for (const k of Object.keys(reqHeaders)) {
          if (['content-length', 'content-type', 'content-encoding', 'content-language', 'content-location'].includes(k.toLowerCase())) {
            delete reqHeaders[k];
          }
        }
      }
      currentUrl = nextUrl.toString();
      continue;
    }
    res.once('end', () => {
      cleanup();
      try { tlsSocket.end(); } catch {}
    });
    res.once('close', () => {
      cleanup();
      if (!res.complete) {
        try { tlsSocket.destroy(); } catch {}
      }
    });
    const respHeaders = decorateProxyHeaders(res.headers);
    const bodyStream = toWebBodyStream(res, tlsSocket);
    let consumed = false;
    const readAllBuffer = async () => {
      consumed = true;
      const chunks = [];
      for await (const chunk of bodyStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    };
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: res.statusMessage || '',
      url: currentUrl,
      headers: respHeaders,
      body: bodyStream,
      get bodyUsed() {
        return consumed || bodyStream.locked;
      },
      async arrayBuffer() {
        const buf = await readAllBuffer();
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      },
      async text() {
        return (await readAllBuffer()).toString('utf8');
      },
      async json() {
        return JSON.parse(await this.text());
      }
    };
  }
  const err = new Error('重定向次数过多');
  err.noFallback = true;
  throw err;
}

export async function httpsGetThroughProxy(targetUrl, proxyUrl, options = {}) {
  return httpsRequestThroughProxy(targetUrl, proxyUrl, { ...options, method: 'GET' });
}

export function createProxyFetcher({
  home = homedir(),
  env = process.env,
  dataDir,
  fallback,
  tlsOptions,
  strictProxy = false,
  proxyUrl: explicitProxyUrl,
  bypass: explicitBypass
} = {}) {
  const directFetch = typeof fallback === 'function'
    ? fallback
    : (...args) => globalThis.fetch(...args);
  return async (url, options = {}) => {
    const resolved = explicitProxyUrl !== undefined
      ? {
          proxyUrl: normalizeProxyUrl(explicitProxyUrl) || '',
          bypass: explicitBypass ?? DEFAULT_PROXY_BYPASS
        }
      : resolveEffectiveProxyConfig({ home, env, dataDir });
    const proxyUrl = resolved.proxyUrl;
    const bypass = explicitBypass !== undefined ? explicitBypass : resolved.bypass;
    const effectiveStrict = Boolean(options.strictProxy ?? strictProxy);
    if (proxyUrl && /^https:/i.test(String(url)) && !shouldBypassProxy(url, bypass)) {
      try {
        return await httpsRequestThroughProxy(url, proxyUrl, {
          method: options.method || 'GET',
          headers: options.headers,
          body: options.body,
          redirect: options.redirect || 'follow',
          timeoutMs: options.timeoutMs || 45000,
          signal: options.signal,
          tlsOptions
        });
      } catch (proxyErr) {
        if (effectiveStrict || options.signal?.aborted || proxyErr?.noFallback) throw proxyErr;
        try { return await directFetch(url, options); } catch { throw proxyErr; }
      }
    }
    return directFetch(url, options);
  };
}
