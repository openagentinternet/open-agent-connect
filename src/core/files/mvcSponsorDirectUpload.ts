import { promises as fs } from 'node:fs';
import { mvc } from 'meta-contract';
import type { Signer } from '../signing/signer';
import type { MvcSponsorAddressInfo, MvcSponsorCommitResult, MvcSponsorPreResult } from '../subsidy/mvcSponsorV2Client';
import { signMvcAddressMessage } from '../subsidy/mvcMessageSigning';
import mvcChainAdapter from '../chain/adapters/mvc';
import { normalizeChainWriteRequest } from '../chain/writePin';
import {
  buildMvcFileInscriptionDraft,
  extractOwnedOutputsFromPreparedMvcTx,
  signMvcPreparedUserInputs,
} from '../chain/mvcFileInscriptionDraft';
import { rememberPendingMvcTransaction } from '../chain/mvcPendingUtxos';
import { uploadLocalFileToChain, type UploadLocalFileToChainResult } from './uploadFile';

export type MvcSponsorFeeAssistMode = 'mvc_sponsor_v2' | 'self_paid';
export type MvcSponsorFeeAssistReason =
  | 'service_unavailable'
  | 'no_user_utxo'
  | 'insufficient_quota'
  | 'pre_rejected'
  | 'commit_failed';
export type MvcSponsorFeeAssistStage =
  | 'address_info'
  | 'challenge'
  | 'pre'
  | 'commit'
  | 'done';

export interface MvcSponsorFeeAssistMetadata {
  attempted: boolean;
  used: boolean;
  mode: MvcSponsorFeeAssistMode;
  sponsor: 'mvc_sponsor_v2';
  reason?: MvcSponsorFeeAssistReason;
  stage?: MvcSponsorFeeAssistStage;
  orderId?: string;
  quotaBefore?: MvcSponsorAddressInfo;
  quotaAfter?: MvcSponsorAddressInfo;
  advisoryFeeEstimate?: number;
  sponsoredMinerFee?: number;
  savedFee?: number;
}

export interface MvcSponsorV2DirectUploadClient {
  getAddressInfo(payload: { address: string }): Promise<MvcSponsorAddressInfo>;
  getChallenge(): Promise<{
    challengeId: string;
    message: string;
    expiresAt?: string;
    raw: Record<string, unknown>;
  }>;
  preSponsor(payload: {
    address: string;
    txHex: string;
    challengeId: string;
    publicKey: string;
    signature: string;
  }): Promise<MvcSponsorPreResult>;
  commitSponsor(payload: {
    orderId: string;
    signedTxHex: string;
    publicKey: string;
    signature: string;
    message?: string;
  }): Promise<MvcSponsorCommitResult>;
}

export type MvcSponsorDirectUploadResult = UploadLocalFileToChainResult & {
  feeAssist: MvcSponsorFeeAssistMetadata;
};

function normalizeSponsorReason(value: unknown, fallback: MvcSponsorFeeAssistReason): MvcSponsorFeeAssistReason {
  return value === 'insufficient_quota'
    || value === 'service_unavailable'
    || value === 'commit_failed'
    || value === 'pre_rejected'
    || value === 'no_user_utxo'
    ? value
    : fallback;
}

function getStableErrorCode(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && code.trim() ? code.trim() : fallback;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isNoUserUtxoDraftError(error: unknown): boolean {
  return /MetaBot balance is insufficient for this chain write\./i.test(getErrorMessage(error, ''));
}

function estimateDraftMinerFee(input: {
  unsignedTxHex: string;
  userInputTotal: number;
}): number {
  const tx = new mvc.Transaction(input.unsignedTxHex);
  const outputTotal = tx.outputs.reduce((sum: number, output: { satoshis?: number }) => sum + Number(output.satoshis || 0), 0);
  return Math.max(0, input.userInputTotal - outputTotal);
}

async function selfPaidDirect(input: {
  filePath: string;
  contentType: string;
  network: string;
  signer: Signer;
  feeAssist: MvcSponsorFeeAssistMetadata;
}): Promise<MvcSponsorDirectUploadResult> {
  const direct = await uploadLocalFileToChain({
    filePath: input.filePath,
    contentType: input.contentType,
    network: input.network,
    signer: input.signer,
  });
  return {
    ...direct,
    feeAssist: input.feeAssist,
  };
}

function attachFeeAssistError(input: {
  error: unknown;
  fallbackCode: string;
  fallbackReason: MvcSponsorFeeAssistReason;
  stage: MvcSponsorFeeAssistStage;
  orderId?: string;
  quotaBefore?: MvcSponsorAddressInfo;
  advisoryFeeEstimate?: number;
  sponsoredMinerFee?: number;
}): never {
  const error = input.error instanceof Error
    ? input.error as Error & { code?: string; data?: Record<string, unknown> }
    : new Error(getErrorMessage(input.error, `MVC sponsor ${input.stage} failed.`)) as Error & { code?: string; data?: Record<string, unknown> };
  error.code = getStableErrorCode(error, input.fallbackCode);
  const existingData = error.data && typeof error.data === 'object' ? error.data : {};
  error.data = {
    ...existingData,
    feeAssist: {
      attempted: true,
      used: false,
      mode: 'mvc_sponsor_v2',
      sponsor: 'mvc_sponsor_v2',
      reason: normalizeSponsorReason((input.error as { reason?: unknown } | undefined)?.reason, input.fallbackReason),
      stage: input.stage,
      orderId: input.orderId,
      quotaBefore: input.quotaBefore,
      advisoryFeeEstimate: input.advisoryFeeEstimate,
      sponsoredMinerFee: input.sponsoredMinerFee,
      savedFee: input.sponsoredMinerFee,
    } satisfies MvcSponsorFeeAssistMetadata,
  };
  throw error;
}

async function fallbackSelfPaidForSponsorError(input: {
  error: unknown;
  filePath: string;
  contentType: string;
  network: string;
  signer: Signer;
  fallbackReason: MvcSponsorFeeAssistReason;
  stage: MvcSponsorFeeAssistStage;
  quotaBefore?: MvcSponsorAddressInfo;
  advisoryFeeEstimate?: number;
}): Promise<MvcSponsorDirectUploadResult> {
  return selfPaidDirect({
    filePath: input.filePath,
    contentType: input.contentType,
    network: input.network,
    signer: input.signer,
    feeAssist: {
      attempted: true,
      used: false,
      mode: 'self_paid',
      sponsor: 'mvc_sponsor_v2',
      reason: normalizeSponsorReason((input.error as { reason?: unknown } | undefined)?.reason, input.fallbackReason),
      stage: input.stage,
      quotaBefore: input.quotaBefore,
      advisoryFeeEstimate: input.advisoryFeeEstimate,
    },
  });
}

export async function uploadMvcSponsorDirectFile(input: {
  filePath: string;
  fileName: string;
  contentType: string;
  bytes: number;
  extension: string;
  network: string;
  signer: Signer;
  mvcSponsorClient: MvcSponsorV2DirectUploadClient;
}): Promise<MvcSponsorDirectUploadResult> {
  const identity = await input.signer.getIdentity();
  const data = await fs.readFile(input.filePath);
  const request = normalizeChainWriteRequest({
    path: '/file',
    payload: data,
    contentType: input.contentType,
    encoding: 'binary',
    network: 'mvc',
  });
  const address = identity.addresses?.mvc || identity.mvcAddress;

  let quotaBefore!: MvcSponsorAddressInfo;
  try {
    quotaBefore = await input.mvcSponsorClient.getAddressInfo({ address });
  } catch (error) {
    return fallbackSelfPaidForSponsorError({
      error,
      filePath: input.filePath,
      contentType: input.contentType,
      network: input.network,
      signer: input.signer,
      fallbackReason: 'service_unavailable',
      stage: 'address_info',
    });
  }

  let draft: Awaited<ReturnType<typeof buildMvcFileInscriptionDraft>>;
  let estimatedMinerFee = 0;
  try {
    const utxos = await mvcChainAdapter.fetchUtxos(address);
    draft = await buildMvcFileInscriptionDraft({
      identity,
      request,
      utxos,
      feeRate: 1,
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
    return fallbackSelfPaidForSponsorError({
      error,
      filePath: input.filePath,
      contentType: input.contentType,
      network: input.network,
      signer: input.signer,
      fallbackReason: 'no_user_utxo',
      stage: 'address_info',
      quotaBefore,
    });
  }

  if (quotaBefore.availableAmount < estimatedMinerFee) {
    return fallbackSelfPaidForSponsorError({
      error: { reason: 'insufficient_quota' },
      filePath: input.filePath,
      contentType: input.contentType,
      network: input.network,
      signer: input.signer,
      fallbackReason: 'insufficient_quota',
      stage: 'address_info',
      quotaBefore,
      advisoryFeeEstimate: estimatedMinerFee,
    });
  }

  let challenge: Awaited<ReturnType<MvcSponsorV2DirectUploadClient['getChallenge']>>;
  try {
    challenge = await input.mvcSponsorClient.getChallenge();
  } catch (error) {
    if (normalizeSponsorReason((error as { reason?: unknown } | undefined)?.reason, 'service_unavailable') === 'service_unavailable') {
      return fallbackSelfPaidForSponsorError({
        error,
        filePath: input.filePath,
        contentType: input.contentType,
        network: input.network,
        signer: input.signer,
        fallbackReason: 'service_unavailable',
        stage: 'challenge',
        quotaBefore,
        advisoryFeeEstimate: estimatedMinerFee,
      });
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

  let pre: MvcSponsorPreResult;
  try {
    pre = await input.mvcSponsorClient.preSponsor({
      address,
      txHex: draft.unsignedTxHex,
      challengeId: challenge.challengeId,
      publicKey: challengeSignature.publicKey,
      signature: challengeSignature.signature,
    });
  } catch (error) {
    const reason = normalizeSponsorReason((error as { reason?: unknown } | undefined)?.reason, 'pre_rejected');
    if (reason === 'service_unavailable') {
      return fallbackSelfPaidForSponsorError({
        error,
        filePath: input.filePath,
        contentType: input.contentType,
        network: input.network,
        signer: input.signer,
        fallbackReason: 'service_unavailable',
        stage: 'pre',
        quotaBefore,
        advisoryFeeEstimate: estimatedMinerFee,
      });
    }
    attachFeeAssistError({
      error,
      fallbackCode: 'mvc_fee_assist_pre_failed',
      fallbackReason: reason === 'insufficient_quota' ? 'insufficient_quota' : 'pre_rejected',
      stage: 'pre',
      quotaBefore,
      advisoryFeeEstimate: estimatedMinerFee,
    });
  }

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
      advisoryFeeEstimate: estimatedMinerFee,
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
    commit = await input.mvcSponsorClient.commitSponsor({
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
      advisoryFeeEstimate: estimatedMinerFee,
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
  let quotaAfter: MvcSponsorAddressInfo | undefined;
  try {
    quotaAfter = await input.mvcSponsorClient.getAddressInfo({ address });
  } catch {
    quotaAfter = undefined;
  }
  const pinId = `${commit.txId}i0`;
  return {
    pinId,
    txids: [commit.txId],
    totalCost: sponsoredMinerFee,
    network: 'mvc',
    filePath: input.filePath,
    fileName: input.fileName,
    contentType: input.contentType,
    bytes: input.bytes,
    extension: input.extension,
    metafileUri: `metafile://${pinId}${input.extension}`,
    globalMetaId: identity.globalMetaId,
    feeAssist: {
      attempted: true,
      used: true,
      mode: 'mvc_sponsor_v2',
      sponsor: 'mvc_sponsor_v2',
      stage: 'done',
      orderId: pre.orderId,
      quotaBefore,
      quotaAfter,
      advisoryFeeEstimate: estimatedMinerFee,
      sponsoredMinerFee,
      savedFee: sponsoredMinerFee,
    },
  };
}
