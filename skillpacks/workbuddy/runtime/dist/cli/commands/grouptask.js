"use strict";
/**
 * `metabot grouptask …` — Group Task verbs. Each subcommand parses flags and
 * delegates to context.dependencies.grouptask, which the runtime wires to the
 * daemon's /api/grouptask/* routes (the daemon is the single store writer).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runGroupTaskCommand = runGroupTaskCommand;
const commandResult_1 = require("../../core/contracts/commandResult");
const helpers_1 = require("./helpers");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readCsvFlag(args, flag) {
    const raw = (0, helpers_1.readFlagValue)(args, flag);
    if (!raw)
        return [];
    return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}
function readIntFlag(args, flag) {
    const raw = (0, helpers_1.readFlagValue)(args, flag);
    if (raw === null)
        return undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : 'invalid';
}
function requireHandler(context, key) {
    const handler = context.dependencies.grouptask?.[key];
    return (handler ?? null);
}
/** Common `--chair <slug> --task <id>` pair used by most verbs. */
function readTaskRefFlags(args) {
    const chair = normalizeText((0, helpers_1.readFlagValue)(args, '--chair'));
    if (!chair)
        return (0, helpers_1.commandMissingFlag)('--chair');
    const taskId = readIntFlag(args, '--task');
    if (taskId === undefined)
        return (0, helpers_1.commandMissingFlag)('--task');
    if (taskId === 'invalid' || taskId <= 0) {
        return (0, commandResult_1.commandFailed)('invalid_flag', '--task must be a positive integer task id.');
    }
    return { chair, taskId };
}
function isFailure(value) {
    return 'ok' in value;
}
async function runGroupTaskCommand(args, context) {
    const action = normalizeText(args[0]);
    if (action === 'create') {
        const handler = requireHandler(context, 'create');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task create handler is not configured.');
        const title = normalizeText((0, helpers_1.readFlagValue)(args, '--title'));
        if (!title)
            return (0, helpers_1.commandMissingFlag)('--title');
        const goal = normalizeText((0, helpers_1.readFlagValue)(args, '--goal'));
        if (!goal)
            return (0, helpers_1.commandMissingFlag)('--goal');
        return handler({
            title,
            goal,
            acceptanceCriteria: normalizeText((0, helpers_1.readFlagValue)(args, '--acceptance')) || undefined,
            workerSlugs: readCsvFlag(args, '--workers'),
            chairSlug: normalizeText((0, helpers_1.readFlagValue)(args, '--chair')) || undefined,
        });
    }
    if (action === 'list') {
        const handler = requireHandler(context, 'list');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task list handler is not configured.');
        const tab = normalizeText((0, helpers_1.readFlagValue)(args, '--tab')) || 'all';
        if (!['active', 'done', 'cancelled', 'all'].includes(tab)) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--tab must be one of: active, done, cancelled, all.');
        }
        return handler({
            tab,
            includeArchived: (0, helpers_1.hasFlag)(args, '--include-archived'),
        });
    }
    if (action === 'detail') {
        const handler = requireHandler(context, 'detail');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task detail handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        return handler({
            ...ref,
            view: normalizeText((0, helpers_1.readFlagValue)(args, '--view')) || undefined,
            sync: (0, helpers_1.hasFlag)(args, '--no-sync') ? false : undefined,
        });
    }
    if (action === 'messages') {
        const handler = requireHandler(context, 'messages');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task messages handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        const limit = readIntFlag(args, '--limit');
        if (limit === 'invalid')
            return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be an integer.');
        const beforeIndex = readIntFlag(args, '--before-index');
        if (beforeIndex === 'invalid')
            return (0, commandResult_1.commandFailed)('invalid_flag', '--before-index must be an integer.');
        return handler({
            ...ref,
            limit,
            beforeIndex,
            sync: (0, helpers_1.hasFlag)(args, '--no-sync') ? false : undefined,
        });
    }
    if (action === 'post') {
        const handler = requireHandler(context, 'postMessage');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task post handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        const content = normalizeText((0, helpers_1.readFlagValue)(args, '--content'));
        if (!content)
            return (0, helpers_1.commandMissingFlag)('--content');
        const asSlug = normalizeText((0, helpers_1.readFlagValue)(args, '--as'));
        const asOwner = (0, helpers_1.hasFlag)(args, '--as-owner');
        if (asSlug && asOwner) {
            return (0, commandResult_1.commandFailed)('invalid_flag', '--as and --as-owner are mutually exclusive.');
        }
        return handler({
            ...ref,
            content,
            asSlug: asSlug || undefined,
            asOwner: asOwner || undefined,
            replyPin: normalizeText((0, helpers_1.readFlagValue)(args, '--reply-pin')) || undefined,
            mention: readCsvFlag(args, '--mention'),
        });
    }
    if (action === 'close') {
        const handler = requireHandler(context, 'close');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task close handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        const outcome = normalizeText((0, helpers_1.readFlagValue)(args, '--outcome'));
        if (outcome !== 'done' && outcome !== 'cancelled') {
            return (0, commandResult_1.commandFailed)('invalid_flag', "--outcome must be 'done' or 'cancelled'.");
        }
        const rating = readIntFlag(args, '--rating');
        if (rating === 'invalid')
            return (0, commandResult_1.commandFailed)('invalid_flag', '--rating must be an integer between 1 and 5.');
        return handler({
            ...ref,
            outcome,
            rating,
            ratingComment: normalizeText((0, helpers_1.readFlagValue)(args, '--comment')) || undefined,
            reason: normalizeText((0, helpers_1.readFlagValue)(args, '--reason')) || undefined,
        });
    }
    if (action === 'reopen') {
        const handler = requireHandler(context, 'reopen');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task reopen handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        return handler({
            ...ref,
            reason: normalizeText((0, helpers_1.readFlagValue)(args, '--reason')) || undefined,
        });
    }
    if (action === 'kick') {
        const handler = requireHandler(context, 'kickMember');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task kick handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        const slug = normalizeText((0, helpers_1.readFlagValue)(args, '--member'));
        const globalMetaId = normalizeText((0, helpers_1.readFlagValue)(args, '--global-metaid'));
        if (!slug && !globalMetaId) {
            return (0, commandResult_1.commandFailed)('invalid_flag', 'kick requires --member <slug> or --global-metaid <id>.');
        }
        return handler({
            ...ref,
            slug: slug || undefined,
            globalMetaId: globalMetaId || undefined,
            reason: normalizeText((0, helpers_1.readFlagValue)(args, '--reason')) || undefined,
        });
    }
    if (action === 'member-status') {
        const handler = requireHandler(context, 'setMemberStatus');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task member-status handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        const status = normalizeText((0, helpers_1.readFlagValue)(args, '--status'));
        if (!status)
            return (0, helpers_1.commandMissingFlag)('--status');
        const slug = normalizeText((0, helpers_1.readFlagValue)(args, '--member'));
        const globalMetaId = normalizeText((0, helpers_1.readFlagValue)(args, '--global-metaid'));
        if (!slug && !globalMetaId) {
            return (0, commandResult_1.commandFailed)('invalid_flag', 'member-status requires --member <slug> or --global-metaid <id>.');
        }
        return handler({
            ...ref,
            status,
            slug: slug || undefined,
            globalMetaId: globalMetaId || undefined,
        });
    }
    if (action === 'rename') {
        const handler = requireHandler(context, 'rename');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task rename handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        const name = (0, helpers_1.readFlagValue)(args, '--name');
        if (name === null)
            return (0, helpers_1.commandMissingFlag)('--name');
        return handler({ ...ref, displayName: name });
    }
    if (action === 'pin' || action === 'unpin') {
        const handler = requireHandler(context, 'setPinned');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task pin handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        return handler({ ...ref, pinned: action === 'pin' });
    }
    if (action === 'archive' || action === 'unarchive') {
        const handler = requireHandler(context, 'setArchived');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task archive handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        return handler({ ...ref, archived: action === 'archive' });
    }
    if (action === 'invite') {
        const handler = requireHandler(context, 'invite');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task invite handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        const globalMetaId = normalizeText((0, helpers_1.readFlagValue)(args, '--global-metaid'));
        if (!globalMetaId)
            return (0, helpers_1.commandMissingFlag)('--global-metaid');
        return handler({
            ...ref,
            globalMetaId,
            name: normalizeText((0, helpers_1.readFlagValue)(args, '--name')) || undefined,
            requiredSkills: readCsvFlag(args, '--skills'),
            allowReinvite: (0, helpers_1.hasFlag)(args, '--allow-reinvite') || undefined,
        });
    }
    if (action === 'invites') {
        const handler = requireHandler(context, 'invites');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task invites handler is not configured.');
        const ref = readTaskRefFlags(args);
        if (isFailure(ref))
            return ref;
        return handler({ ...ref });
    }
    if (action === 'collabs') {
        const handler = requireHandler(context, 'collabs');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task collabs handler is not configured.');
        return handler({});
    }
    if (action === 'collab-messages') {
        const handler = requireHandler(context, 'collabMessages');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task collab-messages handler is not configured.');
        const slug = normalizeText((0, helpers_1.readFlagValue)(args, '--bot'));
        if (!slug)
            return (0, helpers_1.commandMissingFlag)('--bot');
        const groupId = normalizeText((0, helpers_1.readFlagValue)(args, '--group'));
        if (!groupId)
            return (0, helpers_1.commandMissingFlag)('--group');
        const limit = readIntFlag(args, '--limit');
        if (limit === 'invalid')
            return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be an integer.');
        return handler({ slug, groupId, limit });
    }
    if (action === 'health') {
        const handler = requireHandler(context, 'health');
        if (!handler)
            return (0, commandResult_1.commandFailed)('not_implemented', 'Group task health handler is not configured.');
        return handler({});
    }
    if (action === 'staffing') {
        const sub = normalizeText(args[1]);
        if (sub === 'propose') {
            const handler = requireHandler(context, 'staffingPropose');
            if (!handler)
                return (0, commandResult_1.commandFailed)('not_implemented', 'Staffing propose handler is not configured.');
            const title = normalizeText((0, helpers_1.readFlagValue)(args, '--title'));
            if (!title)
                return (0, helpers_1.commandMissingFlag)('--title');
            const goal = normalizeText((0, helpers_1.readFlagValue)(args, '--goal'));
            if (!goal)
                return (0, helpers_1.commandMissingFlag)('--goal');
            const planJson = normalizeText((0, helpers_1.readFlagValue)(args, '--plan'));
            if (!planJson)
                return (0, helpers_1.commandMissingFlag)('--plan');
            let plan;
            try {
                plan = JSON.parse(planJson);
            }
            catch {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--plan must be a JSON object: {"stages":[…],"seats":[…]}');
            }
            return handler({
                title,
                goal,
                acceptanceCriteria: normalizeText((0, helpers_1.readFlagValue)(args, '--acceptance')) || undefined,
                plan,
                triggeringWish: normalizeText((0, helpers_1.readFlagValue)(args, '--wish')) || undefined,
                sourceSessionId: normalizeText((0, helpers_1.readFlagValue)(args, '--session')) || undefined,
                chairSlug: normalizeText((0, helpers_1.readFlagValue)(args, '--chair')) || undefined,
                language: normalizeText((0, helpers_1.readFlagValue)(args, '--lang')) || undefined,
            });
        }
        if (sub === 'list') {
            const handler = requireHandler(context, 'staffingList');
            if (!handler)
                return (0, commandResult_1.commandFailed)('not_implemented', 'Staffing list handler is not configured.');
            return handler({
                chairSlug: normalizeText((0, helpers_1.readFlagValue)(args, '--chair')) || undefined,
            });
        }
        if (sub === 'decide') {
            const handler = requireHandler(context, 'staffingDecide');
            if (!handler)
                return (0, commandResult_1.commandFailed)('not_implemented', 'Staffing decide handler is not configured.');
            const chair = normalizeText((0, helpers_1.readFlagValue)(args, '--chair'));
            if (!chair)
                return (0, helpers_1.commandMissingFlag)('--chair');
            const proposalId = readIntFlag(args, '--proposal');
            if (proposalId === 'invalid' || typeof proposalId !== 'number' || proposalId <= 0) {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--proposal must be a positive integer.');
            }
            const decision = normalizeText((0, helpers_1.readFlagValue)(args, '--decision'));
            if (!['confirm', 'revise', 'skip'].includes(decision)) {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--decision must be one of: confirm, revise, skip.');
            }
            return handler({ chairSlug: chair, proposalId, decision });
        }
        if (sub === 'create') {
            const handler = requireHandler(context, 'staffingCreate');
            if (!handler)
                return (0, commandResult_1.commandFailed)('not_implemented', 'Staffing create handler is not configured.');
            const proposalId = readIntFlag(args, '--proposal');
            if (proposalId === 'invalid' || typeof proposalId !== 'number' || proposalId <= 0) {
                return (0, commandResult_1.commandFailed)('invalid_flag', '--proposal must be a positive integer.');
            }
            return handler({
                proposalId,
                chairSlug: normalizeText((0, helpers_1.readFlagValue)(args, '--chair')) || undefined,
            });
        }
        if (sub === 'search') {
            const handler = requireHandler(context, 'staffingSearch');
            if (!handler)
                return (0, commandResult_1.commandFailed)('not_implemented', 'Staffing search handler is not configured.');
            const seat = normalizeText((0, helpers_1.readFlagValue)(args, '--seat'));
            const query = normalizeText((0, helpers_1.readFlagValue)(args, '--query'));
            if (!seat && !query) {
                return (0, commandResult_1.commandFailed)('invalid_flag', 'either --seat <role> or --query <text> is required.');
            }
            const limit = readIntFlag(args, '--limit');
            if (limit === 'invalid')
                return (0, commandResult_1.commandFailed)('invalid_flag', '--limit must be an integer.');
            return handler({
                seat: seat || undefined,
                query: query || undefined,
                domainLabel: normalizeText((0, helpers_1.readFlagValue)(args, '--domain')) || undefined,
                skills: readCsvFlag(args, '--skills'),
                limit: typeof limit === 'number' ? limit : undefined,
            });
        }
        return (0, helpers_1.commandUnknownSubcommand)(`grouptask staffing ${args.slice(1).join(' ')}`.trim());
    }
    return (0, helpers_1.commandUnknownSubcommand)(`grouptask ${args.join(' ')}`.trim());
}
