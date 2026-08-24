import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

async function runSimpleNote(argv, deps, requestFile) {
  const stdout = [];
  const exitCode = await runCli(['simplenote', ...argv], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    cwd: path.dirname(requestFile),
    dependencies: { simplenote: deps },
  });
  const raw = stdout.join('').trim();
  return { exitCode, result: raw ? JSON.parse(raw) : null };
}

test('simplenote post resolves request-file paths and forwards to the handler', async () => {
  const systemHome = mkdtempTempRootSync('metabot-sn-cli-');
  const coverAbs = path.join(systemHome, 'cover.png');
  writeFileSync(coverAbs, 'png');
  const requestPath = path.join(systemHome, 'req.json');
  writeFileSync(requestPath, JSON.stringify({
    title: 'T',
    content: 'Body',
    cover: './cover.png',
    attachments: ['./cover.png', 'metafile://keep'],
    content_type: 'text/markdown',
    tags: ['x'],
  }));

  const calls = [];
  const { exitCode, result } = await runSimpleNote(
    ['post', '--request-file', requestPath, '--chain', 'btc', '--from', 'twin'],
    {
      post: async (input) => {
        calls.push(input);
        return { ok: true, state: 'success', data: { pinId: 'p1', formatted: 'sheet' } };
      },
    },
    requestPath,
  );
  assert.equal(exitCode, 0);
  assert.equal(calls[0].title, 'T');
  assert.equal(calls[0].cover, coverAbs, 'relative cover resolved against the request dir');
  assert.equal(calls[0].attachments[0], coverAbs);
  assert.equal(calls[0].attachments[1], 'metafile://keep');
  assert.equal(calls[0].contentType, 'text/markdown', 'content_type mapped to contentType');
  assert.equal(calls[0].network, 'btc');
  assert.equal(calls[0].from, 'twin');
  assert.equal(result.data.pinId, 'p1');

  const missing = await runSimpleNote(['post'], { post: async () => ({ ok: true }) }, requestPath);
  assert.equal(missing.result.code, 'missing_flag');
  const bogus = await runSimpleNote(['bogus'], {}, requestPath);
  assert.equal(bogus.result.code, 'unknown_command');
});
