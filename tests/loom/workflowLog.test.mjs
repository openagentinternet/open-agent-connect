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

test('redacts json env and query token shapes while keeping non-secret text readable', () => {
  const input = [
    'status=plain text is still readable',
    '{"api_key":"json-api-secret","token":"json-token-secret"}',
    '{"token":"secret value"}',
    '{"Authorization":"Bearer json-bearer-secret"}',
    'OPENAI_API_KEY=sk-openai-secret',
    'GITHUB_TOKEN=ghp_githubsecret',
    'openai_api_key=sk-lower-openai-secret',
    'github_token=ghp_lowergithubsecret',
    'Api-Key: sk-header-secret',
    'callback=https://example.test?access_token=query-secret&state=ok',
  ].join('\n');

  const redacted = redactLoomProcessLog(input);

  assert.match(redacted, /plain text is still readable/);
  assert.match(redacted, /state=ok/);
  assert.doesNotMatch(redacted, /json-api-secret/);
  assert.doesNotMatch(redacted, /json-token-secret/);
  assert.doesNotMatch(redacted, /secret value/);
  assert.doesNotMatch(redacted, /json-bearer-secret/);
  assert.doesNotMatch(redacted, /sk-openai-secret/);
  assert.doesNotMatch(redacted, /ghp_githubsecret/);
  assert.doesNotMatch(redacted, /sk-lower-openai-secret/);
  assert.doesNotMatch(redacted, /ghp_lowergithubsecret/);
  assert.doesNotMatch(redacted, /sk-header-secret/);
  assert.doesNotMatch(redacted, /query-secret/);
});

test('redacts cli flag and authorization token secret shapes', () => {
  const input = [
    'command=oac publish --token ghp_secret --api-key sk-secret --dry-run',
    'TOKEN="secret value"',
    "API_KEY='single-quote-secret'",
    'Authorization: token ghp_authsecret',
    'visible text remains readable',
  ].join('\n');

  const redacted = redactLoomProcessLog(input);

  assert.match(redacted, /visible text remains readable/);
  assert.match(redacted, /--dry-run/);
  assert.doesNotMatch(redacted, /ghp_secret/);
  assert.doesNotMatch(redacted, /sk-secret/);
  assert.doesNotMatch(redacted, /secret value/);
  assert.doesNotMatch(redacted, /single-quote-secret/);
  assert.doesNotMatch(redacted, /ghp_authsecret/);
});

test('redacts cli secret shapes from rendered check commands', () => {
  const rendered = renderLoomProcessLog({
    checks: [
      {
        command: 'oac publish --token ghp_secret --api-key sk-secret',
        status: 'failed',
      },
      {
        command: 'curl -H "Authorization: token ghp_authsecret" https://example.test',
        status: 'failed',
      },
    ],
  });

  assert.doesNotMatch(rendered, /ghp_secret/);
  assert.doesNotMatch(rendered, /sk-secret/);
  assert.doesNotMatch(rendered, /ghp_authsecret/);
});

test('redacts labelled mnemonic material without erasing ordinary prose', () => {
  const mnemonic = redactLoomProcessLog(
    'seed phrase: abandon ability able about above absent absorb abstract absurd abuse access accident',
  );
  const jsonMnemonic = redactLoomProcessLog(
    '{"mnemonic":"abandon ability able about above absent absorb abstract absurd abuse access accident"}',
  );
  const jsonSeed = redactLoomProcessLog(
    '{"seed":"abandon ability able about above absent absorb abstract absurd abuse access accident"}',
  );
  const seedEquals = redactLoomProcessLog(
    'seed=abandon ability able about above absent absorb abstract absurd abuse access accident',
  );
  const seedWords = redactLoomProcessLog(
    'seed_words="abandon ability able about above absent absorb abstract absurd abuse access accident"',
  );
  const mention = redactLoomProcessLog(
    'Implemented mnemonic redaction tests and confirmed mnemonic not found in output.',
  );
  const prose = redactLoomProcessLog(
    'this ordinary process summary explains progress across checks commits branches reviews and cleanup',
  );

  assert.match(mnemonic, /\[REDACTED MNEMONIC\]/);
  assert.doesNotMatch(mnemonic, /abandon ability able/);
  assert.match(jsonMnemonic, /\[REDACTED MNEMONIC\]/);
  assert.doesNotMatch(jsonMnemonic, /abandon ability able/);
  assert.match(jsonSeed, /\[REDACTED MNEMONIC\]/);
  assert.doesNotMatch(jsonSeed, /abandon ability able/);
  assert.match(seedEquals, /\[REDACTED MNEMONIC\]/);
  assert.doesNotMatch(seedEquals, /abandon ability able/);
  assert.match(seedWords, /\[REDACTED MNEMONIC\]/);
  assert.doesNotMatch(seedWords, /abandon ability able/);
  assert.match(mention, /Implemented mnemonic redaction tests/);
  assert.match(mention, /mnemonic not found in output/);
  assert.doesNotMatch(mention, /\[REDACTED MNEMONIC\]/);
  assert.match(prose, /ordinary process summary/);
  assert.doesNotMatch(prose, /\[REDACTED MNEMONIC\]/);
});

test('redacts json-style secrets from rendered diagnostics', () => {
  const rendered = renderLoomProcessLog({
    payloadPreview: {
      mnemonic: 'abandon ability able about above absent absorb abstract absurd abuse access accident',
      token: 'secret value',
    },
    chainResult: {
      seed: 'abandon ability able about above absent absorb abstract absurd abuse access accident',
    },
    roundNote: 'ordinary mnemonic prose remains readable',
  });

  assert.match(rendered, /ordinary mnemonic prose remains readable/);
  assert.doesNotMatch(rendered, /abandon ability able/);
  assert.doesNotMatch(rendered, /secret value/);
  assert.match(rendered, /\[REDACTED MNEMONIC\]/);
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

test('renders circular and bigint diagnostics without throwing', () => {
  const circular = { name: 'preview' };
  circular.self = circular;

  const rendered = renderLoomProcessLog({
    payloadPreview: circular,
    chainResult: { n: 1n },
  });

  assert.match(rendered, /\[Circular\]/);
  assert.match(rendered, /"1"/);
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

test('keeps tiny capped written process logs within maxBytes after newline handling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-process-log-'));
  const maxBytes = 1;
  try {
    const result = await writeLoomProcessLogFile({
      directory,
      fileName: 'tiny.md',
      rawLog: 'x'.repeat(100),
      maxBytes,
    });

    assert.ok(Buffer.byteLength(result.content, 'utf8') <= maxBytes);
    assert.equal(await readFile(result.path, 'utf8'), result.content);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not exceed exact process log byte caps when writing newline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-process-log-'));
  const baseInput = {
    taskPinId: 'task-pin',
    claimPinId: 'claim-pin',
    statusDecision: {
      status: 'completed',
      summary: 'Exact cap.',
    },
  };
  const maxBytes = Buffer.byteLength(renderLoomProcessLog(baseInput), 'utf8');
  try {
    const result = await writeLoomProcessLogFile({
      directory,
      fileName: 'exact.md',
      ...baseInput,
      maxBytes,
    });

    assert.ok(Buffer.byteLength(result.content, 'utf8') <= maxBytes);
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
