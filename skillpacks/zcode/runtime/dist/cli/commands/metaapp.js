"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMetaAppCommand = runMetaAppCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function readRequiredFlag(args, flag) {
    const value = (0, helpers_1.readFlagValue)(args, flag);
    if (!value || value.startsWith('--')) {
        return { ok: false, result: (0, helpers_1.commandMissingFlag)(flag) };
    }
    return { ok: true, value };
}
function readOptionalFlag(args, flag) {
    const value = (0, helpers_1.readFlagValue)(args, flag);
    return value && !value.startsWith('--') ? value : undefined;
}
function readOptionalValueFlag(args, flag) {
    if (!args.includes(flag)) {
        return { ok: true };
    }
    const value = (0, helpers_1.readFlagValue)(args, flag);
    if (!value || value.startsWith('--')) {
        return { ok: false, result: commandInvalidFlag(`${flag} requires a value.`) };
    }
    return { ok: true, value };
}
function commandNotImplemented(command) {
    return (0, commandResult_1.commandFailed)('not_implemented', `MetaApp ${command} handler is not configured.`);
}
function commandInvalidFlag(message) {
    return (0, commandResult_1.commandFailed)('invalid_flag', message);
}
function confirmationRequired(message) {
    return (0, commandResult_1.commandFailed)('confirmation_required', message);
}
function migrationError(message) {
    return (0, commandResult_1.commandFailed)('invalid_flag', message);
}
function readPositiveIntegerFlag(args, flag, fallback) {
    const index = args.indexOf(flag);
    if (index === -1) {
        return { ok: true, value: fallback };
    }
    const raw = args[index + 1];
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
        return { ok: false, result: commandInvalidFlag(`${flag} must be a positive integer.`) };
    }
    return { ok: true, value: Number.parseInt(raw, 10) };
}
async function runMetaAppCommand(args, context) {
    const subcommand = args[0];
    if (subcommand === 'preview') {
        const projectDir = readRequiredFlag(args, '--project-dir');
        if (!projectDir.ok) {
            return projectDir.result;
        }
        const handler = context.dependencies.metaapp?.preview;
        if (!handler) {
            return commandNotImplemented('preview');
        }
        const manifestFile = readOptionalFlag(args, '--manifest-file');
        return handler({
            projectDir: projectDir.value,
            ...(manifestFile ? { manifestFile } : {}),
            open: (0, helpers_1.hasFlag)(args, '--open'),
        });
    }
    if (subcommand === 'list') {
        const size = readPositiveIntegerFlag(args, '--size', 12);
        if (!size.ok) {
            return size.result;
        }
        const handler = context.dependencies.metaapp?.list;
        if (!handler) {
            return commandNotImplemented('list');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        const cursor = readOptionalFlag(args, '--cursor');
        return handler({
            ...(from ? { from } : {}),
            size: size.value,
            ...(cursor ? { cursor } : {}),
        });
    }
    if (subcommand === 'publish') {
        if (args.includes('--project-dir')) {
            return migrationError('Use metabot metaapp publish-project for project-directory publishing. metabot metaapp publish now requires --payload-file.');
        }
        const payloadFile = readRequiredFlag(args, '--payload-file');
        if (!payloadFile.ok) {
            return payloadFile.result;
        }
        if (!(0, helpers_1.hasFlag)(args, '--confirm')) {
            return confirmationRequired('metabot metaapp publish requires --confirm.');
        }
        const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.metaapp?.publish;
        if (!handler) {
            return commandNotImplemented('publish');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        const payload = await (0, helpers_1.readJsonFile)(context, payloadFile.value);
        return handler({
            ...payload,
            ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            ...(from ? { from } : {}),
            confirm: true,
        });
    }
    if (subcommand === 'update') {
        if (args.includes('--project-dir')) {
            return migrationError('Use metabot metaapp update-project for project-directory publishing. metabot metaapp update now requires --payload-file.');
        }
        const targetPinId = readRequiredFlag(args, '--target-pin-id');
        if (!targetPinId.ok) {
            return targetPinId.result;
        }
        const payloadFile = readRequiredFlag(args, '--payload-file');
        if (!payloadFile.ok) {
            return payloadFile.result;
        }
        if (!(0, helpers_1.hasFlag)(args, '--confirm')) {
            return confirmationRequired('metabot metaapp update requires --confirm.');
        }
        const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.metaapp?.update;
        if (!handler) {
            return commandNotImplemented('update');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        const payload = await (0, helpers_1.readJsonFile)(context, payloadFile.value);
        return handler({
            ...payload,
            targetPinId: targetPinId.value,
            ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            ...(from ? { from } : {}),
            confirm: true,
        });
    }
    if (subcommand === 'delete') {
        const targetPinId = readRequiredFlag(args, '--target-pin-id');
        if (!targetPinId.ok) {
            return targetPinId.result;
        }
        if (!(0, helpers_1.hasFlag)(args, '--confirm')) {
            return confirmationRequired('metabot metaapp delete requires --confirm.');
        }
        const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.metaapp?.delete;
        if (!handler) {
            return commandNotImplemented('delete');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        return handler({
            targetPinId: targetPinId.value,
            ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            ...(from ? { from } : {}),
            confirm: true,
        });
    }
    if (subcommand === 'publish-project') {
        const projectDir = readRequiredFlag(args, '--project-dir');
        if (!projectDir.ok) {
            return projectDir.result;
        }
        const chainFlag = (0, helpers_1.readFileUploadChainFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.metaapp?.publishProject;
        if (!handler) {
            return commandNotImplemented('publish-project');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        const manifestFile = readOptionalFlag(args, '--manifest-file');
        return handler({
            projectDir: projectDir.value,
            ...(manifestFile ? { manifestFile } : {}),
            ...(from ? { from } : {}),
            ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            confirm: (0, helpers_1.hasFlag)(args, '--confirm'),
        });
    }
    if (subcommand === 'update-project') {
        const projectDir = readRequiredFlag(args, '--project-dir');
        if (!projectDir.ok) {
            return projectDir.result;
        }
        const targetPinId = readRequiredFlag(args, '--target-pin-id');
        if (!targetPinId.ok) {
            return targetPinId.result;
        }
        const chainFlag = (0, helpers_1.readFileUploadChainFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.metaapp?.updateProject;
        if (!handler) {
            return commandNotImplemented('update-project');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        const manifestFile = readOptionalFlag(args, '--manifest-file');
        return handler({
            projectDir: projectDir.value,
            targetPinId: targetPinId.value,
            ...(manifestFile ? { manifestFile } : {}),
            ...(from ? { from } : {}),
            ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            confirm: (0, helpers_1.hasFlag)(args, '--confirm'),
        });
    }
    if (subcommand === 'share') {
        const pinId = readRequiredFlag(args, '--pin-id');
        if (!pinId.ok) {
            return pinId.result;
        }
        const announce = (0, helpers_1.hasFlag)(args, '--announce');
        const chainFlag = announce ? (0, helpers_1.readChainWriteFlag)(args) : { chain: null, error: null };
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.metaapp?.share;
        if (!handler) {
            return commandNotImplemented('share');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        return handler({
            pinId: pinId.value,
            ...(from ? { from } : {}),
            ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            announce,
        });
    }
    if (subcommand === 'view') {
        const pinIdInput = readOptionalValueFlag(args, '--pin-id');
        if (!pinIdInput.ok) {
            return pinIdInput.result;
        }
        const firstPinIdInput = readOptionalValueFlag(args, '--first-pin-id');
        if (!firstPinIdInput.ok) {
            return firstPinIdInput.result;
        }
        const pinId = pinIdInput.value;
        const firstPinId = firstPinIdInput.value;
        const mine = (0, helpers_1.hasFlag)(args, '--mine');
        if (pinId && firstPinId) {
            return commandInvalidFlag('Use only one MetaApp selector: --pin-id or --first-pin-id.');
        }
        if (mine && (pinId || firstPinId)) {
            return commandInvalidFlag('Use --mine by itself; it cannot be combined with --pin-id or --first-pin-id.');
        }
        const handler = context.dependencies.metaapp?.view;
        if (!handler) {
            return commandNotImplemented('view');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        return handler({
            ...(pinId ? { pinId } : {}),
            ...(firstPinId ? { firstPinId } : {}),
            ...(from ? { from } : {}),
            mine,
        });
    }
    if (subcommand === 'comment') {
        const pinId = readRequiredFlag(args, '--pin-id');
        if (!pinId.ok) {
            return pinId.result;
        }
        const comment = readRequiredFlag(args, '--comment');
        if (!comment.ok) {
            return comment.result;
        }
        const chainFlag = (0, helpers_1.readChainWriteFlag)(args);
        if (chainFlag.error) {
            return chainFlag.error;
        }
        const handler = context.dependencies.metaapp?.comment;
        if (!handler) {
            return commandNotImplemented('comment');
        }
        const from = (0, helpers_1.readFromFlag)(args);
        return handler({
            pinId: pinId.value,
            ...(from ? { from } : {}),
            ...(chainFlag.chain ? { network: chainFlag.chain } : {}),
            comment: comment.value,
        });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`metaapp ${args.join(' ')}`.trim());
}
