import { commandSuccess, type MetabotCommandResult } from '../core/contracts/commandResult';
import type { CliRuntimeContext } from './types';

export interface CommandHelpFlag {
  flag: string;
  value?: string;
  description: string;
}

export interface CommandHelpSubcommand {
  name: string;
  summary: string;
}

export interface CommandHelpSpec {
  commandPath: string[];
  summary: string;
  usage: string;
  subcommands?: CommandHelpSubcommand[];
  requiredFlags?: CommandHelpFlag[];
  optionalFlags?: CommandHelpFlag[];
  requestShape?: Record<string, unknown>;
  successFields?: string[];
  failureSemantics?: string[];
  examples?: string[];
}

function formatFlag(flag: CommandHelpFlag): string {
  return [flag.flag, flag.value].filter(Boolean).join(' ');
}

function renderFlagSection(title: string, flags?: CommandHelpFlag[]): string[] {
  if (!flags?.length) {
    return [];
  }

  return [
    `${title}:`,
    ...flags.map((flag) => `  ${formatFlag(flag)}  ${flag.description}`),
  ];
}

function renderListSection(title: string, values?: string[]): string[] {
  if (!values?.length) {
    return [];
  }

  return [
    `${title}:`,
    ...values.map((value) => `- ${value}`),
  ];
}

function renderSubcommandSection(spec: CommandHelpSpec): string[] {
  if (!spec.subcommands?.length) {
    return [];
  }

  return [
    'Commands:',
    ...spec.subcommands.map((subcommand) => `  ${subcommand.name}  ${subcommand.summary}`),
  ];
}

function renderJsonSection(title: string, payload?: Record<string, unknown>): string[] {
  if (!payload) {
    return [];
  }

  return [
    `${title}:`,
    JSON.stringify(payload, null, 2),
  ];
}

export function renderCommandHelp(spec: CommandHelpSpec): string {
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

function rawStdoutHandledResult(): MetabotCommandResult<unknown> & {
  __rawStdoutHandled?: boolean;
} {
  const result = commandSuccess({ help: true }) as MetabotCommandResult<unknown> & {
    __rawStdoutHandled?: boolean;
  };
  result.__rawStdoutHandled = true;
  return result;
}

export function helpRequested(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

export function helpJsonRequested(args: string[]): boolean {
  return args.includes('--json');
}

function positionalCommandPath(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith('-'));
}

export function resolveCommandHelpSpec(args: string[]): CommandHelpSpec | null {
  const path = positionalCommandPath(args);

  let best: CommandHelpSpec | null = null;
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

export function writeResolvedHelp(
  context: CliRuntimeContext,
  args: string[]
): MetabotCommandResult<unknown> & { __rawStdoutHandled?: boolean } {
  const spec = resolveCommandHelpSpec(args) ?? ROOT_COMMAND_HELP;
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

const HELP_JSON_FLAG: CommandHelpFlag = {
  flag: '--json',
  description: 'Emit machine-readable help JSON instead of text.',
};

export const ROOT_COMMAND_HELP: CommandHelpSpec = {
  commandPath: [],
  summary: 'Machine-first MetaBot CLI for local runtime, chain write, remote delegation, and local inspection.',
  usage: 'metabot <command>',
  subcommands: [
    { name: 'identity', summary: 'Create the local MetaBot identity and bootstrap chain state.' },
    { name: 'doctor', summary: 'Check daemon health, identity state, and local runtime readiness.' },
    { name: 'daemon', summary: 'Start the local MetaBot daemon process.' },
    { name: 'file', summary: 'Upload local files to MetaWeb.' },
    { name: 'buzz', summary: 'Publish simplebuzz posts to MetaWeb.' },
    { name: 'chain', summary: 'Write arbitrary MetaID tuples and protocol payloads on-chain.' },
    { name: 'network', summary: 'Inspect the MetaWeb yellow-pages directory and local source seeds.' },
    { name: 'services', summary: 'Publish, call, and rate remote MetaBot services.' },
    { name: 'chat', summary: 'Send encrypted private MetaWeb messages to another MetaBot.' },
    { name: 'trace', summary: 'Watch or inspect structured remote delegation traces.' },
    { name: 'ui', summary: 'Open local human-only MetaBot HTML pages.' },
  ],
  optionalFlags: [HELP_JSON_FLAG],
  examples: [
    'metabot services call --help',
    'metabot chat private --help --json',
  ],
};

const COMMAND_HELP_SPECS: CommandHelpSpec[] = [
  ROOT_COMMAND_HELP,
  {
    commandPath: ['identity'],
    summary: 'Identity commands for creating, listing, and switching local MetaBot profiles.',
    usage: 'metabot identity <subcommand>',
    subcommands: [
      { name: 'create', summary: 'Create a local MetaBot from a human-provided name.' },
      { name: 'who', summary: 'Show which local MetaBot is currently active.' },
      { name: 'list', summary: 'List local MetaBot profiles discovered on this machine.' },
      { name: 'assign', summary: 'Switch the active local MetaBot profile by name.' },
    ],
    optionalFlags: [HELP_JSON_FLAG],
  },
  {
    commandPath: ['identity', 'create'],
    summary: 'Create one local MetaBot and complete the validated bootstrap flow for the current active home.',
    usage: 'metabot identity create --name <display-name>',
    requiredFlags: [
      { flag: '--name', value: '<display-name>', description: 'Human-facing name for the new local MetaBot.' },
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
      'metabot identity create --name "Alice"',
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
    summary: 'List local MetaBot profiles on this machine and report the current active home.',
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
    summary: 'Switch the active local MetaBot profile by display name.',
    usage: 'metabot identity assign --name <display-name>',
    requiredFlags: [
      { flag: '--name', value: '<display-name>', description: 'Existing local MetaBot profile name to activate.' },
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
    usage: 'metabot file upload --request-file <path>',
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
    ],
    examples: [
      'metabot file upload --request-file file-request.json',
    ],
    optionalFlags: [HELP_JSON_FLAG],
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
    usage: 'metabot buzz post --request-file <path>',
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
    ],
    optionalFlags: [HELP_JSON_FLAG],
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
    usage: 'metabot chain write --request-file <path>',
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
    ],
    optionalFlags: [HELP_JSON_FLAG],
  },
  {
    commandPath: ['network'],
    summary: 'Directory commands for reading online MetaBot services and managing local seed sources.',
    usage: 'metabot network <subcommand>',
    subcommands: [
      { name: 'services', summary: 'List MetaBot services from chain discovery and local fallbacks.' },
      { name: 'sources', summary: 'Manage local seeded directory sources.' },
    ],
    optionalFlags: [HELP_JSON_FLAG],
  },
  {
    commandPath: ['network', 'services'],
    summary: 'List yellow-pages services discovered from MetaWeb and optional local source seeds.',
    usage: 'metabot network services [--online]',
    optionalFlags: [
      { flag: '--online', description: 'Return only services whose providers currently satisfy heartbeat-based online filtering.' },
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
      { name: 'call', summary: 'Delegate one task to a remote MetaBot service.' },
      { name: 'rate', summary: 'Publish one buyer-side service rating after delivery.' },
    ],
    optionalFlags: [HELP_JSON_FLAG],
  },
  {
    commandPath: ['services', 'publish'],
    summary: 'Publish one service to the chain-backed skill-service directory.',
    usage: 'metabot services publish --payload-file <path>',
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
    ],
    optionalFlags: [HELP_JSON_FLAG],
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
    usage: 'metabot services rate --request-file <path>',
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
    ],
    optionalFlags: [HELP_JSON_FLAG],
  },
  {
    commandPath: ['chat'],
    summary: 'Private MetaWeb chat commands.',
    usage: 'metabot chat <subcommand>',
    subcommands: [
      { name: 'private', summary: 'Send one encrypted private MetaWeb message to another MetaBot.' },
    ],
    optionalFlags: [HELP_JSON_FLAG],
  },
  {
    commandPath: ['chat', 'private'],
    summary: 'Send one encrypted private MetaWeb message to another MetaBot.',
    usage: 'metabot chat private --request-file <path>',
    requiredFlags: [
      { flag: '--request-file', value: '<path>', description: 'JSON request file.' },
    ],
    requestShape: {
      to: 'remote globalMetaId',
      content: 'message text',
      replyPin: 'optional prior message pin id',
    },
    successFields: [
      'to',
      'path',
      'payload',
      'encryptedContent',
      'peerChatPublicKey',
      'traceId',
    ],
    failureSemantics: [
      'Fails when the local chat secret is missing or the remote MetaBot has no published chat public key.',
    ],
    examples: [
      'metabot chat private --request-file chat-request.json',
    ],
    optionalFlags: [HELP_JSON_FLAG],
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
    summary: 'Read the full structured trace record plus exported transcript and inspector evidence paths.',
    usage: 'metabot trace get --trace-id <trace-id>',
    requiredFlags: [
      { flag: '--trace-id', value: '<trace-id>', description: 'Trace identifier returned by a remote service call.' },
    ],
    successFields: [
      'traceId',
      'session',
      'order',
      'a2a',
      'artifacts',
      'inspector',
    ],
    failureSemantics: [
      'Fails when the traceId is unknown in the local runtime state.',
    ],
    examples: [
      'metabot trace get --trace-id trace-123',
    ],
    optionalFlags: [HELP_JSON_FLAG],
  },
  {
    commandPath: ['ui'],
    summary: 'Open local human-only HTML pages backed by the same daemon state as the CLI.',
    usage: 'metabot ui <subcommand>',
    subcommands: [
      { name: 'open', summary: 'Open one local MetaBot page in the browser.' },
    ],
    optionalFlags: [HELP_JSON_FLAG],
  },
  {
    commandPath: ['ui', 'open'],
    summary: 'Open one local MetaBot HTML page such as hub, publish, my-services, trace, or refund.',
    usage: 'metabot ui open --page <page> [--trace-id <trace-id>]',
    requiredFlags: [
      { flag: '--page', value: '<page>', description: 'Built-in page name: hub, publish, my-services, trace, or refund.' },
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
      'metabot ui open --page trace --trace-id trace-123',
    ],
  },
];
