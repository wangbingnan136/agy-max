import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { databaseStamp, readDatabase } from './database.mjs';

// A decode window shorter than this, or faster than this, is a buffered reply's tail, not real streaming.
const MIN_STREAM_MS = 500;
const MAX_DECODE_TPS = 500;

export function requestEvents(database, conversationId) {
  const generations = (database?.generations || []).filter(g => g.modelName || g.error || g.outputTokens);
  const knownExecutionEnum = generations.find(g => g.executionModelEnum)?.executionModelEnum || null;
  return generations.map(g => {
    const times = g.stepIndices.map(index => database.times.get(index)).filter(Boolean);
    const created = times.map(t => t.createdMs).filter(Number.isFinite);
    const timestampMs = created.length ? Math.min(...created) : null;
    const role = g.role || (knownExecutionEnum && g.modelEnum ? (g.modelEnum === knownExecutionEnum ? 'execution' : 'planner') : '');
    const durationMs = g.ttftMs != null && g.streamingMs != null ? g.ttftMs + g.streamingMs : null;
    // Use pure streaming decode window when plausible; buffered (non-streamed) replies only report a short tail,
    // which would inflate tok/s and peak speed, so they fall back to whole-request duration.
    const streamDecode = g.outputTokens > 0 && g.streamingMs != null && g.streamingMs >= MIN_STREAM_MS && (g.outputTokens * 1000 / g.streamingMs) <= MAX_DECODE_TPS;
    const effectiveGenMs = streamDecode ? g.streamingMs : durationMs;
    return { id: g.requestId || `${g.executionId}:${g.index}:${timestampMs}:${g.modelName}`, conversationId, timestampMs,
      model: g.modelName, role, inputTokens: g.inputTokens, cacheReadTokens: g.cacheReadTokens, outputTokens: g.outputTokens,
      cacheHitPercent: g.inputTokens + g.cacheReadTokens > 0 ? Number((g.cacheReadTokens / (g.inputTokens + g.cacheReadTokens) * 100).toFixed(1)) : null,
      thinkingTokens: g.thinkingTokens, responseTokens: g.responseTokens, ttftMs: g.ttftMs, streamingMs: g.streamingMs,
      durationMs, effectiveGenMs,
      tps: effectiveGenMs != null && effectiveGenMs > 0 ? Number((g.outputTokens * 1000 / effectiveGenMs).toFixed(1)) : null,
      e2eTps: durationMs != null && durationMs > 0 ? Number((g.outputTokens * 1000 / durationMs).toFixed(1)) : null,
      error: g.error || '', status: g.error ? 'error' : g.outputTokens > 0 ? 'success' : 'recorded', retries: g.retries, retryErrors:g.retryErrors||[] };
  });
}

let cache;
const fileEventsCacheByDir = new Map();
const lastGoodByDir = new Map();

export function usageDashboard(appDataDir, { force = false } = {}) {
  if (!force && cache?.dir === appDataDir && Date.now() - cache.at < 30000) return cache.value;
  const convDir = join(appDataDir, 'conversations');
  let files = [];
  // A transient readdir failure must not report a zeroed dashboard; reuse the last good scan.
  try { files = readdirSync(convDir).filter(name => /^[\w-]+\.db$/.test(name)); } catch (error) {
    // ENOENT means genuinely no conversations; anything else (EBUSY/EACCES/EIO) is transient.
    const lastGood = lastGoodByDir.get(appDataDir);
    if (error?.code !== 'ENOENT' && lastGood) return lastGood;
  }
  let dirCache = fileEventsCacheByDir.get(appDataDir);
  if (!dirCache) {
    dirCache = new Map();
    fileEventsCacheByDir.set(appDataDir, dirCache);
  }
  const seenPaths = new Set();
  const unique = new Map();
  for (const file of files) {
    const id = file.slice(0, -3);
    const dbPath = join(convDir, file);
    seenPaths.add(dbPath);
    const stamp = databaseStamp(dbPath);
    let cachedEntry = dirCache.get(dbPath);
    let events;
    if (cachedEntry && cachedEntry.stamp === stamp) {
      events = cachedEntry.events;
    } else {
      const db = readDatabase(appDataDir, id);
      // A locked or half-written .db reads as null; keep its last good events rather than
      // letting this scan dip (upstream research 2026-11-27, item 4: no zero/rollback scans).
      if (db === null && cachedEntry) events = cachedEntry.events;
      else {
        events = requestEvents(db, id);
        if (db !== null) dirCache.set(dbPath, { stamp, events });
      }
    }
    for (const event of events) if (!unique.has(event.id)) unique.set(event.id, event);
  }
  for (const cachedPath of dirCache.keys()) {
    if (!seenPaths.has(cachedPath)) dirCache.delete(cachedPath);
  }
  if (dirCache.size === 0) fileEventsCacheByDir.delete(appDataDir);
  const requests = [...unique.values()].sort((a,b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  const days = new Map();
  for (const r of requests) {
    if (!r.timestampMs) continue;
    const date = new Date(r.timestampMs);
    const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    if (!days.has(key)) days.set(key, { date: key, requests: 0, tokens: 0 });
    const day = days.get(key); day.requests++; day.tokens += r.inputTokens + r.cacheReadTokens + r.outputTokens;
  }
  const errors=requests.flatMap(r=>[...(r.error?[r]:[]),...r.retryErrors.filter(error=>error&&String(error).trim()&&error!==r.error).map((error,index)=>({...r,id:`${r.id}:retry:${index}`,status:'error',error}))]);
  const value = { requests, totalRequests: requests.length, errors, totalErrors:errors.length, days:[...days.values()], updatedAtMs:Date.now() };
  cache = { dir: appDataDir, at: Date.now(), value };
  lastGoodByDir.set(appDataDir, value);
  return value;
}
