import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|otf|eot|zip|gz|tar|tgz|pdf|exe|dll|so|dylib|node)$/i;
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;
const TAG_RE = /[\u{E0000}-\u{E007F}]/u;
const ZERO_WIDTH_RE = /[\u200B\u200C\u2060]/u;
const SUSPICIOUS_CHAR_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u{E0000}-\u{E007F}\u200B\u200C\u2060]/gu;
const PINNED_ACTION_RE = /^[^@\s]+@[0-9a-f]{40}$/;
const UNTRUSTED_EXPR_RE = /\$\{\{[^}]*\bgithub\.(?:event\.(?:pull_request\.(?:title|body|head\.(?:ref|label))|issue\.(?:title|body)|comment\.body|review\.body|discussion\.(?:title|body)|commits\[[^\]]*\]\.message|head_commit\.message)|head_ref)\b[^}]*\}\}/g;

function classifyCodePoint(ch) {
  if (BIDI_RE.test(ch)) return 'bidi-control';
  if (TAG_RE.test(ch)) return 'unicode-tag';
  if (ZERO_WIDTH_RE.test(ch)) return 'zero-width';
  return 'suspicious-unicode';
}

export function scanSuspiciousUnicode(text) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    SUSPICIOUS_CHAR_RE.lastIndex = 0;
    let match;
    while ((match = SUSPICIOUS_CHAR_RE.exec(line)) !== null) {
      const ch = match[0];
      const cp = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      findings.push({
        line: i + 1,
        column: match.index + 1,
        codePoint: cp,
        kind: classifyCodePoint(ch),
      });
    }
  }
  return findings;
}

export function auditWorkflowContent(filePath, content) {
  const issues = [];
  const lines = String(content).split(/\r?\n/);
  const hasTopPermissions = lines.some((line) => /^permissions:\s*/.test(line));
  if (!hasTopPermissions) {
    issues.push({ file: filePath, line: 1, rule: 'top-level-permissions', message: 'Workflow must declare explicit top-level permissions (recommended: permissions: {})' });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const uncommented = line.replace(/#.*$/, '');

    if (/\bpermissions:\s*write-all\b/.test(uncommented)) {
      issues.push({ file: filePath, line: lineNo, rule: 'no-write-all', message: 'Avoid write-all permissions in workflows' });
    }

    if (/\bpull_request_target\b/.test(uncommented) && !line.includes('security-check:allow-pull-request-target')) {
      issues.push({ file: filePath, line: lineNo, rule: 'no-pull-request-target', message: 'pull_request_target is blocked by default to prevent fork privilege escalation' });
    }

    const usesMatch = uncommented.match(/^\s*(?:-\s*)?uses:\s*['"]?([^\s'"]+)['"]?\s*$/);
    if (usesMatch) {
      const ref = usesMatch[1];
      if (!ref.startsWith('./') && !ref.startsWith('docker://') && !PINNED_ACTION_RE.test(ref)) {
        issues.push({ file: filePath, line: lineNo, rule: 'pin-action-sha', message: `Action "${ref}" must be pinned to a full 40-char commit SHA` });
      }
      if (/^actions\/checkout@/.test(ref)) {
        const baseIndent = line.search(/\S/);
        let hasPersistFalse = false;
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j];
          if (/^\s*$/.test(next) || /^\s*#/.test(next)) continue;
          const nextIndent = next.search(/\S/);
          if (nextIndent <= baseIndent && /^\s*-\s/.test(next)) break;
          if (nextIndent < baseIndent) break;
          if (/^\s*persist-credentials:\s*false\b/.test(next.replace(/#.*$/, ''))) {
            hasPersistFalse = true;
            break;
          }
        }
        if (!hasPersistFalse) {
          issues.push({ file: filePath, line: lineNo, rule: 'checkout-persist-credentials', message: 'actions/checkout must set "persist-credentials: false"' });
        }
      }
    }

    UNTRUSTED_EXPR_RE.lastIndex = 0;
    let exprMatch;
    while ((exprMatch = UNTRUSTED_EXPR_RE.exec(uncommented)) !== null) {
      issues.push({
        file: filePath,
        line: lineNo,
        rule: 'untrusted-interpolation',
        message: `Avoid interpolating untrusted PR/issue context directly: ${exprMatch[0]}`,
      });
    }
  }

  return issues;
}

export function listTrackedFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

export function runSecurityCheck({ root, audit = false } = {}) {
  const repoRoot = resolve(root);
  const issues = [];

  for (const rel of listTrackedFiles(repoRoot)) {
    if (BINARY_EXT.test(rel)) continue;
    const full = join(repoRoot, rel);
    if (!existsSync(full)) continue;
    const buf = readFileSync(full);
    if (buf.includes(0)) continue;
    for (const hit of scanSuspiciousUnicode(buf.toString('utf8'))) {
      issues.push({
        file: rel,
        line: hit.line,
        rule: `unicode-${hit.kind}`,
        message: `Suspicious hidden/control character ${hit.codePoint} (${hit.kind}) at col ${hit.column}`,
      });
    }
  }

  const workflowDir = join(repoRoot, '.github', 'workflows');
  if (existsSync(workflowDir)) {
    for (const name of readdirSync(workflowDir).sort()) {
      if (!/\.ya?ml$/i.test(name)) continue;
      const rel = `.github/workflows/${name}`;
      const content = readFileSync(join(workflowDir, name), 'utf8');
      issues.push(...auditWorkflowContent(rel, content));
    }
  }

  if (audit) {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
      execFileSync(npmCmd, ['audit', '--audit-level=high'], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' });
    } catch (error) {
      const detail = (error.stdout || error.stderr || error.message || '').trim().slice(0, 800);
      issues.push({ file: 'package-lock.json', line: 1, rule: 'npm-audit', message: `npm audit failed: ${detail}` });
    }
  }

  return { ok: issues.length === 0, issues };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const audit = process.argv.includes('--audit');
  const result = runSecurityCheck({ root, audit });
  if (!result.ok) {
    for (const issue of result.issues) {
      console.error(`[${issue.rule}] ${issue.file}:${issue.line} - ${issue.message}`);
    }
    process.exit(1);
  }
  console.log(`security-check passed (${audit ? 'baseline + npm audit' : 'baseline'})`);
}
