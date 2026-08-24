/**
 * Workspace-scoped upload gate for daemon-side chain uploads (group task
 * deliverables, simplenote publishing). The daemon has no interactive
 * approval surface, so the rule is deterministic fail-closed: a local file
 * may be published on-chain only when it lives inside the acting Bot's
 * workspace (memory layer root) — the Bot's own working directory. Anything
 * else (.env, ~/.ssh, arbitrary absolute paths — including paths a remote
 * group member injected into a guest reply) is refused before any bytes
 * leave the machine. Hosts with an interactive surface (the DSH native
 * tools) ask the owner instead; they pass `confirmExternalUpload: true`
 * after approval so the daemon-side gate can honor the decision.
 */
import type { Signer } from '../signing/signer';
export type GatedUploadFn = (input: {
    slug: string;
    filePath: string;
    network?: string;
    contentType?: string;
}) => Promise<{
    metafileUri: string;
    pinId: string;
}>;
export type ProfileHomeResolver = (slug: string) => Promise<string | null>;
export interface ProfileUploadGateOptions {
    /** Resolves a bot slug to its profile home dir. */
    profileHomeDir: ProfileHomeResolver;
    /** Explicit owner consent checked for out-of-workspace files: a callback
     *  or a plain boolean (hosts that already asked set `true`). */
    confirmExternalUpload?: boolean | ((input: {
        slug: string;
        filePath: string;
    }) => Promise<boolean> | boolean);
    /** Test seam; defaults to the real chain upload. */
    upload?: (input: {
        filePath: string;
        network?: string;
        contentType?: string;
        signer: Signer;
    }) => Promise<{
        metafileUri: string;
        pinId: string;
    }>;
    /** Signer factory; required unless `upload` is overridden. */
    signerForSlug?: (slug: string) => Promise<Signer>;
    log?: (message: string) => void;
}
export declare class UploadOutsideWorkspaceError extends Error {
    readonly filePath: string;
    readonly slug: string;
    constructor(filePath: string, slug: string);
}
/**
 * Wrap a chain upload with the workspace gate. The workspace root is the
 * profile's workspace layer (`<homeDir>/memory`'s parent — the profile home
 * itself), i.e. everything the Bot owns.
 */
export declare function createProfileScopedUpload(options: ProfileUploadGateOptions): GatedUploadFn;
