<!-- refreshed: 2026-04-28 -->
# Architecture

**Analysis Date:** 2026-04-28

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                        Renderer Process (React 19)                    │
│  src/renderer/App.tsx  ·  src/renderer/main.tsx                      │
│                                                                        │
│  Zustand Store (useStore)  ←  IPC events (push)                       │
│  src/renderer/store/index.ts + slices/                                │
│                                                                        │
│  Components                    Feature slices                          │
│  src/renderer/components/      src/features/*/renderer/               │
└───────────────────┬──────────────────────────────────────────────────┘
                    │  contextBridge (window.electronAPI)
                    │  src/preload/index.ts
                    │
┌───────────────────▼──────────────────────────────────────────────────┐
│                      Preload Script                                    │
│  src/preload/index.ts  — exposes ElectronAPI typed surface            │
│  Feature bridges: createRecentProjectsBridge(), etc.                  │
└───────────────────┬──────────────────────────────────────────────────┘
                    │  ipcRenderer.invoke / ipcRenderer.send / ipcMain.on
                    │
┌───────────────────▼──────────────────────────────────────────────────┐
│                       Main Process (Node.js)                           │
│  src/main/index.ts  — app bootstrap, feature wiring                   │
│                                                                        │
│  IPC handlers          Services                  Workers (threads)     │
│  src/main/ipc/         src/main/services/        src/main/workers/    │
│                                                                        │
│  Feature slices        HTTP server               External processes    │
│  src/features/*/main/  src/main/http/            Claude CLI / agents  │
└───────────────────────────────────────────────────────────────────────┘
                    │  JSON files on disk
                    ▼
           ~/.claude/projects/{encoded-path}/*.jsonl
           ~/.claude/todos/{sessionId}.json
           ~/.config/agent-teams/{teamName}/
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Main entry | Electron bootstrap, feature wiring, IPC setup | `src/main/index.ts` |
| Preload bridge | Expose typed IPC surface via contextBridge | `src/preload/index.ts` |
| Renderer entry | React root, store init, listener registration | `src/renderer/main.tsx`, `src/renderer/App.tsx` |
| Zustand store | All renderer state, IPC-driven reactivity | `src/renderer/store/index.ts` |
| IPC handlers | Route each channel to a service method | `src/main/ipc/handlers.ts` + domain files |
| TeamDataService | Core team orchestration, task CRUD, inbox relay | `src/main/services/team/TeamDataService.ts` |
| Analysis services | Parse JSONL, build chunks, extract semantics | `src/main/services/analysis/` |
| Discovery services | Scan projects, locate sessions, search | `src/main/services/discovery/` |
| Parsing services | JSONL → typed messages, CLAUDE.md reading | `src/main/services/parsing/` |
| Team runtime | Spawn/manage Claude CLI processes per member | `src/main/services/team/runtime/` |
| Feature slices | Self-contained cross-process feature modules | `src/features/<name>/` |
| Agent Graph package | Canvas-based agent visualization | `packages/agent-graph/` |
| MCP server | External tool integration surface | `mcp-server/` |

## Pattern Overview

**Overall:** Multi-process Electron app with Hexagonal Architecture (ports & adapters) for features, a flat service layer for the main process core, and Zustand slices for renderer state management.

**Key Characteristics:**
- Process isolation enforced by `contextBridge` — renderer never imports Node.js modules directly
- IPC is the only channel between renderer and main; all calls go through `window.electronAPI`
- Medium/large features use the canonical slice standard (`src/features/<name>/core/domain/`, `core/application/`, `main/`, `preload/`, `renderer/`)
- Zustand store is composed from slice factories (`createXxxSlice`) all merged into one `useStore`
- Main process uses Worker Threads (`src/main/workers/`) for CPU-heavy tasks (task-change computation, team data parsing)

## Layers

**Renderer Layer:**
- Purpose: UI rendering, user interaction, store state management
- Location: `src/renderer/`
- Contains: React components, Zustand store + slices, hooks, utils, renderer types
- Depends on: `window.electronAPI` (preload), `@shared/*` types/utils
- Used by: End user through Electron BrowserWindow

**Preload Layer:**
- Purpose: Secure bridge between renderer and main via contextBridge
- Location: `src/preload/index.ts`
- Contains: `electronAPI` object construction, feature bridge composition, IPC channel forwarding
- Depends on: `@preload/constants/ipcChannels`, feature preload bridges, `@shared/types`
- Used by: Renderer via `window.electronAPI`

**Main Process Layer:**
- Purpose: Business logic, file system access, process management, IPC handler registration
- Location: `src/main/`
- Contains: IPC handlers (`ipc/`), services (`services/`), workers (`workers/`), HTTP server (`http/`), utils
- Depends on: Node.js APIs, Electron APIs, `@shared/*`, external CLI binaries
- Used by: Electron framework

**Shared Layer:**
- Purpose: Types, constants, and pure utilities shared across all processes
- Location: `src/shared/`
- Contains: TypeScript types (`types/`), constants (`constants/`), pure utils (`utils/`)
- Depends on: Nothing (no process-specific imports allowed)
- Used by: Main, renderer, preload, features

**Feature Slices (`src/features/`):**
- Purpose: Self-contained cross-process features following the canonical slice standard
- Location: `src/features/<feature-name>/`
- Contains: `contracts/`, `core/domain/`, `core/application/`, `main/`, `preload/`, `renderer/`
- Key features: `recent-projects` (reference impl), `tmux-installer`, `runtime-provider-management`, `codex-account`, `codex-model-catalog`, `team-runtime-lanes`, `agent-graph`, `anthropic-runtime-profile`, `codex-runtime-profile`

## Data Flow

### Session Analysis Request Path

1. Renderer calls `window.electronAPI.getSessionDetail(projectId, sessionId)` (`src/preload/index.ts`)
2. IPC reaches handler in `src/main/ipc/sessions.ts`
3. Handler delegates to `SessionParser` (`src/main/services/parsing/SessionParser.ts`)
4. Parser reads JSONL from `~/.claude/projects/{encoded-path}/*.jsonl`
5. `ChunkBuilder` (`src/main/services/analysis/ChunkBuilder.ts`) produces typed chunks
6. Response serialized as `IpcResult<T>` and returned to renderer
7. Renderer store slice (`sessionDetailSlice`) updates state

### Team Change Push Flow

1. Main process watches team config directory, inbox files, and Claude CLI stdout
2. `TeamDataService` emits `TeamChangeEvent` via `mainWindow.webContents.send(TEAM_CHANGE, event)`
3. Preload registers listener: `ipcRenderer.on(TEAM_CHANGE, callback)` (exposed as `onTeamChange`)
4. Store listener in `src/renderer/store/index.ts` (`initializeNotificationListeners`) receives event
5. Depending on `event.type`, either: updates store in-memory directly (`lead-activity`, `lead-context`, `tool-activity`) or schedules a throttled IPC fetch (`refreshTeamData`)

### Agent Team Launch Path

1. Renderer calls `window.electronAPI.teams.launchTeam(request)`
2. IPC handler in `src/main/ipc/teams.ts` → `TeamProvisioningService` (`src/main/services/team/TeamProvisioningService.ts`)
3. Provisioning spawns Claude CLI processes per member via `TeamRuntimeAdapter` (`src/main/services/team/runtime/TeamRuntimeAdapter.ts`)
4. Lead reads stdin only; teammates are independent CLI processes with their own inbox files
5. `TeamDataService` monitors file system changes and emits `TEAM_CHANGE` events back to renderer

### Context Tracking Flow

1. Renderer processes session chunks returned from `getSessionDetail`
2. `computeContextStats()` in `src/renderer/utils/contextTracker.ts` analyzes chunks
3. Produces `ContextStats` with token breakdown across 6 categories: `claude-md`, `mentioned-file`, `tool-output`, `thinking-text`, `team-coordination`, `user-message`
4. `ContextBadge`, `TokenUsageDisplay`, `SessionContextPanel` consume these stats

**State Management:**
- All renderer state lives in a single Zustand store (`src/renderer/store/index.ts`)
- Store is composed of 20+ slice factories (`createXxxSlice`), each in `src/renderer/store/slices/`
- No React Context API or local component state for shared data — slices own it all
- IPC events drive store mutations via listeners registered in `initializeNotificationListeners()`

## Key Abstractions

**IpcResult\<T\>:**
- Purpose: Standardized success/error envelope for all IPC calls
- Pattern: `{ success: true, data: T } | { success: false, error: string }`
- All handlers use `createIpcWrapper()` at `src/main/ipc/ipcWrapper.ts` to produce these

**Chunk types (UserChunk, AIChunk, SystemChunk, CompactChunk):**
- Purpose: Typed timeline units for session visualization
- Examples: `src/main/services/analysis/ChunkBuilder.ts`, `src/main/services/analysis/ChunkFactory.ts`
- Pattern: Discriminated union on `type` field; each carries timestamp, duration, metrics (tokens, cost, tools)

**AgentBlock:**
- Purpose: Delimited sections in Claude messages hidden from UI, used for agent-to-agent coordination
- Location: `src/shared/constants/agentBlocks.ts`
- Wrappers: `wrapAgentBlock(text)` to create, `stripAgentBlocks(text)` to remove for display, `unwrapAgentBlock(block)` to extract content

**FeatureFacade:**
- Purpose: Thin composition root exposed by each feature's `main/` to the app shell
- Examples: `RecentProjectsFeatureFacade` at `src/features/recent-projects/main`
- Pattern: Feature creates facade in `main/composition/`, app shell wires it in `src/main/index.ts`

**TaskRef:**
- Purpose: Typed cross-team task reference `{ taskId, displayId, teamName }`
- Persisted on: `InboxMessage.taskRefs`, `TeamTask.descriptionTaskRefs`, `TaskComment.taskRefs`
- Renderer flow: `useTaskSuggestions()` + `src/renderer/utils/taskReferenceUtils.ts` → zero-width encoded metadata in text

## Entry Points

**Electron Main:**
- Location: `src/main/index.ts`
- Triggers: Electron `app.ready`
- Responsibilities: Create BrowserWindow, register IPC handlers, instantiate all services and feature facades, start file watchers

**Renderer:**
- Location: `src/renderer/main.tsx`
- Triggers: BrowserWindow loads `index.html`
- Responsibilities: Mount React app, call `initializeNotificationListeners()` which subscribes IPC push events and fetches initial data

**Preload:**
- Location: `src/preload/index.ts`
- Triggers: Electron loads preload script before page content
- Responsibilities: Build `electronAPI` object from channel constants, call `contextBridge.exposeInMainWorld('electronAPI', electronAPI)`

## Architectural Constraints

- **Process isolation:** Renderer must only access Node.js/Electron APIs through `window.electronAPI`; any new IPC capability requires a preload addition plus an IPC handler
- **Threading:** Main process is single-threaded Node.js event loop; CPU-heavy work (task change diffs, team data parsing, fs operations) is offloaded to Worker Threads in `src/main/workers/`
- **Global state:** Several main-process service singletons exist (e.g., `gitIdentityResolver`, `providerConnectionService`); they are module-level constants initialized in `src/main/index.ts`
- **Shared layer purity:** `src/shared/` must not import from `@main/*`, `@renderer/*`, or `@preload/*`
- **Feature slice imports:** Outside a feature, only import from its public entrypoints (`contracts/`, `main/`, `preload/`, `renderer/`) — never deep-import feature internals

## Anti-Patterns

### Bypassing contextBridge

**What happens:** A Node.js or Electron module is imported directly inside `src/renderer/`
**Why it's wrong:** Breaks process isolation and Electron security model; fails at runtime when context isolation is enabled
**Do this instead:** Add a typed method to `ElectronAPI` in `src/preload/index.ts` and a corresponding IPC handler in `src/main/ipc/`

### Manually concatenating Agent Block delimiters

**What happens:** Code writes `AGENT_BLOCK_OPEN + content + AGENT_BLOCK_CLOSE` directly
**Why it's wrong:** Skips trimming and formatting guarantees; creates inconsistent blocks that strip logic may not recognize
**Do this instead:** Always use `wrapAgentBlock(text)` from `@shared/constants/agentBlocks`

### Using `src/renderer/features/` for new cross-process features

**What happens:** A new feature with main-process needs is placed under `src/renderer/features/`
**Why it's wrong:** That directory holds legacy renderer-only slices; new cross-process features must use the canonical standard
**Do this instead:** Follow `docs/FEATURE_ARCHITECTURE_STANDARD.md` and place the feature under `src/features/<feature-name>/`

### Importing feature internals across feature boundaries

**What happens:** One feature deep-imports from another feature's `core/` or `infrastructure/`
**Why it's wrong:** Couples features; breaks public API boundary; prevents independent refactoring
**Do this instead:** Import only from `@features/<name>/contracts`, `@features/<name>/main`, `@features/<name>/preload`, or `@features/<name>/renderer`

## Error Handling

**Strategy:** Try/catch at IPC handler boundary; errors returned as `IpcResult<T>` with `success: false` and `error: string`. Renderer throws on failure via `invokeIpcWithResult()` in preload.

**Patterns:**
- Main: `createIpcWrapper(logPrefix)` at `src/main/ipc/ipcWrapper.ts` wraps every handler — catches errors, logs via `createLogger`, returns `IpcResult`
- Renderer store actions: try/catch with error state stored in relevant Zustand slice
- Unhandled errors: Sentry integration in both `src/main/sentry.ts` and `src/renderer/sentry.ts`

## Cross-Cutting Concerns

**Logging:** `createLogger(prefix)` from `src/shared/utils/logger.ts` — prefixed console output; renderer logs with tags `[Store:]`, `[Component:]`, `[IPC:]`, `[Service:]`, `[Perf:]` are forwarded to main via `RENDERER_LOG` IPC
**Validation:** IPC parameter guards in `src/main/ipc/guards.ts`; feature-level validation in `core/domain/` policies
**Authentication:** No external auth required; Claude CLI handles Anthropic auth; SSH tunnel managed via `src/main/services/infrastructure/`; Codex account via `src/features/codex-account/`

---

*Architecture analysis: 2026-04-28*
