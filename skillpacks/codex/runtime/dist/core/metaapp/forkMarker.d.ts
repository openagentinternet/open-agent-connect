/**
 * Provenance marker written into a workspace directory by
 * `metabot metaapp source --out <dir>` when a MetaApp package is forked for
 * editing/remixing. The publish flow reads it to default the manifest's
 * `forkedFrom` lineage and to inherit capability tags. The marker is local
 * provenance only; it is never shipped inside the published zip.
 *
 * Mirrors the IDBots `.idbots-fork.json` flow with a host-neutral name.
 */
export declare const METAAPP_FORK_MARKER = ".metaapp-fork.json";
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
/** Write the fork marker into a workspace directory; returns the marker path. */
export declare function writeMetaAppForkMarker(dir: string, marker: MetaAppForkMarker): Promise<string>;
/**
 * Read the fork marker written by `metabot metaapp source --out`, if present.
 * Returns null when the file is missing, malformed, or carries an invalid
 * source pin id (a broken marker must never inject garbage into an on-chain
 * manifest).
 */
export declare function readMetaAppForkMarker(dir: string): Promise<MetaAppForkMarker | null>;
