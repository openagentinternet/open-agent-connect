import { derivePrivateKeyHex, parseAddressIndexFromPath, type DerivedIdentity } from '../identity/deriveIdentity';
import { createHash } from 'node:crypto';
import { loadIdentity } from '../identity/loadIdentity';
import {
  normalizeChainWriteRequest,
  type ChainWriteRequest,
  type ChainWriteResult,
} from '../chain/writePin';
import type { ChainAdapter } from '../chain/adapters/types';
import type { ChainAdapterRegistry } from '../chain/adapters/types';
import type { SecretStore } from '../secrets/secretStore';
import { resolveWalletSpendQueueKey, withWalletSpendQueue } from '../wallet/spendQueue';
import type { PrivateChatSignerIdentity, Signer } from './signer';

const DEFAULT_BTC_WRITE_FEE_RATE = 2;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function loadSignerIdentity(secretStore: SecretStore): Promise<DerivedIdentity> {
  const secrets = await secretStore.readIdentitySecrets();
  if (!secrets?.mnemonic) {
    throw new Error('Local identity mnemonic is missing from the secret store.');
  }
  return loadIdentity(secrets);
}

async function buildPrivateChatIdentity(secretStore: SecretStore): Promise<PrivateChatSignerIdentity> {
  const secrets = await secretStore.readIdentitySecrets();
  if (!secrets?.mnemonic) {
    throw new Error('Local identity mnemonic is missing from the secret store.');
  }

  const identity = await loadIdentity(secrets);
  const privateKeyHex = normalizeText(secrets.privateKeyHex) || await derivePrivateKeyHex({
    mnemonic: identity.mnemonic,
    path: identity.path,
  });
  if (!privateKeyHex) {
    throw new Error('Local private key could not be derived from the secret store.');
  }

  return {
    globalMetaId: identity.globalMetaId,
    chatPublicKey: identity.chatPublicKey,
    privateKeyHex,
  };
}

/**
 * A broadcast-phase failure with UNKNOWN finality: the signed transactions
 * left the wallet but the node never confirmed acceptance (timeout, network
 * drop, ambiguous node error). Retrying blindly mints duplicates — the
 * transaction may already be on-chain. Handlers must surface this as
 * manual_action_required with the candidate txids, never as a plain failure.
 */
export class ChainBroadcastUnknownError extends Error {
  /** Candidate txids derived from the signed raw transactions (verify on-chain). */
  readonly candidateTxids: string[];
  /** Txids that DID broadcast successfully before the failure. */
  readonly confirmedTxids: string[];

  constructor(input: { candidateTxids: string[]; confirmedTxids: string[]; cause: unknown }) {
    const message = input.cause instanceof Error ? input.cause.message : String(input.cause);
    super(
      `Chain broadcast status UNKNOWN: ${message}. Signed transactions may already be on-chain — `
      + `do NOT retry the same publish blindly. Candidate txids (verify on an explorer): `
      + `${[...new Set([...input.confirmedTxids, ...input.candidateTxids])].join(', ') || '(unavailable)'}`,
    );
    this.name = 'ChainBroadcastUnknownError';
    this.candidateTxids = input.candidateTxids;
    this.confirmedTxids = input.confirmedTxids;
  }
}

/** Bitcoin-style txid of a serialized raw tx: double SHA-256, little-endian. */
function computeCandidateTxid(rawTxHex: string): string | null {
  try {
    const first = createHash('sha256').update(Buffer.from(rawTxHex, 'hex')).digest();
    const second = createHash('sha256').update(first).digest();
    return [...second].reverse().map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * Create a local mnemonic signer backed by a ChainAdapterRegistry.
 *
 * The Signer delegates all chain-specific operations (inscription building, broadcasting)
 * to the appropriate ChainAdapter. No chain-dispatch logic (`if network === 'mvc'`, etc.)
 * lives in the Signer itself.
 */
export function createLocalMnemonicSigner(input: {
  secretStore: SecretStore;
  adapters?: ChainAdapterRegistry;
  /** Optional per-chain fee rates. If not provided, each adapter fetches its own. */
  feeRates?: Partial<Record<string, number>>;
}): Signer {
  return {
    getIdentity: async () => loadSignerIdentity(input.secretStore),
    getPrivateChatIdentity: async () => buildPrivateChatIdentity(input.secretStore),

    writePin: async (rawInput: ChainWriteRequest): Promise<ChainWriteResult> => {
      const request = normalizeChainWriteRequest(rawInput);
      const identity = await loadSignerIdentity(input.secretStore);

      const adapters = input.adapters ?? new Map();
      const adapter = adapters.get(request.network);
      if (!adapter) {
        throw new Error(`Chain write network ${request.network} is not supported.`);
      }

      const lockKey = await resolveWalletSpendQueueKey({
        adapter,
        mnemonic: identity.mnemonic,
        path: identity.path,
        fallbackAddress: identity.addresses?.[request.network] ?? identity.mvcAddress,
      });

      return withWalletSpendQueue(lockKey, async () => {
        const feeRate = input.feeRates?.[request.network];
        const inscriptionResult = await adapter.buildInscription({
          request,
          identity,
          feeRate,
        });

        // Broadcast all signed transactions in order. A failure here leaves
        // finality UNKNOWN (earlier txs of the batch may be on-chain): surface
        // ChainBroadcastUnknownError instead of a plain retryable error.
        const broadcastTxids: string[] = [];
        try {
          for (const rawTx of inscriptionResult.signedRawTxs) {
            broadcastTxids.push(await adapter.broadcastTx(rawTx));
          }
        } catch (error) {
          throw new ChainBroadcastUnknownError({
            confirmedTxids: [...broadcastTxids],
            candidateTxids: inscriptionResult.signedRawTxs
              .map((rawTx: string) => computeCandidateTxid(rawTx))
              .filter((txid: string | null): txid is string => txid !== null),
            cause: error,
          });
        }

        const firstRevealTxid = broadcastTxids[inscriptionResult.revealIndices[0]];
        const revealTxids = inscriptionResult.revealIndices.map((i: number) => broadcastTxids[i]);

        return {
          txids: revealTxids,
          pinId: `${firstRevealTxid}i0`,
          totalCost: inscriptionResult.totalCost,
          network: request.network,
          operation: request.operation,
          path: request.path,
          contentType: request.contentType,
          encoding: request.encoding,
          globalMetaId: identity.globalMetaId,
          mvcAddress: identity.mvcAddress,
        };
      });
    },
  };
}

/**
 * Convenience helper: execute a transfer using an adapter's buildTransfer + broadcastTx.
 * Replaces the old `executeMvcTransfer` / `executeBtcTransfer` per-chain functions.
 */
export async function executeTransfer(
  adapter: ChainAdapter,
  input: {
    mnemonic: string;
    path: string;
    toAddress: string;
    amountSatoshis: number;
    feeRate?: number;
  },
): Promise<{ txid: string; fee: number }> {
  const lockKey = await resolveWalletSpendQueueKey({
    adapter,
    mnemonic: input.mnemonic,
    path: input.path,
  });

  return withWalletSpendQueue(lockKey, async () => {
    const { rawTx, fee } = await adapter.buildTransfer({
      mnemonic: input.mnemonic,
      path: input.path,
      toAddress: input.toAddress,
      amountSatoshis: input.amountSatoshis,
      feeRate: input.feeRate,
    });
    const txid = await adapter.broadcastTx(rawTx);
    return { txid, fee };
  });
}
