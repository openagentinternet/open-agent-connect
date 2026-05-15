import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  commandAwaitingConfirmation,
  commandFailed,
  commandSuccess,
  type MetabotCommandResult,
} from '../contracts/commandResult';
import { buildLoomChainWriteRequest, type LoomChainWriteRequest } from './chainRequest';
import {
  findLatestValidDelivery,
  findValidClaimForDelivery,
  type LoomWorkflowTaskState,
} from './workflowState';
import type { LoomWorkflowStore } from './workflowStore';
import { writeLoomProtocolRecord } from './workflowChain';

const DEFAULT_CHAIN = 'mvc';
const SUPPORTED_PAYMENT_CURRENCIES = new Set(['SPACE', 'BTC', 'DOGE', 'OPCAT']);
const POSITIVE_DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface LoomWalletTransferInput {
  from?: string;
  toAddress: string;
  amountRaw: string;
  confirm: boolean;
}

export interface LoomReviewWorkflowBaseInput {
  from?: string;
  taskPinId: string;
  deliveryPinId: string;
  score: number;
  comment: string;
  chain?: string;
  requesterGlobalMetaId: string;
  state: LoomWorkflowTaskState;
  workflowStore: LoomWorkflowStore;
  writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
  now?: () => number;
}

export interface LoomAcceptAndPayWorkflowInput extends LoomReviewWorkflowBaseInput {
  confirmPayment: boolean;
  walletTransfer: (input: LoomWalletTransferInput) => Promise<MetabotCommandResult<unknown>>;
}

export interface LoomReviewDeliveryWorkflowInput extends LoomReviewWorkflowBaseInput {
  verdict: 'rejected' | 'revision_needed';
  attachments?: string[];
}

export interface LoomReviewWorkflowResult {
  taskPinId: string;
  claimPinId: string;
  deliveryPinId: string;
  acceptancePinId: string;
  paymentTxId?: string;
  acceptancePayload: Record<string, unknown>;
}

interface ResolvedReviewContext {
  taskPinId: string;
  claimPinId: string;
  deliveryPinId: string;
  payoutAddress?: string;
  taskPayload: Record<string, unknown>;
}

export function buildLoomPaymentAmountRaw(bounty: unknown): string | undefined {
  if (!isRecord(bounty)) {
    return undefined;
  }
  const amount = nonEmptyString(bounty.amount);
  const currency = nonEmptyString(bounty.currency);
  if (!amount || !currency || !SUPPORTED_PAYMENT_CURRENCIES.has(currency)) {
    return undefined;
  }
  if (!POSITIVE_DECIMAL_RE.test(amount) || Number(amount) <= 0) {
    return undefined;
  }
  return `${amount}${currency}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function payloadObject(record: { payload?: unknown }): Record<string, unknown> {
  return isRecord(record.payload) ? record.payload : {};
}

function hasAcceptedPaidDelivery(input: LoomReviewWorkflowBaseInput): boolean {
  if (!input.state.found) {
    return false;
  }
  if (input.state.state === 'accepted_paid') {
    const latestDeliveryPinId = input.state.latestAcceptance
      ? nonEmptyString(payloadObject(input.state.latestAcceptance).deliveryPinId)
      : undefined;
    return !latestDeliveryPinId || latestDeliveryPinId === input.deliveryPinId;
  }
  return input.state.valid.acceptances.some((acceptance) => {
    const payload = payloadObject(acceptance);
    return payload.deliveryPinId === input.deliveryPinId
      && payload.verdict === 'passed'
      && payload.releasePayment === true
      && Boolean(nonEmptyString(payload.paymentTxId));
  });
}

function resolveReviewContext(input: LoomReviewWorkflowBaseInput): MetabotCommandResult<ResolvedReviewContext> {
  if (!input.state.found) {
    return commandFailed('task_not_found', input.state.message);
  }

  const delivery = findLatestValidDelivery(input.state, input.deliveryPinId);
  if (!delivery) {
    return commandFailed('delivery_not_found', `Loom delivery ${input.deliveryPinId} was not found for task ${input.taskPinId}.`);
  }

  const claim = findValidClaimForDelivery(input.state, input.deliveryPinId);
  if (!claim) {
    return commandFailed('claim_not_found', `Loom claim for delivery ${input.deliveryPinId} was not found.`);
  }

  if (input.state.task.globalMetaId !== input.requesterGlobalMetaId) {
    return commandFailed('permission_denied', `Loom acceptance for task ${input.taskPinId} must be written by the requester.`);
  }

  if (hasAcceptedPaidDelivery(input)) {
    return commandFailed('already_accepted_paid', `Loom delivery ${input.deliveryPinId} is already accepted and paid.`);
  }

  return commandSuccess({
    taskPinId: input.taskPinId,
    claimPinId: claim.pinId,
    deliveryPinId: delivery.pinId,
    payoutAddress: nonEmptyString(payloadObject(claim).payoutAddress),
    taskPayload: payloadObject(input.state.task),
  });
}

function buildFullChainRequest(input: {
  payload: Record<string, unknown>;
  from?: string;
  chain: string;
}): MetabotCommandResult<LoomChainWriteRequest & { from?: string; network?: string }> {
  const built = buildLoomChainWriteRequest('acceptance', input.payload);
  if (!built.request) {
    const message = built.validation.errors.length
      ? `Loom acceptance payload is invalid: ${built.validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`
      : 'Loom acceptance payload is invalid.';
    return commandFailed('invalid_payload', message);
  }
  return commandSuccess({
    ...built.request,
    ...(input.from ? { from: input.from } : {}),
    network: input.chain,
  });
}

function extractPaymentTxId(result: MetabotCommandResult<unknown>): string | undefined {
  if (!result.ok || !isRecord(result.data)) {
    return undefined;
  }
  return nonEmptyString(result.data.txid)
    ?? nonEmptyString(result.data.txId)
    ?? (Array.isArray(result.data.txids) ? result.data.txids.map(nonEmptyString).find(Boolean) : undefined);
}

function paymentFailed(result: MetabotCommandResult<unknown>, message?: string): MetabotCommandResult<never> {
  return commandFailed(
    'payment_failed',
    message ?? result.message ?? result.code ?? 'Loom payment failed.',
    { data: { cause: result } },
  );
}

async function persistAcceptanceIfWorkflowExists(input: {
  workflowStore: LoomWorkflowStore;
  taskPinId: string;
  claimPinId: string;
  acceptancePinId: string;
  paymentTxId?: string;
  nowIso: string;
}): Promise<void> {
  const workflow = await input.workflowStore.read(input.taskPinId, input.claimPinId);
  if (!workflow || workflow.taskPinId !== input.taskPinId || workflow.claimPinId !== input.claimPinId) {
    return;
  }
  await input.workflowStore.write({
    ...workflow,
    acceptance: {
      pinId: input.acceptancePinId,
      ...(input.paymentTxId ? { paymentTxId: input.paymentTxId } : {}),
    },
    updatedAt: input.nowIso,
  });
}

async function saveRetryArtifacts(input: {
  workflowStore: LoomWorkflowStore;
  taskPinId: string;
  claimPinId: string;
  acceptancePayload: Record<string, unknown>;
  chainRequest: Record<string, unknown>;
  nowIso: string;
}): Promise<{
  acceptancePayloadPath?: string;
  acceptanceRequestPath?: string;
  error?: { name?: string; message: string };
}> {
  try {
    const paths = input.workflowStore.resolve(input.taskPinId, input.claimPinId);
    const directory = path.dirname(paths.workflowPath);
    const acceptancePayloadPath = path.join(directory, 'acceptance-payload.json');
    const acceptanceRequestPath = path.join(directory, 'acceptance-chain-request.json');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(acceptancePayloadPath, `${JSON.stringify(input.acceptancePayload, null, 2)}\n`, 'utf8');
    await fs.writeFile(acceptanceRequestPath, `${JSON.stringify(input.chainRequest, null, 2)}\n`, 'utf8');

    try {
      const workflow = await input.workflowStore.read(input.taskPinId, input.claimPinId);
      if (workflow && workflow.taskPinId === input.taskPinId && workflow.claimPinId === input.claimPinId) {
        await input.workflowStore.write({
          ...workflow,
          retry: {
            ...workflow.retry,
            acceptancePayloadPath,
            acceptanceRequestPath,
          },
          updatedAt: input.nowIso,
        });
      }
    } catch {
      // The saved request files are the recovery source of truth.
    }

    return { acceptancePayloadPath, acceptanceRequestPath };
  } catch (error) {
    return {
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) },
    };
  }
}

async function writeAcceptance(input: {
  base: LoomReviewWorkflowBaseInput;
  context: ResolvedReviewContext;
  payload: Record<string, unknown>;
  paymentTxId?: string;
}): Promise<MetabotCommandResult<LoomReviewWorkflowResult>> {
  const chain = input.base.chain ?? DEFAULT_CHAIN;
  const writeResult = await writeLoomProtocolRecord({
    protocol: 'acceptance',
    payload: input.payload,
    from: input.base.from,
    chain,
    writeChain: input.base.writeChain,
  });
  if (!writeResult.ok) {
    return writeResult;
  }

  const nowIso = new Date(input.base.now?.() ?? Date.now()).toISOString();
  await persistAcceptanceIfWorkflowExists({
    workflowStore: input.base.workflowStore,
    taskPinId: input.base.taskPinId,
    claimPinId: input.context.claimPinId,
    acceptancePinId: writeResult.data.pinId,
    paymentTxId: input.paymentTxId,
    nowIso,
  });

  return commandSuccess({
    taskPinId: input.base.taskPinId,
    claimPinId: input.context.claimPinId,
    deliveryPinId: input.context.deliveryPinId,
    acceptancePinId: writeResult.data.pinId,
    ...(input.paymentTxId ? { paymentTxId: input.paymentTxId } : {}),
    acceptancePayload: input.payload,
  });
}

export async function runLoomAcceptAndPayWorkflow(
  input: LoomAcceptAndPayWorkflowInput,
): Promise<MetabotCommandResult<LoomReviewWorkflowResult | Record<string, unknown>>> {
  const resolved = resolveReviewContext(input);
  if (!resolved.ok) {
    return resolved;
  }
  const context = resolved.data;
  if (!context.payoutAddress) {
    return commandFailed('invalid_loom_state', `Loom claim ${context.claimPinId} does not include a payout address.`);
  }

  const amountRaw = buildLoomPaymentAmountRaw(context.taskPayload.bounty);
  if (!amountRaw) {
    return commandFailed('invalid_bounty', `Loom task ${input.taskPinId} has an invalid or unsupported bounty.`);
  }

  const transferResult = await input.walletTransfer({
    ...(input.from ? { from: input.from } : {}),
    toAddress: context.payoutAddress,
    amountRaw,
    confirm: Boolean(input.confirmPayment),
  });
  if (!transferResult.ok) {
    return paymentFailed(transferResult);
  }

  if (!input.confirmPayment) {
    return commandAwaitingConfirmation({
      ...(isRecord(transferResult.data) ? transferResult.data : {}),
      taskPinId: input.taskPinId,
      claimPinId: context.claimPinId,
      deliveryPinId: context.deliveryPinId,
      payoutAddress: context.payoutAddress,
      amountRaw,
    });
  }

  const paymentTxId = extractPaymentTxId(transferResult);
  if (!paymentTxId) {
    return paymentFailed(transferResult, 'Loom payment succeeded but did not return a payment txid.');
  }

  const acceptancePayload = {
    taskPinId: input.taskPinId,
    deliveryPinId: context.deliveryPinId,
    verdict: 'passed',
    score: input.score,
    comment: input.comment,
    releasePayment: true,
    paymentTxId,
  };
  const fullChainRequest = buildFullChainRequest({
    payload: acceptancePayload,
    from: input.from,
    chain: input.chain ?? DEFAULT_CHAIN,
  });
  if (!fullChainRequest.ok) {
    return fullChainRequest;
  }

  const writeResult = await writeLoomProtocolRecord({
    protocol: 'acceptance',
    payload: acceptancePayload,
    from: input.from,
    chain: input.chain ?? DEFAULT_CHAIN,
    writeChain: input.writeChain,
  });
  if (!writeResult.ok) {
    const nowIso = new Date(input.now?.() ?? Date.now()).toISOString();
    const savedArtifacts = await saveRetryArtifacts({
      workflowStore: input.workflowStore,
      taskPinId: input.taskPinId,
      claimPinId: context.claimPinId,
      acceptancePayload,
      chainRequest: { ...fullChainRequest.data },
      nowIso,
    });
    return commandFailed(
      'acceptance_write_failed_after_payment',
      `Payment ${paymentTxId} succeeded, but writing loom-acceptance failed. Use the saved acceptance chain request; retry guidance must not call wallet transfer again.`,
      {
        data: {
          paymentTxId,
          acceptancePayload,
          chainRequest: fullChainRequest.data,
          retryGuidance: `Recovery must not call wallet transfer. Publish the saved request with: metabot chain write --from ${input.from ?? '<requester-bot>'} --request-file <acceptance-chain-request.json> --chain ${input.chain ?? DEFAULT_CHAIN}.`,
          savedArtifacts,
          cause: writeResult,
        },
      },
    );
  }

  const nowIso = new Date(input.now?.() ?? Date.now()).toISOString();
  await persistAcceptanceIfWorkflowExists({
    workflowStore: input.workflowStore,
    taskPinId: input.taskPinId,
    claimPinId: context.claimPinId,
    acceptancePinId: writeResult.data.pinId,
    paymentTxId,
    nowIso,
  });

  return commandSuccess({
    taskPinId: input.taskPinId,
    claimPinId: context.claimPinId,
    deliveryPinId: context.deliveryPinId,
    acceptancePinId: writeResult.data.pinId,
    paymentTxId,
    acceptancePayload,
  });
}

export async function runLoomReviewDeliveryWorkflow(
  input: LoomReviewDeliveryWorkflowInput,
): Promise<MetabotCommandResult<LoomReviewWorkflowResult>> {
  if (input.verdict !== 'rejected' && input.verdict !== 'revision_needed') {
    return commandFailed('invalid_flag', 'Loom review-delivery verdict must be rejected or revision_needed.');
  }

  const resolved = resolveReviewContext(input);
  if (!resolved.ok) {
    return resolved;
  }

  const payload: Record<string, unknown> = {
    taskPinId: input.taskPinId,
    deliveryPinId: resolved.data.deliveryPinId,
    verdict: input.verdict,
    score: input.score,
    comment: input.comment,
    releasePayment: false,
    ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
  };

  return writeAcceptance({
    base: input,
    context: resolved.data,
    payload,
  });
}
