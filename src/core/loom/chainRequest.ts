import { LOOM_PROTOCOLS, type LoomProtocolName } from './protocols';
import { validateLoomPayload, type LoomValidationResult } from './validation';

export interface LoomChainWriteRequest {
  operation: 'create';
  path: string;
  encryption: '0';
  version: '1.0.0';
  contentType: 'application/json';
  payload: string;
}

export type LoomChainWriteRequestBuildResult =
  | {
      request: LoomChainWriteRequest;
      validation: LoomValidationResult;
    }
  | {
      request: null;
      code: 'invalid_payload';
      validation: LoomValidationResult;
    };

export function buildLoomChainWriteRequest(
  protocol: LoomProtocolName,
  payload: Record<string, unknown>,
): LoomChainWriteRequestBuildResult {
  const spec = LOOM_PROTOCOLS[protocol];
  const validation = validateLoomPayload(protocol, payload);

  if (!validation.valid) {
    return {
      request: null,
      code: 'invalid_payload',
      validation,
    };
  }

  return {
    request: {
      operation: 'create',
      path: spec.path,
      encryption: '0',
      version: spec.version,
      contentType: spec.contentType,
      payload: JSON.stringify(payload),
    },
    validation,
  };
}
