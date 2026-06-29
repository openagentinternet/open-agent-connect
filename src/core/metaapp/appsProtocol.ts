import { commandFailed, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import type { MetaAppManifestInput } from './types';

export const METAAPP_PIN_ID_PATTERN = /^[0-9a-f]{64}i0$/i;
export const METAAPP_METAFILE_REFERENCE_PATTERN = /^([0-9a-f]{64}i0)(?:\.[a-z0-9][a-z0-9+-]{0,31})?$/i;

export const METAAPP_RUNTIME_OPTIONS = ['browser', 'android', 'ios', 'windows', 'macOS', 'linux'] as const;
export type MetaAppRuntimeOption = typeof METAAPP_RUNTIME_OPTIONS[number];

export const METAAPP_CONTENT_TYPE_OPTIONS = [
  'application/zip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/gzip',
  'application/json',
  'application/xml',
  'text/plain',
  'text/html',
  'text/css',
  'application/javascript',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'application/octet-stream',
] as const;

export const METAAPP_CODE_TYPE_OPTIONS = [
  'application/zip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/gzip',
  'application/json',
  'application/xml',
  'text/html',
  'text/css',
  'application/javascript',
] as const;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripMetafilePrefix(value: string): string {
  return value.toLowerCase().startsWith('metafile://')
    ? value.slice('metafile://'.length)
    : value;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeMetafileReference(value: unknown, fieldName: string): string {
  const raw = normalizeText(value);
  const reference = stripMetafilePrefix(raw).trim();
  if (!METAAPP_METAFILE_REFERENCE_PATTERN.test(reference)) {
    throw new Error(`${fieldName} must be a MetaID pin id or metafile:// pin id with an optional file extension.`);
  }
  return `metafile://${reference}`;
}

export function normalizeMetafileReferenceList(value: unknown, fieldName: string): string[] {
  const values = Array.isArray(value)
    ? value
    : normalizeText(value).split(/[\n,]/u);
  return values
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .map((item) => normalizeMetafileReference(item, fieldName));
}

export function normalizeMetaAppImageReference(value: unknown, fieldName: string): string {
  const raw = normalizeText(value);
  if (isHttpUrl(raw)) return raw;
  return normalizeMetafileReference(raw, fieldName);
}

export function normalizeMetaAppImageReferenceList(value: unknown, fieldName: string): string[] {
  const values = Array.isArray(value)
    ? value
    : normalizeText(value).split(/[\n,]/u);
  return values
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .map((item) => normalizeMetaAppImageReference(item, fieldName));
}

export function serializeMetaAppRuntime(value: unknown): string {
  const values = Array.isArray(value)
    ? value.map((item) => normalizeText(item))
    : normalizeText(value).split('/').map((item) => item.trim());
  const allowed = new Set<string>(METAAPP_RUNTIME_OPTIONS);
  const nonEmpty = values.filter(Boolean);
  const unsupported = nonEmpty.filter((item) => !allowed.has(item));
  if (unsupported.length > 0) {
    const uniqueUnsupported = [...new Set(unsupported)];
    throw new Error(
      uniqueUnsupported.length === 1
        ? `runtime contains unsupported value: ${uniqueUnsupported[0]}.`
        : `runtime contains unsupported values: ${uniqueUnsupported.join(', ')}.`,
    );
  }
  const selected = nonEmpty.filter((item) => allowed.has(item));
  if (selected.length === 0) {
    throw new Error('runtime requires at least one supported runtime.');
  }
  return [...new Set(selected)].join('/');
}

function normalizeOption(
  value: unknown,
  fieldName: string,
  allowedValues: readonly string[],
  fallback: string | undefined,
): string | undefined {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (!allowedValues.includes(text)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}.`);
  }
  return text;
}

function normalizeTags(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : normalizeText(value).split(',');
  return [...new Set(values.map((item) => normalizeText(item)).filter(Boolean))];
}

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const text = normalizeText(value);
  if (!text) return undefined;
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('metadata must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function normalizeOptionalMetafile(value: unknown, fieldName: string): string | undefined {
  return normalizeText(value) ? normalizeMetafileReference(value, fieldName) : undefined;
}

export function buildMetaAppProtocolPayload(input: Record<string, unknown>): MetaAppManifestInput {
  const title = normalizeText(input.title);
  const appName = normalizeText(input.appName);
  if (!title) throw new Error('title is required.');
  if (!appName) throw new Error('appName is required.');

  return {
    title,
    appName,
    prompt: normalizeText(input.prompt) || undefined,
    icon: normalizeMetaAppImageReference(input.icon, 'icon'),
    coverImg: normalizeMetaAppImageReference(input.coverImg, 'coverImg'),
    introImgs: normalizeMetaAppImageReferenceList(input.introImgs, 'introImgs'),
    intro: normalizeText(input.intro) || undefined,
    runtime: serializeMetaAppRuntime(input.runtime),
    version: normalizeText(input.version) || undefined,
    contentType: normalizeOption(input.contentType, 'contentType', METAAPP_CONTENT_TYPE_OPTIONS, 'application/zip'),
    content: normalizeOptionalMetafile(input.content, 'content'),
    indexFile: normalizeText(input.indexFile) || undefined,
    code: normalizeOptionalMetafile(input.code, 'code'),
    contentHash: normalizeText(input.contentHash) || undefined,
    metadata: normalizeMetadata(input.metadata),
    tags: normalizeTags(input.tags),
    disabled: input.disabled === true,
    codeType: normalizeOption(input.codeType, 'codeType', METAAPP_CODE_TYPE_OPTIONS, undefined),
  };
}

export function buildMetaAppCreateWrite(payload: MetaAppManifestInput): {
  operation: 'create';
  path: '/protocols/metaapp';
  contentType: 'application/json';
  payload: string;
} {
  return {
    operation: 'create',
    path: '/protocols/metaapp',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  };
}

export function buildMetaAppModifyWrite(targetPinId: string, payload: MetaAppManifestInput): {
  operation: 'modify';
  path: string;
  contentType: 'application/json';
  payload: string;
} {
  if (!METAAPP_PIN_ID_PATTERN.test(targetPinId)) {
    throw new Error('targetPinId must be a MetaID pin id.');
  }
  return {
    operation: 'modify',
    path: `@${targetPinId}`,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  };
}

export function buildMetaAppRevokeWrite(targetPinId: string): {
  operation: 'revoke';
  path: string;
} {
  if (!METAAPP_PIN_ID_PATTERN.test(targetPinId)) {
    throw new Error('targetPinId must be a MetaID pin id.');
  }
  return {
    operation: 'revoke',
    path: `@${targetPinId}`,
  };
}

export function metaAppFormFailure(error: unknown): MetabotCommandResult<never> {
  return commandFailed(
    'metaapp_apps_form_invalid',
    error instanceof Error ? error.message : String(error),
  );
}

export function metaAppFormSuccess(data: Record<string, unknown>): MetabotCommandResult<Record<string, unknown>> {
  return commandSuccess(data);
}
