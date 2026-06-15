import { promises as fs } from 'node:fs';
import path from 'node:path';

export type MetabotHomepageRenderer = 'auto' | 'metaapp';

export interface MetabotHomepage {
  uri: string;
  renderer: MetabotHomepageRenderer;
  contentType: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRenderer(value: unknown, uri: string): MetabotHomepageRenderer {
  const renderer = normalizeText(value).toLowerCase();
  if (renderer === 'metaapp') return 'metaapp';
  if (renderer === 'auto') return 'auto';
  return uri.toLowerCase().startsWith('metaapp://') ? 'metaapp' : 'auto';
}

function defaultContentType(uri: string, renderer: MetabotHomepageRenderer): string {
  if (renderer === 'metaapp' || uri.toLowerCase().startsWith('metaapp://')) {
    return 'application/vnd.metaapp';
  }
  return 'application/octet-stream';
}

function validateHomepageUri(uri: string): void {
  if (!uri) {
    throw new Error('Homepage uri is required.');
  }
  if (!/^metafile:\/\/\S+$/iu.test(uri) && !/^metaapp:\/\/\S+$/iu.test(uri)) {
    throw new Error('Homepage uri must start with metafile:// or metaapp:// and must not contain whitespace.');
  }
}

export function normalizeMetabotHomepage(value: unknown): MetabotHomepage | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Homepage must be an object with uri, renderer, and contentType.');
  }
  const record = value as Record<string, unknown>;
  const uri = normalizeText(record.uri);
  validateHomepageUri(uri);
  const renderer = normalizeRenderer(record.renderer, uri);
  const contentType = normalizeText(record.contentType) || defaultContentType(uri, renderer);
  return { uri, renderer, contentType };
}

export function sameMetabotHomepage(left: MetabotHomepage | null | undefined, right: MetabotHomepage | null | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.uri === right.uri
    && left.renderer === right.renderer
    && left.contentType === right.contentType;
}

export async function readMetabotHomepage(filePath: string): Promise<MetabotHomepage | undefined> {
  let raw = '';
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return normalizeMetabotHomepage(JSON.parse(trimmed)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function writeMetabotHomepage(filePath: string, homepage: MetabotHomepage): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(homepage, null, 2)}\n`, 'utf8');
}

export function serializeMetabotHomepagePayload(homepage: MetabotHomepage): string {
  return JSON.stringify(homepage);
}
