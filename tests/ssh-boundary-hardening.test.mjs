import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createSshProjectsStore, SSH_PROJECT_MARKER, sshProjectMarkerFileExists } from '../lib/ssh-projects.mjs';
import { evaluateSshBoundaryHook } from '../lib/ssh-boundary.mjs';
import { failClosedResult, probeSshMarker, runHook } from '../scripts/ssh-boundary-hook.mjs';

const repoRoot = join(import.meta.dirname, '..');

function makeFakeVault() {
  const map = new Map();
  return {
    supported: true,
    savePassword(id, pw) { map.set(id, pw); return { ok: true }; },
    readPassword(id) { return { ok: true, exists: map.has(id), password: map.get(id) || '' }; },
    hasPassword(id) { return map.has(id); },
    removePassword(id) { map.delete(id); return { ok: true }; }
  };
}

function makeFixture({ scope = { mode: 'all' } } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'agy-ssh-hardening-'));
  const fakeHome = join(tmp, 'home');
  const artifactDir = join(tmp, 'artifacts');
  mkdirSync(artifactDir, { recursive: true });
  const store = createSshProjectsStore({ dataDir: join(tmp, 'data'), home: fakeHome, vault: makeFakeVault() });
  const host = store.upsertHost({ name: 'gpu-box', host: '10.0.0.9', user: 'root', port: 22, authType: 'key' });
  const proj = store.createProject({ name: 'exp', hostId: host.id, remoteDir: '/root/exp', capabilityScope: scope });
  const pre = (name, args = {}, extra = {}) => evaluateSshBoundaryHook({
    hookEventName: 'PreToolUse', cwd: proj.proxyWorkspaceDir, artifactDirectoryPath: artifactDir, toolCall: { name, args }, ...extra
  }, { home: fakeHome });
  return { tmp, fakeHome, artifactDir, proj, pre, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function runLoader(env, payload, cwd = tmpdir()) {
  const cfg = JSON.parse(readFileSync(join(repoRoot, 'hooks.json'), 'utf8'));
  const command = cfg['agy-max-ssh-boundary'].PreToolUse[0].hooks[0].command;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, { shell: true, cwd, env: { ...process.env, AGY_PLUGIN_ROOT: '', ...env } });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', rejectPromise);
    child.on('close', () => {
      try { resolvePromise(JSON.parse(out.trim().split('\n').pop())); } catch (error) { rejectPromise(new Error(`bad hook output: ${out}`)); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

test('allowlist: path-bearing tools are path-checked regardless of their name', () => {
  const f = makeFixture();
  try {
    assert.equal(f.pre('list_dir', { DirectoryPath: '/etc' }).decision, 'deny');
    assert.equal(f.pre('list_directory', { path: '/etc' }).decision, 'deny');
    assert.equal(f.pre('grep_search', { SearchPath: '/Users', Query: 'token' }).decision, 'deny');
    assert.equal(f.pre('find_by_name', { SearchDirectory: '/' }).decision, 'deny');
    assert.equal(f.pre('codebase_search', { Query: 'x', TargetDirectories: ['/opt/secret'] }).decision, 'deny');
    assert.equal(f.pre('view_file_outline', { AbsolutePath: '/etc/passwd' }).decision, 'deny');
    assert.equal(f.pre('some_future_reader', { FilePath: '/etc/passwd' }).decision, 'deny');
    assert.equal(f.pre('view_file', { AbsolutePath: 'file:///etc/hosts' }).decision, 'deny');
    assert.equal(f.pre('view_file', { AbsolutePath: '../../../../../../etc/hosts' }).decision, 'deny');
    // reads inside the conversation artifact dir and the proxy workspace stay allowed
    assert.deepEqual(f.pre('list_dir', { DirectoryPath: f.artifactDir }), { decision: 'allow' });
    assert.deepEqual(f.pre('list_dir', { DirectoryPath: f.proj.proxyWorkspaceDir }), { decision: 'allow' });
  } finally { f.cleanup(); }
});

test('allowlist: writes need a verifiable target inside the artifact dir', () => {
  const f = makeFixture();
  try {
    assert.equal(f.pre('write_to_file', { TargetFile: join(f.tmp, 'outside.txt') }).decision, 'deny');
    assert.equal(f.pre('delete_file', { Path: join(f.proj.proxyWorkspaceDir, SSH_PROJECT_MARKER) }).decision, 'deny');
    assert.equal(f.pre('edit_file', {}).decision, 'deny');
    assert.deepEqual(f.pre('write_to_file', { TargetFile: join(f.artifactDir, 'plan.md') }), { decision: 'allow' });
    assert.equal(f.pre('send_command_input', { CommandId: '1', Input: 'rm -rf /' }).decision, 'deny');
  } finally { f.cleanup(); }
});

test('allowlist: unclassified tools without paths ask instead of silently allowing', () => {
  const f = makeFixture();
  try {
    const verdict = f.pre('totally_new_tool', { Mode: 'fast' });
    assert.equal(verdict.decision, 'ask');
    assert.match(verdict.reason, /totally_new_tool/);
    assert.deepEqual(f.pre('search_web', { query: 'pytorch' }), { decision: 'allow' });
    assert.deepEqual(f.pre('update_focus', { focus: 'Checking remote training logs' }), { decision: 'allow' });
    assert.deepEqual(f.pre('update_steps', { steps: [{ title: 'Check GPU', status: 'in_progress' }] }), { decision: 'allow' });
    assert.deepEqual(f.pre('ask_question', { questions: [] }), { decision: 'allow' });
    assert.deepEqual(f.pre('search_marketplace', { queries: ['ssh'] }), { decision: 'allow' });
    assert.deepEqual(f.pre('list_plugin_accounts', {}), { decision: 'allow' });
    assert.deepEqual(f.pre('browser_navigate', { Url: 'https://example.com' }), { decision: 'allow' });
    assert.deepEqual(f.pre('mcp_agy-ssh-projects_ssh_list_dir', { projectId: f.proj.id, path: '/root' }), { decision: 'allow' });
    // outside SSH projects nothing changes
    assert.deepEqual(evaluateSshBoundaryHook({ hookEventName: 'PreToolUse', cwd: f.tmp, toolCall: { name: 'totally_new_tool', args: {} } }, { home: f.fakeHome }), { decision: 'allow' });
  } finally { f.cleanup(); }
});

test('fail-closed: errors deny inside SSH projects and allow elsewhere', async () => {
  const f = makeFixture();
  try {
    const boom = new Error('boom');
    const inside = failClosedResult('PreToolUse', { cwd: f.proj.proxyWorkspaceDir }, boom);
    assert.equal(inside.decision, 'deny');
    assert.match(inside.reason, /boom/);
    assert.deepEqual(failClosedResult('PreToolUse', { cwd: f.tmp }, boom), { decision: 'allow' });
    assert.deepEqual(failClosedResult('SessionStart', { cwd: f.proj.proxyWorkspaceDir }, boom), {});

    // a corrupt marker still counts as an SSH project
    const corrupt = join(f.tmp, 'corrupt');
    mkdirSync(corrupt);
    writeFileSync(join(corrupt, SSH_PROJECT_MARKER), '{not json');
    assert.deepEqual(probeSshMarker({ cwd: corrupt }), { projectId: '' });
    assert.equal(failClosedResult('PreToolUse', { cwd: corrupt }, boom).decision, 'deny');

    // unparseable payload asks; well-formed payloads go through the real evaluator
    assert.equal((await runHook('{oops', 'PreToolUse')).decision, 'ask');
    assert.deepEqual(await runHook('{oops', 'SessionStart'), {});
    const denied = await runHook(JSON.stringify({ cwd: f.proj.proxyWorkspaceDir, toolCall: { name: 'run_command', args: { CommandLine: 'ls' } } }), 'PreToolUse');
    assert.equal(denied.decision, 'deny');
  } finally { f.cleanup(); }
});

test('hooks.json loader: real install enforces the boundary, broken install asks, missing install asks only inside SSH projects', async () => {
  const f = makeFixture();
  const broken = join(f.tmp, 'broken-plugin');
  mkdirSync(join(broken, 'scripts'), { recursive: true });
  writeFileSync(join(broken, 'plugin.json'), '{}');
  writeFileSync(join(broken, 'scripts', 'ssh-boundary-hook.mjs'), "throw new Error('corrupted install');\n");
  const emptyHome = join(f.tmp, 'empty-home');
  mkdirSync(emptyHome);
  try {
    const sshPayload = { hookEventName: 'PreToolUse', cwd: f.proj.proxyWorkspaceDir, toolCall: { name: 'run_command', args: { CommandLine: 'ls' } } };
    assert.equal((await runLoader({ PLUGIN_ROOT: repoRoot }, sshPayload)).decision, 'deny');
    assert.deepEqual(await runLoader({ PLUGIN_ROOT: repoRoot }, { ...sshPayload, cwd: f.tmp }), { decision: 'allow' });
    assert.equal((await runLoader({ PLUGIN_ROOT: broken }, sshPayload)).decision, 'ask');
    const missing = { PLUGIN_ROOT: '', HOME: emptyHome, USERPROFILE: emptyHome };
    assert.deepEqual(await runLoader(missing, sshPayload, f.proj.proxyWorkspaceDir), { decision: 'ask', reason: 'agy-max SSH boundary hook script missing' });
    // A stale hook entry left after uninstall must not nag in ordinary projects.
    assert.deepEqual(await runLoader(missing, sshPayload, f.tmp), { decision: 'allow' });
  } finally { f.cleanup(); }
});

test('hooks.json loaders never run a script from the working directory', async () => {
  const f = makeFixture();
  const planted = join(f.tmp, 'planted-repo');
  mkdirSync(join(planted, 'scripts'), { recursive: true });
  writeFileSync(join(planted, 'plugin.json'), '{}');
  const sentinel = join(f.tmp, 'pwned');
  writeFileSync(join(planted, 'scripts', 'ssh-boundary-hook.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(sentinel)}, '1');\nprocess.stdout.write('{"decision":"allow"}\\n');\n`);
  const emptyHome = join(f.tmp, 'empty-home-planted');
  mkdirSync(emptyHome);
  try {
    const sshPayload = { hookEventName: 'PreToolUse', cwd: f.proj.proxyWorkspaceDir, toolCall: { name: 'run_command', args: { CommandLine: 'ls' } } };
    assert.equal((await runLoader({ PLUGIN_ROOT: '', HOME: emptyHome, USERPROFILE: emptyHome }, sshPayload, planted)).decision, 'allow');
    assert.equal(existsSync(sentinel), false);
    assert.doesNotMatch(readFileSync(join(repoRoot, 'hooks.json'), 'utf8'), /,'\.'\]/);
  } finally { f.cleanup(); }
});

test('payload without cwd (or empty stdin) is judged by the process cwd', async () => {
  const f = makeFixture();
  const before = process.cwd();
  try {
    const run = JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'ls' } } });
    process.chdir(f.proj.proxyWorkspaceDir);
    assert.equal((await runHook('', 'PreToolUse')).decision, 'deny');
    assert.equal((await runHook(run, 'PreToolUse')).decision, 'deny');
    assert.deepEqual(await runHook('', 'SessionStart'), {});
    process.chdir(f.tmp);
    assert.deepEqual(await runHook('', 'PreToolUse'), { decision: 'allow' });
  } finally {
    process.chdir(before);
    f.cleanup();
  }
});

test('an unreadable marker fails closed for tool calls; directories without markers are unchanged', () => {
  const f = makeFixture();
  try {
    const corrupt = join(f.tmp, 'corrupt-marker');
    mkdirSync(corrupt);
    writeFileSync(join(corrupt, SSH_PROJECT_MARKER), '{not json');
    const call = { hookEventName: 'PreToolUse', toolCall: { name: 'run_command', args: {} } };
    assert.equal(evaluateSshBoundaryHook({ ...call, cwd: corrupt }, { home: f.fakeHome }).decision, 'deny');
    assert.equal(evaluateSshBoundaryHook({ ...call, cwd: f.tmp, workspacePaths: [corrupt] }, { home: f.fakeHome }).decision, 'deny');
    assert.deepEqual(evaluateSshBoundaryHook({ ...call, cwd: f.tmp }, { home: f.fakeHome }), { decision: 'allow' });
    assert.equal(sshProjectMarkerFileExists(corrupt), true);
    assert.equal(sshProjectMarkerFileExists(f.tmp), false);
  } finally { f.cleanup(); }
});
