(() => {
  const EFFORT_STORAGE_KEY = 'agy.effortMemory.v1';
  const EFFORT_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  const CODE_FOLD_MIN_LINES = 48;
  const TABLE_PAGE_LIMIT = 100;
  const FONT_SPECIMEN_SIZES = [12, 16, 20, 28, 36, 48];
  const OMNI_EXT_KINDS = {
    mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video',
    mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio',
    png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', avif: 'image', bmp: 'image', ico: 'image',
    svg: 'svg',
    csv: 'table', tsv: 'table', jsonl: 'table', ndjson: 'table',
    pdf: 'pdf', html: 'html', htm: 'html',
    ttf: 'font', otf: 'font', woff: 'font', woff2: 'font'
  };
  const SENSITIVE_PATH_RE = /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|\.kube|\.env(?:\.[^\\/]*)?|thought-profiles\.json)(?:[\\/]|$)|\.(?:pem|key|p12|pfx)$/i;

  const DEFAULTS = {
    enabled: true,
    language: 'zh-CN',
    effortSlider: true,
    effortMemory: true,
    thoughtTranslate: 'off',
    thoughtTrigger: 'expand',
    thoughtView: 'bilingual',
    thoughtStyle: 'technical',
    thoughtCustomPrompt: '',
    translateSessionTitles: false,
    codeBlockFold: true,
    inlineStepDiff: true,
    railHoverOutline: true,
    quickContextMenu: true,
    omniViewer: true,
    linkTarget: 'builtin',
    homeStudio: false,
    chatModeBeta: false
  };

  function createWorkbench(env = {}) {
    let disposed = false;
    let syncedOptions = null;
    let syncTimer = null;
    let activeTurnIndex = -1;
    let railCloseTimer = null;
    let activeRailPopover = null;
    let activeRailAnchor = null;
    let activeQuickMenu = null;
    let activeOmniDrawer = null;
    let activeOmniFontStyle = null;
    let pickedMediaUrl = null;
    let omniFontSeq = 0;
    let activeStudioTab = 'overview';
    let sidebarSpaceMode = 'code';
    let chatFoldersState = { loaded: false, loading: false, folders: [], assignments: {}, selectedFolderId: 'all' };

    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const listenerOpts = ac ? { signal: ac.signal } : undefined;
    const styleId = 'agy-workbench-style';
    let styleEl = null;

    // Effort state
    let applyingEffortMemory = false;
    let pendingModelOverride = null;
    let lastHostSelectedLabel = '';
    const appliedPanelModelMap = new WeakMap();
    const observedEffortPanels = new WeakSet();

    // Thought translation state
    const thoughtStateMap = new WeakMap(); // container -> { text, translated, status, key, showOriginal, box, bodyEl }
    const trackedThoughtBoxes = new Set();
    const hiddenThoughtBodies = new Set();
    const thoughtInFlight = new Map();

    // Session title translation state (WeakMap snapshot + tracked Set for lossless restore)
    const titleOriginals = new WeakMap(); // el -> { text, hadTitleAttr, origTitleAttr }
    const trackedTitleEls = new Set();
    const titleInFlight = new Set();
    const titleCache = new Map(); // cacheKey -> translated

    // Code block fold state
    const stickyCodeHeaders = new Set();
    const foldedPreEls = new Set();
    const injectedCodeNodes = new Set();

    // Inline step diff state
    const diffDrawerMap = new WeakMap(); // row -> { drawer, open, loading, path }
    const injectedDiffNodes = new Set();

    // Rail outline state
    const boundRails = new WeakSet();

    // Bare URL / path highlight state
    let bareLinkEntries = [];

    // Chat mode draggable/hidden state
    const chatHiddenRows = new Set();
    const chatDraggableRestore = new WeakMap();
    const trackedChatRows = new Set();
    const dragBoundChatRows = new WeakSet();

    function getOpts() {
      const fromEnv = typeof env.options === 'function' ? (env.options() || {}) : (env.options || {});
      return { ...DEFAULTS, ...fromEnv, ...(syncedOptions || {}) };
    }

    function lang() {
      return getOpts().language || 'zh-CN';
    }

    function toTw(str) {
      if (lang() === 'zh-TW' && typeof globalThis.__agyToZhTw === 'function') {
        return globalThis.__agyToZhTw(str);
      }
      return str;
    }

    function tr(zh, en) {
      const l = lang();
      if (l === 'en') return en;
      if (typeof env.uiText === 'function' && (!syncedOptions || !syncedOptions.language)) {
        return env.uiText(zh, en);
      }
      return toTw(zh);
    }

    function currentConversationId() {
      const st = typeof env.state === 'function' ? env.state() : env.state;
      if (st?.conversationId) return String(st.conversationId);
      try {
        if (typeof location !== 'undefined' && typeof location.pathname === 'string') {
          const m = location.pathname.match(/^\/c\/([^/?#]+)/);
          if (m) return decodeURIComponent(m[1]);
        }
      } catch {}
      return '';
    }

    function currentWorkspaceUri(cid = '') {
      const st = typeof env.state === 'function' ? env.state() : env.state;
      if (typeof env.adapter?.workspaceUri === 'function') {
        try {
          const u = env.adapter.workspaceUri(cid || st?.conversationId || '');
          if (u) return String(u);
        } catch {}
      }
      return String(st?.workspaceUri || '');
    }

    function isEditableElement(el) {
      if (!el) return false;
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable === true) return true;
      const ce = el.getAttribute?.('contenteditable');
      if (ce === 'true' || ce === '') return true;
      if (el.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], .monaco-editor, .xterm')) {
        return true;
      }
      return false;
    }

    function encodePathSegments(path) {
      return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
    }

    function absoluteFileUri(path) {
      if (/^file:/i.test(path)) return stripUriQueryHash(path);
      if (/^[A-Za-z]:[\\/]/.test(path)) {
        return `file:///${path.slice(0, 2)}${encodePathSegments(path.slice(2).replaceAll('\\', '/'))}`;
      }
      const unc = path.match(/^(?:\\\\|\/\/)([^\\/]+)([\\/].+)$/);
      if (unc) return `file://${encodeURIComponent(unc[1])}${encodePathSegments(unc[2].replaceAll('\\', '/'))}`;
      if (path.startsWith('/')) return `file://${encodePathSegments(path)}`;
      return '';
    }

    function toFileUri(pathOrUri, workspaceUri = '') {
      const raw = String(pathOrUri || '').trim();
      if (!raw || /^(?:file:|https?:\/\/)/i.test(raw)) return raw;
      const absolute = absoluteFileUri(raw);
      if (absolute) return absolute;
      const ws = stripUriQueryHash(workspaceUri || currentWorkspaceUri());
      if (/^file:/i.test(ws)) {
        const base = ws.endsWith('/') ? ws : `${ws}/`;
        return base + encodePathSegments(raw.replaceAll('\\', '/').replace(/^\.\//, ''));
      }
      return raw;
    }

    function stripUriQueryHash(uriOrPath) {
      const raw = String(uriOrPath || '').trim();
      return /^(?:file:|https?:\/\/)/i.test(raw) ? raw.split(/[?#]/)[0] : raw;
    }

    function stripUriMeta(uriOrPath) {
      const base = stripUriQueryHash(uriOrPath);
      if (!/^file:\/\//i.test(base)) return base;
      const withoutScheme = base.replace(/^file:\/\//i, '');
      const normalized = /^\/[A-Za-z]:\//.test(withoutScheme) ? withoutScheme.slice(1) : withoutScheme;
      try {
        return decodeURIComponent(normalized);
      } catch {
        return normalized;
      }
    }

    function extOf(uriOrPath) {
      const clean = stripUriMeta(uriOrPath);
      if (!clean || clean.endsWith('/') || clean.endsWith('\\')) return '';
      const dot = clean.lastIndexOf('.');
      const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
      if (dot <= slash || dot === clean.length - 1) return '';
      return clean.slice(dot + 1).toLowerCase();
    }

    function canOmniPreview(uriOrPath) {
      const opts = getOpts();
      if (!opts.enabled || !opts.omniViewer) return false;
      const raw = String(uriOrPath || '').trim();
      if (!raw) return false;
      if (/^https?:\/\//i.test(raw)) return true;
      const clean = stripUriMeta(raw);
      if (!clean || clean.endsWith('/') || clean.endsWith('\\')) return false;
      if (SENSITIVE_PATH_RE.test(clean)) return false;
      const ext = extOf(clean);
      return Boolean(ext && Object.prototype.hasOwnProperty.call(OMNI_EXT_KINDS, ext));
    }

    function copyText(value) {
      const str = String(value || '');
      if (!str) return Promise.resolve(false);
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(str).then(() => true).catch(() => false);
      }
      return Promise.resolve(false);
    }

    function notifyUser(title, message, tag = 'agy-workbench') {
      try {
        env.notify?.({ title, message, tag });
      } catch {}
    }

    function el(tag, attrs = {}, ...children) {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'className') node.className = v;
        else if (k === 'textContent') node.textContent = String(v);
        else if (k === 'style' && typeof v === 'object') {
          if (node.style) Object.assign(node.style, v);
        } else if (k === 'style' && typeof v === 'string') {
          if (node.style) node.style.cssText = v;
        } else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset' && typeof v === 'object') {
          for (const [dk, dv] of Object.entries(v)) {
            if (node.dataset) node.dataset[dk] = String(dv);
            node.setAttribute?.(`data-${dk.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`, String(dv));
          }
        } else {
          node.setAttribute?.(k, v === true ? '' : String(v));
        }
      }
      for (const child of children.flat()) {
        if (child === undefined || child === null || child === false) continue;
        if (typeof child === 'string' || typeof child === 'number') {
          node.appendChild?.(document.createTextNode ? document.createTextNode(String(child)) : String(child));
        } else {
          node.appendChild?.(child);
        }
      }
      return node;
    }

    function injectStyles() {
      if (styleEl && styleEl.isConnected) return;
      if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;
      styleEl = document.createElement('style');
      styleEl.setAttribute?.('data-agy-workbench-style', '1');
      styleEl.id = styleId;
      styleEl.textContent = `
        /* Effort Slider (1:1 Codex Two-Stage Popover & Smooth Glide Track) */
        @keyframes agy-effort-pop{0%{transform:translateY(2px);opacity:.55}100%{transform:none;opacity:1}}
        .agy-effort-sep{display:none!important}
        .agy-effort-bar{margin:0;padding:2px 2px 3px;border:0;border-radius:14px;background:transparent;display:flex;flex-direction:column;align-items:stretch;gap:9px;font-size:13px;color:var(--foreground);user-select:none}
        .agy-codex-model-switch{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;align-self:center;min-width:128px;max-width:100%;margin:0 auto;padding:2px 10px 3px;border:0;border-radius:10px;background:transparent;color:var(--foreground);font:inherit;cursor:pointer;outline:none;transition:transform 120ms ease}
        .agy-codex-model-switch:hover,.agy-codex-model-switch:focus-visible{background:transparent}
        .agy-codex-model-switch:hover .agy-codex-model-sub,.agy-codex-model-switch:focus-visible .agy-codex-model-sub{color:color-mix(in srgb,var(--foreground) 82%,transparent)}
        .agy-codex-model-switch:active{transform:scale(.98)}
        .agy-effort-val{font-size:14px;line-height:1.28;font-weight:600;color:#0066cc;transition:color 140ms ease}
        .dark .agy-effort-val{color:#4da3ff}
        .agy-effort-val[data-pop="1"]{animation:agy-effort-pop 180ms cubic-bezier(.22,1,.36,1)}
        .agy-codex-model-sub{display:inline-flex;align-items:center;justify-content:center;gap:2px;max-width:196px;font-size:12px;line-height:1.32;font-weight:400;color:color-mix(in srgb,var(--foreground) 58%,transparent);transition:color 140ms ease}
        .agy-codex-model-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:176px}
        .agy-codex-model-chev{width:11px;height:11px;flex-shrink:0;opacity:.75}
        .agy-effort-track{position:relative;width:100%;height:24px;margin:0;border-radius:999px;background:color-mix(in srgb,var(--foreground) 8.5%,transparent);cursor:pointer;touch-action:none;outline:none;transition:opacity 160ms ease,box-shadow 160ms ease}
        .dark .agy-effort-track{background:rgba(255,255,255,.12)}
        .agy-effort-track:focus-visible{box-shadow:0 0 0 2px rgba(0,113,227,.38)}
        .agy-effort-bar[data-locked="true"] .agy-effort-track{opacity:.48;cursor:not-allowed}
        .agy-effort-fill{position:absolute;top:0;left:0;bottom:0;width:var(--agy-fill-w,24px);border-radius:999px;background:#0071e3;pointer-events:none;will-change:width;transition:width 220ms cubic-bezier(.22,1,.36,1),background-color 160ms ease}
        .dark .agy-effort-fill{background:#0a84ff}
        .agy-effort-bar[data-dragging="1"] .agy-effort-fill,.agy-effort-bar[data-dragging="1"] .agy-effort-knob{transition:none!important}
        .agy-effort-bar[data-dragging="1"] .agy-effort-knob{transform:scale(1.06)}
        .agy-effort-dots{position:absolute;inset:0;pointer-events:none}
        .agy-effort-dot{position:absolute;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:color-mix(in srgb,var(--foreground) 28%,transparent);transition:background-color 160ms ease}
        .dark .agy-effort-dot{background:rgba(255,255,255,.28)}
        .agy-effort-dot[data-on="1"]{background:rgba(255,255,255,.65)}
        .agy-effort-knob{position:absolute;top:50%;left:var(--agy-knob-x,12px);width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#ffffff;box-shadow:0 1px 4px rgba(0,0,0,.24),0 0 0 .5px rgba(0,0,0,.08);pointer-events:none;will-change:left;transition:left 220ms cubic-bezier(.22,1,.36,1),transform 140ms cubic-bezier(.22,1,.36,1)}
        .agy-effort-ticks{position:absolute;inset:0;pointer-events:none}
        .agy-effort-tick{position:absolute;top:0;bottom:0;width:28px;transform:translateX(-50%);padding:0;border:0;border-radius:999px;background:transparent;color:transparent;font-size:0;cursor:pointer;pointer-events:auto;outline:none}
        .agy-effort-tick:first-child{transform:translateX(-12px)}
        .agy-effort-tick:last-child{transform:translateX(calc(12px - 100%))}
        .agy-effort-prism{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 8px;border-radius:10px;background:transparent}
        html[data-agy-effort-slider-ready="1"] [role="menu"]:has([data-testid="model-selector-effort-option"]):not(:has([data-testid="model-selector-panel"])),
        html[data-agy-effort-slider-ready="1"] div[role="presentation"]:has(>[role="menu"] [data-testid="model-selector-effort-option"]):not(:has([data-testid="model-selector-panel"])){display:none!important;visibility:hidden!important;pointer-events:none!important;opacity:0!important}
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-panel"][data-agy-codex-stage]{background:transparent!important}
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-panel"][data-agy-codex-stage="effort"] > :not([data-agy-effort-slider="1"]){display:none!important}
        @layer theme {
          html[data-agy-effort-slider-ready="1"] [data-agy-codex-popup="effort"],
          html[data-agy-effort-slider-ready="1"] [role="menu"]:has([data-testid="model-selector-panel"][data-agy-codex-stage="effort"]),
          html[data-agy-effort-slider-ready="1"] [role="dialog"]:has([data-testid="model-selector-panel"][data-agy-codex-stage="effort"]){min-width:228px!important;width:228px!important;max-width:248px!important;padding:10px 12px 12px!important;border-radius:18px!important;background:#ffffff!important;border:1px solid rgba(0,0,0,.08)!important;box-shadow:0 10px 30px rgba(0,0,0,.10),0 2px 8px rgba(0,0,0,.05)!important}
          .dark[data-agy-effort-slider-ready="1"] [data-agy-codex-popup="effort"],
          .dark[data-agy-effort-slider-ready="1"] [role="menu"]:has([data-testid="model-selector-panel"][data-agy-codex-stage="effort"]),
          .dark[data-agy-effort-slider-ready="1"] [role="dialog"]:has([data-testid="model-selector-panel"][data-agy-codex-stage="effort"]){background:var(--popover,#1c1c1e)!important;border-color:rgba(255,255,255,.12)!important}
          html[data-agy-effort-slider-ready="1"] [data-agy-codex-popup="models"],
          html[data-agy-effort-slider-ready="1"] [role="menu"]:has([data-testid="model-selector-panel"][data-agy-codex-stage="models"]),
          html[data-agy-effort-slider-ready="1"] [role="dialog"]:has([data-testid="model-selector-panel"][data-agy-codex-stage="models"]){min-width:256px!important;width:max-content!important;max-width:320px!important;padding:6px!important;border-radius:18px!important;background:#ffffff!important;border:1px solid rgba(0,0,0,.08)!important;box-shadow:0 10px 30px rgba(0,0,0,.10),0 2px 8px rgba(0,0,0,.05)!important}
          .dark[data-agy-effort-slider-ready="1"] [data-agy-codex-popup="models"],
          .dark[data-agy-effort-slider-ready="1"] [role="menu"]:has([data-testid="model-selector-panel"][data-agy-codex-stage="models"]),
          .dark[data-agy-effort-slider-ready="1"] [role="dialog"]:has([data-testid="model-selector-panel"][data-agy-codex-stage="models"]){background:var(--popover,#1c1c1e)!important;border-color:rgba(255,255,255,.12)!important}
        }
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-panel"][data-agy-codex-stage="models"] [data-agy-effort-slider="1"],
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-panel"][data-agy-codex-stage="models"] [data-agy-effort-sep="1"],
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-panel"][data-agy-codex-stage="models"] > [role="separator"],
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-panel"][data-agy-codex-stage="models"] > div:nth-child(n+2):not([data-agy-effort-slider="1"]){display:none!important}
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-header"][data-agy-codex-header]{font-size:0!important;padding:6px 10px 6px!important}
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-header"][data-agy-codex-header]::after{content:attr(data-agy-codex-header);font-size:13px;font-weight:500;color:var(--muted-foreground)}
        html[data-agy-effort-slider-ready="1"] [role="menuitem"]:has([data-testid="model-selector-effort-group"]) > span.shrink-0:last-child,
        html[data-agy-effort-slider-ready="1"] [role="menuitem"] [data-testid="model-selector-effort-group"] + span{display:none!important}
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-panel"] [role="menuitem"]{border-radius:10px!important;padding-block:7px!important;padding-inline:10px!important;background:transparent!important}
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-panel"] [role="menuitem"]:hover,
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-panel"] [role="menuitem"]:focus-visible,
        html[data-agy-effort-slider-ready="1"] [data-testid="model-selector-panel"] [role="menuitem"][data-highlighted]{background:color-mix(in srgb,var(--foreground) 6%,transparent)!important}
        html[data-agy-codex-selector="1"] [data-testid="model-selector-trigger"]{padding:0 10px!important;border-radius:999px!important;gap:4px!important;color:var(--foreground)!important;font-weight:500!important}
        html[data-agy-codex-selector="1"] [data-testid="model-selector-trigger"] > .google-symbols:last-of-type,
        html[data-agy-codex-selector="1"] [data-testid="model-selector-trigger"] > [data-icon]:last-of-type,
        html[data-agy-codex-selector="1"] [data-testid="model-selector-trigger"] > svg:last-of-type{display:none!important}
        html[data-agy-codex-selector="1"] [data-testid="model-selector-trigger"] span[data-agy-effort-display]{font-size:0!important;opacity:1!important;font-weight:400!important}
        html[data-agy-codex-selector="1"] [data-testid="model-selector-trigger"] span[data-agy-effort-display]::after{content:attr(data-agy-effort-display);font-size:13px;font-weight:400;color:color-mix(in srgb,var(--foreground) 48%,transparent)}
        html[data-agy-codex-selector="1"] [data-testid="model-selector-trigger"][data-agy-codex-open="effort"]{min-width:144px!important;padding:0 18px!important;justify-content:center!important;background:color-mix(in srgb,var(--foreground) 6.5%,transparent)!important}
        html[data-agy-codex-selector="1"] [data-testid="model-selector-trigger"][data-agy-codex-open="effort"] > *{display:none!important}
        html[data-agy-codex-selector="1"] [data-testid="model-selector-trigger"][data-agy-codex-open="effort"]::after{content:attr(data-agy-effort-prompt);font-size:13px;font-weight:400;color:color-mix(in srgb,var(--foreground) 54%,transparent);white-space:nowrap}
        html[data-agy-codex-selector="1"] [data-testid="model-selector-trigger"][data-agy-codex-open="models"]{background:color-mix(in srgb,var(--foreground) 6.5%,transparent)!important}
        html[data-agy-codex-selector="1"]:not(:has([data-testid="model-selector-trigger"][data-agy-codex-open="models"])) [data-testid="model-selector-panel"]:not([data-agy-codex-stage]){opacity:0!important;pointer-events:none!important}
        @media (prefers-reduced-motion:reduce){.agy-effort-fill,.agy-effort-knob,.agy-effort-val[data-pop="1"]{transition:none!important;animation:none!important}}

        /* Thought Translator */
        [data-agy-thought-hidden="1"]{display:none!important}
        .agy-thought-box{margin:6px 0 8px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:color-mix(in srgb,var(--secondary) 40%,var(--card));color:var(--foreground);font-size:12.5px;line-height:1.55;display:flex;flex-direction:column;gap:8px}
        .agy-thought-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--muted-foreground);padding-bottom:6px;border-bottom:1px solid color-mix(in srgb,var(--border) 75%,transparent)}
        .agy-thought-actions{display:inline-flex;align-items:center;gap:6px}
        .agy-thought-btn{padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--foreground);font:inherit;font-size:11px;cursor:pointer;transition:background 120ms ease}
        .agy-thought-btn:hover{background:var(--secondary)}
        .agy-thought-pair{display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-radius:7px;background:color-mix(in srgb,var(--background) 65%,transparent);border:1px solid color-mix(in srgb,var(--border) 60%,transparent)}
        .agy-thought-orig{font-size:11.5px;color:var(--muted-foreground);white-space:pre-wrap;word-break:break-word}
        .agy-thought-trans{font-size:12.5px;color:var(--foreground);white-space:pre-wrap;word-break:break-word}
        .agy-thought-file-pill{display:inline-flex;align-items:center;gap:3px;padding:0 6px;margin:0 2px;border-radius:5px;border:1px solid color-mix(in srgb,var(--primary) 32%,var(--border));background:color-mix(in srgb,var(--primary) 11%,transparent);color:var(--primary);font-family:var(--font-mono,ui-monospace,monospace);font-size:11px;line-height:1.6;cursor:pointer;vertical-align:baseline}
        .agy-thought-file-pill:hover{background:color-mix(in srgb,var(--primary) 20%,transparent)}

        /* Code Block Sticky Header & Manual Fold */
        html[data-agy-code-fold] .agy-code-sticky-header{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--card) 92%,transparent);backdrop-filter:blur(6px)}
        .agy-code-synth-header{display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:4px 8px;border-bottom:1px solid var(--border);border-radius:8px 8px 0 0;font-size:11px}
        .agy-code-fold-btn{padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:var(--secondary);color:var(--foreground);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
        .agy-code-fold-btn:hover{background:color-mix(in srgb,var(--primary) 15%,var(--secondary))}
        pre[data-agy-code-folded="1"]{max-height:112px!important;overflow:hidden!important;position:relative;mask-image:linear-gradient(to bottom,#000 55%,transparent 100%);-webkit-mask-image:linear-gradient(to bottom,#000 55%,transparent 100%)}

        /* Inline Step Diff */
        .agy-diff-toggle-btn{margin-left:6px;padding:1px 7px;border-radius:5px;border:1px solid var(--border);background:var(--secondary);color:var(--foreground);font:inherit;font-size:11px;cursor:pointer}
        .agy-diff-toggle-btn:hover{border-color:var(--primary);color:var(--primary)}
        .agy-inline-diff-drawer{margin:6px 0 8px;border-radius:8px;border:1px solid var(--border);background:color-mix(in srgb,var(--secondary) 48%,var(--background));overflow:hidden;font-size:11.5px}
        .agy-inline-diff-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border);background:var(--card)}
        .agy-inline-diff-path{font-family:var(--font-mono,ui-monospace,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--foreground)}
        .agy-inline-diff-body{max-height:260px;overflow:auto;font-family:var(--font-mono,ui-monospace,monospace);font-size:11px;line-height:1.48}
        .agy-inline-diff-notice{padding:10px 12px;color:var(--muted-foreground)}

        /* Rail Hover Outline Popover */
        .agy-rail-popover{position:fixed;z-index:9140;width:300px;max-height:420px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--foreground);box-shadow:0 12px 32px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden;font-size:12px}
        .agy-rail-pop-head{display:flex;align-items:center;gap:6px;padding:8px;border-bottom:1px solid var(--border)}
        .agy-rail-filter{flex:1;min-width:0;height:28px;padding:0 9px;border-radius:7px;border:1px solid var(--border);background:var(--background);color:var(--foreground);font:inherit;font-size:12px;outline:none}
        .agy-rail-filter:focus{border-color:var(--primary)}
        .agy-rail-collapse-btn{flex-shrink:0;height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--border);background:var(--secondary);color:var(--foreground);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
        .agy-rail-list{overflow-y:auto;padding:4px 6px 6px;display:flex;flex-direction:column;gap:2px}
        .agy-rail-chapter{padding:5px 6px 2px;font-size:10.5px;font-weight:600;color:var(--muted-foreground);letter-spacing:.02em;user-select:none}
        .agy-rail-item{display:flex;align-items:center;gap:7px;width:100%;padding:6px 8px;border:0;border-radius:7px;background:transparent;color:var(--foreground);text-align:left;cursor:pointer;font:inherit;font-size:12px}
        .agy-rail-item:hover{background:var(--secondary)}
        .agy-rail-num{flex-shrink:0;min-width:20px;font-size:10.5px;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
        .agy-rail-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

        /* Unified Quick Context Menu */
        .agy-qmenu{position:fixed;z-index:9300;min-width:196px;padding:5px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--foreground);box-shadow:0 12px 30px rgba(0,0,0,.24);display:flex;flex-direction:column;gap:2px;font-size:12.5px}
        .agy-qmenu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:6px 10px;border:0;border-radius:7px;background:transparent;color:var(--foreground);text-align:left;cursor:pointer;font:inherit;font-size:12.5px}
        .agy-qmenu-item:hover,.agy-qmenu-item:focus-visible{background:var(--secondary);outline:none}
        .agy-qmenu-sep{height:1px;margin:3px 6px;background:var(--border)}

        /* Bare URL / Path Highlight */
        ::highlight(agy-omni-link){color:var(--primary);text-decoration:underline;text-decoration-style:dotted}

        /* Omni Right-Pane Streaming Viewer Drawer */
        .agy-omni-drawer{width:min(560px,calc(100vw - 24px));z-index:9130}
        .agy-omni-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:12px 14px}
        .agy-omni-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11.5px}
        .agy-omni-btn{padding:4px 9px;border-radius:7px;border:1px solid var(--border);background:var(--secondary);color:var(--foreground);font:inherit;font-size:11.5px;cursor:pointer}
        .agy-omni-btn[aria-pressed="true"]{border-color:var(--primary);color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,var(--secondary))}
        .agy-omni-video,.agy-omni-audio{width:100%;border-radius:8px;background:#000}
        .agy-omni-waveform{width:100%;height:84px;border-radius:8px;border:1px solid var(--border);background:color-mix(in srgb,var(--secondary) 45%,var(--background));cursor:pointer;display:block}
        .agy-omni-checkerboard{position:relative;flex:1;min-height:260px;overflow:hidden;border-radius:8px;border:1px solid var(--border);background-image:linear-gradient(45deg,rgba(128,128,128,.12) 25%,transparent 25%),linear-gradient(-45deg,rgba(128,128,128,.12) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(128,128,128,.12) 75%),linear-gradient(-45deg,transparent 75%,rgba(128,128,128,.12) 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;display:flex;align-items:center;justify-content:center;cursor:grab}
        .agy-omni-table-wrap{flex:1;min-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px}
        .agy-omni-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
        .agy-omni-table thead th{position:sticky;top:0;z-index:2;background:var(--card);border-bottom:1px solid var(--border);padding:7px 9px;text-align:left;font-weight:600;white-space:nowrap}
        .agy-omni-table tbody td{padding:6px 9px;border-bottom:1px solid color-mix(in srgb,var(--border) 65%,transparent);white-space:nowrap}
        .agy-omni-iframe{flex:1;width:100%;min-height:420px;border:1px solid var(--border);border-radius:8px;background:#fff}
        .agy-omni-font-row{padding:8px 10px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:4px}
        .agy-omni-font-size{font-size:10.5px;color:var(--muted-foreground);font-family:var(--font-mono,ui-monospace,monospace)}

        /* Home Studio Dashboard */
        .agy-home-studio{width:100%;max-width:720px;margin:14px auto 0;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--foreground);overflow:hidden;font-size:12.5px}
        .agy-studio-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap}
        .agy-studio-tabs{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:8px;border:1px solid var(--border);background:color-mix(in srgb,var(--secondary) 40%,transparent)}
        .agy-studio-tab{padding:3px 10px;border:0;border-radius:6px;background:transparent;color:var(--muted-foreground);font:inherit;font-size:12px;cursor:pointer}
        .agy-studio-tab[aria-selected="true"]{background:var(--secondary);color:var(--foreground);font-weight:600}
        .agy-studio-body{padding:12px 14px}
        .agy-studio-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
        .agy-studio-kpi{padding:10px;border-radius:9px;background:color-mix(in srgb,var(--secondary) 48%,transparent);display:flex;flex-direction:column;gap:4px}
        .agy-studio-kpi-val{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
        .agy-studio-bars{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;align-items:end;height:92px;padding-top:8px}
        .agy-studio-bar-col{display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end}
        .agy-studio-bar-fill{width:100%;max-width:28px;border-radius:5px 5px 2px 2px;background:var(--primary);min-height:3px}
        .agy-studio-quota-list{display:flex;flex-direction:column;gap:8px}
        .agy-studio-quota-row{display:flex;flex-direction:column;gap:4px}
        .agy-studio-quota-bar{height:6px;border-radius:9999px;background:var(--secondary);overflow:hidden}
        .agy-studio-quota-fill{height:100%;background:var(--primary);border-radius:inherit}

        /* Chat Mode Beta Sidebar */
        .agy-chat-mode-wrap{padding:6px 8px 4px;display:flex;flex-direction:column;gap:6px}
        .agy-chat-seg{display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:2px;border-radius:8px;border:1px solid var(--border);background:color-mix(in srgb,var(--secondary) 40%,transparent)}
        .agy-chat-seg-btn{height:26px;border:0;border-radius:6px;background:transparent;color:var(--muted-foreground);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
        .agy-chat-seg-btn[aria-pressed="true"]{background:var(--card);color:var(--foreground);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
        .agy-chat-folders{display:flex;flex-direction:column;gap:5px;padding:6px 8px 8px;border-bottom:1px solid var(--border)}
        .agy-chat-folder-list{display:flex;flex-wrap:wrap;gap:4px}
        .agy-chat-folder-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:9999px;border:1px solid var(--border);background:var(--card);color:var(--foreground);font:inherit;font-size:11.5px;cursor:pointer}
        .agy-chat-folder-chip[aria-pressed="true"]{border-color:var(--primary);background:color-mix(in srgb,var(--primary) 14%,var(--card));color:var(--primary);font-weight:600}
        .agy-chat-folder-chip[data-drag-over="1"]{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 26%,transparent)}
        .agy-chat-folder-form{display:flex;align-items:center;gap:4px}
        .agy-chat-folder-input{flex:1;min-width:0;height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--border);background:var(--background);color:var(--foreground);font:inherit;font-size:11.5px}
        .agy-chat-assign-select{margin-left:4px;height:20px;max-width:84px;border-radius:5px;border:1px solid var(--border);background:var(--card);color:var(--muted-foreground);font-size:10.5px}
        [data-agy-chat-hidden="1"]{display:none!important}
      `;
      document.head.appendChild(styleEl);
    }

    // =========================================================================
    // 1. Model Reasoning Effort Slider & Per-Model Effort Memory
    // =========================================================================
    function readEffortMemory() {
      try {
        if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return {};
        const raw = localStorage.getItem(EFFORT_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }

    function writeEffortMemory(map) {
      try {
        if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
        localStorage.setItem(EFFORT_STORAGE_KEY, JSON.stringify(map || {}));
      } catch {}
    }

    function normalizeEffortKey(raw) {
      const s = String(raw || '').trim().replace(/^[(\uff08]+|[)\uff09]+$/g, '').trim();
      if (!s || s.length > 40) return '';
      if (/\b(?:gemini|claude|gpt|opus|sonnet|haiku|orchestrator|model)\b/i.test(s)) return '';
      if (/^(?:effort[:\s-]*)?(?:extra[\s_-]*high|x[\s_-]*high|xhigh|extra|极高|極高|超高|超深)(?:\s|$|-)/i.test(s)) return 'xhigh';
      if (/^(?:effort[:\s-]*)?(?:max|最大|最高)(?:\s|$|-)/i.test(s)) return 'max';
      if (/^(?:effort[:\s-]*)?(?:high|高|高思考|高推理)(?:\s|$|-)/i.test(s)) return 'high';
      if (/^(?:effort[:\s-]*)?(?:medium|med|中|中等|中思考)(?:\s|$|-)/i.test(s)) return 'medium';
      if (/^(?:effort[:\s-]*)?(?:minimal|极低|極低|最低|最小)(?:\s|$|-)/i.test(s)) return 'minimal';
      if (/^(?:effort[:\s-]*)?(?:low|低|低思考)(?:\s|$|-)/i.test(s)) return 'low';
      if (/^(?:effort[:\s-]*)?(?:off|关闭|關閉|关)(?:\s|$|-)/i.test(s)) return 'off';
      return '';
    }

    function effortLabel(key) {
      if (key === 'off') return tr('关闭', 'Off');
      if (key === 'minimal') return tr('极低', 'Minimal');
      if (key === 'low') return tr('低', 'Low');
      if (key === 'medium') return tr('中', 'Medium');
      if (key === 'high') return tr('高', 'High');
      if (key === 'xhigh') return tr('极高', 'Extra High');
      if (key === 'max') return tr('最高', 'Max');
      if (key === 'fixed') return tr('固定', 'Fixed');
      return key;
    }

    function effortEnglishLabel(key) {
      const map = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', fixed: 'Fixed' };
      return map[key] || key;
    }

    function effortVisualPalette(key, isMax, isClaude) {
      if (isMax) {
        return {
          color: isClaude ? '#a855f7' : '#8b5cf6',
          bg: isClaude
            ? 'linear-gradient(90deg,#c26444,#a855f7 56%,#8b5cf6)'
            : 'linear-gradient(90deg,#4c1d95,#7c3aed 42%,#9333ea 72%,#c084fc)'
        };
      }
      if (isClaude) {
        if (key === 'high') return { color: '#9f67ff', bg: 'linear-gradient(90deg,#d97757,#a78bfa)' };
        if (key === 'medium') return { color: '#d97757', bg: 'linear-gradient(90deg,#e08b6a,#d97757)' };
        return { color: '#b4745c', bg: 'linear-gradient(90deg,#c89582,#d97757)' };
      }
      if (key === 'high') return { color: '#6366f1', bg: 'linear-gradient(90deg,#3b82f6,#6366f1)' };
      if (key === 'medium') return { color: '#3b82f6', bg: 'linear-gradient(90deg,#60a5fa,#3b82f6)' };
      if (key === 'low' || key === 'minimal') return { color: '#64748b', bg: 'linear-gradient(90deg,#94a3b8,#60a5fa)' };
      return { color: '#64748b', bg: 'linear-gradient(90deg,#94a3b8,#64748b)' };
    }

    function normalizeModelKey(raw) {
      const s = String(raw || '')
        .replace(/[(\uff08]\s*(?:off|minimal|low|medium|med|high|xhigh|extra\s+high|max|thinking|低|中|中等|高|极高|極高|超高|最高|极低|关闭)\s*[)\uff09]/gi, '')
        .replace(/[-_\s]+(?:off|minimal|low|medium|high|xhigh|extra\s+high|max|minimal)$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      return s;
    }

    function parseModelOptionLabel(raw) {
      const s = String(raw || '').trim();
      if (!s) return null;
      const paren = s.match(/^(.*?)\s*[(\uff08]([^()\uff08\uff09]+)[)\uff09]\s*$/);
      if (paren) {
        const eff = normalizeEffortKey(paren[2]);
        if (eff) return { base: paren[1].trim(), effort: eff };
      }
      const tail = s.match(/^(.*?)\s+(Extra\s+High|XHigh|High|Medium|Low|Minimal|Max|Off|极高|極高|超高|高|中|中等|低|极低|关闭)$/i);
      if (tail) {
        const eff = normalizeEffortKey(tail[2]);
        if (eff) return { base: tail[1].trim(), effort: eff };
      }
      return null;
    }

    function isClaudeModelName(name) {
      return /\b(?:claude|anthropic|opus|sonnet|haiku)\b/i.test(String(name || ''));
    }

    function isOrchestratorName(name) {
      return /\borchestrator\b|编排|調度/i.test(String(name || ''));
    }

    function setEffortSliderReadyAttr(ready) {
      const html = document?.documentElement;
      if (!html) return;
      if (ready) {
        if (html.getAttribute?.('data-agy-effort-slider-ready') !== '1') {
          html.setAttribute?.('data-agy-effort-slider-ready', '1');
        }
      } else if (html.hasAttribute?.('data-agy-effort-slider-ready')) {
        html.removeAttribute?.('data-agy-effort-slider-ready');
      }
    }

    const panelStageMap = new Map();

    function clearPopupStageAttrs() {
      for (const pop of document.querySelectorAll?.('[data-agy-codex-popup]') || []) {
        pop.removeAttribute?.('data-agy-codex-popup');
      }
      for (const p of document.querySelectorAll?.('[data-agy-codex-stage]') || []) {
        p.removeAttribute?.('data-agy-codex-stage');
      }
      panelStageMap.clear();
    }

    function setCodexSelectorAttr(active) {
      const html = document?.documentElement;
      if (!html) return;
      if (active) {
        if (html.getAttribute?.('data-agy-codex-selector') !== '1') {
          html.setAttribute?.('data-agy-codex-selector', '1');
        }
      } else if (html.hasAttribute?.('data-agy-codex-selector')) {
        html.removeAttribute?.('data-agy-codex-selector');
      }
    }

    function clearTriggerEffortTint() {
      setCodexSelectorAttr(false);
      const triggers = document.querySelectorAll?.('[data-testid="model-selector-trigger"]') || [];
      for (const trBtn of triggers) {
        trBtn.removeAttribute?.('data-agy-codex-open');
        trBtn.removeAttribute?.('data-agy-effort-prompt');
        for (const sp of trBtn.querySelectorAll?.('[data-agy-effort-tint="1"], [data-agy-effort-display]') || []) {
          if (sp.style) {
            sp.style.color = '';
            sp.style.fontWeight = '';
          }
          sp.removeAttribute?.('data-agy-effort-tint');
          sp.removeAttribute?.('data-agy-effort-display');
        }
      }
      for (const hdr of document.querySelectorAll?.('[data-testid="model-selector-header"][data-agy-codex-header]') || []) {
        hdr.removeAttribute?.('data-agy-codex-header');
      }
      clearPopupStageAttrs();
    }

    function findActiveModelTrigger() {
      return document.querySelector?.('[data-testid="model-selector-trigger"][aria-expanded="true"], [data-testid="model-selector-trigger"][data-state="open"]')
        || document.querySelector?.('[data-testid="model-selector-trigger"]')
        || null;
    }

    function syncTriggerEffortTint(activeKey, _isMax, _isClaude, openStage = '') {
      setCodexSelectorAttr(true);
      const triggers = [...(document.querySelectorAll?.('[data-testid="model-selector-trigger"]') || [])];
      const activeTrigger = findActiveModelTrigger();
      for (const trBtn of triggers) {
        const isCurrent = trBtn === activeTrigger;
        const isOpen = isCurrent && Boolean(openStage);
        if (isOpen) {
          trBtn.setAttribute?.('data-agy-codex-open', openStage);
          if (openStage === 'effort') {
            trBtn.setAttribute?.('data-agy-effort-prompt', tr('选择推理强度', 'Choose reasoning effort'));
          } else {
            trBtn.removeAttribute?.('data-agy-effort-prompt');
          }
        } else {
          trBtn.removeAttribute?.('data-agy-codex-open');
          trBtn.removeAttribute?.('data-agy-effort-prompt');
        }
        const spans = [...(trBtn.querySelectorAll?.('span') || [])];
        const effSpan = spans.find(sp => !sp.children?.length && normalizeEffortKey(sp.textContent));
        if (effSpan) {
          const detected = isCurrent && activeKey && activeKey !== 'fixed' ? activeKey : normalizeEffortKey(effSpan.textContent);
          if (detected) {
            const rawText = String(effSpan.textContent || '');
            const suffixMatch = rawText.match(/\s+([^\s]+)$/);
            const extraSuffix = suffixMatch && !normalizeEffortKey(suffixMatch[1]) && rawText.trim().includes(' ') ? '' : '';
            const nextDisplay = ` ${effortLabel(detected)}${extraSuffix}`;
            if (effSpan.getAttribute?.('data-agy-effort-display') !== nextDisplay) {
              effSpan.setAttribute?.('data-agy-effort-display', nextDisplay);
            }
          }
          if (effSpan.style) {
            effSpan.style.color = '';
            effSpan.style.fontWeight = '';
          }
        }
      }
    }

    function readReactFiber(el) {
      if (!el || typeof el !== 'object') return null;
      let raw = null;
      for (const key of Object.keys(el)) {
        if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
          raw = el[key];
          break;
        }
      }
      if (!raw) return null;
      if (raw.alternate) {
        let root = raw;
        let hops = 0;
        while (root.return && hops < 80) {
          root = root.return;
          hops += 1;
        }
        if (root?.stateNode?.current && root.stateNode.current !== root) return raw.alternate;
      }
      return raw;
    }

    function isMapLike(v) {
      return Boolean(v && typeof v === 'object' && typeof v.get === 'function' && typeof v.forEach === 'function' && typeof v.has === 'function');
    }

    function slugModelKey(raw) {
      return normalizeModelKey(raw).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function lookupEffortBucket(index, baseOrKey) {
      if (!isMapLike(index) || !baseOrKey) return null;
      const direct = index.get(normalizeModelKey(baseOrKey));
      if (direct) return direct;
      const targetSlug = slugModelKey(baseOrKey);
      if (!targetSlug) return null;
      for (const [k, bucket] of index.entries()) {
        if (slugModelKey(k) === targetSlug || slugModelKey(bucket?.baseName) === targetSlug) return bucket;
      }
      return null;
    }

    function buildNormalizedEffortIndex(rawIndex, modelOptions) {
      const byBase = new Map();
      const ensureBucket = base => {
        const key = normalizeModelKey(base);
        if (!key) return null;
        let entry = byBase.get(key);
        if (!entry) {
          entry = { baseName: String(base).trim(), efforts: new Map() };
          byBase.set(key, entry);
        }
        return entry;
      };
      if (Array.isArray(modelOptions)) {
        for (const opt of modelOptions) {
          if (!opt || opt.isCustom || typeof opt.label !== 'string' || isOrchestratorName(opt.label)) continue;
          const parsed = parseModelOptionLabel(opt.label);
          if (!parsed?.base || !parsed.effort) continue;
          const bucket = ensureBucket(parsed.base);
          if (bucket && !bucket.efforts.has(parsed.effort)) bucket.efforts.set(parsed.effort, opt);
        }
      }
      if (isMapLike(rawIndex)) {
        rawIndex.forEach((inner, rawKey) => {
          if (!isMapLike(inner) || !inner.size) return;
          let detectedBase = '';
          inner.forEach(opt => {
            if (detectedBase || typeof opt?.label !== 'string') return;
            const parsed = parseModelOptionLabel(opt.label);
            if (parsed?.base) detectedBase = parsed.base;
          });
          const bucket = ensureBucket(detectedBase || String(rawKey || ''));
          if (!bucket) return;
          inner.forEach((opt, ek) => {
            const norm = normalizeEffortKey(ek) || (String(ek || '').toLowerCase() === 'extra' ? 'xhigh' : '');
            if (norm && opt && !bucket.efforts.has(norm)) bucket.efforts.set(norm, opt);
          });
        });
      }
      return byBase;
    }

    function hasLocalModelSelectorFiber(panel) {
      let cur = readReactFiber(panel);
      for (let step = 0; cur && step < 28; step += 1, cur = cur.return) {
        const props = cur.memoizedProps;
        if (!props || typeof props !== 'object') continue;
        const val = props.value;
        if (val && typeof val === 'object' && typeof val.setModelConfigByLabelForConversation === 'function') {
          return false;
        }
        if ('conversationId' in props && 'placement' in props) {
          return false;
        }
        if (val && typeof val === 'object' && isMapLike(val.effortIndex) && Array.isArray(val.modelOptions)) {
          return true;
        }
        if (typeof props.setIsOpen === 'function' && typeof props.setSelectedModel === 'function' && Array.isArray(props.modelOptions)) {
          return true;
        }
      }
      return false;
    }

    function isGenuineModelSelectorPanel(panel) {
      if (!panel || panel.closest?.('[data-agy-powertools-root], [data-testid="overview-panel"]')) return false;
      const testId = panel.getAttribute?.('data-testid') || '';
      if (/^agy-/.test(testId)) return false;
      if (testId === 'model-selector-panel' || testId === 'model-selector-list') return true;
      if (panel.matches?.('[data-testid="model-selector-panel"], [data-testid="model-selector-list"]')) return true;
      if (panel.querySelector?.('[data-testid="overview-panel"], .agy-card')) return false;
      if (panel.querySelector?.('[data-testid="model-selector-effort-group"], [data-testid="model-selector-item"], [data-testid="model-selector-effort-option"], [data-testid="model-selector-orchestrator"], [data-model-id]')) {
        return true;
      }
      return hasLocalModelSelectorFiber(panel);
    }

    function readModelSelectorFiber(panel, { allowTriggerFallback = true } = {}) {
      const triggerSeed = allowTriggerFallback ? findActiveModelTrigger() : null;
      const seeds = [panel, triggerSeed !== panel ? triggerSeed : null].filter(Boolean);
      for (const seed of seeds) {
        let cur = readReactFiber(seed);
        if (!cur) continue;
        let selectorCtx = null;
        let innerProps = null;
        let outerProps = null;
        let convId;
        let hasConv = false;
        let globalModelCtx = null;
        for (let step = 0; cur && step < 450; step += 1, cur = cur.return) {
          const props = cur.memoizedProps;
          if (!props || typeof props !== 'object') continue;
          const val = props.value;
          if (!selectorCtx && val && typeof val === 'object' && isMapLike(val.effortIndex) && Array.isArray(val.modelOptions)) {
            selectorCtx = val;
          }
          if (typeof props.setIsOpen === 'function' && typeof props.setSelectedModel === 'function' && Array.isArray(props.modelOptions)) {
            if (!innerProps) innerProps = props;
            outerProps = props;
          }
          if (!hasConv && ('conversationId' in props) && ('placement' in props)) {
            hasConv = true;
            convId = props.conversationId;
          }
          if (!globalModelCtx && val && typeof val === 'object' && typeof val.setModelConfigByLabelForConversation === 'function') {
            globalModelCtx = val;
          }
          if (selectorCtx && outerProps && hasConv && globalModelCtx) break;
        }
        if (!selectorCtx && !innerProps && !outerProps && !globalModelCtx) continue;
        const modelOptions = outerProps?.modelOptions || innerProps?.modelOptions || selectorCtx?.modelOptions || globalModelCtx?.visibleModelConfigs || [];
        const selectedModel = outerProps?.selectedModel || innerProps?.selectedModel || selectorCtx?.selectedModel
          || (globalModelCtx && (hasConv && typeof globalModelCtx.getModelConfigForConversation === 'function'
            ? globalModelCtx.getModelConfigForConversation(convId)
            : globalModelCtx.currentModelConfig))
          || null;
        const orchPlanners = Array.isArray(selectorCtx?.orchestratorPlanners) ? selectorCtx.orchestratorPlanners : [];
        const effortIndex = buildNormalizedEffortIndex(selectorCtx?.effortIndex, modelOptions);
        const orchIndex = buildNormalizedEffortIndex(selectorCtx?.orchestratorPlannerIndex, orchPlanners);
        const canCommit = Boolean(
          typeof globalModelCtx?.setModelConfigByLabelForConversation === 'function'
          || typeof outerProps?.setSelectedModel === 'function'
          || typeof innerProps?.setSelectedModel === 'function'
          || typeof selectorCtx?.setSelectedModel === 'function'
          || typeof globalModelCtx?.setCurrentModelConfigByLabel === 'function'
        );
        if (!canCommit || (!effortIndex.size && !orchIndex.size)) continue;
        return {
          effortIndex,
          modelOptions,
          selectedModel,
          orchPlanners,
          orchIndex,
          orchDefault: selectorCtx?.orchestratorDefaultPlanner || null,
          orchPick: selectorCtx?.orchestratorPick && typeof selectorCtx.orchestratorPick === 'object' ? selectorCtx.orchestratorPick : null,
          conversationId: convId,
          setModelConfigByLabelForConversation: typeof globalModelCtx?.setModelConfigByLabelForConversation === 'function' ? globalModelCtx.setModelConfigByLabelForConversation : null,
          setCurrentModelConfigByLabel: typeof globalModelCtx?.setCurrentModelConfigByLabel === 'function' ? globalModelCtx.setCurrentModelConfigByLabel : null,
          setSelectedModel: typeof outerProps?.setSelectedModel === 'function' ? outerProps.setSelectedModel
            : typeof innerProps?.setSelectedModel === 'function' ? innerProps.setSelectedModel
            : typeof selectorCtx?.setSelectedModel === 'function' ? selectorCtx.setSelectedModel : null,
          setIsOpen: typeof outerProps?.setIsOpen === 'function' ? outerProps.setIsOpen
            : typeof innerProps?.setIsOpen === 'function' ? innerProps.setIsOpen
            : typeof selectorCtx?.setIsOpen === 'function' ? selectorCtx.setIsOpen : null
        };
      }
      return null;
    }

    function commitFiberOption(ctx, targetOption, { isOrchPlanner = false, keepOpen = true } = {}) {
      if (!ctx || !targetOption?.label) return false;
      try {
        if (isOrchPlanner && typeof ctx.orchPick?.select === 'function') {
          const defVal = ctx.orchDefault?.value;
          ctx.orchPick.select(defVal != null && defVal === targetOption.value ? 0 : targetOption.value);
          if (keepOpen) { try { ctx.setIsOpen?.(true); } catch {} }
          return true;
        }
        if (typeof ctx.setModelConfigByLabelForConversation === 'function') {
          ctx.setModelConfigByLabelForConversation(targetOption.label, ctx.conversationId, keepOpen);
          return true;
        }
        if (typeof ctx.setSelectedModel === 'function') {
          const editors = keepOpen ? [...(document.querySelectorAll?.('[contenteditable="true"]') || [])] : [];
          const prevActive = document.activeElement;
          const savedFocus = editors.map(ed => ({ ed, hasOwn: Object.prototype.hasOwnProperty.call(ed, 'focus'), fn: ed.focus }));
          const stopFocus = ev => { ev?.stopImmediatePropagation?.(); ev?.stopPropagation?.(); };
          if (keepOpen) {
            for (const item of savedFocus) {
              item.ed.addEventListener?.('focus', stopFocus, true);
              item.ed.addEventListener?.('focusin', stopFocus, true);
              try { item.ed.focus = () => {}; } catch {}
            }
          }
          try {
            ctx.setSelectedModel(targetOption);
            if (keepOpen) {
              for (const { ed } of savedFocus) {
                if (document.activeElement === ed) {
                  try { ed.blur?.(); } catch {}
                  if (prevActive && prevActive !== ed) { try { prevActive.focus?.(); } catch {} }
                }
              }
            }
          } finally {
            for (const item of savedFocus) {
              item.ed.removeEventListener?.('focus', stopFocus, true);
              item.ed.removeEventListener?.('focusin', stopFocus, true);
              try {
                if (item.hasOwn) item.ed.focus = item.fn;
                else delete item.ed.focus;
              } catch {}
            }
          }
          if (keepOpen) { try { ctx.setIsOpen?.(true); } catch {} }
          return true;
        }
        if (typeof ctx.setCurrentModelConfigByLabel === 'function') {
          ctx.setCurrentModelConfigByLabel(targetOption.label);
          return true;
        }
      } catch {}
      return false;
    }

    function resolveFiberProfile(ctx, overrideOption = null) {
      if (!ctx) return null;
      const selOpt = overrideOption || ctx.selectedModel;
      const selLabel = typeof selOpt?.label === 'string' ? selOpt.label : '';
      const isOrch = isOrchestratorName(selLabel) || isOrchestratorName(selOpt?.modelId);
      let activeOpt = selOpt;
      let index = ctx.effortIndex;
      let isOrchPlanner = false;

      if (isOrch && ctx.orchPick && typeof ctx.orchPick.select === 'function' && ctx.orchPlanners.length) {
        const findPlanner = ref => {
          if (!ref) return null;
          if (typeof ref === 'object' && typeof ref.label === 'string') return ref;
          return ctx.orchPlanners.find(p => p && (p.value === ref || p.modelId === ref || p.label === ref)) || null;
        };
        const resolved = findPlanner(ctx.orchPick.model) || findPlanner(ctx.orchDefault) || ctx.orchPlanners[0];
        if (resolved) {
          activeOpt = resolved;
          index = ctx.orchIndex.size ? ctx.orchIndex : ctx.effortIndex;
          isOrchPlanner = true;
        }
      }

      const parsed = activeOpt?.label ? parseModelOptionLabel(activeOpt.label) : null;
      const baseName = parsed?.base || activeOpt?.label || '';
      const modelKey = normalizeModelKey(baseName);
      const bucket = modelKey ? lookupEffortBucket(index, baseName) : null;
      const isClaude = isClaudeModelName(baseName);

      if (bucket && bucket.efforts.size >= 2) {
        const orderedKeys = EFFORT_ORDER.filter(k => bucket.efforts.has(k));
        const activeKey = parsed?.effort && bucket.efforts.has(parsed.effort)
          ? parsed.effort
          : bucket.efforts.has('medium') ? 'medium' : orderedKeys[0];
        return {
          mode: 'fiber',
          ctx,
          modelKey,
          baseName: bucket.baseName || baseName,
          isOrch,
          isOrchPlanner,
          isClaude,
          locked: false,
          activeKey,
          effortList: orderedKeys.map(k => ({
            key: k,
            option: bucket.efforts.get(k),
            active: k === activeKey
          }))
        };
      }

      return {
        mode: 'fiber',
        ctx,
        modelKey,
        baseName,
        isOrch,
        isOrchPlanner: false,
        isClaude,
        locked: true,
        activeKey: parsed?.effort || 'fixed',
        effortList: [{ key: parsed?.effort || 'fixed', option: activeOpt, active: true }]
      };
    }

    function isNodeActive(node) {
      if (!node) return false;
      if (node.checked === true) return true;
      const attrs = ['aria-selected', 'aria-checked', 'aria-pressed', 'data-selected', 'data-active'];
      for (const a of attrs) {
        if (node.getAttribute?.(a) === 'true') return true;
      }
      const st = node.getAttribute?.('data-state');
      if (st === 'checked' || st === 'active' || st === 'on') return true;
      if (/\b(?:selected|active)\b/.test(String(node.className || ''))) return true;
      return false;
    }

    function detectEffortOptions(panel) {
      let candidates = [...(panel.querySelectorAll?.('[data-testid="model-selector-effort-option"]') || [])];
      if (!candidates.length) {
        candidates = [...(panel.querySelectorAll?.('button, [role="option"], [role="radio"], [role="menuitemradio"]') || [])]
          .filter(btn => !btn.closest?.('[data-agy-effort-slider]') && normalizeEffortKey(btn.getAttribute?.('data-effort') || btn.getAttribute?.('aria-label') || btn.textContent));
      }
      const byKey = new Map();
      for (const btn of candidates) {
        const key = normalizeEffortKey(btn.dataset?.effort || btn.getAttribute?.('data-effort') || btn.getAttribute?.('aria-label') || btn.textContent);
        if (key && !byKey.has(key)) byKey.set(key, { key, el: btn, active: isNodeActive(btn) });
      }
      return EFFORT_ORDER.filter(k => byKey.has(k)).map(k => byKey.get(k));
    }

    function detectModelKey(panel) {
      const modelItems = [...(panel.querySelectorAll?.('[data-testid="model-selector-item"], [data-model-id], [role="option"]') || [])]
        .filter(item => !item.closest?.('[data-agy-effort-slider]') && item.getAttribute?.('data-testid') !== 'model-selector-effort-option' && !normalizeEffortKey(item.textContent));
      const activeItem = modelItems.find(isNodeActive);
      if (activeItem) {
        const key = normalizeModelKey(activeItem.getAttribute?.('data-model-id') || activeItem.dataset?.modelId || activeItem.textContent);
        if (key) return key;
      }
      const trigger = findActiveModelTrigger();
      const triggerKey = normalizeModelKey(trigger?.getAttribute?.('data-model-id') || trigger?.textContent);
      if (triggerKey) return triggerKey;
      const capModel = env.adapter?.capabilities?.()?.model;
      return normalizeModelKey(capModel || '');
    }

    function detectOrchestratorActive(panel, modelKey) {
      const orch = panel.querySelector?.('[data-testid="model-selector-orchestrator"]');
      if (orch) {
        const explicitFalse = orch.getAttribute?.('aria-checked') === 'false' || orch.getAttribute?.('aria-selected') === 'false' || orch.getAttribute?.('aria-pressed') === 'false' || orch.getAttribute?.('data-state') === 'unchecked';
        if (isNodeActive(orch)) return true;
        if (explicitFalse) return false;
      }
      if (isOrchestratorName(modelKey)) return true;
      const items = [...(panel.querySelectorAll?.('[role="option"], button, [data-testid="model-selector-item"]') || [])];
      return items.some(item => !item.closest?.('[data-agy-effort-slider]') && isOrchestratorName(item.textContent) && isNodeActive(item));
    }

    function recordEffortChoice(modelKey, effortKey) {
      if (!getOpts().effortMemory || !modelKey || !effortKey || effortKey === 'fixed') return;
      const mem = readEffortMemory();
      if (mem[modelKey] !== effortKey) {
        mem[modelKey] = effortKey;
        writeEffortMemory(mem);
      }
    }

    function syncFiberPanelRows(panel, profile) {
      if (!panel || !profile) return;
      const mem = readEffortMemory();
      const rows = [...(panel.querySelectorAll?.('[role="menuitem"]') || [])];
      for (const row of rows) {
        if (row.closest?.('[data-agy-effort-slider]')) continue;
        const grp = row.querySelector?.('[data-testid="model-selector-effort-group"]');
        if (grp) {
          const base = grp.getAttribute?.('data-model-base') || grp.textContent || '';
          const rowKey = normalizeModelKey(base);
          const isSelected = !profile.isOrch && rowKey && rowKey === profile.modelKey;
          row.setAttribute?.('data-agy-model-selected', isSelected ? 'true' : 'false');
          const effSpan = grp.nextElementSibling;
          if (effSpan && effSpan.tagName === 'SPAN') {
            const effKey = isSelected ? profile.activeKey : mem[rowKey];
            const rowBucket = lookupEffortBucket(profile.ctx?.effortIndex, base);
            if (effKey && effKey !== 'fixed' && rowBucket?.efforts?.has(effKey)) {
              const display = effortEnglishLabel(effKey);
              if (effSpan.textContent !== display) effSpan.textContent = display;
            }
          }
        } else if (row.querySelector?.('[data-testid="model-selector-orchestrator"]') || isOrchestratorName(row.textContent)) {
          row.setAttribute?.('data-agy-model-selected', profile.isOrch ? 'true' : 'false');
        }
      }
    }

    function updateEffortSliderVisual(panel, effortList, activeKey, { isClaude = false, locked = false, pop = false, modelLabel = '', openStage = '' } = {}) {
      const slider = panel.querySelector?.('[data-agy-effort-slider="1"]');
      if (!slider) return;
      const count = effortList.length;
      const activeIdx = Math.max(0, effortList.findIndex(item => item.key === activeKey));
      const key = effortList[activeIdx]?.key || activeKey || '';
      const ratio = count > 1 ? activeIdx / (count - 1) : 1;
      const ratioKey = ratio.toFixed(4);
      const isMax = !locked && count >= 2 && activeIdx === count - 1 && (key === 'xhigh' || key === 'max' || key === 'high');
      const knobExpr = count > 1 ? `calc(12px + (100% - 24px) * ${ratioKey})` : 'calc(100% - 12px)';
      const fillExpr = count > 1 ? `calc(24px + (100% - 24px) * ${ratioKey})` : '100%';

      slider.setAttribute?.('data-max', isMax ? 'true' : 'false');
      slider.setAttribute?.('data-brand', isClaude ? 'claude' : 'codex');
      slider.setAttribute?.('data-locked', locked ? 'true' : 'false');
      if (slider.getAttribute?.('data-ratio') !== ratioKey && !slider.hasAttribute?.('data-dragging')) {
        slider.setAttribute?.('data-ratio', ratioKey);
        slider.style?.setProperty?.('--agy-fill', knobExpr);
        slider.style?.setProperty?.('--agy-knob-x', knobExpr);
        slider.style?.setProperty?.('--agy-fill-w', fillExpr);
      }

      const modelNameEl = slider.querySelector?.('.agy-codex-model-name');
      if (modelNameEl && modelLabel && modelNameEl.textContent !== modelLabel) {
        modelNameEl.textContent = modelLabel;
      }

      const valEl = slider.querySelector?.('.agy-effort-val');
      if (valEl) {
        const nextText = effortLabel(key);
        const changed = valEl.textContent !== nextText;
        valEl.textContent = nextText;
        if (pop && changed) {
          valEl.setAttribute?.('data-pop', '0');
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => { if (!disposed && valEl.isConnected) valEl.setAttribute?.('data-pop', '1'); });
          } else {
            valEl.setAttribute?.('data-pop', '1');
          }
        }
      }
      const track = slider.querySelector?.('[role="slider"]');
      if (track) {
        track.setAttribute?.('aria-valuenow', String(activeIdx));
        track.setAttribute?.('aria-valuemax', String(Math.max(0, count - 1)));
        track.setAttribute?.('aria-valuetext', effortLabel(key));
      }
      const dots = [...(slider.querySelectorAll?.('.agy-effort-dot') || [])];
      for (let i = 0; i < dots.length; i++) {
        dots[i].setAttribute?.('data-on', i <= activeIdx ? '1' : '0');
      }
      for (const tick of slider.querySelectorAll?.('.agy-effort-tick') || []) {
        const tKey = tick.getAttribute?.('data-effort');
        tick.setAttribute?.('aria-pressed', tKey === key ? 'true' : 'false');
      }
      syncTriggerEffortTint(key, isMax, isClaude, openStage || panel.getAttribute?.('data-agy-codex-stage') || '');
    }

    function selectEffortOption(panel, profile, idx, userInitiated = true) {
      const target = profile.effortList[idx];
      if (!target || profile.locked) return;
      if (userInitiated && profile.modelKey) {
        recordEffortChoice(profile.modelKey, target.key);
        appliedPanelModelMap.set(panel, profile.modelKey);
      }
      applyingEffortMemory = !userInitiated;
      try {
        if (profile.mode === 'fiber' && target.option) {
          const ok = commitFiberOption(profile.ctx, target.option, {
            isOrchPlanner: profile.isOrchPlanner,
            keepOpen: true
          });
          if (ok) {
            pendingModelOverride = profile.isOrchPlanner ? (profile.ctx.selectedModel || null) : target.option;
            lastHostSelectedLabel = profile.ctx.selectedModel?.label || '';
          }
        } else {
          target.el?.click?.();
        }
      } finally {
        applyingEffortMemory = false;
      }
      const updated = { ...profile, activeKey: target.key };
      updateEffortSliderVisual(panel, updated.effortList, target.key, {
        isClaude: updated.isClaude,
        locked: updated.locked,
        pop: userInitiated
      });
      if (updated.mode === 'fiber') syncFiberPanelRows(panel, updated);
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(() => { if (!disposed) syncEffortSlider(); });
      }
    }

    function resolvePanelProfile(panel) {
      const fiberCtx = readModelSelectorFiber(panel);
      if (fiberCtx) {
        const hostLabel = fiberCtx.selectedModel?.label || '';
        if (pendingModelOverride && (hostLabel === pendingModelOverride.label || (lastHostSelectedLabel && hostLabel !== lastHostSelectedLabel))) {
          pendingModelOverride = null;
        }
        lastHostSelectedLabel = hostLabel;
        return resolveFiberProfile(fiberCtx, pendingModelOverride);
      }
      const effortList = detectEffortOptions(panel);
      const modelKey = detectModelKey(panel);
      const isOrch = detectOrchestratorActive(panel, modelKey);
      const activeKey = effortList.find(item => item.active)?.key || effortList[0]?.key || '';
      return {
        mode: 'dom',
        ctx: null,
        modelKey,
        baseName: modelKey,
        isOrch,
        isOrchPlanner: false,
        isClaude: isClaudeModelName(modelKey),
        locked: false,
        activeKey,
        effortList
      };
    }

    function bindEffortPanelEvents(panel) {
      if (observedEffortPanels.has(panel)) return;
      observedEffortPanels.add(panel);
      const containsNode = (root, node) => {
        if (!root || !node) return false;
        if (typeof root.contains === 'function') return root.contains(node);
        let cur = node;
        while (cur) {
          if (cur === root) return true;
          cur = cur.parentElement || cur.parentNode;
        }
        return false;
      };

      const resolveFiberRowAction = target => {
        if (disposed || !getOpts().enabled || !getOpts().effortSlider) return null;
        if (!target?.closest || target.closest('[data-agy-effort-slider], button[aria-label="Edit Model"], a[href]')) return null;
        const menuItem = target.closest('[role="menuitem"]');
        if (!menuItem || !containsNode(panel, menuItem)) return null;
        const fiberCtx = readModelSelectorFiber(panel);
        if (!fiberCtx) return null;

        const orchEl = menuItem.querySelector?.('[data-testid="model-selector-orchestrator"]');
        if (orchEl || (!menuItem.querySelector?.('[data-testid="model-selector-effort-group"], [data-testid="model-selector-item"]') && isOrchestratorName(menuItem.textContent))) {
          const orchOpt = fiberCtx.modelOptions.find(o => o && (isOrchestratorName(o.label) || isOrchestratorName(o.modelId)));
          if (!orchOpt || isOrchestratorName(fiberCtx.selectedModel?.label)) return null;
          return { fiberCtx, targetOpt: orchOpt, modelKey: '' };
        }

        const groupEl = menuItem.querySelector?.('[data-testid="model-selector-effort-group"]');
        if (!groupEl) return null;
        const baseRaw = groupEl.getAttribute?.('data-model-base') || groupEl.textContent || '';
        const modelKey = normalizeModelKey(baseRaw);
        const bucket = lookupEffortBucket(fiberCtx.effortIndex, baseRaw);
        if (!bucket || bucket.efforts.size < 2) return null;
        const mem = readEffortMemory();
        const desiredKey = (getOpts().effortMemory && mem[modelKey] && bucket.efforts.has(mem[modelKey]))
          ? mem[modelKey]
          : bucket.efforts.has('medium')
            ? 'medium'
            : EFFORT_ORDER.find(k => bucket.efforts.has(k));
        const targetOpt = desiredKey ? bucket.efforts.get(desiredKey) : null;
        return targetOpt ? { fiberCtx, targetOpt, modelKey } : null;
      };

      const stopFiberRowPointer = event => {
        if (resolveFiberRowAction(event.target)) {
          event.stopImmediatePropagation?.();
          event.stopPropagation?.();
        }
      };

      const handleFiberRowClick = event => {
        const action = resolveFiberRowAction(event.target);
        if (!action) return;
        const inCodexModelsStage = panel.getAttribute?.('data-agy-codex-stage') === 'models';
        const keepOpen = !inCodexModelsStage;
        if (commitFiberOption(action.fiberCtx, action.targetOpt, { keepOpen })) {
          event.preventDefault?.();
          event.stopImmediatePropagation?.();
          event.stopPropagation?.();
          pendingModelOverride = action.targetOpt;
          lastHostSelectedLabel = action.fiberCtx.selectedModel?.label || '';
          if (action.modelKey) appliedPanelModelMap.set(panel, action.modelKey);
          if (!keepOpen) {
            try { action.fiberCtx.setIsOpen?.(false); } catch {}
          }
          syncEffortSlider();
        }
      };

      panel.addEventListener?.('click', event => {
        if (disposed || !getOpts().enabled) return;
        if (event.target?.closest?.('[data-agy-effort-slider]')) return;
        // Native effort button click (DOM mode) -> record memory
        const effortBtn = event.target?.closest?.('[data-testid="model-selector-effort-option"], button, [role="option"], [role="radio"]');
        if (effortBtn) {
          const eKey = normalizeEffortKey(effortBtn.dataset?.effort || effortBtn.getAttribute?.('data-effort') || effortBtn.getAttribute?.('aria-label') || effortBtn.textContent);
          const mKey = detectModelKey(panel);
          if (eKey && mKey && !applyingEffortMemory) {
            recordEffortChoice(mKey, eKey);
            appliedPanelModelMap.set(panel, mKey);
            const prof = resolvePanelProfile(panel);
            updateEffortSliderVisual(panel, prof.effortList, eKey, { isClaude: prof.isClaude, locked: prof.locked, pop: true });
            return;
          }
        }
        const modelItem = event.target?.closest?.('[data-testid="model-selector-item"], [data-model-id], [role="option"]');
        if (modelItem) {
          if (typeof queueMicrotask === 'function') queueMicrotask(() => { if (!disposed) syncEffortSlider(); });
        }
      }, listenerOpts);

      const capOpts = ac ? { capture: true, signal: ac.signal } : true;
      panel.addEventListener?.('pointerup', stopFiberRowPointer, capOpts);
      panel.addEventListener?.('mouseup', stopFiberRowPointer, capOpts);
      panel.addEventListener?.('click', handleFiberRowClick, capOpts);
    }

    // A throw mid-sync must not leave the native-menu-hiding attribute on (it would hide the model menu with no slider).
    function syncEffortSlider() {
      try { syncEffortSliderBody(); } catch { setEffortSliderReadyAttr(false); }
    }

    function syncEffortSliderBody() {
      const opts = getOpts();
      if (!opts.enabled || (!opts.effortSlider && !opts.effortMemory)) {
        for (const bar of document.querySelectorAll?.('[data-agy-effort-slider="1"], [data-agy-effort-sep="1"]') || []) bar.remove?.();
        setEffortSliderReadyAttr(false);
        clearTriggerEffortTint();
        return;
      }
      // Slider off: drop the codex selector gate too, or its pre-cloak keeps the unstamped native menu invisible.
      if (!opts.effortSlider) clearTriggerEffortTint();
      const panels = [...(document.querySelectorAll?.('[data-testid="model-selector-panel"], [data-testid="model-selector-list"], [role="dialog"], [role="listbox"], [role="menu"]') || [])];
      const hasExplicitModelPanel = Boolean(document.querySelector?.('[data-testid="model-selector-panel"], [data-testid="model-selector-list"], [data-testid="model-selector-effort-group"], [data-testid="model-selector-item"]'));
      const validPanels = new Set();
      let mountedFiberSlider = false;

      for (const panel of panels) {
        if (!isGenuineModelSelectorPanel(panel)) continue;
        if (!panel.matches?.('[data-testid="model-selector-panel"], [data-testid="model-selector-list"]') && panel.querySelector?.('[data-testid="model-selector-panel"], [data-testid="model-selector-list"]')) {
          continue;
        }
        // Skip secondary effort-only hover flyouts when the main model list panel is already present
        if (hasExplicitModelPanel
          && !panel.matches?.('[data-testid="model-selector-panel"], [data-testid="model-selector-list"]')
          && !panel.querySelector?.('[data-testid="model-selector-effort-group"], [data-testid="model-selector-item"], [data-testid="model-selector-orchestrator"], [data-model-id]')) {
          continue;
        }
        const profile = resolvePanelProfile(panel);
        const isModelMenu = panel.matches?.('[data-testid="model-selector-panel"], [data-testid="model-selector-list"]')
          || profile.mode === 'fiber'
          || profile.effortList.length >= 2
          || Boolean(panel.querySelector?.('[data-testid="model-selector-orchestrator"]'));
        if (!isModelMenu) continue;
        validPanels.add(panel);

        bindEffortPanelEvents(panel);

        // Per-model effort memory auto-apply
        let activeKey = profile.activeKey;
        if (opts.effortMemory && profile.modelKey && !profile.locked && (!profile.isOrch || profile.isOrchPlanner) && profile.effortList.length >= 2) {
          const prevApplied = appliedPanelModelMap.get(panel);
          if (prevApplied !== profile.modelKey) {
            appliedPanelModelMap.set(panel, profile.modelKey);
            const mem = readEffortMemory();
            const remembered = mem[profile.modelKey];
            if (remembered) {
              const idx = profile.effortList.findIndex(item => item.key === remembered);
              if (idx >= 0) {
                activeKey = remembered;
                if (!profile.effortList[idx].active) {
                  selectEffortOption(panel, profile, idx, false);
                }
              }
            }
          }
        }

        // Auto-yield if external .ces-slider is present or effortSlider disabled
        const hasExternalSlider = Boolean(panel.querySelector?.('.ces-slider') || panel.parentElement?.querySelector?.('.ces-slider'));
        const existing = panel.querySelector?.('[data-agy-effort-slider="1"]');
        const existingSep = panel.querySelector?.('[data-agy-effort-sep="1"]');
        if (!opts.effortSlider || hasExternalSlider || (!profile.isOrch && profile.effortList.length === 0)) {
          existing?.remove?.();
          existingSep?.remove?.();
          panel.removeAttribute?.('data-agy-codex-stage');
          continue;
        }

        const canSlideEffort = !profile.locked && profile.effortList.length >= 2 && !(profile.isOrch && !profile.isOrchPlanner);
        let stage = panelStageMap.get(panel);
        if (!stage) {
          stage = canSlideEffort ? 'effort' : 'models';
          panelStageMap.set(panel, stage);
        } else if (stage === 'effort' && !canSlideEffort) {
          stage = 'models';
          panelStageMap.set(panel, stage);
        }
        panel.setAttribute?.('data-agy-codex-stage', stage);
        const popupWrap = panel.parentElement && panel.parentElement !== document.body && panel.parentElement !== document.documentElement
          ? panel.parentElement
          : null;
        if (popupWrap) popupWrap.setAttribute?.('data-agy-codex-popup', stage);

        const hdr = panel.querySelector?.('[data-testid="model-selector-header"]');
        if (hdr) {
          const rawHdr = String(hdr.textContent || '').trim();
          if (rawHdr && !/best\s+of/i.test(rawHdr)) {
            const wantHdr = tr('选择模型', 'Select model');
            if (hdr.getAttribute?.('data-agy-codex-header') !== wantHdr) {
              hdr.setAttribute?.('data-agy-codex-header', wantHdr);
            }
          } else {
            hdr.removeAttribute?.('data-agy-codex-header');
          }
        }

        const displayModelName = profile.isOrch
          ? 'Orchestrator'
          : (profile.baseName || profile.ctx?.selectedModel?.label || profile.modelKey || tr('选择模型', 'Select model'));

        const desiredMode = (profile.isOrch && !profile.isOrchPlanner) ? 'orchestrator' : 'slider';
        const signature = desiredMode === 'orchestrator'
          ? 'orch'
          : `${profile.mode}:${profile.locked ? 'lock' : 'free'}:${profile.effortList.map(i => i.key).join(',')}`;
        if (profile.mode === 'fiber') {
          mountedFiberSlider = true;
          syncFiberPanelRows(panel, { ...profile, activeKey });
        }
        if (existing && existing.getAttribute?.('data-mode') === desiredMode && existing.getAttribute?.('data-sig') === signature) {
          if (desiredMode === 'slider') {
            updateEffortSliderVisual(panel, profile.effortList, activeKey, {
              isClaude: profile.isClaude,
              locked: profile.locked,
              modelLabel: displayModelName,
              openStage: stage
            });
          } else {
            syncTriggerEffortTint('', false, false, stage);
          }
          continue;
        }
        existing?.remove?.();
        existingSep?.remove?.();

        const bar = el('div', {
          className: 'agy-effort-bar',
          'data-agy-effort-slider': '1',
          'data-agy-powertools-root': 'workbench-effort',
          'data-mode': desiredMode,
          'data-sig': signature,
          'data-testid': desiredMode === 'orchestrator' ? 'agy-effort-prism-bar' : 'agy-effort-slider',
          translate: 'no',
          'data-agy-no-translate': 'true'
        });

        const stopBubble = ev => { ev?.stopPropagation?.(); };
        for (const evName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          bar.addEventListener?.(evName, stopBubble);
        }

        const openModelsStage = e => {
          e?.preventDefault?.();
          e?.stopPropagation?.();
          panelStageMap.set(panel, 'models');
          syncEffortSlider();
        };

        const chevronSvg = () => {
          const ns = 'http://www.w3.org/2000/svg';
          if (typeof document.createElementNS === 'function') {
            const svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('viewBox', '0 0 12 12');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('class', 'agy-codex-model-chev');
            const p = document.createElementNS(ns, 'path');
            p.setAttribute('d', 'M4.5 2.5L8 6L4.5 9.5');
            p.setAttribute('stroke', 'currentColor');
            p.setAttribute('stroke-width', '1.6');
            p.setAttribute('stroke-linecap', 'round');
            p.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(p);
            return svg;
          }
          return el('span', { className: 'agy-codex-model-chev', 'aria-hidden': 'true' }, '>');
        };

        if (desiredMode === 'orchestrator') {
          const prism = el('button', {
            type: 'button',
            className: 'agy-codex-model-switch agy-effort-prism',
            'data-testid': 'agy-effort-open-models',
            onClick: openModelsStage
          },
            el('span', { className: 'agy-effort-val', textContent: 'Orchestrator' }),
            el('span', { className: 'agy-codex-model-sub' },
              el('span', { className: 'agy-codex-model-name', textContent: tr('选择模型', 'Select model') }),
              chevronSvg()
            )
          );
          bar.appendChild(prism);
        } else {
          const modelSwitchBtn = el('button', {
            type: 'button',
            className: 'agy-codex-model-switch',
            'data-testid': 'agy-effort-open-models',
            'aria-label': tr('选择模型', 'Select model'),
            onClick: openModelsStage
          },
            el('span', { className: 'agy-effort-val', textContent: effortLabel(activeKey) }),
            el('span', { className: 'agy-codex-model-sub' },
              el('span', { className: 'agy-codex-model-name', textContent: displayModelName }),
              chevronSvg()
            )
          );

          const fill = el('div', { className: 'agy-effort-fill' });
          const dots = el('div', { className: 'agy-effort-dots', 'aria-hidden': 'true' });
          const ticksRow = el('div', { className: 'agy-effort-ticks' });
          const count = profile.effortList.length;
          for (let i = 0; i < count; i++) {
            const item = profile.effortList[i];
            const isSel = item.key === activeKey;
            const pct = count > 1 ? i / (count - 1) : 0.5;
            const posExpr = count > 1 ? `calc(12px + (100% - 24px) * ${pct.toFixed(4)})` : '50%';
            dots.appendChild(el('span', {
              className: 'agy-effort-dot',
              style: { left: posExpr }
            }));
            ticksRow.appendChild(el('button', {
              type: 'button',
              className: 'agy-effort-tick',
              tabindex: '-1',
              'data-effort': item.key,
              'data-testid': `agy-effort-tick-${item.key}`,
              'aria-label': effortLabel(item.key),
              'aria-pressed': isSel ? 'true' : 'false',
              style: { left: posExpr },
              onClick: e => {
                e.stopPropagation();
                const fresh = resolvePanelProfile(panel);
                if (fresh.locked) return;
                const idx = fresh.effortList.findIndex(x => x.key === item.key);
                if (idx >= 0) selectEffortOption(panel, fresh, idx, true);
              }
            }, effortLabel(item.key)));
          }
          const knob = el('div', { className: 'agy-effort-knob', 'aria-hidden': 'true' });
          const track = el('div', {
            className: 'agy-effort-track',
            role: 'slider',
            tabindex: '0',
            'aria-label': tr('推理等级', 'Reasoning effort'),
            'aria-valuemin': '0',
            'aria-valuemax': String(Math.max(0, count - 1)),
            'aria-valuenow': String(Math.max(0, profile.effortList.findIndex(i => i.key === activeKey)))
          }, fill, dots, knob, ticksRow);

          let pointerHeld = false;
          let dragging = false;
          let downX = 0;
          const ratioAtClientX = clientX => {
            const rect = track.getBoundingClientRect?.();
            if (!rect || !rect.width) return null;
            const pad = Math.min(12, rect.width * 0.2);
            const span = Math.max(1, rect.width - pad * 2);
            return Math.max(0, Math.min(1, (clientX - rect.left - pad) / span));
          };

          track.addEventListener?.('pointerdown', e => {
            if (e.target?.closest?.('.agy-effort-tick')) return;
            const fresh = resolvePanelProfile(panel);
            if (fresh.locked || fresh.effortList.length < 2) return;
            pointerHeld = true;
            dragging = false;
            downX = Number(e.clientX || 0);
          });
          track.addEventListener?.('pointermove', e => {
            if (!pointerHeld) return;
            const cx = Number(e.clientX || 0);
            if (!dragging && Math.abs(cx - downX) > 4) {
              dragging = true;
              bar.setAttribute?.('data-dragging', '1');
              if (e.pointerId != null) track.setPointerCapture?.(e.pointerId);
            }
            if (!dragging) return;
            const fresh = resolvePanelProfile(panel);
            if (fresh.locked || fresh.effortList.length < 2) return;
            const ratio = ratioAtClientX(cx);
            if (ratio == null) return;
            const ratioStr = ratio.toFixed(4);
            bar.removeAttribute?.('data-ratio');
            bar.style?.setProperty?.('--agy-knob-x', `calc(12px + (100% - 24px) * ${ratioStr})`);
            bar.style?.setProperty?.('--agy-fill-w', `calc(24px + (100% - 24px) * ${ratioStr})`);
            const previewIdx = Math.round(ratio * (fresh.effortList.length - 1));
            const previewItem = fresh.effortList[previewIdx];
            const valNode = bar.querySelector?.('.agy-effort-val');
            if (valNode && previewItem) valNode.textContent = effortLabel(previewItem.key);
            const dotNodes = [...(bar.querySelectorAll?.('.agy-effort-dot') || [])];
            for (let i = 0; i < dotNodes.length; i++) dotNodes[i].setAttribute?.('data-on', i <= previewIdx ? '1' : '0');
          });
          const finishPointer = e => {
            if (!pointerHeld) return;
            pointerHeld = false;
            const wasDragging = dragging;
            dragging = false;
            // Remove data-dragging BEFORE committing target ratio so knob and fill always glide smoothly!
            bar.removeAttribute?.('data-dragging');
            if (!wasDragging && e?.target?.closest?.('.agy-effort-tick')) return;
            const fresh = resolvePanelProfile(panel);
            if (fresh.locked || fresh.effortList.length < 2) return;
            const ratio = ratioAtClientX(Number(e?.clientX ?? downX));
            if (ratio == null) {
              updateEffortSliderVisual(panel, fresh.effortList, fresh.activeKey, { isClaude: fresh.isClaude, locked: fresh.locked, modelLabel: displayModelName, openStage: stage });
              return;
            }
            const idx = Math.round(ratio * (fresh.effortList.length - 1));
            if (fresh.effortList[idx]) {
              selectEffortOption(panel, fresh, idx, true);
            }
          };
          track.addEventListener?.('pointerup', finishPointer);
          track.addEventListener?.('pointercancel', () => {
            if (!pointerHeld) return;
            pointerHeld = false;
            dragging = false;
            bar.removeAttribute?.('data-dragging');
            const fresh = resolvePanelProfile(panel);
            updateEffortSliderVisual(panel, fresh.effortList, fresh.activeKey, { isClaude: fresh.isClaude, locked: fresh.locked, modelLabel: displayModelName, openStage: stage });
          });
          track.addEventListener?.('keydown', e => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const fresh = resolvePanelProfile(panel);
            if (fresh.locked || fresh.effortList.length < 2) return;
            const cur = Math.max(0, fresh.effortList.findIndex(i => i.active));
            const next = Math.max(0, Math.min(fresh.effortList.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
            selectEffortOption(panel, fresh, next, true);
          });

          bar.appendChild(modelSwitchBtn);
          bar.appendChild(track);
        }

        // Insert right after model list wrapper when Fiber panel structure matches
        const listWrapper = panel.firstElementChild || panel.children?.[0];
        const afterList = listWrapper?.nextSibling || listWrapper?.nextElementSibling || panel.children?.[1] || null;
        if (profile.mode === 'fiber' && listWrapper && afterList) {
          panel.insertBefore(bar, afterList);
        } else {
          panel.appendChild(bar);
        }
        if (desiredMode === 'slider') {
          updateEffortSliderVisual(panel, profile.effortList, activeKey, {
            isClaude: profile.isClaude,
            locked: profile.locked,
            modelLabel: displayModelName,
            openStage: stage
          });
        } else {
          syncTriggerEffortTint('', false, false, stage);
        }
      }

      for (const node of document.querySelectorAll?.('[data-agy-effort-slider="1"], [data-agy-effort-sep="1"]') || []) {
        if (!validPanels.has(node.parentElement)) node.remove?.();
      }
      for (const trackedPanel of [...panelStageMap.keys()]) {
        if (!validPanels.has(trackedPanel) || !trackedPanel.isConnected) {
          trackedPanel.removeAttribute?.('data-agy-codex-stage');
          trackedPanel.parentElement?.removeAttribute?.('data-agy-codex-popup');
          panelStageMap.delete(trackedPanel);
        }
      }
      for (const pop of document.querySelectorAll?.('[data-agy-codex-popup]') || []) {
        const childPanel = pop.querySelector?.('[data-agy-codex-stage]');
        if (!childPanel || !validPanels.has(childPanel)) pop.removeAttribute?.('data-agy-codex-popup');
      }
      const anyEnhancedPanel = validPanels.size > 0;
      setEffortSliderReadyAttr(mountedFiberSlider || (opts.effortSlider && anyEnhancedPanel));
      if (!anyEnhancedPanel) {
        pendingModelOverride = null;
      }
      if (!anyEnhancedPanel && opts.effortSlider) {
        const trigger = findActiveModelTrigger();
        if (trigger) {
          const ctx = readModelSelectorFiber(trigger, { allowTriggerFallback: false });
          const prof = ctx ? resolveFiberProfile(ctx) : null;
          if (prof && !prof.locked && prof.effortList.length >= 2) {
            syncTriggerEffortTint(prof.activeKey, false, prof.isClaude, '');
          } else {
            syncTriggerEffortTint('', false, false, '');
          }
        }
      }
    }

    // =========================================================================
    // 2. Thought Process Translator & Title Translator UI
    // =========================================================================
    const FILE_PATH_TOKEN_RE = /(?:https?:\/\/[^\s<>"'`)\]]+)|((?:[A-Za-z]:[\\/]|\\\\|\/|\.\.?[\\/]|[A-Za-z0-9_-]+[\\/])(?:[A-Za-z0-9._%#-]+[\\/])*[A-Za-z0-9._%#-]+\.[A-Za-z0-9]{1,10}(?:#L\d+|:\d+(?::\d+)?)?)/g;

    function parseFileRef(token) {
      const hashLine = token.match(/^(.*)#L(\d+)$/);
      if (hashLine) return { path: hashLine[1], line: Number(hashLine[2]) };
      const colonLine = token.match(/^(.*?):(\d+)(?::(\d+))?$/);
      if (colonLine) return { path: colonLine[1], line: Number(colonLine[2]), column: colonLine[3] ? Number(colonLine[3]) : null };
      return { path: token, line: null };
    }

    function appendTranslatedTextWithFilePills(container, text) {
      const str = String(text || '');
      let lastIndex = 0;
      FILE_PATH_TOKEN_RE.lastIndex = 0;
      let match;
      while ((match = FILE_PATH_TOKEN_RE.exec(str)) !== null) {
        const fileToken = match[1];
        if (!fileToken) continue; // URL match, skip
        if (match.index > lastIndex) {
          container.appendChild(document.createTextNode(str.slice(lastIndex, match.index)));
        }
        const parsed = parseFileRef(fileToken);
        const pill = el('button', {
          type: 'button',
          className: 'agy-thought-file-pill',
          'data-testid': 'agy-thought-file-pill',
          'data-path': parsed.path,
          ...(parsed.line != null ? { 'data-line': String(parsed.line) } : {}),
          textContent: fileToken,
          onClick: e => {
            e.preventDefault();
            e.stopPropagation();
            const uri = toFileUri(parsed.path, currentWorkspaceUri());
            void Promise.resolve(env.request?.('file.openEditor', {
              uri,
              ...(parsed.line != null ? { line: parsed.line } : {}),
              ...(parsed.column != null ? { column: parsed.column } : {}),
              source: 'git'
            })).catch(err => notifyUser(tr('打开文件失败', 'Open file failed'), err?.message || ''));
          }
        });
        container.appendChild(pill);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < str.length) {
        container.appendChild(document.createTextNode(str.slice(lastIndex)));
      }
    }

    function findThinkingBody(trigger, container) {
      const controlsId = trigger?.getAttribute?.('aria-controls');
      if (controlsId) {
        const byId = document.getElementById?.(controlsId);
        if (byId && !byId.hasAttribute?.('data-agy-thought-box')) return byId;
      }
      if (container) {
        const explicit = container.querySelector?.('[data-testid="thinking-content"], [data-testid="thinking-body"], [data-testid="planner-thinking-text"]');
        if (explicit) return explicit;
      }
      let next = trigger?.nextElementSibling;
      while (next) {
        if (!next.hasAttribute?.('data-agy-thought-box')) return next;
        next = next.nextElementSibling;
      }
      return null;
    }

    function isThinkingExpanded(trigger, container, bodyEl) {
      const aria = trigger?.getAttribute?.('aria-expanded');
      if (aria === 'true') return true;
      if (aria === 'false') return false;
      const st = trigger?.getAttribute?.('data-state') || container?.getAttribute?.('data-state');
      if (st === 'open') return true;
      if (st === 'closed') return false;
      if (!bodyEl) return false;
      if (bodyEl.hidden === true || bodyEl.style?.display === 'none' || bodyEl.getAttribute?.('data-state') === 'closed') return false;
      return true;
    }

    function isThinkingFinished(trigger, container) {
      if (trigger?.getAttribute?.('data-streaming') === 'true' || container?.getAttribute?.('data-streaming') === 'true') return false;
      if (trigger?.getAttribute?.('data-active') === 'true' || container?.getAttribute?.('data-active') === 'true') return false;
      const tText = String(trigger?.textContent || '').trim();
      if (/^(?:Thinking\.\.\.|正在思考\.\.\.|思考中)/i.test(tText)) return false;
      return true;
    }

    function extractThinkingText(trigger, container, bodyEl) {
      const fromAttr = container?.getAttribute?.('data-thinking-text') || trigger?.getAttribute?.('data-thinking-text');
      if (fromAttr && fromAttr.trim()) return fromAttr.trim();
      if (!bodyEl) return '';
      return String(bodyEl.textContent || '').trim();
    }

    function renderThoughtBox(container, record, expanded) {
      const opts = getOpts();
      if (!record.box || !record.box.isConnected) {
        const box = el('div', {
          className: 'agy-thought-box',
          'data-agy-thought-box': '1',
          'data-agy-powertools-root': 'workbench-thought',
          'data-testid': 'agy-thought-box',
          translate: 'no',
          'data-agy-no-translate': 'true'
        });
        if (record.bodyEl && record.bodyEl.parentElement) {
          record.bodyEl.parentElement.insertBefore(box, record.bodyEl.nextSibling || null);
        } else {
          container.appendChild(box);
        }
        record.box = box;
        trackedThoughtBoxes.add(box);
      }

      const box = record.box;
      const viewMode = opts.thoughtView === 'immersive' ? 'immersive' : 'bilingual';
      box.setAttribute('data-view', viewMode);
      box.setAttribute('data-show-original', record.showOriginal ? '1' : '0');
      box.setAttribute('data-preloaded', expanded ? '0' : '1');
      box.hidden = !expanded;
      if (box.style) box.style.display = expanded ? '' : 'none';

      // Manage original body visibility without mutating any React text node
      if (record.bodyEl) {
        const shouldHideOrig = expanded && record.status === 'done' && !record.showOriginal;
        if (shouldHideOrig) {
          record.bodyEl.setAttribute?.('data-agy-thought-hidden', '1');
          hiddenThoughtBodies.add(record.bodyEl);
        } else {
          record.bodyEl.removeAttribute?.('data-agy-thought-hidden');
          hiddenThoughtBodies.delete(record.bodyEl);
        }
      }

      while (box.firstChild) box.removeChild(box.firstChild);

      const header = el('div', { className: 'agy-thought-head' },
        el('span', {
          textContent: record.status === 'loading'
            ? tr('正在转译思考过程...', 'Translating thought...')
            : record.status === 'error'
              ? tr('思考转译失败', 'Translation failed')
              : (viewMode === 'immersive' ? tr('思考译文', 'Translated Thought') : tr('双语思考对照', 'Bilingual Thought'))
        }),
        el('div', { className: 'agy-thought-actions' },
          el('button', {
            type: 'button',
            className: 'agy-thought-btn',
            'data-testid': 'agy-thought-view-toggle',
            textContent: record.showOriginal ? tr('译文', 'Translation') : tr('译文 / 原文切换', 'Toggle Original'),
            onClick: e => {
              e.stopPropagation();
              record.showOriginal = !record.showOriginal;
              renderThoughtBox(container, record, expanded);
            }
          }),
          el('button', {
            type: 'button',
            className: 'agy-thought-btn',
            'data-testid': 'agy-thought-retry',
            textContent: tr('重新翻译', 'Retranslate'),
            onClick: e => {
              e.stopPropagation();
              void requestThoughtTranslation(container, record, true, expanded);
            }
          })
        )
      );
      box.appendChild(header);

      if (record.status === 'loading') {
        box.appendChild(el('div', { style: { color: 'var(--muted-foreground)' }, textContent: tr('正在生成译文...', 'Translating...') }));
        return;
      }
      if (record.status === 'error') {
        box.appendChild(el('div', { style: { color: 'var(--error, #ef4444)' }, textContent: record.error || tr('转译请求失败', 'Translation request failed') }));
        return;
      }
      if (record.showOriginal) {
        box.appendChild(el('div', { style: { fontSize: '11.5px', color: 'var(--muted-foreground)' }, textContent: tr('当前已显示原文，点击上方按钮切回译文。', 'Showing original text. Click above to view translation.') }));
        return;
      }

      if (viewMode === 'immersive') {
        const prose = el('div', { className: 'agy-thought-trans', 'data-testid': 'agy-thought-immersive-body' });
        appendTranslatedTextWithFilePills(prose, record.translated);
        box.appendChild(prose);
      } else {
        const origParas = String(record.text || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
        const transParas = String(record.translated || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
        const count = Math.max(origParas.length, transParas.length, 1);
        for (let i = 0; i < count; i++) {
          const origP = origParas[i] || '';
          const transP = transParas[i] || '';
          const pair = el('div', { className: 'agy-thought-pair', 'data-agy-thought-pair': '1' });
          if (origP) pair.appendChild(el('div', { className: 'agy-thought-orig', 'data-agy-thought-orig': '1', textContent: origP }));
          if (transP) {
            const transNode = el('div', { className: 'agy-thought-trans', 'data-agy-thought-trans': '1' });
            appendTranslatedTextWithFilePills(transNode, transP);
            pair.appendChild(transNode);
          }
          box.appendChild(pair);
        }
      }
    }

    async function requestThoughtTranslation(container, record, force = false, expanded = true) {
      const opts = getOpts();
      if (disposed || !opts.enabled || opts.thoughtTranslate === 'off') return;
      const cacheKey = JSON.stringify([opts.thoughtTranslate, opts.language || 'zh-CN', opts.thoughtStyle || 'technical', opts.thoughtCustomPrompt || '', record.text]);
      if (!force && record.status === 'done' && record.key === cacheKey) {
        renderThoughtBox(container, record, expanded);
        return;
      }
      record.key = cacheKey;
      record.status = 'loading';
      record.error = '';
      renderThoughtBox(container, record, expanded);

      let promise = !force ? thoughtInFlight.get(cacheKey) : null;
      if (!promise) {
        promise = Promise.resolve(env.request?.('thought.translate', {
          text: record.text,
          mode: opts.thoughtTranslate,
          targetLang: opts.language || 'zh-CN',
          style: opts.thoughtStyle || 'technical',
          customPrompt: opts.thoughtCustomPrompt || '',
          force: Boolean(force)
        }));
        if (!force) {
          thoughtInFlight.set(cacheKey, promise);
          promise.finally(() => {
            if (thoughtInFlight.get(cacheKey) === promise) thoughtInFlight.delete(cacheKey);
          });
        }
      }

      try {
        const res = await promise;
        if (disposed || !getOpts().enabled || getOpts().thoughtTranslate === 'off') return;
        record.translated = String(res?.translated || '');
        record.status = 'done';
        const trigger = container.querySelector?.('[data-testid="thinking-collapsible-trigger"]');
        const nowExpanded = trigger ? isThinkingExpanded(trigger, container, record.bodyEl) : expanded;
        renderThoughtBox(container, record, nowExpanded);
      } catch (err) {
        if (disposed || !getOpts().enabled || getOpts().thoughtTranslate === 'off') return;
        record.status = 'error';
        record.error = err?.message || String(err);
        const trigger = container.querySelector?.('[data-testid="thinking-collapsible-trigger"]');
        const nowExpanded = trigger ? isThinkingExpanded(trigger, container, record.bodyEl) : expanded;
        renderThoughtBox(container, record, nowExpanded);
      }
    }

    function clearThoughtOverlays() {
      for (const box of trackedThoughtBoxes) {
        box.remove?.();
      }
      trackedThoughtBoxes.clear();
      for (const node of document.querySelectorAll?.('[data-agy-thought-box="1"]') || []) {
        node.remove?.();
      }
      for (const body of hiddenThoughtBodies) {
        body.removeAttribute?.('data-agy-thought-hidden');
      }
      hiddenThoughtBodies.clear();
      for (const body of document.querySelectorAll?.('[data-agy-thought-hidden="1"]') || []) {
        body.removeAttribute?.('data-agy-thought-hidden');
      }
    }

    function syncThoughts() {
      const opts = getOpts();
      if (!opts.enabled || opts.thoughtTranslate === 'off') {
        clearThoughtOverlays();
        return;
      }
      const triggers = [...(document.querySelectorAll?.('[data-testid="thinking-collapsible-trigger"]') || [])];
      const blocks = triggers.map(trigger => {
        const container = trigger.closest?.('[data-testid="thinking-block"], [data-testid="thinking-container"]') || trigger.parentElement;
        if (!container) return null;
        const bodyEl = findThinkingBody(trigger, container);
        const expanded = isThinkingExpanded(trigger, container, bodyEl);
        const finished = isThinkingFinished(trigger, container);
        const text = extractThinkingText(trigger, container, bodyEl);
        return { trigger, container, bodyEl, expanded, finished, text };
      }).filter(Boolean);

      // Determine latest finished block for preload mode
      let latestFinishedBlock = null;
      if (opts.thoughtTrigger === 'preload') {
        for (let i = blocks.length - 1; i >= 0; i--) {
          if (blocks[i].finished && blocks[i].text) {
            latestFinishedBlock = blocks[i];
            break;
          }
        }
      }

      for (const block of blocks) {
        const { container, bodyEl, expanded, finished, text } = block;
        let record = thoughtStateMap.get(container);
        if (!text) continue;
        const shouldTranslate = (expanded && finished) || (opts.thoughtTrigger === 'preload' && block === latestFinishedBlock);
        if (!shouldTranslate) {
          if (record?.box) renderThoughtBox(container, record, expanded);
          continue;
        }
        if (!record) {
          record = { text, translated: '', status: 'idle', key: '', showOriginal: false, box: null, bodyEl };
          thoughtStateMap.set(container, record);
        } else {
          record.bodyEl = bodyEl;
          if (record.text !== text) {
            record.text = text;
            record.status = 'idle';
          }
        }
        const cacheKey = JSON.stringify([opts.thoughtTranslate, opts.language || 'zh-CN', opts.thoughtStyle || 'technical', opts.thoughtCustomPrompt || '', text]);
        if (record.status === 'done' && record.key === cacheKey) {
          renderThoughtBox(container, record, expanded);
        } else if (record.status !== 'loading' || record.key !== cacheKey) {
          void requestThoughtTranslation(container, record, false, expanded);
        }
      }
    }

    function isMostlyCjk(text) {
      const s = String(text || '').trim();
      const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
      const latin = (s.match(/[A-Za-z]/g) || []).length;
      return cjk >= 2 && cjk >= latin;
    }

    function resolveSidebarTitleTarget(node) {
      if (!node) return null;
      if (node.tagName === 'A' || node.getAttribute?.('href')?.startsWith('/c/')) {
        const inner = node.querySelector?.('[data-testid="conversation-title"], span.truncate, span');
        return inner && inner.textContent?.trim() ? inner : node;
      }
      const link = node.querySelector?.('a[href^="/c/"]');
      if (link) {
        const inner = link.querySelector?.('[data-testid="conversation-title"], span.truncate, span');
        return inner && inner.textContent?.trim() ? inner : link;
      }
      const inner = node.querySelector?.('[data-testid="conversation-title"], span.truncate, span');
      return inner && inner.textContent?.trim() ? inner : node;
    }

    function resolveConversationIdFromRow(node) {
      const link = node?.matches?.('a[href^="/c/"]') ? node : node?.querySelector?.('a[href^="/c/"]');
      const href = link?.getAttribute?.('href') || '';
      const m = href.match(/^\/c\/([^/?#]+)/);
      if (m) return decodeURIComponent(m[1]);
      return node?.getAttribute?.('data-conversation-id') || node?.dataset?.conversationId || node?.getAttribute?.('data-id') || '';
    }

    function restoreSessionTitles() {
      const toRestore = new Set(trackedTitleEls);
      for (const elNode of document.querySelectorAll?.('[data-agy-title-translated="1"]') || []) {
        toRestore.add(elNode);
      }
      for (const elNode of toRestore) {
        const snap = titleOriginals.get(elNode);
        if (snap) {
          elNode.textContent = snap.text;
          if (snap.hadTitleAttr) elNode.setAttribute?.('title', snap.origTitleAttr);
          else elNode.removeAttribute?.('title');
        }
        elNode.removeAttribute?.('data-agy-title-translated');
      }
      trackedTitleEls.clear();
    }

    function syncSessionTitles() {
      const opts = getOpts();
      if (!opts.enabled || !opts.translateSessionTitles || opts.thoughtTranslate === 'off') {
        restoreSessionTitles();
        return;
      }
      const targetLang = opts.language || 'zh-CN';
      const nodes = [...(document.querySelectorAll?.('[data-testid="conversation-row-sidebar"], .agy-sidebar-row a[href^="/c/"]') || [])];
      const seenTargets = new Set();
      const pendingItems = [];
      const itemTargetMap = new Map();

      for (const node of nodes) {
        const target = resolveSidebarTitleTarget(node);
        if (!target || seenTargets.has(target)) continue;
        seenTargets.add(target);
        const snap = titleOriginals.get(target);
        const rawTitle = snap ? snap.text : String(target.textContent || '').trim();
        if (!rawTitle) continue;
        if (targetLang.startsWith('zh') && isMostlyCjk(rawTitle)) continue;

        const cid = resolveConversationIdFromRow(node) || `title:${rawTitle}`;
        const cacheKey = `${opts.thoughtTranslate}|${targetLang}|${rawTitle}`;
        if (titleCache.has(cacheKey)) {
          const translated = titleCache.get(cacheKey);
          if (!snap) {
            titleOriginals.set(target, {
              text: rawTitle,
              hadTitleAttr: Boolean(target.hasAttribute?.('title')),
              origTitleAttr: target.getAttribute?.('title') || ''
            });
          }
          trackedTitleEls.add(target);
          target.setAttribute?.('data-agy-title-translated', '1');
          target.setAttribute?.('title', rawTitle);
          if (target.textContent !== translated) target.textContent = translated;
          continue;
        }
        if (titleInFlight.has(cacheKey) || pendingItems.length >= 24) continue;
        titleInFlight.add(cacheKey);
        pendingItems.push({ id: cid, title: rawTitle, cacheKey });
        itemTargetMap.set(cid, { target, rawTitle, cacheKey });
      }

      if (!pendingItems.length) return;
      void Promise.resolve(env.request?.('thought.translateTitles', {
        items: pendingItems.map(({ id, title }) => ({ id, title })),
        mode: opts.thoughtTranslate,
        targetLang
      })).then(res => {
        const translations = res?.translations || {};
        const nowOpts = getOpts();
        const stillActive = !disposed && nowOpts.enabled && nowOpts.translateSessionTitles && nowOpts.thoughtTranslate !== 'off';
        for (const item of pendingItems) {
          titleInFlight.delete(item.cacheKey);
          const translated = translations[item.id];
          if (typeof translated === 'string' && translated.trim()) {
            titleCache.set(item.cacheKey, translated.trim());
            if (stillActive) {
              const info = itemTargetMap.get(item.id);
              if (info?.target && info.target.isConnected !== false) {
                if (!titleOriginals.has(info.target)) {
                  titleOriginals.set(info.target, {
                    text: info.rawTitle,
                    hadTitleAttr: Boolean(info.target.hasAttribute?.('title')),
                    origTitleAttr: info.target.getAttribute?.('title') || ''
                  });
                }
                trackedTitleEls.add(info.target);
                info.target.setAttribute?.('data-agy-title-translated', '1');
                info.target.setAttribute?.('title', info.rawTitle);
                info.target.textContent = translated.trim();
              }
            }
          }
        }
      }).catch(() => {
        for (const item of pendingItems) titleInFlight.delete(item.cacheKey);
      });
    }

    // =========================================================================
    // 3. Code Block Sticky Header & Manual Fold + Inline Step Diff
    // =========================================================================
    function countCodeLines(pre) {
      const code = pre.querySelector?.('code') || pre;
      const raw = String(code.textContent || '');
      const trimmed = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
      return trimmed ? trimmed.split('\n').length : 0;
    }

    function toggleCodeFold(pre, btn, lineCount) {
      const wasFolded = pre.getAttribute?.('data-agy-code-folded') === '1';
      if (wasFolded) {
        pre.removeAttribute?.('data-agy-code-folded');
        foldedPreEls.delete(pre);
        btn.setAttribute?.('aria-expanded', 'true');
        btn.textContent = tr(`折叠 (${lineCount}行)`, `Fold (${lineCount} lines)`);
        return;
      }

      // Measure scroll position BEFORE folding to prevent viewport jumps
      const viewport = pre.closest?.('[data-testid="autoscroll-viewport"]') || document.querySelector?.('[data-testid="autoscroll-viewport"]');
      const preRectBefore = pre.getBoundingClientRect?.();
      const vpRect = viewport?.getBoundingClientRect?.();
      const heightBefore = preRectBefore?.height ?? pre.offsetHeight ?? 0;
      const preTopRel = preRectBefore && vpRect
        ? (preRectBefore.top - vpRect.top)
        : (preRectBefore ? preRectBefore.top : 0);
      const scrolledPastTop = preTopRel < 0;

      pre.setAttribute?.('data-agy-code-folded', '1');
      foldedPreEls.add(pre);
      btn.setAttribute?.('aria-expanded', 'false');
      btn.textContent = tr(`展开 (${lineCount}行)`, `Expand (${lineCount} lines)`);

      if (viewport && scrolledPastTop) {
        const preRectAfter = pre.getBoundingClientRect?.();
        const heightAfter = preRectAfter?.height ?? pre.offsetHeight ?? 0;
        const delta = Math.max(0, heightBefore - heightAfter);
        if (delta > 0) {
          const compensation = Math.min(delta, Math.abs(preTopRel));
          viewport.scrollTop = Math.max(0, (viewport.scrollTop || 0) - compensation);
        }
      }
    }

    function cleanupCodeFold() {
      document.documentElement?.removeAttribute?.('data-agy-code-fold');
      for (const pre of foldedPreEls) pre.removeAttribute?.('data-agy-code-folded');
      foldedPreEls.clear();
      for (const hEl of stickyCodeHeaders) hEl.classList?.remove?.('agy-code-sticky-header');
      stickyCodeHeaders.clear();
      for (const node of injectedCodeNodes) node.remove?.();
      injectedCodeNodes.clear();
    }

    function syncCodeFold() {
      const opts = getOpts();
      if (!opts.enabled || !opts.codeBlockFold) {
        cleanupCodeFold();
        return;
      }
      document.documentElement?.setAttribute?.('data-agy-code-fold', '1');
      const containers = [...(document.querySelectorAll?.('[data-testid="conversation-view"], [data-testid="artifact-view"]') || [])];
      const pres = [];
      for (const c of containers) {
        for (const p of c.querySelectorAll?.('pre') || []) pres.push(p);
      }

      for (const pre of pres) {
        if (pre.closest?.('[data-agy-powertools-root]')) continue;
        if (pre.closest?.('[data-streaming="true"]')) continue;

        let header = pre.previousElementSibling;
        if (header && !header.matches?.('[data-testid="code-block-header"], .code-header, header, .agy-code-synth-header') && !header.querySelector?.('button')) {
          header = null;
        }
        if (header) {
          header.classList?.add?.('agy-code-sticky-header');
          stickyCodeHeaders.add(header);
        }

        const lineCount = countCodeLines(pre);
        if (lineCount < CODE_FOLD_MIN_LINES) continue;

        const existingBtn = header?.querySelector?.('[data-testid="agy-code-fold-btn"]') || pre.parentElement?.querySelector?.('[data-testid="agy-code-fold-btn"]');
        if (existingBtn) {
          const isFolded = pre.getAttribute?.('data-agy-code-folded') === '1';
          existingBtn.textContent = isFolded
            ? tr(`展开 (${lineCount}行)`, `Expand (${lineCount} lines)`)
            : tr(`折叠 (${lineCount}行)`, `Fold (${lineCount} lines)`);
          continue;
        }

        if (!header && pre.parentElement) {
          header = el('div', {
            className: 'agy-code-sticky-header agy-code-synth-header',
            'data-agy-powertools-root': 'workbench-code-fold',
            translate: 'no',
            'data-agy-no-translate': 'true'
          });
          pre.parentElement.insertBefore(header, pre);
          injectedCodeNodes.add(header);
          stickyCodeHeaders.add(header);
        }
        if (!header) continue;

        const btn = el('button', {
          type: 'button',
          className: 'agy-code-fold-btn',
          'data-testid': 'agy-code-fold-btn',
          'data-agy-powertools-root': 'workbench-code-fold',
          'aria-expanded': 'true',
          textContent: tr(`折叠 (${lineCount}行)`, `Fold (${lineCount} lines)`),
          onClick: e => {
            e.preventDefault();
            e.stopPropagation();
            toggleCodeFold(pre, btn, countCodeLines(pre));
          }
        });
        header.appendChild(btn);
        injectedCodeNodes.add(btn);
      }
    }

    function extractDiffPath(row, chip) {
      const direct = row?.getAttribute?.('data-uri') || row?.getAttribute?.('data-path') || chip?.getAttribute?.('data-uri') || chip?.getAttribute?.('data-path');
      if (direct) return direct;
      const uriEl = row?.querySelector?.('[data-uri], [data-path]');
      if (uriEl) return uriEl.getAttribute?.('data-uri') || uriEl.getAttribute?.('data-path') || '';
      const codeOrSpan = row?.querySelector?.('code, [data-testid="file-path"], a');
      if (codeOrSpan?.textContent?.trim()) return codeOrSpan.textContent.trim();
      return '';
    }

    async function toggleInlineDiffDrawer(row, filePath, toggleBtn) {
      let state = diffDrawerMap.get(row);
      if (state?.open && state.drawer?.isConnected) {
        state.drawer.remove?.();
        injectedDiffNodes.delete(state.drawer);
        state.open = false;
        if (toggleBtn) toggleBtn.textContent = tr('查看差异', 'View diff');
        return;
      }
      if (!state) {
        state = { drawer: null, open: false, loading: false, path: filePath };
        diffDrawerMap.set(row, state);
      }
      state.open = true;
      state.loading = true;
      if (toggleBtn) toggleBtn.textContent = tr('收起差异', 'Hide diff');

      const drawer = el('div', {
        className: 'agy-inline-diff-drawer',
        'data-testid': 'agy-inline-diff-drawer',
        'data-agy-powertools-root': 'workbench-diff',
        translate: 'no',
        'data-agy-no-translate': 'true'
      },
        el('div', { className: 'agy-inline-diff-notice', textContent: tr('正在加载差异...', 'Loading diff...') })
      );
      state.drawer = drawer;
      injectedDiffNodes.add(drawer);
      if (row.parentElement) row.parentElement.insertBefore(drawer, row.nextSibling || null);
      else row.appendChild(drawer);

      const cid = currentConversationId();
      const wsUri = currentWorkspaceUri(cid);
      try {
        const res = await Promise.resolve(env.request?.('diff.inline', {
          conversationId: cid,
          workspaceUri: wsUri,
          path: absoluteFileUri(filePath.trim()) || filePath.trim()
        }));
        if (disposed || !state.open || !drawer.isConnected) return;
        while (drawer.firstChild) drawer.removeChild(drawer.firstChild);

        const openBtn = el('button', {
          type: 'button',
          className: 'agy-diff-toggle-btn',
          'data-testid': 'agy-inline-diff-open-editor',
          textContent: tr('在编辑器中打开', 'Open in editor'),
          onClick: e => {
            e.stopPropagation();
            void Promise.resolve(env.request?.('file.openEditor', {
              uri: toFileUri(filePath, wsUri),
              source: 'git'
            })).catch(err => notifyUser(tr('在编辑器中打开失败', 'Failed to open editor'), err?.message || ''));
          }
        });
        const badges = [];
        if (res?.untracked) badges.push(el('span', { style: { fontSize: '10.5px', color: 'var(--primary)' }, textContent: tr('未跟踪文件', 'Untracked') }));
        if (res?.truncated) badges.push(el('span', { style: { fontSize: '10.5px', color: 'var(--warning, #d97706)' }, textContent: tr('已截断', 'Truncated') }));

        drawer.appendChild(el('div', { className: 'agy-inline-diff-head' },
          el('span', { className: 'agy-inline-diff-path', textContent: stripUriMeta(filePath) }),
          el('div', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, ...badges, openBtn)
        ));

        if (res?.binary) {
          drawer.appendChild(el('div', {
            className: 'agy-inline-diff-notice',
            'data-testid': 'agy-inline-diff-binary',
            textContent: tr('二进制文件，无法显示文本差异。', 'Binary file, text diff unavailable.')
          }));
        } else if (Array.isArray(res?.lines) && res.lines.length) {
          const body = el('div', { className: 'agy-inline-diff-body' });
          for (const line of res.lines) {
            body.appendChild(el('div', {
              className: 'agy-git-diff-line',
              'data-kind': line.kind || 'ctx',
              textContent: String(line.text ?? '')
            }));
          }
          drawer.appendChild(body);
        } else {
          drawer.appendChild(el('div', {
            className: 'agy-inline-diff-notice',
            textContent: tr('暂无可展示的差异内容。', 'No diff hunks available.')
          }));
        }
      } catch (err) {
        if (disposed || !drawer.isConnected) return;
        while (drawer.firstChild) drawer.removeChild(drawer.firstChild);
        drawer.appendChild(el('div', {
          className: 'agy-inline-diff-notice',
          style: { color: 'var(--error, #ef4444)' },
          textContent: err?.message || tr('加载差异失败', 'Failed to load diff')
        }));
      } finally {
        state.loading = false;
      }
    }

    function cleanupInlineDiff() {
      for (const node of injectedDiffNodes) node.remove?.();
      injectedDiffNodes.clear();
    }

    function syncInlineDiff() {
      const opts = getOpts();
      if (!opts.enabled || !opts.inlineStepDiff) {
        cleanupInlineDiff();
        return;
      }
      const targets = [...(document.querySelectorAll?.('[data-testid="diff-line-count"], [data-testid="file-change-row"], [data-testid="step-file-edit"]') || [])];
      const seenRows = new Set();
      for (const target of targets) {
        if (target.closest?.('[data-agy-powertools-root]')) continue;
        const row = target.closest?.('[data-testid="file-change-row"], [data-testid="step-file-edit"], [data-uri], [data-path]') || target.parentElement || target;
        if (!row || seenRows.has(row)) continue;
        seenRows.add(row);
        const filePath = extractDiffPath(row, target);
        if (!filePath) continue;
        if (row.querySelector?.('[data-testid="agy-inline-diff-toggle"]')) continue;

        const btn = el('button', {
          type: 'button',
          className: 'agy-diff-toggle-btn',
          'data-testid': 'agy-inline-diff-toggle',
          'data-agy-powertools-root': 'workbench-diff',
          textContent: tr('查看差异', 'View diff'),
          onClick: e => {
            e.preventDefault();
            e.stopPropagation();
            void toggleInlineDiffDrawer(row, filePath, btn);
          }
        });
        row.appendChild(btn);
        injectedDiffNodes.add(btn);

        if (target.getAttribute?.('data-testid') === 'diff-line-count' && !target.hasAttribute?.('data-agy-diff-bound')) {
          target.setAttribute?.('data-agy-diff-bound', '1');
          target.addEventListener?.('click', e => {
            if (disposed || !getOpts().enabled || !getOpts().inlineStepDiff) return;
            e.stopPropagation();
            void toggleInlineDiffDrawer(row, filePath, btn);
          }, listenerOpts);
        }
      }
    }

    // =========================================================================
    // 4. Conversation Rail Hover Outline & Alt+Up / Alt+Down Navigation
    // =========================================================================
    function collectConversationTurns() {
      const st = typeof env.state === 'function' ? env.state() : env.state;
      const domSteps = [...(document.querySelectorAll?.('[data-testid="user-input-step"]') || [])];
      if (Array.isArray(st?.turns) && st.turns.length) {
        return st.turns.map((turn, idx) => ({
          index: idx,
          turnNumber: turn.turnNumber ?? (idx + 1),
          title: String(turn.promptTitle || domSteps[idx]?.textContent || '').trim() || tr(`第 ${idx + 1} 轮`, `Turn ${idx + 1}`),
          turn,
          el: domSteps[idx] || null
        }));
      }
      return domSteps.map((node, idx) => ({
        index: idx,
        turnNumber: idx + 1,
        title: String(node.textContent || '').trim() || tr(`第 ${idx + 1} 轮`, `Turn ${idx + 1}`),
        turn: { turnNumber: idx + 1, stepIndexStart: idx },
        el: node
      }));
    }

    function jumpToTurn(idx) {
      const turns = collectConversationTurns();
      if (!turns.length) return false;
      const clamped = Math.max(0, Math.min(turns.length - 1, idx));
      activeTurnIndex = clamped;
      const item = turns[clamped];
      if (typeof env.adapter?.navigateTurn === 'function' && item.turn) {
        try {
          if (env.adapter.navigateTurn(item.turn)) return true;
        } catch {}
      }
      if (item.el && typeof item.el.scrollIntoView === 'function') {
        item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
      return false;
    }

    function collapseHistoricalSteps() {
      const expanded = [...(document.querySelectorAll?.('[data-testid="worked-for-collapsible"][aria-expanded="true"], [data-testid="tool-group-collapsible"][aria-expanded="true"]') || [])];
      let count = 0;
      for (const btn of expanded) {
        try {
          btn.click?.();
          count++;
        } catch {}
      }
      return count;
    }

    function closeRailPopover() {
      if (railCloseTimer) { clearTimeout(railCloseTimer); railCloseTimer = null; }
      activeRailPopover?.remove?.();
      activeRailPopover = null;
      activeRailAnchor = null;
    }

    function scheduleRailClose() {
      if (railCloseTimer) clearTimeout(railCloseTimer);
      railCloseTimer = setTimeout(() => { closeRailPopover(); }, 180);
    }

    function openRailPopover(railEl) {
      const opts = getOpts();
      if (disposed || !opts.enabled || !opts.railHoverOutline) return;
      if (railCloseTimer) { clearTimeout(railCloseTimer); railCloseTimer = null; }
      if (activeRailPopover && activeRailAnchor === railEl && activeRailPopover.isConnected) return;
      closeRailPopover();

      const turns = collectConversationTurns();
      const rect = railEl.getBoundingClientRect?.() || { left: 24, top: 120, right: 56, height: 200 };
      const pop = el('div', {
        className: 'agy-rail-popover',
        'data-testid': 'agy-rail-popover',
        'data-agy-powertools-root': 'workbench-rail',
        translate: 'no',
        'data-agy-no-translate': 'true',
        style: {
          left: `${Math.max(12, Math.round((rect.right || 48) + 8))}px`,
          top: `${Math.max(48, Math.round(rect.top || 100))}px`
        }
      });

      const listEl = el('div', { className: 'agy-rail-list', 'data-testid': 'agy-rail-list' });
      const renderList = query => {
        while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
        const q = String(query || '').trim().toLowerCase();
        const filtered = q ? turns.filter(item => item.title.toLowerCase().includes(q) || String(item.turnNumber).includes(q)) : turns;
        if (!filtered.length) {
          listEl.appendChild(el('div', { style: { padding: '12px', color: 'var(--muted-foreground)', textAlign: 'center' }, textContent: tr('没有匹配的提问', 'No matching prompts') }));
          return;
        }
        for (const item of filtered) {
          if (!q && (item.turnNumber === 1 || (item.turnNumber - 1) % 5 === 0) && turns.length >= 5) {
            const endNum = Math.min(turns.length, item.turnNumber + 4);
            listEl.appendChild(el('div', {
              className: 'agy-rail-chapter',
              'data-testid': 'agy-rail-chapter',
              'data-agy-chapter-marker': '1',
              textContent: tr(`第 ${item.turnNumber} - ${endNum} 轮`, `Turns ${item.turnNumber} - ${endNum}`)
            }));
          }
          listEl.appendChild(el('button', {
            type: 'button',
            className: 'agy-rail-item',
            'data-testid': `agy-rail-turn-${item.turnNumber}`,
            onClick: () => {
              jumpToTurn(item.index);
              closeRailPopover();
            }
          },
            el('span', { className: 'agy-rail-num', textContent: `#${item.turnNumber}` }),
            el('span', { className: 'agy-rail-text', textContent: item.title })
          ));
        }
      };

      const filterInput = el('input', {
        type: 'search',
        className: 'agy-rail-filter',
        'data-testid': 'agy-rail-filter',
        placeholder: tr('过滤本会话提问...', 'Filter prompts...'),
        onInput: e => renderList(e.target?.value || '')
      });

      const collapseBtn = el('button', {
        type: 'button',
        className: 'agy-rail-collapse-btn',
        'data-testid': 'agy-rail-collapse-steps',
        textContent: tr('收起步骤', 'Collapse steps'),
        onClick: e => {
          e.stopPropagation();
          collapseHistoricalSteps();
        }
      });

      pop.appendChild(el('div', { className: 'agy-rail-pop-head' }, filterInput, collapseBtn));
      pop.appendChild(listEl);
      renderList('');

      pop.addEventListener?.('mouseenter', () => {
        if (railCloseTimer) { clearTimeout(railCloseTimer); railCloseTimer = null; }
      });
      pop.addEventListener?.('mouseleave', () => scheduleRailClose());

      document.body?.appendChild(pop);
      activeRailPopover = pop;
      activeRailAnchor = railEl;
    }

    function syncRailOutline() {
      const opts = getOpts();
      if (!opts.enabled || !opts.railHoverOutline) {
        closeRailPopover();
        return;
      }
      const rails = [...(document.querySelectorAll?.('[data-testid="conversation-navigator"], [data-testid="agy-turn-outline"]') || [])];
      for (const rail of rails) {
        if (boundRails.has(rail)) continue;
        boundRails.add(rail);
        rail.addEventListener?.('mouseenter', () => openRailPopover(rail), listenerOpts);
        rail.addEventListener?.('mouseleave', () => scheduleRailClose(), listenerOpts);
      }
    }

    function handleRailKeydown(event) {
      const opts = getOpts();
      if (disposed || !opts.enabled || !opts.railHoverOutline) return;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (isEditableElement(event.target) || isEditableElement(document.activeElement)) return;

      const turns = collectConversationTurns();
      if (!turns.length) return;

      // Infer current turn from DOM positions if available and distinct
      let baseIndex = activeTurnIndex;
      const vp = document.querySelector?.('[data-testid="autoscroll-viewport"]');
      const vpTop = vp?.getBoundingClientRect?.()?.top ?? 0;
      const tops = turns.map(t => t.el?.getBoundingClientRect?.()?.top);
      const hasDistinctTops = tops.filter(v => typeof v === 'number').length > 1 && new Set(tops).size > 1;
      if (hasDistinctTops && baseIndex < 0) {
        let inferred = 0;
        for (let i = 0; i < tops.length; i++) {
          if (typeof tops[i] === 'number' && tops[i] <= vpTop + 32) inferred = i;
        }
        baseIndex = inferred;
      }
      if (baseIndex < 0 || baseIndex >= turns.length) {
        baseIndex = event.key === 'ArrowUp' ? turns.length - 1 : 0;
      }
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      const nextIndex = Math.max(0, Math.min(turns.length - 1, baseIndex + delta));
      event.preventDefault?.();
      jumpToTurn(nextIndex);
    }

    // =========================================================================
    // 5. Unified Quick Context Menu & Bare-URL / Omni Streaming Viewer
    // =========================================================================
    const BARE_LINK_RE = /(?:https?:\/\/[^\s<>"'`)\]]+|(?<![A-Za-z0-9_])localhost:\d{2,5}(?:\/[^\s<>"'`)\]]*)?|(?<![A-Za-z0-9_:.])(?:[A-Za-z]:[\\/]|\\\\|\/(?=[A-Za-z0-9._%#-]+\/))(?:[A-Za-z0-9._%#-]+[\\/])*[A-Za-z0-9._%#-]+(?::\d+(?::\d+)?)?)/g;

    function clearBareLinkHighlights() {
      bareLinkEntries = [];
      try {
        if (typeof globalThis.CSS !== 'undefined' && globalThis.CSS.highlights) {
          globalThis.CSS.highlights.delete('agy-omni-link');
        }
      } catch {}
    }

    function collectTextNodes(root, out) {
      if (!root) return;
      if (root.nodeType === 3) {
        if (root.nodeValue && root.nodeValue.trim()) out.push(root);
        return;
      }
      if (root.nodeType === 1) {
        const tag = String(root.tagName || '').toUpperCase();
        if (tag === 'A' || tag === 'BUTTON' || tag === 'PRE' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG') return;
        if (root.hasAttribute?.('data-agy-powertools-root') || root.hasAttribute?.('data-agy-thought-box')) return;
      }
      const children = root.childNodes || [];
      for (let i = 0; i < children.length; i++) collectTextNodes(children[i], out);
    }

    function syncBareLinkHighlights() {
      const opts = getOpts();
      if (!opts.enabled || !opts.omniViewer) {
        clearBareLinkHighlights();
        return;
      }
      const responses = [...(document.querySelectorAll?.('[data-testid="agent-response"]') || [])];
      const nextEntries = [];
      const ranges = [];
      const canRange = typeof document.createRange === 'function';

      for (const resp of responses) {
        const textNodes = [];
        collectTextNodes(resp, textNodes);
        for (const tNode of textNodes) {
          const val = String(tNode.nodeValue || '');
          BARE_LINK_RE.lastIndex = 0;
          let m;
          while ((m = BARE_LINK_RE.exec(val)) !== null) {
            let token = m[0].replace(/[.,;:!?)]+$/, '');
            if (!token) continue;
            const start = m.index;
            const end = start + token.length;
            let range = null;
            if (canRange) {
              try {
                range = document.createRange();
                range.setStart(tNode, start);
                range.setEnd(tNode, end);
                ranges.push(range);
              } catch {}
            }
            const kind = /^(?:https?:\/\/|localhost:)/i.test(token) ? 'url' : 'path';
            nextEntries.push({ node: tNode, start, end, text: token, kind, range });
          }
        }
      }
      bareLinkEntries = nextEntries;

      try {
        if (typeof globalThis.CSS !== 'undefined' && globalThis.CSS.highlights && typeof globalThis.Highlight === 'function') {
          if (ranges.length) {
            globalThis.CSS.highlights.set('agy-omni-link', new globalThis.Highlight(...ranges));
          } else {
            globalThis.CSS.highlights.delete('agy-omni-link');
          }
        }
      } catch {}
    }

    function findBareLinkAtEvent(event) {
      const x = event.clientX;
      const y = event.clientY;
      let hadRects = false;
      for (const entry of bareLinkEntries) {
        if (entry.range && typeof entry.range.getClientRects === 'function') {
          const rects = entry.range.getClientRects() || [];
          if (rects.length > 0) hadRects = true;
          for (const r of rects) {
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return entry;
          }
        }
      }
      if (!hadRects && event.target) {
        const match = bareLinkEntries.find(e => e.node === event.target || e.node?.parentNode === event.target);
        if (match) return match;
      }
      return null;
    }

    function openExternalTarget(token, kind) {
      if (kind === 'path') {
        const { path, line, column } = parseFileRef(token);
        void Promise.resolve(env.request?.('file.openEditor', { uri: toFileUri(path, currentWorkspaceUri()), line, column, source: 'git' }))
          .catch(err => notifyUser(tr('打开文件失败', 'Open file failed'), err?.message || ''));
        return;
      }
      const url = /^localhost:/i.test(token) ? `http://${token}` : token;
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        void Promise.resolve(env.request?.('file.open', { uri: url })).catch(() => {});
      }
    }

    function handleBareLinkClick(event) {
      const opts = getOpts();
      if (disposed || !opts.enabled || !opts.omniViewer) return;
      if (event.target?.closest?.('a, button, [data-agy-powertools-root]')) return;
      if (!event.target?.closest?.('[data-testid="agent-response"]')) return;
      const hit = findBareLinkAtEvent(event);
      if (!hit) return;
      event.preventDefault?.();
      const defaultBuiltin = (opts.linkTarget || 'builtin') === 'builtin';
      const invert = Boolean(event.metaKey || event.ctrlKey);
      const openBuiltin = invert ? !defaultBuiltin : defaultBuiltin;
      if (openBuiltin) {
        void openOmniViewer(hit.kind === 'path' ? parseFileRef(hit.text).path : hit.text);
      } else {
        openExternalTarget(hit.text, hit.kind);
      }
    }

    function closeQuickMenu() {
      activeQuickMenu?.remove?.();
      activeQuickMenu = null;
    }

    function getSelectionText() {
      try {
        if (typeof window !== 'undefined' && typeof window.getSelection === 'function') {
          return String(window.getSelection()?.toString() || '').trim();
        }
        if (typeof globalThis.getSelection === 'function') {
          return String(globalThis.getSelection()?.toString() || '').trim();
        }
      } catch {}
      return '';
    }

    function findMainComposerCard() {
      const cards = [...(document.querySelectorAll?.('.surface-composer-card') || [])];
      if (!cards.length) return null;
      return cards.find(c => !env.adapter?.isNestedComposer?.(c)) || cards[0];
    }

    function readComposerDraft(card) {
      if (typeof env.adapter?.getComposerText === 'function') {
        try {
          const val = env.adapter.getComposerText(card);
          if (typeof val === 'string') return val.trim();
        } catch {}
      }
      const editable = card?.querySelector?.('[contenteditable="true"]') || document.querySelector?.('.surface-composer-card [contenteditable="true"]');
      return String(editable?.textContent || '').trim();
    }

    function writeComposerDraft(card, value) {
      if (typeof env.adapter?.setComposerText === 'function') {
        try {
          if (env.adapter.setComposerText(card, value)) return true;
        } catch {}
      }
      const editable = card?.querySelector?.('[contenteditable="true"]') || document.querySelector?.('.surface-composer-card [contenteditable="true"]');
      if (editable) {
        editable.textContent = value;
        if (typeof Event === 'function') {
          try { editable.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
        }
        editable.focus?.();
        return true;
      }
      return false;
    }

    function runQuickSlashCommand(slashCmd, quoteText = '') {
      const card = findMainComposerCard();
      const draft = readComposerDraft(card);
      if (draft.length > 0) {
        notifyUser(
          tr('输入框已有未发送草稿', 'Composer has unsent draft'),
          tr(`请先发送或清空草稿，再执行 ${slashCmd}`, `Please send or clear your draft before running ${slashCmd}`),
          'agy-quick-menu-draft-busy'
        );
        return false;
      }
      const trimmed = String(quoteText || '').trim();
      const fullText = trimmed ? `${slashCmd} ${trimmed}` : slashCmd;
      return writeComposerDraft(card, fullText);
    }

    function exportSvgToPng(svgEl, fileName = 'diagram.png') {
      try {
        const serializer = typeof XMLSerializer === 'function' ? new XMLSerializer() : null;
        const svgStr = serializer ? serializer.serializeToString(svgEl) : (svgEl.outerHTML || '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        const blob = typeof Blob === 'function' ? new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }) : null;
        const url = blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(blob)
          : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
        if (typeof Image === 'function') {
          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              const rect = svgEl.getBoundingClientRect?.() || { width: 800, height: 600 };
              canvas.width = Math.max(1, Math.round((img.width || rect.width || 800) * 2));
              canvas.height = Math.max(1, Math.round((img.height || rect.height || 600) * 2));
              const ctx = canvas.getContext?.('2d');
              if (ctx) {
                ctx.scale?.(2, 2);
                ctx.drawImage?.(img, 0, 0);
                const pngUrl = canvas.toDataURL?.('image/png');
                if (pngUrl) triggerDownload(pngUrl, fileName);
              }
            } finally {
              if (blob && typeof URL?.revokeObjectURL === 'function') URL.revokeObjectURL(url);
            }
          };
          img.src = url;
          notifyUser(tr('正在导出 PNG', 'Exporting PNG'), fileName, 'agy-export-png');
          return true;
        }
        triggerDownload(url, fileName);
        return true;
      } catch (err) {
        notifyUser(tr('导出 PNG 失败', 'PNG export failed'), err?.message || '', 'agy-export-png-err');
        return false;
      }
    }

    function triggerDownload(href, filename) {
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body?.appendChild(a);
      a.click?.();
      a.remove?.();
    }

    function showQuickMenu(x, y, items) {
      closeQuickMenu();
      const menu = el('div', {
        className: 'agy-qmenu',
        role: 'menu',
        'data-testid': 'agy-quick-context-menu',
        'data-agy-powertools-root': 'workbench-qmenu',
        translate: 'no',
        'data-agy-no-translate': 'true',
        style: {
          left: `${Math.max(8, Math.round(x || 0))}px`,
          top: `${Math.max(8, Math.round(y || 0))}px`
        }
      });

      for (const item of items) {
        if (item.sep) {
          menu.appendChild(el('div', { className: 'agy-qmenu-sep' }));
          continue;
        }
        menu.appendChild(el('button', {
          type: 'button',
          role: 'menuitem',
          className: 'agy-qmenu-item',
          'data-testid': item.testId,
          textContent: item.label,
          onClick: e => {
            e.stopPropagation();
            closeQuickMenu();
            item.onClick?.();
          }
        }));
      }

      document.body?.appendChild(menu);
      activeQuickMenu = menu;
    }

    function handleContextMenu(event) {
      const opts = getOpts();
      if (disposed || !opts.enabled || !opts.quickContextMenu) return;
      // Shift+Right-Click always passes through to native OS context menu
      if (event.shiftKey || event.defaultPrevented) return;
      // Never fight Powertools FileContextMenu or sidebar row/project menu
      if (event.target?.closest?.('[data-uri^="file://"], a[href^="file://"], .agy-sidebar-row, [data-testid="project-header"], [data-testid="agy-file-context-menu"]')) {
        return;
      }

      // 1. Mermaid SVG diagrams
      const mermaidSvg = event.target?.closest?.('.mermaid svg, [data-mermaid] svg, [data-testid*="mermaid"] svg, svg[id^="mermaid"]')
        || event.target?.closest?.('.mermaid, [data-mermaid]')?.querySelector?.('svg');
      if (mermaidSvg && !opts.omniViewer) return;
      if (mermaidSvg) {
        event.preventDefault?.();
        showQuickMenu(event.clientX, event.clientY, [
          {
            testId: 'agy-qmenu-mermaid-zoom',
            label: tr('缩放查看图表', 'Zoom diagram'),
            onClick: () => { void openOmniViewer('mermaid://diagram.svg', { kind: 'svg', svgElement: mermaidSvg, name: 'Mermaid Diagram' }); }
          },
          {
            testId: 'agy-qmenu-mermaid-png',
            label: tr('导出 PNG', 'Export PNG'),
            onClick: () => { exportSvgToPng(mermaidSvg, 'mermaid-diagram.png'); }
          },
          { sep: true },
          {
            testId: 'agy-qmenu-copy',
            label: tr('复制', 'Copy'),
            onClick: () => { void copyText(mermaidSvg.outerHTML || mermaidSvg.textContent || ''); }
          }
        ]);
        return;
      }

      // 2. Bare URL / local path or external anchor
      const anchor = event.target?.closest?.('a[href^="http://"], a[href^="https://"]');
      if (anchor && !opts.omniViewer) return;
      const bareHit = anchor
        ? { text: anchor.getAttribute('href'), kind: 'url' }
        : findBareLinkAtEvent(event);
      if (bareHit) {
        event.preventDefault?.();
        const isPath = bareHit.kind === 'path';
        const target = isPath ? parseFileRef(bareHit.text).path : bareHit.text;
        showQuickMenu(event.clientX, event.clientY, [
          {
            testId: 'agy-qmenu-open-builtin',
            label: tr('内置面板打开', 'Open in built-in viewer'),
            onClick: () => { void openOmniViewer(target); }
          },
          {
            testId: 'agy-qmenu-open-external',
            label: isPath ? tr('在编辑器中打开', 'Open in editor') : tr('系统浏览器打开', 'Open externally'),
            onClick: () => openExternalTarget(bareHit.text, bareHit.kind)
          },
          { sep: true },
          {
            testId: 'agy-qmenu-copy-link',
            label: tr('复制链接 / 路径', 'Copy link / path'),
            onClick: () => {
              void copyText(bareHit.text).then(ok => notifyUser(ok ? tr('已复制', 'Copied') : tr('复制失败', 'Copy failed'), bareHit.text, 'agy-qmenu-copy'));
            }
          },
          {
            testId: 'agy-qmenu-attach',
            label: tr('引用到输入框', 'Attach to chat'),
            onClick: () => {
              if (isPath) {
                const uri = toFileUri(target, currentWorkspaceUri());
                void Promise.resolve(env.request?.('file.attach', { uri, isDirectory: false }))
                  .then(res => env.adapter?.attachFileToComposer?.(res, event.target))
                  .catch(() => writeComposerDraft(findMainComposerCard(), bareHit.text));
              } else {
                const card = findMainComposerCard();
                const prev = readComposerDraft(card);
                writeComposerDraft(card, prev ? `${prev} ${bareHit.text}` : bareHit.text);
              }
            }
          }
        ]);
        return;
      }

      // 3. Conversation prose / selection inside [data-testid="conversation-view"]
      if (isEditableElement(event.target)) return;
      const inConv = event.target?.closest?.('[data-testid="conversation-view"]');
      if (!inConv) return;

      event.preventDefault?.();
      const selected = getSelectionText();
      const hoveredBlock = event.target?.closest?.('[data-testid="agent-response"], [data-testid="user-input-step"]');
      const copyPayload = selected || String(hoveredBlock?.textContent || '').trim();

      showQuickMenu(event.clientX, event.clientY, [
        {
          testId: 'agy-qmenu-copy',
          label: tr('复制', 'Copy'),
          onClick: () => {
            void copyText(copyPayload).then(ok => notifyUser(ok ? tr('已复制文本', 'Copied text') : tr('复制失败', 'Copy failed'), copyPayload.slice(0, 80), 'agy-qmenu-copy'));
          }
        },
        {
          testId: 'agy-qmenu-side',
          label: tr('侧边对话 (/btw)', 'Side chat (/btw)'),
          onClick: () => runQuickSlashCommand('/btw', selected)
        },
        { sep: true },
        {
          testId: 'agy-qmenu-plan',
          label: tr('基于选区规划 (/plan)', 'Plan from selection (/plan)'),
          onClick: () => runQuickSlashCommand('/plan', selected)
        },
        {
          testId: 'agy-qmenu-compact',
          label: tr('压缩上下文 (/compact)', 'Compact context (/compact)'),
          onClick: () => runQuickSlashCommand('/compact', '')
        },
        {
          testId: 'agy-qmenu-learn',
          label: tr('沉淀经验规则 (/learn)', 'Capture learning (/learn)'),
          onClick: () => runQuickSlashCommand('/learn', selected)
        },
        {
          testId: 'agy-qmenu-grill',
          label: tr('对齐访谈 (/grill-me)', 'Alignment interview (/grill-me)'),
          onClick: () => runQuickSlashCommand('/grill-me', selected)
        }
      ]);
    }

    function closeOmniViewer() {
      activeOmniDrawer?.remove?.();
      activeOmniDrawer = null;
      activeOmniFontStyle?.remove?.();
      activeOmniFontStyle = null;
      if (pickedMediaUrl) { URL.revokeObjectURL(pickedMediaUrl); pickedMediaUrl = null; }
    }

    function drawAudioWaveform(canvas, progressRatio = 0) {
      const ctx = canvas.getContext?.('2d');
      if (!ctx) return;
      const w = canvas.width || 480;
      const h = canvas.height || 84;
      ctx.clearRect?.(0, 0, w, h);
      const bars = 48;
      const gap = 3;
      const barW = Math.max(2, (w - gap * (bars - 1)) / bars);
      for (let i = 0; i < bars; i++) {
        const norm = 0.25 + 0.65 * Math.abs(Math.sin(i * 0.52) * Math.cos(i * 0.21));
        const bh = Math.max(6, Math.round(norm * (h - 14)));
        const x = i * (barW + gap);
        const y = Math.round((h - bh) / 2);
        const active = (i / bars) <= progressRatio;
        ctx.fillStyle = active ? '#669DF6' : 'rgba(148,163,184,0.45)';
        ctx.fillRect?.(x, y, barW, bh);
      }
    }

    function formatClock(seconds) {
      const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    }

    async function openOmniViewer(uriOrPath, meta = {}, pickedFile = null) {
      if (disposed) return { ok: false, error: 'disposed' };
      const opts = getOpts();
      if (!opts.enabled || (!pickedFile && !opts.omniViewer)) {
        return { ok: false, error: 'disabled' };
      }
      closeOmniViewer();

      const drawer = el('aside', {
        className: 'agy-goal-editor agy-omni-drawer',
        'data-testid': 'agy-omni-viewer-drawer',
        'data-agy-powertools-root': 'workbench-omni',
        translate: 'no',
        'data-agy-no-translate': 'true'
      });

      const titleEl = el('span', { className: 'agy-goal-editor-tab', 'data-testid': 'agy-omni-title', textContent: meta?.name || stripUriMeta(uriOrPath).split(/[\\/]/).pop() || String(uriOrPath || '') });
      const kindBadge = el('span', { 'data-testid': 'agy-omni-kind', style: { fontSize: '11px', color: 'var(--muted-foreground)' }, textContent: '' });
      const closeBtn = el('button', {
        type: 'button',
        className: 'agy-omni-btn',
        'data-testid': 'agy-omni-close',
        textContent: tr('关闭', 'Close'),
        onClick: () => closeOmniViewer()
      });

      const body = el('div', { className: 'agy-omni-body', 'data-testid': 'agy-omni-body' },
        el('div', { style: { color: 'var(--muted-foreground)' }, textContent: tr('正在加载流式预览...', 'Loading preview...') })
      );

      drawer.appendChild(el('div', { className: 'agy-goal-editor-top' },
        el('div', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: '0' } }, titleEl, kindBadge),
        closeBtn
      ));
      drawer.appendChild(body);
      document.body?.appendChild(drawer);
      activeOmniDrawer = drawer;

      let info = null;
      try {
        if (pickedFile) {
          pickedMediaUrl = URL.createObjectURL(pickedFile);
          info = { ok: true, name: pickedFile.name, kind: meta.kind, url: pickedMediaUrl };
        } else if (meta?.svgElement || meta?.inlineSvg) {
          info = { ok: true, kind: 'svg', name: meta.name || 'diagram.svg', url: '', svgElement: meta.svgElement, inlineSvg: meta.inlineSvg };
        } else if (/^(?:https?:\/\/|localhost:)/i.test(String(uriOrPath || '').trim()) && !meta?.forceRpc) {
          const rawUrl = String(uriOrPath).trim();
          const url = /^localhost:/i.test(rawUrl) ? `http://${rawUrl}` : rawUrl;
          info = { ok: true, kind: 'html', name: meta?.name || url, url };
        } else {
          info = await Promise.resolve(env.request?.('omni.open', { uriOrPath }));
        }
      } catch (err) {
        if (!drawer.isConnected) return { ok: false, error: err?.message || 'failed' };
        while (body.firstChild) body.removeChild(body.firstChild);
        body.appendChild(el('div', { style: { color: 'var(--error, #ef4444)' }, textContent: err?.message || tr('无法预览该资源', 'Unable to preview resource') }));
        return { ok: false, error: err?.message || 'failed' };
      }

      if (disposed || activeOmniDrawer !== drawer || !drawer.isConnected) {
        return { ok: false, error: 'closed' };
      }

      const kind = info?.kind || OMNI_EXT_KINDS[extOf(uriOrPath)] || 'binary';
      titleEl.textContent = info?.name || titleEl.textContent;
      kindBadge.textContent = kind.toUpperCase();
      drawer.setAttribute('data-omni-kind', kind);
      while (body.firstChild) body.removeChild(body.firstChild);

      if (kind === 'video') {
        const video = el('video', {
          className: 'agy-omni-video',
          'data-testid': 'agy-omni-video',
          controls: true,
          preload: 'metadata',
          src: info.url || ''
        });
        const frameDuration = 1 / 30;
        const stepFrame = dir => {
          try { video.pause?.(); } catch {}
          const cur = Number.isFinite(video.currentTime) ? video.currentTime : 0;
          video.currentTime = Math.max(0, Number((cur + dir * frameDuration).toFixed(4)));
        };
        const speeds = [0.5, 1, 1.25, 1.5, 2];
        const speedBtns = speeds.map(sp => {
          const b = el('button', {
            type: 'button',
            className: 'agy-omni-btn',
            'data-testid': `agy-omni-speed-${sp}`,
            'aria-pressed': sp === 1 ? 'true' : 'false',
            textContent: `${sp}x`,
            onClick: () => {
              video.playbackRate = sp;
              for (const other of speedBtns) other.setAttribute('aria-pressed', other === b ? 'true' : 'false');
            }
          });
          return b;
        });
        const controlsBar = el('div', { className: 'agy-omni-toolbar' },
          el('button', { type: 'button', className: 'agy-omni-btn', 'data-testid': 'agy-omni-frame-prev', textContent: tr('-1帧', '-1f'), onClick: () => stepFrame(-1) }),
          el('button', { type: 'button', className: 'agy-omni-btn', 'data-testid': 'agy-omni-frame-next', textContent: tr('+1帧', '+1f'), onClick: () => stepFrame(1) }),
          ...speedBtns
        );
        body.appendChild(video);
        body.appendChild(controlsBar);
      } else if (kind === 'audio') {
        const audio = el('audio', {
          className: 'agy-omni-audio',
          'data-testid': 'agy-omni-audio',
          controls: true,
          preload: 'metadata',
          src: info.url || ''
        });
        const timeLabel = el('span', { 'data-testid': 'agy-omni-audio-time', style: { fontSize: '11.5px', color: 'var(--muted-foreground)' }, textContent: '00:00 / 00:00' });
        const canvas = el('canvas', {
          className: 'agy-omni-waveform',
          'data-testid': 'agy-omni-waveform',
          width: '480',
          height: '84',
          onClick: e => {
            const rect = canvas.getBoundingClientRect?.() || { left: 0, width: 480 };
            const ratio = Math.max(0, Math.min(1, ((e.clientX || 0) - rect.left) / Math.max(1, rect.width)));
            const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 100;
            audio.currentTime = ratio * dur;
            drawAudioWaveform(canvas, ratio);
            timeLabel.textContent = `${formatClock(audio.currentTime)} / ${formatClock(dur)}`;
          }
        });
        audio.addEventListener?.('timeupdate', () => {
          const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
          const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
          drawAudioWaveform(canvas, dur ? cur / dur : 0);
          timeLabel.textContent = `${formatClock(cur)} / ${formatClock(dur)}`;
        });
        drawAudioWaveform(canvas, 0);
        body.appendChild(audio);
        body.appendChild(canvas);
        body.appendChild(el('div', { className: 'agy-omni-toolbar' }, timeLabel));
      } else if (kind === 'image' || kind === 'svg') {
        let zoom = 1;
        let panX = 0;
        let panY = 0;
        let dragging = false;
        let startX = 0;
        let startY = 0;

        let mediaNode;
        if (info.svgElement && typeof info.svgElement.cloneNode === 'function') {
          mediaNode = info.svgElement.cloneNode(true);
        } else {
          mediaNode = el('img', {
            src: info.url || '',
            alt: info.name || '',
            'data-testid': 'agy-omni-image',
            style: { maxWidth: '100%', maxHeight: '100%', display: 'block', userSelect: 'none' }
          });
        }
        const applyTransform = () => {
          if (mediaNode?.style) {
            mediaNode.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
          }
          zoomReadout.textContent = `${Math.round(zoom * 100)}%`;
        };
        const zoomReadout = el('span', { 'data-testid': 'agy-omni-zoom-label', textContent: '100%' });
        const stage = el('div', {
          className: 'agy-omni-checkerboard',
          'data-testid': 'agy-omni-image-stage',
          onPointerdown: e => {
            dragging = true;
            startX = (e.clientX || 0) - panX;
            startY = (e.clientY || 0) - panY;
          },
          onPointermove: e => {
            if (!dragging) return;
            panX = (e.clientX || 0) - startX;
            panY = (e.clientY || 0) - startY;
            applyTransform();
          },
          onPointerup: () => { dragging = false; },
          onWheel: e => {
            e.preventDefault?.();
            zoom = Math.max(0.25, Math.min(8, Number((zoom + (e.deltaY < 0 ? 0.2 : -0.2)).toFixed(2))));
            applyTransform();
          }
        }, mediaNode);

        const exportPngBtn = el('button', {
          type: 'button',
          className: 'agy-omni-btn',
          'data-testid': 'agy-omni-export-png',
          textContent: tr('导出 PNG', 'Export PNG'),
          onClick: () => {
            const baseName = String(info.name || 'image').replace(/\.[^.]+$/, '') + '.png';
            if (info.svgElement) {
              exportSvgToPng(info.svgElement, baseName);
              return;
            }
            try {
              const canvas = document.createElement('canvas');
              canvas.width = mediaNode.naturalWidth || 800;
              canvas.height = mediaNode.naturalHeight || 600;
              const ctx = canvas.getContext?.('2d');
              ctx?.drawImage?.(mediaNode, 0, 0);
              const dataUrl = canvas.toDataURL?.('image/png') || info.url || '';
              if (dataUrl) triggerDownload(dataUrl, baseName);
              notifyUser(tr('已导出 PNG', 'PNG exported'), baseName, 'agy-omni-export-png');
            } catch (err) {
              notifyUser(tr('导出 PNG 失败', 'PNG export failed'), err?.message || '', 'agy-omni-export-png');
            }
          }
        });

        const toolbar = el('div', { className: 'agy-omni-toolbar' },
          el('button', { type: 'button', className: 'agy-omni-btn', 'data-testid': 'agy-omni-zoom-out', textContent: '-', onClick: () => { zoom = Math.max(0.25, Number((zoom - 0.25).toFixed(2))); applyTransform(); } }),
          zoomReadout,
          el('button', { type: 'button', className: 'agy-omni-btn', 'data-testid': 'agy-omni-zoom-in', textContent: '+', onClick: () => { zoom = Math.min(8, Number((zoom + 0.25).toFixed(2))); applyTransform(); } }),
          el('button', { type: 'button', className: 'agy-omni-btn', 'data-testid': 'agy-omni-zoom-reset', textContent: tr('重置', 'Reset'), onClick: () => { zoom = 1; panX = 0; panY = 0; applyTransform(); } }),
          exportPngBtn
        );

        body.appendChild(toolbar);
        body.appendChild(stage);
      } else if (kind === 'table') {
        let offset = 0;
        let query = '';
        let totalMatched = 0;

        const searchInput = el('input', {
          type: 'search',
          className: 'agy-rail-filter',
          'data-testid': 'agy-omni-table-search',
          placeholder: tr('搜索表格内容...', 'Search table...')
        });
        const metaSpan = el('span', { 'data-testid': 'agy-omni-table-meta', style: { fontSize: '11px', color: 'var(--muted-foreground)' }, textContent: '' });
        const prevBtn = el('button', { type: 'button', className: 'agy-omni-btn', 'data-testid': 'agy-omni-table-prev', textContent: tr('上一页', 'Prev') });
        const nextBtn = el('button', { type: 'button', className: 'agy-omni-btn', 'data-testid': 'agy-omni-table-next', textContent: tr('下一页', 'Next') });
        const thead = el('thead');
        const tbody = el('tbody');
        const table = el('table', { className: 'agy-omni-table', 'data-testid': 'agy-omni-table' }, thead, tbody);
        const wrap = el('div', { className: 'agy-omni-table-wrap' }, table);

        const loadSlice = async () => {
          try {
            const slice = await Promise.resolve(env.request?.('omni.tableSlice', {
              uriOrPath: info.path || uriOrPath,
              offset,
              limit: TABLE_PAGE_LIMIT,
              query
            }));
            if (disposed || !drawer.isConnected) return;
            while (thead.firstChild) thead.removeChild(thead.firstChild);
            while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
            const headers = Array.isArray(slice?.headers) ? slice.headers : [];
            const rows = Array.isArray(slice?.rows) ? slice.rows : [];
            totalMatched = Number(slice?.totalMatched ?? rows.length);

            if (headers.length) {
              const hr = el('tr', {}, ...headers.map(hText => el('th', { textContent: String(hText) })));
              thead.appendChild(hr);
            }
            for (const row of rows) {
              const trEl = el('tr', {}, ...(Array.isArray(row) ? row : [row]).map(cell => el('td', { textContent: String(cell ?? '') })));
              tbody.appendChild(trEl);
            }
            const endIdx = Math.min(totalMatched, offset + rows.length);
            metaSpan.textContent = `${offset + (rows.length ? 1 : 0)} - ${endIdx} / ${totalMatched}${slice?.truncated ? ` (${tr('已截断', 'Truncated')})` : ''}`;
            prevBtn.disabled = offset <= 0;
            nextBtn.disabled = offset + TABLE_PAGE_LIMIT >= totalMatched;
          } catch (err) {
            metaSpan.textContent = err?.message || tr('读取表格失败', 'Failed to load table');
          }
        };

        searchInput.addEventListener?.('input', e => {
          query = String(e.target?.value || '');
          offset = 0;
          void loadSlice();
        });
        prevBtn.addEventListener?.('click', () => {
          offset = Math.max(0, offset - TABLE_PAGE_LIMIT);
          void loadSlice();
        });
        nextBtn.addEventListener?.('click', () => {
          if (offset + TABLE_PAGE_LIMIT < totalMatched) {
            offset += TABLE_PAGE_LIMIT;
            void loadSlice();
          }
        });

        body.appendChild(el('div', { className: 'agy-omni-toolbar' }, searchInput, prevBtn, nextBtn, metaSpan));
        body.appendChild(wrap);
        await loadSlice();
      } else if (kind === 'pdf' || kind === 'html') {
        const frame = el('iframe', {
          className: 'agy-omni-iframe',
          'data-testid': 'agy-omni-iframe',
          sandbox: 'allow-scripts',
          src: info.url || '',
          title: info.name || 'Preview'
        });
        body.appendChild(frame);
      } else if (kind === 'font') {
        const familyName = `AgyOmniSpecimen_${++omniFontSeq}`;
        const safeUrl = String(info.url || '').replace(/["\\)\n\r]/g, '');
        const fontStyle = document.createElement('style');
        fontStyle.setAttribute?.('data-agy-omni-font', '1');
        fontStyle.textContent = `@font-face { font-family: "${familyName}"; src: url("${safeUrl}"); font-display: swap; }`;
        document.head?.appendChild(fontStyle);
        activeOmniFontStyle = fontStyle;

        const waterfall = el('div', {
          'data-testid': 'agy-omni-font-waterfall',
          'data-font-family': familyName
        });
        for (const px of FONT_SPECIMEN_SIZES) {
          waterfall.appendChild(el('div', { className: 'agy-omni-font-row' },
            el('span', { className: 'agy-omni-font-size', textContent: `${px}px` }),
            el('div', {
              style: { fontFamily: `"${familyName}", sans-serif`, fontSize: `${px}px`, lineHeight: '1.35' },
              textContent: 'The quick brown fox jumps over the lazy dog 0123456789'
            }),
            el('div', {
              style: { fontFamily: `"${familyName}", sans-serif`, fontSize: `${px}px`, lineHeight: '1.35' },
              textContent: tr('天地玄黄 宇宙洪荒 光学棱镜 敏捷开发 0123456789', 'The quick brown fox 0123456789 / CJK Sample 敏捷开发')
            })
          ));
        }
        body.appendChild(waterfall);
      } else {
        body.appendChild(el('div', { style: { color: 'var(--muted-foreground)' }, textContent: `${info?.name || uriOrPath} (${info?.mime || kind})` }));
        body.appendChild(el('button', {
          type: 'button',
          className: 'agy-omni-btn',
          textContent: tr('在编辑器中打开', 'Open in editor'),
          onClick: () => { void Promise.resolve(env.request?.('file.openEditor', { uri: toFileUri(info?.path || uriOrPath, currentWorkspaceUri()), source: 'git' })).catch(() => {}); }
        }));
      }

      return { ok: true, kind, drawer };
    }

    // =========================================================================
    // 6. Home Studio Dashboard & Chat Mode Beta Sidebar Space
    // =========================================================================
    function formatCompactNum(num) {
      const n = Number(num || 0);
      if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
      if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
      return String(Math.round(n));
    }

    function formatUsd(val) {
      const n = Number(val || 0);
      return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
    }

    function unmountHomeStudio() {
      for (const node of document.querySelectorAll?.('[data-testid="agy-home-studio"]') || []) {
        node.remove?.();
      }
    }

    function renderHomeStudioContent(card) {
      const body = card.querySelector?.('[data-testid="agy-studio-body"]');
      if (!body) return;
      while (body.firstChild) body.removeChild(body.firstChild);

      const dash = typeof env.dashboard === 'function' ? env.dashboard() : env.dashboard;
      const acct = typeof env.account === 'function' ? env.account() : env.account;
      const requests = Array.isArray(dash?.requests) ? dash.requests : [];

      for (const tabBtn of card.querySelectorAll?.('.agy-studio-tab') || []) {
        tabBtn.setAttribute('aria-selected', tabBtn.getAttribute('data-tab') === activeStudioTab ? 'true' : 'false');
      }

      if (activeStudioTab === 'overview') {
        let totalTokens = 0;
        let totalCost = 0;
        let successCount = 0;
        let cacheReads = 0;
        let totalInput = 0;
        for (const r of requests) {
          const inp = Number(r?.inputTokens || 0);
          const cr = Number(r?.cacheReadTokens || 0);
          const out = Number(r?.outputTokens || 0);
          totalTokens += inp + cr + out;
          totalInput += inp + cr;
          cacheReads += cr;
          totalCost += Number(r?.costUsd || 0);
          if (r?.status !== 'error') successCount++;
        }
        const cacheRate = totalInput > 0 ? `${Math.round((cacheReads / totalInput) * 100)}%` : '-';
        const kpis = [
          [tr('请求数', 'Requests'), String(requests.length)],
          [tr('总 Token', 'Total Tokens'), formatCompactNum(totalTokens)],
          [tr('预估费用', 'Est. Cost'), formatUsd(totalCost)],
          [tr('缓存命中', 'Cache Hit'), requests.length ? cacheRate : (successCount ? '100%' : '-')]
        ];
        body.appendChild(el('div', { className: 'agy-studio-kpis', 'data-testid': 'agy-studio-overview' },
          ...kpis.map(([label, val]) => el('div', { className: 'agy-studio-kpi' },
            el('span', { style: { fontSize: '11px', color: 'var(--muted-foreground)' }, textContent: label }),
            el('span', { className: 'agy-studio-kpi-val', textContent: val })
          ))
        ));
      } else if (activeStudioTab === 'trend') {
        const now = Date.now();
        const days = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now - i * 86400000);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          days.push({ key, label: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`, count: 0, tokens: 0 });
        }
        const byKey = new Map(days.map(d => [d.key, d]));
        for (const r of requests) {
          if (!Number.isFinite(r?.timestampMs)) continue;
          const d = new Date(r.timestampMs);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const bucket = byKey.get(key);
          if (bucket) {
            bucket.count++;
            bucket.tokens += Number(r.inputTokens || 0) + Number(r.cacheReadTokens || 0) + Number(r.outputTokens || 0);
          }
        }
        const maxVal = Math.max(1, ...days.map(d => d.tokens || d.count));
        body.appendChild(el('div', { className: 'agy-studio-bars', 'data-testid': 'agy-studio-trend-bars' },
          ...days.map(d => {
            const metric = d.tokens || d.count;
            const hPct = Math.max(6, Math.round((metric / maxVal) * 100));
            return el('div', { className: 'agy-studio-bar-col', title: `${d.key}: ${d.count} / ${formatCompactNum(d.tokens)}` },
              el('div', { className: 'agy-studio-bar-fill', style: { height: `${hPct}%` } }),
              el('span', { style: { fontSize: '10px', color: 'var(--muted-foreground)' }, textContent: d.label })
            );
          })
        ));
      } else {
        const groups = Array.isArray(acct?.groups) ? acct.groups : [];
        if (!groups.length) {
          body.appendChild(el('div', { style: { color: 'var(--muted-foreground)', padding: '6px 0' }, textContent: tr('暂无模型额度数据', 'No model quota data yet') }));
          return;
        }
        const list = el('div', { className: 'agy-studio-quota-list', 'data-testid': 'agy-studio-quota-list' });
        for (const g of groups) {
          for (const b of g?.buckets || []) {
            const rawFrac = b?.remaining?.case === 'remainingFraction' ? b.remaining.value : b?.remainingFraction;
            if (typeof rawFrac !== 'number' || !Number.isFinite(rawFrac)) continue;
            const pct = Math.max(0, Math.min(100, Math.round(rawFrac * 100)));
            const win = b?.window === 'weekly' || /weekly/i.test(b?.bucketId || '') ? tr('周', '7d') : '5h';
            list.appendChild(el('div', { className: 'agy-studio-quota-row' },
              el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11.5px' } },
                el('span', { textContent: `${g.displayName || 'Model'} (${win})` }),
                el('span', { textContent: `${pct}%` })
              ),
              el('div', { className: 'agy-studio-quota-bar' },
                el('div', { className: 'agy-studio-quota-fill', style: { width: `${pct}%` } })
              )
            ));
          }
        }
        body.appendChild(list);
      }
    }

    function syncHomeStudio() {
      const opts = getOpts();
      const greeting = document.querySelector?.('[data-testid="home-greeting"]');
      if (!opts.enabled || !opts.homeStudio || !greeting) {
        unmountHomeStudio();
        return;
      }
      let card = document.querySelector?.('[data-testid="agy-home-studio"]');
      if (!card) {
        const composerAnchor = document.querySelector?.('[data-testid="agent-input-box"]') || document.querySelector?.('.surface-composer-card') || greeting;
        const parent = composerAnchor?.parentElement || greeting.parentElement || document.body;
        if (!parent) return;

        const tabs = [
          ['overview', tr('概览', 'Overview')],
          ['trend', tr('趋势', 'Trends')],
          ['quota', tr('模型额度', 'Quota')]
        ];
        card = el('section', {
          className: 'agy-home-studio',
          'data-testid': 'agy-home-studio',
          'data-agy-powertools-root': 'workbench-studio',
          translate: 'no',
          'data-agy-no-translate': 'true'
        },
          el('div', { className: 'agy-studio-head' },
            el('strong', { style: { fontSize: '13px' }, textContent: tr('Studio 首页看板', 'Home Studio') }),
            el('div', { className: 'agy-studio-tabs', role: 'tablist' },
              ...tabs.map(([id, label]) => el('button', {
                type: 'button',
                role: 'tab',
                className: 'agy-studio-tab',
                'data-tab': id,
                'data-testid': `agy-studio-tab-${id}`,
                'aria-selected': activeStudioTab === id ? 'true' : 'false',
                textContent: label,
                onClick: () => {
                  activeStudioTab = id;
                  renderHomeStudioContent(card);
                }
              }))
            )
          ),
          el('div', { className: 'agy-studio-body', 'data-testid': 'agy-studio-body' })
        );
        if (composerAnchor && composerAnchor.parentElement === parent) {
          parent.insertBefore(card, composerAnchor.nextSibling || null);
        } else {
          parent.appendChild(card);
        }
      }
      renderHomeStudioContent(card);
    }

    function restoreChatModeRows() {
      for (const row of chatHiddenRows) {
        row.removeAttribute?.('data-agy-chat-hidden');
      }
      chatHiddenRows.clear();
      for (const row of document.querySelectorAll?.('[data-agy-chat-hidden="1"]') || []) {
        row.removeAttribute?.('data-agy-chat-hidden');
      }
      for (const row of trackedChatRows) {
        const origDrag = chatDraggableRestore.get(row);
        if (origDrag === undefined || origDrag === null) row.removeAttribute?.('draggable');
        else row.setAttribute?.('draggable', origDrag);
        row.querySelector?.('[data-agy-chat-assign="1"]')?.remove?.();
      }
      trackedChatRows.clear();
    }

    function cleanupChatMode() {
      restoreChatModeRows();
      for (const node of document.querySelectorAll?.('[data-testid="agy-chat-mode-wrap"]') || []) {
        node.remove?.();
      }
    }

    async function ensureChatFoldersLoaded() {
      if (chatFoldersState.loaded || chatFoldersState.loading) return;
      chatFoldersState.loading = true;
      try {
        const res = await Promise.resolve(env.request?.('chatFolders.get', {}));
        if (disposed) return;
        chatFoldersState.folders = Array.isArray(res?.folders) ? res.folders : [];
        chatFoldersState.assignments = res?.assignments && typeof res.assignments === 'object' ? { ...res.assignments } : {};
        chatFoldersState.loaded = true;
      } catch {
        chatFoldersState.loaded = true;
      } finally {
        chatFoldersState.loading = false;
        if (!disposed) syncChatMode();
      }
    }

    function saveChatFolders() {
      const payload = {
        folders: chatFoldersState.folders.map(f => ({ id: f.id, name: f.name })),
        assignments: { ...chatFoldersState.assignments }
      };
      void Promise.resolve(env.request?.('chatFolders.save', payload)).catch(() => {});
    }

    function assignConversationToFolder(cid, folderId) {
      if (!cid) return;
      if (!folderId) delete chatFoldersState.assignments[cid];
      else chatFoldersState.assignments[cid] = folderId;
      saveChatFolders();
      syncChatMode();
    }

    function applyChatSidebarRows() {
      const rows = [...(document.querySelectorAll?.('[data-testid="conversation-row-sidebar"], .agy-sidebar-row') || [])];
      if (sidebarSpaceMode !== 'chat') {
        restoreChatModeRows();
        return;
      }
      const selected = chatFoldersState.selectedFolderId || 'all';
      for (const row of rows) {
        const cid = resolveConversationIdFromRow(row);
        if (!cid) continue;
        if (!trackedChatRows.has(row)) {
          chatDraggableRestore.set(row, row.getAttribute?.('draggable'));
          row.setAttribute?.('draggable', 'true');
          trackedChatRows.add(row);
        }
        if (!dragBoundChatRows.has(row)) {
          dragBoundChatRows.add(row);
          row.addEventListener?.('dragstart', e => {
            if (sidebarSpaceMode !== 'chat') return;
            const dragCid = resolveConversationIdFromRow(row);
            if (!dragCid) return;
            try {
              e.dataTransfer?.setData?.('text/agy-conversation-id', dragCid);
              e.dataTransfer?.setData?.('text/plain', dragCid);
            } catch {}
          }, listenerOpts);
        }

        const assigned = chatFoldersState.assignments[cid] || '';
        const visible = selected === 'all'
          ? true
          : selected === 'unassigned'
            ? !assigned
            : assigned === selected;

        if (visible) {
          row.removeAttribute?.('data-agy-chat-hidden');
          chatHiddenRows.delete(row);
        } else {
          row.setAttribute?.('data-agy-chat-hidden', '1');
          chatHiddenRows.add(row);
        }

        // Sync inline folder assignment select for easy non-drag assignment
        let sel = row.querySelector?.('[data-agy-chat-assign="1"]');
        if (!sel) {
          sel = el('select', {
            className: 'agy-chat-assign-select',
            'data-agy-chat-assign': '1',
            'data-testid': `agy-chat-assign-${cid}`,
            'aria-label': tr('分配文件夹', 'Assign folder'),
            onClick: e => e.stopPropagation(),
            onChange: e => {
              e.stopPropagation();
              assignConversationToFolder(cid, e.target?.value || '');
            }
          });
          row.appendChild(sel);
        }
        const optSig = chatFoldersState.folders.map(f => `${f.id}:${f.name}`).join('|') + `::${assigned}`;
        if (sel.getAttribute?.('data-sig') !== optSig) {
          sel.setAttribute?.('data-sig', optSig);
          while (sel.firstChild) sel.removeChild(sel.firstChild);
          sel.appendChild(el('option', { value: '', textContent: tr('未分类', 'Unassigned') }));
          for (const f of chatFoldersState.folders) {
            const opt = el('option', { value: f.id, textContent: f.name });
            if (f.id === assigned) opt.selected = true;
            sel.appendChild(opt);
          }
          sel.value = assigned;
        }
      }
    }

    function renderChatFoldersPanel(wrap) {
      let panel = wrap.querySelector?.('[data-testid="agy-chat-folders-panel"]');
      if (sidebarSpaceMode !== 'chat') {
        panel?.remove?.();
        return;
      }
      if (!panel) {
        panel = el('div', {
          className: 'agy-chat-folders',
          'data-testid': 'agy-chat-folders-panel',
          translate: 'no',
          'data-agy-no-translate': 'true'
        });
        const list = el('div', {
          className: 'agy-chat-folder-list',
          'data-testid': 'agy-chat-folder-list'
        });
        const input = el('input', {
          type: 'text',
          className: 'agy-chat-folder-input',
          'data-testid': 'agy-chat-folder-input',
          placeholder: tr('新建文件夹名称...', 'New folder name...')
        });
        const createFolder = () => {
          const name = String(input.value || '').trim();
          if (!name) return;
          const id = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          chatFoldersState.folders = [...chatFoldersState.folders, { id, name }];
          input.value = '';
          saveChatFolders();
          syncChatMode();
        };
        input.addEventListener?.('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault?.(); createFolder(); }
        });
        const createBtn = el('button', {
          type: 'button',
          className: 'agy-omni-btn',
          'data-testid': 'agy-chat-folder-create',
          textContent: tr('新建文件夹', 'New folder'),
          onClick: createFolder
        });
        const form = el('div', { className: 'agy-chat-folder-form' }, input, createBtn);
        panel.appendChild(list);
        panel.appendChild(form);
        wrap.appendChild(panel);
      }

      const input = panel.querySelector?.('[data-testid="agy-chat-folder-input"]');
      const nextPlaceholder = tr('新建文件夹名称...', 'New folder name...');
      if (input && input.getAttribute?.('placeholder') !== nextPlaceholder) {
        input.setAttribute?.('placeholder', nextPlaceholder);
      }
      const createBtn = panel.querySelector?.('[data-testid="agy-chat-folder-create"]');
      const nextBtnText = tr('新建文件夹', 'New folder');
      if (createBtn && createBtn.textContent !== nextBtnText) {
        createBtn.textContent = nextBtnText;
      }

      let list = panel.querySelector?.('[data-testid="agy-chat-folder-list"]');
      if (!list) {
        list = el('div', {
          className: 'agy-chat-folder-list',
          'data-testid': 'agy-chat-folder-list'
        });
        panel.insertBefore(list, panel.firstChild || null);
      }

      const chipsSig = JSON.stringify([
        lang(),
        chatFoldersState.selectedFolderId || 'all',
        chatFoldersState.folders.map(f => [f.id, f.name])
      ]);
      if (list.getAttribute?.('data-sig') === chipsSig) return;
      list.setAttribute?.('data-sig', chipsSig);

      while (list.firstChild) list.removeChild(list.firstChild);

      const makeChip = (id, label, droppableFolderId = null, deletable = false) => {
        const chip = el('button', {
          type: 'button',
          className: 'agy-chat-folder-chip',
          'data-testid': `agy-chat-folder-${id}`,
          'aria-pressed': chatFoldersState.selectedFolderId === id ? 'true' : 'false',
          onClick: () => {
            chatFoldersState.selectedFolderId = id;
            syncChatMode();
          }
        }, el('span', { textContent: label }));

        if (droppableFolderId !== null) {
          chip.addEventListener?.('dragover', e => {
            e.preventDefault?.();
            chip.setAttribute?.('data-drag-over', '1');
          });
          chip.addEventListener?.('dragleave', () => {
            chip.removeAttribute?.('data-drag-over');
          });
          chip.addEventListener?.('drop', e => {
            e.preventDefault?.();
            chip.removeAttribute?.('data-drag-over');
            const cid = e.dataTransfer?.getData?.('text/agy-conversation-id') || e.dataTransfer?.getData?.('text/plain') || '';
            if (cid) assignConversationToFolder(cid, droppableFolderId);
          });
        }

        if (deletable) {
          chip.appendChild(el('span', {
            'data-testid': `agy-chat-folder-delete-${id}`,
            style: { marginLeft: '2px', opacity: '0.7' },
            textContent: '×',
            onClick: e => {
              e.stopPropagation();
              chatFoldersState.folders = chatFoldersState.folders.filter(f => f.id !== id);
              for (const [cid, fid] of Object.entries(chatFoldersState.assignments)) {
                if (fid === id) delete chatFoldersState.assignments[cid];
              }
              if (chatFoldersState.selectedFolderId === id) chatFoldersState.selectedFolderId = 'all';
              saveChatFolders();
              syncChatMode();
            }
          }));
        }
        return chip;
      };

      list.appendChild(makeChip('all', tr('全部', 'All'), null, false));
      list.appendChild(makeChip('unassigned', tr('未分类', 'Unassigned'), '', false));
      for (const f of chatFoldersState.folders) {
        list.appendChild(makeChip(f.id, f.name, f.id, true));
      }
    }

    function syncChatMode() {
      const opts = getOpts();
      if (!opts.enabled || !opts.chatModeBeta) {
        cleanupChatMode();
        return;
      }
      const sidebar = document.querySelector?.('[role="navigation"][aria-label="Sidebar"], [role="navigation"][data-agy-original-aria-label="Sidebar"], [data-testid="sidebar"]')
        || document.querySelector?.('[data-testid="sidebar-navigation-items"]')?.parentElement;
      if (!sidebar) return;

      let wrap = sidebar.querySelector?.('[data-testid="agy-chat-mode-wrap"]');
      if (!wrap) {
        wrap = el('div', {
          className: 'agy-chat-mode-wrap',
          'data-testid': 'agy-chat-mode-wrap',
          'data-agy-powertools-root': 'workbench-chatmode',
          translate: 'no',
          'data-agy-no-translate': 'true'
        });
        const seg = el('div', { className: 'agy-chat-seg', 'data-testid': 'agy-chat-mode-toggle', role: 'group' },
          el('button', {
            type: 'button',
            className: 'agy-chat-seg-btn',
            'data-testid': 'agy-mode-code',
            'aria-pressed': 'true',
            textContent: 'Code',
            onClick: () => {
              sidebarSpaceMode = 'code';
              syncChatMode();
            }
          }),
          el('button', {
            type: 'button',
            className: 'agy-chat-seg-btn',
            'data-testid': 'agy-mode-chat',
            'aria-pressed': 'false',
            textContent: 'Chat',
            onClick: () => {
              sidebarSpaceMode = 'chat';
              void ensureChatFoldersLoaded();
              syncChatMode();
            }
          })
        );
        wrap.appendChild(seg);
        sidebar.insertBefore(wrap, sidebar.firstChild || null);
      }

      const codeBtn = wrap.querySelector?.('[data-testid="agy-mode-code"]');
      const chatBtn = wrap.querySelector?.('[data-testid="agy-mode-chat"]');
      codeBtn?.setAttribute?.('aria-pressed', sidebarSpaceMode === 'code' ? 'true' : 'false');
      chatBtn?.setAttribute?.('aria-pressed', sidebarSpaceMode === 'chat' ? 'true' : 'false');

      renderChatFoldersPanel(wrap);
      applyChatSidebarRows();
    }

    // =========================================================================
    // Lifecycle: Global Events, MutationObserver, sync(), dispose()
    // =========================================================================
    function pruneDisconnected(set) {
      for (const node of set) {
        if (node && node.isConnected === false) set.delete(node);
      }
    }

    function runSync() {
      if (disposed) return;
      pruneDisconnected(trackedThoughtBoxes);
      pruneDisconnected(hiddenThoughtBodies);
      pruneDisconnected(trackedTitleEls);
      pruneDisconnected(stickyCodeHeaders);
      pruneDisconnected(foldedPreEls);
      pruneDisconnected(injectedCodeNodes);
      pruneDisconnected(injectedDiffNodes);
      pruneDisconnected(chatHiddenRows);
      pruneDisconnected(trackedChatRows);
      if (bareLinkEntries.length) {
        bareLinkEntries = bareLinkEntries.filter(entry => entry?.node?.isConnected !== false);
      }
      const opts = getOpts();
      if (!opts.enabled) {
        closeRailPopover();
        closeQuickMenu();
        closeOmniViewer();
        clearThoughtOverlays();
        restoreSessionTitles();
        cleanupCodeFold();
        cleanupInlineDiff();
        clearBareLinkHighlights();
        unmountHomeStudio();
        cleanupChatMode();
        for (const bar of document.querySelectorAll?.('[data-agy-effort-slider="1"], [data-agy-effort-sep="1"]') || []) bar.remove?.();
        setEffortSliderReadyAttr(false);
        clearTriggerEffortTint();
        return;
      }
      injectStyles();
      syncEffortSlider();
      syncThoughts();
      syncSessionTitles();
      syncCodeFold();
      syncInlineDiff();
      syncRailOutline();
      syncBareLinkHighlights();
      syncHomeStudio();
      syncChatMode();
    }

    function scheduleSync() {
      if (disposed) return;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        runSync();
      }, 24);
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          if (activeQuickMenu) closeQuickMenu();
          else if (activeRailPopover) closeRailPopover();
          else if (activeOmniDrawer) closeOmniViewer();
          return;
        }
        handleRailKeydown(e);
      }, listenerOpts);

      document.addEventListener('contextmenu', handleContextMenu, listenerOpts);

      document.addEventListener('click', e => {
        if (activeQuickMenu && !e.target?.closest?.('[data-testid="agy-quick-context-menu"]')) {
          closeQuickMenu();
        }
        // Re-sync thinking block if user clicks a thinking collapsible trigger
        if (e.target?.closest?.('[data-testid="thinking-collapsible-trigger"]')) {
          if (typeof queueMicrotask === 'function') queueMicrotask(() => { if (!disposed) syncThoughts(); });
          else scheduleSync();
        }
        handleBareLinkClick(e);
      }, listenerOpts);

      document.addEventListener('scroll', e => {
        if (activeQuickMenu && !e.target?.closest?.('[data-testid="agy-quick-context-menu"]')) {
          closeQuickMenu();
        }
      }, ac ? { capture: true, signal: ac.signal } : true);
    }

    function isModelSelectorMutation(records) {
      const sel = '[data-testid="model-selector-panel"],[data-testid="model-selector-list"],[data-testid="model-selector-trigger"],[role="menu"],[role="dialog"],[role="listbox"]';
      const touchesSelector = node => Boolean(
        node && node.nodeType === 1 && (
          node.matches?.(sel) || node.querySelector?.('[data-testid="model-selector-panel"],[data-testid="model-selector-list"],[data-testid="model-selector-effort-group"],[data-testid="model-selector-effort-option"]')
        )
      );
      for (const r of records) {
        if (r.type === 'attributes' && r.target?.matches?.('[data-testid="model-selector-trigger"],[role="menu"],[role="dialog"]')) {
          return true;
        }
        for (const n of r.addedNodes || []) {
          if (touchesSelector(n)) return true;
        }
        for (const n of r.removedNodes || []) {
          if (touchesSelector(n)) return true;
        }
      }
      return false;
    }

    let observer = null;
    if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.body) {
      observer = new MutationObserver(records => {
        if (disposed) return;
        const allOurs = records.every(r => r.target?.closest?.('[data-agy-powertools-root],[data-agy-thought-box]'));
        if (allOurs) return;
        const opts = getOpts();
        if (opts.enabled && (opts.effortSlider || opts.effortMemory) && isModelSelectorMutation(records)) {
          injectStyles();
          syncEffortSlider();
        }
        scheduleSync();
      });
      try {
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-selected', 'data-state'] });
      } catch {
        try { observer.observe(document.body, { childList: true, subtree: true }); } catch {}
      }
    }

    runSync();

    return {
      sync(nextOptions) {
        if (disposed) return;
        syncedOptions = nextOptions && typeof nextOptions === 'object' ? { ...nextOptions } : null;
        runSync();
      },
      openOmniViewer,
      async openPickedMedia(file) {
        if (!(file instanceof File) || !file.size) throw new Error(tr('请选择可预览的文件', 'Choose a file to preview'));
        const mime = file.type.toLowerCase();
        const kind = /^(image\/(avif|gif|jpeg|png|webp)|video\/(mp4|webm)|audio\/(mpeg|wav|x-wav|ogg|mp4|flac)|font\/(ttf|otf|woff|woff2))$/.test(mime) ? mime.split('/')[0] : '';
        if (!kind) throw new Error(tr('该文件格式暂不支持本地预览', 'This format is not available for local preview'));
        const result = await openOmniViewer(file.name, { kind, name: file.name }, file);
        if (!result.ok) throw new Error(result.error || tr('无法打开预览', 'Unable to open preview'));
        return result;
      },
      canOmniPreview,
      dispose() {
        if (disposed) return;
        disposed = true;
        if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
        observer?.disconnect?.();
        ac?.abort?.();
        closeRailPopover();
        closeQuickMenu();
        closeOmniViewer();
        clearThoughtOverlays();
        restoreSessionTitles();
        cleanupCodeFold();
        cleanupInlineDiff();
        clearBareLinkHighlights();
        unmountHomeStudio();
        cleanupChatMode();
        for (const bar of document.querySelectorAll?.('[data-agy-effort-slider="1"], [data-agy-effort-sep="1"]') || []) bar.remove?.();
        setEffortSliderReadyAttr(false);
        clearTriggerEffortTint();
        styleEl?.remove?.();
        styleEl = null;
      }
    };
  }

  globalThis.__agyCreateWorkbench = createWorkbench;
})();
