# Coding Conventions

**Analysis Date:** 2026-04-28

## Naming Patterns

**Files:**
- Services/Classes: PascalCase — `ChunkBuilder.ts`, `ProjectScanner.ts`, `FileSystemProvider.ts`
- Utilities: camelCase — `pathDecoder.ts`, `formatters.ts`, `taskReferenceUtils.ts`
- React components: PascalCase — `KanbanTaskCard.tsx`, `MemberBadge.tsx`
- React hooks: camelCase prefixed with `use` — `useTheme.ts`, `useCreateTeamDraft.ts`
- Test files: mirror source name with `.test.ts` or `.test.tsx` suffix

**Functions:**
- Regular functions: camelCase — `encodePath()`, `formatDuration()`
- Type guards: `isXxx` prefix — `isUserChunk()`, `isAIChunk()`, `isParsedRealUserMessage()`
- Builders: `buildXxx` prefix — `buildChunks()`, `buildUserChunk()`, `buildSubagentDetail()`
- Getters: `getXxx` prefix — `getResponses()`, `getSessionDetail()`
- React components: PascalCase arrow functions (enforced by ESLint `react/function-component-definition`)

**Variables:**
- Local variables: camelCase
- Module-level constants: UPPER_SNAKE_CASE — `PARALLEL_WINDOW_MS`, `EMPTY_METRICS`
- Static readonly class properties: camelCase or UPPER_SNAKE_CASE

**Types and Interfaces:**
- All types/interfaces/enums: PascalCase — `ParsedMessage`, `AppState`, `SessionDetail`
- Interfaces must NOT start with `I` (enforced: `^I[A-Z]` regex ban in ESLint)
- Enum members: PascalCase or UPPER_SNAKE_CASE

**Unused identifiers:**
- Prefix with `_` to suppress lint warnings — `_unusedParam`, `_error`

## Code Style

**Formatter:** Prettier 3.x (`/.prettierrc.json`)
- `semi: true` — semicolons required
- `singleQuote: true` — single quotes for JS/TS strings
- `jsxSingleQuote: false` — double quotes in JSX attributes
- `tabWidth: 2`
- `trailingComma: "es5"` — trailing commas in arrays/objects, not function params
- `printWidth: 100`
- `arrowParens: "always"` — always wrap arrow function params: `(x) => x`
- `endOfLine: "lf"`
- `bracketSameLine: false`
- Plugin: `prettier-plugin-tailwindcss` for automatic Tailwind class sorting

**Linting:** ESLint 9.x with flat config (`/eslint.config.js`)
- `typescript-eslint` recommended + type-checked + stylistic
- `sonarjs` for code quality and bug detection
- `eslint-plugin-security` for common security mistakes
- `eslint-plugin-boundaries` for Electron three-process architecture enforcement
- `eslint-plugin-import` for cycle detection (`maxDepth: 3`) and unresolved imports
- `eslint-plugin-simple-import-sort` for enforced import ordering
- Key rules enforced:
  - `prefer-const: error`, `no-var: error`, `eqeqeq: error`
  - `@typescript-eslint/consistent-type-imports: warn` — use `import type` for type-only imports
  - `@typescript-eslint/consistent-type-exports: error` — use `export type` where applicable
  - `@typescript-eslint/explicit-function-return-type: warn` — explicit return types encouraged
  - `@typescript-eslint/no-floating-promises: warn` — floating promises must be handled or voided
  - `import/no-default-export: warn` — prefer named exports
  - `import/no-cycle: error` — no circular imports (max depth 3)
  - `no-param-reassign: warn` — avoid mutating parameters

**React component definition** (enforced by ESLint):
```typescript
// Correct: arrow function
export const MyComponent = ({ name }: Props): React.JSX.Element => {
  return <div>{name}</div>;
};

// Wrong: function declaration (ESLint error)
export function MyComponent({ name }: Props) { ... }
```

## Import Organization

Imports are enforced by `eslint-plugin-simple-import-sort` in this exact order:

1. Side effect imports — `import './styles.css'`
2. Node.js builtins — `import path from 'node:path'` (use `node:` prefix)
3. React and react-dom — `import React from 'react'`
4. External packages — `import { create } from 'zustand'`
5. Internal path aliases
6. Parent imports (`../`)
7. Same-folder imports (`./`)
8. Type imports (inline `type` keyword, sorted last within each group)

**Path Aliases** (defined in `tsconfig.json` and `vitest.config.ts`):
- `@main/*` → `src/main/*`
- `@renderer/*` → `src/renderer/*`
- `@shared/*` → `src/shared/*`
- `@preload/*` → `src/preload/*`
- `@features/*` → `src/features/*`
- `@claude-teams/agent-graph` → `packages/agent-graph/src/index.ts`

**Type imports** use inline syntax:
```typescript
import { type AppState, createStore } from './store';
import type { ParsedMessage } from '@main/types';
```

**ESLint disable comments** require a description and must be re-enabled:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy API shape
```

## Module Boundaries (Electron Architecture)

ESLint `boundaries/element-types` enforces strict process isolation:
- `src/renderer/**` — can only import from `renderer` and `shared`
- `src/main/**` — can only import from `main` and `shared`
- `src/preload/**` — can only import from `preload` and `shared`
- `src/shared/**` — can import from `shared` and `main` (for type re-exports)

**Feature slices** (`src/features/<feature-name>/`) follow canonical slice architecture defined in `docs/FEATURE_ARCHITECTURE_STANDARD.md`, with reference implementation at `src/features/recent-projects/`:
- `core/domain/` — pure, process-agnostic; no Electron/React/Node platform imports allowed
- `core/application/` — use-cases; depends only on ports and domain, no runtime adapters
- `contracts/` — public interface types shared across processes
- `main/` — Electron main process adapter
- `preload/` — Electron preload bridge
- `renderer/` — React UI adapter
  - `renderer/ui/` — presentational only; no store/API/Electron imports

**Cross-feature import rule** (enforced per feature in `eslint.config.js`):
```typescript
// Correct: import through public entrypoint only
import { SomeType } from '@features/recent-projects/contracts';
import { SomeRenderer } from '@features/recent-projects/renderer';

// Wrong: importing internal slice directly (ESLint error)
import { internals } from '@features/recent-projects/core/domain/internals';
```

## Barrel Exports

`src/main/services/` and its domain subdirectories export via `index.ts`:
```typescript
// src/main/services/index.ts
export * from './analysis';
export * from './discovery';
export * from './error';
export * from './extensions';
export * from './infrastructure';
export * from './parsing';
```

```typescript
// Preferred — use barrel
import { ChunkBuilder, ProjectScanner } from '@main/services';
// Also valid — use domain barrel
import { ChunkBuilder } from '@main/services/analysis';
```

**Renderer utils/hooks/types do NOT have barrel exports** — import directly:
```typescript
import { formatDuration } from '@renderer/utils/formatters';
import { useTheme } from '@renderer/hooks/useTheme';
```

## Type Guards

Type guards follow `isXxx` naming with TypeScript type predicates. Key guards:

```typescript
// Message type guards — src/main/types/messages.ts
isParsedRealUserMessage(msg)     // isMeta: false, string content
isParsedInternalUserMessage(msg) // isMeta: true, array content
isAssistantMessage(msg)          // type: "assistant"

// Chunk type guards — src/main/types/
isUserChunk(chunk)    // type: "user"
isAIChunk(chunk)      // type: "ai"
isSystemChunk(chunk)  // type: "system"
isCompactChunk(chunk) // type: "compact"
```

## Error Handling

- Main process: `try/catch`, `console.error`, return safe defaults
- Renderer: error state stored in Zustand store slices
- IPC handlers: validate parameters before processing; degrade gracefully on failure
- Floating promises in event handlers: use `void` operator or `.catch()`

## Logging

- Main process: `createLogger(name)` from `@shared/utils/logger` returns a named logger
- `logger.error` always visible; `info`/`warn` suppressed in production builds
- `console` statements allowed in `src/main/**` (ESLint `no-console: off`)
- Renderer: avoid direct `console` calls; surface errors via Zustand store state

## Comments

**JSDoc style** for exported functions and classes:
```typescript
/**
 * ChunkBuilder service - Builds visualization chunks from parsed session data.
 *
 * Responsibilities:
 * - Group messages into chunks
 * - Attach subagents to chunks
 */
```

**Section dividers** for logical groupings in longer files:
```typescript
// =============================================================================
// Types
// =============================================================================
```

## Storage and Persistence

- New persistence flows depend on small repository/storage abstractions — not directly on `localStorage`, `IndexedDB`, Electron APIs, or raw JSON files from UI components/hooks
- Split responsibilities: schema/normalization → repository interface → concrete implementation → UI adapter (separate modules)
- Design for swappability: feature code must be able to switch local Electron storage for server-backed storage without rewriting the rendering layer
- Reuse generic persistence/layout infrastructure for new draggable/resizable surfaces; do not copy feature-specific storage code

## Agent Block Utilities

For agent-only content injected into messages:
```typescript
import { wrapAgentBlock, stripAgentBlocks, unwrapAgentBlock } from '@shared/constants/agentBlocks';

// Wrap — do NOT manually concatenate AGENT_BLOCK_OPEN/CLOSE
wrapAgentBlock(text)

// Strip for UI display
stripAgentBlocks(text)
```

---

*Convention analysis: 2026-04-28*
