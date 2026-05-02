import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue } from './helpers';
import type { CliRuntimeContext } from '../types';

export async function runTraceCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'get' && args[0] !== 'watch') {
    return commandUnknownSubcommand(`trace ${args.join(' ')}`.trim());
  }

  if (args[0] === 'watch') {
    const traceId = readFlagValue(args, '--trace-id');
    if (!traceId) {
      return commandMissingFlag('--trace-id');
    }

    const handler = context.dependencies.trace?.watch;
    if (!handler) {
      return commandFailed('not_implemented', 'Trace watch handler is not configured.');
    }
    const stream = await handler({ traceId });
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
  if (!traceId && !sessionId) {
    return commandFailed('missing_trace_selector', 'Trace get requires --trace-id or --session-id.');
  }

  const handler = context.dependencies.trace?.get;
  if (!handler) {
    return commandFailed('not_implemented', 'Trace handler is not configured.');
  }
  return handler(sessionId ? { sessionId } : { traceId: traceId || '' });
}
