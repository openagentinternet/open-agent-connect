/**
 * Owner profile on-chain publish: the owner-identity mirror of the Bot
 * /info/* publish seam (src/core/bot/metabotProfileManager.ts). Saving the
 * owner's name and/or avatar publishes them under the owner's own MetaID
 * (`/info/name`, `/info/avatar`) before the local record is updated, so the
 * local file never claims a profile the chain does not show.
 */
import type { ChainWriteRequest, ChainWriteResult } from '../chain/writePin';
import { buildAvatarChainWriteRequest } from '../identity/avatarChainWrite';
import type { Signer } from '../signing/signer';

export const OWNER_NAME_CHAIN_PATH = '/info/name';

/** The changed profile fields to publish; `avatarDataUrl: ''` clears the on-chain avatar. */
export interface OwnerProfileChainFields {
  name?: string;
  avatarDataUrl?: string;
}

export function buildOwnerProfileChainWrites(fields: OwnerProfileChainFields): ChainWriteRequest[] {
  const requests: ChainWriteRequest[] = [];
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  if (name) {
    requests.push({
      operation: 'create',
      path: OWNER_NAME_CHAIN_PATH,
      encryption: '0',
      version: '1.0',
      contentType: 'text/plain',
      payload: name,
      encoding: 'utf-8',
      network: 'mvc',
    });
  }
  if (typeof fields.avatarDataUrl === 'string') {
    requests.push(buildAvatarChainWriteRequest({
      operation: 'create',
      avatarDataUrl: fields.avatarDataUrl,
      network: 'mvc',
    }));
  }
  return requests;
}

/**
 * Sequential writes with the same inter-write delay the Bot profile sync uses
 * (each pin spends the previous write's change UTXO).
 */
export async function writeOwnerProfileChainRequests(
  signer: Signer,
  requests: ChainWriteRequest[],
  options: { delayMs?: number } = {},
): Promise<ChainWriteResult[]> {
  const delayMs = options.delayMs ?? 3_000;
  const results: ChainWriteResult[] = [];
  for (const request of requests) {
    if (results.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    results.push(await signer.writePin(request));
  }
  return results;
}
