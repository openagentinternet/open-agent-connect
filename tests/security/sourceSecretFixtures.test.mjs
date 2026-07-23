import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const STANDARD_BIP39_TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('production source does not embed standard BIP39 mnemonic fixtures', () => {
  const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    // Tolerate working-tree deletions that are not staged yet.
    .filter((file) => existsSync(file));
  const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(STANDARD_BIP39_TEST_MNEMONIC));

  assert.deepEqual(offenders, []);
});
