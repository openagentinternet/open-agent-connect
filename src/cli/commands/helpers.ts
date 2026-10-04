import path from 'node:path';
import type { Readable } from 'node:stream';
import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { CliRuntimeContext } from '../types';

export type CliWriteChainValue = 'mvc' | 'btc' | 'doge' | 'opcat';
export type CliFileUploadChainValue = 'mvc' | 'btc' | 'opcat';

export function readFlagValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  return typeof value === 'string' ? value : null;
}

export function readFromFlag(
  args: string[],
  options: { allowSlugAlias?: boolean } = {},
): string | undefined {
  return readFlagValue(args, '--from')
    ?? (options.allowSlugAlias ? readFlagValue(args, '--slug') : null)
    ?? undefined;
}

function readSupportedChainFlag<TChain extends string>(
  args: string[],
  supportedValues: readonly TChain[],
  unsupportedSuffix = '',
): { chain: TChain | null; error: MetabotCommandResult<never> | null } {
  const index = args.indexOf('--chain');
  if (index === -1) {
    return { chain: null, error: null };
  }

  const supportedText = supportedValues.join(', ');
  const rawValue = args[index + 1];
  if (typeof rawValue !== 'string' || rawValue.startsWith('--')) {
    return {
      chain: null,
      error: commandFailed('invalid_flag', `Missing value for --chain. Supported values: ${supportedText}.`),
    };
  }

  const normalized = rawValue.trim().toLowerCase();
  if (!supportedValues.includes(normalized as TChain)) {
    return {
      chain: null,
      error: commandFailed(
        'invalid_flag',
        `Unsupported --chain value: ${rawValue}. Supported values: ${supportedText}.${unsupportedSuffix}`,
      ),
    };
  }

  return {
    chain: normalized as TChain,
    error: null,
  };
}

export function readChainWriteFlag(args: string[]): {
  chain: CliWriteChainValue | null;
  error: MetabotCommandResult<never> | null;
} {
  return readSupportedChainFlag(args, ['mvc', 'btc', 'doge', 'opcat'] as const);
}

export function readFileUploadChainFlag(args: string[]): {
  chain: CliFileUploadChainValue | null;
  error: MetabotCommandResult<never> | null;
} {
  return readSupportedChainFlag(args, ['mvc', 'btc', 'opcat'] as const, ' DOGE is not supported for file upload.');
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export async function readJsonFile(
  context: CliRuntimeContext,
  filePath: string
): Promise<Record<string, unknown>> {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(context.cwd, filePath);
  const raw = await context.readTextFile(resolved);
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected JSON object input.');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Drain a stdin stream to EOF and return its content as UTF-8 text. Commands
 * that receive secrets (e.g. the owner mnemonic) read them through this
 * instead of argv, so the value never lands in shell history or process
 * listings.
 */
export async function readStdinText(stream: Readable = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function commandMissingFlag(flag: string): MetabotCommandResult<never> {
  return commandFailed('missing_flag', `Missing required flag ${flag}.`);
}

export function commandUnknownSubcommand(command: string): MetabotCommandResult<never> {
  return commandFailed('unknown_command', `Unknown command: ${command}`);
}
