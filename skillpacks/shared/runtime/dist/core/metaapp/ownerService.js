"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listOwnerMetaApps = listOwnerMetaApps;
exports.publishMetaAppPayload = publishMetaAppPayload;
exports.updateMetaAppPayload = updateMetaAppPayload;
exports.deleteMetaAppPin = deleteMetaAppPin;
const commandResult_1 = require("../contracts/commandResult");
const appsProtocol_1 = require("./appsProtocol");
const pinId_1 = require("./pinId");
const share_1 = require("./share");
function requireConfirm(input, action) {
    return input.confirm === true
        ? null
        : (0, commandResult_1.commandFailed)('confirmation_required', `MetaAPP ${action} requires --confirm.`);
}
function requirePinIdFromWrite(write) {
    const pinId = (0, pinId_1.normalizeMetaAppPinId)(write.pinId);
    if (!pinId) {
        throw new Error('MetaAPP chain write did not return pinId.');
    }
    return pinId;
}
async function listOwnerMetaApps(actor, input) {
    const size = Number.isFinite(input.size) && Number(input.size) > 0 ? Math.trunc(Number(input.size)) : 12;
    const result = await input.manClient.listByAddress({
        address: actor.mvcAddress,
        cursor: input.cursor || '',
        size,
    });
    return (0, commandResult_1.commandSuccess)(result);
}
async function publishMetaAppPayload(actor, input) {
    const missing = requireConfirm(input, 'publish');
    if (missing)
        return missing;
    const payload = (0, appsProtocol_1.buildMetaAppProtocolPayload)(input);
    const write = (0, appsProtocol_1.buildMetaAppCreateWrite)(payload);
    const chainWrite = await actor.writePin({ ...write, network: input.network });
    const pinId = requirePinIdFromWrite(chainWrite);
    return (0, commandResult_1.commandSuccess)({
        pinId,
        chainWrite,
        metaappUri: `metaapp://${pinId}`,
        metawebUrl: (0, share_1.buildMetaAppCanonicalUrl)(pinId),
    });
}
async function updateMetaAppPayload(actor, input) {
    const missing = requireConfirm(input, 'update');
    if (missing)
        return missing;
    const targetPinId = typeof input.targetPinId === 'string' ? input.targetPinId.trim() : '';
    const payload = (0, appsProtocol_1.buildMetaAppProtocolPayload)(input);
    const write = (0, appsProtocol_1.buildMetaAppModifyWrite)(targetPinId, payload);
    const chainWrite = await actor.writePin({ ...write, network: input.network });
    const pinId = requirePinIdFromWrite(chainWrite);
    return (0, commandResult_1.commandSuccess)({
        pinId,
        targetPinId,
        chainWrite,
        metaappUri: `metaapp://${pinId}`,
        metawebUrl: (0, share_1.buildMetaAppCanonicalUrl)(pinId),
    });
}
async function deleteMetaAppPin(actor, input) {
    const missing = requireConfirm(input, 'delete');
    if (missing)
        return missing;
    const targetPinId = typeof input.targetPinId === 'string' ? input.targetPinId.trim() : '';
    const write = (0, appsProtocol_1.buildMetaAppRevokeWrite)(targetPinId);
    const chainWrite = await actor.writePin({ ...write, network: input.network });
    const pinId = requirePinIdFromWrite(chainWrite);
    return (0, commandResult_1.commandSuccess)({
        revokedPinId: targetPinId,
        pinId,
        chainWrite,
    });
}
