import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  parseMasterRequest,
  parseMasterResponse,
  buildMasterRequestJson,
  buildMasterResponseJson,
} = require('../../dist/core/master/masterMessageSchema.js');

function createValidRequest() {
  return {
    type: 'master_request',
    version: '1.0.0',
    requestId: 'request-master-1',
    traceId: 'trace-master-1',
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
      userTask: 'Fix a failing unit test in the local workspace.',
      question: 'What should I check first to narrow down the root cause?',
    },
    context: {
      workspaceSummary: 'TypeScript monorepo with a failing runtime test.',
      relevantFiles: ['src/foo.ts', 'tests/foo.test.ts', 'src/foo.ts'],
      artifacts: [
        {
          kind: 'text',
          label: 'test-output',
          content: 'AssertionError: expected 200 to equal 500',
        },
      ],
    },
    trigger: {
      mode: 'manual',
      reason: 'The user explicitly requested Ask Master help.',
    },
    desiredOutput: 'structured_advice',
    extensions: {
      ticket: 'BUG-1',
    },
  };
}

function createValidResponse() {
  return {
    type: 'master_response',
    version: '1.0.0',
    requestId: 'request-master-1',
    traceId: 'trace-master-1',
    responder: {
      providerGlobalMetaId: 'idq1provider',
      masterServicePinId: 'master-pin-1',
      masterKind: 'debug',
    },
    status: 'completed',
    summary: 'The failure likely comes from stale state being reused across tests.',
    responseText: 'Reset the singleton cache before each test run.',
    structuredData: {
      diagnosis: [
        'Shared singleton state survives between test cases.',
      ],
      nextSteps: [
        'Clear the singleton cache in beforeEach.',
        'Re-run the isolated failing test.',
      ],
    },
    followUpQuestion: 'Can you share whether the failure only happens in the full suite?',
    errorCode: null,
    extensions: {
      confidence: 'medium',
    },
  };
}

test('parseMasterRequest accepts a valid JSON envelope and normalizes request context', () => {
  const parsed = parseMasterRequest(createValidRequest());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.requestId, 'request-master-1');
  assert.equal(parsed.value.traceId, 'trace-master-1');
  assert.deepEqual(parsed.value.context.relevantFiles, ['src/foo.ts', 'tests/foo.test.ts']);
  assert.equal(parsed.value.trigger.mode, 'manual');
});

test('parseMasterRequest rejects malformed JSON, wrong type, missing requestId, and incompatible version', () => {
  const malformed = parseMasterRequest('{"type":"master_request"');
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, 'invalid_master_message_json');

  const wrongType = parseMasterRequest({
    ...createValidRequest(),
    type: 'master_response',
  });
  assert.equal(wrongType.ok, false);
  assert.equal(wrongType.code, 'invalid_master_message_type');

  const missingRequestId = parseMasterRequest({
    ...createValidRequest(),
    requestId: '   ',
  });
  assert.equal(missingRequestId.ok, false);
  assert.equal(missingRequestId.code, 'invalid_master_request');
  assert.match(missingRequestId.message, /requestId/i);

  const incompatibleVersion = parseMasterRequest({
    ...createValidRequest(),
    version: '9.9.9',
  });
  assert.equal(incompatibleVersion.ok, false);
  assert.equal(incompatibleVersion.code, 'invalid_master_message_version');
});

test('buildMasterRequestJson emits a parseable normalized master_request snapshot', () => {
  const jsonText = buildMasterRequestJson(createValidRequest());
  const reparsed = parseMasterRequest(jsonText);

  assert.equal(reparsed.ok, true);
  assert.equal(reparsed.value.type, 'master_request');
  assert.deepEqual(reparsed.value.context.relevantFiles, ['src/foo.ts', 'tests/foo.test.ts']);
});

test('parseMasterResponse accepts a valid response and preserves extensible structured data', () => {
  const parsed = parseMasterResponse(createValidResponse());

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.status, 'completed');
  assert.equal(parsed.value.responder.masterKind, 'debug');
  assert.deepEqual(parsed.value.structuredData.diagnosis, [
    'Shared singleton state survives between test cases.',
  ]);
});

test('buildMasterResponseJson emits a parseable normalized master_response snapshot', () => {
  const jsonText = buildMasterResponseJson(createValidResponse());
  const reparsed = parseMasterResponse(jsonText);

  assert.equal(reparsed.ok, true);
  assert.equal(reparsed.value.type, 'master_response');
  assert.equal(reparsed.value.followUpQuestion, 'Can you share whether the failure only happens in the full suite?');
});
