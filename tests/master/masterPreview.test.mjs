import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildMasterAskPreview } = require('../../dist/core/master/masterPreview.js');

function createResolvedTarget() {
  return {
    masterPinId: 'master-pin-1',
    sourceMasterPinId: 'master-pin-1',
    providerGlobalMetaId: 'idq1provider',
    providerMetaId: 'metaid-provider',
    providerAddress: 'mvc-address',
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    description: 'Structured debugging help.',
    masterKind: 'debug',
    specialties: ['debugging'],
    hostModes: ['codex'],
    modelInfo: { provider: 'metaweb', model: 'official-debug-master-v1' },
    style: 'direct_and_structured',
    pricingMode: 'free',
    price: '0',
    currency: 'MVC',
    responseMode: 'structured',
    contextPolicy: 'standard',
    official: true,
    trustedTier: 'official',
    available: true,
    online: true,
    updatedAt: 1_776_000_000_000,
  };
}

test('buildMasterAskPreview trims context to the configured budget and emits a final JSON snapshot', () => {
  const prepared = buildMasterAskPreview({
    draft: {
      target: {
        servicePinId: 'master-pin-1',
        providerGlobalMetaId: 'idq1provider',
        masterKind: 'debug',
        displayName: 'Official Debug Master',
      },
      triggerMode: 'manual',
      contextMode: 'compact',
      userTask: 'Investigate why the caller trace never leaves preview.',
      question: 'What is the most likely root cause and shortest fix path?',
      goal: 'Get actionable debugging steps.',
      workspaceSummary: 'Open Agent Connect repo.',
      errorSummary: 'No structured response arrives after confirm.',
      diffSummary: 'Recent Ask Master phase-1 changes are in progress.',
      relevantFiles: [
        'src/a.ts',
        'src/b.ts',
        'src/c.ts',
        'src/d.ts',
      ],
      artifacts: [
        { kind: 'text', label: 'a', content: 'A' },
        { kind: 'text', label: 'b', content: 'B' },
        { kind: 'text', label: 'c', content: 'C' },
        { kind: 'text', label: 'd', content: 'D' },
      ],
      constraints: [
        'Do not ask for CoT.',
      ],
      desiredOutput: {
        mode: 'structured_help',
      },
    },
    resolvedTarget: createResolvedTarget(),
    caller: {
      globalMetaId: 'idq1caller',
      name: 'Caller Bot',
      host: 'codex',
    },
    traceId: 'trace-master-preview-1',
    requestId: 'request-master-preview-1',
    confirmationMode: 'always',
  });

  assert.equal(prepared.request.traceId, 'trace-master-preview-1');
  assert.equal(prepared.preview.target.displayName, 'Official Debug Master');
  assert.deepEqual(prepared.preview.context.relevantFiles, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
  assert.equal(prepared.preview.context.artifacts.length, 3);
  assert.equal(prepared.preview.safety.noImplicitRepoUpload, true);
  assert.equal(prepared.preview.confirmation.policyMode, 'always');
  assert.equal(prepared.preview.request.type, 'master_request');
  assert.match(prepared.requestJson, /"requestId":"request-master-preview-1"/);
});
