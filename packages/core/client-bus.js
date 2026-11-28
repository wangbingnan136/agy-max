(() => {
  const initialIds = Array.isArray(globalThis.__agyInstalledModules)
    ? globalThis.__agyInstalledModules
    : ['telemetry', 'chat-flow', 'workspace-nav', 'i18n', 'optics', 'accounts', 'proxy', 'ssh-remote'];
  let activeSet = new Set(initialIds);
  const tabs = new Map();
  const settingsGroups = new Map();
  const composerItems = new Map();
  const hooks = new Map();
  const listeners = new Set();

  function notify() {
    for (const fn of [...listeners]) {
      try { fn(); } catch {}
    }
  }

  function registerSlot(map, moduleId, spec) {
    if (!moduleId || !spec?.id) return () => {};
    const key = `${moduleId}:${spec.id}`;
    map.set(key, { ...spec, moduleId, key, order: Number.isFinite(spec.order) ? spec.order : 100 });
    notify();
    return () => {
      if (map.delete(key)) notify();
    };
  }

  function listSlot(map) {
    return [...map.values()]
      .filter(entry => activeSet.has(entry.moduleId))
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  }

  function onHook(slot, moduleId, handler, priority = 100) {
    if (!slot || !moduleId || typeof handler !== 'function') return () => {};
    if (!hooks.has(slot)) hooks.set(slot, []);
    const list = hooks.get(slot);
    const entry = { moduleId, handler, priority };
    list.push(entry);
    list.sort((a, b) => a.priority - b.priority);
    return () => {
      const cur = hooks.get(slot);
      if (!cur) return;
      const idx = cur.indexOf(entry);
      if (idx >= 0) cur.splice(idx, 1);
    };
  }

  function runHookSync(slot, initialValue, ctx = {}) {
    const list = hooks.get(slot);
    if (!list?.length) return initialValue;
    let value = initialValue;
    for (const entry of list) {
      if (!activeSet.has(entry.moduleId)) continue;
      try {
        const next = entry.handler(value, ctx);
        if (next !== undefined) value = next;
      } catch (error) {
        console.error(`[agy-max] module "${entry.moduleId}" hook ${slot} failed`, error);
      }
    }
    return value;
  }

  function unload(moduleId) {
    let changed = false;
    for (const map of [tabs, settingsGroups, composerItems]) {
      for (const [k, v] of map) {
        if (v.moduleId === moduleId) {
          map.delete(k);
          changed = true;
        }
      }
    }
    for (const [slot, list] of hooks) {
      const kept = list.filter(e => e.moduleId !== moduleId);
      if (kept.length !== list.length) {
        changed = true;
        if (kept.length) hooks.set(slot, kept);
        else hooks.delete(slot);
      }
    }
    if (activeSet.delete(moduleId)) changed = true;
    if (changed) notify();
  }

  globalThis.__agyModuleBus = {
    isInstalled: id => activeSet.has(id),
    activeIds: () => [...activeSet],
    setActiveIds(ids) {
      if (!Array.isArray(ids)) return;
      const next = new Set(ids.filter(id => typeof id === 'string' && id));
      if (next.size === activeSet.size && [...next].every(id => activeSet.has(id))) return;
      activeSet = next;
      notify();
    },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    registerTab: (moduleId, spec) => registerSlot(tabs, moduleId, spec),
    listTabs: () => listSlot(tabs),
    registerSettingsGroup: (moduleId, spec) => registerSlot(settingsGroups, moduleId, spec),
    listSettingsGroups: () => listSlot(settingsGroups),
    registerComposerItem: (moduleId, spec) => registerSlot(composerItems, moduleId, spec),
    listComposerItems: () => listSlot(composerItems),
    onHook,
    runHookSync,
    unload
  };
})();
