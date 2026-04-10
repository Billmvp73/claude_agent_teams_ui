#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const runtimeBinaryName = process.platform === 'win32' ? 'claude-multimodel.exe' : 'claude-multimodel'
const bundledRuntimePath = path.join(repoRoot, '.generated', 'runtime-bundle', 'runtime', runtimeBinaryName)

function runOrExit(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  })

  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function ensureRuntimeBinary() {
  if (process.env.CLAUDE_CLI_PATH?.trim()) {
    return process.env.CLAUDE_CLI_PATH.trim()
  }

  if (!fs.existsSync(bundledRuntimePath)) {
    runOrExit('node', ['./scripts/prepare-runtime-bundle.mjs'], { cwd: repoRoot })
  }

  if (!fs.existsSync(bundledRuntimePath)) {
    console.error(`Bundled runtime binary was not prepared: ${bundledRuntimePath}`)
    process.exit(1)
  }

  return bundledRuntimePath
}

const runtimeBinaryPath = ensureRuntimeBinary()

runOrExit('pnpm', ['run', 'dev:ui'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    CLAUDE_CLI_PATH: runtimeBinaryPath,
  },
})
