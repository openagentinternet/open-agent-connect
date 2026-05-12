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
const FILE_UPLOAD_CHAIN_FLAG = {
    flag: '--chain',
    value: '<mvc|btc|opcat>',
    description: `Optional chain network override: mvc, btc, or opcat. ${CONFIGURED_WRITE_NETWORK_TEXT} DOGE is not supported for file upload.`,
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
        { name: 'config', summary: 'Read or change supported public runtime switches.' },
        { name: 'doctor', summary: 'Check daemon health, identity state, and local runtime readiness.' },
        { name: 'daemon', summary: 'Start or stop the local MetaBot daemon process.' },
        { name: 'file', summary: 'Upload local files to MetaWeb.' },
        { name: 'buzz', summary: 'Publish simplebuzz posts to MetaWeb.' },
        { name: 'chain', summary: 'Write arbitrary MetaID tuples and protocol payloads on-chain.' },
        { name: 'wallet', summary: 'Inspect local wallet balances across supported chains.' },
        { name: 'network', summary: 'Inspect the MetaWeb yellow-pages directory and local source seeds.' },
        { name: 'master', summary: 'Publish, discover, ask, and inspect Ask Master flows.' },
        { name: 'services', summary: 'Publish, call, and rate remote MetaBot services.' },
        { name: 'provider', summary: 'Inspect local provider orders and settle seller-side refunds.' },
        { name: 'chat', summary: 'Send encrypted private MetaWeb messages to another MetaBot.' },
        { name: 'host', summary: 'Project shared MetaBot skills into one host-native skills root.' },
        { name: 'trace', summary: 'Watch or inspect structured remote delegation traces.' },
        { name: 'ui', summary: 'Open local human-only HTML pages backed by the MetaBot runtime.' },
        { name: 'skills', summary: 'Resolve shared-default or host-specific skill contracts for install/runtime use.' },
        { name: 'system', summary: 'Update or uninstall local Open Agent Connect runtime assets.' },
        { name: 'llm', summary: 'Discover local LLM runtimes and manage MetaBot-to-LLM bindings.' },
    ],
    optionalFlags: [VERSION_FLAG, HELP_JSON_FLAG],
    examples: [
        'metabot --version',
        'metabot config get askMaster.enabled',
        'metabot services call --help',
        'metabot chat private --help --json',
    ],
};
const COMMAND_HELP_SPECS = [
    exports.ROOT_COMMAND_HELP,
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
        summary: 'Read or change supported public runtime switches such as Ask Master availability and default write network.',
        usage: 'metabot config <subcommand>',
        subcommands: [
            { name: 'get', summary: 'Read one supported config key from the active local runtime home.' },
            { name: 'set', summary: 'Persist one supported config key for the active local runtime home.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
        examples: [
            'metabot config get chain.defaultWriteNetwork',
            'metabot config set chain.defaultWriteNetwork opcat',
            'metabot config get askMaster.enabled',
            'metabot config get a2a.simplemsgListenerEnabled',
            'metabot config set askMaster.triggerMode suggest',
        ],
    },
    {
        commandPath: ['config', 'get'],
        summary: 'Read one supported public config key such as the default write network, Ask Master availability, or trigger mode.',
        usage: 'metabot config get <key>',
        successFields: [
            'key',
            'value',
        ],
        failureSemantics: [
            'Fails with missing_argument when the config key is omitted.',
            'Fails with unsupported_config_key when the requested key is not in the public CLI allowlist.',
        ],
        examples: [
            'metabot config get chain.defaultWriteNetwork',
            'metabot config get askMaster.enabled',
            'metabot config get askMaster.triggerMode',
            'metabot config get a2a.simplemsgListenerEnabled',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['config', 'set'],
        summary: 'Persist one supported public config key. Ask Master trigger mode is intentionally limited to manual or suggest for the current release.',
        usage: 'metabot config set <key> <value>',
        successFields: [
            'key',
            'value',
        ],
        failureSemantics: [
            'Fails with missing_argument when the key or value is omitted.',
            'Fails with unsupported_config_key when the requested key is not in the public CLI allowlist.',
            'Fails when chain.defaultWriteNetwork is not one of mvc, btc, doge, or opcat.',
            'Fails when askMaster.triggerMode is not one of `manual` or `suggest`.',
        ],
        examples: [
            'metabot config set chain.defaultWriteNetwork opcat',
            'metabot config set askMaster.enabled false',
            'metabot config set a2a.simplemsgListenerEnabled false',
            'metabot config set askMaster.triggerMode suggest',
        ],
        optionalFlags: [HELP_JSON_FLAG],
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
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['file', 'upload'],
        summary: 'Upload one local file to MetaWeb and return the resulting metafile URI.',
        usage: 'metabot file upload --request-file <path> [--chain <mvc|btc|opcat>]',
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
            'metabot file upload --request-file file-request.json',
            'metabot file upload --request-file file-opcat-request.json --chain opcat',
        ],
        optionalFlags: [FILE_UPLOAD_CHAIN_FLAG, HELP_JSON_FLAG],
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
        usage: 'metabot buzz post --request-file <path> [--chain <mvc|btc|doge|opcat>]',
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
            'metabot buzz post --request-file buzz-request.json',
            'metabot buzz post --request-file buzz-doge-request.json --chain doge',
            'metabot buzz post --request-file buzz-opcat-request.json --chain opcat',
        ],
        optionalFlags: [CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
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
        usage: 'metabot chain write --request-file <path> [--chain <mvc|btc|doge|opcat>]',
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
            'metabot chain write --request-file chain-request.json',
            'metabot chain write --request-file chain-doge-request.json --chain doge',
            'metabot chain write --request-file chain-opcat-request.json --chain opcat',
        ],
        optionalFlags: [CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
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
        usage: 'metabot wallet transfer --to <address> --amount <amount><UNIT> [--confirm]',
        requiredFlags: [
            { flag: '--to', value: '<address>', description: 'Recipient address.' },
            { flag: '--amount', value: '<amount><UNIT>', description: 'Amount with currency unit: BTC, SPACE, DOGE, or OPCAT (case-insensitive). Example: 0.00001BTC, 1SPACE, 0.01DOGE, 10OPCAT.' },
        ],
        optionalFlags: [
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
            'metabot wallet transfer --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 0.00001BTC',
            'metabot wallet transfer --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 0.00001BTC --confirm',
            'metabot wallet transfer --to 1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 1SPACE --confirm',
            'metabot wallet transfer --to o1EX5NN6npyCp3X6Sv4Yahv6DrBNKRtq4Gw --amount 10OPCAT',
        ],
    },
    {
        commandPath: ['wallet', 'balance'],
        summary: 'Query local wallet balances for mvc, btc, doge, and opcat. Defaults to all chains.',
        usage: 'metabot wallet balance [--chain <all|mvc|btc|doge|opcat>]',
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
            'metabot wallet balance',
            'metabot wallet balance --chain btc',
            'metabot wallet balance --chain doge',
            'metabot wallet balance --chain opcat',
        ],
        optionalFlags: [WALLET_CHAIN_ALL_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['master'],
        summary: 'Ask Master commands for publishing, discovering, asking, and tracing remote masters.',
        usage: 'metabot master <subcommand>',
        subcommands: [
            { name: 'publish', summary: 'Publish one master-service record to the chain-backed directory.' },
            { name: 'list', summary: 'List discoverable master-service entries for the current host.' },
            { name: 'ask', summary: 'Preview or confirm one Ask Master request.' },
            { name: 'suggest', summary: 'Evaluate one host-visible stuck/risk frame and surface a suggest result.' },
            { name: 'host-action', summary: 'Bridge one host-facing Ask Master action into the existing runtime.' },
            { name: 'trace', summary: 'Inspect one Ask Master trace by trace id.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['master', 'publish'],
        summary: 'Publish one master-service payload for a remote master/provider.',
        usage: 'metabot master publish --payload-file <path> [--chain <mvc|btc|doge|opcat>]',
        requiredFlags: [
            { flag: '--payload-file', value: '<path>', description: 'JSON master-service payload file.' },
        ],
        examples: [
            'metabot master publish --payload-file master-payload.json',
            'metabot master publish --payload-file master-doge-payload.json --chain doge',
            'metabot master publish --payload-file master-opcat-payload.json --chain opcat',
        ],
        optionalFlags: [CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['master', 'list'],
        summary: 'List master-service directory entries visible to the current host runtime.',
        usage: 'metabot master list [--online] [--kind <kind>]',
        optionalFlags: [
            { flag: '--online', description: 'Return only currently online masters.' },
            { flag: '--kind', value: '<kind>', description: 'Filter by master kind, such as debug.' },
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['master', 'ask'],
        summary: 'Preview or confirm one Ask Master request from a request file or pending trace.',
        usage: 'metabot master ask --request-file <path> | metabot master ask --trace-id <trace-id> [--confirm]',
        requiredFlags: [
            {
                flag: '--request-file | --trace-id',
                value: '<path|trace-id>',
                description: 'Provide either a new request draft file or an existing pending Ask Master trace id.',
            },
        ],
        optionalFlags: [
            { flag: '--confirm', description: 'Send a previously previewed Ask Master request. Only valid together with `--trace-id`.' },
            HELP_JSON_FLAG,
        ],
    },
    {
        commandPath: ['master', 'suggest'],
        summary: 'Evaluate one host-visible Ask Master suggest request through the runtime trigger engine.',
        usage: 'metabot master suggest --request-file <path>',
        requiredFlags: [
            {
                flag: '--request-file',
                value: '<path>',
                description: 'JSON suggest request file containing draft plus host observation.',
            },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['master', 'host-action'],
        summary: 'Run one host-facing Ask Master action such as manual_ask or accept_suggest through the local runtime bridge.',
        usage: 'metabot master host-action --request-file <path>',
        requiredFlags: [
            {
                flag: '--request-file',
                value: '<path>',
                description: 'JSON host-action request file.',
            },
        ],
        examples: [
            'metabot master host-action --request-file master-manual-ask.json',
            'metabot master host-action --request-file master-accept-suggest.json',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['master', 'trace'],
        summary: 'Inspect one Ask Master trace record.',
        usage: 'metabot master trace --id <trace-id>',
        requiredFlags: [
            { flag: '--id', value: '<trace-id>', description: 'Ask Master trace id.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['network'],
        summary: 'Directory commands for reading online MetaBot services and managing local seed sources.',
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
            { name: 'publish-skills', summary: 'List primary-runtime skills available for service publishing.' },
            { name: 'call', summary: 'Delegate one task to a remote MetaBot service.' },
            { name: 'rate', summary: 'Publish one buyer-side service rating after delivery.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['services', 'publish'],
        summary: 'Publish one service to the chain-backed skill-service directory.',
        usage: 'metabot services publish --payload-file <path> [--chain <mvc|btc|doge|opcat>]',
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
            'metabot services publish --payload-file service-payload.json',
            'metabot services publish --payload-file service-doge-payload.json --chain doge',
            'metabot services publish --payload-file service-opcat-payload.json --chain opcat',
        ],
        optionalFlags: [CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['services', 'publish-skills'],
        summary: 'Lists skills from the active MetaBot primary runtime only.',
        usage: 'metabot services publish-skills',
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
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['provider'],
        summary: 'Provider operations for local seller-side order inspection and refund settlement.',
        usage: 'metabot provider <subcommand>',
        subcommands: [
            { name: 'order', summary: 'Inspect seller-side provider orders.' },
            { name: 'refund', summary: 'Process seller-side refund settlement.' },
        ],
        failureSemantics: [
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
        summary: 'Inspect one seller-side provider order and return service, buyer, status, trace, payment, runtime session, and refund fields.',
        usage: 'metabot provider order inspect (--order-id <id> | --payment-txid <txid>)',
        optionalFlags: [
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
        summary: 'Settle one pending seller refund and return a refund txid, finalization pin, or a machine-readable blocking reason.',
        usage: 'metabot provider refund settle (--order-id <id> | --payment-txid <txid>)',
        optionalFlags: [
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
        usage: 'metabot services call --request-file <path>',
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
            'metabot services call --request-file request.json',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['services', 'rate'],
        summary: 'Publish one buyer-side service rating and optionally deliver a follow-up private message back to the provider.',
        usage: 'metabot services rate --request-file <path> [--chain <mvc|btc|doge|opcat>]',
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
            'metabot services rate --request-file rating.json',
            'metabot services rate --request-file rating-doge.json --chain doge',
            'metabot services rate --request-file rating-opcat.json --chain opcat',
        ],
        optionalFlags: [CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
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
        usage: 'metabot chat private --request-file <path> [--chain <mvc|btc|doge|opcat>]',
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
            'metabot chat private --request-file chat-request.json',
            'metabot chat private --request-file chat-doge-request.json --chain doge',
            'metabot chat private --request-file chat-opcat-request.json --chain opcat',
        ],
        optionalFlags: [CHAIN_WRITE_FLAG, HELP_JSON_FLAG],
    },
    {
        commandPath: ['trace'],
        summary: 'Trace commands for following remote delegation progress and inspecting final artifacts.',
        usage: 'metabot trace <subcommand>',
        subcommands: [
            { name: 'watch', summary: 'Stream public status events for one trace as NDJSON.' },
            { name: 'get', summary: 'Read the full structured trace and export paths.' },
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['trace', 'watch'],
        summary: 'Stream public status events for one trace as NDJSON until the watch completes.',
        usage: 'metabot trace watch --trace-id <trace-id>',
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
            'metabot trace watch --trace-id trace-123',
        ],
        optionalFlags: [HELP_JSON_FLAG],
    },
    {
        commandPath: ['trace', 'get'],
        summary: 'Read the full structured trace or exact A2A session record plus exported transcript and inspector evidence paths.',
        usage: 'metabot trace get --trace-id <trace-id> | metabot trace get --session-id <session-id>',
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
            'metabot trace get --trace-id trace-123',
            'metabot trace get --session-id session-a2a-123',
        ],
        optionalFlags: [HELP_JSON_FLAG],
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
        usage: 'metabot system update [--host <codex|claude-code|openclaw>] [--target-version <tag>] [--dry-run]',
        optionalFlags: [
            { flag: '--host', value: '<codex|claude-code|openclaw>', description: 'Legacy release-pack update target. Omit for npm-first 11-platform registry update.' },
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
            'With --host, uses the legacy release-pack updater for codex, claude-code, or openclaw only.',
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
        summary: 'Open one local MetaBot runtime HTML page such as hub, buzz, chat, publish, my-services, trace, or refund.',
        usage: 'metabot ui open --page <page> [--trace-id <trace-id>]',
        requiredFlags: [
            { flag: '--page', value: '<page>', description: 'Built-in page name: hub, buzz, chat, publish, my-services, trace, or refund.' },
        ],
        optionalFlags: [
            { flag: '--trace-id', value: '<trace-id>', description: 'Trace identifier required by the trace page.' },
            HELP_JSON_FLAG,
        ],
        successFields: [
            'url',
            'page',
        ],
        failureSemantics: [
            'Fails when the requested page is unknown or the local daemon cannot build the page URL.',
        ],
        examples: [
            'metabot ui open --page hub',
            'metabot ui open --page buzz',
            'metabot ui open --page chat',
            'metabot ui open --page trace --trace-id trace-123',
        ],
    },
    {
        commandPath: ['llm'],
        summary: 'Discover local LLM runtimes and manage MetaBot-to-LLM bindings.',
        usage: 'metabot llm <subcommand>',
        subcommands: [
            { name: 'list-runtimes', summary: 'List all discovered LLM runtimes on this machine.' },
            { name: 'discover', summary: 'Scan PATH for available LLM runtimes (claude, codex, openclaw) and register them.' },
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
            'metabot llm bind --slug my-bot --runtime-id llm_claude_code_0 --role primary',
            'metabot llm bindings --slug my-bot',
        ],
    },
];
