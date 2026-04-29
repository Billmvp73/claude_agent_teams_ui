# External Integrations

**Analysis Date:** 2026-04-28

## Claude Code CLI Dependency

The app's primary dependency is the Claude Code CLI (`claude`) installed locally on the machine.

**How it works:**
- The app spawns `claude` as a child process (via `node-pty`) to run agent sessions
- The CLI's `--output-format stream-json` flag streams structured JSONL to the app
- Session files written by the CLI are read from `~/.claude/projects/{encoded-path}/*.jsonl`
- Authentication flows (Claude account login, API key setup) are handled in-app via `cliInstaller:install` IPC

**Detection & Installation:**
- `src/main/ipc/cliInstaller.ts` — IPC handler that detects CLI presence, version, and auth status
- Status is cached for 5 seconds (`STATUS_CACHE_TTL_MS`) to avoid rapid repeated checks
- The app can guide first-time installation through the onboarding UI

## Teams Orchestrator Runtime

A separate runtime binary (`claude-multimodel`) enables multi-provider (non-Claude) support.

**Source:** `runtime.lock.json` (version `0.0.12`, from `777genius/agent_teams_orchestrator`)

**Platform binaries:**
- `darwin-arm64`: `agent-teams-runtime-darwin-arm64-v0.0.12.tar.gz` (binary: `claude-multimodel`)
- `darwin-x64`: `agent-teams-runtime-darwin-x64-v0.0.12.tar.gz`
- `linux-x64`: `agent-teams-runtime-linux-x64-v0.0.12.tar.gz`
- `win32-x64`: `agent-teams-runtime-win32-x64-v0.0.12.zip`

**Download & cache:**
- `scripts/dev-with-runtime.mjs` downloads the correct platform binary on first `pnpm dev`
- Cache location: `~/.agent-teams/runtime-cache/` (override via `CLAUDE_DEV_RUNTIME_CACHE_ROOT`)
- Override binary path: `CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH`

## File System Integrations

### `~/.claude/` — Claude Code data directory

All primary data is read from the Claude Code CLI's data directory.

| Path | Contents | Access |
|------|----------|--------|
| `~/.claude/projects/{encoded-path}/*.jsonl` | Session log files (JSONL, one line per message) | Read |
| `~/.claude/todos/{sessionId}.json` | Todo/task data per session | Read |
| `~/.claude/teams/` | Team configuration files | Read/Write |
| `~/.claude/tasks/` | Task data files | Read/Write |
| `~/.claude/tools/` | Tool configuration | Read |
| `~/.claude/agent-teams-schedules/` | Scheduled task definitions | Read/Write |
| `~/.claude/inboxes/{member}.json` | Agent-to-agent message inbox files | Read/Write |

**Path encoding:** `/Users/name/project` encodes to `-Users-name-project` for directory names.

**Access control:** `src/main/utils/pathValidation.ts` blocks path traversal and restricts write operations to the selected project root. `~/.claude/` is explicitly allowed for session data reads.

**Override:** `CLAUDE_ROOT` env var overrides `~/.claude` in standalone mode (`src/main/standalone.ts`).

### App-owned state

Separate from `~/.claude/` so the CLI cannot delete it:
- Electron `userData` path (OS-determined, e.g., `~/Library/Application Support/Agent Teams UI/`) — app settings, IndexedDB

### File watching

- `chokidar ^4.0.3` watches JSONL session files and inbox files for real-time updates
- 100ms debounce on file change events (performance)
- Three dedicated worker threads handle file system operations:
  - `dist-electron/main/team-fs-worker.cjs` — team filesystem ops
  - `dist-electron/main/task-change-worker.cjs` — task change tracking
  - `dist-electron/main/team-data-worker.cjs` — team data reads

## Electron IPC Structure

All renderer ↔ main communication uses `ipcMain.handle` / `ipcRenderer.invoke` (bidirectional) or `webContents.send` (main → renderer push).

### IPC Handler Modules (`src/main/ipc/`)

| File | Channel prefix | Purpose |
|------|---------------|---------|
| `cliInstaller.ts` | `cliInstaller:*` | CLI detection, installation, provider status |
| `config.ts` | `config:*` | App configuration read/write |
| `context.ts` | `context:*` | Context/token usage data |
| `crossTeam.ts` | `crossTeam:*` | Cross-team task references |
| `editor.ts` | `editor:*` | Built-in code editor operations |
| `extensions.ts` | `extensions:*` | MCP/extension management |
| `httpServer.ts` | `httpServer:*` | Start/stop/status of Fastify sidecar |
| `notifications.ts` | `notifications:*` | Native OS notification triggers |
| `projects.ts` | `projects:*` | Project discovery and management |
| `review.ts` | `review:*` | Code review / diff operations |
| `schedule.ts` | `schedule:*` | Scheduled task management |
| `search.ts` | `search:*` | Project/session search |
| `sessions.ts` | `sessions:*` | Session data reads |
| `skills.ts` | `skills:*` | Agent skill management |
| `ssh.ts` | `ssh:*` | SSH connection lifecycle |
| `subagents.ts` | `subagents:*` | Subagent process management |
| `teams.ts` | `teams:*` | Team CRUD, task creation, inbox relay |
| `terminal.ts` | `terminal:*` | PTY spawn/write/resize/kill |
| `tmux.ts` | `tmux:*` | Tmux session management |
| `updater.ts` | `updater:*` | Auto-update check/download/install |
| `utility.ts` | `utility:*` | Misc utilities |
| `window.ts` | `window:*` | Window management |

### Agent Message Delivery (IPC + file)

- **Lead agent** receives messages via stdin relay: `relayLeadInboxMessages()` converts `~/.claude/inboxes/lead.json` entries to stdin writes
- **Teammate agents** receive messages directly: Claude Code runtime monitors `~/.claude/inboxes/{member}.json` between turns (no IPC relay needed)
- **User DM to teammate**: UI writes to `~/.claude/inboxes/{member}.json` with `from: "user"` via `teams:sendMessage` IPC
- **Teammate response to user**: teammate writes to `~/.claude/inboxes/user.json`; UI reads via `TeamInboxReader`

## MCP Server Integration

The app ships a built-in MCP server that exposes the agent-teams controller API to external tools.

**Package:** `mcp-server/` (`agent-teams-mcp`, uses `fastmcp ^3.34.0`, `zod ^4.3.6`)

**How it works:**
- The MCP server wraps the `agent-teams-controller` HTTP API
- External MCP clients (e.g., Claude Code with MCP configured) can call team/task operations
- Build output: `mcp-server/dist/index.js`, bundled into app package at `resources/mcp-server/index.js`
- Binary name: `agent-teams-mcp`

**IPC surface:** `src/main/ipc/extensions.ts` manages MCP server lifecycle from the UI

**Build:** `mcp-server/` uses `tsup` for bundling; rebuilt during `pnpm prebuild`

## HTTP Sidecar Server

An internal Fastify HTTP server runs alongside the Electron process for standalone/headless use.

**Package:** `agent-teams-controller/` (CommonJS, workspace package)

**Purpose:**
- Exposes a local HTTP API so the MCP server and external tools can interact with team/task state
- Used by standalone mode (`src/main/standalone.ts`) to serve the web UI
- Controller is kept external (not bundled) due to Fastify's dynamic module resolution requirements

**IPC:** `httpServer:start`, `httpServer:stop`, `httpServer:getStatus`

**Standalone mode entrypoint:** `src/main/standalone.ts` — runs without Electron for headless/server deployments

## Monitoring & Observability

### Sentry (Error Tracking)

- **Main process:** `@sentry/electron ^7.10.0` — initialized in `src/main/sentry.ts`
- **Renderer:** `@sentry/react ^10.45.0`
- **DSN:** injected at compile time via `process.env.SENTRY_DSN` (CI only); empty string in local dev
- **Source maps:** uploaded to Sentry during CI builds when `SENTRY_AUTH_TOKEN` is set; map files deleted post-upload
- **Local dev:** Sentry is effectively disabled (empty DSN)

## Auto-Update

- `electron-updater ^6.7.3` — checks GitHub Releases for new versions
- Provider: GitHub (`777genius/claude_agent_teams_ui`)
- IPC channels: `updater:check`, `updater:download`, `updater:install`
- macOS: notarized DMG / ZIP targets; arm64 and x64 artifacts are distinct

## SSH Integration

- `ssh2 ^1.17.0` — SSH client for remote agent execution (roadmap feature, partially implemented)
- `ssh-config ^5.0.4` — parses `~/.ssh/config` for host suggestions
- IPC: `ssh:connect`, `ssh:disconnect`, `ssh:getState`, `ssh:test`, `ssh:getConfigHosts`, `ssh:resolveHost`

## Git Integration

- `simple-git ^3.32.3` — used by the built-in code editor and review workflow for git operations within the selected project
- `diff ^8.0.3`, `node-diff3 ^3.2.0` — diff/merge computation for code review hunks

## Authentication & Identity

**Auth Provider:** None (no cloud auth). The app runs entirely locally.

- Claude authentication is managed by the Claude Code CLI itself (`~/.claude/` stores CLI auth)
- Multi-provider auth (Codex, OpenCode) handled by the teams orchestrator runtime binary
- No API keys or cloud accounts needed for the app itself

## Environment Configuration

**Required for dev:** None. The app starts without any env vars.

**Optional overrides:**
- `CLAUDE_ROOT` — override `~/.claude` location
- `CLAUDE_DEV_RUNTIME_ROOT` — local orchestrator repo path
- `CLAUDE_AGENT_TEAMS_ORCHESTRATOR_CLI_PATH` — direct path to runtime binary
- `CLAUDE_DEV_RUNTIME_CACHE_ROOT` — override `~/.agent-teams/runtime-cache/`
- `SENTRY_AUTH_TOKEN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` — CI Sentry upload

**Secrets location:** None stored in the repo. CLI auth tokens live in `~/.claude/` (managed by Claude Code CLI).

## Webhooks & Callbacks

**Incoming:** None — fully local desktop app, no inbound network endpoints in production.

**Outgoing:** None in normal operation. HTTP calls are limited to:
- GitHub Releases API (auto-update check)
- Sentry ingest (CI builds only, when DSN is set)
- Provider-specific API calls are made by the CLI/runtime, not the Electron app directly

---

*Integration audit: 2026-04-28*
