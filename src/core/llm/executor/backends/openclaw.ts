import type { LlmBackend, LlmBackendFactory } from './backend';

export function createOpenClawBackend(binaryPath: string): LlmBackend {
  return {
    provider: 'openclaw',
    async execute(_request, emitter) {
      const message = `OpenClaw LLM executor backend is not implemented in Phase 1. Binary path: ${binaryPath}`;
      emitter.emit({ type: 'error', message });
      return {
        status: 'failed',
        output: '',
        error: message,
        durationMs: 0,
      };
    },
  };
}

export const openClawBackendFactory: LlmBackendFactory = createOpenClawBackend;
