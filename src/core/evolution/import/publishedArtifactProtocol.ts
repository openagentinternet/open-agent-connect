import { SAFE_IDENTIFIER_PATTERN } from '../localEvolutionStore';
import type { SkillVariantArtifact } from '../types';

export const EVOLUTION_ARTIFACT_PROTOCOL_VERSION = '1';
export const EVOLUTION_SEARCH_MAX_RAW_ROWS = 100;

const METAFILE_SCHEME = 'metafile://';

export interface PublishedEvolutionArtifactMetadata {
  protocolVersion: typeof EVOLUTION_ARTIFACT_PROTOCOL_VERSION;
  skillName: string;
  variantId: string;
  artifactUri: string;
  evolutionType: 'FIX';
  triggerSource: string;
  scopeHash: string;
  sameSkill: boolean;
  sameScope: boolean;
  verificationPassed: boolean;
  replayValid: boolean;
  notWorseThanBase: boolean;
  lineage: {
    lineageId: string;
    parentVariantId: string | null;
    rootVariantId: string;
    executionId: string;
    analysisId: string;
    createdAt: number;
  };
  publisherGlobalMetaId: string;
  artifactCreatedAt: number;
  artifactUpdatedAt: number;
  publishedAt: number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseContentSummary(value: unknown): UnknownRecord | null {
  if (!value) return null;
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeMetadataSource(value: unknown): UnknownRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'contentSummary')) {
    return parseContentSummary(value.contentSummary);
  }
  return value;
}

function parseLineage(value: unknown): PublishedEvolutionArtifactMetadata['lineage'] | null {
  if (!isRecord(value)) return null;
  const lineageId = toNonEmptyString(value.lineageId);
  const rootVariantId = toNonEmptyString(value.rootVariantId);
  const executionId = toNonEmptyString(value.executionId);
  const analysisId = toNonEmptyString(value.analysisId);
  const createdAt = toFiniteNumber(value.createdAt);
  if (
    !lineageId
    || !rootVariantId
    || !executionId
    || !analysisId
    || createdAt == null
    || !isSafeEvolutionIdentifier(lineageId)
    || !isSafeEvolutionIdentifier(rootVariantId)
    || !isSafeEvolutionIdentifier(executionId)
    || !isSafeEvolutionIdentifier(analysisId)
  ) {
    return null;
  }

  const parentVariantIdRaw = value.parentVariantId;
  const parentVariantId = parentVariantIdRaw == null
    ? null
    : toNonEmptyString(parentVariantIdRaw);
  if (parentVariantIdRaw != null && (!parentVariantId || !isSafeEvolutionIdentifier(parentVariantId))) {
    return null;
  }

  return {
    lineageId,
    parentVariantId,
    rootVariantId,
    executionId,
    analysisId,
    createdAt,
  };
}

function parseScope(value: unknown): SkillVariantArtifact['scope'] | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.allowedCommands) || value.allowedCommands.some((item) => typeof item !== 'string')) {
    return null;
  }
  if (
    typeof value.chainRead !== 'boolean'
    || typeof value.chainWrite !== 'boolean'
    || typeof value.localUiOpen !== 'boolean'
    || typeof value.remoteDelegation !== 'boolean'
  ) {
    return null;
  }
  return {
    allowedCommands: [...value.allowedCommands],
    chainRead: value.chainRead,
    chainWrite: value.chainWrite,
    localUiOpen: value.localUiOpen,
    remoteDelegation: value.remoteDelegation,
  };
}

function parseScopeMetadata(value: unknown): SkillVariantArtifact['metadata'] | null {
  if (!isRecord(value)) return null;
  if (typeof value.sameSkill !== 'boolean' || typeof value.sameScope !== 'boolean') {
    return null;
  }
  const scopeHash = value.scopeHash == null ? null : toNonEmptyString(value.scopeHash);
  if (value.scopeHash != null && scopeHash == null) {
    return null;
  }
  return {
    sameSkill: value.sameSkill,
    sameScope: value.sameScope,
    scopeHash,
  };
}

function parseVerification(value: unknown): SkillVariantArtifact['verification'] | null {
  if (!isRecord(value)) return null;
  const checkedAt = toFiniteNumber(value.checkedAt);
  if (
    typeof value.passed !== 'boolean'
    || typeof value.protocolCompatible !== 'boolean'
    || typeof value.replayValid !== 'boolean'
    || typeof value.notWorseThanBase !== 'boolean'
    || checkedAt == null
  ) {
    return null;
  }
  const notes = value.notes == null ? undefined : toNonEmptyString(value.notes);
  if (value.notes != null && typeof notes !== 'string') {
    return null;
  }
  const normalizedNotes = typeof notes === 'string' ? notes : undefined;
  return {
    passed: value.passed,
    checkedAt,
    protocolCompatible: value.protocolCompatible,
    replayValid: value.replayValid,
    notWorseThanBase: value.notWorseThanBase,
    notes: normalizedNotes,
  };
}

export function isSafeEvolutionIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && SAFE_IDENTIFIER_PATTERN.test(value)
  );
}

export function parseMetafilePinId(uri: string): string | null {
  if (typeof uri !== 'string' || !uri.startsWith(METAFILE_SCHEME)) {
    return null;
  }
  const raw = uri.slice(METAFILE_SCHEME.length).trim().replace(/^\/+/, '');
  if (raw.includes('/')) {
    return null;
  }
  return isSafeEvolutionIdentifier(raw) ? raw : null;
}

export function parsePublishedArtifactMetadata(value: unknown): PublishedEvolutionArtifactMetadata | null {
  const source = normalizeMetadataSource(value);
  if (!source) {
    return null;
  }

  const protocolVersion = toNonEmptyString(source.protocolVersion);
  const skillName = toNonEmptyString(source.skillName);
  const variantId = toNonEmptyString(source.variantId);
  const artifactUri = toNonEmptyString(source.artifactUri);
  const evolutionType = toNonEmptyString(source.evolutionType);
  const triggerSource = toNonEmptyString(source.triggerSource);
  const scopeHash = toNonEmptyString(source.scopeHash);
  const publisherGlobalMetaId = toNonEmptyString(source.publisherGlobalMetaId);
  const artifactCreatedAt = toFiniteNumber(source.artifactCreatedAt);
  const artifactUpdatedAt = toFiniteNumber(source.artifactUpdatedAt);
  const publishedAt = toFiniteNumber(source.publishedAt);
  const lineage = parseLineage(source.lineage);

  if (
    protocolVersion !== EVOLUTION_ARTIFACT_PROTOCOL_VERSION
    || evolutionType !== 'FIX'
    || !skillName
    || !variantId
    || !artifactUri
    || !triggerSource
    || !scopeHash
    || !publisherGlobalMetaId
    || artifactCreatedAt == null
    || artifactUpdatedAt == null
    || publishedAt == null
    || !lineage
  ) {
    return null;
  }

  if (
    !isSafeEvolutionIdentifier(variantId)
    || parseMetafilePinId(artifactUri) == null
    || typeof source.sameSkill !== 'boolean'
    || typeof source.sameScope !== 'boolean'
    || typeof source.verificationPassed !== 'boolean'
    || typeof source.replayValid !== 'boolean'
    || typeof source.notWorseThanBase !== 'boolean'
  ) {
    return null;
  }

  return {
    protocolVersion: EVOLUTION_ARTIFACT_PROTOCOL_VERSION,
    skillName,
    variantId,
    artifactUri,
    evolutionType: 'FIX',
    triggerSource,
    scopeHash,
    sameSkill: source.sameSkill,
    sameScope: source.sameScope,
    verificationPassed: source.verificationPassed,
    replayValid: source.replayValid,
    notWorseThanBase: source.notWorseThanBase,
    lineage,
    publisherGlobalMetaId,
    artifactCreatedAt,
    artifactUpdatedAt,
    publishedAt,
  };
}

export function validateShareableArtifactBody(value: unknown): SkillVariantArtifact | null {
  if (!isRecord(value)) {
    return null;
  }

  const variantId = toNonEmptyString(value.variantId);
  const skillName = toNonEmptyString(value.skillName);
  const createdAt = toFiniteNumber(value.createdAt);
  const updatedAt = toFiniteNumber(value.updatedAt);
  const scope = parseScope(value.scope);
  const metadata = parseScopeMetadata(value.metadata);
  const patch = isRecord(value.patch) ? value.patch : null;
  const lineage = parseLineage(value.lineage);
  const verification = parseVerification(value.verification);

  if (
    !variantId
    || !skillName
    || !isSafeEvolutionIdentifier(variantId)
    || !scope
    || !metadata
    || !patch
    || !lineage
    || !verification
    || createdAt == null
    || updatedAt == null
  ) {
    return null;
  }

  return {
    variantId,
    skillName,
    status: 'inactive',
    adoption: 'manual',
    scope,
    metadata,
    patch: patch as SkillVariantArtifact['patch'],
    lineage,
    verification,
    createdAt,
    updatedAt,
  };
}
