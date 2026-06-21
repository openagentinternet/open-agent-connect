"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLoomCommand = runLoomCommand;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const commandResult_1 = require("../../core/contracts/commandResult");
const loom_1 = require("../../core/loom");
const helpers_1 = require("./helpers");
function commandUnsupportedFlag(flag) {
    return (0, commandResult_1.commandFailed)('invalid_flag', `${flag} is not supported by metabot loom. Use metabot chain write for chain selection and actor selection.`);
}
function rejectChainWriteFlags(args) {
    if (args.includes('--chain')) {
        return commandUnsupportedFlag('--chain');
    }
    if (args.includes('--from')) {
        return commandUnsupportedFlag('--from');
    }
    return null;
}
function commandInvalidProtocol(protocol) {
    return (0, commandResult_1.commandFailed)('invalid_protocol', `Unsupported Loom protocol: ${protocol}`);
}
function commandMissingArgument(argument) {
    return (0, commandResult_1.commandFailed)('missing_argument', `Missing required argument ${argument}.`);
}
function readAllFlagValues(args, flag) {
    const values = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] !== flag) {
            continue;
        }
        const value = args[index + 1];
        if (typeof value !== 'string' || value.startsWith('--')) {
            return { ok: false, result: (0, commandResult_1.commandFailed)('invalid_flag', `${flag} requires a value.`) };
        }
        values.push(value);
    }
    return { ok: true, values };
}
function readOptionalValue(args, flag) {
    if (!args.includes(flag)) {
        return { ok: true };
    }
    const value = (0, helpers_1.readFlagValue)(args, flag);
    if (!value || value.startsWith('--')) {
        return { ok: false, result: (0, commandResult_1.commandFailed)('invalid_flag', `${flag} requires a value.`) };
    }
    return { ok: true, value };
}
function readRequiredValue(args, flag) {
    const value = (0, helpers_1.readFlagValue)(args, flag);
    if (!value || value.startsWith('--')) {
        return { ok: false, result: (0, helpers_1.commandMissingFlag)(flag) };
    }
    return { ok: true, value };
}
function readOptionalChain(args) {
    const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
    if (chainFlag.error) {
        return { ok: false, result: chainFlag.error };
    }
    return chainFlag.chain ? { ok: true, chain: chainFlag.chain } : { ok: true };
}
function readOptionalFileChain(args) {
    if (!args.includes('--file-chain')) {
        return { ok: true };
    }
    const fileChain = (0, helpers_1.readFlagValue)(args, '--file-chain');
    if (!fileChain || fileChain.startsWith('--')) {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('invalid_flag', '--file-chain requires a value. Supported values: mvc, btc, opcat.'),
        };
    }
    const normalized = fileChain.trim().toLowerCase();
    if (normalized !== 'mvc' && normalized !== 'btc' && normalized !== 'opcat') {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('invalid_flag', `Unsupported --file-chain value: ${fileChain}. Supported values: mvc, btc, opcat. DOGE is not supported for file upload.`),
        };
    }
    return { ok: true, fileChain: normalized };
}
function parseLoomScore(args) {
    const rawScore = (0, helpers_1.readFlagValue)(args, '--score');
    if (!rawScore || rawScore.startsWith('--')) {
        return { ok: false, result: (0, helpers_1.commandMissingFlag)('--score') };
    }
    if (!['1', '2', '3', '4', '5'].includes(rawScore)) {
        return { ok: false, result: (0, commandResult_1.commandFailed)('invalid_flag', '--score must be an integer from 1 to 5.') };
    }
    const score = Number(rawScore);
    return { ok: true, score };
}
function readTaskPinIdArgument(args) {
    return args.slice(1).find((arg) => !arg.startsWith('-'));
}
function commandInvalidPayload(protocol, validation) {
    return {
        ok: false,
        state: 'failed',
        code: 'invalid_payload',
        message: `Invalid loom ${protocol} payload.`,
        data: {
            validation,
        },
    };
}
function resolveOutPath(context, outPath) {
    return node_path_1.default.isAbsolute(outPath) ? outPath : node_path_1.default.resolve(context.cwd, outPath);
}
function resolveInputPath(context, filePath) {
    return node_path_1.default.isAbsolute(filePath) ? filePath : node_path_1.default.resolve(context.cwd, filePath);
}
function parseOptionalLimit(args) {
    const hasLimitFlag = args.includes('--limit');
    const rawLimit = (0, helpers_1.readFlagValue)(args, '--limit');
    if (!hasLimitFlag) {
        return { ok: true };
    }
    if (rawLimit === null) {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.'),
        };
    }
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit <= 0) {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be a positive integer.'),
        };
    }
    return { ok: true, limit };
}
function parseOptionalCurrency(args) {
    const hasCurrencyFlag = args.includes('--currency');
    const currency = (0, helpers_1.readFlagValue)(args, '--currency');
    if (!hasCurrencyFlag) {
        return { ok: true };
    }
    if (currency === null) {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('invalid_flag', '--currency must be one of SPACE, BTC, DOGE, or OPCAT.'),
        };
    }
    if (!['SPACE', 'BTC', 'DOGE', 'OPCAT'].includes(currency)) {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('invalid_flag', '--currency must be one of SPACE, BTC, DOGE, or OPCAT.'),
        };
    }
    return { ok: true, currency };
}
const LOOM_DASHBOARD_STATE_FILTERS = new Set([
    'open',
    'claimed',
    'in_progress',
    'delivered',
    'revision_needed',
    'rejected',
    'accepted_paid',
    'failed',
    'working',
    'review',
    'revision',
    'closed',
]);
function parseOptionalDashboardRole(args) {
    const hasRoleFlag = args.includes('--role');
    const role = (0, helpers_1.readFlagValue)(args, '--role');
    if (!hasRoleFlag) {
        return { ok: true };
    }
    if (role !== 'all'
        && role !== 'requester'
        && role !== 'developer'
        && role !== 'needs_action') {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('invalid_flag', '--role must be one of all, requester, developer, or needs_action.'),
        };
    }
    return { ok: true, role };
}
function parseOptionalDashboardState(args) {
    const stateInput = readOptionalValue(args, '--state');
    if (!stateInput.ok) {
        return stateInput;
    }
    if (!stateInput.value) {
        return { ok: true };
    }
    if (!LOOM_DASHBOARD_STATE_FILTERS.has(stateInput.value)) {
        return {
            ok: false,
            result: (0, commandResult_1.commandFailed)('invalid_flag', '--state must be one of open, claimed, in_progress, delivered, revision_needed, rejected, accepted_paid, failed, working, review, revision, or closed.'),
        };
    }
    return { ok: true, state: stateInput.value };
}
function invalidJsonValidation(protocol, message) {
    return {
        valid: false,
        protocol,
        path: loom_1.LOOM_PROTOCOLS[protocol].path,
        errors: [
            {
                path: '',
                code: 'invalid_json',
                message,
            },
        ],
    };
}
async function readLoomPayloadFile(context, protocol, payloadFile) {
    const raw = await context.readTextFile(resolveInputPath(context, payloadFile));
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        return {
            ok: false,
            validation: invalidJsonValidation(protocol, error instanceof Error ? error.message : 'payload file must contain valid JSON.'),
        };
    }
    const validation = (0, loom_1.validateLoomPayload)(protocol, parsed);
    if (!validation.valid) {
        return {
            ok: false,
            validation,
        };
    }
    return {
        ok: true,
        payload: parsed,
    };
}
async function readProtocolAndPayload(args, context) {
    const protocol = (0, helpers_1.readFlagValue)(args, '--protocol');
    if (!protocol) {
        return { ok: false, result: (0, helpers_1.commandMissingFlag)('--protocol') };
    }
    if (!(0, loom_1.isLoomProtocolName)(protocol)) {
        return { ok: false, result: commandInvalidProtocol(protocol) };
    }
    const payloadFile = (0, helpers_1.readFlagValue)(args, '--payload-file');
    if (!payloadFile) {
        return { ok: false, result: (0, helpers_1.commandMissingFlag)('--payload-file') };
    }
    const payload = await readLoomPayloadFile(context, protocol, payloadFile);
    if (!payload.ok) {
        return { ok: false, result: commandInvalidPayload(protocol, payload.validation) };
    }
    return {
        ok: true,
        protocol,
        payload: payload.payload,
    };
}
async function runValidateCommand(args, context) {
    const unsupportedFlag = rejectChainWriteFlags(args);
    if (unsupportedFlag) {
        return unsupportedFlag;
    }
    const input = await readProtocolAndPayload(args, context);
    if (!input.ok) {
        return input.result;
    }
    const validation = (0, loom_1.validateLoomPayload)(input.protocol, input.payload);
    if (!validation.valid) {
        return commandInvalidPayload(input.protocol, validation);
    }
    return (0, commandResult_1.commandSuccess)({
        protocol: input.protocol,
        path: validation.path,
        valid: true,
        payload: input.payload,
    });
}
async function runExportChainRequestCommand(args, context) {
    const unsupportedFlag = rejectChainWriteFlags(args);
    if (unsupportedFlag) {
        return unsupportedFlag;
    }
    const input = await readProtocolAndPayload(args, context);
    if (!input.ok) {
        return input.result;
    }
    const result = (0, loom_1.buildLoomChainWriteRequest)(input.protocol, input.payload);
    if (!result.request) {
        return commandInvalidPayload(input.protocol, result.validation);
    }
    const out = (0, helpers_1.readFlagValue)(args, '--out');
    if (!out) {
        return (0, commandResult_1.commandSuccess)({
            protocol: input.protocol,
            path: result.request.path,
            request: result.request,
        });
    }
    const outPath = resolveOutPath(context, out);
    await node_fs_1.promises.writeFile(outPath, `${JSON.stringify(result.request, null, 2)}\n`, 'utf8');
    return (0, commandResult_1.commandSuccess)({
        outPath,
        protocol: input.protocol,
        path: result.request.path,
    });
}
async function runSyncCommand(args, context) {
    const limit = parseOptionalLimit(args);
    if (!limit.ok) {
        return limit.result;
    }
    const input = {};
    if (limit.limit !== undefined) {
        input.limit = limit.limit;
    }
    return context.dependencies.loom?.sync?.(input)
        ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom sync dependency is unavailable.');
}
async function runListCommand(args, context) {
    const limit = parseOptionalLimit(args);
    if (!limit.ok) {
        return limit.result;
    }
    const currency = parseOptionalCurrency(args);
    if (!currency.ok) {
        return currency.result;
    }
    const input = {
        refresh: (0, helpers_1.hasFlag)(args, '--refresh'),
    };
    const tag = (0, helpers_1.readFlagValue)(args, '--tag');
    if (limit.limit !== undefined) {
        input.limit = limit.limit;
    }
    if (tag !== null) {
        input.tag = tag;
    }
    if (currency.currency !== undefined) {
        input.currency = currency.currency;
    }
    return context.dependencies.loom?.list?.(input)
        ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom list dependency is unavailable.');
}
async function runShowCommand(args, context) {
    const taskPinId = args.slice(1).find((arg) => !arg.startsWith('-'));
    if (!taskPinId) {
        return commandMissingArgument('taskPinId');
    }
    return context.dependencies.loom?.show?.({
        taskPinId,
        refresh: (0, helpers_1.hasFlag)(args, '--refresh'),
    }) ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom show dependency is unavailable.');
}
async function runDashboardCommand(args, context) {
    const limit = parseOptionalLimit(args);
    if (!limit.ok) {
        return limit.result;
    }
    const role = parseOptionalDashboardRole(args);
    if (!role.ok) {
        return role.result;
    }
    const fromInput = readOptionalValue(args, '--from');
    if (!fromInput.ok) {
        return fromInput.result;
    }
    const state = parseOptionalDashboardState(args);
    if (!state.ok) {
        return state.result;
    }
    const queryInput = readOptionalValue(args, '--query');
    if (!queryInput.ok) {
        return queryInput.result;
    }
    const input = {
        refresh: (0, helpers_1.hasFlag)(args, '--refresh'),
    };
    if (fromInput.value)
        input.from = fromInput.value;
    if (limit.limit !== undefined)
        input.limit = limit.limit;
    if (state.state)
        input.state = state.state;
    if (role.role)
        input.role = role.role;
    if (queryInput.value)
        input.query = queryInput.value;
    return context.dependencies.loom?.dashboard?.(input)
        ?? (0, commandResult_1.commandFailed)('not_implemented', 'Loom dashboard handler is not configured.');
}
async function runDraftTaskCommand(args, context) {
    const wish = (0, helpers_1.readFlagValue)(args, '--wish');
    if (!wish || wish.startsWith('--')) {
        return (0, helpers_1.commandMissingFlag)('--wish');
    }
    const from = (0, helpers_1.readFlagValue)(args, '--from');
    if (args.includes('--from') && (!from || from.startsWith('--'))) {
        return (0, commandResult_1.commandFailed)('invalid_flag', '--from requires a bot slug value.');
    }
    const input = {
        wish,
        allowInvalid: (0, helpers_1.hasFlag)(args, '--allow-invalid'),
    };
    if (from) {
        input.from = from;
    }
    return context.dependencies.loom?.draftTask?.(input)
        ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom draft-task dependency is unavailable.');
}
async function runPostTaskCommand(args, context) {
    const payloadFileInput = readOptionalValue(args, '--payload-file');
    if (!payloadFileInput.ok) {
        return payloadFileInput.result;
    }
    const wishInput = readOptionalValue(args, '--wish');
    if (!wishInput.ok) {
        return wishInput.result;
    }
    if (!payloadFileInput.value && !wishInput.value) {
        return (0, helpers_1.commandMissingFlag)('--payload-file or --wish');
    }
    if (payloadFileInput.value && wishInput.value) {
        return (0, commandResult_1.commandFailed)('invalid_flag', 'Use exactly one of --payload-file or --wish.');
    }
    const fromInput = readOptionalValue(args, '--from');
    if (!fromInput.ok) {
        return fromInput.result;
    }
    const chainInput = readOptionalChain(args);
    if (!chainInput.ok) {
        return chainInput.result;
    }
    const input = {
        dryRun: (0, helpers_1.hasFlag)(args, '--dry-run'),
    };
    if (fromInput.value)
        input.from = fromInput.value;
    if (payloadFileInput.value)
        input.payloadFile = payloadFileInput.value;
    if (wishInput.value)
        input.wish = wishInput.value;
    if (chainInput.chain)
        input.chain = chainInput.chain;
    return context.dependencies.loom?.postTask?.(input)
        ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom post-task dependency is unavailable.');
}
async function runClaimAndStartCommand(args, context) {
    const taskPinIdInput = readRequiredValue(args, '--task-pin-id');
    if (!taskPinIdInput.ok)
        return taskPinIdInput.result;
    const payoutAddressInput = readOptionalValue(args, '--payout-address');
    if (!payoutAddressInput.ok)
        return payoutAddressInput.result;
    const claimPinIdInput = readOptionalValue(args, '--claim-pin-id');
    if (!claimPinIdInput.ok)
        return claimPinIdInput.result;
    if (!payoutAddressInput.value && !claimPinIdInput.value) {
        return (0, helpers_1.commandMissingFlag)('--payout-address or --claim-pin-id');
    }
    if (payoutAddressInput.value && claimPinIdInput.value) {
        return (0, commandResult_1.commandFailed)('invalid_flag', 'Use exactly one of --payout-address or --claim-pin-id.');
    }
    const fromInput = readOptionalValue(args, '--from');
    if (!fromInput.ok)
        return fromInput.result;
    const messageInput = readOptionalValue(args, '--message');
    if (!messageInput.ok)
        return messageInput.result;
    const chainInput = readOptionalChain(args);
    if (!chainInput.ok)
        return chainInput.result;
    const fileChainInput = readOptionalFileChain(args);
    if (!fileChainInput.ok)
        return fileChainInput.result;
    const input = {
        taskPinId: taskPinIdInput.value,
        dryRun: (0, helpers_1.hasFlag)(args, '--dry-run'),
        resetWorkspace: (0, helpers_1.hasFlag)(args, '--reset-workspace'),
    };
    if (fromInput.value)
        input.from = fromInput.value;
    if (payoutAddressInput.value)
        input.payoutAddress = payoutAddressInput.value;
    if (claimPinIdInput.value)
        input.claimPinId = claimPinIdInput.value;
    if (chainInput.chain)
        input.chain = chainInput.chain;
    if (fileChainInput.fileChain)
        input.fileChain = fileChainInput.fileChain;
    if (messageInput.value)
        input.message = messageInput.value;
    return context.dependencies.loom?.claimAndStart?.(input)
        ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom claim-and-start dependency is unavailable.');
}
async function runDevRoundCommand(args, context) {
    const taskPinIdInput = readRequiredValue(args, '--task-pin-id');
    if (!taskPinIdInput.ok)
        return taskPinIdInput.result;
    const claimPinIdInput = readRequiredValue(args, '--claim-pin-id');
    if (!claimPinIdInput.ok)
        return claimPinIdInput.result;
    const fromInput = readOptionalValue(args, '--from');
    if (!fromInput.ok)
        return fromInput.result;
    const roundNoteInput = readOptionalValue(args, '--round-note');
    if (!roundNoteInput.ok)
        return roundNoteInput.result;
    const chainInput = readOptionalChain(args);
    if (!chainInput.ok)
        return chainInput.result;
    const fileChainInput = readOptionalFileChain(args);
    if (!fileChainInput.ok)
        return fileChainInput.result;
    const checksInput = readAllFlagValues(args, '--check');
    if (!checksInput.ok)
        return checksInput.result;
    const input = {
        taskPinId: taskPinIdInput.value,
        claimPinId: claimPinIdInput.value,
        checks: checksInput.values,
    };
    if (fromInput.value)
        input.from = fromInput.value;
    if (chainInput.chain)
        input.chain = chainInput.chain;
    if (fileChainInput.fileChain)
        input.fileChain = fileChainInput.fileChain;
    if (roundNoteInput.value)
        input.roundNote = roundNoteInput.value;
    return context.dependencies.loom?.runDevRound?.(input)
        ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom run-dev-round dependency is unavailable.');
}
async function runDeliverCommand(args, context) {
    const taskPinIdInput = readRequiredValue(args, '--task-pin-id');
    if (!taskPinIdInput.ok)
        return taskPinIdInput.result;
    const claimPinIdInput = readRequiredValue(args, '--claim-pin-id');
    if (!claimPinIdInput.ok)
        return claimPinIdInput.result;
    const fromInput = readOptionalValue(args, '--from');
    if (!fromInput.ok)
        return fromInput.result;
    const prTitleInput = readOptionalValue(args, '--pr-title');
    if (!prTitleInput.ok)
        return prTitleInput.result;
    const deliverySummaryInput = readOptionalValue(args, '--delivery-summary');
    if (!deliverySummaryInput.ok)
        return deliverySummaryInput.result;
    const chainInput = readOptionalChain(args);
    if (!chainInput.ok)
        return chainInput.result;
    const input = {
        taskPinId: taskPinIdInput.value,
        claimPinId: claimPinIdInput.value,
        dryRun: (0, helpers_1.hasFlag)(args, '--dry-run'),
    };
    if (fromInput.value)
        input.from = fromInput.value;
    if (chainInput.chain)
        input.chain = chainInput.chain;
    if (prTitleInput.value)
        input.prTitle = prTitleInput.value;
    if (deliverySummaryInput.value)
        input.deliverySummary = deliverySummaryInput.value;
    return context.dependencies.loom?.deliver?.(input)
        ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom deliver dependency is unavailable.');
}
async function runAcceptAndPayCommand(args, context) {
    const taskPinIdInput = readRequiredValue(args, '--task-pin-id');
    if (!taskPinIdInput.ok)
        return taskPinIdInput.result;
    const deliveryPinIdInput = readRequiredValue(args, '--delivery-pin-id');
    if (!deliveryPinIdInput.ok)
        return deliveryPinIdInput.result;
    const scoreInput = parseLoomScore(args);
    if (!scoreInput.ok)
        return scoreInput.result;
    const commentInput = readRequiredValue(args, '--comment');
    if (!commentInput.ok)
        return commentInput.result;
    const fromInput = readOptionalValue(args, '--from');
    if (!fromInput.ok)
        return fromInput.result;
    const chainInput = readOptionalChain(args);
    if (!chainInput.ok)
        return chainInput.result;
    const input = {
        taskPinId: taskPinIdInput.value,
        deliveryPinId: deliveryPinIdInput.value,
        score: scoreInput.score,
        comment: commentInput.value,
        confirmPayment: (0, helpers_1.hasFlag)(args, '--confirm-payment'),
    };
    if (fromInput.value)
        input.from = fromInput.value;
    if (chainInput.chain)
        input.chain = chainInput.chain;
    return context.dependencies.loom?.acceptAndPay?.(input)
        ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom accept-and-pay dependency is unavailable.');
}
async function runReviewDeliveryCommand(args, context) {
    const taskPinIdInput = readRequiredValue(args, '--task-pin-id');
    if (!taskPinIdInput.ok)
        return taskPinIdInput.result;
    const deliveryPinIdInput = readRequiredValue(args, '--delivery-pin-id');
    if (!deliveryPinIdInput.ok)
        return deliveryPinIdInput.result;
    const verdictInput = readRequiredValue(args, '--verdict');
    if (!verdictInput.ok)
        return verdictInput.result;
    if (verdictInput.value !== 'rejected' && verdictInput.value !== 'revision_needed') {
        return (0, commandResult_1.commandFailed)('invalid_flag', '--verdict must be rejected or revision_needed.');
    }
    const scoreInput = parseLoomScore(args);
    if (!scoreInput.ok)
        return scoreInput.result;
    const commentInput = readRequiredValue(args, '--comment');
    if (!commentInput.ok)
        return commentInput.result;
    const fromInput = readOptionalValue(args, '--from');
    if (!fromInput.ok)
        return fromInput.result;
    const chainInput = readOptionalChain(args);
    if (!chainInput.ok)
        return chainInput.result;
    const attachmentsInput = readAllFlagValues(args, '--attachment');
    if (!attachmentsInput.ok)
        return attachmentsInput.result;
    const input = {
        taskPinId: taskPinIdInput.value,
        deliveryPinId: deliveryPinIdInput.value,
        verdict: verdictInput.value,
        score: scoreInput.score,
        comment: commentInput.value,
        attachments: attachmentsInput.values,
    };
    if (fromInput.value)
        input.from = fromInput.value;
    if (chainInput.chain)
        input.chain = chainInput.chain;
    return context.dependencies.loom?.reviewDelivery?.(input)
        ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom review-delivery dependency is unavailable.');
}
async function runStateCommand(args, context) {
    const taskPinId = readTaskPinIdArgument(args);
    if (!taskPinId) {
        return commandMissingArgument('taskPinId');
    }
    return context.dependencies.loom?.state?.({
        taskPinId,
        refresh: (0, helpers_1.hasFlag)(args, '--refresh'),
    }) ?? (0, commandResult_1.commandFailed)('dependency_unavailable', 'Loom state dependency is unavailable.');
}
async function runLoomCommand(args, context) {
    switch (args[0]) {
        case 'validate':
            return runValidateCommand(args, context);
        case 'export-chain-request':
            return runExportChainRequestCommand(args, context);
        case 'sync':
            return runSyncCommand(args, context);
        case 'list':
            return runListCommand(args, context);
        case 'show':
            return runShowCommand(args, context);
        case 'dashboard':
            return runDashboardCommand(args, context);
        case 'draft-task':
            return runDraftTaskCommand(args, context);
        case 'post-task':
            return runPostTaskCommand(args, context);
        case 'claim-and-start':
            return runClaimAndStartCommand(args, context);
        case 'run-dev-round':
            return runDevRoundCommand(args, context);
        case 'deliver':
            return runDeliverCommand(args, context);
        case 'accept-and-pay':
            return runAcceptAndPayCommand(args, context);
        case 'review-delivery':
            return runReviewDeliveryCommand(args, context);
        case 'state':
            return runStateCommand(args, context);
        default:
            return (0, helpers_1.commandUnknownSubcommand)(`loom ${args.join(' ')}`.trim());
    }
}
