import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeMetaAppPinId } from './pinId';

/**
 * Provenance marker written into a workspace directory by
 * `metabot metaapp source --out <dir>` when a MetaApp package is forked for
 * editing/remixing. The publish flow reads it to default the manifest's
 * `forkedFrom` lineage and to inherit capability tags. The marker is local
 * provenance only; it is never shipped inside the published zip.
 *
 * Mirrors the IDBots `.idbots-fork.json` flow with a host-neutral name.
 */
export const METAAPP_FORK_MARKER = '.metaapp-fork.json';

export interface MetaAppForkMarker {
  sourcePinId: string;
  sourceUri: string;
  title: string;
  indexFile: string;
  /** Capability/protocol tags inherited from the source app, when known. */
  tags?: string[];
  /** ISO-8601 timestamp of the fork materialization. */
  forkedAt: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeForkedAt(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  // Tolerate epoch-millisecond markers written by other hosts.
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  return '';
}

/** Write the fork marker into a workspace directory; returns the marker path. */
export async function writeMetaAppForkMarker(dir: string, marker: MetaAppForkMarker): Promise<string> {
  const markerPath = path.join(dir, METAAPP_FORK_MARKER);
  await fs.writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  return markerPath;
}

/**
 * Read the fork marker written by `metabot metaapp source --out`, if present.
 * Returns null when the file is missing, malformed, or carries an invalid
 * source pin id (a broken marker must never inject garbage into an on-chain
 * manifest).
 */
export async function readMetaAppForkMarker(dir: string): Promise<MetaAppForkMarker | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, METAAPP_FORK_MARKER), 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const sourcePinId = normalizeMetaAppPinId(record.sourcePinId);
  if (!sourcePinId) {
    return null;
  }

  const tags = Array.isArray(record.tags)
    ? record.tags.map((tag) => normalizeText(tag)).filter(Boolean)
    : [];

  return {
    sourcePinId,
    sourceUri: normalizeText(record.sourceUri) || `metaapp://${sourcePinId}`,
    title: normalizeText(record.title),
    indexFile: normalizeText(record.indexFile) || 'index.html',
    ...(tags.length > 0 ? { tags } : {}),
    forkedAt: normalizeForkedAt(record.forkedAt),
  };
}
