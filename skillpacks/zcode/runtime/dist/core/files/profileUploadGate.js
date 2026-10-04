"use strict";
/**
 * Workspace-scoped upload gate for daemon-side chain uploads (group task
 * deliverables, simplenote publishing). The daemon has no interactive
 * approval surface, so the rule is deterministic fail-closed: a local file
 * may be published on-chain only when it lives inside the acting Bot's
 * workspace (memory layer root) — the Bot's own working directory. Anything
 * else (.env, ~/.ssh, arbitrary absolute paths — including paths a remote
 * group member injected into a guest reply) is refused before any bytes
 * leave the machine.
 *
 * `confirmExternalUpload` is honored only as an in-process callback: the
 * daemon's raw-bytes upload route sets one for the temp file it just staged
 * from the request body (those bytes are caller-supplied by construction).
 * The plain boolean form still exists for direct in-process embedders, but
 * daemon HTTP handlers must never forward a request-body boolean here — a
 * caller self-authorizing `confirmExternalUpload: true` would defeat the
 * gate entirely (H3).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadOutsideWorkspaceError = void 0;
exports.createProfileScopedUpload = createProfileScopedUpload;
const chainUploadGate_1 = require("./chainUploadGate");
const uploadFile_1 = require("./uploadFile");
class UploadOutsideWorkspaceError extends Error {
    filePath;
    slug;
    constructor(filePath, slug) {
        super(`Refused to upload a file outside the Bot workspace: ${filePath} (acting bot: ${slug}). `
            + 'On-chain publishing is irreversible; copy the file into the Bot\'s workspace first, '
            + 'or upload it through the raw bytes upload route (e.g. the UI file picker).');
        this.filePath = filePath;
        this.slug = slug;
        this.name = 'UploadOutsideWorkspaceError';
    }
}
exports.UploadOutsideWorkspaceError = UploadOutsideWorkspaceError;
/**
 * Wrap a chain upload with the workspace gate. The workspace root is the
 * profile's workspace layer (`<homeDir>/memory`'s parent — the profile home
 * itself), i.e. everything the Bot owns.
 */
function createProfileScopedUpload(options) {
    const log = options.log ?? (() => undefined);
    return async (input) => {
        const homeDir = await options.profileHomeDir(input.slug);
        if (homeDir && (0, chainUploadGate_1.isPathInsideDir)(input.filePath, homeDir)) {
            const signer = options.signerForSlug ? await options.signerForSlug(input.slug) : null;
            const upload = options.upload ?? (async ({ filePath, network, contentType }) => {
                if (!signer)
                    throw new Error('signerForSlug is required for the default upload.');
                const uploaded = await (0, uploadFile_1.uploadLocalFileToChain)({ filePath, network, contentType, signer });
                return { metafileUri: uploaded.metafileUri, pinId: uploaded.pinId };
            });
            return upload({
                filePath: input.filePath,
                network: input.network,
                contentType: input.contentType,
                ...(signer ? { signer } : {}),
            });
        }
        const allowed = typeof options.confirmExternalUpload === 'function'
            ? await options.confirmExternalUpload({ slug: input.slug, filePath: input.filePath })
            : options.confirmExternalUpload === true;
        if (allowed) {
            const signer = options.signerForSlug ? await options.signerForSlug(input.slug) : null;
            const upload = options.upload ?? (async ({ filePath, network, contentType }) => {
                if (!signer)
                    throw new Error('signerForSlug is required for the default upload.');
                const uploaded = await (0, uploadFile_1.uploadLocalFileToChain)({ filePath, network, contentType, signer });
                return { metafileUri: uploaded.metafileUri, pinId: uploaded.pinId };
            });
            log(`[UploadGate] External upload approved for ${input.slug}: ${input.filePath}`);
            return upload({ filePath: input.filePath, network: input.network, ...(signer ? { signer } : {}) });
        }
        log(`[UploadGate] REFUSED external upload for ${input.slug}: ${input.filePath}`);
        throw new UploadOutsideWorkspaceError(input.filePath, input.slug);
    };
}
