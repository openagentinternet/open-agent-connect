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
function formatAskMasterSensitivity(value) {
    if (!value) {
        return 'unknown';
    }
    if (value.isSensitive !== true) {
        return 'not_sensitive';
    }
    if (Array.isArray(value.reasons) && value.reasons.length > 0) {
        return `sensitive (${value.reasons.join('; ')})`;
    }
    return 'sensitive';
}
function renderAskMasterStatusText(trace) {
    const askMaster = trace.askMaster;
    if (!askMaster) {
        return null;
    }
    if (normalizeText(trace.a2a?.latestEvent) === 'auto_preview_rejected'
        || normalizeText(askMaster.failure?.code) === 'auto_rejected_by_user') {
        return 'Declined';
    }
    const status = normalizeText(askMaster.canonicalStatus);
    if (status === 'awaiting_confirmation')
        return 'Waiting for your confirmation';
    if (status === 'requesting_remote')
        return 'Request sent to Master';
    if (status === 'remote_received')
        return 'Master received the request';
    if (status === 'master_responded')
        return 'Master has responded';
    if (status === 'completed')
        return 'Completed';
    if (status === 'timed_out')
        return 'Stopped waiting locally';
    if (status === 'failed')
        return 'Failed';
    if (status === 'need_more_context')
        return 'Need more context';
    if (status === 'suggested')
        return 'Suggested';
    if (status === 'discovered')
        return 'Discovered';
    return null;
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
    if (input.trace.askMaster?.flow === 'master') {
        lines.push(`Ask Master Flow: ${input.trace.askMaster.flow}`);
        if (input.trace.askMaster.displayName) {
            lines.push(`Master: ${input.trace.askMaster.displayName}`);
        }
        if (input.trace.askMaster.masterKind) {
            lines.push(`Master Kind: ${input.trace.askMaster.masterKind}`);
        }
        if (input.trace.askMaster.requestId) {
            lines.push(`Request ID: ${input.trace.askMaster.requestId}`);
        }
        if (input.trace.askMaster.canonicalStatus) {
            lines.push(`Ask Master Status: ${input.trace.askMaster.canonicalStatus}`);
        }
        if (input.trace.askMaster.triggerMode) {
            lines.push(`Trigger Mode: ${input.trace.askMaster.triggerMode}`);
        }
        const statusText = renderAskMasterStatusText(input.trace);
        if (statusText) {
            lines.push(`Current Status: ${statusText}`);
        }
        if (input.trace.askMaster.confirmationMode) {
            lines.push(`Confirmation Mode: ${input.trace.askMaster.confirmationMode}`);
        }
        if (input.trace.askMaster.transport) {
            lines.push(`Ask Master Transport: ${input.trace.askMaster.transport}`);
        }
        if (input.trace.askMaster.auto) {
            if (input.trace.askMaster.auto.reason) {
                lines.push(`Auto Reason: ${input.trace.askMaster.auto.reason}`);
            }
            if (input.trace.askMaster.auto.confidence !== null) {
                lines.push(`Confidence: ${input.trace.askMaster.auto.confidence}`);
            }
            if (input.trace.askMaster.auto.frictionMode) {
                lines.push(`Friction Mode: ${input.trace.askMaster.auto.frictionMode}`);
            }
            if (input.trace.askMaster.auto.selectedMasterTrusted !== null) {
                lines.push(`Trusted Target: ${input.trace.askMaster.auto.selectedMasterTrusted ? 'yes' : 'no'}`);
            }
            lines.push(`Sensitivity: ${formatAskMasterSensitivity(input.trace.askMaster.auto.sensitivity)}`);
        }
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
    if (trace.askMaster?.flow === 'master') {
        lines.push(`Ask Master Flow: ${trace.askMaster.flow}`);
        if (trace.askMaster.displayName) {
            lines.push(`Master: ${trace.askMaster.displayName}`);
        }
        if (trace.askMaster.masterKind) {
            lines.push(`Master Kind: ${trace.askMaster.masterKind}`);
        }
        if (trace.askMaster.requestId) {
            lines.push(`Request ID: ${trace.askMaster.requestId}`);
        }
        if (trace.askMaster.canonicalStatus) {
            lines.push(`Ask Master Status: ${trace.askMaster.canonicalStatus}`);
        }
        if (trace.askMaster.triggerMode) {
            lines.push(`Trigger Mode: ${trace.askMaster.triggerMode}`);
        }
        const statusText = renderAskMasterStatusText(trace);
        if (statusText) {
            lines.push(`Current Status: ${statusText}`);
        }
        if (trace.askMaster.confirmationMode) {
            lines.push(`Confirmation Mode: ${trace.askMaster.confirmationMode}`);
        }
        if (trace.askMaster.transport) {
            lines.push(`Ask Master Transport: ${trace.askMaster.transport}`);
        }
        if (trace.askMaster.auto) {
            if (trace.askMaster.auto.reason) {
                lines.push(`Auto Reason: ${trace.askMaster.auto.reason}`);
            }
            if (trace.askMaster.auto.confidence !== null) {
                lines.push(`Confidence: ${trace.askMaster.auto.confidence}`);
            }
            if (trace.askMaster.auto.frictionMode) {
                lines.push(`Friction Mode: ${trace.askMaster.auto.frictionMode}`);
            }
            if (trace.askMaster.auto.selectedMasterTrusted !== null) {
                lines.push(`Trusted Target: ${trace.askMaster.auto.selectedMasterTrusted ? 'yes' : 'no'}`);
            }
            lines.push(`Sensitivity: ${formatAskMasterSensitivity(trace.askMaster.auto.sensitivity)}`);
        }
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
