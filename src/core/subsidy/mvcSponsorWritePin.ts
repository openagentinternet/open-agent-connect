/**
 * Sponsored (traffic-mode, 代付) MVC pin-write orchestration.
 * Port of IDBots src/main/services/mvcSponsorCreatePin.ts onto OAC
 * primitives, mirroring src/core/files/mvcSponsorDirectUpload.ts idioms:
 * address-info preflight -> unsigned inscription draft (no fee deduction) ->
 * advisory quota check -> challenge -> bot signs the challenge ->
 * trafficAccount resolution -> pre -> sign user-owned inputs -> commit proof
 * -> commit, then pending-UTXO tracking + local spend journaling exactly like
 * the broadcast path.
 *
 * Fallback semantics (IDBots parity): service_unavailable / no_user_utxo /
 * insufficient_quota / insufficient_traffic fall back to the regular
 * self-paid write (result carries feeAssist metadata); pre_rejected /
 * commit_failed are hard failures carrying feeAssist diagnostics on
 * error.data.
 */

import { mvc } from 'meta-contract';
import type { DerivedIdentity } from '../identity/deriveIdentity';
import type { ChainWriteResult, NormalizedChainWriteRequest } from '../chain/writePin';
import type { ChainUtxo } from '../chain/adapters/types';
import {
  buildMvcFileInscriptionDraft,
  extractOwnedOutputsFromPreparedMvcTx,
  signMvcPreparedUserInputs,
  type MvcFileInscriptionDraft,
} from '../chain/mvcFileInscriptionDraft';
import { rememberPendingMvcTransaction } from '../chain/mvcPendingUtxos';
import mvcChainAdapter from '../chain/adapters/mvc';
import type { ResolveSponsorWritePin } from '../signing/localMnemonicSigner';
import { signMvcAddressMessage } from './mvcMessageSigning';
import { createMvcSponsorV2Client } from './mvcSponsorV2Client';
import type {
  MvcSponsorAddressInfo,
  MvcSponsorChallenge,
  MvcSponsorCommitResult,
  MvcSponsorPreResult,
  MvcSponsorTrafficAccount,
} from './mvcSponsorV2Client';
import {
  attachFeeAssistError,
  isNoUserUtxoDraftError,
  normalizeSponsorReason,
  type MvcSponsorFeeAssistMetadata,
  type MvcSponsorFeeAssistReason,
  type MvcSponsorFeeAssistStage,
  type MvcSponsorTrafficDeps,
} from './feeAssist';
import type { TrafficAccountService } from '../traffic/trafficAccountService';

/** Reasons that fall back to the regular self-paid write (IDBots parity). */
export type MvcSponsorWritePinFallbackReason =
  | 'service_unavailable'
  | 'no_user_utxo'
  | 'insufficient_quota'
  | 'insufficient_traffic';

/** Minimal sponsor-client surface used by the pin-write flow. */
export interface MvcSponsorWritePinClient {
  getAddressInfo(payload: { address: string }): Promise<MvcSponsorAddressInfo>;
  getChallenge(): Promise<MvcSponsorChallenge>;
  preSponsor(payload: {
    address: string;
    txHex: string;
    challengeId: string;
    publicKey: string;
    signature: string;
    trafficAccount?: MvcSponsorTrafficAccount;
  }): Promise<MvcSponsorPreResult>;
  commitSponsor(payload: {
    orderId: string;
    signedTxHex: string;
    publicKey: string;
    signature: string;
    message?: string;
  }): Promise<MvcSponsorCommitResult>;
}

export interface MvcSponsorWritePinInput {
  request: NormalizedChainWriteRequest;
  identity: DerivedIdentity;
  sponsorClient: MvcSponsorWritePinClient;
  traffic: MvcSponsorTrafficDeps;
  /** Regular self-paid build+broadcast worker (the signer's existing body). */
  runSelfPaid: () => Promise<ChainWriteResult>;
  /** Test seam; defaults to the MVC chain adapter UTXO fetch. */
  fetchUtxos?: (address: string) => Promise<ChainUtxo[]>;
}

function isFallbackReason(reason: MvcSponsorFeeAssistReason): reason is MvcSponsorWritePinFallbackReason {
  return reason === 'service_unavailable'
    || reason === 'no_user_utxo'
    || reason === 'insufficient_quota'
    || reason === 'insufficient_traffic';
}

function estimateDraftMinerFee(input: {
  unsignedTxHex: string;
  userInputTotal: number;
}): number {
  const tx = new mvc.Transaction(input.unsignedTxHex);
  const outputTotal = tx.outputs.reduce((sum: number, output: { satoshis?: number }) => sum + Number(output.satoshis || 0), 0);
  return Math.max(0, input.userInputTotal - outputTotal);
}

export async function writeMvcSponsorPin(input: MvcSponsorWritePinInput): Promise<ChainWriteResult> {
  const { request, identity, sponsorClient, traffic, runSelfPaid } = input;
  const fetchUtxos = input.fetchUtxos ?? ((address: string) => mvcChainAdapter.fetchUtxos(address));
  const address = identity.addresses?.mvc || identity.mvcAddress;

  const fallbackToSelfPaid = async (params: {
    reason: MvcSponsorWritePinFallbackReason;
    stage: MvcSponsorFeeAssistStage;
    quotaBefore?: MvcSponsorAddressInfo;
    advisoryFeeEstimate?: number;
  }): Promise<ChainWriteResult> => {
    const feeAssist: MvcSponsorFeeAssistMetadata = {
      attempted: true,
      used: false,
      mode: 'self_paid',
      sponsor: 'mvc_sponsor_v2',
      reason: params.reason,
      stage: params.stage,
      quotaBefore: params.quotaBefore,
      advisoryFeeEstimate: params.advisoryFeeEstimate,
    };
    const result = await runSelfPaid();
    return { ...result, feeAssist };
  };

  let quotaBefore: MvcSponsorAddressInfo;
  try {
    quotaBefore = await sponsorClient.getAddressInfo({ address });
  } catch {
    return fallbackToSelfPaid({ reason: 'service_unavailable', stage: 'address_info' });
  }

  let draft: MvcFileInscriptionDraft;
  let estimatedMinerFee = 0;
  try {
    const utxos = await fetchUtxos(address);
    draft = await buildMvcFileInscriptionDraft({
      identity,
      request,
      utxos,
      feeRate: 1,
      deductMinerFeeFromChange: false,
    });
    estimatedMinerFee = estimateDraftMinerFee({
      unsignedTxHex: draft.unsignedTxHex,
      userInputTotal: draft.userInputs.reduce((sum, utxo) => sum + utxo.satoshis, 0),
    });
  } catch (error) {
    if (!isNoUserUtxoDraftError(error)) {
      attachFeeAssistError({
        error,
        fallbackCode: 'mvc_fee_assist_address_info_failed',
        fallbackReason: 'service_unavailable',
        stage: 'address_info',
        quotaBefore,
      });
    }
    return fallbackToSelfPaid({
      reason: 'no_user_utxo',
      stage: 'address_info',
      quotaBefore,
    });
  }

  if (estimatedMinerFee > 0 && quotaBefore.availableAmount < estimatedMinerFee) {
    return fallbackToSelfPaid({
      reason: 'insufficient_quota',
      stage: 'address_info',
      quotaBefore,
      advisoryFeeEstimate: estimatedMinerFee,
    });
  }

  let challenge: MvcSponsorChallenge;
  try {
    challenge = await sponsorClient.getChallenge();
  } catch (error) {
    const reason = normalizeSponsorReason((error as { reason?: unknown } | undefined)?.reason, 'service_unavailable');
    if (isFallbackReason(reason)) {
      return fallbackToSelfPaid({ reason, stage: 'challenge', quotaBefore, advisoryFeeEstimate: estimatedMinerFee });
    }
    attachFeeAssistError({
      error,
      fallbackCode: 'mvc_fee_assist_challenge_failed',
      fallbackReason: 'service_unavailable',
      stage: 'challenge',
      quotaBefore,
      advisoryFeeEstimate: estimatedMinerFee,
    });
  }

  const challengeSignature = await signMvcAddressMessage({
    mnemonic: identity.mnemonic,
    path: identity.path,
    message: challenge.message,
  });

  // Traffic-account billing: undefined keeps the legacy quota path (no
  // account, unbound bot, or backend 404).
  const trafficAccount = await traffic.resolveTrafficAccount({
    botAddress: address,
    challengeId: challenge.challengeId,
  });

  let pre: MvcSponsorPreResult;
  try {
    pre = await sponsorClient.preSponsor({
      address,
      txHex: draft.unsignedTxHex,
      challengeId: challenge.challengeId,
      publicKey: challengeSignature.publicKey,
      signature: challengeSignature.signature,
      ...(trafficAccount ? { trafficAccount } : {}),
    });
  } catch (error) {
    const reason = normalizeSponsorReason((error as { reason?: unknown } | undefined)?.reason, 'pre_rejected');
    if (isFallbackReason(reason)) {
      return fallbackToSelfPaid({ reason, stage: 'pre', quotaBefore, advisoryFeeEstimate: estimatedMinerFee });
    }
    attachFeeAssistError({
      error,
      fallbackCode: 'mvc_fee_assist_pre_failed',
      fallbackReason: 'pre_rejected',
      stage: 'pre',
      quotaBefore,
      advisoryFeeEstimate: estimatedMinerFee,
    });
  }
  const advisoryFeeEstimate = estimatedMinerFee > 0 ? estimatedMinerFee : pre.minerFee;

  let signedTxHex: string;
  try {
    signedTxHex = (await signMvcPreparedUserInputs({
      identity,
      preparedTxHex: pre.preparedTxHex,
      userInputs: draft.userInputs,
      userInputIndexes: pre.userInputIndexes,
    })).txHex;
  } catch (error) {
    attachFeeAssistError({
      error,
      fallbackCode: 'mvc_fee_assist_commit_failed',
      fallbackReason: 'pre_rejected',
      stage: 'commit',
      orderId: pre.orderId,
      quotaBefore,
      advisoryFeeEstimate,
      sponsoredMinerFee: pre.minerFee,
    });
  }

  const signedTxHash = new mvc.Transaction(signedTxHex).id;
  const commitMessage = `assist-sponsor-commit:${pre.orderId}:${signedTxHash}`;
  const commitSignature = await signMvcAddressMessage({
    mnemonic: identity.mnemonic,
    path: identity.path,
    message: commitMessage,
  });

  let commit: MvcSponsorCommitResult;
  try {
    commit = await sponsorClient.commitSponsor({
      orderId: pre.orderId,
      signedTxHex,
      publicKey: commitSignature.publicKey,
      signature: commitSignature.signature,
      message: commitMessage,
    });
  } catch (error) {
    attachFeeAssistError({
      error,
      fallbackCode: 'mvc_fee_assist_commit_failed',
      fallbackReason: 'commit_failed',
      stage: 'commit',
      orderId: pre.orderId,
      quotaBefore,
      advisoryFeeEstimate,
      sponsoredMinerFee: pre.minerFee,
    });
  }

  rememberPendingMvcTransaction({
    address,
    spentUtxos: draft.userInputs,
    createdUtxos: extractOwnedOutputsFromPreparedMvcTx({
      txHex: pre.preparedTxHex,
      txId: commit.txId,
      address,
    }),
  });

  const sponsoredMinerFee = commit.minerFee ?? pre.minerFee;
  // Local spend journal + traffic balance-cache deduction (best-effort).
  await traffic.recordSpend({
    txId: commit.txId,
    botAddress: address,
    orderId: pre.orderId,
    txSize: commit.txSize ?? 0,
    sponsoredMinerFee,
    savedFee: sponsoredMinerFee,
    billedBy: trafficAccount ? 'traffic' : 'quota',
    kind: request.path,
  }).catch(() => undefined);

  let quotaAfter: MvcSponsorAddressInfo | undefined;
  try {
    quotaAfter = await sponsorClient.getAddressInfo({ address });
  } catch {
    quotaAfter = undefined;
  }

  return {
    txids: [commit.txId],
    pinId: `${commit.txId}i0`,
    totalCost: sponsoredMinerFee,
    network: request.network,
    operation: request.operation,
    path: request.path,
    contentType: request.contentType,
    encoding: request.encoding,
    globalMetaId: identity.globalMetaId,
    mvcAddress: identity.mvcAddress,
    feeAssist: {
      attempted: true,
      used: true,
      mode: 'mvc_sponsor_v2',
      sponsor: 'mvc_sponsor_v2',
      stage: 'done',
      orderId: pre.orderId,
      quotaBefore,
      quotaAfter,
      advisoryFeeEstimate,
      sponsoredMinerFee,
      savedFee: sponsoredMinerFee,
      billedBy: trafficAccount ? 'traffic' : 'quota',
      txSize: commit.txSize,
    },
  };
}

/**
 * Build the signer's resolveSponsorWritePin hook bound to a shared traffic
 * account service. Returns null (unchanged self-paid behavior) unless the
 * stored traffic pin mode is 'traffic'; otherwise runs the sponsored flow
 * with a sponsor client pointed at the configured assist-service base URL.
 */
export function createTrafficSponsorWritePinResolver(input: {
  trafficAccountService: Pick<
    TrafficAccountService,
    'getTrafficPinMode' | 'getConfiguredTrafficApiBase' | 'resolveSponsorTrafficAccount' | 'recordLocalTrafficSpend'
  >;
}): ResolveSponsorWritePin {
  const service = input.trafficAccountService;
  return async ({ request, identity, runSelfPaid }) => {
    if ((await service.getTrafficPinMode()) !== 'traffic') {
      return null;
    }
    const sponsorClient = createMvcSponsorV2Client({
      baseUrl: await service.getConfiguredTrafficApiBase(),
    });
    return writeMvcSponsorPin({
      request,
      identity,
      sponsorClient,
      traffic: {
        resolveTrafficAccount: ({ botAddress, challengeId }) =>
          service.resolveSponsorTrafficAccount({
            botAddress,
            challengeId,
            botMnemonic: identity.mnemonic,
            botWalletPath: identity.path,
          }),
        recordSpend: (entry) => service.recordLocalTrafficSpend(entry),
      },
      runSelfPaid,
    });
  };
}
