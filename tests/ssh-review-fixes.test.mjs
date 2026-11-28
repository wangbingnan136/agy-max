import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSshProjectsStore } from '../lib/ssh-projects.mjs';
import { evaluateSshBoundaryHook } from '../lib/ssh-boundary.mjs';
import { createSshRunner } from '../lib/ssh-runner.mjs';
import { createSshCredentialVault } from '../lib/ssh-vault.mjs';
import { createCredentialVault } from '../lib/credential-vault.mjs';
import { collectSavedCredentialIds, purgeSavedCredentials } from '../lib/ssh-uninstall-credentials.mjs';

function makeFakeVault({ removeOk = true } = {}) {
  const map = new Map();
  return {
    supported: true,
    map,
    savePassword(id, pw) { map.set(id, pw); return { ok: true }; },
    readPassword(id) { return { ok: true, exists: map.has(id), password: map.get(id) || '' }; },
    hasPassword(id) { return map.has(id); },
    removePassword(id) {
      if (!removeOk) return { ok: false, error: 'keychain locked' };
      map.delete(id);
      return { ok: true };
    }
  };
}

function makeMockSpawn(handler) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () => queueMicrotask(() => {
      const res = handler({ cmd, args }) || { code: 0 };
      if (res.stdout) child.stdout.emit('data', Buffer.from(res.stdout, 'utf8'));
      if (res.stderr) child.stderr.emit('data', Buffer.from(res.stderr, 'utf8'));
      child.emit('close', res.code ?? 0);
    });
    child.kill = () => {};
    calls.push({ cmd, args, opts });
    return child;
  };
  fn.calls = calls;
  return fn;
}

function makeFixture() {
  const tmp = mkdtempSync(join(tmpdir(), 'agy-ssh-review-'));
  const fakeHome = join(tmp, 'home');
  const artifactDir = join(tmp, 'artifacts');
  mkdirSync(artifactDir, { recursive: true });
  const store = createSshProjectsStore({ dataDir: join(tmp, 'data'), home: fakeHome, vault: makeFakeVault() });
  const host = store.upsertHost({ name: 'gpu-box', host: '10.0.0.9', user: 'root', port: 22, authType: 'key' });
  const proj = store.createProject({ name: 'exp', hostId: host.id, remoteDir: '/root/exp' });
  const pre = (name, args = {}, opts = {}) => evaluateSshBoundaryHook({
    hookEventName: 'PreToolUse', cwd: proj.proxyWorkspaceDir, artifactDirectoryPath: artifactDir, toolCall: { name, args }
  }, { home: fakeHome, ...opts });
  return { tmp, fakeHome, artifactDir, proj, pre, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

test('unknown local tools are allowed only when every path they name is inside an allowed location', () => {
  const f = makeFixture();
  try {
    const inside = join(f.proj.proxyWorkspaceDir, 'a.txt');
    assert.deepEqual(f.pre('copy_things', { path: inside }), { decision: 'allow' });
    assert.deepEqual(f.pre('copy_things', { path: inside, destination: join(f.artifactDir, 'b.txt') }), { decision: 'allow' });
    // a second location in a non path-named or nested argument no longer rides along
    assert.equal(f.pre('copy_things', { path: inside, destination: '/etc/cron.d/x' }).decision, 'deny');
    assert.equal(f.pre('copy_things', { path: inside, options: { target: '/Users/me/.ssh/id_rsa' } }).decision, 'deny');
    assert.equal(f.pre('copy_things', { path: inside, extra: ['file:///etc/hosts'] }).decision, 'deny');
    // ~ means the user's home, never a folder inside the proxy workspace
    assert.equal(f.pre('copy_things', { path: '~/.ssh/id_rsa' }).decision, 'deny');
    assert.equal(f.pre('view_file', { AbsolutePath: '~/.ssh/id_rsa' }).decision, 'deny');
    // still: no path at all asks; third-party MCP tools keep their default allow
    assert.equal(f.pre('copy_things', { Mode: 'fast' }).decision, 'ask');
    assert.deepEqual(f.pre('mcp_gdrive_upload', { path: '/Users/me/report.pdf' }), { decision: 'allow' });
    // known tools keep their arg-name based checks (free text is not a path)
    assert.deepEqual(f.pre('search_web', { query: '/etc/passwd meaning' }), { decision: 'allow' });
  } finally { f.cleanup(); }
});

test('with ssh-remote uninstalled the boundary still blocks but points at reinstalling the module', () => {
  const f = makeFixture();
  try {
    const missing = f.pre('run_command', { CommandLine: 'ls' }, { sshToolsAvailable: false });
    assert.equal(missing.decision, 'deny');
    assert.match(missing.reason, /SSH 远端工程 \/ SSH Projects/);
    assert.doesNotMatch(missing.reason, /ssh_run_command|ssh_transfer/);
    const read = f.pre('view_file', { AbsolutePath: '/etc/hosts' }, { sshToolsAvailable: false });
    assert.equal(read.decision, 'deny');
    assert.doesNotMatch(read.reason, /ssh_read_file/);
    const write = f.pre('write_to_file', { TargetFile: '/tmp/x' }, { sshToolsAvailable: false });
    assert.doesNotMatch(write.reason, /ssh_write_file/);
    const start = evaluateSshBoundaryHook({ hookEventName: 'SessionStart', cwd: f.proj.proxyWorkspaceDir }, { home: f.fakeHome, sshToolsAvailable: false });
    const text = start.injectSteps[0].systemMessage.systemMessage;
    assert.match(text, /重新安装/);
    assert.doesNotMatch(text, /ssh_run_command|ssh_transfer/);
    // empty fake home: no module manifest, no SSH data there, so the tools count as missing
    assert.doesNotMatch(f.pre('run_command', { CommandLine: 'ls' }).reason, /ssh_run_command/);
    // module present: the usual ssh_* guidance
    assert.match(f.pre('run_command', { CommandLine: 'ls' }, { sshToolsAvailable: true }).reason, /ssh_run_command/);
  } finally { f.cleanup(); }
});

test('ssh runner never retries once the remote command may have started', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agy-ssh-retry-'));
  try {
    const store = createSshProjectsStore({ dataDir: join(tmp, 'data'), home: join(tmp, 'home'), vault: makeFakeVault() });
    const host = store.upsertHost({ name: 'gpu', host: '10.0.0.8', user: 'root', port: 2222, authType: 'key' });
    const runnerWith = spawnProcess => createSshRunner({ store, spawnProcess, platform: 'darwin', env: {}, home: join(tmp, 'home'), retryDelayMs: 0 });
    const markerOf = args => String(args.at(-1)).match(/__AGY_BEGIN_[0-9a-f]+__/)[0];

    // Dropped mid-command: our start marker already came back, so no second run.
    const midCommand = makeMockSpawn(({ args }) => ({ code: 255, stdout: `${markerOf(args)}\npartial\n`, stderr: 'Connection reset by 10.0.0.8 port 2222\r\n' }));
    await assert.rejects(runnerWith(midCommand).testConnection(host.id), /命令可能已开始执行/);
    assert.equal(midCommand.calls.length, 1);

    // A bare reset without handshake evidence is ambiguous (marker may be lost in flight): no retry.
    const bare = makeMockSpawn(() => ({ code: 255, stderr: 'Connection reset by 10.0.0.8 port 2222\r\n' }));
    await assert.rejects(runnerWith(bare).testConnection(host.id));
    assert.equal(bare.calls.length, 1);

    // Handshake text but the marker was seen: still never retried.
    const late = makeMockSpawn(({ args }) => ({ code: 255, stdout: `${markerOf(args)}\n`, stderr: 'kex_exchange_identification: read: Connection reset by peer\n' }));
    await assert.rejects(runnerWith(late).testConnection(host.id));
    assert.equal(late.calls.length, 1);

    // A pre-auth handshake drop is still retried once.
    const handshake = makeMockSpawn(() => ({ code: 255, stderr: 'kex_exchange_identification: Connection closed by remote host\nConnection closed by 10.0.0.8 port 2222\n' }));
    await assert.rejects(runnerWith(handshake).testConnection(host.id), /握手被中途断开/);
    assert.equal(handshake.calls.length, 2);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('a host record is dropped only after its saved password is really deleted', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agy-ssh-del-'));
  try {
    const vault = makeFakeVault({ removeOk: false });
    const store = createSshProjectsStore({ dataDir: join(tmp, 'data'), home: join(tmp, 'home'), vault });
    const host = store.upsertHost({ name: 'pw', host: '10.0.0.7', user: 'root', authType: 'password', password: 'secret' });
    assert.throws(() => store.deleteHost(host.id), /keychain locked/);
    assert.ok(store.getHost(host.id), 'record kept so the secret is not orphaned');
    assert.throws(() => store.upsertHost({ id: host.id, name: 'pw', host: '10.0.0.7', user: 'root', authType: 'password', clearPassword: true }), /keychain locked/);
    assert.equal(store.getHost(host.id).hasPassword, true);
    // a key-only host never had a secret: a flaky keychain must not block removing it
    const keyHost = store.upsertHost({ name: 'key', host: '10.0.0.6', user: 'root', authType: 'key' });
    assert.equal(store.deleteHost(keyHost.id).deleted, true);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('keychain deletes report failure; exit 44 / secret-tool 1 mean already absent', () => {
  const statusSpawn = status => () => ({ status, stdout: '', stderr: '' });
  const macAccounts = code => createCredentialVault({ platform: 'darwin', wsl: false, runSpawn: statusSpawn(code) });
  assert.deepEqual(macAccounts(0).removeSaved('acc-1'), { ok: true });
  assert.deepEqual(macAccounts(44).removeSaved('acc-1'), { ok: true, status: 'missing' });
  const failed = macAccounts(51).removeSaved('acc-1');
  assert.equal(failed.ok, false);
  assert.match(failed.error, /51/);

  const macSsh = code => createSshCredentialVault({ platform: 'darwin', runSpawn: statusSpawn(code) });
  assert.equal(macSsh(44).removePassword('host-1').ok, true);
  assert.equal(macSsh(51).removePassword('host-1').ok, false);
  const linuxSsh = code => createSshCredentialVault({ platform: 'linux', runSpawn: statusSpawn(code) });
  assert.equal(linuxSsh(1).removePassword('host-1').ok, true);
  assert.equal(linuxSsh(2).removePassword('host-1').ok, false);
});

test('full CLI uninstall removes saved account backups and SSH passwords, best effort', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agy-uninstall-creds-'));
  try {
    mkdirSync(join(tmp, 'ssh-projects'), { recursive: true });
    writeFileSync(join(tmp, 'accounts.json'), JSON.stringify({ activeId: 'a1', accounts: [{ id: 'a1' }, { id: 'a2' }] }));
    writeFileSync(join(tmp, 'ssh-projects', 'hosts.json'), JSON.stringify({ format: 1, hosts: { 'host-1': {}, 'host-2': {} } }));
    const ids = collectSavedCredentialIds(tmp);
    assert.deepEqual(ids, { accounts: ['a1', 'a2'], sshHosts: ['host-1', 'host-2'] });

    const gone = [];
    const accountsVault = { removeSaved: id => { if (id === 'a2') throw new Error('locked'); gone.push(id); return { ok: true }; } };
    const sshVault = { removePassword: id => (id === 'host-2' ? { ok: false, error: 'denied' } : (gone.push(id), { ok: true })) };
    const res = await purgeSavedCredentials(ids, { accountsVault, sshVault });
    assert.deepEqual(gone, ['a1', 'host-1']);
    assert.equal(res.removed, 2);
    assert.deepEqual(res.failures.map(x => `${x.kind}:${x.id}:${x.error}`), ['account:a2:locked', 'ssh-host:host-2:denied']);

    assert.deepEqual(collectSavedCredentialIds(join(tmp, 'nothing-here')), { accounts: [], sshHosts: [] });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
