<div align="center">
  <img src="assets/logo.svg" width="72" height="72" alt="Antigravity Max Logo" />
  <h1>Antigravity Max (<code>agy-max</code>)</h1>
  <p><strong>All-in-one flagship native workbench for Antigravity 2.0 — fully adapted for the latest Antigravity (2.35.1+)</strong></p>
  <p>Modular (1 core + 8 modules, install only what you use) / Built-in <code>agy-fast</code> accelerator (toggleable anytime) / Native Side Panel File Tree / Codex-style workflow suite / Drag conversations between projects &amp; nested /btw side chats / Multilingual UI / Context &amp; usage dashboard / Optional: Prism optics, multi-account switcher, no-TUN proxy, single-window SSH projects</p>
  <!-- plugin-badges:start -->
  <p>
    <a href="https://github.com/wangbingnan136/agy-max/releases"><img src="https://img.shields.io/github/v/release/wangbingnan136/agy-max?label=Release&color=4f46e5" height="20" alt="Release" /></a>
    <a href="https://github.com/wangbingnan136/agy-max/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/wangbingnan136/agy-max/ci.yml?label=CI" height="20" alt="CI" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/wangbingnan136/agy-max?label=License&color=16a34a" height="20" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/Antigravity-2.35.1+-0f172a" height="20" alt="Antigravity 2.35.1+" />
    <img src="https://img.shields.io/badge/Node.js-%3E%3D22.13-339933" height="20" alt="Node.js >= 22.13" />
    <img src="https://img.shields.io/badge/Platform-macOS%20(Tested)%20%7C%20Win%20%2F%20Linux%20(Untested)-475569" height="20" alt="Platform" />
  </p>
  <!-- plugin-badges:end -->
  <p>
    <a href="README.md">简体中文</a> |
    <strong>English</strong>
  </p>
  <p>
    <a href="#credits--open-source-origins">Credits &amp; Origins</a> |
    <a href="#screenshots">Screenshots</a> |
    <a href="#features">Features</a> |
    <a href="#installation">Installation</a> |
    <a href="#configuration">Configuration</a> |
    <a href="#changelog">Changelog</a>
  </p>
</div>

<p align="center">
  <img src="docs/images/hero-workspace.png" alt="Antigravity Max workspace" width="100%" />
</p>

> **Vision &amp; Open-Source Credits**: `Antigravity Max` is independently maintained as an all-in-one batteries-included workbench for Antigravity 2.0. Its debugging attachment and telemetry foundation are derived from [WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools) (MIT), its optical themes and workbench UX draw inspiration from [RMvdesi/obsidian-prism](https://github.com/RMvdesi/obsidian-prism), and it ships with [INK-Q/agy-fast](https://github.com/INK-Q/agy-fast) (MIT) enabled out of the box with a one-click toggle to turn it off anytime. See [Credits &amp; Open-Source Origins](#credits--open-source-origins) below.

---

## Credits &amp; Open-Source Origins

`Antigravity Max` builds openly upon great community projects—thank you to their creators and contributors:

| Upstream Repository | Relationship &amp; Scope | License &amp; Notes |
| --- | --- | --- |
| **[WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools)** | **Core foundation**: Local CDP attachment, read-only SQLite/JSONL session telemetry &amp; 53-week dashboard, multilingual base, session branching &amp; inline editing, OS-keyring multi-account switching, no-TUN proxy, and WSL2 bridge | MIT License (installing `agy-max` automatically pauses `agy-powertools` and migrates saved settings &amp; accounts) |
| **[RMvdesi/obsidian-prism](https://github.com/RMvdesi/obsidian-prism)** | **Optical &amp; workbench inspiration**: Light/dark optical palettes, scene presets, liquid vial context indicator, reasoning effort slider, code-block folding, inline step diffs, chat folders, and mascot concepts | Clean-room MIT implementation inspired by public feature specs (see [docs/PRISM_COMPATIBILITY.md](docs/PRISM_COMPATIBILITY.md)) |
| **[INK-Q/agy-fast](https://github.com/INK-Q/agy-fast)** | **Built-in default accelerator**: Bundles `batch_search`, `apply_edits`, `quick_outline`, `read_slices`, `run_checks`, and `SessionStart` workspace snapshots to cut LLM round trips and token usage | MIT License (enabled by default; toggle off anytime in **Antigravity Max -> Settings -> Conversation enhancements**) |

On top of these foundations, `Antigravity Max` adds an **under-card Git &amp; telemetry status strip, millisecond local + SSH full-text session search (`Cmd+Opt+F`), active-sessions bell &amp; sidebar `Priority` view, persistent `/goal` tracker &amp; live editor drawer, full tool-chain Markdown export, external editor `line:col` jump, and SSH command paste parsing**. Thanks also to the [LINUX DO](https://linux.do) community for tooling discussions and open-source ecosystem inspiration.

---

## Screenshots

<table>
  <tr>
    <th width="50%">Under-Card Status Strip &amp; Context Telemetry</th>
    <th width="50%">Overview Task Progress &amp; Quota</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-composer.png" alt="Context window and speed stats" width="100%" />
      <p>Check the Git status pill, context usage ring (or liquid vial), cache reuse, and generation speed in the clean under-card composer strip.</p>
    </td>
    <td>
      <img src="docs/images/card-overview-panel.png" alt="Overview task progress and quota" width="100%" />
      <p>Track live execution steps, per-step durations, and remaining model quotas in the right Overview panel; click headers to collapse.</p>
    </td>
  </tr>
  <tr>
    <th>Usage Overview (Light)</th>
    <th>Usage Overview (Dark)</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-dashboard-light.png" alt="Usage overview in light theme" width="100%" />
      <p>Defaults to the current weekly quota cycle, displaying request counts, tokens, cache hit rate, estimated cost, a 53-week heatmap, and model health.</p>
    </td>
    <td>
      <img src="docs/images/card-dashboard-dark.png" alt="Usage overview in dark theme" width="100%" />
      <p>Follows light and dark themes, comparing token share, cost share, cache hit rate, and generation speed across models.</p>
    </td>
  </tr>
  <tr>
    <th>Requests &amp; Cache Anomalies</th>
    <th>Multi-Account &amp; Quota Manager (Optional module)</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-requests.png" alt="Request events and cache anomalies" width="100%" />
      <p>Filter requests by account, model, conversation, and status, and flag short-interval cache drops while ignoring cold starts and compactions.</p>
    </td>
    <td>
      <img src="docs/images/card-accounts.png" alt="Multi-account switching and quota management" width="100%" />
      <p>With the Multi-Account Switcher module installed, store and switch multiple Google accounts locally via OS native keyrings, with 5-hour and weekly quota views in one place.</p>
    </td>
  </tr>
  <tr>
    <th>Multilingual &amp; Optics Settings</th>
    <th>No-TUN Proxy (Optional module)</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-settings.png" alt="Language and display settings" width="100%" />
      <p>Switch display languages live and filter settings by category; with the Interface &amp; Optics module installed, add scene presets, optical palettes, and user bubble tints.</p>
    </td>
    <td>
      <img src="docs/images/card-proxy.png" alt="No-TUN application proxy settings" width="100%" />
      <p>With the Standalone Proxy module installed, route only Antigravity through HTTP or SOCKS5 with built-in connectivity checks and Force HTTP/1.1.</p>
    </td>
  </tr>
</table>

---

## Features

Four everyday modules are installed by default and work out of the box; the other four optional modules can be installed or removed anytime from **Antigravity Max -> Modules**. Modules you skip are never loaded, use no memory, and add no settings.

### Core

- **Modular (1 core + 8 modules)**: All modules share one lightweight core and a single debugging connection. Installs download from the GitHub release with SHA-256 verification and fall back to the offline copy bundled in the package; uninstalling either keeps a module's settings (restored when you reinstall) or purges them, and purging also deletes that module's saved account credentials and SSH passwords from the OS keychain. Upgrading from v1.4.x keeps the optional modules you were using. Developers can drop a standalone package into `~/.gemini/config/plugins/agy-<module>` to mount it first in Dev-Local mode.
- **Fully adapted for the latest Antigravity (`2.35.1+`)**: Seamlessly aligned with the newest client sidebar pinning internals, router transition lifecycle, and native `sidePanelV2` architecture with zero cold-start white-screen issues; includes Windows + WSL2 (NAT / Mirrored) compatibility support.
- **Built-in `agy-fast` accelerator (on by default, toggleable anytime)**: Automatically deploys and enables bundled `agy-fast` (batched search, symbol outlines, atomic multi-file edits, concurrent checks, and startup snapshots) with zero extra setup; turn it off anytime in `Settings -> Conversation enhancements -> Built-in agy-fast accelerator` while preserving any custom `*.local.md` rules.
- **One-click in-app updates**: Check for updates, read the release notes, and auto-update from `Settings -> Updates`; packages are SHA-256 verified and roll back automatically if startup fails.

### Default modules

- **Telemetry & Quota: context, speed, and local usage dashboard**: Live context ring (cache reuse, compaction count, Orchestrator per-model bars) and speed dial (decode-phase `tok/s`, TTFT, model/tool time, estimated session cost) below the composer; open the full dashboard from the right Side Panel under **Plugins -> Antigravity Max** for a 53-week heatmap, per-request log, cache anomaly alerts, error copy, and quota estimates.
- **Chat Flow: branch, edit, move, and nest**: Fork full-history sessions (including subagent chats), revise sent messages in place, drag a conversation onto another sidebar project (or out of one), keep `/btw` side questions folded under their main conversation or detach them, and copy full transcripts (or up to any turn) as complete Markdown including tool arguments, outputs, and restored truncated responses across local and SSH sessions; plus the persistent `/goal` bar and editor drawer, `[Image #N]` inline image chips, reasoning effort slider with per-model memory, long code-block folding, inline step Git diffs, hover turn outline, chat folders (Beta), pragmatic coding mode, and `/code-review`.
- **Workspace & Navigation: Codex-style workflow suite**: Millisecond full-text search across local and SSH transcripts (`Cmd+Opt+F` / `Ctrl+Alt+F` jumping straight to matched turns with one-click code/command copy), an active-sessions bell next to the titlebar conversation picker with a persisted sidebar `Priority` running/unread list, one-click archived chats manager, project pinning, and a non-locking composer Git status &amp; read-only Unified Diff pill (`+X / -Y`).
- **Workspace & Navigation: native Side Panel File Tree and external editor jump**: Integrates a **File Tree** entry and persistent tab right inside Antigravity's native right Side Panel (filter project files, preview code / images / `.ipynb` notebooks, edit text files in place and save with `Cmd+S`, or pick and mount recent folders when no workspace is linked); right-click file links or File Tree rows to attach to chat, jump to exact `line:col` anchors in `Cursor` / `VS Code` / `Windsurf` / `Zed` / `Kiro` (falling back to the system text editor when none is installed), reveal in folder, or copy paths (including Windows LAN NAS / SMB shares).
- **Localization & Marketplace i18n**: Localizes panels, common menus, permission dialogs, model descriptions, settings, and Swarm iframes in five languages, and translates English marketplace descriptions with a local cache, while leaving chat messages and code blocks untouched.

### Optional modules (not installed by default)

- **Interface & Optics: Prism optics**: Four light/dark optical palettes, one-click scene presets (`Native` / `Ultra` / `Focus` / `Eco`), accent and corner styles, code fonts, liquid vial context indicator, stream ink and conversation aura, smooth caret, pixel mascots, and user bubble tints (see [docs/PRISM_COMPATIBILITY.md](docs/PRISM_COMPATIBILITY.md)).
- **Multi-Account Switcher**: OS keyring isolation of multiple Google accounts across Windows, macOS, Linux, and WSL2, with a sidebar quick switcher, ownership checks, and optional auto-switch on depletion.
- **Standalone Proxy (No-TUN)**: Per-app HTTP/SOCKS5 proxy injection without a global TUN, with connectivity testing and optional `GODEBUG=http2client=0` to ease idle disconnects.
- **SSH Projects: single-window remote projects**: Add an SSH server under Create Project -> Remote -> `+ Add Resource`; remote projects sit next to local ones in the same window and the local AI works on the server directly (read/edit/search, remote terminal, detached long-running jobs, remote File Tree and Git diffs, cross-machine transfers). Paste `ssh -p 2222 user@host` to auto-fill `user@host:2222` (appended passwords are discarded), and a remote execution boundary hook keeps the AI from running commands on your local machine by mistake.

---

## Installation

> Requirements &amp; platform support: Fully adapted for the latest Antigravity (`2.35.1+`, installed and started at least once). **Because I use macOS as my daily driver, this project is developed and tested primarily on macOS; compatibility scripts and code for Windows, Linux, and WSL2 are included in the repository but have not been strictly tested yet, so they should hopefully work too (issues and PRs are welcome).** Uses local Node.js `>= 22.13` or falls back to Antigravity's bundled `agy-node`. No `npm install` or admin privileges needed. Existing `agy-powertools` setups are migrated seamlessly, and pre-existing standalone `agy-fast` setups are preserved safely.

### Option 1: One-line prompt for your Agent (recommended)

Click the copy button on the right and paste this directly into Antigravity (or Claude Code / Codex):

```text
Please install Antigravity Max from https://github.com/wangbingnan136/agy-max : read docs/INSTALL_AGENT.md first, run the unified installer without closing my active window, keep my existing chats and settings intact, and verify the installed version when done.
```

See [Agent installation guide](docs/INSTALL_AGENT.md) for details.

### Option 2: Command line

Download and extract the latest ZIP from [Releases](https://github.com/wangbingnan136/agy-max/releases) (or clone this repository), then run:

```sh
# macOS (tested) / Linux / WSL2 (not strictly tested)
sh ./install.sh
```

```powershell
# Windows PowerShell (not strictly tested)
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Restart Antigravity once you finish your current task, open the right Side Panel, and pick **Antigravity Max** under **Plugins**. A fresh install starts with the 4 everyday modules; install Interface & Optics, Multi-Account, Proxy, and SSH Projects from the **Modules** tab when you need them. On macOS, `~/Applications/Antigravity (Max).app` is generated with the native icon so you can drag it into your Dock.

### Updates and uninstall

- **In-app updates**: Go to **Antigravity Max -> Settings -> Updates** and click **Check for updates** or **Auto update**. Packages are SHA-256 verified and roll back automatically if startup fails.
- **Upgrading from v1.4.1 or earlier**: The package layout changed in v1.4.2, so older in-app updaters show "Go to download page". Reinstall once as described above (settings, accounts, and SSH projects are kept, and optional modules you used are reinstalled automatically); in-app updates work again afterwards.
- **Installing or removing modules**: Open **Antigravity Max -> Modules** and install or uninstall a module. Uninstalling keeps its settings by default; ticking "Also delete" removes the module's local settings and its credentials in the OS keychain, which cannot be undone.
- **Uninstall**: Run `sh ./uninstall.sh` (macOS / Linux / WSL2) or `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1` (Windows). Append `--keep-settings` to keep your preferences.

---

## Configuration

Every setting applies live in **Antigravity Max -> Settings** and saves automatically, including category filters, scene presets, the **Built-in `agy-fast` accelerator** switch, sanitized JSON export/import, and **Restore defaults**. Settings only show options for installed modules; if a feature is missing, install its module from the **Modules** tab first.

<details>
<summary><strong>Expand environment variables and paths</strong></summary>

| Name / Path | Description |
| --- | --- |
| `ANTIGRAVITY_USER_DATA_DIR` | Custom Antigravity user-data directory for isolated profiles |
| `ANTIGRAVITY_CDP_PORT_FILE` | Explicit path to `DevToolsActivePort` (also honors `AGY_BROWSER_ACTIVE_PORT_FILE`) |
| `~/.gemini/config/plugins/agy-max/` | Installed workbench plugin files and bundled assets |
| `~/.gemini/config/plugins/agy-fast/` | Managed `agy-fast` accelerator plugin directory (removed automatically when toggled off) |
| `~/.gemini/antigravity/plugin_data/agy-max/` | Saved settings, goals, account metadata, quota samples, and pricing cache |
| `~/.gemini/antigravity/plugin_data/agy-max/modules/` | Installed module files; the install list is the sibling `modules-manifest.json` |
| `~/.gemini/antigravity/plugin_data/agy-max/module_data/` | Settings snapshots kept when a module is uninstalled, restored on reinstall |
| `~/.gemini/config/plugins/agy-<module>/` | Dev-Local mode: a standalone module package here mounts ahead of the installed copy |

</details>

---

## Changelog

### v1.4.2
- **Modular by design (1 core + 8 modules)**: Features are split into 8 hot-pluggable modules. Four ship by default (Telemetry & Quota, Chat Flow, Workspace & Navigation, Localization); Interface & Optics, Multi-Account Switcher, Standalone Proxy and SSH Projects are now installed on demand from **Antigravity Max -> Modules**. Downloads are SHA-256 verified and fall back to a bundled offline copy; uninstalling can keep or fully delete a module's settings and credentials (including saved accounts and SSH passwords in the OS keychain). Upgrading from v1.4.x keeps the optional modules you were using.
- **Drag conversations between projects and nested /btw side chats**: Drag a conversation onto another project (or out of one); /btw side questions sit under their main conversation, can be folded, and can be detached into a main conversation.
- **Cleaner effort popover**: The native model list no longer flashes when opening the model menu or sliding the effort level.
- **The "All" settings tab is now "Updates"**: Check for updates, auto-update in one click, and read the release notes there.
- **More accurate, steadier stats**: Speed now counts decode-phase tok/s only; a locked database or a failed scan no longer zeroes or rolls back usage; the full dashboard moved to the right-sidebar Plugins page; pasting inline images no longer hangs.
- **Sturdier, safer SSH**: Output printed by remote login scripts no longer leaks into file reads and command results; the remote execution boundary blocks the call when the hook fails, the project marker is corrupt, or the working directory is unknown; hooks never run a same-named script from the current directory; new end-to-end tests run against a real sshd.
- **Large secrets saved in full to the macOS Keychain**: Account credentials over about 2 KB used to be truncated and are now stored completely.
- **Translations and upstream sync**: Translated new Antigravity 2.35.x UI strings; bundled `agy-fast` bumped to `v0.3.2`.
- **Upgrading from v1.4.1 or earlier needs one manual reinstall**: The package layout changed, so older in-app updaters show "Go to download page". Reinstall once with the install command above or the ZIP from the release (settings, accounts and SSH projects are kept); in-app updates work again from then on. Fully quit Antigravity (`⌘Q` on macOS) and reopen it after upgrading.

### v1.4.1
- **More reliable SSH connections**: When the SSH handshake is dropped (`kex_exchange_identification`, `Connection closed/reset by ... port N`), the remote command is retried once. The command had not started yet, so it can never run twice. A handshake that keeps failing is now reported as a transient network or gateway problem instead of a wrong key, and authentication failures are not retried.
- **File transfer on servers without sftp**: When `scp` fails because the server's sshd has no sftp subsystem, the file is sent again over the legacy scp protocol (`scp -O`).
- **Dedicated key per server for one-click passwordless login**: Generates `~/.ssh/agy-<host>_ed25519` and points the host at it instead of reusing the default `id_ed25519`. Hosts with a key file use `IdentitiesOnly=yes`, so a crowded ssh-agent can no longer use up the server's allowed authentication attempts.
- **Image context menu fixed**: `[Image #N]` image chips swallowed every mouse button, so right-clicking only showed the hover preview. Chips now only capture the left button, and right-clicking the chip label also opens the image menu (Copy image, etc.).
- **Local wallpaper removed**: It was barely visible in the real client, and the see-through shell styles squeezed the chat into a narrow column, so it is gone entirely: the "Local Wallpaper (Beta)" settings card, the wallpaper layer and see-through shell styles, and the `wallpaperEnabled / Opacity / Blur / Dim` settings. Leftover wallpaper keys in existing settings files are ignored on load.
- **Upgrade note**: This release changes the scripts injected into the client. After upgrading, fully quit Antigravity (`⌘Q` on macOS) and reopen it; reloading the page is not enough.

### v1.4.0
- **Single-Window SSH Remote Projects (Local Brain + Remote Execution)**: Added an `SSH Server` option inside `Create Project -> Remote -> + Add Resource` and cloud-terminal sidebar icons with live status indicators, letting local and Linux remote projects coexist inside one window without remote re-authentication (coexisting peacefully with native OpenSSH). Includes `~/.ssh/config` discovery, one-line `ssh -p ...` command parsing, OS keychain password vault, one-click public key installation, remote directory browser, host rebinding with full chat history preservation, safe unlinking without touching remote files, built-in `agy-ssh-projects` MCP server (remote read/edit/search, remote image & `.ipynb` viewing, detached long-running background jobs, explicit cross-machine transfers), remote execution boundary & per-project Skill/Plugin capability scope hooks, plus remote Side Panel File Tree, remote Git status/diff, transfer modal, and built-in interactive `SSH Terminal`.
- **Inline Image Mention Chips & Lightbox**: Reference uploaded images inline as `[Image #N]` chips in both composer and message bubbles with hover thumbnails and full-screen lightbox navigation, automatically syncing attachment order, pruning removed chips, and injecting cross-turn image mappings for the model.
- **Expand/Collapse Toggle for Long User Messages**: Displays a clean `Show more / Show less` toggle underneath clamped user message bubbles so long prompts can be read in full without affecting agent responses.
- **Dynamic Marketplace Catalog Translation**: Added a dynamic translation toggle for the Antigravity plugin marketplace and detail views with local caching and live language switching.
- **Windows 11 Compatibility & Security Hardening**: Hardened Windows 11 Credential Manager error handling, SSH backslash path parsing, proxy-bypassing loopback CDP WebSockets, IPv6 `NO_PROXY`, staging rename retries, and relaunch proxy preservation, backed by a Windows Node 24 CI matrix, PowerShell installer smoke tests, and automated repository security workflows (`security:check`, Scorecard).
- **Bilingual Showcase Website & Upstream Sync**: Added a bilingual showcase site with GitHub Pages deployment, and synced `agy-powertools`, `agy-fast 0.3.1`, and Prism wallpaper, optics, effort slider, and sidebar menu fixes.

### v1.3.0
- **Edit code and text files in the File Tree**: Click the pencil in the File Tree preview to edit UTF-8 text files such as `md` / `py` / `js` / `ts` in place and save with `Cmd+S` / `Ctrl+S`. Saves compare the file's modification time first and ask before overwriting changes made by the agent or other programs, replace the file atomically, and keep CRLF line endings; files over 192 KB or not encoded as UTF-8 stay read-only.
- **`Kiro` and a system text editor fallback for external editors**: `Preferred external editor` now offers `Kiro` and `System text editor` (the macOS default text editor, Windows Notepad, or a common Linux desktop editor / `xdg-open`). Auto-detect falls back to the built-in editor when no IDE is installed, and folders open in the system file manager.
- **Floating `/goal` pill with pause and resume**: Redesigned the floating goal pill and inline acceptance checklist, auto-pause goals when the user stops or the stream ends abnormally, and dispatch a continuation turn automatically on Resume.
- **Side panel and plugin page fixes**: The File Tree side panel now works in brand-new chats, and `plugin://` sidecar page hosts are accepted.

### v1.2.0
- **Full compatibility with the latest Antigravity (`2.35.1+`) and cold-start hardening**: Adapted sidebar project pinning to hook-free storage reads (eliminating React `#311` errors), deferred custom route injection during initial router transitions with automatic idle recovery, and skipped nested `Antigravity Helper.app` bundles on macOS.
- **Native Side Panel File Tree (`auxFileTree`)**: Integrated a dedicated File Tree entry and tab directly into Antigravity's native right Side Panel (`sidePanelV2`) with file filtering, code / image / `.ipynb` previews, and one-click folder picking or recent-project mounting for unlinked chats.
- **Persisted Priority time window and archived chats manager**: Added selectable time windows and disk persistence for sidebar `Priority` sessions, plus a Codex-style archived conversations manager with batch restore and deletion.
- **Immediate post-compaction context projection and security/performance hardening**: Projected post-`/compact` token usage immediately, added incremental SQLite caching for >12 session DBs, and hardened loopback proxy bypass, IPC envelope isolation, Git symlink checks, and multi-account backup guards.

### v1.1.0
- **Built-in `agy-fast` accelerator (on by default, toggleable anytime)**: Bundled [INK-Q/agy-fast](https://github.com/INK-Q/agy-fast) (`v0.3.1`) out of the box and added a `Built-in agy-fast accelerator` toggle under `Settings -> Conversation enhancements` to turn it off or back on anytime while preserving custom `*.local.md` rules and standalone installs.
- **Prominent open-source credits**: Added dedicated attribution tables and callouts across `README.md`, `README_EN.md`, [lib/vendor/NOTICE.txt](lib/vendor/NOTICE.txt), and `Settings -> About` crediting [WhiteBr1ck/agy-powertools](https://github.com/WhiteBr1ck/agy-powertools), [RMvdesi/obsidian-prism](https://github.com/RMvdesi/obsidian-prism), and [INK-Q/agy-fast](https://github.com/INK-Q/agy-fast).

### v1.0.0
- **Initial standalone release (`Antigravity Max` / `agy-max`)**: All-in-one workbench edition with automatic takeover and seamless migration of settings, goals, and OS-keyring multi-account records from `agy-powertools`, under-card Git/telemetry strip, Codex workflow suite, and Prism optical workbench.

---

## License &amp; Links

- **License**: [MIT License](LICENSE) (third-party notices in [lib/vendor/NOTICE.txt](lib/vendor/NOTICE.txt))
- **Community**: [LINUX DO](https://linux.do)
- **Issues**: [GitHub Issues](https://github.com/wangbingnan136/agy-max/issues) (please include OS, Antigravity version, and plugin version)
