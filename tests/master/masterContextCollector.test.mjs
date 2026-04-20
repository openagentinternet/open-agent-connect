import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { collectMasterContext } = require('../../dist/core/master/masterContextCollector.js');

test('collectMasterContext normalizes host-visible signals without leaking hidden reasoning', () => {
  const collected = collectMasterContext({
    now: 1_776_200_000_000,
    hostMode: 'codex',
    traceId: 'trace-master-context-1',
    conversation: {
      currentUserRequest: 'Why does the Ask Master preview never leave confirmation?',
      recentMessages: [
        { role: 'user', content: 'I can reproduce the stuck preview locally.' },
        { role: 'assistant', content: 'I inspected defaultHandlers.ts and the trace rebuild path.' },
      ],
    },
    tools: {
      recentToolResults: [
        {
          toolName: 'npm test',
          exitCode: 1,
          stdout: 'not ok 7 - master trace retains ask master metadata after caller trace artifacts are rebuilt',
          stderr: 'AssertionError: expected requestId to survive trace rebuild\n    at tests/master/masterTraceCommand.test.mjs:190:1',
        },
        {
          toolName: 'node scripts/demo.mjs',
          exitCode: 1,
          stdout: '',
          stderr: 'Error: ECONNREFUSED 127.0.0.1:25200',
        },
      ],
    },
    workspace: {
      goal: 'Preserve Ask Master metadata across trace rebuilds.',
      constraints: ['Do not change timeout semantics.'],
      relevantFiles: [
        'src/daemon/defaultHandlers.ts',
        '.env',
        'tests/master/masterTraceCommand.test.mjs',
      ],
      diffSummary: 'Touching trace rebuild and provider delivery failure paths.',
      fileExcerpts: [
        {
          path: 'src/daemon/defaultHandlers.ts',
          content: 'function rebuildCallerTraceArtifacts(baseTrace) { return { ...baseTrace }; }',
        },
        {
          path: '.env',
          content: 'OPENAI_API_KEY=super-secret',
        },
      ],
    },
    planner: {
      hasPlan: true,
      todoBlocked: true,
      onlyReadingWithoutConverging: true,
    },
    cot: 'private reasoning should never leak',
  });

  assert.equal(collected.hostMode, 'codex');
  assert.equal(collected.taskSummary, 'Why does the Ask Master preview never leave confirmation?');
  assert.equal(collected.questionCandidate, 'Why does the Ask Master preview never leave confirmation?');
  assert.match(collected.workspaceSummary ?? '', /Preserve Ask Master metadata across trace rebuilds\./);
  assert.match(collected.workspaceSummary ?? '', /blocked/i);
  assert.doesNotMatch(collected.workspaceSummary ?? '', /\.env/);
  assert.deepEqual(
    collected.diagnostics.failingTests,
    ['master trace retains ask master metadata after caller trace artifacts are rebuilt']
  );
  assert.deepEqual(collected.diagnostics.failingCommands, ['npm test', 'node scripts/demo.mjs']);
  assert.deepEqual(collected.diagnostics.repeatedErrorSignatures, [
    'AssertionError: expected requestId to survive trace rebuild',
    'Error: ECONNREFUSED 127.0.0.1:25200',
  ]);
  assert.deepEqual(collected.workState.relevantFiles, [
    'src/daemon/defaultHandlers.ts',
    '.env',
    'tests/master/masterTraceCommand.test.mjs',
  ]);
  assert.match(collected.workState.errorSummary ?? '', /AssertionError: expected requestId/);
  assert.equal(
    collected.artifacts.some((artifact) => artifact.source === 'file_excerpt' && artifact.path === '.env'),
    true
  );
  assert.doesNotMatch(JSON.stringify(collected), /private reasoning should never leak/);
});
