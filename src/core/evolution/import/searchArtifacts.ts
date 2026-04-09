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

export function deriveResolvedScopeHash(resolved: {
  scopeMetadata?: {
    scopeHash?: string | null;
  } | null;
  scope: unknown;
}): string {
  const scopedHash = toNonEmptyString(resolved.scopeMetadata?.scopeHash);
  return scopedHash ?? JSON.stringify(resolved.scope);
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
      throw new Error('invalid_page_payload');
    }
    rawRows = fetchedRows.slice(0, EVOLUTION_SEARCH_MAX_RAW_ROWS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`evolution_search_fetch_failed:${message}`);
  }

  const remoteIndex = await input.remoteStore.readIndex();
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
