(() => {
  const STYLE_ATTR = 'data-agy-beta-ai-style';
  const TRANSLATE_ROOT_ATTR = 'data-agy-translate-root';
  const POWERTOOLS_ROOT_ATTR = 'data-agy-powertools-root';
  const HIDDEN_SRC_ATTR = 'data-agy-translate-hidden';
  const BILINGUAL_SRC_ATTR = 'data-agy-translate-bilingual-src';
  const GHOST_ACTIVE_ATTR = 'data-agy-ghost-active';

  const STREAM_TAIL_FLUSH_MS = 480;
  const MUTATION_DEBOUNCE_MS = 80;
  const TRANSLATE_TIMEOUT_MS = 60000;
  const PREDICT_TIMEOUT_MS = 15000;
  const MEMO_LIMIT = 200;
  const TURN_STATE_LIMIT = 100;
  const PREDICT_FAIL_COOLDOWN_MS = 60000;
  const LOADING_GRACE_MS = 160;
  const LOADING_ROTATE_MS = 2200;
  const LOADING_FADE_MS = 150;

  const PREDICT_LOADING_PHRASES = [
    ['大脑飞速旋转中…', 'Spinning up the next idea...'],
    ['正在偷看上下文…', 'Peeking at the context...'],
    ['顺着思路往下猜…', 'Following your train of thought...'],
    ['帮你先起个头…', 'Drafting a quick opener...'],
    ['预判你的下一步…', 'Anticipating your next move...'],
    ['速读刚才的内容…', 'Skimming the last turn...'],
    ['灵感正在路上…', 'Catching a good follow-up...'],
    ['替你打个草稿…', 'Sketching your next prompt...'],
    ['从上下文找线索…', 'Reading between the lines...'],
    ['琢磨接下来问什么…', 'Thinking of what comes next...']
  ];

  const THINKING_TRIGGER_SELECTOR = '[data-testid="thinking-collapsible-trigger"]';
  const VIEW_ROOT_SELECTOR = '[data-testid="conversation-view"], [data-testid="subagent-tab-conversation"]';
  const FORBIDDEN_THINKING_ANCESTOR = '[data-testid="agent-response"], [data-testid="conversation-view"], [data-testid="subagent-tab-conversation"], [data-testid="user-input-step"], body, html';
  const FORBIDDEN_THINKING_BODY = [
    '[data-testid="thinking-collapsible-trigger"]',
    '[data-testid="agent-response"]',
    '[data-testid="planner-response-text"]',
    '[data-testid="tool-group-collapsible"]',
    '[data-testid="worked-for-collapsible"]',
    '[data-testid="user-input-step"]',
    '[data-testid="cascade-system-message-toolbar"]',
    '.surface-composer-card'
  ].join(', ');
  const COMPOSER_EXCLUDED_ANCESTOR = [
    '[data-testid="agy-subagent-popover"]',
    '[data-testid="subagent-tab-conversation"]',
    '[data-testid*="search"]',
    '[role="search"]',
    '[role="dialog"]',
    '[data-agy-editor-slot]',
    '[data-agy-powertools-root]'
  ].join(', ');

  const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/;
  const STREAMING_TEXT_RE = /\bThinking\b|正在思考|思考中/i;
  const EMPTY_ZERO_WIDTH_RE = /[\u200b\ufeff]/g;

  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIALOG',
    'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HGROUP', 'HR', 'LI',
    'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD',
    'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
  ]);
  const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

  function getChildrenList(node) {
    if (!node) return [];
    if (node.childNodes && node.childNodes.length) return Array.from(node.childNodes);
    if (node.children && node.children.length) return Array.from(node.children);
    return [];
  }

  function isElementNode(node) {
    if (!node || typeof node !== 'object') return false;
    if (typeof node.nodeType === 'number') return node.nodeType === 1;
    return typeof node.tagName === 'string' && node.tagName.length > 0;
  }

  function isTextNode(node) {
    if (typeof node === 'string') return true;
    if (!node || typeof node !== 'object') return false;
    if (typeof node.nodeType === 'number') return node.nodeType === 3;
    return false;
  }

  function getNodeText(node) {
    if (typeof node === 'string') return node;
    if (!node) return '';
    return String(node.nodeValue ?? node.textContent ?? '');
  }

  function getAttr(el, name) {
    if (!el) return '';
    if (typeof el.getAttribute === 'function') {
      const val = el.getAttribute(name);
      return val == null ? '' : String(val);
    }
    return '';
  }

  function hasAttr(el, name) {
    if (!el) return false;
    if (typeof el.hasAttribute === 'function') return Boolean(el.hasAttribute(name));
    return getAttr(el, name) !== '';
  }

  function matchesSel(el, sel) {
    if (!el || typeof el.matches !== 'function') return false;
    try { return Boolean(el.matches(sel)); } catch { return false; }
  }

  function closestSel(el, sel) {
    if (!el || typeof el.closest !== 'function') return null;
    try { return el.closest(sel); } catch { return null; }
  }

  function queryAll(root, sel) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    try { return Array.from(root.querySelectorAll(sel)); } catch { return []; }
  }

  function queryOne(root, sel) {
    if (!root || typeof root.querySelector !== 'function') return null;
    try { return root.querySelector(sel); } catch { return null; }
  }

  function appendChildSafe(parent, child) {
    if (!parent || !child) return;
    if (typeof parent.appendChild === 'function') parent.appendChild(child);
    else if (typeof parent.append === 'function') parent.append(child);
  }

  function clearChildrenSafe(el) {
    if (!el) return;
    if (typeof el.removeChild === 'function') {
      while (el.firstChild) el.removeChild(el.firstChild);
      return;
    }
    if (Array.isArray(el.children) && el.children.length) {
      for (const child of [...el.children]) child?.remove?.();
    }
    if (Array.isArray(el.childNodes) && el.childNodes.length) {
      el.childNodes.length = 0;
    }
    el.textContent = '';
  }

  function createTextSafe(doc, value) {
    const str = String(value ?? '');
    if (doc && typeof doc.createTextNode === 'function') return doc.createTextNode(str);
    const span = doc.createElement('span');
    span.textContent = str;
    return span;
  }

  function detectCodeLang(preEl, codeEl) {
    const candidates = [
      getAttr(codeEl, 'data-language'),
      getAttr(codeEl, 'data-lang'),
      getAttr(preEl, 'data-language'),
      getAttr(preEl, 'data-lang'),
      String(codeEl?.className || ''),
      String(preEl?.className || '')
    ];
    for (const raw of candidates) {
      if (!raw) continue;
      const match = /(?:^|\s)(?:language|lang)-([a-zA-Z0-9_+#.-]+)/.exec(raw);
      if (match) return match[1];
    }
    const direct = (getAttr(codeEl, 'data-language') || getAttr(codeEl, 'data-lang') || getAttr(preEl, 'data-language') || getAttr(preEl, 'data-lang')).trim();
    return /^[a-zA-Z0-9_+#.-]+$/.test(direct) ? direct : '';
  }

  function extractRawTextExcludingButtons(node) {
    if (!node) return '';
    if (isTextNode(node)) return getNodeText(node);
    if (!isElementNode(node)) return '';
    const tag = String(node.tagName || '').toUpperCase();
    if (SKIP_TAGS.has(tag) || tag === 'BUTTON') return '';
    if (hasAttr(node, POWERTOOLS_ROOT_ATTR)) return '';
    const kids = getChildrenList(node);
    if (!kids.length) return String(node.textContent || '');
    return kids.map(extractRawTextExcludingButtons).join('');
  }

  function wrapInlineCode(raw) {
    const text = String(raw || '').replace(/\r\n/g, '\n');
    let maxRun = 0;
    const runs = text.match(/`+/g);
    if (runs) {
      for (const r of runs) if (r.length > maxRun) maxRun = r.length;
    }
    const ticks = '`'.repeat(maxRun + 1);
    const needsPad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim().length > 0);
    return needsPad ? `${ticks} ${text} ${ticks}` : `${ticks}${text}${ticks}`;
  }

  function wrapInlineStyle(raw, marker) {
    if (!raw) return '';
    const leadMatch = /^(\s*)/.exec(raw);
    const trailMatch = /(\s*)$/.exec(raw);
    const lead = leadMatch ? leadMatch[1] : '';
    const trail = trailMatch ? trailMatch[1] : '';
    const core = raw.slice(lead.length, raw.length - trail.length);
    if (!core) return raw;
    return `${lead}${marker}${core}${marker}${trail}`;
  }

  function makeFence(codeText) {
    let maxRun = 2;
    const matches = codeText.match(/`{3,}/g);
    if (matches) {
      for (const m of matches) if (m.length > maxRun) maxRun = m.length;
    }
    return '`'.repeat(maxRun + 1);
  }

  function serializeList(listEl, depth) {
    const ordered = String(listEl.tagName || '').toUpperCase() === 'OL';
    const startAttr = Number.parseInt(getAttr(listEl, 'start'), 10);
    let index = Number.isFinite(startAttr) && startAttr > 0 ? startAttr : 1;
    const indent = '  '.repeat(depth);
    const lines = [];
    const items = getChildrenList(listEl).filter(c => isElementNode(c) && String(c.tagName || '').toUpperCase() === 'LI');
    for (const li of items) {
      const marker = ordered ? `${index++}. ` : '- ';
      const nestedLists = [];
      const inlineParts = [];
      const kids = getChildrenList(li);
      if (!kids.length) {
        const txt = String(li.textContent || '').replace(/\r\n/g, '\n').trim();
        if (txt) inlineParts.push(txt);
      } else {
        for (const child of kids) {
          if (isElementNode(child)) {
            const cTag = String(child.tagName || '').toUpperCase();
            if (cTag === 'UL' || cTag === 'OL') {
              const nested = serializeList(child, depth + 1);
              if (nested) nestedLists.push(nested);
              continue;
            }
          }
          const part = serializeNode(child, depth + 1, { inListItem: true });
          if (part) inlineParts.push(part);
        }
      }
      const body = inlineParts.join('').replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
      const bodyLines = body ? body.split('\n') : [''];
      const contIndent = indent + ' '.repeat(marker.length);
      lines.push(`${indent}${marker}${bodyLines[0].trimStart()}`);
      for (let i = 1; i < bodyLines.length; i++) {
        lines.push(bodyLines[i] ? `${contIndent}${bodyLines[i]}` : '');
      }
      for (const nested of nestedLists) {
        lines.push(nested);
      }
    }
    return lines.join('\n');
  }

  function serializeTable(tableEl) {
    const rows = queryAll(tableEl, 'tr');
    if (!rows.length) return String(tableEl.textContent || '').trim();
    const out = [];
    for (const row of rows) {
      const cells = getChildrenList(row).filter(c => isElementNode(c) && (c.tagName === 'TD' || c.tagName === 'TH'));
      if (!cells.length) continue;
      out.push(cells.map(c => serializeChildren(c, 0).replace(/\n+/g, ' ').trim()).join(' | '));
    }
    return out.join('\n');
  }

  function serializeChildren(node, depth, ctx = {}) {
    const kids = getChildrenList(node);
    if (!kids.length) {
      return String(node?.textContent || '').replace(/\r\n/g, '\n');
    }
    let out = '';
    for (const child of kids) {
      out += serializeNode(child, depth, ctx);
    }
    return out;
  }

  function serializeNode(node, depth = 0, ctx = {}) {
    if (!node) return '';
    if (isTextNode(node)) {
      const raw = getNodeText(node).replace(/\r\n/g, '\n');
      if (ctx.inPre) return raw;
      return raw.replace(/[ \t\n]+/g, ' ');
    }
    if (!isElementNode(node)) return '';
    const tag = String(node.tagName || '').toUpperCase();
    if (SKIP_TAGS.has(tag)) return '';
    if (hasAttr(node, POWERTOOLS_ROOT_ATTR)) return '';

    if (tag === 'BR') return '\n';
    if (tag === 'HR') return '\n\n---\n\n';

    if (tag === 'PRE') {
      const codeEl = queryOne(node, 'code') || getChildrenList(node).find(c => isElementNode(c) && String(c.tagName || '').toUpperCase() === 'CODE');
      const lang = detectCodeLang(node, codeEl);
      let codeText = extractRawTextExcludingButtons(codeEl || node).replace(/\r\n/g, '\n');
      if (codeText.endsWith('\n')) codeText = codeText.slice(0, -1);
      const fence = makeFence(codeText);
      return `\n\n${fence}${lang}\n${codeText}\n${fence}\n\n`;
    }

    if (tag === 'CODE') {
      const raw = extractRawTextExcludingButtons(node);
      return raw ? wrapInlineCode(raw) : '';
    }

    if (tag === 'STRONG' || tag === 'B') {
      return wrapInlineStyle(serializeChildren(node, depth, ctx), '**');
    }

    if (tag === 'EM' || tag === 'I') {
      return wrapInlineStyle(serializeChildren(node, depth, ctx), '*');
    }

    if (tag === 'DEL' || tag === 'S') {
      return wrapInlineStyle(serializeChildren(node, depth, ctx), '~~');
    }

    if (tag === 'A') {
      const label = serializeChildren(node, depth, ctx).trim();
      const href = (getAttr(node, 'href') || (typeof node.href === 'string' ? node.href : '')).trim();
      if (!href) return label;
      return `[${label || href}](${href})`;
    }

    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const content = serializeChildren(node, depth, ctx).replace(/\n+/g, ' ').trim();
      if (!content) return '';
      return `\n\n${'#'.repeat(level)} ${content}\n\n`;
    }

    if (tag === 'UL' || tag === 'OL') {
      const listMd = serializeList(node, depth);
      if (!listMd) return '';
      return `\n\n${listMd}\n\n`;
    }

    if (tag === 'BLOCKQUOTE') {
      const inner = normalizeExtractedMarkdown(serializeChildren(node, depth, ctx));
      if (!inner) return '';
      const quoted = inner.split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');
      return `\n\n${quoted}\n\n`;
    }

    if (tag === 'TABLE') {
      const tableMd = serializeTable(node);
      return tableMd ? `\n\n${tableMd}\n\n` : '';
    }

    if (tag === 'P') {
      const inner = serializeChildren(node, depth, ctx)
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .trim();
      if (!inner) return '';
      if (ctx.inListItem) return `${inner}\n`;
      return `\n\n${inner}\n\n`;
    }

    if (BLOCK_TAGS.has(tag)) {
      const kids = getChildrenList(node);
      const hasBlockChild = kids.some(c => isElementNode(c) && BLOCK_TAGS.has(String(c.tagName || '').toUpperCase()));
      const inner = serializeChildren(node, depth, ctx);
      if (!inner.trim()) return '';
      if (hasBlockChild) return `\n\n${inner.trim()}\n\n`;
      const cleaned = inner.split('\n').map(line => line.trim()).join('\n').trim();
      return ctx.inListItem ? `${cleaned}\n` : `\n\n${cleaned}\n\n`;
    }

    return serializeChildren(node, depth, ctx);
  }

  function normalizeExtractedMarkdown(raw) {
    const text = String(raw || '').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const out = [];
    let fenceChar = '';
    let fenceLen = 0;
    let blankRun = 0;

    for (const line of lines) {
      if (fenceChar) {
        out.push(line);
        const closeRe = new RegExp(`^[ \\t]*${fenceChar}{${fenceLen},}[ \\t]*$`);
        if (closeRe.test(line)) {
          fenceChar = '';
          fenceLen = 0;
        }
        blankRun = 0;
        continue;
      }

      const openMatch = FENCE_OPEN_RE.exec(line);
      if (openMatch) {
        fenceChar = openMatch[2][0];
        fenceLen = openMatch[2].length;
        blankRun = 0;
        out.push(line.replace(/[ \t]+$/, ''));
        continue;
      }

      if (!line.trim()) {
        if (out.length === 0) continue;
        blankRun += 1;
        if (blankRun === 1) out.push('');
        continue;
      }

      blankRun = 0;
      out.push(line.replace(/[ \t]+$/, ''));
    }

    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
  }

  function extractThinkingMarkdown(el) {
    if (!el) return '';
    if (typeof el === 'string') return normalizeExtractedMarkdown(el);
    const kids = getChildrenList(el);
    if (!kids.length) return normalizeExtractedMarkdown(String(el.textContent || ''));
    return normalizeExtractedMarkdown(serializeChildren(el, 0));
  }

  function sliceParagraphs(md, isStreaming = false) {
    const input = String(md ?? '').replace(/\r\n/g, '\n');
    if (!input.trim()) {
      return { ready: [], pendingTail: '' };
    }

    const lines = input.split('\n');
    const paragraphs = [];
    let buf = [];
    let fenceChar = '';
    let fenceLen = 0;

    const flushBuf = () => {
      if (!buf.length) return;
      const joined = buf.join('\n').trim();
      if (joined) paragraphs.push(joined);
      buf = [];
    };

    for (const line of lines) {
      if (fenceChar) {
        buf.push(line);
        const closeRe = new RegExp(`^[ \\t]*${fenceChar}{${fenceLen},}[ \\t]*$`);
        if (closeRe.test(line)) {
          fenceChar = '';
          fenceLen = 0;
        }
        continue;
      }

      const openMatch = FENCE_OPEN_RE.exec(line);
      if (openMatch) {
        fenceChar = openMatch[2][0];
        fenceLen = openMatch[2].length;
        buf.push(line);
        continue;
      }

      if (!line.trim()) {
        flushBuf();
        continue;
      }

      buf.push(line);
    }

    const hasUnclosedFence = Boolean(fenceChar);
    flushBuf();

    if (!paragraphs.length) {
      return { ready: [], pendingTail: '' };
    }

    if (!isStreaming) {
      return { ready: paragraphs, pendingTail: '' };
    }

    const endsWithBlankLine = !hasUnclosedFence && /\n[ \t]*\n[ \t]*$/.test(input);
    if (endsWithBlankLine) {
      return { ready: paragraphs, pendingTail: '' };
    }

    return {
      ready: paragraphs.slice(0, -1),
      pendingTail: paragraphs[paragraphs.length - 1]
    };
  }

  function isSafeHttpsUrl(raw) {
    if (typeof raw !== 'string') return '';
    const cleaned = raw.trim().replace(/[\u0000-\u001f\u007f]/g, '');
    if (!cleaned || !/^https:\/\//i.test(cleaned)) return '';
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol !== 'https:') return '';
      return parsed.href;
    } catch {
      return '';
    }
  }

  function findClosingDelim(str, from, delim, requireWordBoundary) {
    let idx = str.indexOf(delim, from);
    while (idx !== -1) {
      if (idx > from && str[idx - 1] !== '\\') {
        if (!requireWordBoundary) return idx;
        const after = str[idx + delim.length] || '';
        if (!/[A-Za-z0-9]/.test(after)) return idx;
      }
      idx = str.indexOf(delim, idx + 1);
    }
    return -1;
  }

  function renderInline(parent, text, doc, depth = 0) {
    const str = String(text ?? '');
    if (!str) return;
    if (depth > 8) {
      appendChildSafe(parent, createTextSafe(doc, str));
      return;
    }

    let i = 0;
    let plain = '';
    const flushPlain = () => {
      if (!plain) return;
      appendChildSafe(parent, createTextSafe(doc, plain));
      plain = '';
    };

    while (i < str.length) {
      const ch = str[i];

      // Backslash escape
      if (ch === '\\' && i + 1 < str.length && /[\\`*_{}[\]()#+\-.!~]/.test(str[i + 1])) {
        plain += str[i + 1];
        i += 2;
        continue;
      }

      // Inline code span
      if (ch === '`') {
        let tickLen = 1;
        while (str[i + tickLen] === '`') tickLen += 1;
        const delim = '`'.repeat(tickLen);
        const closeIdx = str.indexOf(delim, i + tickLen);
        if (closeIdx !== -1) {
          flushPlain();
          let codeVal = str.slice(i + tickLen, closeIdx);
          if (codeVal.length >= 2 && codeVal.startsWith(' ') && codeVal.endsWith(' ') && codeVal.trim().length > 0) {
            codeVal = codeVal.slice(1, -1);
          }
          const codeEl = doc.createElement('code');
          codeEl.className = 'agy-md-inline-code';
          codeEl.textContent = codeVal;
          appendChildSafe(parent, codeEl);
          i = closeIdx + tickLen;
          continue;
        }
      }

      // Markdown link [label](url)
      if (ch === '[') {
        const closeBracket = str.indexOf(']', i + 1);
        if (closeBracket !== -1 && str[closeBracket + 1] === '(') {
          let parenDepth = 1;
          let j = closeBracket + 2;
          while (j < str.length && parenDepth > 0) {
            if (str[j] === '(') parenDepth += 1;
            else if (str[j] === ')') parenDepth -= 1;
            j += 1;
          }
          if (parenDepth === 0) {
            const label = str.slice(i + 1, closeBracket);
            const rawUrl = str.slice(closeBracket + 2, j - 1).trim();
            const safeHref = isSafeHttpsUrl(rawUrl);
            flushPlain();
            if (safeHref) {
              const a = doc.createElement('a');
              a.className = 'agy-md-link';
              a.setAttribute('href', safeHref);
              a.setAttribute('target', '_blank');
              a.setAttribute('rel', 'noopener noreferrer');
              renderInline(a, label || safeHref, doc, depth + 1);
              appendChildSafe(parent, a);
            } else {
              renderInline(parent, label || rawUrl, doc, depth + 1);
            }
            i = j;
            continue;
          }
        }
      }

      // Bold + italic (*** or ___)
      if ((ch === '*' || ch === '_') && str.slice(i, i + 3) === ch.repeat(3)) {
        const prevChar = i > 0 ? str[i - 1] : '';
        const boundary = ch === '_';
        if (!boundary || !/[A-Za-z0-9]/.test(prevChar)) {
          const closeIdx = findClosingDelim(str, i + 3, ch.repeat(3), boundary);
          if (closeIdx !== -1 && str.slice(i + 3, closeIdx).trim()) {
            flushPlain();
            const strong = doc.createElement('strong');
            const em = doc.createElement('em');
            renderInline(em, str.slice(i + 3, closeIdx), doc, depth + 1);
            appendChildSafe(strong, em);
            appendChildSafe(parent, strong);
            i = closeIdx + 3;
            continue;
          }
        }
      }

      // Bold (** or __)
      if ((ch === '*' || ch === '_') && str.slice(i, i + 2) === ch.repeat(2)) {
        const prevChar = i > 0 ? str[i - 1] : '';
        const boundary = ch === '_';
        if (!boundary || !/[A-Za-z0-9]/.test(prevChar)) {
          const closeIdx = findClosingDelim(str, i + 2, ch.repeat(2), boundary);
          if (closeIdx !== -1 && str.slice(i + 2, closeIdx).trim()) {
            flushPlain();
            const strong = doc.createElement('strong');
            renderInline(strong, str.slice(i + 2, closeIdx), doc, depth + 1);
            appendChildSafe(parent, strong);
            i = closeIdx + 2;
            continue;
          }
        }
      }

      // Strikethrough (~~)
      if (ch === '~' && str[i + 1] === '~') {
        const closeIdx = findClosingDelim(str, i + 2, '~~', false);
        if (closeIdx !== -1 && str.slice(i + 2, closeIdx).trim()) {
          flushPlain();
          const del = doc.createElement('del');
          renderInline(del, str.slice(i + 2, closeIdx), doc, depth + 1);
          appendChildSafe(parent, del);
          i = closeIdx + 2;
          continue;
        }
      }

      // Italic (* or _)
      if ((ch === '*' || ch === '_') && str[i + 1] !== ch && str[i + 1] && !/\s/.test(str[i + 1])) {
        const prevChar = i > 0 ? str[i - 1] : '';
        const boundary = ch === '_';
        if (!boundary || !/[A-Za-z0-9]/.test(prevChar)) {
          const closeIdx = findClosingDelim(str, i + 1, ch, boundary);
          if (closeIdx !== -1 && !/\s/.test(str[closeIdx - 1])) {
            flushPlain();
            const em = doc.createElement('em');
            renderInline(em, str.slice(i + 1, closeIdx), doc, depth + 1);
            appendChildSafe(parent, em);
            i = closeIdx + 1;
            continue;
          }
        }
      }

      plain += ch;
      i += 1;
    }

    flushPlain();
  }

  const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/;
  const HR_RE = /^[ \t]*(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/;
  const UL_RE = /^([ \t]*)[-*+][ \t]+(.*)$/;
  const OL_RE = /^([ \t]*)(\d+)[.)][ \t]+(.*)$/;
  const QUOTE_RE = /^[ \t]*>[ \t]?(.*)$/;

  function renderBlocks(container, md, doc) {
    const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) {
        i += 1;
        continue;
      }

      // Fenced code block
      const fenceMatch = FENCE_OPEN_RE.exec(line);
      if (fenceMatch) {
        const fenceChar = fenceMatch[2][0];
        const fenceLen = fenceMatch[2].length;
        const lang = fenceMatch[3].trim().split(/\s+/)[0] || '';
        const closeRe = new RegExp(`^[ \\t]*${fenceChar}{${fenceLen},}[ \\t]*$`);
        const codeLines = [];
        i += 1;
        while (i < lines.length) {
          if (closeRe.test(lines[i])) {
            i += 1;
            break;
          }
          codeLines.push(lines[i]);
          i += 1;
        }
        const pre = doc.createElement('pre');
        pre.className = 'agy-md-pre';
        const code = doc.createElement('code');
        code.className = 'agy-md-code';
        if (lang) code.setAttribute('data-lang', lang);
        code.textContent = codeLines.join('\n');
        appendChildSafe(pre, code);
        appendChildSafe(container, pre);
        continue;
      }

      // Heading
      const headingMatch = HEADING_RE.exec(line);
      if (headingMatch) {
        const level = Math.min(6, Math.max(1, headingMatch[1].length));
        const hEl = doc.createElement(`h${level}`);
        hEl.className = `agy-md-h agy-md-h${level}`;
        renderInline(hEl, headingMatch[2], doc);
        appendChildSafe(container, hEl);
        i += 1;
        continue;
      }

      // Horizontal rule
      if (HR_RE.test(line)) {
        const hr = doc.createElement('hr');
        hr.className = 'agy-md-hr';
        appendChildSafe(container, hr);
        i += 1;
        continue;
      }

      // Blockquote
      if (QUOTE_RE.test(line)) {
        const quoteLines = [];
        while (i < lines.length && QUOTE_RE.test(lines[i])) {
          quoteLines.push(QUOTE_RE.exec(lines[i])[1]);
          i += 1;
        }
        const bq = doc.createElement('blockquote');
        bq.className = 'agy-md-quote';
        renderBlocks(bq, quoteLines.join('\n'), doc);
        appendChildSafe(container, bq);
        continue;
      }

      // Unordered or ordered list (with nested list support)
      const ulStart = UL_RE.exec(line);
      const olStart = !ulStart ? OL_RE.exec(line) : null;
      if (ulStart || olStart) {
        const parseList = (minIndent, expectedOrdered) => {
          const firstLine = lines[i];
          const firstOl = expectedOrdered ? OL_RE.exec(firstLine) : null;
          const listEl = doc.createElement(expectedOrdered ? 'ol' : 'ul');
          listEl.className = expectedOrdered ? 'agy-md-ol' : 'agy-md-ul';
          if (expectedOrdered && firstOl) {
            const startNum = Number.parseInt(firstOl[2], 10);
            if (Number.isFinite(startNum) && startNum !== 1) listEl.setAttribute('start', String(startNum));
          }
          const itemRe = expectedOrdered ? OL_RE : UL_RE;

          while (i < lines.length) {
            const cur = lines[i];
            if (!cur.trim()) break;
            const m = itemRe.exec(cur);
            if (!m) break;
            const indentLen = m[1].length;
            if (indentLen < minIndent) break;
            if (indentLen > minIndent) break;

            const itemTextParts = [expectedOrdered ? m[3] : m[2]];
            i += 1;
            const li = doc.createElement('li');
            li.className = 'agy-md-li';

            while (i < lines.length) {
              const next = lines[i];
              if (!next.trim()) break;
              const nextUl = UL_RE.exec(next);
              const nextOl = !nextUl ? OL_RE.exec(next) : null;
              if (nextUl || nextOl) {
                const nextIndent = (nextUl ? nextUl[1] : nextOl[1]).length;
                if (nextIndent > minIndent) {
                  if (itemTextParts.length) {
                    renderInline(li, itemTextParts.join(' '), doc);
                    itemTextParts.length = 0;
                  }
                  appendChildSafe(li, parseList(nextIndent, Boolean(nextOl)));
                  continue;
                }
                break;
              }
              if (FENCE_OPEN_RE.test(next) || HEADING_RE.test(next) || QUOTE_RE.test(next)) {
                break;
              }
              itemTextParts.push(next.trim());
              i += 1;
            }
            if (itemTextParts.length) {
              renderInline(li, itemTextParts.join(' '), doc);
            }
            appendChildSafe(listEl, li);
          }
          return listEl;
        };

        const baseIndent = (ulStart ? ulStart[1] : olStart[1]).length;
        appendChildSafe(container, parseList(baseIndent, Boolean(olStart)));
        continue;
      }

      // Paragraph
      const paraLines = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (!cur.trim()) break;
        if (paraLines.length > 0 && (
          FENCE_OPEN_RE.test(cur) ||
          HEADING_RE.test(cur) ||
          HR_RE.test(cur) ||
          QUOTE_RE.test(cur) ||
          UL_RE.test(cur) ||
          OL_RE.test(cur)
        )) {
          break;
        }
        paraLines.push(cur);
        i += 1;
      }
      const p = doc.createElement('p');
      p.className = 'agy-md-p';
      for (let k = 0; k < paraLines.length; k++) {
        if (k > 0) appendChildSafe(p, doc.createElement('br'));
        renderInline(p, paraLines[k], doc);
      }
      appendChildSafe(container, p);
    }
  }

  function renderSafeMarkdown(container, md, explicitDoc) {
    if (!container) return;
    const doc = explicitDoc || container.ownerDocument || globalThis.document;
    if (!doc) return;
    clearChildrenSafe(container);
    const input = String(md ?? '');
    if (!input.trim()) return;
    renderBlocks(container, input, doc);
  }

  function buildStylesheet() {
    return `
      [${HIDDEN_SRC_ATTR}="true"]{display:none!important}
      [${BILINGUAL_SRC_ATTR}="true"]{opacity:0.58;margin-bottom:6px;padding-bottom:6px;border-bottom:1px dashed var(--border,rgba(128,128,128,.28))}
      [${TRANSLATE_ROOT_ATTR}="thinking"]{display:block;font:inherit;color:inherit;line-height:inherit}
      [${TRANSLATE_ROOT_ATTR}="thinking"][data-agy-translate-mode="bilingual"]{margin-top:2px}
      .agy-beta-translate-body{font:inherit;line-height:inherit;color:inherit;word-break:break-word}
      .agy-beta-translate-body > :first-child{margin-top:0}
      .agy-beta-translate-body > :last-child{margin-bottom:0}
      .agy-beta-translate-body .agy-md-p{margin:0 0 6px}
      .agy-beta-translate-body .agy-md-h{margin:8px 0 4px;font-weight:var(--agy-fw-semibold,600);line-height:1.35}
      .agy-beta-translate-body .agy-md-h1{font-size:1.12em}
      .agy-beta-translate-body .agy-md-h2{font-size:1.06em}
      .agy-beta-translate-body .agy-md-h3,.agy-beta-translate-body .agy-md-h4,.agy-beta-translate-body .agy-md-h5,.agy-beta-translate-body .agy-md-h6{font-size:1em}
      .agy-beta-translate-body .agy-md-ul,.agy-beta-translate-body .agy-md-ol{margin:0 0 6px;padding-left:1.35em}
      .agy-beta-translate-body .agy-md-ul{list-style:disc}
      .agy-beta-translate-body .agy-md-ol{list-style:decimal}
      .agy-beta-translate-body .agy-md-li{margin:2px 0}
      .agy-beta-translate-body .agy-md-quote{margin:4px 0 6px;padding-left:10px;border-left:2px solid var(--border,rgba(128,128,128,.35));opacity:.9}
      .agy-beta-translate-body .agy-md-hr{border:0;border-top:1px solid var(--border,rgba(128,128,128,.28));margin:8px 0}
      .agy-beta-translate-body .agy-md-inline-code{font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:.9em;padding:1px 4px;border-radius:4px;background:var(--muted,rgba(128,128,128,.14))}
      .agy-beta-translate-body .agy-md-pre{margin:6px 0;padding:8px 10px;border-radius:6px;background:var(--muted,rgba(128,128,128,.14));overflow-x:auto;font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:.88em;line-height:1.45}
      .agy-beta-translate-body .agy-md-code{font-family:inherit;white-space:pre}
      .agy-beta-translate-body .agy-md-link{color:var(--primary,#3b82f6);text-decoration:underline;text-underline-offset:2px}
      .agy-beta-translate-bar{display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap}
      .agy-beta-pill{display:inline-flex;align-items:center;gap:4px;padding:1px 6px;margin-left:-6px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--muted-foreground,inherit);font-size:11.5px;line-height:1.5;font-weight:var(--agy-fw-medium,500);cursor:pointer;opacity:.76;transition:opacity .15s ease,background-color .15s ease,border-color .15s ease}
      .agy-beta-pill:hover,.agy-beta-pill:focus-visible{opacity:1;background:var(--muted,rgba(128,128,128,.12));border-color:var(--border,rgba(128,128,128,.24))}
      .agy-beta-translate-bar .agy-beta-pill ~ .agy-beta-pill,.agy-beta-translate-bar .agy-beta-error ~ .agy-beta-pill{margin-left:0}
      .agy-beta-translate-btn{margin-left:0;border-color:var(--border,rgba(128,128,128,.28))}
      .agy-beta-status{font-size:11px;color:var(--muted-foreground,inherit);opacity:.72;animation:agy-ghost-breathe 1.8s ease-in-out infinite}
      .agy-beta-error{font-size:11px;color:var(--destructive,#ef4444);opacity:.9}
      [${GHOST_ACTIVE_ATTR}="true"]{position:relative}
      [${GHOST_ACTIVE_ATTR}="true"] > :not([contenteditable="true"]):not([${POWERTOOLS_ROOT_ATTR}]).pointer-events-none,
      [${GHOST_ACTIVE_ATTR}="true"] :not([contenteditable="true"]):not([${POWERTOOLS_ROOT_ATTR}]):is([class*="placeholder"],[data-placeholder],.lexical-placeholder){opacity:0!important}
      [${GHOST_ACTIVE_ATTR}="true"] [contenteditable="true"][data-placeholder]::before,
      [${GHOST_ACTIVE_ATTR}="true"] [contenteditable="true"]::before,
      [${GHOST_ACTIVE_ATTR}="true"] [data-placeholder]::after{opacity:0!important;content:none!important}
      .agy-beta-ghost-overlay{position:absolute;inset:0;pointer-events:none;user-select:none;color:var(--placeholder,var(--muted-foreground,#8e8e93));opacity:0.78;overflow:hidden;white-space:pre-wrap;word-break:break-word;z-index:1;box-sizing:border-box}
      .agy-beta-ghost-overlay[data-agy-ghost-phase="loading"]{white-space:nowrap;text-overflow:ellipsis;animation:agy-ghost-breathe 1.8s ease-in-out infinite}
      .agy-beta-ghost-overlay[data-agy-ghost-phase="loading"] .agy-beta-ghost-label{transition:opacity 150ms ease}
      .agy-beta-ghost-overlay[data-agy-ghost-phase="ready"]{animation:agy-ghost-enter 140ms ease-out}
      .agy-beta-ghost-overlay .agy-ghost-tab{display:inline-block;font-size:10px;opacity:0.55;margin-left:6px;padding:0 4px;border-radius:4px;border:1px solid currentColor;line-height:1.35;font-family:inherit;font-weight:var(--agy-fw-medium,500);vertical-align:baseline}
      @keyframes agy-ghost-breathe{0%,100%{opacity:0.42}50%{opacity:0.74}}
      @keyframes agy-ghost-enter{from{opacity:0}to{opacity:0.78}}
      @media (prefers-reduced-motion: reduce){.agy-beta-ghost-overlay[data-agy-ghost-phase="loading"],.agy-beta-ghost-overlay[data-agy-ghost-phase="ready"],.agy-beta-status{animation:none!important}.agy-beta-ghost-overlay[data-agy-ghost-phase="loading"]{opacity:0.56}}
    `;
  }

  function hashText(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function mountBetaAi(env = {}) {
    const doc = env.document || globalThis.document;
    const win = env.window || globalThis;
    const getOptions = typeof env.options === 'function' ? env.options : () => ({});
    const getCurrentId = typeof env.currentId === 'function' ? env.currentId : () => '';
    const getIsTurnRunning = typeof env.isTurnRunning === 'function' ? env.isTurnRunning : () => false;
    const subscribe = typeof env.subscribe === 'function' ? env.subscribe : () => () => {};
    const request = typeof env.request === 'function' ? env.request : async () => ({ ok: false, error: 'request unavailable' });
    const uiText = typeof env.uiText === 'function'
      ? env.uiText
      : (zh, en) => (getOptions()?.language === 'en' ? en : zh);

    let disposed = false;
    let reqSeq = 0;
    let mutationTimer = null;
    const scheduleTimeout = (fn, ms) => (typeof win?.setTimeout === 'function' ? win.setTimeout(fn, ms) : setTimeout(fn, ms));
    const cancelTimeout = id => {
      if (id === null || id === undefined) return;
      if (typeof win?.clearTimeout === 'function') win.clearTimeout(id);
      else clearTimeout(id);
    };

    // Style injection
    let styleEl = null;
    if (doc?.head && typeof doc.createElement === 'function') {
      styleEl = doc.createElement('style');
      styleEl.setAttribute(STYLE_ATTR, '');
      styleEl.textContent = buildStylesheet();
      appendChildSafe(doc.head, styleEl);
    }

    // Active RPC tracking
    const activeTranslateRequests = new Map(); // reqId -> { onDelta, block }
    let activePredictReq = null; // { reqId, convKey, conversationId, turnId, aborted }

    const deltaHandler = (reqId, accumulatedText) => {
      if (disposed) return;
      const entry = activeTranslateRequests.get(reqId);
      if (!entry) return;
      try {
        entry.onDelta(String(accumulatedText ?? ''));
      } catch {}
    };
    const prevDeltaHandler = globalThis.__agyBetaTranslateDelta;
    globalThis.__agyBetaTranslateDelta = deltaHandler;

    function nextReqId(prefix) {
      reqSeq += 1;
      return `${prefix}-${Date.now().toString(36)}-${reqSeq}`;
    }

    function sendAbort(method, reqId) {
      if (!reqId) return;
      try {
        const res = request(method, { reqId }, 5000);
        if (res && typeof res.catch === 'function') res.catch(() => {});
      } catch {}
    }

    function getNormalizedOptions() {
      const raw = getOptions() || {};
      return {
        enabled: raw.enabled !== false,
        language: typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim() : 'zh-CN',
        betaThinkingTranslate: Boolean(raw.betaThinkingTranslate),
        betaThinkingEngine: raw.betaThinkingEngine === 'ai' ? 'ai' : 'free',
        betaThinkingDisplay: raw.betaThinkingDisplay === 'bilingual' ? 'bilingual' : 'replace',
        betaThinkingTrigger: raw.betaThinkingTrigger === 'manual' ? 'manual' : 'auto',
        betaComposerPredict: Boolean(raw.betaComposerPredict),
        betaAiProvider: String(raw.betaAiProvider || ''),
        betaAiModel: String(raw.betaAiModel || ''),
        betaAiTranslateModel: String(raw.betaAiTranslateModel || ''),
        betaAiPredictModel: String(raw.betaAiPredictModel || '')
      };
    }

    function translateConfigKey(opts) {
      return JSON.stringify([
        opts.language,
        opts.betaThinkingEngine,
        opts.betaThinkingEngine === 'ai' ? opts.betaAiProvider : '',
        opts.betaThinkingEngine === 'ai' ? (opts.betaAiTranslateModel || opts.betaAiModel) : ''
      ]);
    }

    // LRU memo for translated markdown blocks so collapse/re-expand is instant
    const translationMemo = new Map();
    function memoGet(key) {
      if (!translationMemo.has(key)) return undefined;
      const val = translationMemo.get(key);
      translationMemo.delete(key);
      translationMemo.set(key, val);
      return val;
    }
    function memoSet(key, val) {
      translationMemo.delete(key);
      translationMemo.set(key, val);
      while (translationMemo.size > MEMO_LIMIT) {
        const oldest = translationMemo.keys().next().value;
        if (oldest === undefined) break;
        translationMemo.delete(oldest);
      }
    }
    function lookupCachedBlockTranslation(cfgKey, md) {
      const exact = memoGet(`${cfgKey}\0${md}`);
      if (typeof exact === 'string') return exact;
      const { ready } = sliceParagraphs(md, false);
      if (!ready.length) return null;
      const parts = [];
      for (const p of ready) {
        const hit = memoGet(`${cfgKey}\0${p}`);
        if (typeof hit !== 'string') return null;
        parts.push(hit);
      }
      const joined = parts.join('\n\n');
      memoSet(`${cfgKey}\0${md}`, joined);
      return joined;
    }

    // -----------------------------------------------------------------------
    // Part 1: Thinking-Only Translation
    // -----------------------------------------------------------------------
    const blockByNativeMd = new Map(); // nativeMd -> BlockState
    const observedTargetMap = new Map(); // observedEl -> Set<BlockState>
    let intersectionObserver = null;

    function findObservableTarget(el) {
      let cur = el;
      while (cur && cur !== doc?.body && cur !== doc?.documentElement) {
        let display = '';
        try {
          display = win?.getComputedStyle?.(cur)?.display || cur.style?.display || '';
        } catch {
          display = cur.style?.display || '';
        }
        if (display !== 'contents') return cur;
        cur = cur.parentElement;
      }
      return el;
    }

    function ensureIntersectionObserver() {
      if (intersectionObserver) return intersectionObserver;
      const IOCtor = win?.IntersectionObserver || globalThis.IntersectionObserver;
      if (typeof IOCtor !== 'function') return null;
      try {
        intersectionObserver = new IOCtor(entries => {
          if (disposed) return;
          for (const entry of entries || []) {
            if (!entry?.isIntersecting) continue;
            const blocks = observedTargetMap.get(entry.target);
            if (!blocks) continue;
            for (const block of blocks) {
              if (!block.isVisible) {
                block.isVisible = true;
                processThinkingBlock(block, getNormalizedOptions());
              }
            }
          }
        }, { rootMargin: '400px 0px' });
      } catch {
        intersectionObserver = null;
      }
      return intersectionObserver;
    }

    function observeBlock(block) {
      const io = ensureIntersectionObserver();
      if (!io) {
        block.isVisible = true;
        return;
      }
      const target = findObservableTarget(block.nativeMd);
      if (block.observedTarget === target) return;
      unobserveBlock(block);
      block.observedTarget = target;
      let set = observedTargetMap.get(target);
      if (!set) {
        set = new Set();
        observedTargetMap.set(target, set);
        try { io.observe(target); } catch {}
      }
      set.add(block);
    }

    function unobserveBlock(block) {
      const target = block.observedTarget;
      if (!target) return;
      block.observedTarget = null;
      const set = observedTargetMap.get(target);
      if (!set) return;
      set.delete(block);
      if (set.size === 0) {
        observedTargetMap.delete(target);
        try { intersectionObserver?.unobserve?.(target); } catch {}
      }
    }

    function isElementHiddenOrClosed(el) {
      if (!el) return true;
      if (hasAttr(el, 'hidden')) return true;
      if (getAttr(el, 'data-state') === 'closed') return true;
      return false;
    }

    function isCandidateThinkingBody(el) {
      if (!el || !isElementNode(el)) return false;
      const tag = String(el.tagName || '').toUpperCase();
      if (SKIP_TAGS.has(tag) || tag === 'BUTTON') return false;
      if (hasAttr(el, POWERTOOLS_ROOT_ATTR) || hasAttr(el, TRANSLATE_ROOT_ATTR)) return false;
      if (isElementHiddenOrClosed(el)) return false;
      if (matchesSel(el, FORBIDDEN_THINKING_BODY)) return false;
      if (queryOne(el, FORBIDDEN_THINKING_BODY)) return false;
      return true;
    }

    function findThinkingBody(trigger) {
      if (!trigger) return null;
      if (getAttr(trigger, 'aria-expanded') === 'false' || getAttr(trigger, 'data-state') === 'closed') {
        return null;
      }
      const parent = trigger.parentElement;
      if (!parent) return null;
      if (getAttr(parent, 'data-state') === 'closed') return null;

      const scanSiblingsAfter = (container, afterNode) => {
        const kids = getChildrenList(container).filter(isElementNode);
        const startIdx = kids.indexOf(afterNode);
        if (startIdx === -1) return null;
        for (let i = startIdx + 1; i < kids.length; i++) {
          const sib = kids[i];
          if (!isCandidateThinkingBody(sib)) continue;
          const mdRoot = matchesSel(sib, '[data-markdown-root]') ? sib : queryOne(sib, '[data-markdown-root]');
          const innerContent = mdRoot || queryOne(sib, '.cursor-edit');
          const target = innerContent && !hasAttr(innerContent, POWERTOOLS_ROOT_ATTR) ? innerContent : sib;
          if (!target.parentElement) continue;
          if (!String(target.textContent || '').trim()) continue;
          return { bodyWrapper: sib, nativeMd: target };
        }
        return null;
      };

      const direct = scanSiblingsAfter(parent, trigger);
      if (direct) return direct;

      // Support trigger wrapped in a single-purpose header div inside a collapsible container
      const grandparent = parent.parentElement;
      if (grandparent && !matchesSel(grandparent, FORBIDDEN_THINKING_ANCESTOR)) {
        const triggersInGrand = queryAll(grandparent, THINKING_TRIGGER_SELECTOR);
        if (triggersInGrand.length === 1 && getAttr(grandparent, 'data-state') !== 'closed') {
          return scanSiblingsAfter(grandparent, parent);
        }
      }
      return null;
    }

    function isThinkingStreaming(trigger, bodyWrapper) {
      if (!trigger) return false;
      if (getAttr(trigger, 'data-streaming') === 'true') return true;
      if (getAttr(trigger.parentElement, 'data-streaming') === 'true') return true;
      if (getAttr(bodyWrapper, 'data-streaming') === 'true') return true;
      if (matchesSel(trigger, '.animate-spin, .animate-pulse, [data-streaming="true"]')) return true;
      if (queryOne(trigger, '.animate-spin, .animate-pulse, [data-streaming="true"]')) return true;
      if (bodyWrapper && queryOne(bodyWrapper, '[data-streaming="true"]')) return true;
      const triggerText = String(trigger.textContent || '');
      if (STREAMING_TEXT_RE.test(triggerText)) return true;
      return false;
    }

    function abortBlockRequests(block) {
      if (block.tailTimer !== null) {
        cancelTimeout(block.tailTimer);
        block.tailTimer = null;
      }
      for (const reqId of [...block.inFlightReqIds]) {
        activeTranslateRequests.delete(reqId);
        block.inFlightReqIds.delete(reqId);
        sendAbort('beta.abortTranslate', reqId);
      }
      block.inFlightParas.clear();
    }

    function clearNativeMdAttributes(nativeMd) {
      if (!nativeMd) return;
      nativeMd.removeAttribute?.(HIDDEN_SRC_ATTR);
      nativeMd.removeAttribute?.(BILINGUAL_SRC_ATTR);
    }

    function teardownBlock(block) {
      abortBlockRequests(block);
      unobserveBlock(block);
      clearNativeMdAttributes(block.nativeMd);
      block.rootEl?.remove?.();
      block.rootEl = null;
      block.bodyEl = null;
      block.barEl = null;
      blockByNativeMd.delete(block.nativeMd);
    }

    function ensureBlockDom(block) {
      if (block.rootEl && block.rootEl.parentElement === block.nativeMd.parentElement) {
        return block.rootEl;
      }
      block.rootEl?.remove?.();
      const rootEl = doc.createElement('div');
      rootEl.setAttribute(TRANSLATE_ROOT_ATTR, 'thinking');
      rootEl.setAttribute(POWERTOOLS_ROOT_ATTR, 'beta-translate');

      const bodyEl = doc.createElement('div');
      bodyEl.className = 'agy-beta-translate-body';

      const barEl = doc.createElement('div');
      barEl.className = 'agy-beta-translate-bar';

      appendChildSafe(rootEl, bodyEl);
      appendChildSafe(rootEl, barEl);

      const parent = block.nativeMd.parentElement;
      if (parent && typeof parent.insertBefore === 'function') {
        parent.insertBefore(rootEl, block.nativeMd.nextSibling || null);
      } else {
        appendChildSafe(parent, rootEl);
      }

      block.rootEl = rootEl;
      block.bodyEl = bodyEl;
      block.barEl = barEl;
      return rootEl;
    }

    function renderBlockUi(block, opts) {
      if (disposed || !block.nativeMd?.isConnected) return;
      const mode = opts.betaThinkingDisplay;
      const rootEl = ensureBlockDom(block);
      rootEl.setAttribute('data-agy-translate-mode', mode);

      const displayMd = block.liveDisplayText || block.translatedText || '';
      const hasTranslation = Boolean(displayMd.trim());
      const isLoading = block.inFlightReqIds.size > 0;

      // Update nativeMd visibility attributes without touching its child tree
      if (hasTranslation && !block.showOriginal && !block.skipped) {
        if (mode === 'replace') {
          block.nativeMd.setAttribute(HIDDEN_SRC_ATTR, 'true');
          block.nativeMd.removeAttribute(BILINGUAL_SRC_ATTR);
        } else {
          block.nativeMd.removeAttribute(HIDDEN_SRC_ATTR);
          block.nativeMd.setAttribute(BILINGUAL_SRC_ATTR, 'true');
        }
      } else {
        clearNativeMdAttributes(block.nativeMd);
      }

      // Render translated body
      if (hasTranslation && !block.showOriginal && !block.skipped) {
        block.bodyEl.style && (block.bodyEl.style.display = '');
        if (block.lastRenderedMd !== displayMd) {
          renderSafeMarkdown(block.bodyEl, displayMd, doc);
          block.lastRenderedMd = displayMd;
        }
      } else {
        clearChildrenSafe(block.bodyEl);
        block.lastRenderedMd = '';
        if (block.bodyEl.style) block.bodyEl.style.display = 'none';
      }

      // Render subtle control bar
      clearChildrenSafe(block.barEl);

      if (block.skipped) {
        return;
      }

      const needsManualButton = opts.betaThinkingTrigger === 'manual' && !block.manualRequested && !hasTranslation && !isLoading;
      if (needsManualButton) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'agy-beta-pill agy-beta-translate-btn';
        btn.setAttribute('data-testid', 'agy-thinking-translate-btn');
        btn.textContent = uiText('翻译思考过程', 'Translate thinking');
        btn.addEventListener?.('click', event => {
          event?.stopPropagation?.();
          if (disposed) return;
          block.manualRequested = true;
          block.error = '';
          block.isVisible = true;
          processThinkingBlock(block, getNormalizedOptions());
        });
        appendChildSafe(block.barEl, btn);
        return;
      }

      if (hasTranslation) {
        const toggle = doc.createElement('button');
        toggle.type = 'button';
        toggle.className = 'agy-beta-pill agy-beta-translate-toggle';
        toggle.setAttribute('data-testid', 'agy-thinking-translate-toggle');
        toggle.setAttribute('aria-pressed', String(Boolean(block.showOriginal)));
        toggle.textContent = block.showOriginal
          ? uiText('译文', 'Translated')
          : uiText('原文', 'Original');
        toggle.addEventListener?.('click', event => {
          event?.stopPropagation?.();
          if (disposed) return;
          block.showOriginal = !block.showOriginal;
          renderBlockUi(block, getNormalizedOptions());
        });
        appendChildSafe(block.barEl, toggle);
      }

      if (isLoading) {
        const status = doc.createElement('span');
        status.className = 'agy-beta-status';
        status.textContent = uiText('翻译中...', 'Translating...');
        appendChildSafe(block.barEl, status);
      } else if (block.error) {
        const errEl = doc.createElement('span');
        errEl.className = 'agy-beta-error';
        errEl.textContent = block.error;
        appendChildSafe(block.barEl, errEl);

        const retryBtn = doc.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'agy-beta-pill';
        retryBtn.setAttribute('data-testid', 'agy-thinking-translate-retry');
        retryBtn.textContent = uiText('重试', 'Retry');
        retryBtn.addEventListener?.('click', event => {
          event?.stopPropagation?.();
          if (disposed) return;
          block.error = '';
          block.lastFailedMd = '';
          block.manualRequested = true;
          processThinkingBlock(block, getNormalizedOptions());
        });
        appendChildSafe(block.barEl, retryBtn);
      }
    }

    function composeIncrementalText(block, paragraphs) {
      const parts = [];
      for (const para of paragraphs) {
        if (block.paraCache.has(para)) {
          parts.push(block.paraCache.get(para));
        } else if (block.paraLive.has(para)) {
          parts.push(block.paraLive.get(para));
        }
      }
      return parts.filter(Boolean).join('\n\n');
    }

    function requestParagraphTranslation(block, para, contextPrev, opts, allParas) {
      if (disposed || !para.trim()) return;
      if (block.paraCache.has(para) || block.inFlightParas.has(para)) return;

      const cfgKey = translateConfigKey(opts);
      const memoKey = `${cfgKey}\0${para}`;
      const cached = memoGet(memoKey);
      if (typeof cached === 'string') {
        block.paraCache.set(para, cached);
        block.translatedText = composeIncrementalText(block, allParas);
        block.liveDisplayText = block.translatedText;
        renderBlockUi(block, opts);
        return;
      }

      const reqId = nextReqId('trp');
      block.inFlightParas.add(para);
      block.inFlightReqIds.add(reqId);
      activeTranslateRequests.set(reqId, {
        block,
        onDelta(acc) {
          if (disposed || block.configKey !== cfgKey) return;
          block.paraLive.set(para, acc);
          block.liveDisplayText = composeIncrementalText(block, block.currentIncrementalParas || allParas);
          renderBlockUi(block, getNormalizedOptions());
        }
      });
      renderBlockUi(block, opts);

      Promise.resolve()
        .then(() => request('beta.translateThinking', {
          reqId,
          text: para,
          targetLang: opts.language,
          contextPrev: contextPrev || ''
        }, TRANSLATE_TIMEOUT_MS))
        .then(res => {
          activeTranslateRequests.delete(reqId);
          block.inFlightReqIds.delete(reqId);
          block.inFlightParas.delete(para);
          block.paraLive.delete(para);
          if (disposed || !block.nativeMd?.isConnected || block.configKey !== cfgKey) return;
          if (res?.aborted) return;
          if (res?.ok) {
            const finalText = typeof res.text === 'string' && res.text.trim() ? res.text : para;
            block.paraCache.set(para, finalText);
            memoSet(memoKey, finalText);
            block.error = '';
            const latestParas = block.currentIncrementalParas || allParas;
            block.translatedText = composeIncrementalText(block, latestParas);
            block.liveDisplayText = block.translatedText;
            if (
              !isThinkingStreaming(block.trigger, block.bodyWrapper) &&
              block.inFlightReqIds.size === 0 &&
              block.translatedText.trim() &&
              latestParas.length > 0 &&
              latestParas.every(p => block.paraCache.has(p))
            ) {
              const fullMd = extractThinkingMarkdown(block.nativeMd);
              if (fullMd) {
                block.translatedSourceMd = fullMd;
                memoSet(`${cfgKey}\0${fullMd}`, block.translatedText);
              }
            }
          } else if (res?.error) {
            block.error = String(res.error);
          }
          renderBlockUi(block, getNormalizedOptions());
        })
        .catch(err => {
          activeTranslateRequests.delete(reqId);
          block.inFlightReqIds.delete(reqId);
          block.inFlightParas.delete(para);
          block.paraLive.delete(para);
          if (disposed || !block.nativeMd?.isConnected || block.configKey !== cfgKey) return;
          if (err?.name === 'AbortError') return;
          block.error = err?.message || uiText('翻译失败', 'Translation failed');
          renderBlockUi(block, getNormalizedOptions());
        });
    }

    function requestFullBlockTranslation(block, md, opts) {
      const cfgKey = translateConfigKey(opts);
      const memoKey = `${cfgKey}\0${md}`;
      const cached = lookupCachedBlockTranslation(cfgKey, md);
      if (typeof cached === 'string') {
        block.translatedSourceMd = md;
        block.translatedText = cached;
        block.liveDisplayText = cached;
        block.skipped = false;
        block.error = '';
        renderBlockUi(block, opts);
        return;
      }

      if (block.inFlightFullMd === md && block.inFlightReqIds.size > 0) {
        renderBlockUi(block, opts);
        return;
      }

      abortBlockRequests(block);
      const reqId = nextReqId('trb');
      block.inFlightFullMd = md;
      block.inFlightReqIds.add(reqId);
      block.liveDisplayText = '';
      activeTranslateRequests.set(reqId, {
        block,
        onDelta(acc) {
          if (disposed || block.configKey !== cfgKey || block.inFlightFullMd !== md) return;
          block.liveDisplayText = acc;
          block.skipped = false;
          renderBlockUi(block, getNormalizedOptions());
        }
      });
      renderBlockUi(block, opts);

      Promise.resolve()
        .then(() => request('beta.translateThinking', {
          reqId,
          text: md,
          targetLang: opts.language,
          contextPrev: ''
        }, TRANSLATE_TIMEOUT_MS))
        .then(res => {
          activeTranslateRequests.delete(reqId);
          block.inFlightReqIds.delete(reqId);
          if (block.inFlightFullMd === md) block.inFlightFullMd = '';
          if (disposed || !block.nativeMd?.isConnected || block.configKey !== cfgKey) return;
          if (res?.aborted) return;
          if (res?.ok) {
            block.translatedSourceMd = md;
            block.error = '';
            if (res.skipped) {
              block.skipped = true;
              block.translatedText = '';
              block.liveDisplayText = '';
            } else {
              const out = typeof res.text === 'string' ? res.text : '';
              block.skipped = false;
              block.translatedText = out;
              block.liveDisplayText = out;
              if (out.trim()) memoSet(memoKey, out);
            }
          } else {
            block.lastFailedMd = md;
            block.error = res?.error ? String(res.error) : uiText('翻译失败', 'Translation failed');
          }
          renderBlockUi(block, getNormalizedOptions());
        })
        .catch(err => {
          activeTranslateRequests.delete(reqId);
          block.inFlightReqIds.delete(reqId);
          if (block.inFlightFullMd === md) block.inFlightFullMd = '';
          if (disposed || !block.nativeMd?.isConnected || block.configKey !== cfgKey) return;
          if (err?.name === 'AbortError') return;
          block.lastFailedMd = md;
          block.error = err?.message || uiText('翻译失败', 'Translation failed');
          renderBlockUi(block, getNormalizedOptions());
        });
    }

    function processThinkingBlock(block, opts) {
      if (disposed || !block.nativeMd?.isConnected) return;
      const cfgKey = translateConfigKey(opts);
      if (block.configKey !== cfgKey) {
        abortBlockRequests(block);
        block.configKey = cfgKey;
        block.paraCache.clear();
        block.paraLive.clear();
        block.usedIncremental = false;
        block.translatedSourceMd = '';
        block.translatedText = '';
        block.liveDisplayText = '';
        block.lastPendingTail = '';
        block.skipped = false;
        block.error = '';
        block.lastFailedMd = '';
      }

      const md = extractThinkingMarkdown(block.nativeMd);
      if (!md) return;

      const streaming = isThinkingStreaming(block.trigger, block.bodyWrapper);
      const shouldTranslate = opts.betaThinkingTrigger === 'auto'
        ? block.isVisible
        : block.manualRequested;

      if (opts.betaThinkingTrigger === 'auto' && !streaming && !block.isVisible) {
        const cachedHit = lookupCachedBlockTranslation(cfgKey, md);
        if (typeof cachedHit === 'string') {
          block.translatedSourceMd = md;
          block.translatedText = cachedHit;
          block.liveDisplayText = cachedHit;
          block.skipped = false;
          block.error = '';
          renderBlockUi(block, opts);
          return;
        }
      }

      if (!shouldTranslate) {
        renderBlockUi(block, opts);
        return;
      }

      if (streaming || block.usedIncremental) {
        block.usedIncremental = true;
        const { ready, pendingTail } = sliceParagraphs(md, streaming);
        const activeList = pendingTail && !streaming ? [...ready, pendingTail] : [...ready];
        block.currentIncrementalParas = pendingTail ? [...ready, pendingTail] : [...ready];

        for (let idx = 0; idx < activeList.length; idx++) {
          const para = activeList[idx];
          const prevPara = idx > 0 ? activeList[idx - 1] : '';
          const contextPrev = prevPara ? prevPara.slice(-240) : '';
          requestParagraphTranslation(block, para, contextPrev, opts, block.currentIncrementalParas);
        }

        if (streaming && pendingTail) {
          if (block.lastPendingTail !== pendingTail) {
            block.lastPendingTail = pendingTail;
            if (block.tailTimer !== null) {
              cancelTimeout(block.tailTimer);
              block.tailTimer = null;
            }
            const capturedTail = pendingTail;
            const prevPara = ready.length ? ready[ready.length - 1] : '';
            const contextPrev = prevPara ? prevPara.slice(-240) : '';
            block.tailTimer = scheduleTimeout(() => {
              block.tailTimer = null;
              if (disposed || !block.nativeMd?.isConnected) return;
              const liveOpts = getNormalizedOptions();
              if (!liveOpts.enabled || !liveOpts.betaThinkingTranslate) return;
              if (block.lastPendingTail !== capturedTail) return;
              requestParagraphTranslation(block, capturedTail, contextPrev, liveOpts, block.currentIncrementalParas || [...ready, capturedTail]);
            }, STREAM_TAIL_FLUSH_MS);
          }
        } else {
          block.lastPendingTail = '';
          if (block.tailTimer !== null) {
            cancelTimeout(block.tailTimer);
            block.tailTimer = null;
          }
        }

        block.translatedText = composeIncrementalText(block, block.currentIncrementalParas);
        block.liveDisplayText = block.translatedText;
        if (
          !streaming &&
          block.inFlightReqIds.size === 0 &&
          block.translatedText.trim() &&
          block.currentIncrementalParas.length > 0 &&
          block.currentIncrementalParas.every(p => block.paraCache.has(p))
        ) {
          block.translatedSourceMd = md;
          memoSet(`${cfgKey}\0${md}`, block.translatedText);
        }
        renderBlockUi(block, opts);
        return;
      }

      if (block.translatedSourceMd === md || block.lastFailedMd === md) {
        renderBlockUi(block, opts);
        return;
      }

      requestFullBlockTranslation(block, md, opts);
    }

    function collectThinkingTriggers() {
      const views = queryAll(doc, VIEW_ROOT_SELECTOR);
      const scopes = views.length ? views : (doc ? [doc] : []);
      const seen = new Set();
      const out = [];
      for (const scope of scopes) {
        for (const trigger of queryAll(scope, THINKING_TRIGGER_SELECTOR)) {
          if (!trigger || seen.has(trigger)) continue;
          if (closestSel(trigger, `[${POWERTOOLS_ROOT_ATTR}]`)) continue;
          seen.add(trigger);
          out.push(trigger);
        }
      }
      return out;
    }

    function syncThinkingTranslation(opts) {
      if (!opts.enabled || !opts.betaThinkingTranslate) {
        for (const block of [...blockByNativeMd.values()]) {
          teardownBlock(block);
        }
        if (intersectionObserver) {
          try { intersectionObserver.disconnect(); } catch {}
          intersectionObserver = null;
          observedTargetMap.clear();
        }
        return;
      }

      const activeNativeMds = new Set();
      const triggers = collectThinkingTriggers();
      for (const trigger of triggers) {
        const found = findThinkingBody(trigger);
        if (!found) continue;
        const { bodyWrapper, nativeMd } = found;
        activeNativeMds.add(nativeMd);

        let block = blockByNativeMd.get(nativeMd);
        if (!block) {
          block = {
            trigger,
            bodyWrapper,
            nativeMd,
            rootEl: null,
            bodyEl: null,
            barEl: null,
            observedTarget: null,
            isVisible: false,
            manualRequested: false,
            showOriginal: false,
            usedIncremental: false,
            configKey: translateConfigKey(opts),
            paraCache: new Map(),
            paraLive: new Map(),
            inFlightParas: new Set(),
            inFlightReqIds: new Set(),
            inFlightFullMd: '',
            currentIncrementalParas: null,
            tailTimer: null,
            lastPendingTail: '',
            translatedSourceMd: '',
            translatedText: '',
            liveDisplayText: '',
            lastRenderedMd: '',
            skipped: false,
            error: '',
            lastFailedMd: ''
          };
          blockByNativeMd.set(nativeMd, block);
        } else {
          block.trigger = trigger;
          block.bodyWrapper = bodyWrapper;
        }

        observeBlock(block);
        processThinkingBlock(block, opts);
      }

      // Teardown detached or collapsed thinking blocks
      for (const [nativeMd, block] of [...blockByNativeMd.entries()]) {
        if (!activeNativeMds.has(nativeMd) || !nativeMd.isConnected) {
          teardownBlock(block);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Part 2: Empty-Composer Inline Gray Ghost Text Prediction
    // -----------------------------------------------------------------------
    const wasRunningByConv = new Map();
    const turnStateByKey = new Map(); // `${convKey}\0${turnId}` -> { suggestion, dismissedByEscape, failedAt, configKey }
    let lastConversationKey = '';
    let lastConvSwitchAt = 0;
    let lastExternalTabKeyAt = 0;
    let isComposing = false;
    let activeGhost = null; // { phase, suggestion, conversationId, turnId, editor, container, overlay, labelSpan }
    let loadingGraceTimer = null;
    let loadingRotateTimer = null;
    let loadingFadeTimer = null;
    let lastLoadingPhraseIdx = -1;

    function predictConfigKey(opts) {
      return `${opts.language}|${opts.betaAiPredictModel || ''}|${opts.betaAiModel || ''}`;
    }

    function turnStateKey(convKey, turnId) {
      return `${convKey}\0${turnId}`;
    }

    function turnStateGet(key) {
      if (!turnStateByKey.has(key)) return null;
      const val = turnStateByKey.get(key);
      turnStateByKey.delete(key);
      turnStateByKey.set(key, val);
      return val;
    }

    function turnStateSet(key, entry) {
      turnStateByKey.delete(key);
      turnStateByKey.set(key, entry);
      while (turnStateByKey.size > TURN_STATE_LIMIT) {
        const oldest = turnStateByKey.keys().next().value;
        if (oldest === undefined) break;
        turnStateByKey.delete(oldest);
      }
    }

    function clearLoadingTimers() {
      if (loadingGraceTimer !== null) {
        cancelTimeout(loadingGraceTimer);
        loadingGraceTimer = null;
      }
      if (loadingRotateTimer !== null) {
        cancelTimeout(loadingRotateTimer);
        loadingRotateTimer = null;
      }
      if (loadingFadeTimer !== null) {
        cancelTimeout(loadingFadeTimer);
        loadingFadeTimer = null;
      }
    }

    function pickNextLoadingPhrase() {
      const count = PREDICT_LOADING_PHRASES.length;
      let idx = Math.floor(Math.random() * count);
      if (idx < 0 || idx >= count) idx = 0;
      if (count > 1 && idx === lastLoadingPhraseIdx) {
        idx = (idx + 1 + Math.floor(Math.random() * (count - 1))) % count;
      }
      lastLoadingPhraseIdx = idx;
      const pair = PREDICT_LOADING_PHRASES[idx];
      return uiText(pair[0], pair[1]);
    }

    function isEditorEmpty(editor) {
      if (!editor) return false;
      if (queryOne(editor, '.agy-inline-img-chip, [data-lexical-decorator="true"], img')) return false;
      const card = closestSel(editor, '.surface-composer-card');
      if (card) {
        if (getAttr(card, 'data-agy-convo-drop-target') === '1') return false;
        if (queryOne(card, '.agy-inline-img-chip, [data-testid*="attachment"], [data-testid="user-message-media-scroll"] img')) return false;
      }
      return !String(editor.textContent || '').replace(EMPTY_ZERO_WIDTH_RE, '').trim();
    }

    function isValidMainComposer(el) {
      if (!el || !isElementNode(el)) return false;
      if (getAttr(el, 'contenteditable') !== 'true') return false;
      if (closestSel(el, COMPOSER_EXCLUDED_ANCESTOR)) return false;
      return true;
    }

    function findMainComposer() {
      const convView = queryOne(doc, '[data-testid="conversation-view"]');
      const searchRoots = convView ? [convView, doc] : [doc];
      for (const root of searchRoots) {
        if (!root) continue;
        for (const el of queryAll(root, '[data-testid="agent-input-box"] [contenteditable="true"]')) {
          if (isValidMainComposer(el)) return el;
        }
        for (const el of queryAll(root, '.surface-composer-card [contenteditable="true"][role="textbox"]')) {
          if (isValidMainComposer(el)) return el;
        }
        for (const el of queryAll(root, '.surface-composer-card [contenteditable="true"]')) {
          if (isValidMainComposer(el)) return el;
        }
      }
      return null;
    }

    function abortInFlightPredict() {
      clearLoadingTimers();
      if (!activePredictReq) return;
      const reqId = activePredictReq.reqId;
      activePredictReq.aborted = true;
      activePredictReq = null;
      sendAbort('beta.abortPredict', reqId);
    }

    function clearGhostOverlay() {
      clearLoadingTimers();
      if (!activeGhost) return;
      try { activeGhost.container?.removeAttribute?.(GHOST_ACTIVE_ATTR); } catch {}
      try { activeGhost.overlay?.remove?.(); } catch {}
      activeGhost = null;
    }

    function dismissGhostAndAbort() {
      clearGhostOverlay();
      abortInFlightPredict();
    }

    function syncGhostOverlayTypography(editor, overlay) {
      if (!editor || !overlay || !overlay.style) return;
      try {
        const cs = win?.getComputedStyle?.(editor);
        if (!cs) return;
        const props = [
          'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
          'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'
        ];
        for (const prop of props) {
          if (cs[prop]) overlay.style[prop] = cs[prop];
        }
      } catch {}
    }

    function mountLoadingOverlay(editor, conversationId, turnId, phrase) {
      clearGhostOverlay();
      if (!editor || !editor.isConnected || !isEditorEmpty(editor) || isComposing) return false;
      const container = editor.parentElement || editor;
      if (!container) return false;

      container.setAttribute(GHOST_ACTIVE_ATTR, 'true');

      const overlay = doc.createElement('div');
      overlay.setAttribute(POWERTOOLS_ROOT_ATTR, 'beta-ghost');
      overlay.setAttribute('data-testid', 'agy-composer-ghost-text');
      overlay.setAttribute('data-agy-ghost-phase', 'loading');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.className = 'agy-beta-ghost-overlay';

      const labelSpan = doc.createElement('span');
      labelSpan.className = 'agy-beta-ghost-label';
      labelSpan.textContent = phrase;

      appendChildSafe(overlay, labelSpan);
      syncGhostOverlayTypography(editor, overlay);

      if (container !== editor && typeof container.insertBefore === 'function') {
        container.insertBefore(overlay, editor.nextSibling || null);
      } else {
        appendChildSafe(container, overlay);
      }

      activeGhost = {
        phase: 'loading',
        suggestion: '',
        conversationId,
        turnId,
        editor,
        container,
        overlay,
        labelSpan
      };
      return true;
    }

    function scheduleLoadingRotation(reqState) {
      if (loadingRotateTimer !== null) {
        cancelTimeout(loadingRotateTimer);
        loadingRotateTimer = null;
      }
      const holdMs = Math.max(0, LOADING_ROTATE_MS - LOADING_FADE_MS);
      loadingRotateTimer = scheduleTimeout(() => {
        loadingRotateTimer = null;
        if (disposed || reqState.aborted || activePredictReq !== reqState) return;
        if (!activeGhost || activeGhost.phase !== 'loading' || !activeGhost.labelSpan) return;
        const liveEditor = activeGhost.editor?.isConnected ? activeGhost.editor : findMainComposer();
        if (!liveEditor || !isEditorEmpty(liveEditor) || isComposing) {
          clearGhostOverlay();
          return;
        }
        const nextPhrase = pickNextLoadingPhrase();
        const label = activeGhost.labelSpan;
        if (label.style) label.style.opacity = '0';
        if (loadingFadeTimer !== null) cancelTimeout(loadingFadeTimer);
        loadingFadeTimer = scheduleTimeout(() => {
          loadingFadeTimer = null;
          if (disposed || reqState.aborted || activePredictReq !== reqState) return;
          if (!activeGhost || activeGhost.phase !== 'loading' || activeGhost.labelSpan !== label) return;
          label.textContent = nextPhrase;
          if (label.style) label.style.opacity = '';
          scheduleLoadingRotation(reqState);
        }, LOADING_FADE_MS);
      }, holdMs);
    }

    function mountGhostOverlay(editor, suggestion, conversationId, turnId) {
      clearGhostOverlay();
      if (!editor || !editor.isConnected || !isEditorEmpty(editor) || isComposing) return;
      const container = editor.parentElement || editor;
      if (!container) return;

      container.setAttribute(GHOST_ACTIVE_ATTR, 'true');

      const overlay = doc.createElement('div');
      overlay.setAttribute(POWERTOOLS_ROOT_ATTR, 'beta-ghost');
      overlay.setAttribute('data-testid', 'agy-composer-ghost-text');
      overlay.setAttribute('data-agy-ghost-phase', 'ready');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.className = 'agy-beta-ghost-overlay';

      const labelSpan = doc.createElement('span');
      labelSpan.className = 'agy-beta-ghost-label';
      labelSpan.textContent = suggestion;

      const tabKbd = doc.createElement('kbd');
      tabKbd.className = 'agy-ghost-tab';
      tabKbd.textContent = 'Tab';

      appendChildSafe(overlay, labelSpan);
      appendChildSafe(overlay, tabKbd);
      syncGhostOverlayTypography(editor, overlay);

      if (container !== editor && typeof container.insertBefore === 'function') {
        container.insertBefore(overlay, editor.nextSibling || null);
      } else {
        appendChildSafe(container, overlay);
      }

      activeGhost = {
        phase: 'ready',
        suggestion,
        conversationId,
        turnId,
        editor,
        container,
        overlay,
        labelSpan
      };
    }

    function extractCleanText(node, skipSelector) {
      if (!node) return '';
      if (isTextNode(node)) return getNodeText(node);
      if (!isElementNode(node)) return '';
      const tag = String(node.tagName || '').toUpperCase();
      if (SKIP_TAGS.has(tag) || tag === 'BUTTON') return '';
      if (hasAttr(node, POWERTOOLS_ROOT_ATTR) || hasAttr(node, TRANSLATE_ROOT_ATTR)) return '';
      if (skipSelector && matchesSel(node, skipSelector)) return '';
      const kids = getChildrenList(node);
      if (!kids.length) return String(node.textContent || '');
      const parts = [];
      for (const child of kids) {
        const chunk = extractCleanText(child, skipSelector);
        if (chunk) parts.push(chunk);
      }
      return parts.join(BLOCK_TAGS.has(tag) ? '\n' : '');
    }

    function extractAssistantText(responseEl) {
      const plannerNodes = queryAll(responseEl, '[data-testid="planner-response-text"]');
      if (plannerNodes.length) {
        return plannerNodes
          .map(n => extractCleanText(n, `[${POWERTOOLS_ROOT_ATTR}], [${TRANSLATE_ROOT_ATTR}]`).trim())
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 1600);
      }

      const excludedBodies = new Set();
      for (const trigger of queryAll(responseEl, THINKING_TRIGGER_SELECTOR)) {
        const found = findThinkingBody(trigger);
        if (found?.bodyWrapper) excludedBodies.add(found.bodyWrapper);
        if (found?.nativeMd) excludedBodies.add(found.nativeMd);
      }

      const skipSel = [
        `[${POWERTOOLS_ROOT_ATTR}]`,
        `[${TRANSLATE_ROOT_ATTR}]`,
        THINKING_TRIGGER_SELECTOR,
        '[data-testid="tool-group-collapsible"]',
        '[data-testid="worked-for-collapsible"]',
        '[data-testid="cascade-system-message-toolbar"]'
      ].join(', ');

      const walk = node => {
        if (!node) return '';
        if (isTextNode(node)) return getNodeText(node);
        if (!isElementNode(node)) return '';
        if (excludedBodies.has(node)) return '';
        const tag = String(node.tagName || '').toUpperCase();
        if (SKIP_TAGS.has(tag) || tag === 'BUTTON') return '';
        if (matchesSel(node, skipSel)) return '';
        const kids = getChildrenList(node);
        if (!kids.length) return String(node.textContent || '');
        const parts = [];
        for (const child of kids) {
          const piece = walk(child);
          if (piece) parts.push(piece);
        }
        return parts.join(BLOCK_TAGS.has(tag) ? '\n' : '');
      };

      return walk(responseEl).replace(/\n{3,}/g, '\n\n').trim().slice(0, 1600);
    }

    function extractRecentTurns() {
      const scope = queryOne(doc, '[data-testid="conversation-view"]') || doc;
      if (!scope) return { turns: [], stepCount: 0 };
      const steps = queryAll(scope, '[data-testid="user-input-step"], [data-testid="agent-response"]')
        .filter(el => !closestSel(el, `[${POWERTOOLS_ROOT_ATTR}], [data-testid="subagent-tab-conversation"]`));

      const pairs = [];
      let current = null;
      for (const step of steps) {
        const testId = getAttr(step, 'data-testid');
        if (testId === 'user-input-step') {
          if (current && (current.user || current.assistant)) pairs.push(current);
          const bubble = queryOne(step, '[data-testid="user-message-bubble"]') || step;
          const userText = extractCleanText(bubble, `[${POWERTOOLS_ROOT_ATTR}]`).replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200);
          current = { user: userText, assistant: '' };
        } else if (testId === 'agent-response') {
          const assistantText = extractAssistantText(step);
          if (!current) current = { user: '', assistant: assistantText };
          else current.assistant = current.assistant ? `${current.assistant}\n${assistantText}`.trim() : assistantText;
        }
      }
      if (current && (current.user || current.assistant)) pairs.push(current);
      const nonEmpty = pairs.filter(p => p.user || p.assistant);
      return { turns: nonEmpty.slice(-2), stepCount: steps.length };
    }

    function getCurrentTurnSnapshot() {
      const { turns, stepCount } = extractRecentTurns();
      if (!turns.length) return null;
      const latest = turns[turns.length - 1];
      const turnId = `t${stepCount}-${hashText(`${latest.user}\0${latest.assistant}`)}`;
      return { turns, stepCount, turnId };
    }

    function restoreCachedGhostIfAvailable(editor, opts) {
      if (!editor || !editor.isConnected || !isEditorEmpty(editor) || isComposing) return false;
      if (!opts.enabled || !opts.betaComposerPredict || getIsTurnRunning()) return false;
      const convId = String(getCurrentId() || '');
      const convKey = convId || '__default__';
      const snap = getCurrentTurnSnapshot();
      if (!snap) return false;
      const entry = turnStateGet(turnStateKey(convKey, snap.turnId));
      if (!entry || entry.dismissedByEscape || !entry.suggestion) return false;
      if (entry.configKey !== predictConfigKey(opts)) return false;
      if (
        activeGhost &&
        activeGhost.phase === 'ready' &&
        activeGhost.editor === editor &&
        activeGhost.suggestion === entry.suggestion &&
        activeGhost.turnId === snap.turnId
      ) {
        return true;
      }
      mountGhostOverlay(editor, entry.suggestion, convId, snap.turnId);
      return true;
    }

    function triggerPrediction(convId, convKey, opts, source = 'turn-end', precomputed = null) {
      const editor = precomputed?.editor || findMainComposer();
      if (!editor || !isEditorEmpty(editor) || isComposing) return;

      let turns = precomputed?.turns;
      let turnId = precomputed?.turnId;
      if (!turns || !turnId) {
        const snap = getCurrentTurnSnapshot();
        if (!snap) return;
        turns = snap.turns;
        turnId = snap.turnId;
      }

      const configKey = precomputed?.configKey || predictConfigKey(opts);
      if (
        activePredictReq &&
        activePredictReq.convKey === convKey &&
        activePredictReq.turnId === turnId &&
        !activePredictReq.aborted
      ) {
        return;
      }

      abortInFlightPredict();
      if (activeGhost?.phase === 'loading') {
        clearGhostOverlay();
      }
      const reqId = nextReqId('pred');
      const reqState = { reqId, convKey, conversationId: convId, turnId, source, configKey, aborted: false };
      activePredictReq = reqState;

      loadingGraceTimer = scheduleTimeout(() => {
        loadingGraceTimer = null;
        if (disposed || reqState.aborted || activePredictReq !== reqState) return;
        const liveOpts = getNormalizedOptions();
        if (!liveOpts.enabled || !liveOpts.betaComposerPredict || getIsTurnRunning()) return;
        const curId = String(getCurrentId() || '');
        const curKey = curId || '__default__';
        if (curKey !== convKey) return;
        const liveEditor = findMainComposer();
        if (!liveEditor || !isEditorEmpty(liveEditor) || isComposing) return;
        const phrase = pickNextLoadingPhrase();
        if (mountLoadingOverlay(liveEditor, convId, turnId, phrase)) {
          scheduleLoadingRotation(reqState);
        }
      }, LOADING_GRACE_MS);

      Promise.resolve()
        .then(() => request('beta.predictIntent', {
          reqId,
          conversationId: convId,
          turnId,
          turns,
          language: opts.language || ''
        }, PREDICT_TIMEOUT_MS))
        .then(res => {
          if (activePredictReq === reqState) {
            activePredictReq = null;
            clearLoadingTimers();
          }
          if (disposed || reqState.aborted) {
            if (activeGhost?.phase === 'loading' && activeGhost.turnId === turnId) clearGhostOverlay();
            return;
          }
          const liveOpts = getNormalizedOptions();
          const curId = String(getCurrentId() || '');
          const curKey = curId || '__default__';
          if (!liveOpts.enabled || !liveOpts.betaComposerPredict || curKey !== convKey || getIsTurnRunning()) {
            if (activeGhost?.phase === 'loading') clearGhostOverlay();
            return;
          }
          if (!res?.ok) {
            if (activeGhost?.phase === 'loading') clearGhostOverlay();
            if (!res?.aborted) {
              const key = turnStateKey(convKey, turnId);
              const existing = turnStateGet(key);
              turnStateSet(key, {
                suggestion: existing?.suggestion || '',
                dismissedByEscape: Boolean(existing?.dismissedByEscape),
                failedAt: Date.now(),
                configKey
              });
            }
            return;
          }
          const suggestion = !res.skipped && typeof res.suggestion === 'string' ? res.suggestion.trim() : '';
          if (!suggestion) {
            if (activeGhost?.phase === 'loading') clearGhostOverlay();
            return;
          }
          const key = turnStateKey(convKey, turnId);
          const existing = turnStateGet(key);
          if (existing?.dismissedByEscape) {
            if (activeGhost?.phase === 'loading') clearGhostOverlay();
            return;
          }
          turnStateSet(key, {
            suggestion,
            dismissedByEscape: false,
            failedAt: 0,
            configKey
          });
          const liveEditor = findMainComposer();
          if (!liveEditor || !isEditorEmpty(liveEditor) || isComposing) {
            if (activeGhost?.phase === 'loading') clearGhostOverlay();
            return;
          }
          mountGhostOverlay(liveEditor, suggestion, convId, turnId);
        })
        .catch(err => {
          if (activePredictReq === reqState) {
            activePredictReq = null;
            clearLoadingTimers();
          }
          if (activeGhost?.phase === 'loading' && activeGhost.turnId === turnId) {
            clearGhostOverlay();
          }
          if (disposed || reqState.aborted || err?.name === 'AbortError') return;
          const key = turnStateKey(convKey, turnId);
          const existing = turnStateGet(key);
          turnStateSet(key, {
            suggestion: existing?.suggestion || '',
            dismissedByEscape: Boolean(existing?.dismissedByEscape),
            failedAt: Date.now(),
            configKey
          });
        });
    }

    function maybeTriggerOrRestorePrediction(convId, convKey, opts, source) {
      const editor = findMainComposer();
      if (!editor || !isEditorEmpty(editor) || isComposing) return;
      if (!opts.enabled || !opts.betaComposerPredict || getIsTurnRunning()) return;

      const snap = getCurrentTurnSnapshot();
      if (!snap) return;

      const { turns, turnId } = snap;
      const configKey = predictConfigKey(opts);
      const key = turnStateKey(convKey, turnId);
      const entry = turnStateGet(key);

      if (entry) {
        if (entry.dismissedByEscape) return;
        if (entry.suggestion && entry.configKey === configKey) {
          if (
            !(activeGhost &&
              activeGhost.phase === 'ready' &&
              activeGhost.editor === editor &&
              activeGhost.suggestion === entry.suggestion &&
              activeGhost.turnId === turnId)
          ) {
            mountGhostOverlay(editor, entry.suggestion, convId, turnId);
          }
          return;
        }
        if (entry.failedAt && Date.now() - entry.failedAt < PREDICT_FAIL_COOLDOWN_MS && entry.configKey === configKey) {
          return;
        }
      }

      if (
        activePredictReq &&
        activePredictReq.convKey === convKey &&
        activePredictReq.turnId === turnId &&
        !activePredictReq.aborted
      ) {
        return;
      }

      triggerPrediction(convId, convKey, opts, source, { editor, turns, turnId, configKey });
    }

    function syncComposerPredict(opts) {
      const convId = String(getCurrentId() || '');
      const convKey = convId || '__default__';
      const running = Boolean(getIsTurnRunning());

      if (lastConversationKey && lastConversationKey !== convKey) {
        dismissGhostAndAbort();
        lastConvSwitchAt = Date.now();
      }
      lastConversationKey = convKey;

      const prevRunning = Boolean(wasRunningByConv.get(convKey));
      wasRunningByConv.set(convKey, running);

      if (!opts.enabled || !opts.betaComposerPredict) {
        dismissGhostAndAbort();
        turnStateByKey.clear();
        return;
      }

      if (running) {
        dismissGhostAndAbort();
        return;
      }

      if (activeGhost) {
        const editor = activeGhost.editor?.isConnected ? activeGhost.editor : findMainComposer();
        if (!editor || !isEditorEmpty(editor) || isComposing) {
          dismissGhostAndAbort();
        }
      }

      if (prevRunning && !running) {
        maybeTriggerOrRestorePrediction(convId, convKey, opts, 'turn-end');
        return;
      }

      if (!activeGhost && !activePredictReq) {
        const editor = findMainComposer();
        if (editor && isEditorEmpty(editor) && !isComposing) {
          restoreCachedGhostIfAvailable(editor, opts);
        }
      }
    }

    function isNodeInside(container, target) {
      if (!container || !target) return false;
      if (container === target) return true;
      if (typeof container.contains === 'function') return Boolean(container.contains(target));
      for (let cur = target; cur; cur = cur.parentElement) {
        if (cur === container) return true;
      }
      return false;
    }

    function insertTextIntoComposer(editor, text) {
      let inserted = false;
      if (typeof doc?.execCommand === 'function') {
        try {
          inserted = Boolean(doc.execCommand('insertText', false, text));
        } catch {
          inserted = false;
        }
      }
      if (!inserted && typeof editor.dispatchEvent === 'function') {
        const InputEventCtor = win?.InputEvent || globalThis.InputEvent;
        let evt = null;
        if (typeof InputEventCtor === 'function') {
          try {
            evt = new InputEventCtor('beforeinput', {
              inputType: 'insertText',
              data: text,
              bubbles: true,
              cancelable: true
            });
          } catch {
            evt = null;
          }
        }
        if (!evt) {
          evt = {
            type: 'beforeinput',
            inputType: 'insertText',
            data: text,
            bubbles: true,
            cancelable: true
          };
        }
        editor.dispatchEvent(evt);
      }
      if (!inserted && isEditorEmpty(editor) && typeof env.adapter?.setComposerText === 'function') {
        try {
          const target = closestSel(editor, '.surface-composer-card') || editor;
          env.adapter.setComposerText(target, text);
        } catch {}
      }
    }

    function onDocumentKeyDown(event) {
      if (disposed || !event) return;
      const editor = (activeGhost?.editor?.isConnected ? activeGhost.editor : null) || findMainComposer();

      if (event.key === 'Tab' && event.isTrusted !== false) {
        const fromInside = editor && (isNodeInside(editor, event.target) || isNodeInside(editor, doc?.activeElement));
        if (!fromInside) {
          lastExternalTabKeyAt = Date.now();
        }
      }

      if (!activeGhost && !activePredictReq) return;
      if (!editor) return;

      const focusedInEditor = isNodeInside(editor, doc?.activeElement) || isNodeInside(editor, event.target);

      if (event.key === 'Escape' && (activeGhost || activePredictReq) && focusedInEditor) {
        const convId = String(getCurrentId() || '');
        const convKey = convId || '__default__';
        const turnId = activeGhost?.turnId || activePredictReq?.turnId || getCurrentTurnSnapshot()?.turnId || '';
        const opts = getNormalizedOptions();
        if (turnId) {
          const key = turnStateKey(convKey, turnId);
          const existing = turnStateGet(key);
          turnStateSet(key, {
            suggestion: existing?.suggestion || (activeGhost?.phase === 'ready' ? activeGhost.suggestion : ''),
            dismissedByEscape: true,
            failedAt: existing?.failedAt || 0,
            configKey: existing?.configKey || predictConfigKey(opts)
          });
        }
        dismissGhostAndAbort();
        return;
      }

      if (
        event.key === 'Tab' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        !isComposing &&
        activeGhost &&
        activeGhost.phase === 'ready' &&
        activeGhost.suggestion &&
        isNodeInside(editor, doc?.activeElement) &&
        isEditorEmpty(editor)
      ) {
        event.preventDefault?.();
        event.stopPropagation?.();
        const text = activeGhost.suggestion;
        clearGhostOverlay();
        insertTextIntoComposer(editor, text);
      }
    }

    function onDocumentBeforeInput(event) {
      if (disposed) return;
      const editor = (activeGhost?.editor?.isConnected ? activeGhost.editor : null) || findMainComposer();
      if (!editor) return;
      if (event?.target && !isNodeInside(editor, event.target)) return;
      const inputType = String(event?.inputType || '');
      if (inputType.startsWith('delete') && isEditorEmpty(editor)) return;
      if (!isEditorEmpty(editor) || !inputType || !inputType.startsWith('delete')) {
        dismissGhostAndAbort();
      }
    }

    function onDocumentInput(event) {
      if (disposed) return;
      const editor = (activeGhost?.editor?.isConnected ? activeGhost.editor : null) || findMainComposer();
      if (!editor) return;
      const inEditor = !event?.target || isNodeInside(editor, event.target);
      if (!inEditor && isEditorEmpty(editor)) return;

      if (!isEditorEmpty(editor)) {
        dismissGhostAndAbort();
        return;
      }

      if (isComposing) {
        dismissGhostAndAbort();
        return;
      }

      const opts = getNormalizedOptions();
      if (!opts.enabled || !opts.betaComposerPredict || getIsTurnRunning()) {
        dismissGhostAndAbort();
        return;
      }
      restoreCachedGhostIfAvailable(editor, opts);
    }

    function onDocumentPaste(event) {
      if (disposed) return;
      const editor = (activeGhost?.editor?.isConnected ? activeGhost.editor : null) || findMainComposer();
      if (!editor) return;
      if (!event?.target || isNodeInside(editor, event.target)) {
        dismissGhostAndAbort();
      }
    }

    function onDocumentPointerDown(event) {
      if (disposed || !event) return;
      if (event.isTrusted === false) return;
      if (event.button != null && event.button !== 0) return;
      const opts = getNormalizedOptions();
      if (!opts.enabled || !opts.betaComposerPredict || getIsTurnRunning() || isComposing) return;
      const editor = findMainComposer();
      if (!editor || !isEditorEmpty(editor)) return;
      if (!isNodeInside(editor, event.target)) return;
      const convId = String(getCurrentId() || '');
      const convKey = convId || '__default__';
      maybeTriggerOrRestorePrediction(convId, convKey, opts, 'user-focus');
    }

    function onDocumentFocusIn(event) {
      if (disposed || !event || event.isTrusted === false) return;
      const opts = getNormalizedOptions();
      if (!opts.enabled || !opts.betaComposerPredict || getIsTurnRunning() || isComposing) return;
      const editor = findMainComposer();
      if (!editor || !isEditorEmpty(editor)) return;
      if (!isNodeInside(editor, event.target)) return;
      const now = Date.now();
      if (now - lastConvSwitchAt <= 350) return;
      if (now - lastExternalTabKeyAt > 150) return;
      const convId = String(getCurrentId() || '');
      const convKey = convId || '__default__';
      maybeTriggerOrRestorePrediction(convId, convKey, opts, 'user-focus');
    }

    function onDocumentFocusOut(event) {
      if (disposed || !event) return;
      if (!activePredictReq || activePredictReq.source !== 'user-focus') return;
      const editor = (activeGhost?.editor?.isConnected ? activeGhost.editor : null) || findMainComposer();
      if (!editor) {
        dismissGhostAndAbort();
        return;
      }
      if (event.target && !isNodeInside(editor, event.target)) return;
      if (event.relatedTarget && isNodeInside(editor, event.relatedTarget)) return;
      dismissGhostAndAbort();
    }

    function onCompositionStart(event) {
      if (disposed) return;
      const editor = (activeGhost?.editor?.isConnected ? activeGhost.editor : null) || findMainComposer();
      if (!editor || !event?.target || isNodeInside(editor, event.target)) {
        isComposing = true;
        dismissGhostAndAbort();
      }
    }

    function onCompositionEnd() {
      isComposing = false;
    }

    doc?.addEventListener?.('keydown', onDocumentKeyDown, true);
    doc?.addEventListener?.('beforeinput', onDocumentBeforeInput, true);
    doc?.addEventListener?.('input', onDocumentInput, true);
    doc?.addEventListener?.('paste', onDocumentPaste, true);
    doc?.addEventListener?.('pointerdown', onDocumentPointerDown, true);
    doc?.addEventListener?.('focusin', onDocumentFocusIn, true);
    doc?.addEventListener?.('focusout', onDocumentFocusOut, true);
    doc?.addEventListener?.('compositionstart', onCompositionStart, true);
    doc?.addEventListener?.('compositionend', onCompositionEnd, true);

    // -----------------------------------------------------------------------
    // Sync, Observer & Lifecycle
    // -----------------------------------------------------------------------
    function sync() {
      if (disposed) return;
      const opts = getNormalizedOptions();
      syncThinkingTranslation(opts);
      syncComposerPredict(opts);
    }

    function scheduleSync() {
      if (disposed || mutationTimer !== null) return;
      mutationTimer = scheduleTimeout(() => {
        mutationTimer = null;
        sync();
      }, MUTATION_DEBOUNCE_MS);
    }

    let mutationObserver = null;
    const MOCtor = win?.MutationObserver || globalThis.MutationObserver;
    if (typeof MOCtor === 'function' && doc?.body) {
      try {
        mutationObserver = new MOCtor(records => {
          if (disposed) return;
          const relevant = (records || []).some(rec => {
            const target = rec?.target;
            if (!target) return false;
            const el = isElementNode(target) ? target : target.parentElement;
            if (!el) return false;
            if (closestSel(el, `[${POWERTOOLS_ROOT_ATTR}], [contenteditable="true"], [contenteditable=""]`)) return false;
            return true;
          });
          if (relevant) scheduleSync();
        });
        mutationObserver.observe(doc.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['aria-expanded', 'data-state', 'data-streaming', 'class']
        });
      } catch {
        mutationObserver = null;
      }
    }

    const unsubStore = subscribe(() => {
      if (!disposed) sync();
    });

    function dispose() {
      if (disposed) return;
      disposed = true;

      if (mutationTimer !== null) {
        cancelTimeout(mutationTimer);
        mutationTimer = null;
      }
      try { unsubStore?.(); } catch {}
      try { mutationObserver?.disconnect?.(); } catch {}
      mutationObserver = null;

      doc?.removeEventListener?.('keydown', onDocumentKeyDown, true);
      doc?.removeEventListener?.('beforeinput', onDocumentBeforeInput, true);
      doc?.removeEventListener?.('input', onDocumentInput, true);
      doc?.removeEventListener?.('paste', onDocumentPaste, true);
      doc?.removeEventListener?.('pointerdown', onDocumentPointerDown, true);
      doc?.removeEventListener?.('focusin', onDocumentFocusIn, true);
      doc?.removeEventListener?.('focusout', onDocumentFocusOut, true);
      doc?.removeEventListener?.('compositionstart', onCompositionStart, true);
      doc?.removeEventListener?.('compositionend', onCompositionEnd, true);

      // Abort & cleanup Thinking translation
      for (const block of [...blockByNativeMd.values()]) {
        teardownBlock(block);
      }
      for (const reqId of [...activeTranslateRequests.keys()]) {
        activeTranslateRequests.delete(reqId);
        sendAbort('beta.abortTranslate', reqId);
      }
      try { intersectionObserver?.disconnect?.(); } catch {}
      intersectionObserver = null;
      observedTargetMap.clear();

      // Safety sweep for any remaining translate roots or attributes
      for (const el of queryAll(doc, `[${TRANSLATE_ROOT_ATTR}="thinking"], [${POWERTOOLS_ROOT_ATTR}="beta-translate"]`)) {
        el.remove?.();
      }
      for (const el of queryAll(doc, `[${HIDDEN_SRC_ATTR}]`)) {
        el.removeAttribute?.(HIDDEN_SRC_ATTR);
      }
      for (const el of queryAll(doc, `[${BILINGUAL_SRC_ATTR}]`)) {
        el.removeAttribute?.(BILINGUAL_SRC_ATTR);
      }

      // Abort & cleanup Composer ghost text
      dismissGhostAndAbort();
      for (const el of queryAll(doc, `[${POWERTOOLS_ROOT_ATTR}="beta-ghost"], [data-testid="agy-composer-ghost-text"]`)) {
        el.remove?.();
      }
      for (const el of queryAll(doc, `[${GHOST_ACTIVE_ATTR}]`)) {
        el.removeAttribute?.(GHOST_ACTIVE_ATTR);
      }

      // Remove injected stylesheet
      styleEl?.remove?.();
      styleEl = null;

      // Restore or remove global delta hook
      if (globalThis.__agyBetaTranslateDelta === deltaHandler) {
        if (prevDeltaHandler === undefined) delete globalThis.__agyBetaTranslateDelta;
        else globalThis.__agyBetaTranslateDelta = prevDeltaHandler;
      }

      wasRunningByConv.clear();
      turnStateByKey.clear();
      translationMemo.clear();
    }

    // Initial sync
    sync();

    return { sync, dispose };
  }

  globalThis.__agyBetaAi = {
    mountBetaAi,
    extractThinkingMarkdown,
    renderSafeMarkdown,
    sliceParagraphs
  };
})();
