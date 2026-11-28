import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  ACTIVE_TARGET,
  ACTIVE_USERNAME,
  SECRET_SERVICE,
  createCredentialVault,
  decodeDarwinKeychainSecret,
  extractCredentialEmail,
  secretTargetFor,
  vaultTargetFor
} from '../lib/credential-vault.mjs';

test('vaultTargetFor validates account IDs and rejects invalid or injection-like names', () => {
  assert.equal(vaultTargetFor('acct-123_ab'), 'agy-powertools:account:acct-123_ab');
  for (const bad of ['', '   ', '../etc', 'a b', 'acct:1', 'a"b', 'x'.repeat(65)]) {
    assert.throws(() => vaultTargetFor(bad), /账号标识/);
  }
});

test('Windows credential vault passes target names via environment variables and avoids leaking secrets', () => {
  const calls = [];
  const vault = createCredentialVault({
    platform: 'win32',
    runSpawn(cmd, args, opts) {
      calls.push({ cmd, args, env: opts.env });
      const op = opts.env.AGY_CRED_OP;
      if (op === 'has' || op === 'inspect') return { status: 0, stdout: '{"ok":true,"exists":true,"bytes":512,"hash":"AABBCCDDEEFF"}\n', stderr: '' };
      if (op === 'copy') return { status: 0, stdout: '{"ok":true,"bytes":512,"hash":"AABBCCDDEEFF"}\n', stderr: '' };
      return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
  });
  assert.equal(vault.supported, true);
  assert.equal(vault.hasSaved('acct-1'), true);
  assert.deepEqual(vault.inspectSaved('acct-1'), { exists: true, hash: 'AABBCCDDEEFF' });
  assert.equal(calls[0].cmd, 'powershell.exe');
  assert.equal(calls[0].env.AGY_CRED_SRC, 'agy-powertools:account:acct-1');

  const saved = vault.saveActiveTo('acct-1');
  assert.deepEqual(saved, { ok: true, bytes: 512, hash: 'AABBCCDDEEFF' });
  assert.equal(calls[2].env.AGY_CRED_SRC, ACTIVE_TARGET);
  assert.equal(calls[2].env.AGY_CRED_DST, 'agy-powertools:account:acct-1');

  const restored = vault.restoreToActive('acct-1');
  assert.deepEqual(restored, { ok: true, bytes: 512, hash: 'AABBCCDDEEFF' });
  assert.equal(calls[3].env.AGY_CRED_SRC, 'agy-powertools:account:acct-1');
  assert.equal(calls[3].env.AGY_CRED_DST, ACTIVE_TARGET);
  assert.equal(calls[3].env.AGY_CRED_USER, ACTIVE_USERNAME);

  assert.deepEqual(vault.removeSaved('acct-1'), { ok: true });
  assert.equal(calls[4].env.AGY_CRED_OP, 'remove');
});

test('macOS and Linux credential vaults use stdin pipes for secrets and never pass tokens in CLI args', () => {
  const macCalls = [];
  const macVault = createCredentialVault({
    platform: 'darwin',
    runSpawn(cmd, args, opts) {
      macCalls.push({ cmd, args, input: opts?.input });
      if (args.includes('-w')) return { status: 0, stdout: Buffer.from('secret-refresh-token\n') };
      return { status: 0, stdout: '' };
    }
  });
  assert.equal(macVault.hasSaved('acct-mac'), true);
  const macCopy = macVault.saveActiveTo('acct-mac');
  assert.equal(macCopy.ok, true);
  assert.equal(macCalls[1].cmd, '/usr/bin/security');
  assert.equal(macCalls[2].args[0], '-i');
  assert.equal(macCalls[2].args.includes('secret-refresh-token'), false);
  assert.ok(String(macCalls[2].input).includes('agy-powertools-account'));

  const linuxCalls = [];
  const linuxVault = createCredentialVault({
    platform: 'linux',
    wsl: false,
    runSpawn(cmd, args, opts) {
      linuxCalls.push({ cmd, args, inputText: opts?.input ? Buffer.from(opts.input).toString('utf8') : '' });
      if (args[0] === 'lookup') return { status: 0, stdout: Buffer.from('linux-token') };
      return { status: 0, stdout: '' };
    }
  });
  assert.equal(linuxVault.hasSaved('acct-lin'), true);
  assert.equal(linuxVault.restoreToActive('acct-lin').ok, true);
  assert.equal(linuxCalls[2].args.includes('linux-token'), false);
  assert.equal(linuxCalls[2].inputText, 'linux-token');
});

test('credential vault extracts id_token_email and blocks mismatched writes across Linux, macOS, and Windows', () => {
  const alphaPayload = JSON.stringify({
    token: { access_token: 'tok-a', refresh_token: 'rt-a' },
    auth_method: 'consumer',
    id_token_email: 'Alpha@Example.com'
  });
  const wslEnvelope = JSON.stringify({
    v: 1,
    token: Buffer.from(alphaPayload, 'utf8').toString('base64'),
    scope: null
  });
  assert.equal(extractCredentialEmail(alphaPayload), 'alpha@example.com');
  assert.equal(extractCredentialEmail(Buffer.from(wslEnvelope, 'utf8')), 'alpha@example.com');
  assert.equal(extractCredentialEmail('opaque-non-json-token'), '');

  // Linux: inspect returns email, and mismatched saveActiveTo refuses without calling secret-tool store
  const linuxOps = [];
  const linuxVault = createCredentialVault({
    platform: 'linux',
    wsl: false,
    runSpawn(cmd, args) {
      linuxOps.push(args[0]);
      if (args[0] === 'lookup') return { status: 0, stdout: Buffer.from(alphaPayload, 'utf8') };
      return { status: 0, stdout: '' };
    }
  });
  const inspected = linuxVault.inspectActive();
  assert.equal(inspected.exists, true);
  assert.equal(inspected.email, 'alpha@example.com');
  const blocked = linuxVault.saveActiveTo('acct-beta', { expectedEmail: 'beta@example.com' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.mismatch, true);
  assert.equal(blocked.actualEmail, 'alpha@example.com');
  assert.equal(blocked.expectedEmail, 'beta@example.com');
  assert.equal(linuxOps.includes('store'), false);
  const allowed = linuxVault.saveActiveTo('acct-alpha', { expectedEmail: 'alpha@example.com' });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.email, 'alpha@example.com');
  assert.equal(linuxOps.includes('store'), true);

  // macOS: mismatched restoreToActive refuses without calling security -i
  const macOps = [];
  const macVault = createCredentialVault({
    platform: 'darwin',
    runSpawn(_cmd, args) {
      macOps.push(args[0]);
      if (args.includes('-w')) return { status: 0, stdout: Buffer.from(alphaPayload + '\n', 'utf8') };
      return { status: 0, stdout: '' };
    }
  });
  assert.equal(macVault.inspectSaved('acct-alpha').email, 'alpha@example.com');
  const macBlocked = macVault.restoreToActive('acct-beta', { expectedEmail: 'beta@example.com' });
  assert.equal(macBlocked.ok, false);
  assert.equal(macBlocked.mismatch, true);
  assert.equal(macOps.includes('-i'), false);

  // Windows: forwards AGY_CRED_EXPECTED_EMAIL (and clears inherited value when omitted) and surfaces mismatch JSON cleanly
  const winEnvs = [];
  const winVault = createCredentialVault({
    platform: 'win32',
    env: { AGY_CRED_EXPECTED_EMAIL: 'stale@example.com' },
    runSpawn(_cmd, _args, opts) {
      winEnvs.push(opts.env);
      if (opts.env.AGY_CRED_OP === 'inspect') {
        return { status: 0, stdout: '{"ok":true,"exists":true,"bytes":128,"hash":"AABBCCDDEEFF","email":"alpha@example.com"}\n', stderr: '' };
      }
      return {
        status: 1,
        stdout: '{"ok":false,"mismatch":true,"actualEmail":"alpha@example.com","expectedEmail":"beta@example.com","error":"credential email mismatch"}\n',
        stderr: ''
      };
    }
  });
  assert.deepEqual(winVault.inspectSaved('acct-alpha'), { exists: true, hash: 'AABBCCDDEEFF', email: 'alpha@example.com' });
  assert.equal(winEnvs[0].AGY_CRED_EXPECTED_EMAIL, '');
  const winBlocked = winVault.saveActiveTo('acct-beta', { expectedEmail: 'Beta@Example.com' });
  assert.equal(winBlocked.ok, false);
  assert.equal(winBlocked.mismatch, true);
  assert.equal(winBlocked.actualEmail, 'alpha@example.com');
  assert.equal(winBlocked.expectedEmail, 'beta@example.com');
  assert.equal(winEnvs[1].AGY_CRED_EXPECTED_EMAIL, 'beta@example.com');
});

test('Windows PowerShell WIN32_SCRIPT compiles Add-Type and extracts id_token_email across direct JSON, decoy keys, and WSL envelopes', { skip: process.platform !== 'win32' }, () => {
  let capturedScript = '';
  const probeVault = createCredentialVault({
    platform: 'linux',
    wsl: true,
    runSpawn(cmd, args, opts) {
      capturedScript = args[args.indexOf('-Command') + 1];
      return spawnSync(cmd, args, { ...opts, timeout: 20000 });
    }
  });
  const probed = probeVault.probe({ force: true });
  assert.equal(probed.supported, true, `WIN32_SCRIPT probe failed: ${probed.reason}`);
  assert.ok(capturedScript.includes('class AgyWinCred'));

  const endMatch = capturedScript.match(/^"@/m);
  assert.ok(endMatch && typeof endMatch.index === 'number');
  const addTypeBlock = capturedScript.slice(0, endMatch.index + endMatch[0].length);
  const directPayload = JSON.stringify({
    token: { access_token: 'tok-a', refresh_token: 'rt-a' },
    id_token_email: 'Alpha@Example.com'
  });
  const decoyPayload = JSON.stringify({
    note: 'id_token_email',
    other: 'decoy@example.com',
    id_token_email: 'Real@Example.com'
  });
  const wslEnvelope = JSON.stringify({
    v: 1,
    token: Buffer.from('\uFEFF' + JSON.stringify({ id_token_email: 'Beta@Example.com' }), 'utf16le').toString('base64'),
    scope: null
  });
  const verifyScript = [
    addTypeBlock,
    '$cases = @($env:AGY_TEST_C1, $env:AGY_TEST_C2, $env:AGY_TEST_C3, $env:AGY_TEST_C4)',
    '$out = foreach ($c in $cases) { [AgyWinCred]::ExtractEmail([Convert]::FromBase64String($c)) }',
    'Write-Output ($out -join "|")'
  ].join('\n');
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', verifyScript],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      env: {
        ...process.env,
        AGY_TEST_C1: Buffer.from('\uFEFF' + directPayload, 'utf16le').toString('base64'),
        AGY_TEST_C2: Buffer.from(decoyPayload, 'utf8').toString('base64'),
        AGY_TEST_C3: Buffer.from(wslEnvelope, 'utf16le').toString('base64'),
        AGY_TEST_C4: Buffer.from('opaque-non-json-token').toString('base64')
      }
    }
  );
  assert.equal(res.status, 0, res.stderr || res.error?.message || 'powershell failed');
  const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
  assert.equal(line, 'alpha@example.com|real@example.com|beta@example.com|');
});

test('macOS credential vault decodes security -w hex output for non-ASCII/multiline secrets without double-hex corruption', () => {
  const utf8MultilineCred = JSON.stringify({
    token: { access_token: 'ya29.abc', refresh_token: '1//rt-alpha' },
    display_name: '张三 · José',
    id_token_email: 'Alice@Example.com'
  }, null, 2) + '\n';
  const expectedBuf = Buffer.from(utf8MultilineCred, 'utf8');
  const singleHex = expectedBuf.toString('hex');

  // Direct helper unit checks
  assert.deepEqual(decodeDarwinKeychainSecret(Buffer.from(singleHex + '\n', 'utf8')), expectedBuf);
  assert.equal(decodeDarwinKeychainSecret(Buffer.from('plain-ascii-token\n', 'utf8')).toString('utf8'), 'plain-ascii-token');
  // Literal ASCII lowercase hex strings must NOT be mis-decoded as raw bytes
  assert.equal(decodeDarwinKeychainSecret(Buffer.from('deadbeef0123456789abcdef01234567\n', 'utf8')).toString('utf8'), 'deadbeef0123456789abcdef01234567');
  assert.equal(decodeDarwinKeychainSecret(Buffer.from('61626364\n', 'utf8')).toString('utf8'), '61626364');

  // Simulate real macOS `/usr/bin/security` behavior:
  // - `add-generic-password ... -X <hex>` stores decoded raw bytes
  // - `find-generic-password ... -w` emits raw bytes if all bytes are 0x20..0x7e, otherwise lowercase hex
  const keychain = new Map([['gemini::antigravity', Buffer.from(expectedBuf)]]);
  const writeCommands = [];
  const vault = createCredentialVault({
    platform: 'darwin',
    runSpawn(cmd, args, opts) {
      assert.equal(cmd, '/usr/bin/security');
      if (args[0] === 'find-generic-password') {
        const service = args[args.indexOf('-s') + 1];
        const account = args[args.indexOf('-a') + 1];
        const key = `${service}::${account}`;
        if (!keychain.has(key)) return { status: 44, stdout: Buffer.alloc(0), stderr: 'could not be found' };
        if (!args.includes('-w')) return { status: 0, stdout: Buffer.alloc(0), stderr: '' };
        const raw = keychain.get(key);
        const allPrintableAscii = raw.every(b => b >= 0x20 && b <= 0x7e);
        const out = allPrintableAscii ? Buffer.concat([raw, Buffer.from('\n')]) : Buffer.from(raw.toString('hex') + '\n', 'utf8');
        return { status: 0, stdout: out, stderr: '' };
      }
      if (args[0] === '-i') {
        const line = String(opts?.input || '').trim();
        writeCommands.push(line);
        const m = line.match(/^add-generic-password -U -s "([^"]+)" -a "([^"]+)" -X ([0-9a-f]+)$/);
        assert.ok(m, `unexpected security -i command: ${line}`);
        keychain.set(`${m[1]}::${m[2]}`, Buffer.from(m[3], 'hex'));
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    }
  });

  // 1. inspectActive decodes hex, extracts id_token_email, and hashes original bytes
  const activeInfo = vault.inspectActive();
  assert.equal(activeInfo.exists, true);
  assert.equal(activeInfo.email, 'alice@example.com');

  // 2. Mismatch guard still works when active secret is hex-encoded by security -w
  const blocked = vault.saveActiveTo('acct-other', { expectedEmail: 'other@example.com' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.mismatch, true);
  assert.equal(blocked.actualEmail, 'alice@example.com');
  assert.equal(writeCommands.length, 0);

  // 3. saveActiveTo writes single hex (NOT double hex) and returns exact byte count & hash
  const saved = vault.saveActiveTo('acct-alice', { expectedEmail: 'alice@example.com' });
  assert.equal(saved.ok, true);
  assert.equal(saved.bytes, expectedBuf.length);
  assert.equal(saved.hash, activeInfo.hash);
  assert.equal(saved.email, 'alice@example.com');
  assert.ok(writeCommands[0].endsWith(` -X ${singleHex}`), 'must write single-encoded hex, not double-encoded');
  assert.deepEqual(keychain.get('agy-powertools-account::acct-alice'), expectedBuf);

  // 4. inspectSaved & restoreToActive round-trip preserves exact bytes without double-hex corruption
  const savedInfo = vault.inspectSaved('acct-alice');
  assert.equal(savedInfo.exists, true);
  assert.equal(savedInfo.hash, activeInfo.hash);
  assert.equal(savedInfo.email, 'alice@example.com');

  keychain.set('gemini::antigravity', Buffer.from('{"id_token_email":"beta@example.com"}', 'utf8'));
  const restored = vault.restoreToActive('acct-alice', { expectedEmail: 'alice@example.com' });
  assert.equal(restored.ok, true);
  assert.equal(restored.bytes, expectedBuf.length);
  assert.equal(restored.hash, activeInfo.hash);
  assert.equal(restored.email, 'alice@example.com');
  assert.deepEqual(keychain.get('gemini::antigravity'), expectedBuf);
});

test('Windows inspect distinguishes missing slots from native and subprocess failures', () => {
  const outputs = [
    { status: 0, stdout: '{"ok":true,"exists":false,"status":"missing","hash":""}' },
    { status: 1, stdout: '{"ok":false,"status":"error","win32Error":5,"error":"read failed: 5"}' },
    { status: 1, stdout: '{"ok":true,"exists":false,"status":"missing"}', stderr: 'PowerShell failed' },
    new Error('PowerShell unavailable')
  ];
  const vault = createCredentialVault({
    platform: 'win32',
    runSpawn() {
      const result = outputs.shift();
      if (result instanceof Error) throw result;
      return result;
    }
  });
  assert.deepEqual(vault.inspectSaved('acct-1'), { exists: false, hash: '', status: 'missing' });
  assert.deepEqual(vault.inspectSaved('acct-1'), { exists: false, status: 'error', error: 'read failed: 5', win32Error: 5 });
  assert.deepEqual(vault.inspectActive(), { exists: false, status: 'error', error: 'PowerShell failed' });
  assert.deepEqual(vault.inspectActive(), { exists: false, status: 'error', error: 'PowerShell unavailable' });
});

test('credential email extraction accepts UTF-8 BOM and UTF-16LE envelopes and tokens', () => {
  const json = JSON.stringify({ id_token_email: 'Alpha@Example.com' });
  assert.equal(extractCredentialEmail(Buffer.from('\uFEFF' + json)), 'alpha@example.com');
  assert.equal(extractCredentialEmail(Buffer.from(json, 'utf16le')), 'alpha@example.com');
  const envelope = JSON.stringify({ token: Buffer.from('\uFEFF' + json, 'utf16le').toString('base64') });
  assert.equal(extractCredentialEmail(Buffer.from(envelope, 'utf16le')), 'alpha@example.com');
});

test('generic secret storage uses isolated agy-max-secret namespace and handles read/write/delete & locked keychains', () => {
  assert.equal(SECRET_SERVICE, 'agy-max-secret');
  const t1 = secretTargetFor('ai-provider:prov_123');
  assert.match(t1, /^agy-max-secret:[a-f0-9]{32}$/);
  assert.match(secretTargetFor('ai-provider:prov_123', { wslDistro: 'Ubuntu-24.04' }), /^agy-max-secret:wsl:Ubuntu-24\.04:[a-f0-9]{32}$/);
  assert.throws(() => secretTargetFor(''), /凭据标识/);
  assert.throws(() => secretTargetFor('bad\nkey'), /凭据标识/);

  const macStore = new Map();
  const macVault = createCredentialVault({
    platform: 'darwin',
    runSpawn(cmd, args, opts) {
      if (cmd === '/usr/bin/security' && args[0] === '-i') {
        const m = String(opts?.input || '').match(/-s "([^"]+)" -a "([^"]+)" -X ([0-9a-f]+)/);
        if (m) macStore.set(`${m[1]}::${m[2]}`, Buffer.from(m[3], 'hex').toString('utf8'));
        return { status: 0, stdout: '', stderr: '' };
      }
      if (cmd === '/usr/bin/security' && args[0] === 'find-generic-password') {
        const key = `${args[2]}::${args[4]}`;
        if (!macStore.has(key)) return { status: 44, stdout: '', stderr: 'could not be found' };
        return { status: 0, stdout: Buffer.from(macStore.get(key) + '\n', 'utf8'), stderr: '' };
      }
      if (cmd === '/usr/bin/security' && args[0] === 'delete-generic-password') {
        macStore.delete(`${args[2]}::${args[4]}`);
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    }
  });

  assert.equal(macVault.readSecret('ai-provider:p1').exists, false);
  assert.equal(macVault.writeSecret('ai-provider:p1', 'sk-live-secret-999').ok, true);
  const readBack = macVault.readSecret('ai-provider:p1');
  assert.equal(readBack.ok, true);
  assert.equal(readBack.exists, true);
  assert.equal(readBack.value, 'sk-live-secret-999');
  assert.equal(macVault.deleteSecret('ai-provider:p1').ok, true);
  assert.equal(macVault.readSecret('ai-provider:p1').exists, false);

  const lockedVault = createCredentialVault({
    platform: 'darwin',
    runSpawn() {
      return { status: 36, stdout: '', stderr: 'User interaction is not allowed (-25308)' };
    }
  });
  const lockedRead = lockedVault.readSecret('ai-provider:p1');
  assert.equal(lockedRead.ok, false);
  assert.equal(lockedRead.available, false);
  assert.equal(lockedRead.reason, 'vault-unavailable');
});
