"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeMvcSponsorPin = writeMvcSponsorPin;
exports.createTrafficSponsorWritePinResolver = createTrafficSponsorWritePinResolver;
const meta_contract_1 = require("meta-contract");
const mvcFileInscriptionDraft_1 = require("../chain/mvcFileInscriptionDraft");
const mvcPendingUtxos_1 = require("../chain/mvcPendingUtxos");
const mvc_1 = __importDefault(require("../chain/adapters/mvc"));
const mvcMessageSigning_1 = require("./mvcMessageSigning");
const mvcSponsorV2Client_1 = require("./mvcSponsorV2Client");
const feeAssist_1 = require("./feeAssist");
function isFallbackReason(reason) {
    return reason === 'service_unavailable'
        || reason === 'no_user_utxo'
        || reason === 'insufficient_quota'
        || reason === 'insufficient_traffic';
}
function estimateDraftMinerFee(input) {
    const tx = new meta_contract_1.mvc.Transaction(input.unsignedTxHex);
    const outputTotal = tx.outputs.reduce((sum, output) => sum + Number(output.satoshis || 0), 0);
    return Math.max(0, input.userInputTotal - outputTotal);
}
async function writeMvcSponsorPin(input) {
    const { request, identity, sponsorClient, traffic, runSelfPaid } = input;
    const fetchUtxos = input.fetchUtxos ?? ((address) => mvc_1.default.fetchUtxos(address));
    const address = identity.addresses?.mvc || identity.mvcAddress;
    const fallbackToSelfPaid = async (params) => {
        const feeAssist = {
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
    let quotaBefore;
    try {
        quotaBefore = await sponsorClient.getAddressInfo({ address });
    }
    catch {
        return fallbackToSelfPaid({ reason: 'service_unavailable', stage: 'address_info' });
    }
    let draft;
    let estimatedMinerFee = 0;
    try {
        const utxos = await fetchUtxos(address);
        draft = await (0, mvcFileInscriptionDraft_1.buildMvcFileInscriptionDraft)({
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
    }
    catch (error) {
        if (!(0, feeAssist_1.isNoUserUtxoDraftError)(error)) {
            (0, feeAssist_1.attachFeeAssistError)({
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
    let challenge;
    try {
        challenge = await sponsorClient.getChallenge();
    }
    catch (error) {
        const reason = (0, feeAssist_1.normalizeSponsorReason)(error?.reason, 'service_unavailable');
        if (isFallbackReason(reason)) {
            return fallbackToSelfPaid({ reason, stage: 'challenge', quotaBefore, advisoryFeeEstimate: estimatedMinerFee });
        }
        (0, feeAssist_1.attachFeeAssistError)({
            error,
            fallbackCode: 'mvc_fee_assist_challenge_failed',
            fallbackReason: 'service_unavailable',
            stage: 'challenge',
            quotaBefore,
            advisoryFeeEstimate: estimatedMinerFee,
        });
    }
    const challengeSignature = await (0, mvcMessageSigning_1.signMvcAddressMessage)({
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
    let pre;
    try {
        pre = await sponsorClient.preSponsor({
            address,
            txHex: draft.unsignedTxHex,
            challengeId: challenge.challengeId,
            publicKey: challengeSignature.publicKey,
            signature: challengeSignature.signature,
            ...(trafficAccount ? { trafficAccount } : {}),
        });
    }
    catch (error) {
        const reason = (0, feeAssist_1.normalizeSponsorReason)(error?.reason, 'pre_rejected');
        if (isFallbackReason(reason)) {
            return fallbackToSelfPaid({ reason, stage: 'pre', quotaBefore, advisoryFeeEstimate: estimatedMinerFee });
        }
        (0, feeAssist_1.attachFeeAssistError)({
            error,
            fallbackCode: 'mvc_fee_assist_pre_failed',
            fallbackReason: 'pre_rejected',
            stage: 'pre',
            quotaBefore,
            advisoryFeeEstimate: estimatedMinerFee,
        });
    }
    const advisoryFeeEstimate = estimatedMinerFee > 0 ? estimatedMinerFee : pre.minerFee;
    let signedTxHex;
    try {
        signedTxHex = (await (0, mvcFileInscriptionDraft_1.signMvcPreparedUserInputs)({
            identity,
            preparedTxHex: pre.preparedTxHex,
            userInputs: draft.userInputs,
            userInputIndexes: pre.userInputIndexes,
        })).txHex;
    }
    catch (error) {
        (0, feeAssist_1.attachFeeAssistError)({
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
    const signedTxHash = new meta_contract_1.mvc.Transaction(signedTxHex).id;
    const commitMessage = `assist-sponsor-commit:${pre.orderId}:${signedTxHash}`;
    const commitSignature = await (0, mvcMessageSigning_1.signMvcAddressMessage)({
        mnemonic: identity.mnemonic,
        path: identity.path,
        message: commitMessage,
    });
    let commit;
    try {
        commit = await sponsorClient.commitSponsor({
            orderId: pre.orderId,
            signedTxHex,
            publicKey: commitSignature.publicKey,
            signature: commitSignature.signature,
            message: commitMessage,
        });
    }
    catch (error) {
        (0, feeAssist_1.attachFeeAssistError)({
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
    (0, mvcPendingUtxos_1.rememberPendingMvcTransaction)({
        address,
        spentUtxos: draft.userInputs,
        createdUtxos: (0, mvcFileInscriptionDraft_1.extractOwnedOutputsFromPreparedMvcTx)({
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
    let quotaAfter;
    try {
        quotaAfter = await sponsorClient.getAddressInfo({ address });
    }
    catch {
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
function createTrafficSponsorWritePinResolver(input) {
    const service = input.trafficAccountService;
    return async ({ request, identity, runSelfPaid }) => {
        if ((await service.getTrafficPinMode()) !== 'traffic') {
            return null;
        }
        const sponsorClient = (0, mvcSponsorV2Client_1.createMvcSponsorV2Client)({
            baseUrl: await service.getConfiguredTrafficApiBase(),
        });
        return writeMvcSponsorPin({
            request,
            identity,
            sponsorClient,
            traffic: {
                resolveTrafficAccount: ({ botAddress, challengeId }) => service.resolveSponsorTrafficAccount({
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
