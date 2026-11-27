import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let DatabaseSync;
try {
  ({ DatabaseSync } = process.getBuiltinModule?.('node:sqlite')
    || (typeof import.meta?.url === 'string' && import.meta.url.startsWith('file:')
      ? createRequire(import.meta.url)('node:sqlite')
      : {}));
} catch { /* Optional SQLite sync fallback. */ }

const VALID_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export const OUTSIDE_OF_PROJECT = 'outside-of-project';

export function normalizeProjectId(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value === 'standalone' || value === OUTSIDE_OF_PROJECT) return OUTSIDE_OF_PROJECT;
  if (!VALID_ID_RE.test(value)) throw new Error('目标项目 ID 无效');
  return value;
}

function encodeVarint(num) {
  const bytes = [];
  let v = num >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

// Field 18 on CortexTrajectoryMetadata is project_id (string, wire type 2).
// Strict: throws on truncated varints, overrunning fields, or unknown wire types, so a malformed blob is never rewritten.
function readVarintAt(src, pos) {
  let value = 0;
  for (let shift = 0; shift < 63; shift += 7) {
    if (pos >= src.length) throw new Error('protobuf: truncated varint');
    const b = src[pos++];
    value += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return { value, pos };
  }
  throw new Error('protobuf: varint too long');
}

export function patchProtoStringField(buffer, fieldNumber, nextValue) {
  const src = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const chunks = [];
  let i = 0;
  while (i < src.length) {
    const start = i;
    const tag = readVarintAt(src, i);
    i = tag.pos;
    const fn = Math.floor(tag.value / 8);
    const wt = tag.value % 8;
    if (fn === 0) throw new Error('protobuf: invalid field number 0');
    if (wt === 0) i = readVarintAt(src, i).pos;
    else if (wt === 1) i += 8;
    else if (wt === 5) i += 4;
    else if (wt === 2) {
      const len = readVarintAt(src, i);
      i = len.pos + len.value;
    } else throw new Error(`protobuf: unsupported wire type ${wt}`);
    if (i > src.length) throw new Error('protobuf: field overruns buffer');
    if (fn !== fieldNumber) chunks.push(src.subarray(start, i));
  }
  if (typeof nextValue === 'string' && nextValue.length > 0) {
    const encoded = Buffer.from(nextValue, 'utf8');
    chunks.push(encodeVarint((fieldNumber << 3) | 2), encodeVarint(encoded.length), encoded);
  }
  return Buffer.concat(chunks);
}

// Unescapes Go/C++ protobuf text-format strings (both raw UTF-8 and \ooo octal byte runs).
export function unescapePbtxtString(raw) {
  if (typeof raw !== 'string' || !raw.includes('\\')) return raw || '';
  const bytes = [];
  let out = '';
  const flushBytes = () => {
    if (bytes.length) {
      out += Buffer.from(bytes).toString('utf8');
      bytes.length = 0;
    }
  };
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\' || i + 1 >= raw.length) {
      flushBytes();
      out += raw[i];
      continue;
    }
    const next = raw[i + 1];
    if (next >= '0' && next <= '7') {
      let oct = next;
      let step = 1;
      while (step < 3 && i + 1 + step < raw.length && raw[i + 1 + step] >= '0' && raw[i + 1 + step] <= '7') {
        oct += raw[i + 1 + step];
        step++;
      }
      bytes.push(parseInt(oct, 8) & 0xff);
      i += step;
      continue;
    }
    if (next === 'x' && i + 3 < raw.length && /^[0-9a-fA-F]{2}$/.test(raw.slice(i + 2, i + 4))) {
      bytes.push(parseInt(raw.slice(i + 2, i + 4), 16));
      i += 3;
      continue;
    }
    flushBytes();
    i++;
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else out += next;
  }
  flushBytes();
  return out;
}

export function parseAnnotationPbtxt(text) {
  const src = String(text || '');
  let title = '';
  const topTitleMatch = src.match(/(?:^|\s)title:\s*"((?:\\.|[^"\\])*)"/);
  if (topTitleMatch) title = unescapePbtxtString(topTitleMatch[1]).trim();

  const sideQuestionIds = [];
  for (const m of src.matchAll(/side_question_cascade_ids:\s*"((?:\\.|[^"\\])*)"/g)) {
    const id = unescapePbtxtString(m[1]).trim();
    if (VALID_ID_RE.test(id) && !sideQuestionIds.includes(id)) sideQuestionIds.push(id);
  }

  const sideQuestionTitles = {};
  for (const m of src.matchAll(/side_question_titles:\s*\{\s*key:\s*"((?:\\.|[^"\\])*)"\s+value:\s*"((?:\\.|[^"\\])*)"\s*\}/g)) {
    const id = unescapePbtxtString(m[1]).trim();
    const val = unescapePbtxtString(m[2]).replace(/\s+/g, ' ').trim();
    if (VALID_ID_RE.test(id) && val) sideQuestionTitles[id] = val;
  }

  return { title, sideQuestionIds, sideQuestionTitles };
}

function readSideQuestionDbStats(appDir, sqId, proto) {
  if (!DatabaseSync || !appDir || !VALID_ID_RE.test(sqId)) return null;
  const dbPath = join(appDir, 'conversations', `${sqId}.db`);
  if (!existsSync(dbPath)) return null;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=800;');
    const cols = db.prepare('PRAGMA table_info(steps)').all().map(c => c.name);
    if (!cols.includes('idx') || !cols.includes('metadata')) return null;
    const hasPayload = cols.includes('step_payload');
    const hasType = cols.includes('step_type');
    const rows = db.prepare(
      `SELECT idx, metadata${hasType ? ', step_type' : ''}${hasPayload ? ', step_payload' : ''} FROM steps ORDER BY idx`
    ).all();
    let createdAtSec = 0;
    let updatedAtSec = 0;
    let lastUserPrompt = '';
    if (proto) {
      const { fields, first, milliseconds, nested, string } = proto;
      for (const row of rows) {
        if (row.metadata) {
          try {
            const f = fields(row.metadata);
            const cMs = milliseconds(first(f, 1)) || 0;
            const fMs = milliseconds(first(f, 7)) || milliseconds(first(f, 8)) || milliseconds(first(f, 6)) || cMs;
            if (cMs > 0 && (!createdAtSec || cMs / 1000 < createdAtSec)) createdAtSec = Math.floor(cMs / 1000);
            if (fMs > 0 && fMs / 1000 > updatedAtSec) updatedAtSec = Math.floor(fMs / 1000);
          } catch {}
        }
        // Fallback prompt snippet if backend AI title has not written side_question_titles yet
        if (hasPayload && row.step_payload && (!hasType || row.step_type === 14 || row.step_type === 1)) {
          try {
            const p = fields(row.step_payload);
            const userStep = p.has(14) ? nested(p, 14) : p;
            for (const itemBytes of userStep.get(1) || []) {
              const item = fields(itemBytes);
              const txt = string(item, 1).replace(/^\/btw\b\s*/i, '').replace(/\s+/g, ' ').trim();
              if (txt) lastUserPrompt = txt.slice(0, 64);
            }
          } catch {}
        }
      }
    }
    return {
      stepCount: rows.length || 1,
      createdAtSec,
      updatedAtSec: updatedAtSec || createdAtSec,
      fallbackPrompt: lastUserPrompt
    };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}

export function readBtwMetadata(appDir, detachedIds = [], proto = null) {
  const btwMeta = {};
  if (!appDir) return btwMeta;
  const annDir = join(appDir, 'annotations');
  if (!existsSync(annDir)) return btwMeta;
  const detached = new Set(Array.isArray(detachedIds) ? detachedIds : []);
  const parsedById = new Map();

  let files = [];
  try { files = readdirSync(annDir); } catch { return btwMeta; }
  for (const file of files) {
    if (!file.endsWith('.pbtxt')) continue;
    const cid = file.slice(0, -6);
    if (!VALID_ID_RE.test(cid)) continue;
    try {
      const text = readFileSync(join(annDir, file), 'utf8');
      if (!text.includes('side_question_') && !text.includes('title:')) continue;
      parsedById.set(cid, parseAnnotationPbtxt(text));
    } catch {}
  }

  for (const [parentId, parsed] of parsedById.entries()) {
    if (!parsed.sideQuestionIds.length) continue;
    for (const sqId of parsed.sideQuestionIds) {
      if (detached.has(sqId)) continue;
      const ownAnn = parsedById.get(sqId);
      const dbStats = readSideQuestionDbStats(appDir, sqId, proto);
      // Only include side questions whose trajectory still exists on disk or has a recorded title
      if (!dbStats && !ownAnn && !parsed.sideQuestionTitles[sqId]) continue;
      const hasBackendSummary = Boolean(ownAnn?.title || parsed.sideQuestionTitles[sqId]);
      const title = ownAnn?.title || parsed.sideQuestionTitles[sqId] || dbStats?.fallbackPrompt || '';
      btwMeta[sqId] = {
        parentId,
        title,
        hasBackendSummary,
        stepCount: dbStats?.stepCount || 1,
        createdAtSec: dbStats?.createdAtSec || 0,
        updatedAtSec: dbStats?.updatedAtSec || 0
      };
    }
  }
  return btwMeta;
}

export function persistLocalSqliteProjectMove(appDir, conversationId, projectId) {
  if (!DatabaseSync || !appDir || !VALID_ID_RE.test(conversationId)) return false;
  let touched = false;
  const convDbPath = join(appDir, 'conversations', `${conversationId}.db`);
  if (existsSync(convDbPath)) {
    let db;
    try {
      db = new DatabaseSync(convDbPath);
      db.exec('PRAGMA busy_timeout=1000;');
      const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='trajectory_metadata_blob'").get();
      if (hasMeta) {
        const row = db.prepare('SELECT id, data FROM trajectory_metadata_blob LIMIT 1').get();
        if (row?.data) {
          const nextData = patchProtoStringField(row.data, 18, projectId);
          db.prepare('UPDATE trajectory_metadata_blob SET data = ? WHERE id = ?').run(nextData, row.id);
          touched = true;
        }
      }
    } catch { /* Best-effort sync; JSON override store remains authoritative. */ }
    finally { try { db?.close(); } catch {} }
  }

  const sumDbPath = join(appDir, 'conversation_summaries.db');
  if (existsSync(sumDbPath)) {
    let sdb;
    try {
      sdb = new DatabaseSync(sumDbPath);
      sdb.exec('PRAGMA busy_timeout=1000;');
      const hasTable = sdb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_summaries'").get();
      if (hasTable) {
        sdb.prepare('UPDATE conversation_summaries SET project_id = ? WHERE conversation_id = ?').run(projectId, conversationId);
        touched = true;
      }
    } catch { /* Ignore lock contention. */ }
    finally { try { sdb?.close(); } catch {} }
  }
  return touched;
}

function sanitizeState(raw) {
  const projectOverrides = {};
  if (raw?.projectOverrides && typeof raw.projectOverrides === 'object' && !Array.isArray(raw.projectOverrides)) {
    for (const [cid, pid] of Object.entries(raw.projectOverrides)) {
      if (!VALID_ID_RE.test(cid) || typeof pid !== 'string') continue;
      try { projectOverrides[cid] = normalizeProjectId(pid); } catch {}
    }
  }
  const cleanIdList = list => [...new Set((Array.isArray(list) ? list : []).filter(id => typeof id === 'string' && VALID_ID_RE.test(id)))];
  return {
    projectOverrides,
    foldedAsides: cleanIdList(raw?.foldedAsides),
    detachedAsides: cleanIdList(raw?.detachedAsides)
  };
}

export function createChatTreeStore(dataDir, { appDir = '', proto = null } = {}) {
  const filePath = join(dataDir, 'chat-flow-tree.json');
  let cached = null;

  // Writers call readState() and may throw; readers use readStateSafe(), which never caches a failed read.
  function readState() {
    if (cached) return cached;
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      cached = sanitizeState({});
      return cached;
    }
    try {
      cached = sanitizeState(JSON.parse(raw));
    } catch {
      try { renameSync(filePath, `${filePath}.corrupt-${Date.now()}`); } catch {}
      cached = sanitizeState({});
    }
    return cached;
  }

  function readStateSafe() {
    try { return readState(); } catch { return sanitizeState({}); }
  }

  function writeState(next) {
    cached = sanitizeState(next);
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(cached, null, 2) + '\n', { mode: 0o600 });
      renameSync(tmp, filePath);
    } catch (err) {
      try { unlinkSync(tmp); } catch {}
      throw err;
    }
    return cached;
  }

  return {
    get() {
      const state = readStateSafe();
      return {
        projectOverrides: { ...state.projectOverrides },
        foldedAsides: [...state.foldedAsides],
        detachedAsides: [...state.detachedAsides],
        btwMeta: readBtwMetadata(appDir, state.detachedAsides, proto)
      };
    },
    projectOverride(conversationId) {
      const overrides = readStateSafe().projectOverrides;
      return Object.hasOwn(overrides, conversationId) ? overrides[conversationId] : '';
    },
    btwMeta() {
      const state = readStateSafe();
      return { btwMeta: readBtwMetadata(appDir, state.detachedAsides, proto) };
    },
    moveProject(conversationId, rawProjectId) {
      const cid = String(conversationId || '').trim();
      if (!VALID_ID_RE.test(cid)) throw new Error('会话 ID 无效');
      const projectId = normalizeProjectId(rawProjectId);
      const cur = readState();
      const next = writeState({
        ...cur,
        projectOverrides: { ...cur.projectOverrides, [cid]: projectId }
      });
      persistLocalSqliteProjectMove(appDir, cid, projectId);
      return {
        ok: true,
        conversationId: cid,
        projectId,
        projectOverrides: { ...next.projectOverrides }
      };
    },
    setFolded(parentConversationId, folded) {
      const pid = String(parentConversationId || '').trim();
      if (!VALID_ID_RE.test(pid)) throw new Error('主会话 ID 无效');
      const cur = readState();
      const set = new Set(cur.foldedAsides);
      const shouldFold = typeof folded === 'boolean' ? folded : !set.has(pid);
      if (shouldFold) set.add(pid);
      else set.delete(pid);
      const next = writeState({ ...cur, foldedAsides: [...set] });
      return { ok: true, parentConversationId: pid, folded: shouldFold, foldedAsides: [...next.foldedAsides] };
    },
    detachAside(conversationId) {
      const cid = String(conversationId || '').trim();
      if (!VALID_ID_RE.test(cid)) throw new Error('侧边会话 ID 无效');
      const cur = readState();
      const set = new Set(cur.detachedAsides);
      set.add(cid);
      const next = writeState({ ...cur, detachedAsides: [...set] });
      return { ok: true, conversationId: cid, detachedAsides: [...next.detachedAsides] };
    }
  };
}
