import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');
const { createLocalEvolutionStore } = require('../../dist/core/evolution/localEvolutionStore.js');
const { createFileSecretStore } = require('../../dist/core/secrets/fileSecretStore.js');
const { loadIdentity } = require('../../dist/core/identity/loadIdentity.js');

const FIXTURE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function createRuntimeEnv(homeDir, overrides = {}) {
  return {
    ...process.env,
    HOME: homeDir,
    METABOT_HOME: homeDir,
    ...overrides,
  };
}

async function runEvolutionCli(homeDir, args, envOverrides = {}, dependencies = undefined) {
  const stdout = [];
  const exitCode = await runCli(args, {
    env: createRuntimeEnv(homeDir, envOverrides),
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies,
  });

  return {
    exitCode,
    stdout: stdout.join(''),
    payload: JSON.parse(stdout.join('').trim()),
  };
}

function createArtifactRecord(overrides = {}) {
  return {
    variantId: 'variant-network-directory-fix-1',
    skillName: 'metabot-network-directory',
    status: 'inactive',
    scope: {
      allowedCommands: ['metabot network services --online', 'metabot ui open --page hub'],
      chainRead: true,
      chainWrite: false,
      localUiOpen: true,
      remoteDelegation: false,
    },
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: 'scope-hash-v1',
    },
    patch: {
      instructionsPatch: 'Prefer machine-first service discovery output.',
    },
    lineage: {
      lineageId: 'lineage-variant-network-directory-fix-1',
      parentVariantId: null,
      rootVariantId: 'variant-network-directory-fix-1',
      executionId: 'execution-1',
      analysisId: 'analysis-1',
      createdAt: 1_744_444_900_000,
    },
    verification: {
      passed: true,
      checkedAt: 1_744_444_900_500,
      protocolCompatible: true,
      replayValid: true,
      notWorseThanBase: true,
      notes: 'Regression replay is valid.',
    },
    adoption: 'manual',
    createdAt: 1_744_444_900_900,
    updatedAt: 1_744_444_900_900,
    ...overrides,
  };
}

function createAnalysisRecord(overrides = {}) {
  return {
    analysisId: 'analysis-1',
    executionId: 'execution-1',
    skillName: 'metabot-network-directory',
    triggerSource: 'hard_failure',
    evolutionType: 'FIX',
    shouldGenerateCandidate: true,
    summary: 'command returned a failed envelope',
    analyzedAt: 1_744_444_900_800,
    ...overrides,
  };
}

async function seedIdentitySecrets(homeDir) {
  const secretStore = createFileSecretStore(homeDir);
  await secretStore.writeIdentitySecrets({
    mnemonic: FIXTURE_MNEMONIC,
  });
  return loadIdentity({ mnemonic: FIXTURE_MNEMONIC });
}

test('runCli supports `metabot evolution status`', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-status-'));
  const result = await runEvolutionCli(homeDir, ['evolution', 'status']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.executions, 0);
  assert.equal(result.payload.data.analyses, 0);
  assert.equal(result.payload.data.artifacts, 0);
  assert.deepEqual(result.payload.data.activeVariants, {});
});

test('runCli supports `metabot evolution adopt --skill --variant-id` and `metabot evolution rollback --skill`', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-adopt-'));
  const store = createLocalEvolutionStore(homeDir);
  const artifact = createArtifactRecord();
  await store.writeArtifact(artifact);

  const adoptResult = await runEvolutionCli(homeDir, [
    'evolution',
    'adopt',
    '--skill',
    'metabot-network-directory',
    '--variant-id',
    artifact.variantId,
  ]);

  assert.equal(adoptResult.exitCode, 0);
  assert.equal(adoptResult.payload.ok, true);
  assert.equal(adoptResult.payload.data.skillName, 'metabot-network-directory');
  assert.equal(adoptResult.payload.data.variantId, artifact.variantId);

  const indexAfterAdopt = await store.readIndex();
  assert.equal(indexAfterAdopt.activeVariants['metabot-network-directory'], artifact.variantId);

  const rollbackResult = await runEvolutionCli(homeDir, [
    'evolution',
    'rollback',
    '--skill',
    'metabot-network-directory',
  ]);

  assert.equal(rollbackResult.exitCode, 0);
  assert.equal(rollbackResult.payload.ok, true);
  assert.equal(rollbackResult.payload.data.skillName, 'metabot-network-directory');

  const indexAfterRollback = await store.readIndex();
  assert.equal(indexAfterRollback.activeVariants['metabot-network-directory'], undefined);
});

test('runCli supports `metabot evolution publish --skill --variant-id` for a verified local artifact without mutating adoption state', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-publish-'));
  const store = createLocalEvolutionStore(homeDir);
  const identity = await seedIdentitySecrets(homeDir);
  const analysis = createAnalysisRecord();
  const artifact = createArtifactRecord();
  await store.writeAnalysis(analysis);
  await store.writeArtifact(artifact);

  const artifactPath = path.join(store.paths.evolutionArtifactsRoot, `${artifact.variantId}.json`);
  const beforeArtifactRaw = readFileSync(artifactPath, 'utf8');
  const beforeIndexRaw = readFileSync(store.paths.evolutionIndexPath, 'utf8');

  const result = await runEvolutionCli(
    homeDir,
    [
      'evolution',
      'publish',
      '--skill',
      'metabot-network-directory',
      '--variant-id',
      artifact.variantId,
    ],
    {
      METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.match(result.payload.data.pinId, /^\/protocols\/metabot-evolution-artifact-v1-pin-/);
  assert.deepEqual(result.payload.data.txids, ['/protocols/metabot-evolution-artifact-v1-tx-2']);
  assert.equal(result.payload.data.skillName, artifact.skillName);
  assert.equal(result.payload.data.variantId, artifact.variantId);
  assert.match(result.payload.data.artifactUri, /^metafile:\/\/\/file-pin-1\.json$/);
  assert.equal(result.payload.data.scopeHash, artifact.metadata.scopeHash);
  assert.equal(result.payload.data.publisherGlobalMetaId, identity.globalMetaId);
  assert.equal(typeof result.payload.data.publishedAt, 'number');

  assert.equal(readFileSync(artifactPath, 'utf8'), beforeArtifactRaw);
  assert.equal(readFileSync(store.paths.evolutionIndexPath, 'utf8'), beforeIndexRaw);
  assert.deepEqual((await store.readIndex()).activeVariants, {});
});

test('runCli publish requires --skill', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-publish-'));
  const result = await runEvolutionCli(homeDir, ['evolution', 'publish', '--variant-id', 'variant-1']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'missing_flag');
});

test('runCli publish requires --variant-id', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-publish-'));
  const result = await runEvolutionCli(homeDir, ['evolution', 'publish', '--skill', 'metabot-network-directory']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'missing_flag');
});

test('runCli publish returns evolution_variant_skill_mismatch when artifact belongs to another skill', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-publish-'));
  const store = createLocalEvolutionStore(homeDir);
  await seedIdentitySecrets(homeDir);
  const artifact = createArtifactRecord({
    skillName: 'metabot-trace-inspector',
    lineage: {
      ...createArtifactRecord().lineage,
      analysisId: 'analysis-trace',
    },
  });
  const analysis = createAnalysisRecord({
    analysisId: 'analysis-trace',
    skillName: 'metabot-trace-inspector',
  });
  await store.writeAnalysis(analysis);
  await store.writeArtifact(artifact);

  const result = await runEvolutionCli(
    homeDir,
    [
      'evolution',
      'publish',
      '--skill',
      'metabot-network-directory',
      '--variant-id',
      artifact.variantId,
    ],
    {
      METABOT_TEST_FAKE_CHAIN_WRITE: '1',
    }
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'evolution_variant_skill_mismatch');
});

test('runCli publish returns evolution_network_disabled when the evolution network is disabled', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-publish-'));
  const configStore = createConfigStore(homeDir);
  const config = await configStore.read();
  await configStore.set({
    ...config,
    evolution_network: {
      ...config.evolution_network,
      enabled: false,
    },
  });

  const result = await runEvolutionCli(homeDir, [
    'evolution',
    'publish',
    '--skill',
    'metabot-network-directory',
    '--variant-id',
    'variant-1',
  ]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'evolution_network_disabled');
});

test('runCli supports `metabot evolution search --skill` and returns JSON-only command result output', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-search-'));
  const result = await runEvolutionCli(
    homeDir,
    ['evolution', 'search', '--skill', 'metabot-network-directory'],
    {},
    {
      evolution: {
        search: async (input) => commandSuccess({
          skillName: input.skill,
          scopeHash: 'scope-hash-v1',
          count: 0,
          results: [],
        }),
      },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.skillName, 'metabot-network-directory');
  assert.equal(result.payload.data.count, 0);
  assert.equal(result.stdout.trim().startsWith('{'), true);
  assert.equal(result.stdout.includes('Unknown command:'), false);
});

test('runCli search requires --skill', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-search-'));
  const result = await runEvolutionCli(
    homeDir,
    ['evolution', 'search'],
    {},
    {
      evolution: {
        search: async () => commandSuccess({}),
      },
    },
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'missing_flag');
});

test('runCli supports `metabot evolution import --pin-id`', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-import-'));
  const expectedArtifactPath = path.join(homeDir, '.metabot', 'evolution', 'remote', 'artifacts', 'variant-1.json');
  const expectedMetadataPath = path.join(homeDir, '.metabot', 'evolution', 'remote', 'artifacts', 'variant-1.meta.json');

  const result = await runEvolutionCli(
    homeDir,
    ['evolution', 'import', '--pin-id', 'pin-1'],
    {},
    {
      evolution: {
        import: async (input) => commandSuccess({
          pinId: input.pinId,
          variantId: 'variant-1',
          artifactPath: expectedArtifactPath,
          metadataPath: expectedMetadataPath,
        }),
      },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.pinId, 'pin-1');
  assert.equal(result.payload.data.artifactPath, expectedArtifactPath);
  assert.equal(result.payload.data.metadataPath, expectedMetadataPath);
});

test('runCli import requires --pin-id', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-import-'));
  const result = await runEvolutionCli(
    homeDir,
    ['evolution', 'import'],
    {},
    {
      evolution: {
        import: async () => commandSuccess({}),
      },
    },
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'missing_flag');
});

test('runCli search/import return evolution_network_disabled when the evolution network is disabled', async () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'metabot-cli-evolution-disabled-'));
  const configStore = createConfigStore(homeDir);
  const config = await configStore.read();
  await configStore.set({
    ...config,
    evolution_network: {
      ...config.evolution_network,
      enabled: false,
    },
  });

  const searchResult = await runEvolutionCli(homeDir, [
    'evolution',
    'search',
    '--skill',
    'metabot-network-directory',
  ]);

  assert.equal(searchResult.exitCode, 1);
  assert.equal(searchResult.payload.ok, false);
  assert.equal(searchResult.payload.code, 'evolution_network_disabled');

  const importResult = await runEvolutionCli(homeDir, [
    'evolution',
    'import',
    '--pin-id',
    'pin-1',
  ]);

  assert.equal(importResult.exitCode, 1);
  assert.equal(importResult.payload.ok, false);
  assert.equal(importResult.payload.code, 'evolution_network_disabled');
});
