import type { LlmExecutionRequest } from '../types';
import type { LlmBackend, LlmBackendFactory } from './backend';
import { createAcpBackend } from './acp';

function buildHermesBackend(binaryPath: string, env: Record<string, string> | undefined, request: LlmExecutionRequest): LlmBackend {
  return createAcpBackend({
    provider: 'hermes',
    binaryPath,
    env,
    baseArgs: ['acp'],
    blockedArgs: {
      acp: { takesValue: false },
    },
    forcedEnv: {
      HERMES_YOLO_MODE: '1',
    },
    resumeMethod: 'session/resume',
    includeModelInNewSession: Boolean(request.model),
    gateNotificationsUntilPrompt: true,
  });
}

export function createHermesBackend(binaryPath: string, env?: Record<string, string>): LlmBackend {
  return {
    provider: 'hermes',
    execute(request, emitter, signal) {
      return buildHermesBackend(binaryPath, env, request).execute(request, emitter, signal);
    },
  };
}

export const hermesBackendFactory: LlmBackendFactory = createHermesBackend;
