/**
 * DSH plugin update discovery and one-click application.
 *
 * DSH's plugin manager owns installation and profile mutation; OAC never
 * downloads or replaces package files directly. The check reads the npm
 * `latest` dist-tag (or OAC_DSH_UPDATE_REGISTRY). Apply prefers DSH 0.2.2's
 * native `pluginManager.updateBundle` (registry resolution, compatibility
 * gate, and failure restore owned by the host) and falls back to the manual
 * remove + install + rollback path on kernels without it.
 */
import { readFileSync } from 'node:fs'

export const PLUGIN_PACKAGE_NAME = 'open-agent-connect-dsh'
export const DEFAULT_UPDATE_REGISTRY = 'https://registry.npmjs.org'
const UPDATE_CACHE_MS = 6 * 60 * 60 * 1000
const UPDATE_TIMEOUT_MS = 8_000

export interface PluginUpdateStatus {
  ok: boolean
  current: string
  latest?: string
  updateAvailable: boolean
  registry: string
  checkedAt: number
  releaseUrl?: string
  code?: string
  message?: string
}

export interface PluginUpdateApplyResult {
  ok: boolean
  current: string
  target: string
  application?: 'applied' | 'restart-required' | 'failed'
  version?: string
  message?: string
  code?: string
}

/** One `plugin-manager/update-state` step announced by DSH 0.2.2+ native updates. */
export type PluginUpdateStep = 'checking' | 'removing' | 'installing' | 'restoring'

/** Last announced native update progress, readable while an apply is in flight. */
export interface PluginUpdateProgressState {
  active: boolean
  step?: PluginUpdateStep
  from?: string
  to?: string
  startedAt?: number
  updatedAt?: number
}

interface RegistryLatest {
  name?: unknown
  version?: unknown
}

interface PluginBundleInfo {
  name: string
  version?: string
  source?: string
  removable?: boolean
}

interface PluginChangeResult {
  application?: 'applied' | 'restart-required' | 'failed' | 'cancelled' | 'overridden'
  version?: string
  error?: { code?: string; message?: string; diagnostic?: string }
}

/** DSH 0.2.2 `PluginUpdateResult`: how one native update ended. */
interface PluginUpdateOutcome {
  from?: string
  to?: string
  step?: 'check' | 'remove' | 'install'
  result: PluginChangeResult
  restore?: PluginChangeResult
}

export interface DshPluginManagerLike {
  listBundles(): Promise<ReadonlyArray<PluginBundleInfo>>
  removeBundle(name: string): Promise<PluginChangeResult>
  installBundle(spec: string, options?: { enabled?: boolean; saveExact?: boolean }): Promise<PluginChangeResult>
  /**
   * DSH 0.2.2 native third-party update: registry resolution, compatibility
   * gate, and automatic restore of the removed version on failure. Presence
   * is the feature detection; older kernels only expose the methods below.
   */
  updateBundle?(name: string, version: string, options?: { requestId?: string }): Promise<PluginUpdateOutcome>
}

interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>
}

let cached: { registry: string; current: string; status: PluginUpdateStatus } | undefined
let applying = false

/** Read the version of this built package without importing package.json as code. */
export function currentPluginVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
  return typeof manifest.version === 'string' && manifest.version.trim() !== '' ? manifest.version.trim() : '0.0.0'
}

/** Compare two semantic versions, including prerelease ordering, without a runtime dependency. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): { core: number[]; pre: string[] } | undefined => {
    const normalized = value.trim().replace(/^v/, '').split('+', 1)[0] ?? ''
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalized)
    if (match === null) return undefined
    return {
      core: [Number(match[1]), Number(match[2]), Number(match[3])],
      pre: match[4] === undefined ? [] : match[4].split('.'),
    }
  }
  const a = parse(left)
  const b = parse(right)
  if (a === undefined || b === undefined) return left.localeCompare(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  if (a.pre.length === 0 || b.pre.length === 0) {
    return a.pre.length === b.pre.length ? 0 : a.pre.length === 0 ? 1 : -1
  }
  const length = Math.max(a.pre.length, b.pre.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.pre[index]
    const rightPart = b.pre[index]
    if (leftPart === undefined || rightPart === undefined) return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined) {
      if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1
      continue
    }
    if (leftNumber !== undefined || rightNumber !== undefined) return leftNumber !== undefined ? -1 : 1
    const difference = leftPart.localeCompare(rightPart)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return 0
}

/** Validate and normalize the configurable registry root. */
export function updateRegistry(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.OAC_DSH_UPDATE_REGISTRY?.trim()
  const value = configured === undefined || configured === '' ? DEFAULT_UPDATE_REGISTRY : configured.replace(/\/+$/, '')
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined
  } catch {
    return undefined
  }
}

/** Clear the in-memory check cache (tests and a forced refresh). */
export function resetUpdateCacheForTests(): void {
  cached = undefined
}

/** Check the configured registry's `latest` dist-tag for this package. */
export async function checkPluginUpdate(options: {
  force?: boolean
  fetchImpl?: FetchLike
  registry?: string
  currentVersion?: string
  now?: () => number
  timeoutMs?: number
} = {}): Promise<PluginUpdateStatus> {
  const current = options.currentVersion ?? currentPluginVersion()
  const registry = options.registry ?? updateRegistry()
  const checkedAt = (options.now ?? Date.now)()
  if (registry === undefined) {
    return { ok: false, current, updateAvailable: false, registry: DEFAULT_UPDATE_REGISTRY, checkedAt, code: 'invalid_registry', message: 'invalid OAC_DSH_UPDATE_REGISTRY' }
  }
  if (options.force !== true) {
    const hit = cached
    if (hit !== undefined && hit.registry === registry && hit.current === current && options.now === undefined && Date.now() - hit.status.checkedAt < UPDATE_CACHE_MS) return hit.status
  }
  if (process.env.OAC_DSH_UPDATE_DISABLED === '1') {
    return { ok: false, current, updateAvailable: false, registry, checkedAt, code: 'disabled', message: 'update checks are disabled' }
  }
  const doFetch: FetchLike = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? UPDATE_TIMEOUT_MS)
  try {
    const response = await doFetch(registry + '/' + PLUGIN_PACKAGE_NAME + '/latest', {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (response.ok === false) {
      const message = 'registry returned HTTP ' + String(response.status)
      return { ok: false, current, updateAvailable: false, registry, checkedAt, code: 'registry_http', message }
    }
    const latest = await response.json() as RegistryLatest
    if (latest.name === PLUGIN_PACKAGE_NAME && typeof latest.version === 'string' && latest.version.trim().length > 0) {
      const target = latest.version.trim()
      const status: PluginUpdateStatus = {
        ok: true,
        current,
        latest: target,
        updateAvailable: compareVersions(target, current) > 0,
        registry,
        checkedAt,
        releaseUrl: 'https://www.npmjs.com/package/' + PLUGIN_PACKAGE_NAME + '/v/' + target,
      }
      cached = { registry, current, status }
      return status
    }
    return { ok: false, current, updateAvailable: false, registry, checkedAt, code: 'invalid_response', message: 'registry response did not identify a valid package version' }
  } catch (error) {
    return {
      ok: false,
      current,
      updateAvailable: false,
      registry,
      checkedAt,
      code: 'fetch_failed',
      message: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

function managerOf(ctx: { get?(key: string): unknown }): DshPluginManagerLike | undefined {
  return ctx.get?.('pluginManager') as DshPluginManagerLike | undefined
}

function failure(current: string, target: string, code: string, message: string): PluginUpdateApplyResult {
  return { ok: false, current, target, application: 'failed', code, message }
}

let applyProgress: PluginUpdateProgressState | undefined

/** Last announced native update progress; `active` clears once the apply settles. */
export function pluginUpdateProgress(): PluginUpdateProgressState {
  return applyProgress ?? { active: false }
}

type ApplyUpdateContext = {
  get?(key: string): unknown
  on?(event: string, listener: (...args: unknown[]) => void): unknown
  logger?: { warn?(message: string): void; info?(message: string): void }
}

/**
 * Track `plugin-manager/update-state` emissions for one native apply. Returns
 * the disposer; events carrying a foreign request id are ignored.
 */
function trackUpdateProgress(ctx: ApplyUpdateContext, requestId: string, from: string, to: string): () => void {
  const track = (step: PluginUpdateStep): void => {
    applyProgress = {
      active: true,
      step,
      from: applyProgress?.from ?? from,
      to: applyProgress?.to ?? to,
      startedAt: applyProgress?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
    }
  }
  track('checking')
  const listener = (...args: unknown[]): void => {
    const payload = args[0] as { requestId?: unknown; step?: unknown } | undefined
    if (payload === undefined || payload.requestId !== requestId) return
    if (payload.step !== 'checking' && payload.step !== 'removing' && payload.step !== 'installing' && payload.step !== 'restoring') return
    track(payload.step)
    ctx.logger?.info?.(`[oac-dsh] native plugin update: ${payload.step}`)
  }
  if (typeof ctx.on !== 'function') return () => undefined
  const off = ctx.on('plugin-manager/update-state', listener) as unknown
  return typeof off === 'function' ? off as () => void : () => undefined
}

/**
 * Native DSH 0.2.2+ path: the host owns registry resolution, the
 * compatibility gate, and restoring the removed version when the install
 * fails, so this side only maps the outcome onto the apply result.
 */
async function applyNativeUpdate(
  ctx: ApplyUpdateContext,
  updateBundle: NonNullable<DshPluginManagerLike['updateBundle']>,
  current: string,
  target: string,
  installed: PluginBundleInfo,
): Promise<PluginUpdateApplyResult> {
  const requestId = 'oac-update-' + Date.now().toString(36)
  const stopTracking = trackUpdateProgress(ctx, requestId, installed.version ?? current, target)
  try {
    const outcome = await updateBundle(PLUGIN_PACKAGE_NAME, target, { requestId })
    const change = outcome.result ?? {}
    if (change.application === 'failed' || change.application === 'cancelled') {
      const restored = outcome.restore !== undefined && outcome.restore.application !== 'failed' && outcome.restore.application !== 'cancelled'
      const message = (change.error?.diagnostic ?? change.error?.message ?? 'plugin update failed') + (restored ? '; the previously installed version was restored' : '')
      return failure(current, target, change.error?.code ?? (outcome.step === 'remove' ? 'remove_failed' : 'install_failed'), message)
    }
    const actual = change.version
    if (actual !== undefined && compareVersions(actual, target) !== 0) {
      return failure(current, target, 'version_mismatch', 'installed ' + actual + ' instead of ' + target + '; pnpm minimumReleaseAge may have held the target back')
    }
    const installedVersion = actual ?? target
    return {
      ok: true,
      current: installedVersion,
      target,
      application: change.application === 'restart-required' ? 'restart-required' : 'applied',
      version: installedVersion,
    }
  } finally {
    stopTracking()
    if (applyProgress !== undefined) applyProgress = { ...applyProgress, active: false }
  }
}

/**
 * Legacy path (kernels without updateBundle): remove the current bundle,
 * install the exact target, and reinstall the prior source when anything
 * fails so the profile is never left without OAC.
 */
async function applyLegacyUpdate(
  ctx: ApplyUpdateContext,
  manager: DshPluginManagerLike,
  current: string,
  target: string,
  installed: PluginBundleInfo,
): Promise<PluginUpdateApplyResult> {
  const rollback = installed.source ?? PLUGIN_PACKAGE_NAME + '@' + (installed.version ?? current)
  const removed = await manager.removeBundle(PLUGIN_PACKAGE_NAME)
  if (removed.application === 'failed') {
    return failure(current, target, removed.error?.code ?? 'remove_failed', removed.error?.message ?? 'could not remove the current plugin')
  }
  let installedResult: PluginChangeResult
  try {
    installedResult = await manager.installBundle(PLUGIN_PACKAGE_NAME + '@' + target, { enabled: true, saveExact: true })
  } catch (error) {
    installedResult = { application: 'failed', error: { message: error instanceof Error ? error.message : String(error) } }
  }
  if (installedResult.application === 'failed' || installedResult.application === 'cancelled') {
    // Removal already happened. Restore the previous source/version so a
    // failed update cannot silently leave the profile without OAC.
    try {
      await manager.installBundle(rollback, { enabled: true })
    } catch (rollbackError) {
      ctx.logger?.warn?.('[oac-dsh] update rollback failed: ' + (rollbackError instanceof Error ? rollbackError.message : String(rollbackError)))
    }
    return failure(current, target, installedResult.error?.code ?? 'install_failed', installedResult.error?.message ?? 'plugin installation failed')
  }
  const actual = installedResult.version
  if (actual !== undefined && compareVersions(actual, target) !== 0) {
    try {
      await manager.installBundle(rollback, { enabled: true })
    } catch (rollbackError) {
      ctx.logger?.warn?.('[oac-dsh] version-mismatch rollback failed: ' + (rollbackError instanceof Error ? rollbackError.message : String(rollbackError)))
    }
    return failure(current, target, 'version_mismatch', 'installed ' + actual + ' instead of ' + target + '; pnpm minimumReleaseAge may have held the target back')
  }
  const installedVersion = actual ?? target
  return {
    ok: true,
    current: installedVersion,
    target,
    application: installedResult.application === 'restart-required' ? 'restart-required' : 'applied',
    version: installedVersion,
  }
}

/**
 * Install the current npm latest through DSH pluginManager.
 * Prefers DSH 0.2.2's native `updateBundle`; the legacy remove/install path
 * remains the fallback on kernels without it. DSH performs the compatibility
 * gate and package-manager security checks for the new spec either way.
 */
export async function applyPluginUpdate(
  ctx: ApplyUpdateContext,
  options: { check?: () => Promise<PluginUpdateStatus> } = {},
): Promise<PluginUpdateApplyResult> {
  const current = currentPluginVersion()
  if (applying) return failure(current, '', 'in_progress', 'an update is already being applied')
  const manager = managerOf(ctx)
  if (manager === undefined) return failure(current, '', 'plugin_manager_unavailable', 'DSH pluginManager is unavailable in this profile')
  applying = true
  let target = ''
  try {
    const status = await (options.check ?? (() => checkPluginUpdate({ force: true })))()
    if (status.ok === false) return failure(current, status.latest ?? '', status.code ?? 'check_failed', status.message ?? 'update check failed')
    target = status.latest ?? ''
    if (status.updateAvailable === false || target === '' || compareVersions(target, current) <= 0) return failure(current, target, 'not_available', 'no newer plugin version is available')
    const before = await manager.listBundles()
    const installed = before.find((bundle) => bundle.name === PLUGIN_PACKAGE_NAME)
    if (installed === undefined) return failure(current, target, 'not_installed', 'this plugin is not installed as a profile bundle')
    if (installed.removable === false) return failure(current, target, 'not_removable', 'the installed plugin cannot be removed by the plugin manager')
    if (typeof manager.updateBundle === 'function') {
      return await applyNativeUpdate(ctx, manager.updateBundle.bind(manager), current, target, installed)
    }
    return await applyLegacyUpdate(ctx, manager, current, target, installed)
  } catch (error) {
    return failure(current, target, 'update_failed', error instanceof Error ? error.message : String(error))
  } finally {
    applying = false
  }
}
