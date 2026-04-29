# Codebase Concerns

**Analysis Date:** 2026-04-28

---

## M4 / Apple Silicon Specific Concerns

### Native Module Rebuild on arm64

**Native modules requiring electron-rebuild:** `node-pty`, `ssh2`, `cpu-features`

The `postinstall` hook runs:
```
electron-rebuild -f -o node-pty,ssh2,cpu-features || echo 'native Electron rebuild failed (terminal/ssh features may be degraded)'
```

- Files: `package.json` line 66
- Risk: The `|| echo` fallback silently swallows rebuild failures. On a fresh M4 clone, if `node-gyp` lacks Xcode Command Line Tools or the correct Python version, terminal (`node-pty`) and SSH features will silently degrade with no hard error. Users only discover the failure at runtime when the embedded terminal or SSH connection fails.
- Fix approach: Add an explicit `pnpm postinstall:check` script that validates the `.node` binaries were produced for `arm64` before continuing. Alternatively, gate the dev server start on a successful rebuild check.

**`pnpm onlyBuiltDependencies`:** Only `electron`, `node-pty`, `cpu-features` are listed. `ssh2` is not — but `ssh2`'s optional `cpu-features` binding is covered indirectly. Confirm this is sufficient if `ssh2` native extensions are needed on a clean M4 install.
- Files: `package.json` lines 322–326

### `npmRebuild: false` in electron-builder

`package.json` build config sets `"npmRebuild": false`. This means electron-builder will NOT re-run native rebuilds during `dist:mac:arm64`. The assumption is that `postinstall` has already rebuilt natives for the correct Electron ABI.

- Files: `package.json` line 259
- Risk: If a developer runs `pnpm dist:mac:arm64` after a `pnpm install` that failed its native rebuild (silently, due to `|| echo`), the packaged `.dmg` will contain x86_64 or wrong-ABI `.node` binaries. The `afterPack.cjs` validation step will catch this and throw, but only after packaging starts.
- Fix approach: Move the native rebuild validation earlier — run `electron-rebuild --version-check` as a pre-dist check before `electron-builder` is invoked.

### afterPack Binary Validation

`scripts/electron-builder/afterPack.cjs` walks the output directory, parses Mach-O/ELF/PE headers, and throws if any native binary has the wrong arch.

- Files: `scripts/electron-builder/afterPack.cjs`
- Status: This is a good safeguard. However, it fires only after packaging completes, wasting time when arch mismatches already exist. No tests found for this module's internal logic despite internal exports (`module.exports._internal`) being present.

### `bun.lock` Present Alongside `pnpm-lock.yaml`

Both `bun.lock` and `pnpm-lock.yaml` exist at the root. The project's canonical package manager is `pnpm@10.33.0` (declared in `package.json`). The `bun.lock` file is stale/orphaned.

- Files: `bun.lock`, `pnpm-lock.yaml`
- Risk: A developer who runs `bun install` will get a different dependency tree than `pnpm install`. The presence of `bun.lock` also confuses tooling that auto-detects package managers.
- Fix approach: Delete `bun.lock` and add it to `.gitignore`.

### Sentry SDK Major Version Mismatch

`@sentry/electron` is pinned to `^7.10.0` (main process) while `@sentry/react` is `^10.45.0` (renderer). A workaround comment exists:

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-version @sentry/core type mismatch
```

- Files: `src/renderer/sentry.ts` line 50, `package.json` lines 123–124
- Risk: The major version gap means they share no compatible `@sentry/core`. The workaround uses `@sentry/electron/renderer`'s `browserTracingIntegration` instead of `@sentry/react`'s. Upgrades to either package require careful coordinated bumps.

---

## Tech Debt

### God Object: `TeamProvisioningService`

`src/main/services/team/TeamProvisioningService.ts` is **24,813 lines**. This single file contains team lifecycle management, agent spawning, inbox relay, prompt construction, task routing, stall detection, context recovery, and process monitoring.

- Files: `src/main/services/team/TeamProvisioningService.ts`
- Impact: Extremely difficult to test in isolation. Any change risks unexpected side effects across unrelated team functionality. It is the single highest-risk file for regressions.
- TODOs inside: line 552 (`team-result-notification-v2`), line 1075 (`refactor` prompt-bound tool contracts)
- Fix approach: Extract domain sub-services incrementally — e.g., `TeamInboxRelayService`, `TeamPromptBuilder`, `AgentProcessMonitor`. The pattern of extracting utilities (e.g., `shellEnv.ts`) is already started but must go much further.

### Large IPC Handler File

`src/main/ipc/teams.ts` is 4,766 lines. There are 244 registered IPC handlers total across the codebase.

- Files: `src/main/ipc/teams.ts`
- Impact: Hard to navigate, high merge conflict risk, test coverage gaps per surface area.
- Fix approach: Split into domain-grouped IPC modules (e.g., `teams/tasks.ts`, `teams/members.ts`, `teams/inbox.ts`) matching the pattern already used for `crossTeam.ts`.

### Large Renderer Components

Several renderer components exceed 1,500 lines mixing business logic with rendering:

| File | Lines |
|------|-------|
| `src/renderer/components/team/TeamDetailView.tsx` | 3,166 |
| `src/renderer/components/team/dialogs/LaunchTeamDialog.tsx` | 2,921 |
| `src/renderer/components/team/dialogs/CreateTeamDialog.tsx` | 2,203 |
| `src/renderer/components/dashboard/CliStatusBanner.tsx` | 1,923 |
| `src/renderer/components/team/activity/ActivityItem.tsx` | 1,628 |

- Fix approach: Extract sub-components and custom hooks; move business logic to Zustand slices or separate utility files.

### Legacy `src/renderer/features/` Directory

`src/renderer/features/` exists as a migration-era location. It currently contains only a `CLAUDE.md` guard file with no actual feature slices. New features must use `src/features/<feature-name>/`.

- Files: `src/renderer/features/CLAUDE.md`
- Risk: Low immediate risk, but confuses contributors who see both `src/features/` and `src/renderer/features/`.

### `relayMemberInboxMessages` Implemented but Intentionally Disabled

The `relayMemberInboxMessages` function is fully implemented but its call sites are commented out because it caused relay loops and duplicate messages.

- Files: `src/main/ipc/teams.ts` lines 2655–2666 (call site comment), `src/main/services/team/TeamProvisioningService.ts` line 14608 (implementation)
- Impact: Dead code adds maintenance overhead. A future contributor who misunderstands the architecture and re-enables the relay will reintroduce known bugs.
- Fix approach: Create an ADR documenting why member inbox relay must never be called. Either delete the function body (preserving a comment referencing the ADR) or add a `@deprecated` JSDoc annotation with the reason.

### `TeamAttachmentStore` Cleanup Not Implemented

```typescript
// TODO: add deleteAttachments(teamName, messageId) for cleanup on failed/cancelled sends.
```

- Files: `src/main/services/team/TeamAttachmentStore.ts` line 281
- Impact: Attachments from failed/cancelled sends accumulate on disk indefinitely.

### Outgoing Message Queue Missing

The roadmap explicitly lists "Outgoing message queue" as pending. There is no implementation. If a user sends a message while the lead is busy, the message may be lost or delivered out of order.

- Impact: Correctness issue for time-sensitive agent communication.

---

## Known Bugs / Fragile Areas

### UV Thread Pool Saturation (Partially Mitigated)

The build injects a banner into the main process bundle:

```js
if(!process.env.UV_THREADPOOL_SIZE){process.env.UV_THREADPOOL_SIZE='24'}
```

- Files: `electron.vite.config.ts` (rollupOptions.output.banner)
- Why: Windows NTFS `fs.watch({ recursive: true })` occupies one UV thread per watcher. With 4+ watchers + concurrent fs/DNS/spawn, the default 4 threads deadlock.
- macOS M4 note: macOS uses FSEvents and does not consume UV threads for `fs.watch`, so this bump is a no-op for macOS. The 24-thread pool wastes a minor amount of memory but causes no harm.

### Chokidar `awaitWriteFinish` Polling

`TeamLogSourceTracker` configures chokidar with `awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 }`. This means chokidar polls every 50ms while waiting for file writes to stabilize.

- Files: `src/main/services/team/TeamLogSourceTracker.ts` lines 294–304
- Impact on M4: When many agents are writing simultaneously, this creates high-frequency filesystem polling. On M4 the efficiency cores handle it well, but it is a potential battery drain concern during large multi-agent runs.

### Periodic Catch-Up Scan Timer

`FileWatcher` runs a periodic catch-up scan (every 45s, constant `CATCH_UP_SCAN_INTERVAL`) to detect events missed by `fs.watch`.

- Files: `src/main/services/infrastructure/FileWatcher.ts` line 45 and line 1076
- Impact: Adds background CPU/IO activity even when no agents are running.

---

## Security Considerations

### Electron Security Defaults

The main window uses correct defaults: `nodeIntegration: false`, `contextIsolation: true`.
- Files: `src/main/index.ts` lines 1545–1546
- Status: No issues.

### macOS Entitlements: `disable-library-validation`

`resources/entitlements.mac.plist` grants `com.apple.security.cs.disable-library-validation`. This is required for `node-pty` native addon loading under hardened runtime but broadens the attack surface by allowing unsigned dylibs.

- Files: `resources/entitlements.mac.plist`
- Mitigation: Common Electron+native-addon pattern. Document why it is needed and revisit if a future `node-pty` version supports hardened-runtime-compatible loading.

### Sentry DSN Baked into Renderer Bundle at Build Time

The renderer bundle bakes in `SENTRY_DSN` at compile time via `VITE_SENTRY_DSN`. Any developer with `SENTRY_DSN` in their shell environment who runs `pnpm build` will produce a binary that reports crashes to the production Sentry project.

- Files: `electron.vite.config.ts` (define block), `src/renderer/sentry.ts`
- Fix approach: Gate Sentry DSN injection on a CI-specific environment variable (e.g., require both `SENTRY_DSN` and `CI=true`).

### IPC Handler Count vs. Path Validation Audit

244 IPC handlers exist across the codebase. Path traversal protection is documented in `SECURITY.md` and guards exist in `src/main/ipc/guards.ts`, but there is no documented audit or test suite that systematically validates path sanitization coverage across all handlers.

- Files: `src/main/ipc/` directory
- Fix approach: Add a fuzz/property test for path traversal patterns targeting all IPC channels that accept path parameters.

---

## Performance Considerations

### Build Memory: 8 GB Required

`pnpm build` runs with `--max-old-space-size=8192`. On an M4 MacBook Pro with 16 GB RAM this is workable but leaves limited headroom for other applications during build.
- Files: `package.json` line 28

### Large JSONL Session Files — No Pre-Indexing

Large sessions (many hours of agent activity, potentially 50+ MB JSONL) must be scanned line-by-line from the beginning when first opened unless cached. First-open latency can be several seconds.
- Files: `src/main/services/` (JSONL parsing and LRU cache layer)
- Fix approach: Add a lightweight byte-offset index written alongside each JSONL file (e.g., `{session}.jsonl.idx`) to enable O(1) seeks to later time ranges.

### Kanban Board Does Not Use Virtual Scrolling

The kanban board renders all task cards at once. For teams with hundreds of tasks, this will cause render jank.
- Files: `src/renderer/components/team/kanban/KanbanBoard.tsx`
- Fix approach: Apply `@tanstack/react-virtual` (already a dependency) per-column.

### `TeamProvisioningService` as Singleton

All running teams share a single `TeamProvisioningService` instance. All in-memory team state lives in one heap object. With many concurrent teams, this becomes a large undifferentiated heap allocation.
- Files: `src/main/index.ts` line 1042

---

## Deprecated Patterns

### Direct `localStorage` Access from Utility Files and Components

Several files access `localStorage` directly instead of through a storage abstraction:

- `src/renderer/utils/teamMessageExpandStorage.ts`
- `src/renderer/utils/teamMessageReadStorage.ts`
- `src/renderer/utils/diffViewedStorage.ts`
- `src/renderer/components/sidebar/GlobalTaskList.tsx`
- `src/renderer/components/dashboard/DashboardUpdateBanner.tsx`

Per the CLAUDE.md storage convention, new persistence flows should use repository/storage abstractions. These are legacy usages.
- Fix approach: Introduce a `LocalStorageRepository` abstraction with a consistent key-prefix convention and TTL support, then migrate each direct call.

---

## Build / Packaging Concerns for arm64

### No macOS CI Runner

CI tests run on `ubuntu-latest` and `windows-latest` only. There is no macOS runner in the test matrix.

- Files: `.github/workflows/ci.yml`
- Impact: macOS-specific behavior (FSEvents, Dock integration, notarization, code-signing, hardened runtime, M4 native module loading) is never exercised in CI. macOS-specific bugs introduced by contributors on other platforms will not be caught until manually tested on a Mac.
- Fix approach: Add a `macos-latest` runner to the test matrix for at minimum a smoke-test run.

### `runtime.lock.json` Version Drift Risk

`runtime.lock.json` pins the `claude-multimodel` runtime binary at `v0.0.12` for `darwin-arm64`. The runtime is versioned independently of the app.

- Files: `runtime.lock.json`
- Risk: If the locked version becomes incompatible with a future Claude Code CLI update, the multimodel bridge will fail silently until `runtime.lock.json` is bumped.
- Fix approach: Add a startup compatibility check that validates the runtime binary's self-reported version against the expected interface contract.

### `node-pty` asarUnpack Glob Fragility

```json
"asarUnpack": ["out/renderer/**", "**/node_modules/node-pty/**"]
```

- Files: `package.json` lines 237–240
- Risk: If `pnpm` hoisting changes `node-pty`'s location inside `node_modules`, the glob could silently miss the `.node` file. The `afterPack` validation catches this, but only after packaging.

### `afterPack.cjs` Has No Tests

`scripts/electron-builder/afterPack.cjs` exports internal functions (`module.exports._internal`) suggesting tests were planned, but no test file was found.

- Files: `scripts/electron-builder/afterPack.cjs`
- Risk: Regressions in arch validation logic could allow mismatched arm64/x64 binaries to be packaged silently (unless caught by `afterPack` at runtime — but a bug in the validator itself would be invisible).
- Priority: Medium

---

*Concerns audit: 2026-04-28*
