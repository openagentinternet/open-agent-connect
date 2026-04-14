import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SessionTraceRecord } from './sessionTrace';

export interface TranscriptMessageInput {
  id?: string;
  type: string;
  timestamp?: number | null;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ExportSessionArtifactsInput {
  trace: SessionTraceRecord;
  transcript: {
    sessionId: string;
    title?: string | null;
    messages: TranscriptMessageInput[];
  };
}

export interface ExportSessionArtifactsResult {
  transcriptMarkdownPath: string;
  traceMarkdownPath: string;
  traceJsonPath: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatConnectedAgentLabel(options: {
  name?: string | null;
  globalMetaId?: string | null;
  fallback: string;
}): string {
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

function renderTimeoutNote(prefix: 'transcript' | 'trace'): string {
  if (prefix === 'transcript') {
    return 'Foreground timeout reached; the remote MetaBot may still continue processing.';
  }
  return 'Trace remains inspectable after timeout; remote completion may still arrive later.';
}

function buildCallerLabel(trace: SessionTraceRecord): string {
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

function buildRemoteLabel(trace: SessionTraceRecord): string {
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

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function renderTranscriptMarkdown(input: ExportSessionArtifactsInput): string {
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

function renderTraceMarkdown(trace: SessionTraceRecord): string {
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

export async function exportSessionArtifacts(
  input: ExportSessionArtifactsInput
): Promise<ExportSessionArtifactsResult> {
  const transcriptMarkdown = renderTranscriptMarkdown(input);
  await writeFile(input.trace.artifacts.transcriptMarkdownPath, transcriptMarkdown);

  await writeFile(
    input.trace.artifacts.traceJsonPath,
    JSON.stringify(input.trace, null, 2)
  );
  await writeFile(
    input.trace.artifacts.traceMarkdownPath,
    renderTraceMarkdown(input.trace)
  );

  return {
    transcriptMarkdownPath: input.trace.artifacts.transcriptMarkdownPath,
    traceMarkdownPath: input.trace.artifacts.traceMarkdownPath,
    traceJsonPath: input.trace.artifacts.traceJsonPath,
  };
}
