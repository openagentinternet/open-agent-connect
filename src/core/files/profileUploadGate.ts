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

import path from 'node:path';
import { isPathInsideDir } from './chainUploadGate';
import { uploadLocalFileToChain } from './uploadFile';
import type { Signer } from '../signing/signer';

export type GatedUploadFn = (input: {
  slug: string;
  filePath: string;
  network?: string;
  contentType?: string;
}) => Promise<{ metafileUri: string; pinId: string }>;

export type ProfileHomeResolver = (slug: string) => Promise<string | null>;

export interface ProfileUploadGateOptions {
  /** Resolves a bot slug to its profile home dir. */
  profileHomeDir: ProfileHomeResolver;
  /** Explicit owner consent checked for out-of-workspace files: a callback
   *  or a plain boolean (hosts that already asked set `true`). */
  confirmExternalUpload?: boolean | ((input: { slug: string; filePath: string }) => Promise<boolean> | boolean);
  /** Test seam; defaults to the real chain upload. */
  upload?: (input: {
    filePath: string;
    network?: string;
    contentType?: string;
    signer: Signer;
  }) => Promise<{ metafileUri: string; pinId: string }>;
  /** Signer factory; required unless `upload` is overridden. */
  signerForSlug?: (slug: string) => Promise<Signer>;
  log?: (message: string) => void;
}

export class UploadOutsideWorkspaceError extends Error {
  constructor(readonly filePath: string, readonly slug: string) {
    super(
      `Refused to upload a file outside the Bot workspace: ${filePath} (acting bot: ${slug}). `
      + 'On-chain publishing is irreversible; copy the file into the Bot\'s workspace first, '
      + 'or upload it through the raw bytes upload route (e.g. the UI file picker).',
    );
    this.name = 'UploadOutsideWorkspaceError';
  }
}

/**
 * Wrap a chain upload with the workspace gate. The workspace root is the
 * profile's workspace layer (`<homeDir>/memory`'s parent — the profile home
 * itself), i.e. everything the Bot owns.
 */
export function createProfileScopedUpload(
  options: ProfileUploadGateOptions,
): GatedUploadFn {
  const log = options.log ?? (() => undefined);
  return async (input) => {
    const homeDir = await options.profileHomeDir(input.slug);
    if (homeDir && isPathInsideDir(input.filePath, homeDir)) {
      const signer = options.signerForSlug ? await options.signerForSlug(input.slug) : null;
      const upload = options.upload ?? (async ({ filePath, network, contentType }) => {
        if (!signer) throw new Error('signerForSlug is required for the default upload.');
        const uploaded = await uploadLocalFileToChain({ filePath, network, contentType, signer });
        return { metafileUri: uploaded.metafileUri, pinId: uploaded.pinId };
      });
      return upload({
        filePath: input.filePath,
        network: input.network,
        contentType: input.contentType,
        ...(signer ? { signer } : {}),
      } as { filePath: string; network?: string; contentType?: string; signer: Signer });
    }
    const allowed = typeof options.confirmExternalUpload === 'function'
      ? await options.confirmExternalUpload({ slug: input.slug, filePath: input.filePath })
      : options.confirmExternalUpload === true;
    if (allowed) {
      const signer = options.signerForSlug ? await options.signerForSlug(input.slug) : null;
      const upload = options.upload ?? (async ({ filePath, network, contentType }) => {
        if (!signer) throw new Error('signerForSlug is required for the default upload.');
        const uploaded = await uploadLocalFileToChain({ filePath, network, contentType, signer });
        return { metafileUri: uploaded.metafileUri, pinId: uploaded.pinId };
      });
      log(`[UploadGate] External upload approved for ${input.slug}: ${input.filePath}`);
      return upload({ filePath: input.filePath, network: input.network, ...(signer ? { signer } : {}) } as { filePath: string; network?: string; signer: Signer });
    }
    log(`[UploadGate] REFUSED external upload for ${input.slug}: ${input.filePath}`);
    throw new UploadOutsideWorkspaceError(input.filePath, input.slug);
  };
}
