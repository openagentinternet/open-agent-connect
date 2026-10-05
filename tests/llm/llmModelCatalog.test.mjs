import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  CLAUDE_STATIC_MODELS,
  CODEX_STATIC_MODELS,
  CURSOR_STATIC_MODELS,
  discoverModelCatalog,
} = require('../../dist/core/llm/modelCatalog.js');

async function writeExecutableScript(dir, name, source) {
  const filePath = path.join(dir, name);
  await writeFile(filePath, source, 'utf8');
  await chmod(filePath, 0o755);
  return filePath;
}

test('claude model catalog uses the stream-json list_models control request', async () => {
  const tempRoot = await mkdtempTempRoot('oac-models-claude-');
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const binaryPath = await writeExecutableScript(binDir, 'fake-claude', `#!/bin/sh
cat > "$FAKE_CLAUDE_STDIN"
printf '%s\\n' '{"type":"control_response","response":{"subtype":"success","request_id":"oac-list-models","response":{"models":[{"value":"default","resolvedModel":"claude-sonnet-5"},{"value":"sonnet","resolvedModel":"claude-sonnet-5","displayName":"Sonnet 5"},{"value":"opus1m","resolvedModel":"claude-opus-5-5[1m]","displayName":"Opus 5.5","disabled":false},{"value":"fable","resolvedModel":"claude-fable-5-1","displayName":"Fable 5.1","disabled":true}]}}}'
exit 0
`);

  const catalog = await discoverModelCatalog({
    provider: 'claude-code',
    binaryPath,
    env: { ...process.env, FAKE_CLAUDE_STDIN: path.join(tempRoot, 'stdin.txt') },
  });

  const { readFile } = await import('node:fs/promises');
  const request = JSON.parse((await readFile(path.join(tempRoot, 'stdin.txt'), 'utf8')).trim());
  assert.equal(request.type, 'control_request');
  assert.equal(request.request.subtype, 'list_models');

  assert.equal(catalog.source, 'live');
  assert.deepEqual(catalog.models, [
    { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    { id: 'claude-opus-5-5[1m]', label: 'Opus 5.5' },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', disabled: true },
  ]);
});

test('claude model catalog degrades to the static fallback when the control request is unsupported', async () => {
  const tempRoot = await mkdtempTempRoot('oac-models-claude-unsupported-');
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const binaryPath = await writeExecutableScript(binDir, 'fake-claude', `#!/bin/sh
cat > /dev/null
printf '%s\\n' '{"type":"control_response","response":{"subtype":"error","request_id":"oac-list-models","error":"Unsupported control request subtype: list_models"}}'
exit 0
`);

  const catalog = await discoverModelCatalog({
    provider: 'claude-code',
    binaryPath,
    env: { ...process.env },
  });

  assert.equal(catalog.source, 'static');
  assert.match(catalog.reason, /Unsupported control request subtype/);
  assert.equal(catalog.models, CLAUDE_STATIC_MODELS);
  assert.ok(catalog.models.some((model) => model.id === 'claude-sonnet-4-6' && model.default));
});

test('codex model catalog parses debug models and marks the first visible entry default', async () => {
  const tempRoot = await mkdtempTempRoot('oac-models-codex-');
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const binaryPath = await writeExecutableScript(binDir, 'fake-codex', `#!/bin/sh
if [ "$1" = "debug" ] && [ "$2" = "models" ] && [ "$3" != "--bundled" ]; then
  printf '%s' '{"models":[
    {"slug":"gpt-6-astra","display_name":"GPT-6-Astra","visibility":"visible"},
    {"slug":"gpt-6.1-sol","display_name":"GPT-6.1-Sol","visibility":"visible"},
    {"slug":"hidden-experiment","visibility":"hide"}
  ]}'
  exit 0
fi
printf '%s' '{"models":[{"slug":"bundled-only","visibility":"visible"}]}'
exit 0
`);

  const catalog = await discoverModelCatalog({
    provider: 'codex',
    binaryPath,
    env: { ...process.env },
    version: '0.159.3',
  });

  assert.equal(catalog.source, 'live');
  assert.deepEqual(catalog.models, [
    { id: 'gpt-6-astra', label: 'GPT-6-Astra', default: true },
    { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' },
  ]);
});

test('codex model catalog falls back to bundled, then static', async () => {
  const tempRoot = await mkdtempTempRoot('oac-models-codex-fallback-');
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const binaryPath = await writeExecutableScript(binDir, 'fake-codex', `#!/bin/sh
echo "$@" >> "$FAKE_CODEX_CALLS"
if [ "$3" = "--bundled" ]; then
  printf '%s' '{"models":[{"slug":"bundled-model","visibility":"visible"}]}'
  exit 0
fi
printf '%s' '{"models":[]}'
exit 0
`);

  const bundled = await discoverModelCatalog({
    provider: 'codex',
    binaryPath,
    env: { ...process.env, FAKE_CODEX_CALLS: path.join(tempRoot, 'calls.txt') },
    version: '0.159.3',
  });
  assert.equal(bundled.source, 'bundled');
  assert.deepEqual(bundled.models, [{ id: 'bundled-model', label: 'bundled-model', default: true }]);
  const { readFile } = await import('node:fs/promises');
  const calls = (await readFile(path.join(tempRoot, 'calls.txt'), 'utf8')).trim().split('\n');
  assert.deepEqual(calls, ['debug models', 'debug models --bundled']);
});

test('codex model catalog gates debug models on the CLI version', async () => {
  const tempRoot = await mkdtempTempRoot('oac-models-codex-gate-');
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const binaryPath = await writeExecutableScript(binDir, 'fake-codex', `#!/bin/sh
echo "debug models must not run" >&2
exit 3
`);

  const catalog = await discoverModelCatalog({
    provider: 'codex',
    binaryPath,
    env: { ...process.env },
    version: '0.100.0',
  });

  assert.equal(catalog.source, 'static');
  assert.match(catalog.reason, /0\.100\.0 predates/);
  assert.equal(catalog.models, CODEX_STATIC_MODELS);
  assert.ok(catalog.models.some((model) => model.id === 'gpt-6-astra' && model.default));
});

test('cursor model catalog parses id - label rows and flags the default', async () => {
  const tempRoot = await mkdtempTempRoot('oac-models-cursor-');
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const binaryPath = await writeExecutableScript(binDir, 'fake-cursor-agent', `#!/bin/sh
printf 'Available models\\n\\nauto - Auto\\ncomposer-2-fast - Composer 2 Fast (current, default)\\nclaude-4.6-sonnet-medium - Claude 4.6 Sonnet Medium\\n'
exit 0
`);

  const catalog = await discoverModelCatalog({
    provider: 'cursor',
    binaryPath,
    env: { ...process.env },
  });

  assert.equal(catalog.source, 'live');
  assert.deepEqual(catalog.models, [
    { id: 'auto', label: 'Auto' },
    { id: 'composer-2-fast', label: 'Composer 2 Fast', default: true },
    { id: 'claude-4.6-sonnet-medium', label: 'Claude 4.6 Sonnet Medium' },
  ]);
});

test('cursor model catalog degrades to the minimal static list on failure', async () => {
  const tempRoot = await mkdtempTempRoot('oac-models-cursor-fail-');
  const binDir = path.join(tempRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const binaryPath = await writeExecutableScript(binDir, 'fake-cursor-agent', `#!/bin/sh
echo 'Error: Authentication required.' >&2
exit 1
`);

  const catalog = await discoverModelCatalog({
    provider: 'cursor',
    binaryPath,
    env: { ...process.env },
  });

  assert.equal(catalog.source, 'static');
  assert.equal(catalog.models, CURSOR_STATIC_MODELS);
  assert.equal(catalog.models[0].id, 'auto');
});
