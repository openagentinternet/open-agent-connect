import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readChainFlag, readFlagValue, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

export async function runChainCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'write') {
    return commandUnknownSubcommand(`chain ${args.join(' ')}`.trim());
  }

  const requestFile = readFlagValue(args, '--request-file');
  if (!requestFile) {
    return commandMissingFlag('--request-file');
  }

  const chainFlag = readChainFlag(args);
  if (chainFlag.error) {
    return chainFlag.error;
  }

  const handler = context.dependencies.chain?.write;
  if (!handler) {
    return commandFailed('not_implemented', 'Chain write handler is not configured.');
  }

  const request = await readJsonFile(context, requestFile);
  return handler(chainFlag.chain ? { ...request, network: chainFlag.chain } : request);
}
