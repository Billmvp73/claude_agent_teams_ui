#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const runtimeLockPath = path.join(repoRoot, 'runtime.lock.json')
const defaultOutputDir = path.join(repoRoot, '.generated', 'runtime-bundle')

function parseArgs(argv) {
  let platform = null
  let outputDir = defaultOutputDir

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--platform' && argv[index + 1]) {
      platform = argv[index + 1]
      index += 1
      continue
    }
    if (arg.startsWith('--platform=')) {
      platform = arg.slice('--platform='.length)
      continue
    }
    if (arg === '--output' && argv[index + 1]) {
      outputDir = path.resolve(argv[index + 1])
      index += 1
      continue
    }
    if (arg.startsWith('--output=')) {
      outputDir = path.resolve(arg.slice('--output='.length))
    }
  }

  return {
    outputDir,
    platform: platform ?? detectRuntimePlatform(),
  }
}

function detectRuntimePlatform() {
  const arch = os.arch()
  switch (process.platform) {
    case 'darwin':
      if (arch === 'arm64') return 'darwin-arm64'
      if (arch === 'x64') return 'darwin-x64'
      break
    case 'linux':
      if (arch === 'x64') return 'linux-x64'
      break
    case 'win32':
      if (arch === 'x64') return 'win32-x64'
      break
    default:
      break
  }

  throw new Error(`Unsupported runtime platform: ${process.platform}-${arch}`)
}

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed with code ${result.status}`)
  }
}

async function downloadToFile(url, destination) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  await fs.promises.mkdir(path.dirname(destination), { recursive: true })
  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.promises.writeFile(destination, buffer)
}

async function main() {
  const { outputDir, platform } = parseArgs(process.argv.slice(2))
  const runtimeLock = JSON.parse(await fs.promises.readFile(runtimeLockPath, 'utf8'))
  const releaseBaseUrl = `https://github.com/${runtimeLock.repository}/releases/download/${runtimeLock.tag}`

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-teams-runtime-'))
  const manifestPath = path.join(tempDir, 'manifest.json')
  await downloadToFile(`${releaseBaseUrl}/manifest.json`, manifestPath)

  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'))
  const asset = manifest.assets?.[platform]
  if (!asset?.file || !asset?.sha256) {
    throw new Error(`Runtime asset metadata missing for ${platform}`)
  }

  const archivePath = path.join(tempDir, asset.file)
  await downloadToFile(`${releaseBaseUrl}/${asset.file}`, archivePath)

  const archiveBuffer = await fs.promises.readFile(archivePath)
  const actualSha = createHash('sha256').update(archiveBuffer).digest('hex')
  if (actualSha !== asset.sha256) {
    throw new Error(`Checksum mismatch for ${asset.file}: expected ${asset.sha256}, got ${actualSha}`)
  }

  await fs.promises.rm(outputDir, { recursive: true, force: true })
  await fs.promises.mkdir(outputDir, { recursive: true })

  if (asset.archiveKind === 'tar.gz') {
    runOrThrow('tar', ['-xzf', archivePath, '-C', outputDir])
  } else if (asset.archiveKind === 'zip') {
    if (process.platform === 'win32') {
      runOrThrow('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${outputDir.replaceAll("'", "''")}' -Force`,
      ])
    } else {
      runOrThrow('unzip', ['-o', archivePath, '-d', outputDir])
    }
  } else {
    throw new Error(`Unsupported archive kind: ${asset.archiveKind}`)
  }

  const binaryPath = path.join(outputDir, 'runtime', asset.binaryName)
  await fs.promises.access(binaryPath, fs.constants.F_OK)
  await fs.promises.writeFile(path.join(outputDir, 'runtime', '.gitkeep'), '')

  console.log(binaryPath)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
