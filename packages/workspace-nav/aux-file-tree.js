(() => {
  globalThis.__agyCreateAuxFileTree = function createAuxFileTree(env) {
    const R = globalThis.React;
    const h = R.createElement;
    const PANE_KEY = 'agyFileTree';
    const doc = typeof document !== 'undefined' ? document : null;

    if (doc) {
      doc.documentElement?.removeAttribute?.('data-agy-right-rail');
      doc.documentElement?.removeAttribute?.('data-agy-right-rail-open');
      for (const oldStyle of doc.querySelectorAll?.('[data-agy-right-rail-style]') || []) {
        oldStyle.remove?.();
      }
    }

    const styleEl = doc?.createElement ? doc.createElement('style') : null;
    if (styleEl && doc?.head) {
      styleEl.setAttribute?.('data-agy-aux-file-tree-style', '1');
      styleEl.textContent = `
        .agy-ftree-root{width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;font-size:12.5px;color:var(--foreground);background:var(--background)}
        .agy-ftree-head{height:38px;padding:0 8px 0 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:6px;flex-shrink:0}
        .agy-ftree-title{font-size:12.5px;font-weight:600;color:var(--foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
        .agy-ftree-iconbtn{width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--muted-foreground);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:background 110ms ease,color 110ms ease}
        .agy-ftree-iconbtn:hover,.agy-ftree-iconbtn:focus-visible{background:var(--secondary);color:var(--foreground);outline:none}
        .agy-ftree-pill{display:flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted-foreground)}
        .agy-ftree-pill:focus-within{border-color:var(--primary)}
        .agy-ftree-pill input{flex:1;min-width:0;border:0;outline:none!important;background:transparent;color:var(--foreground);font:inherit;font-size:12px}
        .agy-ftree-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
        .agy-ftree-row{width:100%;min-height:27px;padding-top:3px;padding-bottom:3px;padding-right:8px;border:0;border-radius:6px;background:transparent;color:var(--foreground);display:flex;align-items:center;gap:5px;font:inherit;font-size:12.5px;text-align:left;cursor:pointer;transition:background 100ms ease}
        .agy-ftree-row:hover,.agy-ftree-row:focus-visible{background:var(--secondary);outline:none}
        .agy-ftree-row[data-selected="true"]{background:color-mix(in srgb,var(--primary) 14%,var(--secondary));font-weight:500}
        .agy-ftree-action-row{width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:var(--foreground);display:flex;align-items:center;justify-content:space-between;gap:8px;font:inherit;font-size:12.5px;text-align:left;cursor:pointer;transition:background 110ms ease}
        .agy-ftree-action-row:hover,.agy-ftree-action-row:focus-visible{background:var(--secondary);outline:none}
        .agy-ftree-primary-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border:0;border-radius:8px;background:var(--primary);color:var(--primary-foreground);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;transition:opacity 120ms ease}
        .agy-ftree-primary-btn:hover{opacity:.92}
        .agy-ftree-sec-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:var(--background);color:var(--foreground);font:inherit;font-size:12px;font-weight:500;cursor:pointer;transition:background 110ms ease}
        .agy-ftree-sec-btn:hover{background:var(--secondary)}
        .agy-ftree-sec-btn:disabled{opacity:.5;cursor:default;background:var(--background)}
        .agy-ftree-code{margin:0;padding:8px 10px;font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px;line-height:1.5;white-space:pre;overflow-x:auto;color:var(--foreground)}
        .agy-ftree-editor{flex:1;min-width:0;margin:0;padding:8px 10px;border:0;outline:none;resize:none;background:transparent;font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px;line-height:1.5;white-space:pre;overflow:auto;tab-size:4;color:var(--foreground)}
      `;
      doc.head.appendChild?.(styleEl);
    }

    const SVG_PATHS = {
      folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z',
      folder_open: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2H3V6zm0 4h18l-2 9H5l-2-9z',
      search: 'M11 4a7 7 0 1 0 4.95 11.95L20 20',
      description: 'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 0v6h6',
      chevron_right: 'M9 6l6 6-6 6',
      expand_more: 'M6 9l6 6 6-6',
      refresh: 'M4 12a8 8 0 0 1 13.6-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.6 5.6L4 15m0 5v-5h5',
      close: 'M6 6l12 12M18 6L6 18',
      arrow_back: 'M19 12H5m6-6l-6 6 6 6',
      attach_file: 'M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6',
      code: 'M8 8l-4 4 4 4m8-8l4 4-4 4',
      edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zm9.5-13.5l4 4',
      open_in_new: 'M14 4h6v6m0-6L10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'
    };

    function icon(name, size = 16) {
      const d = SVG_PATHS[name] || SVG_PATHS.description;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.85,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className: 'shrink-0',
        'aria-hidden': 'true'
      }, h('path', { d }));
    }

    const mountedWorkspaces = new Map();
    const dirCache = new Map();
    const uriKey = uri => uri?.replace(/^file:\/\/\/[A-Z]:/i, drive => drive.toLowerCase());
    const dirKey = (uri, relPath = '') => `${uriKey(uri)}::${relPath}`;

    function decodeName(value) {
      try { return decodeURIComponent(value); } catch { return value; }
    }

    function shortPath(fullPath = '') {
      const clean = String(fullPath || '').replaceAll('\\', '/');
      const parts = clean.split('/').filter(Boolean);
      if (parts.length <= 3) return clean;
      return `.../${parts.slice(-3).join('/')}`;
    }

    function formatBytes(bytes) {
      const n = Number(bytes) || 0;
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    }

    function buildSearchTree(entries) {
      const rootNodes = [];
      const dirMap = new Map();
      const ensureDir = parts => {
        const key = parts.join('/');
        if (dirMap.has(key)) return dirMap.get(key);
        const node = {
          name: parts[parts.length - 1],
          relPath: key,
          uri: '',
          isDirectory: true,
          children: []
        };
        dirMap.set(key, node);
        if (parts.length === 1) rootNodes.push(node);
        else ensureDir(parts.slice(0, -1)).children.push(node);
        return node;
      };
      for (const item of entries) {
        const parts = String(item.relPath || item.name || '').split('/').filter(Boolean);
        if (!parts.length) continue;
        if (item.isDirectory) {
          const d = ensureDir(parts);
          d.uri = item.uri || d.uri;
        } else if (parts.length === 1) {
          rootNodes.push({ ...item });
        } else {
          const parent = ensureDir(parts.slice(0, -1));
          parent.children.push({ ...item });
        }
      }
      return rootNodes;
    }

    function FileTreePane() {
      const uiText = env.uiText;
      const [, forceRender] = R.useState(0);
      const bump = () => forceRender(n => n + 1);

      R.useEffect(() => env.subscribe ? env.subscribe(bump) : undefined, []);

      const conversationId = env.currentId?.() || '';
      const draftProjectId = !conversationId && typeof location !== 'undefined' && location.search
        ? (new URLSearchParams(location.search).get('project')?.trim() || '')
        : '';
      const sessionKey = conversationId || `__home__:${draftProjectId}`;
      const nativeWsUri = env.adapter?.workspaceUri?.(conversationId) || '';

      const [choosingFolder, setChoosingFolder] = R.useState(false);
      const [recents, setRecents] = R.useState([]);
      const [expandedDirs, setExpandedDirs] = R.useState(() => new Set());
      const [filterQuery, setFilterQuery] = R.useState('');
      const [searchEntries, setSearchEntries] = R.useState(null);
      const [loadingTree, setLoadingTree] = R.useState(false);
      const [treeError, setTreeError] = R.useState('');
      const [preview, setPreview] = R.useState(null);
      const [loadingPreview, setLoadingPreview] = R.useState(false);
      const [draft, setDraft] = R.useState(null);
      const [saving, setSaving] = R.useState(false);

      const activeWsUri = mountedWorkspaces.get(sessionKey) || nativeWsUri || '';
      const rootCacheKey = dirKey(activeWsUri);
      const rootData = activeWsUri ? dirCache.get(rootCacheKey) : null;

      const refreshRecents = R.useCallback(async () => {
        const clientList = env.adapter?.recentWorkspaces?.() || [];
        try {
          const reply = await env.request('workspace.recent', { clientWorkspaces: clientList });
          if (Array.isArray(reply?.workspaces)) {
            setRecents(reply.workspaces);
            return;
          }
        } catch {}
        setRecents(clientList);
      }, []);

      const loadDirectory = R.useCallback(async (wsUri, relPath = '', force = false) => {
        if (!wsUri) return;
        const key = dirKey(wsUri, relPath);
        if (!force && dirCache.has(key)) { bump(); return; }
        if (!relPath) setLoadingTree(true);
        setTreeError('');
        try {
          let res;
          try {
            res = await env.request('workspace.listDir', { rootUri: wsUri, relPath });
          } catch (firstErr) {
            if (nativeWsUri && uriKey(wsUri) === uriKey(nativeWsUri) && /未授权/.test(firstErr?.message || '')) {
              await env.request('workspace.recent', { clientWorkspaces: [{ uri: wsUri }, ...(env.adapter?.recentWorkspaces?.() || [])] }).catch(() => {});
              res = await env.request('workspace.listDir', { rootUri: wsUri, relPath });
            } else {
              throw firstErr;
            }
          }
          if (res?.ok) dirCache.set(key, res);
        } catch (err) {
          if (!relPath) setTreeError(err?.message || uiText('读取目录失败', 'Failed to read folder'));
        } finally {
          if (!relPath) setLoadingTree(false);
          bump();
        }
      }, [nativeWsUri, uiText]);

      const activeWsKey = uriKey(activeWsUri) || '';
      const prevSessionRef = R.useRef(sessionKey);
      const prevWsKeyRef = R.useRef(activeWsKey);
      R.useEffect(() => {
        const prevKey = prevSessionRef.current;
        if (prevKey === sessionKey) {
          prevWsKeyRef.current = activeWsKey;
          return;
        }
        prevSessionRef.current = sessionKey;
        if (prevKey.startsWith('__home__:') && conversationId && !mountedWorkspaces.has(sessionKey) && !nativeWsUri && mountedWorkspaces.has(prevKey)) {
          const carriedUri = mountedWorkspaces.get(prevKey);
          mountedWorkspaces.set(sessionKey, carriedUri);
          prevWsKeyRef.current = uriKey(carriedUri) || '';
          setChoosingFolder(false);
          bump();
          return;
        }
        const sameWorkspace = Boolean(prevWsKeyRef.current && activeWsKey && prevWsKeyRef.current === activeWsKey);
        prevWsKeyRef.current = activeWsKey;
        setPreview(null);
        setDraft(null);
        setFilterQuery('');
        setSearchEntries(null);
        setChoosingFolder(false);
        if (!sameWorkspace) setExpandedDirs(new Set());
      }, [activeWsKey, conversationId, nativeWsUri, sessionKey]);

      R.useEffect(() => {
        if (activeWsUri && !choosingFolder) {
          void loadDirectory(activeWsUri, '');
        } else {
          void refreshRecents();
        }
      }, [activeWsUri, choosingFolder, loadDirectory, refreshRecents]);

      R.useEffect(() => {
        if (!activeWsUri || choosingFolder) return;
        const q = filterQuery.trim().replaceAll('\\', '/');
        if (!q) {
          setSearchEntries(null);
          return;
        }
        const timer = setTimeout(() => {
          void env.request('workspace.searchFiles', { rootUri: activeWsUri, query: q }).then(res => {
            if (Array.isArray(res?.entries)) setSearchEntries(res.entries);
          }).catch(() => {});
        }, 120);
        return () => clearTimeout(timer);
      }, [activeWsUri, choosingFolder, filterQuery]);

      const selectWorkspace = async uri => {
        if (!uri) return;
        try {
          const res = await env.request('workspace.mount', { uri });
          const nextUri = res?.uri || uri;
          mountedWorkspaces.set(sessionKey, nextUri);
          prevWsKeyRef.current = uriKey(nextUri) || '';
          setChoosingFolder(false);
          setPreview(null);
          setFilterQuery('');
          setExpandedDirs(new Set());
          await loadDirectory(nextUri, '', true);
        } catch (err) {
          env.notify?.({ title: uiText('挂载文件夹失败', 'Failed to mount folder'), message: err?.message || '' });
        }
      };

      const handlePickFolder = async () => {
        try {
          const res = await env.request('workspace.pickFolder');
          if (res?.cancelled || !res?.uri) return;
          mountedWorkspaces.set(sessionKey, res.uri);
          prevWsKeyRef.current = uriKey(res.uri) || '';
          setChoosingFolder(false);
          setPreview(null);
          setFilterQuery('');
          setExpandedDirs(new Set());
          await loadDirectory(res.uri, '', true);
        } catch (err) {
          env.notify?.({ title: uiText('选择文件夹失败', 'Folder picker failed'), message: err?.message || '' });
        }
      };

      const openFilePreview = async fileUri => {
        if (!fileUri) return;
        setLoadingPreview(true);
        try {
          const res = await env.request('workspace.readFile', { rootUri: activeWsUri, fileUri });
          if (res?.ok) {
            setPreview(res);
            setDraft(null);
            setChoosingFolder(false);
          }
        } catch (err) {
          env.notify?.({ title: uiText('打开文件失败', 'Failed to open file'), message: err?.message || '' });
        } finally {
          setLoadingPreview(false);
        }
      };

      // The textarea reports CRLF as LF. Restore CRLF only if it predominated in the original.
      const original = preview?.kind === 'text' ? String(preview.content || '') : '';
      const baseline = original.replace(/\r\n/g, '\n');
      const dirty = draft !== null && draft !== baseline;
      const confirmDiscard = () => !dirty || globalThis.confirm?.(uiText('放弃未保存的修改吗？', 'Discard unsaved changes?')) === true;

      const saveDraft = async () => {
        if (!preview || draft === null || saving || !dirty) return;
        const crlf = (original.match(/\r\n/g) || []).length;
        const newlines = (baseline.match(/\n/g) || []).length;
        const content = crlf > newlines / 2 ? draft.replace(/\n/g, '\r\n') : draft;
        const write = overwrite => env.request('workspace.writeFile', { rootUri: activeWsUri, fileUri: preview.uri, content, expectedMtimeMs: preview.mtimeMs, overwrite });
        setSaving(true);
        try {
          let res = await write(false);
          if (res?.conflict && globalThis.confirm?.(uiText('这个文件已在别处被修改（可能是 AI 刚改过）。仍要用你的版本覆盖吗？', 'This file changed on disk (maybe the agent edited it). Overwrite it with your version?')) === true) {
            res = await write(true);
          }
          if (res?.ok) setPreview({ ...preview, content, size: res.size, mtimeMs: res.mtimeMs });
        } catch (err) {
          env.notify?.({ title: uiText('保存失败', 'Save failed'), message: err?.message || '' });
        } finally {
          setSaving(false);
        }
      };

      const attachUriToChat = async (uri, isDirectory = false, sourceEl = null) => {
        try {
          const attached = await env.request('file.attach', { uri, isDirectory, source: 'file-tree' });
          await env.adapter?.attachFileToComposer?.(attached, sourceEl);
        } catch (err) {
          env.notify?.({ title: uiText('引用到输入框失败', 'Failed to attach file'), message: err?.message || '' });
        }
      };

      const toggleDirectory = relPath => {
        const next = new Set(expandedDirs);
        if (next.has(relPath)) {
          next.delete(relPath);
        } else {
          next.add(relPath);
          void loadDirectory(activeWsUri, relPath);
        }
        setExpandedDirs(next);
      };

      const renderLazyTree = (relPath = '', depth = 0) => {
        const cached = dirCache.get(dirKey(activeWsUri, relPath));
        const list = cached?.entries || [];
        return list.map(entry => {
          const padLeft = 10 + depth * 14;
          const isOpen = entry.isDirectory && expandedDirs.has(entry.relPath);
          return h('div', { key: entry.relPath },
            h('button', {
              type: 'button',
              role: 'treeitem',
              'aria-expanded': entry.isDirectory ? isOpen : undefined,
              'data-testid': entry.isDirectory ? 'agy-ftree-dir-row' : 'agy-ftree-file-row',
              'data-selected': !entry.isDirectory && preview && uriKey(preview.uri) === uriKey(entry.uri) ? 'true' : undefined,
              className: 'agy-ftree-row',
              style: { paddingLeft: `${padLeft}px` },
              title: entry.relPath,
              onClick: () => {
                if (entry.isDirectory) toggleDirectory(entry.relPath);
                else void openFilePreview(entry.uri);
              },
              onContextMenu: e => {
                if (!env.showFileContextMenu || !entry.uri) return;
                e.preventDefault();
                e.stopPropagation();
                env.showFileContextMenu({ x: e.clientX, y: e.clientY, uri: entry.uri, isDirectory: entry.isDirectory, source: e.currentTarget });
              }
            },
              entry.isDirectory
                ? h('span', { className: 'text-muted-foreground inline-flex' }, icon(isOpen ? 'expand_more' : 'chevron_right', 14))
                : h('span', { style: { width: 14, flexShrink: 0 } }),
              h('span', { className: 'text-muted-foreground inline-flex' }, icon(entry.isDirectory ? (isOpen ? 'folder_open' : 'folder') : 'description', 15)),
              h('span', { className: 'truncate flex-1' }, entry.name)),
            isOpen ? h('div', null, renderLazyTree(entry.relPath, depth + 1)) : null);
        });
      };

      const renderFilteredTree = (nodes, depth = 0) => nodes.map(node => {
        const padLeft = 10 + depth * 14;
        return h('div', { key: node.relPath || node.name },
          h('button', {
            type: 'button',
            role: 'treeitem',
            'data-testid': node.isDirectory ? 'agy-ftree-dir-row' : 'agy-ftree-file-row',
            className: 'agy-ftree-row',
            style: { paddingLeft: `${padLeft}px` },
            title: node.relPath,
            onClick: () => {
              if (!node.isDirectory && node.uri) void openFilePreview(node.uri);
            },
            onContextMenu: e => {
              if (!env.showFileContextMenu || !node.uri) return;
              e.preventDefault();
              e.stopPropagation();
              env.showFileContextMenu({ x: e.clientX, y: e.clientY, uri: node.uri, isDirectory: node.isDirectory, source: e.currentTarget });
            }
          },
            node.isDirectory
              ? h('span', { className: 'text-muted-foreground inline-flex' }, icon('expand_more', 14))
              : h('span', { style: { width: 14, flexShrink: 0 } }),
            h('span', { className: 'text-muted-foreground inline-flex' }, icon(node.isDirectory ? 'folder_open' : 'description', 15)),
            h('span', { className: 'truncate flex-1' }, node.name)),
          Array.isArray(node.children) && node.children.length > 0
            ? h('div', null, renderFilteredTree(node.children, depth + 1))
            : null);
      });

      const renderFolderSelector = () => h('div', { className: 'agy-ftree-scroll p-3 space-y-3', 'data-testid': 'agy-ftree-empty-workspace' },
        h('div', { className: 'p-4 rounded-xl border border-border bg-card/40 space-y-2.5 text-center' },
          h('div', { className: 'inline-flex items-center justify-center w-9 h-9 rounded-full bg-secondary text-foreground mx-auto' }, icon('folder_open', 18)),
          h('div', { className: 'font-semibold text-xs' }, uiText('当前会话未关联文件夹', 'No folder linked to this chat')),
          h('div', { className: 'text-xs text-muted-foreground leading-relaxed' }, uiText('选择一个本地文件夹，或直接点击下方最近使用的项目查看文件结构。', 'Pick a local folder or select a recent project below to browse its file tree.')),
          h('div', { className: 'pt-1 flex items-center justify-center gap-2' },
            h('button', {
              type: 'button',
              className: 'agy-ftree-primary-btn w-full',
              'data-testid': 'agy-ftree-pick-folder',
              onClick: () => { void handlePickFolder(); }
            }, icon('folder', 15), h('span', null, uiText('选择文件夹', 'Choose folder'))),
            activeWsUri && choosingFolder ? h('button', {
              type: 'button',
              className: 'agy-ftree-sec-btn shrink-0',
              onClick: () => setChoosingFolder(false)
            }, uiText('返回', 'Back')) : null)),
        recents.length > 0 && h('div', { className: 'space-y-1', 'data-testid': 'agy-ftree-recent-projects' },
          h('div', { className: 'px-1.5 text-xs font-medium text-muted-foreground' }, uiText('最近使用的项目', 'Recent projects')),
          recents.map(item => h('button', {
            key: item.uri,
            type: 'button',
            className: 'agy-ftree-action-row',
            'data-testid': 'agy-ftree-recent-item',
            title: item.path || item.uri,
            onClick: () => { void selectWorkspace(item.uri); }
          },
            h('span', { className: 'flex items-center gap-2 min-w-0 flex-1' },
              h('span', { className: 'text-muted-foreground inline-flex' }, icon('folder', 15)),
              h('span', { className: 'min-w-0 flex-1' },
                h('div', { className: 'truncate font-medium text-xs' }, item.name),
                item.path ? h('div', { className: 'truncate text-xs text-muted-foreground opacity-80' }, shortPath(item.path)) : null))))));

      const renderPreviewPane = () => h('div', { className: 'flex-1 min-h-0 flex flex-col', 'data-testid': 'agy-ftree-preview' },
        h('div', { className: 'px-2.5 py-1.5 border-b border-border flex items-center justify-between gap-1.5 shrink-0' },
          h('button', {
            type: 'button',
            className: 'agy-ftree-sec-btn !h-6 !px-2 text-xs',
            'data-testid': 'agy-ftree-preview-back',
            onClick: () => { if (confirmDiscard()) { setDraft(null); setPreview(null); } }
          }, icon('arrow_back', 13), h('span', null, uiText('目录', 'Tree'))),
          h('span', { className: 'truncate text-xs font-medium flex-1 px-1', title: preview.path }, dirty ? `● ${preview.name}` : preview.name),
          h('div', { className: 'flex items-center gap-0.5 shrink-0' },
            draft !== null && h('button', {
              type: 'button',
              className: 'agy-ftree-sec-btn !h-6 !px-2 text-xs',
              'data-testid': 'agy-ftree-preview-save',
              disabled: !dirty || saving,
              onClick: () => { void saveDraft(); }
            }, saving ? uiText('保存中…', 'Saving…') : uiText('保存', 'Save')),
            draft !== null && h('button', {
              type: 'button',
              className: 'agy-ftree-iconbtn',
              title: uiText('退出编辑', 'Stop editing'),
              'data-testid': 'agy-ftree-preview-cancel',
              onClick: () => { if (confirmDiscard()) setDraft(null); }
            }, icon('close', 14)),
            draft === null && preview.kind === 'text' && preview.editable && h('button', {
              type: 'button',
              className: 'agy-ftree-iconbtn',
              title: uiText('编辑', 'Edit'),
              'data-testid': 'agy-ftree-preview-edit',
              onClick: () => setDraft(baseline)
            }, icon('edit', 14)),
            h('button', {
              type: 'button',
              className: 'agy-ftree-iconbtn',
              title: uiText('引用到输入框', 'Attach to chat'),
              'data-testid': 'agy-ftree-preview-attach',
              onClick: e => { void attachUriToChat(preview.uri, false, e.currentTarget); }
            }, icon('attach_file', 14)),
            h('button', {
              type: 'button',
              className: 'agy-ftree-iconbtn',
              title: uiText('在编辑器中打开', 'Open in editor'),
              'data-testid': 'agy-ftree-preview-editor',
              onClick: () => { void env.request('file.openEditor', { uri: preview.uri, source: 'file-tree' }).catch(err => env.notify?.({ title: uiText('打开失败', 'Open failed'), message: err?.message || '' })); }
            }, icon('code', 14)),
            h('button', {
              type: 'button',
              className: 'agy-ftree-iconbtn',
              title: uiText('用默认应用打开', 'Open with default app'),
              'data-testid': 'agy-ftree-preview-open',
              onClick: () => { void env.request('file.open', { uri: preview.uri, source: 'file-tree' }).catch(err => env.notify?.({ title: uiText('打开失败', 'Open failed'), message: err?.message || '' })); }
            }, icon('open_in_new', 14)))),
        draft !== null ? h('div', { className: 'flex-1 min-h-0 p-2.5 flex' },
          h('div', { className: 'flex-1 min-h-0 flex rounded-lg border border-border bg-card/30 overflow-hidden' },
            h('textarea', {
              className: 'agy-ftree-editor',
              'data-testid': 'agy-ftree-editor',
              'aria-label': uiText(`编辑 ${preview.name}`, `Edit ${preview.name}`),
              value: draft,
              wrap: 'off',
              spellCheck: false,
              autoCapitalize: 'off',
              autoComplete: 'off',
              autoCorrect: 'off',
              onChange: e => setDraft(e.target.value),
              onKeyDown: e => {
                if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 's') {
                  e.preventDefault();
                  e.stopPropagation();
                  void saveDraft();
                }
              }
            }))) :
        h('div', { className: 'agy-ftree-scroll p-2.5' },
          preview.kind === 'image' && h('div', { className: 'p-2 flex flex-col items-center gap-2' },
            h('img', { src: preview.dataUrl, alt: preview.name, className: 'max-w-full rounded-lg border border-border' }),
            h('span', { className: 'text-xs text-muted-foreground' }, formatBytes(preview.size))),
          preview.kind === 'notebook' && h('div', { className: 'space-y-2' },
            preview.cells.map(cell => h('div', { key: cell.index, className: 'rounded-lg border border-border bg-card/30 overflow-hidden' },
              h('div', { className: 'px-2.5 py-1 border-b border-border text-xs text-muted-foreground flex items-center justify-between' },
                h('span', null, cell.type === 'markdown' ? 'Markdown' : `In [${cell.executionCount ?? ' '}]`),
                h('span', null, `#${cell.index}`)),
              h('pre', { className: 'agy-ftree-code !whitespace-pre-wrap break-words' }, cell.source || ''),
              cell.output ? h('pre', { className: 'agy-ftree-code border-t border-border bg-secondary/40 !whitespace-pre-wrap break-words text-muted-foreground' }, cell.output) : null))),
          preview.kind === 'text' && h('div', { className: 'rounded-lg border border-border bg-card/30 overflow-hidden' },
            h('pre', { className: 'agy-ftree-code' }, preview.content || ''),
            preview.truncated ? h('div', { className: 'px-2.5 py-1.5 border-t border-border text-xs text-muted-foreground' }, uiText('文件较大，仅展示前 192 KB，可点右上角在编辑器打开完整文件。', 'Large file truncated at 192 KB. Open in editor to view all.')) : null),
          preview.kind === 'binary' && h('div', { className: 'p-4 rounded-xl border border-border bg-card/30 text-center space-y-2.5' },
            h('div', { className: 'text-xs font-medium' }, preview.name),
            h('div', { className: 'text-xs text-muted-foreground' }, formatBytes(preview.size)),
            h('button', {
              type: 'button',
              className: 'agy-ftree-primary-btn w-full',
              onClick: () => { void env.request('file.open', { uri: preview.uri, source: 'file-tree' }).catch(err => env.notify?.({ title: uiText('打开失败', 'Open failed'), message: err?.message || '' })); }
            }, icon('open_in_new', 14), h('span', null, uiText('用默认应用打开', 'Open with default app'))))));

      const renderTreeBody = () => {
        if (preview) return renderPreviewPane();
        if (!activeWsUri || choosingFolder) return renderFolderSelector();
        const filteredNodes = Array.isArray(searchEntries) ? buildSearchTree(searchEntries) : null;
        return h('div', { className: 'flex-1 min-h-0 flex flex-col', 'data-testid': 'agy-ftree-view' },
          h('div', { className: 'px-2.5 py-2 border-b border-border shrink-0' },
            h('div', { className: 'agy-ftree-pill' },
              icon('search', 14),
              h('input', {
                type: 'text',
                value: filterQuery,
                placeholder: uiText('筛选文件...', 'Filter files...'),
                'data-testid': 'agy-ftree-filter',
                onChange: e => setFilterQuery(e.target.value)
              }),
              filterQuery ? h('button', {
                type: 'button',
                className: 'agy-ftree-iconbtn !w-5 !h-5',
                onClick: () => setFilterQuery('')
              }, icon('close', 12)) : null)),
          h('div', { className: 'agy-ftree-scroll p-1.5' },
            loadingTree || loadingPreview
              ? h('div', { className: 'p-4 text-center text-xs text-muted-foreground' }, uiText('正在加载...', 'Loading...'))
              : treeError
                ? h('div', { className: 'p-3 text-xs text-muted-foreground space-y-2' },
                    h('div', null, treeError),
                    h('button', { type: 'button', className: 'agy-ftree-sec-btn w-full', onClick: () => { setChoosingFolder(true); void refreshRecents(); } }, uiText('重新选择文件夹', 'Choose another folder')))
                : filteredNodes
                  ? (filteredNodes.length ? renderFilteredTree(filteredNodes) : h('div', { className: 'p-4 text-center text-xs text-muted-foreground' }, uiText('未找到匹配文件', 'No matching files')))
                  : renderLazyTree('', 0)));
      };

      const headerTitle = preview
        ? preview.name
        : (rootData?.rootName || (activeWsUri ? decodeName(activeWsUri.split('/').filter(Boolean).pop() || '') : uiText('文件结构', 'File Tree')));

      return h('div', {
        className: 'agy-ftree-root',
        'data-agy-powertools-root': 'aux-file-tree',
        'data-testid': 'agy-aux-file-tree'
      },
        h('div', { className: 'agy-ftree-head' },
          h('span', { className: 'agy-ftree-title', title: rootData?.rootPath || activeWsUri || headerTitle }, headerTitle),
          h('div', { className: 'flex items-center gap-0.5 shrink-0' },
            !preview && h('button', {
              type: 'button',
              className: 'agy-ftree-iconbtn',
              title: uiText('切换或选择文件夹', 'Switch or choose folder'),
              'data-testid': 'agy-ftree-switch-folder',
              onClick: () => {
                const next = !choosingFolder;
                setChoosingFolder(next);
                if (next) void refreshRecents();
              }
            }, icon('folder_open', 15)),
            activeWsUri && !choosingFolder && !preview && h('button', {
              type: 'button',
              className: 'agy-ftree-iconbtn',
              title: uiText('刷新目录', 'Refresh'),
              'data-testid': 'agy-ftree-refresh',
              onClick: () => {
                for (const k of dirCache.keys()) if (k.startsWith(rootCacheKey)) dirCache.delete(k);
                void loadDirectory(activeWsUri, '', true);
              }
            }, icon('refresh', 15)))),
        renderTreeBody());
    }

    function EmptyHeader() {
      return null;
    }

    let lastRegisteredLabel = '';
    let lastRegisteredEnabled = false;

    function buildDescriptor(label) {
      return {
        toString: () => '{}',
        fromString: () => ({}),
        isEqual: () => true,
        title: label,
        icon: 'folder',
        getIcon: () => 'folder',
        MainHeader: EmptyHeader,
        Content: FileTreePane,
        hideFindInPane: true,
        plusMenuEntry: {
          label,
          icon: 'folder',
          serializedInputs: '{}'
        }
      };
    }

    function sync({ enabled = true } = {}) {
      const nextEnabled = Boolean(enabled);
      const label = env.uiText('文件结构', 'File Tree');
      if (!nextEnabled) {
        if (lastRegisteredEnabled) {
          env.adapter?.setCustomSidePanel?.(PANE_KEY, null);
          lastRegisteredEnabled = false;
          lastRegisteredLabel = '';
        }
        return;
      }
      const applied = env.adapter?.setCustomSidePanel?.(
        PANE_KEY,
        buildDescriptor(label),
        lastRegisteredEnabled && lastRegisteredLabel === label
      );
      if (applied) {
        lastRegisteredEnabled = true;
        lastRegisteredLabel = label;
      }
    }

    return {
      PANE_KEY,
      FileTreePane,
      sync,
      dispose() {
        env.adapter?.setCustomSidePanel?.(PANE_KEY, null);
        lastRegisteredEnabled = false;
        lastRegisteredLabel = '';
        styleEl?.remove?.();
      }
    };
  };
})();
