import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runOfficialReviewMaster } = require('../../dist/core/master/reviewMasterFixture.js');

function createRequest(overrides = {}) {
  const extensions = {
    goal: 'Return the highest-value review findings first.',
    errorSummary: null,
    diffSummary: 'Patch updates review-master routing and provider matrix coverage.',
    constraints: ['Keep the review structured and concrete.'],
    ...overrides.extensions,
  };

  return {
    type: 'master_request',
    version: '1.0.0',
    requestId: 'request-review-master-1',
    traceId: 'trace-review-master-1',
    caller: {
      globalMetaId: 'idq1caller',
      name: 'Caller Bot',
      host: 'codex',
    },
    target: {
      masterServicePinId: 'master-pin-review-1',
      providerGlobalMetaId: 'idq1provider',
      masterKind: 'review',
    },
    task: {
      userTask: 'Review the current patch before release.',
      question: 'What review findings or regression risks matter most here?',
      ...overrides.task,
    },
    context: {
      workspaceSummary: 'Open Agent Connect workspace with a provider-matrix patch under review.',
      relevantFiles: ['src/core/master/masterProviderRuntime.ts'],
      artifacts: [],
      ...overrides.context,
    },
    trigger: {
      mode: 'manual',
      reason: 'Caller explicitly requested review help.',
    },
    desiredOutput: 'structured_review',
    extensions,
  };
}

test('official review master asks for more context when the request is too vague for a reliable review', () => {
  const result = runOfficialReviewMaster({
    request: createRequest({
      task: {
        userTask: 'Review this.',
        question: 'Thoughts?',
      },
      context: {
        workspaceSummary: null,
        relevantFiles: [],
        artifacts: [],
      },
      extensions: {
        goal: null,
        diffSummary: null,
        constraints: [],
      },
    }),
  });

  assert.deepEqual(result, {
    state: 'need_more_context',
    summary: 'The current request is too vague for a reliable review pass.',
    missing: [
      'A short diff summary or a few changed file paths.',
      'The main regression risk or review concern you want checked first.',
    ],
    followUpQuestion: 'Can you share the diff summary or the main patch risk you want reviewed first?',
    risks: [
      'Without patch context, any review findings would be speculative.',
    ],
  });
});

test('official review master returns generic structured review guidance when the request has context but not a strong patch-risk signature', () => {
  const result = runOfficialReviewMaster({
    request: createRequest({
      task: {
        userTask: 'Sanity-check the current implementation direction.',
        question: 'What should I inspect first before continuing?',
      },
      context: {
        workspaceSummary: 'Open Agent Connect workspace with documentation and helper cleanup in progress.',
      },
      extensions: {
        goal: 'Return the highest-value observations first.',
        diffSummary: 'Current implementation mostly updates docs and small helper constants.',
        constraints: ['Keep the answer structured and concrete.'],
      },
    }),
  });

  assert.deepEqual(result, {
    state: 'completed',
    summary: 'Start with the highest-impact behavior changes, then verify that the supporting tests still cover the intended routing and safety boundaries.',
    findings: [
      'The request looks reviewable, but the current context does not point to one single dominant regression yet.',
      'The most useful next step is to anchor the review around routing, policy, or trace behavior rather than general code style.',
    ],
    recommendations: [
      'Identify the one or two user-visible behaviors this patch changes and confirm tests pin them down directly.',
      'Prefer targeted assertions on routing and exported state over broad snapshot-only checks.',
    ],
    risks: [
      'A broad review request without a focal risk can miss the highest-value behavior change.',
    ],
    confidence: 0.72,
    followUpQuestion: 'Which specific behavior change should the review focus on first?',
  });
});
