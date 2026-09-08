// Tests for the `metabot media describe` CLI dispatch: flag parsing, path
// validation, and the friendly error envelope. The relay client itself is
// covered by tests/llm/llmRelayService.test.mjs; here the fetch layer is
// pointed at an unreachable localhost endpoint through the
// OAC_VISION_RELAY_* static-credential env pair so no network is touched.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

function createHarness(homeDir) {
  const stdout = [];
  const stderr = [];
  const context = {
    env: {
      ...process.env,
      HOME: homeDir,
      OAC_VISION_RELAY_URL: 'http://127.0.0.1:9/assist-open-api',
      OAC_VISION_RELAY_API_KEY: 'mrk_cli_test',
    },
    cwd: homeDir,
    stdout: { write: (chunk) => stdout.push(String(chunk)) },
    stderr: { write: (chunk) => stderr.push(String(chunk)) },
  };
  return { stdout, stderr, context };
}

function parseResult(stdout) {
  return JSON.parse(stdout.join('').trim());
}

test('media describe rejects an unknown kind and a missing --path', async () => {
  const homeDir = await mkdtempTempRoot('oac-cli-media-test-');
  {
    const { stdout, context } = createHarness(homeDir);
    const exitCode = await runCli(['media', 'describe', 'bogus', '--path', '/tmp/a.png'], context);
    assert.equal(exitCode, 1);
    const result = parseResult(stdout);
    assert.equal(result.code, 'invalid_argument');
    assert.match(result.message, /Unknown media kind: bogus/);
  }
  {
    const { stdout, context } = createHarness(homeDir);
    const exitCode = await runCli(['media', 'describe', 'image'], context);
    assert.equal(exitCode, 1);
    const result = parseResult(stdout);
    assert.equal(result.code, 'missing_flag');
    assert.match(result.message, /--path/);
  }
});

test('media describe rejects relative local paths before any relay call', async () => {
  const homeDir = await mkdtempTempRoot('oac-cli-media-test-');
  {
    const { stdout, context } = createHarness(homeDir);
    const exitCode = await runCli(['media', 'describe', 'image', '--path', 'relative.png'], context);
    assert.equal(exitCode, 1);
    const result = parseResult(stdout);
    assert.equal(result.code, 'invalid_argument');
    assert.match(result.message, /must be an absolute local path/);
  }
  {
    const { stdout, context } = createHarness(homeDir);
    const exitCode = await runCli(['media', 'describe', 'audio', '--path', 'relative.mp3'], context);
    assert.equal(exitCode, 1);
    const result = parseResult(stdout);
    assert.equal(result.code, 'invalid_argument');
    assert.match(result.message, /must be absolute for local audio/);
  }
});

test('media describe surfaces relay transport failures through the friendly mapper', async () => {
  const homeDir = await mkdtempTempRoot('oac-cli-media-test-');
  const { stdout, context } = createHarness(homeDir);
  const exitCode = await runCli(['media', 'describe', 'image', '--path', '/etc/hostname.png'], context);
  assert.equal(exitCode, 1);
  const result = parseResult(stdout);
  assert.equal(result.code, 'media_describe_failed');
  // The unreachable endpoint surfaces as a relay request failure, not a crash.
  assert.match(result.message, /Image reading failed:/);
});

test('media help renders the command family', async () => {
  const homeDir = await mkdtempTempRoot('oac-cli-media-test-');
  const { stdout, context } = createHarness(homeDir);
  const exitCode = await runCli(['media', '--help'], context);
  assert.equal(exitCode, 0);
  const text = stdout.join('');
  assert.match(text, /metabot media describe <image\|video\|audio>/);
  assert.match(text, /--question/);
});
