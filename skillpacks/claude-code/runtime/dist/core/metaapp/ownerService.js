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
const writeGuard_1 = require("./writeGuard");
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
async function publishMetaAppPayload(actor, input, writeGuard) {
    const missing = requireConfirm(input, 'publish');
    if (missing)
        return missing;
    const payload = (0, appsProtocol_1.buildMetaAppProtocolPayload)(input);
    const write = (0, appsProtocol_1.buildMetaAppCreateWrite)(payload);
    const execute = async () => {
        const chainWrite = await actor.writePin({ ...write, network: input.network });
        const pinId = requirePinIdFromWrite(chainWrite);
        return (0, commandResult_1.commandSuccess)({
            pinId,
            firstPinId: pinId,
            chainWrite,
            metaappUri: (0, share_1.buildMetaAppUri)(pinId),
            metawebUrl: (0, share_1.buildMetaAppCanonicalUrl)(pinId),
        });
    };
    if (!writeGuard)
        return execute();
    return writeGuard.run({
        idemKey: (0, writeGuard_1.stableMetaAppWriteHash)('metaapp-create', [
            actor.mvcAddress,
            JSON.stringify(payload),
            typeof input.network === 'string' ? input.network : undefined,
        ]),
        fn: execute,
    });
}
async function updateMetaAppPayload(actor, input, writeGuard) {
    const missing = requireConfirm(input, 'update');
    if (missing)
        return missing;
    const targetPinId = typeof input.targetPinId === 'string' ? input.targetPinId.trim() : '';
    const payload = (0, appsProtocol_1.buildMetaAppProtocolPayload)(input);
    const write = (0, appsProtocol_1.buildMetaAppModifyWrite)(targetPinId, payload);
    const execute = async () => {
        const chainWrite = await actor.writePin({ ...write, network: input.network });
        const pinId = requirePinIdFromWrite(chainWrite);
        const firstPinId = (0, pinId_1.normalizeMetaAppPinId)(chainWrite.firstPinId) ?? targetPinId;
        return (0, commandResult_1.commandSuccess)({
            pinId,
            firstPinId,
            targetPinId,
            chainWrite,
            metaappUri: (0, share_1.buildMetaAppUri)(pinId, firstPinId),
            metawebUrl: (0, share_1.buildMetaAppCanonicalUrl)(pinId, firstPinId),
        });
    };
    if (!writeGuard)
        return execute();
    return writeGuard.run({
        idemKey: (0, writeGuard_1.stableMetaAppWriteHash)('metaapp-modify', [
            actor.mvcAddress,
            targetPinId,
            JSON.stringify(payload),
            typeof input.network === 'string' ? input.network : undefined,
        ]),
        lockKey: `metaapp:${targetPinId}`,
        fn: execute,
    });
}
async function deleteMetaAppPin(actor, input, writeGuard) {
    const missing = requireConfirm(input, 'delete');
    if (missing)
        return missing;
    const targetPinId = typeof input.targetPinId === 'string' ? input.targetPinId.trim() : '';
    const write = (0, appsProtocol_1.buildMetaAppRevokeWrite)(targetPinId);
    const execute = async () => {
        const chainWrite = await actor.writePin({ ...write, network: input.network });
        const pinId = requirePinIdFromWrite(chainWrite);
        return (0, commandResult_1.commandSuccess)({
            revokedPinId: targetPinId,
            pinId,
            chainWrite,
        });
    };
    if (!writeGuard)
        return execute();
    return writeGuard.run({
        idemKey: (0, writeGuard_1.stableMetaAppWriteHash)('metaapp-revoke', [actor.mvcAddress, targetPinId]),
        lockKey: `metaapp:${targetPinId}`,
        fn: execute,
    });
}
