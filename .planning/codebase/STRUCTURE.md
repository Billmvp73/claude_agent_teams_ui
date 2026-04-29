# Codebase Structure

**Analysis Date:** 2026-04-28

## Directory Layout

```
claude_agent_teams_ui/
├── src/                        # All application source code
│   ├── main/                   # Electron main process
│   ├── renderer/               # Electron renderer process (React app)
│   ├── preload/                # Electron preload bridge
│   ├── shared/                 # Cross-process types, constants, utils
│   └── features/               # Cross-process feature slices (canonical standard)
├── packages/
│   └── agent-graph/            # Standalone agent visualization canvas package
├── mcp-server/                 # Built-in MCP server for external tool integration
├── agent-teams-controller/     # Claude Code agent teams controller module
├── docs/                       # Architecture docs, research notes
├── resources/                  # Electron build resources (icons, etc.)
├── public/                     # Static renderer assets
├── scripts/                    # Build and utility scripts
├── test/                       # Top-level integration/e2e tests
├── .planning/                  # GSD planning documents
│   └── codebase/               # Codebase map documents (this directory)
├── electron.vite.config.ts     # Electron Vite build config
├── vite.web.config.ts          # Web-only build config
├── tsconfig.json               # TypeScript config with path aliases
├── vitest.config.ts            # Test runner config
├── pnpm-workspace.yaml         # Workspace membership (canonical)
└── package.json                # Root package manifest
```

## Directory Purposes

**`src/main/`:**
- Purpose: All code that runs in the Electron main process (Node.js context)
- Contains: App bootstrap, IPC handler registration, services, Worker Thread clients
- Key files: `src/main/index.ts` (entry), `src/main/standalone.ts` (non-Electron mode)
- Subdirectories:
  - `ipc/` — one file per IPC domain (teams, sessions, review, editor, ssh, etc.)
  - `services/` — business logic organized by domain with barrel `index.ts`
  - `services/analysis/` — JSONL chunk building (`ChunkBuilder`, `SemanticStepExtractor`)
  - `services/discovery/` — project scanning (`ProjectScanner`, `SessionSearcher`, `SubagentLocator`)
  - `services/parsing/` — JSONL parsing (`SessionParser`, `ClaudeMdReader`, `MessageClassifier`)
  - `services/team/` — team orchestration, task CRUD, inbox, review, runtime adapters
  - `services/team/runtime/` — Claude CLI spawning (`TeamRuntimeAdapter`, `OpenCodeTeamRuntimeAdapter`)
  - `services/team/taskLogs/` — task log stream, exact log access
  - `services/runtime/` — provider connection, model availability, auto-update policy
  - `services/schedule/` — cron-based scheduled task execution
  - `services/extensions/` — MCP registry, plugin catalog, skills, API keys
  - `services/infrastructure/` — Codex app server, SSH tunnel
  - `workers/` — Worker Thread implementations: `task-change-worker.ts`, `team-data-worker.ts`, `team-fs-worker.ts`
  - `http/` — Embedded HTTP server routes (sessions, projects, teams, search, etc.)
  - `types/` — Main-process-only TypeScript types (messages, etc.)
  - `utils/` — Main-process utilities (path decoding, process management, shell env)

**`src/renderer/`:**
- Purpose: All code that runs in the Electron renderer process (browser context)
- Contains: React components, Zustand store, hooks, utils, renderer-only types
- Key files: `src/renderer/main.tsx` (React entry), `src/renderer/App.tsx` (root component)
- Subdirectories:
  - `store/` — Zustand store with `index.ts` (composed store + event listeners) and `slices/` (20+ domain slices)
  - `store/slices/` — one file per slice: `teamSlice`, `sessionSlice`, `projectSlice`, `changeReviewSlice`, `editorSlice`, etc.
  - `components/` — React components organized by domain
  - `components/team/` — team views: kanban, messages, review, members, tasks, taskLogs, editor, sidebar
  - `components/chat/` — session viewer: chat items, context panel, viewers
  - `components/layout/` — split-pane tabbed layout (`TabbedLayout`)
  - `components/dashboard/` — dashboard/home view
  - `components/extensions/` — MCP, plugins, skills, API keys UI
  - `components/settings/` — settings panels and notification trigger settings
  - `components/common/` — shared UI primitives and dialogs
  - `components/ui/` — shadcn/radix UI primitives, TipTap editor
  - `hooks/` — shared React hooks (theme, navigation, etc.)
  - `utils/` — renderer utilities (contextTracker, sessionAnalyzer, taskReferenceUtils, etc.)
  - `types/` — renderer-only TypeScript types (data, tabs, panes, contextInjection, etc.)
  - `api/` — `api.ts` adapter that wraps `window.electronAPI` for use in renderer code
  - `contexts/` — React Context providers (minimal usage)
  - `features/` — **Legacy**: renderer-only slices; do not add new features here
  - `services/` — renderer-side services (layout system, comment read state)

**`src/preload/`:**
- Purpose: Electron preload script — bridge between renderer and main
- Key files:
  - `src/preload/index.ts` — builds and exposes the full `ElectronAPI` object
  - `src/preload/constants/ipcChannels.ts` — all IPC channel string constants

**`src/shared/`:**
- Purpose: Pure, process-agnostic types, constants, and utilities
- Contains: No Electron, React, or Node.js-specific imports
- Key files:
  - `src/shared/types/` — `index.ts` (main shared types), `extensions/`, `editor.ts`, `terminal.ts`, etc.
  - `src/shared/constants/` — `agentBlocks.ts`, `memberColors.ts`, `kanban.ts`, `teamLimits.ts`, etc.
  - `src/shared/utils/` — `logger.ts`, `tokenFormatting.ts`, `toolSummary.ts`, `reviewState.ts`, etc.

**`src/features/`:**
- Purpose: Cross-process feature slices following the canonical hexagonal architecture standard
- Reference implementation: `src/features/recent-projects/`
- All current features:
  - `recent-projects/` — project list with multi-source (local + Codex) merge logic
  - `tmux-installer/` — tmux detection and installation flow
  - `runtime-provider-management/` — provider (Claude, OpenCode, Gemini, etc.) configuration UI
  - `codex-account/` — Codex cloud account integration
  - `codex-model-catalog/` — model catalog from Codex backend
  - `codex-runtime-profile/` — Codex runtime profile selection
  - `anthropic-runtime-profile/` — Anthropic runtime profile selection
  - `team-runtime-lanes/` — mixed Claude Code + OpenCode team lane logic
  - `agent-graph/` — renderer-only agent graph visualization (uses `packages/agent-graph`)

**`packages/agent-graph/`:**
- Purpose: Standalone canvas-based agent graph visualization package
- Structure: `src/canvas/`, `src/hooks/`, `src/layout/`, `src/ports/`, `src/strategies/`, `src/ui/`, `src/constants/`
- Imported as: `@claude-teams/agent-graph`

**`mcp-server/`:**
- Purpose: Standalone MCP server for external tool/agent plugin integration
- Generated: No (source code)
- Committed: Yes

**`docs/`:**
- Purpose: Architecture documentation, feature plans, research notes
- Key files: `docs/FEATURE_ARCHITECTURE_STANDARD.md` (canonical slice standard)

## Key File Locations

**Entry Points:**
- `src/main/index.ts`: Electron main process bootstrap
- `src/renderer/main.tsx`: React renderer entry point
- `src/renderer/App.tsx`: Root React component
- `src/preload/index.ts`: contextBridge preload script

**Configuration:**
- `tsconfig.json`: TypeScript + path alias definitions
- `electron.vite.config.ts`: Electron Vite build (main + renderer + preload)
- `vitest.config.ts`: Test runner configuration
- `pnpm-workspace.yaml`: Workspace membership (authoritative — not `package.json`)
- `tailwind.config.js`: Tailwind CSS configuration

**Core Logic:**
- `src/renderer/store/index.ts`: Store composition and all IPC event listeners
- `src/main/services/team/TeamDataService.ts`: Primary team orchestration service
- `src/main/services/analysis/ChunkBuilder.ts`: Session chunk construction
- `src/main/ipc/ipcWrapper.ts`: IPC handler error standardization helper
- `src/preload/constants/ipcChannels.ts`: All IPC channel name constants
- `src/shared/constants/agentBlocks.ts`: Agent block wrap/strip utilities
- `src/shared/types/index.ts`: Primary shared type definitions (`ElectronAPI`, `TeamTask`, etc.)

**Testing:**
- `vitest.config.ts`: Default test config (unit + integration)
- `vitest.critical.config.ts`: Critical-path test subset config
- Tests co-located with source in `__tests__/` subdirectories or `.test.ts` siblings

## Naming Conventions

**Files:**
- Services/classes: PascalCase — `TeamDataService.ts`, `ChunkBuilder.ts`
- Utilities/helpers: camelCase — `pathDecoder.ts`, `taskReferenceUtils.ts`
- React components: PascalCase — `KanbanBoard.tsx`, `TeamListView.tsx`
- Constants files: camelCase — `agentBlocks.ts`, `memberColors.ts`
- IPC channel files: camelCase by domain — `teams.ts`, `sessions.ts`, `review.ts`

**Directories:**
- Feature slices: kebab-case — `recent-projects/`, `tmux-installer/`, `runtime-provider-management/`
- Service domains: camelCase — `analysis/`, `discovery/`, `parsing/`, `team/`
- Component domains: camelCase — `kanban/`, `messages/`, `taskLogs/`

## Where to Add New Code

**New cross-process feature (has main + renderer + IPC):**
- Create `src/features/<feature-name>/` following the canonical template in `docs/FEATURE_ARCHITECTURE_STANDARD.md`
- Public contracts: `src/features/<feature-name>/contracts/`
- Business rules: `src/features/<feature-name>/core/domain/`
- Use cases: `src/features/<feature-name>/core/application/`
- Main composition root: `src/features/<feature-name>/main/composition/`
- IPC input adapter: `src/features/<feature-name>/main/adapters/input/ipc/`
- Preload bridge: `src/features/<feature-name>/preload/`
- Renderer: `src/features/<feature-name>/renderer/` (with `hooks/`, `ui/`, `adapters/`, `utils/`)
- Wire the feature facade in `src/main/index.ts`
- Wire the preload bridge in `src/preload/index.ts`

**New renderer-only slice (no main process needs):**
- Small/simple: Co-locate alongside the consuming component or put in `src/renderer/utils/`
- Complex with its own UI sub-tree: `src/renderer/features/<name>/` (legacy location, renderer-only only)

**New IPC channel (extending existing domain):**
- Add channel constant to `src/preload/constants/ipcChannels.ts`
- Add handler in the relevant `src/main/ipc/<domain>.ts`
- Expose via `src/preload/index.ts` on `electronAPI`
- Add types to `src/shared/types/` if needed

**New main process service:**
- Domain-specific service: `src/main/services/<domain>/MyService.ts`
- Add barrel export via `src/main/services/<domain>/index.ts`

**New Zustand slice:**
- `src/renderer/store/slices/<domain>Slice.ts` — export `createXxxSlice`
- Add to composite store in `src/renderer/store/index.ts`
- Add types to `src/renderer/store/types.ts` (`AppState` interface)

**New shared type or utility:**
- Types: `src/shared/types/index.ts` (main) or a new file in `src/shared/types/`
- Pure utils: `src/shared/utils/<name>.ts`
- Constants: `src/shared/constants/<name>.ts`

**Tests:**
- Unit tests: `__tests__/` subdirectory next to the tested file, or `<file>.test.ts` sibling
- Critical path tests: Register in `vitest.critical.config.ts`

## Special Directories

**`.worktrees/`:**
- Purpose: Git worktrees for feature branches (per global CLAUDE.md workflow)
- Generated: Yes (by `git worktree add`)
- Committed: No (listed in `.gitignore`)

**`.planning/`:**
- Purpose: GSD project planning documents (phases, codebase maps)
- Generated: No (authored by GSD commands)
- Committed: Yes

**`dist/`, `dist-electron/`:**
- Purpose: Build output
- Generated: Yes
- Committed: No

**`resources/`:**
- Purpose: Electron build assets (app icons, entitlements)
- Generated: No
- Committed: Yes

## Path Aliases

| Alias | Resolves to | Usage |
|-------|-------------|-------|
| `@main/*` | `src/main/*` | Main-process imports |
| `@renderer/*` | `src/renderer/*` | Renderer-process imports |
| `@shared/*` | `src/shared/*` | Cross-process shared code |
| `@preload/*` | `src/preload/*` | Preload-only imports |
| `@features/*` | `src/features/*` | Feature slice imports |
| `@claude-teams/agent-graph` | `packages/agent-graph/src/index.ts` | Agent graph package |

**Import order convention:**
1. External packages (e.g., `react`, `zustand`)
2. Path aliases (`@main/*`, `@renderer/*`, `@shared/*`, `@features/*`)
3. Relative imports (`./`, `../`)

---

*Structure analysis: 2026-04-28*
