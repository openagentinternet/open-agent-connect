/**
 * Daemon-pinned CLI runs for timer-driven host pollers.
 *
 * The CLI's `ensureDaemonBaseUrl` treats a daemon whose `/api/daemon/status`
 * probe exceeds 1.5s as gone: it stops the process and starts a replacement.
 * That is right for user-initiated commands, but a busy daemon (grouptask
 * engine sweep over every profile, post-boot warm-up) can answer slower than
 * that budget while being perfectly healthy — and a daemon that gets killed
 * during warm-up never gets faster. Pollers on an 8–30s cadence then replace
 * it again and again: a self-sustaining restart storm that wedges every panel
 * (each replacement window costs seconds and resets all daemon caches).
 *
 * Pinning `METABOT_DAEMON_BASE_URL` (resolved from the daemon record) makes
 * the CLI skip the probe/stop/start dance entirely and just talk to the URL;
 * a slow or down daemon fails the tick, which retries next tick. When no
 * daemon record exists the tick is skipped outright — background ticks must
 * never be the ones to boot or replace the daemon.
 */
import { resolveDaemonBaseUrl } from './browser-bridge.js'
import { runMetabot, type MetabotCommandResult, type RunMetabotOptions } from './cli-bridge.js'

export const DAEMON_PINNED_SKIP: MetabotCommandResult = {
  ok: false,
  state: 'failed',
  code: 'daemon_unreachable',
  message: 'OAC daemon is not running; background tick skipped (pollers never start or replace the daemon).',
}

export async function runMetabotPinned(
  args: string[],
  options: Omit<RunMetabotOptions, 'env'> = {},
  spawnCli: typeof runMetabot = runMetabot,
): Promise<MetabotCommandResult> {
  const baseUrl = await resolveDaemonBaseUrl()
  if (!baseUrl) return DAEMON_PINNED_SKIP
  return spawnCli(args, {
    ...options,
    env: { ...process.env, METABOT_DAEMON_BASE_URL: baseUrl },
  })
}
