import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { normalizeSystemHomeDir } from '../../core/state/homeSelection';
import { buildCliShimDoctorCheck } from '../../core/state/cliShimDoctor';
import { CLI_VERSION } from '../version';
import type { CliRuntimeContext } from '../types';

function hasDoctorChecks(data: unknown): data is { checks: unknown[]; [key: string]: unknown } {
  return Boolean(data)
    && typeof data === 'object'
    && Array.isArray((data as { checks?: unknown[] }).checks);
}

export async function runDoctorCommand(_args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const handler = context.dependencies.doctor?.run;
  if (!handler) {
    return commandFailed('not_implemented', 'Doctor handler is not configured.');
  }
  const result = await handler();
  if (!result.ok || result.state !== 'success' || !hasDoctorChecks(result.data)) {
    return result;
  }

  const cliShimCheck = await buildCliShimDoctorCheck(
    normalizeSystemHomeDir(context.env, context.cwd),
    context.env,
    context.cwd,
  );

  return {
    ...result,
    data: {
      ...result.data,
      version: CLI_VERSION,
      checks: [...result.data.checks, cliShimCheck],
    },
  };
}
