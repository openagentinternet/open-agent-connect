import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, hasFlag, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

function readLimit(args: string[], fallback: number): number {
  const raw = readFlagValue(args, '--limit');
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function runTraceCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'get' && args[0] !== 'watch' && args[0] !== 'sessions') {
    return commandUnknownSubcommand(`trace ${args.join(' ')}`.trim());
  }

  if (args[0] === 'sessions') {
    const handler = context.dependencies.trace?.listSessions;
    if (!handler) {
      return commandFailed('not_implemented', 'Trace session list handler is not configured.');
    }
    const from = readFlagValue(args, '--from') || undefined;
    return handler({
      ...(from ? { from } : {}),
      all: hasFlag(args, '--all'),
      limit: readLimit(args, 50),
    });
  }

  if (args[0] === 'watch') {
    const traceId = readFlagValue(args, '--trace-id');
    const from = readFlagValue(args, '--from') || undefined;
    if (!traceId) {
      return commandMissingFlag('--trace-id');
    }

    const handler = context.dependencies.trace?.watch;
    if (!handler) {
      return commandFailed('not_implemented', 'Trace watch handler is not configured.');
    }
    const stream = await handler({ traceId, ...(from ? { from } : {}) });
    context.stdout.write(stream);
    const streamedResult = commandSuccess({
      traceId,
      streamed: true,
    }) as MetabotCommandResult<unknown> & {
      __rawStdoutHandled?: boolean;
    };
    streamedResult.__rawStdoutHandled = true;
    return streamedResult;
  }

  const traceId = readFlagValue(args, '--trace-id');
  const sessionId = readFlagValue(args, '--session-id');
  const from = readFlagValue(args, '--from') || undefined;
  if (!traceId && !sessionId) {
    return commandFailed('missing_trace_selector', 'Trace get requires --trace-id or --session-id.');
  }

  const handler = context.dependencies.trace?.get;
  if (!handler) {
    return commandFailed('not_implemented', 'Trace handler is not configured.');
  }
  return handler(sessionId
    ? { sessionId, ...(from ? { from } : {}) }
    : { traceId: traceId || '', ...(from ? { from } : {}) });
}
