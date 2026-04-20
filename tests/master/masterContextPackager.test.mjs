import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { packageMasterContextForAsk } = require('../../dist/core/master/masterContextPackager.js');
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

function createCollectedContext() {
  return {
    hostMode: 'codex',
    taskSummary: 'Diagnose why Ask Master metadata disappears after the caller trace leaves preview.',
    questionCandidate: 'What is the most likely root cause and the next best fix?',
    workspaceSummary: 'Open Agent Connect repo. Current work is blocked after repeated trace rebuild failures.',
    diagnostics: {
      failingTests: [
        'master trace retains ask master metadata after caller trace artifacts are rebuilt',
      ],
      failingCommands: ['npm test', 'node scripts/demo.mjs'],
      repeatedErrorSignatures: [
        'AssertionError: expected requestId to survive trace rebuild',
        'Error: ECONNREFUSED 127.0.0.1:25200',
      ],
      stderrHighlights: [
        'AssertionError: expected requestId to survive trace rebuild',
        'Error: ECONNREFUSED 127.0.0.1:25200',
      ],
    },
    workState: {
      goal: 'Preserve Ask Master metadata across trace rebuilds.',
      constraints: [
        'Do not change timeout semantics.',
        'Do not upload the whole repository.',
      ],
      errorSummary: 'AssertionError: expected requestId to survive trace rebuild',
      diffSummary: 'Touching trace rebuild and provider delivery failure paths.',
      relevantFiles: [
        '.env',
        'wallets/dev.key',
        'src/daemon/defaultHandlers.ts',
        'tests/master/masterTraceCommand.test.mjs',
        'src/core/master/masterTrace.ts',
        'src/core/master/masterPreview.ts',
        'src/core/master/masterMessageSchema.ts',
      ],
    },
    artifacts: [
      {
        kind: 'text',
        label: 'current_request',
        content: 'Why does Ask Master lose metadata after preview?',
        source: 'chat',
        path: null,
      },
      {
        kind: 'text',
        label: 'test_failure',
        content: 'AssertionError: expected requestId to survive trace rebuild',
        source: 'test',
        path: null,
      },
      {
        kind: 'text',
        label: 'terminal_error',
        content: 'Error: ECONNREFUSED 127.0.0.1:25200',
        source: 'terminal',
        path: null,
      },
      {
        kind: 'text',
        label: 'diff_summary',
        content: 'Touching trace rebuild and provider delivery failure paths.',
        source: 'diff',
        path: null,
      },
      {
        kind: 'text',
        label: 'excerpt:.env',
        content: 'OPENAI_API_KEY=super-secret',
        source: 'file_excerpt',
        path: '.env',
      },
      {
        kind: 'text',
        label: 'excerpt:src/daemon/defaultHandlers.ts',
        content: 'x'.repeat(900),
        source: 'file_excerpt',
        path: 'src/daemon/defaultHandlers.ts',
      },
    ],
  };
}

test('packageMasterContextForAsk filters sensitive inputs and enforces the compact budget', () => {
  const draft = packageMasterContextForAsk({
    collected: createCollectedContext(),
    triggerMode: 'manual',
    contextMode: 'compact',
  });

  assert.equal(draft.triggerMode, 'manual');
  assert.equal(draft.contextMode, 'compact');
  assert.equal(
    draft.userTask,
    'Diagnose why Ask Master metadata disappears after the caller trace leaves preview.'
  );
  assert.equal(draft.question, 'What is the most likely root cause and the next best fix?');
  assert.equal(draft.desiredOutput.mode, 'structured_help');
  assert.deepEqual(draft.relevantFiles, [
    'src/daemon/defaultHandlers.ts',
    'tests/master/masterTraceCommand.test.mjs',
    'src/core/master/masterTrace.ts',
  ]);
  assert.equal(draft.artifacts.length, 3);
  assert.equal(draft.artifacts.some((artifact) => /OPENAI_API_KEY/.test(artifact.content)), false);
  assert.equal(draft.artifacts.every((artifact) => artifact.content.length <= 320), true);
  assert.match(draft.errorSummary ?? '', /AssertionError: expected requestId/);
});

test('packageMasterContextForAsk filters Windows-style sensitive paths before packaging', () => {
  const collected = createCollectedContext();
  collected.workState.relevantFiles = [
    'C:\\Users\\dev\\.env',
    'C:\\Users\\dev\\wallets\\prod.key',
    'db\\seed.ts',
    'src\\daemon\\defaultHandlers.ts',
    'tests\\master\\masterTraceCommand.test.mjs',
  ];
  collected.artifacts.push(
    {
      kind: 'text',
      label: 'excerpt:C:\\Users\\dev\\.env',
      content: 'safe looking text',
      source: 'file_excerpt',
      path: 'C:\\Users\\dev\\.env',
    },
    {
      kind: 'text',
      label: 'excerpt:src\\daemon\\defaultHandlers.ts',
      content: 'export function keepMe() {}',
      source: 'file_excerpt',
      path: 'src\\daemon\\defaultHandlers.ts',
    }
  );

  const draft = packageMasterContextForAsk({
    collected,
    contextMode: 'compact',
  });

  assert.deepEqual(draft.relevantFiles, [
    'db\\seed.ts',
    'src\\daemon\\defaultHandlers.ts',
    'tests\\master\\masterTraceCommand.test.mjs',
  ]);
  assert.equal(
    draft.artifacts.some((artifact) => artifact.label === 'excerpt:C:\\Users\\dev\\.env'),
    false
  );
});

test('packageMasterContextForAsk scrubs sensitive summary fields before building the draft', () => {
  const collected = createCollectedContext();
  collected.workState.goal = 'Inspect wallets/dev.key handling.';
  collected.workspaceSummary = 'Relevant files: .env, src/daemon/defaultHandlers.ts.';
  collected.workState.errorSummary = 'OPENAI_API_KEY=super-secret';
  collected.workState.diffSummary = 'Touched src/daemon/defaultHandlers.ts and wallets/dev.key.';
  collected.workState.constraints = [
    'Keep the answer structured.',
    'Do not inspect wallets/dev.key.',
  ];

  const draft = packageMasterContextForAsk({
    collected,
    contextMode: 'compact',
  });

  assert.equal(draft.goal, null);
  assert.equal(draft.workspaceSummary, null);
  assert.equal(draft.errorSummary, null);
  assert.equal(draft.diffSummary, null);
  assert.deepEqual(draft.constraints, ['Keep the answer structured.']);
});

test('packageMasterContextForAsk avoids deriving a question from sensitive error signatures', () => {
  const collected = createCollectedContext();
  collected.questionCandidate = null;
  collected.diagnostics.failingTests = [];
  collected.diagnostics.repeatedErrorSignatures = [
    "Error: ENOENT: no such file or directory, open '/Users/alice/.env'",
  ];

  const draft = packageMasterContextForAsk({
    collected,
    contextMode: 'compact',
  });

  assert.equal(draft.question, 'What is the most likely root cause and the next best fix?');
});

test('packageMasterContextForAsk redacts sensitive paths from task text and drops path-bearing artifacts', () => {
  const collected = createCollectedContext();
  collected.taskSummary = 'Diagnose why /Users/alice/.env fails to load.';
  collected.questionCandidate = 'Why does wallets/dev.key break the task?';
  collected.artifacts.push({
    kind: 'text',
    label: 'terminal_excerpt',
    content: "Error: ENOENT: open '/Users/alice/.env'",
    source: 'terminal',
    path: null,
  });

  const draft = packageMasterContextForAsk({
    collected,
    contextMode: 'compact',
  });

  assert.doesNotMatch(draft.userTask, /\/Users\/alice\/\.env/);
  assert.doesNotMatch(draft.question, /wallets\/dev\.key/);
  assert.match(draft.userTask, /\[redacted-sensitive-path\]/);
  assert.match(draft.question, /\[redacted-sensitive-path\]/);
  assert.equal(draft.artifacts.some((artifact) => /\/Users\/alice\/\.env/.test(artifact.content)), false);
});

test('packageMasterContextForAsk emits a preview-ready standard draft with safety-visible preview data', () => {
  const collected = createCollectedContext();
  collected.workState.relevantFiles.push(
    'src/core/master/masterTypes.ts',
    'src/core/master/masterContextCollector.ts',
    'src/core/master/masterContextPackager.ts',
    'docs/superpowers/specs/2026-04-20-master-context-collector-packager.zh-CN.md'
  );
  collected.artifacts.push(
    {
      kind: 'text',
      label: 'excerpt:src/core/master/masterTypes.ts',
      content: 'type MasterDirectoryItem = { ... }',
      source: 'file_excerpt',
      path: 'src/core/master/masterTypes.ts',
    },
    {
      kind: 'text',
      label: 'excerpt:src/core/master/masterContextCollector.ts',
      content: 'export function collectMasterContext(...) { ... }',
      source: 'file_excerpt',
      path: 'src/core/master/masterContextCollector.ts',
    },
    {
      kind: 'text',
      label: 'excerpt:src/core/master/masterContextPackager.ts',
      content: 'export function packageMasterContextForAsk(...) { ... }',
      source: 'file_excerpt',
      path: 'src/core/master/masterContextPackager.ts',
    },
    {
      kind: 'text',
      label: 'spec_excerpt',
      content: 'phase-2 先只公开 compact 与 standard',
      source: 'chat',
      path: null,
    }
  );

  const draft = packageMasterContextForAsk({
    collected,
    target: {
      servicePinId: 'master-pin-1',
      providerGlobalMetaId: 'idq1provider',
      masterKind: 'debug',
      displayName: 'Official Debug Master',
    },
    triggerMode: 'suggest',
    contextMode: 'standard',
    explicitQuestion: 'Which root cause is most likely, and what should I try next to unblock this?',
  });

  assert.equal(draft.triggerMode, 'suggest');
  assert.equal(draft.contextMode, 'standard');
  assert.equal(
    draft.question,
    'Which root cause is most likely, and what should I try next to unblock this?'
  );
  assert.equal(draft.relevantFiles.length, 8);
  assert.equal(draft.artifacts.length, 8);
  assert.equal(draft.target?.servicePinId, 'master-pin-1');

  const preview = buildMasterAskPreview({
    draft,
    resolvedTarget: createResolvedTarget(),
    caller: {
      globalMetaId: 'idq1caller',
      name: 'Caller Bot',
      host: 'codex',
    },
    traceId: 'trace-master-context-preview-1',
    requestId: 'request-master-context-preview-1',
    confirmationMode: 'always',
  });

  assert.equal(preview.preview.context.contextMode, 'standard');
  assert.equal(preview.preview.context.relevantFiles.length, 8);
  assert.equal(preview.preview.context.artifacts.length, 8);
  assert.equal(preview.preview.safety.noImplicitRepoUpload, true);
  assert.equal(preview.preview.safety.noImplicitSecrets, true);
  assert.equal(preview.preview.request.trigger.mode, 'suggest');
});
