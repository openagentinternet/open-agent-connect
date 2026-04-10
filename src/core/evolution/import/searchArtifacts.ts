import type { RemoteEvolutionStore } from '../remoteEvolutionStore';
import type { PublishedEvolutionSearchResultSummaryRow } from '../types';
import {
  EVOLUTION_SEARCH_MAX_RAW_ROWS,
  parsePublishedArtifactMetadata,
} from './publishedArtifactProtocol';

export { EVOLUTION_SEARCH_MAX_RAW_ROWS };

export type PublishedEvolutionArtifactSearchResult = PublishedEvolutionSearchResultSummaryRow;

interface MetadataRow {
  pinId: string;
  payload: unknown;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSameOrNewerCandidate(input: {
  incomingPublishedAt: number;
  incomingPinId: string;
  currentPublishedAt: number;
  currentPinId: string;
}): boolean {
  if (input.incomingPublishedAt !== input.currentPublishedAt) {
    return input.incomingPublishedAt > input.currentPublishedAt;
  }
  return input.incomingPinId.localeCompare(input.currentPinId) < 0;
}

function parseTriggerSource(value: string): PublishedEvolutionArtifactSearchResult['triggerSource'] | null {
  if (value === 'hard_failure' || value === 'soft_failure' || value === 'manual_recovery') {
    return value;
  }
  return null;
}

function createMissingScopeHashError(): Error {
  return new Error('evolution_scope_hash_missing');
}

function createSearchError(
  code: 'evolution_chain_query_failed' | 'evolution_search_result_invalid' | 'evolution_search_index_failed',
  detail: string
): Error {
  return new Error(`${code}:${detail}`);
}

export function deriveResolvedScopeHash(resolved: {
  scopeMetadata?: {
    scopeHash?: string | null;
  } | null;
  scope: unknown;
}): string {
  const scopedHash = toNonEmptyString(resolved.scopeMetadata?.scopeHash);
  if (scopedHash) {
    return scopedHash;
  }
  try {
    const serialized = JSON.stringify(resolved.scope);
    if (typeof serialized !== 'string' || serialized.length === 0) {
      throw createMissingScopeHashError();
    }
    return serialized;
  } catch (error) {
    if (error instanceof Error && error.message === 'evolution_scope_hash_missing') {
      throw error;
    }
    throw createMissingScopeHashError();
  }
}

export async function searchPublishedEvolutionArtifacts(input: {
  skillName: string;
  resolvedScopeHash: string;
  remoteStore: Pick<RemoteEvolutionStore, 'readIndex'>;
  fetchMetadataRows: () => Promise<Array<{ pinId: string; payload: unknown }>>;
}): Promise<{
  skillName: string;
  scopeHash: string;
  count: number;
  results: PublishedEvolutionArtifactSearchResult[];
}> {
  let rawRows: MetadataRow[];
  try {
    const fetchedRows = await input.fetchMetadataRows();
    if (!Array.isArray(fetchedRows)) {
      throw createSearchError('evolution_search_result_invalid', 'invalid_page_payload');
    }
    rawRows = fetchedRows.slice(0, EVOLUTION_SEARCH_MAX_RAW_ROWS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('evolution_search_result_invalid:')) {
      throw new Error(message);
    }
    throw createSearchError('evolution_chain_query_failed', message);
  }

  let remoteIndex: Awaited<ReturnType<typeof input.remoteStore.readIndex>>;
  try {
    remoteIndex = await input.remoteStore.readIndex();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createSearchError('evolution_search_index_failed', message);
  }
  const dedupedByVariantId = new Map<string, PublishedEvolutionArtifactSearchResult>();

  for (const row of rawRows) {
    const pinId = toNonEmptyString(row?.pinId);
    if (!pinId) {
      continue;
    }
    const metadata = parsePublishedArtifactMetadata(row.payload);
    if (!metadata) {
      continue;
    }
    const triggerSource = parseTriggerSource(metadata.triggerSource);
    if (!triggerSource) {
      continue;
    }
    if (
      metadata.skillName !== input.skillName
      || metadata.scopeHash !== input.resolvedScopeHash
      || metadata.verificationPassed !== true
    ) {
      continue;
    }

    const existing = dedupedByVariantId.get(metadata.variantId);
    if (existing && !isSameOrNewerCandidate({
      incomingPublishedAt: metadata.publishedAt,
      incomingPinId: pinId,
      currentPublishedAt: existing.publishedAt,
      currentPinId: existing.pinId,
    })) {
      continue;
    }

    const importedPinId = remoteIndex.byVariantId[metadata.variantId]?.pinId ?? null;
    dedupedByVariantId.set(metadata.variantId, {
      pinId,
      variantId: metadata.variantId,
      skillName: metadata.skillName,
      artifactUri: metadata.artifactUri,
      publisherGlobalMetaId: metadata.publisherGlobalMetaId,
      publishedAt: metadata.publishedAt,
      scopeHash: metadata.scopeHash,
      triggerSource,
      verificationPassed: metadata.verificationPassed,
      replayValid: metadata.replayValid,
      notWorseThanBase: metadata.notWorseThanBase,
      alreadyImported: importedPinId !== null,
      importedPinId,
    });
  }

  const results = [...dedupedByVariantId.values()].sort((left, right) => {
    const publishedAtSort = right.publishedAt - left.publishedAt;
    if (publishedAtSort !== 0) return publishedAtSort;
    return left.pinId.localeCompare(right.pinId);
  });

  return {
    skillName: input.skillName,
    scopeHash: input.resolvedScopeHash,
    count: results.length,
    results,
  };
}
