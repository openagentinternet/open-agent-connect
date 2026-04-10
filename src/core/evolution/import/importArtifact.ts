import type { RemoteEvolutionStore } from '../remoteEvolutionStore';
import type { ImportedRemoteArtifactSidecar } from '../types';
import {
  parsePublishedArtifactMetadata,
  validateShareableArtifactBody,
} from './publishedArtifactProtocol';

type ImportFailureCode =
  | 'evolution_import_metadata_invalid'
  | 'evolution_import_pin_not_found'
  | 'evolution_import_not_supported'
  | 'evolution_import_scope_mismatch'
  | 'evolution_import_variant_conflict'
  | 'evolution_import_artifact_fetch_failed'
  | 'evolution_import_artifact_invalid';

type CodedError = Error & { code: ImportFailureCode };

const SUPPORTED_SKILL = 'metabot-network-directory';

function createImportError(code: ImportFailureCode, message: string): CodedError {
  const error = new Error(message) as CodedError;
  error.code = code;
  return error;
}

function isVariantAlreadyImported(
  index: {
    byVariantId?: Record<string, { pinId?: string }>;
  } | null | undefined,
  variantId: string
): boolean {
  if (!index || typeof index !== 'object' || !index.byVariantId || typeof index.byVariantId !== 'object') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(index.byVariantId, variantId);
}

function normalizeArtifactBody(rawBody: unknown): unknown {
  if (typeof rawBody !== 'string') {
    return rawBody;
  }
  return JSON.parse(rawBody) as unknown;
}

function hasImportableVerificationTuple(metadata: NonNullable<ReturnType<typeof parsePublishedArtifactMetadata>>): boolean {
  return (
    metadata.verificationPassed === true
    && metadata.replayValid === true
    && metadata.notWorseThanBase === true
  );
}

function doesArtifactMatchMetadata(input: {
  artifact: NonNullable<ReturnType<typeof validateShareableArtifactBody>>;
  metadata: NonNullable<ReturnType<typeof parsePublishedArtifactMetadata>>;
}): boolean {
  const { artifact, metadata } = input;
  return (
    artifact.variantId === metadata.variantId
    && artifact.skillName === metadata.skillName
    && artifact.metadata.scopeHash === metadata.scopeHash
    && artifact.lineage.lineageId === metadata.lineage.lineageId
    && artifact.lineage.parentVariantId === metadata.lineage.parentVariantId
    && artifact.lineage.rootVariantId === metadata.lineage.rootVariantId
    && artifact.lineage.executionId === metadata.lineage.executionId
    && artifact.lineage.analysisId === metadata.lineage.analysisId
    && artifact.lineage.createdAt === metadata.lineage.createdAt
    && artifact.verification.passed === metadata.verificationPassed
    && artifact.verification.replayValid === metadata.replayValid
    && artifact.verification.notWorseThanBase === metadata.notWorseThanBase
  );
}

export async function importPublishedEvolutionArtifact(input: {
  pinId: string;
  skillName: string;
  resolvedScopeHash: string;
  remoteStore: RemoteEvolutionStore;
  readMetadataPinById: (pinId: string) => Promise<unknown | null>;
  readArtifactBodyByUri: (artifactUri: string) => Promise<unknown>;
  now?: () => number;
}): Promise<{
  pinId: string;
  variantId: string;
  skillName: string;
  publisherGlobalMetaId: string;
  artifactUri: string;
  artifactPath: string;
  metadataPath: string;
  importedAt: number;
}> {
  let metadataPin: unknown | null;
  try {
    metadataPin = await input.readMetadataPinById(input.pinId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createImportError(
      'evolution_import_metadata_invalid',
      `Failed to read metadata pin "${input.pinId}": ${message}`
    );
  }
  if (metadataPin == null) {
    throw createImportError(
      'evolution_import_pin_not_found',
      `Metadata pin "${input.pinId}" was not found`
    );
  }

  const metadata = parsePublishedArtifactMetadata(metadataPin);
  if (!metadata) {
    throw createImportError(
      'evolution_import_metadata_invalid',
      `Metadata pin "${input.pinId}" is malformed or incompatible`
    );
  }

  if (
    input.skillName !== SUPPORTED_SKILL
    || metadata.skillName !== SUPPORTED_SKILL
    || metadata.skillName !== input.skillName
  ) {
    throw createImportError(
      'evolution_import_not_supported',
      `Import is currently supported only for "${SUPPORTED_SKILL}"`
    );
  }

  if (!hasImportableVerificationTuple(metadata)) {
    throw createImportError(
      'evolution_import_metadata_invalid',
      `Metadata pin "${input.pinId}" is missing required verification guarantees`
    );
  }

  if (metadata.scopeHash !== input.resolvedScopeHash) {
    throw createImportError(
      'evolution_import_scope_mismatch',
      'Metadata scopeHash does not match the resolved local scope hash'
    );
  }

  const remoteIndex = await input.remoteStore.readIndex();
  if (isVariantAlreadyImported(remoteIndex, metadata.variantId)) {
    throw createImportError(
      'evolution_import_variant_conflict',
      `Variant "${metadata.variantId}" is already imported`
    );
  }

  let fetchedBody: unknown;
  try {
    const rawBody = await input.readArtifactBodyByUri(metadata.artifactUri);
    fetchedBody = normalizeArtifactBody(rawBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createImportError(
      'evolution_import_artifact_fetch_failed',
      `Failed to read published artifact body: ${message}`
    );
  }

  const artifact = validateShareableArtifactBody(fetchedBody);
  if (!artifact) {
    throw createImportError(
      'evolution_import_artifact_invalid',
      'Artifact body failed structural validation'
    );
  }

  if (!doesArtifactMatchMetadata({ artifact, metadata })) {
    throw createImportError(
      'evolution_import_artifact_invalid',
      'Artifact body does not match metadata fields'
    );
  }

  const importedAt = (input.now ?? (() => Date.now()))();
  const sidecar: ImportedRemoteArtifactSidecar = {
    pinId: input.pinId,
    variantId: metadata.variantId,
    publisherGlobalMetaId: metadata.publisherGlobalMetaId,
    artifactUri: metadata.artifactUri,
    skillName: metadata.skillName,
    scopeHash: metadata.scopeHash,
    publishedAt: metadata.publishedAt,
    importedAt,
  };

  try {
    const writeResult = await input.remoteStore.writeImport({
      artifact,
      sidecar,
    });

    return {
      pinId: input.pinId,
      variantId: metadata.variantId,
      skillName: metadata.skillName,
      publisherGlobalMetaId: metadata.publisherGlobalMetaId,
      artifactUri: metadata.artifactUri,
      artifactPath: writeResult.artifactPath,
      metadataPath: writeResult.metadataPath,
      importedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already imported/i.test(message)) {
      throw createImportError(
        'evolution_import_variant_conflict',
        `Variant "${metadata.variantId}" is already imported`
      );
    }
    throw error;
  }
}
