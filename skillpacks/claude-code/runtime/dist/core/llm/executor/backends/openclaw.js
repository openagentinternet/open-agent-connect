"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openClawBackendFactory = void 0;
exports.createOpenClawBackend = createOpenClawBackend;
function createOpenClawBackend(binaryPath) {
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
exports.openClawBackendFactory = createOpenClawBackend;
