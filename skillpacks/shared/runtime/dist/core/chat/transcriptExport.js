"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportSessionArtifacts = exportSessionArtifacts;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function formatConnectedAgentLabel(options) {
    const name = normalizeText(options.name);
    const globalMetaId = normalizeText(options.globalMetaId);
    if (name && globalMetaId) {
        return `${name} (${globalMetaId})`;
    }
    if (name) {
        return name;
    }
    if (globalMetaId) {
        return globalMetaId;
    }
    return options.fallback;
}
function renderTimeoutNote(prefix) {
    if (prefix === 'transcript') {
        return 'Foreground timeout reached; the remote MetaBot may still continue processing.';
    }
    return 'Trace remains inspectable after timeout; remote completion may still arrive later.';
}
function buildCallerLabel(trace) {
    if (trace.a2a) {
        return formatConnectedAgentLabel({
            name: trace.a2a.callerName,
            globalMetaId: trace.a2a.callerGlobalMetaId,
            fallback: trace.session.metabotId != null
                ? `Local MetaBot #${trace.session.metabotId}`
                : 'Unknown Caller MetaBot',
        });
    }
    if (trace.order?.role === 'seller') {
        return formatConnectedAgentLabel({
            name: trace.session.peerName,
            globalMetaId: trace.session.peerGlobalMetaId,
            fallback: 'Unknown Caller MetaBot',
        });
    }
    return trace.session.metabotId != null
        ? `Local MetaBot #${trace.session.metabotId}`
        : 'Unknown Caller MetaBot';
}
function buildRemoteLabel(trace) {
    if (trace.a2a) {
        const remoteIsCaller = trace.a2a.role === 'provider';
        return formatConnectedAgentLabel({
            name: remoteIsCaller ? trace.a2a.callerName : trace.a2a.providerName,
            globalMetaId: remoteIsCaller
                ? trace.a2a.callerGlobalMetaId
                : trace.a2a.providerGlobalMetaId,
            fallback: trace.session.peerName
                || trace.session.peerGlobalMetaId
                || 'Unknown Remote MetaBot',
        });
    }
    return formatConnectedAgentLabel({
        name: trace.session.peerName,
        globalMetaId: trace.session.peerGlobalMetaId,
        fallback: 'Unknown Remote MetaBot',
    });
}
async function writeFile(filePath, content) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}
function renderTranscriptMarkdown(input) {
    const title = normalizeText(input.transcript.title)
        || normalizeText(input.trace.session.title)
        || `Session ${normalizeText(input.transcript.sessionId)}`;
    const lines = [
        `# ${title}`,
        `Session ID: ${normalizeText(input.transcript.sessionId)}`,
    ];
    if (input.trace.channel) {
        lines.push(`Channel: ${input.trace.channel}`);
    }
    if (input.trace.session.externalConversationId) {
        lines.push(`External Conversation ID: ${input.trace.session.externalConversationId}`);
    }
    if (input.trace.order?.id) {
        lines.push(`Order ID: ${input.trace.order.id}`);
    }
    lines.push(`Caller MetaBot: ${buildCallerLabel(input.trace)}`);
    lines.push(`Remote MetaBot: ${buildRemoteLabel(input.trace)}`);
    if (input.trace.session.peerName || input.trace.session.peerGlobalMetaId) {
        const peerName = input.trace.session.peerName || 'Unknown Peer';
        const peerGlobalMetaId = input.trace.session.peerGlobalMetaId
            ? ` (${input.trace.session.peerGlobalMetaId})`
            : '';
        lines.push(`Peer: ${peerName}${peerGlobalMetaId}`);
    }
    if (input.trace.a2a?.sessionId) {
        lines.push(`A2A Session ID: ${input.trace.a2a.sessionId}`);
    }
    if (input.trace.a2a?.taskRunId) {
        lines.push(`Task Run ID: ${input.trace.a2a.taskRunId}`);
    }
    if (input.trace.a2a?.publicStatus) {
        lines.push(`Public Status: ${input.trace.a2a.publicStatus}`);
    }
    if (input.trace.a2a?.latestEvent) {
        lines.push(`Latest Event: ${input.trace.a2a.latestEvent}`);
    }
    if (input.trace.a2a?.taskRunState) {
        lines.push(`Task Run State: ${input.trace.a2a.taskRunState}`);
    }
    if (input.trace.a2a?.publicStatus === 'timeout') {
        lines.push(renderTimeoutNote('transcript'));
    }
    lines.push('');
    for (const message of input.transcript.messages) {
        lines.push(`[${normalizeText(message.type) || 'message'}] ${String(message.content ?? '')}`);
    }
    return lines.join('\n');
}
function renderTraceMarkdown(trace) {
    const lines = [
        `# Trace ${trace.traceId}`,
        `Channel: ${trace.channel || 'unknown'}`,
        `Session ID: ${trace.session.id}`,
    ];
    if (trace.session.externalConversationId) {
        lines.push(`External Conversation ID: ${trace.session.externalConversationId}`);
    }
    if (trace.order?.id) {
        lines.push(`Order ID: ${trace.order.id}`);
    }
    if (trace.order?.serviceName) {
        lines.push(`Service: ${trace.order.serviceName}`);
    }
    if (trace.order?.paymentTxid) {
        lines.push(`Payment TXID: ${trace.order.paymentTxid}`);
    }
    lines.push(`Caller agent: ${buildCallerLabel(trace)}`);
    lines.push(`Remote agent: ${buildRemoteLabel(trace)}`);
    if (trace.a2a?.sessionId) {
        lines.push(`A2A Session ID: ${trace.a2a.sessionId}`);
    }
    if (trace.a2a?.taskRunId) {
        lines.push(`Task Run ID: ${trace.a2a.taskRunId}`);
    }
    if (trace.a2a?.publicStatus) {
        lines.push(`Public Status: ${trace.a2a.publicStatus}`);
    }
    if (trace.a2a?.latestEvent) {
        lines.push(`Latest Event: ${trace.a2a.latestEvent}`);
    }
    if (trace.a2a?.taskRunState) {
        lines.push(`Task Run State: ${trace.a2a.taskRunState}`);
    }
    if (trace.a2a?.publicStatus === 'timeout') {
        lines.push(renderTimeoutNote('trace'));
    }
    lines.push(`Transcript: ${trace.artifacts.transcriptMarkdownPath}`);
    lines.push(`Trace JSON: ${trace.artifacts.traceJsonPath}`);
    return lines.join('\n');
}
async function exportSessionArtifacts(input) {
    const transcriptMarkdown = renderTranscriptMarkdown(input);
    await writeFile(input.trace.artifacts.transcriptMarkdownPath, transcriptMarkdown);
    await writeFile(input.trace.artifacts.traceJsonPath, JSON.stringify(input.trace, null, 2));
    await writeFile(input.trace.artifacts.traceMarkdownPath, renderTraceMarkdown(input.trace));
    return {
        transcriptMarkdownPath: input.trace.artifacts.transcriptMarkdownPath,
        traceMarkdownPath: input.trace.artifacts.traceMarkdownPath,
        traceJsonPath: input.trace.artifacts.traceJsonPath,
    };
}
