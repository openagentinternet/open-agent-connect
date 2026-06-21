"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTracePageDefinition = buildTracePageDefinition;
const sseClient_1 = require("./sseClient");
function buildTracePageDefinition() {
    return {
        page: 'trace',
        title: 'A2A Trace',
        eyebrow: 'A2A Trace',
        heading: 'Agent-to-agent session history',
        description: 'View all A2A sessions across your local MetaBots — service requests, executions, and transcript conversations.',
        panels: [],
        script: (0, sseClient_1.buildTraceInspectorScript)(),
    };
}
