import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReadableStream } from 'node:stream/web';
import {
  AI_PROTOCOLS,
  completeText,
  listModels,
  streamText,
  testConnection,
  validateAiEndpoint
} from '../lib/ai-provider.mjs';
import { createAiProvidersStore, formatModelRef, parseModelRef } from '../lib/ai-providers-store.mjs';
import {
  createThinkingTranslator,
  mapTargetLang,
  maskTechnicalMarkdown,
  shouldSkipTranslation,
  unmaskTechnicalMarkdown
} from '../lib/translator.mjs';
import {
  buildMinimalContextSummary,
  createIntentPredictor,
  parsePredictedIntent
} from '../lib/intent-predictor.mjs';
import { createSettingsStore } from '../lib/settings.mjs';
import { createHookBus } from '../packages/core/hook-bus.mjs';
import { createModuleRegistry } from '../packages/core/module-registry.mjs';
import { registerModule as registerChatFlow } from '../packages/chat-flow/service.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sseResponse(lines) {
  const payload = lines.join('\n') + '\n';
  const body = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(payload));
      ctrl.close();
    }
  });
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/event-stream']]),
    body
  };
}

test('validateAiEndpoint enforces HTTPS for remote hosts, blocks cloud metadata IPs, and supports all 4 protocols', async () => {
  assert.deepEqual(AI_PROTOCOLS, ['openai', 'openai-responses', 'anthropic', 'gemini']);

  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' }).ok, true);
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'http://api.openai.com/v1', apiKey: 'sk-1234' }).code, 'remote-http-disallowed');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '' }).code, 'api-key-required');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'https://169.254.169.254/v1', apiKey: 'sk-1234' }).code, 'metadata-host-disallowed');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'https://metadata.google.internal/v1', apiKey: 'sk-1234' }).code, 'metadata-host-disallowed');
  assert.equal(validateAiEndpoint({ protocol: 'openai', baseUrl: 'https://user:pass@api.openai.com/v1', apiKey: 'sk-1234' }).code, 'credentials-in-url-disallowed');

  // Stream SSE across OpenAI, OpenAI Responses, Anthropic, and Gemini + key redaction on HTTP error
  const deltas = [];
  const oaText = await streamText({
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: 'sk-secret-key-999',
    prompt: 'Hello',
    onDelta: (_c, acc) => deltas.push(acc),
    fetcher: async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"好"}}]}',
      '',
      'data: [DONE]'
    ])
  });
  assert.equal(oaText, '你好');
  assert.deepEqual(deltas, ['你', '你好']);

  const respText = await streamText({
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKey: 'sk-secret-key-999',
    prompt: 'Hello',
    fetcher: async () => sseResponse([
      'data: {"type":"response.output_text.delta","delta":"Resp "}',
      '',
      'data: {"type":"response.output_text.delta","delta":"OK"}',
      '',
      'data: {"type":"response.completed"}'
    ])
  });
  assert.equal(respText, 'Resp OK');

  const anthText = await streamText({
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-haiku',
    apiKey: 'sk-ant-secret',
    prompt: 'Hello',
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(init.headers['x-api-key'], 'sk-ant-secret');
      return sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude OK"}}',
        '',
        'data: {"type":"message_stop"}'
      ]);
    }
  });
  assert.equal(anthText, 'Claude OK');

  const gemModels = await listModels({
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: 'AIzaSecretKey',
    fetcher: async url => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }
          ]
        })
      };
    }
  });
  assert.deepEqual(gemModels, { ok: true, models: ['gemini-2.5-flash'] });

  const redacted = await testConnection({
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: 'sk-super-sensitive-12345',
    fetcher: async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid key sk-super-sensitive-12345"}}'
    })
  });
  assert.equal(redacted.ok, false);
  assert.equal(redacted.error.includes('sk-super-sensitive-12345'), false);
  assert.ok(redacted.error.includes('[REDACTED]'));
});

test('ai-providers-store stores API keys in OS keychain when available, falls back to 0600 file, and purges on module uninstall', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-ai-store-'));
  try {
    const dataDir = join(root, 'data');
    const vaultMap = new Map();
    const mockVault = {
      writeSecret(scope, val) { vaultMap.set(scope, val); return { ok: true, available: true }; },
      readSecret(scope) {
        return vaultMap.has(scope)
          ? { ok: true, exists: true, value: vaultMap.get(scope), available: true }
          : { ok: true, exists: false, value: '', available: true };
      },
      deleteSecret(scope) { vaultMap.delete(scope); return { ok: true, available: true }; }
    };

    const store = createAiProvidersStore(dataDir, { vault: mockVault });
    const saved = store.upsert({
      name: 'Main Relay',
      protocol: 'openai-responses',
      baseUrl: 'https://relay.example.com/v1/',
      apiKey: 'sk-keychain-protected',
      models: 'gpt-4.1-mini, o4-mini'
    });
    assert.equal(saved.ok, true);
    const id = saved.provider.id;
    assert.equal(vaultMap.get(`ai-provider:${id}`), 'sk-keychain-protected');

    // Disk file must NOT contain plaintext API key when vault succeeded, and must be 0600 on POSIX
    const diskPath = join(dataDir, 'ai-providers.json');
    const rawDisk = readFileSync(diskPath, 'utf8');
    assert.equal(rawDisk.includes('sk-keychain-protected'), false);
    const parsedDisk = JSON.parse(rawDisk);
    assert.equal(parsedDisk.providers[0].keyInVault, true);
    assert.equal(parsedDisk.providers[0].apiKey, '');
    if (process.platform !== 'win32') {
      assert.equal(statSync(diskPath).mode & 0o777, 0o600);
    }

    // Hydrates secret transparently on read & resolveModel
    const ref = formatModelRef(id, 'gpt-4.1-mini');
    assert.deepEqual(parseModelRef(ref), { providerId: id, model: 'gpt-4.1-mini' });
    const resolved = store.resolveModel(ref);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.apiKey, 'sk-keychain-protected');
    assert.deepEqual(resolved.provider.models, ['gpt-4.1-mini', 'o4-mini']);

    // Uninstalling chat-flow with purgeData: true cleans up keychain secrets and ai-providers.json
    const home = join(root, 'home');
    const regDataDir = join(home, '.gemini', 'antigravity', 'plugin_data', 'agy-max');
    mkdirSync(regDataDir, { recursive: true });
    const regStore = createAiProvidersStore(regDataDir, { vault: mockVault });
    const p2 = regStore.upsert({ name: 'Purge Test', protocol: 'anthropic', apiKey: 'sk-ant-purge', models: ['claude-3-5-haiku'] });
    assert.equal(vaultMap.has(`ai-provider:${p2.provider.id}`), true);

    const registry = createModuleRegistry({
      home,
      pluginRoot: REPO_ROOT,
      installedPluginDir: REPO_ROOT,
      dataDir: regDataDir,
      settingsStore: createSettingsStore(regDataDir),
      version: '1.4.3',
      syncIntegrations: false,
      vaults: { secrets: mockVault }
    });
    registry.ensureInitialized();
    assert.equal(registry.resolveModuleState('chat-flow').hasSavedData, true);
    const uninstalled = await registry.uninstallModule('chat-flow', { purgeData: true });
    assert.equal(uninstalled.ok, true);
    assert.equal(vaultMap.has(`ai-provider:${p2.provider.id}`), false);
    assert.equal(existsSync(join(regDataDir, 'ai-providers.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('translator masks code/paths/URLs, falls back across Google HTML -> GTX -> Edge, and supports yue/CJK skip rules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-translator-'));
  try {
    assert.equal(mapTargetLang('yue').edge, 'zh-Hant');
    assert.equal(shouldSkipTranslation('这段中文里面有 `const x = 1` 和 JSON API', 'zh-CN'), true);
    assert.equal(shouldSkipTranslation('Inspect `src/app/main.ts` and check https://example.com/docs.', 'zh-CN'), false);

    const sample = 'Check `npm run test` in `/Users/dev/app.mjs` and https://example.com/api:\n```js\nconst a = 1;\n```';
    const masked = maskTechnicalMarkdown(sample);
    assert.equal(masked.masked.includes('npm run test'), false);
    assert.equal(masked.masked.includes('/Users/dev/app.mjs'), false);
    assert.equal(masked.masked.includes('const a = 1;'), false);
    const unmasked = unmaskTechnicalMarkdown(masked.masked.replace('Check', '检查').replace('and', '和'), masked.tokens);
    assert.equal(unmasked.ok, true);
    assert.ok(unmasked.text.includes('`npm run test`'));
    assert.ok(unmasked.text.includes('/Users/dev/app.mjs'));
    assert.ok(unmasked.text.includes('https://example.com/api:'));
    assert.ok(unmasked.text.includes('const a = 1;'));

    // Simulate Google HTML failing (503), Google GTX failing (429), and Microsoft Edge succeeding!
    const hitUrls = [];
    const translator = createThinkingTranslator({
      dataDir: dir,
      fetcher: async (url, init) => {
        hitUrls.push(url);
        if (url.includes('translateHtml')) return { ok: false, status: 503 };
        if (url.includes('translate_a/single')) return { ok: false, status: 429 };
        if (url.includes('edge.microsoft.com')) {
          const [input] = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            json: async () => [{ translations: [{ text: input.replace('Verify logic in', '核对逻辑位于') }] }]
          };
        }
        throw new Error(`Unexpected URL ${url}`);
      }
    });

    const first = await translator.translate({
      text: 'Verify logic in `packages/core/catalog.mjs`',
      targetLang: 'zh-CN',
      engine: 'free'
    });
    assert.equal(first.ok, true);
    assert.equal(first.transport, 'edge');
    assert.equal(first.text, '核对逻辑位于 `packages/core/catalog.mjs`');
    assert.equal(hitUrls.length, 3);

    // Second call hits persistent cache (0 network calls)
    const second = await translator.translate({
      text: 'Verify logic in `packages/core/catalog.mjs`',
      targetLang: 'zh-CN',
      engine: 'free'
    });
    assert.equal(second.cached, true);
    assert.equal(hitUrls.length, 3);

    translator.purgeCache();
    assert.equal(existsSync(translator.cachePath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('intent predictor strips noise, deduplicates concurrent calls, and chat-flow HookBus streams & purges cleanly', async () => {
  const summary = buildMinimalContextSummary({
    turns: [
      {
        user: 'Fix the failing test\n```sh\nnpm test\n```',
        assistant: '<tool_call>hidden</tool_call>\n$ git status\nAll unit tests now pass, ready to build release.'
      }
    ]
  });
  assert.ok(summary.includes('[code block]'));
  assert.equal(summary.includes('hidden'), false);
  assert.equal(parsePredictedIntent('Suggestion: "帮我打包发布版本并检查更新日志"'), '帮我打包发布版本并检查更新日志');
  assert.equal(parsePredictedIntent('As an AI, I cannot predict that.'), '');

  let llmCalls = 0;
  const predictor = createIntentPredictor();
  const fakeFetch = async () => {
    llmCalls++;
    await new Promise(r => setTimeout(r, 15));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '"继续运行完整回归测试"' } }] })
    };
  };
  const aiConfig = { provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5', apiKey: '', fetcher: fakeFetch };
  const [r1, r2] = await Promise.all([
    predictor.predict({ conversationId: 'c1', turnId: 't1', turns: [{ user: '修好了吗', assistant: '已修好代码' }], language: 'zh-CN', aiConfig }),
    predictor.predict({ conversationId: 'c1', turnId: 't1', turns: [{ user: '修好了吗', assistant: '已修好代码' }], language: 'zh-CN', aiConfig })
  ]);
  assert.equal(llmCalls, 1);
  assert.equal(r1.suggestion, '继续运行完整回归测试');
  assert.equal(r2.suggestion, '继续运行完整回归测试');

  // Verify chat-flow HookBus beta.* RPC integration
  const root = mkdtempSync(join(tmpdir(), 'agy-chatflow-beta-'));
  try {
    const dataDir = join(root, 'data');
    const appDir = join(root, 'app');
    const settings = createSettingsStore(dataDir);
    const bus = createHookBus();
    let purgedCount = 0;
    const pushedEvals = [];

    await registerChatFlow(bus, {
      home: root,
      pluginRoot: REPO_ROOT,
      dataDir,
      appDir,
      settings,
      vault: null,
      translator: {
        async translate({ text, onDelta }) {
          onDelta?.('译：', '译：');
          onDelta?.(text, `译：${text}`);
          return { ok: true, text: `译：${text}`, engine: 'free', cached: false };
        },
        purgeCache() { purgedCount++; }
      }
    });

    // Disabled by default -> rejects translation cleanly
    const blocked = await bus.dispatchRpc('beta.translateThinking', { method: 'beta.translateThinking', text: 'Hello world' });
    assert.equal(blocked.reply.ok, false);
    assert.equal(blocked.reply.code, 'disabled');

    // Enable -> streams delta via pushClientEval
    settings.set({ betaThinkingTranslate: true });
    const translated = await bus.dispatchRpc(
      'beta.translateThinking',
      { method: 'beta.translateThinking', reqId: 'tr-1', text: 'Step one' },
      { pushClientEval: async expr => { pushedEvals.push(expr); return {}; } }
    );
    assert.equal(translated.reply.ok, true);
    assert.equal(translated.reply.text, '译：Step one');
    assert.ok(pushedEvals.some(e => e.includes('__agyBetaTranslateDelta') && e.includes('tr-1')));

    // Turning betaThinkingTranslate off triggers settings.changed hook -> purges cache automatically
    const prev = settings.get();
    const next = settings.set({ betaThinkingTranslate: false });
    bus.runSync('settings.changed', next, { prev, patch: { betaThinkingTranslate: false } });
    assert.equal(purgedCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
