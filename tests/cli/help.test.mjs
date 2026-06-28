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
  assert.match(output, /^\s+bot\s+/m);
  assert.match(output, /^\s+config\s+/m);
  assert.match(output, /^\s+wallet\s+/m);
  assert.match(output, /^\s+services\s+/m);
  assert.match(output, /^\s+products\s+/m);
  assert.match(output, /^\s+provider\s+/m);
  assert.match(output, /^\s+host\s+/m);
  assert.match(output, /^\s+trace\s+/m);
  assert.match(output, /^\s+browser\s+/m);
  assert.match(output, /^\s+system\s+/m);
  assert.match(output, /^\s+loom\s+/m);
  assert.match(output, /^\s+metaapp\s+/m);
  assert.match(output, /^\s+metaapp\s+.*owner list\/delete.*project packaging/m);
  assert.doesNotMatch(output, /^\s+master\s+/m);
  assert.doesNotMatch(output, /^\s+evolution\s+/m);
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
  assert.ok(output.subcommands.some((entry) => entry.name === 'bot'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'host'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'provider'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'products'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'loom'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'browser'));
  assert.ok(output.subcommands.some((entry) => entry.name === 'metaapp'));
  assert.ok(output.subcommands.some((entry) => (
    entry.name === 'metaapp'
    && /owner list\/delete/.test(entry.summary)
    && /project packaging/.test(entry.summary)
  )));
  assert.equal(output.subcommands.some((entry) => entry.name === 'master'), false);
  assert.equal(output.subcommands.some((entry) => entry.name === 'evolution'), false);
});

test('runCli rejects retired master and evolution commands', async () => {
  for (const command of ['master', 'evolution']) {
    const stdout = [];

    const exitCode = await runCli([command], {
      stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
      stderr: { write: () => true },
    });

    assert.equal(exitCode, 1);
    const output = JSON.parse(stdout.join(''));
    assert.equal(output.ok, false);
    assert.equal(output.code, 'unknown_command');
    assert.match(output.message, new RegExp(`Unknown command: ${command}`));
  }
});

test('runCli prints metaapp group help with all leaf commands', async () => {
  const stdout = [];

  const exitCode = await runCli(['metaapp', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot metaapp <subcommand>/m);
  for (const command of ['list', 'publish', 'update', 'delete', 'preview', 'publish-project', 'update-project', 'share', 'view', 'comment']) {
    assert.match(output, new RegExp(`\\s+${command}\\s+`));
  }
});

test('runCli prints metaapp leaf command text help', async () => {
  for (const command of ['list', 'publish', 'update', 'delete', 'preview', 'publish-project', 'update-project', 'share', 'view', 'comment']) {
    const stdout = [];

    const exitCode = await runCli(['metaapp', command, '--help'], {
      stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
      stderr: { write: () => true },
    });

    assert.equal(exitCode, 0);
    const output = stdout.join('');
    assert.match(output, new RegExp(`^Usage:\\s+metabot metaapp ${command}`, 'm'));
    assert.match(output, /^Summary:\s+/m);
    assert.equal(output.includes('"ok"'), false);
  }
});

test('runCli prints machine-readable metaapp publish help', async () => {
  const stdout = [];

  const exitCode = await runCli(['metaapp', 'publish', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['metaapp', 'publish']);
  assert.equal(output.command, 'metabot metaapp publish');
});

test('runCli prints machine-readable help for every metaapp leaf command', async () => {
  for (const command of ['list', 'publish', 'update', 'delete', 'preview', 'publish-project', 'update-project', 'share', 'view', 'comment']) {
    const stdout = [];

    const exitCode = await runCli(['metaapp', command, '--help', '--json'], {
      stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
      stderr: { write: () => true },
    });

    assert.equal(exitCode, 0);
    const output = JSON.parse(stdout.join(''));
    assert.deepEqual(output.commandPath, ['metaapp', command]);
    assert.equal(output.command, `metabot metaapp ${command}`);
    assert.ok(output.optionalFlags.some((entry) => entry.flag === '--json'));
  }
});

test('runCli prints metaapp owner-management and project packaging help usages', async () => {
  const stdout = [];

  for (const command of ['publish', 'publish-project', 'delete']) {
    const exitCode = await runCli(['metaapp', command, '--help'], {
      stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
      stderr: { write: () => true },
    });

    assert.equal(exitCode, 0);
  }

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot metaapp publish \[--from <bot-slug>\] --payload-file <path> \[--chain <mvc\|btc\|doge\|opcat>\] --confirm/m);
  assert.match(output, /^Usage:\s+metabot metaapp publish-project --project-dir <path>/m);
  assert.match(output, /^Usage:\s+metabot metaapp delete \[--from <bot-slug>\] --target-pin-id <pinid> --confirm/m);
});

test('runCli prints metaapp share and comment help with write-chain behavior', async () => {
  const shareStdout = [];
  const shareExitCode = await runCli(['metaapp', 'share', '--help'], {
    stdout: { write: (chunk) => { shareStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(shareExitCode, 0);
  const shareOutput = shareStdout.join('');
  assert.match(shareOutput, /--chain <mvc\|btc\|doge\|opcat>/);
  assert.match(shareOutput, /configured `chain\.defaultWriteNetwork`, initially mvc/i);
  assert.match(shareOutput, /ignored unless --announce/i);

  const commentStdout = [];
  const commentExitCode = await runCli(['metaapp', 'comment', '--help'], {
    stdout: { write: (chunk) => { commentStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(commentExitCode, 0);
  const commentOutput = commentStdout.join('');
  assert.match(commentOutput, /--chain <mvc\|btc\|doge\|opcat>/);
  assert.match(commentOutput, /configured `chain\.defaultWriteNetwork`, initially mvc/i);
  assert.match(commentOutput, /paycomment/i);
});

test('runCli prints metaapp preview help with manifest-file override', async () => {
  const stdout = [];

  const exitCode = await runCli(['metaapp', 'preview', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot metaapp preview --project-dir <path> \[--manifest-file <path>\] \[--open\]/m);
  assert.match(output, /--manifest-file <path>/);
  assert.match(output, /manifest override file/i);
  assert.match(output, /metabot metaapp preview --project-dir \.\/dist-site --manifest-file metaapp\.json/);
});

test('runCli prints products help with publish, skills, and owned list commands', async () => {
  const groupStdout = [];
  const groupExitCode = await runCli(['products', '--help'], {
    stdout: { write: (chunk) => { groupStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(groupExitCode, 0);
  const groupOutput = groupStdout.join('');
  assert.match(groupOutput, /^Usage:\s+metabot products <subcommand>/m);
  assert.match(groupOutput, /skills\s+List product fulfillment skills from one seller bot primary runtime\./);
  assert.match(groupOutput, /publish\s+Publish a product listing payload after validating seller fulfillment skills\./);
  assert.match(groupOutput, /owned\s+List locally owned product listings\./);

  const publishStdout = [];
  const publishExitCode = await runCli(['products', 'publish', '--help'], {
    stdout: { write: (chunk) => { publishStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(publishExitCode, 0);
  const publishOutput = publishStdout.join('');
  assert.match(publishOutput, /^Usage:\s+metabot products publish \[--from <bot-slug>\] --payload-file <path> \[--chain <mvc\|btc\|doge\|opcat>\]/m);
  assert.match(publishOutput, /all fulfillment\.fulfillmentSkills must exist in the seller bot primary runtime/i);

  const skillsStdout = [];
  const skillsExitCode = await runCli(['products', 'skills', '--help'], {
    stdout: { write: (chunk) => { skillsStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(skillsExitCode, 0);
  assert.match(skillsStdout.join(''), /^Usage:\s+metabot products skills \[--from <bot-slug>\]/m);

  const ownedStdout = [];
  const ownedExitCode = await runCli(['products', 'owned', 'list', '--help'], {
    stdout: { write: (chunk) => { ownedStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(ownedExitCode, 0);
  assert.match(ownedStdout.join(''), /^Usage:\s+metabot products owned list \[--from <bot-slug> \| --all\] \[--page <n>\] \[--page-size <n>\] \[--refresh\]/m);
});

test('runCli prints network help with products directory command', async () => {
  const groupStdout = [];
  const groupExitCode = await runCli(['network', '--help'], {
    stdout: { write: (chunk) => { groupStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(groupExitCode, 0);
  const groupOutput = groupStdout.join('');
  assert.match(groupOutput, /^Usage:\s+metabot network <subcommand>/m);
  assert.match(groupOutput, /services\s+List MetaBot services from chain discovery and local fallbacks\./);
  assert.match(groupOutput, /products\s+List product listings from chain discovery and local product cache\./);

  const jsonStdout = [];
  const jsonExitCode = await runCli(['network', '--help', '--json'], {
    stdout: { write: (chunk) => { jsonStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(jsonExitCode, 0);
  const jsonOutput = JSON.parse(jsonStdout.join(''));
  assert.ok(jsonOutput.subcommands.some((entry) => entry.name === 'products'));

  const productsStdout = [];
  const productsExitCode = await runCli(['network', 'products', '--help'], {
    stdout: { write: (chunk) => { productsStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(productsExitCode, 0);
  const productsOutput = productsStdout.join('');
  assert.match(productsOutput, /^Usage:\s+metabot network products \[--online\] \[--cached\] \[--query <text>\] \[--search <text>\] \[--limit <n>\]/m);
  assert.match(productsOutput, /--online\s+Return only product listings whose sellers currently appear in socket presence\./);
  assert.match(productsOutput, /--search <text>\s+Alias for --query\./);
});

test('runCli prints loom group help for validation and export commands', async () => {
  const stdout = [];

  const exitCode = await runCli(['loom', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot loom <subcommand>/m);
  assert.match(output, /validate\s+Validate one Loom protocol payload\./);
  assert.match(output, /export-chain-request\s+Build a chain write request for one Loom payload\./);
  assert.match(output, /draft-task\s+Draft a Loom task payload with the selected MetaBot LLM runtime\./);
  assert.match(output, /sync\s+Synchronize raw Loom protocol records into the local cache\./);
  assert.match(output, /list\s+List task-centric Loom records from the local cache\./);
  assert.match(output, /show\s+Show one Loom task and grouped related raw records\./);
  assert.match(output, /dashboard\s+Show the Loom task dashboard\./);
});

test('runCli prints loom validate help with protocol and payload-file flags', async () => {
  const stdout = [];

  const exitCode = await runCli(['loom', 'validate', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot loom validate --protocol <protocol> --payload-file <path>/m);
  assert.match(output, /--protocol <protocol>/);
  assert.match(output, /--payload-file <path>/);
  assert.match(output, /invalid_payload/);
});

test('runCli prints loom export-chain-request help and JSON help', async () => {
  const textStdout = [];

  const textExitCode = await runCli(['loom', 'export-chain-request', '--help'], {
    stdout: { write: (chunk) => { textStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(textExitCode, 0);
  const textOutput = textStdout.join('');
  assert.match(textOutput, /^Usage:\s+metabot loom export-chain-request --protocol <protocol> --payload-file <path> \[--out <path>\]/m);
  assert.match(textOutput, /--out <path>/);
  assert.match(textOutput, /payload/);

  const jsonStdout = [];
  const jsonExitCode = await runCli(['loom', 'export-chain-request', '--help', '--json'], {
    stdout: { write: (chunk) => { jsonStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(jsonExitCode, 0);
  const jsonOutput = JSON.parse(jsonStdout.join(''));
  assert.deepEqual(jsonOutput.commandPath, ['loom', 'export-chain-request']);
  assert.equal(jsonOutput.command, 'metabot loom export-chain-request');
  assert.ok(jsonOutput.optionalFlags.some((flag) => flag.flag === '--out'));
});

test('runCli prints loom sync, list, and show help', async () => {
  const syncStdout = [];
  const syncExitCode = await runCli(['loom', 'sync', '--help'], {
    stdout: { write: (chunk) => { syncStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(syncExitCode, 0);
  assert.match(syncStdout.join(''), /^Usage:\s+metabot loom sync \[--limit <n>\]/m);

  const listStdout = [];
  const listExitCode = await runCli(['loom', 'list', '--help'], {
    stdout: { write: (chunk) => { listStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(listExitCode, 0);
  assert.match(listStdout.join(''), /^Usage:\s+metabot loom list \[--refresh\] \[--limit <n>\] \[--tag <tag>\] \[--currency <SPACE\|BTC\|DOGE\|OPCAT>\]/m);

  const showStdout = [];
  const showExitCode = await runCli(['loom', 'show', '--help'], {
    stdout: { write: (chunk) => { showStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  assert.equal(showExitCode, 0);
  assert.match(showStdout.join(''), /^Usage:\s+metabot loom show <taskPinId> \[--refresh\]/m);
});

test('runCli prints loom dashboard help with filter flags', async () => {
  const stdout = [];

  const exitCode = await runCli(['loom', 'dashboard', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot loom dashboard \[--from <bot-slug>\] \[--refresh\] \[--limit <n>\] \[--state <state-or-column>\] \[--role <all\|requester\|developer\|needs_action>\] \[--query <text>\]/m);
  assert.match(output, /--from <bot-slug>/);
  assert.match(output, /--refresh/);
  assert.match(output, /--limit <n>/);
  assert.match(output, /--state <state-or-column>/);
  assert.match(output, /--role <all\|requester\|developer\|needs_action>/);
  assert.match(output, /--query <text>/);
  assert.match(output, /not_implemented/);
  assert.match(output, /updates the local raw Loom cache and dashboard index/);
  assert.match(output, /does not write chain data, perform payments, or mutate GitHub or browsers/);
});

test('runCli prints loom draft-task help with wish and actor flags', async () => {
  const textStdout = [];
  const textExitCode = await runCli(['loom', 'draft-task', '--help'], {
    stdout: { write: (chunk) => { textStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(textExitCode, 0);
  const textOutput = textStdout.join('');
  assert.match(textOutput, /^Usage:\s+metabot loom draft-task --wish <text> \[--from <bot-slug>\] \[--allow-invalid\]/m);
  assert.match(textOutput, /--wish <text>/);
  assert.match(textOutput, /--from <bot-slug>/);
  assert.match(textOutput, /--allow-invalid/);
  assert.match(textOutput, /invalid_llm_output/);

  const jsonStdout = [];
  const jsonExitCode = await runCli(['loom', 'draft-task', '--help', '--json'], {
    stdout: { write: (chunk) => { jsonStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(jsonExitCode, 0);
  const jsonOutput = JSON.parse(jsonStdout.join(''));
  assert.deepEqual(jsonOutput.commandPath, ['loom', 'draft-task']);
  assert.equal(jsonOutput.command, 'metabot loom draft-task');
  assert.ok(jsonOutput.requiredFlags.some((flag) => flag.flag === '--wish'));
  assert.ok(jsonOutput.optionalFlags.some((flag) => flag.flag === '--allow-invalid'));
});

test('runCli prints loom workflow command help', async () => {
  const outputs = new Map();

  for (const command of [
    'post-task',
    'claim-and-start',
    'run-dev-round',
    'deliver',
    'accept-and-pay',
    'review-delivery',
    'state',
  ]) {
    const stdout = [];
    const exitCode = await runCli(['loom', command, '--help'], {
      stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
      stderr: { write: () => true },
    });

    assert.equal(exitCode, 0);
    const output = stdout.join('');
    outputs.set(command, output);
    assert.match(output, new RegExp(`metabot loom ${command}`));
  }

  assert.match(outputs.get('accept-and-pay'), /--score <1-5>/);
  assert.match(outputs.get('accept-and-pay'), /--confirm-payment/);
  assert.match(outputs.get('accept-and-pay'), /without.*--confirm-payment.*payment/i);
  assert.match(outputs.get('claim-and-start'), /git/i);
  assert.match(outputs.get('claim-and-start'), /gh/i);
  assert.match(outputs.get('claim-and-start'), /github/i);
  assert.match(outputs.get('run-dev-round'), /git|gh|github/i);
});

test('runCli prints bot group help for profile, runtime, and session commands', async () => {
  const stdout = [];

  const exitCode = await runCli(['bot', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot bot <subcommand>/m);
  assert.match(output, /show\s+Show one local MetaBot profile\./);
  assert.match(output, /runtimes\s+List or discover LLM runtimes for a MetaBot profile\./);
  assert.match(output, /sessions\s+List runtime sessions for a MetaBot profile\./);
});

test('runCli prints bot sessions help with actor and limit selectors', async () => {
  const stdout = [];

  const exitCode = await runCli(['bot', 'sessions', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot bot sessions \[--from <bot-slug>\] \[--limit <n>\]/m);
  assert.match(output, /--from <bot-slug>/);
  assert.match(output, /--limit <n>\s+Maximum session count\. Defaults to 50\./);
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
  assert.match(output, /chain\.defaultWriteNetwork/);
  assert.match(output, /a2a\.simplemsgListenerEnabled/);
  assert.doesNotMatch(output, /askMaster/);
  assert.doesNotMatch(output, /evolution_network/);
  assert.match(output, /--from alice/);
});

test('runCli prints config set help with active config keys only', async () => {
  const stdout = [];

  const exitCode = await runCli(['config', 'set', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot config set \[--from <bot-slug>\] <key> <value>/m);
  assert.match(output, /--from <bot-slug>/);
  assert.match(output, /Fails when chain\.defaultWriteNetwork is not one of mvc, btc, doge, or opcat\./);
  assert.match(output, /metabot config set --from alice a2a\.simplemsgListenerEnabled false/);
  assert.doesNotMatch(output, /askMaster/);
  assert.doesNotMatch(output, /evolution_network/);
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

test('runCli prints wallet transfer help with every supported transfer unit', async () => {
  const stdout = [];

  const exitCode = await runCli(['wallet', 'transfer', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot wallet transfer \[--from <bot-slug>\] --to <address> --amount <amount><UNIT> \[--confirm\]/m);
  assert.match(output, /--from <bot-slug>/);
  assert.match(output, /BTC, SPACE, DOGE, or OPCAT/);
  assert.match(output, /10OPCAT/);
  assert.match(output, /Fails with invalid_argument when --to or --amount is missing, or the currency unit is not BTC, SPACE, DOGE, or OPCAT\./);
});

test('runCli prints wallet balance help with every supported balance chain', async () => {
  const stdout = [];

  const exitCode = await runCli(['wallet', 'balance', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot wallet balance \[--from <bot-slug>\] \[--chain <all\|mvc\|btc\|doge\|opcat>\]/m);
  assert.match(output, /--from <bot-slug>/);
  assert.match(output, /wallet balances for mvc, btc, doge, and opcat/i);
  assert.match(output, /metabot wallet balance --from alice --chain doge/);
  assert.match(output, /metabot wallet balance --from alice --chain opcat/);
});

test('runCli prints chain write help with every supported write chain', async () => {
  const stdout = [];

  const exitCode = await runCli(['chain', 'write', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot chain write \[--from <bot-slug>\] --request-file <path> \[--chain <mvc\|btc\|doge\|opcat>\]/m);
  assert.match(output, /--from <bot-slug>/);
  assert.match(output, /optional chain network override: mvc, btc, doge, or opcat/i);
  assert.match(output, /configured `chain\.defaultWriteNetwork`, initially mvc/i);
  assert.match(output, /chain-doge-request\.json/);
  assert.match(output, /chain-opcat-request\.json/);
});

test('runCli prints buzz post help with DOGE and OPCAT chain support', async () => {
  const stdout = [];

  const exitCode = await runCli(['buzz', 'post', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot buzz post \[--from <bot-slug>\] --request-file <path> \[--chain <mvc\|btc\|doge\|opcat>\]/m);
  assert.match(output, /--from <bot-slug>/);
  assert.match(output, /configured `chain\.defaultWriteNetwork`, initially mvc/i);
  assert.match(output, /buzz-doge-request\.json/);
  assert.match(output, /buzz-opcat-request\.json/);
});

test('runCli prints file upload help with OPCAT support and DOGE exclusion', async () => {
  const stdout = [];

  const exitCode = await runCli(['file', 'upload', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot file upload \[--from <bot-slug>\] --request-file <path> \[--chain <mvc\|btc\|opcat>\]/m);
  assert.match(output, /--from <bot-slug>/);
  assert.match(output, /DOGE is not supported for file upload/i);
  assert.match(output, /configured `chain\.defaultWriteNetwork`, initially mvc/i);
});

test('runCli prints file group help with upload-large listed', async () => {
  const stdout = [];

  const exitCode = await runCli(['file', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot file <subcommand>/m);
  assert.match(output, /upload\s+Upload one local file through the shared MetaWeb file path\./);
  assert.match(output, /upload-large\s+Upload one local file through the daemon-backed large file path\./);
});

test('runCli prints file upload-large help with request shape and MVC large-upload notes', async () => {
  const stdout = [];

  const exitCode = await runCli(['file', 'upload-large', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot file upload-large --file <path> \[--from <bot-slug>\] \[--content-type <mime>\] \[--chain <mvc\|btc\|opcat>\] \[--verify\]/m);
  assert.match(output, /^metabot file upload-large <path> \[--from <bot-slug>\] \[--content-type <mime>\] \[--chain <mvc\|btc\|opcat>\] \[--verify\]/m);
  assert.match(output, /^metabot file upload-large --request-file <path> \[--from <bot-slug>\] \[--chain <mvc\|btc\|opcat>\] \[--verify\]/m);
  assert.match(output, /"filePath": "\/absolute\/or\/relative\/path\/to\/file"/);
  assert.match(output, /"verify": "optional availability verification boolean"/);
  assert.match(output, /metafileUri/);
  assert.match(output, /verification/);
  assert.match(output, /DOGE is not supported for file upload/i);
  assert.match(output, /Large uploads above the direct threshold currently require MVC/i);
  assert.match(output, /large_file_upload_unavailable/);
  assert.match(output, /metabot file upload-large --from alice --file \.\/dist\/metaapp\.zip --content-type application\/zip --verify/);
  assert.match(output, /metabot file upload-large \.\/dist\/metaapp\.zip --from alice --verify/);
  assert.match(output, /metabot file upload-large --from alice --request-file large-file-request\.json --verify/);
});

test('runCli prints machine-readable file upload-large help', async () => {
  const stdout = [];

  const exitCode = await runCli(['file', 'upload-large', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['file', 'upload-large']);
  assert.equal(output.command, 'metabot file upload-large');
  assert.match(output.usage, /metabot file upload-large --file <path>/);
  assert.match(output.usage, /metabot file upload-large <path>/);
  assert.match(output.usage, /metabot file upload-large --request-file <path>/);
  assert.ok(output.optionalFlags.some((flag) => flag.flag === '--file'));
  assert.ok(output.optionalFlags.some((flag) => flag.flag === '--request-file'));
  assert.ok(output.optionalFlags.some((flag) => flag.flag === '--content-type'));
  assert.ok(output.optionalFlags.some((flag) => flag.flag === '--verify'));
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
  assert.match(output, /^Usage:\s+metabot system update \[--host <codex\|claude-code\|openclaw\|zcode\|workbuddy>\] \[--target-version <tag>\] \[--dry-run\]/m);
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
  assert.match(output, /skills\s+List primary-runtime skills available for service publishing\./);
  assert.match(output, /publish-skills\s+Compatibility alias for services skills\./);
  assert.match(output, /owned\s+List and manage services owned by local MetaBots\./);
  assert.match(output, /orders\s+Inspect seller-side service orders\./);
  assert.match(output, /refunds\s+List and settle service refunds\./);
});

test('runCli prints services publish and rate help with DOGE and OPCAT chain support', async () => {
  const publishStdout = [];
  const publishExitCode = await runCli(['services', 'publish', '--help'], {
    stdout: { write: (chunk) => { publishStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(publishExitCode, 0);
  const publishOutput = publishStdout.join('');
  assert.match(publishOutput, /^Usage:\s+metabot services publish \[--from <bot-slug>\] --payload-file <path> \[--chain <mvc\|btc\|doge\|opcat>\]/m);
  assert.match(publishOutput, /--from <bot-slug>\s+Optional local MetaBot actor/m);
  assert.match(publishOutput, /configured `chain\.defaultWriteNetwork`, initially mvc/i);
  assert.match(publishOutput, /service-doge-payload\.json/);
  assert.match(publishOutput, /service-opcat-payload\.json/);

  const rateStdout = [];
  const rateExitCode = await runCli(['services', 'rate', '--help'], {
    stdout: { write: (chunk) => { rateStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(rateExitCode, 0);
  const rateOutput = rateStdout.join('');
  assert.match(rateOutput, /^Usage:\s+metabot services rate \[--from <bot-slug>\] --request-file <path> \[--chain <mvc\|btc\|doge\|opcat>\]/m);
  assert.match(rateOutput, /--from <bot-slug>\s+Optional local MetaBot actor/m);
  assert.match(rateOutput, /configured `chain\.defaultWriteNetwork`, initially mvc/i);
  assert.match(rateOutput, /rating-doge\.json/);
  assert.match(rateOutput, /rating-opcat\.json/);
});

test('runCli prints leaf help text for canonical `metabot services skills --help`', async () => {
  const stdout = [];

  const exitCode = await runCli(['services', 'skills', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot services skills \[--from <bot-slug>\]/m);
  assert.match(output, /Lists skills from one local MetaBot primary runtime only/i);
  assert.match(output, /--from <bot-slug>\s+Optional local MetaBot actor/m);
  assert.match(output, /metabot services skills --from alice/);
});

test('runCli prints leaf help text for `metabot services publish-skills --help`', async () => {
  const stdout = [];

  const exitCode = await runCli(['services', 'publish-skills', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot services publish-skills \[--slug <bot-slug>\]/m);
  assert.match(output, /Compatibility alias for `metabot services skills`/i);
  assert.match(output, /--slug <bot-slug>\s+Compatibility actor selector/m);
  assert.match(output, /metaBotSlug/m);
  assert.match(output, /runtime/m);
  assert.match(output, /skills/m);
  assert.match(output, /primary runtime is missing/i);
});

test('runCli prints services owned help with read and mutation subcommands', async () => {
  const groupStdout = [];
  const groupExitCode = await runCli(['services', 'owned', '--help'], {
    stdout: { write: (chunk) => { groupStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(groupExitCode, 0);
  const groupOutput = groupStdout.join('');
  assert.match(groupOutput, /^Usage:\s+metabot services owned <subcommand>/m);
  assert.match(groupOutput, /list\s+List services owned by the active, selected, or all local MetaBots\./);
  assert.match(groupOutput, /modify\s+Publish an on-chain modification for one owned service\./);

  const listStdout = [];
  const listExitCode = await runCli(['services', 'owned', 'list', '--help'], {
    stdout: { write: (chunk) => { listStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(listExitCode, 0);
  const listOutput = listStdout.join('');
  assert.match(listOutput, /^Usage:\s+metabot services owned list \[--from <bot-slug> \| --all\]/m);
  assert.match(listOutput, /--all\s+Aggregate owned services across all local MetaBot profiles\./);

  const modifyStdout = [];
  const modifyExitCode = await runCli(['services', 'owned', 'modify', '--help'], {
    stdout: { write: (chunk) => { modifyStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(modifyExitCode, 0);
  const modifyOutput = modifyStdout.join('');
  assert.match(modifyOutput, /^Usage:\s+metabot services owned modify \[--from <bot-slug>\] --payload-file <path>/m);
  assert.match(modifyOutput, /Rejects --all because service mutations must choose exactly one local MetaBot actor\./);
});

test('runCli prints provider operations help with order inspection and refund settlement', async () => {
  const stdout = [];

  const exitCode = await runCli(['provider', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot provider <subcommand>/m);
  assert.match(output, /Compatibility aliases for seller-side service order inspection and refund settlement\./);
  assert.match(output, /Prefer `metabot services orders inspect` and `metabot services refunds settle`/);
  assert.match(output, /order\s+Inspect seller-side provider orders\./);
  assert.match(output, /refund\s+Process seller-side refund settlement\./);
});

test('runCli prints services order and refund lifecycle help', async () => {
  const listStdout = [];
  const listExitCode = await runCli(['services', 'refunds', 'list', '--help'], {
    stdout: { write: (chunk) => { listStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(listExitCode, 0);
  const listOutput = listStdout.join('');
  assert.match(listOutput, /^Usage:\s+metabot services refunds list \[--from <bot-slug> \| --all\] \[--kind <all\|initiated\|received> \| --initiated \| --received\]/m);
  assert.match(listOutput, /--kind <all\|initiated\|received>\s+Select all refunds, buyer-side initiated refunds, or seller-side received refund requests\./m);

  const syncStdout = [];
  const syncExitCode = await runCli(['services', 'refunds', 'sync', '--help'], {
    stdout: { write: (chunk) => { syncStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(syncExitCode, 0);
  const syncOutput = syncStdout.join('');
  assert.match(syncOutput, /^Usage:\s+metabot services refunds sync \[--from <bot-slug> \| --all\]/m);
  assert.match(syncOutput, /Read refund request and finalize pins, retry due buyer requests, and update local refund state\./m);

  const orderStdout = [];
  const orderExitCode = await runCli(['services', 'orders', 'inspect', '--help'], {
    stdout: { write: (chunk) => { orderStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(orderExitCode, 0);
  const orderOutput = orderStdout.join('');
  assert.match(orderOutput, /^Usage:\s+metabot services orders inspect \[--from <bot-slug>\] \(\--order-id <id> \| --payment-txid <txid>\)/m);
  assert.match(orderOutput, /service, buyer, status, trace, payment, runtime session, and refund fields/i);

  const refundStdout = [];
  const refundExitCode = await runCli(['services', 'refunds', 'settle', '--help'], {
    stdout: { write: (chunk) => { refundStdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(refundExitCode, 0);
  const refundOutput = refundStdout.join('');
  assert.match(refundOutput, /^Usage:\s+metabot services refunds settle \[--from <bot-slug>\] \(\--order-id <id> \| --payment-txid <txid>\)/m);
  assert.match(refundOutput, /refund txid, finalization pin, or a machine-readable blocking reason/i);
});

test('runCli prints provider order inspect help with order id and payment txid selectors', async () => {
  const stdout = [];

  const exitCode = await runCli(['provider', 'order', 'inspect', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot provider order inspect \[--from <bot-slug>\] \(\--order-id <id> \| --payment-txid <txid>\)/m);
  assert.match(output, /Compatibility alias for `metabot services orders inspect`/i);
});

test('runCli prints provider refund settle help with settlement proof and blocker semantics', async () => {
  const stdout = [];

  const exitCode = await runCli(['provider', 'refund', 'settle', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot provider refund settle \[--from <bot-slug>\] \(\--order-id <id> \| --payment-txid <txid>\)/m);
  assert.match(output, /Compatibility alias for `metabot services refunds settle`/i);
});

test('runCli prints leaf help text for `metabot services call --help` with request and result semantics', async () => {
  const stdout = [];

  const exitCode = await runCli(['services', 'call', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot services call \[--from <bot-slug>\] --request-file <path>/m);
  assert.match(output, /^Required flags:/m);
  assert.match(output, /--request-file <path>\s+JSON request file\./m);
  assert.match(output, /--from <bot-slug>\s+Optional local MetaBot actor/m);
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
  assert.match(output.usage, /\[--from <bot-slug>\]/);
  assert.match(output.usage, /--trace-id <trace-id>/);
  assert.match(output.usage, /--session-id <session-id>/);
  assert.ok(output.requiredFlags.some((entry) => entry.flag === '--trace-id'));
  assert.ok(output.requiredFlags.some((entry) => entry.flag === '--session-id'));
  assert.ok(output.successFields.includes('traceId'));
  assert.ok(output.successFields.includes('sessionId'));
  assert.ok(output.successFields.includes('orderTxid'));
  assert.ok(output.successFields.includes('paymentTxid'));
  assert.ok(output.successFields.includes('localUiUrl'));
  assert.ok(output.examples.includes('metabot trace get --from alice --session-id session-a2a-123'));
});

test('runCli documents trace sessions listing with actor selectors', async () => {
  const stdout = [];

  const exitCode = await runCli(['trace', 'sessions', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['trace', 'sessions']);
  assert.match(output.usage, /\[--from <bot-slug> \| --all\]/);
  assert.ok(output.optionalFlags.some((entry) => entry.flag === '--from'));
  assert.ok(output.optionalFlags.some((entry) => entry.flag === '--all'));
  assert.ok(output.optionalFlags.some((entry) => entry.flag === '--limit'));
  assert.ok(output.successFields.includes('sessions'));
  assert.ok(output.examples.includes('metabot trace sessions --from alice --limit 20'));
});

test('runCli documents ui open selectors for page-specific handoffs', async () => {
  const stdout = [];

  const exitCode = await runCli(['ui', 'open', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['ui', 'open']);
  assert.match(output.summary, /apps/);
  assert.match(output.summary, /conversations/);
  assert.match(output.summary, /products/);
  assert.match(output.summary, /services/);
  assert.match(output.summary, /settings/);
  assert.match(output.usage, /\[--from <bot-slug>\]/);
  assert.match(output.usage, /\[--session-id <session-id>\]/);
  assert.match(output.usage, /\[--service-id <service-pin-id>\]/);
  assert.match(output.requiredFlags[0].description, /apps/);
  assert.match(output.requiredFlags[0].description, /conversations/);
  assert.match(output.requiredFlags[0].description, /products/);
  assert.match(output.requiredFlags[0].description, /services/);
  assert.match(output.requiredFlags[0].description, /settings/);
  assert.doesNotMatch(output.requiredFlags[0].description, /chat-viewer/);
  assert.doesNotMatch(output.summary, /metaapps/);
  assert.doesNotMatch(output.requiredFlags[0].description, /metaapps/);
  assert.ok(output.requiredFlags.some((entry) => entry.flag === '--page' && /products/.test(entry.description)));
  assert.ok(output.optionalFlags.some((entry) => entry.flag === '--from'));
  const traceFlag = output.optionalFlags.find((entry) => entry.flag === '--trace-id');
  assert.ok(traceFlag);
  assert.match(traceFlag.description, /Optional/);
  const sessionFlag = output.optionalFlags.find((entry) => entry.flag === '--session-id');
  assert.ok(sessionFlag);
  assert.doesNotMatch(sessionFlag.description, /chat-viewer/);
  assert.ok(output.optionalFlags.some((entry) => entry.flag === '--service-id'));
  assert.ok(output.successFields.includes('localUiUrl'));
  assert.ok(output.examples.includes('metabot ui open --page publish --from alice'));
  assert.ok(output.examples.includes('metabot ui open --page services'));
  assert.ok(output.examples.includes('metabot ui open --page conversations --from alice'));
  assert.ok(output.examples.includes('metabot ui open --page settings'));
  assert.ok(output.examples.includes('metabot ui open --page apps'));
  assert.ok(output.examples.includes('metabot ui open --page products'));
  assert.ok(output.examples.includes('metabot ui open --page products --from alice'));
  assert.ok(!output.examples.includes('metabot ui open --page metaapps'));
});

test('runCli prints browser group help with the open subcommand', async () => {
  const stdout = [];

  const exitCode = await runCli(['browser', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot browser <subcommand>/m);
  assert.match(output, /^\s+open\s+/m);
  assert.equal(output.includes('"ok"'), false);
});

test('runCli documents browser open json help with uri examples and browser url output', async () => {
  const stdout = [];

  const exitCode = await runCli(['browser', 'open', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['browser', 'open']);
  assert.equal(output.command, 'metabot browser open');
  assert.equal(output.usage, 'metabot browser open [--uri <resource-uri>]');
  const uriFlag = output.optionalFlags.find((entry) => entry.flag === '--uri');
  assert.ok(uriFlag);
  assert.match(uriFlag.description, /optional Browser resource URI/i);
  assert.ok(output.examples.includes('metabot browser open --uri metaid://<globalMetaId>'));
  assert.ok(output.examples.includes('metabot browser open --uri metaapp://<pinId>'));
  assert.ok(output.examples.includes('metabot browser open --uri metafile://<pinId>.png'));
  assert.ok(output.successFields.includes('localUiUrl'));
});

test('runCli keeps browser out of ui open page help', async () => {
  const stdout = [];

  const exitCode = await runCli(['ui', 'open', '--help', '--json'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);

  const output = JSON.parse(stdout.join(''));
  assert.doesNotMatch(output.summary, /\bbrowser\b/i);
  assert.doesNotMatch(output.requiredFlags[0].description, /\bbrowser\b/i);
  for (const example of output.examples) {
    assert.doesNotMatch(example, /\bbrowser\b/i);
  }
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
  assert.match(output.usage, /^metabot chat private \[--from <bot-slug>\] --request-file <path> \[--chain <mvc\|btc\|doge\|opcat>\]$/);
  assert.equal(output.summary, 'Send one encrypted private MetaWeb message to another MetaBot.');
  assert.deepEqual(output.requiredFlags, [
    {
      flag: '--request-file',
      value: '<path>',
      description: 'JSON request file.',
    },
  ]);
  assert.ok(output.optionalFlags.some((entry) => (
    entry.flag === '--chain'
    && entry.value === '<mvc|btc|doge|opcat>'
    && /chain\.defaultWriteNetwork/.test(entry.description)
  )));
  assert.ok(output.optionalFlags.some((entry) => entry.flag === '--from'));
  assert.equal(output.requestShape.to, 'remote globalMetaId');
  assert.equal(output.requestShape.content, 'message text');
  assert.equal(output.requestShape.replyPin, 'optional prior message pin id');
  assert.equal(output.requestShape.network, 'optional chain network override: mvc, btc, doge, or opcat');
  assert.ok(Array.isArray(output.successFields));
  assert.ok(output.successFields.includes('traceId'));
  assert.ok(output.successFields.includes('pinId'));
  assert.ok(output.successFields.includes('txids'));
  assert.ok(output.successFields.includes('localUiUrl'));
  assert.equal(output.successFields.includes('payload'), false);
  assert.equal(output.successFields.includes('encryptedContent'), false);
  assert.equal(output.successFields.includes('peerChatPublicKey'), false);
});

test('runCli documents actor selection for chat history and auto-reply commands', async () => {
  const cases = [
    {
      args: ['chat', 'conversations', '--help'],
      usage: /^Usage:\s+metabot chat conversations \[--from <bot-slug>\]/m,
    },
    {
      args: ['chat', 'messages', '--help'],
      usage: /^Usage:\s+metabot chat messages \[--from <bot-slug>\] --conversation-id <conversation-id> \[--limit <n>\]/m,
    },
    {
      args: ['chat', 'auto-reply', 'status', '--help'],
      usage: /^Usage:\s+metabot chat auto-reply status \[--from <bot-slug>\]/m,
    },
    {
      args: ['chat', 'auto-reply', 'enable', '--help'],
      usage: /^Usage:\s+metabot chat auto-reply enable \[--from <bot-slug>\] \[--strategy <strategy-id>\]/m,
    },
    {
      args: ['chat', 'auto-reply', 'disable', '--help'],
      usage: /^Usage:\s+metabot chat auto-reply disable \[--from <bot-slug>\]/m,
    },
  ];

  for (const entry of cases) {
    const stdout = [];
    const exitCode = await runCli(entry.args, {
      stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
      stderr: { write: () => true },
    });

    assert.equal(exitCode, 0);
    const output = stdout.join('');
    assert.match(output, entry.usage);
    assert.match(output, /--from <bot-slug>/);
  }
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
  assert.match(output, /^Usage:\s+metabot skills resolve --skill <skill-name> --format <json\|markdown> \[--host <claude-code\|codex\|copilot\|opencode\|openclaw\|hermes\|gemini\|pi\|cursor\|kimi\|kiro\|codebuddy\|zcode\|workbuddy>\]/m);
  assert.match(output, /^Required flags:/m);
  assert.match(output, /--skill <skill-name>\s+Base skill id to resolve, such as metabot-network-manage\./m);
  assert.match(output, /--format <json\|markdown>\s+Output shape to render\./m);
  assert.match(output, /^Optional flags:/m);
  assert.match(output, /--host <claude-code\|codex\|copilot\|opencode\|openclaw\|hermes\|gemini\|pi\|cursor\|kimi\|kiro\|codebuddy\|zcode\|workbuddy>\s+Optional compatibility override\./m);
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
  assert.equal(output.usage, 'metabot skills resolve --skill <skill-name> --format <json|markdown> [--host <claude-code|codex|copilot|opencode|openclaw|hermes|gemini|pi|cursor|kimi|kiro|codebuddy|zcode|workbuddy>]');
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
      value: '<claude-code|codex|copilot|opencode|openclaw|hermes|gemini|pi|cursor|kimi|kiro|codebuddy|zcode|workbuddy>',
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

test('runCli prints LLM group help with canonical --from examples', async () => {
  const stdout = [];

  const exitCode = await runCli(['llm', '--help'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /--from my-bot/);
  assert.match(output, /--slug remains a compatibility alias/i);
});

test('runCli prints LLM leaf JSON help for actor-scoped binding commands', async () => {
  for (const [subcommand, usage] of [
    ['bindings', 'metabot llm bindings [--from <bot-slug>]'],
    ['bind', 'metabot llm bind [--from <bot-slug>] --runtime-id <runtime-id> [--role <role>] [--priority <n>]'],
    ['unbind', 'metabot llm unbind [--from <bot-slug>] --binding-id <binding-id>'],
    ['set-preferred', 'metabot llm set-preferred [--from <bot-slug>] [--runtime-id <runtime-id>]'],
    ['get-preferred', 'metabot llm get-preferred [--from <bot-slug>]'],
  ]) {
    const stdout = [];
    const exitCode = await runCli(['llm', subcommand, '--help', '--json'], {
      stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
      stderr: { write: () => true },
    });

    assert.equal(exitCode, 0);
    const payload = JSON.parse(stdout.join(''));
    assert.deepEqual(payload.commandPath, ['llm', subcommand]);
    assert.equal(payload.usage, usage);
    assert.ok(payload.optionalFlags.some((entry) => entry.flag === '--from'));
  }
});
