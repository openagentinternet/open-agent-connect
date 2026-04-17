export const MASTER_MESSAGE_VERSION = '1.0.0';
export const MASTER_REQUEST_TYPE = 'master_request';
export const MASTER_RESPONSE_TYPE = 'master_response';

export type MasterTriggerMode = 'manual' | 'suggest' | 'auto';
export type MasterResponseStatus = 'completed' | 'needs_clarification' | 'failed';

export interface MasterMessageArtifact {
  kind: string;
  label: string;
  content: string;
  mimeType: string | null;
}

export interface MasterRequestMessage {
  type: typeof MASTER_REQUEST_TYPE;
  version: string;
  requestId: string;
  traceId: string;
  caller: {
    globalMetaId: string;
    name: string | null;
    host: string;
  };
  target: {
    masterServicePinId: string;
    providerGlobalMetaId: string;
    masterKind: string;
  };
  task: {
    userTask: string;
    question: string;
  };
  context: {
    workspaceSummary: string | null;
    relevantFiles: string[];
    artifacts: MasterMessageArtifact[];
  };
  trigger: {
    mode: MasterTriggerMode;
    reason: string | null;
  };
  desiredOutput: string | null;
  extensions: Record<string, unknown> | null;
}

export interface MasterResponseMessage {
  type: typeof MASTER_RESPONSE_TYPE;
  version: string;
  requestId: string;
  traceId: string;
  responder: {
    providerGlobalMetaId: string;
    masterServicePinId: string;
    masterKind: string;
  };
  status: MasterResponseStatus;
  summary: string;
  responseText: string | null;
  structuredData: Record<string, unknown>;
  followUpQuestion: string | null;
  errorCode: string | null;
  extensions: Record<string, unknown> | null;
}

interface ParseSuccess<T> {
  ok: true;
  value: T;
}

interface ParseFailure {
  ok: false;
  code:
    | 'invalid_master_message_json'
    | 'invalid_master_message_type'
    | 'invalid_master_message_version'
    | 'invalid_master_request'
    | 'invalid_master_response';
  message: string;
}

export type MasterRequestParseResult = ParseSuccess<MasterRequestMessage> | ParseFailure;
export type MasterResponseParseResult = ParseSuccess<MasterResponseMessage> | ParseFailure;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonEnvelope(value: unknown): ParseSuccess<Record<string, unknown>> | ParseFailure {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return {
        ok: false,
        code: 'invalid_master_message_json',
        message: 'Master message JSON must not be empty.',
      };
    }
    try {
      const parsed = JSON.parse(normalized) as unknown;
      const objectValue = readObject(parsed);
      if (!objectValue) {
        return {
          ok: false,
          code: 'invalid_master_message_json',
          message: 'Master message JSON must decode to an object.',
        };
      }
      return {
        ok: true,
        value: objectValue,
      };
    } catch (error) {
      return {
        ok: false,
        code: 'invalid_master_message_json',
        message: `Malformed master message JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const objectValue = readObject(value);
  if (!objectValue) {
    return {
      ok: false,
      code: 'invalid_master_message_json',
      message: 'Master message must be a JSON object.',
    };
  }
  return {
    ok: true,
    value: objectValue,
  };
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    const text = normalizeText(entry);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function parseArtifacts(value: unknown): MasterMessageArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const artifacts: MasterMessageArtifact[] = [];
  for (const entry of value) {
    const item = readObject(entry);
    if (!item) {
      continue;
    }
    const kind = normalizeText(item.kind);
    const label = normalizeText(item.label);
    const content = normalizeText(item.content);
    if (!kind || !label || !content) {
      continue;
    }
    artifacts.push({
      kind,
      label,
      content,
      mimeType: normalizeText(item.mimeType) || null,
    });
  }
  return artifacts;
}

function parseTriggerMode(value: unknown): MasterTriggerMode | null {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'manual' || normalized === 'suggest' || normalized === 'auto') {
    return normalized;
  }
  return null;
}

function parseResponseStatus(value: unknown): MasterResponseStatus | null {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'completed' || normalized === 'needs_clarification' || normalized === 'failed') {
    return normalized;
  }
  return null;
}

function validateTypeAndVersion(
  envelope: Record<string, unknown>,
  expectedType: typeof MASTER_REQUEST_TYPE | typeof MASTER_RESPONSE_TYPE
): ParseFailure | null {
  const type = normalizeText(envelope.type);
  if (type !== expectedType) {
    return {
      ok: false,
      code: 'invalid_master_message_type',
      message: `Expected ${expectedType} but received ${type || 'empty type'}.`,
    };
  }

  const version = normalizeText(envelope.version);
  if (version !== MASTER_MESSAGE_VERSION) {
    return {
      ok: false,
      code: 'invalid_master_message_version',
      message: `Unsupported master message version: ${version || 'empty version'}.`,
    };
  }

  return null;
}

function failRequest(message: string): ParseFailure {
  return {
    ok: false,
    code: 'invalid_master_request',
    message,
  };
}

function failResponse(message: string): ParseFailure {
  return {
    ok: false,
    code: 'invalid_master_response',
    message,
  };
}

export function parseMasterRequest(value: unknown): MasterRequestParseResult {
  const envelope = parseJsonEnvelope(value);
  if (!envelope.ok) {
    return envelope;
  }

  const typeFailure = validateTypeAndVersion(envelope.value, MASTER_REQUEST_TYPE);
  if (typeFailure) {
    return typeFailure;
  }

  const caller = readObject(envelope.value.caller);
  const target = readObject(envelope.value.target);
  const task = readObject(envelope.value.task);
  const context = readObject(envelope.value.context) ?? {};
  const trigger = readObject(envelope.value.trigger);
  const extensions = readObject(envelope.value.extensions);

  const requestId = normalizeText(envelope.value.requestId);
  if (!requestId) {
    return failRequest('master_request.requestId is required.');
  }

  const traceId = normalizeText(envelope.value.traceId);
  if (!traceId) {
    return failRequest('master_request.traceId is required.');
  }

  const callerGlobalMetaId = normalizeText(caller?.globalMetaId);
  const callerHost = normalizeText(caller?.host);
  if (!callerGlobalMetaId || !callerHost) {
    return failRequest('master_request.caller.globalMetaId and master_request.caller.host are required.');
  }

  const masterServicePinId = normalizeText(target?.masterServicePinId);
  const providerGlobalMetaId = normalizeText(target?.providerGlobalMetaId);
  const masterKind = normalizeText(target?.masterKind);
  if (!masterServicePinId || !providerGlobalMetaId || !masterKind) {
    return failRequest('master_request.target.masterServicePinId, providerGlobalMetaId, and masterKind are required.');
  }

  const userTask = normalizeText(task?.userTask);
  const question = normalizeText(task?.question);
  if (!userTask || !question) {
    return failRequest('master_request.task.userTask and master_request.task.question are required.');
  }

  const triggerMode = parseTriggerMode(trigger?.mode);
  if (!triggerMode) {
    return failRequest('master_request.trigger.mode must be one of manual, suggest, auto.');
  }

  return {
    ok: true,
    value: {
      type: MASTER_REQUEST_TYPE,
      version: MASTER_MESSAGE_VERSION,
      requestId,
      traceId,
      caller: {
        globalMetaId: callerGlobalMetaId,
        name: normalizeText(caller?.name) || null,
        host: callerHost,
      },
      target: {
        masterServicePinId,
        providerGlobalMetaId,
        masterKind,
      },
      task: {
        userTask,
        question,
      },
      context: {
        workspaceSummary: normalizeText(context.workspaceSummary) || null,
        relevantFiles: parseStringArray(context.relevantFiles),
        artifacts: parseArtifacts(context.artifacts),
      },
      trigger: {
        mode: triggerMode,
        reason: normalizeText(trigger?.reason) || null,
      },
      desiredOutput: normalizeText(envelope.value.desiredOutput) || null,
      extensions,
    },
  };
}

export function parseMasterResponse(value: unknown): MasterResponseParseResult {
  const envelope = parseJsonEnvelope(value);
  if (!envelope.ok) {
    return envelope;
  }

  const typeFailure = validateTypeAndVersion(envelope.value, MASTER_RESPONSE_TYPE);
  if (typeFailure) {
    return typeFailure;
  }

  const responder = readObject(envelope.value.responder);
  const structuredData = readObject(envelope.value.structuredData) ?? {};
  const extensions = readObject(envelope.value.extensions);

  const requestId = normalizeText(envelope.value.requestId);
  if (!requestId) {
    return failResponse('master_response.requestId is required.');
  }

  const traceId = normalizeText(envelope.value.traceId);
  if (!traceId) {
    return failResponse('master_response.traceId is required.');
  }

  const providerGlobalMetaId = normalizeText(responder?.providerGlobalMetaId);
  const masterServicePinId = normalizeText(responder?.masterServicePinId);
  const masterKind = normalizeText(responder?.masterKind);
  if (!providerGlobalMetaId || !masterServicePinId || !masterKind) {
    return failResponse('master_response.responder.providerGlobalMetaId, masterServicePinId, and masterKind are required.');
  }

  const status = parseResponseStatus(envelope.value.status);
  if (!status) {
    return failResponse('master_response.status must be one of completed, needs_clarification, failed.');
  }

  const summary = normalizeText(envelope.value.summary);
  if (!summary) {
    return failResponse('master_response.summary is required.');
  }

  return {
    ok: true,
    value: {
      type: MASTER_RESPONSE_TYPE,
      version: MASTER_MESSAGE_VERSION,
      requestId,
      traceId,
      responder: {
        providerGlobalMetaId,
        masterServicePinId,
        masterKind,
      },
      status,
      summary,
      responseText: normalizeText(envelope.value.responseText) || null,
      structuredData,
      followUpQuestion: normalizeText(envelope.value.followUpQuestion) || null,
      errorCode: normalizeText(envelope.value.errorCode) || null,
      extensions,
    },
  };
}

export function buildMasterRequestJson(value: unknown): string {
  const parsed = parseMasterRequest(value);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return JSON.stringify(parsed.value);
}

export function buildMasterResponseJson(value: unknown): string {
  const parsed = parseMasterResponse(value);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return JSON.stringify(parsed.value);
}
