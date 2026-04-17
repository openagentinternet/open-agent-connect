import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runOfficialDebugMaster } = require('../../dist/core/master/debugMasterFixture.js');

function createRequest(overrides = {}) {
  const extensions = {
    goal: 'Unblock the caller with the shortest correct fix path.',
    errorSummary: null,
    diffSummary: null,
    constraints: ['Keep the answer concrete and command-oriented.'],
    ...overrides.extensions,
  };

  return {
    type: 'master_request',
    version: '1.0.0',
    requestId: 'request-debug-master-1',
    traceId: 'trace-debug-master-1',
    caller: {
      globalMetaId: 'idq1caller',
      name: 'Caller Bot',
      host: 'codex',
    },
    target: {
      masterServicePinId: 'master-pin-1',
      providerGlobalMetaId: 'idq1provider',
      masterKind: 'debug',
    },
    task: {
      userTask: 'Diagnose a local Ask Master problem.',
      question: 'Why is Ask Master not returning the expected result?',
      ...overrides.task,
    },
    context: {
      workspaceSummary: 'Open Agent Connect workspace with a local caller/provider setup.',
      relevantFiles: [],
      artifacts: [],
      ...overrides.context,
    },
    trigger: {
      mode: 'manual',
      reason: 'Caller explicitly requested Ask Master help.',
    },
    desiredOutput: 'structured_help',
    extensions,
  };
}

test('official debug master returns stable structured advice for discovery-empty cases', () => {
  const result = runOfficialDebugMaster({
    request: createRequest({
      task: {
        question: 'metabot master list returns an empty masters list. Is that expected?',
      },
      context: {
        artifacts: [
          {
            kind: 'text',
            label: 'master-list-output',
            content: '{"ok":true,"state":"success","data":{"masters":[]}}',
            mimeType: 'application/json',
          },
        ],
      },
      extensions: {
        errorSummary: 'Observed local output: {"ok":true,"state":"success","data":{"masters":[]}}',
      },
    }),
  });

  assert.deepEqual(result, {
    state: 'completed',
    summary: 'The empty master list most likely means the caller has no visible online master source, or the target master is filtered out for the current host.',
    findings: [
      'A successful empty list is usually a discovery/configuration state, not a runtime crash.',
      'The first checks should be network sources, provider online status, and host-mode visibility for the published master-service.',
      'If the target provider daemon URL is already known, direct Ask Master delivery can still work even before local discovery is populated.',
    ],
    recommendations: [
      'Run `metabot network sources list` on the caller side and confirm the expected provider base URL is present.',
      'If the provider source is missing, add it with `metabot network sources add --base-url <provider-url>` and re-run `metabot master list`.',
      'If the source exists but the list is still empty, verify the provider is online and the master-service includes the current host mode.',
    ],
    risks: [
      'This diagnosis is based only on the structured request and does not prove the current provider is online right now.',
      'Do not assume an empty list means the feature is broken before checking local source configuration.',
    ],
    confidence: 0.84,
    followUpQuestion: 'Can you share the current output of `metabot network sources list` from the caller side?',
  });
});

test('official debug master returns stable timeout guidance without pretending the provider stopped', () => {
  const result = runOfficialDebugMaster({
    request: createRequest({
      task: {
        userTask: 'Explain a timeout seen during Ask Master.',
        question: 'The request timed out. Does that mean the provider stopped running?',
      },
      extensions: {
        errorSummary: 'Caller saw a timeout while waiting for a remote master response.',
      },
    }),
  });

  assert.deepEqual(result, {
    state: 'completed',
    summary: 'A timeout usually means the caller stopped waiting before the provider result was observed, not that the provider definitely stopped running.',
    findings: [
      'Caller-side timeout semantics describe the local wait boundary first.',
      'The next step is to inspect trace state and any late-arriving provider result before changing runtime semantics.',
      'Treat timeout as an observability/debugging problem unless provider failure evidence is explicit.',
    ],
    recommendations: [
      'Check the trace state for the request and look for a later provider completion event.',
      'Verify whether the caller foreground wait ended while a background continuation was still allowed to watch for delivery.',
      'Only change timeout values after confirming the provider is actually slow rather than merely observed late.',
    ],
    risks: [
      'If you treat timeout as provider failure too early, you can misdiagnose a still-running request.',
      'This answer is based on the request text and not on a live trace inspection.',
    ],
    confidence: 0.79,
    followUpQuestion: 'Do you already have the traceId for the timed-out Ask Master request?',
  });
});

test('official debug master asks for more context when the request is too vague for a reliable diagnosis', () => {
  const result = runOfficialDebugMaster({
    request: createRequest({
      task: {
        userTask: 'Help me fix it.',
        question: 'What should I do?',
      },
      context: {
        workspaceSummary: null,
      },
      extensions: {
        goal: null,
        errorSummary: null,
        diffSummary: null,
        constraints: [],
      },
    }),
  });

  assert.deepEqual(result, {
    state: 'need_more_context',
    summary: 'The current request is too vague to support a reliable debugging diagnosis.',
    missing: [
      'The concrete error output, failing behavior, or exact unexpected result.',
      'What the caller expected to happen instead.',
    ],
    followUpQuestion: 'Can you send the observed error output or the exact unexpected behavior?',
    risks: [
      'Without concrete failure details, any recommendation would be guesswork.',
    ],
  });
});
