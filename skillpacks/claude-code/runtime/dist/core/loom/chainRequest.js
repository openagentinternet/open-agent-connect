"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLoomChainWriteRequest = buildLoomChainWriteRequest;
const protocols_1 = require("./protocols");
const validation_1 = require("./validation");
function buildLoomChainWriteRequest(protocol, payload) {
    const spec = protocols_1.LOOM_PROTOCOLS[protocol];
    const validation = (0, validation_1.validateLoomPayload)(protocol, payload);
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
