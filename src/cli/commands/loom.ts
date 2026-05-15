import { promises as fs } from 'node:fs';
import path from 'node:path';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import {
  buildLoomChainWriteRequest,
  isLoomProtocolName,
  LOOM_PROTOCOLS,
  validateLoomPayload,
  type LoomProtocolName,
  type LoomValidationResult,
} from '../../core/loom';
import {
  commandMissingFlag,
  commandUnknownSubcommand,
  hasFlag,
  readChainWriteFlag,
  readFileUploadChainFlag,
  readFlagValue,
} from './helpers';
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

function commandMissingArgument(argument: string): MetabotCommandResult<never> {
  return commandFailed('missing_argument', `Missing required argument ${argument}.`);
}

function readAllFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) {
      continue;
    }
    const value = args[index + 1];
    if (typeof value === 'string' && !value.startsWith('--')) {
      values.push(value);
    }
  }
  return values;
}

function readOptionalValue(args: string[], flag: string): {
  ok: true;
  value?: string;
} | { ok: false; result: MetabotCommandResult<never> } {
  if (!args.includes(flag)) {
    return { ok: true };
  }
  const value = readFlagValue(args, flag);
  if (!value || value.startsWith('--')) {
    return { ok: false, result: commandFailed('invalid_flag', `${flag} requires a value.`) };
  }
  return { ok: true, value };
}

function readRequiredValue(args: string[], flag: string): {
  ok: true;
  value: string;
} | { ok: false; result: MetabotCommandResult<never> } {
  const value = readFlagValue(args, flag);
  if (!value || value.startsWith('--')) {
    return { ok: false, result: commandMissingFlag(flag) };
  }
  return { ok: true, value };
}

function readOptionalChain(args: string[]): {
  ok: true;
  chain?: string;
} | { ok: false; result: MetabotCommandResult<never> } {
  const chainFlag = readChainWriteFlag(args);
  if (chainFlag.error) {
    return { ok: false, result: chainFlag.error };
  }
  return chainFlag.chain ? { ok: true, chain: chainFlag.chain } : { ok: true };
}

function readOptionalFileChain(args: string[]): {
  ok: true;
  fileChain?: string;
} | { ok: false; result: MetabotCommandResult<never> } {
  if (!args.includes('--file-chain')) {
    return { ok: true };
  }
  const fileChain = readFlagValue(args, '--file-chain');
  const fileChainFlag = fileChain && !fileChain.startsWith('--')
    ? readFileUploadChainFlag(['--chain', fileChain])
    : readFileUploadChainFlag(['--chain']);
  if (fileChainFlag.error) {
    return { ok: false, result: fileChainFlag.error };
  }
  return fileChainFlag.chain ? { ok: true, fileChain: fileChainFlag.chain } : { ok: true };
}

function parsePositiveScore(args: string[]): {
  ok: true;
  score: number;
} | { ok: false; result: MetabotCommandResult<never> } {
  const rawScore = readFlagValue(args, '--score');
  if (!rawScore || rawScore.startsWith('--')) {
    return { ok: false, result: commandMissingFlag('--score') };
  }
  const score = Number(rawScore);
  if (!Number.isInteger(score) || score <= 0) {
    return { ok: false, result: commandFailed('invalid_flag', '--score must be a positive integer.') };
  }
  return { ok: true, score };
}

function readTaskPinIdArgument(args: string[]): string | undefined {
  return args.slice(1).find((arg) => !arg.startsWith('-'));
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

function resolveInputPath(context: CliRuntimeContext, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(context.cwd, filePath);
}

function parseOptionalLimit(args: string[]): { ok: true; limit?: number } | { ok: false; result: MetabotCommandResult<never> } {
  const hasLimitFlag = args.includes('--limit');
  const rawLimit = readFlagValue(args, '--limit');
  if (!hasLimitFlag) {
    return { ok: true };
  }
  if (rawLimit === null) {
    return {
      ok: false,
      result: commandFailed('invalid_flag', '--limit must be a positive integer.'),
    };
  }
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit <= 0) {
    return {
      ok: false,
      result: commandFailed('invalid_flag', '--limit must be a positive integer.'),
    };
  }
  return { ok: true, limit };
}

function parseOptionalCurrency(args: string[]): { ok: true; currency?: string } | { ok: false; result: MetabotCommandResult<never> } {
  const hasCurrencyFlag = args.includes('--currency');
  const currency = readFlagValue(args, '--currency');
  if (!hasCurrencyFlag) {
    return { ok: true };
  }
  if (currency === null) {
    return {
      ok: false,
      result: commandFailed('invalid_flag', '--currency must be one of SPACE, BTC, DOGE, or OPCAT.'),
    };
  }
  if (!['SPACE', 'BTC', 'DOGE', 'OPCAT'].includes(currency)) {
    return {
      ok: false,
      result: commandFailed('invalid_flag', '--currency must be one of SPACE, BTC, DOGE, or OPCAT.'),
    };
  }
  return { ok: true, currency };
}

function invalidJsonValidation(
  protocol: LoomProtocolName,
  message: string,
): LoomValidationResult {
  return {
    valid: false,
    protocol,
    path: LOOM_PROTOCOLS[protocol].path,
    errors: [
      {
        path: '',
        code: 'invalid_json',
        message,
      },
    ],
  };
}

async function readLoomPayloadFile(
  context: CliRuntimeContext,
  protocol: LoomProtocolName,
  payloadFile: string,
): Promise<
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; validation: LoomValidationResult }
> {
  const raw = await context.readTextFile(resolveInputPath(context, payloadFile));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return {
      ok: false,
      validation: invalidJsonValidation(
        protocol,
        error instanceof Error ? error.message : 'payload file must contain valid JSON.',
      ),
    };
  }

  const validation = validateLoomPayload(protocol, parsed);
  if (!validation.valid) {
    return {
      ok: false,
      validation,
    };
  }

  return {
    ok: true,
    payload: parsed as Record<string, unknown>,
  };
}

async function readProtocolAndPayload(
  args: string[],
  context: CliRuntimeContext,
): Promise<
  | { ok: true; protocol: LoomProtocolName; payload: Record<string, unknown> }
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

  const payload = await readLoomPayloadFile(context, protocol, payloadFile);
  if (!payload.ok) {
    return { ok: false, result: commandInvalidPayload(protocol, payload.validation) };
  }

  return {
    ok: true,
    protocol,
    payload: payload.payload,
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

async function runSyncCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const limit = parseOptionalLimit(args);
  if (!limit.ok) {
    return limit.result;
  }
  const input: { limit?: number } = {};
  if (limit.limit !== undefined) {
    input.limit = limit.limit;
  }
  return context.dependencies.loom?.sync?.(input)
    ?? commandFailed('dependency_unavailable', 'Loom sync dependency is unavailable.');
}

async function runListCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const limit = parseOptionalLimit(args);
  if (!limit.ok) {
    return limit.result;
  }
  const currency = parseOptionalCurrency(args);
  if (!currency.ok) {
    return currency.result;
  }

  const input: { refresh: boolean; limit?: number; tag?: string; currency?: string } = {
    refresh: hasFlag(args, '--refresh'),
  };
  const tag = readFlagValue(args, '--tag');
  if (limit.limit !== undefined) {
    input.limit = limit.limit;
  }
  if (tag !== null) {
    input.tag = tag;
  }
  if (currency.currency !== undefined) {
    input.currency = currency.currency;
  }
  return context.dependencies.loom?.list?.(input)
    ?? commandFailed('dependency_unavailable', 'Loom list dependency is unavailable.');
}

async function runShowCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const taskPinId = args.slice(1).find((arg) => !arg.startsWith('-'));
  if (!taskPinId) {
    return commandMissingArgument('taskPinId');
  }
  return context.dependencies.loom?.show?.({
    taskPinId,
    refresh: hasFlag(args, '--refresh'),
  }) ?? commandFailed('dependency_unavailable', 'Loom show dependency is unavailable.');
}

async function runDraftTaskCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const wish = readFlagValue(args, '--wish');
  if (!wish || wish.startsWith('--')) {
    return commandMissingFlag('--wish');
  }
  const from = readFlagValue(args, '--from');
  if (args.includes('--from') && (!from || from.startsWith('--'))) {
    return commandFailed('invalid_flag', '--from requires a bot slug value.');
  }
  const input: { wish: string; from?: string; allowInvalid: boolean } = {
    wish,
    allowInvalid: hasFlag(args, '--allow-invalid'),
  };
  if (from) {
    input.from = from;
  }
  return context.dependencies.loom?.draftTask?.(input)
    ?? commandFailed('dependency_unavailable', 'Loom draft-task dependency is unavailable.');
}

async function runPostTaskCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const payloadFileInput = readOptionalValue(args, '--payload-file');
  if (!payloadFileInput.ok) {
    return payloadFileInput.result;
  }
  const wishInput = readOptionalValue(args, '--wish');
  if (!wishInput.ok) {
    return wishInput.result;
  }
  if (!payloadFileInput.value && !wishInput.value) {
    return commandMissingFlag('--payload-file or --wish');
  }
  if (payloadFileInput.value && wishInput.value) {
    return commandFailed('invalid_flag', 'Use exactly one of --payload-file or --wish.');
  }
  const fromInput = readOptionalValue(args, '--from');
  if (!fromInput.ok) {
    return fromInput.result;
  }
  const chainInput = readOptionalChain(args);
  if (!chainInput.ok) {
    return chainInput.result;
  }

  const input: {
    from?: string;
    payloadFile?: string;
    wish?: string;
    chain?: string;
    dryRun: boolean;
  } = {
    dryRun: hasFlag(args, '--dry-run'),
  };
  if (fromInput.value) input.from = fromInput.value;
  if (payloadFileInput.value) input.payloadFile = payloadFileInput.value;
  if (wishInput.value) input.wish = wishInput.value;
  if (chainInput.chain) input.chain = chainInput.chain;

  return context.dependencies.loom?.postTask?.(input)
    ?? commandFailed('dependency_unavailable', 'Loom post-task dependency is unavailable.');
}

async function runClaimAndStartCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const taskPinIdInput = readRequiredValue(args, '--task-pin-id');
  if (!taskPinIdInput.ok) return taskPinIdInput.result;
  const payoutAddressInput = readOptionalValue(args, '--payout-address');
  if (!payoutAddressInput.ok) return payoutAddressInput.result;
  const claimPinIdInput = readOptionalValue(args, '--claim-pin-id');
  if (!claimPinIdInput.ok) return claimPinIdInput.result;
  if (!payoutAddressInput.value && !claimPinIdInput.value) {
    return commandMissingFlag('--payout-address or --claim-pin-id');
  }
  const fromInput = readOptionalValue(args, '--from');
  if (!fromInput.ok) return fromInput.result;
  const messageInput = readOptionalValue(args, '--message');
  if (!messageInput.ok) return messageInput.result;
  const chainInput = readOptionalChain(args);
  if (!chainInput.ok) return chainInput.result;
  const fileChainInput = readOptionalFileChain(args);
  if (!fileChainInput.ok) return fileChainInput.result;

  const input: {
    from?: string;
    taskPinId: string;
    payoutAddress?: string;
    claimPinId?: string;
    chain?: string;
    fileChain?: string;
    message?: string;
    dryRun: boolean;
    resetWorkspace: boolean;
  } = {
    taskPinId: taskPinIdInput.value,
    dryRun: hasFlag(args, '--dry-run'),
    resetWorkspace: hasFlag(args, '--reset-workspace'),
  };
  if (fromInput.value) input.from = fromInput.value;
  if (payoutAddressInput.value) input.payoutAddress = payoutAddressInput.value;
  if (claimPinIdInput.value) input.claimPinId = claimPinIdInput.value;
  if (chainInput.chain) input.chain = chainInput.chain;
  if (fileChainInput.fileChain) input.fileChain = fileChainInput.fileChain;
  if (messageInput.value) input.message = messageInput.value;

  return context.dependencies.loom?.claimAndStart?.(input)
    ?? commandFailed('dependency_unavailable', 'Loom claim-and-start dependency is unavailable.');
}

async function runDevRoundCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const taskPinIdInput = readRequiredValue(args, '--task-pin-id');
  if (!taskPinIdInput.ok) return taskPinIdInput.result;
  const claimPinIdInput = readRequiredValue(args, '--claim-pin-id');
  if (!claimPinIdInput.ok) return claimPinIdInput.result;
  const fromInput = readOptionalValue(args, '--from');
  if (!fromInput.ok) return fromInput.result;
  const roundNoteInput = readOptionalValue(args, '--round-note');
  if (!roundNoteInput.ok) return roundNoteInput.result;
  const chainInput = readOptionalChain(args);
  if (!chainInput.ok) return chainInput.result;
  const fileChainInput = readOptionalFileChain(args);
  if (!fileChainInput.ok) return fileChainInput.result;

  const input: {
    from?: string;
    taskPinId: string;
    claimPinId: string;
    chain?: string;
    fileChain?: string;
    checks: string[];
    roundNote?: string;
  } = {
    taskPinId: taskPinIdInput.value,
    claimPinId: claimPinIdInput.value,
    checks: readAllFlagValues(args, '--check'),
  };
  if (fromInput.value) input.from = fromInput.value;
  if (chainInput.chain) input.chain = chainInput.chain;
  if (fileChainInput.fileChain) input.fileChain = fileChainInput.fileChain;
  if (roundNoteInput.value) input.roundNote = roundNoteInput.value;

  return context.dependencies.loom?.runDevRound?.(input)
    ?? commandFailed('dependency_unavailable', 'Loom run-dev-round dependency is unavailable.');
}

async function runDeliverCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const taskPinIdInput = readRequiredValue(args, '--task-pin-id');
  if (!taskPinIdInput.ok) return taskPinIdInput.result;
  const claimPinIdInput = readRequiredValue(args, '--claim-pin-id');
  if (!claimPinIdInput.ok) return claimPinIdInput.result;
  const fromInput = readOptionalValue(args, '--from');
  if (!fromInput.ok) return fromInput.result;
  const prTitleInput = readOptionalValue(args, '--pr-title');
  if (!prTitleInput.ok) return prTitleInput.result;
  const deliverySummaryInput = readOptionalValue(args, '--delivery-summary');
  if (!deliverySummaryInput.ok) return deliverySummaryInput.result;
  const chainInput = readOptionalChain(args);
  if (!chainInput.ok) return chainInput.result;

  const input: {
    from?: string;
    taskPinId: string;
    claimPinId: string;
    chain?: string;
    prTitle?: string;
    deliverySummary?: string;
    dryRun: boolean;
  } = {
    taskPinId: taskPinIdInput.value,
    claimPinId: claimPinIdInput.value,
    dryRun: hasFlag(args, '--dry-run'),
  };
  if (fromInput.value) input.from = fromInput.value;
  if (chainInput.chain) input.chain = chainInput.chain;
  if (prTitleInput.value) input.prTitle = prTitleInput.value;
  if (deliverySummaryInput.value) input.deliverySummary = deliverySummaryInput.value;

  return context.dependencies.loom?.deliver?.(input)
    ?? commandFailed('dependency_unavailable', 'Loom deliver dependency is unavailable.');
}

async function runAcceptAndPayCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const taskPinIdInput = readRequiredValue(args, '--task-pin-id');
  if (!taskPinIdInput.ok) return taskPinIdInput.result;
  const deliveryPinIdInput = readRequiredValue(args, '--delivery-pin-id');
  if (!deliveryPinIdInput.ok) return deliveryPinIdInput.result;
  const scoreInput = parsePositiveScore(args);
  if (!scoreInput.ok) return scoreInput.result;
  const commentInput = readRequiredValue(args, '--comment');
  if (!commentInput.ok) return commentInput.result;
  const fromInput = readOptionalValue(args, '--from');
  if (!fromInput.ok) return fromInput.result;
  const chainInput = readOptionalChain(args);
  if (!chainInput.ok) return chainInput.result;

  const input: {
    from?: string;
    taskPinId: string;
    deliveryPinId: string;
    score: number;
    comment: string;
    chain?: string;
    confirmPayment: boolean;
  } = {
    taskPinId: taskPinIdInput.value,
    deliveryPinId: deliveryPinIdInput.value,
    score: scoreInput.score,
    comment: commentInput.value,
    confirmPayment: hasFlag(args, '--confirm-payment'),
  };
  if (fromInput.value) input.from = fromInput.value;
  if (chainInput.chain) input.chain = chainInput.chain;

  return context.dependencies.loom?.acceptAndPay?.(input)
    ?? commandFailed('dependency_unavailable', 'Loom accept-and-pay dependency is unavailable.');
}

async function runReviewDeliveryCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const taskPinIdInput = readRequiredValue(args, '--task-pin-id');
  if (!taskPinIdInput.ok) return taskPinIdInput.result;
  const deliveryPinIdInput = readRequiredValue(args, '--delivery-pin-id');
  if (!deliveryPinIdInput.ok) return deliveryPinIdInput.result;
  const verdictInput = readRequiredValue(args, '--verdict');
  if (!verdictInput.ok) return verdictInput.result;
  if (verdictInput.value !== 'rejected' && verdictInput.value !== 'revision_needed') {
    return commandFailed('invalid_flag', '--verdict must be rejected or revision_needed.');
  }
  const scoreInput = parsePositiveScore(args);
  if (!scoreInput.ok) return scoreInput.result;
  const commentInput = readRequiredValue(args, '--comment');
  if (!commentInput.ok) return commentInput.result;
  const fromInput = readOptionalValue(args, '--from');
  if (!fromInput.ok) return fromInput.result;
  const chainInput = readOptionalChain(args);
  if (!chainInput.ok) return chainInput.result;

  const input: {
    from?: string;
    taskPinId: string;
    deliveryPinId: string;
    verdict: 'rejected' | 'revision_needed';
    score: number;
    comment: string;
    chain?: string;
    attachments: string[];
  } = {
    taskPinId: taskPinIdInput.value,
    deliveryPinId: deliveryPinIdInput.value,
    verdict: verdictInput.value,
    score: scoreInput.score,
    comment: commentInput.value,
    attachments: readAllFlagValues(args, '--attachment'),
  };
  if (fromInput.value) input.from = fromInput.value;
  if (chainInput.chain) input.chain = chainInput.chain;

  return context.dependencies.loom?.reviewDelivery?.(input)
    ?? commandFailed('dependency_unavailable', 'Loom review-delivery dependency is unavailable.');
}

async function runStateCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const taskPinId = readTaskPinIdArgument(args);
  if (!taskPinId) {
    return commandMissingArgument('taskPinId');
  }
  return context.dependencies.loom?.state?.({
    taskPinId,
    refresh: hasFlag(args, '--refresh'),
  }) ?? commandFailed('dependency_unavailable', 'Loom state dependency is unavailable.');
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
    case 'sync':
      return runSyncCommand(args, context);
    case 'list':
      return runListCommand(args, context);
    case 'show':
      return runShowCommand(args, context);
    case 'draft-task':
      return runDraftTaskCommand(args, context);
    case 'post-task':
      return runPostTaskCommand(args, context);
    case 'claim-and-start':
      return runClaimAndStartCommand(args, context);
    case 'run-dev-round':
      return runDevRoundCommand(args, context);
    case 'deliver':
      return runDeliverCommand(args, context);
    case 'accept-and-pay':
      return runAcceptAndPayCommand(args, context);
    case 'review-delivery':
      return runReviewDeliveryCommand(args, context);
    case 'state':
      return runStateCommand(args, context);
    default:
      return commandUnknownSubcommand(`loom ${args.join(' ')}`.trim());
  }
}
