import { commandFailed, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import { buildLoomChainWriteRequest, type LoomChainWriteRequest } from './chainRequest';
import { validateLoomPayload } from './validation';
import { writeLoomProtocolRecord, type LoomProtocolRecordWriteResult } from './workflowChain';

export interface LoomPostTaskWorkflowDryRunResult {
  dryRun: true;
  payload: Record<string, unknown>;
  request: LoomChainWriteRequest;
}

export type LoomTaskDraftDependencyResult =
  | Record<string, unknown>
  | MetabotCommandResult<unknown>;

export interface LoomPostTaskWorkflowInput {
  from?: string;
  payload?: Record<string, unknown>;
  payloadFile?: string;
  wish?: string;
  chain?: string;
  dryRun?: boolean;
  readPayloadFile?: (payloadFile: string) => Promise<Record<string, unknown>>;
  draftTask?: (wish: string) => Promise<LoomTaskDraftDependencyResult>;
  writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValidationMessage(errors: { path: string; message: string }[]): string {
  if (errors.length === 0) {
    return 'Loom task payload is invalid.';
  }
  return `Loom task payload is invalid: ${errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`;
}

function sourceCount(input: Pick<LoomPostTaskWorkflowInput, 'payload' | 'payloadFile' | 'wish'>): number {
  return [input.payload !== undefined, Boolean(input.payloadFile), Boolean(input.wish)]
    .filter(Boolean)
    .length;
}

function extractDraftPayload(result: LoomTaskDraftDependencyResult): MetabotCommandResult<Record<string, unknown>> {
  if (isRecord(result) && result.ok === false && typeof result.state === 'string') {
    return result as MetabotCommandResult<Record<string, unknown>>;
  }

  if (isRecord(result) && result.ok === true && result.state === 'success') {
    const data = result.data;
    if (isRecord(data) && isRecord(data.payload)) {
      return commandSuccess(data.payload);
    }
    if (isRecord(data)) {
      return commandSuccess(data);
    }
    return commandFailed('invalid_payload', 'Drafted loom task payload must be an object.');
  }

  if (isRecord(result)) {
    return commandSuccess(result);
  }

  return commandFailed('invalid_payload', 'Drafted loom task payload must be an object.');
}

async function resolvePayload(
  input: LoomPostTaskWorkflowInput,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  if (sourceCount(input) !== 1) {
    return commandFailed('invalid_source', 'Use exactly one of payload, payloadFile, or wish.');
  }

  if (input.payload !== undefined) {
    return commandSuccess(input.payload);
  }

  if (input.payloadFile) {
    if (!input.readPayloadFile) {
      return commandFailed('dependency_unavailable', 'Loom post-task payload-file reader is unavailable.');
    }
    let payload: Record<string, unknown>;
    try {
      payload = await input.readPayloadFile(input.payloadFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'payload file must contain valid JSON.';
      return commandFailed('invalid_payload', `Loom task payload file is invalid: ${message}`);
    }
    if (!isRecord(payload)) {
      return commandFailed('invalid_payload', 'Loom task payload must be an object.');
    }
    return commandSuccess(payload);
  }

  if (!input.draftTask) {
    return commandFailed('dependency_unavailable', 'Loom post-task draft dependency is unavailable.');
  }
  const draft = await input.draftTask(input.wish as string);
  return extractDraftPayload(draft);
}

export async function runLoomPostTaskWorkflow(
  input: LoomPostTaskWorkflowInput,
): Promise<MetabotCommandResult<LoomPostTaskWorkflowDryRunResult | LoomProtocolRecordWriteResult>> {
  const resolvedPayload = await resolvePayload(input);
  if (!resolvedPayload.ok) {
    return resolvedPayload;
  }

  const payload = resolvedPayload.data;
  const validation = validateLoomPayload('task', payload);
  if (!validation.valid) {
    return commandFailed('invalid_payload', formatValidationMessage(validation.errors));
  }

  const built = buildLoomChainWriteRequest('task', payload);
  if (built.request === null) {
    return commandFailed('invalid_payload', formatValidationMessage(built.validation.errors));
  }

  if (input.dryRun) {
    return commandSuccess({
      dryRun: true,
      payload,
      request: built.request,
    });
  }

  return writeLoomProtocolRecord({
    protocol: 'task',
    payload,
    from: input.from,
    chain: input.chain,
    writeChain: input.writeChain,
  });
}
