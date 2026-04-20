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

test('buildMasterAskPreview re-sanitizes raw drafts before emitting preview and request payloads', () => {
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
      userTask: 'Investigate why /Users/alice/.env breaks the host task.',
      question: 'What should I try next about wallets/dev.key?',
      goal: 'Keep the request minimal.',
      workspaceSummary: 'Relevant files: .env, db/seed.ts, src/safe.ts.',
      errorSummary: 'OPENAI_API_KEY=super-secret',
      diffSummary: 'Touched wallets/dev.key and src/safe.ts.',
      relevantFiles: [
        '.env',
        'db/seed.ts',
        'src/safe.ts',
        'wallets/dev.key',
      ],
      artifacts: [
        { kind: 'text', label: 'excerpt:/Users/alice/.env', content: 'looks safe' },
        { kind: 'text', label: 'OPENAI_API_KEY=super-secret', content: 'still looks safe' },
        { kind: 'text', label: 'secret', content: 'OPENAI_API_KEY=super-secret' },
        { kind: 'text', label: 'path_content', content: "Error: ENOENT: open '/Users/alice/.env'" },
        { kind: 'text', label: 'long', content: 'x'.repeat(400) },
        { kind: 'text', label: 'safe', content: 'Looks safe.' },
      ],
      constraints: [
        'Do not upload credentials.',
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
    traceId: 'trace-master-preview-2',
    requestId: 'request-master-preview-2',
    confirmationMode: 'always',
  });

  assert.doesNotMatch(prepared.request.task.userTask, /\/Users\/alice\/\.env/);
  assert.doesNotMatch(prepared.request.task.question, /wallets\/dev\.key/);
  assert.match(prepared.request.task.userTask, /\[redacted-sensitive-path\]/);
  assert.match(prepared.request.task.question, /\[redacted-sensitive-path\]/);
  assert.equal(prepared.preview.context.workspaceSummary, null);
  assert.equal(prepared.preview.context.errorSummary, null);
  assert.equal(prepared.preview.context.diffSummary, null);
  assert.deepEqual(prepared.preview.context.relevantFiles, ['db/seed.ts', 'src/safe.ts']);
  assert.equal(prepared.preview.context.artifacts.some((artifact) => /OPENAI_API_KEY/.test(artifact.content)), false);
  assert.equal(prepared.preview.context.artifacts.some((artifact) => /\.env|OPENAI_API_KEY/.test(artifact.label)), false);
  assert.equal(prepared.preview.context.artifacts.some((artifact) => /\/Users\/alice\/\.env/.test(artifact.content)), false);
  assert.equal(prepared.preview.context.artifacts.every((artifact) => artifact.content.length <= 320), true);
  assert.deepEqual(prepared.request.context.relevantFiles, ['db/seed.ts', 'src/safe.ts']);
  assert.equal(prepared.request.context.artifacts.some((artifact) => /OPENAI_API_KEY/.test(artifact.content)), false);
  assert.equal(prepared.request.context.artifacts.some((artifact) => /\.env|OPENAI_API_KEY/.test(artifact.label)), false);
  assert.equal(prepared.request.context.artifacts.some((artifact) => /\/Users\/alice\/\.env/.test(artifact.content)), false);
});

test('buildMasterAskPreview maps full_task to the public standard context shape', () => {
  const prepared = buildMasterAskPreview({
    draft: {
      target: {
        servicePinId: 'master-pin-1',
        providerGlobalMetaId: 'idq1provider',
        masterKind: 'debug',
        displayName: 'Official Debug Master',
      },
      triggerMode: 'manual',
      contextMode: 'full_task',
      userTask: 'Investigate a blocked host task.',
      question: 'What should I try next?',
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
    },
    resolvedTarget: createResolvedTarget(),
    caller: {
      globalMetaId: 'idq1caller',
      name: 'Caller Bot',
      host: 'codex',
    },
    traceId: 'trace-master-preview-3',
    requestId: 'request-master-preview-3',
    confirmationMode: 'always',
  });

  assert.equal(prepared.preview.context.contextMode, 'standard');
  assert.equal(prepared.preview.context.relevantFiles.length, 4);
  assert.equal(prepared.preview.context.artifacts.length, 4);
});

test('buildMasterAskPreview reflects confirmationMode=never without forcing confirmation', () => {
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
      userTask: 'Investigate a blocked host task.',
      question: 'What should I try next?',
    },
    resolvedTarget: createResolvedTarget(),
    caller: {
      globalMetaId: 'idq1caller',
      name: 'Caller Bot',
      host: 'codex',
    },
    traceId: 'trace-master-preview-4',
    requestId: 'request-master-preview-4',
    confirmationMode: 'never',
  });

  assert.equal(prepared.preview.confirmation.policyMode, 'never');
  assert.equal(prepared.preview.confirmation.requiresConfirmation, false);
});
