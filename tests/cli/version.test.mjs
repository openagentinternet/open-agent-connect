import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const pkg = require('../../package.json');

function captureStdout() {
  const chunks = [];
  return {
    chunks,
    context: {
      stdout: { write: (chunk) => { chunks.push(String(chunk)); return true; } },
      stderr: { write: () => true },
    },
  };
}

test('runCli prints plain version text for `metabot --version`', async () => {
  const cap = captureStdout();
  const exitCode = await runCli(['--version'], cap.context);
  assert.equal(exitCode, 0);
  assert.equal(cap.chunks.join(''), `metabot ${pkg.version}\n`);
});

test('runCli prints plain version text for `metabot -v`', async () => {
  const cap = captureStdout();
  const exitCode = await runCli(['-v'], cap.context);
  assert.equal(exitCode, 0);
  assert.equal(cap.chunks.join(''), `metabot ${pkg.version}\n`);
});

test('runCli prints JSON version for `metabot --version --json`', async () => {
  const cap = captureStdout();
  const exitCode = await runCli(['--version', '--json'], cap.context);
  assert.equal(exitCode, 0);
  const parsed = JSON.parse(cap.chunks.join(''));
  assert.deepEqual(parsed, { version: pkg.version });
});

test('runCli root help advertises the --version flag', async () => {
  const cap = captureStdout();
  const exitCode = await runCli(['--help'], cap.context);
  assert.equal(exitCode, 0);
  const output = cap.chunks.join('');
  assert.match(output, /^Optional flags:/m);
  assert.match(output, /--version, -v\s+Print the metabot CLI version/);
});
