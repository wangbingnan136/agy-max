export function createHookBus() {
  const pipelines = new Map();
  const rpcRoutes = [];
  const cleanups = new Map();

  function trackCleanup(moduleId, fn) {
    if (!moduleId || typeof fn !== 'function') return;
    if (!cleanups.has(moduleId)) cleanups.set(moduleId, new Set());
    cleanups.get(moduleId).add(fn);
  }

  function on(slot, moduleId, handler, { priority = 100 } = {}) {
    if (typeof slot !== 'string' || !slot || typeof moduleId !== 'string' || !moduleId || typeof handler !== 'function') {
      throw new Error('Invalid hook registration');
    }
    if (!pipelines.has(slot)) pipelines.set(slot, []);
    const list = pipelines.get(slot);
    const entry = { moduleId, handler, priority: Number.isFinite(priority) ? priority : 100 };
    list.push(entry);
    list.sort((a, b) => a.priority - b.priority);
    const remove = () => {
      const cur = pipelines.get(slot);
      if (!cur) return;
      const idx = cur.indexOf(entry);
      if (idx >= 0) cur.splice(idx, 1);
    };
    trackCleanup(moduleId, remove);
    return remove;
  }

  function runSync(slot, initialValue, context = {}) {
    const list = pipelines.get(slot);
    if (!list || !list.length) return initialValue;
    let value = initialValue;
    for (const entry of [...list]) {
      try {
        const next = entry.handler(value, context);
        if (next !== undefined) value = next;
      } catch (error) {
        // One module's hook failing must not break the pipeline for the others.
        console.error(`[agy-max] module "${entry.moduleId}" hook ${slot} failed`, error);
      }
    }
    return value;
  }

  async function runAsync(slot, initialValue, context = {}) {
    const list = pipelines.get(slot);
    if (!list || !list.length) return initialValue;
    let value = initialValue;
    for (const entry of [...list]) {
      try {
        const next = await entry.handler(value, context);
        if (next !== undefined) value = next;
      } catch (error) {
        // One module's hook failing must not break the pipeline for the others.
        console.error(`[agy-max] module "${entry.moduleId}" hook ${slot} failed`, error);
      }
    }
    return value;
  }

  function registerRpc(moduleId, matcher, handler) {
    if (typeof moduleId !== 'string' || !moduleId || typeof handler !== 'function') {
      throw new Error('Invalid RPC registration');
    }
    const matchFn = typeof matcher === 'function'
      ? matcher
      : typeof matcher === 'string'
        ? (matcher.endsWith('.') ? method => method.startsWith(matcher) : method => method === matcher)
        : matcher instanceof Set
          ? method => matcher.has(method)
          : Array.isArray(matcher)
            ? method => matcher.includes(method)
            : null;
    if (!matchFn) throw new Error('Invalid RPC matcher');
    const record = { moduleId, matchFn, handler };
    rpcRoutes.push(record);
    const remove = () => {
      const idx = rpcRoutes.indexOf(record);
      if (idx >= 0) rpcRoutes.splice(idx, 1);
    };
    trackCleanup(moduleId, remove);
    return remove;
  }

  function canHandleRpc(method) {
    return typeof method === 'string' && rpcRoutes.some(r => r.matchFn(method));
  }

  async function dispatchRpc(method, request, context = {}) {
    const route = rpcRoutes.find(r => r.matchFn(method));
    if (!route) return { handled: false, reply: undefined };
    const reply = await route.handler(request, context);
    return { handled: true, moduleId: route.moduleId, reply };
  }

  function onUnload(moduleId, fn) {
    trackCleanup(moduleId, fn);
  }

  async function unload(moduleId) {
    const fns = cleanups.get(moduleId);
    cleanups.delete(moduleId);
    if (fns) {
      for (const fn of [...fns]) {
        try { await fn(); } catch {}
      }
    }
    for (const [slot, list] of pipelines) {
      const kept = list.filter(entry => entry.moduleId !== moduleId);
      if (kept.length) pipelines.set(slot, kept);
      else pipelines.delete(slot);
    }
    for (let i = rpcRoutes.length - 1; i >= 0; i--) {
      if (rpcRoutes[i].moduleId === moduleId) rpcRoutes.splice(i, 1);
    }
  }

  async function clear() {
    const ids = [...new Set([
      ...cleanups.keys(),
      ...[...pipelines.values()].flatMap(list => list.map(e => e.moduleId)),
      ...rpcRoutes.map(r => r.moduleId)
    ])];
    for (const id of ids) await unload(id);
  }

  function registeredModules() {
    return [...new Set([
      ...cleanups.keys(),
      ...[...pipelines.values()].flatMap(list => list.map(e => e.moduleId)),
      ...rpcRoutes.map(r => r.moduleId)
    ])];
  }

  return {
    on,
    runSync,
    runAsync,
    registerRpc,
    canHandleRpc,
    dispatchRpc,
    onUnload,
    unload,
    clear,
    registeredModules
  };
}
