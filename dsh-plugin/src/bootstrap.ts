import {
  runMetabot,
  resolveCli,
  type CliResolution,
  type MetabotCommandResult,
} from './cli-bridge.js'
import { emptyHealth, summarizeHealth, type HealthPayload } from './health.js'

const BOOTSTRAP_TIMEOUT_MS = 45_000

function resultMessage(result: MetabotCommandResult): string {
  if (result.message) return result.message
  if (result.ok) return result.state
  return result.code ?? result.state
}

function applyStep(result: MetabotCommandResult): { ok: boolean; message: string } {
  return { ok: result.ok && result.state === 'success', message: resultMessage(result) }
}

/**
 * Resolve CLI, start daemon, bind `metabot-*` into DSH skill roots.
 * Never throws: failures land on the health payload.
 */
export async function bootstrapHealth(
  env: NodeJS.ProcessEnv = process.env,
  run: typeof runMetabot = runMetabot,
  resolve: typeof resolveCli = resolveCli,
): Promise<HealthPayload> {
  const health = emptyHealth()
  let resolution: CliResolution
  try {
    resolution = resolve(env)
  } catch (error) {
    health.error = error instanceof Error ? error.message : String(error)
    return summarizeHealth(health)
  }
  health.cliPath = resolution.cliPath
  health.oacPath = resolution.oacPath
  health.nodePath = resolution.nodePath
  health.nodeVersion = resolution.nodeVersion

  try {
    health.daemon = applyStep(await run(['daemon', 'start'], {
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
      env,
      resolution,
    }))
  } catch (error) {
    health.daemon = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    if (resolution.oacPath) {
      health.skillBind = applyStep(await run(['install', '--host', 'dsh'], {
        timeoutMs: BOOTSTRAP_TIMEOUT_MS,
        env,
        resolution,
        entry: 'oac',
      }))
    } else {
      health.skillBind = applyStep(await run(['host', 'bind-skills', '--host', 'dsh'], {
        timeoutMs: BOOTSTRAP_TIMEOUT_MS,
        env,
        resolution,
      }))
    }
  } catch (error) {
    health.skillBind = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  if (!health.daemon.ok || !health.skillBind.ok) {
    health.error = [
      health.daemon.ok ? undefined : `daemon: ${health.daemon.message ?? 'failed'}`,
      health.skillBind.ok ? undefined : `skillBind: ${health.skillBind.message ?? 'failed'}`,
    ].filter(Boolean).join('; ')
  }

  return summarizeHealth(health)
}
