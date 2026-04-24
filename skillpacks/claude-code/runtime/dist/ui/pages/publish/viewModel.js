"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublishPageViewModel = buildPublishPageViewModel;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function pushRow(rows, label, value) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return;
    }
    rows.push({ label, value: normalized });
}
function buildPublishPageViewModel(input) {
    const providerSummary = input.providerSummary && typeof input.providerSummary === 'object'
        ? input.providerSummary
        : {};
    const identity = providerSummary.identity && typeof providerSummary.identity === 'object'
        ? providerSummary.identity
        : {};
    const publishResult = input.publishResult && typeof input.publishResult === 'object'
        ? input.publishResult
        : {};
    const providerRows = [];
    pushRow(providerRows, 'Provider Name', identity.name);
    pushRow(providerRows, 'Provider GlobalMetaId', identity.globalMetaId);
    pushRow(providerRows, 'Payment Address', identity.mvcAddress);
    const resultRows = [];
    pushRow(resultRows, 'Service Pin ID', publishResult.servicePinId);
    pushRow(resultRows, 'Source Pin ID', publishResult.sourceServicePinId);
    pushRow(resultRows, 'Price', [
        normalizeText(publishResult.price),
        normalizeText(publishResult.currency),
    ].filter(Boolean).join(' '));
    pushRow(resultRows, 'Output Type', publishResult.outputType);
    pushRow(resultRows, 'Path', publishResult.path);
    return {
        providerCard: {
            title: 'Provider Identity',
            summary: normalizeText(identity.globalMetaId)
                ? 'This local MetaBot will publish the capability under its current chain identity.'
                : 'No local provider identity is loaded yet.',
            rows: providerRows,
        },
        resultCard: {
            hasResult: Boolean(normalizeText(publishResult.servicePinId)),
            title: 'Publish Result',
            summary: normalizeText(publishResult.servicePinId)
                ? 'The service has been published to MetaWeb and now has a real chain pin.'
                : 'No publish result yet. Submit the form to create one on-chain.',
            rows: resultRows,
        },
    };
}
