import type { LocalEvolutionStore } from './localEvolutionStore';
import type { RemoteEvolutionStore } from './remoteEvolutionStore';

type RemoteAdoptionFailureCode =
  | 'evolution_remote_adopt_not_supported'
  | 'evolution_remote_variant_not_found'
  | 'evolution_remote_variant_skill_mismatch'
  | 'evolution_remote_variant_scope_mismatch'
  | 'evolution_remote_variant_invalid';

type CodedError = Error & { code: RemoteAdoptionFailureCode };

const SUPPORTED_SKILL = 'metabot-network-directory';

function createRemoteAdoptionError(code: RemoteAdoptionFailureCode, message: string): CodedError {
  const error = new Error(message) as CodedError;
  error.code = code;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasValidVerificationTuple(verification: unknown): boolean {
  if (!isRecord(verification)) {
    return false;
  }
  return (
    verification.passed === true
    && verification.protocolCompatible === true
    && verification.replayValid === true
    && verification.notWorseThanBase === true
    && typeof verification.checkedAt === 'number'
    && Number.isFinite(verification.checkedAt)
  );
}

export async function adoptRemoteEvolutionArtifact(input: {
  skillName: string;
  variantId: string;
  resolvedScopeHash: string;
  remoteStore: Pick<RemoteEvolutionStore, 'readArtifact' | 'readSidecar'>;
  evolutionStore: Pick<LocalEvolutionStore, 'setActiveVariantRef'>;
}): Promise<{
  skillName: string;
  variantId: string;
  source: 'remote';
  active: true;
}> {
  if (input.skillName !== SUPPORTED_SKILL) {
    throw createRemoteAdoptionError(
      'evolution_remote_adopt_not_supported',
      `Remote adoption is currently supported only for "${SUPPORTED_SKILL}"`
    );
  }

  let artifact: Awaited<ReturnType<typeof input.remoteStore.readArtifact>>;
  let sidecar: Awaited<ReturnType<typeof input.remoteStore.readSidecar>>;
  try {
    [artifact, sidecar] = await Promise.all([
      input.remoteStore.readArtifact(input.variantId),
      input.remoteStore.readSidecar(input.variantId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createRemoteAdoptionError(
      'evolution_remote_variant_invalid',
      `Remote variant "${input.variantId}" could not be read: ${message}`
    );
  }

  if (!artifact || !sidecar) {
    throw createRemoteAdoptionError(
      'evolution_remote_variant_not_found',
      `Remote variant "${input.variantId}" is not available in imported artifacts`
    );
  }

  if (artifact.variantId !== input.variantId || sidecar.variantId !== input.variantId) {
    throw createRemoteAdoptionError(
      'evolution_remote_variant_invalid',
      `Remote variant "${input.variantId}" has inconsistent imported metadata`
    );
  }

  if (artifact.skillName !== input.skillName) {
    throw createRemoteAdoptionError(
      'evolution_remote_variant_skill_mismatch',
      `Remote variant "${input.variantId}" does not match requested skill "${input.skillName}"`
    );
  }

  if (sidecar.skillName !== input.skillName) {
    throw createRemoteAdoptionError(
      'evolution_remote_variant_skill_mismatch',
      `Remote variant "${input.variantId}" sidecar does not match requested skill "${input.skillName}"`
    );
  }

  if (typeof sidecar.scopeHash !== 'string') {
    throw createRemoteAdoptionError(
      'evolution_remote_variant_invalid',
      `Remote variant "${input.variantId}" sidecar is missing scope metadata`
    );
  }

  if (sidecar.scopeHash !== input.resolvedScopeHash) {
    throw createRemoteAdoptionError(
      'evolution_remote_variant_scope_mismatch',
      `Remote variant "${input.variantId}" scopeHash does not match resolved local scope`
    );
  }

  if (!isRecord(artifact.metadata) || typeof artifact.metadata.scopeHash !== 'string') {
    throw createRemoteAdoptionError(
      'evolution_remote_variant_invalid',
      `Remote variant "${input.variantId}" is missing artifact scope metadata`
    );
  }

  if (artifact.metadata.scopeHash !== sidecar.scopeHash) {
    throw createRemoteAdoptionError(
      'evolution_remote_variant_invalid',
      `Remote variant "${input.variantId}" has inconsistent scope metadata`
    );
  }

  if (!hasValidVerificationTuple(artifact.verification)) {
    throw createRemoteAdoptionError(
      'evolution_remote_variant_invalid',
      `Remote variant "${input.variantId}" failed verification requirements`
    );
  }

  await input.evolutionStore.setActiveVariantRef(input.skillName, {
    source: 'remote',
    variantId: input.variantId,
  });

  return {
    skillName: input.skillName,
    variantId: input.variantId,
    source: 'remote',
    active: true,
  };
}
