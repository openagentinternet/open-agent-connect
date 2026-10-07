import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function read(relative) {
  return readFile(join(root, relative), 'utf8')
}

test('UserPanel maps an unusable runtime to the guided setup card, never a raw CLI error', async () => {
  const userPanel = await read('src/client/UserPanel.tsx')
  // The fallback probes the structured runtime check on a who() failure…
  assert.match(userPanel, /const check = await setup\.check\(\)/)
  assert.match(userPanel, /check\.status !== 'ok'/)
  // …renders the same card My Bots uses (guided install, localized copy)…
  assert.match(userPanel, /import \{ RuntimeSetupCard \} from '\.\/RuntimeSetupCard\.tsx'/)
  assert.match(userPanel, /<RuntimeSetupCard/)
  // …and the raw error string only survives when the runtime itself is ok.
  assert.match(userPanel, /Fall through: the raw error is the honest fallback/)
})

test('the runtimeSetup face is injected and forwarded to the User tab', async () => {
  const clientIndex = await read('src/client/index.ts')
  assert.match(clientIndex, /runtimeSetup: \{\s*\n\s*check: \(\) => api\.runtimeCheck\(\),/)
  assert.match(clientIndex, /install: \(\) => api\.runtimeInstall\(\),/)
  const settingsPanel = await read('src/client/PluginSettingsPanel.tsx')
  assert.match(settingsPanel, /runtimeSetup,/)
  assert.match(settingsPanel, /runtimeSetup=\{runtimeSetup\}/)
})

test('a guided runtime install creates the machine owner identity before returning', async () => {
  const hostIndex = await read('src/index.ts')
  // IDBots-style zero-touch account: post-install the host runs the
  // idempotent `user ensure` so the User tab lands on a profile, and the
  // daemon's fire-and-forget onboarding owns traffic account + free grant.
  assert.match(hostIndex, /resetLocalReadCache\(\)/)
  assert.match(hostIndex, /runMetabot\(\['user', 'ensure'\]/)
  assert.match(hostIndex, /if \(!hasIdentity\)/)
})

test('local reads locate the dist without a supported Node binary', async () => {
  const localRead = await read('src/local-read.ts')
  assert.match(localRead, /resolveLocalCliPath\(\)/)
  assert.doesNotMatch(localRead, /resolveCli\(\)/)
  // Caches reset after a guided install so a first-ever dist re-resolves.
  assert.match(localRead, /export function resetLocalReadCache/)
})

test('every CLI spawn merges the Electron run-as-node env', async () => {
  const cliBridge = await read('src/cli-bridge.ts')
  assert.match(cliBridge, /spawnEnv \? \{ \.\.\.env, \.\.\.spawnEnv \} : env/)
  assert.match(cliBridge, /resolution\.nodeSpawnEnv/)
  const scheduleRoutes = await read('src/schedule-routes.ts')
  assert.match(scheduleRoutes, /resolution\.nodeSpawnEnv \? \{ \.\.\.env, \.\.\.resolution\.nodeSpawnEnv \} : env/)
})
