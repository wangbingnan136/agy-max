import {
  LICENSE_URL,
  NOTICE_URL,
  RELEASES_URL,
  REPO_SLUG,
  REPO_URL,
  SCREENSHOT_ASSETS,
  SITE_CONTENT
} from './content.mjs';
import { MODULE_CATALOG } from '../packages/core/catalog.mjs';

const esc = value =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const assetFileById = new Map(SCREENSHOT_ASSETS.map(item => [item.id, item.file]));

function renderHeatmapCells(count) {
  const levels = [0, 1, 2, 1, 3, 2, 4, 2, 1, 3, 4, 3, 2, 1, 0, 2, 3, 4, 3, 2, 4, 3, 2, 1, 3, 4, 2, 3];
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const level = levels[(i * 7 + (i % 5)) % levels.length];
    out += `<span class="hm-cell hm-${level}"></span>`;
  }
  return out;
}

function renderBentoVisual(id, v) {
  if (id === 'fast') {
    return `
      <div class="bento-visual visual-fast" aria-hidden="true">
        <div class="fast-bar-group">
          <div class="fast-row">
            <span>${esc(v.fastBefore)}</span>
            <span class="mono muted">12 turns</span>
          </div>
          <div class="bar-track"><span class="bar-fill bar-muted" style="width:92%"></span></div>
          <div class="fast-row">
            <span>${esc(v.fastAfter)}</span>
            <span class="mono accent">3 turns</span>
          </div>
          <div class="bar-track"><span class="bar-fill bar-accent" style="width:28%"></span></div>
        </div>
        <div class="tool-chips">
          <span class="mono chip">batch_search</span>
          <span class="mono chip">apply_edits</span>
          <span class="mono chip">quick_outline</span>
          <span class="mono chip">run_checks</span>
        </div>
        <div class="mini-toggle-row">
          <span class="mini-dot on"></span>
          <span>${esc(v.fastSwitch)}</span>
        </div>
      </div>`;
  }
  if (id === 'filetree') {
    return `
      <div class="bento-visual visual-tree" aria-hidden="true">
        <div class="mini-tree-box">
          <div class="mini-tree-head">
            <span class="mono">lib / aux-file-tree.js</span>
            <span class="badge-soft mono">${esc(v.fileTreeSave)}</span>
          </div>
          <div class="mini-tree-lines mono">
            <div><span class="ln">41</span> const stat = await fs.stat(target);</div>
            <div class="diff-add"><span class="ln">42</span> + if (stat.mtimeMs !== baseMtime) return conflict();</div>
            <div class="diff-add"><span class="ln">43</span> + await atomicReplace(target, nextText, eol);</div>
          </div>
        </div>
        <div class="editor-chips">
          <span class="chip">Cursor</span>
          <span class="chip">VS Code</span>
          <span class="chip">Windsurf</span>
          <span class="chip">Zed</span>
          <span class="chip chip-accent">Kiro</span>
        </div>
      </div>`;
  }
  if (id === 'codex') {
    return `
      <div class="bento-visual visual-codex" aria-hidden="true">
        <div class="mini-row-card">
          <span class="kbd mono">⌘⌥F</span>
          <span class="row-copy">${esc(v.codexSearch)}</span>
        </div>
        <div class="mini-row-card">
          <span class="status-pulse"></span>
          <span class="row-copy">${esc(v.codexBell)}</span>
          <span class="badge-soft">Priority</span>
        </div>
        <div class="mini-row-card goal-mini">
          <span class="goal-tag mono">/goal</span>
          <span class="row-copy">${esc(v.codexGoal)}</span>
        </div>
      </div>`;
  }
  if (id === 'prism') {
    return `
      <div class="bento-visual visual-prism" aria-hidden="true">
        <div class="swatch-strip">
          <div class="swatch" style="--sw-bg:#F4F7FB;--sw-fg:#0F172A;--sw-ac:#2563EB">
            <span class="swatch-dot"></span><span>Crystal</span>
          </div>
          <div class="swatch" style="--sw-bg:#0E0E11;--sw-fg:#F2F2F5;--sw-ac:#669DF6">
            <span class="swatch-dot"></span><span>Obsidian</span>
          </div>
          <div class="swatch" style="--sw-bg:#F6F4EE;--sw-fg:#1C1814;--sw-ac:#C25934">
            <span class="swatch-dot"></span><span>Alabaster</span>
          </div>
          <div class="swatch" style="--sw-bg:#141413;--sw-fg:#F2EFE9;--sw-ac:#D97757">
            <span class="swatch-dot"></span><span>Warm</span>
          </div>
        </div>
        <div class="vial-showcase">
          <div class="vial-mini"><div class="vial-liquid"></div></div>
          <div class="preset-chips">
            <span class="chip">Native</span>
            <span class="chip chip-accent">Ultra</span>
            <span class="chip">Focus</span>
            <span class="chip">Eco</span>
          </div>
        </div>
      </div>`;
  }
  if (id === 'telemetry') {
    return `
      <div class="bento-visual visual-telemetry" aria-hidden="true">
        <div class="telemetry-top">
          <div>
            <div class="big-metric mono">97.4%</div>
            <div class="metric-caption">${esc(v.telemetryRate)}</div>
          </div>
          <span class="alert-pill">${esc(v.telemetryAlert)}</span>
        </div>
        <div class="mini-heatmap">${renderHeatmapCells(42)}</div>
      </div>`;
  }
  return `
    <div class="bento-visual visual-ssh" aria-hidden="true">
      <div class="ssh-card">
        <div class="ssh-raw mono">${esc(v.sshInput)}</div>
        <div class="ssh-out">
          <span class="mono ok-text">${esc(v.sshParsed)}</span>
          <span class="badge-warn">${esc(v.sshDropped)}</span>
        </div>
      </div>
      <div class="tool-chips">
        <span class="chip">${esc(v.keyringTag)}</span>
        <span class="chip">${esc(v.proxyTag)}</span>
      </div>
    </div>`;
}

export function renderPage({ locale, version, assetPrefix }) {
  const c = SITE_CONTENT[locale];
  const logoSrc = `${assetPrefix}assets/logo.svg`;
  const heroShotSrc = `${assetPrefix}assets/images/hero-workspace.png`;
  const pageTitle = c.title;
  const isZh = locale === 'zh';
  const versionLabel = `v${version}`;

  const navLinksHtml = c.nav
    .map(item => `<a class="nav-link" href="${esc(item.href)}">${esc(item.label)}</a>`)
    .join('');

  const heroTabsHtml = c.hero.tabs
    .map(
      (tab, index) => `
      <button type="button" class="mode-tab${index === 0 ? ' is-active' : ''}" role="tab" aria-selected="${index === 0 ? 'true' : 'false'}" data-demo-tab="${esc(tab.id)}">
        ${esc(tab.label)}
      </button>`
    )
    .join('');

  const priorityHtml = c.demo.sidebarPriorityItems
    .map(
      item => `
      <div class="wb-item${item.active ? ' is-active' : ''}">
        <span class="wb-dot wb-dot-${esc(item.badge)}"></span>
        <span class="wb-item-title">${esc(item.title)}</span>
        <span class="wb-badge mono">${esc(item.meta)}</span>
      </div>`
    )
    .join('');

  const foldersHtml = c.demo.sidebarFolders
    .map(
      item => `
      <div class="wb-item${item.active ? ' is-active' : ''}">
        <span class="wb-folder-mark"></span>
        <span class="wb-item-title">${esc(item.name)}</span>
        <span class="wb-count mono">${esc(item.count)}</span>
      </div>`
    )
    .join('');

  const telemetryStatsHtml = c.demo.telemetryStats
    .map(
      stat => `
      <div class="wb-stat-card">
        <div class="wb-stat-label">${esc(stat.label)}</div>
        <div class="wb-stat-value mono">${esc(stat.value)}</div>
        <div class="wb-stat-sub">${esc(stat.sub)}</div>
      </div>`
    )
    .join('');

  const paletteButtonsHtml = c.demo.palettes
    .map(
      (p, idx) => `
      <button type="button" class="palette-card${idx === 0 ? ' is-active' : ''}" data-wb-palette="${esc(p.id)}">
        <div class="palette-card-top">
          <span class="palette-swatch palette-swatch-${esc(p.id)}"></span>
          <span class="palette-name">${esc(p.name)}</span>
          <span class="palette-mode">${esc(p.mode)}</span>
        </div>
        <p class="palette-desc">${esc(p.desc)}</p>
      </button>`
    )
    .join('');

  const presetsHtml = c.demo.presets
    .map(
      (preset, idx) => `
      <button type="button" class="preset-pill${idx === 1 ? ' is-active' : ''}" data-wb-preset="${idx}">
        ${esc(preset)}
      </button>`
    )
    .join('');

  const shotTabsHtml = c.screenshots.items
    .map(
      (item, idx) => `
      <button type="button" class="shot-tab${idx === 0 ? ' is-active' : ''}" data-shot-id="${esc(item.id)}" data-shot-src="${esc(`${assetPrefix}assets/images/${assetFileById.get(item.id)}`)}" data-shot-title="${esc(item.title)}" data-shot-caption="${esc(item.caption)}">
        ${esc(item.tab)}
      </button>`
    )
    .join('');

  const shotThumbsHtml = c.screenshots.items
    .map(
      (item, idx) => `
      <button type="button" class="shot-thumb${idx === 0 ? ' is-active' : ''}" data-shot-id="${esc(item.id)}" aria-label="${esc(item.title)}">
        <img src="${esc(`${assetPrefix}assets/images/${assetFileById.get(item.id)}`)}" alt="${esc(item.title)}" loading="lazy" />
        <span>${esc(item.tab)}</span>
      </button>`
    )
    .join('');

  const bentoHtml = c.capabilities.cards
    .map(
      card => `
      <article class="bento-card">
        ${renderBentoVisual(card.id, c.capabilities.visuals)}
        <div class="bento-body">
          <h3>${esc(card.title)}</h3>
          <p>${esc(card.desc)}</p>
        </div>
      </article>`
    )
    .join('');

  // Module names and descriptions come from the plugin's own catalog so the site never drifts from the Modules tab.
  const catalogLang = isZh ? 'zh-CN' : 'en';
  const moduleGroupHtml = (defaultInstalled, title, badge) => `
      <div class="modules-group">
        <h3 class="modules-group-title">${esc(title)}</h3>
        <div class="modules-grid">
          ${MODULE_CATALOG.filter(m => m.defaultInstalled === defaultInstalled)
            .map(
              m => `
          <article class="pillar-card module-card">
            <div class="module-top">
              <h4>${esc(m.displayName[catalogLang])}</h4>
              <span class="${defaultInstalled ? 'badge-soft' : 'chip chip-accent'}">${esc(badge)}</span>
            </div>
            <p>${esc(m.description[catalogLang])}</p>
          </article>`
            )
            .join('')}
        </div>
      </div>`;
  const modulesHtml =
    moduleGroupHtml(true, c.modules.defaultTitle, c.modules.defaultBadge) +
    moduleGroupHtml(false, c.modules.optionalTitle, c.modules.optionalBadge);
  const modulePointsHtml = c.modules.points.map(point => `<li class="chip">${esc(point)}</li>`).join('');

  const pillarsHtml = c.credits.pillars
    .map(
      pillar => `
      <article class="pillar-card">
        <h3>${esc(pillar.title)}</h3>
        <p>${esc(pillar.body)}</p>
      </article>`
    )
    .join('');

  const upstreamsHtml = c.credits.upstreams
    .map(
      item => `
      <a class="upstream-card" href="${esc(item.url)}" target="_blank" rel="noreferrer">
        <div class="upstream-top">
          <span class="upstream-name mono">${esc(item.name)}</span>
          <span class="upstream-role">${esc(item.role)}</span>
        </div>
        <p>${esc(item.desc)}</p>
      </a>`
    )
    .join('');

  const platformsHtml = c.install.platforms
    .map(
      plat => `
      <article class="platform-card">
        <div class="platform-head">
          <h3>${esc(plat.name)}</h3>
          <span class="platform-status status-${esc(plat.statusTone)}">${esc(plat.status)}</span>
        </div>
        <div class="cmd-box">
          <code class="mono">${esc(plat.cmd)}</code>
          <button type="button" class="copy-mini" data-copy-text="${esc(plat.cmd)}" data-copy-done="${esc(c.install.copiedBtn)}" aria-label="${esc(c.install.copyCmdLabel)}">
            ${esc(c.install.copyCmdLabel)}
          </button>
        </div>
        <p class="platform-note">${esc(plat.note)}</p>
      </article>`
    )
    .join('');

  const installLinksHtml = c.install.links
    .map(
      link => `<a class="text-link" href="${esc(link.href)}" target="_blank" rel="noreferrer">${esc(link.label)}</a>`
    )
    .join('');

  const changelogHtml = c.changelog.entries
    .map(
      (entry, idx) => `
      <details class="release-item"${idx === 0 ? ' open' : ''}>
        <summary class="release-summary">
          <span class="release-ver mono">${esc(entry.version)}</span>
          ${entry.tag ? `<span class="release-tag">${esc(entry.tag)}</span>` : ''}
          <span class="release-title">${esc(entry.title)}</span>
          <span class="release-chevron" aria-hidden="true"></span>
        </summary>
        <ul class="release-list">
          ${entry.highlights.map(line => `<li>${esc(line)}</li>`).join('')}
        </ul>
      </details>`
    )
    .join('');

  const footerLinksHtml = c.footer.links
    .map(link => {
      const external = link.href.startsWith('http');
      return `<a href="${esc(link.href)}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${esc(link.label)}</a>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${esc(c.lang)}" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(pageTitle)}</title>
  <meta name="description" content="${esc(c.description)}" />
  <meta property="og:title" content="${esc(pageTitle)}" />
  <meta property="og:description" content="${esc(c.description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="${esc(heroShotSrc)}" />
  <link rel="icon" type="image/svg+xml" href="${esc(logoSrc)}" />
  <script>
    (() => {
      try {
        const saved = localStorage.getItem('agy-max-site-theme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = saved === 'dark' || saved === 'light' ? saved : (prefersDark ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;
      } catch {}
    })();
  </script>
  <link rel="stylesheet" href="${esc(assetPrefix)}styles.css" />
</head>
<body data-repo="${esc(REPO_SLUG)}" data-version="${esc(versionLabel)}" data-locale="${esc(locale)}">
  <div class="optical-wash" aria-hidden="true"></div>

  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="#">
        <img src="${esc(logoSrc)}" width="28" height="28" alt="${esc(c.brand)} Logo" />
        <span>${esc(c.brand)}</span>
      </a>
      <nav class="header-nav" aria-label="Primary">
        ${navLinksHtml}
      </nav>
      <div class="header-actions">
        <button type="button" class="icon-btn" id="theme-toggle" aria-label="${esc(c.themeToggleLabel)}" title="${esc(c.themeToggleLabel)}">
          <svg class="icon-sun" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4"></circle>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
          </svg>
          <svg class="icon-moon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        </button>
        <a class="pill-btn lang-btn" href="${esc(c.altLangHref)}">${esc(c.altLangLabel)}</a>
        <a class="pill-btn gh-btn" href="${esc(REPO_URL)}" target="_blank" rel="noreferrer">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18a10.98 10.98 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.8 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.42.36.79 1.07.79 2.16 0 1.56-.01 2.82-.01 3.2 0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>
          <span>GitHub</span>
          <span class="gh-stars mono" id="gh-stars"></span>
        </a>
        <a class="solid-btn header-install" href="#install">${esc(c.installNavCta)}</a>
      </div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="container hero-copy">
        <div class="hero-pill">
          <span class="hero-pill-dot"></span>
          <span>${esc(c.hero.badge)}</span>
          <span class="sep-bar" aria-hidden="true"></span>
          <span class="muted">${esc(c.hero.badgeNote)}</span>
        </div>
        <h1>
          <span>${esc(c.hero.titleLine1)}</span>
          <span class="h1-line2">${esc(c.hero.titleLine2)}</span>
        </h1>
        <p class="hero-lead">${esc(c.hero.lead)}</p>
        <div class="hero-cta-group">
          <button type="button" class="primary-cta" id="hero-copy-prompt" data-copy-text="${esc(c.install.agentPrompt)}" data-copy-default="${esc(c.hero.primaryCta)}" data-copy-done="${esc(c.hero.primaryCtaCopied)}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span class="cta-label">${esc(c.hero.primaryCta)}</span>
          </button>
          <a class="secondary-cta" href="#install">${esc(c.hero.secondaryLink)}</a>
        </div>
        <div class="hero-meta">
          <span class="mono" id="hero-version">${esc(versionLabel)}</span>
          <span class="sep-bar" aria-hidden="true"></span>
          <span>${esc(c.hero.metaLicense)}</span>
          <span class="sep-bar" aria-hidden="true"></span>
          <span>${esc(c.hero.metaPlatform)}</span>
        </div>
      </div>

      <div class="container stage-wrap">
        <div class="mode-switcher" role="tablist" aria-label="Workbench demo views">
          ${heroTabsHtml}
        </div>

        <div class="workbench-shell" id="workbench-shell" data-wb-palette="crystal" data-gauge="vial">
          <div class="wb-titlebar">
            <div class="wb-traffic" aria-hidden="true">
              <span class="tl tl-r"></span>
              <span class="tl tl-y"></span>
              <span class="tl tl-g"></span>
            </div>
            <div class="wb-title mono">${esc(c.demo.windowTitle)}</div>
            <div class="wb-title-tools">
              <span class="wb-pill mono">${esc(c.demo.searchHint)}</span>
              <span class="wb-pill wb-pill-live"><span class="live-dot"></span>${esc(c.demo.bellLabel)}</span>
            </div>
          </div>

          <!-- View 1: Workbench & Inline File Tree -->
          <div class="wb-view is-active" data-demo-panel="workbench">
            <aside class="wb-sidebar">
              <div class="wb-side-label">${esc(c.demo.sidebarPriorityTitle)}</div>
              <div class="wb-list">${priorityHtml}</div>
              <div class="wb-side-label">${esc(c.demo.sidebarFoldersTitle)}</div>
              <div class="wb-list">${foldersHtml}</div>
            </aside>

            <div class="wb-center">
              <div class="wb-goal-pill">
                <span class="wb-goal-tag mono">${esc(c.demo.goalLabel)}</span>
                <span class="wb-goal-text">${esc(c.demo.goalText)}</span>
                <span class="wb-goal-progress mono">${esc(c.demo.goalStepsDone)}</span>
              </div>

              <div class="wb-thread">
                <div class="wb-bubble wb-user">${esc(c.demo.chatUserPrompt)}</div>
                <div class="wb-step-row">
                  <span class="wb-check"></span>
                  <span>${esc(c.demo.chatThought)}</span>
                </div>
                <div class="wb-bubble wb-assistant">
                  <p>${esc(c.demo.chatReply)}</p>
                  <div class="wb-inline-diff mono">
                    <span>${esc(c.demo.diffFiles)}</span>
                    <span class="diff-plus">+42</span>
                    <span class="diff-minus">-8</span>
                  </div>
                </div>
              </div>

              <div class="wb-composer-wrap">
                <div class="wb-composer-box">${esc(c.demo.composerPlaceholder)}</div>
                <div class="wb-status-strip">
                  <div class="wb-strip-left mono">
                    <span class="strip-pill">⎇ ${esc(c.demo.gitBranch)}</span>
                    <span class="strip-pill"><span class="diff-plus">+42</span> <span class="diff-minus">-8</span></span>
                  </div>
                  <div class="wb-strip-right">
                    <button type="button" class="gauge-switch" id="wb-gauge-toggle" title="${esc(c.demo.contextModeLabel)}">
                      <span class="gauge-ring-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity="0.22" stroke-width="2.6"></circle>
                          <circle cx="12" cy="12" r="9" fill="none" stroke="var(--wb-accent)" stroke-width="2.6" stroke-dasharray="39 57" stroke-linecap="round" transform="rotate(-90 12 12)"></circle>
                        </svg>
                      </span>
                      <span class="gauge-vial-icon" aria-hidden="true"><span class="vial-fill-sm"></span></span>
                      <span class="mono">${esc(c.demo.contextUsed)}</span>
                      <span class="gauge-mode-text" data-ring-label="${esc(c.demo.contextRingName)}" data-vial-label="${esc(c.demo.contextVialName)}">${esc(c.demo.contextVialName)}</span>
                    </button>
                    <span class="strip-metric mono">${esc(c.demo.contextDetail)}</span>
                    <span class="strip-metric mono accent-wb">${esc(c.demo.speedValue)}</span>
                  </div>
                </div>
              </div>
            </div>

            <aside class="wb-right-panel">
              <div class="wb-panel-tabs">
                <span class="wb-ptab">${esc(c.demo.sidePanelTabs[0])}</span>
                <span class="wb-ptab is-active">${esc(c.demo.sidePanelTabs[1])}</span>
              </div>
              <div class="wb-tree-list mono">
                <div class="wb-tree-row">▾ lib/</div>
                <div class="wb-tree-row is-selected">  aux-file-tree.js</div>
                <div class="wb-tree-row">  prism-optics.js</div>
                <div class="wb-tree-row">  transcript-search.mjs</div>
                <div class="wb-tree-row">▸ docs/</div>
              </div>
              <div class="wb-preview-card">
                <div class="wb-preview-head">
                  <span class="mono">aux-file-tree.js</span>
                  <button type="button" class="wb-edit-btn" id="wb-inline-edit-btn" data-edit-label="${esc(c.demo.editBtn)}" data-save-label="${esc(c.demo.saveBtn)}">
                    ${esc(c.demo.editBtn)}
                  </button>
                </div>
                <pre class="wb-code mono" id="wb-code-preview">async function saveInlineFile(path, text, baseMtime) {
  const cur = await stat(path);
  if (cur.mtimeMs !== baseMtime) return { conflict: true };
  return atomicWrite(path, preserveEol(text));
}</pre>
                <textarea class="wb-code-editor mono" id="wb-code-editor" spellcheck="false" hidden>async function saveInlineFile(path, text, baseMtime) {
  const cur = await stat(path);
  if (cur.mtimeMs !== baseMtime) return { conflict: true };
  return atomicWrite(path, preserveEol(text));
}</textarea>
                <div class="wb-preview-foot" id="wb-editor-status" data-default="${esc(c.demo.editorHint)}" data-saved="${esc(c.demo.savedToast)}">
                  ${esc(c.demo.editorHint)}
                </div>
              </div>
            </aside>
          </div>

          <!-- View 2: Telemetry Dashboard & Cache Anomaly -->
          <div class="wb-view wb-telemetry-view" data-demo-panel="telemetry">
            <div class="wb-stat-grid">
              ${telemetryStatsHtml}
            </div>
            <div class="wb-heatmap-card">
              <div class="wb-card-head">
                <div>
                  <div class="wb-card-title">${esc(c.demo.heatmapTitle)}</div>
                  <div class="wb-card-sub">${esc(c.demo.heatmapSub)}</div>
                </div>
                <span class="wb-pill mono">SQLite Read-Only</span>
              </div>
              <div class="wb-heatmap-grid">${renderHeatmapCells(140)}</div>
            </div>
            <div class="wb-anomaly-card">
              <div class="wb-anomaly-title">${esc(c.demo.anomalyTitle)}</div>
              <div class="wb-anomaly-row mono">${esc(c.demo.anomalyRow)}</div>
            </div>
          </div>

          <!-- View 3: Live Prism Optical Palette Switcher -->
          <div class="wb-view wb-optics-view" data-demo-panel="optics">
            <div class="wb-optics-intro">
              <div>
                <h3>${esc(c.demo.opticsTitle)}</h3>
                <p>${esc(c.demo.opticsSub)}</p>
              </div>
              <div class="wb-optics-controls">
                <div class="wb-control-label">${esc(c.demo.gaugeToggleTitle)}</div>
                <div class="wb-seg-group">
                  <button type="button" class="wb-seg-btn" data-set-gauge="ring">${esc(c.demo.contextRingName)}</button>
                  <button type="button" class="wb-seg-btn is-active" data-set-gauge="vial">${esc(c.demo.contextVialName)}</button>
                </div>
              </div>
            </div>
            <div class="palette-grid">
              ${paletteButtonsHtml}
            </div>
            <div class="wb-preset-bar">
              <span class="wb-control-label">${esc(c.demo.presetTitle)}</span>
              <div class="wb-preset-pills">${presetsHtml}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="screenshots">
      <div class="container">
        <div class="section-head">
          <h2>${esc(c.screenshots.heading)}</h2>
          <p>${esc(c.screenshots.subheading)}</p>
        </div>

        <div class="shot-tabs" role="tablist" aria-label="Screenshots">
          ${shotTabsHtml}
        </div>

        <div class="shot-stage">
          <button type="button" class="shot-figure" id="shot-zoom-trigger" aria-label="${esc(c.screenshots.zoomHint)}">
            <img id="shot-main-img" src="${esc(heroShotSrc)}" alt="${esc(c.screenshots.items[0].title)}" />
            <span class="shot-zoom-chip">${esc(c.screenshots.zoomHint)}</span>
          </button>
          <div class="shot-meta">
            <h3 id="shot-main-title">${esc(c.screenshots.items[0].title)}</h3>
            <p id="shot-main-caption">${esc(c.screenshots.items[0].caption)}</p>
          </div>
          <div class="shot-thumbs">
            ${shotThumbsHtml}
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="capabilities">
      <div class="container">
        <div class="section-head">
          <h2>${esc(c.capabilities.heading)}</h2>
          <p>${esc(c.capabilities.subheading)}</p>
        </div>
        <div class="bento-grid">
          ${bentoHtml}
        </div>
      </div>
    </section>

    <section class="section" id="modules">
      <div class="container">
        <div class="section-head">
          <h2>${esc(c.modules.heading)}</h2>
          <p>${esc(c.modules.subheading)}</p>
        </div>
        ${modulesHtml}
        <ul class="module-points">${modulePointsHtml}</ul>
      </div>
    </section>

    <section class="section" id="credits">
      <div class="container">
        <div class="section-head">
          <h2>${esc(c.credits.heading)}</h2>
          <p>${esc(c.credits.subheading)}</p>
        </div>
        <div class="pillars-grid">
          ${pillarsHtml}
        </div>
        <div class="upstreams-wrap">
          <div class="upstreams-head">
            <h3>${esc(c.credits.tableTitle)}</h3>
            <a class="text-link" href="${esc(NOTICE_URL)}" target="_blank" rel="noreferrer">${esc(c.credits.noticeLink)}</a>
          </div>
          <div class="upstreams-grid">
            ${upstreamsHtml}
          </div>
          <p class="community-note">${esc(c.credits.communityNote)}</p>
        </div>
      </div>
    </section>

    <section class="section" id="install">
      <div class="container">
        <div class="section-head">
          <h2>${esc(c.install.heading)}</h2>
          <p>${esc(c.install.subheading)}</p>
        </div>

        <div class="agent-install-card">
          <div class="agent-install-head">
            <span class="agent-badge">${esc(c.install.agentBadge)}</span>
            <h3>${esc(c.install.agentTitle)}</h3>
            <p>${esc(c.install.agentDesc)}</p>
          </div>
          <div class="prompt-box">
            <pre class="prompt-code" id="agent-prompt-text">${esc(c.install.agentPrompt)}</pre>
            <button type="button" class="solid-btn prompt-copy-btn" data-copy-text="${esc(c.install.agentPrompt)}" data-copy-done="${esc(c.install.copiedBtn)}">
              ${esc(c.install.copyBtn)}
            </button>
          </div>
        </div>

        <div class="cli-block">
          <div class="cli-head">
            <h3>${esc(c.install.cliTitle)}</h3>
            <p>${esc(c.install.cliDesc)}</p>
          </div>
          <div class="platforms-grid">
            ${platformsHtml}
          </div>
          <div class="install-links">
            ${installLinksHtml}
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="changelog">
      <div class="container">
        <div class="section-head section-head-row">
          <div>
            <h2>${esc(c.changelog.heading)}</h2>
            <p>${esc(c.changelog.subheading)}</p>
          </div>
          <a class="pill-btn" href="${esc(RELEASES_URL)}" target="_blank" rel="noreferrer">${esc(c.changelog.allReleasesLabel)}</a>
        </div>
        <div class="changelog-list">
          ${changelogHtml}
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="footer-brand">
        <img src="${esc(logoSrc)}" width="22" height="22" alt="${esc(c.brand)} Logo" />
        <span>${esc(c.brand)}</span>
        <span class="sep-bar" aria-hidden="true"></span>
        <a href="${esc(LICENSE_URL)}" target="_blank" rel="noreferrer">${esc(c.footer.license)}</a>
      </div>
      <div class="footer-links">
        ${footerLinksHtml}
      </div>
    </div>
  </footer>

  <div class="lightbox" id="lightbox" hidden aria-modal="true" role="dialog" aria-label="${isZh ? '截图大图预览' : 'Screenshot lightbox'}">
    <button type="button" class="lightbox-close" id="lightbox-close" aria-label="${esc(c.screenshots.closeLabel)}">&times;</button>
    <div class="lightbox-inner">
      <img id="lightbox-img" alt="" />
      <div class="lightbox-caption">
        <strong id="lightbox-title"></strong>
        <p id="lightbox-desc"></p>
      </div>
    </div>
  </div>

  <script type="module" src="${esc(assetPrefix)}app.js"></script>
</body>
</html>
`;
}
