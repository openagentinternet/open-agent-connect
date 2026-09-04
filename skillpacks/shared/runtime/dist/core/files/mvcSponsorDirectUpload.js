"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadMvcSponsorDirectFile = uploadMvcSponsorDirectFile;
const node_fs_1 = require("node:fs");
const meta_contract_1 = require("meta-contract");
const mvcMessageSigning_1 = require("../subsidy/mvcMessageSigning");
const feeAssist_1 = require("../subsidy/feeAssist");
const mvc_1 = __importDefault(require("../chain/adapters/mvc"));
const writePin_1 = require("../chain/writePin");
const mvcFileInscriptionDraft_1 = require("../chain/mvcFileInscriptionDraft");
const mvcPendingUtxos_1 = require("../chain/mvcPendingUtxos");
const metafileUrls_1 = require("./metafileUrls");
const uploadFile_1 = require("./uploadFile");
function estimateDraftMinerFee(input) {
    const tx = new meta_contract_1.mvc.Transaction(input.unsignedTxHex);
    const outputTotal = tx.outputs.reduce((sum, output) => sum + Number(output.satoshis || 0), 0);
    return Math.max(0, input.userInputTotal - outputTotal);
}
async function selfPaidDirect(input) {
    const direct = await (0, uploadFile_1.uploadLocalFileToChain)({
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
async function fallbackSelfPaidForSponsorError(input) {
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
            reason: (0, feeAssist_1.normalizeSponsorReason)(input.error?.reason, input.fallbackReason),
            stage: input.stage,
            quotaBefore: input.quotaBefore,
            advisoryFeeEstimate: input.advisoryFeeEstimate,
        },
    });
}
async function uploadMvcSponsorDirectFile(input) {
    const identity = await input.signer.getIdentity();
    const data = await node_fs_1.promises.readFile(input.filePath);
    const request = (0, writePin_1.normalizeChainWriteRequest)({
        path: '/file',
        payload: data,
        contentType: input.contentType,
        encoding: 'binary',
        network: 'mvc',
    });
    const address = identity.addresses?.mvc || identity.mvcAddress;
    let quotaBefore;
    try {
        quotaBefore = await input.mvcSponsorClient.getAddressInfo({ address });
    }
    catch (error) {
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
    let draft;
    let estimatedMinerFee = 0;
    try {
        const utxos = await mvc_1.default.fetchUtxos(address);
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
    if (estimatedMinerFee > 0 && quotaBefore.availableAmount < estimatedMinerFee) {
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
    let challenge;
    try {
        challenge = await input.mvcSponsorClient.getChallenge();
    }
    catch (error) {
        if ((0, feeAssist_1.normalizeSponsorReason)(error?.reason, 'service_unavailable') === 'service_unavailable') {
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
    // Traffic-account billing (流量): the daemon attaches the dep only in
    // traffic mode; undefined keeps the legacy quota path (no account, unbound
    // bot, or backend 404).
    const trafficAccount = await input.mvcSponsorClient.traffic?.resolveTrafficAccount({
        botAddress: address,
        challengeId: challenge.challengeId,
        botMnemonic: identity.mnemonic,
        botWalletPath: identity.path,
    });
    let pre;
    try {
        pre = await input.mvcSponsorClient.preSponsor({
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
        if (reason === 'service_unavailable' || reason === 'insufficient_traffic') {
            return fallbackSelfPaidForSponsorError({
                error,
                filePath: input.filePath,
                contentType: input.contentType,
                network: input.network,
                signer: input.signer,
                fallbackReason: reason,
                stage: 'pre',
                quotaBefore,
                advisoryFeeEstimate: estimatedMinerFee,
            });
        }
        (0, feeAssist_1.attachFeeAssistError)({
            error,
            fallbackCode: 'mvc_fee_assist_pre_failed',
            fallbackReason: reason === 'insufficient_quota' ? 'insufficient_quota' : 'pre_rejected',
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
            advisoryFeeEstimate: advisoryFeeEstimate,
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
        commit = await input.mvcSponsorClient.commitSponsor({
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
            advisoryFeeEstimate: advisoryFeeEstimate,
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
    // Local spend journal + traffic balance-cache deduction (best-effort,
    // never throws) — only wired in traffic mode.
    if (input.mvcSponsorClient.traffic) {
        await input.mvcSponsorClient.traffic.recordSpend({
            txId: commit.txId,
            botAddress: address,
            orderId: pre.orderId,
            txSize: commit.txSize ?? 0,
            sponsoredMinerFee,
            savedFee: sponsoredMinerFee,
            billedBy: trafficAccount ? 'traffic' : 'quota',
            kind: '/file',
        }).catch(() => undefined);
    }
    let quotaAfter;
    try {
        quotaAfter = await input.mvcSponsorClient.getAddressInfo({ address });
    }
    catch {
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
        metawebUrl: (0, metafileUrls_1.buildMetafileBrowserUrl)(pinId),
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
            advisoryFeeEstimate: advisoryFeeEstimate,
            sponsoredMinerFee,
            savedFee: sponsoredMinerFee,
        },
    };
}
