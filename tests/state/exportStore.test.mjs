import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createExportStore } = require('../../dist/core/state/exportStore.js');

function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = mkdtempSync(path.join(tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
}

test('createExportStore writes inspectable json and markdown exports under .runtime/exports', async () => {
  const homeDir = createProfileHome('metabot-export-');
  const store = createExportStore(homeDir);

  const jsonPath = await store.writeJson('identity snapshot', {
    publicKey: '123',
    notes: ['inspectable']
  });
  const markdownPath = await store.writeMarkdown('session notes', '# Hello');

  assert.equal(jsonPath, path.join(store.paths.exportsRoot, 'identity-snapshot.json'));
  assert.equal(markdownPath, path.join(store.paths.exportsRoot, 'session-notes.md'));
  assert.deepEqual(JSON.parse(readFileSync(jsonPath, 'utf8')), {
    publicKey: '123',
    notes: ['inspectable']
  });
  assert.equal(readFileSync(markdownPath, 'utf8'), '# Hello\n');
  assert.equal(jsonPath.startsWith(store.paths.runtimeRoot), true);
  assert.equal(jsonPath.startsWith(store.paths.stateRoot), false);
});
