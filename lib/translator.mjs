import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createProxyFetcher } from './proxy.mjs';
import { streamText } from './ai-provider.mjs';

export const TRANSLATE_ENGINES = Object.freeze(['free', 'ai']);

const DEFAULT_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const GOOGLE_HTML_URL = 'https://translate-pa.googleapis.com/v1/translateHtml';
// Public Chrome Translate (wt_lib) client identifier; not a private GCP API key.
const GOOGLE_HTML_API_KEY = 'AIzaSy' + 'ATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'; // gitleaks:allow
const GOOGLE_GTX_BASE_URL = 'https://translate.googleapis.com/translate_a/single';
const EDGE_TRANSLATE_BASE_URL = 'https://edge.microsoft.com/translate/translatetext';

const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_CHUNK_CHARS = 3500;
const TRANSPORT_STICKY_MS = 10 * 60 * 1000;
const FREE_TRANSPORTS = Object.freeze(['google-html', 'google-gtx', 'edge']);

const LANG_MAP = Object.freeze({
  'zh-CN': Object.freeze({ lang: 'zh-CN', google: 'zh-CN', edge: 'zh-Hans', label: 'Simplified Chinese' }),
  'zh-TW': Object.freeze({ lang: 'zh-TW', google: 'zh-TW', edge: 'zh-Hant', label: 'Traditional Chinese' }),
  yue: Object.freeze({ lang: 'zh-TW', google: 'zh-TW', edge: 'zh-Hant', label: 'Traditional Chinese (Cantonese)' }),
  en: Object.freeze({ lang: 'en', google: 'en', edge: 'en', label: 'English' }),
  fr: Object.freeze({ lang: 'fr', google: 'fr', edge: 'fr', label: 'French' }),
  ja: Object.freeze({ lang: 'ja', google: 'ja', edge: 'ja', label: 'Japanese' }),
  ko: Object.freeze({ lang: 'ko', google: 'ko', edge: 'ko', label: 'Korean' }),
  de: Object.freeze({ lang: 'de', google: 'de', edge: 'de', label: 'German' }),
  es: Object.freeze({ lang: 'es', google: 'es', edge: 'es', label: 'Spanish' }),
  ru: Object.freeze({ lang: 'ru', google: 'ru', edge: 'ru', label: 'Russian' }),
  vi: Object.freeze({ lang: 'vi', google: 'vi', edge: 'vi', label: 'Vietnamese' })
});

function matchTargetLocale(raw = '') {
  const clean = String(raw || '').trim().replace(/\..*$/, '').replace(/_/g, '-');
  if (!clean) return 'zh-CN';
  const lower = clean.toLowerCase();
  if (lower === 'yue' || lower.startsWith('yue-')) return 'yue';
  if (lower.startsWith('zh')) {
    if (/-(tw|hk|mo|hant)\b/.test(lower)) return 'zh-TW';
    return 'zh-CN';
  }
  const primary = lower.split('-')[0];
  if (Object.hasOwn(LANG_MAP, primary)) return primary;
  return 'en';
}

export function mapTargetLang(lang) {
  const raw = typeof lang === 'string' ? lang.trim() : '';
  if (!raw) return LANG_MAP['zh-CN'];
  if (Object.hasOwn(LANG_MAP, raw)) return LANG_MAP[raw];
  const matched = matchTargetLocale(raw);
  return LANG_MAP[matched] || LANG_MAP.en;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const NAMED_HTML_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
});

function unescapeHtmlOnce(text) {
  return String(text || '').replace(/&(amp|lt|gt|quot|apos|nbsp|#(\d+)|#x([0-9a-fA-F]+));/gi, (full, body, dec, hex) => {
    if (dec !== undefined) {
      const code = Number.parseInt(dec, 10);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        try { return String.fromCodePoint(code); } catch { return full; }
      }
      return full;
    }
    if (hex !== undefined) {
      const code = Number.parseInt(hex, 16);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        try { return String.fromCodePoint(code); } catch { return full; }
      }
      return full;
    }
    const lower = String(body || '').toLowerCase();
    return Object.hasOwn(NAMED_HTML_ENTITIES, lower) ? NAMED_HTML_ENTITIES[lower] : full;
  });
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
      const err = new Error(`Translation request timed out after ${timeoutMs}ms`);
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

function resolveFreeFetcher({ fetcher, home, env, dataDir, proxyUrl, bypass } = {}) {
  if (typeof fetcher === 'function') return fetcher;
  return createProxyFetcher({ home, env, dataDir, proxyUrl, bypass });
}

async function readJsonSafe(res) {
  if (typeof res?.json === 'function') {
    return await res.json();
  }
  if (typeof res?.text === 'function') {
    return JSON.parse(await res.text());
  }
  throw new Error('Translation response cannot be read as JSON');
}

const HR_LINE_RE = /^[ \t]*(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/;
const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/;
const INLINE_CODE_RE = /(`+)([^\n]*?)\1/g;
const URL_RE = /https?:\/\/[^\s<>"'`\])]+/g;
const WIN_PATH_RE = /\b[A-Za-z]:\\(?:[^\s"'`<>|*?]+\\)*[^\s"'`<>|*?]+|\b[A-Za-z]:\/(?:[^\s"'`<>|*?]+\/)+[^\s"'`<>|*?]+/g;
const POSIX_OR_REL_PATH_RE = /(?<![A-Za-z0-9_.:])(?:(?:\.\.?|~)\/[^\s"'`<>),;:!?]+|\/(?:Users|home|etc|var|tmp|opt|usr|bin|lib|src|app|mnt|proc|dev|Applications|Library|System|Volumes)(?:\/[^\s"'`<>),;:!?]+)+|(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z][A-Za-z0-9]{0,7})(?![A-Za-z0-9_/-])/g;

function trimUrlTrailingPunctuation(rawUrl) {
  let url = rawUrl;
  let suffix = '';
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (/[.,;:!?]/.test(last)) {
      suffix = last + suffix;
      url = url.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (closes > opens) {
        suffix = last + suffix;
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return { url, suffix };
}

export function maskTechnicalMarkdown(text) {
  const input = String(text ?? '');
  if (!input) {
    return { masked: '', tokens: [] };
  }

  const usedIndices = new Set();
  for (const match of input.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    usedIndices.add(Number(match[1]));
  }

  let nextIdx = 0;
  const tokens = [];
  const register = (value, kind) => {
    while (usedIndices.has(nextIdx)) nextIdx += 1;
    const index = nextIdx;
    usedIndices.add(index);
    nextIdx += 1;
    const placeholder = `{{${index}}}`;
    tokens.push({ index, placeholder, value, kind });
    return placeholder;
  };

  const lines = input.split('\n');
  const outLines = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const openMatch = FENCE_OPEN_RE.exec(line);
    if (openMatch) {
      const fenceChar = openMatch[2][0];
      const fenceLen = openMatch[2].length;
      const closeRe = new RegExp(`^[ \\t]*${fenceChar}{${fenceLen},}[ \\t]*$`);
      const blockLines = [line];
      i += 1;
      while (i < lines.length) {
        blockLines.push(lines[i]);
        if (closeRe.test(lines[i])) {
          i += 1;
          break;
        }
        i += 1;
      }
      outLines.push(register(blockLines.join('\n'), 'fenced-code'));
      continue;
    }
    if (HR_LINE_RE.test(line)) {
      outLines.push(register(line, 'hr'));
      i += 1;
      continue;
    }
    outLines.push(line);
    i += 1;
  }

  let masked = outLines.join('\n');
  masked = masked.replace(INLINE_CODE_RE, match => register(match, 'inline-code'));
  masked = masked.replace(URL_RE, match => {
    const { url, suffix } = trimUrlTrailingPunctuation(match);
    if (!url) return match;
    return `${register(url, 'url')}${suffix}`;
  });
  masked = masked.replace(WIN_PATH_RE, match => register(match, 'file-path'));
  masked = masked.replace(POSIX_OR_REL_PATH_RE, match => register(match, 'file-path'));

  return { masked, tokens };
}

export function unmaskTechnicalMarkdown(text, tokens = []) {
  const input = String(text ?? '');
  const list = Array.isArray(tokens) ? tokens : [];
  if (!list.length) {
    return {
      text: input,
      ok: true,
      intact: true,
      missing: [],
      restoredCount: 0,
      totalCount: 0
    };
  }

  const byIndex = new Map();
  for (const item of list) {
    if (item && Number.isInteger(item.index) && typeof item.value === 'string') {
      byIndex.set(item.index, item);
    }
  }

  const found = new Set();
  const restored = input.replace(/(?:\{\s*\{|｛\s*｛)\s*(\d+)\s*(?:\}\s*\}|｝\s*｝)/g, (full, rawIndex) => {
    const idx = Number(rawIndex);
    const entry = byIndex.get(idx);
    if (!entry) return full;
    found.add(idx);
    return entry.value;
  });

  const missing = [];
  for (const item of list) {
    if (!found.has(item.index)) {
      missing.push(item);
    }
  }

  return {
    text: restored,
    ok: missing.length === 0,
    intact: missing.length === 0,
    missing,
    restoredCount: found.size,
    totalCount: list.length
  };
}

const ENGLISH_HINT_RE = /\b(?:the|and|that|with|this|from|have|will|should|would|could|into|about|check|need|using|there|their|which|when|where|because|before|after)\b/i;
const FRENCH_HINT_RE = /\b(?:les|des|une|pour|dans|avec|nous|vous|est|sont|mais|comme|aussi|être|cette|chez)\b|[àâæçéèêëîïôœùûüÿ]/i;
const GERMAN_HINT_RE = /\b(?:der|die|das|und|ist|nicht|mit|auf|für|eine|einen|einem|werden|kann|auch|oder|über)\b|[äöüß]/i;
const SPANISH_HINT_RE = /\b(?:los|las|una|para|por|con|como|pero|más|este|esta|entre|sobre|desde|está|son)\b|[áéíóúñ¿¡]/i;
const VIETNAMESE_CHAR_RE = /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/g;
const VIETNAMESE_UNIQUE_RE = /[ăâđơưĂÂĐƠƯằắẳẵặầấẩẫậềếểễệồốổỗộờớởỡợừứửữự]/;

export function shouldSkipTranslation(text, targetLang = 'zh-CN') {
  if (typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (!trimmed) return true;

  const { masked } = maskTechnicalMarkdown(trimmed);
  const unmaskedProse = masked.replace(/\{\{\d+\}\}/g, ' ');
  const prose = unmaskedProse.replace(/[^\p{L}]+/gu, ' ').trim();

  if (!prose) return true;

  const hanCount = (prose.match(/\p{Script=Han}/gu) || []).length;
  const kanaCount = (prose.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const hangulCount = (prose.match(/\p{Script=Hangul}/gu) || []).length;
  const cyrillicCount = (prose.match(/\p{Script=Cyrillic}/gu) || []).length;
  const latinCount = (prose.match(/\p{Script=Latin}/gu) || []).length;
  const totalLetters = hanCount + kanaCount + hangulCount + cyrillicCount + latinCount;

  if (totalLetters === 0) return true;

  const proseNoAcronyms = unmaskedProse
    .replace(/\b[A-Z]{2,6}\b/g, ' ')
    .replace(/[^\p{L}]+/gu, ' ')
    .trim();
  const nonAcronymLatin = (proseNoAcronyms.match(/\p{Script=Latin}/gu) || []).length;
  const effectiveTotalForNonLatin = hanCount + kanaCount + hangulCount + cyrillicCount + nonAcronymLatin;

  const target = mapTargetLang(targetLang).lang;

  if (target === 'zh-CN' || target === 'zh-TW') {
    if (kanaCount > 0 && kanaCount / (hanCount + kanaCount) >= 0.1) return false;
    if (hangulCount > 0 && hangulCount / (hanCount + hangulCount) >= 0.1) return false;
    return hanCount >= 2 && effectiveTotalForNonLatin > 0 && hanCount / effectiveTotalForNonLatin >= 0.4;
  }

  if (target === 'ja') {
    return kanaCount >= 2 && effectiveTotalForNonLatin > 0 && (kanaCount + hanCount) / effectiveTotalForNonLatin >= 0.5;
  }

  if (target === 'ko') {
    return hangulCount >= 2 && effectiveTotalForNonLatin > 0 && hangulCount / effectiveTotalForNonLatin >= 0.45;
  }

  if (target === 'ru') {
    return cyrillicCount >= 3 && effectiveTotalForNonLatin > 0 && cyrillicCount / effectiveTotalForNonLatin >= 0.6;
  }

  if (target === 'vi') {
    const viChars = (prose.match(VIETNAMESE_CHAR_RE) || []).length;
    return latinCount >= 4 && latinCount / totalLetters >= 0.7 && VIETNAMESE_UNIQUE_RE.test(prose) && viChars >= 2;
  }

  if (target === 'en') {
    if (latinCount < 4 || latinCount / totalLetters < 0.85) return false;
    const asciiLatin = (prose.match(/[A-Za-z]/g) || []).length;
    if (asciiLatin / latinCount < 0.97) return false;
    if (VIETNAMESE_UNIQUE_RE.test(prose)) return false;
    if (ENGLISH_HINT_RE.test(unmaskedProse)) return true;
    if (!FRENCH_HINT_RE.test(unmaskedProse) && !GERMAN_HINT_RE.test(unmaskedProse) && !SPANISH_HINT_RE.test(unmaskedProse)) {
      return true;
    }
    return false;
  }

  if (target === 'fr') {
    return latinCount >= 8 && latinCount / totalLetters >= 0.85 && FRENCH_HINT_RE.test(unmaskedProse) && !ENGLISH_HINT_RE.test(unmaskedProse);
  }
  if (target === 'de') {
    return latinCount >= 8 && latinCount / totalLetters >= 0.85 && GERMAN_HINT_RE.test(unmaskedProse) && !ENGLISH_HINT_RE.test(unmaskedProse);
  }
  if (target === 'es') {
    return latinCount >= 8 && latinCount / totalLetters >= 0.85 && SPANISH_HINT_RE.test(unmaskedProse) && !ENGLISH_HINT_RE.test(unmaskedProse);
  }

  return false;
}

export async function translateGoogleHtml(text, targetLang, {
  fetcher,
  home,
  env,
  dataDir,
  proxyUrl,
  bypass,
  signal,
  timeoutMs = 10000
} = {}) {
  const { google: googleLang } = mapTargetLang(targetLang);
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  const escapedHtml = escapeHtml(normalized).replace(/\n/g, '<br>');
  const fetchFn = resolveFreeFetcher({ fetcher, home, env, dataDir, proxyUrl, bypass });
  const scoped = createScopedSignal(signal, timeoutMs);

  try {
    if (scoped.signal.aborted) throw createAbortError(scoped.signal.reason);
    const res = await fetchFn(GOOGLE_HTML_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'X-Goog-API-Key': GOOGLE_HTML_API_KEY,
        'User-Agent': DEFAULT_BROWSER_UA
      },
      body: JSON.stringify([[[escapedHtml], 'auto', googleLang], 'wt_lib']),
      signal: scoped.signal,
      timeoutMs
    });
    if (!res?.ok) {
      throw new Error(`Google translateHtml failed with HTTP ${Number(res?.status) || 0}`);
    }
    const data = await readJsonSafe(res);
    const rawTranslated = Array.isArray(data?.[0])
      ? data[0][0]
      : (typeof data?.[0] === 'string' ? data[0] : null);
    if (typeof rawTranslated !== 'string') {
      throw new Error('Google translateHtml returned an unexpected payload');
    }
    const withNewlines = rawTranslated.replace(/<br\s*\/?>/gi, '\n');
    return unescapeHtmlOnce(withNewlines);
  } catch (err) {
    if (err?.name === 'AbortError' || scoped.signal.aborted) {
      throw createAbortError(scoped.signal.reason || err);
    }
    throw err;
  } finally {
    scoped.cleanup();
  }
}

export async function translateGoogleGtx(text, targetLang, {
  fetcher,
  home,
  env,
  dataDir,
  proxyUrl,
  bypass,
  signal,
  timeoutMs = 10000
} = {}) {
  const { google: googleLang } = mapTargetLang(targetLang);
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  const fetchFn = resolveFreeFetcher({ fetcher, home, env, dataDir, proxyUrl, bypass });
  const scoped = createScopedSignal(signal, timeoutMs);
  const url = `${GOOGLE_GTX_BASE_URL}?client=gtx&sl=auto&tl=${encodeURIComponent(googleLang)}&dt=t`;

  try {
    if (scoped.signal.aborted) throw createAbortError(scoped.signal.reason);
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': DEFAULT_BROWSER_UA
      },
      body: `q=${encodeURIComponent(normalized)}`,
      signal: scoped.signal,
      timeoutMs
    });
    if (!res?.ok) {
      throw new Error(`Google GTX translate failed with HTTP ${Number(res?.status) || 0}`);
    }
    const data = await readJsonSafe(res);
    if (!Array.isArray(data?.[0])) {
      throw new Error('Google GTX translate returned an unexpected payload');
    }
    let out = '';
    for (const seg of data[0]) {
      if (Array.isArray(seg) && typeof seg[0] === 'string') {
        out += seg[0];
      }
    }
    return out;
  } catch (err) {
    if (err?.name === 'AbortError' || scoped.signal.aborted) {
      throw createAbortError(scoped.signal.reason || err);
    }
    throw err;
  } finally {
    scoped.cleanup();
  }
}

export async function translateMicrosoftEdge(text, targetLang, {
  fetcher,
  home,
  env,
  dataDir,
  proxyUrl,
  bypass,
  signal,
  timeoutMs = 10000
} = {}) {
  const { edge: edgeLang } = mapTargetLang(targetLang);
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  const escapedText = escapeHtml(normalized);
  const fetchFn = resolveFreeFetcher({ fetcher, home, env, dataDir, proxyUrl, bypass });
  const scoped = createScopedSignal(signal, timeoutMs);
  const url = `${EDGE_TRANSLATE_BASE_URL}?from=&to=${encodeURIComponent(edgeLang)}&isEnterpriseClient=false`;

  try {
    if (scoped.signal.aborted) throw createAbortError(scoped.signal.reason);
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': DEFAULT_BROWSER_UA
      },
      body: JSON.stringify([escapedText]),
      signal: scoped.signal,
      timeoutMs
    });
    if (!res?.ok) {
      throw new Error(`Microsoft Edge translate failed with HTTP ${Number(res?.status) || 0}`);
    }
    const data = await readJsonSafe(res);
    let rawTranslated = null;
    if (Array.isArray(data)) {
      if (typeof data[0] === 'string') {
        rawTranslated = data[0];
      } else if (typeof data[0]?.translations?.[0]?.text === 'string') {
        rawTranslated = data[0].translations[0].text;
      }
    }
    if (typeof rawTranslated !== 'string') {
      throw new Error('Microsoft Edge translate returned an unexpected payload');
    }
    return unescapeHtmlOnce(rawTranslated);
  } catch (err) {
    if (err?.name === 'AbortError' || scoped.signal.aborted) {
      throw createAbortError(scoped.signal.reason || err);
    }
    throw err;
  } finally {
    scoped.cleanup();
  }
}

function splitTextIntoSegments(text, maxChunkChars = DEFAULT_MAX_CHUNK_CHARS) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  const rawParts = normalized.split(/(\n{2,})/);
  const segments = [];

  for (let i = 0; i < rawParts.length; i += 2) {
    const para = rawParts[i] || '';
    const sep = rawParts[i + 1] || '';
    if (para.length <= maxChunkChars) {
      segments.push({ text: para, separator: sep });
      continue;
    }

    const subPieces = [];
    const lines = para.split('\n');
    let current = '';
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const prefix = current ? '\n' : '';
      if ((current.length + prefix.length + line.length) <= maxChunkChars) {
        current += prefix + line;
        continue;
      }
      if (current) {
        subPieces.push({ text: current, separator: '\n' });
        current = '';
      }
      if (line.length <= maxChunkChars) {
        current = line;
        continue;
      }
      let pos = 0;
      while (pos < line.length) {
        let end = Math.min(pos + maxChunkChars, line.length);
        if (end < line.length) {
          const openBrace = line.lastIndexOf('{{', end);
          const closeBrace = openBrace !== -1 ? line.indexOf('}}', openBrace) : -1;
          if (openBrace !== -1 && openBrace < end && (closeBrace === -1 || closeBrace + 2 > end)) {
            if (openBrace > pos) end = openBrace;
            else if (closeBrace !== -1) end = closeBrace + 2;
          } else {
            const windowStr = line.slice(pos, end);
            const boundary = Math.max(
              windowStr.lastIndexOf('. '),
              windowStr.lastIndexOf('! '),
              windowStr.lastIndexOf('? '),
              windowStr.lastIndexOf('。'),
              windowStr.lastIndexOf('；'),
              windowStr.lastIndexOf(' ')
            );
            if (boundary > Math.floor(maxChunkChars * 0.4)) {
              end = pos + boundary + 1;
            }
          }
        }
        const slice = line.slice(pos, end);
        subPieces.push({ text: slice, separator: '' });
        pos = end;
      }
      if (li < lines.length - 1 && subPieces.length) {
        subPieces[subPieces.length - 1].separator = '\n';
      }
    }
    if (current) {
      subPieces.push({ text: current, separator: '' });
    }
    if (subPieces.length) {
      subPieces[subPieces.length - 1].separator = sep;
      segments.push(...subPieces);
    }
  }

  return segments;
}

function atomicWriteCacheFile(filePath, payload) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  const serialized = JSON.stringify(payload);
  writeFileSync(tmpPath, serialized, { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(tmpPath, 0o600); } catch {}
  renameSync(tmpPath, filePath);
  try { chmodSync(filePath, 0o600); } catch {}
}

function buildAiTranslateSystemPrompt(targetInfo, contextPrev = '') {
  const lines = [
    `Translate the user's AI reasoning trace faithfully and naturally into ${targetInfo.label} (${targetInfo.lang}).`,
    'Preserve all Markdown formatting, fenced code blocks, inline code, identifiers, file paths, URLs, and technical terms verbatim.',
    'Output ONLY the translated text without commentary, notes, or surrounding quotes.'
  ];
  const ctx = typeof contextPrev === 'string' ? contextPrev.trim().slice(-400) : '';
  if (ctx) {
    lines.push(`Prior paragraph context for terminology consistency only (do not repeat or translate this context): ${ctx}`);
  }
  return lines.join('\n');
}

export function createThinkingTranslator({
  dataDir,
  home = homedir(),
  env = process.env,
  fetcher,
  ttlMs = DEFAULT_CACHE_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
  now = () => Date.now()
} = {}) {
  const resolvedDir = dataDir === null
    ? ''
    : (dataDir || join(home, '.gemini', 'antigravity', 'plugin_data', 'agy-max'));
  const cachePath = resolvedDir ? join(resolvedDir, 'thinking-translate-cache.json') : '';
  const memoryCache = new Map();
  let preferredTransport = { name: '', expiresAt: 0 };

  function isExpired(entry) {
    if (!entry || typeof entry.value !== 'string' || !Number.isFinite(entry.updatedAt)) return true;
    const age = now() - entry.updatedAt;
    return age >= ttlMs || age < 0;
  }

  function enforceMaxEntries() {
    while (memoryCache.size > maxEntries) {
      const oldestKey = memoryCache.keys().next().value;
      if (oldestKey === undefined) break;
      memoryCache.delete(oldestKey);
    }
  }

  function persistCache() {
    if (!cachePath) return;
    const entries = [];
    for (const [key, entry] of memoryCache.entries()) {
      if (!isExpired(entry)) {
        entries.push([key, entry]);
      }
    }
    try {
      atomicWriteCacheFile(cachePath, { version: 1, entries });
    } catch {}
  }

  function loadCacheFromDisk() {
    if (!cachePath || !existsSync(cachePath)) return;
    try {
      const raw = readFileSync(cachePath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
      for (const item of list) {
        if (!Array.isArray(item) || item.length !== 2) continue;
        const [key, entry] = item;
        if (typeof key !== 'string' || !key) continue;
        if (isExpired(entry)) continue;
        memoryCache.set(key, {
          value: entry.value,
          updatedAt: entry.updatedAt
        });
      }
      enforceMaxEntries();
    } catch {
      memoryCache.clear();
    }
  }

  loadCacheFromDisk();

  function makeCacheKey(engine, model, targetLangCode, text) {
    return createHash('sha256')
      .update(JSON.stringify([engine, model || '', targetLangCode, text]))
      .digest('hex');
  }

  function getCached(key) {
    const entry = memoryCache.get(key);
    if (!entry) return null;
    if (isExpired(entry)) {
      memoryCache.delete(key);
      persistCache();
      return null;
    }
    memoryCache.delete(key);
    memoryCache.set(key, entry);
    return entry.value;
  }

  function setCached(key, value) {
    memoryCache.delete(key);
    memoryCache.set(key, { value, updatedAt: now() });
    enforceMaxEntries();
    persistCache();
  }

  function purgeCache() {
    memoryCache.clear();
    preferredTransport = { name: '', expiresAt: 0 };
    if (cachePath) {
      try {
        unlinkSync(cachePath);
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
    }
    return { ok: true, cleared: true };
  }

  function getCandidateTransports() {
    if (preferredTransport.name && now() < preferredTransport.expiresAt && FREE_TRANSPORTS.includes(preferredTransport.name)) {
      return [
        preferredTransport.name,
        ...FREE_TRANSPORTS.filter(name => name !== preferredTransport.name)
      ];
    }
    return [...FREE_TRANSPORTS];
  }

  async function runFreeTransport(transportName, maskedText, targetLang, signal) {
    const opts = { fetcher, home, env, dataDir: resolvedDir || undefined, signal };
    if (transportName === 'google-html') return await translateGoogleHtml(maskedText, targetLang, opts);
    if (transportName === 'google-gtx') return await translateGoogleGtx(maskedText, targetLang, opts);
    return await translateMicrosoftEdge(maskedText, targetLang, opts);
  }

  async function translateFreeSegment(segmentText, targetLangCode, signal) {
    if (shouldSkipTranslation(segmentText, targetLangCode)) {
      return { text: segmentText, transport: 'skipped', tokenAudit: { ok: true, missing: [] } };
    }

    const { masked, tokens } = maskTechnicalMarkdown(segmentText);
    const candidates = getCandidateTransports();
    let lastError = null;
    let bestFallback = null;

    for (const name of candidates) {
      if (signal?.aborted) throw createAbortError(signal.reason);
      try {
        const translatedMasked = await runFreeTransport(name, masked, targetLangCode, signal);
        const unmasked = unmaskTechnicalMarkdown(translatedMasked, tokens);
        if (unmasked.ok) {
          preferredTransport = { name, expiresAt: now() + TRANSPORT_STICKY_MS };
          return { text: unmasked.text, transport: name, tokenAudit: unmasked };
        }
        if (!bestFallback) {
          bestFallback = { text: segmentText, transport: name, tokenAudit: unmasked };
        }
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) {
          throw createAbortError(signal?.reason || err);
        }
        lastError = err;
        if (preferredTransport.name === name) {
          preferredTransport = { name: '', expiresAt: 0 };
        }
      }
    }

    if (bestFallback) {
      return bestFallback;
    }
    throw lastError || new Error('All free translation transports failed');
  }

  async function translate({
    text,
    targetLang = 'zh-CN',
    engine = 'free',
    aiConfig = null,
    contextPrev = '',
    signal,
    onDelta
  } = {}) {
    const source = String(text ?? '');
    const selectedEngine = TRANSLATE_ENGINES.includes(engine) ? engine : 'free';
    const targetInfo = mapTargetLang(targetLang);

    if (shouldSkipTranslation(source, targetInfo.lang)) {
      return {
        ok: true,
        text: source,
        engine: selectedEngine,
        targetLang: targetInfo.lang,
        cached: false,
        skipped: true
      };
    }

    const modelKey = selectedEngine === 'ai' ? String(aiConfig?.model || '').trim() : '';
    const cacheKey = makeCacheKey(selectedEngine, modelKey, targetInfo.lang, source);
    const cached = getCached(cacheKey);
    if (cached !== null) {
      if (typeof onDelta === 'function') onDelta(cached, cached);
      return {
        ok: true,
        text: cached,
        engine: selectedEngine,
        targetLang: targetInfo.lang,
        cached: true,
        skipped: false
      };
    }

    if (signal?.aborted) {
      throw createAbortError(signal.reason);
    }

    if (selectedEngine === 'ai') {
      if (!aiConfig || typeof aiConfig !== 'object') {
        throw new Error('AI translation requires aiConfig');
      }
      const system = buildAiTranslateSystemPrompt(targetInfo, contextPrev);
      const translated = await streamText({
        provider: aiConfig.provider,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
        apiKey: aiConfig.apiKey,
        system,
        prompt: source,
        maxTokens: aiConfig.maxTokens || 2048,
        temperature: typeof aiConfig.temperature === 'number' ? aiConfig.temperature : 0.15,
        fetcher: aiConfig.fetcher || fetcher,
        home,
        env,
        dataDir: resolvedDir || undefined,
        signal,
        onDelta
      });
      setCached(cacheKey, translated);
      return {
        ok: true,
        text: translated,
        engine: 'ai',
        model: modelKey,
        targetLang: targetInfo.lang,
        cached: false,
        skipped: false
      };
    }

    const { masked: fenceSafeSource, tokens: outerTokens } = maskTechnicalMarkdown(source);
    const segments = splitTextIntoSegments(fenceSafeSource, maxChunkChars);
    let accumulated = '';
    let winningTransport = '';
    let allTokensIntact = true;

    for (const seg of segments) {
      if (signal?.aborted) throw createAbortError(signal.reason);
      const segmentOriginal = unmaskTechnicalMarkdown(seg.text, outerTokens).text;
      let pieceText = '';
      if (segmentOriginal) {
        const res = await translateFreeSegment(segmentOriginal, targetInfo.lang, signal);
        pieceText = res.text;
        if (res.transport && res.transport !== 'skipped') winningTransport = res.transport;
        if (res.tokenAudit && !res.tokenAudit.ok) allTokensIntact = false;
      }
      const chunkWithSep = `${pieceText}${seg.separator}`;
      accumulated += chunkWithSep;
      if (chunkWithSep && typeof onDelta === 'function') {
        onDelta(chunkWithSep, accumulated);
      }
    }

    if (allTokensIntact) {
      setCached(cacheKey, accumulated);
    }
    return {
      ok: true,
      text: accumulated,
      engine: 'free',
      transport: winningTransport || preferredTransport.name || 'google-html',
      targetLang: targetInfo.lang,
      cached: false,
      skipped: false,
      tokensIntact: allTokensIntact
    };
  }

  return {
    cachePath,
    translate,
    clearCache: purgeCache,
    purgeCache,
    cacheSize() {
      return memoryCache.size;
    },
    getPreferredTransport() {
      return preferredTransport.name && now() < preferredTransport.expiresAt ? preferredTransport.name : '';
    }
  };
}
