import type { MasterMessageArtifact } from './masterMessageSchema';

type ArtifactSource = 'terminal' | 'test' | 'diff' | 'chat' | 'file_excerpt';

interface ArtifactCandidate {
  kind: string;
  label: string;
  content: string;
  mimeType: string | null;
  path: string | null;
  source: ArtifactSource;
  index: number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeStringArray(value: unknown): string[] {
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

function normalizePathForMatching(value: unknown): string {
  return normalizeText(value).replace(/\\/g, '/').toLowerCase();
}

function cleanPotentialPathToken(value: string): string {
  return value.replace(/^[^\w./:\\-]+|[^\w./:\\-]+$/g, '');
}

function looksLikePathToken(value: string): boolean {
  return value.includes('/')
    || value.includes('\\')
    || value.startsWith('.')
    || /^[A-Za-z]:\\/.test(value)
    || /\.[A-Za-z0-9_-]{1,12}$/.test(value);
}

function redactSensitiveContentSnippets(value: string): string {
  return value
    .replace(/BEGIN [A-Z ]*PRIVATE KEY[\s\S]*?END [A-Z ]*PRIVATE KEY/gi, '[redacted-secret]')
    .replace(/(OPENAI_API_KEY\s*=\s*)[^\s,;]+/gi, '$1[redacted-secret]')
    .replace(/(api[_-]?key\s*=\s*)[^\s,;]+/gi, '$1[redacted-secret]')
    .replace(/(bearer\s+)[a-z0-9._-]+/gi, '$1[redacted-secret]')
    .replace(/\bOPENAI_API_KEY\b/gi, '[redacted-secret]')
    .replace(/\bPRIVATE KEY\b/gi, '[redacted-secret]')
    .replace(/\bseed phrase\b/gi, '[redacted-secret]')
    .replace(/\bmnemonic\b/gi, '[redacted-secret]')
    .replace(/\bwallet secret\b/gi, '[redacted-secret]');
}

function redactSensitivePathSnippets(value: string): string {
  return value
    .split(/([\s,;()[\]{}"'`<>]+)/)
    .map((segment) => {
      const token = cleanPotentialPathToken(segment);
      if (!token || !looksLikePathToken(token) || !isSensitivePath(token)) {
        return segment;
      }
      return segment.replace(token, '[redacted-sensitive-path]');
    })
    .join('');
}

function artifactPriority(source: ArtifactSource): number {
  switch (source) {
    case 'test':
      return 0;
    case 'terminal':
      return 1;
    case 'diff':
      return 2;
    case 'file_excerpt':
      return 3;
    case 'chat':
    default:
      return 4;
  }
}

function readArtifactSource(value: unknown): ArtifactSource {
  return value === 'test'
    || value === 'terminal'
    || value === 'diff'
    || value === 'file_excerpt'
    ? value
    : 'chat';
}

function readArtifactCandidates(value: unknown): ArtifactCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const artifacts: ArtifactCandidate[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const item = entry as Record<string, unknown>;
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
      mimeType: normalizeNullableText(item.mimeType),
      path: normalizeNullableText(item.path),
      source: readArtifactSource(item.source),
      index,
    });
  }
  return artifacts;
}

function trimArtifactContent(content: string, limit: number): string {
  const normalized = normalizeText(content);
  if (normalized.length <= limit) {
    return normalized;
  }
  const suffix = '...';
  return `${normalized.slice(0, Math.max(0, limit - suffix.length)).trimEnd()}${suffix}`;
}

export function isSensitivePath(filePath: string | null): boolean {
  const normalized = normalizePathForMatching(filePath);
  if (!normalized) {
    return false;
  }
  if (/(^|\/)\.env(\.|$|\/)?/.test(normalized)) {
    return true;
  }
  if (/\.(pem|key)$/i.test(normalized)) {
    return true;
  }
  return /(^|\/)(credentials?|wallets?|secrets?|mnemonic|seed[-_ ]?phrase|private[-_ ]?key)(\/|\.|-|_|$)/.test(normalized);
}

export function hasSensitiveContent(content: string): boolean {
  const normalized = normalizeText(content);
  if (!normalized) {
    return false;
  }
  return /(BEGIN [A-Z ]*PRIVATE KEY|OPENAI_API_KEY|PRIVATE KEY|seed phrase|mnemonic|bearer [a-z0-9._-]+|api[_-]?key\s*=|wallet secret)/i.test(normalized);
}

export function hasSensitivePathSnippet(value: unknown): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  for (const rawToken of normalized.split(/[\s,;()[\]{}"'`<>]+/)) {
    const token = cleanPotentialPathToken(rawToken);
    if (!token || !looksLikePathToken(token)) {
      continue;
    }
    if (isSensitivePath(token)) {
      return true;
    }
  }
  return false;
}

export function sanitizeRelevantFiles(value: unknown, limit: number): string[] {
  return normalizeStringArray(value)
    .filter((filePath) => !isSensitivePath(filePath))
    .slice(0, limit);
}

export function sanitizeSummaryText(
  value: unknown,
  options: {
    rejectSensitivePaths?: boolean;
  } = {}
): string | null {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }
  if (hasSensitiveContent(normalized)) {
    return null;
  }
  if (options.rejectSensitivePaths !== false && hasSensitivePathSnippet(normalized)) {
    return null;
  }
  return normalized;
}

export function sanitizeTaskText(value: unknown, fallback: string): string {
  const normalized = normalizeNullableText(value) ?? fallback;
  const redacted = redactSensitivePathSnippets(redactSensitiveContentSnippets(normalized));
  return normalizeNullableText(redacted) ?? fallback;
}

export function sanitizeConstraintList(value: unknown): string[] {
  const constraints = normalizeStringArray(value);
  const safeConstraints: string[] = [];
  for (const constraint of constraints) {
    const safeConstraint = sanitizeSummaryText(constraint);
    if (!safeConstraint) {
      continue;
    }
    safeConstraints.push(safeConstraint);
  }
  return safeConstraints;
}

export function sanitizeArtifacts(
  value: unknown,
  limit: number,
  maxChars: number
): MasterMessageArtifact[] {
  const safeArtifacts = readArtifactCandidates(value)
    .filter((artifact) => !hasSensitivePathSnippet(artifact.label))
    .filter((artifact) => !hasSensitiveContent(artifact.label))
    .filter((artifact) => !isSensitivePath(artifact.path))
    .filter((artifact) => !hasSensitiveContent(artifact.content))
    .filter((artifact) => !hasSensitivePathSnippet(artifact.content))
    .sort((left, right) => {
      const priority = artifactPriority(left.source) - artifactPriority(right.source);
      return priority !== 0 ? priority : left.index - right.index;
    });

  const seen = new Set<string>();
  const packaged: MasterMessageArtifact[] = [];
  for (const artifact of safeArtifacts) {
    if (packaged.length >= limit) {
      break;
    }
    const content = trimArtifactContent(artifact.content, maxChars);
    if (!content) {
      continue;
    }
    const key = `${artifact.label}:${content}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    packaged.push({
      kind: artifact.kind,
      label: artifact.label,
      content,
      mimeType: artifact.mimeType,
    });
  }
  return packaged;
}
