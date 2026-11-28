import { completeText } from './ai-provider.mjs';
import { mapTargetLang } from './translator.mjs';

const FENCED_BLOCK_RE = /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g;
const TOOL_XML_BLOCK_RE = /<(?:tool_call|tool_use|tool_result|tool_output|function_call|function_response|antml:invoke|antml:function_calls)[^>]*>[\s\S]*?<\/(?:tool_call|tool_use|tool_result|tool_output|function_call|function_response|antml:invoke|antml:function_calls)>/gi;
const TOOL_LOG_LINE_RE = /^[ \t]*(?:\[(?:tool|stdout|stderr|command|exec|debug|trace)[^\]]*\]|Command exited with code \d+|Command output:|Exit code:\s*\d+|\$\s+\S+.*|at\s+\S+\s+\([^)]+:\d+:\d+\))[^\n]*$/gim;

function stripCodeAndToolNoise(raw) {
  if (typeof raw !== 'string') return '';
  let text = raw.replace(/\r\n/g, '\n');
  text = text.replace(FENCED_BLOCK_RE, '$1[code block]');
  text = text.replace(TOOL_XML_BLOCK_RE, ' ');
  text = text.replace(TOOL_LOG_LINE_RE, ' ');
  text = text.replace(/(?:\[code block\]\s*){2,}/g, '[code block]\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function normalizeTurns(turns) {
  if (!Array.isArray(turns) || !turns.length) return [];

  const looksPaired = turns.some(
    t => t && typeof t === 'object'
      && ('user' in t || 'assistant' in t || 'prompt' in t || 'response' in t || 'userText' in t || 'assistantText' in t)
  );

  if (looksPaired) {
    const pairs = [];
    for (const item of turns) {
      if (!item || typeof item !== 'object') continue;
      const user = stripCodeAndToolNoise(item.user ?? item.prompt ?? item.userText ?? '');
      const assistant = stripCodeAndToolNoise(item.assistant ?? item.response ?? item.assistantText ?? '');
      if (user || assistant) pairs.push({ user, assistant });
    }
    return pairs.slice(-2);
  }

  const pairs = [];
  let current = null;
  for (const msg of turns) {
    if (!msg || typeof msg !== 'object') continue;
    const role = String(msg.role || '').trim().toLowerCase();
    if (role !== 'user' && role !== 'assistant') continue;
    const text = stripCodeAndToolNoise(msg.content ?? msg.text ?? '');
    if (!text) continue;
    if (role === 'user') {
      if (current && (current.user || current.assistant)) pairs.push(current);
      current = { user: text, assistant: '' };
    } else {
      if (!current) current = { user: '', assistant: text };
      else current.assistant = current.assistant ? `${current.assistant}\n${text}` : text;
    }
  }
  if (current && (current.user || current.assistant)) pairs.push(current);
  return pairs.slice(-2);
}

function takeHead(text, limit) {
  if (limit <= 0 || !text) return '';
  if (text.length <= limit) return text;
  if (limit <= 3) return text.slice(0, limit);
  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function takeTail(text, limit) {
  if (limit <= 0 || !text) return '';
  if (text.length <= limit) return text;
  if (limit <= 3) return text.slice(-limit);
  return `...${text.slice(-(limit - 3)).trimStart()}`;
}

function formatTurnPair(pair, userBudget, assistantBudget) {
  const lines = [];
  if (pair.user && userBudget > 0) {
    lines.push(`User: ${takeHead(pair.user, userBudget)}`);
  }
  if (pair.assistant && assistantBudget > 0) {
    lines.push(`Assistant: ${takeTail(pair.assistant, assistantBudget)}`);
  }
  return lines.join('\n');
}

export function buildMinimalContextSummary({ turns = [], maxChars = 1800 } = {}) {
  const budget = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (budget === 0) return '';

  const recent = normalizeTurns(turns);
  if (!recent.length) return '';

  const renderAll = pairs => {
    const blocks = [];
    for (const pair of pairs) {
      const lines = [];
      if (pair.user) lines.push(`User: ${pair.user}`);
      if (pair.assistant) lines.push(`Assistant: ${pair.assistant}`);
      if (lines.length) blocks.push(lines.join('\n'));
    }
    return blocks.join('\n\n');
  };

  const full = renderAll(recent);
  if (full.length <= budget) return full;

  if (recent.length === 2 && budget >= 240) {
    const olderBudget = Math.floor(budget * 0.35);
    const latestBudget = budget - olderBudget - 2;
    const olderBlock = formatTurnPair(
      recent[0],
      Math.max(0, Math.floor(olderBudget * 0.45) - 6),
      Math.max(0, Math.floor(olderBudget * 0.55) - 12)
    );
    const latestBlock = formatTurnPair(
      recent[1],
      Math.max(0, Math.floor(latestBudget * 0.38) - 6),
      Math.max(0, Math.floor(latestBudget * 0.62) - 12)
    );
    const combined = [olderBlock, latestBlock].filter(Boolean).join('\n\n');
    if (combined.length <= budget) return combined;
    return takeTail(combined, budget);
  }

  const last = recent[recent.length - 1];
  const overhead = (last.user ? 6 : 0) + (last.assistant ? 12 : 0) + (last.user && last.assistant ? 1 : 0);
  const contentBudget = Math.max(0, budget - overhead);
  if (contentBudget === 0) return takeTail(full, budget);

  const userBudget = last.user
    ? (last.assistant ? Math.min(last.user.length, Math.max(40, Math.floor(contentBudget * 0.38))) : contentBudget)
    : 0;
  const assistantBudget = last.assistant ? Math.max(0, contentBudget - userBudget) : 0;
  const formatted = formatTurnPair(last, userBudget, assistantBudget);
  return formatted.length <= budget ? formatted : formatted.slice(0, budget);
}

const PREFIX_LABEL_RE = /^(?:(?:next|suggested|recommended|predicted|possible|likely)\s+(?:user\s+)?(?:prompt|message|question|follow[- ]?up|step)|follow[- ]?up|suggestion|prompt|user|next|下一步(?:建议|提问|指令)?|建议(?:提问|输入)?|推荐(?:提问|回复)?|追问|用户)\s*[:：-]\s*/i;
const HEADER_ONLY_RE = /^(?:(?:next|suggested|recommended|predicted)\s+(?:user\s+)?(?:prompt|message|question|follow[- ]?up|step)|follow[- ]?up|suggestion|prompt|下一步(?:建议|提问)?|建议|推荐提问|追问)\s*[:：]?\s*$/i;
const BULLET_PREFIX_RE = new RegExp(`^(?:[-*+>${String.fromCharCode(0x2022)}]|\\d+[.)、])\\s+`);
const META_OR_REFUSAL_RE = /^(?:i\s+(?:cannot|can't|am\s+unable|don't\s+have)|as\s+an\s+ai|sorry,?\s+i\b|here\s+(?:is|are)\s+(?:a|the|one|some)\b|no\s+(?:suggestion|follow[- ]?up)|none|n\/a|null|undefined|抱歉|对不起|作为\s*AI|无法(?:预测|生成|提供)|没有(?:建议|合适)|暂无建议|以下是)/i;
const PURE_PUNCT_RE = /^[\p{P}\p{S}\s]+$/u;

const QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』']
];

function stripSurroundingQuotes(text) {
  let out = text.trim();
  let changed = true;
  while (changed && out.length >= 2) {
    changed = false;
    for (const [open, close] of QUOTE_PAIRS) {
      if (out.startsWith(open) && out.endsWith(close)) {
        out = out.slice(open.length, out.length - close.length).trim();
        changed = true;
        break;
      }
    }
  }
  return out;
}

function clampIntentLength(text, maxLen = 90) {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const spaceIdx = slice.lastIndexOf(' ');
  const punctIdx = Math.max(slice.lastIndexOf('，'), slice.lastIndexOf('。'), slice.lastIndexOf('；'), slice.lastIndexOf(','));
  const cut = Math.max(spaceIdx, punctIdx);
  if (cut >= Math.floor(maxLen * 0.6)) {
    return slice.slice(0, cut).replace(/[,:;，：；\s]+$/, '').trim();
  }
  return slice.replace(/[,:;，：；\s]+$/, '').trim();
}

export function parsePredictedIntent(rawText) {
  if (typeof rawText !== 'string') return '';
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (!lines.length) return '';

  let candidate = '';
  for (const line of lines) {
    if (HEADER_ONLY_RE.test(line)) continue;
    candidate = line;
    break;
  }
  if (!candidate) return '';

  let cleaned = candidate;
  for (let pass = 0; pass < 3; pass++) {
    cleaned = cleaned.replace(BULLET_PREFIX_RE, '').trim();
    cleaned = cleaned.replace(/^\*\*(.+)\*\*$/, '$1').replace(/^__(.+)__$/, '$1').trim();
    cleaned = stripSurroundingQuotes(cleaned);
    cleaned = cleaned.replace(PREFIX_LABEL_RE, '').trim();
    cleaned = stripSurroundingQuotes(cleaned);
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned || PURE_PUNCT_RE.test(cleaned)) return '';
  if (META_OR_REFUSAL_RE.test(cleaned)) return '';

  const clamped = clampIntentLength(cleaned, 90);
  if (!clamped || PURE_PUNCT_RE.test(clamped)) return '';
  return clamped;
}

function buildIntentSystemPrompt(language = '') {
  const langRule = language
    ? `Write the follow-up message in ${mapTargetLang(language).label} (${mapTargetLang(language).lang}).`
    : 'Write the follow-up message in the exact same language as the user used in the conversation.';
  return [
    'Predict the single most likely next follow-up message the user will type in this coding assistant chat.',
    langRule,
    'Output ONLY ONE short, natural, actionable follow-up message (under 80 characters).',
    'No quotes, no bullets, no prefixes, no markdown, and no explanation.'
  ].join('\n');
}

export function createIntentPredictor({ maxCache = 64 } = {}) {
  const limit = Math.max(1, Math.floor(Number(maxCache) || 64));
  const cache = new Map();
  const inFlight = new Map();

  function makeKey({ conversationId = '', turnId = '', aiConfig = {}, language = '' }) {
    return `${String(conversationId || '')}:${String(turnId || '')}:${String(aiConfig?.provider || '')}:${String(aiConfig?.model || '')}:${String(language || '')}`;
  }

  function getCached(key) {
    if (!cache.has(key)) return undefined;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function setCached(key, value) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  async function predict({
    conversationId = '',
    turnId = '',
    turns = [],
    language = '',
    aiConfig,
    fetcher,
    home,
    env,
    dataDir,
    signal
  } = {}) {
    if (signal?.aborted) {
      return { ok: false, aborted: true, suggestion: '', error: 'Request aborted' };
    }

    const key = makeKey({ conversationId, turnId, aiConfig, language });
    const cached = getCached(key);
    if (cached !== undefined) {
      return { ok: true, suggestion: cached, cached: true };
    }

    const summary = buildMinimalContextSummary({ turns });
    if (!summary) {
      return { ok: true, suggestion: '', skipped: true };
    }

    if (!aiConfig || typeof aiConfig !== 'object') {
      return { ok: false, suggestion: '', code: 'invalid-config', error: 'AI configuration is required' };
    }

    let entry = inFlight.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { waiters: 0, controller, promise: null };
      entry.promise = (async () => {
        const raw = await completeText({
          provider: aiConfig.provider,
          baseUrl: aiConfig.baseUrl,
          model: aiConfig.model,
          apiKey: aiConfig.apiKey,
          system: buildIntentSystemPrompt(language),
          prompt: summary,
          maxTokens: 70,
          temperature: 0.25,
          fetcher: aiConfig.fetcher || fetcher,
          home,
          env,
          dataDir,
          signal: controller.signal
        });
        const suggestion = parsePredictedIntent(raw);
        setCached(key, suggestion);
        return suggestion;
      })();
      entry.promise.catch(() => {});
      inFlight.set(key, entry);
      entry.promise.finally(() => {
        if (inFlight.get(key) === entry) {
          inFlight.delete(key);
        }
      });
    }

    entry.waiters += 1;
    let released = false;
    const releaseWaiter = (shouldAbortShared = false) => {
      if (released) return;
      released = true;
      entry.waiters = Math.max(0, entry.waiters - 1);
      if (shouldAbortShared && entry.waiters === 0) {
        try { entry.controller.abort(); } catch {}
      }
    };

    try {
      const suggestion = signal
        ? await new Promise((resolve, reject) => {
            if (signal.aborted) {
              releaseWaiter(true);
              const err = new Error('Request aborted');
              err.name = 'AbortError';
              reject(err);
              return;
            }
            const onAbort = () => {
              releaseWaiter(true);
              const err = new Error('Request aborted');
              err.name = 'AbortError';
              reject(err);
            };
            signal.addEventListener('abort', onAbort, { once: true });
            entry.promise.then(
              val => {
                signal.removeEventListener('abort', onAbort);
                releaseWaiter(false);
                resolve(val);
              },
              err => {
                signal.removeEventListener('abort', onAbort);
                releaseWaiter(false);
                reject(err);
              }
            );
          })
        : await entry.promise.finally(() => releaseWaiter(false));
      return { ok: true, suggestion, cached: false };
    } catch (err) {
      releaseWaiter(false);
      if (err?.name === 'AbortError' || signal?.aborted) {
        return { ok: false, aborted: true, suggestion: '', error: 'Request aborted' };
      }
      return {
        ok: false,
        code: err?.code || 'request-failed',
        suggestion: '',
        error: err?.message || 'Intent prediction failed'
      };
    }
  }

  function clear() {
    cache.clear();
  }

  return {
    predict,
    clear,
    cacheSize() {
      return cache.size;
    }
  };
}
