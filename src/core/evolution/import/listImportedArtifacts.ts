import type { RemoteEvolutionStore } from '../remoteEvolutionStore';
import type {
  ImportedEvolutionArtifactSummaryRow,
  ImportedRemoteArtifactSidecar,
  SkillActiveVariantRef,
} from '../types';
import { validateShareableArtifactBody } from './publishedArtifactProtocol';

type ImportedListFailureCode = 'evolution_import_not_supported' | 'evolution_imported_artifact_invalid';

const SUPPORTED_SKILL = 'metabot-network-directory';

interface CodedError extends Error {
  code: ImportedListFailureCode;
}

function createListError(code: ImportedListFailureCode, message: string): CodedError {
  const error = new Error(message) as CodedError;
  error.code = code;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeSidecar(value: unknown): ImportedRemoteArtifactSidecar | null {
  if (!isRecord(value)) {
    return null;
  }

  const pinId = toNonEmptyString(value.pinId);
  const variantId = toNonEmptyString(value.variantId);
  const publisherGlobalMetaId = toNonEmptyString(value.publisherGlobalMetaId);
  const artifactUri = toNonEmptyString(value.artifactUri);
  const skillName = toNonEmptyString(value.skillName);
  const scopeHash = toNonEmptyString(value.scopeHash);
  const publishedAt = toFiniteNumber(value.publishedAt);
  const importedAt = toFiniteNumber(value.importedAt);

  if (
    !pinId
    || !variantId
    || !publisherGlobalMetaId
    || !artifactUri
    || !skillName
    || !scopeHash
    || publishedAt == null
    || importedAt == null
  ) {
    return null;
  }

  return {
    pinId,
    variantId,
    publisherGlobalMetaId,
    artifactUri,
    skillName,
    scopeHash,
    publishedAt,
    importedAt,
  };
}

export async function listImportedEvolutionArtifacts(input: {
  skillName: string;
  activeRef: SkillActiveVariantRef | null;
  remoteStore: Pick<RemoteEvolutionStore, 'readIndex' | 'readArtifact' | 'readSidecar'>;
}): Promise<{
  skillName: string;
  count: number;
  results: ImportedEvolutionArtifactSummaryRow[];
}> {
  if (input.skillName !== SUPPORTED_SKILL) {
    throw createListError(
      'evolution_import_not_supported',
      `Import is currently supported only for "${SUPPORTED_SKILL}"`
    );
  }

  const remoteIndex = await input.remoteStore.readIndex();
  const results: ImportedEvolutionArtifactSummaryRow[] = [];

  for (const variantId of remoteIndex.imports) {
    let rawSidecar: Awaited<ReturnType<typeof input.remoteStore.readSidecar>>;
    let rawArtifact: Awaited<ReturnType<typeof input.remoteStore.readArtifact>>;

    try {
      [rawSidecar, rawArtifact] = await Promise.all([
        input.remoteStore.readSidecar(variantId),
        input.remoteStore.readArtifact(variantId),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw createListError(
        'evolution_imported_artifact_invalid',
        `Imported artifact "${variantId}" could not be read: ${message}`
      );
    }

    if (rawSidecar == null || rawArtifact == null) {
      continue;
    }

    const sidecar = normalizeSidecar(rawSidecar);
    const artifact = validateShareableArtifactBody(rawArtifact);
    if (!sidecar || !artifact) {
      throw createListError(
        'evolution_imported_artifact_invalid',
        `Imported artifact "${variantId}" is malformed`
      );
    }

    if (
      sidecar.variantId !== variantId
      || artifact.variantId !== variantId
      || sidecar.skillName !== input.skillName
      || artifact.skillName !== input.skillName
      || sidecar.scopeHash !== artifact.metadata.scopeHash
    ) {
      throw createListError(
        'evolution_imported_artifact_invalid',
        `Imported artifact "${variantId}" has inconsistent metadata`
      );
    }

    const active = input.activeRef?.source === 'remote' && input.activeRef.variantId === variantId;
    results.push({
      variantId,
      pinId: sidecar.pinId,
      skillName: sidecar.skillName,
      publisherGlobalMetaId: sidecar.publisherGlobalMetaId,
      artifactUri: sidecar.artifactUri,
      publishedAt: sidecar.publishedAt,
      importedAt: sidecar.importedAt,
      scopeHash: sidecar.scopeHash,
      verificationPassed: artifact.verification.passed,
      replayValid: artifact.verification.replayValid,
      notWorseThanBase: artifact.verification.notWorseThanBase,
      active,
    });
  }

  results.sort((left, right) => {
    const importedAtSort = right.importedAt - left.importedAt;
    if (importedAtSort !== 0) {
      return importedAtSort;
    }
    return left.variantId.localeCompare(right.variantId);
  });

  return {
    skillName: input.skillName,
    count: results.length,
    results,
  };
}
