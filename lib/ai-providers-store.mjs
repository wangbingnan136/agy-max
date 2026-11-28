import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AI_PROTOCOLS, DEFAULT_BASE_URLS, validateAiEndpoint } from './ai-provider.mjs';

const CONTROL_RE = /[\x00-\x1f\x7f]/;
const PROVIDER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_PROVIDERS = 50;
const MAX_MODELS = 500;
const MAX_NAME_LENGTH = 80;
const MAX_API_KEY_LENGTH = 512;
const MAX_MODEL_LENGTH = 160;

const secretScopeFor = id => `ai-provider:${id}`;

export function parseModelRef(ref) {
  const trimmed = typeof ref === 'string' ? ref.trim() : '';
  if (!trimmed) return { providerId: '', model: '' };
  const sep = trimmed.indexOf('::');
  if (sep === -1) return { providerId: '', model: trimmed };
  return {
    providerId: trimmed.slice(0, sep).trim(),
    model: trimmed.slice(sep + 2).trim()
  };
}

export function formatModelRef(providerId, model) {
  const p = typeof providerId === 'string' ? providerId.trim() : '';
  const m = typeof model === 'string' ? model.trim() : '';
  if (!p || !m) return '';
  return `${p}::${m}`;
}

function normalizeModelsList(raw) {
  if (raw === undefined || raw === null) return { ok: true, models: [] };
  let items;
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    items = raw.split(/[\r\n,]+/);
  } else {
    return { ok: false, code: 'invalid-models', error: 'Models must be an array or string' };
  }

  const seen = new Set();
  const models = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const clean = item.trim();
    if (!clean || clean.length > MAX_MODEL_LENGTH || CONTROL_RE.test(clean)) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    models.push(clean);
    if (models.length >= MAX_MODELS) break;
  }
  return { ok: true, models };
}

function cloneProvider(entry) {
  return {
    id: entry.id,
    name: entry.name,
    protocol: entry.protocol,
    baseUrl: entry.baseUrl,
    apiKey: entry.apiKey,
    models: [...entry.models],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

function sanitizeStoredProvider(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || !PROVIDER_ID_RE.test(id)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > MAX_NAME_LENGTH || CONTROL_RE.test(name)) return null;
  const protocol = typeof raw.protocol === 'string' ? raw.protocol.trim().toLowerCase() : '';
  if (!AI_PROTOCOLS.includes(protocol)) return null;
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  if (apiKey.length > MAX_API_KEY_LENGTH || CONTROL_RE.test(apiKey)) return null;
  const endpoint = validateAiEndpoint({
    protocol,
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : DEFAULT_BASE_URLS[protocol],
    apiKey,
    requireKeyForRemote: false
  });
  if (!endpoint.ok) return null;
  const normalizedModels = normalizeModelsList(raw.models);
  const models = normalizedModels.ok ? normalizedModels.models : [];
  const createdAt = Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : 0;
  const updatedAt = Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : createdAt;
  return {
    id,
    name,
    protocol,
    baseUrl: endpoint.baseUrl,
    apiKey,
    keyInVault: Boolean(raw.keyInVault),
    models,
    createdAt,
    updatedAt
  };
}

export function createAiProvidersStore(
  dataDir = join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-max'),
  { vault = null } = {}
) {
  const filePath = join(dataDir, 'ai-providers.json');

  function readRawDisk() {
    if (!existsSync(filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      const rawList = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.providers) ? parsed.providers : []);
      const seen = new Set();
      const providers = [];
      for (const item of rawList) {
        const clean = sanitizeStoredProvider(item);
        if (!clean || seen.has(clean.id)) continue;
        seen.add(clean.id);
        providers.push(clean);
        if (providers.length >= MAX_PROVIDERS) break;
      }
      return providers;
    } catch {
      return [];
    }
  }

  function hydrateSecret(entry) {
    if (!entry.keyInVault || entry.apiKey || !vault || typeof vault.readSecret !== 'function') {
      return entry;
    }
    try {
      const res = vault.readSecret(secretScopeFor(entry.id));
      if (res?.ok && res.exists && typeof res.value === 'string' && !CONTROL_RE.test(res.value)) {
        return { ...entry, apiKey: res.value.trim().slice(0, MAX_API_KEY_LENGTH) };
      }
    } catch {}
    return entry;
  }

  function readAll() {
    return readRawDisk().map(hydrateSecret);
  }

  function writeAll(providers) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const tmpPath = `${filePath}.tmp`;
    const diskRecords = providers.map(entry => ({
      id: entry.id,
      name: entry.name,
      protocol: entry.protocol,
      baseUrl: entry.baseUrl,
      apiKey: entry.keyInVault ? '' : entry.apiKey,
      ...(entry.keyInVault ? { keyInVault: true } : {}),
      models: [...entry.models],
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    }));
    const serialized = JSON.stringify({ version: 1, providers: diskRecords }, null, 2) + '\n';
    writeFileSync(tmpPath, serialized, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') {
      try { chmodSync(tmpPath, 0o600); } catch {}
    }
    renameSync(tmpPath, filePath);
    if (process.platform !== 'win32') {
      try { chmodSync(filePath, 0o600); } catch {}
    }
  }

  function list() {
    return readAll().map(cloneProvider);
  }

  function get(id) {
    const cleanId = typeof id === 'string' ? id.trim() : '';
    if (!cleanId) return null;
    const found = readRawDisk().find(p => p.id === cleanId);
    return found ? cloneProvider(hydrateSecret(found)) : null;
  }

  function upsert(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, code: 'invalid-input', error: 'Provider payload must be an object' };
    }

    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH || CONTROL_RE.test(name)) {
      return { ok: false, code: 'invalid-name', error: 'Provider name must be 1 to 80 printable characters' };
    }

    const rawProtocol = (input.protocol !== undefined && input.protocol !== null && input.protocol !== '')
      ? input.protocol
      : input.provider;
    const protocol = typeof rawProtocol === 'string' ? rawProtocol.trim().toLowerCase() : '';
    if (!AI_PROTOCOLS.includes(protocol)) {
      return { ok: false, code: 'invalid-protocol', error: `Unsupported AI protocol: ${String(rawProtocol || '')}` };
    }

    const rawId = typeof input.id === 'string' ? input.id.trim() : '';
    if (rawId && !PROVIDER_ID_RE.test(rawId)) {
      return { ok: false, code: 'invalid-id', error: 'Provider ID contains invalid characters' };
    }

    const providers = readAll();
    const existingIdx = rawId ? providers.findIndex(p => p.id === rawId) : -1;
    const existing = existingIdx >= 0 ? providers[existingIdx] : null;

    if (!existing && providers.length >= MAX_PROVIDERS) {
      return { ok: false, code: 'max-providers', error: `Maximum of ${MAX_PROVIDERS} providers reached` };
    }

    let apiKey;
    if (input.apiKey === undefined) {
      apiKey = existing ? existing.apiKey : '';
    } else if (input.apiKey === null) {
      apiKey = '';
    } else if (typeof input.apiKey === 'string') {
      apiKey = input.apiKey.trim();
    } else {
      return { ok: false, code: 'invalid-api-key', error: 'API key must be a string' };
    }

    if (apiKey.length > MAX_API_KEY_LENGTH || CONTROL_RE.test(apiKey)) {
      return { ok: false, code: 'invalid-api-key', error: 'API key is invalid or exceeds 512 characters' };
    }

    const rawBaseUrl = input.baseUrl === undefined
      ? (existing ? existing.baseUrl : DEFAULT_BASE_URLS[protocol])
      : input.baseUrl;
    const endpoint = validateAiEndpoint({
      protocol,
      baseUrl: rawBaseUrl,
      apiKey,
      requireKeyForRemote: false
    });
    if (!endpoint.ok) {
      return { ok: false, code: endpoint.code, error: endpoint.error };
    }

    let models;
    if (input.models === undefined && existing) {
      models = [...existing.models];
    } else {
      const normalizedModels = normalizeModelsList(input.models);
      if (!normalizedModels.ok) {
        return { ok: false, code: normalizedModels.code, error: normalizedModels.error };
      }
      models = normalizedModels.models;
    }

    const now = Date.now();
    let id = rawId;
    if (!id) {
      const existingIds = new Set(providers.map(p => p.id));
      do {
        id = `prov_${randomBytes(6).toString('hex')}`;
      } while (existingIds.has(id));
    }

    let keyInVault = false;
    if (vault && typeof vault.writeSecret === 'function') {
      if (apiKey) {
        try {
          const savedSecret = vault.writeSecret(secretScopeFor(id), apiKey, { userName: 'agy-max' });
          if (savedSecret?.ok) keyInVault = true;
        } catch {}
      } else if (existing?.keyInVault && typeof vault.deleteSecret === 'function') {
        try { vault.deleteSecret(secretScopeFor(id)); } catch {}
      }
    }

    const record = {
      id,
      name,
      protocol,
      baseUrl: endpoint.baseUrl,
      apiKey,
      keyInVault,
      models,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    if (existingIdx >= 0) {
      providers[existingIdx] = record;
    } else {
      providers.push(record);
    }

    writeAll(providers);
    return {
      ok: true,
      provider: cloneProvider(record),
      providers: providers.map(cloneProvider)
    };
  }

  function remove(id) {
    const cleanId = typeof id === 'string' ? id.trim() : '';
    const disk = readRawDisk();
    const removedEntry = cleanId ? disk.find(p => p.id === cleanId) : null;
    const nextDisk = cleanId ? disk.filter(p => p.id !== cleanId) : disk;
    const removed = nextDisk.length !== disk.length;
    if (removed) {
      if (removedEntry?.keyInVault && vault && typeof vault.deleteSecret === 'function') {
        try { vault.deleteSecret(secretScopeFor(cleanId)); } catch {}
      }
      writeAll(nextDisk);
    }
    return {
      ok: true,
      removed,
      providers: nextDisk.map(hydrateSecret).map(cloneProvider)
    };
  }

  function purgeAll() {
    const disk = readRawDisk();
    if (vault && typeof vault.deleteSecret === 'function') {
      for (const entry of disk) {
        if (entry.keyInVault) {
          try { vault.deleteSecret(secretScopeFor(entry.id)); } catch {}
        }
      }
    }
    try { unlinkSync(filePath); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
    return { ok: true };
  }

  function resolveModel(ref) {
    const { providerId, model } = parseModelRef(ref);
    if (!model) {
      return { ok: false, code: 'model-required', error: 'Model name is required' };
    }
    if (!providerId) {
      return { ok: false, code: 'provider-required', error: 'Model reference must include a provider ID' };
    }
    const found = get(providerId);
    if (!found) {
      return { ok: false, code: 'provider-not-found', error: `AI provider not found: ${providerId}` };
    }
    return {
      ok: true,
      provider: found,
      protocol: found.protocol,
      baseUrl: found.baseUrl,
      apiKey: found.apiKey,
      model
    };
  }

  return {
    list,
    get,
    upsert,
    remove,
    purgeAll,
    resolveModel
  };
}
