import { promises as fs } from 'node:fs';
import path from 'node:path';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  buildLoomChainWriteRequest,
  isLoomProtocolName,
  LOOM_PROTOCOLS,
  validateLoomPayload,
  type LoomValidationResult,
} from '../../core/loom';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, readJsonFile } from './helpers';
import type { CliRuntimeContext } from '../types';

function commandUnsupportedFlag(flag: string): MetabotCommandResult<never> {
  return commandFailed('invalid_flag', `${flag} is not supported by metabot loom. Use metabot chain write for chain selection and actor selection.`);
}

function rejectChainWriteFlags(args: string[]): MetabotCommandResult<never> | null {
  if (args.includes('--chain')) {
    return commandUnsupportedFlag('--chain');
  }
  if (args.includes('--from')) {
    return commandUnsupportedFlag('--from');
  }
  return null;
}

function commandInvalidProtocol(protocol: string): MetabotCommandResult<never> {
  return commandFailed('invalid_protocol', `Unsupported Loom protocol: ${protocol}`);
}

function commandInvalidPayload(
  protocol: string,
  validation: LoomValidationResult,
): MetabotCommandResult<never> & { data: { validation: LoomValidationResult } } {
  return {
    ok: false,
    state: 'failed',
    code: 'invalid_payload',
    message: `Invalid loom ${protocol} payload.`,
    data: {
      validation,
    },
  };
}

function resolveOutPath(context: CliRuntimeContext, outPath: string): string {
  return path.isAbsolute(outPath) ? outPath : path.resolve(context.cwd, outPath);
}

async function readProtocolAndPayload(
  args: string[],
  context: CliRuntimeContext,
): Promise<
  | { ok: true; protocol: keyof typeof LOOM_PROTOCOLS; payload: Record<string, unknown> }
  | { ok: false; result: MetabotCommandResult<never> }
> {
  const protocol = readFlagValue(args, '--protocol');
  if (!protocol) {
    return { ok: false, result: commandMissingFlag('--protocol') };
  }
  if (!isLoomProtocolName(protocol)) {
    return { ok: false, result: commandInvalidProtocol(protocol) };
  }

  const payloadFile = readFlagValue(args, '--payload-file');
  if (!payloadFile) {
    return { ok: false, result: commandMissingFlag('--payload-file') };
  }

  return {
    ok: true,
    protocol,
    payload: await readJsonFile(context, payloadFile),
  };
}

async function runValidateCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const unsupportedFlag = rejectChainWriteFlags(args);
  if (unsupportedFlag) {
    return unsupportedFlag;
  }

  const input = await readProtocolAndPayload(args, context);
  if (!input.ok) {
    return input.result;
  }

  const validation = validateLoomPayload(input.protocol, input.payload);
  if (!validation.valid) {
    return commandInvalidPayload(input.protocol, validation);
  }

  return commandSuccess({
    protocol: input.protocol,
    path: validation.path,
    valid: true,
    payload: input.payload,
  });
}

async function runExportChainRequestCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const unsupportedFlag = rejectChainWriteFlags(args);
  if (unsupportedFlag) {
    return unsupportedFlag;
  }

  const input = await readProtocolAndPayload(args, context);
  if (!input.ok) {
    return input.result;
  }

  const result = buildLoomChainWriteRequest(input.protocol, input.payload);
  if (!result.request) {
    return commandInvalidPayload(input.protocol, result.validation);
  }

  const out = readFlagValue(args, '--out');
  if (!out) {
    return commandSuccess({
      protocol: input.protocol,
      path: result.request.path,
      request: result.request,
    });
  }

  const outPath = resolveOutPath(context, out);
  await fs.writeFile(outPath, `${JSON.stringify(result.request, null, 2)}\n`, 'utf8');

  return commandSuccess({
    outPath,
    protocol: input.protocol,
    path: result.request.path,
  });
}

export async function runLoomCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  switch (args[0]) {
    case 'validate':
      return runValidateCommand(args, context);
    case 'export-chain-request':
      return runExportChainRequestCommand(args, context);
    default:
      return commandUnknownSubcommand(`loom ${args.join(' ')}`.trim());
  }
}
