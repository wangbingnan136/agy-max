import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, unlinkSync, chmodSync, statSync, copyFileSync, utimesSync, renameSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { antigravityUserDataDir } from './paths.mjs';
import { appendWslEnv, isWslEnvironment, resolveWslWindowsExecutable, resolveWslWindowsTemp, wslPathToWindows } from './wsl.mjs';

export const DEBUG_FLAG = '--remote-debugging-port=0';
const HAS_DEBUG_RE = /(?:^|\s)--remote-debugging-port(?:=\S+|\s+\d+|\b)/;
const STRIP_DEBUG_RE = /(?:^|\s+)--remote-debugging-port=0(?=\s|$)/g;
const PROMPT_COOLDOWN_MS = 10 * 60 * 1000;
const FRESH_INSTALL_GRACE_MS = 120 * 1000;

export function isSameHome(a, b, platform = process.platform) {
  return relative(resolve(a), resolve(b)) === '' || (platform === 'win32' && win32.relative(win32.resolve(a), win32.resolve(b)) === '');
}

export function isRemoteSshEnvironment({ env = process.env, platform = process.platform, wsl } = {}) {
  if (platform === 'win32') return false;
  if (typeof wsl === 'boolean' ? wsl : isWslEnvironment({ platform, env })) return false;
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return false;
  return Boolean(
    env.ANTIGRAVITY_VSCODE_HOST === '1' ||
    env.SSH_CONNECTION ||
    env.SSH_CLIENT ||
    env.SSH_TTY
  );
}

export function injectDebugArg(args = '') {
  const trimmed = String(args || '').trim();
  if (HAS_DEBUG_RE.test(trimmed)) return trimmed;
  return trimmed ? `${trimmed} ${DEBUG_FLAG}` : DEBUG_FLAG;
}

export function removeDebugArg(args = '') {
  return String(args || '').replace(STRIP_DEBUG_RE, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function patchDesktopEntry(content) {
  let changed = false;
  const lines = String(content || '').split(/\r?\n/).map(line => {
    if (!/^Exec\s*=/.test(line) || HAS_DEBUG_RE.test(line)) return line;
    const eq = line.indexOf('=');
    const prefix = line.slice(0, eq + 1);
    const cmd = line.slice(eq + 1).trim();
    if (!/antigravity/i.test(cmd)) return line;
    const match = cmd.match(/^("[^"]+"|\S+)([\s\S]*)$/);
    if (!match) return line;
    changed = true;
    const rest = match[2].trim();
    return `${prefix}${match[1]} ${DEBUG_FLAG}${rest ? ` ${rest}` : ''}`;
  });
  return { content: lines.join('\n'), changed };
}

export function unpatchDesktopEntry(content) {
  let changed = false;
  const lines = String(content || '').split(/\r?\n/).map(line => {
    if (!/^Exec\s*=/.test(line) || !line.includes(DEBUG_FLAG)) return line;
    const next = line.replace(STRIP_DEBUG_RE, ' ').replace(/^(Exec\s*=\s*)/, '$1').replace(/\s{2,}/g, ' ').trimEnd();
    if (next !== line) changed = true;
    return next;
  });
  return { content: lines.join('\n'), changed };
}

function readJson(path, fallback = {}) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function writeJson(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  } catch {}
}

function defaultRunPowerShell(script, env, wslEnvKeys = []) {
  const finalEnv = wslEnvKeys.length ? appendWslEnv(env || process.env, wslEnvKeys) : env;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 8000,
    env: finalEnv
  });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || '').trim();
}

function windowsShortcutFolders({ home, env, sandbox, runPowerShell }) {
  const appData = sandbox ? join(home, 'AppData', 'Roaming') : (env.APPDATA || join(home, 'AppData', 'Roaming'));
  const dirs = new Set([
    join(home, 'Desktop'),
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')
  ]);
  if (!sandbox) {
    const out = runPowerShell('[Console]::OutputEncoding=[Text.Encoding]::UTF8; @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs")) | ConvertTo-Json -Compress', env);
    try {
      for (const folder of [].concat(JSON.parse(out || '[]'))) if (typeof folder === 'string' && isAbsolute(folder)) dirs.add(folder);
    } catch {}
  }
  return [...dirs];
}

function windowsShortcutCandidates(dirs) {
  const files = new Set();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isFile() && /\.lnk$/i.test(entry.name)) files.add(full);
        else if (entry.isDirectory() && /^antigravity$/i.test(entry.name)) {
          for (const sub of readdirSync(full, { withFileTypes: true })) {
            if (sub.isFile() && /\.lnk$/i.test(sub.name)) files.add(join(full, sub.name));
          }
        }
      }
    } catch {}
  }
  return [...files];
}

function canEditShortcut(folders, path) {
  return typeof path === 'string' && isAbsolute(path) && /\.lnk$/i.test(path) && folders.some(folder => {
    const dir = dirname(path);
    return (isSameHome(folder, dir, 'win32') || (/^antigravity$/i.test(basename(dir)) && isSameHome(folder, dirname(dir), 'win32')))
      && isSafeOwnedPath(folder, path);
  });
}

export function planLauncherChanges({ home, dataDir, uninstall = false, platform = process.platform, env = process.env } = {}) {
  const stateFile = join(dataDir, 'launcher-state.json');
  const sandbox = !isSameHome(home, homedir(), platform);
  let locations;
  if (platform === 'win32') locations = windowsShortcutFolders({ home, env, sandbox, runPowerShell: () => null });
  else if (platform === 'darwin') locations = [join(home, 'Applications', 'Antigravity (Max).app')];
  else locations = [join(sandbox ? join(home, '.local', 'share') : (env.XDG_DATA_HOME || join(home, '.local', 'share')), 'applications', 'antigravity.desktop')];
  return { action: uninstall ? 'restore' : 'configure-debug-port', platform, stateFile, locations };
}

function shortcutRecords(runPowerShell, env, records, action, wslEnvKeys = []) {
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$records = $env:AGY_LNK_LIST | ConvertFrom-Json',
    '$ws = New-Object -ComObject WScript.Shell',
    '$changed = @()',
    'foreach ($item in $records) {',
    '  try {',
    '    $p = if ($item -is [string]) { $item } else { $item.path }',
    ...(action === 'restore' ? ['    if (-not (Test-Path -LiteralPath $p)) { $changed += $p; continue }'] : []),
    '    $file = Get-Item -LiteralPath $p -Force -ErrorAction Stop',
    '    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }',
    '    $s = $ws.CreateShortcut($p)',
    '    if ((Split-Path -Leaf $s.TargetPath) -ine "Antigravity.exe") { continue }',
    ...(action === 'inspect' ? [
      '    $changed += @{path = $p; target = [string]$s.TargetPath; beforeArgs = [string]$s.Arguments}',
    ] : [
      '    if ($item -is [string]) {',
      '      $before = [string]$s.Arguments',
      '      $after = ($before -replace "(?:^|\\s+)--remote-debugging-port=0(?=\\s|$)", " ").Trim()',
      '    } else {',
      '      if ($s.TargetPath -ine $item.target) { continue }',
      `      $before = [string]$item.${action === 'restore' ? 'afterArgs' : 'beforeArgs'}`,
      `      $after = [string]$item.${action === 'restore' ? 'beforeArgs' : 'afterArgs'}`,
      '    }',
      '    if ($s.Arguments -cne $after) {',
      '      if ($s.Arguments -cne $before) { continue }',
      '      $s.Arguments = $after',
      '      $s.Save()',
      '    }',
      '    $changed += $p',
    ]),
    '  } catch {}',
    '}',
    'ConvertTo-Json -Compress @($changed)'
  ].join('\n');
  const out = runPowerShell(script, { ...env, AGY_LNK_LIST: JSON.stringify(records) }, wslEnvKeys);
  try { return [].concat(JSON.parse(out || '[]')); } catch { return []; }
}

function saveShortcutState(stateFile, state) {
  mkdirSync(dirname(stateFile), { recursive: true });
  const temp = `${stateFile}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temp, stateFile);
  } finally {
    try { unlinkSync(temp); } catch {}
  }
}

const MAC_LSREGISTER_PATH = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

function isMacAntigravityAppBundle(appPath) {
  return Boolean(
    appPath &&
    /Antigravity.*\.app$/i.test(basename(appPath)) &&
    !/^Antigravity \(Max\)\.app$/i.test(basename(appPath)) &&
    !/\.app[\\/]Contents(?:[\\/]|$)/i.test(dirname(appPath))
  );
}

function resolveMacSourceApp({ home = homedir(), env = process.env, execPath = process.execPath, sandbox = false, excludeAppDir = '', macSourceApp } = {}) {
  if (typeof macSourceApp === 'string') return macSourceApp;
  const resolvedHome = resolve(home);
  const excluded = excludeAppDir ? resolve(excludeAppDir) : '';
  const isUsableApp = candidate => {
    if (!candidate || !existsSync(candidate)) return false;
    const resolved = resolve(candidate);
    if (resolved === excluded) return false;
    if (sandbox && !resolved.startsWith(resolvedHome + sep)) return false;
    return true;
  };
  for (const seed of [env.ANTIGRAVITY_AGENTAPI_EXE, execPath].filter(Boolean)) {
    for (let cur = dirname(seed); cur && cur !== dirname(cur); cur = dirname(cur)) {
      if (isMacAntigravityAppBundle(cur) && isUsableApp(cur)) return cur;
    }
  }
  const candidates = [join(home, 'Applications', 'Antigravity.app')];
  if (!sandbox) candidates.unshift('/Applications/Antigravity.app');
  for (const candidate of candidates) {
    if (isUsableApp(candidate)) return candidate;
  }
  return '';
}

function resolveMacAppIcon(sourceApp) {
  if (!sourceApp) return '';
  const resourcesDir = join(sourceApp, 'Contents', 'Resources');
  if (!existsSync(resourcesDir)) return '';
  let declared = '';
  try {
    const plist = readFileSync(join(sourceApp, 'Contents', 'Info.plist'), 'utf8');
    const raw = (plist.match(/<key>\s*CFBundleIconFile\s*<\/key>\s*<string>([^<]+)<\/string>/)?.[1] || '').trim();
    declared = raw ? basename(raw) : '';
  } catch {}
  const candidates = [
    declared && declared.toLowerCase().endsWith('.icns') ? declared : '',
    declared && !declared.toLowerCase().endsWith('.icns') ? `${declared}.icns` : '',
    'icon.icns',
    'Antigravity.icns',
    'app.icns',
    'electron.icns'
  ].filter(Boolean);
  for (const name of candidates) {
    const candidate = join(resourcesDir, name);
    if (existsSync(candidate)) return candidate;
  }
  try {
    const fallback = readdirSync(resourcesDir).sort().find(name => name.toLowerCase().endsWith('.icns'));
    if (fallback) return join(resourcesDir, fallback);
  } catch {}
  return '';
}

export function configureLaunchers({
  home = homedir(),
  dataDir,
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  sandbox = !isSameHome(home, homedir(), platform),
  systemApplicationsDir = sandbox ? '' : '/usr/share/applications',
  runPowerShell = defaultRunPowerShell,
  macSourceApp,
  wsl
} = {}) {
  const wslMode = typeof wsl === 'boolean' ? wsl : isWslEnvironment({ platform, env });
  const stateFile = dataDir ? join(dataDir, 'launcher-state.json') : '';
  const state = stateFile ? readJson(stateFile, { shortcuts: [], desktopEntries: [], macApps: [] }) : { shortcuts: [], desktopEntries: [], macApps: [] };
  const updated = [];
  let iconConfigured = false;
  let macApp = '';

  if (platform === 'win32') {
    if (!stateFile) return { updated };
    const stateStat = lstatSync(stateFile, { throwIfNoEntry: false });
    if (stateStat && (!stateStat.isFile() || !Array.isArray(readJson(stateFile, null)?.shortcuts))) throw new Error('快捷方式状态无效');
    const folders = windowsShortcutFolders({ home, env, sandbox, runPowerShell });
    const candidates = windowsShortcutCandidates(folders).filter(path => canEditShortcut(folders, path));
    const toAdd = [];
    const toConfigure = [];
    let stateChanged = !stateStat;
    if (candidates.length) {
      for (const item of shortcutRecords(runPowerShell, env, candidates, 'inspect')) {
        if (!candidates.includes(item?.path) || typeof item.target !== 'string' || typeof item.beforeArgs !== 'string') continue;
        const existingIdx = state.shortcuts.findIndex(record => isSameHome(record?.path || record || '.', item.path, 'win32'));
        const existing = existingIdx >= 0 ? state.shortcuts[existingIdx] : null;
        if (existing && typeof existing === 'object' && existing.target?.toLowerCase() === item.target.toLowerCase()) {
          if (item.beforeArgs === existing.beforeArgs && existing.afterArgs && existing.afterArgs !== existing.beforeArgs) {
            toConfigure.push(existing);
          }
          continue;
        }
        const afterArgs = injectDebugArg(item.beforeArgs);
        if (afterArgs === item.beforeArgs) continue;
        const rec = { ...item, afterArgs };
        if (existingIdx >= 0) {
          state.shortcuts[existingIdx] = rec;
          stateChanged = true;
        } else {
          toAdd.push(rec);
        }
        toConfigure.push(rec);
      }
    }
    if (toAdd.length || stateChanged) {
      state.shortcuts.push(...toAdd);
      saveShortcutState(stateFile, state);
    }
    if (toConfigure.length) updated.push(...shortcutRecords(runPowerShell, env, toConfigure, 'configure'));
    return { updated };
  } else if (wslMode && (!sandbox || runPowerShell !== defaultRunPowerShell)) {
    const script = [
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      '$appData = [Environment]::GetFolderPath("ApplicationData")',
      '$dirs = @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"), (Join-Path $appData "Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar")) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique',
      '$paths = @()',
      'foreach ($d in $dirs) {',
      '  try {',
      '    Get-ChildItem -LiteralPath $d -File -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { $paths += $_.FullName }',
      '    Get-ChildItem -LiteralPath $d -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^antigravity$" } | ForEach-Object {',
      '      Get-ChildItem -LiteralPath $_.FullName -File -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { $paths += $_.FullName }',
      '    }',
      '  } catch {}',
      '}',
      '$ws = New-Object -ComObject WScript.Shell',
      '$changed = @()',
      'foreach ($p in ($paths | Select-Object -Unique)) {',
      '  try {',
      '    $s = $ws.CreateShortcut($p)',
      '    $leaf = Split-Path -Leaf $s.TargetPath',
      '    if ($leaf -match "^antigravity\\.exe$") {',
      '      $args = [string]$s.Arguments',
      '      if ($args -notmatch "(?:^|\\s)--remote-debugging-port(?:=\\S+|\\s+\\d+|\\b)") {',
      '        $s.Arguments = ($args + " --remote-debugging-port=0").Trim()',
      '        $s.Save()',
      '        $changed += $p',
      '      }',
      '    }',
      '  } catch {}',
      '}',
      'ConvertTo-Json -Compress @($changed)'
    ].join('\n');
    const out = runPowerShell(script, env);
    try {
      for (const item of JSON.parse(out || '[]')) {
        if (typeof item === 'string' && item) {
          updated.push(item);
          if (!state.shortcuts.includes(item)) state.shortcuts.push(item);
        }
      }
    } catch {}
  } else if (platform === 'linux') {
    const appsDir = join(sandbox ? join(home, '.local', 'share') : (env.XDG_DATA_HOME || join(home, '.local', 'share')), 'applications');
    const userDesktop = join(appsDir, 'antigravity.desktop');
    const systemDesktop = systemApplicationsDir ? join(systemApplicationsDir, 'antigravity.desktop') : '';
    if (existsSync(userDesktop)) {
      const patched = patchDesktopEntry(readFileSync(userDesktop, 'utf8'));
      if (patched.changed) {
        writeFileSync(userDesktop, patched.content, 'utf8');
        updated.push(userDesktop);
        if (!state.desktopEntries.some(e => e.path === userDesktop)) state.desktopEntries.push({ path: userDesktop, mode: 'patched' });
      }
    } else if (systemDesktop && existsSync(systemDesktop)) {
      const patched = patchDesktopEntry(readFileSync(systemDesktop, 'utf8'));
      if (patched.changed) {
        mkdirSync(appsDir, { recursive: true });
        writeFileSync(userDesktop, patched.content, 'utf8');
        updated.push(userDesktop);
        state.desktopEntries = [...state.desktopEntries.filter(e => e.path !== userDesktop), { path: userDesktop, mode: 'created' }];
      }
    }
  } else if (platform === 'darwin') {
    const appDir = join(home, 'Applications', 'Antigravity (Max).app');
    const macosDir = join(appDir, 'Contents', 'MacOS');
    const resourcesDir = join(appDir, 'Contents', 'Resources');
    const plistPath = join(appDir, 'Contents', 'Info.plist');
    const launcherPath = join(macosDir, 'launcher');
    const iconTargetPath = join(resourcesDir, 'icon.icns');
    const sourceApp = resolveMacSourceApp({ home, env, execPath, sandbox, excludeAppDir: appDir, macSourceApp });
    const iconSource = resolveMacAppIcon(sourceApp);
    mkdirSync(macosDir, { recursive: true });
    if (iconSource) {
      mkdirSync(resourcesDir, { recursive: true });
      copyFileSync(iconSource, iconTargetPath);
      iconConfigured = true;
    } else if (existsSync(iconTargetPath)) {
      try { unlinkSync(iconTargetPath); } catch {}
    }
    const plistLines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      '  <key>CFBundleExecutable</key><string>launcher</string>',
      '  <key>CFBundleIdentifier</key><string>io.github.wangbingnan136.agy-max.launcher</string>',
      '  <key>CFBundleName</key><string>Antigravity (Max)</string>',
      '  <key>CFBundlePackageType</key><string>APPL</string>'
    ];
    if (iconConfigured) {
      plistLines.push('  <key>CFBundleIconFile</key><string>icon.icns</string>');
    }
    plistLines.push('</dict></plist>');
    writeFileSync(plistPath, plistLines.join('\n'), 'utf8');
    const launchTarget = (sourceApp || '/Applications/Antigravity.app').replace(/(["\\$`])/g, '\\$1');
    // After ⌘Q the old instance takes a few seconds to exit and swallows `open -a`; wait for it first.
    // shortcut: the quitting check reads the stock Antigravity main.log; a renamed build falls back to plain open.
    writeFileSync(launcherPath, [
      '#!/bin/sh',
      `app="${launchTarget}"`,
      'pid=$(/bin/ps -axo pid=,args= | /usr/bin/awk -v p="$app/Contents/MacOS/" \'{ pid=$1; sub(/^ *[0-9]+ +/, ""); if (index($0, p) == 1) { print pid; exit } }\')',
      'if [ -n "$pid" ] && /usr/bin/tail -n 50 "$HOME/Library/Logs/Antigravity/main.log" 2>/dev/null | /usr/bin/grep -E "Starting app|Shutting down language server" | /usr/bin/tail -n 1 | /usr/bin/grep -q "Shutting down"; then',
      '  i=0; while [ $i -lt 50 ] && kill -0 "$pid" 2>/dev/null; do sleep 0.2; i=$((i+1)); done',
      '  sleep 0.3',
      'fi',
      'exec open -a "$app" --args --remote-debugging-port=0 "$@"',
      ''
    ].join('\n'), { mode: 0o755 });
    try { chmodSync(launcherPath, 0o755); } catch {}
    if (!sandbox) {
      try { const now = new Date(); utimesSync(appDir, now, now); } catch {}
      if (iconConfigured && existsSync(MAC_LSREGISTER_PATH)) {
        try { spawnSync(MAC_LSREGISTER_PATH, ['-f', appDir], { stdio: 'ignore', timeout: 3000 }); } catch {}
      }
    }
    macApp = appDir;
    updated.push(appDir);
    if (!state.macApps.includes(appDir)) state.macApps.push(appDir);
  }

  if (stateFile && (updated.length || existsSync(stateFile))) writeJson(stateFile, state);
  return platform === 'darwin' ? { updated, macApp, iconConfigured } : { updated };
}

function isSafeOwnedPath(root, target) {
  if (!root || !target || typeof target !== 'string') return false;
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (
    !rel ||
    rel === '.' ||
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    rel.startsWith('../') ||
    rel.startsWith('..\\') ||
    isAbsolute(rel)
  ) {
    return false;
  }
  const rootStat = lstatSync(resolvedRoot, { throwIfNoEntry: false });
  if (rootStat?.isSymbolicLink()) return false;
  let cur = resolvedRoot;
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    cur = join(cur, part);
    const st = lstatSync(cur, { throwIfNoEntry: false });
    if (st?.isSymbolicLink()) return false;
  }
  return true;
}

export function restoreLaunchers({
  home = homedir(),
  dataDir,
  platform = process.platform,
  env = process.env,
  sandbox = !isSameHome(home, homedir(), platform),
  runPowerShell = defaultRunPowerShell,
  wsl
} = {}) {
  const wslMode = typeof wsl === 'boolean' ? wsl : isWslEnvironment({ platform, env });
  const stateFile = dataDir ? join(dataDir, 'launcher-state.json') : '';
  const state = stateFile ? readJson(stateFile, { shortcuts: [], desktopEntries: [], macApps: [] }) : { shortcuts: [], desktopEntries: [], macApps: [] };
  const restored = [];

  if (platform === 'win32') {
    const stateStat = stateFile && lstatSync(stateFile, { throwIfNoEntry: false });
    if (!stateStat || !stateStat.isFile() || !Array.isArray(readJson(stateFile, null)?.shortcuts)) return { restored };
    const folders = windowsShortcutFolders({ home, env, sandbox, runPowerShell });
    const records = state.shortcuts;
    const candidates = records.filter(record => {
      if (typeof record === 'string') return canEditShortcut(folders, record);
      return canEditShortcut(folders, record?.path) && typeof record.target === 'string' &&
        typeof record.beforeArgs === 'string' && record.afterArgs === injectDebugArg(record.beforeArgs) && record.afterArgs !== record.beforeArgs;
    });
    if (candidates.length) restored.push(...shortcutRecords(runPowerShell, env, candidates, 'restore'));
    if (stateStat) {
      const remaining = records.filter(record => !restored.includes(record?.path || record));
      if (remaining.length) saveShortcutState(stateFile, { ...state, shortcuts: remaining });
      else unlinkSync(stateFile);
    }
    return { restored };
  } else if (wslMode && (!sandbox || runPowerShell !== defaultRunPowerShell)) {
    const psEnv = { ...env, AGY_LNK_LIST: JSON.stringify(state.shortcuts || []) };
    const script = [
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      '$appData = [Environment]::GetFolderPath("ApplicationData")',
      '$dirs = @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"), (Join-Path $appData "Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar")) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique',
      '$paths = @()',
      'try { foreach ($x in ($env:AGY_LNK_LIST | ConvertFrom-Json)) { if ($x) { $paths += $x } } } catch {}',
      'foreach ($d in $dirs) {',
      '  try {',
      '    Get-ChildItem -LiteralPath $d -File -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { $paths += $_.FullName }',
      '    Get-ChildItem -LiteralPath $d -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^antigravity$" } | ForEach-Object {',
      '      Get-ChildItem -LiteralPath $_.FullName -File -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { $paths += $_.FullName }',
      '    }',
      '  } catch {}',
      '}',
      '$ws = New-Object -ComObject WScript.Shell',
      '$changed = @()',
      'foreach ($p in ($paths | Select-Object -Unique)) {',
      '  try {',
      '    if (-not (Test-Path -LiteralPath $p)) { continue }',
      '    $s = $ws.CreateShortcut($p)',
      '    $leaf = Split-Path -Leaf $s.TargetPath',
      '    if ($leaf -match "^antigravity\\.exe$" -and ([string]$s.Arguments) -match "--remote-debugging-port=0") {',
      '      $s.Arguments = (([string]$s.Arguments) -replace "(?:^|\\s+)--remote-debugging-port=0(?=\\s|$)", " ").Trim()',
      '      $s.Save()',
      '      $changed += $p',
      '    }',
      '  } catch {}',
      '}',
      'ConvertTo-Json -Compress @($changed)'
    ].join('\n');
    const out = runPowerShell(script, psEnv, ['AGY_LNK_LIST']);
    try {
      for (const item of JSON.parse(out || '[]')) if (typeof item === 'string' && item) restored.push(item);
    } catch {}
  } else if (platform === 'linux') {
    const fallbackPath = join(sandbox ? join(home, '.local', 'share') : (env.XDG_DATA_HOME || join(home, '.local', 'share')), 'applications', 'antigravity.desktop');
    const entries = state.desktopEntries?.length ? state.desktopEntries : [{ path: fallbackPath, mode: 'patched' }];
    for (const entry of entries) {
      if (!entry?.path || !isSafeOwnedPath(home, entry.path)) continue;
      const resolvedPath = resolve(entry.path);
      if (basename(resolvedPath) !== 'antigravity.desktop') continue;
      const st = lstatSync(resolvedPath, { throwIfNoEntry: false });
      if (!st || !st.isFile()) continue;
      if (entry.mode === 'created') {
        try { unlinkSync(resolvedPath); restored.push(entry.path); } catch {}
      } else {
        const unpatched = unpatchDesktopEntry(readFileSync(resolvedPath, 'utf8'));
        if (unpatched.changed) {
          writeFileSync(resolvedPath, unpatched.content, 'utf8');
          restored.push(entry.path);
        }
      }
    }
  } else if (platform === 'darwin') {
    const targets = state.macApps?.length ? state.macApps : [join(home, 'Applications', 'Antigravity (Max).app')];
    for (const appDir of targets) {
      if (!appDir || !isSafeOwnedPath(home, appDir)) continue;
      const resolvedDir = resolve(appDir);
      if (basename(resolvedDir) !== 'Antigravity (Max).app') continue;
      const st = lstatSync(resolvedDir, { throwIfNoEntry: false });
      if (!st || !st.isDirectory()) continue;
      try { rmSync(resolvedDir, { recursive: true, force: true }); restored.push(appDir); } catch {}
    }
  }

  if (stateFile && existsSync(stateFile)) {
    try { unlinkSync(stateFile); } catch {}
  }
  return { restored };
}

export function resolveAntigravityExecutable({ platform = process.platform, env = process.env, home = homedir(), execPath = process.execPath, wsl, resolveWslExe = resolveWslWindowsExecutable } = {}) {
  const wslMode = typeof wsl === 'boolean' ? wsl : isWslEnvironment({ platform, env });
  const agentExe = env.ANTIGRAVITY_AGENTAPI_EXE || '';
  if (wslMode) {
    return resolveWslExe({ env })?.winPath || '';
  }
  if (platform === 'win32') {
    if (agentExe) {
      const candidate = join(dirname(dirname(dirname(agentExe))), 'Antigravity.exe');
      if (existsSync(candidate)) return candidate;
    }
    if (execPath && /^antigravity\.exe$/i.test(basename(execPath)) && existsSync(execPath)) {
      return execPath;
    }
    const candidates = [
      join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs', 'antigravity', 'Antigravity.exe'),
      env.ProgramFiles && join(env.ProgramFiles, 'Antigravity', 'Antigravity.exe'),
      env.ProgramFiles && join(env.ProgramFiles, 'antigravity', 'Antigravity.exe'),
      env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Antigravity', 'Antigravity.exe')
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return '';
  }
  if (platform === 'darwin') {
    for (const seed of [agentExe, execPath].filter(Boolean)) {
      for (let cur = dirname(seed); cur && cur !== dirname(cur); cur = dirname(cur)) {
        if (isMacAntigravityAppBundle(cur) && existsSync(cur)) return cur;
      }
    }
    for (const candidate of ['/Applications/Antigravity.app', join(home, 'Applications', 'Antigravity.app')]) {
      if (existsSync(candidate)) return candidate;
    }
    return '';
  }
  if (env.APPIMAGE && existsSync(env.APPIMAGE)) return env.APPIMAGE;
  if (agentExe) {
    const candidate = join(dirname(dirname(dirname(agentExe))), 'antigravity');
    if (existsSync(candidate)) return candidate;
  }
  if (execPath && /^antigravity$/i.test(basename(execPath)) && existsSync(execPath)) {
    return execPath;
  }
  for (const candidate of ['/usr/share/antigravity/antigravity', '/opt/Antigravity/antigravity', '/usr/bin/antigravity']) {
    if (existsSync(candidate)) return candidate;
  }
  return '';
}

function readCustomLauncher(dataDir, platform) {
  const configPath = join(dataDir, 'launcher-config.json');
  if (!isSafeOwnedPath(dataDir, configPath) || !lstatSync(configPath, { throwIfNoEntry: false })?.isFile()) return null;
  const config = readJson(configPath, null)?.customLauncher;
  if (!config || typeof config !== 'object') return null;
  const { command, args = [], cwd, appendDefaultArgs = true } = config;
  const validText = value => typeof value === 'string' && !/[\x00-\x1f\x7f]/.test(value);
  const validPath = value => validText(value) && isAbsolute(value);
  if (!validPath(command) || !Array.isArray(args) || args.length > 128 || !args.every(validText)) return null;
  if (cwd !== undefined && !validPath(cwd)) return null;
  try {
    const st = lstatSync(command);
    const isWinAppAlias = platform === 'win32' && st.isSymbolicLink() && /\.exe$/i.test(command);
    if (!isWinAppAlias && !statSync(command).isFile()) return null;
    if (cwd && !statSync(cwd).isDirectory()) return null;
    if (platform === 'win32' && !/\.(exe|com|cmd|bat|ps1)$/i.test(command)) return null;
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(command)) windowsCmdInvocation(command, args);
  } catch { return null; }
  return { command, args, cwd: cwd ?? dirname(command), appendDefaultArgs: appendDefaultArgs !== false };
}

export function hasCustomLauncher(dataDir, { platform = process.platform, env = process.env, wsl } = {}) {
  const wslMode = typeof wsl === 'boolean' ? wsl : isWslEnvironment({ platform, env });
  return Boolean(!wslMode && dataDir && readCustomLauncher(dataDir, platform));
}

export function readPostUpdateMode(dataDir) {
  if (!dataDir) return 'prompt';
  const configPath = join(dataDir, 'launcher-config.json');
  if (!isSafeOwnedPath(dataDir, configPath) || !lstatSync(configPath, { throwIfNoEntry: false })?.isFile()) return 'prompt';
  const raw = readJson(configPath, null)?.postUpdateMode;
  if (raw === 'auto' || raw === 'silent' || raw === 'prompt') return raw;
  return 'prompt';
}

function executableSignature(targetPath) {
  if (!targetPath) return '';
  try {
    const st = statSync(targetPath);
    return `${targetPath}|${Math.trunc(st.mtimeMs)}|${st.size}`;
  } catch {
    return String(targetPath);
  }
}

export function clearAutoRelaunchAttempt(dataDir) {
  if (!dataDir) return;
  const stateFile = join(dataDir, 'relaunch-state.json');
  const prev = readJson(stateFile, null);
  if (!prev || typeof prev !== 'object' || !prev.lastAutoRelaunchTargetSig) return;
  const next = { ...prev };
  delete next.lastAutoRelaunchTargetSig;
  writeJson(stateFile, next);
}

function launchArguments(args = [], extra = [], { appendDefaultArgs = true } = {}) {
  if (!appendDefaultArgs) return [...args];
  return [...args, ...(!args.some(arg => /^--remote-debugging-port(?:=|$)/.test(arg)) ? [DEBUG_FLAG] : []), ...extra];
}

function shSingleQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function manualLaunchCommand({ platform = process.platform, env = process.env, home = homedir(), dataDir = join(home, '.gemini', 'antigravity', 'plugin_data', 'agy-max'), execPath = process.execPath, wsl, resolveWslExe = resolveWslWindowsExecutable } = {}) {
  const wslMode = typeof wsl === 'boolean' ? wsl : isWslEnvironment({ platform, env });
  const custom = !wslMode && readCustomLauncher(dataDir, platform);
  if (custom) {
    const args = launchArguments(custom.args, [], { appendDefaultArgs: custom.appendDefaultArgs });
    if (platform === 'win32') {
      const argStr = args.length ? ` ${args.map(psSingleQuote).join(' ')}` : '';
      return `Push-Location -LiteralPath ${psSingleQuote(custom.cwd)}; try { & ${psSingleQuote(custom.command)}${argStr} } finally { Pop-Location }`;
    }
    return `(cd ${shSingleQuote(custom.cwd)} && ${[custom.command, ...args].map(shSingleQuote).join(' ')})`;
  }
  const target = resolveAntigravityExecutable({ platform, env, home, execPath, wsl: wslMode, resolveWslExe });
  if (!target) return '';
  if (platform === 'win32') return `& ${psSingleQuote(target)} ${DEBUG_FLAG}`;
  if (wslMode) return `"${target}" ${DEBUG_FLAG}`;
  if (platform === 'darwin') return `open -n -a "${target}" --args ${DEBUG_FLAG}`;
  return `"${target}" ${DEBUG_FLAG}`;
}

function cleanGuiEnv(env) {
  const copy = { ...env };
  for (const key of Object.keys(copy)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'NODE_OPTIONS' || key.startsWith('ANTIGRAVITY_SIDECAR_') || key === 'ANTIGRAVITY_LS_ADDRESS' || key === 'ANTIGRAVITY_CSRF_TOKEN' || key === 'ANTIGRAVITY_AGENTAPI_EXE') {
      delete copy[key];
    }
  }
  return copy;
}

const LOOPBACK_BYPASS = ['localhost', '127.0.0.1', '::1', '[::1]'];

function proxyBypass(raw = '') {
  const seen = new Set();
  const bypassList = [...LOOPBACK_BYPASS, ...raw.split(/[,;\s]+/)].filter(item => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const chromiumBypass = [...new Set(bypassList.map(item => item === '::1' ? '[::1]' : item))].join(';');
  return { bypass: bypassList.join(','), chromiumBypass };
}

function resolveLaunchProxy({ dataDir, proxy } = {}) {
  let raw = proxy;
  if (raw === undefined && dataDir) {
    const saved = readJson(join(dataDir, 'settings.json'), null);
    const modManifest = readJson(join(dataDir, 'modules-manifest.json'), null);
    const proxyModuleUninstalled = Boolean(
      modManifest
      && Array.isArray(modManifest.installed)
      && !modManifest.installed.includes('proxy')
      && Array.isArray(modManifest.explicitlyUninstalled)
      && modManifest.explicitlyUninstalled.includes('proxy')
    );
    if (saved && typeof saved === 'object' && !proxyModuleUninstalled) {
      raw = {
        enabled: Boolean(saved.proxyEnabled),
        url: typeof saved.proxyUrl === 'string' ? saved.proxyUrl : '',
        bypass: typeof saved.proxyBypass === 'string' ? saved.proxyBypass : '',
        forceHttp1: Boolean(saved.proxyForceHttp1)
      };
    }
  }
  const empty = { enabled: false, url: '', hasCredentials: false, forceHttp1: false, specKey: '', chromiumServer: '', ...proxyBypass() };
  if (!raw || !raw.enabled || typeof raw.url !== 'string') return empty;
  const trimmed = raw.url.trim();
  if (!trimmed || trimmed.length > 256 || /[\x00-\x1f\x7f\s'"`\\;$|&<>]/.test(trimmed)) return empty;
  let parsed;
  try { parsed = new URL(trimmed); } catch { return empty; }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname) return empty;
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) return empty;
  const hasCredentials = Boolean(parsed.username || parsed.password);
  const auth = hasCredentials ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@` : '';
  const host = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[') ? `[${parsed.hostname}]` : parsed.hostname;
  const port = parsed.port ? `:${parsed.port}` : '';
  const url = `${parsed.protocol}//${auth}${host}${port}`;
  const bypassRaw = typeof raw.bypass === 'string' && !/[\x00-\x1f\x7f'"`\\$|&<>]/.test(raw.bypass) ? raw.bypass : '';
  const { bypass, chromiumBypass } = proxyBypass(bypassRaw);
  const forceHttp1 = Boolean(raw.forceHttp1);
  const chromeScheme = parsed.protocol === 'socks5h:' ? 'socks5:' : parsed.protocol;
  const chromiumServer = `${chromeScheme}//${host}${port}`;
  return {
    enabled: true,
    url,
    hasCredentials,
    bypass,
    forceHttp1,
    specKey: `${url}|${bypass}|${forceHttp1 ? 'h1' : 'auto'}`,
    chromiumServer,
    chromiumBypass
  };
}

function inheritedLaunchProxy(env) {
  const variables = {};
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
    const value = env[name] || env[name.toLowerCase()];
    if (typeof value === 'string' && value.trim()) variables[name] = value;
  }
  if (!Object.keys(variables).length) return null;
  const rawBypass = [env.NO_PROXY, env.no_proxy]
    .filter(value => typeof value === 'string')
    .flatMap(value => value.split(/[,;\s]+/))
    .filter(item => item && !/[\x00-\x1f\x7f'"`\\$|&<>^%!]/.test(item))
    .join(',');
  const { bypass, chromiumBypass } = proxyBypass(rawBypass);
  const parseServer = raw => {
    if (!raw) return '';
    return resolveLaunchProxy({ proxy: { enabled: true, url: raw.includes('://') ? raw : `http://${raw}` } }).chromiumServer;
  };
  const httpServer = parseServer(variables.HTTP_PROXY);
  const httpsServer = parseServer(variables.HTTPS_PROXY);
  const allServer = parseServer(variables.ALL_PROXY);
  let chromiumServer = '';
  if (allServer && (!httpServer || httpServer === allServer) && (!httpsServer || httpsServer === allServer)) {
    chromiumServer = allServer;
  } else {
    const rules = [];
    if (httpServer) rules.push(`http=${httpServer}`);
    else if (allServer) rules.push(`http=${allServer}`);
    if (httpsServer) rules.push(`https=${httpsServer}`);
    else if (allServer) rules.push(`https=${allServer}`);
    if (allServer && /^socks/i.test(allServer)) rules.push(`socks=${allServer}`);
    chromiumServer = rules.join(';');
  }
  return { variables: { ...variables, NO_PROXY: bypass }, chromiumServer, chromiumBypass };
}

function psSingleQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function sanitizeOnboardingSync(value) {
  if (!value || typeof value !== 'object') return null;
  const email = typeof value.email === 'string' ? value.email.trim() : '';
  if (!/^[^\s@"'`\\;|$<>]{1,120}@[^\s@"'`\\;|$<>]{1,120}\.[^\s@"'`\\;|$<>]{1,63}$/.test(email)) return null;
  return { email, isGcpTos: typeof value.isGcpTos === 'boolean' ? value.isGcpTos : null };
}

function quoteWindowsArgument(value) {
  if (value && !/[\s"]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

function windowsStartCommand(target, custom, args, env) {
  if (!custom) {
    const argPart = args.length ? ` -ArgumentList (@(${args.map(quoteWindowsArgument).map(psSingleQuote).join(', ')}) -join ' ')` : '';
    return `Start-Process -FilePath $target${argPart} -WorkingDirectory (Split-Path -Parent $target)`;
  }
  const { command, cwd } = custom;
  let file = command, argumentList = args.map(quoteWindowsArgument).join(' ');
  let hideWindow = /^(?:pwsh|powershell)(?:\.exe)?$/i.test(basename(command)) || /\.ps1$/i.test(command);
  if (/\.ps1$/i.test(command)) {
    file = 'powershell.exe';
    argumentList = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', command, ...args].map(quoteWindowsArgument).join(' ');
  } else if (WINDOWS_CMD_WRAPPER_RE.test(command)) {
    const invocation = windowsCmdInvocation(command, args, env);
    file = invocation.command;
    argumentList = invocation.args.join(' ');
    hideWindow = true;
  }
  const argClause = argumentList ? ` -ArgumentList ${psSingleQuote(argumentList)}` : '';
  return `Start-Process -FilePath ${psSingleQuote(file)}${argClause} -WorkingDirectory ${psSingleQuote(cwd)}${hideWindow ? ' -WindowStyle Hidden' : ''}`;
}

export function scheduleRelaunchWithDebugPort({
  dataDir,
  home = homedir(),
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  proxy,
  onboardingSync = null,
  appStoragePath = '',
  spawnProcess = spawn,
  wsl,
  resolveWslExe = resolveWslWindowsExecutable,
  resolveWslTemp = resolveWslWindowsTemp,
  toWindowsPath = wslPathToWindows
} = {}) {
  const wslMode = typeof wsl === 'boolean' ? wsl : isWslEnvironment({ platform, env });
  const custom = !wslMode && readCustomLauncher(dataDir || join(home, '.gemini', 'antigravity', 'plugin_data', 'agy-max'), platform);
  const target = resolveAntigravityExecutable({ platform, env, home, execPath, wsl: wslMode, resolveWslExe });
  if (!target && !custom) throw new Error('未找到 Antigravity 启动程序');
  if (dataDir) {
    const stateFile = join(dataDir, 'relaunch-state.json');
    const prev = readJson(stateFile, {});
    writeJson(stateFile, { ...prev, lastRelaunchAt: Date.now(), lastPromptLsAddress: env.ANTIGRAVITY_LS_ADDRESS || '' });
  }

  const launchProxy = resolveLaunchProxy({ dataDir, proxy });
  const cleanOnboarding = sanitizeOnboardingSync(onboardingSync);
  const resolvedStoragePath = cleanOnboarding
    ? (appStoragePath || antigravityUserDataDir({ platform, env, home, wsl: wslMode }))
    : '';
  const clearManagedProxy = !launchProxy.enabled && Boolean(env.AGY_POWERTOOLS_PROXY_SPEC?.trim());
  const childEnv = { ...cleanGuiEnv(env), AGY_RELAUNCH_TARGET: target };
  if (platform === 'win32' || wslMode) {
    let scriptWritePath = '';
    let winScriptPath = '';
    const scriptName = wslMode ? 'agy-powertools-relaunch.ps1' : `relaunch-antigravity-${randomUUID()}.ps1`;
    if (wslMode) {
      const winTemp = resolveWslTemp({ env });
      if (winTemp?.wslPath && winTemp?.winPath) {
        mkdirSync(winTemp.wslPath, { recursive: true });
        scriptWritePath = join(winTemp.wslPath, scriptName);
        winScriptPath = `${winTemp.winPath.replace(/[\\/]+$/, '')}\\${scriptName}`;
      } else {
        const scriptDir = dataDir || tmpdir();
        mkdirSync(scriptDir, { recursive: true });
        scriptWritePath = join(scriptDir, scriptName);
        winScriptPath = toWindowsPath(scriptWritePath, { env }) || scriptWritePath;
      }
    } else {
      const scriptDir = dataDir || tmpdir();
      mkdirSync(scriptDir, { recursive: true });
      scriptWritePath = join(scriptDir, scriptName);
      winScriptPath = scriptWritePath;
    }
    const winStoragePath = cleanOnboarding && resolvedStoragePath
      ? (wslMode ? (toWindowsPath(resolvedStoragePath, { env }) || resolvedStoragePath) : resolvedStoragePath)
      : '';
    const inherited = !launchProxy.enabled && !clearManagedProxy ? inheritedLaunchProxy(env) : null;
    const proxyEnvLines = launchProxy.enabled
      ? [
          `$env:HTTP_PROXY = ${psSingleQuote(launchProxy.url)}`,
          `$env:HTTPS_PROXY = ${psSingleQuote(launchProxy.url)}`,
          `$env:ALL_PROXY = ${psSingleQuote(launchProxy.url)}`,
          `$env:http_proxy = ${psSingleQuote(launchProxy.url)}`,
          `$env:https_proxy = ${psSingleQuote(launchProxy.url)}`,
          `$env:all_proxy = ${psSingleQuote(launchProxy.url)}`,
          `$env:NO_PROXY = ${psSingleQuote(launchProxy.bypass)}`,
          `$env:no_proxy = ${psSingleQuote(launchProxy.bypass)}`,
          `$env:AGY_POWERTOOLS_PROXY_SPEC = ${psSingleQuote(launchProxy.specKey)}`,
          ...(launchProxy.forceHttp1
            ? ["$env:GODEBUG = 'http2client=0'"]
            : ["if ($env:GODEBUG -eq 'http2client=0') { Remove-Item Env:GODEBUG -ErrorAction SilentlyContinue }"])
        ]
      : clearManagedProxy ? [
          "Remove-Item Env:HTTP_PROXY,Env:HTTPS_PROXY,Env:ALL_PROXY,Env:http_proxy,Env:https_proxy,Env:all_proxy,Env:NO_PROXY,Env:no_proxy,Env:AGY_POWERTOOLS_PROXY_SPEC -ErrorAction SilentlyContinue",
          "if ($env:GODEBUG -eq 'http2client=0') { Remove-Item Env:GODEBUG -ErrorAction SilentlyContinue }"
        ] : Object.entries(inherited?.variables || {}).flatMap(([name, value]) => [
          `$env:${name} = ${psSingleQuote(value)}`,
          `$env:${name.toLowerCase()} = ${psSingleQuote(value)}`
        ]);
    const chromium = launchProxy.enabled ? launchProxy : inherited;
    const proxyArgs = chromium?.chromiumServer ? [`--proxy-server=${chromium.chromiumServer}`, `--proxy-bypass-list=${chromium.chromiumBypass}`] : [];
    const startArgs = launchArguments(custom?.args, proxyArgs, { appendDefaultArgs: custom ? custom.appendDefaultArgs : true });
    const relaunchBody = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "Start-Sleep -Milliseconds 350",
      `$target = ${psSingleQuote(target)}`,
      "$sessionId = (Get-Process -Id $PID).SessionId",
      "$canInspect = $true",
      "function Get-AgyProcs {",
      "  if (-not $target -or -not $script:canInspect) { return }",
      "  try {",
      "    Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe' AND SessionId = $sessionId\" -ErrorAction Stop | Where-Object {",
      "      $_.ExecutablePath -and $_.ExecutablePath.Equals($target, [System.StringComparison]::OrdinalIgnoreCase)",
      "    }",
      "  } catch { $script:canInspect = $false }",
      "}",
      "function Get-AgyProcess($record) {",
      "  $p = Get-Process -Id ([int]$record.ProcessId)",
      "  if ($p -and $p.SessionId -eq $sessionId -and $p.Path -ieq $target) { $p }",
      "}",
      "try {",
      "  foreach ($record in @(Get-AgyProcs)) {",
      "    if (-not $record.CommandLine -or $record.CommandLine -match '(?:^|\\s)\"?--(?:type|import)=') { continue }",
      "    $p = Get-AgyProcess $record",
      "    if ($p -and $p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() }",
      "  }",
      "  $deadline = (Get-Date).AddSeconds(3)",
      "  while ((Get-Date) -lt $deadline -and @(Get-AgyProcs).Count -gt 0) { Start-Sleep -Milliseconds 250 }",
      "  foreach ($record in @(Get-AgyProcs)) {",
      "    $p = Get-AgyProcess $record",
      "    if ($p) { Stop-Process -InputObject $p -Force }",
      "  }",
      "  $deadline = (Get-Date).AddSeconds(6)",
      "  while ((Get-Date) -lt $deadline -and @(Get-AgyProcs).Count -gt 0) { Start-Sleep -Milliseconds 250 }",
      "  if (-not $script:canInspect -or @(Get-AgyProcs).Count -gt 0) { return }",
      "  Start-Sleep -Milliseconds 400",
      ...(cleanOnboarding && winStoragePath ? [
          "  try {",
          `    $storagePath = ${psSingleQuote(winStoragePath)}`,
          "    if (Test-Path -LiteralPath $storagePath) {",
          "      $rawStorage = Get-Content -LiteralPath $storagePath -Raw -Encoding UTF8",
          "      $storageObj = $rawStorage | ConvertFrom-Json",
          "      if ($storageObj -is [System.Management.Automation.PSCustomObject]) {",
          `        $storageObj | Add-Member -NotePropertyName 'agy.onboarding.lastLoginUsername' -NotePropertyValue ${psSingleQuote(cleanOnboarding.email)} -Force`,
          ...(cleanOnboarding.isGcpTos === null ? [] : [`        $storageObj | Add-Member -NotePropertyName 'agy.onboarding.lastLoginIsGcpTos' -NotePropertyValue ${psSingleQuote(String(cleanOnboarding.isGcpTos))} -Force`]),
          "        $tmpStorage = $storagePath + '.agy.tmp'",
          "        $jsonOut = $storageObj | ConvertTo-Json -Depth 100",
          "        [System.IO.File]::WriteAllText($tmpStorage, $jsonOut, [System.Text.UTF8Encoding]::new($false))",
          "        Move-Item -LiteralPath $tmpStorage -Destination $storagePath -Force",
          "      }",
          "    }",
          "  } catch {}"
        ] : []),
      ...proxyEnvLines.map(line => `  ${line}`),
      `  ${windowsStartCommand(target, custom, startArgs, env)}`,
      "} finally {",
      "  Remove-Item -LiteralPath $PSCommandPath -Force",
      "}",
    ].join('\r\n');
    writeFileSync(scriptWritePath, '\uFEFF' + relaunchBody + '\r\n', { mode: 0o600, flag: wslMode ? 'w' : 'wx' });

    // Launch via Explorer.exe Desktop COM (ShellWindows FindWindowSW -> ShellExecute) using -EncodedCommand
    // without detached:true on the short-lived trigger (PowerShell 5.1 exits silently under DETACHED_PROCESS + windowsHide).
    // Explorer.exe spawns relaunch-antigravity.ps1 completely outside Antigravity's Win32 Job Object and avoids WMI ASR blocks.
    const launcherScript = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$script = $env:AGY_RELAUNCH_SCRIPT",
      '$psArgs = \'-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "\' + $script + \'"\'',
      '$launched = $false',
      'try {',
      "  $shellWin = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'9BA05972-F6A8-11CF-A442-00A0C90A8F39'))",
      '  $hwnd = 0',
      '  $disp = $shellWin.FindWindowSW(0, 0, 8, [ref]$hwnd, 1)',
      '  if ($disp -and $disp.Document -and $disp.Document.Application) {',
      "    $disp.Document.Application.ShellExecute('powershell.exe', $psArgs, '', 'open', 0)",
      '    $launched = $true',
      '  }',
      '} catch {}',
      'if (-not $launched) {',
      '  try {',
      '    Add-Type -TypeDefinition @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public static class AgyBreakawayLaunch {',
      '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
      '  public struct STARTUPINFO {',
      '    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;',
      '    public int dwX; public int dwY; public int dwXSize; public int dwYSize;',
      '    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;',
      '    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;',
      '    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;',
      '  }',
      '  [StructLayout(LayoutKind.Sequential)]',
      '  public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }',
      '  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]',
      '  public static extern bool CreateProcessW(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);',
      '  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);',
      '  public static bool Run(string cmd) {',
      '    var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si); si.dwFlags = 1; si.wShowWindow = 0;',
      '    PROCESS_INFORMATION pi;',
      '    if (!CreateProcessW(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x01000000u | 0x08000000u, IntPtr.Zero, null, ref si, out pi)) return false;',
      '    CloseHandle(pi.hThread); CloseHandle(pi.hProcess); return true;',
      '  }',
      '}',
      '"@',
      "    if ([AgyBreakawayLaunch]::Run('powershell.exe ' + $psArgs)) { $launched = $true }",
      '  } catch {}',
      '}',
      'if (-not $launched) {',
      "  Start-Process -FilePath 'powershell.exe' -ArgumentList $psArgs -WindowStyle Hidden",
      '}'
    ].join('\r\n');
    const encodedLauncher = Buffer.from(launcherScript, 'utf16le').toString('base64');
    const launchEnv = wslMode
      ? appendWslEnv({ ...childEnv, AGY_RELAUNCH_SCRIPT: winScriptPath }, ['AGY_RELAUNCH_SCRIPT'])
      : { ...childEnv, AGY_RELAUNCH_SCRIPT: winScriptPath };

    const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedLauncher], {
      stdio: 'ignore',
      windowsHide: true,
      env: launchEnv
    });
    child.on?.('error', () => { try { unlinkSync(scriptWritePath); } catch {} });
    child.unref?.();
    return { scheduled: true, target: custom?.command || target, proxyActive: launchProxy.enabled || Boolean(inherited) };
  }

  const onboardingShellEnv = cleanOnboarding && resolvedStoragePath
    ? {
        AGY_ONBOARDING_STORAGE: resolvedStoragePath,
        AGY_ONBOARDING_EMAIL: cleanOnboarding.email,
        AGY_ONBOARDING_GCP_TOS: cleanOnboarding.isGcpTos === null ? '' : String(cleanOnboarding.isGcpTos),
        AGY_NODE_BIN: execPath
      }
    : {};
  const posixOnboardingLines = cleanOnboarding && resolvedStoragePath
    ? [
        'if [ -n "$AGY_ONBOARDING_STORAGE" ] && [ -n "$AGY_ONBOARDING_EMAIL" ] && [ -f "$AGY_ONBOARDING_STORAGE" ]; then ELECTRON_RUN_AS_NODE=1 "$AGY_NODE_BIN" -e "const fs=require(\'fs\'),p=process.env.AGY_ONBOARDING_STORAGE;try{const d=JSON.parse(fs.readFileSync(p,\'utf8\'));if(d&&typeof d===\'object\'&&!Array.isArray(d)){d[\'agy.onboarding.lastLoginUsername\']=process.env.AGY_ONBOARDING_EMAIL;if(process.env.AGY_ONBOARDING_GCP_TOS===\'true\'||process.env.AGY_ONBOARDING_GCP_TOS===\'false\')d[\'agy.onboarding.lastLoginIsGcpTos\']=process.env.AGY_ONBOARDING_GCP_TOS;fs.writeFileSync(p+\'.agy.tmp\',JSON.stringify(d,null,2),\'utf8\');fs.renameSync(p+\'.agy.tmp\',p);}}catch{}" >/dev/null 2>&1 || true; fi',
        'unset AGY_ONBOARDING_STORAGE AGY_ONBOARDING_EMAIL AGY_ONBOARDING_GCP_TOS AGY_NODE_BIN'
      ]
    : [];

  const proxyShellEnv = launchProxy.enabled
    ? {
        AGY_PROXY_URL: launchProxy.url,
        AGY_PROXY_BYPASS: launchProxy.bypass,
        AGY_PROXY_SPEC: launchProxy.specKey,
        AGY_PROXY_CHROME_SERVER: launchProxy.chromiumServer,
        AGY_PROXY_CHROME_BYPASS: launchProxy.chromiumBypass,
        AGY_PROXY_FORCE_HTTP1: launchProxy.forceHttp1 ? '1' : '0'
      }
    : {};

  const customArgs = custom ? launchArguments(custom.args, [], { appendDefaultArgs: custom.appendDefaultArgs }) : [];
  const customCommand = custom ? `(cd ${shSingleQuote(custom.cwd)} && nohup ${[custom.command, ...customArgs].map(shSingleQuote).join(' ')}` : '';
  const launchCustom = custom ? `${customCommand}${launchProxy.enabled && custom.appendDefaultArgs ? ' "--proxy-server=$p_chrome" "--proxy-bypass-list=$p_cbypass"' : ''} >/dev/null 2>&1) &` : '';
  const clearProxyShellLines = clearManagedProxy ? [
    'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy AGY_POWERTOOLS_PROXY_SPEC',
    'if [ "$GODEBUG" = "http2client=0" ]; then unset GODEBUG; fi'
  ] : [];

  if (platform === 'darwin' && target) {
    const appName = basename(target, '.app');
    const openEnvLine = launchProxy.hasCredentials
      // Never expose raw proxy credentials in `/usr/bin/open --env` argv (visible via `ps`);
      // launch the bundle executable directly so exported proxy env vars are inherited via envp.
      ? 'set -- --env "NO_PROXY=$p_bypass" --env "no_proxy=$p_bypass"'
      : 'set -- --env "HTTP_PROXY=$p_url" --env "HTTPS_PROXY=$p_url" --env "ALL_PROXY=$p_url" --env "http_proxy=$p_url" --env "https_proxy=$p_url" --env "all_proxy=$p_url" --env "NO_PROXY=$p_bypass" --env "no_proxy=$p_bypass" --env "AGY_POWERTOOLS_PROXY_SPEC=$p_spec"';
    const macLaunchCommand = launchProxy.hasCredentials
      ? 'app_exe=$(/usr/bin/defaults read "$target/Contents/Info" CFBundleExecutable 2>/dev/null || printf "%s" "$app_name"); if [ -n "$app_exe" ] && [ -x "$target/Contents/MacOS/$app_exe" ]; then nohup "$target/Contents/MacOS/$app_exe" --remote-debugging-port=0 "--proxy-server=$p_chrome" "--proxy-bypass-list=$p_cbypass" >/dev/null 2>&1 & else /usr/bin/open -n -a "$target" "$@" --args --remote-debugging-port=0 "--proxy-server=$p_chrome" "--proxy-bypass-list=$p_cbypass" >/dev/null 2>&1; fi'
      : '/usr/bin/open -n -a "$target" "$@" --args --remote-debugging-port=0 "--proxy-server=$p_chrome" "--proxy-bypass-list=$p_cbypass" >/dev/null 2>&1 || /usr/bin/open -n -a "$target" --args --remote-debugging-port=0 "--proxy-server=$p_chrome" "--proxy-bypass-list=$p_cbypass" >/dev/null 2>&1';
    const launchLines = launchProxy.enabled
      ? [
          'p_url="$AGY_PROXY_URL"; p_bypass="$AGY_PROXY_BYPASS"; p_spec="$AGY_PROXY_SPEC"; p_chrome="$AGY_PROXY_CHROME_SERVER"; p_cbypass="$AGY_PROXY_CHROME_BYPASS"; p_h1="$AGY_PROXY_FORCE_HTTP1"',
          'unset AGY_PROXY_URL AGY_PROXY_BYPASS AGY_PROXY_SPEC AGY_PROXY_CHROME_SERVER AGY_PROXY_CHROME_BYPASS AGY_PROXY_FORCE_HTTP1',
          'export HTTP_PROXY="$p_url" HTTPS_PROXY="$p_url" ALL_PROXY="$p_url" http_proxy="$p_url" https_proxy="$p_url" all_proxy="$p_url" NO_PROXY="$p_bypass" no_proxy="$p_bypass" AGY_POWERTOOLS_PROXY_SPEC="$p_spec"',
          'if [ "$p_h1" = "1" ]; then export GODEBUG="http2client=0"; elif [ "$GODEBUG" = "http2client=0" ]; then unset GODEBUG; fi',
          openEnvLine,
          'if [ "$p_h1" = "1" ]; then set -- "$@" --env "GODEBUG=http2client=0"; fi',
          launchCustom || macLaunchCommand
        ]
      : [
          ...clearProxyShellLines,
          launchCustom || '/usr/bin/open -n -a "$target" --args --remote-debugging-port=0 >/dev/null 2>&1'
        ];
    const script = [
      "trap '' HUP TERM",
      '/usr/bin/osascript -e \'tell application (system attribute "AGY_RELAUNCH_APP_NAME") to quit\' >/dev/null 2>&1 || true',
      'i=0; while [ $i -lt 15 ] && /bin/ps -axo args= | /usr/bin/awk -v p="$AGY_RELAUNCH_TARGET/Contents/MacOS/" \'{ sub(/^ +/, ""); if (index($0, p) == 1) found=1 } END { exit !found }\'; do sleep 0.3; i=$((i+1)); done',
      'pids=$(/bin/ps -axo pid=,args= | /usr/bin/awk -v p="$AGY_RELAUNCH_TARGET/Contents/MacOS/" \'{ pid=$1; sub(/^ *[0-9]+ +/, ""); if (index($0, p) == 1) print pid }\')',
      'if [ -n "$pids" ]; then kill -TERM $pids >/dev/null 2>&1 || true; fi',
      'i=0; while [ $i -lt 45 ] && /bin/ps -axo args= | /usr/bin/awk -v p="$AGY_RELAUNCH_TARGET/Contents/MacOS/" \'{ sub(/^ +/, ""); if (index($0, p) == 1) found=1 } END { exit !found }\'; do sleep 0.3; i=$((i+1)); done',
      'sleep 0.8',
      ...posixOnboardingLines,
      'target="$AGY_RELAUNCH_TARGET"; app_name="$AGY_RELAUNCH_APP_NAME"; unset AGY_RELAUNCH_TARGET AGY_RELAUNCH_APP_NAME',
      ...launchLines
    ].join('\n');
    const child = spawnProcess('sh', ['-c', script], {
      detached: true,
      stdio: 'ignore',
      env: { ...childEnv, ...proxyShellEnv, ...onboardingShellEnv, AGY_RELAUNCH_APP_NAME: appName }
    });
    child.unref?.();
    return { scheduled: true, target: custom?.command || target, proxyActive: launchProxy.enabled };
  }

  const linuxLaunchLines = launchProxy.enabled
    ? [
        'p_url="$AGY_PROXY_URL"; p_bypass="$AGY_PROXY_BYPASS"; p_spec="$AGY_PROXY_SPEC"; p_chrome="$AGY_PROXY_CHROME_SERVER"; p_cbypass="$AGY_PROXY_CHROME_BYPASS"; p_h1="$AGY_PROXY_FORCE_HTTP1"',
        'unset AGY_PROXY_URL AGY_PROXY_BYPASS AGY_PROXY_SPEC AGY_PROXY_CHROME_SERVER AGY_PROXY_CHROME_BYPASS AGY_PROXY_FORCE_HTTP1',
        'export HTTP_PROXY="$p_url" HTTPS_PROXY="$p_url" ALL_PROXY="$p_url" http_proxy="$p_url" https_proxy="$p_url" all_proxy="$p_url" NO_PROXY="$p_bypass" no_proxy="$p_bypass" AGY_POWERTOOLS_PROXY_SPEC="$p_spec"',
        'if [ "$p_h1" = "1" ]; then export GODEBUG="http2client=0"; elif [ "$GODEBUG" = "http2client=0" ]; then unset GODEBUG; fi',
        launchCustom || 'nohup "$target" --remote-debugging-port=0 "--proxy-server=$p_chrome" "--proxy-bypass-list=$p_cbypass" >/dev/null 2>&1 &'
      ]
    : [
        ...clearProxyShellLines,
        launchCustom || 'nohup "$target" --remote-debugging-port=0 >/dev/null 2>&1 &'
      ];
  const script = [
    "trap '' HUP TERM",
    ...(target ? [
    'pids=$(ps -eo pid=,args= | awk -v p="$AGY_RELAUNCH_TARGET" \'{ pid=$1; sub(/^ *[0-9]+ +/, ""); if ($0 == p || index($0, p " ") == 1) print pid }\')',
    'if [ -n "$pids" ]; then kill -TERM $pids >/dev/null 2>&1 || true; fi',
    'i=0; while [ $i -lt 60 ] && ps -eo args= | awk -v p="$AGY_RELAUNCH_TARGET" \'{ sub(/^ +/, ""); if ($0 == p || index($0, p " ") == 1) found=1 } END { exit !found }\'; do sleep 0.3; i=$((i+1)); done',
    'sleep 0.8',
    'target="$AGY_RELAUNCH_TARGET"; unset AGY_RELAUNCH_TARGET',
    ] : []),
    ...posixOnboardingLines,
    ...linuxLaunchLines
  ].join('\n');
  const child = spawnProcess('sh', ['-c', script], { detached: true, stdio: 'ignore', env: { ...childEnv, ...proxyShellEnv, ...onboardingShellEnv } });
  child.unref?.();
  return { scheduled: true, target: custom?.command || target, proxyActive: launchProxy.enabled };
}

export function shouldPromptPostUpdate({
  dataDir,
  installDir,
  env = process.env,
  now = Date.now()
} = {}) {
  if (!env.ANTIGRAVITY_LS_ADDRESS || env.ELECTRON_OZONE_PLATFORM_HINT === 'headless' || env.AGY_POWERTOOLS_NO_PROMPT === '1') {
    return { prompt: false, reason: 'non-interactive' };
  }
  if (readPostUpdateMode(dataDir) === 'silent') {
    return { prompt: false, reason: 'suppressed-by-config' };
  }
  if (installDir) {
    try {
      const mtimeMs = statSync(join(installDir, '.agy-install.json')).mtimeMs;
      if (Number.isFinite(mtimeMs) && now - mtimeMs > -5000 && now - mtimeMs < FRESH_INSTALL_GRACE_MS) {
        return { prompt: false, reason: 'fresh-install' };
      }
    } catch {}
  }
  if (dataDir) {
    const state = readJson(join(dataDir, 'relaunch-state.json'), {});
    if (state.lastPromptLsAddress && state.lastPromptLsAddress === env.ANTIGRAVITY_LS_ADDRESS) {
      return { prompt: false, reason: 'already-prompted-session' };
    }
    if ((state.lastPromptAt && now - state.lastPromptAt < PROMPT_COOLDOWN_MS) ||
        (state.lastRelaunchAt && now - state.lastRelaunchAt < PROMPT_COOLDOWN_MS)) {
      return { prompt: false, reason: 'cooldown' };
    }
  }
  return { prompt: true, reason: 'ready' };
}

export function maybePromptPostUpdateRelaunch({
  dataDir,
  installDir,
  language = 'zh-CN',
  platform = process.platform,
  env = process.env,
  home = homedir(),
  now = Date.now(),
  relaunch = scheduleRelaunchWithDebugPort,
  spawnProcess = spawn
} = {}) {
  const decision = shouldPromptPostUpdate({ dataDir, installDir, env, now });
  if (!decision.prompt) return { prompted: false, reason: decision.reason };
  const mode = readPostUpdateMode(dataDir);
  const wslMode = isWslEnvironment({ platform, env });
  const custom = !wslMode && dataDir ? readCustomLauncher(dataDir, platform) : null;
  const target = resolveAntigravityExecutable({ platform, env, home });
  if (!target && !custom) return { prompted: false, reason: 'executable-not-found' };

  if (mode === 'auto') {
    const sig = executableSignature(target || custom?.command || '');
    if (dataDir && sig) {
      const prev = readJson(join(dataDir, 'relaunch-state.json'), {});
      if (prev.lastAutoRelaunchTargetSig === sig) {
        return { prompted: false, autoRelaunched: false, reason: 'auto-relaunch-already-attempted' };
      }
      writeJson(join(dataDir, 'relaunch-state.json'), {
        ...prev,
        lastPromptAt: now,
        lastPromptLsAddress: env.ANTIGRAVITY_LS_ADDRESS,
        lastAutoRelaunchTargetSig: sig
      });
    }
    try {
      const result = relaunch({ dataDir, home, platform, env });
      return { prompted: false, autoRelaunched: Boolean(result?.scheduled !== false), result };
    } catch (error) {
      return { prompted: false, autoRelaunched: false, reason: error?.message || 'auto-relaunch-failed' };
    }
  }

  if (dataDir) {
    const stateFile = join(dataDir, 'relaunch-state.json');
    const prev = readJson(stateFile, {});
    writeJson(stateFile, { ...prev, lastPromptAt: now, lastPromptLsAddress: env.ANTIGRAVITY_LS_ADDRESS });
  }

  const en = language === 'en';
  const message = en
    ? 'Antigravity was updated. Restart to re-enable the Antigravity Max plugin?\n\nYour open conversations will be preserved.'
    : '检测到 Antigravity 已升级，请重启以重新启用 Antigravity Max 插件。\n\n是否现在立即重启客户端？（当前会话记录会自动保留）';

  if (platform === 'win32' || wslMode) {
    const promptEnv = wslMode
      ? appendWslEnv({ ...env, AGY_PROMPT_TEXT: message }, ['AGY_PROMPT_TEXT'])
      : { ...env, AGY_PROMPT_TEXT: message };
    const child = spawnProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command',
      `$ws = New-Object -ComObject WScript.Shell; $ans = $ws.Popup($env:AGY_PROMPT_TEXT, 0, 'Antigravity Max', 65 + 4096); if ($ans -eq 1) { exit 10 } else { exit 0 }`
    ], { windowsHide: true, stdio: 'ignore', env: promptEnv });
    let canceled = false;
    child.on?.('exit', code => {
      if (!canceled && code === 10) {
        try { relaunch({ dataDir, home, platform, env }); } catch {}
      }
    });
    child.unref?.();
    const cancel = () => {
      if (canceled) return;
      canceled = true;
      try { child.kill?.(); } catch {}
    };
    return { prompted: true, cancel };
  }

  if (platform === 'darwin') {
    const dockHint = en
      ? '\n\nTip: Drag ~/Applications/Antigravity (Max).app onto your Dock to replace the original icon for future launches.'
      : '\n\n提示：可将 ~/Applications/Antigravity (Max).app 拖入 Dock 栏替换原图标，后续直接从 Dock 启动即可生效。';
    const btnLater = en ? 'Later' : '稍后';
    const btnNow = en ? 'Restart Now' : '立即重启';
    const script = `display dialog ${JSON.stringify(message + dockHint)} with title "Antigravity Max" buttons {${JSON.stringify(btnLater)}, ${JSON.stringify(btnNow)}} default button ${JSON.stringify(btnNow)}`;
    const child = spawnProcess('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    let canceled = false;
    child.stdout?.on('data', chunk => { out += chunk; });
    child.on?.('exit', code => {
      if (!canceled && code === 0 && out.includes(btnNow)) {
        try { relaunch({ dataDir, home, platform, env }); } catch {}
      }
    });
    child.unref?.();
    const cancel = () => {
      if (canceled) return;
      canceled = true;
      try { child.kill?.(); } catch {}
    };
    return { prompted: true, cancel };
  }

  return { prompted: false, reason: 'unsupported-dialog-platform' };
}

const WINDOWS_RUNNABLE_EXTENSIONS = new Set([
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.psd1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta',
  '.msi', '.msp', '.scr', '.pif', '.reg', '.msc', '.cpl', '.lnk', '.url', '.jar'
]);

export function isWindowsRunnableFile(filePath) {
  return WINDOWS_RUNNABLE_EXTENSIONS.has(extname(String(filePath || '')).toLowerCase());
}

function isNonGlobalIpv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some(n => n < 0 || n > 255)) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isNonGlobalIp(address) {
  const addr = String(address || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const ver = isIP(addr);
  if (ver === 4) return isNonGlobalIpv4(addr);
  if (ver === 6) {
    if (addr === '::1') return true;
    const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isNonGlobalIpv4(mapped[1]);
    return /^f[cd][0-9a-f]{2}:/.test(addr) || /^fe[89ab][0-9a-f]:/.test(addr);
  }
  return false;
}

function isLoopbackOrKernelHost(hostname, platform) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (platform === 'win32' && host === 'wsl$') return true;
  return false;
}

function normalizeFileUri(uri) {
  let s = String(uri || '').trim();
  // RFC 8089 Appendix E.3.2 & Windows UNC variants: normalize 4+ slashes and mixed / \ %2f %5c UNC prefixes to file://host/...
  s = s.replace(/^file:\/\/\/(?:[/\\]|%2f|%5c)+([^/\\?#]+)/i, 'file://$1');
  s = s.replace(/^file:\/\/(?:\\|%5c)+([^/\\?#]+)/i, 'file://$1');
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) {
    const before = s.slice(0, hashIdx);
    const decodedFragSep = s.slice(hashIdx + 1).replace(/%2f/gi, '/').replace(/%5c/gi, '/');
    const isLineAnchor = /^(?:L\d+(?:(?:C|:)\d+)?(?:-L?\d+(?:(?:C|:)\d+)?)?|\d+(?:-\d+)?)$/i.test(decodedFragSep);
    const isDocHeading = /\.(?:md|markdown|html?|rst|adoc|pdf)$/i.test(before) && /^[^/\\#?.]+$/.test(decodedFragSep);
    if (isLineAnchor || isDocHeading) {
      s = before;
    } else {
      let tail = decodedFragSep.replace(/(?:#|%23)(?:L\d+(?:(?:C|:)\d+)?(?:-L?\d+(?:(?:C|:)\d+)?)?|\d+(?:-\d+)?)$/i, '');
      tail = tail.replace(/(\.(?:md|markdown|html?|rst|adoc|pdf))(?:#|%23)[^/\\#?.]+$/i, '$1');
      s = `${before}%23${tail.replaceAll('#', '%23')}`;
    }
  }
  return s;
}

function pathAnchor(value) {
  if (/[?#]/.test(value) || /^file:\/\/[^/\\]+$/i.test(value)) return null;
  const match = /:(\d+)(?::(\d+))?$/.exec(value);
  const path = match && value.slice(0, match.index);
  if (!path || /^(?:file:\/*)?[a-z]$/i.test(path)) return null;
  return match;
}

function stripPathAnchor(value) {
  const match = pathAnchor(value);
  return match ? value.slice(0, match.index) : value;
}

export function parseFileUriAnchor(uri) {
  const s = String(uri || '').trim();
  const hashIdx = s.indexOf('#');
  if (hashIdx < 0) return { line: null, column: null };
  let tail = s.slice(hashIdx + 1);
  try { tail = decodeURIComponent(tail); } catch { /* Keep raw fragment. */ }
  const match = tail.match(/(?:^|#)(?:L(\d+)(?:(?:C|:)(\d+))?(?:-L?\d+(?:(?:C|:)\d+)?)?|(\d+)(?:-\d+)?)$/i);
  if (!match) return { line: null, column: null };
  const line = Number(match[1] || match[3]);
  const col = match[2] ? Number(match[2]) : null;
  return {
    line: Number.isInteger(line) && line > 0 ? line : null,
    column: Number.isInteger(col) && col > 0 ? col : null
  };
}

function normalizeWslFileUri(uri, platform) {
  if (platform === 'win32') return uri;
  const s = String(uri || '').trim();
  const m = s.match(/^file:\/\/(?:wsl\.localhost|wsl\$)\/[^/\\]+(\/.*)$/i);
  return m ? `file://${m[1]}` : uri;
}

function parseFileUri(uri, platform = process.platform) {
  if (typeof uri !== 'string' || !uri.trim()) throw new Error('文件路径无效');
  let parsed;
  try {
    parsed = new URL(normalizeFileUri(normalizeWslFileUri(uri, platform)));
  } catch {
    throw new Error('文件路径格式无效');
  }
  if (parsed.protocol !== 'file:') throw new Error('仅支持本地文件链接');
  parsed.hash = '';
  parsed.search = '';
  return { parsed, hostname: parsed.hostname || '' };
}

function toPlatformFilePath(parsed, platform) {
  const hasDrive = /^\/[a-zA-Z]:(?:\/|$)/.test(parsed.pathname);
  if (platform === 'win32') {
    let resolved;
    try {
      resolved = fileURLToPath(parsed, { windows: true });
    } catch {
      throw new Error('文件路径格式无效');
    }
    if (!parsed.hostname && !/^[a-zA-Z]:\\/.test(resolved)) {
      throw new Error('文件路径格式无效');
    }
    return resolved;
  }
  const useWindows = process.platform === 'win32' && hasDrive && !parsed.hostname;
  try {
    return fileURLToPath(parsed, { windows: useWindows });
  } catch {
    throw new Error('文件路径格式无效');
  }
}

export function resolveLocalFilePath(uri, { platform = process.platform } = {}) {
  const { parsed, hostname } = parseFileUri(uri, platform);
  if (isLoopbackOrKernelHost(hostname, platform)) return toPlatformFilePath(parsed, platform);
  if (platform === 'win32' && isNonGlobalIp(hostname)) return toPlatformFilePath(parsed, platform);
  throw new Error('仅支持本机或局域网文件路径');
}

export async function resolveVerifiedLocalFilePath(
  uri,
  { platform = process.platform, lookup = dnsLookup, timeoutMs = 2000 } = {}
) {
  const { parsed, hostname } = parseFileUri(uri, platform);
  if (isLoopbackOrKernelHost(hostname, platform)) return toPlatformFilePath(parsed, platform);
  if (platform !== 'win32') throw new Error('仅支持本机或局域网文件路径');
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isNonGlobalIp(host)) return toPlatformFilePath(parsed, platform);
    throw new Error('仅支持本机或局域网文件路径');
  }
  let timer;
  let records;
  try {
    const query = Promise.resolve(lookup(host, { all: true }));
    records = await (timeoutMs > 0
      ? Promise.race([
          query,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('局域网主机解析超时')), timeoutMs);
          })
        ])
      : query);
  } catch {
    throw new Error('无法解析局域网主机路径');
  } finally {
    clearTimeout(timer);
  }
  const list = Array.isArray(records) ? records : (records ? [records] : []);
  if (!list.length || !list.every(entry => isNonGlobalIp(typeof entry === 'string' ? entry : entry?.address))) {
    throw new Error('仅支持本机或局域网文件路径');
  }
  return toPlatformFilePath(parsed, platform);
}

export async function openLocalFile(
  uri,
  { action = 'open', platform = process.platform, spawnProcess = spawn, exists = existsSync, stat = statSync, lookup = dnsLookup } = {}
) {
  if (action !== 'open' && action !== 'reveal') throw new Error('不支持的文件操作');
  const filePath = await resolveVerifiedLocalFilePath(uri, { platform, lookup });
  if (!exists(filePath)) throw new Error('文件或文件夹不存在');
  let isDir = false;
  try { isDir = Boolean(stat(filePath)?.isDirectory?.()); } catch { /* Best effort. */ }
  if (action === 'open' && platform === 'win32' && !isDir && isWindowsRunnableFile(filePath)) {
    throw new Error('该文件类型在 Windows 下可能直接执行，已拦截；请使用“打开所在文件夹”或“复制路径”');
  }

  let command;
  let args;
  const spawnOptions = { detached: true, stdio: 'ignore' };
  if (platform === 'win32') {
    command = 'explorer.exe';
    spawnOptions.windowsHide = true;
    if (action === 'reveal') {
      if (filePath.includes(',') || (filePath.startsWith('\\\\') && filePath.includes(' '))) {
        args = [`/select,"${filePath}"`];
        spawnOptions.windowsVerbatimArguments = true;
      } else {
        args = [`/select,${filePath}`];
      }
    } else {
      args = [filePath];
    }
  } else if (platform === 'darwin') {
    command = 'open';
    args = action === 'reveal' ? ['-R', filePath] : [filePath];
  } else {
    command = 'xdg-open';
    args = [action === 'reveal' ? (isDir ? filePath : dirname(filePath)) : filePath];
  }

  const child = spawnProcess(command, args, spawnOptions);
  if (platform === 'win32' && typeof child?.once === 'function') {
    await new Promise((resolve, reject) => {
      const onError = err => {
        child.off?.('spawn', onSpawn);
        reject(err);
      };
      const onSpawn = () => {
        child.off?.('error', onError);
        child.on?.('error', () => {});
        resolve();
      };
      child.once('error', onError);
      child.once('spawn', onSpawn);
    });
  }
  child?.unref?.();
  return { ok: true, path: filePath };
}

const WINDOWS_CMD_WRAPPER_RE = /\.(?:cmd|bat)$/i;
const WINDOWS_CMD_UNSAFE_ARG_RE = /[&|<>^%!"\r\n\0]/;

export function windowsCmdInvocation(command, args, env = process.env) {
  const parts = [command, ...args];
  if (parts.some(part => WINDOWS_CMD_UNSAFE_ARG_RE.test(String(part)))) {
    throw new Error('Windows .cmd 路径或参数包含不安全字符，已拦截');
  }
  const cmdLine = parts.map(part => `"${part}"`).join(' ');
  return { command: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${cmdLine}"`], windowsVerbatimArguments: true };
}

function isWindowsLikePath(p) {
  return typeof p === 'string' && (/^[a-zA-Z]:[\\/]|^\\\\/.test(p) || (p.includes('\\') && !p.includes('/')));
}

function joinForPath(base, ...parts) {
  return (isWindowsLikePath(base) ? win32.join : join)(base, ...parts);
}

function resolveNativeWindowsEditorExe(cmdPath, spec, exists) {
  if (!cmdPath || !WINDOWS_CMD_WRAPPER_RE.test(cmdPath)) return '';
  const exeNames = spec?.winExeNames || [];
  if (!exeNames.length) return '';
  const pathOps = isWindowsLikePath(cmdPath) ? win32 : { dirname, join };
  const binDir = pathOps.dirname(cmdPath);
  const parent1 = pathOps.dirname(binDir);
  const parent2 = pathOps.dirname(parent1);
  const parent3 = pathOps.dirname(parent2);
  const searchDirs = [...new Set([parent1, parent3, binDir].filter(Boolean))];
  for (const dir of searchDirs) {
    for (const exeName of exeNames) {
      const candidate = pathOps.join(dir, exeName);
      if (exists(candidate)) return candidate;
    }
  }
  return '';
}

const EDITOR_SPECS = Object.freeze({
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    style: 'vscode',
    cliNames: ['cursor'],
    winExeNames: ['Cursor.exe'],
    darwinPaths: home => [
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      join(home, 'Applications', 'Cursor.app', 'Contents', 'Resources', 'app', 'bin', 'cursor'),
      '/opt/homebrew/bin/cursor',
      '/usr/local/bin/cursor'
    ],
    winPaths: env => {
      const pf = env.PROGRAMFILES || env.ProgramFiles;
      return [
        env.LOCALAPPDATA && joinForPath(env.LOCALAPPDATA, 'Programs', 'cursor', 'Cursor.exe'),
        pf && joinForPath(pf, 'cursor', 'Cursor.exe'),
        env.LOCALAPPDATA && joinForPath(env.LOCALAPPDATA, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd')
      ].filter(Boolean);
    },
    linuxPaths: home => [join(home, '.local', 'bin', 'cursor'), '/usr/local/bin/cursor', '/usr/bin/cursor']
  },
  vscode: {
    id: 'vscode',
    label: 'VS Code',
    style: 'vscode',
    cliNames: ['code'],
    winExeNames: ['Code.exe', 'Code - Insiders.exe'],
    darwinPaths: home => [
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      join(home, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
      '/opt/homebrew/bin/code',
      '/usr/local/bin/code'
    ],
    winPaths: env => {
      const pf = env.PROGRAMFILES || env.ProgramFiles;
      return [
        env.LOCALAPPDATA && joinForPath(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        pf && joinForPath(pf, 'Microsoft VS Code', 'Code.exe'),
        env.LOCALAPPDATA && joinForPath(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd')
      ].filter(Boolean);
    },
    linuxPaths: home => [join(home, '.local', 'bin', 'code'), '/usr/local/bin/code', '/usr/bin/code', '/snap/bin/code']
  },
  windsurf: {
    id: 'windsurf',
    label: 'Windsurf',
    style: 'vscode',
    cliNames: ['windsurf'],
    winExeNames: ['Windsurf.exe'],
    darwinPaths: home => [
      '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf',
      join(home, 'Applications', 'Windsurf.app', 'Contents', 'Resources', 'app', 'bin', 'windsurf'),
      '/opt/homebrew/bin/windsurf',
      '/usr/local/bin/windsurf'
    ],
    winPaths: env => {
      const pf = env.PROGRAMFILES || env.ProgramFiles;
      return [
        env.LOCALAPPDATA && joinForPath(env.LOCALAPPDATA, 'Programs', 'Windsurf', 'Windsurf.exe'),
        pf && joinForPath(pf, 'Windsurf', 'Windsurf.exe'),
        env.LOCALAPPDATA && joinForPath(env.LOCALAPPDATA, 'Programs', 'Windsurf', 'bin', 'windsurf.cmd')
      ].filter(Boolean);
    },
    linuxPaths: home => [join(home, '.local', 'bin', 'windsurf'), '/usr/local/bin/windsurf', '/usr/bin/windsurf']
  },
  zed: {
    id: 'zed',
    label: 'Zed',
    style: 'zed',
    cliNames: ['zed', 'zeditor'],
    winExeNames: ['Zed.exe', 'zed.exe'],
    darwinPaths: home => [
      '/Applications/Zed.app/Contents/MacOS/cli',
      join(home, 'Applications', 'Zed.app', 'Contents', 'MacOS', 'cli'),
      '/opt/homebrew/bin/zed',
      '/usr/local/bin/zed'
    ],
    winPaths: env => [
      env.LOCALAPPDATA && joinForPath(env.LOCALAPPDATA, 'Programs', 'Zed', 'Zed.exe'),
      env.LOCALAPPDATA && joinForPath(env.LOCALAPPDATA, 'Programs', 'Zed', 'bin', 'zed.exe')
    ].filter(Boolean),
    linuxPaths: home => [join(home, '.local', 'bin', 'zed'), '/usr/local/bin/zed', '/usr/bin/zed', '/usr/bin/zeditor']
  },
  kiro: {
    id: 'kiro',
    label: 'Kiro',
    style: 'vscode',
    cliNames: ['kiro'],
    winExeNames: ['Kiro.exe'],
    darwinPaths: home => [
      '/Applications/Kiro.app/Contents/Resources/app/bin/code',
      join(home, 'Applications', 'Kiro.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
      '/opt/homebrew/bin/kiro',
      '/usr/local/bin/kiro'
    ],
    winPaths: env => {
      const pf = env.PROGRAMFILES || env.ProgramFiles;
      return [
        env.LOCALAPPDATA && joinForPath(env.LOCALAPPDATA, 'Programs', 'Kiro', 'Kiro.exe'),
        pf && joinForPath(pf, 'Kiro', 'Kiro.exe'),
        env.LOCALAPPDATA && joinForPath(env.LOCALAPPDATA, 'Programs', 'Kiro', 'bin', 'kiro.cmd')
      ].filter(Boolean);
    },
    linuxPaths: home => [join(home, '.local', 'bin', 'kiro'), '/usr/local/bin/kiro', '/usr/bin/kiro']
  },
  // Built into every desktop OS, so auto-detect always has something to open.
  system: {
    id: 'system',
    label: '系统文本编辑器',
    style: 'system',
    cliNames: ['gnome-text-editor', 'gedit', 'kate', 'kwrite', 'mousepad', 'xed', 'pluma', 'xdg-open'],
    winExeNames: [],
    darwinPaths: () => ['/usr/bin/open'],
    winPaths: env => [joinForPath(env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows', 'System32', 'notepad.exe')],
    linuxPaths: () => []
  }
});

const EDITOR_ORDER = ['cursor', 'vscode', 'windsurf', 'zed', 'kiro', 'system'];

export function resolveExternalEditor({
  preferred = 'auto',
  platform = process.platform,
  env = process.env,
  home = homedir(),
  exists = existsSync
} = {}) {
  const candidates = preferred && preferred !== 'auto'
    ? (EDITOR_SPECS[preferred] ? [EDITOR_SPECS[preferred]] : [])
    : EDITOR_ORDER.map(id => EDITOR_SPECS[id]);
  if (!candidates.length) throw new Error('不支持的外部编辑器配置');

  const rawPath = String(env?.PATH || env?.Path || '');
  const pathDirs = (platform === 'win32' || rawPath.includes(';')
    ? rawPath.split(';')
    : rawPath.replace(/([a-zA-Z]):(?=[\\/])/g, '$1\0').split(':').map(s => s.replace(/\0/g, ':'))
  ).map(s => s.trim()).filter(Boolean);

  for (const spec of candidates) {
    const fixed = platform === 'darwin'
      ? spec.darwinPaths(home)
      : platform === 'win32'
        ? spec.winPaths(env || {})
        : spec.linuxPaths(home);
    let cmdFallback = '';
    for (const full of fixed) {
      if (!full || !exists(full)) continue;
      if (platform === 'win32' && WINDOWS_CMD_WRAPPER_RE.test(full)) {
        const nativeExe = resolveNativeWindowsEditorExe(full, spec, exists);
        if (nativeExe) return { id: spec.id, label: spec.label, style: spec.style, command: nativeExe };
        if (!cmdFallback) cmdFallback = full;
        continue;
      }
      return { id: spec.id, label: spec.label, style: spec.style, command: full };
    }
    for (const dir of pathDirs) {
      if (platform === 'win32') {
        for (const cli of spec.cliNames) {
          const exePath = joinForPath(dir, `${cli}.exe`);
          if (exists(exePath)) return { id: spec.id, label: spec.label, style: spec.style, command: exePath };
        }
        for (const exeName of spec.winExeNames || []) {
          const exePath = joinForPath(dir, exeName);
          if (exists(exePath)) return { id: spec.id, label: spec.label, style: spec.style, command: exePath };
        }
        for (const cli of spec.cliNames) {
          for (const ext of ['.cmd', '.bat']) {
            const wrapperPath = joinForPath(dir, `${cli}${ext}`);
            if (!exists(wrapperPath)) continue;
            const nativeExe = resolveNativeWindowsEditorExe(wrapperPath, spec, exists);
            if (nativeExe) return { id: spec.id, label: spec.label, style: spec.style, command: nativeExe };
            if (!cmdFallback) cmdFallback = wrapperPath;
          }
        }
      } else {
        for (const cli of spec.cliNames) {
          const p = join(dir, cli);
          if (exists(p)) return { id: spec.id, label: spec.label, style: spec.style, command: p };
        }
      }
    }
    if (cmdFallback) return { id: spec.id, label: spec.label, style: spec.style, command: cmdFallback };
  }
  if (preferred && preferred !== 'auto' && EDITOR_SPECS[preferred]) {
    throw new Error(`未检测到已安装的 ${EDITOR_SPECS[preferred].label}，请在设置中更换首选外部编辑器`);
  }
  throw new Error('未检测到可用的外部编辑器（支持 Cursor、VS Code、Windsurf、Zed、Kiro 与系统文本编辑器）');
}

export async function openInExternalEditor(
  uri,
  {
    preferred = 'auto',
    line = null,
    column = null,
    platform = process.platform,
    env = process.env,
    home = homedir(),
    spawnProcess = spawn,
    exists = existsSync,
    stat = statSync,
    lookup = dnsLookup
  } = {}
) {
  const anchor = parseFileUriAnchor(uri);
  let targetLine = Number.isInteger(Number(line)) && Number(line) > 0 ? Number(line) : anchor.line;
  let targetCol = Number.isInteger(Number(column)) && Number(column) > 0 ? Number(column) : anchor.column;
  let filePath = await resolveVerifiedLocalFilePath(uri, { platform, lookup });
  if (!exists(filePath)) {
    const suffixMatch = pathAnchor(String(uri || '').trim());
    if (suffixMatch) {
      const strippedPath = await resolveVerifiedLocalFilePath(stripPathAnchor(String(uri || '').trim()), { platform, lookup });
      if (exists(strippedPath)) {
        filePath = strippedPath;
        if (!targetLine) targetLine = Number(suffixMatch[1]);
        if (!targetCol && suffixMatch[2]) targetCol = Number(suffixMatch[2]);
      }
    }
  }
  if (!exists(filePath)) throw new Error('文件或文件夹不存在');
  let isDir = false;
  try { isDir = Boolean(stat(filePath)?.isDirectory?.()); } catch { /* Best effort. */ }
  const editor = resolveExternalEditor({ preferred, platform, env, home, exists });
  if (editor.style === 'system' && isDir) {
    // Plain text editors cannot open folders, so hand folders to the system file manager.
    const opened = await openLocalFile(uri, { action: 'open', platform, spawnProcess, exists, stat, lookup });
    return { ...opened, editor: editor.id, editorLabel: editor.label, line: null, column: null };
  }

  let command = editor.command;
  let args;
  let editorEnv = env;
  if (env && 'ELECTRON_RUN_AS_NODE' in env) {
    editorEnv = { ...env };
    delete editorEnv.ELECTRON_RUN_AS_NODE;
  }
  const spawnOptions = { detached: true, stdio: 'ignore', windowsHide: true, env: editorEnv };
  if (isDir) {
    args = [filePath];
  } else if (editor.style === 'system') {
    // System text editors cannot jump to a line; `open -t` picks the macOS default text editor.
    args = platform === 'darwin' ? ['-t', filePath] : [filePath];
  } else if (editor.style === 'zed') {
    const loc = targetLine ? `${filePath}:${targetLine}${targetCol ? `:${targetCol}` : ''}` : filePath;
    args = [loc];
  } else {
    const loc = targetLine ? `${filePath}:${targetLine}:${targetCol || 1}` : filePath;
    args = targetLine ? ['-g', loc] : [filePath];
  }

  if (platform === 'win32' && WINDOWS_CMD_WRAPPER_RE.test(command)) {
    const invocation = windowsCmdInvocation(command, args, env);
    ({ command, args } = invocation);
    spawnOptions.windowsVerbatimArguments = invocation.windowsVerbatimArguments;
  }

  const child = spawnProcess(command, args, spawnOptions);
  child?.on?.('error', () => {});
  child?.unref?.();
  return { ok: true, path: filePath, editor: editor.id, editorLabel: editor.label, line: targetLine, column: targetCol };
}

function runProcessAsync(spawnProcess, command, args, options = {}, { input, timeoutMs = 8000 } = {}) {
  return new Promise(resolvePromise => {
    let settled = false;
    let stderr = '';
    let timer = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    let child;
    try {
      child = spawnProcess(command, args, {
        ...options,
        stdio: [input != null ? 'pipe' : 'ignore', 'ignore', 'pipe']
      });
    } catch (error) {
      return finish({ status: -1, error, stderr: '' });
    }
    timer = setTimeout(() => {
      try { child?.kill?.(); } catch { /* Best effort. */ }
      finish({ status: -1, error: new Error('操作超时'), stderr });
    }, timeoutMs);
    child?.stderr?.on?.('data', chunk => {
      if (stderr.length < 2048) stderr += String(chunk);
    });
    child?.on?.('error', error => finish({ status: -1, error, stderr }));
    child?.on?.('close', code => finish({ status: code ?? 0, error: null, stderr }));
    if (input != null && child?.stdin) {
      child.stdin.on?.('error', () => {});
      child.stdin.end(input);
    }
  });
}

export async function copyLocalFile(
  uri,
  { platform = process.platform, spawnProcess = spawn, exists = existsSync, env = process.env, timeoutMs = 8000, lookup = dnsLookup } = {}
) {
  const filePath = await resolveVerifiedLocalFilePath(uri, { platform, lookup });
  if (!exists(filePath)) throw new Error('文件或文件夹不存在');

  let result;
  if (platform === 'win32') {
    result = await runProcessAsync(
      spawnProcess,
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', 'Set-Clipboard -LiteralPath $env:AGY_CLIPBOARD_PATH'],
      { windowsHide: true, env: { ...env, AGY_CLIPBOARD_PATH: filePath } },
      { timeoutMs }
    );
  } else if (platform === 'darwin') {
    result = await runProcessAsync(
      spawnProcess,
      'osascript',
      ['-e', 'set the clipboard to (POSIX file (system attribute "AGY_CLIPBOARD_PATH"))'],
      { env: { ...env, AGY_CLIPBOARD_PATH: filePath } },
      { timeoutMs }
    );
  } else {
    const fileUri = `${pathToFileURL(filePath).href}\n`;
    result = await runProcessAsync(
      spawnProcess,
      'wl-copy',
      ['--type', 'text/uri-list'],
      { env },
      { input: fileUri, timeoutMs }
    );
    if (result.error || result.status !== 0) {
      result = await runProcessAsync(
        spawnProcess,
        'xclip',
        ['-selection', 'clipboard', '-t', 'text/uri-list'],
        { env },
        { input: fileUri, timeoutMs }
      );
    }
  }

  if (result?.error || result?.status !== 0) {
    throw new Error(result?.stderr?.trim() || result?.error?.message || '复制文件失败');
  }
  return { ok: true, path: filePath };
}

const ATTACH_MEDIA_MIME = new Map([
  ['.png', { mimeType: 'image/png', kind: 'media' }],
  ['.jpg', { mimeType: 'image/jpeg', kind: 'media' }],
  ['.jpeg', { mimeType: 'image/jpeg', kind: 'media' }],
  ['.gif', { mimeType: 'image/gif', kind: 'media' }],
  ['.webp', { mimeType: 'image/webp', kind: 'media' }],
  ['.bmp', { mimeType: 'image/bmp', kind: 'media' }],
  ['.pdf', { mimeType: 'application/pdf', kind: 'doc' }],
  ['.docx', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'doc' }],
  ['.doc', { mimeType: 'application/msword', kind: 'doc' }],
  ['.xlsx', { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'doc' }],
  ['.xls', { mimeType: 'application/vnd.ms-excel', kind: 'doc' }],
  ['.pptx', { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'doc' }],
  ['.ppt', { mimeType: 'application/vnd.ms-powerpoint', kind: 'doc' }],
  ['.odt', { mimeType: 'application/vnd.oasis.opendocument.text', kind: 'doc' }],
  ['.ods', { mimeType: 'application/vnd.oasis.opendocument.spreadsheet', kind: 'doc' }],
  ['.odp', { mimeType: 'application/vnd.oasis.opendocument.presentation', kind: 'doc' }],
  ['.rtf', { mimeType: 'application/rtf', kind: 'doc' }],
  ['.zip', { mimeType: 'application/zip', kind: 'media' }],
  ['.mp4', { mimeType: 'video/mp4', kind: 'media' }],
  ['.webm', { mimeType: 'video/webm', kind: 'media' }],
  ['.wav', { mimeType: 'audio/wav', kind: 'media' }],
  ['.mp3', { mimeType: 'audio/mp3', kind: 'media' }],
  ['.m4a', { mimeType: 'audio/m4a', kind: 'media' }],
  ['.aac', { mimeType: 'audio/aac', kind: 'media' }],
  ['.ogg', { mimeType: 'audio/ogg', kind: 'media' }],
  ['.flac', { mimeType: 'audio/flac', kind: 'media' }],
  ['.opus', { mimeType: 'audio/opus', kind: 'media' }],
  ['.weba', { mimeType: 'audio/webm', kind: 'media' }]
]);

export async function readLocalFileForAttach(
  uri,
  {
    platform = process.platform,
    exists = existsSync,
    stat = statSync,
    readFile = readFileSync,
    lookup = dnsLookup,
    maxMediaBytes = 10 * 1024 * 1024,
    maxDocBytes = 10 * 1024 * 1024
  } = {}
) {
  const filePath = await resolveVerifiedLocalFilePath(uri, { platform, lookup });
  if (!exists(filePath)) throw new Error('文件或文件夹不存在');
  const info = stat(filePath);
  const name = basename(filePath) || filePath;
  const normalizedUri = pathToFileURL(filePath).href;
  if (info?.isDirectory?.()) {
    return { ok: true, mode: 'mention', kind: 'directory', uri: normalizedUri, path: filePath, name, isDirectory: true };
  }
  const spec = ATTACH_MEDIA_MIME.get(extname(filePath).toLowerCase());
  const size = Number(info?.size || 0);
  const limit = spec?.kind === 'doc' ? maxDocBytes : maxMediaBytes;
  if (spec && size >= 0 && size <= limit) {
    const buffer = readFile(filePath);
    return {
      ok: true,
      mode: 'media',
      kind: 'file',
      uri: normalizedUri,
      path: filePath,
      name,
      mimeType: spec.mimeType,
      size: buffer.length,
      base64: buffer.toString('base64'),
      isDirectory: false
    };
  }
  return {
    ok: true,
    mode: 'mention',
    kind: 'file',
    uri: normalizedUri,
    path: filePath,
    name,
    size,
    oversized: Boolean(spec && size > limit),
    isDirectory: false
  };
}
