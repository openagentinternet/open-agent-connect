import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  EVOLUTION_SEARCH_MAX_RAW_ROWS,
  deriveResolvedScopeHash,
  searchPublishedEvolutionArtifacts,
} = require('../../dist/core/evolution/import/searchArtifacts.js');

function createMetadata(overrides = {}) {
  return {
    protocolVersion: '1',
    skillName: 'metabot-network-directory',
    variantId: 'variant-a',
    artifactUri: 'metafile://artifact-a.json',
    evolutionType: 'FIX',
    triggerSource: 'hard_failure',
    scopeHash: 'scope-hash-1',
    sameSkill: true,
    sameScope: true,
    verificationPassed: true,
    replayValid: true,
    notWorseThanBase: true,
    lineage: {
      lineageId: 'lineage-a',
      parentVariantId: null,
      rootVariantId: 'variant-a',
      executionId: 'exec-a',
      analysisId: 'analysis-a',
      createdAt: 1_710_000_000_000,
    },
    publisherGlobalMetaId: 'idq://publisher-a',
    artifactCreatedAt: 1_710_000_100_000,
    artifactUpdatedAt: 1_710_000_200_000,
    publishedAt: 1_710_000_300_000,
    ...overrides,
  };
}

function createRow(pinId, contentSummary) {
  return {
    pinId,
    payload: {
      id: pinId,
      contentSummary,
    },
  };
}

test('deriveResolvedScopeHash prefers scope metadata hash and falls back to stringified scope', () => {
  const resolvedWithHash = {
    scopeMetadata: {
      scopeHash: 'scope-hash-from-metadata',
    },
    scope: {
      allowedCommands: ['a'],
    },
  };
  const resolvedWithoutHash = {
    scopeMetadata: {
      scopeHash: null,
    },
    scope: {
      chainRead: true,
      chainWrite: false,
      localUiOpen: true,
      remoteDelegation: false,
      allowedCommands: ['metabot network services'],
    },
  };

  assert.equal(
    deriveResolvedScopeHash(resolvedWithHash),
    'scope-hash-from-metadata'
  );
  assert.equal(
    deriveResolvedScopeHash(resolvedWithoutHash),
    JSON.stringify(resolvedWithoutHash.scope)
  );
});

test('search parses bounded metadata rows, filters valid matches, de-dupes, sorts, and annotates imports', async () => {
  let readIndexCalls = 0;
  let bodyFetchCalls = 0;
  const remoteStore = {
    async readIndex() {
      readIndexCalls += 1;
      return {
        schemaVersion: 1,
        imports: ['variant-a', 'variant-b'],
        byVariantId: {
          'variant-a': {
            variantId: 'variant-a',
            pinId: 'pin-imported-older',
          },
          'variant-b': {
            variantId: 'variant-b',
            pinId: 'pin-b',
          },
        },
      };
    },
    async readArtifact() {
      bodyFetchCalls += 1;
      return null;
    },
  };

  const rows = [
    createRow(
      'pin-a-old',
      createMetadata({
        variantId: 'variant-a',
        artifactUri: 'metafile://artifact-a-old.json',
        publishedAt: 100,
      })
    ),
    createRow(
      'pin-b',
      JSON.stringify(
        createMetadata({
          variantId: 'variant-b',
          artifactUri: 'metafile://artifact-b.json',
          publishedAt: 200,
          triggerSource: 'soft_failure',
        })
      )
    ),
    createRow(
      'pin-a-new',
      createMetadata({
        variantId: 'variant-a',
        artifactUri: 'metafile://artifact-a-new.json',
        publishedAt: 200,
      })
    ),
    createRow(
      'pin-other-skill',
      createMetadata({
        variantId: 'variant-other-skill',
        skillName: 'metabot-trace-inspector',
        artifactUri: 'metafile://artifact-other-skill.json',
      })
    ),
    createRow(
      'pin-other-scope',
      createMetadata({
        variantId: 'variant-other-scope',
        scopeHash: 'scope-hash-other',
        artifactUri: 'metafile://artifact-other-scope.json',
      })
    ),
    createRow(
      'pin-unverified',
      createMetadata({
        variantId: 'variant-unverified',
        verificationPassed: false,
        artifactUri: 'metafile://artifact-unverified.json',
      })
    ),
    createRow(
      'pin-missing-required',
      createMetadata({
        variantId: 'variant-missing-required',
        artifactUri: undefined,
      })
    ),
    createRow('pin-invalid-json', '{not-json'),
    {
      pinId: 'pin-missing-content-summary',
      payload: {
        id: 'pin-missing-content-summary',
      },
    },
    createRow('pin-non-object-content', '123'),
  ];

  for (let index = rows.length; index < EVOLUTION_SEARCH_MAX_RAW_ROWS; index += 1) {
    rows.push(
      createRow(
        `pin-noise-${index}`,
        createMetadata({
          variantId: `variant-noise-${index}`,
          skillName: 'metabot-other',
          artifactUri: `metafile://artifact-noise-${index}.json`,
        })
      )
    );
  }

  rows.push(
    createRow(
      'pin-beyond-cap',
      createMetadata({
        variantId: 'variant-beyond-cap',
        artifactUri: 'metafile://artifact-beyond-cap.json',
        publishedAt: 999999,
      })
    )
  );

  const result = await searchPublishedEvolutionArtifacts({
    skillName: 'metabot-network-directory',
    resolvedScopeHash: 'scope-hash-1',
    remoteStore,
    fetchMetadataRows: async () => rows,
  });

  assert.equal(readIndexCalls, 1);
  assert.equal(bodyFetchCalls, 0);

  assert.equal(result.skillName, 'metabot-network-directory');
  assert.equal(result.scopeHash, 'scope-hash-1');
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.results.map((row) => ({
      pinId: row.pinId,
      variantId: row.variantId,
      publishedAt: row.publishedAt,
      alreadyImported: row.alreadyImported,
      importedPinId: row.importedPinId,
    })),
    [
      {
        pinId: 'pin-a-new',
        variantId: 'variant-a',
        publishedAt: 200,
        alreadyImported: true,
        importedPinId: 'pin-imported-older',
      },
      {
        pinId: 'pin-b',
        variantId: 'variant-b',
        publishedAt: 200,
        alreadyImported: true,
        importedPinId: 'pin-b',
      },
    ]
  );
});

test('search skips malformed rows without failing the full search', async () => {
  const remoteStore = {
    async readIndex() {
      return {
        schemaVersion: 1,
        imports: [],
        byVariantId: {},
      };
    },
  };

  const result = await searchPublishedEvolutionArtifacts({
    skillName: 'metabot-network-directory',
    resolvedScopeHash: 'scope-hash-1',
    remoteStore,
    fetchMetadataRows: async () => [
      { pinId: 'bad-1', payload: null },
      createRow('bad-2', 'not-json'),
      createRow(
        'good-1',
        createMetadata({
          variantId: 'variant-ok',
          artifactUri: 'metafile://artifact-ok.json',
          publishedAt: 321,
        })
      ),
      { pinId: '', payload: { contentSummary: {} } },
    ],
  });

  assert.equal(result.count, 1);
  assert.equal(result.results[0].pinId, 'good-1');
  assert.equal(result.results[0].variantId, 'variant-ok');
});

test('search surfaces transport/page envelope failures as search-level errors', async () => {
  const remoteStore = {
    async readIndex() {
      return {
        schemaVersion: 1,
        imports: [],
        byVariantId: {},
      };
    },
  };

  await assert.rejects(
    searchPublishedEvolutionArtifacts({
      skillName: 'metabot-network-directory',
      resolvedScopeHash: 'scope-hash-1',
      remoteStore,
      fetchMetadataRows: async () => {
        throw new Error('chain_path_list_failed');
      },
    }),
    /chain_path_list_failed/
  );
});
