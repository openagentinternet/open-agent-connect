/**
 * Metafile artifact proxy (M9 — reviewer tooling): resolves a `metafile://`
 * reference to its bytes through the MAN content route, reassembling chunked
 * uploads (chunkList concat in listed order) and verifying the aggregate
 * sha256 against the manifest before serving. Content pins are immutable, so
 * resolved bytes cache in-process.
 *
 * Recipe (verified against the v1.3 pilot's S5 package, 2026-10-04):
 *  1. `GET https://manapi.metaid.io/content/<pinId>` → JSON manifest
 *     `{ sha256, fileSize, chunkNumber, chunkSize, dataType, name, chunkList[] }`.
 *  2. Small files answer with inline bytes directly; chunked files list
 *     `chunkList[{sha256, pinId}]`.
 *  3. Fetch each chunk via the same route (raw bytes), concatenate IN LISTED
 *     ORDER, verify sha256(file) == manifest.sha256.
 *  4. Serve with the manifest's dataType and name.
 * The suffixed URI form (`metafile://<pin>.gz`) 404s on the content route —
 * resolve by the bare 66-char pin id. Bare-pin `metafile://` URIs without an
 * extension are valid and must be accepted.
 */
export declare const DEFAULT_MANAPI_CONTENT_BASE_URL = "https://manapi.metaid.io";
export interface MetafileContent {
    pinId: string;
    body: Buffer;
    contentType: string;
    fileName: string;
    sha256: string;
}
export type MetafileProxyOptions = {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
/** metafile:// URI | bare pin | any MAN content URL → the bare 66-char pin id. */
export declare function normalizeMetafileReference(reference: string): string | null;
/** Resolved-bytes cache so repeat downloads (immutable content) cost nothing. */
export declare function cachedMetafileContent(pinId: string): MetafileContent | null;
/**
 * Resolve one metafile reference to verified bytes. Returns null on any
 * failure (unknown pin, fetch error, size cap, sha256 mismatch) — a broken
 * artifact must never be served as good.
 */
export declare function fetchMetafileContent(reference: string, options?: MetafileProxyOptions): Promise<MetafileContent | null>;
