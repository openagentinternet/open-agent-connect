import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createInfrastructureConfigStore,
} = require('../../dist/core/config/infrastructureConfigStore.js');

test('infrastructure config is installation-wide and persists normalized base URLs', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-infrastructure-');
  const store = createInfrastructureConfigStore(systemHomeDir);

  assert.deepEqual(await store.read(), {
    metasoP2PBaseUrl: 'https://so.metaid.io',
    metafileContentBaseUrl: 'https://file.metaid.io/metafile-indexer',
    manApiBaseUrl: 'https://manapi.metaid.io',
  });
  assert.equal(
    store.paths.infrastructureConfigPath,
    path.join(systemHomeDir, '.metabot', 'manager', 'infrastructure.json'),
  );

  await store.set({
    metasoP2PBaseUrl: 'https://so.example.test/root/',
    metafileContentBaseUrl: 'https://files.example.test/content/',
    manApiBaseUrl: 'https://man.example.test/',
  });

  const saved = {
    metasoP2PBaseUrl: 'https://so.example.test/root',
    metafileContentBaseUrl: 'https://files.example.test/content',
    manApiBaseUrl: 'https://man.example.test',
  };
  assert.deepEqual(await store.read(), saved);
  assert.deepEqual(
    JSON.parse(await fs.readFile(store.paths.infrastructureConfigPath, 'utf8')),
    saved,
  );
});

test('infrastructure config rejects non-http service URLs', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-infrastructure-invalid-');
  const store = createInfrastructureConfigStore(systemHomeDir);

  await assert.rejects(
    store.set({
      metasoP2PBaseUrl: 'wss://so.example.test',
      metafileContentBaseUrl: 'https://files.example.test',
      manApiBaseUrl: 'https://man.example.test',
    }),
    /browser\.metasoP2PBaseUrl must be an http\(s\) base URL/,
  );
});
