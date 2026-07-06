"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROOT_COMMAND_HELP = void 0;
exports.renderCommandHelp = renderCommandHelp;
exports.helpRequested = helpRequested;
exports.helpJsonRequested = helpJsonRequested;
exports.resolveCommandHelpSpec = resolveCommandHelpSpec;
exports.writeResolvedHelp = writeResolvedHelp;
const commandResult_1 = require("../core/contracts/commandResult");
const platformRegistry_1 = require("../core/platform/platformRegistry");
function formatFlag(flag) {
    return [flag.flag, flag.value].filter(Boolean).join(' ');
}
function renderFlagSection(title, flags) {
    if (!flags?.length) {
        return [];
    }
    return [
        `${title}:`,
        ...flags.map((flag) => `  ${formatFlag(flag)}  ${flag.description}`),
    ];
}
function renderListSection(title, values) {
    if (!values?.length) {
        return [];
    }
    return [
        `${title}:`,
        ...values.map((value) => `- ${value}`),
    ];
}
function renderSubcommandSection(spec) {
    if (!spec.subcommands?.length) {
        return [];
    }
    return [
        'Commands:',
        ...spec.subcommands.map((subcommand) => `  ${subcommand.name}  ${subcommand.summary}`),
    ];
}
function renderJsonSection(title, payload) {
    if (!payload) {
        return [];
    }
    return [
        `${title}:`,
        JSON.stringify(payload, null, 2),
    ];
}
function renderCommandHelp(spec) {
    const lines = [
        `Usage: ${spec.usage}`,
        `Summary: ${spec.summary}`,
        ...renderSubcommandSection(spec),
        ...renderFlagSection('Required flags', spec.requiredFlags),
        ...renderFlagSection('Optional flags', spec.optionalFlags),
        ...renderJsonSection('Request shape', spec.requestShape),
        ...renderListSection('Success shape', spec.successFields),
        ...renderListSection('Failure semantics', spec.failureSemantics),
        ...renderListSection('Examples', spec.examples),
    ];
    return `${lines.filter(Boolean).join('\n')}\n`;
}
function rawStdoutHandledResult() {
    const result = (0, commandResult_1.commandSuccess)({ help: true });
    result.__rawStdoutHandled = true;
    return result;
}
function helpRequested(args) {
    return args.includes('--help') || args.includes('-h');
}
function helpJsonRequested(args) {
    return args.includes('--json');
}
function positionalCommandPath(args) {
    return args.filter((arg) => !arg.startsWith('-'));
}
function resolveCommandHelpSpec(args) {
    const path = positionalCommandPath(args);
    let best = null;
    for (const spec of COMMAND_HELP_SPECS) {
        const matches = spec.commandPath.every((segment, index) => path[index] === segment);
        if (!matches) {
            continue;
        }
        if (!best || spec.commandPath.length > best.commandPath.length) {
            best = spec;
        }
    }
    return best;
}
function writeResolvedHelp(context, args) {
    const spec = resolveCommandHelpSpec(args) ?? exports.ROOT_COMMAND_HELP;
    if (helpJsonRequested(args)) {
        const payload = {
            commandPath: spec.commandPath,
            command: spec.commandPath.length ? `metabot ${spec.commandPath.join(' ')}` : 'metabot',
            summary: spec.summary,
            usage: spec.usage,
            subcommands: spec.subcommands ?? [],
            requiredFlags: spec.requiredFlags ?? [],
            optionalFlags: spec.optionalFlags ?? [],
            requestShape: spec.requestShape ?? null,
            successFields: spec.successFields ?? [],
            failureSemantics: spec.failureSemantics ?? [],
            examples: spec.examples ?? [],
        };
        context.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return rawStdoutHandledResult();
    }
    context.stdout.write(renderCommandHelp(spec));
    return rawStdoutHandledResult();
}
const HELP_JSON_FLAG = {
    flag: '--json',
    description: 'Emit machine-readable help JSON instead of text.',
};
const PLATFORM_HOST_VALUE = `<${platformRegistry_1.SUPPORTED_PLATFORM_IDS.join('|')}>`;
const PLATFORM_HOST_TEXT = platformRegistry_1.SUPPORTED_PLATFORM_IDS.join(', ');
const CONFIGURED_WRITE_NETWORK_TEXT = 'Defaults to the configured `chain.defaultWriteNetwork`, initially mvc.';
const CHAIN_WRITE_FLAG = {
    flag: '--chain',
    value: '<mvc|btc|doge|opcat>',
    description: `Optional chain network override: mvc, btc, doge, or opcat. ${CONFIGURED_WRITE_NETWORK_TEXT}`,
};
const FROM_BOT_FLAG = {
    flag: '--from',
    value: '<bot-slug>',
    description: 'Optional local MetaBot actor. Omit to use the active identity.',
};
const FILE_UPLOAD_CHAIN_FLAG = {
    flag: '--chain',
    value: '<mvc|btc|opcat>',
    description: `Optional chain network override: mvc, btc, or opcat. ${CONFIGURED_WRITE_NETWORK_TEXT} DOGE is not supported for file upload.`,
};
const VERIFY_FLAG = {
    flag: '--verify',
    description: 'Verify file availability after upload when supported by the daemon path.',
};
const WALLET_CHAIN_ALL_FLAG = {
    flag: '--chain',
    value: '<all|mvc|btc|doge|opcat>',
    description: 'Select wallet balance scope. Defaults to all.',
};
const VERSION_FLAG = {
    flag: '--version, -v',
    description: 'Print the metabot CLI version and exit. Combine with --json for machine-readable output.',
};
exports.ROOT_COMMAND_HELP = {
    commandPath: [],
    summary: 'Machine-first MetaBot CLI for local runtime, chain write, remote delegation, and local inspection.',
    usage: 'metabot <command>',
    subcommands: [
        { name: 'identity', summary: 'Create the local MetaBot identity and bootstrap chain state.' },
        { name: 'bot', summary: 'Manage local MetaBot profiles, config, wallets, runtimes, and sessions.' },
        { name: 'config', summary: 'Read or change supported public runtime switches.' },
        { name: 'doctor', summary: 'Check daemon health, identity state, and local runtime readiness.' },
        { name: 'daemon', summary: 'Start or stop the local MetaBot daemon process.' },
        { name: 'file', summary: 'Upload local files to MetaWeb.' },
        { name: 'buzz', summary: 'Publish simplebuzz posts to MetaWeb.' },
        { name: 'metaapp', summary: 'Manage MetaApp owner list/delete, payload publishing, project packaging, sharing, viewing, and commenting.' },
        { name: 'chain', summary: 'Write arbitrary MetaID tuples and protocol payloads on-chain.' },
        { name: 'wallet', summary: 'Inspect local wallet balances across supported chains.' },
        { name: 'network', summary: 'Inspect the MetaWeb yellow-pages directory and local source seeds.' },
        { name: 'services', summary: 'Publish, call, and rate remote MetaBot services.' },
        { name: 'provider', summary: 'Inspect local provider orders and settle seller-side refunds.' },
        { name: 'chat', summary: 'Send encrypted private MetaWeb messages to another MetaBot.' },
        { name: 'host', summary: 'Project shared MetaBot skills into one host-native skills root.' },
        { name: 'trace', summary: 'Watch or inspect structured remote delegation traces.' },
        { name: 'browser', summary: 'Open the dedicated Agent Internet Browser UI and optional deep links.' },
        { name: 'ui', summary: 'Open local human-only HTML pages backed by the MetaBot runtime.' },
        { name: 'skills', summary: 'Resolve shared-default or host-specific skill contracts for install/runtime use.' },
        { name: 'system', summary: 'Update or uninstall local Open Agent Connect runtime assets.' },
        { name: 'llm', summary: 'Discover local LLM runtimes and manage MetaBot-to-LLM bindings.' },
        { name: 'loom', summary: 'Validate Loom payloads, run workflow commands, sync raw records, and inspect task views.' },
    ],
    optionalFlags: [VERSION_FLAG, HELP_JSON_FLAG],
    examples: [
        'metabot --version',
        'metabot config get --from alice chain.defaultWriteNetwork',
        'metabot services call --help',
        'metabot chat private --help --json',
    ],
};
const COMMAND_HELP_SPECS = [
    exports.ROOT_COMMAND_HELP,
    {
        commandPath: ['loom'],
        summary: 'Loom commands for validating protocol payloads, delegated task workflows, raw cache sync, and task inspection.',
        usage: 'metabot loom <subcommand>',
        subcommands: [
            { name: 'validate', summary: 'Validate one Loom protocol payload.' },
            { name: 'export-chain-request', summary: 'Build a chain write request for one Loom payload.' },
            { name: 'draft-task', summary: 'Draft a Loom task payload with the selected MetaBot LLM runtime.' },
            { name: 'post-task', summary: 'Post a Loom task from a payload file or task wish.' },
            { name: 'claim-and-start', summary: 'Claim a Loom task and prepare a local work session.' },
            { name: 'run-dev-round', summary: 'Run a development round for an accepted Loom claim.' },
            { name: 'deliver', summary: 'Create or summarize a Loom delivery for review.' },
            { name: 'accept-and-pay', summary: 'Accept a delivery and optionally confirm payment.' },
            { name: 'review-delivery', summary: 'Reject or request revision for a Loom delivery.' },
            { name: 'state', summary: 'Show derived Loom workflow state for one task.' },
            { name: 'sync', summary: 'Synchronize raw Loom protocol records into the local cache.' },
            { name: 'list', summary: 'List task-centric Loom records from the local cache.' },
            { name: 'show', summary: 'Show one Loom task and grouped related raw records.' },
            { name: 'dashboard', summary: 'Show the Loom task dashboard.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['loom', 'validate'],
        summary: 'Validate one Loom protocol payload without writing chain data.',
        usage: 'metabot loom validate --protocol <protocol> --payload-file <path>',
        requiredFlags: [
            { flag: '--protocol', value: '<protocol>', description: 'Loom protocol name, such as claim.' },
            { flag: '--payload-file', value: '<path>', description: 'JSON payload file to validate.' },
        ],
        successFields: [
            'protocol',
            'path',
            'valid',
            'payload',
        ],
        failureSemantics: [
            'Fails with invalid_protocol when --protocol is not a supported Loom protocol.',
            'Fails with invalid_payload and validation errors when the payload does not satisfy the protocol.',
        ],
        examples: [
            'metabot loom validate --protocol claim --payload-file claim.json',
            'metabot loom validate --protocol claim --payload-file claim.json --help --json',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['loom', 'export-chain-request'],
        summary: 'Build a chain write request for one validated Loom payload without writing chain data.',
        usage: 'metabot loom export-chain-request --protocol <protocol> --payload-file <path> [--out <path>]',
        requiredFlags: [
            { flag: '--protocol', value: '<protocol>', description: 'Loom protocol name, such as claim.' },
            { flag: '--payload-file', value: '<path>', description: 'JSON payload file to validate and export.' },
        ],
        optionalFlags: [
            { flag: '--out', value: '<path>', description: 'Write the chain request JSON to this path. Relative paths resolve against the current working directory.' },
            HELP_JSON_FLAG,
        ],
        requestShape: {
            taskPinId: '64-hex PINID string with i suffix',
            payoutAddress: 'claim payout address',
            message: 'optional claim message',
        },
        successFields: [
            'protocol',
            'path',
            'request.operation',
            'request.payload',
            'outPath',
        ],
        failureSemantics: [
            'Fails with invalid_protocol when --protocol is not a supported Loom protocol.',
            'Fails with invalid_payload and validation errors when the payload does not satisfy the protocol.',
            'Does not accept --chain or --from; pass the exported request to metabot chain write for actual chain writes.',
        ],
        examples: [
            'metabot loom export-chain-request --protocol claim --payload-file claim.json',
            'metabot loom export-chain-request --protocol claim --payload-file claim.json --out claim-request.json',
            'metabot loom export-chain-request --protocol claim --payload-file claim.json --help --json',
        ],
    },
    {
        commandPath: ['loom', 'draft-task'],
        summary: 'Draft a Loom task payload with the selected MetaBot LLM runtime without writing chain data.',
        usage: 'metabot loom draft-task --wish <text> [--from <bot-slug>] [--allow-invalid]',
        requiredFlags: [
            { flag: '--wish', value: '<text>', description: 'Natural-language task wish to turn into a /protocols/loom-task payload.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--allow-invalid', description: 'Return parsed schema-invalid task JSON for editing instead of failing with invalid_payload.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'protocol',
            'path',
            'valid',
            'payload',
            'validation',
        ],
        failureSemantics: [
            'Fails with missing_flag when --wish is omitted.',
            'Fails with llm_runtime_unavailable when the selected MetaBot has no usable LLM runtime.',
            'Fails with invalid_llm_output when the LLM output cannot be parsed as JSON, even with --allow-invalid.',
            'Fails with invalid_payload when parsed task JSON fails validation unless --allow-invalid is set.',
            'Does not write chain data, export chain requests, upload attachments, inspect git, create PRs, or perform payments.',
        ],
        examples: [
            'metabot loom draft-task --wish "Add CLI help for loom draft-task"',
            'metabot loom draft-task --from alice --allow-invalid --wish "Sketch a rough task for a future UI"',
            'metabot loom draft-task --help --json',
        ],
    },
    {
        commandPath: ['loom', 'sync'],
        summary: 'Synchronize raw Loom protocol records into the global local cache.',
        usage: 'metabot loom sync [--limit <n>]',
        optionalFlags: [
            { flag: '--limit', value: '<n>', description: 'Maximum rows to request per Loom protocol path for this sync.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'fetchedRecords',
            'fetchedByProtocol',
            'cachedRecords',
            'cachePath',
            'updatedAt',
        ],
        failureSemantics: [
            'Fails with invalid_flag when --limit is not a positive integer.',
            'Reads only Loom protocol paths and does not write chain data.',
        ],
        examples: [
            'metabot loom sync',
            'metabot loom sync --limit 25',
        ],
    },
    {
        commandPath: ['loom', 'post-task'],
        summary: 'Post a Loom task from a JSON payload file or draft wish through the delegated workflow dependency.',
        usage: 'metabot loom post-task [--from <bot-slug>] (--payload-file <path>|--wish <text>) [--chain <mvc|btc|doge|opcat>] [--dry-run]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--payload-file', value: '<path>', description: 'Validated Loom task payload JSON to post. Mutually exclusive with --wish.' },
            { flag: '--wish', value: '<text>', description: 'Natural-language task wish to draft and post. Mutually exclusive with --payload-file.' },
            CHAIN_WRITE_FLAG,
            { flag: '--dry-run', description: 'Build and validate workflow inputs without writing chain data.' },
            HELP_JSON_FLAG,
        ],
        failureSemantics: [
            'Fails with missing_flag when neither --payload-file nor --wish is provided.',
            'Fails with invalid_flag when both --payload-file and --wish are provided.',
        ],
        examples: [
            'metabot loom post-task --from alice --payload-file task.json --chain mvc --dry-run',
            'metabot loom post-task --from alice --wish "Add workflow CLI parser tests" --chain mvc',
        ],
    },
    {
        commandPath: ['loom', 'claim-and-start'],
        summary: 'Claim a Loom task and prepare a local workspace through the delegated workflow dependency.',
        usage: 'metabot loom claim-and-start --task-pin-id <pinid> (--payout-address <address>|--claim-pin-id <pinid>) [--from <bot-slug>] [--chain <mvc|btc|doge|opcat>] [--file-chain <mvc|btc|opcat>] [--message <text>] [--dry-run] [--reset-workspace]',
        requiredFlags: [
            { flag: '--task-pin-id', value: '<pinid>', description: 'Loom task PIN id to claim or resume.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--payout-address', value: '<address>', description: 'Developer payout address for a new claim. Required unless --claim-pin-id is supplied.' },
            { flag: '--claim-pin-id', value: '<pinid>', description: 'Existing claim PIN id to resume. Required unless --payout-address is supplied.' },
            CHAIN_WRITE_FLAG,
            { flag: '--file-chain', value: '<mvc|btc|opcat>', description: 'Optional chain override for file uploads. DOGE is not supported for file upload.' },
            { flag: '--message', value: '<text>', description: 'Optional claim or workspace message.' },
            { flag: '--dry-run', description: 'Prepare inputs without writing chain data or changing the workspace.' },
            { flag: '--reset-workspace', description: 'Allow the workflow dependency to reset its task workspace before starting.' },
            HELP_JSON_FLAG,
        ],
        failureSemantics: [
            'Fails with missing_flag when --task-pin-id is omitted.',
            'Fails with missing_flag when neither --payout-address nor --claim-pin-id is provided.',
            'Fails with invalid_flag when both --payout-address and --claim-pin-id are provided.',
            'Requires the delegated workflow dependency to provide local git, gh, authenticated `gh auth status`, and GitHub repository access.',
        ],
        examples: [
            `metabot loom claim-and-start --from bob --task-pin-id ${'a'.repeat(64)}i0 --payout-address 1DeveloperPayoutAddress --chain mvc --file-chain btc --message hi`,
            `metabot loom claim-and-start --from bob --task-pin-id ${'a'.repeat(64)}i0 --claim-pin-id ${'b'.repeat(64)}i0 --chain mvc --reset-workspace`,
        ],
    },
    {
        commandPath: ['loom', 'run-dev-round'],
        summary: 'Run a local development round for a task claim and forward repeated verification commands.',
        usage: 'metabot loom run-dev-round --task-pin-id <pinid> --claim-pin-id <pinid> [--from <bot-slug>] [--chain <mvc|btc|doge|opcat>] [--file-chain <mvc|btc|opcat>] [--check <command>...] [--round-note <text>]',
        requiredFlags: [
            { flag: '--task-pin-id', value: '<pinid>', description: 'Loom task PIN id under development.' },
            { flag: '--claim-pin-id', value: '<pinid>', description: 'Accepted claim PIN id for this development round.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            CHAIN_WRITE_FLAG,
            { flag: '--file-chain', value: '<mvc|btc|opcat>', description: 'Optional chain override for file uploads. DOGE is not supported for file upload.' },
            { flag: '--check', value: '<command>', description: 'Verification command to run. Repeat to preserve multiple checks.' },
            { flag: '--round-note', value: '<text>', description: 'Optional development round note.' },
            HELP_JSON_FLAG,
        ],
        failureSemantics: [
            'Fails with missing_flag when --task-pin-id or --claim-pin-id is omitted.',
            'Requires the delegated workflow dependency to provide any Git, gh/GitHub, command execution, and file-upload behavior.',
        ],
        examples: [
            `metabot loom run-dev-round --task-pin-id ${'a'.repeat(64)}i0 --claim-pin-id ${'b'.repeat(64)}i0 --check "npm run build" --check "npm test"`,
        ],
    },
    {
        commandPath: ['loom', 'deliver'],
        summary: 'Deliver completed work for a Loom task claim through the delegated workflow dependency.',
        usage: 'metabot loom deliver --task-pin-id <pinid> --claim-pin-id <pinid> [--from <bot-slug>] [--chain <mvc|btc|doge|opcat>] [--pr-title <text>] [--delivery-summary <text>] [--dry-run]',
        requiredFlags: [
            { flag: '--task-pin-id', value: '<pinid>', description: 'Loom task PIN id being delivered.' },
            { flag: '--claim-pin-id', value: '<pinid>', description: 'Claim PIN id for the delivered work.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            CHAIN_WRITE_FLAG,
            { flag: '--pr-title', value: '<text>', description: 'Optional pull request title to forward to the workflow dependency.' },
            { flag: '--delivery-summary', value: '<text>', description: 'Optional human-readable delivery summary.' },
            { flag: '--dry-run', description: 'Prepare delivery inputs without writing chain data or creating remote artifacts.' },
            HELP_JSON_FLAG,
        ],
        failureSemantics: [
            'Fails with missing_flag when --task-pin-id or --claim-pin-id is omitted.',
            'GitHub operations, pull request creation, and repository inspection require the delegated workflow dependency to provide those tools.',
        ],
        examples: [
            `metabot loom deliver --task-pin-id ${'a'.repeat(64)}i0 --claim-pin-id ${'b'.repeat(64)}i0 --pr-title "feat: add loom workflow CLI" --delivery-summary "Parser and help added."`,
        ],
    },
    {
        commandPath: ['loom', 'accept-and-pay'],
        summary: 'Accept a Loom delivery and forward payment confirmation intent through the delegated workflow dependency.',
        usage: 'metabot loom accept-and-pay --task-pin-id <pinid> --delivery-pin-id <pinid> --score <1-5> --comment <text> [--from <bot-slug>] [--chain <mvc|btc|doge|opcat>] [--confirm-payment]',
        requiredFlags: [
            { flag: '--task-pin-id', value: '<pinid>', description: 'Loom task PIN id whose delivery is accepted.' },
            { flag: '--delivery-pin-id', value: '<pinid>', description: 'Delivery PIN id to accept.' },
            { flag: '--score', value: '<1-5>', description: 'Integer review score from 1 to 5.' },
            { flag: '--comment', value: '<text>', description: 'Acceptance comment.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            CHAIN_WRITE_FLAG,
            { flag: '--confirm-payment', description: 'Explicitly allow the delegated workflow dependency to perform payment. Without --confirm-payment, preview acceptance without confirming payment.' },
            HELP_JSON_FLAG,
        ],
        failureSemantics: [
            'Fails with invalid_flag when --score is not an integer from 1 to 5.',
            'Omitting --confirm-payment forwards confirmPayment: false; no payment should be confirmed without the explicit flag.',
        ],
        examples: [
            `metabot loom accept-and-pay --task-pin-id ${'a'.repeat(64)}i0 --delivery-pin-id ${'c'.repeat(64)}i0 --score 5 --comment "Accepted" --confirm-payment`,
        ],
    },
    {
        commandPath: ['loom', 'review-delivery'],
        summary: 'Reject or request revision for a Loom delivery through the delegated workflow dependency.',
        usage: 'metabot loom review-delivery --task-pin-id <pinid> --delivery-pin-id <pinid> --verdict <rejected|revision_needed> --score <1-5> --comment <text> [--from <bot-slug>] [--chain <mvc|btc|doge|opcat>] [--attachment <uri>...]',
        requiredFlags: [
            { flag: '--task-pin-id', value: '<pinid>', description: 'Loom task PIN id being reviewed.' },
            { flag: '--delivery-pin-id', value: '<pinid>', description: 'Delivery PIN id to review.' },
            { flag: '--verdict', value: '<rejected|revision_needed>', description: 'Negative review verdict to post.' },
            { flag: '--score', value: '<1-5>', description: 'Integer review score from 1 to 5.' },
            { flag: '--comment', value: '<text>', description: 'Review comment.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            CHAIN_WRITE_FLAG,
            { flag: '--attachment', value: '<uri>', description: 'Optional review attachment URI. Repeat to include multiple attachments.' },
            HELP_JSON_FLAG,
        ],
        failureSemantics: [
            'Fails with invalid_flag when --verdict is not rejected or revision_needed.',
            'Fails with invalid_flag when --score is not an integer from 1 to 5.',
            'This command only represents negative delivery outcomes; accepted delivery payment uses accept-and-pay.',
        ],
        examples: [
            `metabot loom review-delivery --task-pin-id ${'a'.repeat(64)}i0 --delivery-pin-id ${'c'.repeat(64)}i0 --verdict revision_needed --score 2 --comment "Please add tests." --attachment metafile://review-note`,
        ],
    },
    {
        commandPath: ['loom', 'state'],
        summary: 'Show derived Loom workflow state for one task through the delegated workflow dependency.',
        usage: 'metabot loom state <taskPinId> [--refresh]',
        optionalFlags: [
            { flag: '--refresh', description: 'Refresh task state before reading it.' },
            HELP_JSON_FLAG,
        ],
        failureSemantics: [
            'Fails with missing_argument when taskPinId is omitted.',
        ],
        examples: [
            `metabot loom state ${'a'.repeat(64)}i0 --refresh`,
        ],
    },
    {
        commandPath: ['loom', 'list'],
        summary: 'List task-centric Loom records from the global local cache.',
        usage: 'metabot loom list [--refresh] [--limit <n>] [--tag <tag>] [--currency <SPACE|BTC|DOGE|OPCAT>]',
        optionalFlags: [
            { flag: '--refresh', description: 'Run loom sync before reading the local cache.' },
            { flag: '--limit', value: '<n>', description: 'Maximum task count to return.' },
            { flag: '--tag', value: '<tag>', description: 'Return tasks whose payload tags include this tag.' },
            { flag: '--currency', value: '<SPACE|BTC|DOGE|OPCAT>', description: 'Return tasks whose bounty currency matches this value.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'tasks',
            'tasks[].pinId',
            'tasks[].relatedCounts',
            'cache',
        ],
        failureSemantics: [
            'Fails with invalid_flag when --limit or --currency is invalid.',
            'Does not emit derived task status or business state.',
        ],
        examples: [
            'metabot loom list',
            'metabot loom list --refresh --tag cli --currency SPACE',
        ],
    },
    {
        commandPath: ['loom', 'show'],
        summary: 'Show one Loom task and grouped related raw records from the local cache.',
        usage: 'metabot loom show <taskPinId> [--refresh]',
        optionalFlags: [
            { flag: '--refresh', description: 'Run loom sync before reading the local cache.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'found',
            'task',
            'related.claims',
            'related.statuses',
            'related.deliveries',
            'related.acceptances',
            'related.claimRejects',
            'cache',
        ],
        failureSemantics: [
            'Fails with missing_argument when taskPinId is omitted.',
            'Fails with task_not_found when the task is absent from the local cache.',
            'Does not emit derived task status, permission validation, or payment transaction validation.',
        ],
        examples: [
            `metabot loom show ${'a'.repeat(64)}i0`,
            `metabot loom show ${'a'.repeat(64)}i0 --refresh`,
        ],
    },
    {
        commandPath: ['loom', 'dashboard'],
        summary: 'Show the Loom task dashboard from raw cache, with optional refresh and task filters.',
        usage: 'metabot loom dashboard [--from <bot-slug>] [--refresh] [--limit <n>] [--state <state-or-column>] [--role <all|requester|developer|needs_action>] [--query <text>]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--refresh', description: 'Refresh raw Loom chain records before building the dashboard index.' },
            { flag: '--limit', value: '<n>', description: 'Maximum dashboard task count to return.' },
            { flag: '--state', value: '<state-or-column>', description: 'Return tasks matching a derived state or dashboard column.' },
            { flag: '--role', value: '<all|requester|developer|needs_action>', description: 'Return tasks by actor relationship. Defaults to all.' },
            { flag: '--query', value: '<text>', description: 'Return tasks whose dashboard text matches this query.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'dashboard.summary',
            'dashboard.columns',
            'dashboard.tasks',
            'dashboard.details',
            'cache',
            'indexPath',
        ],
        failureSemantics: [
            'Fails with invalid_flag when --limit, --state, or --role is invalid.',
            'Fails with not_implemented when the dashboard handler is not configured.',
            'Refresh updates the local raw Loom cache and dashboard index; it does not write chain data, perform payments, or mutate GitHub or browsers.',
        ],
        examples: [
            'metabot loom dashboard',
            'metabot loom dashboard --from alice --refresh --state review --role needs_action --query github',
        ],
    },
    {
        commandPath: ['bot'],
        summary: 'Manage local MetaBot profiles, config, wallets, runtimes, and sessions.',
        usage: 'metabot bot <subcommand>',
        subcommands: [
            { name: 'list', summary: 'List local MetaBot profiles.' },
            { name: 'show', summary: 'Show one local MetaBot profile.' },
            { name: 'create', summary: 'Create one local MetaBot profile.' },
            { name: 'update', summary: 'Update one local MetaBot profile.' },
            { name: 'delete', summary: 'Delete one local MetaBot profile after confirmation.' },
            { name: 'config', summary: 'Get or set one MetaBot profile config.' },
            { name: 'wallet', summary: 'Show wallet metadata for one MetaBot profile.' },
            { name: 'backup', summary: 'Show mnemonic backup material for one MetaBot profile.' },
            { name: 'runtimes', summary: 'List or discover LLM runtimes for a MetaBot profile.' },
            { name: 'sessions', summary: 'List runtime sessions for a MetaBot profile.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['bot', 'list'],
        summary: 'List local MetaBot profiles and indicate which profile is currently active.',
        usage: 'metabot bot list',
        successFields: ['profiles'],
        examples: ['metabot bot list'],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['bot', 'show'],
        summary: 'Show one local MetaBot profile.',
        usage: 'metabot bot show --from <bot-slug>',
        requiredFlags: [FROM_BOT_FLAG],
        examples: ['metabot bot show --from alice'],
    },
    {
        commandPath: ['bot', 'create'],
        summary: 'Create one local MetaBot profile.',
        usage: 'metabot bot create --name <name>',
        requiredFlags: [
            { flag: '--name', value: '<name>', description: 'Human-facing name for the new local MetaBot profile.' },
        ],
        examples: ['metabot bot create --name "Alice"'],
    },
    {
        commandPath: ['bot', 'update'],
        summary: 'Update one local MetaBot profile.',
        usage: 'metabot bot update --from <bot-slug> --payload-file <path>',
        requiredFlags: [
            FROM_BOT_FLAG,
            { flag: '--payload-file', value: '<path>', description: 'JSON profile update payload.' },
        ],
        requestShape: {
            name: 'optional updated public display name',
            bio: 'optional updated public bio markdown',
            role: 'optional updated ROLE.md contents',
            soul: 'optional updated SOUL.md contents',
            goal: 'optional updated GOAL.md contents',
            avatarDataUrl: 'optional data URL avatar, empty string clears the avatar',
            primaryProvider: 'optional primary LLM provider id or null',
            fallbackProvider: 'optional fallback LLM provider id or null',
            allowChatSkills: ['optional allowed private chat skill ids'],
            homepage: {
                uri: 'optional metafile://... or metaapp://... homepage target',
                renderer: 'optional renderer hint such as auto',
                contentType: 'optional content type for metafile homepages',
            },
        },
        successFields: ['profile', 'chainWrites'],
        failureSemantics: [
            'Fails when the profile is missing, the payload is invalid, or a chain-backed public identity update cannot be written safely.',
            'Public identity writes return chainWrites before the local profile is updated.',
        ],
    },
    {
        commandPath: ['bot', 'delete'],
        summary: 'Delete one local MetaBot profile after confirmation.',
        usage: 'metabot bot delete --from <bot-slug> --confirm',
        requiredFlags: [
            FROM_BOT_FLAG,
            { flag: '--confirm', description: 'Required explicit confirmation for profile deletion.' },
        ],
    },
    {
        commandPath: ['bot', 'config'],
        summary: 'Get or set one MetaBot profile config.',
        usage: 'metabot bot config <get|set>',
        subcommands: [
            { name: 'get', summary: 'Read one MetaBot profile config.' },
            { name: 'set', summary: 'Write one MetaBot profile config from JSON.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['bot', 'config', 'get'],
        summary: 'Read one MetaBot profile config JSON document.',
        usage: 'metabot bot config get --from <bot-slug>',
        requiredFlags: [FROM_BOT_FLAG],
        successFields: ['chain', 'a2a'],
        examples: ['metabot bot config get --from alice'],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['bot', 'config', 'set'],
        summary: 'Write one MetaBot profile config JSON document.',
        usage: 'metabot bot config set --from <bot-slug> --payload-file <path>',
        requiredFlags: [
            FROM_BOT_FLAG,
            { flag: '--payload-file', value: '<path>', description: 'JSON config update payload.' },
        ],
        requestShape: {
            chain: {
                defaultWriteNetwork: 'mvc|btc|doge|opcat',
            },
        },
        successFields: ['chain', 'a2a'],
        failureSemantics: [
            'Fails when the selected MetaBot profile does not exist.',
            'Fails when chain.defaultWriteNetwork is not one of mvc, btc, doge, or opcat.',
        ],
        examples: ['metabot bot config set --from alice --payload-file bot-config.json'],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['bot', 'wallet'],
        summary: 'Show wallet metadata for one MetaBot profile.',
        usage: 'metabot bot wallet --from <bot-slug>',
        requiredFlags: [FROM_BOT_FLAG],
    },
    {
        commandPath: ['bot', 'backup'],
        summary: 'Show mnemonic backup material for one MetaBot profile.',
        usage: 'metabot bot backup --from <bot-slug>',
        requiredFlags: [FROM_BOT_FLAG],
    },
    {
        commandPath: ['bot', 'runtimes'],
        summary: 'List or discover LLM runtimes for a MetaBot profile.',
        usage: 'metabot bot runtimes <list|discover> [--from <bot-slug>]',
        subcommands: [
            { name: 'list', summary: 'List known LLM runtimes.' },
            { name: 'discover', summary: 'Refresh discovered LLM runtimes.' },
        ],
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['bot', 'runtimes', 'list'],
        summary: 'List known LLM runtimes visible to the selected or active MetaBot profile.',
        usage: 'metabot bot runtimes list [--from <bot-slug>]',
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
        successFields: ['runtimes'],
        examples: ['metabot bot runtimes list --from alice', 'metabot bot runtimes list'],
    },
    {
        commandPath: ['bot', 'runtimes', 'discover'],
        summary: 'Refresh discovered LLM runtimes for the selected or active MetaBot profile.',
        usage: 'metabot bot runtimes discover [--from <bot-slug>]',
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
        successFields: ['runtimes'],
        examples: ['metabot bot runtimes discover --from alice', 'metabot bot runtimes discover'],
    },
    {
        commandPath: ['bot', 'sessions'],
        summary: 'List runtime sessions for a MetaBot profile.',
        usage: 'metabot bot sessions [--from <bot-slug>] [--limit <n>]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--limit', value: '<n>', description: 'Maximum session count. Defaults to 50.' },
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['host'],
        summary: 'Host projection commands for binding shared MetaBot skills into one host-native skills root.',
        usage: 'metabot host <subcommand>',
        subcommands: [
            { name: 'bind-skills', summary: 'Project shared MetaBot skills into one host-native skills root.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
        examples: [
            'metabot host bind-skills --host codex',
            'metabot host bind-skills --host claude-code',
            'metabot host bind-skills --host openclaw',
        ],
    },
    {
        commandPath: ['host', 'bind-skills'],
        summary: 'Project shared MetaBot skills into one host-native skills root.',
        usage: `metabot host bind-skills --host ${PLATFORM_HOST_VALUE}`,
        requiredFlags: [
            { flag: '--host', value: PLATFORM_HOST_VALUE, description: 'Target host whose native skills root should receive shared MetaBot symlinks.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
        successFields: [
            'host',
            'hostSkillRoot',
            'sharedSkillRoot',
            'boundSkills',
            'replacedEntries',
            'unchangedEntries',
        ],
        failureSemantics: [
            `Fails with invalid_argument when --host is not one of ${PLATFORM_HOST_TEXT}.`,
            'Fails with shared_skills_missing when ~/.metabot/skills has no shared metabot-* directories to bind.',
            'Fails with host_skill_root_unresolved and returns host plus the attempted hostSkillRoot path.',
            'Fails with host_skill_bind_failed and returns sourceSharedSkillPath plus destinationHostPath.',
        ],
        examples: [
            'metabot host bind-skills --host codex',
            'metabot host bind-skills --host claude-code',
            'metabot host bind-skills --host openclaw',
        ],
    },
    {
        commandPath: ['skills'],
        summary: 'Skill contract commands for shared-default resolution and explicit host compatibility rendering.',
        usage: 'metabot skills <subcommand>',
        subcommands: [
            { name: 'resolve', summary: 'Render one resolved skill contract in markdown or JSON.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
        examples: [
            'metabot skills resolve --skill metabot-network-manage --format markdown',
            'metabot skills resolve --skill metabot-network-manage --host codex --format json',
        ],
    },
    {
        commandPath: ['skills', 'resolve'],
        summary: 'Render one resolved skill contract using the shared-default host or an explicit compatibility host override.',
        usage: `metabot skills resolve --skill <skill-name> --format <json|markdown> [--host ${PLATFORM_HOST_VALUE}]`,
        requiredFlags: [
            { flag: '--skill', value: '<skill-name>', description: 'Base skill id to resolve, such as metabot-network-manage.' },
            { flag: '--format', value: '<json|markdown>', description: 'Output shape to render.' },
        ],
        optionalFlags: [
            { flag: '--host', value: PLATFORM_HOST_VALUE, description: 'Optional compatibility override. Omit to render the shared-default contract.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'Markdown mode returns the rendered contract string.',
            'JSON mode returns host, optional requestedHost, resolutionMode, format, and contract.',
        ],
        failureSemantics: [
            'Fails when --skill or --format is omitted.',
            `Fails when --host is present but not one of ${PLATFORM_HOST_TEXT}.`,
        ],
        examples: [
            'metabot skills resolve --skill metabot-network-manage --format markdown',
            'metabot skills resolve --skill metabot-network-manage --format json',
            'metabot skills resolve --skill metabot-network-manage --host codex --format markdown',
            'metabot skills resolve --skill metabot-network-manage --host codex --format json',
        ],
    },
    {
        commandPath: ['config'],
        summary: 'Read or change supported public runtime switches such as the default write network.',
        usage: 'metabot config <subcommand>',
        subcommands: [
            { name: 'get', summary: 'Read one supported config key for one MetaBot actor.' },
            { name: 'set', summary: 'Persist one supported config key for one MetaBot actor.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
        examples: [
            'metabot config get --from alice chain.defaultWriteNetwork',
            'metabot config set --from alice chain.defaultWriteNetwork opcat',
            'metabot config get --from alice a2a.simplemsgListenerEnabled',
        ],
    },
    {
        commandPath: ['config', 'get'],
        summary: 'Read one supported public config key such as the default write network.',
        usage: 'metabot config get [--from <bot-slug>] <key>',
        successFields: [
            'key',
            'value',
        ],
        failureSemantics: [
            'Fails with missing_argument when the config key is omitted.',
            'Fails with unsupported_config_key when the requested key is not in the public CLI allowlist.',
        ],
        examples: [
            'metabot config get --from alice chain.defaultWriteNetwork',
            'metabot config get --from alice a2a.simplemsgListenerEnabled',
        ],
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['config', 'set'],
        summary: 'Persist one supported public config key.',
        usage: 'metabot config set [--from <bot-slug>] <key> <value>',
        successFields: [
            'key',
            'value',
        ],
        failureSemantics: [
            'Fails with missing_argument when the key or value is omitted.',
            'Fails with unsupported_config_key when the requested key is not in the public CLI allowlist.',
            'Fails when chain.defaultWriteNetwork is not one of mvc, btc, doge, or opcat.',
        ],
        examples: [
            'metabot config set --from alice chain.defaultWriteNetwork opcat',
            'metabot config set --from alice a2a.simplemsgListenerEnabled false',
        ],
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['identity'],
        summary: 'Identity commands for creating, listing, and switching local MetaBot identity profiles.',
        usage: 'metabot identity <subcommand>',
        subcommands: [
            { name: 'create', summary: 'Create one local MetaBot identity from a human-provided name.' },
            { name: 'who', summary: 'Show which local MetaBot identity is currently active.' },
            { name: 'list', summary: 'List local MetaBot identity profiles discovered on this machine.' },
            { name: 'assign', summary: 'Switch the active local MetaBot identity profile by name.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['identity', 'create'],
        summary: 'Create one local MetaBot identity and complete the validated bootstrap flow for the current active home.',
        usage: 'metabot identity create --name <display-name>',
        requiredFlags: [
            { flag: '--name', value: '<display-name>', description: 'Human-facing name for the new local MetaBot identity.' },
        ],
        successFields: [
            'metabotId',
            'name',
            'publicKey',
            'chatPublicKey',
            'mvcAddress',
            'globalMetaId',
        ],
        failureSemantics: [
            'Fails with identity_name_taken when another local profile on this machine already uses the same name.',
            'Fails with identity_name_conflict when another active local identity already exists under the current home.',
            'Fails when the bootstrap flow cannot derive keys, claim subsidy, or persist identity state.',
        ],
        examples: [
            'metabot identity create --name "<your chosen MetaBot name>"',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['identity', 'who'],
        summary: 'Show the currently active local MetaBot identity and active home directory.',
        usage: 'metabot identity who',
        successFields: [
            'activeHomeDir',
            'systemHomeDir',
            'identity.name',
            'identity.globalMetaId',
            'identity.mvcAddress',
        ],
        failureSemantics: [
            'Fails when no local identity is initialized for the current active home.',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['identity', 'list'],
        summary: 'List local MetaBot identity profiles on this machine and report the current active home.',
        usage: 'metabot identity list',
        successFields: [
            'systemHomeDir',
            'activeHomeDir',
            'profiles',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['identity', 'assign'],
        summary: 'Switch the active local MetaBot identity profile by display name.',
        usage: 'metabot identity assign --name <display-name>',
        requiredFlags: [
            { flag: '--name', value: '<display-name>', description: 'Existing local MetaBot identity profile name to activate.' },
        ],
        successFields: [
            'activeHomeDir',
            'assignedProfile.name',
            'assignedProfile.globalMetaId',
        ],
        failureSemantics: [
            'Fails when no local profile matches the requested name.',
            'Fails when multiple profiles share the same name and assignment is ambiguous.',
        ],
        examples: [
            'metabot identity assign --name "Charles"',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['doctor'],
        summary: 'Check local daemon reachability, loaded identity state, and directory readiness.',
        usage: 'metabot doctor',
        successFields: [
            'version',
            'checks',
            'daemon.baseUrl',
            'daemon.pid',
        ],
        failureSemantics: [
            'Returns failed when the local daemon cannot be reached or runtime inspection crashes.',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['daemon'],
        summary: 'Daemon commands for the local MetaBot runtime process.',
        usage: 'metabot daemon <subcommand>',
        subcommands: [
            { name: 'start', summary: 'Start or reuse the local daemon process.' },
            { name: 'stop', summary: 'Stop the currently running local daemon process.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['daemon', 'start'],
        summary: 'Start the local MetaBot daemon process and return its local base URL.',
        usage: 'metabot daemon start',
        successFields: [
            'baseUrl',
            'pid',
            'reused',
        ],
        failureSemantics: [
            'Fails when the daemon cannot bind its local port or initialize runtime dependencies.',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['daemon', 'stop'],
        summary: 'Stop the currently running local MetaBot daemon process.',
        usage: 'metabot daemon stop',
        successFields: [
            'pid',
            'stopped',
        ],
        failureSemantics: [
            'Fails with daemon_not_running when no daemon process is tracked.',
            'Fails with daemon_stop_failed when the process cannot be signaled.',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['file'],
        summary: 'File upload commands for MetaWeb attachments and content publishing.',
        usage: 'metabot file <subcommand>',
        subcommands: [
            { name: 'upload', summary: 'Upload one local file through the shared MetaWeb file path.' },
            { name: 'upload-large', summary: 'Upload one local file through the daemon-backed large file path.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['file', 'upload'],
        summary: 'Upload one local file to MetaWeb and return the resulting metafile URI.',
        usage: 'metabot file upload [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|opcat>]',
        requiredFlags: [
            { flag: '--request-file', value: '<path>', description: 'JSON request file.' },
        ],
        requestShape: {
            filePath: '/absolute/or/relative/path/to/file',
            contentType: 'optional MIME type',
            network: 'optional chain network override',
        },
        successFields: [
            'fileName',
            'pinId',
            'metafileUri',
            'txids',
        ],
        failureSemantics: [
            'Fails when the local file is missing, unreadable, or the chain upload path rejects the write.',
            'DOGE is not supported for file upload.',
        ],
        examples: [
            'metabot file upload --from alice --request-file file-request.json',
            'metabot file upload --from alice --request-file file-opcat-request.json --chain opcat',
        ],
        optionalFlags: [FROM_BOT_FLAG, FILE_UPLOAD_CHAIN_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['file', 'upload-large'],
        summary: 'Upload one local file through the daemon large-file route and return the daemon result.',
        usage: [
            'metabot file upload-large --file <path> [--from <bot-slug>] [--content-type <mime>] [--chain <mvc|btc|opcat>] [--verify]',
            'metabot file upload-large <path> [--from <bot-slug>] [--content-type <mime>] [--chain <mvc|btc|opcat>] [--verify]',
            'metabot file upload-large --request-file <path> [--from <bot-slug>] [--chain <mvc|btc|opcat>] [--verify]',
        ].join('\n'),
        requestShape: {
            filePath: '/absolute/or/relative/path/to/file',
            contentType: 'optional MIME type',
            network: 'optional chain network override',
            verify: 'optional availability verification boolean',
        },
        successFields: [
            'fileName',
            'pinId',
            'metafileUri',
            'txids',
            'uploadMode',
            'verification',
        ],
        failureSemantics: [
            'Fails when the local file is missing, unreadable, or the daemon upload route rejects the write.',
            'DOGE is not supported for file upload.',
            'Large uploads above the direct threshold currently require MVC.',
            'Fails with large_file_upload_unavailable when the daemon has no production large-file uploader configured.',
        ],
        examples: [
            'metabot file upload-large --from alice --file ./dist/metaapp.zip --content-type application/zip --verify',
            'metabot file upload-large ./dist/metaapp.zip --from alice --verify',
            'metabot file upload-large --from alice --request-file large-file-request.json --verify',
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--file', value: '<path>', description: 'Direct local file path for large upload.' },
            { flag: '--request-file', value: '<path>', description: 'JSON request file for compatibility.' },
            { flag: '--content-type', value: '<mime>', description: 'Optional MIME type for --file or positional path uploads.' },
            FILE_UPLOAD_CHAIN_FLAG,
            VERIFY_FLAG,
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['buzz'],
        summary: 'Buzz commands for posting simplebuzz content on MetaWeb.',
        usage: 'metabot buzz <subcommand>',
        subcommands: [
            { name: 'post', summary: 'Publish one simplebuzz post, optionally with attachments.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['buzz', 'post'],
        summary: 'Publish one simplebuzz post through the validated MetaWeb buzz contract.',
        usage: 'metabot buzz post [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--request-file', value: '<path>', description: 'JSON request file.' },
        ],
        requestShape: {
            content: 'simplebuzz text body',
            attachments: ['optional local file path', 'optional local file path'],
        },
        successFields: [
            'pinId',
            'txids',
            'path',
        ],
        failureSemantics: [
            'Fails when no local identity exists, attachment upload fails, or the chain write is rejected.',
        ],
        examples: [
            'metabot buzz post --from alice --request-file buzz-request.json',
            'metabot buzz post --from alice --request-file buzz-doge-request.json --chain doge',
            'metabot buzz post --from alice --request-file buzz-opcat-request.json --chain opcat',
        ],
        optionalFlags: [FROM_BOT_FLAG, CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['metaapp'],
        summary: 'MetaApp commands for owner management, publishing, project packaging, sharing, viewing, and commenting.',
        usage: 'metabot metaapp <subcommand>',
        subcommands: [
            { name: 'list', summary: 'List MetaApps owned by one local MetaBot actor.' },
            { name: 'publish', summary: 'Publish a new MetaApp from a prepared protocol payload file.' },
            { name: 'update', summary: 'Publish a new version of an existing MetaApp from a payload file.' },
            { name: 'delete', summary: 'Revoke an owned MetaApp record.' },
            { name: 'preview', summary: 'Inspect a project directory and prepare a local MetaApp preview.' },
            { name: 'publish-project', summary: 'Package and publish a project directory as a MetaApp.' },
            { name: 'update-project', summary: 'Package and publish a new version of an existing MetaApp.' },
            { name: 'share', summary: 'Build a share bundle and optionally announce the MetaApp with simplebuzz.' },
            { name: 'view', summary: 'Open the local MetaApp gallery.' },
            { name: 'comment', summary: 'Post an on-chain comment for a MetaApp.' },
        ],
        examples: [
            'metabot metaapp list --from alice',
            'metabot metaapp publish --from alice --payload-file metaapp.json --chain mvc --confirm',
            'metabot metaapp update --from alice --target-pin-id <pinid> --payload-file metaapp.json --confirm',
            'metabot metaapp delete --from alice --target-pin-id <pinid> --confirm',
            'metabot metaapp publish-project --project-dir ./dist-site --from alice --chain mvc --confirm',
            'metabot metaapp update-project --target-pin-id <pinid> --project-dir ./dist-site --from alice --confirm',
            'metabot metaapp share --pin-id <pinid>',
            'metabot metaapp share --pin-id <pinid> --announce --from alice',
            'metabot metaapp view --mine --from alice',
            'metabot metaapp comment --pin-id <pinid> --comment "Great demo" --from alice',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['metaapp', 'list'],
        summary: 'List MetaApps owned by one local MetaBot actor with cursor pagination.',
        usage: 'metabot metaapp list [--from <bot-slug>] [--size <number>] [--cursor <cursor>]',
        requestShape: {
            from: 'optional local MetaBot actor',
            size: 'positive page size, default 12',
            cursor: 'optional pagination cursor',
        },
        successFields: [
            'records',
            'nextCursor',
        ],
        failureSemantics: [
            'Fails with not_implemented until a MetaApp list handler is configured.',
        ],
        examples: [
            'metabot metaapp list --from alice',
            'metabot metaapp list --from alice --size 12 --cursor <cursor>',
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--size', value: '<number>', description: 'Positive page size. Defaults to 12.' },
            { flag: '--cursor', value: '<cursor>', description: 'Cursor returned by the previous list response.' },
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['metaapp', 'preview'],
        summary: 'Inspect a project directory, derive a draft MetaApp manifest, and start a local preview without chain writes.',
        usage: 'metabot metaapp preview --project-dir <path> [--manifest-file <path>] [--open]',
        requiredFlags: [
            { flag: '--project-dir', value: '<path>', description: 'Project directory to inspect and preview.' },
        ],
        requestShape: {
            projectDir: 'browser-runnable project directory',
            manifestFile: 'optional manifest override file',
            open: 'open the local preview when true',
        },
        successFields: [
            'project',
            'manifest',
            'localPreviewUrl',
        ],
        failureSemantics: [
            'Never writes chain data or uploads the publish artifact.',
            'Returns a manual configuration draft when the project cannot be classified.',
            'Fails with not_implemented until a MetaApp preview handler is configured.',
        ],
        examples: [
            'metabot metaapp preview --project-dir ./dist-site',
            'metabot metaapp preview --project-dir ./dist-site --manifest-file metaapp.json',
            'metabot metaapp preview --project-dir ./dist-site --open',
        ],
        optionalFlags: [
            { flag: '--manifest-file', value: '<path>', description: 'Optional user-edited manifest override file.' },
            { flag: '--open', description: 'Open the generated local preview URL when the handler supports it.' },
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['metaapp', 'publish'],
        summary: 'Publish a new MetaApp from a prepared MetaApp protocol payload file.',
        usage: 'metabot metaapp publish [--from <bot-slug>] --payload-file <path> [--chain <mvc|btc|doge|opcat>] --confirm',
        requiredFlags: [
            { flag: '--payload-file', value: '<path>', description: 'JSON MetaApp protocol payload file.' },
            { flag: '--confirm', description: 'Confirm the on-chain publish write.' },
        ],
        requestShape: {
            payload: 'fields parsed from --payload-file',
            from: 'optional local MetaBot actor',
            network: 'optional write-chain override: mvc, btc, doge, or opcat',
            confirm: 'always true when dispatched',
        },
        successFields: [
            'pinId',
            'firstPinId',
            'metawebUrl',
            'localUiUrl',
        ],
        failureSemantics: [
            'Requires --confirm before dispatching the publish handler.',
            'Rejects --project-dir and directs callers to metabot metaapp publish-project.',
            'Fails with not_implemented until a MetaApp publish handler is configured.',
        ],
        examples: [
            'metabot metaapp publish --from alice --payload-file metaapp.json --confirm',
            'metabot metaapp publish --from alice --payload-file metaapp.json --chain mvc --confirm',
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            CHAIN_WRITE_FLAG,
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['metaapp', 'update'],
        summary: 'Publish a new version of an existing MetaApp from a prepared protocol payload file.',
        usage: 'metabot metaapp update [--from <bot-slug>] --target-pin-id <pinid> --payload-file <path> [--chain <mvc|btc|doge|opcat>] --confirm',
        requiredFlags: [
            { flag: '--target-pin-id', value: '<pinid>', description: 'Existing MetaApp pin to modify.' },
            { flag: '--payload-file', value: '<path>', description: 'JSON MetaApp protocol payload file.' },
            { flag: '--confirm', description: 'Confirm the on-chain update write.' },
        ],
        requestShape: {
            targetPinId: 'existing MetaApp pin id',
            payload: 'fields parsed from --payload-file',
            from: 'optional local MetaBot actor',
            network: 'optional write-chain override: mvc, btc, doge, or opcat',
            confirm: 'always true when dispatched',
        },
        successFields: [
            'pinId',
            'firstPinId',
            'metawebUrl',
            'localUiUrl',
        ],
        failureSemantics: [
            'Requires --confirm before dispatching the update handler.',
            'Rejects --project-dir and directs callers to metabot metaapp update-project.',
            'Fails with not_implemented until a MetaApp update handler is configured.',
        ],
        examples: [
            'metabot metaapp update --from alice --target-pin-id <pinid> --payload-file metaapp.json --confirm',
            'metabot metaapp update --from alice --target-pin-id <pinid> --payload-file metaapp.json --chain opcat --confirm',
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            CHAIN_WRITE_FLAG,
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['metaapp', 'delete'],
        summary: 'Revoke an owned MetaApp record.',
        usage: 'metabot metaapp delete [--from <bot-slug>] --target-pin-id <pinid> --confirm [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--target-pin-id', value: '<pinid>', description: 'Existing MetaApp pin to revoke.' },
            { flag: '--confirm', description: 'Confirm the on-chain delete write.' },
        ],
        requestShape: {
            targetPinId: 'existing MetaApp pin id',
            from: 'optional local MetaBot actor',
            network: 'optional write-chain override: mvc, btc, doge, or opcat',
            confirm: 'always true when dispatched',
        },
        successFields: [
            'revokedPinId',
            'pinId',
            'txids',
        ],
        failureSemantics: [
            'Requires --confirm before dispatching the delete handler.',
            'Fails with not_implemented until a MetaApp delete handler is configured.',
        ],
        examples: [
            'metabot metaapp delete --from alice --target-pin-id <pinid> --confirm',
            'metabot metaapp delete --from alice --target-pin-id <pinid> --chain mvc --confirm',
        ],
        optionalFlags: [FROM_BOT_FLAG, CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['metaapp', 'publish-project'],
        summary: 'Package and publish a project directory through the file-upload-backed MetaApp protocol.',
        usage: 'metabot metaapp publish-project --project-dir <path> [--from <bot-slug>] [--manifest-file <path>] [--chain <mvc|btc|opcat>] [--confirm]',
        requiredFlags: [
            { flag: '--project-dir', value: '<path>', description: 'Project directory to package and publish.' },
        ],
        requestShape: {
            projectDir: 'browser-runnable project directory',
            manifestFile: 'optional manifest override file',
            from: 'optional local MetaBot actor',
            network: 'optional file-upload-compatible chain override: mvc, btc, or opcat',
            confirm: 'write only when true',
        },
        successFields: [
            'pinId',
            'firstPinId',
            'metawebUrl',
            'localUiUrl',
            'payloadPreview when --confirm is omitted',
            'archivePreview when --confirm is omitted',
        ],
        failureSemantics: [
            'Without --confirm, returns the rendered preview data plus payloadPreview JSON and does not write chain data.',
            'Uses the file upload chain set; DOGE is not supported for file upload.',
            'Fails with not_implemented until a MetaApp publish-project handler is configured.',
        ],
        examples: [
            'metabot metaapp publish-project --project-dir ./dist-site --from alice --json',
            'metabot metaapp publish-project --project-dir ./dist-site --from alice --chain mvc --confirm',
            'metabot metaapp publish-project --project-dir ./dist-site --from alice --manifest-file metaapp.json --confirm',
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--manifest-file', value: '<path>', description: 'Optional user-edited manifest JSON file.' },
            FILE_UPLOAD_CHAIN_FLAG,
            { flag: '--confirm', description: 'Confirm the MetaApp upload and on-chain publish write.' },
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['metaapp', 'update-project'],
        summary: 'Package and publish a new project-directory version of an existing MetaApp.',
        usage: 'metabot metaapp update-project --target-pin-id <pinid> --project-dir <path> [--from <bot-slug>] [--manifest-file <path>] [--chain <mvc|btc|opcat>] [--confirm]',
        requiredFlags: [
            { flag: '--target-pin-id', value: '<pinid>', description: 'Existing MetaApp pin to modify.' },
            { flag: '--project-dir', value: '<path>', description: 'Project directory to package and publish as the next version.' },
        ],
        requestShape: {
            targetPinId: 'existing MetaApp pin id',
            projectDir: 'browser-runnable project directory',
            manifestFile: 'optional manifest override file',
            from: 'optional local MetaBot actor',
            network: 'optional file-upload-compatible chain override: mvc, btc, or opcat',
            confirm: 'write only when true',
        },
        successFields: [
            'pinId',
            'firstPinId',
            'metawebUrl',
            'localUiUrl',
            'payloadPreview when --confirm is omitted',
            'archivePreview when --confirm is omitted',
        ],
        failureSemantics: [
            'Without --confirm, returns the rendered preview data plus payloadPreview JSON and does not write chain data.',
            'Uses the file upload chain set; DOGE is not supported for file upload.',
            'Fails with not_implemented until a MetaApp update-project handler is configured.',
        ],
        examples: [
            'metabot metaapp update-project --target-pin-id <pinid> --project-dir ./dist-site --from alice --json',
            'metabot metaapp update-project --target-pin-id <pinid> --project-dir ./dist-site --from alice --confirm',
            'metabot metaapp update-project --target-pin-id <pinid> --project-dir ./dist-site --from alice --chain opcat --confirm',
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--manifest-file', value: '<path>', description: 'Optional user-edited manifest JSON file.' },
            FILE_UPLOAD_CHAIN_FLAG,
            { flag: '--confirm', description: 'Confirm the MetaApp upload and on-chain update write.' },
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['metaapp', 'share'],
        summary: 'Return a shareable MetaApp bundle and optionally announce it through simplebuzz.',
        usage: 'metabot metaapp share --pin-id <pinid> [--announce] [--from <bot-slug>] [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--pin-id', value: '<pinid>', description: 'Published MetaApp pin id to share.' },
        ],
        requestShape: {
            pinId: 'published MetaApp pin id',
            announce: 'post a simplebuzz announcement when true',
            from: 'optional local MetaBot actor',
            network: 'optional write-chain override used only with --announce',
        },
        successFields: [
            'pinId',
            'metawebUrl',
            'suggestedBuzz',
            'buzzPinId',
        ],
        failureSemantics: [
            'The --chain flag is ignored unless --announce is present; without --announce no chain write is planned.',
            'With --announce, uses the same write-chain behavior as metabot buzz post and metabot chain write.',
            'Fails with not_implemented until a MetaApp share handler is configured.',
        ],
        examples: [
            'metabot metaapp share --pin-id <pinid>',
            'metabot metaapp share --pin-id <pinid> --announce --from alice',
            'metabot metaapp share --pin-id <pinid> --announce --from alice --chain doge',
        ],
        optionalFlags: [
            { flag: '--announce', description: 'Post a simplebuzz announcement that quotes the MetaApp pin.' },
            FROM_BOT_FLAG,
            CHAIN_WRITE_FLAG,
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['metaapp', 'view'],
        summary: 'Open the local MetaApp gallery, optionally scoped to one actor or one published MetaApp.',
        usage: 'metabot metaapp view [--from <bot-slug>] [--pin-id <pinid>] [--first-pin-id <pinid>] [--mine]',
        requestShape: {
            from: 'optional local MetaBot actor',
            pinId: 'optional version pin selector',
            firstPinId: 'optional stable first-pin selector',
            mine: 'scope the gallery to the selected actor when true',
        },
        successFields: [
            'localUiUrl',
        ],
        failureSemantics: [
            '--pin-id and --first-pin-id are mutually exclusive.',
            '--mine may be combined with --from, but not with --pin-id or --first-pin-id.',
            'Fails with not_implemented until a MetaApp view handler is configured.',
        ],
        examples: [
            'metabot metaapp view --mine --from alice',
            'metabot metaapp view --pin-id <pinid>',
            'metabot metaapp view --first-pin-id <pinid>',
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--pin-id', value: '<pinid>', description: 'Open the gallery focused on one MetaApp version pin.' },
            { flag: '--first-pin-id', value: '<pinid>', description: 'Open the gallery focused on a stable first-pin id.' },
            { flag: '--mine', description: 'Open the gallery scoped to the selected MetaBot actor.' },
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['metaapp', 'comment'],
        summary: 'Post an on-chain paycomment against a published MetaApp pin.',
        usage: 'metabot metaapp comment --pin-id <pinid> --comment <text> [--from <bot-slug>] [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--pin-id', value: '<pinid>', description: 'Published MetaApp pin id to comment on.' },
            { flag: '--comment', value: '<text>', description: 'Comment text to publish.' },
        ],
        requestShape: {
            pinId: 'published MetaApp pin id used as paycomment commentTo',
            comment: 'comment text',
            from: 'optional local MetaBot actor',
            network: 'optional chain network override: mvc, btc, doge, or opcat',
        },
        successFields: [
            'pinId',
            'txids',
            'path',
        ],
        failureSemantics: [
            'Writes /protocols/paycomment with commentTo set to the target MetaApp pin id.',
            'Uses the same write-chain behavior as metabot buzz post and metabot chain write.',
            'Fails with not_implemented until a MetaApp comment handler is configured.',
        ],
        examples: [
            'metabot metaapp comment --pin-id <pinid> --comment "Great demo" --from alice',
            'metabot metaapp comment --pin-id <pinid> --comment "Great demo" --from alice --chain btc',
        ],
        optionalFlags: [FROM_BOT_FLAG, CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['chain'],
        summary: 'Chain write commands for arbitrary MetaID tuple publishing.',
        usage: 'metabot chain <subcommand>',
        subcommands: [
            { name: 'write', summary: 'Write one MetaID tuple or protocol payload to chain.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['chain', 'write'],
        summary: 'Write one arbitrary MetaID tuple using the public chain-write interface.',
        usage: 'metabot chain write [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--request-file', value: '<path>', description: 'JSON request file.' },
        ],
        requestShape: {
            operation: 'create | modify | revoke',
            path: '/protocols/example',
            encryption: '0',
            version: '1.0.0',
            contentType: 'application/json',
            payload: '{"example":true}',
            network: 'optional chain network override: mvc, btc, doge, or opcat',
        },
        successFields: [
            'pinId',
            'txids',
            'path',
        ],
        failureSemantics: [
            'Fails when the local signer cannot build or broadcast the requested chain write.',
        ],
        examples: [
            'metabot chain write --from alice --request-file chain-request.json',
            'metabot chain write --from alice --request-file chain-doge-request.json --chain doge',
            'metabot chain write --from alice --request-file chain-opcat-request.json --chain opcat',
        ],
        optionalFlags: [FROM_BOT_FLAG, CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['wallet'],
        summary: 'Wallet commands for querying local identity balances and sending transfers.',
        usage: 'metabot wallet <subcommand>',
        subcommands: [
            { name: 'balance', summary: 'Query local wallet balances on supported chains.' },
            { name: 'transfer', summary: 'Preview or execute a BTC, SPACE, DOGE, or OPCAT transfer to a target address.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['wallet', 'transfer'],
        summary: 'Preview or execute a BTC, SPACE, DOGE, or OPCAT transfer to a target address. Without --confirm, returns a preview for confirmation. With --confirm, executes the transfer.',
        usage: 'metabot wallet transfer [--from <bot-slug>] --to <address> --amount <amount><UNIT> [--confirm]',
        requiredFlags: [
            { flag: '--to', value: '<address>', description: 'Recipient address.' },
            { flag: '--amount', value: '<amount><UNIT>', description: 'Amount with currency unit: BTC, SPACE, DOGE, or OPCAT (case-insensitive). Example: 0.00001BTC, 1SPACE, 0.01DOGE, 10OPCAT.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--confirm', description: 'Execute the transfer. Omit to preview only.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'txid',
            'explorerUrl',
            'amount',
            'toAddress',
        ],
        failureSemantics: [
            'Returns awaiting_confirmation with preview data (fromAddress, currentBalance, toAddress, amount, estimatedFee) when --confirm is omitted.',
            'Fails with invalid_argument when --to or --amount is missing, or the currency unit is not BTC, SPACE, DOGE, or OPCAT.',
            'Fails with insufficient_balance when total balance (confirmed + unconfirmed) is below amount + estimated fee.',
            'Fails with transfer_broadcast_failed when the network rejects the transaction.',
        ],
        examples: [
            'metabot wallet transfer --from alice --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 0.00001BTC',
            'metabot wallet transfer --from alice --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 0.00001BTC --confirm',
            'metabot wallet transfer --from alice --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 1SPACE --confirm',
            'metabot wallet transfer --from alice --to o1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 10OPCAT',
        ],
    },
    {
        commandPath: ['wallet', 'balance'],
        summary: 'Query local wallet balances for mvc, btc, doge, and opcat. Defaults to all chains.',
        usage: 'metabot wallet balance [--from <bot-slug>] [--chain <all|mvc|btc|doge|opcat>]',
        successFields: [
            'chain',
            'globalMetaId',
            'balances.mvc',
            'balances.btc',
            'balances.doge',
            'balances.opcat',
        ],
        failureSemantics: [
            'Fails when no local identity is loaded or the selected chain balance API is unavailable.',
        ],
        examples: [
            'metabot wallet balance --from alice',
            'metabot wallet balance --from alice --chain btc',
            'metabot wallet balance --from alice --chain doge',
            'metabot wallet balance --from alice --chain opcat',
        ],
        optionalFlags: [FROM_BOT_FLAG, WALLET_CHAIN_ALL_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['network'],
        summary: 'Directory commands for reading online MetaBots, optional service listings, and managing local seed sources.',
        usage: 'metabot network <subcommand>',
        subcommands: [
            { name: 'services', summary: 'List MetaBot services from chain discovery and local fallbacks.' },
            { name: 'bots', summary: 'List online MetaBots from socket presence with service-directory fallback.' },
            { name: 'sources', summary: 'Manage local seeded directory sources.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['network', 'services'],
        summary: 'List yellow-pages services discovered from MetaWeb and optional local source seeds.',
        usage: 'metabot network services [--online]',
        optionalFlags: [
            { flag: '--online', description: 'Return only services whose providers currently appear in the socket online-users directory.' },
            { flag: '--cached', description: 'Search only the local online service cache without refreshing chain data.' },
            { flag: '--query', value: '<text>', description: 'Search cached/refreshed online services by service name, description, provider, skill, rating, and recency.' },
            { flag: '--search', value: '<text>', description: 'Alias for --query.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'services',
        ],
        failureSemantics: [
            'Fails only when the local directory orchestration crashes; chain misses fall back to local seeded sources.',
        ],
        examples: [
            'metabot network services --online',
        ],
    },
    {
        commandPath: ['network', 'bots'],
        summary: 'List online MetaBots from socket presence, with service-directory fallback when presence API is unavailable.',
        usage: 'metabot network bots [--online] [--limit <n>]',
        optionalFlags: [
            { flag: '--online', description: 'Prefer online-only rows. Defaults to true for current public behavior.' },
            { flag: '--limit', value: '<n>', description: 'Maximum rows to return. Supported range: 1-100. Default: 10.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'source',
            'fallbackUsed',
            'total',
            'onlineWindowSeconds',
            'bots',
        ],
        failureSemantics: [
            'Fails when --limit is outside 1-100.',
            'Socket presence read errors auto-fallback to service-directory-based online bot projection.',
        ],
        examples: [
            'metabot network bots --online --limit 20',
        ],
    },
    {
        commandPath: ['network', 'sources'],
        summary: 'Manage local directory source seeds used as explicit fallbacks or demo transport hints.',
        usage: 'metabot network sources <subcommand>',
        subcommands: [
            { name: 'list', summary: 'List local seeded directory sources.' },
            { name: 'add', summary: 'Add one local seeded directory source.' },
            { name: 'remove', summary: 'Remove one local seeded directory source.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['network', 'sources', 'list'],
        summary: 'List currently configured local seeded directory sources.',
        usage: 'metabot network sources list',
        successFields: [
            'sources',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['network', 'sources', 'add'],
        summary: 'Add one local seeded directory source for fallback discovery and demo transport hints.',
        usage: 'metabot network sources add --base-url <url> [--label <label>]',
        requiredFlags: [
            { flag: '--base-url', value: '<url>', description: 'Base URL for the remote directory source.' },
        ],
        optionalFlags: [
            { flag: '--label', value: '<label>', description: 'Optional human-readable label for the source.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'baseUrl',
            'label',
            'totalSources',
        ],
        failureSemantics: [
            'Fails when the base URL is missing or source persistence cannot be updated.',
        ],
        examples: [
            'metabot network sources add --base-url http://127.0.0.1:4827 --label weather-demo',
        ],
    },
    {
        commandPath: ['network', 'sources', 'remove'],
        summary: 'Remove one local seeded directory source.',
        usage: 'metabot network sources remove --base-url <url>',
        requiredFlags: [
            { flag: '--base-url', value: '<url>', description: 'Base URL for the source to remove.' },
        ],
        successFields: [
            'removed',
            'baseUrl',
            'totalSources',
        ],
        failureSemantics: [
            'Fails when the base URL is missing or source persistence cannot be updated.',
        ],
        examples: [
            'metabot network sources remove --base-url http://127.0.0.1:4827',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['services'],
        summary: 'Service commands for provider publish, caller delegation, and buyer-side rating.',
        usage: 'metabot services <subcommand>',
        subcommands: [
            { name: 'publish', summary: 'Publish one paid capability to chain.' },
            { name: 'skills', summary: 'List primary-runtime skills available for service publishing.' },
            { name: 'publish-skills', summary: 'Compatibility alias for services skills.' },
            { name: 'owned', summary: 'List and manage services owned by local MetaBots.' },
            { name: 'orders', summary: 'Inspect seller-side service orders.' },
            { name: 'refunds', summary: 'List and settle service refunds.' },
            { name: 'call', summary: 'Delegate one task to a remote MetaBot service.' },
            { name: 'rate', summary: 'Publish one buyer-side service rating after delivery.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['services', 'publish'],
        summary: 'Publish one service to the chain-backed skill-service directory.',
        usage: 'metabot services publish [--from <bot-slug>] --payload-file <path> [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--payload-file', value: '<path>', description: 'JSON service payload file.' },
        ],
        requestShape: {
            serviceName: 'weather-service',
            displayName: 'Weather Service',
            description: 'Returns one weather result.',
            providerSkill: 'weather-skill',
            price: '0.00005',
            currency: 'SPACE',
            outputType: 'text',
            skillDocument: '# Weather Service',
        },
        successFields: [
            'servicePinId',
            'sourceServicePinId',
            'txids',
            'displayName',
        ],
        failureSemantics: [
            'Fails when no local identity exists, payload validation fails, or the service chain write is rejected.',
        ],
        examples: [
            'metabot services publish --from provider --payload-file service-payload.json',
            'metabot services publish --from provider --payload-file service-doge-payload.json --chain doge',
            'metabot services publish --from provider --payload-file service-opcat-payload.json --chain opcat',
        ],
        optionalFlags: [FROM_BOT_FLAG, CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['services', 'skills'],
        summary: 'Lists skills from one local MetaBot primary runtime only.',
        usage: 'metabot services skills [--from <bot-slug>]',
        successFields: [
            'metaBotSlug',
            'identity',
            'runtime',
            'platform',
            'skills',
            'rootDiagnostics',
        ],
        failureSemantics: [
            'Fails before chain writes when no identity exists, the primary runtime is missing, or the primary runtime is unavailable.',
            'Fallback runtime skills are intentionally excluded from this list.',
        ],
        examples: [
            'metabot services skills',
            'metabot services skills --from alice',
        ],
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['services', 'publish-skills'],
        summary: 'Compatibility alias for `metabot services skills`.',
        usage: 'metabot services publish-skills [--slug <bot-slug>]',
        successFields: [
            'metaBotSlug',
            'identity',
            'runtime',
            'platform',
            'skills',
            'rootDiagnostics',
        ],
        failureSemantics: [
            'Fails before chain writes when no identity exists, the primary runtime is missing, or the primary runtime is unavailable.',
            'Fallback runtime skills are intentionally excluded from this list.',
        ],
        examples: [
            'metabot services publish-skills',
            'metabot services publish-skills --slug alice',
        ],
        optionalFlags: [
            { flag: '--slug', value: '<bot-slug>', description: 'Compatibility actor selector. Prefer --from with `metabot services skills`.' },
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['services', 'owned'],
        summary: 'Owner-side service commands backing the my-services UI.',
        usage: 'metabot services owned <subcommand>',
        subcommands: [
            { name: 'list', summary: 'List services owned by the active, selected, or all local MetaBots.' },
            { name: 'orders', summary: 'List completed/refunded orders for one owned service.' },
            { name: 'modify', summary: 'Publish an on-chain modification for one owned service.' },
            { name: 'revoke', summary: 'Publish an on-chain revocation for one owned service.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['services', 'owned', 'list'],
        summary: 'List services owned by the active, selected, or all local MetaBots.',
        usage: 'metabot services owned list [--from <bot-slug> | --all] [--page <n>] [--page-size <n>] [--refresh]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--all', description: 'Aggregate owned services across all local MetaBot profiles.' },
            { flag: '--page', value: '<n>', description: 'Page number. Defaults to 1.' },
            { flag: '--page-size', value: '<n>', description: 'Page size. Defaults to 20.' },
            { flag: '--refresh', description: 'Refresh rating details before rendering the owner view.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['items', 'page', 'pageSize', 'total', 'totalPages'],
        examples: [
            'metabot services owned list',
            'metabot services owned list --from alice',
            'metabot services owned list --all --refresh',
        ],
    },
    {
        commandPath: ['services', 'owned', 'orders'],
        summary: 'List completed/refunded orders for one owned service.',
        usage: 'metabot services owned orders --service-id <service-pin-id> [--from <bot-slug> | --all] [--page <n>] [--page-size <n>] [--refresh]',
        requiredFlags: [
            { flag: '--service-id', value: '<service-pin-id>', description: 'Current or source service pin id.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--all', description: 'Search all local MetaBot profiles for the service.' },
            { flag: '--page', value: '<n>', description: 'Page number. Defaults to 1.' },
            { flag: '--page-size', value: '<n>', description: 'Page size. Defaults to 20.' },
            { flag: '--refresh', description: 'Refresh rating details before rendering order rows.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['items', 'page', 'pageSize', 'total', 'totalPages'],
        examples: [
            'metabot services owned orders --service-id <service-pin-id>',
            'metabot services owned orders --service-id <service-pin-id> --all',
        ],
    },
    {
        commandPath: ['services', 'owned', 'modify'],
        summary: 'Publish an on-chain modification for one owned service.',
        usage: 'metabot services owned modify [--from <bot-slug>] --payload-file <path> [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--payload-file', value: '<path>', description: 'JSON modification payload, including serviceId.' },
        ],
        optionalFlags: [FROM_BOT_FLAG, CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
        failureSemantics: [
            'Rejects --all because service mutations must choose exactly one local MetaBot actor.',
        ],
        examples: [
            'metabot services owned modify --from alice --payload-file service-update.json --chain btc',
        ],
    },
    {
        commandPath: ['services', 'owned', 'revoke'],
        summary: 'Publish an on-chain revocation for one owned service.',
        usage: 'metabot services owned revoke [--from <bot-slug>] --service-id <service-pin-id> [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--service-id', value: '<service-pin-id>', description: 'Current or source service pin id.' },
        ],
        optionalFlags: [FROM_BOT_FLAG, CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
        failureSemantics: [
            'Rejects --all because service mutations must choose exactly one local MetaBot actor.',
        ],
        examples: [
            'metabot services owned revoke --from alice --service-id <service-pin-id> --chain doge',
        ],
    },
    {
        commandPath: ['services', 'orders'],
        summary: 'Seller-side service order inspection commands.',
        usage: 'metabot services orders <subcommand>',
        subcommands: [
            { name: 'inspect', summary: 'Inspect one seller order by order id or payment txid.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['services', 'orders', 'inspect'],
        summary: 'Inspect one seller-side service order and return service, buyer, status, trace, payment, runtime session, and refund fields.',
        usage: 'metabot services orders inspect [--from <bot-slug>] (--order-id <id> | --payment-txid <txid>)',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--order-id', value: '<id>', description: 'Local seller order id.' },
            { flag: '--payment-txid', value: '<txid>', description: 'Payment txid associated with the seller order.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'order.orderId',
            'order.service',
            'order.buyer',
            'order.status',
            'order.trace',
            'order.payment',
            'order.runtime',
            'order.refund',
        ],
        failureSemantics: [
            'Fails when neither selector is provided, both selectors are provided, or no seller order matches the selector.',
        ],
        examples: [
            'metabot services orders inspect --from seller --order-id seller-order-123',
            'metabot services orders inspect --payment-txid <txid>',
        ],
    },
    {
        commandPath: ['services', 'refunds'],
        summary: 'Refund commands for buyer-initiated and seller-received service refunds.',
        usage: 'metabot services refunds <subcommand>',
        subcommands: [
            { name: 'list', summary: 'List initiated, received, or all service refunds.' },
            { name: 'sync', summary: 'Sync refund request and finalize pins into local state.' },
            { name: 'settle', summary: 'Settle one pending seller refund by order id or payment txid.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['services', 'refunds', 'list'],
        summary: 'List initiated, received, or all service refunds.',
        usage: 'metabot services refunds list [--from <bot-slug> | --all] [--kind <all|initiated|received> | --initiated | --received]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--all', description: 'Aggregate refunds across all local MetaBot profiles when supported by the runtime.' },
            { flag: '--kind', value: '<all|initiated|received>', description: 'Select all refunds, buyer-side initiated refunds, or seller-side received refund requests.' },
            { flag: '--initiated', description: 'Show buyer-side refunds initiated by the selected local MetaBot.' },
            { flag: '--received', description: 'Show seller-side refund requests received by the selected local MetaBot.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['initiatedByMe', 'receivedByMe', 'totalCount', 'pendingCount'],
        examples: [
            'metabot services refunds list --from buyer --initiated',
            'metabot services refunds list --all --received',
        ],
    },
    {
        commandPath: ['services', 'refunds', 'sync'],
        summary: 'Read refund request and finalize pins, retry due buyer requests, and update local refund state.',
        usage: 'metabot services refunds sync [--from <bot-slug> | --all]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--all', description: 'Sync refunds across all local MetaBot profiles when supported by the runtime.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['scanned', 'applied', 'skipped', 'blocked'],
        examples: [
            'metabot services refunds sync',
            'metabot services refunds sync --from seller',
            'metabot services refunds sync --all',
        ],
    },
    {
        commandPath: ['services', 'refunds', 'settle'],
        summary: 'Settle one pending seller refund and return a refund txid, finalization pin, or a machine-readable blocking reason.',
        usage: 'metabot services refunds settle [--from <bot-slug>] (--order-id <id> | --payment-txid <txid>)',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--order-id', value: '<id>', description: 'Local seller order id.' },
            { flag: '--payment-txid', value: '<txid>', description: 'Payment txid associated with the seller order.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'orderId',
            'paymentTxid',
            'refundTxid',
            'refundFinalizePinId',
            'order',
            'settlement',
        ],
        failureSemantics: [
            'Returns manual_action_required with order.refund.blockingReason when settlement is blocked by missing proof, unsupported asset, missing destination address, insufficient balance, transfer failure, or finalization failure.',
        ],
        examples: [
            'metabot services refunds settle --from seller --order-id seller-order-123',
            'metabot services refunds settle --payment-txid <txid>',
        ],
    },
    {
        commandPath: ['provider'],
        summary: 'Compatibility aliases for seller-side service order inspection and refund settlement.',
        usage: 'metabot provider <subcommand>',
        subcommands: [
            { name: 'order', summary: 'Inspect seller-side provider orders.' },
            { name: 'refund', summary: 'Process seller-side refund settlement.' },
        ],
        failureSemantics: [
            'Prefer `metabot services orders inspect` and `metabot services refunds settle` for new automation.',
            'Provider operations resolve the active local MetaBot and fail before settlement when no active identity exists.',
            'Refund settlement returns a machine-readable blocker instead of marking an order refunded without proof.',
        ],
        examples: [
            'metabot provider order inspect --order-id seller-order-123',
            'metabot provider refund settle --payment-txid <txid>',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['provider', 'order'],
        summary: 'Inspect seller-side provider orders.',
        usage: 'metabot provider order <subcommand>',
        subcommands: [
            { name: 'inspect', summary: 'Inspect one seller order by order id or payment txid.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['provider', 'order', 'inspect'],
        summary: 'Compatibility alias for `metabot services orders inspect`.',
        usage: 'metabot provider order inspect [--from <bot-slug>] (--order-id <id> | --payment-txid <txid>)',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--order-id', value: '<id>', description: 'Local seller order id.' },
            { flag: '--payment-txid', value: '<txid>', description: 'Payment txid associated with the seller order.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'order.orderId',
            'order.service',
            'order.buyer',
            'order.status',
            'order.trace',
            'order.payment',
            'order.runtime',
            'order.refund',
        ],
        failureSemantics: [
            'Fails when neither selector is provided, both selectors are provided, or no seller order matches the selector.',
        ],
        examples: [
            'metabot provider order inspect --order-id seller-order-123',
            'metabot provider order inspect --payment-txid <txid>',
        ],
    },
    {
        commandPath: ['provider', 'refund'],
        summary: 'Process seller-side refund settlement.',
        usage: 'metabot provider refund <subcommand>',
        subcommands: [
            { name: 'settle', summary: 'Settle one pending seller refund by order id or payment txid.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['provider', 'refund', 'settle'],
        summary: 'Compatibility alias for `metabot services refunds settle`.',
        usage: 'metabot provider refund settle [--from <bot-slug>] (--order-id <id> | --payment-txid <txid>)',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--order-id', value: '<id>', description: 'Local seller order id.' },
            { flag: '--payment-txid', value: '<txid>', description: 'Payment txid associated with the seller order.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'orderId',
            'paymentTxid',
            'refundTxid',
            'refundFinalizePinId',
            'order',
            'settlement',
        ],
        failureSemantics: [
            'Returns manual_action_required with order.refund.blockingReason when settlement is blocked by missing proof, unsupported asset, missing destination address, insufficient balance, transfer failure, or finalization failure.',
        ],
        examples: [
            'metabot provider refund settle --order-id seller-order-123',
            'metabot provider refund settle --payment-txid <txid>',
        ],
    },
    {
        commandPath: ['services', 'call'],
        summary: 'Delegate one task to a remote MetaBot and keep the result in the current host session.',
        usage: 'metabot services call [--from <bot-slug>] --request-file <path>',
        requiredFlags: [
            { flag: '--request-file', value: '<path>', description: 'JSON request file.' },
        ],
        requestShape: {
            request: {
                servicePinId: 'service-pin-id',
                providerGlobalMetaId: 'gm-provider',
                providerDaemonBaseUrl: 'optional demo transport hint',
                userTask: 'tell me tomorrow fortune',
                taskContext: 'user asked for a one-shot fortune reading',
                spendCap: {
                    amount: '0.00005',
                    currency: 'SPACE',
                },
            },
        },
        successFields: [
            'traceId',
            'paymentTxid',
            'orderPinId',
            'responseText',
            'traceJsonPath',
            'traceMarkdownPath',
            'transcriptMarkdownPath',
        ],
        failureSemantics: [
            'A returned traceId without responseText means the local MetaBot must keep following the same trace.',
            'timeout does not mean failed; the remote MetaBot may still continue and later complete.',
            'manual_action_required means the runtime needs a local UI handoff before the workflow can continue.',
        ],
        examples: [
            'metabot services call --from buyer --request-file request.json',
        ],
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['services', 'rate'],
        summary: 'Publish one buyer-side service rating and optionally deliver a follow-up private message back to the provider.',
        usage: 'metabot services rate [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--request-file', value: '<path>', description: 'JSON request file.' },
        ],
        requestShape: {
            traceId: 'trace-123',
            rate: 5,
            comment: 'Useful result and smooth remote collaboration.',
        },
        successFields: [
            'pinId',
            'traceId',
            'rate',
            'comment',
            'ratingMessageSent',
            'ratingMessagePinId',
        ],
        failureSemantics: [
            'Fails when the trace is missing, not buyer-side, or lacks service/payment metadata required for skill-service-rate.',
            'ratingMessageSent can be false even when the on-chain rating write succeeded.',
        ],
        examples: [
            'metabot services rate --from buyer --request-file rating.json',
            'metabot services rate --from buyer --request-file rating-doge.json --chain doge',
            'metabot services rate --from buyer --request-file rating-opcat.json --chain opcat',
        ],
        optionalFlags: [FROM_BOT_FLAG, CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['chat'],
        summary: 'Private MetaWeb chat commands.',
        usage: 'metabot chat <subcommand>',
        subcommands: [
            { name: 'private', summary: 'Send one encrypted private MetaWeb message to another MetaBot.' },
            { name: 'conversations', summary: 'List local private chat conversations.' },
            { name: 'messages', summary: 'Show messages for one local conversation.' },
            { name: 'auto-reply', summary: 'Manage auto-reply settings (status, enable, disable).' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['chat', 'private'],
        summary: 'Send one encrypted private MetaWeb message to another MetaBot.',
        usage: 'metabot chat private [--from <bot-slug>] --request-file <path> [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--request-file', value: '<path>', description: 'JSON request file.' },
        ],
        requestShape: {
            to: 'remote globalMetaId',
            content: 'message text',
            replyPin: 'optional prior message pin id',
            network: 'optional chain network override: mvc, btc, doge, or opcat',
        },
        successFields: [
            'to',
            'path',
            'pinId',
            'txids',
            'traceId',
            'a2aSessionId',
            'localUiUrl',
        ],
        failureSemantics: [
            'Fails when the local chat secret is missing or the remote MetaBot has no published chat public key.',
            'Fails with chat_broadcast_failed when the simplemsg chain write is rejected.',
        ],
        examples: [
            'metabot chat private --from alice --request-file chat-request.json',
            'metabot chat private --from alice --request-file chat-doge-request.json --chain doge',
            'metabot chat private --from alice --request-file chat-opcat-request.json --chain opcat',
        ],
        optionalFlags: [FROM_BOT_FLAG, CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['chat', 'conversations'],
        summary: 'List local private chat conversations for one MetaBot actor.',
        usage: 'metabot chat conversations [--from <bot-slug>]',
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
        successFields: ['conversations'],
        examples: [
            'metabot chat conversations',
            'metabot chat conversations --from alice',
        ],
    },
    {
        commandPath: ['chat', 'messages'],
        summary: 'Show recent messages for one local private chat conversation.',
        usage: 'metabot chat messages [--from <bot-slug>] --conversation-id <conversation-id> [--limit <n>]',
        requiredFlags: [
            { flag: '--conversation-id', value: '<conversation-id>', description: 'Local private chat conversation id.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--limit', value: '<n>', description: 'Maximum message count. Defaults to 50.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['messages'],
        examples: [
            'metabot chat messages --conversation-id c1',
            'metabot chat messages --from alice --conversation-id c1 --limit 25',
        ],
    },
    {
        commandPath: ['chat', 'auto-reply'],
        summary: 'Manage private chat auto-reply settings.',
        usage: 'metabot chat auto-reply <status|enable|disable>',
        subcommands: [
            { name: 'status', summary: 'Show auto-reply settings for one MetaBot actor.' },
            { name: 'enable', summary: 'Enable auto-reply for one MetaBot actor.' },
            { name: 'disable', summary: 'Disable auto-reply for one MetaBot actor.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['chat', 'auto-reply', 'status'],
        summary: 'Show private chat auto-reply settings for one MetaBot actor.',
        usage: 'metabot chat auto-reply status [--from <bot-slug>]',
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
        successFields: ['enabled', 'acceptPolicy', 'defaultStrategyId'],
        examples: ['metabot chat auto-reply status --from alice'],
    },
    {
        commandPath: ['chat', 'auto-reply', 'enable'],
        summary: 'Enable private chat auto-reply for one MetaBot actor.',
        usage: 'metabot chat auto-reply enable [--from <bot-slug>] [--strategy <strategy-id>]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--strategy', value: '<strategy-id>', description: 'Optional default reply strategy id.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['enabled', 'defaultStrategyId'],
        examples: ['metabot chat auto-reply enable --from alice --strategy default'],
    },
    {
        commandPath: ['chat', 'auto-reply', 'disable'],
        summary: 'Disable private chat auto-reply for one MetaBot actor.',
        usage: 'metabot chat auto-reply disable [--from <bot-slug>]',
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
        successFields: ['enabled', 'defaultStrategyId'],
        examples: ['metabot chat auto-reply disable --from alice'],
    },
    {
        commandPath: ['trace'],
        summary: 'Trace commands for following remote delegation progress and inspecting final artifacts.',
        usage: 'metabot trace <subcommand>',
        subcommands: [
            { name: 'sessions', summary: 'List trace-capable A2A sessions.' },
            { name: 'watch', summary: 'Stream public status events for one trace as NDJSON.' },
            { name: 'get', summary: 'Read the full structured trace and export paths.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['trace', 'sessions'],
        summary: 'List trace-capable A2A sessions.',
        usage: 'metabot trace sessions [--from <bot-slug> | --all] [--limit <n>]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--all', description: 'Aggregate sessions across all local MetaBot profiles.' },
            { flag: '--limit', value: '<n>', description: 'Maximum session count. Defaults to 50.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['sessions', 'stats'],
        examples: [
            'metabot trace sessions --from alice --limit 20',
            'metabot trace sessions --all --limit 50',
        ],
    },
    {
        commandPath: ['trace', 'watch'],
        summary: 'Stream public status events for one trace as NDJSON until the watch completes.',
        usage: 'metabot trace watch [--from <bot-slug>] --trace-id <trace-id>',
        requiredFlags: [
            { flag: '--trace-id', value: '<trace-id>', description: 'Trace identifier returned by a remote service call.' },
        ],
        successFields: [
            'Writes NDJSON status events directly to stdout.',
        ],
        failureSemantics: [
            'A watch can emit timeout and later remote_received or completed in the same follow-up; do not stop at the first timeout line if the command is still running.',
        ],
        examples: [
            'metabot trace watch --from alice --trace-id trace-123',
        ],
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['trace', 'get'],
        summary: 'Read the full structured trace or exact A2A session record plus exported transcript and inspector evidence paths.',
        usage: 'metabot trace get [--from <bot-slug>] (--trace-id <trace-id> | --session-id <session-id>)',
        requiredFlags: [
            { flag: '--trace-id', value: '<trace-id>', description: 'Trace identifier returned by a remote service call. Required when --session-id is not provided.' },
            { flag: '--session-id', value: '<session-id>', description: 'A2A session identifier returned by a private chat or service call. Required when --trace-id is not provided.' },
        ],
        successFields: [
            'traceId',
            'sessionId',
            'session',
            'order',
            'orderPinId',
            'orderTxid',
            'orderTxids',
            'paymentTxid',
            'a2a',
            'artifacts',
            'inspector',
            'localUiUrl',
        ],
        failureSemantics: [
            'Fails when neither selector is provided.',
            'Fails when the traceId or sessionId is unknown in the local runtime state.',
        ],
        examples: [
            'metabot trace get --from alice --trace-id trace-123',
            'metabot trace get --from alice --session-id session-a2a-123',
        ],
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['system'],
        summary: 'System lifecycle commands for local runtime update and uninstall.',
        usage: 'metabot system <subcommand>',
        subcommands: [
            { name: 'update', summary: 'Update Open Agent Connect and rerun registry-driven platform binding.' },
            { name: 'uninstall', summary: 'Run safe uninstall by default, with optional full erase.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
        examples: [
            'metabot system update',
            'metabot system update --host codex',
            'metabot system uninstall',
            'metabot system uninstall --all --confirm-token DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS',
        ],
    },
    {
        commandPath: ['system', 'update'],
        summary: 'Update Open Agent Connect. Defaults to npm-first package update and registry-driven oac install.',
        usage: 'metabot system update [--host <codex|claude-code|openclaw|zcode|workbuddy>] [--target-version <tag>] [--dry-run]',
        optionalFlags: [
            { flag: '--host', value: '<codex|claude-code|openclaw|zcode|workbuddy>', description: 'Legacy release-pack update target. Omit for npm-first 14-platform registry update.' },
            { flag: '--target-version', value: '<tag>', description: 'Optional explicit version. npm mode accepts tags such as latest or v0.2.7.' },
            { flag: '--dry-run', description: 'Print the update plan without downloading, installing, or rebinding.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'updateMode',
            'host',
            'requestedVersion',
            'resolvedVersion',
            'previousVersion',
            'outcome',
            'packageSpec',
            'downloadUrl',
            'installpackPath',
            'dryRun',
        ],
        failureSemantics: [
            'Without --host, runs npm i -g open-agent-connect@<version> and then oac install so registry roots for all supported platforms are rebound.',
            'With --host, uses the legacy release-pack updater for codex, claude-code, openclaw, zcode, or workbuddy only.',
            'Fails with download_failed, install_artifact_invalid, or install_failed when the update execution cannot complete.',
        ],
        examples: [
            'metabot system update',
            'metabot system update --host codex',
            'metabot system update --host claude-code --target-version v0.2.1',
            'metabot system update --dry-run',
        ],
    },
    {
        commandPath: ['system', 'uninstall'],
        summary: 'Uninstall Open Agent Connect runtime assets. Default mode is safe and preserves identity and wallet-sensitive data.',
        usage: 'metabot system uninstall [--all --confirm-token <token>] [--yes]',
        optionalFlags: [
            { flag: '--all', description: 'Run full erase mode (danger zone). Requires --confirm-token.' },
            { flag: '--confirm-token', value: '<token>', description: 'Required for --all. Use DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS.' },
            { flag: '--yes', description: 'Skip non-critical prompts for safe uninstall mode.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'tier',
            'removedHostBindings',
            'removedCliShim',
            'daemonStopAttempted',
            'daemonStopped',
            'preservedSensitiveData',
        ],
        failureSemantics: [
            'Default uninstall preserves identity profiles, mnemonics, private keys, and wallet-related local data.',
            'Returns manual_action_required with confirmation_required when --all is provided without --confirm-token.',
            'Fails with invalid_confirmation_token when --all confirmation token is not exact.',
        ],
        examples: [
            'metabot system uninstall',
            'metabot system uninstall --all --confirm-token DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS',
        ],
    },
    {
        commandPath: ['browser'],
        summary: 'Open the dedicated Agent Internet Browser UI and optional deep links.',
        usage: 'metabot browser <subcommand>',
        subcommands: [
            { name: 'open', summary: 'Open the Agent Internet Browser page, optionally deep-linked to one resource URI.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['browser', 'open'],
        summary: 'Open the dedicated Agent Internet Browser page, optionally deep-linked to one Browser resource URI.',
        usage: 'metabot browser open [--uri <resource-uri>]',
        optionalFlags: [
            {
                flag: '--uri',
                value: '<resource-uri>',
                description: 'Optional Browser resource URI to preload, such as metaid://<globalMetaId>, metaid://sunnyfung.eth, metaapp://<pinId>, metafile://<pinId>.png, or pin://<pinId>.',
            },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'localUiUrl',
        ],
        failureSemantics: [
            'Fails when --uri is provided without a non-empty value or the local daemon cannot build the browser URL.',
        ],
        examples: [
            'metabot browser open',
            'metabot browser open --uri metaid://<globalMetaId>',
            'metabot browser open --uri metaid://sunnyfung.eth',
            'metabot browser open --uri metaapp://<pinId>',
            'metabot browser open --uri metafile://<pinId>.png',
            'metabot browser open --uri pin://<pinId>',
        ],
    },
    {
        commandPath: ['ui'],
        summary: 'Open local human-only HTML pages backed by the same daemon state as the CLI.',
        usage: 'metabot ui <subcommand>',
        subcommands: [
            { name: 'open', summary: 'Open one local MetaBot runtime page in the browser.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['ui', 'open'],
        summary: 'Open one local MetaBot runtime HTML page such as bot, conversations, services, apps, settings, hub, buzz, chat, publish, my-services, trace, or refund.',
        usage: 'metabot ui open --page <page> [--from <bot-slug>] [--trace-id <trace-id>] [--session-id <session-id>] [--service-id <service-pin-id>]',
        requiredFlags: [
            { flag: '--page', value: '<page>', description: 'Built-in page name: bot, conversations, services, apps, settings, hub, buzz, chat, publish, my-services, trace, or refund.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--trace-id', value: '<trace-id>', description: 'Optional trace identifier for trace page deep links.' },
            { flag: '--session-id', value: '<session-id>', description: 'A2A session identifier for trace page deep links.' },
            { flag: '--service-id', value: '<service-pin-id>', description: 'Owned service selector for my-services pages.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'localUiUrl',
            'page',
        ],
        failureSemantics: [
            'Fails when the requested page is unknown or the local daemon cannot build the page URL.',
        ],
        examples: [
            'metabot ui open --page hub',
            'metabot ui open --page services',
            'metabot ui open --page conversations --from alice',
            'metabot ui open --page settings',
            'metabot ui open --page buzz',
            'metabot ui open --page chat',
            'metabot ui open --page apps',
            'metabot ui open --page trace --from alice --trace-id trace-123',
            'metabot ui open --page publish --from alice',
            'metabot ui open --page my-services --service-id <service-pin-id>',
        ],
    },
    {
        commandPath: ['llm'],
        summary: 'Discover local LLM runtimes and manage MetaBot-to-LLM bindings. Use --from as the canonical actor selector; --slug remains a compatibility alias where accepted.',
        usage: 'metabot llm <subcommand>',
        subcommands: [
            { name: 'list-runtimes', summary: 'List all discovered LLM runtimes on this machine.' },
            { name: 'discover', summary: 'Scan available LLM provider CLIs and register responsive runtimes.' },
            { name: 'bindings', summary: 'List LLM bindings for a MetaBot profile.' },
            { name: 'bind', summary: 'Create or update a binding between a MetaBot and an LLM runtime.' },
            { name: 'unbind', summary: 'Remove a specific LLM binding by id.' },
            { name: 'set-preferred', summary: 'Set the preferred LLM runtime for a MetaBot profile.' },
            { name: 'get-preferred', summary: 'Get the preferred LLM runtime for a MetaBot profile.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
        examples: [
            'metabot llm discover',
            'metabot llm list-runtimes',
            'metabot llm bind --from my-bot --runtime-id llm_claude_code_0 --role primary',
            'metabot llm bindings --from my-bot',
            'metabot llm bindings --slug my-bot',
        ],
    },
    {
        commandPath: ['llm', 'list-runtimes'],
        summary: 'List all discovered LLM runtimes on this machine.',
        usage: 'metabot llm list-runtimes',
        successFields: ['runtimes'],
        examples: ['metabot llm list-runtimes'],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['llm', 'discover'],
        summary: 'Scan local LLM provider CLIs and register responsive runtimes.',
        usage: 'metabot llm discover',
        successFields: ['runtimes'],
        examples: ['metabot llm discover'],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['llm', 'bindings'],
        summary: 'List LLM bindings for one MetaBot profile. Omit --from to use the active identity.',
        usage: 'metabot llm bindings [--from <bot-slug>]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--slug', value: '<bot-slug>', description: 'Compatibility alias for --from.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['version', 'bindings'],
        examples: [
            'metabot llm bindings --from my-bot',
            'metabot llm bindings',
        ],
    },
    {
        commandPath: ['llm', 'bind'],
        summary: 'Create or update a binding between one MetaBot profile and one discovered LLM runtime.',
        usage: 'metabot llm bind [--from <bot-slug>] --runtime-id <runtime-id> [--role <role>] [--priority <n>]',
        requiredFlags: [
            { flag: '--runtime-id', value: '<runtime-id>', description: 'Discovered LLM runtime identifier to bind.' },
        ],
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--slug', value: '<bot-slug>', description: 'Compatibility alias for --from.' },
            { flag: '--role', value: '<role>', description: 'Binding role: primary, fallback, reviewer, or specialist. Defaults to primary.' },
            { flag: '--priority', value: '<n>', description: 'Non-negative priority for bindings with the same role. Defaults to 0.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['version', 'bindings'],
        examples: [
            'metabot llm bind --from my-bot --runtime-id llm_codex_0 --role primary',
            'metabot llm bind --runtime-id llm_claude_code_0 --role fallback',
        ],
    },
    {
        commandPath: ['llm', 'unbind'],
        summary: 'Remove one LLM binding from the selected MetaBot profile. Omit --from to use the active identity.',
        usage: 'metabot llm unbind [--from <bot-slug>] --binding-id <binding-id>',
        requiredFlags: [
            { flag: '--binding-id', value: '<binding-id>', description: 'Binding identifier to remove.' },
        ],
        optionalFlags: [FROM_BOT_FLAG, HELP_JSON_FLAG],
        successFields: ['version', 'bindings'],
        examples: [
            'metabot llm unbind --from my-bot --binding-id lb_my-bot_llm_codex_0_primary',
        ],
    },
    {
        commandPath: ['llm', 'set-preferred'],
        summary: 'Set or clear the preferred LLM runtime for one MetaBot profile.',
        usage: 'metabot llm set-preferred [--from <bot-slug>] [--runtime-id <runtime-id>]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--slug', value: '<bot-slug>', description: 'Compatibility alias for --from.' },
            { flag: '--runtime-id', value: '<runtime-id>', description: 'Preferred runtime identifier. Omit to clear the preference.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['runtimeId'],
        examples: [
            'metabot llm set-preferred --from my-bot --runtime-id llm_codex_0',
            'metabot llm set-preferred',
        ],
    },
    {
        commandPath: ['llm', 'get-preferred'],
        summary: 'Read the preferred LLM runtime for one MetaBot profile. Omit --from to use the active identity.',
        usage: 'metabot llm get-preferred [--from <bot-slug>]',
        optionalFlags: [
            FROM_BOT_FLAG,
            { flag: '--slug', value: '<bot-slug>', description: 'Compatibility alias for --from.' },
            HELP_JSON_FLAG,
        ],
        successFields: ['runtimeId'],
        examples: [
            'metabot llm get-preferred --from my-bot',
            'metabot llm get-preferred',
        ],
    },
];
