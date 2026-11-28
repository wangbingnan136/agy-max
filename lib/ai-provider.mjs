import { createProxyFetcher } from './proxy.mjs';

export const AI_PROTOCOLS = Object.freeze(['openai', 'openai-responses', 'anthropic', 'gemini']);
export const AI_PROVIDERS = AI_PROTOCOLS;

export const DEFAULT_BASE_URLS = Object.freeze({
  openai: 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta'
});

const CONTROL_OR_SPACE_RE = /[\x00-\x1f\x7f\s]/;
const HEADER_UNSAFE_RE = /[\r\n\x00-\x1f\x7f]/;
const IPV4_LOOPBACK_RE = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const ANTHROPIC_VERSION = '2023-06-01';

const METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.internal',
  'metadata.tencentyun.com',
  'instance-data',
  'instance-data.ec2.internal',
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254'
]);

function isValidDecimalOctet(part) {
  if (!part || (part.length > 1 && part.startsWith('0'))) return false;
  const num = Number(part);
  return Number.isInteger(num) && num >= 0 && num <= 255;
}

export function isLoopbackHost(hostname) {
  if (typeof hostname !== 'string') return false;
  const clean = hostname.trim().toLowerCase();
  if (!clean) return false;
  if (clean === 'localhost' || clean === '::1' || clean === '[::1]') return true;
  const match = IPV4_LOOPBACK_RE.exec(clean);
  if (!match) return false;
  return isValidDecimalOctet(match[1])
    && isValidDecimalOctet(match[2])
    && isValidDecimalOctet(match[3]);
}

function isBlockedMetadataHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!host) return true;
  if (METADATA_HOSTS.has(host) || host.endsWith('.metadata.google.internal')) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

function makeValidationError(code, error) {
  return { ok: false, code, error };
}

function makeCodedError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function sanitizeErrorText(raw, apiKey = '') {
  let msg = raw instanceof Error ? raw.message : String(raw || 'Request failed');
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key && key.length >= 4) {
    msg = msg.split(key).join('[REDACTED]');
  }
  return msg.replace(/[\r\n]+/g, ' ').trim().slice(0, 400) || 'Request failed';
}

function hasRawAuthorityAtSign(urlStr) {
  const schemeIdx = urlStr.indexOf('://');
  if (schemeIdx === -1) return false;
  const rest = urlStr.slice(schemeIdx + 3);
  const slashIdx = rest.search(/[/?#]/);
  const authority = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  return authority.includes('@');
}

export function validateAiEndpoint({
  provider,
  protocol,
  baseUrl,
  apiKey = '',
  requireKeyForRemote = true
} = {}) {
  const rawProtocol = (protocol !== undefined && protocol !== null && protocol !== '')
    ? protocol
    : provider;
  const normalizedProtocol = typeof rawProtocol === 'string' ? rawProtocol.trim().toLowerCase() : '';
  if (!AI_PROTOCOLS.includes(normalizedProtocol)) {
    return makeValidationError('invalid-provider', `Unsupported AI protocol: ${String(rawProtocol || '')}`);
  }

  let rawUrl;
  if (baseUrl === undefined || baseUrl === null) {
    rawUrl = DEFAULT_BASE_URLS[normalizedProtocol];
  } else if (typeof baseUrl === 'string') {
    rawUrl = baseUrl.trim() || DEFAULT_BASE_URLS[normalizedProtocol];
  } else {
    return makeValidationError('invalid-url', 'AI endpoint URL must be a string');
  }

  if (rawUrl.length > 512 || CONTROL_OR_SPACE_RE.test(rawUrl)) {
    return makeValidationError('invalid-url', 'AI endpoint URL contains invalid characters');
  }
  if (rawUrl.includes('?')) {
    return makeValidationError('query-disallowed', 'AI endpoint URL must not include a query string');
  }
  if (rawUrl.includes('#')) {
    return makeValidationError('hash-disallowed', 'AI endpoint URL must not include a hash fragment');
  }
  if (hasRawAuthorityAtSign(rawUrl)) {
    return makeValidationError('credentials-in-url-disallowed', 'AI endpoint URL must not embed credentials');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return makeValidationError('invalid-url', 'AI endpoint URL is invalid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return makeValidationError('unsupported-protocol', `Unsupported protocol: ${parsed.protocol}`);
  }
  if (!parsed.hostname) {
    return makeValidationError('invalid-url', 'AI endpoint URL is missing a hostname');
  }
  if (isBlockedMetadataHost(parsed.hostname)) {
    return makeValidationError('metadata-host-disallowed', 'Cloud metadata endpoints are blocked');
  }
  if (parsed.username || parsed.password) {
    return makeValidationError('credentials-in-url-disallowed', 'AI endpoint URL must not embed credentials');
  }
  if (parsed.search) {
    return makeValidationError('query-disallowed', 'AI endpoint URL must not include a query string');
  }
  if (parsed.hash) {
    return makeValidationError('hash-disallowed', 'AI endpoint URL must not include a hash fragment');
  }
  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return makeValidationError('invalid-url', 'AI endpoint URL has an invalid port');
    }
  }

  const loopback = isLoopbackHost(parsed.hostname);

  if (parsed.protocol === 'http:' && !loopback) {
    return makeValidationError(
      'remote-http-disallowed',
      'Remote AI endpoints must use HTTPS (HTTP is only permitted on loopback hosts)'
    );
  }

  const cleanKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (cleanKey && HEADER_UNSAFE_RE.test(cleanKey)) {
    return makeValidationError('invalid-api-key', 'API key contains invalid control characters');
  }

  if (!loopback && requireKeyForRemote && !cleanKey) {
    return makeValidationError(
      'api-key-required',
      'An API key is required for non-loopback AI endpoints'
    );
  }

  const origin = parsed.origin;
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  const normalizedBaseUrl = `${origin}${cleanPath}`;

  return {
    ok: true,
    provider: normalizedProtocol,
    protocol: normalizedProtocol,
    origin,
    baseUrl: normalizedBaseUrl,
    isLoopback: loopback
  };
}

function resolveFetcher({ fetcher, home, env, dataDir } = {}) {
  if (typeof fetcher === 'function') return fetcher;
  return createProxyFetcher({ home, env, dataDir, strictProxy: true });
}

function createAbortError(reason) {
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  const err = new Error(typeof reason === 'string' && reason ? reason : 'Request aborted');
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
}

function createScopedSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timer = null;
  let onParentAbort = null;

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(createAbortError(parentSignal.reason));
    } else {
      onParentAbort = () => controller.abort(createAbortError(parentSignal.reason));
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      const err = new Error(`Request timed out after ${timeoutMs}ms`);
      err.name = 'TimeoutError';
      err.code = 'TIMEOUT';
      controller.abort(err);
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (parentSignal && onParentAbort) {
        parentSignal.removeEventListener('abort', onParentAbort);
        onParentAbort = null;
      }
    }
  };
}

function anthropicApiRoot(baseUrl) {
  if (/\/v1$/i.test(baseUrl)) return baseUrl;
  return `${baseUrl}/v1`;
}

function geminiApiRoot(baseUrl) {
  if (/\/v1(?:beta)?$/i.test(baseUrl)) return baseUrl;
  return `${baseUrl}/v1beta`;
}

function cleanGeminiModel(model) {
  return String(model || '').trim().replace(/^models\//i, '');
}

async function readJsonPayload(res) {
  if (typeof res?.json === 'function') {
    try {
      return await res.json();
    } catch (err) {
      throw makeCodedError('invalid-json', `Invalid JSON response: ${err?.message || 'parse error'}`);
    }
  }
  if (typeof res?.text === 'function') {
    const raw = await res.text();
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw makeCodedError('invalid-json', `Invalid JSON response: ${err?.message || 'parse error'}`);
    }
  }
  throw makeCodedError('invalid-response', 'Response object cannot be parsed as JSON');
}

async function readHttpErrorMessage(res, apiKey = '') {
  const status = Number(res?.status) || 0;
  let detail = '';
  try {
    let raw = '';
    if (typeof res?.text === 'function') {
      raw = await res.text();
    } else if (typeof res?.json === 'function') {
      raw = JSON.stringify(await res.json());
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message
          || (typeof parsed?.error === 'string' ? parsed.error : '')
          || parsed?.message
          || parsed?.detail
          || '';
      } catch {
        detail = raw.trim().slice(0, 200);
      }
    }
  } catch {}
  const base = status ? `HTTP ${status}` : 'HTTP error';
  return sanitizeErrorText(detail ? `${base}: ${detail}` : base, apiKey);
}

function extractOpenAiContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let out = '';
    for (const part of content) {
      if (typeof part === 'string') {
        out += part;
      } else if (part && typeof part === 'object') {
        if (part.type === 'reasoning' || part.type === 'thinking' || part.thought === true) continue;
        if (typeof part.text === 'string') out += part.text;
      }
    }
    return out;
  }
  return '';
}

function extractOpenAiResponsesContent(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.length > 0) {
    return payload.output_text;
  }
  const items = Array.isArray(payload?.output) ? payload.output : [];
  let out = '';
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.type !== 'message') continue;
    const parts = Array.isArray(item.content) ? item.content : [];
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'output_text' && typeof part.text === 'string') {
        out += part.text;
      }
    }
  }
  return out;
}

function extractAnthropicContent(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  let out = '';
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      out += block.text;
    }
  }
  return out;
}

function extractGeminiContent(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  let out = '';
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.thought === true) continue;
    if (typeof part.text === 'string') out += part.text;
  }
  return out;
}

function extractProtocolError(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (obj.type === 'error' || obj.type === 'response.failed') {
    return obj.error?.message
      || obj.response?.error?.message
      || obj.message
      || (typeof obj.error === 'string' ? obj.error : '')
      || 'Provider error';
  }
  if (obj.error) {
    return obj.error?.message || (typeof obj.error === 'string' ? obj.error : JSON.stringify(obj.error));
  }
  return '';
}

function buildCompletionRequest({ endpoint, model, system = '', prompt, maxTokens, temperature, apiKey = '', stream = false }) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const trimmedModel = String(model || '').trim();
  const sysText = typeof system === 'string' ? system.trim() : '';
  const userText = String(prompt ?? '');

  if (endpoint.protocol === 'openai') {
    const messages = [];
    if (sysText) messages.push({ role: 'system', content: sysText });
    messages.push({ role: 'user', content: userText });
    const headers = {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json'
    };
    if (key) headers.Authorization = `Bearer ${key}`;
    return {
      url: `${endpoint.baseUrl}/chat/completions`,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: trimmedModel,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream
        })
      }
    };
  }

  if (endpoint.protocol === 'openai-responses') {
    const headers = {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json'
    };
    if (key) headers.Authorization = `Bearer ${key}`;
    const body = {
      model: trimmedModel,
      ...(sysText ? { instructions: sysText } : {}),
      input: userText,
      max_output_tokens: maxTokens,
      temperature,
      stream
    };
    return {
      url: `${endpoint.baseUrl}/responses`,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      }
    };
  }

  if (endpoint.protocol === 'anthropic') {
    const headers = {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
      'anthropic-version': ANTHROPIC_VERSION
    };
    if (key) headers['x-api-key'] = key;
    const body = {
      model: trimmedModel,
      ...(sysText ? { system: sysText } : {}),
      messages: [{ role: 'user', content: userText }],
      max_tokens: maxTokens,
      temperature,
      stream
    };
    return {
      url: `${anthropicApiRoot(endpoint.baseUrl)}/messages`,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      }
    };
  }

  const modelId = cleanGeminiModel(trimmedModel);
  const root = geminiApiRoot(endpoint.baseUrl);
  const url = stream
    ? `${root}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`
    : `${root}/models/${encodeURIComponent(modelId)}:generateContent`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: stream ? 'text/event-stream' : 'application/json'
  };
  if (key) headers['x-goog-api-key'] = key;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature
    }
  };
  if (sysText) {
    payload.systemInstruction = { parts: [{ text: sysText }] };
  }
  return {
    url,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    }
  };
}

export async function listModels({
  provider,
  protocol,
  baseUrl,
  apiKey = '',
  fetcher,
  home,
  env,
  dataDir,
  signal,
  timeoutMs = 15000
} = {}) {
  const endpoint = validateAiEndpoint({ provider, protocol, baseUrl, apiKey });
  if (!endpoint.ok) {
    return { ok: false, code: endpoint.code, error: endpoint.error, models: [] };
  }

  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const fetchFn = resolveFetcher({ fetcher, home, env, dataDir });
  const scoped = createScopedSignal(signal, timeoutMs);

  let url = '';
  const headers = { Accept: 'application/json' };
  if (endpoint.protocol === 'openai' || endpoint.protocol === 'openai-responses') {
    url = `${endpoint.baseUrl}/models`;
    if (key) headers.Authorization = `Bearer ${key}`;
  } else if (endpoint.protocol === 'anthropic') {
    url = `${anthropicApiRoot(endpoint.baseUrl)}/models`;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    if (key) headers['x-api-key'] = key;
  } else {
    url = `${geminiApiRoot(endpoint.baseUrl)}/models`;
    if (key) headers['x-goog-api-key'] = key;
  }

  try {
    if (scoped.signal.aborted) {
      throw createAbortError(scoped.signal.reason);
    }
    const res = await fetchFn(url, {
      method: 'GET',
      headers,
      signal: scoped.signal,
      timeoutMs
    });
    if (!res?.ok) {
      const error = await readHttpErrorMessage(res, key);
      return { ok: false, status: Number(res?.status) || 0, error, models: [] };
    }
    const data = await readJsonPayload(res);
    let rawIds = [];
    if (endpoint.protocol === 'openai' || endpoint.protocol === 'openai-responses') {
      const items = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
      rawIds = items.map(item => (typeof item === 'string' ? item : item?.id));
    } else if (endpoint.protocol === 'anthropic') {
      const items = Array.isArray(data?.data) ? data.data : [];
      rawIds = items.map(item => (typeof item === 'string' ? item : item?.id));
    } else {
      const items = Array.isArray(data?.models) ? data.models : [];
      rawIds = items
        .filter(item => !Array.isArray(item?.supportedGenerationMethods) || item.supportedGenerationMethods.includes('generateContent'))
        .map(item => cleanGeminiModel(typeof item === 'string' ? item : (item?.name || item?.id || '')));
    }

    const seen = new Set();
    const models = [];
    for (const id of rawIds) {
      const clean = typeof id === 'string' ? id.trim() : '';
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      models.push(clean);
    }
    models.sort((a, b) => a.localeCompare(b));

    return { ok: true, models };
  } catch (err) {
    return {
      ok: false,
      code: err?.code || (err?.name === 'AbortError' ? 'ABORT_ERR' : 'request-failed'),
      error: sanitizeErrorText(err, key),
      models: []
    };
  } finally {
    scoped.cleanup();
  }
}

export async function completeText({
  provider,
  protocol,
  baseUrl,
  model,
  system = '',
  prompt,
  maxTokens = 120,
  temperature = 0.2,
  apiKey = '',
  fetcher,
  home,
  env,
  dataDir,
  signal,
  timeoutMs = 45000
} = {}) {
  const endpoint = validateAiEndpoint({ provider, protocol, baseUrl, apiKey });
  if (!endpoint.ok) {
    throw makeCodedError(endpoint.code, endpoint.error);
  }
  const trimmedModel = typeof model === 'string' ? model.trim() : '';
  if (!trimmedModel) {
    throw makeCodedError('model-required', 'Model name is required');
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw makeCodedError('prompt-required', 'Prompt must be a non-empty string');
  }

  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const fetchFn = resolveFetcher({ fetcher, home, env, dataDir });
  const scoped = createScopedSignal(signal, timeoutMs);
  const { url, init } = buildCompletionRequest({
    endpoint,
    model: trimmedModel,
    system,
    prompt,
    maxTokens,
    temperature,
    apiKey: key,
    stream: false
  });

  try {
    if (scoped.signal.aborted) {
      throw createAbortError(scoped.signal.reason);
    }
    const res = await fetchFn(url, {
      ...init,
      signal: scoped.signal,
      timeoutMs
    });
    if (!res?.ok) {
      const msg = await readHttpErrorMessage(res, key);
      throw makeCodedError('http-error', msg, { status: Number(res?.status) || 0 });
    }
    const data = await readJsonPayload(res);
    const providerErr = extractProtocolError(data);
    if (providerErr) {
      throw makeCodedError('provider-error', sanitizeErrorText(providerErr, key));
    }
    if (endpoint.protocol === 'openai') {
      const choice = data?.choices?.[0];
      return extractOpenAiContent(choice?.message?.content ?? choice?.text ?? '');
    }
    if (endpoint.protocol === 'openai-responses') {
      return extractOpenAiResponsesContent(data);
    }
    if (endpoint.protocol === 'anthropic') {
      return extractAnthropicContent(data);
    }
    return extractGeminiContent(data);
  } catch (err) {
    if (scoped.signal.aborted) {
      if (scoped.signal.reason?.name === 'TimeoutError') throw scoped.signal.reason;
      throw createAbortError(scoped.signal.reason || err);
    }
    if (err?.name === 'AbortError') {
      throw createAbortError(err);
    }
    if (err?.code) throw err;
    throw makeCodedError('request-failed', sanitizeErrorText(err, key));
  } finally {
    scoped.cleanup();
  }
}

export async function testConnection({
  provider,
  protocol,
  baseUrl,
  model = '',
  apiKey = '',
  fetcher,
  home,
  env,
  dataDir,
  signal,
  timeoutMs = 10000
} = {}) {
  const endpoint = validateAiEndpoint({ provider, protocol, baseUrl, apiKey });
  if (!endpoint.ok) {
    return { ok: false, code: endpoint.code, error: endpoint.error };
  }

  const startedAt = Date.now();
  const trimmedModel = typeof model === 'string' ? model.trim() : '';
  const scoped = createScopedSignal(signal, timeoutMs);

  try {
    if (trimmedModel) {
      await completeText({
        protocol: endpoint.protocol,
        baseUrl: endpoint.baseUrl,
        model: trimmedModel,
        system: '',
        prompt: 'Reply with OK.',
        maxTokens: 16,
        temperature: 0,
        apiKey,
        fetcher,
        home,
        env,
        dataDir,
        signal: scoped.signal,
        timeoutMs
      });
      return {
        ok: true,
        latencyMs: Math.max(0, Date.now() - startedAt),
        model: trimmedModel
      };
    }

    const listed = await listModels({
      protocol: endpoint.protocol,
      baseUrl: endpoint.baseUrl,
      apiKey,
      fetcher,
      home,
      env,
      dataDir,
      signal: scoped.signal,
      timeoutMs
    });
    if (!listed.ok) {
      return {
        ok: false,
        code: listed.code,
        status: listed.status,
        error: listed.error,
        latencyMs: Math.max(0, Date.now() - startedAt)
      };
    }
    return {
      ok: true,
      latencyMs: Math.max(0, Date.now() - startedAt),
      model: listed.models[0] || ''
    };
  } catch (err) {
    return {
      ok: false,
      code: err?.code || (err?.name === 'AbortError' ? 'ABORT_ERR' : 'request-failed'),
      status: err?.status,
      error: sanitizeErrorText(err, apiKey),
      latencyMs: Math.max(0, Date.now() - startedAt)
    };
  } finally {
    scoped.cleanup();
  }
}

async function* iterateDecodedChunks(res, signal) {
  const body = res?.body;
  const decoder = new TextDecoder('utf-8');

  if (!body) {
    if (typeof res?.text === 'function') {
      const full = await res.text();
      if (full) yield full;
    }
    return;
  }

  if (typeof body === 'string') {
    if (body) yield body;
    return;
  }

  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    const onAbort = () => {
      try { reader.cancel(createAbortError(signal?.reason)); } catch {}
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        throw createAbortError(signal.reason);
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      while (true) {
        if (signal?.aborted) throw createAbortError(signal.reason);
        const { done, value } = await reader.read();
        if (done) break;
        if (value !== undefined && value !== null) {
          const text = typeof value === 'string'
            ? value
            : decoder.decode(value, { stream: true });
          if (text) yield text;
        }
      }
      const trailing = decoder.decode();
      if (trailing) yield trailing;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      try { reader.releaseLock(); } catch {}
    }
    return;
  }

  if (typeof body[Symbol.asyncIterator] === 'function') {
    const onAbort = () => {
      if (typeof body.destroy === 'function') {
        try { body.destroy(createAbortError(signal?.reason)); } catch {}
      }
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        throw createAbortError(signal.reason);
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      for await (const chunk of body) {
        if (signal?.aborted) throw createAbortError(signal.reason);
        if (chunk === undefined || chunk === null) continue;
        const text = typeof chunk === 'string'
          ? chunk
          : decoder.decode(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk), { stream: true });
        if (text) yield text;
      }
      const trailing = decoder.decode();
      if (trailing) yield trailing;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

function getHeaderValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v.join(', ') : String(v || '');
  }
  return '';
}

export async function streamText({
  provider,
  protocol,
  baseUrl,
  model,
  system = '',
  prompt,
  maxTokens = 2048,
  temperature = 0.2,
  apiKey = '',
  fetcher,
  home,
  env,
  dataDir,
  signal,
  timeoutMs = 120000,
  onDelta
} = {}) {
  const endpoint = validateAiEndpoint({ provider, protocol, baseUrl, apiKey });
  if (!endpoint.ok) {
    throw makeCodedError(endpoint.code, endpoint.error);
  }
  const trimmedModel = typeof model === 'string' ? model.trim() : '';
  if (!trimmedModel) {
    throw makeCodedError('model-required', 'Model name is required');
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw makeCodedError('prompt-required', 'Prompt must be a non-empty string');
  }

  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const fetchFn = resolveFetcher({ fetcher, home, env, dataDir });
  const scoped = createScopedSignal(signal, timeoutMs);
  const { url, init } = buildCompletionRequest({
    endpoint,
    model: trimmedModel,
    system,
    prompt,
    maxTokens,
    temperature,
    apiKey: key,
    stream: true
  });

  let full = '';
  const emit = chunk => {
    if (!chunk) return;
    full += chunk;
    if (typeof onDelta === 'function') onDelta(chunk, full);
  };

  try {
    if (scoped.signal.aborted) {
      throw createAbortError(scoped.signal.reason);
    }
    const res = await fetchFn(url, {
      ...init,
      signal: scoped.signal,
      timeoutMs
    });
    if (!res?.ok) {
      const msg = await readHttpErrorMessage(res, key);
      throw makeCodedError('http-error', msg, { status: Number(res?.status) || 0 });
    }

    const contentType = getHeaderValue(res.headers, 'content-type').toLowerCase();

    if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
      const data = await readJsonPayload(res);
      const providerErr = extractProtocolError(data);
      if (providerErr) {
        throw makeCodedError('provider-error', sanitizeErrorText(providerErr, key));
      }
      if (endpoint.protocol === 'openai') {
        const choice = data?.choices?.[0];
        emit(extractOpenAiContent(choice?.message?.content ?? choice?.delta?.content ?? ''));
      } else if (endpoint.protocol === 'openai-responses') {
        emit(extractOpenAiResponsesContent(data));
      } else if (endpoint.protocol === 'anthropic') {
        emit(extractAnthropicContent(data));
      } else {
        emit(extractGeminiContent(data));
      }
      return full;
    }

    let lineBuf = '';
    let dataLines = [];
    let streamDone = false;

    const handleSsePayload = payload => {
      const trimmed = payload.trim();
      if (!trimmed) return;
      if (trimmed === '[DONE]') {
        streamDone = true;
        return;
      }
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return;
      }
      const providerErr = extractProtocolError(obj);
      if (providerErr) {
        throw makeCodedError('provider-error', sanitizeErrorText(providerErr, key));
      }
      if (endpoint.protocol === 'openai') {
        const choice = obj?.choices?.[0];
        const piece = extractOpenAiContent(choice?.delta?.content ?? choice?.message?.content ?? '');
        if (piece) emit(piece);
      } else if (endpoint.protocol === 'openai-responses') {
        if (obj?.type === 'response.output_text.delta' && typeof obj.delta === 'string') {
          emit(obj.delta);
        } else if (obj?.type === 'response.completed') {
          if (!full) {
            const fallback = extractOpenAiResponsesContent(obj.response || obj);
            if (fallback) emit(fallback);
          }
          streamDone = true;
        }
      } else if (endpoint.protocol === 'anthropic') {
        if (obj?.type === 'content_block_delta' && obj.delta?.type === 'text_delta' && typeof obj.delta.text === 'string') {
          emit(obj.delta.text);
        } else if (obj?.type === 'message_stop') {
          streamDone = true;
        }
      } else if (endpoint.protocol === 'gemini') {
        const piece = extractGeminiContent(obj);
        if (piece) emit(piece);
      }
    };

    const flushEvent = () => {
      if (!dataLines.length) return;
      const payload = dataLines.join('\n');
      dataLines = [];
      handleSsePayload(payload);
    };

    const processSseLine = line => {
      if (line === '') {
        flushEvent();
        return;
      }
      if (line.startsWith(':')) return;
      if (line.startsWith('event:')) {
        if (dataLines.length) flushEvent();
        return;
      }
      if (line.startsWith('data:')) {
        const value = line.slice(5).replace(/^ /, '');
        if (dataLines.length === 1 && (value === '[DONE]' || value.startsWith('{'))) {
          const prev = dataLines[0].trim();
          if (prev === '[DONE]' || (prev.startsWith('{') && prev.endsWith('}'))) {
            flushEvent();
          }
        }
        dataLines.push(value);
      }
    };

    for await (const chunk of iterateDecodedChunks(res, scoped.signal)) {
      lineBuf += chunk;
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (scoped.signal.aborted) throw createAbortError(scoped.signal.reason);
        processSseLine(line);
        if (streamDone) break;
      }
      if (streamDone) break;
    }

    if (!streamDone) {
      if (lineBuf) processSseLine(lineBuf);
      flushEvent();
    }

    return full;
  } catch (err) {
    if (scoped.signal.aborted) {
      if (scoped.signal.reason?.name === 'TimeoutError') throw scoped.signal.reason;
      throw createAbortError(scoped.signal.reason || err);
    }
    if (err?.name === 'AbortError') {
      throw createAbortError(err);
    }
    if (err?.code) throw err;
    throw makeCodedError('request-failed', sanitizeErrorText(err, key));
  } finally {
    scoped.cleanup();
  }
}
