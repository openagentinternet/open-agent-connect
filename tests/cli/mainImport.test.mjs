import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execFileCallback);

test('importing the CLI main module does not emit the Node localStorage warning', async () => {
  const { stderr } = await execFile(process.execPath, ['-e', "require('./dist/cli/main.js')"], {
    cwd: process.cwd(),
  });

  assert.doesNotMatch(stderr, /--localstorage-file/);
});
