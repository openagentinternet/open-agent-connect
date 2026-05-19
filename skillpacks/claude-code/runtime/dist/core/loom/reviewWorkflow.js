"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLoomPaymentAmountRaw = buildLoomPaymentAmountRaw;
exports.runLoomAcceptAndPayWorkflow = runLoomAcceptAndPayWorkflow;
exports.runLoomReviewDeliveryWorkflow = runLoomReviewDeliveryWorkflow;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../contracts/commandResult");
const chainRequest_1 = require("./chainRequest");
const workflowState_1 = require("./workflowState");
const workflowChain_1 = require("./workflowChain");
const DEFAULT_CHAIN = 'mvc';
const SUPPORTED_PAYMENT_CURRENCIES = new Set(['SPACE', 'BTC', 'DOGE', 'OPCAT']);
const POSITIVE_DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
function buildLoomPaymentAmountRaw(bounty) {
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
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
function payloadObject(record) {
    return isRecord(record.payload) ? record.payload : {};
}
function hasAcceptedPaidDelivery(input) {
    if (!input.state.found) {
        return false;
    }
    if (input.state.state === 'accepted_paid') {
        return true;
    }
    return input.state.valid.acceptances.some((acceptance) => {
        const payload = payloadObject(acceptance);
        return payload.verdict === 'passed'
            && payload.releasePayment === true
            && Boolean(nonEmptyString(payload.paymentTxId));
    });
}
function resolveReviewContext(input) {
    if (!input.state.found) {
        return (0, commandResult_1.commandFailed)('task_not_found', input.state.message);
    }
    const delivery = (0, workflowState_1.findLatestValidDelivery)(input.state, input.deliveryPinId);
    if (!delivery) {
        return (0, commandResult_1.commandFailed)('delivery_not_found', `Loom delivery ${input.deliveryPinId} was not found for task ${input.taskPinId}.`);
    }
    const claim = (0, workflowState_1.findValidClaimForDelivery)(input.state, input.deliveryPinId);
    if (!claim) {
        return (0, commandResult_1.commandFailed)('claim_not_found', `Loom claim for delivery ${input.deliveryPinId} was not found.`);
    }
    if (input.state.task.globalMetaId !== input.requesterGlobalMetaId) {
        return (0, commandResult_1.commandFailed)('permission_denied', `Loom acceptance for task ${input.taskPinId} must be written by the requester.`);
    }
    if (hasAcceptedPaidDelivery(input)) {
        return (0, commandResult_1.commandFailed)('already_accepted_paid', `Loom delivery ${input.deliveryPinId} is already accepted and paid.`);
    }
    return (0, commandResult_1.commandSuccess)({
        taskPinId: input.taskPinId,
        claimPinId: claim.pinId,
        deliveryPinId: delivery.pinId,
        payoutAddress: nonEmptyString(payloadObject(claim).payoutAddress),
        taskPayload: payloadObject(input.state.task),
    });
}
function buildFullChainRequest(input) {
    const built = (0, chainRequest_1.buildLoomChainWriteRequest)('acceptance', input.payload);
    if (!built.request) {
        const message = built.validation.errors.length
            ? `Loom acceptance payload is invalid: ${built.validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`
            : 'Loom acceptance payload is invalid.';
        return (0, commandResult_1.commandFailed)('invalid_payload', message);
    }
    return (0, commandResult_1.commandSuccess)({
        ...built.request,
        ...(input.from ? { from: input.from } : {}),
        network: input.chain,
    });
}
function extractPaymentTxId(result) {
    if (!result.ok || !isRecord(result.data)) {
        return undefined;
    }
    return nonEmptyString(result.data.txid)
        ?? nonEmptyString(result.data.txId)
        ?? (Array.isArray(result.data.txids) ? result.data.txids.map(nonEmptyString).find(Boolean) : undefined);
}
function paymentFailed(result, message) {
    return (0, commandResult_1.commandFailed)('payment_failed', message ?? result.message ?? result.code ?? 'Loom payment failed.', { data: { cause: result } });
}
function serializeError(error) {
    return error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) };
}
async function persistAcceptanceIfWorkflowExists(input) {
    try {
        const workflow = await input.workflowStore.read(input.taskPinId, input.claimPinId);
        if (!workflow || workflow.taskPinId !== input.taskPinId || workflow.claimPinId !== input.claimPinId) {
            return undefined;
        }
        await input.workflowStore.write({
            ...workflow,
            acceptance: {
                pinId: input.acceptancePinId,
                ...(input.paymentTxId ? { paymentTxId: input.paymentTxId } : {}),
            },
            updatedAt: input.nowIso,
        });
        return undefined;
    }
    catch (error) {
        return {
            code: 'local_persistence_failed',
            message: 'Loom acceptance was written on-chain, but updating the local workflow state failed.',
            error: serializeError(error),
        };
    }
}
async function saveRetryArtifacts(input) {
    try {
        const paths = input.workflowStore.resolve(input.taskPinId, input.claimPinId);
        const directory = node_path_1.default.dirname(paths.workflowPath);
        const acceptancePayloadPath = node_path_1.default.join(directory, 'acceptance-payload.json');
        const acceptanceRequestPath = node_path_1.default.join(directory, 'acceptance-chain-request.json');
        await node_fs_1.promises.mkdir(directory, { recursive: true });
        await node_fs_1.promises.writeFile(acceptancePayloadPath, `${JSON.stringify(input.acceptancePayload, null, 2)}\n`, 'utf8');
        await node_fs_1.promises.writeFile(acceptanceRequestPath, `${JSON.stringify(input.chainRequest, null, 2)}\n`, 'utf8');
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
        }
        catch {
            // The saved request files are the recovery source of truth.
        }
        return { acceptancePayloadPath, acceptanceRequestPath };
    }
    catch (error) {
        return {
            error: error instanceof Error
                ? { name: error.name, message: error.message }
                : { message: String(error) },
        };
    }
}
async function writeAcceptance(input) {
    const chain = input.base.chain ?? DEFAULT_CHAIN;
    const writeResult = await (0, workflowChain_1.writeLoomProtocolRecord)({
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
    const localPersistenceWarning = await persistAcceptanceIfWorkflowExists({
        workflowStore: input.base.workflowStore,
        taskPinId: input.base.taskPinId,
        claimPinId: input.context.claimPinId,
        acceptancePinId: writeResult.data.pinId,
        paymentTxId: input.paymentTxId,
        nowIso,
    });
    return (0, commandResult_1.commandSuccess)({
        taskPinId: input.base.taskPinId,
        claimPinId: input.context.claimPinId,
        deliveryPinId: input.context.deliveryPinId,
        acceptancePinId: writeResult.data.pinId,
        ...(input.paymentTxId ? { paymentTxId: input.paymentTxId } : {}),
        acceptancePayload: input.payload,
        ...(localPersistenceWarning ? { localPersistenceWarning } : {}),
    });
}
async function runLoomAcceptAndPayWorkflow(input) {
    const resolved = resolveReviewContext(input);
    if (!resolved.ok) {
        return resolved;
    }
    const context = resolved.data;
    if (!context.payoutAddress) {
        return (0, commandResult_1.commandFailed)('invalid_loom_state', `Loom claim ${context.claimPinId} does not include a payout address.`);
    }
    const amountRaw = buildLoomPaymentAmountRaw(context.taskPayload.bounty);
    if (!amountRaw) {
        return (0, commandResult_1.commandFailed)('invalid_bounty', `Loom task ${input.taskPinId} has an invalid or unsupported bounty.`);
    }
    const prePaymentAcceptancePayload = {
        taskPinId: input.taskPinId,
        deliveryPinId: context.deliveryPinId,
        verdict: 'passed',
        score: input.score,
        comment: input.comment,
        releasePayment: true,
        paymentTxId: 'pending-payment-validation-placeholder',
    };
    const prePaymentChainRequest = buildFullChainRequest({
        payload: prePaymentAcceptancePayload,
        from: input.from,
        chain: input.chain ?? DEFAULT_CHAIN,
    });
    if (!prePaymentChainRequest.ok) {
        return prePaymentChainRequest;
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
        return (0, commandResult_1.commandAwaitingConfirmation)({
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
    const writeResult = await (0, workflowChain_1.writeLoomProtocolRecord)({
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
        return (0, commandResult_1.commandFailed)('acceptance_write_failed_after_payment', `Payment ${paymentTxId} succeeded, but writing loom-acceptance failed. Use the saved acceptance chain request; retry guidance must not call wallet transfer again.`, {
            data: {
                paymentTxId,
                acceptancePayload,
                chainRequest: fullChainRequest.data,
                retryGuidance: `Recovery must not call wallet transfer. Publish the saved request with: metabot chain write --from ${input.from ?? '<requester-bot>'} --request-file <acceptance-chain-request.json> --chain ${input.chain ?? DEFAULT_CHAIN}.`,
                savedArtifacts,
                cause: writeResult,
            },
        });
    }
    const nowIso = new Date(input.now?.() ?? Date.now()).toISOString();
    const localPersistenceWarning = await persistAcceptanceIfWorkflowExists({
        workflowStore: input.workflowStore,
        taskPinId: input.taskPinId,
        claimPinId: context.claimPinId,
        acceptancePinId: writeResult.data.pinId,
        paymentTxId,
        nowIso,
    });
    return (0, commandResult_1.commandSuccess)({
        taskPinId: input.taskPinId,
        claimPinId: context.claimPinId,
        deliveryPinId: context.deliveryPinId,
        acceptancePinId: writeResult.data.pinId,
        paymentTxId,
        acceptancePayload,
        ...(localPersistenceWarning ? { localPersistenceWarning } : {}),
    });
}
async function runLoomReviewDeliveryWorkflow(input) {
    if (input.verdict !== 'rejected' && input.verdict !== 'revision_needed') {
        return (0, commandResult_1.commandFailed)('invalid_flag', 'Loom review-delivery verdict must be rejected or revision_needed.');
    }
    const resolved = resolveReviewContext(input);
    if (!resolved.ok) {
        return resolved;
    }
    const payload = {
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
