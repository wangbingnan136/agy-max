import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditWorkflowContent, runSecurityCheck, scanSuspiciousUnicode } from '../scripts/security-check.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('scanSuspiciousUnicode ignores normal code, CJK text, and compound emoji', () => {
  const sample = 'const title = "安全检查 🛡️ 👨‍💻";\nexport default title;\n';
  assert.deepEqual(scanSuspiciousUnicode(sample), []);
});

test('scanSuspiciousUnicode detects Trojan Source bidi, Unicode Tag prompt smuggling, and zero-width chars', () => {
  const bidi = `const ok = "safe\u202Eevil";`;
  const tag = `<!-- normal \u{E0049}\u{E0067} -->`;
  const zw = `const a\u200Bb = 1;`;

  const bidiHits = scanSuspiciousUnicode(bidi);
  assert.equal(bidiHits.length, 1);
  assert.equal(bidiHits[0].kind, 'bidi-control');
  assert.equal(bidiHits[0].codePoint, 'U+202E');

  const tagHits = scanSuspiciousUnicode(tag);
  assert.equal(tagHits.length, 2);
  assert.equal(tagHits[0].kind, 'unicode-tag');
  assert.equal(tagHits[0].codePoint, 'U+E0049');

  const zwHits = scanSuspiciousUnicode(zw);
  assert.equal(zwHits.length, 1);
  assert.equal(zwHits[0].kind, 'zero-width');
  assert.equal(zwHits[0].codePoint, 'U+200B');
});

test('auditWorkflowContent flags unsafe workflow patterns', () => {
  const badYaml = [
    'name: Bad',
    'on:',
    '  pull_request_target:',
    'jobs:',
    '  test:',
    '    permissions: write-all',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - run: echo "${{ github.event.pull_request.title }}"',
  ].join('\n');

  const issues = auditWorkflowContent('.github/workflows/bad.yml', badYaml);
  const rules = new Set(issues.map((item) => item.rule));
  assert.ok(rules.has('top-level-permissions'));
  assert.ok(rules.has('no-pull-request-target'));
  assert.ok(rules.has('no-write-all'));
  assert.ok(rules.has('pin-action-sha'));
  assert.ok(rules.has('checkout-persist-credentials'));
  assert.ok(rules.has('untrusted-interpolation'));
});

test('auditWorkflowContent accepts properly hardened workflow', () => {
  const goodYaml = [
    'name: Good',
    'on: [pull_request]',
    'permissions: {}',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      contents: read',
    '    steps:',
    '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    '        with:',
    '          persist-credentials: false',
    '      - uses: ./local-action',
  ].join('\n');

  assert.deepEqual(auditWorkflowContent('.github/workflows/good.yml', goodYaml), []);
});

test('repository passes baseline security checks', () => {
  const result = runSecurityCheck({ root: ROOT, audit: false });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});
