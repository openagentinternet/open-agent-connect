"use strict";
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
            + 'On-chain publishing is irreversible; copy the file into the Bot\'s workspace, '
            + 'or pass explicit owner confirmation for the external upload.');
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
