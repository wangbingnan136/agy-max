import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendWslEnv, isWslEnvironment, wslDistroName } from './wsl.mjs';
import { buildMacKeychainReadScript, writeMacGenericPassword } from './mac-keychain.mjs';

export const ACTIVE_TARGET = 'gemini:antigravity';
export const ACTIVE_USERNAME = 'antigravity';
export const ACTIVE_SERVICE = 'gemini';
export const VAULT_SERVICE = 'agy-powertools-account';
export const SECRET_SERVICE = 'agy-max-secret';

const WIN32_MAX_CREDENTIAL_BYTES = 2560;
const ACCOUNT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const CRED_EMAIL_RE = /^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/;
const SECRET_HASH_RE = /^[a-f0-9]{16,64}$/;
const SECRET_CONTROL_RE = /[\x00-\x1f\x7f]/;
const MAC_UNAVAILABLE_RE = /-25308|-25293|interaction not allowed|keychain.*locked/i;
const LINUX_UNAVAILABLE_RE = /cannot autolaunch d-bus|org\.freedesktop\.secrets|no such interface|cannot connect to|dbus|keyring.*locked|serviceunknown/i;

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  return CRED_EMAIL_RE.test(value) ? value : '';
}

const UTF8_FATAL_DECODER = new TextDecoder('utf-8', { fatal: true });
const UTF16LE_FATAL_DECODER = new TextDecoder('utf-16le', { fatal: true });

export function extractCredentialEmail(bufferOrText) {
  if (!Buffer.isBuffer(bufferOrText)) return extractEmailFromText(String(bufferOrText || ''));
  const utf16First = (bufferOrText[0] === 0xff && bufferOrText[1] === 0xfe) || bufferOrText[1] === 0;
  const decoders = utf16First ? [UTF16LE_FATAL_DECODER, UTF8_FATAL_DECODER] : [UTF8_FATAL_DECODER, UTF16LE_FATAL_DECODER];
  for (const decoder of decoders) {
    try {
      const email = extractEmailFromText(decoder.decode(bufferOrText));
      if (email) return email;
    } catch {}
  }
  return '';
}

function extractEmailFromText(text) {
  try {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) return '';
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const direct = normalizeEmail(parsed.id_token_email);
      if (direct) return direct;
      if (typeof parsed.token === 'string' && parsed.token) {
        const inner = Buffer.from(parsed.token, 'base64');
        try {
          return extractCredentialEmail(inner);
        } finally {
          inner.fill(0);
        }
      }
    }
  } catch {}
  return '';
}

function mismatchResult(actualEmail, expectedEmail) {
  return {
    ok: false,
    mismatch: true,
    actualEmail,
    expectedEmail,
    error: `当前系统凭据属于 ${actualEmail}，与目标账号 ${expectedEmail} 不一致，已跳过写入以防凭据串号`
  };
}

export function vaultTargetFor(accountId, { wslDistro = '' } = {}) {
  const id = String(accountId || '').trim();
  if (!ACCOUNT_ID_RE.test(id)) throw new Error('账号标识无效');
  const distro = String(wslDistro || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48);
  return distro ? `agy-powertools:wsl:${distro}:account:${id}` : `agy-powertools:account:${id}`;
}

export function secretTargetFor(scopeKey, { wslDistro = '' } = {}) {
  const raw = typeof scopeKey === 'string' ? scopeKey.trim() : '';
  if (!raw || raw.length > 256 || SECRET_CONTROL_RE.test(raw)) throw new Error('凭据标识无效');
  const digest = createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32);
  const distro = String(wslDistro || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48);
  return distro ? `${SECRET_SERVICE}:wsl:${distro}:${digest}` : `${SECRET_SERVICE}:${digest}`;
}

function splitPosixTarget(target) {
  if (target === ACTIVE_TARGET) return { service: ACTIVE_SERVICE, account: ACTIVE_USERNAME };
  const prefix = 'agy-powertools:account:';
  if (target.startsWith(prefix)) {
    const account = target.slice(prefix.length);
    if (!ACCOUNT_ID_RE.test(account)) throw new Error('账号标识无效');
    return { service: VAULT_SERVICE, account };
  }
  const secretPrefix = `${SECRET_SERVICE}:`;
  if (target.startsWith(secretPrefix)) {
    const account = target.slice(secretPrefix.length);
    if (!SECRET_HASH_RE.test(account)) throw new Error('凭据标识无效');
    return { service: SECRET_SERVICE, account };
  }
  throw new Error('不支持的凭据目标');
}

function shortHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 12).toUpperCase();
}

const LOWER_HEX_RE = /^(?:[0-9a-f]{2})+$/;

export function decodeDarwinKeychainSecret(rawStdout) {
  const text = (Buffer.isBuffer(rawStdout) ? rawStdout.toString('utf8') : String(rawStdout || ''))
    .replace(/[\r\n]+$/, '');
  if (LOWER_HEX_RE.test(text)) {
    const decoded = Buffer.from(text, 'hex');
    let hasNonPrintable = false;
    let hasDisallowedControl = false;
    for (let i = 0; i < decoded.length; i++) {
      const b = decoded[i];
      if (b < 0x20 || b >= 0x7f) {
        hasNonPrintable = true;
        if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f) {
          hasDisallowedControl = true;
          break;
        }
      }
    }
    if (hasNonPrintable && !hasDisallowedControl) {
      try {
        UTF8_FATAL_DECODER.decode(decoded);
        return decoded;
      } catch {}
    }
    decoded.fill(0);
  }
  return Buffer.from(text, 'utf8');
}

const WIN32_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

public static class AgyWinCred {
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

  public static string ShortHash(byte[] bytes) {
    using (var sha = SHA256.Create()) {
      return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").Substring(0, 12);
    }
  }

  private static string FindJsonStringField(string text, string key) {
    if (string.IsNullOrEmpty(text)) return "";
    string needle = "\\"" + key + "\\"";
    int start = 0;
    while (start < text.Length) {
      int idx = text.IndexOf(needle, start, StringComparison.Ordinal);
      if (idx < 0) return "";
      start = idx + needle.Length;
      if (idx > 0 && text[idx - 1] == '\\\\') continue;
      int p = start;
      while (p < text.Length && (text[p] == ' ' || text[p] == '\\t' || text[p] == '\\r' || text[p] == '\\n')) p++;
      if (p >= text.Length || text[p] != ':') continue;
      p++;
      while (p < text.Length && (text[p] == ' ' || text[p] == '\\t' || text[p] == '\\r' || text[p] == '\\n')) p++;
      if (p >= text.Length || text[p] != '"') continue;
      int q2 = p + 1;
      while (q2 < text.Length) {
        if (text[q2] == '\\\\') { q2 += 2; continue; }
        if (text[q2] == '"') break;
        q2++;
      }
      if (q2 < text.Length && q2 > p + 1 && text[q2] == '"') {
        return text.Substring(p + 1, q2 - p - 1).Trim();
      }
      start = Math.Min(q2 + 1, text.Length);
    }
    return "";
  }

  private static bool IsSafeEmail(string value) {
    if (string.IsNullOrEmpty(value) || value.Length > 254) return false;
    int at = value.IndexOf('@');
    if (at <= 0 || at != value.LastIndexOf('@')) return false;
    int dot = value.IndexOf('.', at + 2);
    if (dot < 0 || dot >= value.Length - 1) return false;
    for (int i = 0; i < value.Length; i++) {
      char ch = value[i];
      if (ch <= 32 || ch >= 127 || ch == '"' || ch == '\\\\') return false;
    }
    return true;
  }

  private static string DecodeCredential(byte[] bytes, bool utf16) {
    var encoding = utf16 ? (System.Text.Encoding)new System.Text.UnicodeEncoding(false, false, true)
      : new System.Text.UTF8Encoding(false, true);
    return encoding.GetString(bytes).TrimStart((char)0xfeff).Trim().TrimEnd((char)0);
  }

  public static string ExtractEmail(byte[] bytes) {
    return ExtractEmail(bytes, true);
  }

  private static string ExtractEmail(byte[] bytes, bool allowEnvelope) {
    if (bytes == null || bytes.Length == 0) return "";
    bool utf16First = bytes.Length > 1 && ((bytes[0] == 0xff && bytes[1] == 0xfe) || bytes[1] == 0);
    foreach (bool utf16 in new[] { utf16First, !utf16First }) {
      try {
        string text = DecodeCredential(bytes, utf16);
        if (!text.StartsWith("{", StringComparison.Ordinal) || !text.EndsWith("}", StringComparison.Ordinal)) continue;
        string direct = FindJsonStringField(text, "id_token_email");
        if (IsSafeEmail(direct)) return direct.ToLowerInvariant();
        if (!allowEnvelope) continue;
        string b64 = FindJsonStringField(text, "token");
        if (string.IsNullOrEmpty(b64)) continue;
        byte[] inner = Convert.FromBase64String(b64);
        try {
          string email = ExtractEmail(inner, false);
          if (!string.IsNullOrEmpty(email)) return email;
        } finally {
          Array.Clear(inner, 0, inner.Length);
        }
      } catch (ArgumentException) {} catch (FormatException) {}
    }
    return "";
  }
}
"@
$op = $env:AGY_CRED_OP
$src = $env:AGY_CRED_SRC
$dst = $env:AGY_CRED_DST
$dstUser = $env:AGY_CRED_USER
$expectedEmail = if ([string]::IsNullOrEmpty($env:AGY_CRED_EXPECTED_EMAIL)) { '' } else { $env:AGY_CRED_EXPECTED_EMAIL.Trim().ToLowerInvariant() }
$expectedHash = $env:AGY_CRED_EXPECTED_HASH
if ($op -eq 'has' -or $op -eq 'inspect') {
  $ptr = [IntPtr]::Zero
  if ([AgyWinCred]::CredReadW($src, 1, 0, [ref]$ptr)) {
    [byte[]]$bytes = $null
    try {
      $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][AgyWinCred+CREDENTIAL])
      $size = [int]$c.CredentialBlobSize
      $bytes = New-Object byte[] $size
      if ($size -gt 0 -and $c.CredentialBlob -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $bytes, 0, $size)
      }
      $hash = [AgyWinCred]::ShortHash($bytes)
      $email = [AgyWinCred]::ExtractEmail($bytes)
      $emailPart = if ([string]::IsNullOrEmpty($email)) { '' } else { ',"email":"' + $email + '"' }
      Write-Output ('{"ok":true,"exists":true,"bytes":' + $size + ',"hash":"' + $hash + '"' + $emailPart + '}')
    } finally {
      if ($bytes -ne $null) { [Array]::Clear($bytes, 0, $bytes.Length) }
      [AgyWinCred]::CredFree($ptr)
    }
  } else {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -eq 1168) {
      Write-Output '{"ok":true,"exists":false,"status":"missing","hash":""}'
    } else {
      Write-Output ('{"ok":false,"status":"error","win32Error":' + $err + ',"error":"read failed: ' + $err + '"}')
      exit 1
    }
  }
} elseif ($op -eq 'copy') {
  $ptr = [IntPtr]::Zero
  if (-not [AgyWinCred]::CredReadW($src, 1, 0, [ref]$ptr)) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output ('{"ok":false,"error":"read failed: ' + $err + '"}')
    exit 1
  }
  $blobCopy = [IntPtr]::Zero
  [byte[]]$bytes = $null
  try {
    $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][AgyWinCred+CREDENTIAL])
    $size = [int]$c.CredentialBlobSize
    $bytes = New-Object byte[] $size
    if ($size -gt 0 -and $c.CredentialBlob -ne [IntPtr]::Zero) {
      [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $bytes, 0, $size)
    }
    $email = [AgyWinCred]::ExtractEmail($bytes)
    if (-not [string]::IsNullOrEmpty($expectedEmail) -and -not [string]::IsNullOrEmpty($email) -and $email -ne $expectedEmail) {
      Write-Output ('{"ok":false,"mismatch":true,"actualEmail":"' + $email + '","expectedEmail":"' + $expectedEmail + '","error":"credential email mismatch"}')
      exit 1
    }
    $hash = [AgyWinCred]::ShortHash($bytes)
    if ($expectedHash -and $hash -ne $expectedHash) {
      Write-Output '{"ok":false,"error":"source credential hash changed"}'
      exit 1
    }
    if ($dst -eq 'gemini:antigravity' -and $expectedEmail -and -not $email -and -not $expectedHash) {
      $dstPtr = [IntPtr]::Zero
      if ([AgyWinCred]::CredReadW($dst, 1, 0, [ref]$dstPtr)) {
        [byte[]]$dstBytes = $null
        try {
          $existing = [System.Runtime.InteropServices.Marshal]::PtrToStructure($dstPtr, [Type][AgyWinCred+CREDENTIAL])
          $dstSize = [int]$existing.CredentialBlobSize
          $dstBytes = New-Object byte[] $dstSize
          if ($dstSize -gt 0) {
            [System.Runtime.InteropServices.Marshal]::Copy($existing.CredentialBlob, $dstBytes, 0, $dstSize)
          }
          if ([AgyWinCred]::ShortHash($dstBytes) -ne $hash) {
            Write-Output '{"ok":false,"error":"refusing to overwrite an unverifiable credential"}'
            exit 1
          }
        } finally {
          if ($dstBytes -ne $null) { [Array]::Clear($dstBytes, 0, $dstBytes.Length) }
          [AgyWinCred]::CredFree($dstPtr)
        }
      } else {
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($err -ne 1168) {
          Write-Output ('{"ok":false,"error":"destination read failed: ' + $err + '"}')
          exit 1
        }
      }
    }
    if ($size -gt 0) {
      $blobCopy = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
      [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blobCopy, $size)
    }
    $next = New-Object AgyWinCred+CREDENTIAL
    $next.Flags = 0
    $next.Type = 1
    $next.TargetName = $dst
    $next.Comment = $c.Comment
    $next.CredentialBlobSize = [uint32]$size
    $next.CredentialBlob = $blobCopy
    $next.Persist = if ($c.Persist -ne 0) { $c.Persist } else { 2 }
    $next.AttributeCount = 0
    $next.Attributes = [IntPtr]::Zero
    $next.TargetAlias = $null
    $next.UserName = if ([string]::IsNullOrEmpty($dstUser)) { $c.UserName } else { $dstUser }
    if (-not [AgyWinCred]::CredWriteW([ref]$next, 0)) {
      $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
      Write-Output ('{"ok":false,"error":"write failed: ' + $err + '"}')
      exit 1
    }
    $emailPart = if ([string]::IsNullOrEmpty($email)) { '' } else { ',"email":"' + $email + '"' }
    Write-Output ('{"ok":true,"bytes":' + $size + ',"hash":"' + $hash + '"' + $emailPart + '}')
  } finally {
    if ($bytes -ne $null) { [Array]::Clear($bytes, 0, $bytes.Length) }
    if ($blobCopy -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($blobCopy) }
    if ($ptr -ne [IntPtr]::Zero) { [AgyWinCred]::CredFree($ptr) }
  }
} elseif ($op -eq 'probe') {
  Write-Output '{"ok":true}'
} elseif ($op -eq 'read') {
  $ptr = [IntPtr]::Zero
  if ([AgyWinCred]::CredReadW($src, 1, 0, [ref]$ptr)) {
    [byte[]]$bytes = $null
    try {
      $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][AgyWinCred+CREDENTIAL])
      $size = [int]$c.CredentialBlobSize
      $bytes = New-Object byte[] $size
      if ($size -gt 0 -and $c.CredentialBlob -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $bytes, 0, $size)
      }
      $hash = [AgyWinCred]::ShortHash($bytes)
      $b64 = [Convert]::ToBase64String($bytes)
      Write-Output ('{"ok":true,"exists":true,"bytes":' + $size + ',"hash":"' + $hash + '","data":"' + $b64 + '"}')
    } finally {
      if ($bytes -ne $null) { [Array]::Clear($bytes, 0, $bytes.Length) }
      if ($ptr -ne [IntPtr]::Zero) { [AgyWinCred]::CredFree($ptr) }
    }
  } else {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -eq 1168) {
      Write-Output '{"ok":true,"exists":false,"status":"missing","hash":"","data":""}'
    } else {
      Write-Output ('{"ok":false,"status":"error","win32Error":' + $err + ',"error":"read failed: ' + $err + '"}')
      exit 1
    }
  }
} elseif ($op -eq 'write') {
  $raw = [Console]::In.ReadToEnd().Trim()
  if ([string]::IsNullOrEmpty($raw)) {
    Write-Output '{"ok":false,"error":"empty payload"}'
    exit 1
  }
  [byte[]]$bytes = $null
  $blobCopy = [IntPtr]::Zero
  try {
    $bytes = [Convert]::FromBase64String($raw)
    $size = $bytes.Length
    if ($size -gt 2560) {
      Write-Output '{"ok":false,"error":"WSL credential envelope exceeds the 2560-byte Windows Credential Manager limit"}'
      exit 1
    }
    if ($size -gt 0) {
      $blobCopy = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
      [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blobCopy, $size)
    }
    $hash = [AgyWinCred]::ShortHash($bytes)
    $next = New-Object AgyWinCred+CREDENTIAL
    $next.Flags = 0
    $next.Type = 1
    $next.TargetName = $dst
    $next.Comment = 'Agy Powertools WSL account backup'
    $next.CredentialBlobSize = [uint32]$size
    $next.CredentialBlob = $blobCopy
    $next.Persist = 2
    $next.AttributeCount = 0
    $next.Attributes = [IntPtr]::Zero
    $next.TargetAlias = $null
    $next.UserName = if ([string]::IsNullOrEmpty($dstUser)) { 'antigravity' } else { $dstUser }
    if (-not [AgyWinCred]::CredWriteW([ref]$next, 0)) {
      $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
      Write-Output ('{"ok":false,"error":"write failed: ' + $err + '"}')
      exit 1
    }
    Write-Output ('{"ok":true,"bytes":' + $size + ',"hash":"' + $hash + '"}')
  } finally {
    if ($bytes -ne $null) { [Array]::Clear($bytes, 0, $bytes.Length) }
    if ($blobCopy -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($blobCopy) }
  }
} elseif ($op -eq 'remove') {
  $ok = [AgyWinCred]::CredDeleteW($src, 1, 0)
  if (-not $ok) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -eq 1168) {
      Write-Output '{"ok":true,"status":"missing"}'
      exit 0
    }
    Write-Output ('{"ok":false,"error":"delete failed: ' + $err + '"}')
    exit 1
  }
  Write-Output '{"ok":true}'
} else {
  Write-Output '{"ok":false,"error":"unknown op"}'
  exit 1
}
`;

function unlinkIfPresent(path) {
  try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function readIfPresent(path) {
  try { return readFileSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

function stageSecureFile(filePath, buffer, stagedFiles) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = filePath + '.' + randomUUID() + '.tmp';
  stagedFiles.push(tmpPath);
  writeFileSync(tmpPath, buffer, { mode: 0o600, flag: 'wx' });
  try { chmodSync(tmpPath, 0o600); } catch {}
  return tmpPath;
}

export function createCredentialVault({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  wsl,
  wslDistro,
  runSpawn = spawnSync
} = {}) {
  const wslMode = typeof wsl === 'boolean' ? wsl : isWslEnvironment({ platform, env });
  const distro = wslMode ? (wslDistro || wslDistroName({ env })) : '';
  const supported = platform === 'win32' || platform === 'darwin' || platform === 'linux';
  const backend = platform === 'win32'
    ? 'win32-credman'
    : platform === 'darwin'
      ? 'darwin-keychain'
      : wslMode
        ? 'wsl-wincred'
        : platform === 'linux'
          ? 'linux-secret-service'
          : 'unsupported';

  const wslActiveTokenPath = join(home, '.gemini', 'jetski-standalone-oauth-token');
  const wslActiveScopePath = join(env?.XDG_CONFIG_HOME || join(home, '.config'), 'antigravity', 'credential-user-scope');
  let probeCache = null;

  function runWin32(op, src, dst = '', userName = '', input = undefined, expectedEmail = '', expectedHash = '') {
    const normalizedExpected = normalizeEmail(expectedEmail);
    const baseEnv = {
      ...env,
      AGY_CRED_OP: op,
      AGY_CRED_SRC: src,
      AGY_CRED_DST: dst,
      AGY_CRED_USER: userName,
      AGY_CRED_EXPECTED_EMAIL: normalizedExpected,
      AGY_CRED_EXPECTED_HASH: expectedHash
    };
    const wslKeys = ['AGY_CRED_OP', 'AGY_CRED_SRC', 'AGY_CRED_DST', 'AGY_CRED_USER', 'AGY_CRED_EXPECTED_EMAIL', 'AGY_CRED_EXPECTED_HASH'];
    const finalEnv = wslMode
      ? appendWslEnv(baseEnv, wslKeys)
      : baseEnv;
    const opts = {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 12000,
      env: finalEnv
    };
    if (input !== undefined) {
      opts.input = input;
      opts.stdio = ['pipe', 'pipe', 'pipe'];
    } else if (wslMode) {
      opts.stdio = ['ignore', 'pipe', 'pipe'];
    }
    const result = runSpawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', WIN32_SCRIPT],
      opts
    );
    const line = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
    try {
      const parsed = JSON.parse(line);
      if (result.status === 0 && parsed?.ok) return parsed;
      if (parsed?.mismatch) {
        const actualEmail = normalizeEmail(parsed.actualEmail);
        const expected = normalizeEmail(parsed.expectedEmail || normalizedExpected);
        return actualEmail && expected
          ? mismatchResult(actualEmail, expected)
          : { ok: false, mismatch: true, actualEmail, expectedEmail: expected, error: parsed.error || '凭据所属账号不一致，已跳过写入' };
      }
      return { ok: false, ...(Number.isInteger(parsed?.win32Error) ? { win32Error: parsed.win32Error } : {}), error: parsed?.error || result.stderr?.trim() || '凭据操作失败' };
    } catch {
      return { ok: false, error: result.stderr?.trim() || result.error?.message || '凭据操作失败' };
    }
  }

  function readWslActiveEnvelope() {
    let tokenBuf = null;
    let scopeBuf = null;
    try {
      tokenBuf = readIfPresent(wslActiveTokenPath);
      if (!tokenBuf) {
        return { ok: false, exists: false, status: 'missing', error: '未检测到 WSL2 登录凭据文件（~/.gemini/jetski-standalone-oauth-token），请先完成登录' };
      }
      if (!tokenBuf.length) {
        return { ok: false, exists: false, status: 'error', error: 'WSL2 登录凭据文件为空，请重新登录' };
      }
      const email = extractCredentialEmail(tokenBuf);
      scopeBuf = readIfPresent(wslActiveScopePath);
      const envelopeBuf = Buffer.from(JSON.stringify({
        v: 1,
        token: tokenBuf.toString('base64'),
        scope: scopeBuf ? scopeBuf.toString('base64') : null
      }), 'utf8');
      const hash = shortHash(envelopeBuf);
      return { ok: true, exists: true, envelopeBuf, hash, email };
    } catch (error) {
      return { ok: false, exists: false, status: 'error', error: error?.message || '读取 WSL2 登录凭据文件失败' };
    } finally {
      tokenBuf?.fill(0);
      scopeBuf?.fill(0);
    }
  }

  function writeWslActiveEnvelope(envelopeBuf) {
    let tokenBuf = null;
    let scopeBuf = null;
    let previousScope = null;
    const stagedFiles = [];
    try {
      const parsed = JSON.parse(envelopeBuf.toString('utf8'));
      if (!parsed || typeof parsed.token !== 'string' || !parsed.token) {
        return { ok: false, error: 'WSL2 凭据备份格式无效，请重新添加该账号' };
      }
      tokenBuf = Buffer.from(parsed.token, 'base64');
      if (!tokenBuf.length) return { ok: false, error: 'WSL2 凭据备份为空，请重新添加该账号' };
      const stagedToken = stageSecureFile(wslActiveTokenPath, tokenBuf, stagedFiles);
      scopeBuf = typeof parsed.scope === 'string' ? Buffer.from(parsed.scope, 'base64') : null;
      const stagedScope = scopeBuf && stageSecureFile(wslActiveScopePath, scopeBuf, stagedFiles);
      previousScope = readIfPresent(wslActiveScopePath);
      const rollbackScope = previousScope && stageSecureFile(wslActiveScopePath, previousScope, stagedFiles);

      if (stagedScope) renameSync(stagedScope, wslActiveScopePath);
      else unlinkIfPresent(wslActiveScopePath);
      try {
        renameSync(stagedToken, wslActiveTokenPath);
      } catch (error) {
        try {
          if (rollbackScope) renameSync(rollbackScope, wslActiveScopePath);
          else unlinkIfPresent(wslActiveScopePath);
        } catch (rollbackError) {
          throw new Error('WSL credential commit failed: ' + error.message + '; scope rollback failed: ' + rollbackError.message);
        }
        throw error;
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || '写入 WSL2 登录凭据文件失败' };
    } finally {
      tokenBuf?.fill(0);
      scopeBuf?.fill(0);
      previousScope?.fill(0);
      for (const tmp of stagedFiles) { try { unlinkIfPresent(tmp); } catch {} }
    }
  }

  function probe({ force = false } = {}) {
    if (probeCache && !force) return probeCache;
    if (!supported) {
      probeCache = { supported: false, backend, reason: '当前系统不支持凭据库操作' };
      return probeCache;
    }
    if (platform === 'win32' || platform === 'darwin') {
      probeCache = { supported: true, backend, reason: '' };
      return probeCache;
    }
    if (wslMode) {
      const res = runWin32('probe', '');
      probeCache = res?.ok
        ? { supported: true, backend, reason: '' }
        : { supported: false, backend, reason: res?.error || '无法通过 WSL Interop 访问 Windows 凭据管理器' };
      return probeCache;
    }
    const res = runSpawn('secret-tool', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000
    });
    if (res?.error?.code === 'ENOENT') {
      probeCache = { supported: false, backend, reason: '未安装 secret-tool（libsecret-tools），当前 Linux 环境不支持系统密钥环' };
      return probeCache;
    }
    if (!env?.DBUS_SESSION_BUS_ADDRESS && !env?.DISPLAY && !env?.WAYLAND_DISPLAY) {
      probeCache = { supported: false, backend, reason: '未检测到桌面密钥环服务（Linux Secret Service 不可用）' };
      return probeCache;
    }
    probeCache = { supported: true, backend, reason: '' };
    return probeCache;
  }

  function targetFor(accountId) {
    return vaultTargetFor(accountId, { wslDistro: distro });
  }

  function inspect(target) {
    if (!supported) return { exists: false, hash: '' };
    if (wslMode && target === ACTIVE_TARGET) {
      const envRes = readWslActiveEnvelope();
      if (!envRes.ok) return { exists: false, hash: '', status: envRes.status, ...(envRes.status === 'error' ? { error: envRes.error } : {}) };
      const { hash, email } = envRes;
      envRes.envelopeBuf.fill(0);
      return { exists: true, hash, ...(email ? { email } : {}) };
    }
    if (platform === 'win32' || wslMode) {
      try {
        const res = runWin32('inspect', target);
        if (!res.ok) return { exists: false, status: 'error', error: res.error, ...(res.win32Error === undefined ? {} : { win32Error: res.win32Error }) };
        if (!res.exists) return { exists: false, hash: '', status: 'missing' };
        const email = normalizeEmail(res.email);
        return { exists: true, hash: typeof res.hash === 'string' ? res.hash : '', ...(email ? { email } : {}) };
      } catch (error) {
        return { exists: false, status: 'error', error: error?.message || String(error) };
      }
    }
    const { service, account } = splitPosixTarget(target);
    if (platform === 'darwin') {
      const res = runSpawn('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], {
        timeout: 8000
      });
      if (res.status === 44) return { exists: false, hash: '', status: 'missing' };
      if (res.status !== 0 || !res.stdout) {
        return { exists: false, status: 'error', error: res.error?.message || String(res.stderr || '').trim() || 'Keychain read failed' };
      }
      const buf = decodeDarwinKeychainSecret(res.stdout);
      const hash = shortHash(buf);
      const email = extractCredentialEmail(buf);
      buf.fill(0);
      return { exists: true, hash, ...(email ? { email } : {}) };
    }
    const res = runSpawn('secret-tool', ['lookup', 'service', service, 'username', account], {
      timeout: 8000
    });
    const stderr = String(res.stderr || '').trim();
    if (res.status === 1 && !stderr && !res.error) return { exists: false, hash: '', status: 'missing' };
    if (res.status !== 0 || !res.stdout) {
      return { exists: false, status: 'error', error: res.error?.message || stderr || 'Secret Service read failed' };
    }
    const buf = Buffer.from(res.stdout);
    const hash = shortHash(buf);
    const email = extractCredentialEmail(buf);
    buf.fill(0);
    return { exists: true, hash, ...(email ? { email } : {}) };
  }

  function has(target) {
    if (!supported) return false;
    if (wslMode) {
      if (target === ACTIVE_TARGET) return existsSync(wslActiveTokenPath);
      return Boolean(runWin32('has', target).exists);
    }
    if (platform === 'win32') return Boolean(runWin32('has', target).exists);
    const { service, account } = splitPosixTarget(target);
    if (platform === 'darwin') {
      const res = runSpawn('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account], {
        stdio: 'ignore',
        timeout: 8000
      });
      return res.status === 0;
    }
    const res = runSpawn('secret-tool', ['lookup', 'service', service, 'username', account], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 8000
    });
    return res.status === 0;
  }

  function verifyCopy(toTarget, { email, hash, expectedEmail, expectedHash, guardOpaque = false }) {
    if (expectedEmail && email && email !== expectedEmail) return mismatchResult(email, expectedEmail);
    if (expectedHash && hash !== expectedHash) return { ok: false, error: 'source credential hash changed' };
    if (guardOpaque && toTarget === ACTIVE_TARGET && expectedEmail && !email && !expectedHash) {
      const dst = inspect(toTarget);
      if (dst.status === 'error') return { ok: false, error: dst.error };
      if (dst.exists && dst.hash !== hash) return { ok: false, error: 'refusing to overwrite an unverifiable credential' };
    }
    return null;
  }

  function copy(fromTarget, toTarget, { userName = '', expectedEmail = '', expectedHash = '' } = {}) {
    if (!supported) return { ok: false, error: '当前系统不支持凭据库操作' };
    const normalizedExpected = normalizeEmail(expectedEmail);
    if (wslMode) {
      if (fromTarget === ACTIVE_TARGET) {
        const active = readWslActiveEnvelope();
        if (!active.ok) return { ok: false, error: active.error };
        const email = normalizeEmail(active.email);
        let b64;
        try {
          if (active.envelopeBuf.length > WIN32_MAX_CREDENTIAL_BYTES) {
            return { ok: false, error: 'WSL credential envelope exceeds the 2560-byte Windows Credential Manager limit' };
          }
          const failure = verifyCopy(toTarget, { email, hash: active.hash, expectedEmail: normalizedExpected, expectedHash, guardOpaque: true });
          if (failure) return failure;
          b64 = active.envelopeBuf.toString('base64');
        } finally {
          active.envelopeBuf.fill(0);
        }
        const written = runWin32('write', '', toTarget, userName || ACTIVE_USERNAME, b64);
        if (!written?.ok) return { ok: false, error: written?.error || '写入 Windows 凭据管理器失败' };
        return { ok: true, bytes: written.bytes, hash: active.hash || written.hash || '', ...(email ? { email } : {}) };
      }
      if (toTarget === ACTIVE_TARGET) {
        const readRes = runWin32('read', fromTarget);
        if (!readRes?.ok) return { ok: false, error: readRes?.error || '读取 Windows 凭据管理器失败' };
        if (!readRes.exists || !readRes.data) return { ok: false, error: 'Windows 凭据管理器中未找到该账号备份' };
        const envelopeBuf = Buffer.from(readRes.data, 'base64');
        const email = extractCredentialEmail(envelopeBuf);
        const hash = shortHash(envelopeBuf);
        let wrote;
        try {
          const failure = verifyCopy(toTarget, { email, hash, expectedEmail: normalizedExpected, expectedHash, guardOpaque: true });
          if (failure) return failure;
          wrote = writeWslActiveEnvelope(envelopeBuf);
        } finally {
          envelopeBuf.fill(0);
        }
        if (!wrote.ok) return wrote;
        return { ok: true, bytes: readRes.bytes, hash, ...(email ? { email } : {}) };
      }
      return runWin32('copy', fromTarget, toTarget, userName, undefined, normalizedExpected, expectedHash);
    }
    if (platform === 'win32') return runWin32('copy', fromTarget, toTarget, userName, undefined, normalizedExpected, expectedHash);
    const src = splitPosixTarget(fromTarget);
    const dst = splitPosixTarget(toTarget);
    if (platform === 'darwin') {
      const readRes = runSpawn('/usr/bin/security', ['find-generic-password', '-s', src.service, '-a', src.account, '-w'], {
        timeout: 8000
      });
      if (readRes.status !== 0 || !readRes.stdout) {
        return { ok: false, error: String(readRes.stderr || '').trim() || '未能读取当前凭据' };
      }
      const buf = decodeDarwinKeychainSecret(readRes.stdout);
      const email = extractCredentialEmail(buf);
      const hash = shortHash(buf);
      const failure = verifyCopy(toTarget, { email, hash, expectedEmail: normalizedExpected, expectedHash });
      if (failure) { buf.fill(0); return failure; }
      const bytes = buf.length;
      // Large token envelopes overflow `security -i`; see lib/mac-keychain.mjs.
      let writeRes;
      try {
        writeRes = writeMacGenericPassword({ service: dst.service, account: dst.account, buf, runSpawn });
      } finally {
        buf.fill(0);
      }
      if (!writeRes.ok) return { ok: false, error: writeRes.error || '写入钥匙串失败' };
      return { ok: true, bytes, hash, ...(email ? { email } : {}) };
    }
    const readRes = runSpawn('secret-tool', ['lookup', 'service', src.service, 'username', src.account], {
      timeout: 8000
    });
    if (readRes.error?.code === 'ENOENT') {
      return { ok: false, error: '未安装 secret-tool（libsecret-tools），当前 Linux 环境不支持系统密钥环' };
    }
    if (readRes.status !== 0 || !readRes.stdout) {
      return { ok: false, error: String(readRes.stderr || '').trim() || '未能读取当前凭据（系统密钥环不可用或未登录）' };
    }
    const buf = Buffer.from(readRes.stdout);
    const email = extractCredentialEmail(buf);
    const hash = shortHash(buf);
    const failure = verifyCopy(toTarget, { email, hash, expectedEmail: normalizedExpected, expectedHash });
    if (failure) { buf.fill(0); return failure; }
    const writeRes = runSpawn('secret-tool', ['store', '--label=Agy Powertools', 'service', dst.service, 'username', dst.account], {
      input: buf,
      stdio: ['pipe', 'ignore', 'pipe'],
      timeout: 8000
    });
    buf.fill(0);
    if (writeRes.status !== 0) {
      return { ok: false, error: String(writeRes.stderr || '').trim() || '写入密钥环失败' };
    }
    return { ok: true, bytes: readRes.stdout.length, hash, ...(email ? { email } : {}) };
  }

  function remove(target) {
    if (!supported) return { ok: false, error: '当前系统不支持凭据库操作' };
    if (wslMode && target === ACTIVE_TARGET) {
      try {
        unlinkIfPresent(wslActiveTokenPath);
        unlinkIfPresent(wslActiveScopePath);
        return { ok: true };
      } catch (error) { return { ok: false, error: error.message }; }
    }
    if (platform === 'win32' || wslMode) return runWin32('remove', target);
    const { service, account } = splitPosixTarget(target);
    if (platform === 'darwin') {
      const res = runSpawn('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', account], {
        stdio: 'ignore',
        timeout: 8000
      });
      if (res.status === 0) return { ok: true };
      if (res.status === 44) return { ok: true, status: 'missing' };
      return { ok: false, error: res.error?.message || `Keychain delete failed (exit ${res.status})` };
    }
    const res = runSpawn('secret-tool', ['clear', 'service', service, 'username', account], {
      stdio: 'ignore',
      timeout: 8000
    });
    if (res.status === 0) return { ok: true };
    if (res.status === 1 && inspect(target).status === 'missing') return { ok: true, status: 'missing' };
    return { ok: false, error: res.error?.message || 'Secret Service delete failed' };
  }

  function resolveSecretTarget(scopeKey) {
    try {
      return { ok: true, target: secretTargetFor(scopeKey, { wslDistro: distro }) };
    } catch (error) {
      return { ok: false, error: error?.message || '凭据标识无效' };
    }
  }

  function hasLinuxDesktopKeyringEnv() {
    return Boolean(env?.DBUS_SESSION_BUS_ADDRESS || env?.DISPLAY || env?.WAYLAND_DISPLAY);
  }

  function isMacVaultUnavailable(res) {
    if (res?.error?.code === 'ENOENT') return true;
    const msg = `${String(res?.stderr || '')} ${String(res?.stdout || '')} ${String(res?.error?.message || '')}`;
    return res?.status === 36 || MAC_UNAVAILABLE_RE.test(msg);
  }

  function isLinuxVaultUnavailable(res) {
    if (res?.error?.code === 'ENOENT') return true;
    const msg = `${String(res?.stderr || '')} ${String(res?.error?.message || '')}`;
    return LINUX_UNAVAILABLE_RE.test(msg);
  }

  function isWin32VaultUnavailable(res) {
    if (!res || res.ok) return false;
    if ([1312, 1004, 5, 50, 1058].includes(Number(res.win32Error))) return true;
    return /ENOENT|powershell|1312|logon session|access is denied/i.test(String(res.error || ''));
  }

  function readSecret(scopeKey) {
    if (!supported) {
      return { ok: false, exists: false, value: '', available: false, reason: 'vault-unavailable', error: '当前系统不支持凭据库操作' };
    }
    const targetRes = resolveSecretTarget(scopeKey);
    if (!targetRes.ok) {
      return { ok: false, exists: false, value: '', available: true, reason: 'invalid-scope', error: targetRes.error };
    }
    const target = targetRes.target;
    if (platform === 'win32' || wslMode) {
      const parsed = runWin32('read', target);
      if (isWin32VaultUnavailable(parsed)) {
        return { ok: false, exists: false, value: '', available: false, reason: 'vault-unavailable', error: parsed?.error || '系统凭据管理器不可用' };
      }
      if (!parsed?.ok) {
        return { ok: false, exists: false, value: '', available: true, reason: 'read-failed', error: parsed?.error || '读取系统凭据失败' };
      }
      if (!parsed.exists || !parsed.data) {
        return { ok: true, exists: false, value: '', available: true, reason: '' };
      }
      const buf = Buffer.from(parsed.data, 'base64');
      const value = buf.toString('utf8');
      buf.fill(0);
      return { ok: true, exists: true, value, available: true, reason: '' };
    }
    const { service, account } = splitPosixTarget(target);
    if (platform === 'darwin') {
      const secRes = runSpawn('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], {
        timeout: 8000
      });
      if (isMacVaultUnavailable(secRes)) {
        return {
          ok: false,
          exists: false,
          value: '',
          available: false,
          reason: 'vault-unavailable',
          error: String(secRes.stderr || secRes.error?.message || '').trim() || 'macOS 钥匙串不可用或已锁定'
        };
      }
      if (secRes.status === 0 && secRes.stdout != null) {
        const buf = decodeDarwinKeychainSecret(secRes.stdout);
        const value = buf.toString('utf8');
        buf.fill(0);
        return { ok: true, exists: true, value, available: true, reason: '' };
      }
      if (secRes.status === 44) {
        return { ok: true, exists: false, value: '', available: true, reason: '' };
      }
      const script = buildMacKeychainReadScript({ service, account });
      const jxaRes = runSpawn('/usr/bin/osascript', ['-l', 'JavaScript'], {
        input: script,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 8000
      });
      if (isMacVaultUnavailable(jxaRes)) {
        return {
          ok: false,
          exists: false,
          value: '',
          available: false,
          reason: 'vault-unavailable',
          error: String(jxaRes.stderr || jxaRes.error?.message || '').trim() || 'macOS 钥匙串不可用或已锁定'
        };
      }
      if (jxaRes.status === 0 && jxaRes.stdout) {
        const b64 = Buffer.from(jxaRes.stdout).toString('utf8').trim();
        if (b64) {
          try {
            const buf = Buffer.from(b64, 'base64');
            const value = buf.toString('utf8');
            buf.fill(0);
            return { ok: true, exists: true, value, available: true, reason: '' };
          } catch {}
        }
      }
      const jxaMsg = `${String(jxaRes.stderr || '')} ${String(jxaRes.stdout || '')}`;
      if (/-25300/.test(jxaMsg)) {
        return { ok: true, exists: false, value: '', available: true, reason: '' };
      }
      return {
        ok: false,
        exists: false,
        value: '',
        available: true,
        reason: 'read-failed',
        error: String(secRes.stderr || jxaRes.stderr || '').trim() || '读取钥匙串凭据失败'
      };
    }
    if (!hasLinuxDesktopKeyringEnv()) {
      return {
        ok: false,
        exists: false,
        value: '',
        available: false,
        reason: 'vault-unavailable',
        error: '未检测到桌面密钥环服务（Linux Secret Service 不可用）'
      };
    }
    const res = runSpawn('secret-tool', ['lookup', 'service', service, 'username', account], {
      timeout: 8000
    });
    if (isLinuxVaultUnavailable(res)) {
      return {
        ok: false,
        exists: false,
        value: '',
        available: false,
        reason: 'vault-unavailable',
        error: res.error?.code === 'ENOENT'
          ? '未安装 secret-tool（libsecret-tools），当前 Linux 环境不支持系统密钥环'
          : (String(res.stderr || res.error?.message || '').trim() || '系统密钥环不可用')
      };
    }
    if (res.status !== 0 || !res.stdout) {
      const errText = String(res.stderr || '').trim();
      if (res.status !== 0 && errText) {
        return { ok: false, exists: false, value: '', available: true, reason: 'read-failed', error: errText };
      }
      return { ok: true, exists: false, value: '', available: true, reason: '' };
    }
    const buf = Buffer.from(res.stdout);
    const value = buf.toString('utf8').replace(/\r?\n$/, '');
    buf.fill(0);
    return { ok: true, exists: Boolean(value), value, available: true, reason: '' };
  }

  function writeSecret(scopeKey, value, { userName = 'agy-max' } = {}) {
    if (!supported) {
      return { ok: false, available: false, reason: 'vault-unavailable', error: '当前系统不支持凭据库操作' };
    }
    const targetRes = resolveSecretTarget(scopeKey);
    if (!targetRes.ok) {
      return { ok: false, available: true, reason: 'invalid-scope', error: targetRes.error };
    }
    if (typeof value !== 'string' || !value) {
      return { ok: false, available: true, reason: 'invalid-value', error: '凭据内容不能为空' };
    }
    const target = targetRes.target;
    if (platform === 'win32' || wslMode) {
      const buf = Buffer.from(value, 'utf8');
      const b64 = buf.toString('base64');
      buf.fill(0);
      const parsed = runWin32('write', '', target, userName, b64);
      if (isWin32VaultUnavailable(parsed)) {
        return { ok: false, available: false, reason: 'vault-unavailable', error: parsed?.error || '系统凭据管理器不可用' };
      }
      if (!parsed?.ok) {
        return { ok: false, available: true, reason: 'write-failed', error: parsed?.error || '写入系统凭据失败' };
      }
      return { ok: true, available: true, reason: '' };
    }
    const { service, account } = splitPosixTarget(target);
    if (platform === 'darwin') {
      const buf = Buffer.from(value, 'utf8');
      let macWrite;
      try {
        macWrite = writeMacGenericPassword({ service, account, buf, runSpawn });
      } finally {
        buf.fill(0);
      }
      if (!macWrite.ok) {
        const unavail = MAC_UNAVAILABLE_RE.test(String(macWrite.error || ''));
        return {
          ok: false,
          available: !unavail,
          reason: unavail ? 'vault-unavailable' : 'write-failed',
          error: macWrite.error || '写入钥匙串失败'
        };
      }
      return { ok: true, available: true, reason: '' };
    }
    if (!hasLinuxDesktopKeyringEnv()) {
      return {
        ok: false,
        available: false,
        reason: 'vault-unavailable',
        error: '未检测到桌面密钥环服务（Linux Secret Service 不可用）'
      };
    }
    const buf = Buffer.from(value, 'utf8');
    const res = runSpawn('secret-tool', ['store', '--label=Antigravity Max', 'service', service, 'username', account], {
      input: buf,
      stdio: ['pipe', 'ignore', 'pipe'],
      timeout: 8000
    });
    buf.fill(0);
    if (isLinuxVaultUnavailable(res)) {
      return {
        ok: false,
        available: false,
        reason: 'vault-unavailable',
        error: res.error?.code === 'ENOENT'
          ? '未安装 secret-tool（libsecret-tools），当前 Linux 环境不支持系统密钥环'
          : (String(res.stderr || res.error?.message || '').trim() || '系统密钥环不可用')
      };
    }
    if (res.status !== 0) {
      return { ok: false, available: true, reason: 'write-failed', error: String(res.stderr || '').trim() || '写入系统密钥环失败' };
    }
    return { ok: true, available: true, reason: '' };
  }

  function deleteSecret(scopeKey) {
    if (!supported) {
      return { ok: false, available: false, reason: 'vault-unavailable', error: '当前系统不支持凭据库操作' };
    }
    const targetRes = resolveSecretTarget(scopeKey);
    if (!targetRes.ok) {
      return { ok: false, available: true, reason: 'invalid-scope', error: targetRes.error };
    }
    const target = targetRes.target;
    if (platform === 'win32' || wslMode) {
      const parsed = runWin32('remove', target);
      if (isWin32VaultUnavailable(parsed)) {
        return { ok: false, available: false, reason: 'vault-unavailable', error: parsed?.error || '系统凭据管理器不可用' };
      }
      if (!parsed?.ok) {
        return { ok: false, available: true, reason: 'delete-failed', error: parsed?.error || '删除系统凭据失败' };
      }
      return { ok: true, available: true, reason: '' };
    }
    const { service, account } = splitPosixTarget(target);
    if (platform === 'darwin') {
      const res = runSpawn('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', account], {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 8000
      });
      if (isMacVaultUnavailable(res)) {
        return {
          ok: false,
          available: false,
          reason: 'vault-unavailable',
          error: String(res.stderr || res.error?.message || '').trim() || 'macOS 钥匙串不可用或已锁定'
        };
      }
      if (res.status === 0 || res.status === 44) {
        return { ok: true, available: true, reason: '' };
      }
      return { ok: false, available: true, reason: 'delete-failed', error: String(res.stderr || '').trim() || '删除钥匙串凭据失败' };
    }
    if (!hasLinuxDesktopKeyringEnv()) {
      return {
        ok: false,
        available: false,
        reason: 'vault-unavailable',
        error: '未检测到桌面密钥环服务（Linux Secret Service 不可用）'
      };
    }
    const res = runSpawn('secret-tool', ['clear', 'service', service, 'username', account], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 8000
    });
    if (isLinuxVaultUnavailable(res)) {
      return {
        ok: false,
        available: false,
        reason: 'vault-unavailable',
        error: res.error?.code === 'ENOENT'
          ? '未安装 secret-tool（libsecret-tools），当前 Linux 环境不支持系统密钥环'
          : (String(res.stderr || res.error?.message || '').trim() || '系统密钥环不可用')
      };
    }
    if (res.status !== 0 && inspect(target).status !== 'missing') {
      return { ok: false, available: true, reason: 'delete-failed', error: String(res.stderr || '').trim() || '删除系统密钥环凭据失败' };
    }
    return { ok: true, available: true, reason: '' };
  }

  return {
    supported,
    backend,
    wslMode,
    probe,
    has,
    inspect,
    copy,
    remove,
    readSecret,
    writeSecret,
    deleteSecret,
    secretTargetFor: scopeKey => secretTargetFor(scopeKey, { wslDistro: distro }),
    targetFor,
    saveActiveTo: (accountId, opts) => copy(ACTIVE_TARGET, targetFor(accountId), opts),
    restoreToActive: (accountId, opts) => copy(targetFor(accountId), ACTIVE_TARGET, { ...opts, userName: ACTIVE_USERNAME }),
    hasSaved: accountId => has(targetFor(accountId)),
    inspectSaved: accountId => inspect(targetFor(accountId)),
    inspectActive: () => inspect(ACTIVE_TARGET),
    removeSaved: accountId => remove(targetFor(accountId)),
    removeActive: () => remove(ACTIVE_TARGET)
  };
}

export function readSecret(scopeKey, opts = {}) {
  const vault = opts?.vault || createCredentialVault(opts);
  return vault.readSecret(scopeKey);
}

export function writeSecret(scopeKey, value, opts = {}) {
  const vault = opts?.vault || createCredentialVault(opts);
  return vault.writeSecret(scopeKey, value, opts);
}

export function deleteSecret(scopeKey, opts = {}) {
  const vault = opts?.vault || createCredentialVault(opts);
  return vault.deleteSecret(scopeKey);
}
