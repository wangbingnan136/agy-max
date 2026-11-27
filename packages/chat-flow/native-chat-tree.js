(() => {
  globalThis.__agyCreateChatTree = function createChatTree(env) {
    const h = globalThis.React?.createElement;
    const OUTSIDE = 'outside-of-project';
    const doc = typeof document !== 'undefined' ? document : null;
    const win = typeof window !== 'undefined' ? window : null;
    let disposed = false;
    let enabledMove = false;
    let enabledBtw = false;
    let hydrated = false;
    let loading = false;
    let projectOverrides = {};
    let foldedSet = new Set();
    let detachedSet = new Set();
    let btwMetaMap = {};
    let knownSideQuestions = new Set();
    let seededInitialSideQuestions = false;
    let unsubStore = null;
    let observer = null;
    let listenersInstalled = false;
    let rafId = 0;
    let autoScrollRaf = 0;
    let titleRefreshTimers = new Set();
    let styleEl = null;
    let dragPillEl = null;
    let dragState = null;
    let suppressOwnEscape = false;
    let inStoreSync = false;

    const ui = (zh, en) => (typeof env.uiText === 'function' ? env.uiText(zh, en) : zh);

    function svgIcon(paths, { size = 16, className = 'shrink-0 text-secondary-foreground' } = {}) {
      if (!h) return undefined;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.75,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className,
          'aria-hidden': 'true'
        },
        ...paths.map((d, idx) => h('path', { key: idx, d }))
      );
    }

    const detachBranchIcon = (size = 16) => svgIcon([
      'M6 3v12',
      'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      'M18 9a9 9 0 0 1-9 9'
    ], { size });

    const backParentIcon = (size = 16) => svgIcon([
      'M9 14l-4-4 4-4',
      'M5 10h10a4 4 0 0 1 4 4v5'
    ], { size });

    function ensureStyle() {
      if (styleEl || !doc?.head) return;
      styleEl = doc.createElement('style');
      styleEl.setAttribute('data-agy-chat-tree-style', '1');
      styleEl.textContent = `
        /* BaoCode-style /btw child conversation row:
           Main conversation stays 100% unchanged; /btw child sits directly below it,
           indented +16px further right than its parent row's title! */
        [data-sidebar-row-id][data-agy-btw-child="1"]:not(.pl-5)[data-agy-btw-project-row="1"] .agy-sidebar-row {
          margin-left: 22px !important;
          width: calc(100% - 22px) !important;
          padding-left: 24px !important;
        }
        [data-sidebar-row-id].pl-5[data-agy-btw-child="1"] .agy-sidebar-row {
          margin-left: 16px !important;
          width: calc(100% - 16px) !important;
          padding-left: 10px !important;
        }
        [data-sidebar-row-id][data-agy-btw-child="1"]:not(.pl-5):not([data-agy-btw-project-row="1"]) .agy-sidebar-row {
          margin-left: 16px !important;
          width: calc(100% - 16px) !important;
          padding-left: 8px !important;
        }
        [data-sidebar-row-id][data-agy-btw-parent="1"]:not([style*="position"]) {
          position: relative;
        }
        [data-sidebar-row-id][data-agy-btw-parent="1"]:not([data-agy-btw-project-parent="1"]) .agy-sidebar-row {
          padding-left: 26px !important;
        }
        .agy-btw-fold-btn {
          position: absolute;
          left: 7px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 4;
          width: 18px;
          height: 18px;
          padding: 0;
          border: 0;
          border-radius: 5px;
          background: transparent;
          color: var(--muted-foreground);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          pointer-events: auto;
          opacity: 0.56;
          transition: opacity 140ms ease, background-color 140ms ease, color 140ms ease;
        }
        [data-sidebar-row-id][data-agy-btw-parent="1"]:not([data-agy-btw-project-parent="1"]) .agy-btw-fold-btn {
          left: 5px;
        }
        [data-sidebar-row-id][data-agy-btw-parent="1"]:hover .agy-btw-fold-btn,
        .agy-btw-fold-btn[data-folded="1"] {
          opacity: 0.88;
        }
        .agy-btw-fold-btn:hover,
        .agy-btw-fold-btn:focus-visible {
          opacity: 1 !important;
          color: var(--foreground);
          background: color-mix(in srgb, var(--foreground) 8%, transparent);
          outline: none;
        }
        .agy-btw-fold-chev {
          width: 12px;
          height: 12px;
          flex-shrink: 0;
          transition: transform 150ms cubic-bezier(.22, 1, .36, 1);
        }
        .agy-btw-fold-btn[data-folded="1"] .agy-btw-fold-chev {
          transform: rotate(-90deg);
        }

        /* Sidebar Cross-Project Drag Highlight & Cursor Pill */
        [data-agy-project-drop-target="1"] {
          box-shadow: inset 0 0 0 1.5px var(--primary) !important;
          background: color-mix(in srgb, var(--primary) 12%, var(--sidebar, transparent)) !important;
          color: var(--foreground) !important;
          border-radius: 8px !important;
          transition: background 90ms ease, box-shadow 90ms ease;
        }
        .agy-drag-move-pill {
          position: fixed;
          z-index: 10002;
          pointer-events: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          max-width: 240px;
          padding: 5px 10px;
          border-radius: 999px;
          background: var(--popover, var(--card));
          color: var(--foreground);
          border: 1px solid color-mix(in srgb, var(--primary) 50%, var(--border));
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
          font-size: 12px;
          font-weight: 500;
          line-height: 1.25;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .agy-drag-move-pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: var(--primary);
          flex-shrink: 0;
        }
      `;
      doc.head.appendChild(styleEl);
    }

    function pushAdapterState() {
      const prevSync = inStoreSync;
      inStoreSync = true;
      try {
        env.adapter?.setBtwTreeState?.({
          foldedIds: [...foldedSet],
          detachedIds: [...detachedSet],
          btwMeta: btwMetaMap
        });
        if (enabledBtw) {
          env.adapter?.hydrateBtwSummaries?.(btwMetaMap);
        }
        if (enabledMove) {
          env.adapter?.applyProjectOverrides?.(projectOverrides);
        }
      } finally {
        inStoreSync = prevSync;
      }
    }

    async function toggleParentFolded(parentId, explicitFolded) {
      if (!parentId) return false;
      const nextFolded = typeof explicitFolded === 'boolean' ? explicitFolded : !foldedSet.has(parentId);
      if (nextFolded) foldedSet.add(parentId);
      else foldedSet.delete(parentId);
      pushAdapterState();
      decorateSidebarRows();
      try {
        await env.request?.('chatTree.setFolded', { parentConversationId: parentId, folded: nextFolded });
      } catch {}
      return nextFolded;
    }

    async function refreshBtwMetadataFromBackend() {
      if (disposed || !enabledBtw || typeof env.request !== 'function') return;
      try {
        const res = await env.request('chatTree.btwMeta', {});
        if (disposed || !res?.btwMeta) return;
        btwMetaMap = { ...btwMetaMap, ...res.btwMeta };
        env.adapter?.setBtwTreeState?.({ btwMeta: btwMetaMap });
        env.adapter?.hydrateBtwSummaries?.(btwMetaMap);
        scheduleDecorate();
      } catch {}
    }

    function scheduleBackendTitlePoll() {
      if (typeof setTimeout !== 'function') return;
      for (const delay of [1800, 4500, 9000]) {
        const timer = setTimeout(() => {
          titleRefreshTimers.delete(timer);
          void refreshBtwMetadataFromBackend();
        }, delay);
        titleRefreshTimers.add(timer);
      }
    }

    async function hydrate() {
      if (hydrated || loading || disposed || typeof env.request !== 'function') return;
      loading = true;
      try {
        const res = await env.request('chatTree.get', {});
        if (disposed) return;
        projectOverrides = res?.projectOverrides && typeof res.projectOverrides === 'object' ? { ...res.projectOverrides } : {};
        foldedSet = new Set(Array.isArray(res?.foldedAsides) ? res.foldedAsides : []);
        detachedSet = new Set(Array.isArray(res?.detachedAsides) ? res.detachedAsides : []);
        btwMetaMap = res?.btwMeta && typeof res.btwMeta === 'object' ? { ...res.btwMeta } : {};
        for (const id of Object.keys(btwMetaMap)) knownSideQuestions.add(id);
        hydrated = true;
        pushAdapterState();
        scheduleDecorate();
        if (Object.values(btwMetaMap).some(m => !m?.hasBackendSummary)) {
          scheduleBackendTitlePoll();
        }
      } catch {
        hydrated = true;
      } finally {
        loading = false;
      }
    }

    function closeRightSideQuestionTab(sqId, parentId = '') {
      const st = env.adapter?.store?.();
      if (!st?.dispatch || !sqId) return;
      const state = st.getState?.() || {};
      const parents = new Set([parentId, env.currentId?.()].filter(Boolean));
      for (const key of Object.keys(state.sidePanelV2?.viewsByTreeKey || {})) {
        if (key.startsWith('cascadeId:')) parents.add(key.slice(10));
      }
      const tabId = `side_question__${sqId}`;
      for (const pid of parents) {
        const panelScope = { kind: 'cascadeId', cascadeId: pid };
        const view = state.sidePanelV2?.viewsByTreeKey?.[`cascadeId:${pid}`];
        const tabs = Array.isArray(view?.tabs) ? view.tabs : [];
        const hasSqTab = tabs.some(t => t?.id === tabId || t?.content?.sideQuestionView?.cascadeId === sqId);
        if (!hasSqTab) continue;
        const onlyTab = tabs.filter(t => t?.id !== tabId && t?.id !== 'side_question__draft').length === 0;
        try { st.dispatch({ type: 'sidePanelV2/closeTabs', payload: { panelScope, tabIds: [tabId] } }); } catch {}
        try { st.dispatch({ type: 'sidePanel/closeTabs', payload: { panelScope, tabIds: [tabId] } }); } catch {}
        if (onlyTab) {
          try { st.dispatch({ type: 'auxPane/setOpen', payload: { panelScope, isOpen: false } }); } catch {}
          try { st.dispatch({ type: 'sidePanel/setOpen', payload: { panelScope, isOpen: false } }); } catch {}
        }
      }
    }

    function handleStoreChange() {
      if (disposed || inStoreSync) return;
      inStoreSync = true;
      try {
        if (enabledMove && Object.keys(projectOverrides).length > 0) {
          env.adapter?.applyProjectOverrides?.(projectOverrides);
        }
        if (!enabledBtw) return;
        env.adapter?.hydrateBtwSummaries?.(btwMetaMap);
        const snap = env.adapter?.btwTreeSnapshot?.();
        if (!snap) return;
        const allIds = Object.keys(snap.parentByChild || {});
        if (!seededInitialSideQuestions) {
          for (const id of allIds) knownSideQuestions.add(id);
          seededInitialSideQuestions = true;
          scheduleDecorate();
          return;
        }
        let newestChild = '';
        let newestParent = '';
        for (const id of allIds) {
          if (!knownSideQuestions.has(id)) {
            knownSideQuestions.add(id);
            const pid = snap.parentByChild[id] || '';
            if (pid) closeRightSideQuestionTab(id, pid);
            newestChild = id;
            newestParent = pid;
          }
        }
        if (newestChild && newestParent) {
          if (foldedSet.has(newestParent)) {
            void toggleParentFolded(newestParent, false);
          }
          scheduleBackendTitlePoll();
          const parentExec = env.adapter?.executionState?.(newestParent);
          const parentBusy = Boolean(parentExec && [2, 4].includes(parentExec.status));
          if (!parentBusy && env.currentId?.() === newestParent) {
            const pid = env.adapter?.conversationProjectId?.(newestParent) || '';
            void env.navigateToConversation?.(newestChild, pid && pid !== OUTSIDE ? pid : '');
          }
        }
        scheduleDecorate();
      } finally {
        inStoreSync = false;
      }
    }

    function ensureStoreSubscription() {
      if (unsubStore) return;
      const st = env.adapter?.store?.();
      if (typeof st?.subscribe === 'function') {
        unsubStore = st.subscribe(handleStoreChange);
      }
    }

    function createFoldChevronElement() {
      const ns = 'http://www.w3.org/2000/svg';
      if (typeof doc?.createElementNS === 'function') {
        const svg = doc.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 12 12');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'agy-btw-fold-chev');
        const p = doc.createElementNS(ns, 'path');
        p.setAttribute('d', 'M3 4.5L6 7.5L9 4.5');
        p.setAttribute('stroke', 'currentColor');
        p.setAttribute('stroke-width', '1.65');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(p);
        return svg;
      }
      const fallback = doc.createElement('span');
      fallback.className = 'agy-btw-fold-chev';
      fallback.textContent = '▾';
      return fallback;
    }

    function clearParentFoldMarker(wrap) {
      wrap.removeAttribute('data-agy-btw-parent');
      wrap.removeAttribute('data-agy-btw-project-parent');
      wrap.removeAttribute('data-agy-btw-folded');
      const oldBtn = wrap.querySelector?.('[data-agy-btw-fold-btn="1"]');
      oldBtn?.remove?.();
    }

    function decorateSidebarRows() {
      if (!doc) return;
      const wrappers = doc.querySelectorAll('[data-sidebar-row-id]');
      if (!enabledBtw) {
        for (const wrap of wrappers) {
          wrap.removeAttribute('data-agy-btw-child');
          wrap.removeAttribute('data-agy-btw-project-row');
          clearParentFoldMarker(wrap);
        }
        return;
      }
      const snap = env.adapter?.btwTreeSnapshot?.() || { parentByChild: {}, childrenByParent: {} };
      for (const wrap of wrappers) {
        const cid = wrap.getAttribute('data-sidebar-row-id') || '';
        const parentId = cid ? snap.parentByChild?.[cid] : '';
        const secId = wrap.getAttribute('data-sidebar-section-id') || '';
        const folderId = wrap.getAttribute('data-sidebar-row-folder-id') || '';
        const isProjectRow = Boolean(folderId || (secId && secId !== 'standalone' && secId !== 'pinned' && secId !== 'all' && secId !== 'main-section-header' && !secId.startsWith('convgroup:')));
        if (parentId) {
          clearParentFoldMarker(wrap);
          wrap.setAttribute('data-agy-btw-child', '1');
          if (isProjectRow) wrap.setAttribute('data-agy-btw-project-row', '1');
          else wrap.removeAttribute('data-agy-btw-project-row');
          continue;
        }
        wrap.removeAttribute('data-agy-btw-child');
        wrap.removeAttribute('data-agy-btw-project-row');
        const children = cid ? snap.childrenByParent?.[cid] : null;
        if (Array.isArray(children) && children.length > 0) {
          const isFolded = foldedSet.has(cid);
          wrap.setAttribute('data-agy-btw-parent', '1');
          wrap.setAttribute('data-agy-btw-folded', isFolded ? '1' : '0');
          if (isProjectRow) wrap.setAttribute('data-agy-btw-project-parent', '1');
          else wrap.removeAttribute('data-agy-btw-project-parent');
          let btn = wrap.querySelector?.('[data-agy-btw-fold-btn="1"]');
          if (!btn) {
            btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = 'agy-btw-fold-btn';
            btn.setAttribute('data-agy-btw-fold-btn', '1');
            btn.setAttribute('data-testid', 'agy-btw-fold-btn');
            btn.append(createFoldChevronElement());
            btn.addEventListener('pointerdown', ev => { ev?.stopPropagation?.(); });
            btn.addEventListener('click', ev => {
              ev?.preventDefault?.();
              ev?.stopPropagation?.();
              const targetCid = wrap.getAttribute('data-sidebar-row-id') || cid;
              void toggleParentFolded(targetCid);
            });
            if (typeof wrap.appendChild === 'function') wrap.appendChild(btn);
            else wrap.append?.(btn);
          }
          const tip = isFolded
            ? ui(`展开 ${children.length} 条侧边对话`, `Expand ${children.length} side chats`)
            : ui(`收起 ${children.length} 条侧边对话`, `Collapse ${children.length} side chats`);
          btn.setAttribute('data-folded', isFolded ? '1' : '0');
          btn.setAttribute('aria-expanded', isFolded ? 'false' : 'true');
          btn.setAttribute('aria-label', tip);
          btn.title = tip;
        } else {
          clearParentFoldMarker(wrap);
        }
      }
    }

    function scheduleDecorate() {
      if (disposed || !doc || rafId) return;
      let ranSync = false;
      const sched = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : fn => setTimeout(fn, 16);
      const id = sched(() => {
        ranSync = true;
        rafId = 0;
        if (!disposed) decorateSidebarRows();
      });
      if (!ranSync) rafId = id;
    }

    async function moveConversation(conversationId, targetProjectId) {
      if (!conversationId) return false;
      const normalized = !targetProjectId || targetProjectId === 'standalone' || targetProjectId === OUTSIDE
        ? OUTSIDE
        : String(targetProjectId).trim();
      const prev = env.adapter?.conversationProjectId?.(conversationId) || OUTSIDE;
      if (prev === normalized && projectOverrides[conversationId] === normalized) return true;

      const prevOverrides = projectOverrides;
      projectOverrides = { ...projectOverrides, [conversationId]: normalized };
      try {
        env.adapter?.applySingleProjectMove?.(conversationId, normalized);
      } catch {}

      if (env.currentId?.() === conversationId) {
        const r = env.adapter?.router?.();
        if (typeof r?.navigate === 'function') {
          try {
            await r.navigate({
              to: '/c/$cascadeId',
              params: { cascadeId: conversationId },
              search: normalized === OUTSIDE ? {} : { project: normalized },
              replace: true
            });
          } catch {}
        }
      }

      try {
        await env.request?.('chatTree.moveProject', { conversationId, projectId: normalized });
        const projects = env.adapter?.movableProjects?.() || [];
        const targetLabel = normalized === OUTSIDE
          ? ui('不属于任何项目', 'No Project')
          : (projects.find(p => p.id === normalized)?.name || normalized);
        env.notify?.({
          title: normalized === OUTSIDE
            ? ui('已移出项目', 'Removed from project')
            : ui(`已移动到「${targetLabel}」`, `Moved to "${targetLabel}"`),
          tag: 'agy-move-project-ok'
        });
        return true;
      } catch (err) {
        projectOverrides = prevOverrides;
        try { env.adapter?.applySingleProjectMove?.(conversationId, prev); } catch {}
        env.notify?.({
          title: ui('移动会话失败', 'Failed to move conversation'),
          message: err?.message || '',
          tag: 'agy-move-project-err'
        });
        return false;
      }
    }

    async function detachSideConversation(sqId) {
      const snap = env.adapter?.btwTreeSnapshot?.() || {};
      const parentId = snap.parentByChild?.[sqId] || '';
      try {
        const res = await env.adapter?.detachBtwConversation?.(sqId, parentId);
        detachedSet.add(sqId);
        pushAdapterState();
        await env.request?.('chatTree.detachAside', { conversationId: sqId }).catch(() => {});
        if (res?.newConversationId) {
          const parentPid = parentId ? (env.adapter?.conversationProjectId?.(parentId) || OUTSIDE) : OUTSIDE;
          if (parentPid && parentPid !== OUTSIDE) {
            await moveConversation(res.newConversationId, parentPid);
          }
          await env.navigateToConversation?.(res.newConversationId, parentPid !== OUTSIDE ? parentPid : '');
        }
        scheduleDecorate();
        env.notify?.({
          title: ui('已独立为主对话', 'Detached as standalone conversation'),
          tag: 'agy-btw-detach-ok'
        });
      } catch (err) {
        env.notify?.({
          title: ui('独立侧边对话失败', 'Failed to detach side chat'),
          message: err?.message || '',
          tag: 'agy-btw-detach-err'
        });
      }
    }

    // --- Geometry-based Sidebar Cross-Project Drag-and-Drop ---
    // Antigravity mounts a fullscreen <div data-testid="pointer-drag-shield" style="z-index:9999">
    // and sets pointer-events:none on the virtual list during drag, so hit-testing uses pure bounding boxes.
    function hideDragPill() {
      dragPillEl?.remove?.();
      dragPillEl = null;
    }

    function showDragPill(x, y, text) {
      if (!doc?.body) return;
      if (!dragPillEl) {
        dragPillEl = doc.createElement('div');
        dragPillEl.className = 'agy-drag-move-pill';
        dragPillEl.setAttribute('data-testid', 'agy-drag-move-pill');
        const dot = doc.createElement('span');
        dot.className = 'agy-drag-move-pill-dot';
        const label = doc.createElement('span');
        label.setAttribute('data-agy-pill-text', '1');
        label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        dragPillEl.append(dot, label);
        doc.body.appendChild(dragPillEl);
      }
      const labelEl = dragPillEl.querySelector?.('[data-agy-pill-text="1"]');
      if (labelEl && labelEl.textContent !== text) labelEl.textContent = text;
      const vw = win?.innerWidth || 1280;
      const vh = win?.innerHeight || 800;
      const left = Math.min(Math.max(8, x + 14), Math.max(8, vw - 248));
      const top = Math.min(Math.max(8, y - 16), Math.max(8, vh - 40));
      dragPillEl.style.left = `${Math.round(left)}px`;
      dragPillEl.style.top = `${Math.round(top)}px`;
    }

    function clearDropHighlight() {
      if (doc) {
        for (const el of doc.querySelectorAll('[data-agy-project-drop-target="1"]')) {
          el.removeAttribute('data-agy-project-drop-target');
        }
      }
      hideDragPill();
    }

    function stopAutoScroll() {
      if (autoScrollRaf) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(autoScrollRaf);
        else clearTimeout(autoScrollRaf);
        autoScrollRaf = 0;
      }
    }

    function resolveDropTargetByGeometry(x, y, state) {
      if (!doc) return null;
      const sidebarEl = state.scrollEl
        || doc.querySelector?.('[data-testid="conversation-list-sidebar"]')
        || doc.querySelector?.('[role="navigation"][aria-label="Sidebar"], [role="navigation"][data-agy-original-aria-label="Sidebar"]');
      if (sidebarEl?.getBoundingClientRect) {
        const sb = sidebarEl.getBoundingClientRect();
        if (sb.width > 0 && sb.height > 0) {
          if (x < sb.left - 20 || x > sb.right + 28 || y < sb.top - 8 || y > sb.bottom + 8) {
            return null;
          }
        }
      }

      const projects = env.adapter?.movableProjects?.() || [];
      const projNameById = new Map(projects.map(p => [p.id, p.name || p.id]));
      const esc = val => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(val) : val.replace(/["\\]/g, '\\$&'));

      for (const hdr of doc.querySelectorAll('[data-testid="project-header"]')) {
        const r = hdr.getBoundingClientRect?.();
        if (!r || r.width <= 0 || r.height <= 0 || y < r.top || y > r.bottom) continue;
        const pid = env.adapter?.projectIdFromElement?.(hdr)
          || hdr.closest?.('[data-sidebar-section-drop-id]')?.getAttribute?.('data-sidebar-section-drop-id')
          || '';
        if (!pid || pid === 'standalone' || pid === 'pinned' || pid === 'all' || pid === 'main-section-header') continue;
        if (pid === state.sourceProjectId) return null;
        const label = projNameById.get(pid) || hdr.getAttribute?.('data-project-label') || hdr.textContent?.trim() || pid;
        return { projectId: pid, highlightEl: hdr, label };
      }

      for (const sh of doc.querySelectorAll('[data-section-id="standalone"], [data-sidebar-section-drop-id="standalone"]')) {
        const r = sh.getBoundingClientRect?.();
        if (!r || r.width <= 0 || r.height <= 0 || y < r.top || y > r.bottom) continue;
        if (state.sourceProjectId === OUTSIDE) return null;
        return { projectId: OUTSIDE, highlightEl: sh, label: ui('不属于任何项目', 'No Project') };
      }

      for (const dropEl of doc.querySelectorAll('[data-sidebar-section-drop-id]')) {
        const r = dropEl.getBoundingClientRect?.();
        if (!r || r.width <= 0 || r.height <= 0 || y < r.top || y > r.bottom) continue;
        const dropId = dropEl.getAttribute?.('data-sidebar-section-drop-id') || '';
        if (!dropId || dropId === 'pinned' || dropId === 'all' || dropId === 'main-section-header' || dropId.startsWith('convgroup:') || dropId === 'section-coordinator') continue;
        if (dropId === 'standalone') {
          if (state.sourceProjectId === OUTSIDE) return null;
          return { projectId: OUTSIDE, highlightEl: dropEl, label: ui('不属于任何项目', 'No Project') };
        }
        if (projNameById.has(dropId)) {
          if (dropId === state.sourceProjectId) return null;
          const hdr = doc.querySelector?.(`[data-sidebar-section-drop-id="${esc(dropId)}"] [data-testid="project-header"]`) || dropEl;
          return { projectId: dropId, highlightEl: hdr, label: projNameById.get(dropId) };
        }
      }

      for (const rowWrap of doc.querySelectorAll('[data-sidebar-row-id]')) {
        const rowCid = rowWrap.getAttribute?.('data-sidebar-row-id') || '';
        if (!rowCid || rowCid === state.cascadeId) continue;
        const r = rowWrap.getBoundingClientRect?.();
        if (!r || r.width <= 0 || r.height <= 0 || y < r.top - 3 || y > r.bottom + 3) continue;
        const secId = rowWrap.getAttribute?.('data-sidebar-section-id') || '';
        const folderId = rowWrap.getAttribute?.('data-sidebar-row-folder-id') || '';
        if ((secId === 'pinned' && !folderId) || secId.startsWith('convgroup:') || secId === 'section-coordinator') return null;
        if (secId === 'all' || secId === 'main-section-header') return null;
        const rawTarget = folderId || secId || env.adapter?.conversationProjectId?.(rowCid) || '';
        if (rawTarget === 'standalone' || rawTarget === OUTSIDE) {
          if (state.sourceProjectId === OUTSIDE) return null;
          const sh = doc.querySelector?.('[data-section-id="standalone"]') || rowWrap;
          return { projectId: OUTSIDE, highlightEl: sh, label: ui('不属于任何项目', 'No Project') };
        }
        if (rawTarget && (projNameById.has(rawTarget) || env.adapter?.conversationProjectId?.(rowCid) === rawTarget)) {
          if (rawTarget === state.sourceProjectId) return null;
          const hdr = doc.querySelector?.(`[data-sidebar-section-drop-id="${esc(rawTarget)}"] [data-testid="project-header"]`) || rowWrap;
          return { projectId: rawTarget, highlightEl: hdr, label: projNameById.get(rawTarget) || rawTarget };
        }
      }

      return null;
    }

    function updateDragAtPointer(x, y) {
      if (!dragState || !dragState.active) return;
      clearDropHighlight();
      const target = resolveDropTargetByGeometry(x, y, dragState);
      dragState.targetProjectId = target ? target.projectId : null;
      dragState.targetLabel = target ? target.label : '';
      if (target) {
        target.highlightEl?.setAttribute?.('data-agy-project-drop-target', '1');
        const pillText = target.projectId === OUTSIDE
          ? ui('移出当前项目', 'Move out of project')
          : ui(`移动到「${target.label}」`, `Move to "${target.label}"`);
        showDragPill(x, y, pillText);
      }
    }

    function stepAutoScroll() {
      autoScrollRaf = 0;
      if (!dragState || !dragState.active || !dragState.scrollEl?.getBoundingClientRect) return;
      const sc = dragState.scrollEl;
      const rect = sc.getBoundingClientRect();
      const edge = 42;
      let delta = 0;
      if (dragState.lastY >= rect.top && dragState.lastY < rect.top + edge) {
        delta = -Math.ceil(((rect.top + edge - dragState.lastY) / edge) * 9);
      } else if (dragState.lastY <= rect.bottom && dragState.lastY > rect.bottom - edge) {
        delta = Math.ceil(((dragState.lastY - (rect.bottom - edge)) / edge) * 9);
      }
      if (delta !== 0 && typeof sc.scrollTop === 'number') {
        const prev = sc.scrollTop;
        sc.scrollTop += delta;
        if (sc.scrollTop !== prev) {
          updateDragAtPointer(dragState.lastX, dragState.lastY);
          const sched = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : fn => setTimeout(fn, 16);
          autoScrollRaf = sched(stepAutoScroll);
        }
      }
    }

    function hasOrphanedDragShield() {
      return Boolean(
        doc?.querySelector?.('[data-testid="pointer-drag-shield"]')
        || doc?.body?.style?.cursor === 'grabbing'
      );
    }

    function abortNativeSidebarDrag() {
      const hadShield = hasOrphanedDragShield();
      if (win && typeof KeyboardEvent === 'function') {
        try {
          suppressOwnEscape = true;
          win.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        } catch {} finally {
          suppressOwnEscape = false;
        }
      }
      if ((hadShield || hasOrphanedDragShield()) && doc) {
        for (const shield of doc.querySelectorAll?.('[data-testid="pointer-drag-shield"]') || []) {
          shield.remove?.();
        }
        if (doc.body?.style?.cursor === 'grabbing') doc.body.style.cursor = '';
        if (doc.body?.style?.userSelect === 'none') doc.body.style.userSelect = '';
      }
    }

    function cancelActiveDrag(releaseNative = true) {
      const wasActive = Boolean(dragState?.active);
      dragState = null;
      stopAutoScroll();
      clearDropHighlight();
      if (releaseNative && (wasActive || hasOrphanedDragShield())) {
        abortNativeSidebarDrag();
      }
    }

    function finishActiveDrag(forceAbortNative = false) {
      if (!dragState) {
        if (forceAbortNative && hasOrphanedDragShield()) abortNativeSidebarDrag();
        return;
      }
      const finished = dragState;
      dragState = null;
      stopAutoScroll();
      clearDropHighlight();
      if (finished.active && finished.targetProjectId) {
        abortNativeSidebarDrag();
        void moveConversation(finished.cascadeId, finished.targetProjectId);
      } else if (forceAbortNative && (finished.active || hasOrphanedDragShield())) {
        abortNativeSidebarDrag();
      }
    }

    function onPointerDown(e) {
      if (disposed) return;
      if (!dragState && hasOrphanedDragShield()) {
        abortNativeSidebarDrag();
      }
      if (!enabledMove || e.button !== 0) return;
      if (e.target?.closest?.('button, input, select, textarea, [role="menuitem"], [role="menu"], .agy-row-actions')) return;
      const rowWrap = e.target?.closest?.('[data-sidebar-row-id]')
        || e.target?.closest?.('[data-testid="conversation-row-sidebar"]')?.closest?.('[data-sidebar-row-id]');
      if (!rowWrap) return;
      const cid = rowWrap.getAttribute?.('data-sidebar-row-id') || '';
      if (!cid || !env.adapter?.isMovableConversation?.(cid)) return;
      const sourceProjectId = env.adapter?.conversationProjectId?.(cid) || OUTSIDE;
      const scrollEl = rowWrap.closest?.('[data-sidebar-scroll-container]')
        || doc?.querySelector?.('[data-testid="conversation-list-sidebar"]')
        || null;
      dragState = {
        cascadeId: cid,
        sourceProjectId,
        scrollEl,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        active: false,
        targetProjectId: null,
        targetLabel: ''
      };
    }

    function onPointerMove(e) {
      if (!dragState) return;
      if (typeof e.buttons === 'number' && e.buttons === 0) {
        cancelActiveDrag(true);
        return;
      }
      dragState.lastX = e.clientX;
      dragState.lastY = e.clientY;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (!dragState.active) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return;
        dragState.active = true;
      }
      updateDragAtPointer(e.clientX, e.clientY);
      if (!autoScrollRaf && dragState.scrollEl) stepAutoScroll();
    }

    function onPointerUp() {
      finishActiveDrag(false);
    }

    function onMouseUp() {
      if (dragState || hasOrphanedDragShield()) finishActiveDrag(true);
    }

    function onPointerCancel() {
      cancelActiveDrag(true);
    }

    function onDragStart(e) {
      if (disposed || !enabledMove) return;
      if (dragState || e.target?.closest?.('[data-sidebar-row-id]')) {
        e.preventDefault?.();
      }
    }

    function onWindowBlur() {
      if (dragState || hasOrphanedDragShield()) cancelActiveDrag(true);
    }

    function onVisibilityChange() {
      if (doc?.hidden && (dragState || hasOrphanedDragShield())) cancelActiveDrag(true);
    }

    function onKeyDown(e) {
      if (suppressOwnEscape) return;
      if (e.key === 'Escape' && dragState) {
        cancelActiveDrag(false);
      }
    }

    function onSidebarClick(e) {
      if (disposed || !enabledBtw) return;
      const rowWrap = e.target?.closest?.('[data-sidebar-row-id][data-agy-btw-child="1"]');
      if (!rowWrap || e.target?.closest?.('.agy-row-actions, [role="menu"]')) return;
      const sqId = rowWrap.getAttribute('data-sidebar-row-id') || '';
      if (!sqId) return;
      const snap = env.adapter?.btwTreeSnapshot?.() || {};
      const parentId = snap.parentByChild?.[sqId] || '';
      closeRightSideQuestionTab(sqId, parentId);
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (e.button == null || e.button === 0)) {
        env.adapter?.activateConversationPane?.(sqId);
      }
    }

    function installDomListeners() {
      if (!doc || listenersInstalled) return;
      listenersInstalled = true;
      const target = win || doc;
      target.addEventListener('pointerdown', onPointerDown, true);
      target.addEventListener('pointermove', onPointerMove, true);
      target.addEventListener('pointerup', onPointerUp, true);
      target.addEventListener('mouseup', onMouseUp, true);
      target.addEventListener('pointercancel', onPointerCancel, true);
      target.addEventListener('dragstart', onDragStart, true);
      target.addEventListener('dragend', onPointerCancel, true);
      target.addEventListener('contextmenu', onPointerCancel, true);
      target.addEventListener('blur', onWindowBlur);
      target.addEventListener('keydown', onKeyDown, true);
      doc.addEventListener('visibilitychange', onVisibilityChange);
      doc.addEventListener('click', onSidebarClick, true);
      if (typeof MutationObserver === 'function' && doc.body) {
        observer = new MutationObserver(() => scheduleDecorate());
        observer.observe(doc.body, { childList: true, subtree: true });
      }
    }

    function removeDomListeners() {
      if (!doc || !listenersInstalled) return;
      listenersInstalled = false;
      const target = win || doc;
      target.removeEventListener('pointerdown', onPointerDown, true);
      target.removeEventListener('pointermove', onPointerMove, true);
      target.removeEventListener('pointerup', onPointerUp, true);
      target.removeEventListener('mouseup', onMouseUp, true);
      target.removeEventListener('pointercancel', onPointerCancel, true);
      target.removeEventListener('dragstart', onDragStart, true);
      target.removeEventListener('dragend', onPointerCancel, true);
      target.removeEventListener('contextmenu', onPointerCancel, true);
      target.removeEventListener('blur', onWindowBlur);
      target.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      doc.removeEventListener('click', onSidebarClick, true);
      observer?.disconnect?.();
      observer = null;
      stopAutoScroll();
      clearDropHighlight();
    }

    // Only /btw child conversations get extra menu actions ("独立为主对话" / "回到主对话").
    // Project reassignment uses direct sidebar drag-and-drop only — no right-click Move submenu.
    function extendConversationMenu(id, menuOptions, items) {
      if (!id || !Array.isArray(items) || menuOptions?.isArchived) return items;
      let result = enabledMove ? items.filter(it => it?.id !== 'move-to-project') : items;

      if (enabledBtw) {
        const snap = env.adapter?.btwTreeSnapshot?.() || {};
        const parentId = snap.parentByChild?.[id] || '';
        if (parentId) {
          const btwItems = [];
          if (!result.some(it => it?.id === 'agy-btw-detach')) {
            btwItems.push({
              id: 'agy-btw-detach',
              label: ui('独立为主对话', 'Detach as standalone chat'),
              icon: detachBranchIcon(16),
              testId: 'agy-btw-detach-menu-item',
              onClick: () => detachSideConversation(id)
            });
          }
          if (!result.some(it => it?.id === 'agy-btw-open-parent')) {
            btwItems.push({
              id: 'agy-btw-open-parent',
              label: ui('回到主对话', 'Back to main chat'),
              icon: backParentIcon(16),
              testId: 'agy-btw-parent-menu-item',
              onClick: () => {
                const pid = env.adapter?.conversationProjectId?.(parentId) || '';
                return env.navigateToConversation?.(parentId, pid && pid !== OUTSIDE ? pid : '');
              }
            });
          }
          if (btwItems.length) {
            const renameIdx = result.findIndex(it => it?.id === 'rename');
            const pos = renameIdx >= 0 ? renameIdx + 1 : 0;
            result = [...result.slice(0, pos), ...btwItems, ...result.slice(pos)];
          }
        }
      }

      return result;
    }

    function sync({ moveEnabled = false, btwEnabled = false } = {}) {
      if (disposed) return;
      enabledMove = Boolean(moveEnabled);
      enabledBtw = Boolean(btwEnabled);
      env.adapter?.setBtwSubtree?.(enabledBtw);
      if (enabledMove || enabledBtw) {
        ensureStyle();
        installDomListeners();
        ensureStoreSubscription();
        void hydrate();
        pushAdapterState();
        handleStoreChange();
      } else {
        decorateSidebarRows();
        clearDropHighlight();
      }
    }

    return {
      sync,
      toggleParentFolded,
      moveConversation,
      detachSideConversation,
      extendConversationMenu,
      dispose() {
        disposed = true;
        if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
        rafId = 0;
        for (const timer of titleRefreshTimers) clearTimeout(timer);
        titleRefreshTimers.clear();
        removeDomListeners();
        try { unsubStore?.(); } catch {}
        unsubStore = null;
        styleEl?.remove?.();
        styleEl = null;
        env.adapter?.setBtwSubtree?.(false);
      }
    };
  };
})();
