import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

test('runCli prints top-level help text for `metabot --help` without a JSON envelope', async () => {
  const stdout = [];

  const exitCode = await runCli(['--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot <command>/m);
  assert.match(output, /^Commands:/m);
  assert.match(output, /^\s+identity\s+/m);
  assert.match(output, /^\s+config\s+/m);
  assert.match(output, /^\s+wallet\s+/m);
  assert.match(output, /^\s+services\s+/m);
  assert.match(output, /^\s+host\s+/m);
  assert.match(output, /^\s+trace\s+/m);
  assert.match(output, /^\s+system\s+/m);
  assert.equal(output.includes('"ok"'), false);
});

test('runCli prints machine-readable top-level help for `metabot --help --json`', async () => {
  const stdout = [];

  const exitCode = await runCli(['--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, []);
  assert.equal(output.command, 'metabot');
  assert.ok(Array.isArray(output.subcommands));
  assert.ok(output.subcommands.some((entry) => entry.name === 'host'));
});

test('runCli prints config group help with get and set subcommands', async () => {
  const stdout = [];

  const exitCode = await runCli(['config', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot config <subcommand>/m);
  assert.match(output, /^Commands:/m);
  assert.match(output, /^\s+get\s+/m);
  assert.match(output, /^\s+set\s+/m);
  assert.match(output, /askMaster\.enabled/);
  assert.match(output, /askMaster\.triggerMode suggest/);
});

test('runCli prints config set help with the public Ask Master trigger modes only', async () => {
  const stdout = [];

  const exitCode = await runCli(['config', 'set', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot config set <key> <value>/m);
  assert.match(output, /Ask Master trigger mode is intentionally limited to manual or suggest/i);
  assert.match(output, /Fails when askMaster\.triggerMode is not one of `manual` or `suggest`\./);
  assert.doesNotMatch(output, /`manual`, `suggest`, or `auto`/);
});

test('runCli prints master host-action help with both manual_ask and accept_suggest examples', async () => {
  const stdout = [];

  const exitCode = await runCli(['master', 'host-action', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot master host-action --request-file <path>/m);
  assert.match(output, /manual_ask or accept_suggest/i);
  assert.match(output, /master-manual-ask\.json/);
  assert.match(output, /master-accept-suggest\.json/);
});

test('runCli prints master ask help with confirm limited to the trace-id continuation path', async () => {
  const stdout = [];

  const exitCode = await runCli(['master', 'ask', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot master ask --request-file <path> \| metabot master ask --trace-id <trace-id> \[--confirm\]/m);
  assert.match(output, /Only valid together with `--trace-id`\./);
});

test('runCli prints wallet group help with balance subcommand', async () => {
  const stdout = [];

  const exitCode = await runCli(['wallet', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot wallet <subcommand>/m);
  assert.match(output, /^Commands:/m);
  assert.match(output, /^\s+balance\s+/m);
});

test('runCli prints system group help with update and uninstall subcommands', async () => {
  const stdout = [];

  const exitCode = await runCli(['system', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot system <subcommand>/m);
  assert.match(output, /^Commands:/m);
  assert.match(output, /^\s+update\s+/m);
  assert.match(output, /^\s+uninstall\s+/m);
});

test('runCli prints system update help with npm-first and legacy host-pack semantics', async () => {
  const stdout = [];

  const exitCode = await runCli(['system', 'update', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot system update \[--host <codex\|claude-code\|openclaw>\] \[--target-version <tag>\] \[--dry-run\]/m);
  assert.match(output, /npm-first package update and registry-driven oac install/i);
  assert.match(output, /Legacy release-pack update target/i);
  assert.match(output, /npm i -g open-agent-connect@<version> and then oac install/i);
});

test('runCli prints system uninstall help with preservation and token confirmation semantics', async () => {
  const stdout = [];

  const exitCode = await runCli(['system', 'uninstall', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot system uninstall \[--all --confirm-token <token>\] \[--yes\]/m);
  assert.match(output, /Default uninstall preserves identity profiles, mnemonics, private keys, and wallet-related local data\./);
  assert.match(output, /DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS/);
});

test('runCli prints services group help with publish skill listing', async () => {
  const stdout = [];

  const exitCode = await runCli(['services', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot services <subcommand>/m);
  assert.match(output, /publish-skills\s+List primary-runtime skills available for service publishing\./);
});

test('runCli prints leaf help text for `metabot services publish-skills --help`', async () => {
  const stdout = [];

  const exitCode = await runCli(['services', 'publish-skills', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot services publish-skills/m);
  assert.match(output, /Lists skills from the active MetaBot primary runtime only/i);
  assert.match(output, /metaBotSlug/m);
  assert.match(output, /runtime/m);
  assert.match(output, /skills/m);
  assert.match(output, /primary runtime is missing/i);
});

test('runCli prints leaf help text for `metabot services call --help` with request and result semantics', async () => {
  const stdout = [];

  const exitCode = await runCli(['services', 'call', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot services call --request-file <path>/m);
  assert.match(output, /^Required flags:/m);
  assert.match(output, /--request-file <path>\s+JSON request file\./m);
  assert.match(output, /^Request shape:/m);
  assert.match(output, /"servicePinId": "service-pin-id"/m);
  assert.match(output, /^Success shape:/m);
  assert.match(output, /traceId/m);
  assert.match(output, /responseText/m);
  assert.match(output, /^Failure semantics:/m);
  assert.match(output, /timeout does not mean failed/i);
  assert.equal(output.includes('"ok"'), false);
});

test('runCli documents trace get lookup by trace id or session id', async () => {
  const stdout = [];

  const exitCode = await runCli(['trace', 'get', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['trace', 'get']);
  assert.match(output.usage, /--trace-id <trace-id>/);
  assert.match(output.usage, /--session-id <session-id>/);
  assert.ok(output.requiredFlags.some((entry) => entry.flag === '--trace-id'));
  assert.ok(output.requiredFlags.some((entry) => entry.flag === '--session-id'));
  assert.ok(output.successFields.includes('traceId'));
  assert.ok(output.successFields.includes('sessionId'));
  assert.ok(output.successFields.includes('orderTxid'));
  assert.ok(output.successFields.includes('paymentTxid'));
  assert.ok(output.successFields.includes('localUiUrl'));
  assert.ok(output.examples.includes('metabot trace get --session-id session-a2a-123'));
});

test('runCli prints machine-readable help for `metabot chat private --help --json`', async () => {
  const stdout = [];

  const exitCode = await runCli(['chat', 'private', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['chat', 'private']);
  assert.equal(output.command, 'metabot chat private');
  assert.match(output.usage, /^metabot chat private --request-file <path>$/);
  assert.equal(output.summary, 'Send one encrypted private MetaWeb message to another MetaBot.');
  assert.deepEqual(output.requiredFlags, [
    {
      flag: '--request-file',
      value: '<path>',
      description: 'JSON request file.',
    },
  ]);
  assert.equal(output.requestShape.to, 'remote globalMetaId');
  assert.equal(output.requestShape.content, 'message text');
  assert.equal(output.requestShape.replyPin, 'optional prior message pin id');
  assert.ok(Array.isArray(output.successFields));
  assert.ok(output.successFields.includes('traceId'));
  assert.ok(output.successFields.includes('pinId'));
  assert.ok(output.successFields.includes('txids'));
  assert.ok(output.successFields.includes('localUiUrl'));
  assert.equal(output.successFields.includes('payload'), false);
  assert.equal(output.successFields.includes('encryptedContent'), false);
  assert.equal(output.successFields.includes('peerChatPublicKey'), false);
});

test('runCli prints nested group help for `metabot network sources --help`', async () => {
  const stdout = [];

  const exitCode = await runCli(['network', 'sources', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot network sources <subcommand>/m);
  assert.match(output, /^Commands:/m);
  assert.match(output, /^\s+list\s+/m);
  assert.match(output, /^\s+add\s+/m);
  assert.match(output, /^\s+remove\s+/m);
});

test('runCli prints skills group help for `metabot skills --help`', async () => {
  const stdout = [];

  const exitCode = await runCli(['skills', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot skills <subcommand>/m);
  assert.match(output, /^Commands:/m);
  assert.match(output, /^\s+resolve\s+/m);
  assert.match(output, /shared-default resolution/i);
  assert.match(output, /metabot skills resolve --skill metabot-network-manage --format markdown/);
});

test('runCli prints skills resolve help for `metabot skills resolve --help`', async () => {
  const stdout = [];

  const exitCode = await runCli(['skills', 'resolve', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot skills resolve --skill <skill-name> --format <json\|markdown> \[--host <claude-code\|codex\|copilot\|opencode\|openclaw\|hermes\|gemini\|pi\|cursor\|kimi\|kiro>\]/m);
  assert.match(output, /^Required flags:/m);
  assert.match(output, /--skill <skill-name>\s+Base skill id to resolve, such as metabot-network-manage\./m);
  assert.match(output, /--format <json\|markdown>\s+Output shape to render\./m);
  assert.match(output, /^Optional flags:/m);
  assert.match(output, /--host <claude-code\|codex\|copilot\|opencode\|openclaw\|hermes\|gemini\|pi\|cursor\|kimi\|kiro>\s+Optional compatibility override\./m);
  assert.match(output, /^Success shape:/m);
  assert.match(output, /requestedHost/);
  assert.match(output, /resolutionMode/);
});

test('runCli prints machine-readable skills resolve help for `metabot skills resolve --help --json`', async () => {
  const stdout = [];

  const exitCode = await runCli(['skills', 'resolve', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['skills', 'resolve']);
  assert.equal(output.command, 'metabot skills resolve');
  assert.equal(output.summary, 'Render one resolved skill contract using the shared-default host or an explicit compatibility host override.');
  assert.equal(output.usage, 'metabot skills resolve --skill <skill-name> --format <json|markdown> [--host <claude-code|codex|copilot|opencode|openclaw|hermes|gemini|pi|cursor|kimi|kiro>]');
  assert.deepEqual(output.requiredFlags, [
    {
      flag: '--skill',
      value: '<skill-name>',
      description: 'Base skill id to resolve, such as metabot-network-manage.',
    },
    {
      flag: '--format',
      value: '<json|markdown>',
      description: 'Output shape to render.',
    },
  ]);
  assert.deepEqual(output.optionalFlags, [
    {
      flag: '--host',
      value: '<claude-code|codex|copilot|opencode|openclaw|hermes|gemini|pi|cursor|kimi|kiro>',
      description: 'Optional compatibility override. Omit to render the shared-default contract.',
    },
    {
      flag: '--json',
      description: 'Emit machine-readable help JSON instead of text.',
    },
  ]);
  assert.ok(Array.isArray(output.examples));
  assert.ok(output.examples.includes('metabot skills resolve --skill metabot-network-manage --format json'));
});

test('runCli prints identity group help with create/who/list/assign subcommands', async () => {
  const stdout = [];

  const exitCode = await runCli(['identity', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot identity <subcommand>/m);
  assert.match(output, /^Commands:/m);
  assert.match(output, /^\s+create\s+/m);
  assert.match(output, /^\s+who\s+/m);
  assert.match(output, /^\s+list\s+/m);
  assert.match(output, /^\s+assign\s+/m);
});

test('runCli prints identity create help with MetaBot terminology', async () => {
  const stdout = [];

  const exitCode = await runCli(['identity', 'create', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /Create one local MetaBot identity/i);
  assert.match(output, /Human-facing name for the new local MetaBot identity\./i);
  assert.match(output, /metabot identity create --name "<your chosen MetaBot name>"/);
  assert.doesNotMatch(output, /metabot identity create --name "Alice"/);
  assert.doesNotMatch(output, /connected-agent/i);
});
