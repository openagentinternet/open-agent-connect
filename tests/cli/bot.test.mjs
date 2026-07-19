import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

test('runCli dispatches bot profile read commands', async () => {
  const calls = [];
  const listExitCode = await runCli(['bot', 'list'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      bot: {
        listProfiles: async () => {
          calls.push(['list']);
          return commandSuccess({ profiles: [] });
        },
      },
    },
  });
  const showExitCode = await runCli(['bot', 'show', '--from', 'alice'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      bot: {
        getProfile: async (input) => {
          calls.push(['show', input]);
          return commandSuccess({ profile: input.slug });
        },
      },
    },
  });

  assert.equal(listExitCode, 0);
  assert.equal(showExitCode, 0);
  assert.deepEqual(calls, [
    ['list'],
    ['show', { slug: 'alice' }],
  ]);
});

test('runCli dispatches bot profile mutations with actor selectors', async () => {
  const tempDir = await mkdtempTempRoot('metabot-cli-bot-');
  const payloadFile = path.join(tempDir, 'profile.json');
  await writeFile(payloadFile, JSON.stringify({ displayName: 'Alice Bot' }), 'utf8');

  const calls = [];
  const createExitCode = await runCli(['bot', 'create', '--name', 'Alice', '--host', 'codex'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      bot: {
        createProfile: async (input) => {
          calls.push(['create', input]);
          return commandSuccess({ profile: input.name });
        },
      },
    },
  });
  const updateExitCode = await runCli(['bot', 'update', '--from', 'alice', '--payload-file', payloadFile], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      bot: {
        updateProfile: async (input) => {
          calls.push(['update', input]);
          return commandSuccess({ profile: input.slug });
        },
      },
    },
  });
  const deleteExitCode = await runCli(['bot', 'delete', '--from', 'alice', '--confirm'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      bot: {
        deleteProfile: async (input) => {
          calls.push(['delete', input]);
          return commandSuccess({ deleted: input.slug });
        },
      },
    },
  });

  assert.equal(createExitCode, 0);
  assert.equal(updateExitCode, 0);
  assert.equal(deleteExitCode, 0);
  assert.deepEqual(calls, [
    ['create', { name: 'Alice', host: 'codex' }],
    ['update', { slug: 'alice', displayName: 'Alice Bot' }],
    ['delete', { slug: 'alice', confirm: true }],
  ]);
});

test('runCli dispatches bot config, wallet, backup, runtime, and session commands', async () => {
  const tempDir = await mkdtempTempRoot('metabot-cli-bot-config-');
  const configFile = path.join(tempDir, 'config.json');
  await writeFile(configFile, JSON.stringify({ chain: { defaultWriteNetwork: 'doge' } }), 'utf8');

  const calls = [];
  const commands = [
    ['bot', 'config', 'get', '--from', 'alice'],
    ['bot', 'config', 'set', '--from', 'alice', '--payload-file', configFile],
    ['bot', 'wallet', '--from', 'alice'],
    ['bot', 'backup', '--from', 'alice'],
    ['bot', 'runtimes', 'list', '--from', 'alice'],
    ['bot', 'runtimes', 'discover', '--from', 'alice'],
    ['bot', 'sessions', '--from', 'alice', '--limit', '50'],
  ];
  const dependencies = {
    bot: {
      getConfig: async (input) => {
        calls.push(['config:get', input]);
        return commandSuccess({});
      },
      setConfig: async (input) => {
        calls.push(['config:set', input]);
        return commandSuccess({});
      },
      getWallet: async (input) => {
        calls.push(['wallet', input]);
        return commandSuccess({});
      },
      getBackup: async (input) => {
        calls.push(['backup', input]);
        return commandSuccess({});
      },
      listRuntimes: async (input) => {
        calls.push(['runtimes:list', input]);
        return commandSuccess({});
      },
      discoverRuntimes: async (input) => {
        calls.push(['runtimes:discover', input]);
        return commandSuccess({});
      },
      listSessions: async (input) => {
        calls.push(['sessions', input]);
        return commandSuccess({});
      },
    },
  };

  for (const argv of commands) {
    const exitCode = await runCli(argv, {
      stdout: { write: () => true },
      stderr: { write: () => true },
      dependencies,
    });
    assert.equal(exitCode, 0, argv.join(' '));
  }

  assert.deepEqual(calls, [
    ['config:get', { slug: 'alice' }],
    ['config:set', { slug: 'alice', chain: { defaultWriteNetwork: 'doge' } }],
    ['wallet', { slug: 'alice' }],
    ['backup', { slug: 'alice' }],
    ['runtimes:list', { from: 'alice' }],
    ['runtimes:discover', { from: 'alice' }],
    ['sessions', { slug: 'alice', limit: 50 }],
  ]);
});
