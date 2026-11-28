import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync, symlinkSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import {
  injectDebugArg,
  removeDebugArg,
  patchDesktopEntry,
  unpatchDesktopEntry,
  configureLaunchers,
  restoreLaunchers,
  resolveAntigravityExecutable,
  manualLaunchCommand,
  clearAutoRelaunchAttempt,
  hasCustomLauncher,
  maybePromptPostUpdateRelaunch,
  readPostUpdateMode,
  shouldPromptPostUpdate,
  scheduleRelaunchWithDebugPort,
  isRemoteSshEnvironment,
  resolveLocalFilePath,
  resolveVerifiedLocalFilePath,
  isWindowsRunnableFile,
  openLocalFile,
  copyLocalFile,
  readLocalFileForAttach,
  parseFileUriAnchor,
  resolveExternalEditor,
  openInExternalEditor
} from '../lib/launcher.mjs';
import { startSidecarWebUi, renderAuxPaneHtml } from '../lib/sidecar-ui.mjs';

test('injectDebugArg and removeDebugArg preserve user arguments and avoid duplicates', () => {
  assert.equal(injectDebugArg(''), '--remote-debugging-port=0');
  assert.equal(injectDebugArg('--wsl-distro=Ubuntu'), '--wsl-distro=Ubuntu --remote-debugging-port=0');
  assert.equal(injectDebugArg('--remote-debugging-port=9222'), '--remote-debugging-port=9222');
  assert.equal(removeDebugArg('--remote-debugging-port=0'), '');
  assert.equal(removeDebugArg('--wsl-distro=Ubuntu --remote-debugging-port=0 --flag'), '--wsl-distro=Ubuntu --flag');
  assert.equal(removeDebugArg('--remote-debugging-port=9222'), '--remote-debugging-port=9222');
});

test('Linux desktop launcher override patches and restores cleanly in sandbox', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-launcher-linux-'));
  try {
    const home = join(root, 'home'), dataDir = join(root, 'data'), sysApps = join(root, 'sys-apps');
    mkdirSync(sysApps, { recursive: true });
    writeFileSync(join(sysApps, 'antigravity.desktop'), '[Desktop Entry]\nName=Antigravity\nExec=/opt/Antigravity/antigravity %U\nType=Application\n');
    const created = configureLaunchers({ home, dataDir, platform: 'linux', sandbox: true, systemApplicationsDir: sysApps });
    const userFile = join(home, '.local', 'share', 'applications', 'antigravity.desktop');
    assert.equal(created.updated.length, 1);
    assert.equal(created.macApp, undefined);
    assert.equal(created.iconConfigured, undefined);
    assert.equal(existsSync(join(home, 'Applications', 'Antigravity (Max).app')), false);
    assert.match(readFileSync(userFile, 'utf8'), /Exec=\/opt\/Antigravity\/antigravity --remote-debugging-port=0 %U/);

    const restored = restoreLaunchers({ home, dataDir, platform: 'linux', sandbox: true });
    assert.equal(restored.restored.length, 1);
    assert.equal(existsSync(userFile), false);

    mkdirSync(join(home, '.local', 'share', 'applications'), { recursive: true });
    writeFileSync(userFile, '[Desktop Entry]\nExec="/opt/Antigravity App/antigravity" --ozone-platform=wayland %U\n');
    configureLaunchers({ home, dataDir, platform: 'linux', sandbox: true });
    assert.match(readFileSync(userFile, 'utf8'), /Exec="\/opt\/Antigravity App\/antigravity" --remote-debugging-port=0 --ozone-platform=wayland %U/);
    restoreLaunchers({ home, dataDir, platform: 'linux', sandbox: true });
    assert.equal(readFileSync(userFile, 'utf8'), '[Desktop Entry]\nExec="/opt/Antigravity App/antigravity" --ozone-platform=wayland %U\n');
    assert.equal(patchDesktopEntry('[Desktop Entry]\nExec=/usr/bin/firefox %u\n').changed, false);
    assert.equal(unpatchDesktopEntry('[Desktop Entry]\nExec=/usr/bin/firefox %u\n').changed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('macOS launcher app copies source icon when available, clears stale icon when absent, and removes on restore', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-launcher-mac-'));
  try {
    const home = join(root, 'home'), dataDir = join(root, 'data');
    const res = configureLaunchers({ home, dataDir, platform: 'darwin', sandbox: true });
    const appDir = join(home, 'Applications', 'Antigravity (Max).app');
    const plistPath = join(appDir, 'Contents', 'Info.plist');
    const iconPath = join(appDir, 'Contents', 'Resources', 'icon.icns');
    assert.equal(res.updated[0], appDir);
    assert.equal(res.macApp, appDir);
    assert.equal(res.iconConfigured, false);
    assert.equal(existsSync(iconPath), false);
    assert.equal(readFileSync(plistPath, 'utf8').includes('CFBundleIconFile'), false);
    assert.ok(readFileSync(join(appDir, 'Contents', 'MacOS', 'launcher'), 'utf8').includes('--remote-debugging-port=0'));

    const sourceApp = join(home, 'Applications', 'Antigravity.app');
    mkdirSync(join(sourceApp, 'Contents', 'Resources'), { recursive: true });
    writeFileSync(join(sourceApp, 'Contents', 'Info.plist'), '<plist><dict><key>CFBundleIconFile</key><string>CustomIcon</string></dict></plist>', 'utf8');
    writeFileSync(join(sourceApp, 'Contents', 'Resources', 'CustomIcon.icns'), 'FAKE_ICNS', 'utf8');

    const withIcon = configureLaunchers({ home, dataDir, platform: 'darwin', sandbox: true });
    assert.equal(withIcon.iconConfigured, true);
    assert.equal(withIcon.macApp, appDir);
    assert.equal(readFileSync(iconPath, 'utf8'), 'FAKE_ICNS');
    assert.ok(readFileSync(plistPath, 'utf8').includes('<key>CFBundleIconFile</key><string>icon.icns</string>'));
    assert.ok(readFileSync(join(appDir, 'Contents', 'MacOS', 'launcher'), 'utf8').includes(sourceApp.replace(/(["\\$`])/g, '\\$1')));

    rmSync(sourceApp, { recursive: true, force: true });
    const withoutIcon = configureLaunchers({ home, dataDir, platform: 'darwin', sandbox: true });
    assert.equal(withoutIcon.iconConfigured, false);
    assert.equal(existsSync(iconPath), false);
    assert.equal(readFileSync(plistPath, 'utf8').includes('CFBundleIconFile'), false);

    restoreLaunchers({ home, dataDir, platform: 'darwin', sandbox: true });
    assert.equal(existsSync(appDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('macOS launcher waits for a quitting Antigravity to exit before opening, but not for a running one', { skip: process.platform !== 'darwin' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-launcher-quit-'));
  // Invoke via `/bin/sh` rather than exec'ing inside a `.app` bundle directly so macOS LaunchServices doesn't index temp test bundles.
  const runLauncher = (launcher, env) => {
    accessSync(launcher, constants.X_OK);
    return new Promise(done => spawn('/bin/sh', [launcher], { env, stdio: 'ignore' }).on('exit', done));
  };
  try {
    // Avoid a `.app` directory with a copied Mach-O binary so macOS Gatekeeper/LaunchServices won't flag a fake "Antigravity.app" as damaged.
    const home = join(root, 'home'), sourceApp = join(root, 'Apps', 'Antigravity-fixture'), stubDir = join(root, 'stub');
    const fakeMain = join(sourceApp, 'Contents', 'MacOS', 'Antigravity');
    const mainLog = join(home, 'Library', 'Logs', 'Antigravity', 'main.log');
    const openLog = join(root, 'open.log');
    mkdirSync(dirname(fakeMain), { recursive: true });
    mkdirSync(dirname(mainLog), { recursive: true });
    mkdirSync(stubDir, { recursive: true });
    symlinkSync('/bin/sleep', fakeMain);
    writeFileSync(join(stubDir, 'open'), '#!/bin/sh\n{ if kill -0 "$FAKE_PID" 2>/dev/null; then echo alive; else echo gone; fi; echo "$@"; } > "$OPEN_LOG"\n', { mode: 0o755 });
    configureLaunchers({ home, dataDir: join(root, 'data'), platform: 'darwin', sandbox: true, macSourceApp: sourceApp });
    const launcher = join(home, 'Applications', 'Antigravity (Max).app', 'Contents', 'MacOS', 'launcher');

    for (const [lastLine, expected] of [['Shutting down language server…', 'gone'], ['Starting app (v2) with dynamic port…', 'alive']]) {
      writeFileSync(mainLog, `[t] [info]  Starting app (v1) with dynamic port…\n[t] [info]  ${lastLine}\n`);
      const fake = spawn(fakeMain, ['30'], { stdio: 'ignore' });
      const killer = setTimeout(() => fake.kill(), 600);
      await runLauncher(launcher, { ...process.env, HOME: home, PATH: `${stubDir}:${process.env.PATH}`, FAKE_PID: String(fake.pid), OPEN_LOG: openLog });
      clearTimeout(killer);
      fake.kill();
      assert.deepEqual(readFileSync(openLog, 'utf8').trim().split('\n'), [expected, `-a ${sourceApp} --args --remote-debugging-port=0`]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows .lnk shortcuts targeting Antigravity.exe are updated and restored without touching unrelated shortcuts', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-launcher-win-'));
  try {
    const home = join(root, 'home'), dataDir = join(root, 'data');
    const desktop = join(home, 'Desktop');
    mkdirSync(desktop, { recursive: true });
    const fakeAgy = join(root, 'Antigravity.exe'), fakeOther = join(root, 'Other.exe');
    writeFileSync(fakeAgy, ''); writeFileSync(fakeOther, '');
    const agyLnk = join(desktop, 'Antigravity.lnk'), otherLnk = join(desktop, 'Other.lnk');
    spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$ws = New-Object -ComObject WScript.Shell; $s1 = $ws.CreateShortcut($env:L1); $s1.TargetPath = $env:T1; $s1.Arguments = '--wsl-distro=Ubuntu'; $s1.Save(); $s2 = $ws.CreateShortcut($env:L2); $s2.TargetPath = $env:T2; $s2.Save()`
    ], { env: { ...process.env, L1: agyLnk, T1: fakeAgy, L2: otherLnk, T2: fakeOther }, windowsHide: true });

    const configured = configureLaunchers({ home, dataDir, platform: 'win32', sandbox: true });
    assert.deepEqual(configured.updated, [agyLnk]);
    const readArgs = lnk => spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject WScript.Shell).CreateShortcut($env:L).Arguments`
    ], { env: { ...process.env, L: lnk }, encoding: 'utf8', windowsHide: true }).stdout.trim();
    assert.equal(readArgs(agyLnk), '--wsl-distro=Ubuntu --remote-debugging-port=0');
    assert.equal(readArgs(otherLnk), '');

    const second = configureLaunchers({ home, dataDir, platform: 'win32', sandbox: true });
    assert.deepEqual(second.updated, []);

    const restored = restoreLaunchers({ home, dataDir, platform: 'win32', sandbox: true });
    assert.deepEqual(restored.restored, [agyLnk]);
    assert.equal(readArgs(agyLnk), '--wsl-distro=Ubuntu');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('executable discovery, post-update prompt guards, and relaunch scheduling prevent loops', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-'));
  try {
    const appRoot = join(root, 'Programs', 'antigravity');
    const binDir = join(appRoot, 'resources', 'bin');
    mkdirSync(binDir, { recursive: true });
    const exe = join(appRoot, 'Antigravity.exe'), lsExe = join(binDir, 'language_server.exe');
    writeFileSync(exe, ''); writeFileSync(lsExe, '');
    assert.equal(resolveAntigravityExecutable({ platform: 'win32', env: { ANTIGRAVITY_AGENTAPI_EXE: lsExe }, home: root, execPath: '' }), exe);
    assert.equal(resolveAntigravityExecutable({ platform: 'win32', env: {}, home: root, execPath: exe }), exe);
    assert.equal(manualLaunchCommand({ platform: 'win32', env: {}, home: root, dataDir: join(root, 'data'), execPath: exe }), `& '${exe.replace(/'/g, "''")}' --remote-debugging-port=0`);

    const installDir = join(root, 'installed'), dataDir = join(root, 'data');
    mkdirSync(installDir, { recursive: true }); mkdirSync(dataDir, { recursive: true });
    const receipt = join(installDir, '.agy-install.json');
    writeFileSync(receipt, '{}');
    const now = Date.now();
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: {}, now }).reason, 'non-interactive');
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000', ELECTRON_OZONE_PLATFORM_HINT: 'headless' }, now }).reason, 'non-interactive');
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000' }, now }).reason, 'fresh-install');

    const oldDate = new Date(now - 5 * 60 * 1000);
    utimesSync(receipt, oldDate, oldDate);
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000' }, now }).prompt, true);

    const spawned = [];
    const res = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { ANTIGRAVITY_AGENTAPI_EXE: lsExe, ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000', ELECTRON_RUN_AS_NODE: '1' },
      spawnProcess(cmd, args, opts) { spawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(res.scheduled, true);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].opts.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(spawned[0].opts.env.AGY_RELAUNCH_TARGET, exe);
    assert.match(spawned[0].opts.env.AGY_RELAUNCH_SCRIPT, /relaunch-antigravity-[a-f0-9-]+\.ps1$/i);
    assert.ok(existsSync(spawned[0].opts.env.AGY_RELAUNCH_SCRIPT));
    assert.equal(spawned[0].opts.detached, undefined);
    assert.ok(spawned[0].args.includes('-EncodedCommand'));
    const encodedIdx = spawned[0].args.indexOf('-EncodedCommand');
    const decodedLauncher = Buffer.from(spawned[0].args[encodedIdx + 1], 'base64').toString('utf16le');
    assert.ok(decodedLauncher.includes('FindWindowSW'));
    assert.ok(decodedLauncher.includes('ShellExecute'));
    assert.ok(decodedLauncher.includes('CreateProcessW'));
    const psBody = readFileSync(spawned[0].opts.env.AGY_RELAUNCH_SCRIPT, 'utf8');
    assert.ok(psBody.includes('Start-Sleep -Milliseconds 350'));
    assert.ok(psBody.includes('--remote-debugging-port=0'));
    assert.ok(psBody.includes('Remove-Item -LiteralPath $PSCommandPath'));
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5000' }, now: now + 1000 }).prompt, false);
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:6000' }, now: now + 1000 }).reason, 'cooldown');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('postUpdateMode supports silent suppression, zero-popup auto relaunch, and cancellable prompt dialogs', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-post-update-mode-'));
  try {
    const appRoot = join(root, 'Programs', 'antigravity');
    const binDir = join(appRoot, 'resources', 'bin');
    mkdirSync(binDir, { recursive: true });
    const exe = join(appRoot, 'Antigravity.exe');
    const lsExe = join(binDir, 'language_server.exe');
    writeFileSync(exe, '');
    writeFileSync(lsExe, '');

    const installDir = join(root, 'installed');
    const dataDir = join(root, 'data');
    mkdirSync(installDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    const receipt = join(installDir, '.agy-install.json');
    writeFileSync(receipt, '{}');
    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(receipt, oldDate, oldDate);

    // 1. silent mode suppresses prompt completely
    writeFileSync(join(dataDir, 'launcher-config.json'), JSON.stringify({ postUpdateMode: 'silent' }));
    assert.equal(readPostUpdateMode(dataDir), 'silent');
    assert.equal(shouldPromptPostUpdate({ dataDir, installDir, env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5001' } }).reason, 'suppressed-by-config');
    const silentRes = maybePromptPostUpdateRelaunch({
      dataDir,
      installDir,
      platform: 'win32',
      home: root,
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5001', ANTIGRAVITY_AGENTAPI_EXE: lsExe }
    });
    assert.equal(silentRes.prompted, false);
    assert.equal(silentRes.reason, 'suppressed-by-config');

    // 2. auto mode triggers relaunch once per host binary signature without spawning any modal popup
    writeFileSync(join(dataDir, 'launcher-config.json'), JSON.stringify({ postUpdateMode: 'auto' }));
    let relaunchCalls = 0;
    let spawnCalls = 0;
    const autoRes = maybePromptPostUpdateRelaunch({
      dataDir,
      installDir,
      platform: 'win32',
      home: root,
      now: Date.now() + 20 * 60 * 1000,
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5002', ANTIGRAVITY_AGENTAPI_EXE: lsExe },
      relaunch() { relaunchCalls++; return { scheduled: true }; },
      spawnProcess() { spawnCalls++; return { on() {}, kill() {}, unref() {} }; }
    });
    assert.equal(autoRes.prompted, false);
    assert.equal(autoRes.autoRelaunched, true);
    assert.equal(relaunchCalls, 1);
    assert.equal(spawnCalls, 0);

    // Second auto attempt after cooldown for the SAME binary signature must NOT loop
    const autoRepeat = maybePromptPostUpdateRelaunch({
      dataDir,
      installDir,
      platform: 'win32',
      home: root,
      now: Date.now() + 40 * 60 * 1000,
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5002b', ANTIGRAVITY_AGENTAPI_EXE: lsExe },
      relaunch() { relaunchCalls++; return { scheduled: true }; },
      spawnProcess() { spawnCalls++; return { on() {}, kill() {}, unref() {} }; }
    });
    assert.equal(autoRepeat.autoRelaunched, false);
    assert.equal(autoRepeat.reason, 'auto-relaunch-already-attempted');
    assert.equal(relaunchCalls, 1);

    // Clearing the attempt after a healthy CDP session allows future auto relaunch
    clearAutoRelaunchAttempt(dataDir);
    const autoAfterHealthy = maybePromptPostUpdateRelaunch({
      dataDir,
      installDir,
      platform: 'win32',
      home: root,
      now: Date.now() + 60 * 60 * 1000,
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5002c', ANTIGRAVITY_AGENTAPI_EXE: lsExe },
      relaunch() { relaunchCalls++; return { scheduled: true }; },
      spawnProcess() { spawnCalls++; return { on() {}, kill() {}, unref() {} }; }
    });
    assert.equal(autoAfterHealthy.autoRelaunched, true);
    assert.equal(relaunchCalls, 2);

    // WSL ignores Linux customLauncher in hasCustomLauncher()
    const linuxBin = join(root, 'custom-bin.sh');
    writeFileSync(linuxBin, '#!/bin/sh\n');
    writeFileSync(join(dataDir, 'launcher-config.json'), JSON.stringify({ customLauncher: { command: linuxBin, args: [] }, postUpdateMode: 'prompt' }));
    assert.equal(hasCustomLauncher(dataDir, { platform: 'linux', wsl: true }), false);

    // 3. default prompt mode returns a cancel() handle that kills the dialog and suppresses exit-code relaunch
    let killed = false;
    let exitHandler = null;
    const promptRes = maybePromptPostUpdateRelaunch({
      dataDir,
      installDir,
      platform: 'win32',
      home: root,
      now: Date.now() + 85 * 60 * 1000,
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:5003', ANTIGRAVITY_AGENTAPI_EXE: lsExe },
      relaunch() { relaunchCalls++; return { scheduled: true }; },
      spawnProcess() {
        spawnCalls++;
        return {
          on(ev, fn) { if (ev === 'exit') exitHandler = fn; },
          kill() { killed = true; },
          unref() {}
        };
      }
    });
    assert.equal(promptRes.prompted, true);
    assert.equal(typeof promptRes.cancel, 'function');
    assert.equal(spawnCalls, 1);
    promptRes.cancel();
    assert.equal(killed, true);
    exitHandler?.(10);
    assert.equal(relaunchCalls, 2, 'Canceled prompt must not relaunch on exit');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('macOS relaunch script waits for ancestor Antigravity process without pgrep -f and passes debug port', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-mac-'));
  try {
    const appBundle = join(root, 'Antigravity.app');
    const binDir = join(appBundle, 'Contents', 'Resources', 'bin');
    mkdirSync(binDir, { recursive: true });
    const lsExe = join(binDir, 'language_server');
    writeFileSync(lsExe, '');

    const spawned = [];
    const res = scheduleRelaunchWithDebugPort({
      dataDir: join(root, 'data'),
      home: root,
      platform: 'darwin',
      env: { ANTIGRAVITY_AGENTAPI_EXE: lsExe, ELECTRON_RUN_AS_NODE: '1' },
      spawnProcess(cmd, args, opts) { spawned.push({ cmd, args, opts }); return { unref() {} }; }
    });

    assert.equal(res.scheduled, true);
    assert.equal(res.target, appBundle);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].cmd, 'sh');
    assert.equal(spawned[0].args[0], '-c');
    assert.equal(spawned[0].opts.detached, true);
    assert.equal(spawned[0].opts.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(spawned[0].opts.env.AGY_RELAUNCH_TARGET, appBundle);

    const script = spawned[0].args[1];
    assert.ok(script.includes("trap '' HUP TERM"));
    assert.ok(script.includes('/bin/ps -axo args='));
    assert.ok(!script.includes('pgrep -f'));
    assert.ok(script.includes('/usr/bin/open -n -a "$target" --args --remote-debugging-port=0 >/dev/null 2>&1'));
    assert.ok(!script.includes('--remote-debugging-port=0 >/dev/null 2>&1 &'));

    if (process.platform !== 'win32') {
      const check = spawnSync('sh', ['-n', '-c', script], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux relaunch script protects against HUP/TERM and matches executable via ps/awk without pgrep -f', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-linux-'));
  try {
    const exe = join(root, 'antigravity');
    writeFileSync(exe, '');
    const spawned = [];
    const res = scheduleRelaunchWithDebugPort({
      dataDir: join(root, 'data'),
      home: root,
      platform: 'linux',
      env: { APPIMAGE: exe, ELECTRON_RUN_AS_NODE: '1' },
      spawnProcess(cmd, args, opts) { spawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(res.scheduled, true);
    assert.equal(res.target, exe);
    const script = spawned[0].args[1];
    assert.ok(script.includes("trap '' HUP TERM"));
    assert.ok(script.includes('ps -eo args='));
    assert.ok(!script.includes('pgrep -f'));
    assert.ok(script.includes('--remote-debugging-port=0'));
    if (process.platform !== 'win32') {
      const check = spawnSync('sh', ['-n', '-c', script], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Sidecar Aux Pane Web UI serves post-update prompt copy, enforces token auth, and triggers relaunch', async () => {
  const freePort = await new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
  let relaunched = 0, checked = 0, installedVer = '';
  const close = await startSidecarWebUi({
    port: freePort,
    token: 'secret-token',
    version: '2.13.0',
    getStatus: async () => ({
      healthy: false,
      compatibilityError: 'Antigravity compatibility: um (missing)',
      clientVersion: '2.34.0',
      connected: true,
      enabled: true,
      language: 'zh-CN'
    }),
    onRelaunch: async () => { relaunched++; return { scheduled: true }; },
    onCheckUpdate: async () => { checked++; return { status: 'available', version: '2.13.1', canInstall: true, releaseUrl: 'https://github.com/wangbingnan136/agy-max/releases/tag/v2.13.1' }; },
    onInstallUpdate: async ({ version }) => { installedVer = version; return { status: 'preparing', version }; },
    onUpdateStatus: async () => ({ status: installedVer ? 'installing' : 'idle', version: installedVer })
  });
  try {
    const html = renderAuxPaneHtml({ version: '2.13.0', language: 'zh-CN' });
    assert.ok(html.includes('需要重启 Antigravity 以启用 Antigravity Max 插件'));
    assert.ok(html.includes('复制启动命令'));
    assert.ok(html.includes('检查插件更新'));
    assert.ok(html.includes('复制诊断信息'));
    assert.ok(html.includes('id="mac-dock-hint"'));
    assert.ok(html.includes("data.platform === 'darwin'"));
    assert.ok(html.includes('拖入 Dock 栏替换原 Antigravity 图标'));
    assert.ok(html.includes('[hidden] { display: none !important; }'));
    assert.equal(html.includes('\u00b7'), false);
    const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
    assert.ok(inlineScript);
    new Function(inlineScript);

    const unauth = await fetch(`http://127.0.0.1:${freePort}/api/status`);
    assert.equal(unauth.status, 401);

    const statusRes = await fetch(`http://127.0.0.1:${freePort}/api/status?token=secret-token`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.healthy, false);
    assert.equal(statusJson.version, '2.13.0');
    assert.equal(statusJson.compatibilityError, 'Antigravity compatibility: um (missing)');
    assert.equal(statusJson.clientVersion, '2.34.0');

    const badPost = await fetch(`http://127.0.0.1:${freePort}/api/relaunch`, { method: 'POST' });
    assert.equal(badPost.status, 401);
    assert.equal(relaunched, 0);

    const okPost = await fetch(`http://127.0.0.1:${freePort}/api/relaunch`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token' }
    });
    assert.equal(okPost.status, 200);
    assert.equal(relaunched, 1);

    assert.equal((await fetch(`http://127.0.0.1:${freePort}/api/update/check`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${freePort}/api/update/install`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${freePort}/api/update/status`)).status, 401);

    const checkRes = await fetch(`http://127.0.0.1:${freePort}/api/update/check`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(checkRes.status, 200);
    assert.equal((await checkRes.json()).version, '2.13.1');
    assert.equal(checked, 1);

    const installRes = await fetch(`http://127.0.0.1:${freePort}/api/update/install`, {
      method: 'POST',
      headers: { 'x-sidecar-token': 'secret-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '2.13.1' })
    });
    assert.equal(installRes.status, 200);
    assert.equal(installedVer, '2.13.1');

    const updStatusRes = await fetch(`http://127.0.0.1:${freePort}/api/update/status?token=secret-token`);
    assert.equal(updStatusRes.status, 200);
    assert.equal((await updStatusRes.json()).status, 'installing');
  } finally {
    await close();
  }
});

test('resolveLocalFilePath and resolveVerifiedLocalFilePath verify non-global IPs via DNS without domain suffix hardcoding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-file-uri-'));
  try {
    const file = join(dir, 'sample #1.md');
    writeFileSync(file, 'hello', 'utf8');
    const fileUri = `${pathToFileURL(file).href}#L10-L20`;
    assert.equal(resolveLocalFilePath(fileUri), file);
    // Unescaped '#' in directory/file names (e.g. project-C#/app.exe) must not be truncated as URL hash
    const hashDir = join(dir, 'project-C#');
    mkdirSync(hashDir);
    const hashFile = join(hashDir, 'app.exe');
    writeFileSync(hashFile, 'bin', 'utf8');
    const rawHashUri = pathToFileURL(hashFile).href.replaceAll('%23', '#');
    assert.equal(resolveLocalFilePath(rawHashUri), hashFile);
    assert.equal(resolveLocalFilePath(`${rawHashUri}#L10-L20`), hashFile);
    // Antigravity URI serializer encodes '/' and second '#' inside the fragment as %2F and %23
    const fragStart = rawHashUri.indexOf('#');
    const encodedFragUri = `${rawHashUri.slice(0, fragStart + 1)}${rawHashUri.slice(fragStart + 1).replaceAll('/', '%2F')}`;
    assert.equal(resolveLocalFilePath(encodedFragUri), hashFile);
    assert.equal(resolveLocalFilePath(`${encodedFragUri}%23L10-L20`), hashFile);
    const readmeInHashDir = join(hashDir, 'README.md');
    writeFileSync(readmeInHashDir, '# hi', 'utf8');
    const rawReadmeUri = pathToFileURL(readmeInHashDir).href.replaceAll('%23', '#');
    assert.equal(resolveLocalFilePath(`${rawReadmeUri}#installation`), readmeInHashDir);
    const readmeFragStart = rawReadmeUri.indexOf('#');
    const encodedReadmeUri = `${rawReadmeUri.slice(0, readmeFragStart + 1)}${rawReadmeUri.slice(readmeFragStart + 1).replaceAll('/', '%2F')}%23installation`;
    assert.equal(resolveLocalFilePath(encodedReadmeUri), readmeInHashDir);
    assert.throws(() => resolveLocalFilePath('https://example.com/a.md'), /仅支持本地文件链接/);
    assert.throws(() => resolveLocalFilePath('file://evil.example/share/a.md'), /仅支持本机或局域网文件路径/);
    assert.throws(() => resolveLocalFilePath('file://8.8.8.8/share/a.md', { platform: 'win32' }), /仅支持本机或局域网文件路径/);
    assert.throws(() => resolveLocalFilePath('file://192.168.1.10/share/a.md', { platform: 'darwin' }), /仅支持本机或局域网文件路径/);
    assert.equal(resolveLocalFilePath('file://192.168.1.10/share/%E4%BA%AE%E5%BA%A6%20%E5%AF%B9%E6%AF%94%E5%BA%A6.png', { platform: 'win32' }), '\\\\192.168.1.10\\share\\亮度 对比度.png');
    assert.equal(resolveLocalFilePath('file:////192.168.1.10/share/shot.png', { platform: 'win32' }), '\\\\192.168.1.10\\share\\shot.png');
    assert.equal(resolveLocalFilePath('file://100.64.1.2/media/clip.mp4', { platform: 'win32' }), '\\\\100.64.1.2\\media\\clip.mp4');
    assert.equal(resolveLocalFilePath('file://wsl.localhost/Ubuntu-24.04/home/dev/a.txt', { platform: 'win32' }), '\\\\wsl.localhost\\Ubuntu-24.04\\home\\dev\\a.txt');
    assert.equal(resolveLocalFilePath('file://wsl$/Ubuntu-24.04/home/dev/a.txt', { platform: 'win32' }), '\\\\wsl$\\Ubuntu-24.04\\home\\dev\\a.txt');
    assert.throws(() => resolveLocalFilePath(''), /文件路径无效/);

    // Async DNS-before-SMB verification allows any hostname resolving strictly to non-global IPs (custom split-DNS, Tailscale MagicDNS, NetBIOS)
    const dnsCalls = [];
    const fakeLookup = async host => {
      dnsCalls.push(host);
      if (host === 'nas') return [{ address: '192.168.1.20', family: 4 }];
      if (host === 'nas.mycompany.com') return [{ address: '10.20.30.40', family: 4 }];
      if (host === 'synology.tail1a2b.ts.net') return [{ address: '100.64.2.9', family: 4 }, { address: 'fd7a:115c:a1e0::1', family: 6 }];
      if (host === 'evil.example') return [{ address: '93.184.216.34', family: 4 }];
      if (host === 'dual.example') return [{ address: '192.168.1.10', family: 4 }, { address: '8.8.8.8', family: 4 }];
      throw new Error('ENOTFOUND');
    };
    assert.equal(await resolveVerifiedLocalFilePath('file://192.168.1.10/share/a.png', { platform: 'win32', lookup: fakeLookup }), '\\\\192.168.1.10\\share\\a.png');
    assert.equal(dnsCalls.length, 0); // Literal IPs skip DNS completely
    assert.equal(await resolveVerifiedLocalFilePath('file://nas/photos/test.png', { platform: 'win32', lookup: fakeLookup }), '\\\\nas\\photos\\test.png');
    assert.equal(await resolveVerifiedLocalFilePath('file://nas.mycompany.com/share/doc.pdf', { platform: 'win32', lookup: fakeLookup }), '\\\\nas.mycompany.com\\share\\doc.pdf');
    assert.equal(await resolveVerifiedLocalFilePath('file://synology.tail1a2b.ts.net/media/a.png', { platform: 'win32', lookup: fakeLookup }), '\\\\synology.tail1a2b.ts.net\\media\\a.png');
    await assert.rejects(() => resolveVerifiedLocalFilePath('file://evil.example/share/a.md', { platform: 'win32', lookup: fakeLookup }), /仅支持本机或局域网文件路径/);
    await assert.rejects(() => resolveVerifiedLocalFilePath('file://dual.example/share/a.md', { platform: 'win32', lookup: fakeLookup }), /仅支持本机或局域网文件路径/);
    await assert.rejects(() => resolveVerifiedLocalFilePath('file://unknown-host/share/a.md', { platform: 'win32', lookup: fakeLookup }), /无法解析局域网主机路径/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('openLocalFile dispatches platform commands and blocks runnable Windows files on open', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-open-file-'));
  try {
    const doc = join(dir, 'notes.md');
    const winDoc = 'C:\\Users\\dev\\notes.md';
    const winDocUri = 'file:///C:/Users/dev/notes.md';
    const winCommaFile = 'C:\\Users\\dev\\a,b.txt';
    const winCommaUri = 'file:///C:/Users/dev/a,b.txt';
    const winScript = 'C:\\Users\\dev\\run.js';
    const winScriptUri = 'file:///C:/Users/dev/run.js';
    writeFileSync(doc, '# hi', 'utf8');
    const calls = [];
    const fakeSpawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { unref() {} };
    };
    const fakeWinFile = { exists: () => true, stat: () => ({ isDirectory: () => false }) };

    await openLocalFile(winDocUri, { action: 'open', platform: 'win32', spawnProcess: fakeSpawn, ...fakeWinFile });
    await openLocalFile(winDocUri, { action: 'reveal', platform: 'win32', spawnProcess: fakeSpawn, ...fakeWinFile });
    await openLocalFile(winCommaUri, { action: 'reveal', platform: 'win32', spawnProcess: fakeSpawn, ...fakeWinFile });
    await openLocalFile(pathToFileURL(doc).href, { action: 'reveal', platform: 'darwin', spawnProcess: fakeSpawn, ...fakeWinFile });
    await openLocalFile(pathToFileURL(doc).href, { action: 'reveal', platform: 'linux', spawnProcess: fakeSpawn, ...fakeWinFile });
    await openLocalFile(winScriptUri, { action: 'reveal', platform: 'win32', spawnProcess: fakeSpawn, ...fakeWinFile });

    const posixDoc = doc;
    const posixDir = dir;
    assert.deepEqual(calls[0], { cmd: 'explorer.exe', args: [winDoc], opts: { detached: true, stdio: 'ignore', windowsHide: true } });
    assert.deepEqual(calls[1], { cmd: 'explorer.exe', args: [`/select,${winDoc}`], opts: { detached: true, stdio: 'ignore', windowsHide: true } });
    assert.deepEqual(calls[2], { cmd: 'explorer.exe', args: [`/select,"${winCommaFile}"`], opts: { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true } });
    assert.deepEqual(calls[3], { cmd: 'open', args: ['-R', posixDoc], opts: { detached: true, stdio: 'ignore' } });
    assert.deepEqual(calls[4], { cmd: 'xdg-open', args: [posixDir], opts: { detached: true, stdio: 'ignore' } });
    assert.deepEqual(calls[5], { cmd: 'explorer.exe', args: [`/select,${winScript}`], opts: { detached: true, stdio: 'ignore', windowsHide: true } });

    // Windows LAN UNC paths with spaces quote cleanly for explorer /select
    await openLocalFile('file://192.168.1.10/share/a%20b.png', {
      action: 'reveal',
      platform: 'win32',
      spawnProcess: fakeSpawn,
      exists: () => true,
      stat: () => ({ isDirectory: () => false })
    });
    assert.deepEqual(calls[6], {
      cmd: 'explorer.exe',
      args: ['/select,"\\\\192.168.1.10\\share\\a b.png"'],
      opts: { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }
    });

    assert.equal(isWindowsRunnableFile(winScript), true);
    assert.equal(isWindowsRunnableFile(winDoc), false);
    await assert.rejects(() => openLocalFile(winScriptUri, { action: 'open', platform: 'win32', spawnProcess: fakeSpawn, ...fakeWinFile }), /可能直接执行/);
    await assert.rejects(() => openLocalFile(pathToFileURL(doc).href, { action: 'delete', spawnProcess: fakeSpawn }), /不支持的文件操作/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('copyLocalFile runs asynchronously across platforms with safe URI encoding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-copy-file-'));
  try {
    const file = join(dir, 'shot #1.png');
    writeFileSync(file, 'png', 'utf8');
    const fileUri = pathToFileURL(file).href;
    const winFile = 'C:\\Users\\dev\\shot #1.png';
    const winFileUri = 'file:///C:/Users/dev/shot%20%231.png';
    const calls = [];
    const fakeSpawn = (cmd, args, opts) => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      let written = '';
      child.stdin = { on() {}, end(chunk) { written += String(chunk || ''); } };
      child.kill = () => {};
      const entry = { cmd, args, opts, get stdin() { return written; } };
      calls.push(entry);
      queueMicrotask(() => {
        if (cmd === 'wl-copy') child.emit('error', new Error('ENOENT'));
        else child.emit('close', 0);
      });
      return child;
    };

    await copyLocalFile(winFileUri, { platform: 'win32', spawnProcess: fakeSpawn, exists: () => true, env: {} });
    await copyLocalFile(fileUri, { platform: 'darwin', spawnProcess: fakeSpawn, exists: () => true, env: {} });
    await copyLocalFile(fileUri, { platform: 'linux', spawnProcess: fakeSpawn, exists: () => true, env: {} });

    const posixFile = file;
    assert.equal(calls[0].cmd, 'powershell.exe');
    assert.equal(calls[0].opts.env.AGY_CLIPBOARD_PATH, winFile);
    assert.equal(calls[1].cmd, 'osascript');
    assert.equal(calls[1].opts.env.AGY_CLIPBOARD_PATH, posixFile);
    assert.equal(calls[2].cmd, 'wl-copy');
    assert.equal(calls[3].cmd, 'xclip');
    assert.equal(calls[3].stdin, `${pathToFileURL(posixFile).href}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isRemoteSshEnvironment detects headless SSH remote hosts without false positives on local desktop', () => {
  assert.equal(isRemoteSshEnvironment({ platform: 'linux', env: { SSH_CONNECTION: '1.2.3.4 22', ANTIGRAVITY_VSCODE_HOST: '1' } }), true);
  assert.equal(isRemoteSshEnvironment({ platform: 'linux', env: { ANTIGRAVITY_VSCODE_HOST: '1' } }), true);
  assert.equal(isRemoteSshEnvironment({ platform: 'linux', env: { SSH_CONNECTION: '1.2.3.4 22', DISPLAY: ':0' } }), false);
  assert.equal(isRemoteSshEnvironment({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } }), false);
  assert.equal(isRemoteSshEnvironment({ platform: 'win32', env: { SSH_CONNECTION: '1.2.3.4 22' } }), false);
  const html = renderAuxPaneHtml({ version: '2.12.8', language: 'zh-CN' });
  assert.ok(html.includes('当前处于 SSH 远端模式'));
});

test('scheduleRelaunchWithDebugPort reads saved proxy settings across platforms without creating shortcuts', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-proxy-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
      proxyEnabled: true,
      proxyUrl: 'socks5h://127.0.0.1:7897',
      proxyBypass: '192.168.0.0/16',
      proxyForceHttp1: true
    }));

    // Windows: reads settings.json automatically (so account switch & update relaunch preserve proxy)
    const winExe = join(root, 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe');
    mkdirSync(join(root, 'AppData', 'Local', 'Programs', 'antigravity'), { recursive: true });
    writeFileSync(winExe, '');
    const winSpawned = [];
    const winRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local') },
      spawnProcess(cmd, args, opts) { winSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(winRes.proxyActive, true);
    const psBody = readFileSync(winSpawned[0].opts.env.AGY_RELAUNCH_SCRIPT, 'utf8');
    assert.ok(psBody.includes("$env:HTTPS_PROXY = 'socks5h://127.0.0.1:7897'"));
    assert.ok(psBody.includes("$env:NO_PROXY = 'localhost,127.0.0.1,::1,[::1],192.168.0.0/16'"));
    assert.ok(psBody.includes("$env:GODEBUG = 'http2client=0'"));
    assert.ok(psBody.includes("'--proxy-server=socks5://127.0.0.1:7897'"));
    assert.ok(psBody.includes("'--proxy-bypass-list=localhost;127.0.0.1;[::1];192.168.0.0/16'"));

    // macOS: injects env + --env flags + Chromium proxy args and clears helper vars
    const macApp = join(root, 'Antigravity.app');
    mkdirSync(join(macApp, 'Contents', 'Resources', 'bin'), { recursive: true });
    const macLs = join(macApp, 'Contents', 'Resources', 'bin', 'language_server');
    writeFileSync(macLs, '');
    const macSpawned = [];
    const macRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'darwin',
      env: { ANTIGRAVITY_AGENTAPI_EXE: macLs },
      spawnProcess(cmd, args, opts) { macSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(macRes.proxyActive, true);
    assert.equal(macSpawned[0].opts.env.AGY_PROXY_URL, 'socks5h://127.0.0.1:7897');
    assert.equal(macSpawned[0].opts.env.AGY_PROXY_CHROME_SERVER, 'socks5://127.0.0.1:7897');
    assert.ok(macSpawned[0].args[1].includes('--env "HTTPS_PROXY=$p_url"'));
    assert.ok(macSpawned[0].args[1].includes('--proxy-server=$p_chrome'));
    assert.ok(macSpawned[0].args[1].includes('unset AGY_PROXY_URL'));

    // Linux: exports env + passes Chromium args
    const linExe = join(root, 'antigravity');
    writeFileSync(linExe, '');
    const linSpawned = [];
    const linRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'linux',
      env: { APPIMAGE: linExe },
      spawnProcess(cmd, args, opts) { linSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(linRes.proxyActive, true);
    assert.ok(linSpawned[0].args[1].includes('export HTTP_PROXY="$p_url"'));
    assert.ok(linSpawned[0].args[1].includes('--proxy-server=$p_chrome'));

    // Disabled proxy after plugin-managed proxy: Windows relaunch clears stale managed proxy env vars
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ proxyEnabled: false, proxyUrl: 'http://127.0.0.1:7897' }));
    const offSpawned = [];
    const offRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local'), AGY_POWERTOOLS_PROXY_SPEC: 'http://127.0.0.1:7897|localhost|auto' },
      spawnProcess(cmd, args, opts) { offSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(offRes.proxyActive, false);
    const psOffBody = readFileSync(offSpawned[0].opts.env.AGY_RELAUNCH_SCRIPT, 'utf8');
    assert.ok(psOffBody.includes('Remove-Item Env:HTTP_PROXY'));
    assert.ok(!psOffBody.includes('--proxy-server='));

    // Disabled plugin proxy with external inherited proxy: Windows relaunch preserves per-scheme rules & loopback bypass
    const extSpawned = [];
    const extRes = scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local'), HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890', NO_PROXY: '127.0.0.1,localhost' },
      spawnProcess(cmd, args, opts) { extSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(extRes.proxyActive, true);
    const psExtBody = readFileSync(extSpawned[0].opts.env.AGY_RELAUNCH_SCRIPT, 'utf8');
    assert.ok(!psExtBody.includes('Remove-Item Env:HTTP_PROXY'));
    assert.ok(psExtBody.includes("$env:HTTPS_PROXY = 'http://127.0.0.1:7890'"));
    assert.ok(psExtBody.includes("$env:NO_PROXY = 'localhost,127.0.0.1,::1,[::1]'"));
    assert.ok(psExtBody.includes('--proxy-server=http=http://127.0.0.1:7890;https=http://127.0.0.1:7890'));

    // HTTP-only external proxy does not route HTTPS through HTTP proxy
    const httpOnlySpawned = [];
    scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local'), HTTP_PROXY: 'http://127.0.0.1:8080' },
      spawnProcess(cmd, args, opts) { httpOnlySpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    const psHttpOnly = readFileSync(httpOnlySpawned[0].opts.env.AGY_RELAUNCH_SCRIPT, 'utf8');
    assert.ok(psHttpOnly.includes('--proxy-server=http=http://127.0.0.1:8080'));
    assert.ok(!psHttpOnly.includes('https='));

    // Split HTTP and HTTPS external proxies generate distinct per-scheme Chromium rules
    const splitSpawned = [];
    scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local'), HTTP_PROXY: 'http://127.0.0.1:8080', HTTPS_PROXY: 'http://127.0.0.1:8443' },
      spawnProcess(cmd, args, opts) { splitSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    const psSplit = readFileSync(splitSpawned[0].opts.env.AGY_RELAUNCH_SCRIPT, 'utf8');
    assert.ok(psSplit.includes('--proxy-server=http=http://127.0.0.1:8080;https=http://127.0.0.1:8443'));

    // Custom launcher with appendDefaultArgs: false delegates cleanly without appending raw Chromium flags (Win32 & POSIX)
    const wrapperScript = join(root, 'Start-Wrapper.ps1');
    writeFileSync(wrapperScript, 'param([switch]$EnableCdp)\n');
    writeFileSync(join(dataDir, 'launcher-config.json'), JSON.stringify({
      customLauncher: { command: wrapperScript, args: ['-EnableCdp'], cwd: root, appendDefaultArgs: false }
    }));
    const customCmd = manualLaunchCommand({ platform: 'win32', home: root, dataDir, execPath: winExe });
    assert.ok(customCmd.includes(wrapperScript) && customCmd.includes("'-EnableCdp'") && !customCmd.includes('--remote-debugging-port=0'));
    const customSpawned = [];
    scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local'), HTTPS_PROXY: 'http://127.0.0.1:7890' },
      spawnProcess(cmd, args, opts) { customSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    const psCustomBody = readFileSync(customSpawned[0].opts.env.AGY_RELAUNCH_SCRIPT, 'utf8');
    assert.ok(psCustomBody.includes(wrapperScript) && psCustomBody.includes('-EnableCdp') && !psCustomBody.includes('--remote-debugging-port=0'));

    const posixWrapper = join(root, 'launch.sh');
    writeFileSync(posixWrapper, '#!/bin/sh\n');
    writeFileSync(join(dataDir, 'launcher-config.json'), JSON.stringify({
      customLauncher: { command: posixWrapper, args: ['--custom-cdp'], cwd: root, appendDefaultArgs: false }
    }));
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897' }));
    const posixCustomSpawned = [];
    scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'linux',
      env: { APPIMAGE: linExe },
      spawnProcess(cmd, args, opts) { posixCustomSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.ok(posixCustomSpawned[0].args[1].includes('--custom-cdp'));
    assert.ok(!posixCustomSpawned[0].args[1].includes('--remote-debugging-port=0'));
    assert.ok(!posixCustomSpawned[0].args[1].includes('--proxy-server=$p_chrome'));

    // Literal POSIX file URI containing :digits is preserved without stripping
    assert.equal(resolveLocalFilePath('file:///tmp/report:2024', { platform: 'linux' }), '/tmp/report:2024');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readLocalFileForAttach returns base64 media for images/PDFs, mentions for code/folders/oversized, and rejects missing or remote URIs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-attach-'));
  try {
    const imgPath = join(dir, 'sample.png');
    const imgBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    writeFileSync(imgPath, imgBytes);
    const pdfPath = join(dir, 'spec.pdf');
    writeFileSync(pdfPath, Buffer.from('%PDF-1.7\n'));
    const codePath = join(dir, 'index.mjs');
    writeFileSync(codePath, 'export const ok = true;\n');
    const subDir = join(dir, 'folder');
    mkdirSync(subDir);

    const imgRes = await readLocalFileForAttach(pathToFileURL(imgPath).href);
    assert.equal(imgRes.mode, 'media');
    assert.equal(imgRes.mimeType, 'image/png');
    assert.equal(imgRes.name, 'sample.png');
    assert.equal(imgRes.base64, imgBytes.toString('base64'));

    const pdfRes = await readLocalFileForAttach(pathToFileURL(pdfPath).href);
    assert.equal(pdfRes.mode, 'media');
    assert.equal(pdfRes.mimeType, 'application/pdf');

    const oversizedRes = await readLocalFileForAttach(pathToFileURL(imgPath).href, { maxMediaBytes: 4 });
    assert.equal(oversizedRes.mode, 'mention');
    assert.equal(oversizedRes.oversized, true);
    assert.equal(oversizedRes.base64, undefined);

    const codeRes = await readLocalFileForAttach(pathToFileURL(codePath).href);
    assert.equal(codeRes.mode, 'mention');
    assert.equal(codeRes.kind, 'file');
    assert.equal(codeRes.isDirectory, false);

    const dirRes = await readLocalFileForAttach(pathToFileURL(subDir).href);
    assert.equal(dirRes.mode, 'mention');
    assert.equal(dirRes.kind, 'directory');
    assert.equal(dirRes.isDirectory, true);

    await assert.rejects(() => readLocalFileForAttach(pathToFileURL(join(dir, 'missing.png')).href), /不存在/);
    await assert.rejects(() => readLocalFileForAttach('https://example.com/a.png'), /仅支持本地文件/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseFileUriAnchor, resolveExternalEditor, and openInExternalEditor jump to exact lines across editors and WSL URIs', async () => {
  assert.deepEqual(parseFileUriAnchor('file:///repo/a.js#L42'), { line: 42, column: null });
  assert.deepEqual(parseFileUriAnchor('file:///repo/a.js#L18C7-L25'), { line: 18, column: 7 });
  assert.deepEqual(parseFileUriAnchor('file:///repo/a.js#L9:3'), { line: 9, column: 3 });
  assert.deepEqual(parseFileUriAnchor('file:///repo/README.md#overview'), { line: null, column: null });

  const wslResolved = resolveLocalFilePath('file://wsl.localhost/Ubuntu/home/dev/app.ts#L12', { platform: 'linux' });
  assert.equal(wslResolved, '/home/dev/app.ts');

  const dir = mkdtempSync(join(tmpdir(), 'agy-editor-'));
  try {
    const targetFile = join(dir, 'main.mjs');
    writeFileSync(targetFile, 'console.log(1);\n');
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    const cursorBin = join(binDir, 'cursor');
    const zedBin = join(binDir, 'zed');
    writeFileSync(cursorBin, '');
    writeFileSync(zedBin, '');

    const autoFound = resolveExternalEditor({ preferred: 'auto', platform: 'linux', env: { PATH: binDir }, home: dir });
    assert.equal(autoFound.id, 'cursor');

    const calls = [];
    const fakeSpawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { on() {}, unref() {} };
    };

    const uriWithLine = `${pathToFileURL(targetFile).href}#L27C4`;
    const resCursor = await openInExternalEditor(uriWithLine, {
      preferred: 'auto',
      platform: 'linux',
      env: { PATH: binDir },
      home: dir,
      spawnProcess: fakeSpawn
    });
    assert.equal(resCursor.editor, 'cursor');
    assert.equal(resCursor.line, 27);
    assert.equal(resCursor.column, 4);
    assert.deepEqual(calls[0].args, ['-g', `${targetFile}:27:4`]);

    const resZed = await openInExternalEditor(uriWithLine, {
      preferred: 'zed',
      platform: 'linux',
      env: { PATH: binDir },
      home: dir,
      spawnProcess: fakeSpawn
    });
    assert.equal(resZed.editor, 'zed');
    assert.deepEqual(calls[1].args, [`${targetFile}:27:4`]);

    await assert.rejects(
      () => openInExternalEditor(uriWithLine, { preferred: 'windsurf', platform: 'linux', env: { PATH: binDir }, home: dir, spawnProcess: fakeSpawn }),
      /Windsurf/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('openInExternalEditor supports Kiro and falls back to the built-in system text editor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-editor-sys-'));
  try {
    const targetFile = join(dir, 'notes.md');
    writeFileSync(targetFile, '# hi\n');
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    writeFileSync(join(binDir, 'xdg-open'), '');
    const calls = [];
    const fakeSpawn = (cmd, args) => { calls.push({ cmd, args }); return { on() {}, unref() {} }; };
    const uri = `${pathToFileURL(targetFile).href}#L3`;

    const linuxRes = await openInExternalEditor(uri, { preferred: 'auto', platform: 'linux', env: { PATH: binDir }, home: dir, spawnProcess: fakeSpawn });
    assert.equal(linuxRes.editor, 'system');
    assert.deepEqual(calls.at(-1), { cmd: join(binDir, 'xdg-open'), args: [targetFile] });

    writeFileSync(join(binDir, 'gedit'), '');
    assert.equal(resolveExternalEditor({ preferred: 'system', platform: 'linux', env: { PATH: binDir }, home: dir }).command, join(binDir, 'gedit'));

    const macExists = p => p === '/usr/bin/open' || p === targetFile;
    await openInExternalEditor(uri, { preferred: 'auto', platform: 'darwin', env: { PATH: '' }, home: dir, spawnProcess: fakeSpawn, exists: macExists });
    assert.deepEqual(calls.at(-1), { cmd: '/usr/bin/open', args: ['-t', targetFile] });

    const kiroCli = '/Applications/Kiro.app/Contents/Resources/app/bin/code';
    const kiroRes = await openInExternalEditor(uri, { preferred: 'auto', platform: 'darwin', env: { PATH: '' }, home: dir, spawnProcess: fakeSpawn, exists: p => p === kiroCli || macExists(p) });
    assert.equal(kiroRes.editor, 'kiro');
    assert.deepEqual(calls.at(-1), { cmd: kiroCli, args: ['-g', `${targetFile}:3:1`] });

    const notepad = resolveExternalEditor({ preferred: 'auto', platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, home: dir, exists: p => p === 'C:\\Windows\\System32\\notepad.exe' });
    assert.equal(notepad.id, 'system');

    await openInExternalEditor(pathToFileURL(dir).href, { preferred: 'system', platform: 'linux', env: { PATH: binDir }, home: dir, spawnProcess: fakeSpawn });
    assert.deepEqual(calls.at(-1), { cmd: 'xdg-open', args: [dir] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows openInExternalEditor prefers native .exe over .cmd and hardens .cmd fallback against injection and /s quote stripping', async () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on() {}, unref() {} };
  };
  const fakeStat = () => ({ isDirectory: () => false });

  // 1. Custom PATH containing ...\bin\code.cmd resolves sibling parent ...\Code.exe directly
  const vscodeFiles = new Set([
    'D:\\Tools\\Microsoft VS Code\\bin\\code.cmd',
    'D:\\Tools\\Microsoft VS Code\\Code.exe',
    'C:\\Users\\Alice Smith\\proj\\a&b.js'
  ]);
  const resolvedVscode = resolveExternalEditor({
    preferred: 'vscode',
    platform: 'win32',
    env: { PATH: 'D:\\Tools\\Microsoft VS Code\\bin' },
    exists: p => vscodeFiles.has(p)
  });
  assert.equal(resolvedVscode.command, 'D:\\Tools\\Microsoft VS Code\\Code.exe');

  await openInExternalEditor('file:///C:/Users/Alice%20Smith/proj/a%26b.js#L12C3', {
    preferred: 'vscode',
    platform: 'win32',
    env: { PATH: 'D:\\Tools\\Microsoft VS Code\\bin', ELECTRON_RUN_AS_NODE: '1' },
    spawnProcess: fakeSpawn,
    exists: p => vscodeFiles.has(p),
    stat: fakeStat
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'D:\\Tools\\Microsoft VS Code\\Code.exe');
  assert.deepEqual(calls[0].args, ['-g', 'C:\\Users\\Alice Smith\\proj\\a&b.js:12:3']);
  assert.equal(calls[0].opts.windowsVerbatimArguments, undefined);
  assert.equal(calls[0].opts.env.ELECTRON_RUN_AS_NODE, undefined);

  // 2. Cursor nested resources\app\bin\cursor.cmd resolves parent ...\Cursor.exe directly
  const cursorFiles = new Set([
    'D:\\Apps\\cursor\\resources\\app\\bin\\cursor.cmd',
    'D:\\Apps\\cursor\\Cursor.exe'
  ]);
  const resolvedCursor = resolveExternalEditor({
    preferred: 'cursor',
    platform: 'win32',
    env: { PATH: 'D:\\Apps\\cursor\\resources\\app\\bin' },
    exists: p => cursorFiles.has(p)
  });
  assert.equal(resolvedCursor.command, 'D:\\Apps\\cursor\\Cursor.exe');

  // 3. Standalone .cmd wrapper fallback wraps full command line in outer quotes with windowsVerbatimArguments: true
  const shimFiles = new Set([
    'C:\\My Shims\\code.cmd',
    'C:\\Users\\Alice Smith\\proj\\index.mjs',
    'C:\\Users\\Alice Smith\\proj\\evil&calc.mjs',
    'C:\\Users\\Alice Smith\\proj\\evil%TEMP%.mjs',
    'C:\\Users\\Alice Smith\\proj\\evil|pipe.mjs'
  ]);
  await openInExternalEditor('file:///C:/Users/Alice%20Smith/proj/index.mjs#L5', {
    preferred: 'vscode',
    platform: 'win32',
    env: { PATH: 'C:\\My Shims', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    spawnProcess: fakeSpawn,
    exists: p => shimFiles.has(p),
    stat: fakeStat
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cmd, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(calls[1].args, [
    '/d',
    '/s',
    '/c',
    '""C:\\My Shims\\code.cmd" "-g" "C:\\Users\\Alice Smith\\proj\\index.mjs:5:1""'
  ]);
  assert.equal(calls[1].opts.windowsVerbatimArguments, true);

  // 4. Standalone .cmd wrapper rejects cmd.exe metacharacters (BatBadBut protection)
  for (const badUri of [
    'file:///C:/Users/Alice%20Smith/proj/evil%26calc.mjs',
    'file:///C:/Users/Alice%20Smith/proj/evil%25TEMP%25.mjs',
    'file:///C:/Users/Alice%20Smith/proj/evil%7Cpipe.mjs'
  ]) {
    await assert.rejects(
      () => openInExternalEditor(badUri, {
        preferred: 'vscode',
        platform: 'win32',
        env: { PATH: 'C:\\My Shims' },
        spawnProcess: fakeSpawn,
        exists: p => shimFiles.has(p),
        stat: fakeStat
      }),
      /不安全字符/
    );
  }
  assert.equal(calls.length, 2);
});

test('Windows file URI normalization and validation block all UNC/SMB bypass variants', async () => {
  const fakeLookup = async host => {
    if (host === 'evil.example') return [{ address: '93.184.216.34', family: 4 }];
    throw new Error('ENOTFOUND');
  };

  // Multi-slash, mixed-slash, and percent-encoded UNC prefixes pointing to remote hosts must be rejected
  for (const bypassUri of [
    'file:///\\evil.example/share/secret.txt',
    'file://///evil.example/share/secret.txt',
    'file:///\\\\evil.example/share/secret.txt',
    'file:///%5cevil.example/share/secret.txt',
    'file:///%5c%5cevil.example/share/secret.txt',
    'file:///%2fevil.example/share/secret.txt',
    'file://\\\\evil.example/share/secret.txt',
    'file://localhost//evil.example/share/secret.txt',
    'file://localhost/\\evil.example/share/secret.txt',
    'file:///\\\\?\\UNC\\evil.example\\share\\secret.txt',
    'file:///var/folders/non-drive/secret.txt'
  ]) {
    assert.throws(
      () => resolveLocalFilePath(bypassUri, { platform: 'win32' }),
      /仅支持本机或局域网文件路径|文件路径格式无效/,
      `resolveLocalFilePath should reject: ${bypassUri}`
    );
    await assert.rejects(
      () => resolveVerifiedLocalFilePath(bypassUri, { platform: 'win32', lookup: fakeLookup }),
      /仅支持本机或局域网文件路径|文件路径格式无效|无法解析局域网主机路径/,
      `resolveVerifiedLocalFilePath should reject: ${bypassUri}`
    );
  }

  // Legitimate LAN IP UNC variants and drive-letter URIs continue to work on win32
  assert.equal(resolveLocalFilePath('file:///C:/Users/dev/notes.md', { platform: 'win32' }), 'C:\\Users\\dev\\notes.md');
  assert.equal(resolveLocalFilePath('file://localhost/C:/Users/dev/notes.md', { platform: 'win32' }), 'C:\\Users\\dev\\notes.md');
  assert.equal(resolveLocalFilePath('file://///192.168.1.10/share/shot.png', { platform: 'win32' }), '\\\\192.168.1.10\\share\\shot.png');
  assert.equal(resolveLocalFilePath('file:///\\192.168.1.10/share/shot.png', { platform: 'win32' }), '\\\\192.168.1.10\\share\\shot.png');
});

test('macOS relaunch passes appName via env to prevent shell injection and omits proxy credentials from open --env argv', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-relaunch-mac-sec-'));
  try {
    const trickyAppName = "Antigravity'$(id);uname'";
    const appBundle = join(root, `${trickyAppName}.app`);
    const binDir = join(appBundle, 'Contents', 'Resources', 'bin');
    mkdirSync(binDir, { recursive: true });
    const lsExe = join(binDir, 'language_server');
    writeFileSync(lsExe, '');

    const spawned = [];
    const res = scheduleRelaunchWithDebugPort({
      dataDir: join(root, 'data'),
      home: root,
      platform: 'darwin',
      env: { ANTIGRAVITY_AGENTAPI_EXE: lsExe },
      proxy: {
        enabled: true,
        url: 'http://alice:s3cr3tPass@127.0.0.1:7897',
        bypass: '10.0.0.0/8',
        forceHttp1: true
      },
      spawnProcess(cmd, args, opts) { spawned.push({ cmd, args, opts }); return { unref() {} }; }
    });

    assert.equal(res.scheduled, true);
    assert.equal(res.proxyActive, true);
    assert.equal(spawned.length, 1);

    const script = spawned[0].args[1];
    const env = spawned[0].opts.env;

    // 1. appName is passed through env and read via AppleScript system attribute, never interpolated into sh -c
    assert.equal(env.AGY_RELAUNCH_APP_NAME, trickyAppName);
    assert.ok(script.includes('system attribute "AGY_RELAUNCH_APP_NAME"'));
    assert.ok(script.includes('unset AGY_RELAUNCH_TARGET AGY_RELAUNCH_APP_NAME'));
    assert.equal(script.includes('$(id)'), false);
    assert.equal(script.includes('uname'), false);

    // 2. Proxy credentials stay in exported env vars and are NOT passed to /usr/bin/open --env argv
    assert.equal(env.AGY_PROXY_URL, 'http://alice:s3cr3tPass@127.0.0.1:7897');
    assert.ok(script.includes('export HTTP_PROXY="$p_url"'));
    assert.equal(script.includes('--env "HTTP_PROXY=$p_url"'), false);
    assert.equal(script.includes('--env "HTTPS_PROXY=$p_url"'), false);
    assert.equal(script.includes('--env "AGY_POWERTOOLS_PROXY_SPEC=$p_spec"'), false);
    assert.equal(script.includes('s3cr3tPass'), false);
    assert.ok(script.includes('--env "NO_PROXY=$p_bypass"'));
    assert.ok(script.includes('--env "GODEBUG=http2client=0"'));

    if (process.platform !== 'win32') {
      const check = spawnSync('sh', ['-n', '-c', script], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('restoreLaunchers rejects home itself, sibling prefix collisions, wrong filenames, and symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-restore-sec-'));
  try {
    const home = join(root, 'alice');
    const siblingHome = join(root, 'alice2');
    const dataDir = join(root, 'data');
    mkdirSync(join(home, 'Applications', 'Other.app'), { recursive: true });
    mkdirSync(join(home, '.local', 'share', 'applications'), { recursive: true });
    mkdirSync(join(siblingHome, 'Applications', 'Antigravity (Max).app'), { recursive: true });
    mkdirSync(join(siblingHome, '.local', 'share', 'applications'), { recursive: true });
    mkdirSync(dataDir, { recursive: true });

    const homeKeepFile = join(home, 'important.txt');
    writeFileSync(homeKeepFile, 'keep', 'utf8');
    const otherDesktop = join(home, '.local', 'share', 'applications', 'other.desktop');
    writeFileSync(otherDesktop, '[Desktop Entry]\nExec=/opt/Antigravity/antigravity --remote-debugging-port=0\n', 'utf8');
    const siblingDesktop = join(siblingHome, '.local', 'share', 'applications', 'antigravity.desktop');
    writeFileSync(siblingDesktop, '[Desktop Entry]\nExec=/opt/Antigravity/antigravity --remote-debugging-port=0\n', 'utf8');

    let macSymlink = '';
    let linuxSymlink = '';
    const externalTargetDir = join(root, 'external-app');
    const externalTargetFile = join(root, 'external.desktop');
    mkdirSync(externalTargetDir, { recursive: true });
    writeFileSync(externalTargetFile, '[Desktop Entry]\nExec=/opt/Antigravity/antigravity --remote-debugging-port=0\n', 'utf8');
    if (process.platform !== 'win32') {
      macSymlink = join(home, 'Applications', 'Antigravity (Max).app');
      symlinkSync(externalTargetDir, macSymlink);
      linuxSymlink = join(home, '.local', 'share', 'applications', 'antigravity.desktop');
      symlinkSync(externalTargetFile, linuxSymlink);
    }

    // Tampered macOS launcher-state.json
    writeFileSync(join(dataDir, 'launcher-state.json'), JSON.stringify({
      shortcuts: [],
      desktopEntries: [],
      macApps: [
        home,
        join(siblingHome, 'Applications', 'Antigravity (Max).app'),
        join(home, 'Applications', 'Other.app'),
        ...(macSymlink ? [macSymlink] : [])
      ]
    }));
    const macRes = restoreLaunchers({ home, dataDir, platform: 'darwin', sandbox: true });
    assert.deepEqual(macRes.restored, []);
    assert.equal(existsSync(home), true);
    assert.equal(existsSync(homeKeepFile), true);
    assert.equal(existsSync(join(siblingHome, 'Applications', 'Antigravity (Max).app')), true);
    assert.equal(existsSync(join(home, 'Applications', 'Other.app')), true);
    assert.equal(existsSync(externalTargetDir), true);

    // Tampered Linux launcher-state.json
    writeFileSync(join(dataDir, 'launcher-state.json'), JSON.stringify({
      shortcuts: [],
      desktopEntries: [
        { path: home, mode: 'created' },
        { path: homeKeepFile, mode: 'created' },
        { path: otherDesktop, mode: 'created' },
        { path: siblingDesktop, mode: 'created' },
        { path: siblingDesktop, mode: 'patched' },
        ...(linuxSymlink ? [{ path: linuxSymlink, mode: 'created' }, { path: linuxSymlink, mode: 'patched' }] : [])
      ],
      macApps: []
    }));
    const linuxRes = restoreLaunchers({ home, dataDir, platform: 'linux', sandbox: true });
    assert.deepEqual(linuxRes.restored, []);
    assert.equal(existsSync(home), true);
    assert.equal(existsSync(homeKeepFile), true);
    assert.equal(existsSync(otherDesktop), true);
    assert.equal(existsSync(siblingDesktop), true);
    assert.ok(readFileSync(siblingDesktop, 'utf8').includes('--remote-debugging-port=0'));
    assert.equal(existsSync(externalTargetFile), true);
    assert.ok(readFileSync(externalTargetFile, 'utf8').includes('--remote-debugging-port=0'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('macOS bundle discovery skips nested Antigravity Helper.app and Antigravity (Max).app wrapper', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-mac-helper-'));
  try {
    const home = join(root, 'home'), dataDir = join(root, 'data');
    const outerApp = join(home, 'Applications', 'Antigravity.app');
    const helperExe = join(outerApp, 'Contents', 'Frameworks', 'Antigravity Helper.app', 'Contents', 'MacOS', 'Antigravity Helper');
    const maxLauncherExe = join(home, 'Applications', 'Antigravity (Max).app', 'Contents', 'MacOS', 'launcher');
    mkdirSync(join(outerApp, 'Contents', 'Frameworks', 'Antigravity Helper.app', 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(join(home, 'Applications', 'Antigravity (Max).app', 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(helperExe, '');
    writeFileSync(maxLauncherExe, '');

    assert.equal(resolveAntigravityExecutable({ platform: 'darwin', env: {}, home, execPath: helperExe }), outerApp);
    const fromWrapper = resolveAntigravityExecutable({ platform: 'darwin', env: {}, home, execPath: maxLauncherExe });
    assert.notEqual(fromWrapper, join(home, 'Applications', 'Antigravity (Max).app'));
    assert.equal(fromWrapper, existsSync('/Applications/Antigravity.app') ? '/Applications/Antigravity.app' : outerApp);

    configureLaunchers({ home, dataDir, platform: 'darwin', sandbox: true, execPath: helperExe });
    const launcherScript = readFileSync(maxLauncherExe, 'utf8');
    assert.ok(launcherScript.includes(outerApp.replace(/(["\\$`])/g, '\\$1')));
    assert.equal(launcherScript.includes('Antigravity Helper.app'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relaunch scripts sync ToS keys after Antigravity exits, preserving other app_storage.json keys (Issue #59)', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-tos-launch-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    const exe = join(root, 'antigravity');
    writeFileSync(exe, '');
    const storage = join(root, 'app_storage.json');
    writeFileSync(storage, JSON.stringify({ 'agy.onboarding.lastLoginUsername': 'old@example.com', otherKey: 'keep-me' }));
    const spawned = [];
    scheduleRelaunchWithDebugPort({
      dataDir,
      home: root,
      platform: 'linux',
      env: { APPIMAGE: exe },
      onboardingSync: { email: 'new@example.com', isGcpTos: true },
      appStoragePath: storage,
      execPath: process.execPath,
      spawnProcess(cmd, args, opts) { spawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    const [shellArg, script] = spawned[0].args;
    assert.equal(shellArg, '-c');
    assert.equal(spawned[0].opts.env.AGY_ONBOARDING_EMAIL, 'new@example.com');
    assert.equal(spawned[0].opts.env.AGY_ONBOARDING_GCP_TOS, 'true');
    assert.equal(spawned[0].opts.env.AGY_ONBOARDING_STORAGE, storage);
    assert.ok(script.includes('agy.onboarding.lastLoginUsername'));
    assert.ok(script.includes('agy.onboarding.lastLoginIsGcpTos'));
    const syncIdx = script.indexOf("d['agy.onboarding.lastLoginUsername']");
    const launchIdx = script.indexOf('nohup "$target"');
    assert.ok(syncIdx > 0 && syncIdx < launchIdx, 'sync must happen after exit and before launch');
    if (process.platform !== 'win32') {
      const check = spawnSync('sh', ['-n', '-c', script], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
    // Execute only the injected node -e sync to verify atomic write and key preservation.
    const nodeCmd = script.match(/ELECTRON_RUN_AS_NODE=1 "\$AGY_NODE_BIN" -e "([^"]+)"/)[1];
    const sync = spawnSync(process.execPath, ['-e', nodeCmd], { encoding: 'utf8', env: spawned[0].opts.env });
    assert.equal(sync.status, 0, sync.stderr);
    const after = JSON.parse(readFileSync(storage, 'utf8'));
    assert.equal(after['agy.onboarding.lastLoginUsername'], 'new@example.com');
    assert.equal(after['agy.onboarding.lastLoginIsGcpTos'], 'true');
    assert.equal(after.otherKey, 'keep-me');

    // Missing or corrupt storage is skipped, not fatal; invalid email payload is ignored entirely.
    rmSync(storage);
    const noFile = spawnSync(process.execPath, ['-e', nodeCmd], { encoding: 'utf8', env: spawned[0].opts.env });
    assert.equal(noFile.status, 0, noFile.stderr);
    writeFileSync(storage, '{bad json');
    const badFile = spawnSync(process.execPath, ['-e', nodeCmd], { encoding: 'utf8', env: spawned[0].opts.env });
    assert.equal(badFile.status, 0, badFile.stderr);
    const spawnedBad = [];
    const winExe = join(root, 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe');
    mkdirSync(join(root, 'AppData', 'Local', 'Programs', 'antigravity'), { recursive: true });
    writeFileSync(winExe, '');
    scheduleRelaunchWithDebugPort({
      dataDir, home: root, platform: 'win32', env: { LOCALAPPDATA: join(root, 'AppData', 'Local'), ANTIGRAVITY_AGENTAPI_EXE: '' },
      onboardingSync: { email: 'bad email', isGcpTos: true }, appStoragePath: storage,
      spawnProcess(cmd, args, opts) { spawnedBad.push({ cmd, args, opts }); return { unref() {} }; }
    });
    assert.equal(spawnedBad[0].opts.env.AGY_ONBOARDING_EMAIL, undefined);

    // Custom .exe launcher with empty args & appendDefaultArgs:false omits -ArgumentList; Clash mixed HTTP+SOCKS ALL_PROXY emits valid per-scheme rules
    const customExe = join(root, 'MyLauncher.exe');
    writeFileSync(customExe, '');
    writeFileSync(join(dataDir, 'launcher-config.json'), JSON.stringify({
      customLauncher: { command: customExe, args: [], cwd: root, appendDefaultArgs: false }
    }));
    const customExeSpawned = [];
    scheduleRelaunchWithDebugPort({
      dataDir, home: root, platform: 'win32',
      env: { LOCALAPPDATA: join(root, 'AppData', 'Local') },
      spawnProcess(cmd, args, opts) { customExeSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    const customExePs = readFileSync(customExeSpawned[0].opts.env.AGY_RELAUNCH_SCRIPT, 'utf8');
    assert.ok(customExePs.includes(`Start-Process -FilePath '${customExe.replace(/'/g, "''")}' -WorkingDirectory`));
    assert.ok(!customExePs.includes('-ArgumentList'));

    rmSync(join(dataDir, 'launcher-config.json'));
    const clashSpawned = [];
    scheduleRelaunchWithDebugPort({
      dataDir, home: root, platform: 'win32',
      env: {
        LOCALAPPDATA: join(root, 'AppData', 'Local'),
        HTTP_PROXY: 'http://127.0.0.1:7890',
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        ALL_PROXY: 'socks5://127.0.0.1:7890'
      },
      spawnProcess(cmd, args, opts) { clashSpawned.push({ cmd, args, opts }); return { unref() {} }; }
    });
    const clashPs = readFileSync(clashSpawned[0].opts.env.AGY_RELAUNCH_SCRIPT, 'utf8');
    assert.ok(clashPs.includes('--proxy-server=http=http://127.0.0.1:7890;https=http://127.0.0.1:7890;socks=socks5://127.0.0.1:7890'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
