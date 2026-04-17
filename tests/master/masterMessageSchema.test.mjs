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

test('parseMasterRequest accepts the documented simplemsg master_request envelope shape', () => {
  const parsed = parseMasterRequest({
    type: 'master_request',
    version: '1.0.0',
    requestId: 'request-master-spec-1',
    traceId: 'trace-master-spec-1',
    callerGlobalMetaId: 'idq1caller',
    target: {
      providerGlobalMetaId: 'idq1provider',
      servicePinId: 'master-pin-1',
      masterKind: 'debug',
    },
    host: {
      mode: 'codex',
      client: 'metabot',
      clientVersion: '0.1.0',
    },
    trigger: {
      mode: 'manual',
      reason: 'user_requested_help',
    },
    task: {
      userTask: '定位当前测试失败的根因',
      question: '为什么这个测试会失败，最短修复路径是什么？',
      goal: '拿到诊断与下一步建议',
    },
    context: {
      workspaceSummary: '当前仓库是 open-agent-connect。',
      errorSummary: '测试在解密阶段失败。',
      diffSummary: '本地有未提交改动。',
      relevantFiles: ['src/core/chat/privateChat.ts'],
      artifacts: [
        {
          kind: 'text',
          label: 'test-output',
          content: 'AssertionError ...',
        },
      ],
    },
    constraints: [
      '不要建议读取 CoT',
    ],
    desiredOutput: {
      mode: 'structured_help',
    },
    sentAt: 1_776_400_000_000,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.caller.globalMetaId, 'idq1caller');
  assert.equal(parsed.value.caller.host, 'codex');
  assert.equal(parsed.value.target.masterServicePinId, 'master-pin-1');
  assert.equal(parsed.value.desiredOutput, 'structured_help');
  assert.equal(parsed.value.extensions.goal, '拿到诊断与下一步建议');
  assert.equal(parsed.value.extensions.errorSummary, '测试在解密阶段失败。');
  assert.deepEqual(parsed.value.extensions.constraints, ['不要建议读取 CoT']);
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

test('parseMasterResponse normalizes need_more_context and legacy needs_clarification statuses', () => {
  const normalized = parseMasterResponse({
    ...createValidResponse(),
    status: 'need_more_context',
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.status, 'need_more_context');

  const legacy = parseMasterResponse({
    ...createValidResponse(),
    status: 'needs_clarification',
  });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.value.status, 'need_more_context');
});

test('parseMasterResponse accepts the documented structured response envelope, including unavailable', () => {
  const completed = parseMasterResponse({
    type: 'master_response',
    version: '1.0.0',
    requestId: 'request-master-spec-1',
    traceId: 'trace-master-spec-1',
    providerGlobalMetaId: 'idq1provider',
    servicePinId: 'master-pin-1',
    masterKind: 'debug',
    status: 'unavailable',
    summary: '当前 Master 暂不可用。',
    findings: ['provider heartbeat 不在线'],
    recommendations: ['稍后重试'],
    risks: ['不要误判为 schema 错误'],
    confidence: 0.25,
    followUpQuestion: '是否要改用其他 Debug Master？',
    respondedAt: 1_776_400_000_321,
  });

  assert.equal(completed.ok, true);
  assert.equal(completed.value.status, 'unavailable');
  assert.equal(completed.value.responder.masterServicePinId, 'master-pin-1');
  assert.deepEqual(completed.value.structuredData.findings, ['provider heartbeat 不在线']);
  assert.deepEqual(completed.value.structuredData.recommendations, ['稍后重试']);
  assert.equal(completed.value.structuredData.confidence, 0.25);
});

test('buildMasterResponseJson emits a parseable normalized master_response snapshot', () => {
  const jsonText = buildMasterResponseJson(createValidResponse());
  const reparsed = parseMasterResponse(jsonText);

  assert.equal(reparsed.ok, true);
  assert.equal(reparsed.value.type, 'master_response');
  assert.equal(reparsed.value.followUpQuestion, 'Can you share whether the failure only happens in the full suite?');
});
