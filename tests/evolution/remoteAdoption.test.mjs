import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createProfileHomeSync } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createLocalEvolutionStore } = require('../../dist/core/evolution/localEvolutionStore.js');
const { createRemoteEvolutionStore } = require('../../dist/core/evolution/remoteEvolutionStore.js');
const { adoptRemoteEvolutionArtifact } = require('../../dist/core/evolution/remoteAdoption.js');

function createScope() {
  return {
    allowedCommands: ['metabot network services --online', 'metabot ui open --page hub'],
    chainRead: true,
    chainWrite: false,
    localUiOpen: true,
    remoteDelegation: false,
  };
}

function createArtifactRecord(overrides = {}) {
  const variantId = overrides.variantId ?? 'variant-remote-1';
  const scopeHash = overrides.scopeHash ?? 'scope-hash-remote-1';
  const verification = overrides.verification ?? {};
  const hasProtocolCompatible = Object.prototype.hasOwnProperty.call(verification, 'protocolCompatible');
  const hasCheckedAt = Object.prototype.hasOwnProperty.call(verification, 'checkedAt');
  return {
    variantId,
    skillName: overrides.skillName ?? 'metabot-network-directory',
    status: 'inactive',
    scope: createScope(),
    metadata: {
      sameSkill: true,
      sameScope: true,
      scopeHash,
    },
    patch: {
      instructionsPatch: `patch-${variantId}`,
    },
    lineage: {
      lineageId: `lineage-${variantId}`,
      parentVariantId: null,
      rootVariantId: variantId,
      executionId: `exec-${variantId}`,
      analysisId: `analysis-${variantId}`,
      createdAt: 1_766_300_000_000,
    },
    verification: {
      passed: verification.passed ?? true,
      checkedAt: hasCheckedAt ? verification.checkedAt : 1_766_300_000_100,
      protocolCompatible: hasProtocolCompatible ? verification.protocolCompatible : true,
      replayValid: verification.replayValid ?? true,
      notWorseThanBase: verification.notWorseThanBase ?? true,
      notes: `verification-${variantId}`,
    },
    adoption: 'manual',
    createdAt: 1_766_300_000_200,
    updatedAt: 1_766_300_000_200,
  };
}

function createSidecarRecord(overrides = {}) {
  const variantId = overrides.variantId ?? 'variant-remote-1';
  const hasScopeHash = Object.prototype.hasOwnProperty.call(overrides, 'scopeHash');
  const scopeHash = hasScopeHash ? overrides.scopeHash : 'scope-hash-remote-1';
  return {
    pinId: overrides.pinId ?? `pin-${variantId}`,
    variantId,
    publisherGlobalMetaId: overrides.publisherGlobalMetaId ?? `idq://publisher-${variantId}`,
    artifactUri: overrides.artifactUri ?? `metafile://${variantId}.json`,
    skillName: overrides.skillName ?? 'metabot-network-directory',
    scopeHash,
    publishedAt: overrides.publishedAt ?? 1_766_300_010_000,
    importedAt: overrides.importedAt ?? 1_766_300_020_000,
  };
}

function assertFailureCode(error, expectedCode) {
  assert.equal(error instanceof Error, true);
  assert.equal(error.code, expectedCode);
  return true;
}

test('successful remote adopt stores a remote active variant ref for the requested skill', async () => {
  const homeDir = createProfileHomeSync('metabot-remote-adopt-');
  const remoteStore = createRemoteEvolutionStore(homeDir);
  const evolutionStore = createLocalEvolutionStore(homeDir);

  await remoteStore.writeImport({
    artifact: createArtifactRecord({
      variantId: 'variant-remote-1',
      scopeHash: 'scope-hash-remote-1',
    }),
    sidecar: createSidecarRecord({
      variantId: 'variant-remote-1',
      scopeHash: 'scope-hash-remote-1',
    }),
  });

  const result = await adoptRemoteEvolutionArtifact({
    skillName: 'metabot-network-directory',
    variantId: 'variant-remote-1',
    resolvedScopeHash: 'scope-hash-remote-1',
    remoteStore,
    evolutionStore,
  });

  assert.deepEqual(result, {
    skillName: 'metabot-network-directory',
    variantId: 'variant-remote-1',
    source: 'remote',
    active: true,
  });

  const index = await evolutionStore.readIndex();
  assert.deepEqual(index.activeVariants['metabot-network-directory'], {
    source: 'remote',
    variantId: 'variant-remote-1',
  });
});

test('unsupported skill returns evolution_remote_adopt_not_supported before reading remote stores', async () => {
  let readArtifactCalls = 0;
  let readSidecarCalls = 0;
  let setActiveCalls = 0;

  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-trace-inspector',
      variantId: 'variant-remote-1',
      resolvedScopeHash: 'scope-hash-remote-1',
      remoteStore: {
        async readArtifact() {
          readArtifactCalls += 1;
          throw new Error('should not read artifact for unsupported skill');
        },
        async readSidecar() {
          readSidecarCalls += 1;
          throw new Error('should not read sidecar for unsupported skill');
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          setActiveCalls += 1;
          throw new Error('should not set active ref for unsupported skill');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_adopt_not_supported')
  );

  assert.equal(readArtifactCalls, 0);
  assert.equal(readSidecarCalls, 0);
  assert.equal(setActiveCalls, 0);
});

test('missing imported artifact or sidecar returns evolution_remote_variant_not_found', async () => {
  const sidecar = createSidecarRecord({
    variantId: 'variant-remote-missing',
    scopeHash: 'scope-hash-remote-missing',
  });
  const artifact = createArtifactRecord({
    variantId: 'variant-remote-missing',
    scopeHash: 'scope-hash-remote-missing',
  });

  const scenarios = [
    {
      name: 'artifact missing',
      readArtifact: async () => null,
      readSidecar: async () => sidecar,
    },
    {
      name: 'sidecar missing',
      readArtifact: async () => artifact,
      readSidecar: async () => null,
    },
  ];

  for (const scenario of scenarios) {
    await assert.rejects(
      adoptRemoteEvolutionArtifact({
        skillName: 'metabot-network-directory',
        variantId: 'variant-remote-missing',
        resolvedScopeHash: 'scope-hash-remote-missing',
        remoteStore: {
          readArtifact: scenario.readArtifact,
          readSidecar: scenario.readSidecar,
        },
        evolutionStore: {
          async setActiveVariantRef() {
            throw new Error(`setActiveVariantRef should not run when ${scenario.name}`);
          },
        },
      }),
      (error) => assertFailureCode(error, 'evolution_remote_variant_not_found')
    );
  }
});

test('remote store read failures return evolution_remote_variant_invalid', async () => {
  const readFailure = new SyntaxError('corrupt remote artifact json');

  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-read-failure',
      resolvedScopeHash: 'scope-hash-remote-read-failure',
      remoteStore: {
        async readArtifact() {
          throw readFailure;
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-read-failure',
            scopeHash: 'scope-hash-remote-read-failure',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run when remote reads fail');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
  );
});

test('skill mismatch returns evolution_remote_variant_skill_mismatch', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-skill-mismatch',
      resolvedScopeHash: 'scope-hash-remote-skill-mismatch',
      remoteStore: {
        async readArtifact() {
          return createArtifactRecord({
            variantId: 'variant-remote-skill-mismatch',
            skillName: 'metabot-trace-inspector',
            scopeHash: 'scope-hash-remote-skill-mismatch',
          });
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-skill-mismatch',
            scopeHash: 'scope-hash-remote-skill-mismatch',
            skillName: 'metabot-network-directory',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run on skill mismatch');
        },
      },
      }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_skill_mismatch')
  );
});

test('sidecar skill mismatch returns evolution_remote_variant_skill_mismatch', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-sidecar-skill-mismatch',
      resolvedScopeHash: 'scope-hash-remote-sidecar-skill-mismatch',
      remoteStore: {
        async readArtifact() {
          return createArtifactRecord({
            variantId: 'variant-remote-sidecar-skill-mismatch',
            skillName: 'metabot-network-directory',
            scopeHash: 'scope-hash-remote-sidecar-skill-mismatch',
          });
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-sidecar-skill-mismatch',
            scopeHash: 'scope-hash-remote-sidecar-skill-mismatch',
            skillName: 'metabot-trace-inspector',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run on sidecar skill mismatch');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_skill_mismatch')
  );
});

test('scope hash mismatch returns evolution_remote_variant_scope_mismatch', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-scope-mismatch',
      resolvedScopeHash: 'scope-hash-local',
      remoteStore: {
        async readArtifact() {
          return createArtifactRecord({
            variantId: 'variant-remote-scope-mismatch',
            scopeHash: 'scope-hash-remote',
          });
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-scope-mismatch',
            scopeHash: 'scope-hash-remote',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run on scope mismatch');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_scope_mismatch')
  );
});

test('missing sidecar scope hash returns evolution_remote_variant_invalid', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-sidecar-missing-scope',
      resolvedScopeHash: 'scope-hash-local',
      remoteStore: {
        async readArtifact() {
          return createArtifactRecord({
            variantId: 'variant-remote-sidecar-missing-scope',
            scopeHash: 'scope-hash-local',
          });
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-sidecar-missing-scope',
            scopeHash: undefined,
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run on invalid sidecar scope hash');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
  );
});

test('failed verification tuple returns evolution_remote_variant_invalid', async () => {
  const invalidVerifications = [
    { passed: false, replayValid: true, notWorseThanBase: true },
    { passed: true, replayValid: false, notWorseThanBase: true },
    { passed: true, replayValid: true, notWorseThanBase: false },
  ];

  for (const [index, verification] of invalidVerifications.entries()) {
    await assert.rejects(
      adoptRemoteEvolutionArtifact({
        skillName: 'metabot-network-directory',
        variantId: `variant-remote-invalid-${index + 1}`,
        resolvedScopeHash: 'scope-hash-remote-invalid',
        remoteStore: {
          async readArtifact() {
            return createArtifactRecord({
              variantId: `variant-remote-invalid-${index + 1}`,
              scopeHash: 'scope-hash-remote-invalid',
              verification,
            });
          },
          async readSidecar() {
            return createSidecarRecord({
              variantId: `variant-remote-invalid-${index + 1}`,
              scopeHash: 'scope-hash-remote-invalid',
            });
          },
        },
        evolutionStore: {
          async setActiveVariantRef() {
            throw new Error('setActiveVariantRef should not run for invalid verification tuples');
          },
        },
      }),
      (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
    );
  }
});

test('missing verification object returns evolution_remote_variant_invalid', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-missing-verification',
      resolvedScopeHash: 'scope-hash-remote-missing-verification',
      remoteStore: {
        async readArtifact() {
          return {
            ...createArtifactRecord({
              variantId: 'variant-remote-missing-verification',
              scopeHash: 'scope-hash-remote-missing-verification',
            }),
            verification: undefined,
          };
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-missing-verification',
            scopeHash: 'scope-hash-remote-missing-verification',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run when verification is missing');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
  );
});

test('incomplete verification summary returns evolution_remote_variant_invalid', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-incomplete-verification',
      resolvedScopeHash: 'scope-hash-remote-incomplete-verification',
      remoteStore: {
        async readArtifact() {
          return {
            ...createArtifactRecord({
              variantId: 'variant-remote-incomplete-verification',
              scopeHash: 'scope-hash-remote-incomplete-verification',
            }),
            verification: {
              passed: true,
              replayValid: true,
              notWorseThanBase: true,
            },
          };
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-incomplete-verification',
            scopeHash: 'scope-hash-remote-incomplete-verification',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run for incomplete verification summaries');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
  );
});

test('protocolCompatible false returns evolution_remote_variant_invalid', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-protocol-incompatible',
      resolvedScopeHash: 'scope-hash-remote-protocol-incompatible',
      remoteStore: {
        async readArtifact() {
          return createArtifactRecord({
            variantId: 'variant-remote-protocol-incompatible',
            scopeHash: 'scope-hash-remote-protocol-incompatible',
            verification: {
              protocolCompatible: false,
            },
          });
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-protocol-incompatible',
            scopeHash: 'scope-hash-remote-protocol-incompatible',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run for protocol-incompatible verification');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
  );
});

test('non-finite checkedAt returns evolution_remote_variant_invalid', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-invalid-checked-at',
      resolvedScopeHash: 'scope-hash-remote-invalid-checked-at',
      remoteStore: {
        async readArtifact() {
          return createArtifactRecord({
            variantId: 'variant-remote-invalid-checked-at',
            scopeHash: 'scope-hash-remote-invalid-checked-at',
            verification: {
              checkedAt: Number.NaN,
            },
          });
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-invalid-checked-at',
            scopeHash: 'scope-hash-remote-invalid-checked-at',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run for invalid checkedAt');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
  );
});

test('variant id mismatch between requested id and imported records returns evolution_remote_variant_invalid', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-requested',
      resolvedScopeHash: 'scope-hash-remote-requested',
      remoteStore: {
        async readArtifact() {
          return createArtifactRecord({
            variantId: 'variant-remote-actual',
            scopeHash: 'scope-hash-remote-requested',
          });
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-requested',
            scopeHash: 'scope-hash-remote-requested',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run on variant id mismatch');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
  );
});

test('sidecar variant id mismatch returns evolution_remote_variant_invalid', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-sidecar-requested',
      resolvedScopeHash: 'scope-hash-remote-sidecar-requested',
      remoteStore: {
        async readArtifact() {
          return createArtifactRecord({
            variantId: 'variant-remote-sidecar-requested',
            scopeHash: 'scope-hash-remote-sidecar-requested',
          });
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-sidecar-actual',
            scopeHash: 'scope-hash-remote-sidecar-requested',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run on sidecar variant mismatch');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
  );
});

test('artifact and sidecar scope hash mismatch returns evolution_remote_variant_invalid', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-scope-integrity',
      resolvedScopeHash: 'scope-hash-sidecar',
      remoteStore: {
        async readArtifact() {
          return createArtifactRecord({
            variantId: 'variant-remote-scope-integrity',
            scopeHash: 'scope-hash-artifact',
          });
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-scope-integrity',
            scopeHash: 'scope-hash-sidecar',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run on artifact/sidecar scope mismatch');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
  );
});

test('missing metadata object returns evolution_remote_variant_invalid', async () => {
  await assert.rejects(
    adoptRemoteEvolutionArtifact({
      skillName: 'metabot-network-directory',
      variantId: 'variant-remote-missing-metadata',
      resolvedScopeHash: 'scope-hash-remote-missing-metadata',
      remoteStore: {
        async readArtifact() {
          return {
            ...createArtifactRecord({
              variantId: 'variant-remote-missing-metadata',
              scopeHash: 'scope-hash-remote-missing-metadata',
            }),
            metadata: undefined,
          };
        },
        async readSidecar() {
          return createSidecarRecord({
            variantId: 'variant-remote-missing-metadata',
            scopeHash: 'scope-hash-remote-missing-metadata',
          });
        },
      },
      evolutionStore: {
        async setActiveVariantRef() {
          throw new Error('setActiveVariantRef should not run when metadata is missing');
        },
      },
    }),
    (error) => assertFailureCode(error, 'evolution_remote_variant_invalid')
  );
});

test('remote adopt does not write into local self-evolution artifact files', async () => {
  const homeDir = createProfileHomeSync('metabot-remote-adopt-');
  const remoteStore = createRemoteEvolutionStore(homeDir);
  const evolutionStore = createLocalEvolutionStore(homeDir);
  const variantId = 'variant-remote-only-active-ref';

  await remoteStore.writeImport({
    artifact: createArtifactRecord({
      variantId,
      scopeHash: 'scope-hash-remote-only-active-ref',
    }),
    sidecar: createSidecarRecord({
      variantId,
      scopeHash: 'scope-hash-remote-only-active-ref',
    }),
  });

  await adoptRemoteEvolutionArtifact({
    skillName: 'metabot-network-directory',
    variantId,
    resolvedScopeHash: 'scope-hash-remote-only-active-ref',
    remoteStore,
    evolutionStore,
  });

  const localArtifactPath = path.join(evolutionStore.paths.evolutionArtifactsRoot, `${variantId}.json`);
  assert.equal(existsSync(localArtifactPath), false);

  const index = await evolutionStore.readIndex();
  assert.deepEqual(index.artifacts, []);
  assert.deepEqual(index.activeVariants['metabot-network-directory'], {
    source: 'remote',
    variantId,
  });
});
