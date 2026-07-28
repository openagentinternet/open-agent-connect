import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

const VALID_PIN_ID = `${'a1b2c3d4'.repeat(8)}i0`;

async function runBrowserCli(args, context = {}) {
  const stdout = [];
  const exitCode = await runCli(args, {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    ...context,
  });
  return {
    exitCode,
    envelope: stdout.length ? JSON.parse(stdout.join('').trim()) : null,
  };
}

test('runCli dispatches `metabot browser link --uri` to the configured handler', async () => {
  const calls = [];
  const { exitCode, envelope } = await runBrowserCli([
    'browser',
    'link',
    '--uri', `metaapp://${VALID_PIN_ID}`,
  ], {
    dependencies: {
      browser: {
        link: async (input) => {
          calls.push(input);
          return commandSuccess({ uri: input.uri, localUiUrl: 'http://127.0.0.1:4827/browser/metaapp/x' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.deepEqual(calls, [{ uri: `metaapp://${VALID_PIN_ID}` }]);
});

test('runCli rejects `metabot browser link` without --uri or with a flag-like value', async () => {
  for (const args of [['browser', 'link'], ['browser', 'link', '--uri', '--flag']]) {
    let linkCalled = false;
    const { exitCode, envelope } = await runBrowserCli(args, {
      dependencies: {
        browser: {
          link: async () => {
            linkCalled = true;
            return commandSuccess({ shouldNotRun: true });
          },
        },
      },
    });

    assert.equal(exitCode, 1, `expected failure for ${args.join(' ')}`);
    assert.equal(envelope.code, 'invalid_flag', `expected invalid_flag for ${args.join(' ')}`);
    assert.equal(linkCalled, false, `handler must not run for ${args.join(' ')}`);
  }
});

test('runCli default `metabot browser link` handler resolves a clickable Browser URL when a daemon base URL is configured', async () => {
  const systemHome = await mkdtempTempRoot('oac-cli-browser-link-');

  const { exitCode, envelope } = await runBrowserCli([
    'browser',
    'link',
    '--uri', `metaapp://${VALID_PIN_ID}`,
  ], {
    env: { HOME: systemHome, METABOT_DAEMON_BASE_URL: 'http://127.0.0.1:10001' },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, {
    uri: `metaapp://${VALID_PIN_ID}`,
    localUiUrl: `http://127.0.0.1:10001/browser/metaapp/${VALID_PIN_ID}`,
  });
});

test('runCli default `metabot browser link` handler normalizes map URIs through the browser query route', async () => {
  const systemHome = await mkdtempTempRoot('oac-cli-browser-link-map-');

  const { exitCode, envelope } = await runBrowserCli([
    'browser',
    'link',
    '--uri', 'map://sunnyfung.eth/root',
  ], {
    env: { HOME: systemHome, METABOT_DAEMON_BASE_URL: 'http://127.0.0.1:10001' },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  const url = new URL(envelope.data.localUiUrl);
  assert.equal(url.pathname, '/browser');
  assert.equal(url.searchParams.get('uri'), 'map://sunnyfung.eth/root');
});

test('runCli default `metabot browser link` handler returns the bare URI when no daemon is reachable', async () => {
  const systemHome = await mkdtempTempRoot('oac-cli-browser-link-down-');

  const { exitCode, envelope } = await runBrowserCli([
    'browser',
    'link',
    '--uri', 'metaid://idq1alice',
  ], {
    env: { HOME: systemHome },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { uri: 'metaid://idq1alice' });
});
