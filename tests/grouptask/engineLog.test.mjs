import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createGroupTaskEngineLogWriter,
  resolveGroupTaskEngineLogPath,
  readGroupTaskEngineLogTail,
} = require('../../dist/core/grouptask/engineLog.js');

function logFilePath(prefix) {
  const logsRoot = path.join(mkdtempTempRootSync(prefix), 'runtime', 'logs');
  return resolveGroupTaskEngineLogPath(logsRoot);
}

test('engine log writer appends timestamped lines and creates the logs dir', async () => {
  const logFile = logFilePath('metabot-gt-engine-log-append-');
  const writer = createGroupTaskEngineLogWriter({ logFile });
  writer('first failure');
  writer('second failure');
  await writer.flush();

  const text = readFileSync(logFile, 'utf8');
  assert.match(text, /^\[\d{4}-\d{2}-\d{2}T[^\]]+\] first failure\n/);
  assert.match(text, /second failure\n$/);
});

test('engine log writer rolls to one generation past the size cap', async () => {
  const logFile = logFilePath('metabot-gt-engine-log-rotate-');
  const writer = createGroupTaskEngineLogWriter({ logFile, maxBytes: 64 });
  for (let i = 0; i < 12; i += 1) {
    writer(`line ${i} with enough padding to exceed the cap`);
  }
  await writer.flush();

  // The latest line always lands in the live file, the previous window lives
  // in the single rolled generation, and the live file stays bounded.
  const live = readFileSync(logFile, 'utf8');
  assert.ok(live.includes('line 11'), `live should hold the latest line: ${live}`);
  assert.ok(live.length <= 64 + 128, `live should stay near the cap: ${live.length}`);
  const rolled = readFileSync(`${logFile}.1`, 'utf8');
  assert.match(rolled, /line \d+ with enough padding/);
  assert.ok(!rolled.includes('line 11'), 'rolled generation must be older than live');
});

test('engine log writer never throws for unwritable destinations', async () => {
  const writer = createGroupTaskEngineLogWriter({
    logFile: path.join(mkdtempTempRootSync('metabot-gt-engine-log-dead-'), 'no', 'such', 'dir', 'x', 'log.txt'),
    maxBytes: 8,
  });
  writer('drop me');
  await writer.flush();
  await writer.flush();
});

test('engine log tail reader spans the rolled generation and tolerates missing files', async () => {
  const logFile = logFilePath('metabot-gt-engine-log-tail-');
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(`${logFile}.1`, 'rolled-old\nrolled-new\n', 'utf8');
  writeFileSync(logFile, 'live-a\nlive-b\n', 'utf8');

  const full = await readGroupTaskEngineLogTail(logFile, 1024);
  assert.ok(full.includes('rolled-old'));
  assert.ok(full.endsWith('live-b\n'));

  // Byte-level clipping can cut a line in half; only the newest bytes remain.
  const clipped = await readGroupTaskEngineLogTail(logFile, 6);
  assert.ok(!clipped.includes('rolled-'));
  assert.ok(clipped.endsWith('b\n'));

  const missing = await readGroupTaskEngineLogTail(
    path.join(path.dirname(logFile), 'absent.log'),
    128,
  );
  assert.equal(missing, '');
});
