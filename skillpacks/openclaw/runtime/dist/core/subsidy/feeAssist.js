"use strict";
/**
 * Shared fee-assist (sponsor v2) metadata + error plumbing.
 * Extracted from src/core/files/mvcSponsorDirectUpload.ts so the sponsored
 * pin-write flow (mvcSponsorWritePin.ts) and the sponsored file-upload flow
 * attach the exact same diagnostics shape, matching IDBots'
 * mvcSponsorUpload.ts / mvcSponsorCreatePin.ts semantics.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSponsorReason = normalizeSponsorReason;
exports.getStableErrorCode = getStableErrorCode;
exports.getErrorMessage = getErrorMessage;
exports.isNoUserUtxoDraftError = isNoUserUtxoDraftError;
exports.attachFeeAssistError = attachFeeAssistError;
function normalizeSponsorReason(value, fallback) {
    return value === 'insufficient_quota'
        || value === 'insufficient_traffic'
        || value === 'service_unavailable'
        || value === 'commit_failed'
        || value === 'pre_rejected'
        || value === 'no_user_utxo'
        ? value
        : fallback;
}
function getStableErrorCode(error, fallback) {
    const code = error?.code;
    return typeof code === 'string' && code.trim() ? code.trim() : fallback;
}
function getErrorMessage(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
}
/** True when a draft build failed because the wallet has no usable UTXOs. */
function isNoUserUtxoDraftError(error) {
    return /MetaBot balance is insufficient for this chain write\./i.test(getErrorMessage(error, ''));
}
/**
 * Rethrow a sponsor-flow failure with feeAssist diagnostics attached on
 * error.data (same contract as the upload path). Never returns.
 */
function attachFeeAssistError(input) {
    const error = input.error instanceof Error
        ? input.error
        : new Error(getErrorMessage(input.error, `MVC sponsor ${input.stage} failed.`));
    error.code = getStableErrorCode(error, input.fallbackCode);
    const existingData = error.data && typeof error.data === 'object' ? error.data : {};
    error.data = {
        ...existingData,
        feeAssist: {
            attempted: true,
            used: false,
            mode: 'mvc_sponsor_v2',
            sponsor: 'mvc_sponsor_v2',
            reason: normalizeSponsorReason(input.error?.reason, input.fallbackReason),
            stage: input.stage,
            orderId: input.orderId,
            quotaBefore: input.quotaBefore,
            advisoryFeeEstimate: input.advisoryFeeEstimate,
            sponsoredMinerFee: input.sponsoredMinerFee,
            savedFee: input.sponsoredMinerFee,
        },
    };
    throw error;
}
