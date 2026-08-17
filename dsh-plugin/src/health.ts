export type StepStatus = {
  ok: boolean
  message?: string
}

/** Host apply health: CLI path, daemon, skill bind. Failure is loud here, not a DSH crash. */
export type HealthPayload = {
  ok: boolean
  cliPath: string | null
  oacPath: string | null
  nodePath: string | null
  nodeVersion: string | null
  daemon: StepStatus
  skillBind: StepStatus
  error?: string
}

export function emptyHealth(): HealthPayload {
  return {
    ok: false,
    cliPath: null,
    oacPath: null,
    nodePath: null,
    nodeVersion: null,
    daemon: { ok: false },
    skillBind: { ok: false },
  }
}

export function summarizeHealth(health: HealthPayload): HealthPayload {
  const ok = health.cliPath !== null
    && health.daemon.ok
    && health.skillBind.ok
    && health.error === undefined
  return { ...health, ok }
}
