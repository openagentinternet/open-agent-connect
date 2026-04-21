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
  assert.match(output, /^\s+trace\s+/m);
  assert.equal(output.includes('"ok"'), false);
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
  assert.doesNotMatch(output, /connected-agent/i);
});
