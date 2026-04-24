import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createLocalEvolutionStore } = require('../../dist/core/evolution/localEvolutionStore.js');

function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = mkdtempSync(path.join(tmpdir(), prefix));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  mkdirSync(homeDir, { recursive: true });
  return homeDir;
}

function createScope() {
  return {
    allowedCommands: ['metabot network services --online', 'metabot ui open --page hub'],
    chainRead: true,
    chainWrite: false,
    localUiOpen: true,
    remoteDelegation: false,
  };
}

function createExecutionRecord() {
  return {
    executionId: 'exec-1',
    skillName: 'metabot-network-directory',
    activeVariantId: null,
    commandTemplate: 'metabot network services --online --json',
    startedAt: 1_744_444_444_000,
    finishedAt: 1_744_444_444_500,
    envelope: {
      state: 'failed',
    },
    stdout: '',
    stderr: 'missing data.services',
    usedUiFallback: false,
    manualRecovery: false,
  };
}

function createAnalysisRecord() {
  return {
    analysisId: 'analysis-1',
    executionId: 'exec-1',
    skillName: 'metabot-network-directory',
    triggerSource: 'hard_failure',
    evolutionType: 'FIX',
    shouldGenerateCandidate: true,
    summary: 'command returned a failed envelope',
    analyzedAt: 1_744_444_445_000,
  };
}

function createArtifactRecord() {
  return {
    variantId: 'variant-1',
    skillName: 'metabot-network-directory',
    status: 'inactive',
    scope: createScope(),
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash: 'scope-hash-v1',
    },
    patch: {
      instructionsPatch: 'Read machine output first and only open UI when explicitly requested.',
    },
    lineage: {
      lineageId: 'lineage-1',
      parentVariantId: null,
      rootVariantId: 'variant-1',
      executionId: 'exec-1',
      analysisId: 'analysis-1',
      createdAt: 1_744_444_445_500,
    },
    verification: {
      passed: true,
      checkedAt: 1_744_444_446_000,
      protocolCompatible: true,
      replayValid: true,
      notWorseThanBase: true,
      notes: 'fixture replay no longer fails',
    },
    adoption: 'manual',
    createdAt: 1_744_444_446_500,
    updatedAt: 1_744_444_446_500,
  };
}

test('local evolution store persists execution, analysis, artifact, and index under profile .runtime/evolution', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);
  const execution = createExecutionRecord();
  const analysis = createAnalysisRecord();
  const artifact = createArtifactRecord();

  await store.writeExecution(execution);
  await store.writeAnalysis(analysis);
  await store.writeArtifact(artifact);
  await store.setActiveVariant(artifact.skillName, artifact.variantId);

  const executionPath = path.join(store.paths.evolutionExecutionsRoot, `${execution.executionId}.json`);
  const analysisPath = path.join(store.paths.evolutionAnalysesRoot, `${analysis.analysisId}.json`);
  const artifactPath = path.join(store.paths.evolutionArtifactsRoot, `${artifact.variantId}.json`);

  assert.deepEqual(JSON.parse(readFileSync(executionPath, 'utf8')), execution);
  assert.deepEqual(JSON.parse(readFileSync(analysisPath, 'utf8')), analysis);
  assert.deepEqual(JSON.parse(readFileSync(artifactPath, 'utf8')), artifact);

  const indexFromFile = JSON.parse(readFileSync(store.paths.evolutionIndexPath, 'utf8'));
  assert.deepEqual(indexFromFile.executions, [execution.executionId]);
  assert.deepEqual(indexFromFile.analyses, [analysis.analysisId]);
  assert.deepEqual(indexFromFile.artifacts, [artifact.variantId]);
  assert.deepEqual(indexFromFile.activeVariants['metabot-network-directory'], {
    source: 'local',
    variantId: artifact.variantId,
  });
});

test('local evolution store reads stored artifact and analysis records and returns null for missing records', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);
  const analysis = createAnalysisRecord();
  const artifact = createArtifactRecord();

  await store.writeAnalysis(analysis);
  await store.writeArtifact(artifact);

  assert.deepEqual(await store.readAnalysis(analysis.analysisId), analysis);
  assert.deepEqual(await store.readArtifact(artifact.variantId), artifact);
  assert.equal(await store.readAnalysis('analysis-missing'), null);
  assert.equal(await store.readArtifact('variant-missing'), null);
});

test('local evolution store keeps deterministic, append-safe index updates and active mapping', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);
  const execution = createExecutionRecord();
  const analysis = createAnalysisRecord();
  const artifact = createArtifactRecord();
  const newerArtifact = {
    ...artifact,
    variantId: 'variant-2',
    createdAt: 1_744_444_447_000,
    updatedAt: 1_744_444_447_000,
  };

  await store.writeExecution(execution);
  await store.writeExecution(execution);
  await store.writeAnalysis(analysis);
  await store.writeAnalysis(analysis);
  await store.writeArtifact(artifact);
  await store.writeArtifact(artifact);
  await store.writeArtifact(newerArtifact);
  await store.setActiveVariant(artifact.skillName, artifact.variantId);
  await store.setActiveVariant(artifact.skillName, newerArtifact.variantId);

  const index = await store.readIndex();
  assert.deepEqual(index.executions, [execution.executionId]);
  assert.deepEqual(index.analyses, [analysis.analysisId]);
  assert.deepEqual(index.artifacts, [artifact.variantId, newerArtifact.variantId]);
  assert.deepEqual(index.activeVariants['metabot-network-directory'], {
    source: 'local',
    variantId: newerArtifact.variantId,
  });
});

test('local evolution store clears one active variant through the shared index update queue', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);

  await Promise.all([
    store.writeExecution(createExecutionRecord()),
    store.setActiveVariant('metabot-network-directory', 'variant-keep'),
    store.setActiveVariant('metabot-trace-inspector', 'variant-remove'),
  ]);

  await store.clearActiveVariant('metabot-trace-inspector');

  const index = await store.readIndex();
  assert.deepEqual(index.executions, ['exec-1']);
  assert.deepEqual(index.activeVariants['metabot-network-directory'], {
    source: 'local',
    variantId: 'variant-keep',
  });
  assert.equal(index.activeVariants['metabot-trace-inspector'], undefined);
});

test('local evolution store normalizes legacy active variant strings into local refs', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);
  await store.ensureLayout();
  writeFileSync(
    store.paths.evolutionIndexPath,
    `${JSON.stringify({
      schemaVersion: 1,
      executions: [],
      analyses: [],
      artifacts: [],
      activeVariants: {
        'metabot-network-directory': 'variant-local-1',
      },
    })}\n`,
    'utf8'
  );

  const index = await store.readIndex();
  assert.deepEqual(index.activeVariants, {
    'metabot-network-directory': {
      source: 'local',
      variantId: 'variant-local-1',
    },
  });
});

test('local evolution store drops malformed active variant refs during read', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);
  await store.ensureLayout();
  writeFileSync(
    store.paths.evolutionIndexPath,
    `${JSON.stringify({
      schemaVersion: 1,
      executions: [],
      analyses: [],
      artifacts: [],
      activeVariants: {
        'metabot-network-directory': {
          source: 'local',
        },
        'metabot-trace-inspector': {
          source: 'unknown',
          variantId: 'variant-bad-source',
        },
        'metabot-import': 42,
      },
    })}\n`,
    'utf8'
  );

  const index = await store.readIndex();
  assert.deepEqual(index.activeVariants, {});
});

test('local evolution store drops unsafe active variant identifiers during read', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);
  await store.ensureLayout();
  writeFileSync(
    store.paths.evolutionIndexPath,
    `${JSON.stringify({
      schemaVersion: 1,
      executions: [],
      analyses: [],
      artifacts: [],
      activeVariants: {
        'metabot-network-directory': '../etc/passwd',
        'nested/path': 'variant-local-1',
        'metabot-trace-inspector': {
          source: 'local',
          variantId: 'nested/path',
        },
        'metabot-import': {
          source: 'remote',
          variantId: 'variant-remote-1',
        },
      },
    })}\n`,
    'utf8'
  );

  const index = await store.readIndex();
  assert.deepEqual(index.activeVariants, {
    'metabot-import': {
      source: 'remote',
      variantId: 'variant-remote-1',
    },
  });
});

test('local evolution store rejects unsafe identifiers used for filesystem paths', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);
  const execution = createExecutionRecord();
  const analysis = createAnalysisRecord();
  const artifact = createArtifactRecord();

  await assert.rejects(
    store.writeExecution({
      ...execution,
      executionId: '../escape',
    }),
    /Invalid executionId/
  );
  await assert.rejects(
    store.writeAnalysis({
      ...analysis,
      analysisId: 'nested/path',
    }),
    /Invalid analysisId/
  );
  await assert.rejects(
    store.writeArtifact({
      ...artifact,
      variantId: '/tmp/evil',
    }),
    /Invalid variantId/
  );
});

test('local evolution store serializes concurrent index updates to avoid lost writes', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);

  const executionWrites = Array.from({ length: 24 }, (_, index) => {
    const execution = createExecutionRecord();
    execution.executionId = `exec-${index + 1}`;
    return store.writeExecution(execution);
  });
  const analysisWrites = Array.from({ length: 24 }, (_, index) => {
    const analysis = createAnalysisRecord();
    analysis.analysisId = `analysis-${index + 1}`;
    analysis.executionId = `exec-${index + 1}`;
    return store.writeAnalysis(analysis);
  });
  const artifactWrites = Array.from({ length: 24 }, (_, index) => {
    const artifact = createArtifactRecord();
    artifact.variantId = `variant-${index + 1}`;
    artifact.lineage.lineageId = `lineage-${index + 1}`;
    artifact.lineage.rootVariantId = `variant-${index + 1}`;
    artifact.lineage.parentVariantId = index === 0 ? null : `variant-${index}`;
    artifact.lineage.executionId = `exec-${index + 1}`;
    artifact.lineage.analysisId = `analysis-${index + 1}`;
    return store.writeArtifact(artifact);
  });

  await Promise.all([
    ...executionWrites,
    ...analysisWrites,
    ...artifactWrites,
    store.setActiveVariant('metabot-network-directory', 'variant-24'),
    store.setActiveVariant('metabot-trace-inspector', 'variant-trace-1'),
  ]);

  const index = await store.readIndex();
  const expectedExecutions = Array.from({ length: 24 }, (_, i) => `exec-${i + 1}`).sort();
  const expectedAnalyses = Array.from({ length: 24 }, (_, i) => `analysis-${i + 1}`).sort();
  const expectedArtifacts = Array.from({ length: 24 }, (_, i) => `variant-${i + 1}`).sort();

  assert.deepEqual(index.executions, expectedExecutions);
  assert.deepEqual(index.analyses, expectedAnalyses);
  assert.deepEqual(index.artifacts, expectedArtifacts);
  assert.deepEqual(index.activeVariants['metabot-network-directory'], {
    source: 'local',
    variantId: 'variant-24',
  });
  assert.deepEqual(index.activeVariants['metabot-trace-inspector'], {
    source: 'local',
    variantId: 'variant-trace-1',
  });
});

test('local evolution store serializes concurrent index updates across store instances sharing one index path', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const storeA = createLocalEvolutionStore(homeDir);
  const storeB = createLocalEvolutionStore(homeDir);

  const writesA = Array.from({ length: 20 }, (_, index) => {
    const execution = createExecutionRecord();
    execution.executionId = `a-exec-${index + 1}`;
    return storeA.writeExecution(execution);
  });
  const writesB = Array.from({ length: 20 }, (_, index) => {
    const execution = createExecutionRecord();
    execution.executionId = `b-exec-${index + 1}`;
    return storeB.writeExecution(execution);
  });

  await Promise.all([
    ...writesA,
    ...writesB,
    storeA.setActiveVariant('metabot-network-directory', 'variant-a'),
    storeB.setActiveVariant('metabot-trace-inspector', 'variant-b'),
  ]);

  const index = await storeA.readIndex();
  const expectedExecutions = [
    ...Array.from({ length: 20 }, (_, i) => `a-exec-${i + 1}`),
    ...Array.from({ length: 20 }, (_, i) => `b-exec-${i + 1}`),
  ].sort();

  assert.deepEqual(index.executions, expectedExecutions);
  assert.deepEqual(index.activeVariants['metabot-network-directory'], {
    source: 'local',
    variantId: 'variant-a',
  });
  assert.deepEqual(index.activeVariants['metabot-trace-inspector'], {
    source: 'local',
    variantId: 'variant-b',
  });
});

test('local evolution store preserves unknown index fields during updates', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);
  await store.ensureLayout();
  writeFileSync(
    store.paths.evolutionIndexPath,
    `${JSON.stringify({
      schemaVersion: 1,
      executions: ['existing-exec'],
      analyses: [],
      artifacts: [],
      activeVariants: {},
      futureState: {
        compactedAt: 1_744_444_500_000,
      },
    })}\n`,
    'utf8'
  );

  await store.writeExecution(createExecutionRecord());

  const rawIndex = JSON.parse(readFileSync(store.paths.evolutionIndexPath, 'utf8'));
  assert.deepEqual(rawIndex.futureState, {
    compactedAt: 1_744_444_500_000,
  });
  assert.deepEqual(rawIndex.executions, ['exec-1', 'existing-exec']);
});

test('local evolution store recovers from malformed index.json without bricking writes', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);
  await store.ensureLayout();
  writeFileSync(store.paths.evolutionIndexPath, '{"broken": ', 'utf8');

  await assert.doesNotReject(store.writeExecution(createExecutionRecord()));
  const index = await store.readIndex();
  assert.deepEqual(index.executions, ['exec-1']);
});

test('local evolution store can persist a remote active variant ref and keeps local helper behavior', async () => {
  const homeDir = createProfileHome('metabot-evolution-store-');
  const store = createLocalEvolutionStore(homeDir);

  await store.setActiveVariantRef('metabot-network-directory', {
    source: 'remote',
    variantId: 'variant-remote-1',
  });
  await store.setActiveVariant('metabot-trace-inspector', 'variant-local-1');

  const index = await store.readIndex();
  assert.deepEqual(index.activeVariants['metabot-network-directory'], {
    source: 'remote',
    variantId: 'variant-remote-1',
  });
  assert.deepEqual(index.activeVariants['metabot-trace-inspector'], {
    source: 'local',
    variantId: 'variant-local-1',
  });
});
