# Testing Patterns

**Analysis Date:** 2026-04-28

## Test Framework

**Runner:**
- Vitest 3.x
- Config: `vitest.config.ts` (main), `vitest.critical.config.ts` (critical path subset)

**Assertion Library:**
- Vitest built-in (`expect`) — Chai-compatible API

**Test environment:**
- `happy-dom` — default for all tests (browser-like DOM without full browser overhead)
- `// @vitest-environment node` — override per-file for Node.js-only tests (e.g., `CodexBinaryResolver.test.ts`)

**Run Commands:**
```bash
pnpm test                         # Run all tests (vitest run)
pnpm test:ci                      # CI mode — single worker (--maxWorkers 1 --minWorkers 1)
pnpm test:watch                   # Watch mode
pnpm test:coverage                # Coverage with v8 provider
pnpm test:coverage:critical       # Critical path coverage (vitest.critical.config.ts)
pnpm test:task-change-ledger      # Focused: task ledger + review service tests
pnpm test:chunks                  # Specialized: tsx test/test-chunk-building.ts
pnpm test:semantic                # Specialized: tsx test/test-semantic-steps.ts
pnpm test:noise                   # Specialized: tsx test/test-noise-filtering.ts
pnpm test:task-filtering          # Specialized: tsx test/test-task-filtering.ts
pnpm test:workspace               # Root + agent-teams-controller + agent-teams-mcp
```

## Test File Organization

Tests live in two locations:

**1. Separate `test/` directory** (primary for most tests):
```
test/
├── setup.ts                    # Global setup: Sentry mocks, HOME stub, console spy
├── mocks/
│   └── electronAPI.ts          # Typed mock factory for window.electronAPI
├── fixtures/
│   ├── extensions/             # JSON response fixtures
│   └── team/                   # JSONL + JSON fixtures, source-file fixtures for change ledger
├── renderer/
│   ├── utils/                  # Tests for src/renderer/utils/*
│   ├── store/                  # Tests for Zustand store slices
│   ├── hooks/                  # Tests for renderer hooks
│   ├── components/             # Component render tests
│   ├── features/               # Tests for renderer-layer feature slices
│   ├── api/                    # Tests for renderer API layer
│   ├── types/                  # Tests for type utilities
│   └── constants/              # Tests for constants
├── main/
│   ├── services/
│   │   ├── analysis/           # ChunkBuilder, ProcessLinker
│   │   ├── team/               # Team service tests (largest: stallMonitor, change ledger)
│   │   ├── discovery/          # ProjectPathResolver
│   │   ├── parsing/
│   │   ├── infrastructure/     # CodexBinaryResolver, JsonRpcStdioClient
│   │   └── ...
│   ├── ipc/                    # IPC guard and config validation tests
│   └── utils/                  # pathDecoder tests
├── shared/
│   └── constants/              # Shared constants tests
└── features/                   # Tests for cross-process feature integration
    ├── codex-account/
    ├── recent-projects/
    └── ...
```

**2. Co-located `__tests__/` subdirectories** (used within `src/features/` and `src/` slices):
```
src/features/team-runtime-lanes/core/domain/__tests__/planTeamRuntimeLanes.test.ts
src/features/tmux-installer/core/domain/policies/__tests__/buildTmuxAutoInstallCapability.test.ts
src/features/tmux-installer/renderer/ui/__tests__/TmuxInstallerBannerView.test.tsx
src/renderer/components/team/kanban/KanbanTaskCard.test.tsx
src/renderer/hooks/useCreateTeamDraft.test.tsx
src/shared/utils/__tests__/contextMetrics.test.ts
```

**Naming:**
- All test files: `*.test.ts` or `*.test.tsx`
- No `.spec.*` files used in this project

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

describe('ModuleName', () => {
  describe('functionName', () => {
    it('describes expected behavior in plain language', () => {
      // arrange
      // act
      // assert
      expect(result).toBe(expected);
    });
  });
});
```

**Patterns:**
- `beforeEach` — reset mocks, set up fresh state (avoid shared mutable state between tests)
- `afterEach` — restore mocks, clean up DOM (`document.body.innerHTML = ''`)
- Global `afterEach` in `test/setup.ts` asserts no unexpected `console.error` or `console.warn` calls — tests that expect console noise must silence spies explicitly

## Mocking

**Framework:** Vitest `vi` API

**`vi.hoisted()` pattern** — used when mock needs to be referenced both in `vi.mock()` factory and in test body:
```typescript
const { mockUseTmuxInstallerBanner } = vi.hoisted(() => ({
  mockUseTmuxInstallerBanner: vi.fn(),
}));

vi.mock('../../hooks/useTmuxInstallerBanner', () => ({
  useTmuxInstallerBanner: mockUseTmuxInstallerBanner,
}));
```

**`vi.mock()` module replacement** — used for replacing entire modules (hooks, APIs, components):
```typescript
vi.mock('@renderer/api', () => ({
  api: mockApi,
  isElectronMode: mockApi.isElectronMode,
}));

// Lightweight component stub
vi.mock('@renderer/components/team/MemberBadge', () => ({
  MemberBadge: ({ name }: { name: string }) => React.createElement('span', null, name),
}));
```

**`vi.fn()` typed mocks** — always type async mocks explicitly:
```typescript
const accessMock = vi.fn<(filePath: PathLike, mode?: number) => Promise<void>>();

mockApi.tmux.getStatus = vi.fn<() => Promise<TmuxStatus>>();
```

**`vi.stubGlobal()`** — used for patching globals:
```typescript
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('window', { ...window, electronAPI: mockApi });
```

**`vi.stubEnv()`** — in `test/setup.ts`, stubs `HOME` to a temp directory for all tests.

**`vi.resetModules()` + `vi.clearAllMocks()`** — used in `beforeEach` for tests with platform-dependent module behavior (e.g., `CodexBinaryResolver.test.ts`).

**What to mock:**
- `window.electronAPI` — use `createMockElectronAPI()` / `installMockElectronAPI()` from `test/mocks/electronAPI.ts`
- Hooks in component tests — replace with `vi.fn().mockReturnValue(viewModel)`
- Node built-ins for platform-specific logic — `vi.mock('node:fs/promises', ...)`
- `@sentry/electron` and `@sentry/react` — always mocked globally in `test/setup.ts`

**What NOT to mock:**
- Pure domain logic functions (test them directly)
- Shared type utilities in `src/shared/`

## Fixtures and Factories

**Test Data Factories** — inline helper functions in test files:
```typescript
// test/main/services/analysis/ChunkBuilder.test.ts
function createMessage(overrides: Partial<ParsedMessage>): ParsedMessage {
  return {
    uuid: `msg-${Math.random().toString(36).slice(2, 11)}`,
    parentUuid: null,
    type: 'user',
    timestamp: new Date(),
    content: '',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}
```

**Base fixture objects** — defined at the top of each test file for reuse across tests:
```typescript
const baseStatus: TmuxStatus = { ... };
const idleSnapshot: TmuxInstallerSnapshot = { ... };
const baseViewModel: TmuxInstallerBannerViewModel = { ... };
```

**Fixture files** — JSON/JSONL files in `test/fixtures/`:
- `test/fixtures/extensions/*.json` — API response fixtures
- `test/fixtures/team/*.jsonl` — real JSONL session transcripts for integration tests
- `test/fixtures/team/task-change-ledger/*/` — per-scenario fixture directories with `manifest.json` + source files

**Shared store factory** — `test/renderer/store/storeTestUtils.ts`:
```typescript
import { createTestStore } from '../../../test/renderer/store/storeTestUtils';

const store = createTestStore(); // fresh isolated Zustand store instance
```

**Shared electronAPI mock** — `test/mocks/electronAPI.ts`:
```typescript
import { createMockElectronAPI, installMockElectronAPI } from '../../test/mocks/electronAPI';

const mock = installMockElectronAPI(); // stubs window.electronAPI
mock.getProjects.mockResolvedValue([fakeProject]);
```

## Coverage

**Provider:** v8 (built into Node.js)

**Default config** (`vitest.config.ts`):
- Includes: `src/**/*.ts`, `src/**/*.tsx`
- Excludes: `src/**/*.d.ts`, `src/main/index.ts`, `src/preload/index.ts`
- No minimum thresholds enforced (thresholds only in `vitest.critical.config.ts`)

**Critical path config** (`vitest.critical.config.ts`):
- Includes: `src/main/ipc/guards.ts`, `src/main/ipc/configValidation.ts`, `src/main/utils/pathDecoder.ts`, `src/main/services/discovery/ProjectPathResolver.ts`
- Minimum thresholds: lines 65%, functions 75%, branches 60%, statements 65%

**View Coverage:**
```bash
pnpm test:coverage                # Full coverage — output in coverage/
pnpm test:coverage:critical       # Critical path only with threshold enforcement
```

## Test Types

**Unit Tests (majority):**
- Scope: single function, class, or hook in isolation
- Location: `test/renderer/utils/`, `test/main/services/analysis/`, `src/features/*/core/domain/__tests__/`
- Approach: pure input → output, no I/O; mock all dependencies

**Integration Tests:**
- Scope: service + file system (using temp dirs), store slice + selector, multi-layer feature tests
- Location: `test/main/services/team/`, `test/features/`, `test/renderer/store/`
- Approach: uses real `fs` with temp HOME directory (stubbed in `test/setup.ts`); fixture JSONL files loaded from `test/fixtures/`

**Component Render Tests:**
- Scope: React component behavior via DOM assertions (no testing-library — uses raw `createRoot`)
- Location: `src/renderer/components/**/__tests__/`, `src/features/*/renderer/ui/__tests__/`
- Approach: `React.createElement` + `createRoot`, DOM queries (`querySelectorAll`), `act()` for async state
- Key pattern: mock all hooks and child components via `vi.mock()`

**Specialized Script Tests** (run with `tsx`, not vitest):
- `test:chunks` — chunk-building pipeline against real fixtures
- `test:semantic` — semantic step extraction against real JSONL transcripts
- `test:noise` — noise filtering logic
- `test:task-filtering` — task tool filtering

## Common Patterns

**Async Testing with React:**
```typescript
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);

await act(async () => {
  root.render(React.createElement(MyComponent));
  await Promise.resolve();
  await Promise.resolve(); // double flush for nested async state
});

expect(host.textContent).toContain('expected text');

act(() => { root.unmount(); });
```

**Hook Testing via Harness Component:**
```typescript
let capturedHook: HookResult | null = null;

function Harness(): React.JSX.Element | null {
  capturedHook = useMyHook();
  return null;
}

// Render Harness, then assert on capturedHook
```

**Error Testing:**
```typescript
mockApi.tmux.install.mockRejectedValueOnce(new Error('bridge failed'));

await act(async () => {
  await capturedHook?.install();
  await Promise.resolve();
});

expect(capturedHook?.viewModel.error).toBe('bridge failed');
```

**Platform-specific behavior:**
```typescript
function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true, writable: true });
}

beforeEach(() => {
  vi.resetModules();
  setPlatform('win32');
});
```

**`toMatchObject` for partial assertion** (preferred for complex domain objects):
```typescript
expect(result).toMatchObject({
  ok: true,
  plan: {
    mode: 'mixed_opencode_side_lanes',
    primaryMembers: [expect.objectContaining({ name: 'alice' })],
  },
});
```

---

*Testing analysis: 2026-04-28*
