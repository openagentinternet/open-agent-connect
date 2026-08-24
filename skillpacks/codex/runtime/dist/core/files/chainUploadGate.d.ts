/**
 * Owner-approval gate for on-chain file publishing from chain-write tools
 * (upload_file / post_buzz / post_simplenote). OAC port of the IDBots
 * chainUploadGate (2026-08-24 release). Publishing a file makes it public
 * and irreversible, so local paths OUTSIDE the session workspace require an
 * explicit owner confirmation before they ever leave the machine. Files
 * inside the workspace (the bot's own working directory) publish freely —
 * that is the tools' normal job. metafile:// URIs are already on-chain and
 * are never gated (the gate sits at the local-file upload chokepoint only).
 *
 * The gate is ACTIVE only when the host provides both the workspace
 * resolver and the confirmation callback. Hosts that provide neither keep
 * the legacy ungated behavior — embedders should provide both.
 */
/**
 * True when filePath resolves inside dir (or equals it). Symlink-aware:
 * both sides are resolved through symlinks first, so a symlink planted
 * inside the workspace that points at e.g. ~/.ssh/id_rsa counts as
 * OUTSIDE. Paths that do not exist keep their lexical tail (the caller's
 * own existsSync validation reports them later).
 */
export declare function isPathInsideDir(filePath: string, dir: string): boolean;
export type UploadGateDeps = {
    /** Resolves the session workspace dir; undefined when the session has none. */
    getWorkspaceDir?: () => string | undefined;
    /** Asks the owner to approve publishing the listed files. True = approved. */
    confirmExternalUpload?: (files: string[]) => Promise<boolean>;
};
/**
 * Gate one local file. Returns null when the upload may proceed, or a
 * human/agent-readable error message when it must not (owner declined).
 * A file outside the workspace — or any file when the workspace is
 * unknown — asks the owner once.
 */
export declare function checkUploadAllowed(filePath: string, deps: UploadGateDeps): Promise<string | null>;
/**
 * Wrap one upload function with the gate. Consumers upload through the
 * wrapper instead of the raw service; a declined file throws before any
 * bytes leave the machine, and the caller's normal error handling
 * surfaces the message to the agent.
 */
export declare function wrapUploadWithGate<T extends (params: {
    filePath: string;
}) => Promise<unknown>>(upload: T, deps: UploadGateDeps): T;
