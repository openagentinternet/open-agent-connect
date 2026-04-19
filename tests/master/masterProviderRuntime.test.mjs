import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createA2ASessionEngine } = require('../../dist/core/a2a/sessionEngine.js');
const {
  handleMasterProviderRequest,
} = require('../../dist/core/master/masterProviderRuntime.js');
const { parseMasterResponse } = require('../../dist/core/master/masterMessageSchema.js');

function createPublishedMaster(overrides = {}) {
  return {
    id: 'master-pin-1',
    sourceMasterPinId: 'master-pin-1',
    currentPinId: 'master-pin-1',
    creatorMetabotId: 1,
    providerGlobalMetaId: 'idq1provider',
    providerAddress: 'mvc-provider-address',
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    description: 'Structured debugging help.',
    masterKind: 'debug',
    specialties: ['debugging'],
    hostModes: ['codex'],
    modelInfoJson: '{"provider":"metaweb","model":"official-debug-master-v1"}',
    style: 'direct_and_structured',
    pricingMode: 'free',
    price: '0',
    currency: 'MVC',
    responseMode: 'structured',
    contextPolicy: 'standard',
    official: 1,
    trustedTier: 'official',
    payloadJson: '{}',
    available: 1,
    revokedAt: null,
    updatedAt: 1_776_000_000_000,
    ...overrides,
  };
}

function createRequest(overrides = {}) {
  return {
    type: 'master_request',
    version: '1.0.0',
    requestId: 'request-provider-runtime-1',
    traceId: 'trace-provider-runtime-1',
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
      userTask: 'Diagnose why master discovery is empty.',
      question: 'metabot master list returns an empty masters list. What should I check first?',
    },
    context: {
      workspaceSummary: 'Caller-side Ask Master smoke test.',
      relevantFiles: [],
      artifacts: [
        {
          kind: 'text',
          label: 'master-list-output',
          content: '{"ok":true,"state":"success","data":{"masters":[]}}',
          mimeType: 'application/json',
        },
      ],
    },
    trigger: {
      mode: 'manual',
      reason: 'Caller explicitly requested Ask Master help.',
    },
    desiredOutput: 'structured_help',
    extensions: {
      goal: 'Return the shortest correct fix path.',
      errorSummary: 'Observed local output: {"ok":true,"state":"success","data":{"masters":[]}}',
      constraints: ['Keep the answer concrete and minimal.'],
    },
    ...overrides,
  };
}

test('provider runtime accepts a valid master_request for the official debug master and returns a completed structured response', async () => {
  const sessionEngine = createA2ASessionEngine({
    now: () => 1_776_100_000_000,
    createSessionId: () => 'provider-session-1',
    createTaskRunId: () => 'provider-run-1',
  });

  const result = await handleMasterProviderRequest({
    rawRequest: createRequest(),
    providerIdentity: {
      globalMetaId: 'idq1provider',
      name: 'Provider Bot',
    },
    publishedMasters: [createPublishedMaster()],
    sessionEngine,
  });

  assert.equal(result.ok, true);
  assert.equal(result.received.event, 'provider_received');
  assert.equal(result.applied.event, 'provider_completed');
  assert.equal(result.response.status, 'completed');
  assert.equal(result.response.requestId, 'request-provider-runtime-1');
  assert.equal(result.response.responder.masterServicePinId, 'master-pin-1');
  assert.deepEqual(result.response.structuredData.findings, [
    'A successful empty list is usually a discovery/configuration state, not a runtime crash.',
    'The first checks should be network sources, provider online status, and host-mode visibility for the published master-service.',
    'If the target provider daemon URL is already known, direct Ask Master delivery can still work even before local discovery is populated.',
  ]);
  assert.deepEqual(result.traceSummary, {
    flow: 'master',
    servicePinId: 'master-pin-1',
    masterKind: 'debug',
    requestId: 'request-provider-runtime-1',
    requestStatus: 'completed',
  });

  const parsed = parseMasterResponse(result.responseJson);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.status, 'completed');
});

test('provider runtime maps need_more_context runner results into a structured master_response and clarification event', async () => {
  const result = await handleMasterProviderRequest({
    rawRequest: createRequest(),
    providerIdentity: {
      globalMetaId: 'idq1provider',
      name: 'Provider Bot',
    },
    publishedMasters: [createPublishedMaster()],
    resolveRunner: () => async () => ({
      state: 'need_more_context',
      summary: 'More concrete failure output is required.',
      missing: ['The exact failing command output.'],
      followUpQuestion: 'Can you share the failing command output?',
      risks: ['Without the failing output, the diagnosis would be low-confidence.'],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied.event, 'clarification_needed');
  assert.equal(result.response.status, 'need_more_context');
  assert.deepEqual(result.response.structuredData.missing, ['The exact failing command output.']);
  assert.equal(result.response.followUpQuestion, 'Can you share the failing command output?');

  const parsed = parseMasterResponse(result.responseJson);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.status, 'need_more_context');
});

test('provider runtime fails loudly when the request targets a different provider identity', async () => {
  const result = await handleMasterProviderRequest({
    rawRequest: createRequest({
      target: {
        masterServicePinId: 'master-pin-1',
        providerGlobalMetaId: 'idq1someoneelse',
        masterKind: 'debug',
      },
    }),
    providerIdentity: {
      globalMetaId: 'idq1provider',
      name: 'Provider Bot',
    },
    publishedMasters: [createPublishedMaster()],
  });

  assert.deepEqual(result, {
    ok: false,
    code: 'provider_identity_mismatch',
    message: 'master_request.target.providerGlobalMetaId does not match the local provider identity.',
  });
});

test('provider runtime normalizes malformed custom runner results into a failed master_response', async () => {
  const result = await handleMasterProviderRequest({
    rawRequest: createRequest(),
    providerIdentity: {
      globalMetaId: 'idq1provider',
      name: 'Provider Bot',
    },
    publishedMasters: [createPublishedMaster()],
    resolveRunner: () => async () => ({
      state: 'completed',
      summary: 'broken runner result',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied.event, 'provider_failed');
  assert.equal(result.response.status, 'failed');
  assert.equal(result.response.errorCode, 'invalid_master_runner_result');
  assert.match(result.response.summary, /invalid master runner result/i);
});

test('provider runtime treats whitespace-only required runner strings as invalid_runner_result', async () => {
  const result = await handleMasterProviderRequest({
    rawRequest: createRequest(),
    providerIdentity: {
      globalMetaId: 'idq1provider',
      name: 'Provider Bot',
    },
    publishedMasters: [createPublishedMaster()],
    resolveRunner: () => async () => ({
      state: 'completed',
      summary: '   ',
      findings: [],
      recommendations: [],
      risks: [],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.response.status, 'failed');
  assert.equal(result.response.errorCode, 'invalid_master_runner_result');
});
