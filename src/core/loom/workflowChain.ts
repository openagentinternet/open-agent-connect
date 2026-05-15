import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../contracts/commandResult';
import {
  buildLoomChainWriteRequest,
  type LoomChainWriteRequest,
} from './chainRequest';
import type { LoomProtocolName } from './protocols';

export interface LoomProtocolRecordWriteInput {
  protocol: LoomProtocolName;
  payload: Record<string, unknown>;
  from?: string;
  chain?: string;
  writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
}

export interface LoomProtocolRecordWriteResult {
  pinId: string;
  txids?: string[];
  request: LoomChainWriteRequest;
  network?: string;
  globalMetaId?: string;
  mvcAddress?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length > 0 ? strings : undefined;
}

function formatValidationMessage(errors: { path: string; message: string }[]): string {
  if (errors.length === 0) {
    return 'Loom payload is invalid.';
  }
  return `Loom payload is invalid: ${errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`;
}

function formatWriteFailure(result: MetabotCommandResult<unknown>): string {
  const code = result.code ? `${result.code}: ` : '';
  return `${code}${result.message ?? 'Chain writer returned a failed result.'}`;
}

function serializeThrownCause(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return error;
}

function commandFailedWithCause(
  code: string,
  message: string,
  cause: unknown,
): MetabotCommandResult<never> {
  return commandFailed(code, message, { data: { cause } });
}

export async function writeLoomProtocolRecord(
  input: LoomProtocolRecordWriteInput,
): Promise<MetabotCommandResult<LoomProtocolRecordWriteResult>> {
  const built = buildLoomChainWriteRequest(input.protocol, input.payload);
  if (built.request === null) {
    return commandFailed('invalid_payload', formatValidationMessage(built.validation.errors));
  }

  const writeRequest: Record<string, unknown> = {
    ...built.request,
    ...(input.from ? { from: input.from } : {}),
    ...(input.chain ? { network: input.chain } : {}),
  };

  let writeResult: MetabotCommandResult<unknown>;
  try {
    writeResult = await input.writeChain(writeRequest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return commandFailedWithCause(
      'chain_write_failed',
      `Loom chain write failed: ${message}`,
      serializeThrownCause(error),
    );
  }

  if (!writeResult.ok) {
    return commandFailedWithCause(
      'chain_write_failed',
      `Loom chain write failed: ${formatWriteFailure(writeResult)}`,
      writeResult,
    );
  }

  if (!isRecord(writeResult.data)) {
    return commandFailed('chain_write_failed', 'Loom chain write failed: writer returned no result data.');
  }

  const pinId = optionalString(writeResult.data.pinId);
  if (!pinId) {
    return commandFailed('chain_write_failed', 'Loom chain write failed: writer result did not include pinId.');
  }

  return commandSuccess({
    pinId,
    txids: optionalStringArray(writeResult.data.txids),
    request: built.request,
    network: optionalString(writeResult.data.network),
    globalMetaId: optionalString(writeResult.data.globalMetaId),
    mvcAddress: optionalString(writeResult.data.mvcAddress),
  });
}
