/**
 * Live model-catalog discovery for the flagship providers, ported from
 * multica's discovery layer (models.go / claude_models.go / thinking.go).
 *
 * Claude Code has no --list-models flag; the catalog is answered over the
 * stream-json control protocol (`list_models` control request), computed by
 * the installed binary against the logged-in account. Codex exposes
 * `codex debug models` (0.122.0+; live account-visible catalog, `--bundled`
 * offline snapshot). Cursor ships `cursor-agent --list-models` as `id - Label`
 * rows. Every live failure degrades to a static fallback that is flagged
 * non-authoritative so callers must never persist or hard-validate against
 * it — a stale guess must not overwrite what the CLI actually offers.
 */
export type ModelCatalogProvider = 'claude-code' | 'codex' | 'cursor';
export interface ModelCatalogEntry {
    /** Model id to pass through to the CLI's model flag. */
    id: string;
    label: string;
    default?: boolean;
    /** Present but not runnable on this install (claude picker rows). */
    disabled?: boolean;
}
export type ModelCatalogSource = 'live' | 'bundled' | 'static';
export interface ModelCatalog {
    provider: ModelCatalogProvider;
    source: ModelCatalogSource;
    models: ModelCatalogEntry[];
    /** Why live discovery degraded, when source is not 'live'. */
    reason?: string;
}
export interface ModelCatalogInput {
    provider: ModelCatalogProvider;
    binaryPath: string;
    env?: NodeJS.ProcessEnv;
    /** Pre-detected CLI version, used for the codex debug-models gate. */
    version?: string;
    timeoutMs?: number;
}
/** Static fallback, ported from multica's claudeStaticModels (2026-10). */
export declare const CLAUDE_STATIC_MODELS: ModelCatalogEntry[];
/** Static fallback, ported from multica's codexStaticModels (2026-10). */
export declare const CODEX_STATIC_MODELS: ModelCatalogEntry[];
/** Minimal static fallback: cursor model ids shift too fast to bake (multica). */
export declare const CURSOR_STATIC_MODELS: ModelCatalogEntry[];
/**
 * Discovers the model catalog for a provider. Never throws: every failure
 * path degrades to the flagged static fallback so callers can render a
 * usable picker offline.
 */
export declare function discoverModelCatalog(input: ModelCatalogInput): Promise<ModelCatalog>;
