import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetaAppPinToRecord } from '@openagentinternet/agent-browser-core';
import {
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../contracts/commandResult';
import {
  createMetaAppArtifactCacheStore,
  type MetaAppArtifactCacheEntry,
  type MetaAppArtifactCacheStore,
} from './artifactCache';
import { resolveMetaAppArtifact } from './artifactDownload';
import {
  METAAPP_FORK_MARKER,
  writeMetaAppForkMarker,
  type MetaAppForkMarker,
} from './forkMarker';
import { normalizeMetaAppPinId } from './pinId';

/**
 * `metabot metaapp source` backend: resolve a MetaApp pin, download its zip
 * package through the shared metafile/artifact-cache path (the same one the
 * daemon uses for `/browser/metaapp/<pinId>`), and either point the caller at
 * the extracted cache directory or copy it into a workspace directory with a
 * `.metaapp-fork.json` provenance marker for later publishing.
 */

export interface MetaAppSourceInput {
  /** Bare MetaApp pinId (64-hex + i0); the CLI layer normalizes metaapp:// URIs. */
  pinId: string;
  /** Optional workspace directory to copy the extracted source into. */
  outDir?: string;
}

export interface MetaAppSourceDependencies {
  /** Actor home directory whose artifact cache is shared with the Browser. */
  homeDir: string;
  fetch?: typeof fetch;
  manApiBaseUrl?: string;
  metafileContentBaseUrl?: string;
  /** Test seam; production uses createMetaAppArtifactCacheStore(homeDir). */
  artifactCache?: MetaAppArtifactCacheStore;
  now?: () => number;
}

interface ResolvedSourcePackage {
  artifact: MetaAppArtifactCacheEntry;
  title: string;
  tags: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean)
    : [];
}

function mapResolveFailure(result: { code?: string; message?: string }): MetabotCommandResult<never> {
  const message = result.message || 'Unable to resolve the MetaApp pin.';
  switch (result.code) {
    case 'invalid_browser_uri':
      return commandFailed('invalid_argument', message);
    case 'browser_resource_not_found':
      return commandFailed('metaapp_not_found', message);
    case 'browser_resource_disabled':
      return commandFailed('metaapp_disabled', message);
    case 'browser_protocol_mismatch':
      return commandFailed('metaapp_protocol_mismatch', message);
    default:
      return commandFailed('metaapp_source_failed', message);
  }
}

async function resolveSourcePackage(
  pinId: string,
  deps: MetaAppSourceDependencies,
  artifactCache: MetaAppArtifactCacheStore,
): Promise<ResolvedSourcePackage | MetabotCommandResult<never>> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return commandFailed('metaapp_source_failed', 'A fetch implementation is required to resolve MetaApp pins.');
  }

  // The pin resolver hands the package descriptor to this hook, mirroring the
  // daemon host adapter's createPreviewSession integration. The download into
  // the artifact cache happens afterwards via the shared artifactDownload
  // path so failures map to precise CLI error codes.
  const captured: {
    descriptor?: {
      contentReference: string;
      contentType: string;
      indexFile: string;
      pinRecord: Record<string, unknown>;
    };
  } = {};
  const resolved = await resolveMetaAppPinToRecord({
    pinId,
    fetch: fetchImpl,
    manApiBaseUrl: deps.manApiBaseUrl,
    metafileContentBaseUrl: deps.metafileContentBaseUrl,
    createPreviewSession: (input) => {
      captured.descriptor = {
        contentReference: input.contentReference,
        contentType: input.contentType,
        indexFile: input.indexFile,
        pinRecord: input.pinRecord,
      };
      return { localPreviewUrl: '' };
    },
  });
  if (!resolved.ok) {
    return mapResolveFailure(resolved);
  }
  const descriptor = captured.descriptor;
  if (!descriptor) {
    return commandFailed('metaapp_source_failed', 'MetaApp pin resolution did not return a package descriptor.');
  }

  let artifact: MetaAppArtifactCacheEntry | null;
  try {
    artifact = await resolveMetaAppArtifact({
      pinId,
      contentReference: descriptor.contentReference,
      contentType: descriptor.contentType,
      indexFile: descriptor.indexFile,
      pinRecord: descriptor.pinRecord,
      artifactCache,
      fetchImpl,
    });
  } catch (error) {
    return commandFailed('metaapp_source_download_failed', errorMessage(error));
  }
  if (!artifact) {
    return commandFailed(
      'metaapp_source_unsupported',
      'MetaApp package content is not a downloadable ZIP archive; its source cannot be materialized.',
    );
  }

  const record = resolved.data;
  return {
    artifact,
    title: record.title || record.appName || pinId,
    tags: normalizeTags(record.tags),
  };
}

export async function materializeMetaAppSource(
  input: MetaAppSourceInput,
  deps: MetaAppSourceDependencies,
): Promise<MetabotCommandResult<Record<string, unknown>>> {
  const pinId = normalizeMetaAppPinId(input.pinId);
  if (!pinId) {
    return commandFailed('invalid_argument', 'Invalid MetaApp pinId. Expected a 64-hex MetaWeb pinId ending in i0.');
  }

  const artifactCache = deps.artifactCache ?? createMetaAppArtifactCacheStore(deps.homeDir);
  const resolved = await resolveSourcePackage(pinId, deps, artifactCache);
  if ('state' in resolved) {
    return resolved;
  }

  const { artifact, title, tags } = resolved;
  if (!input.outDir) {
    return commandSuccess({
      dir: artifact.artifactDir,
      indexFile: artifact.indexFile,
      title,
      sourcePinId: pinId,
    });
  }

  const outDir = path.resolve(input.outDir);
  try {
    const existing = await fs.readdir(outDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (existing && existing.length > 0) {
      return commandFailed(
        'metaapp_source_out_not_empty',
        `Output directory is not empty: ${outDir}. Choose an empty or new directory so app files are not overwritten.`,
      );
    }

    await fs.mkdir(outDir, { recursive: true });
    await fs.cp(artifact.artifactDir, outDir, {
      recursive: true,
      // A marker in the source tree is stale provenance; the fresh one below
      // records this fork instead.
      filter: (sourcePath) => path.basename(sourcePath) !== METAAPP_FORK_MARKER,
    });

    const marker: MetaAppForkMarker = {
      sourcePinId: pinId,
      sourceUri: `metaapp://${pinId}`,
      title,
      indexFile: artifact.indexFile,
      ...(tags.length > 0 ? { tags } : {}),
      forkedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    };
    const markerPath = await writeMetaAppForkMarker(outDir, marker);

    return commandSuccess({
      dir: outDir,
      indexFile: artifact.indexFile,
      title,
      sourcePinId: pinId,
      sourceUri: marker.sourceUri,
      markerPath,
    });
  } catch (error) {
    return commandFailed('metaapp_source_failed', errorMessage(error));
  }
}
