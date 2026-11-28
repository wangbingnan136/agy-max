import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { decodeDarwinKeychainSecret } from './credential-vault.mjs';
import { writeMacGenericPassword } from './mac-keychain.mjs';

export const SSH_VAULT_SERVICE = 'agy-max-ssh-host';
const HOST_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const WIN32_MAX_BYTES = 2560;

export function sshVaultTarget(hostId) {
  const id = String(hostId || '').trim();
  if (!HOST_ID_RE.test(id)) throw new Error('无效的 SSH 主机标识');
  return `agy-max:ssh-host:${id}`;
}

const WIN32_SSH_CRED_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class AgySshCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredReadW(string target, uint type, int reservedFlag, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredWriteW([In] ref CREDENTIAL userCredential, uint flags);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredDeleteW(string target, uint type, int flags);

  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr cred);
}
"@
$op = $env:AGY_SSH_CRED_OP
$target = $env:AGY_SSH_CRED_TARGET
$user = if ([string]::IsNullOrEmpty($env:AGY_SSH_CRED_USER)) { 'ssh' } else { $env:AGY_SSH_CRED_USER }
if ($op -eq 'has' -or $op -eq 'read') {
  $ptr = [IntPtr]::Zero
  if ([AgySshCred]::CredReadW($target, 1, 0, [ref]$ptr)) {
    try {
      $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][AgySshCred+CREDENTIAL])
      if ($op -eq 'has') {
        Write-Output '{"ok":true,"exists":true}'
      } else {
        $bytes = New-Object byte[] $cred.CredentialBlobSize
        if ($cred.CredentialBlobSize -gt 0) {
          [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, [int]$cred.CredentialBlobSize)
        }
        $b64 = [Convert]::ToBase64String($bytes)
        [Array]::Clear($bytes, 0, $bytes.Length)
        Write-Output (@{ ok = $true; exists = $true; data = $b64 } | ConvertTo-Json -Compress)
      }
    } finally {
      [AgySshCred]::CredFree($ptr)
    }
  } else {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -eq 1168) {
      Write-Output '{"ok":true,"exists":false}'
    } else {
      Write-Output (@{ ok = $false; error = "CredReadW failed ($err)" } | ConvertTo-Json -Compress)
    }
  }
} elseif ($op -eq 'write') {
  $rawB64 = [Console]::In.ReadToEnd().Trim()
  $bytes = [Convert]::FromBase64String($rawB64)
  $blobPtr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blobPtr, $bytes.Length)
    $cred = New-Object AgySshCred+CREDENTIAL
    $cred.Type = 1
    $cred.TargetName = $target
    $cred.UserName = $user
    $cred.Persist = 2
    $cred.CredentialBlobSize = [uint32]$bytes.Length
    $cred.CredentialBlob = $blobPtr
    if ([AgySshCred]::CredWriteW([ref]$cred, 0)) {
      Write-Output '{"ok":true}'
    } else {
      $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      Write-Output (@{ ok = $false; error = "CredWriteW failed ($err)" } | ConvertTo-Json -Compress)
    }
  } finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    [Runtime.InteropServices.Marshal]::FreeHGlobal($blobPtr)
  }
} elseif ($op -eq 'remove') {
  if ([AgySshCred]::CredDeleteW($target, 1, 0)) {
    Write-Output '{"ok":true}'
  } else {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -eq 1168) { Write-Output '{"ok":true}' }
    else { Write-Output (@{ ok = $false; error = "CredDeleteW failed ($err)" } | ConvertTo-Json -Compress) }
  }
}
`;

export function createSshCredentialVault({
  platform = process.platform,
  env = process.env,
  runSpawn = spawnSync
} = {}) {
  const supported = platform === 'darwin' || platform === 'win32' || platform === 'linux';

  function runWin32(op, target, { user = 'ssh', secretBase64 = '' } = {}) {
    const res = runSpawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', WIN32_SSH_CRED_SCRIPT
    ], {
      env: { ...env, AGY_SSH_CRED_OP: op, AGY_SSH_CRED_TARGET: target, AGY_SSH_CRED_USER: user },
      input: secretBase64 ? `${secretBase64}\n` : undefined,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 12000
    });
    if (res.error) return { ok: false, error: res.error.message };
    const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
    try {
      return JSON.parse(line);
    } catch {
      return { ok: false, error: String(res.stderr || '').trim() || `Windows 凭据库操作失败 (${res.status})` };
    }
  }

  function savePassword(hostId, password, { user = 'ssh' } = {}) {
    if (!supported) return { ok: false, error: '当前系统不支持凭据库' };
    const target = sshVaultTarget(hostId);
    const secret = String(password ?? '');
    if (!secret) return { ok: false, error: '密码不能为空' };
    const buf = Buffer.from(secret, 'utf8');
    try {
      if (platform === 'win32') {
        if (buf.length > WIN32_MAX_BYTES) return { ok: false, error: '凭据长度超出 Windows 凭据管理器上限' };
        return runWin32('write', target, { user, secretBase64: buf.toString('base64') });
      }
      if (platform === 'darwin') {
        const res = writeMacGenericPassword({ service: SSH_VAULT_SERVICE, account: hostId, buf, runSpawn });
        if (!res.ok) return { ok: false, error: res.error || '写入 macOS 钥匙串失败' };
        return { ok: true };
      }
      const res = runSpawn('secret-tool', ['store', '--label=Antigravity Max SSH', 'service', SSH_VAULT_SERVICE, 'username', hostId], {
        input: buf,
        stdio: ['pipe', 'ignore', 'pipe'],
        timeout: 8000
      });
      if (res.error?.code === 'ENOENT') {
        return { ok: false, error: '未安装 secret-tool（libsecret-tools），无法保存密码到 Linux 密钥环' };
      }
      if (res.error || res.status !== 0) {
        return { ok: false, error: res.error?.message || String(res.stderr || '').trim() || '写入 Linux 密钥环失败' };
      }
      return { ok: true };
    } finally {
      buf.fill(0);
    }
  }

  function readPassword(hostId) {
    if (!supported) return { ok: false, exists: false, password: '', error: '当前系统不支持凭据库' };
    const target = sshVaultTarget(hostId);
    if (platform === 'win32') {
      const res = runWin32('read', target);
      if (!res?.ok) return { ok: false, exists: false, password: '', error: res?.error || '读取凭据失败' };
      if (!res.exists || !res.data) return { ok: true, exists: false, password: '' };
      const buf = Buffer.from(res.data, 'base64');
      const password = buf.toString('utf8');
      buf.fill(0);
      return { ok: true, exists: true, password };
    }
    if (platform === 'darwin') {
      const res = runSpawn('/usr/bin/security', ['find-generic-password', '-s', SSH_VAULT_SERVICE, '-a', hostId, '-w'], {
        timeout: 8000
      });
      if (res.status === 44) return { ok: true, exists: false, password: '' };
      if (res.error || res.status !== 0) {
        return { ok: false, exists: false, password: '', error: res.error?.message || String(res.stderr || '').trim() || '读取钥匙串失败' };
      }
      const buf = decodeDarwinKeychainSecret(res.stdout || '');
      const password = buf.toString('utf8');
      buf.fill(0);
      return { ok: true, exists: true, password };
    }
    const res = runSpawn('secret-tool', ['lookup', 'service', SSH_VAULT_SERVICE, 'username', hostId], {
      timeout: 8000
    });
    if (res.status === 1 && !String(res.stderr || '').trim() && !res.error) {
      return { ok: true, exists: false, password: '' };
    }
    if (res.error || res.status !== 0) {
      return { ok: false, exists: false, password: '', error: res.error?.message || String(res.stderr || '').trim() || '读取密钥环失败' };
    }
    return { ok: true, exists: true, password: Buffer.from(res.stdout || '').toString('utf8') };
  }

  function hasPassword(hostId) {
    if (!supported) return false;
    const target = sshVaultTarget(hostId);
    if (platform === 'win32') return Boolean(runWin32('has', target)?.exists);
    if (platform === 'darwin') {
      const res = runSpawn('/usr/bin/security', ['find-generic-password', '-s', SSH_VAULT_SERVICE, '-a', hostId], {
        stdio: 'ignore',
        timeout: 8000
      });
      return res.status === 0;
    }
    const res = runSpawn('secret-tool', ['lookup', 'service', SSH_VAULT_SERVICE, 'username', hostId], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 8000
    });
    return res.status === 0;
  }

  function removePassword(hostId) {
    if (!supported) return { ok: true };
    const target = sshVaultTarget(hostId);
    if (platform === 'win32') return runWin32('remove', target);
    if (platform === 'darwin') {
      const res = runSpawn('/usr/bin/security', ['delete-generic-password', '-s', SSH_VAULT_SERVICE, '-a', hostId], {
        stdio: 'ignore',
        timeout: 8000
      });
      if (res.status === 0 || res.status === 44) return { ok: true };
      return { ok: false, error: res.error?.message || `Keychain delete failed (exit ${res.status})` };
    }
    const res = runSpawn('secret-tool', ['clear', 'service', SSH_VAULT_SERVICE, 'username', hostId], {
      stdio: 'ignore',
      timeout: 8000
    });
    if (res.status === 0 || res.status === 1) return { ok: true };
    return { ok: false, error: res.error?.message || `Secret Service delete failed (exit ${res.status})` };
  }

  return { supported, savePassword, readPassword, hasPassword, removePassword };
}

/**
 * Creates an ephemeral cross-platform SSH_ASKPASS wrapper for OpenSSH password auth
 * without requiring third-party `sshpass`. Temp secret and script are deleted immediately
 * after the callback finishes.
 */
export async function withSshAskpass(password, fn, { platform = process.platform, tempRoot = tmpdir() } = {}) {
  if (!password) return fn({});
  const token = randomBytes(12).toString('hex');
  const secretPath = join(tempRoot, `.agy-ssh-secret-${process.pid}-${token}`);
  const isWin = platform === 'win32';
  const scriptPath = join(tempRoot, `.agy-ssh-askpass-${process.pid}-${token}${isWin ? '.cmd' : '.sh'}`);
  mkdirSync(tempRoot, { recursive: true });
  writeFileSync(secretPath, String(password), { mode: 0o600, flag: 'wx' });
  try {
    if (!isWin) try { chmodSync(secretPath, 0o600); } catch {}
    if (isWin) {
      // Uses the current Node executable to echo the secret cleanly without cmd escaping bugs.
      const nodeExe = process.execPath.replace(/"/g, '""');
      const helperScript = `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(secretPath)},'utf8'))`;
      const cmdContent = `@echo off\r\n"${nodeExe}" -e "${helperScript.replace(/"/g, '\\"')}"\r\n`;
      writeFileSync(scriptPath, cmdContent, { mode: 0o700, flag: 'wx' });
    } else {
      const quoted = `'${secretPath.replace(/'/g, `'\\''`)}'`;
      const shContent = `#!/bin/sh\ncat ${quoted}\n`;
      writeFileSync(scriptPath, shContent, { mode: 0o700, flag: 'wx' });
      try { chmodSync(scriptPath, 0o700); } catch {}
    }
    return await fn({
      SSH_ASKPASS: scriptPath,
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: process.env.DISPLAY || 'agy-max-ssh:0'
    });
  } finally {
    try { writeFileSync(secretPath, '', { mode: 0o600 }); } catch {}
    try { unlinkSync(secretPath); } catch {}
    try { unlinkSync(scriptPath); } catch {}
  }
}

export function ensureLocalPublicKey({ home = homedir(), runSpawn = spawnSync, platform = process.platform, keyName = '' } = {}) {
  const sshDir = join(home, '.ssh');
  // A named key belongs to one server: never fall back to the shared default identities.
  const candidates = keyName ? [join(sshDir, `${keyName}.pub`)] : [
    join(sshDir, 'id_ed25519.pub'),
    join(sshDir, 'id_ecdsa.pub'),
    join(sshDir, 'id_rsa.pub')
  ];
  for (const pubPath of candidates) {
    if (existsSync(pubPath)) {
      const content = readFileSync(pubPath, 'utf8').trim();
      if (content) {
        return {
          ok: true,
          created: false,
          publicKeyPath: pubPath,
          privateKeyPath: pubPath.replace(/\.pub$/, ''),
          publicKey: content
        };
      }
    }
  }
  mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  const keyPath = join(sshDir, keyName || 'id_ed25519');
  const pubPath = `${keyPath}.pub`;
  const keygen = platform === 'win32' ? 'ssh-keygen.exe' : 'ssh-keygen';
  const res = runSpawn(keygen, ['-t', 'ed25519', '-N', '', '-f', keyPath, '-C', keyName ? `agy-max-ssh ${keyName}` : 'agy-max-ssh'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000
  });
  if (res.error || res.status !== 0 || !existsSync(pubPath)) {
    throw new Error(res.error?.message || String(res.stderr || '').trim() || '生成本地 SSH 密钥失败');
  }
  return {
    ok: true,
    created: true,
    publicKeyPath: pubPath,
    privateKeyPath: keyPath,
    publicKey: readFileSync(pubPath, 'utf8').trim()
  };
}
