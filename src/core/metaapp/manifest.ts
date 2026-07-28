import { promises as fs } from 'node:fs';
import type { MetaAppManifestInput, MetaAppPreviewPlan } from './types';

const STRING_FIELDS = new Set([
  'title',
  'appName',
  'prompt',
  'icon',
  'coverImg',
  'intro',
  'runtime',
  'version',
  'contentType',
  'content',
  'indexFile',
  'code',
  'contentHash',
  'codeType',
  'artifactDir',
  'forkedFrom',
]);

const STRING_ARRAY_FIELDS = new Set(['introImgs', 'tags']);
const BOOLEAN_FIELDS = new Set(['disabled', 'sourceArchive']);
const OBJECT_FIELDS = new Set(['metadata']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return normalized.length > 0 ? normalized : [];
}

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const metadata: Record<string, unknown> = {};
  if (isPlainObject(value.user)) {
    metadata.user = { ...value.user };
  }
  return metadata;
}

export function normalizeMetaAppManifestInput(value: unknown): MetaAppManifestInput {
  if (!isPlainObject(value)) {
    throw new Error('MetaApp manifest override must be a JSON object.');
  }

  const manifest: MetaAppManifestInput = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (STRING_FIELDS.has(key)) {
      const normalized = normalizeString(rawValue);
      if (normalized !== undefined) {
        (manifest as Record<string, unknown>)[key] = normalized;
      }
      continue;
    }

    if (STRING_ARRAY_FIELDS.has(key)) {
      const normalized = normalizeStringArray(rawValue);
      if (normalized !== undefined) {
        (manifest as Record<string, unknown>)[key] = normalized;
      }
      continue;
    }

    if (BOOLEAN_FIELDS.has(key)) {
      if (typeof rawValue === 'boolean') {
        (manifest as Record<string, unknown>)[key] = rawValue;
      }
      continue;
    }

    if (OBJECT_FIELDS.has(key)) {
      const normalized = normalizeMetadata(rawValue);
      if (normalized !== undefined) {
        manifest.metadata = normalized;
      }
    }
  }

  return manifest;
}

export async function readMetaAppManifestFile(filePath: string): Promise<MetaAppManifestInput> {
  const raw = await fs.readFile(filePath, 'utf8');
  return normalizeMetaAppManifestInput(JSON.parse(raw));
}

export function buildMetaAppManifestDraft(plan: MetaAppPreviewPlan): MetaAppManifestInput {
  const draft: MetaAppManifestInput = {
    ...plan.manifest,
    runtime: plan.manifest.runtime ?? 'browser',
    version: plan.manifest.version ?? '1.0.0',
    contentType: plan.manifest.contentType ?? 'application/zip',
    codeType: plan.manifest.codeType ?? 'application/zip',
    indexFile: plan.manifest.indexFile ?? plan.indexFile,
    code: plan.manifest.code ?? '',
    content: plan.manifest.content ?? '',
  };

  if (isPlainObject(plan.manifest.metadata) && Object.keys(plan.manifest.metadata).length > 0) {
    draft.metadata = { ...plan.manifest.metadata };
  }

  return draft;
}
