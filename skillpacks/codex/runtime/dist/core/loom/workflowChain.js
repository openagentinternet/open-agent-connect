"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeLoomProtocolRecord = writeLoomProtocolRecord;
const commandResult_1 = require("../contracts/commandResult");
const chainRequest_1 = require("./chainRequest");
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function optionalString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function optionalStringArray(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const strings = value.filter((item) => typeof item === 'string');
    return strings.length > 0 ? strings : undefined;
}
function formatValidationMessage(errors) {
    if (errors.length === 0) {
        return 'Loom payload is invalid.';
    }
    return `Loom payload is invalid: ${errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`;
}
function formatWriteFailure(result) {
    const code = result.code ? `${result.code}: ` : '';
    return `${code}${result.message ?? 'Chain writer returned a failed result.'}`;
}
function serializeThrownCause(error) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
        };
    }
    return error;
}
function commandFailedWithCause(code, message, cause) {
    return (0, commandResult_1.commandFailed)(code, message, { data: { cause } });
}
function writerFailureWithCause(result) {
    const message = `Loom chain write failed: ${formatWriteFailure(result)}`;
    if (result.state === 'waiting') {
        return {
            ok: false,
            state: 'waiting',
            code: 'chain_write_failed',
            message,
            pollAfterMs: result.pollAfterMs,
            ...(result.localUiUrl ? { localUiUrl: result.localUiUrl } : {}),
            data: { cause: result },
        };
    }
    if (result.state === 'manual_action_required') {
        return {
            ok: false,
            state: 'manual_action_required',
            code: 'chain_write_failed',
            message,
            ...(result.localUiUrl ? { localUiUrl: result.localUiUrl } : {}),
            data: { cause: result },
        };
    }
    return commandFailedWithCause('chain_write_failed', message, result);
}
async function writeLoomProtocolRecord(input) {
    const built = (0, chainRequest_1.buildLoomChainWriteRequest)(input.protocol, input.payload);
    if (built.request === null) {
        return (0, commandResult_1.commandFailed)('invalid_payload', formatValidationMessage(built.validation.errors));
    }
    const writeRequest = {
        ...built.request,
        ...(input.from ? { from: input.from } : {}),
        ...(input.chain ? { network: input.chain } : {}),
    };
    let writeResult;
    try {
        writeResult = await input.writeChain(writeRequest);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return commandFailedWithCause('chain_write_failed', `Loom chain write failed: ${message}`, serializeThrownCause(error));
    }
    if (!writeResult.ok) {
        return writerFailureWithCause(writeResult);
    }
    if (!isRecord(writeResult.data)) {
        return (0, commandResult_1.commandFailed)('chain_write_failed', 'Loom chain write failed: writer returned no result data.');
    }
    const pinId = optionalString(writeResult.data.pinId);
    if (!pinId) {
        return (0, commandResult_1.commandFailed)('chain_write_failed', 'Loom chain write failed: writer result did not include pinId.');
    }
    return (0, commandResult_1.commandSuccess)({
        pinId,
        txids: optionalStringArray(writeResult.data.txids),
        request: built.request,
        network: optionalString(writeResult.data.network),
        globalMetaId: optionalString(writeResult.data.globalMetaId),
        mvcAddress: optionalString(writeResult.data.mvcAddress),
    });
}
