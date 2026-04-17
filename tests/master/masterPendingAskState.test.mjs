import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createPendingMasterAskStateStore } = require('../../dist/core/master/masterPendingAskState.js');

test('pending ask store persists and reloads preview snapshots by traceId', async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-pending-master-ask-'));
  t.after(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  const store = createPendingMasterAskStateStore(homeDir);
  await store.put({
    traceId: 'trace-master-1',
    requestId: 'request-master-1',
    createdAt: 1_776_000_000_000,
    updatedAt: 1_776_000_000_000,
    confirmationState: 'awaiting_confirmation',
    requestJson: '{"type":"master_request"}',
    request: {
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
        userTask: 'Investigate a failing test.',
        question: 'What should I inspect first?',
      },
      context: {
        workspaceSummary: 'Open Agent Connect repo.',
        relevantFiles: ['src/foo.ts'],
        artifacts: [],
      },
      trigger: {
        mode: 'manual',
        reason: 'The user explicitly asked for help.',
      },
      desiredOutput: 'structured_help',
      extensions: {
        goal: 'Get actionable debug steps.',
      },
    },
    target: {
      displayName: 'Official Debug Master',
      masterKind: 'debug',
      servicePinId: 'master-pin-1',
      providerGlobalMetaId: 'idq1provider',
      official: true,
      trustedTier: 'official',
      pricingMode: 'free',
      hostModes: ['codex'],
    },
    preview: {
      target: {
        displayName: 'Official Debug Master',
      },
      summary: {
        question: 'What should I inspect first?',
      },
    },
  });

  const record = await store.get('trace-master-1');
  assert.equal(record.traceId, 'trace-master-1');
  assert.equal(record.request.task.question, 'What should I inspect first?');
  assert.equal(record.target.displayName, 'Official Debug Master');
  assert.equal(record.confirmationState, 'awaiting_confirmation');
});
