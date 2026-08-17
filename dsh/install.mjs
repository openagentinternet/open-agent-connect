#!/usr/bin/env node
/**
 * Install the OAC-on-DSH agent preset.
 *
 * Copies `dsh/preset/*` and `dsh/plugins/*` into
 * `${DSH_HOME:-$HOME/.dsh}/.agent-presets/oac/` and bakes the absolute path of
 * this checkout's built metabot CLI (`<repo>/dist/cli/main.js`) into the
 * composition's `{{CLI_PATH}}` placeholder.
 *
 * Run from the repo root:  `node dsh/install.mjs`
 * The repo must be built first (`npm run build`) so `dist/cli/main.js` exists.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const cliPath = path.join(repoRoot, 'dist', 'cli', 'main.js')

if (!fs.existsSync(cliPath)) {
  console.error(`[oac-dsh] metabot CLI not found at ${cliPath}`)
  console.error('[oac-dsh] run `npm run build` in the repo first, then retry install.')
  process.exit(1)
}

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const presetDir = path.join(dshHome, '.agent-presets', 'oac')

fs.rmSync(presetDir, { recursive: true, force: true })
fs.mkdirSync(path.join(presetDir, 'plugins'), { recursive: true })

// Copy the composition + metadata, then the plugin modules (a row's relative
// `./plugins/...` specifier resolves against the composition directory, so the
// installed preset is self-contained and movable).
fs.cpSync(path.join(__dirname, 'preset'), presetDir, { recursive: true })
fs.cpSync(path.join(__dirname, 'plugins'), path.join(presetDir, 'plugins'), { recursive: true })

// Bake the concrete CLI path into the installed composition.
const compositionPath = path.join(presetDir, 'agent.cordis.yml')
let composition = fs.readFileSync(compositionPath, 'utf8')
if (!composition.includes('{{CLI_PATH}}')) {
  console.error(`[oac-dsh] no {{CLI_PATH}} placeholder found in ${compositionPath}; aborting.`)
  process.exit(1)
}
composition = composition.split('{{CLI_PATH}}').join(cliPath)
fs.writeFileSync(compositionPath, composition)

console.log(`[oac-dsh] installed OAC preset at ${presetDir}`)
console.log(`[oac-dsh] metabot CLI : ${cliPath}`)
console.log('[oac-dsh] start a new session on the "Open Agent Connect (MetaBot)" preset in the DSH UI')
console.log('[oac-dsh] to reinstall after rebuilding/relocating the repo, run this script again')
