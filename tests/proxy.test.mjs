import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PROXY_BYPASS,
  checkProxyPortOpen,
  chromiumProxyArgs,
  createProxyFetcher,
  inspectProxyRuntime,
  isValidProxyBypass,
  isValidProxyUrl,
  maskProxyUrl,
  normalizeProxyBypass,
  normalizeProxyUrl,
  probeProxyConnectivity,
  proxySpecFromSettings,
  resolveEffectiveProxyConfig,
  shouldBypassProxy
} from '../lib/proxy.mjs';

function listenTcp(onConnection) {
  return new Promise((resolve, reject) => {
    const server = net.createServer(onConnection);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise(done => server.close(() => done()))
      });
    });
  });
}

test('normalizeProxyUrl, normalizeProxyBypass, and chromiumProxyArgs sanitize safely and reject injections', () => {
  assert.equal(normalizeProxyUrl('http://127.0.0.1:7897/'), 'http://127.0.0.1:7897');
  assert.equal(normalizeProxyUrl('socks5h://127.0.0.1:1080'), 'socks5h://127.0.0.1:1080');
  assert.equal(normalizeProxyUrl('http://user:pass@127.0.0.1:7890'), 'http://user:pass@127.0.0.1:7890');
  assert.equal(maskProxyUrl('http://user:secret@127.0.0.1:7890'), 'http://***@127.0.0.1:7890');
  assert.equal(maskProxyUrl('http://127.0.0.1:7897'), 'http://127.0.0.1:7897');
  assert.equal(isValidProxyUrl(''), true);

  for (const bad of [
    'ftp://127.0.0.1:21',
    'http://127.0.0.1:7897/path',
    'http://127.0.0.1:7897?a=1',
    'http://127.0.0.1:7897;calc',
    'http://127.0.0.1:7897" --foo',
    'http://127.0.0.1:99999',
    'not a url'
  ]) {
    assert.equal(isValidProxyUrl(bad), false, `expected invalid: ${bad}`);
  }

  assert.equal(normalizeProxyBypass('192.168.0.0/16; .internal.local, localhost'), 'localhost,127.0.0.1,::1,[::1],192.168.0.0/16,.internal.local');
  assert.equal(isValidProxyBypass('localhost,127.0.0.1,::1'), true);
  assert.equal(normalizeProxyBypass('[::1],::1,[::1]'), DEFAULT_PROXY_BYPASS);
  assert.equal(isValidProxyBypass('localhost"$(whoami)'), false);

  const spec = proxySpecFromSettings({
    proxyEnabled: true,
    proxyUrl: 'socks5h://127.0.0.1:7897/',
    proxyBypass: '10.0.0.0/8',
    proxyForceHttp1: true
  });
  assert.equal(spec.enabled, true);
  assert.equal(spec.bypass, `${DEFAULT_PROXY_BYPASS},10.0.0.0/8`);
  assert.deepEqual(chromiumProxyArgs(spec), [
    '--proxy-server=socks5://127.0.0.1:7897',
    '--proxy-bypass-list=localhost;127.0.0.1;[::1];10.0.0.0/8'
  ]);
});

test('inspectProxyRuntime classifies disabled, not-applied, active, config-changed, and needs-disable states', () => {
  const off = inspectProxyRuntime({ proxyEnabled: false, proxyUrl: '' }, {});
  assert.equal(off.reason, 'disabled');
  assert.equal(off.mismatch, false);

  // External OS proxy while plugin proxy is disabled must not trigger needs-disable prompt
  const osProxy = inspectProxyRuntime({ proxyEnabled: false, proxyUrl: '' }, { HTTPS_PROXY: 'http://127.0.0.1:7890' });
  assert.equal(osProxy.reason, 'disabled');
  assert.equal(osProxy.mismatch, false);

  // Cold start without proxy env while plugin proxy is enabled
  const cold = inspectProxyRuntime({ proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: false }, {});
  assert.equal(cold.reason, 'not-applied');
  assert.equal(cold.mismatch, true);

  // Active managed session matches exactly
  const spec = proxySpecFromSettings({ proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: true });
  const active = inspectProxyRuntime(
    { proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: true },
    { HTTPS_PROXY: 'http://127.0.0.1:7897', GODEBUG: 'http2client=0', AGY_POWERTOOLS_PROXY_SPEC: spec.specKey }
  );
  assert.equal(active.reason, 'active');
  assert.equal(active.mismatch, false);

  // User changes proxy port or HTTP/1.1 toggle
  const changed = inspectProxyRuntime(
    { proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7898', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: true },
    { HTTPS_PROXY: 'http://127.0.0.1:7897', GODEBUG: 'http2client=0', AGY_POWERTOOLS_PROXY_SPEC: spec.specKey }
  );
  assert.equal(changed.reason, 'config-changed');
  assert.equal(changed.mismatch, true);

  // User turns proxy off while current window is still running Powertools proxy
  const needsDisable = inspectProxyRuntime(
    { proxyEnabled: false, proxyUrl: 'http://127.0.0.1:7897', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: false },
    { HTTPS_PROXY: 'http://127.0.0.1:7897', AGY_POWERTOOLS_PROXY_SPEC: spec.specKey }
  );
  assert.equal(needsDisable.reason, 'needs-disable');
  assert.equal(needsDisable.mismatch, true);
});

test('probeProxyConnectivity verifies HTTP CONNECT, HTTP 407, SOCKS5 handshake, and closed ports', async () => {
  // 1. Mock HTTP CONNECT proxy returning 200
  const seenRequests = [];
  const httpProxy = await listenTcp(socket => {
    socket.once('data', chunk => {
      const req = chunk.toString('utf8');
      seenRequests.push(req);
      if (req.includes('Basic dXNlcjpwYXNz')) {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      } else if (req.includes('407.test')) {
        socket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      } else {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      }
    });
  });

  // 2. Mock SOCKS5 proxy returning success
  const socksProxy = await listenTcp(socket => {
    let step = 0;
    socket.on('data', chunk => {
      if (step === 0 && chunk[0] === 0x05) {
        step = 1;
        socket.write(Buffer.from([0x05, 0x00]));
      } else if (step === 1 && chunk[0] === 0x05 && chunk[1] === 0x01) {
        step = 2;
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));
      }
    });
  });

  // 3. Allocate a closed loopback port
  const temp = await listenTcp(() => {});
  const closedPort = temp.port;
  await temp.close();

  try {
    const okHttp = await probeProxyConnectivity(`http://user:pass@127.0.0.1:${httpProxy.port}`, { targetHost: 'example.com', targetPort: 443 });
    assert.equal(okHttp.ok, true);
    assert.equal(okHttp.tunnelOk, true);
    assert.equal(okHttp.url, `http://***@127.0.0.1:${httpProxy.port}`);
    assert.ok(seenRequests[0].includes('CONNECT example.com:443 HTTP/1.1'));
    assert.ok(seenRequests[0].includes('Proxy-Authorization: Basic dXNlcjpwYXNz'));

    const authFail = await probeProxyConnectivity(`http://127.0.0.1:${httpProxy.port}`, { targetHost: '407.test', targetPort: 443 });
    assert.equal(authFail.ok, false);
    assert.equal(authFail.reachable, true);
    assert.ok(authFail.error.includes('407'));

    const okSocks = await probeProxyConnectivity(`socks5://127.0.0.1:${socksProxy.port}`, { targetHost: 'example.com', targetPort: 443 });
    assert.equal(okSocks.ok, true);
    assert.equal(okSocks.tunnelOk, true);

    const closed = await checkProxyPortOpen(`http://127.0.0.1:${closedPort}`, 500);
    assert.equal(closed.ok, false);
    assert.equal(closed.reachable, false);
  } finally {
    await httpProxy.close();
    await socksProxy.close();
  }
});

test('external proxy must match the configured bypass list', () => {
  const proxyUrl = 'http://proxy.example';
  const settings = { proxyEnabled: true, proxyUrl, proxyBypass: '.internal.example,example.test' };
  const matching = { HTTPS_PROXY: proxyUrl, no_proxy: 'EXAMPLE.TEST;[::1];.internal.example' };
  assert.equal(inspectProxyRuntime(settings, matching).reason, 'active');
  const different = { ...matching, no_proxy: '.internal.example' };
  assert.equal(inspectProxyRuntime(settings, different).reason, 'config-changed');
});

test('shouldBypassProxy, resolveEffectiveProxyConfig, and createProxyFetcher respect agy-max dataDir, CIDR/glob rules, and abort/strict modes', async () => {
  assert.equal(shouldBypassProxy('https://localhost:8443/v1', DEFAULT_PROXY_BYPASS), true);
  assert.equal(shouldBypassProxy('https://10.20.30.40/api', '10.0.0.0/8,*.corp.local'), true);
  assert.equal(shouldBypassProxy('https://sub.corp.local/models', '10.0.0.0/8,*.corp.local'), true);
  assert.equal(shouldBypassProxy('https://api.openai.com/v1/models', '10.0.0.0/8,*.corp.local'), false);
  assert.equal(shouldBypassProxy('https://internal.dev:8443/v1', 'internal.dev:8443'), true);
  assert.equal(shouldBypassProxy('https://internal.dev:443/v1', 'internal.dev:8443'), false);

  const dir = mkdtempSync(join(tmpdir(), 'agy-proxy-cfg-'));
  try {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      proxyEnabled: true,
      proxyUrl: 'http://127.0.0.1:7897/',
      proxyBypass: '192.168.0.0/16'
    }));
    const resolved = resolveEffectiveProxyConfig({ dataDir: dir, env: { HTTPS_PROXY: 'http://127.0.0.1:9999' } });
    assert.equal(resolved.proxyUrl, 'http://127.0.0.1:7897');
    assert.ok(resolved.bypass.includes('192.168.0.0/16'));

    const closed = await listenTcp(() => {});
    const closedPort = closed.port;
    await closed.close();

    // Non-strict fetcher falls back to direct fallback when proxy port is down
    let fallbackCalls = 0;
    const lenient = createProxyFetcher({
      proxyUrl: `http://127.0.0.1:${closedPort}`,
      strictProxy: false,
      fallback: async url => {
        fallbackCalls++;
        return { ok: true, status: 200, url };
      }
    });
    const res = await lenient('https://api.openai.com/v1/models');
    assert.equal(res.ok, true);
    assert.equal(fallbackCalls, 1);

    // Strict fetcher rejects instead of leaking direct traffic
    const strict = createProxyFetcher({
      proxyUrl: `http://127.0.0.1:${closedPort}`,
      strictProxy: true,
      fallback: async () => ({ ok: true, status: 200 })
    });
    await assert.rejects(() => strict('https://api.openai.com/v1/models'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
