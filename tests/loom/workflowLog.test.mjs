import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  selectProcessLogFileChain,
  redactLoomProcessLog,
  renderLoomProcessLog,
  writeLoomProcessLogFile,
} = require('../../dist/core/loom/index.js');

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test('selects the process log file chain from the record chain by default', () => {
  assert.equal(selectProcessLogFileChain('mvc'), 'mvc');
  assert.equal(selectProcessLogFileChain('btc'), 'btc');
  assert.equal(selectProcessLogFileChain('opcat'), 'opcat');
  assert.equal(selectProcessLogFileChain('doge'), 'mvc');
});

test('honors supported explicit process log file chain overrides', () => {
  assert.equal(selectProcessLogFileChain('mvc', 'btc'), 'btc');
  assert.equal(selectProcessLogFileChain('btc', 'opcat'), 'opcat');
  assert.equal(selectProcessLogFileChain('opcat', 'mvc'), 'mvc');
});

test('rejects unsupported explicit process log file chain overrides', () => {
  assert.throws(
    () => selectProcessLogFileChain('mvc', 'doge'),
    /Unsupported Loom process log file chain/,
  );
});

test('redacts common process log secrets', () => {
  const privateKey = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'private-key-material',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n');
  const input = [
    'Authorization: Bearer abc',
    'url=https://example.test?api_key=abc',
    'token=abc',
    'mnemonic: abandon ability able about above absent absorb abstract absurd abuse access accident',
    privateKey,
  ].join('\n');

  const redacted = redactLoomProcessLog(input);

  assert.doesNotMatch(redacted, /Bearer abc/);
  assert.doesNotMatch(redacted, /api_key=abc/);
  assert.doesNotMatch(redacted, /token=abc/);
  assert.doesNotMatch(redacted, /abandon ability able/);
  assert.doesNotMatch(redacted, /private-key-material/);
  assert.match(redacted, /\[REDACTED/);
});

test('renders deterministic markdown-ish process logs with truncation notes', () => {
  const rendered = renderLoomProcessLog({
    taskPinId: 'task-pin',
    claimPinId: 'claim-pin',
    actor: {
      slug: 'dev-bot',
      globalMetaId: 'global-meta-id',
    },
    repo: {
      uri: 'https://github.com/example/repo',
      branch: 'codex/loom',
    },
    roundNote: 'Implemented workflow helpers.',
    llm: {
      model: 'gpt-5.5',
      sessionId: 'session-123',
    },
    checks: [
      { command: 'npm run build', status: 'passed', summary: 'build passed' },
      { command: 'node --test tests/loom/workflowLog.test.mjs', status: 'passed' },
    ],
    git: {
      changes: ['src/core/loom/workflowLog.ts'],
      commits: [{ sha: 'abc1234', message: 'feat: add logs' }],
    },
    statusDecision: {
      status: 'completed',
      summary: 'Ready for review.',
    },
    payloadPreview: {
      status: 'completed',
      processLogs: ['metafile://log'],
    },
    chainResult: {
      pinId: 'status-pin',
      txids: ['tx1'],
    },
    errors: ['Authorization: Bearer abc'],
    rawLog: 'x'.repeat(120_000),
    maxBytes: 4_000,
  });

  assert.match(rendered, /Task: task-pin/);
  assert.match(rendered, /Claim: claim-pin/);
  assert.match(rendered, /build passed/);
  assert.match(rendered, /abc1234 feat: add logs/);
  assert.match(rendered, /completed/);
  assert.match(rendered, /truncated/);
  assert.doesNotMatch(rendered, /Bearer abc/);
  assert.ok(Buffer.byteLength(rendered, 'utf8') <= 4_200);
});

test('redacts secrets from rendered check commands', () => {
  const rendered = renderLoomProcessLog({
    taskPinId: 'task-pin',
    claimPinId: 'claim-pin',
    checks: [
      {
        command: 'curl -H "Authorization: Bearer abc" https://example.test',
        status: 'failed',
        summary: 'request failed',
      },
    ],
  });

  assert.doesNotMatch(rendered, /abc/);
  assert.doesNotMatch(rendered, /Bearer abc/);
  assert.match(rendered, /Authorization: Bearer \[REDACTED\]/);
});

test('truncates non-ascii logs within the configured byte limit', () => {
  const maxBytes = 98;
  const rendered = renderLoomProcessLog({
    taskPinId: 'task-pin',
    claimPinId: 'claim-pin',
    rawLog: '开发日志'.repeat(100),
    maxBytes,
  });

  assert.ok(Buffer.byteLength(rendered, 'utf8') <= maxBytes);
});

test('writes rendered process logs to the expected path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-process-log-'));
  try {
    const result = await writeLoomProcessLogFile({
      directory,
      fileName: 'round-1.md',
      taskPinId: 'task-pin',
      claimPinId: 'claim-pin',
      statusDecision: {
        status: 'in_progress',
        summary: 'Working.',
      },
      checks: [{ command: 'npm run build', status: 'passed' }],
      git: {
        commits: [{ sha: 'abc1234', message: 'feat: add logs' }],
      },
    });

    assert.equal(result.path, join(directory, 'round-1.md'));
    assert.match(result.content, /Task: task-pin/);
    assert.equal(result.content.endsWith('\n'), true);
    assert.equal(await readFile(result.path, 'utf8'), result.content);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unsafe process log filenames without writing outside the directory', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'loom-process-log-parent-'));
  const directory = join(parentDirectory, 'logs');
  const outsidePath = join(parentDirectory, 'escape.md');
  try {
    await assert.rejects(
      () => writeLoomProcessLogFile({
        directory,
        fileName: '../escape.md',
        taskPinId: 'task-pin',
        claimPinId: 'claim-pin',
        statusDecision: {
          status: 'failed',
          summary: 'Unsafe path rejected.',
        },
      }),
      /Unsafe Loom process log file name/,
    );
    assert.equal(await fileExists(outsidePath), false);
  } finally {
    await rm(parentDirectory, { recursive: true, force: true });
  }
});
