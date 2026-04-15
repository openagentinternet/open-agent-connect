import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandUnknownSubcommand } from './helpers';
import type { CliRuntimeContext } from '../types';

type WalletBalanceChain = 'all' | 'mvc' | 'btc';

function readWalletBalanceChainFlag(args: string[]): {
  chain: WalletBalanceChain;
  error: MetabotCommandResult<never> | null;
} {
  const index = args.indexOf('--chain');
  if (index === -1) {
    return { chain: 'all', error: null };
  }

  const rawValue = args[index + 1];
  if (typeof rawValue !== 'string' || rawValue.startsWith('--')) {
    return {
      chain: 'all',
      error: commandFailed('invalid_flag', 'Missing value for --chain. Supported values: all, mvc, btc.'),
    };
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized !== 'all' && normalized !== 'mvc' && normalized !== 'btc') {
    return {
      chain: 'all',
      error: commandFailed(
        'invalid_flag',
        `Unsupported --chain value: ${rawValue}. Supported values: all, mvc, btc.`
      ),
    };
  }

  return { chain: normalized, error: null };
}

export async function runWalletCommand(args: string[], context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  if (args[0] !== 'balance') {
    return commandUnknownSubcommand(`wallet ${args.join(' ')}`.trim());
  }

  const chainFlag = readWalletBalanceChainFlag(args);
  if (chainFlag.error) {
    return chainFlag.error;
  }

  const handler = context.dependencies.wallet?.balance;
  if (!handler) {
    return commandFailed('not_implemented', 'Wallet balance handler is not configured.');
  }

  return handler({ chain: chainFlag.chain });
}

