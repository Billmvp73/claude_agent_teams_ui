# Technology Stack

**Analysis Date:** 2026-04-28

## Languages

**Primary:**
- TypeScript 5.x (`^5.9.3`) - All source code under `src/`, test code under `test/`
- TSX (TypeScript JSX) - React component files under `src/renderer/`

**Secondary:**
- JavaScript (ESM `.mjs`) - Build/dev scripts under `scripts/`
- CSS - Tailwind utility classes; no plain CSS authoring

## Runtime

**Environment:**
- Node.js 20+ required (README specifies 20+; all `engines.node` fields use `">=20"`)
- Current dev machine running Node.js v25.9.0 (also works)
- No `.nvmrc` or `.node-version` file — use any Node.js 20+ version

**TypeScript target:** ES2023 (`tsconfig.json` → `target: "ES2023"`)

**Package Manager:**
- pnpm 10.33.0 (pinned in `package.json` → `packageManager` field)
- Lockfile: `pnpm-lock.yaml` (present, committed)
- Do NOT use npm or yarn — workspace structure relies on pnpm

## Frameworks

**Core:**
- Electron `^40.3.0` - Desktop application shell; main/renderer/preload process model
- React `^19.0.0` + React DOM `^19.0.0` - Renderer UI

**Build/Dev:**
- electron-vite `^5.0.0` - Unified dev server and build tool for all three Electron processes
- Vite `^5.4.2` - Underlying bundler (used directly for standalone/web builds)
- tsx `^4.21.0` - Run TypeScript scripts directly (used in `scripts/`, `test/` manual tests)
- electron-builder `^26.8.1` - Cross-platform distribution packaging

**Testing:**
- Vitest `^3.1.4` - Test runner (config: `vitest.config.ts`, `vitest.critical.config.ts`)
- happy-dom `^20.0.2` - DOM environment for renderer unit tests
- `@vitest/coverage-v8` `^3.1.4` - Coverage reports

**Styling:**
- Tailwind CSS `^3.4.1` - Utility-first styling (config: `tailwind.config.js`)
- PostCSS `^8.4.35` (config: `postcss.config.cjs`)
- `@tailwindcss/typography` `^0.5.19` - Prose styling plugin
- tailwind-merge `^3.5.0`, tailwindcss-animate `^1.0.7`

## Key Dependencies

**UI Components:**
- Radix UI (12 primitives: alert-dialog, checkbox, collapsible, context-menu, dialog, hover-card, label, popover, select, slot, tabs, tooltip) - Headless accessible components
- `@dnd-kit/core` `^6.3.1` - Drag-and-drop (kanban board)
- `@tanstack/react-virtual` `^3.10.8` - Virtual scrolling for large lists
- Lucide React `^0.577.0` - Icon library
- Framer Motion (`motion`) `12.38.0` - Animations

**Code Editor (built-in):**
- CodeMirror 6 (`@codemirror/*`) - Full language support for 15+ languages, merge/diff view
- `@tiptap/react` `^3.20.4` - Rich-text editor for messages/task input

**Terminal:**
- `@xterm/xterm` `^6.0.0` + addons (fit, web-links) - Terminal emulator in renderer
- `node-pty` `^1.1.0` - Native pseudo-terminal (requires Electron rebuild — see M4 notes below)

**State Management:**
- Zustand `^4.5.0` - All client-side state

**HTTP Server (sidecar):**
- Fastify `^5.7.4` + `@fastify/cors` + `@fastify/static` - Internal HTTP API for standalone mode and controller access

**File/Process:**
- chokidar `^4.0.3` - File watching (session/task JSONL files)
- simple-git `^3.32.3` - Git operations from within the app
- pidusage `4.0.1` - Process CPU/memory stats

**Native addons (require rebuild):**
- `node-pty` `^1.1.0` - PTY (pseudo-terminal)
- `ssh2` `^1.17.0` - SSH connections (optional native accelerator: `cpu-features`)
- `cpu-features` - Optional SSH performance aid

**Workspace packages:**
- `agent-teams-controller` (workspace) - Controller package at `agent-teams-controller/`
- `agent-teams-mcp` (`mcp-server/`) - MCP server package
- `@claude-teams/agent-graph` (`packages/agent-graph/`) - Force-directed agent graph visualization
- `@claude-teams/agent-graph` peer-depends on React 18/19 and Lucide React

## Build Toolchain

**Dev server (`pnpm dev`):**
- Runs `scripts/dev-with-runtime.mjs` which:
  1. Downloads/caches the teams orchestrator runtime binary (`~/.agent-teams/runtime-cache/`)
  2. Spawns `electron-vite dev` for the Electron app with hot reload
- Environment variable `CLAUDE_DEV_RUNTIME_ROOT` can point to a local orchestrator build
- Environment variable `CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH` overrides the runtime binary path

**Production build:**
```bash
pnpm prebuild   # Fetches pricing data, builds controller + mcp-server sub-packages
pnpm build      # electron-vite build (max-old-space-size=8192 for large bundles)
```

**Output directories:**
- `dist-electron/main/` - Main process CJS bundles (4 entry points: index, team-fs-worker, task-change-worker, team-data-worker)
- `dist-electron/preload/` - Preload script
- `out/renderer/` - Renderer HTML/JS/CSS

**Bundler configuration (`electron.vite.config.ts`):**
- Main process: CJS format, `format: 'cjs'`, `.cjs` extensions
- UV_THREADPOOL_SIZE=24 injected via banner (prevents thread pool exhaustion)
- `node-pty`, `fastify`, `agent-teams-controller` kept external (not bundled)
- Native `.node` addons stubbed via `nativeModuleStub()` plugin
- Sentry source map upload active only when `SENTRY_AUTH_TOKEN` env var is set

**Path aliases (all processes):**
- `@main/*` → `src/main/*`
- `@renderer/*` → `src/renderer/*`
- `@shared/*` → `src/shared/*`
- `@preload/*` → `src/preload/*`
- `@features/*` → `src/features/*`
- `@claude-teams/agent-graph` → `packages/agent-graph/src/index.ts`

## How to Install and Run Locally (M4 MacBook Pro)

### Prerequisites

1. **Node.js 20+** — install via `nvm`, `fnm`, or Homebrew:
   ```bash
   brew install node   # or: nvm install 20 && nvm use 20
   ```
2. **pnpm 10.33.0** — install via Corepack:
   ```bash
   corepack enable
   corepack prepare pnpm@10.33.0 --activate
   ```
3. **Xcode Command Line Tools** (required for native module compilation):
   ```bash
   xcode-select --install
   ```

### Install

```bash
git clone https://github.com/777genius/claude_agent_teams_ui.git
cd claude_agent_teams_ui
pnpm install
```

The `postinstall` hook runs automatically:
```
electron-rebuild -f -o node-pty,ssh2,cpu-features
```
This recompiles `node-pty`, `ssh2`, and `cpu-features` against the bundled Electron headers for arm64. If it fails, a warning is printed but the install continues — terminal and SSH features may be degraded.

### Start Development Server

```bash
pnpm dev
```

On first run, the script downloads the teams orchestrator runtime binary for `darwin-arm64` from GitHub releases into `~/.agent-teams/runtime-cache/`.

### Quality Gate Commands

```bash
pnpm typecheck 2>&1 | tail -20   # TypeScript type checking
pnpm test                         # Run all Vitest tests
pnpm build 2>&1 | tail -20        # Production build
pnpm check                        # Full gate: types + lint + test + build
```

### Distribution Build for M4

```bash
pnpm dist:mac:arm64   # Produces release/Claude.Agent.Teams.UI-{version}-arm64-mac.dmg
```

## M4 / Apple Silicon Specific Considerations

### Native Module Rebuild (Critical)
`node-pty` is a native Node.js addon (C++ PTY implementation). It **must** be rebuilt for the exact Electron version and arm64 architecture after `pnpm install`. The `postinstall` script does this automatically via `@electron/rebuild`. If you see `Error: The module ... was compiled against a different Node.js version`, run:
```bash
./node_modules/.bin/electron-rebuild -f -o node-pty,ssh2,cpu-features
```

### `cpu-features` (ssh2 acceleration)
`cpu-features` is an optional native addon used by `ssh2` for SIMD acceleration. It is arm64-aware and compiles cleanly on M4. If compilation fails, `ssh2` falls back to pure JS — no functionality loss.

### Rosetta 2 Not Required
All dependencies support arm64 natively. Do not install Node.js via an x64 Homebrew prefix or x64 nvm — this causes architecture mismatch between native addon binaries and the Electron process.

### Electron arm64 Binary
Electron `^40.3.0` ships separate arm64 and x64 binaries. pnpm installs the correct `darwin-arm64` variant automatically based on `process.arch`. The distribution command `pnpm dist:mac:arm64` explicitly targets arm64.

### UV Thread Pool
The build injects `UV_THREADPOOL_SIZE=24` as a banner in the main process bundle (`electron.vite.config.ts`). This prevents libuv thread pool starvation from `fs.watch` watchers on macOS — no manual configuration needed.

### Xcode Version
Electron 40 requires a reasonably recent Xcode. Xcode 15+ (available on macOS Sonoma) and Xcode 16 (macOS Sequoia) both work. M4 MacBooks ship with macOS 15 Sequoia.

### Runtime Binary (darwin-arm64)
The teams orchestrator runtime (`runtime.lock.json` version `0.0.12`) ships a dedicated `darwin-arm64` binary (`claude-multimodel`), downloaded automatically by `scripts/dev-with-runtime.mjs` to `~/.agent-teams/runtime-cache/`.

## Configuration

**Environment (optional overrides):**
- `CLAUDE_DEV_RUNTIME_ROOT` - Path to local orchestrator repo root (dev only)
- `CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH` - Direct path to runtime binary
- `CLAUDE_DEV_RUNTIME_CACHE_ROOT` - Override runtime cache directory (default `~/.agent-teams/runtime-cache/`)
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_DSN` - CI-only Sentry integration
- `CLAUDE_ROOT` - Override `~/.claude` path (standalone mode only)

**No `.env` file required for local development.** The dev server starts cleanly without any environment variables set.

**Key config files:**
- `electron.vite.config.ts` - Unified Electron build config (main + preload + renderer)
- `tsconfig.json` - Root TypeScript config
- `tsconfig.node.json` - Node-only scripts config
- `vitest.config.ts` - Test runner config
- `tailwind.config.js` - Tailwind configuration
- `eslint.config.js` - Flat ESLint config (ESLint 9)
- `pnpm-workspace.yaml` - Workspace packages declaration

## Platform Requirements

**Development (M4 MacBook):**
- macOS 12.0+ (Sequoia fully supported)
- Node.js 20+
- pnpm 10.33.0
- Xcode Command Line Tools (for native addon compilation)
- ~8 GB RAM recommended for `pnpm build` (max-old-space-size=8192)

**Production / Distribution:**
- Electron 40, minimum macOS 12.0 (`minimumSystemVersion: "12.0"`)
- Hardened Runtime enabled, notarization required for distribution builds
- arm64 artifact name pattern: `Claude.Agent.Teams.UI-{version}-arm64-mac.dmg`

---

*Stack analysis: 2026-04-28*
