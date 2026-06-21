"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLoomPostTaskWorkflow = runLoomPostTaskWorkflow;
const commandResult_1 = require("../contracts/commandResult");
const chainRequest_1 = require("./chainRequest");
const validation_1 = require("./validation");
const workflowChain_1 = require("./workflowChain");
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function formatValidationMessage(errors) {
    if (errors.length === 0) {
        return 'Loom task payload is invalid.';
    }
    return `Loom task payload is invalid: ${errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`;
}
function sourceCount(input) {
    return [input.payload !== undefined, Boolean(input.payloadFile), Boolean(input.wish)]
        .filter(Boolean)
        .length;
}
function buildPreviewRequest(request, input) {
    return {
        ...request,
        ...(input.from ? { from: input.from } : {}),
        ...(input.chain ? { network: input.chain } : {}),
    };
}
function extractDraftPayload(result) {
    if (isRecord(result) && result.ok === false && typeof result.state === 'string') {
        return result;
    }
    if (isRecord(result) && result.ok === true && result.state === 'success') {
        const data = result.data;
        if (isRecord(data) && isRecord(data.payload)) {
            return (0, commandResult_1.commandSuccess)(data.payload);
        }
        if (isRecord(data)) {
            return (0, commandResult_1.commandSuccess)(data);
        }
        return (0, commandResult_1.commandFailed)('invalid_payload', 'Drafted loom task payload must be an object.');
    }
    if (isRecord(result)) {
        return (0, commandResult_1.commandSuccess)(result);
    }
    return (0, commandResult_1.commandFailed)('invalid_payload', 'Drafted loom task payload must be an object.');
}
async function resolvePayload(input) {
    if (sourceCount(input) !== 1) {
        return (0, commandResult_1.commandFailed)('invalid_source', 'Use exactly one of payload, payloadFile, or wish.');
    }
    if (input.payload !== undefined) {
        return (0, commandResult_1.commandSuccess)(input.payload);
    }
    if (input.payloadFile) {
        if (!input.readPayloadFile) {
            return (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom post-task payload-file reader is unavailable.');
        }
        let payload;
        try {
            payload = await input.readPayloadFile(input.payloadFile);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'payload file must contain valid JSON.';
            return (0, commandResult_1.commandFailed)('invalid_payload', `Loom task payload file is invalid: ${message}`);
        }
        if (!isRecord(payload)) {
            return (0, commandResult_1.commandFailed)('invalid_payload', 'Loom task payload must be an object.');
        }
        return (0, commandResult_1.commandSuccess)(payload);
    }
    if (!input.draftTask) {
        return (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom post-task draft dependency is unavailable.');
    }
    const draft = await input.draftTask(input.wish);
    return extractDraftPayload(draft);
}
async function runLoomPostTaskWorkflow(input) {
    const resolvedPayload = await resolvePayload(input);
    if (!resolvedPayload.ok) {
        return resolvedPayload;
    }
    const payload = resolvedPayload.data;
    const validation = (0, validation_1.validateLoomPayload)('task', payload);
    if (!validation.valid) {
        return (0, commandResult_1.commandFailed)('invalid_payload', formatValidationMessage(validation.errors));
    }
    const built = (0, chainRequest_1.buildLoomChainWriteRequest)('task', payload);
    if (built.request === null) {
        return (0, commandResult_1.commandFailed)('invalid_payload', formatValidationMessage(built.validation.errors));
    }
    if (input.dryRun) {
        return (0, commandResult_1.commandSuccess)({
            dryRun: true,
            payload,
            request: buildPreviewRequest(built.request, input),
        });
    }
    return (0, workflowChain_1.writeLoomProtocolRecord)({
        protocol: 'task',
        payload,
        from: input.from,
        chain: input.chain,
        writeChain: input.writeChain,
    });
}
