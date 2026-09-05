"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runKnowledgeBaseCommand = runKnowledgeBaseCommand;
const node_fs_1 = require("node:fs");
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function requireKbHandler(context, key) {
    const handler = context.dependencies.knowledgeBase?.[key];
    if (!handler) {
        return (0, commandResult_1.commandFailed)('not_implemented', `Knowledge-base ${String(key)} handler is not configured.`);
    }
    return handler;
}
function isFailure(value) {
    return Boolean(value && typeof value === 'object' && value.ok === false);
}
function readOnOffFlag(args, flag) {
    const raw = (0, helpers_1.readFlagValue)(args, flag);
    if (raw === null)
        return undefined;
    const normalized = raw.trim().toLowerCase();
    if (['on', 'true', '1'].includes(normalized))
        return true;
    if (['off', 'false', '0'].includes(normalized))
        return false;
    return 'invalid';
}
function readNumberFlag(args, flag) {
    const raw = (0, helpers_1.readFlagValue)(args, flag);
    if (raw === null)
        return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 'invalid';
}
const SOURCE_TYPES = new Set(['web', 'metaweb', 'manual']);
async function readContentFlag(context, args) {
    const inline = (0, helpers_1.readFlagValue)(args, '--content');
    const file = (0, helpers_1.readFlagValue)(args, '--content-file');
    if (inline !== null && file !== null) {
        return (0, commandResult_1.commandFailed)('invalid_flag', 'Use either --content or --content-file, not both.');
    }
    if (inline !== null)
        return inline;
    if (file !== null) {
        try {
            return await node_fs_1.promises.readFile(file, 'utf8');
        }
        catch (error) {
            return (0, commandResult_1.commandFailed)('invalid_flag', `--content-file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return (0, helpers_1.commandMissingFlag)('--content or --content-file');
}
async function runKnowledgeBaseCommand(args, context) {
    const [subcommand] = args;
    const from = (0, helpers_1.readFromFlag)(args);
    if (subcommand === 'list') {
        const handler = requireKbHandler(context, 'list');
        if (isFailure(handler))
            return handler;
        return handler({ from });
    }
    if (subcommand === 'create') {
        const handler = requireKbHandler(context, 'create');
        if (isFailure(handler))
            return handler;
        const name = (0, helpers_1.readFlagValue)(args, '--name');
        if (!name?.trim())
            return (0, helpers_1.commandMissingFlag)('--name');
        const autoLearn = readOnOffFlag(args, '--autolearn');
        if (autoLearn === 'invalid') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--autolearn accepts on|off.');
        }
        return handler({
            from,
            name: name.trim(),
            ...((0, helpers_1.readFlagValue)(args, '--description')?.trim()
                ? { description: (0, helpers_1.readFlagValue)(args, '--description').trim() }
                : {}),
            ...((0, helpers_1.readFlagValue)(args, '--raw-dir')?.trim()
                ? { rawDir: (0, helpers_1.readFlagValue)(args, '--raw-dir').trim() }
                : {}),
            ...(autoLearn !== undefined ? { autoLearn } : {}),
        });
    }
    if (subcommand === 'update') {
        const handler = requireKbHandler(context, 'update');
        if (isFailure(handler))
            return handler;
        const id = (0, helpers_1.readFlagValue)(args, '--id');
        if (!id?.trim())
            return (0, helpers_1.commandMissingFlag)('--id');
        const autoLearn = readOnOffFlag(args, '--autolearn');
        if (autoLearn === 'invalid') {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--autolearn accepts on|off.');
        }
        return handler({
            from,
            id: id.trim(),
            ...((0, helpers_1.readFlagValue)(args, '--name')?.trim() ? { name: (0, helpers_1.readFlagValue)(args, '--name').trim() } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--description')?.trim()
                ? { description: (0, helpers_1.readFlagValue)(args, '--description').trim() }
                : {}),
            ...(autoLearn !== undefined ? { autoLearn } : {}),
        });
    }
    if (subcommand === 'remove') {
        const handler = requireKbHandler(context, 'remove');
        if (isFailure(handler))
            return handler;
        const id = (0, helpers_1.readFlagValue)(args, '--id');
        if (!id?.trim())
            return (0, helpers_1.commandMissingFlag)('--id');
        if (!(0, helpers_1.hasFlag)(args, '--confirm')) {
            return (0, commandResult_1.commandFailed)('missing_flag', 'Removing a knowledge base deletes its raw documents. Pass --confirm to proceed.');
        }
        return handler({ from, id: id.trim() });
    }
    if (subcommand === 'query') {
        const handler = requireKbHandler(context, 'query');
        if (isFailure(handler))
            return handler;
        const text = (0, helpers_1.readFlagValue)(args, '--text');
        if (!text?.trim())
            return (0, helpers_1.commandMissingFlag)('--text');
        const topK = readNumberFlag(args, '--top-k');
        if (topK === 'invalid')
            return (0, commandResult_1.commandFailed)('invalid_flag', '--top-k must be a number.');
        const minScore = readNumberFlag(args, '--min-score');
        if (minScore === 'invalid')
            return (0, commandResult_1.commandFailed)('invalid_flag', '--min-score must be a number.');
        return handler({
            from,
            text: text.trim(),
            ...((0, helpers_1.readFlagValue)(args, '--id')?.trim() ? { id: (0, helpers_1.readFlagValue)(args, '--id').trim() } : {}),
            ...(topK !== undefined ? { topK } : {}),
            ...(minScore !== undefined ? { minScore } : {}),
        });
    }
    if (subcommand === 'add-document') {
        const handler = requireKbHandler(context, 'addDocument');
        if (isFailure(handler))
            return handler;
        const title = (0, helpers_1.readFlagValue)(args, '--title');
        if (!title?.trim())
            return (0, helpers_1.commandMissingFlag)('--title');
        const content = await readContentFlag(context, args);
        if (typeof content !== 'string')
            return content;
        const sourceType = (0, helpers_1.readFlagValue)(args, '--source-type');
        if (sourceType !== null && !SOURCE_TYPES.has(sourceType.trim())) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--source-type accepts web|metaweb|manual.');
        }
        const tags = (0, helpers_1.readFlagValue)(args, '--tags');
        return handler({
            from,
            title: title.trim(),
            content,
            ...((0, helpers_1.readFlagValue)(args, '--id')?.trim() ? { id: (0, helpers_1.readFlagValue)(args, '--id').trim() } : {}),
            ...(sourceType?.trim() ? { sourceType: sourceType.trim() } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--url')?.trim() ? { url: (0, helpers_1.readFlagValue)(args, '--url').trim() } : {}),
            ...((0, helpers_1.readFlagValue)(args, '--pin-id')?.trim() ? { pinId: (0, helpers_1.readFlagValue)(args, '--pin-id').trim() } : {}),
            ...(tags?.trim() ? { tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) } : {}),
        });
    }
    if (subcommand === 'learn') {
        const handler = requireKbHandler(context, 'learn');
        if (isFailure(handler))
            return handler;
        return handler({
            from,
            ...((0, helpers_1.readFlagValue)(args, '--id')?.trim() ? { id: (0, helpers_1.readFlagValue)(args, '--id').trim() } : {}),
            full: (0, helpers_1.hasFlag)(args, '--full'),
        });
    }
    return (0, helpers_1.commandUnknownSubcommand)(`knowledge-base ${String(subcommand ?? '')}`.trim());
}
