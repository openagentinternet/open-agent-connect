import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { createLocalEvolutionStore } = require('../../dist/core/evolution/localEvolutionStore.js');

function createRuntimeEnv(homeDir) {
  return {
    ...process.env,
    HOME: homeDir,
    METABOT_HOME: homeDir,
  };
}

async function runEvolutionCli(homeDir, args) {
  const stdout = [];
  const exitCode = await runCli(args, {
    env: createRuntimeEnv(homeDir),
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  return {
    exitCode,
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
