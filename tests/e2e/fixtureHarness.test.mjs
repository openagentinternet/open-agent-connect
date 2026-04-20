import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { validateMasterServicePayload } = require('../../dist/core/master/masterServiceSchema.js');
const { buildPublishedMaster } = require('../../dist/core/master/masterServicePublish.js');
const { summarizePublishedMaster, listMasters } = require('../../dist/core/master/masterDirectory.js');
const { buildMasterAskPreview } = require('../../dist/core/master/masterPreview.js');
const { handleMasterProviderRequest } = require('../../dist/core/master/masterProviderRuntime.js');

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PROVIDER_FIXTURE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/provider-service.json');
const CALLER_FIXTURE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/caller-request.json');
const MASTER_PROVIDER_FIXTURE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/master-service-debug.json');
const MASTER_REVIEW_PROVIDER_FIXTURE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/master-service-review.json');
const MASTER_REQUEST_FIXTURE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/master-ask-request.json');
const CODEX_CLAUDE_URL = pathToFileURL(path.join(REPO_ROOT, 'e2e/run-codex-claude.mjs')).href;
const OPENCLAW_CODEX_URL = pathToFileURL(path.join(REPO_ROOT, 'e2e/run-openclaw-codex.mjs')).href;

test('Codex -> Claude Code fixture harness loads provider identity and preserves the canonical globalMetaId', async () => {
  const { runCodexClaudeFixtureHarness } = await import(CODEX_CLAUDE_URL);
  const result = await runCodexClaudeFixtureHarness({
    providerFixturePath: PROVIDER_FIXTURE_PATH,
    callerFixturePath: CALLER_FIXTURE_PATH,
  });

  assert.equal(result.provider.identity.globalMetaId, 'idq1970463ym8fqmgawe4lylktne97ahhw4kqehkch');
  assert.equal(result.provider.identity.mvcAddress, '15Lofqw6Kpa6P8WnTYXKvmPyw3UZvvQWrB');
});

test('OpenClaw -> Codex fixture harness marks the provider service as discoverable and online', async () => {
  const { runOpenClawCodexFixtureHarness } = await import(OPENCLAW_CODEX_URL);
  const result = await runOpenClawCodexFixtureHarness({
    providerFixturePath: PROVIDER_FIXTURE_PATH,
    callerFixturePath: CALLER_FIXTURE_PATH,
  });

  assert.equal(result.directory.availableServices.length, 1);
  assert.equal(result.directory.availableServices[0].servicePinId, 'service-weather-001');
  assert.equal(result.directory.onlineBots['idq1970463ym8fqmgawe4lylktne97ahhw4kqehkch'], 1_744_444_444);
});

test('fixture harness generates a trace record after the remote call plan succeeds', async () => {
  const { runCodexClaudeFixtureHarness } = await import(CODEX_CLAUDE_URL);
  const result = await runCodexClaudeFixtureHarness({
    providerFixturePath: PROVIDER_FIXTURE_PATH,
    callerFixturePath: CALLER_FIXTURE_PATH,
  });

  assert.equal(result.call.state, 'ready');
  assert.match(result.trace.traceId, /^trace-idq1970463ym8fqm-service-weather--?[a-z0-9]+-[a-z0-9]+$/);
  assert.equal(
    result.trace.artifacts.traceJsonPath.includes(`/traces/${result.trace.traceId}.json`),
    true
  );
});

test('official debug master fixture validates as a publishable master-service payload', async () => {
  const payload = JSON.parse(await readFile(MASTER_PROVIDER_FIXTURE_PATH, 'utf8'));
  const validated = validateMasterServicePayload(payload);

  assert.equal(validated.ok, true);
  assert.equal(validated.value.masterKind, 'debug');
  assert.equal(validated.value.displayName, 'Official Debug Master');
});

test('master ask fixture can build a preview against the official debug master fixture without widening context', async () => {
  const servicePayload = JSON.parse(await readFile(MASTER_PROVIDER_FIXTURE_PATH, 'utf8'));
  const requestFixture = JSON.parse(await readFile(MASTER_REQUEST_FIXTURE_PATH, 'utf8'));
  const published = buildPublishedMaster({
    sourceMasterPinId: 'master-pin-fixture-1',
    currentPinId: 'master-pin-fixture-1',
    creatorMetabotId: 7,
    providerGlobalMetaId: 'idq1fixtureprovider',
    providerAddress: 'mvc-fixture-provider',
    draft: servicePayload,
    payloadJson: JSON.stringify(servicePayload),
    now: 1_776_500_000_000,
  });
  const summary = summarizePublishedMaster(published.record);

  const prepared = buildMasterAskPreview({
    draft: {
      ...requestFixture,
      target: {
        ...requestFixture.target,
        servicePinId: summary.masterPinId,
        providerGlobalMetaId: summary.providerGlobalMetaId,
      },
    },
    resolvedTarget: {
      ...summary,
      online: true,
      providerDaemonBaseUrl: 'http://127.0.0.1:25200',
    },
    caller: {
      globalMetaId: 'idq1fixturecaller',
      name: 'Fixture Caller',
      host: 'codex',
    },
    traceId: 'trace-fixture-master-1',
    requestId: 'master-req-fixture-1',
    confirmationMode: 'always',
  });

  assert.equal(prepared.preview.target.displayName, 'Official Debug Master');
  assert.equal(prepared.preview.request.type, 'master_request');
  assert.equal(prepared.preview.request.target.masterKind, 'debug');
  assert.equal(prepared.preview.context.relevantFiles.includes('src/daemon/defaultHandlers.ts'), true);
});

test('official review master fixture validates and can answer a structured review request through provider runtime', async () => {
  const debugServicePayload = JSON.parse(await readFile(MASTER_PROVIDER_FIXTURE_PATH, 'utf8'));
  const servicePayload = JSON.parse(await readFile(MASTER_REVIEW_PROVIDER_FIXTURE_PATH, 'utf8'));
  const validated = validateMasterServicePayload(servicePayload);

  assert.equal(validated.ok, true);
  assert.equal(validated.value.masterKind, 'review');
  assert.equal(validated.value.displayName, 'Official Review Master');

  const published = buildPublishedMaster({
    sourceMasterPinId: 'master-review-pin-fixture-1',
    currentPinId: 'master-review-pin-fixture-1',
    creatorMetabotId: 9,
    providerGlobalMetaId: 'idq1reviewfixtureprovider',
    providerAddress: 'mvc-review-provider',
    draft: servicePayload,
    payloadJson: JSON.stringify(servicePayload),
    now: 1_776_500_100_000,
  });
  const summary = summarizePublishedMaster(published.record);
  const publishedDebug = buildPublishedMaster({
    sourceMasterPinId: 'master-debug-pin-fixture-1',
    currentPinId: 'master-debug-pin-fixture-1',
    creatorMetabotId: 8,
    providerGlobalMetaId: 'idq1reviewfixtureprovider',
    providerAddress: 'mvc-review-provider',
    draft: debugServicePayload,
    payloadJson: JSON.stringify(debugServicePayload),
    now: 1_776_500_050_000,
  });
  const debugSummary = summarizePublishedMaster(publishedDebug.record);
  const discovered = listMasters({
    entries: [
      {
        ...debugSummary,
        online: true,
      },
      {
        ...summary,
        online: true,
      },
    ],
    host: 'codex',
    official: true,
  });

  assert.deepEqual(
    discovered.map((entry) => `${entry.masterKind}:${entry.displayName}`).sort(),
    [
      'debug:Official Debug Master',
      'review:Official Review Master',
    ]
  );

  const result = await handleMasterProviderRequest({
    rawRequest: {
      type: 'master_request',
      version: '1.0.0',
      requestId: 'request-review-fixture-1',
      traceId: 'trace-review-fixture-1',
      caller: {
        globalMetaId: 'idq1fixturecaller',
        name: 'Fixture Caller',
        host: 'codex',
      },
      target: {
        masterServicePinId: summary.masterPinId,
        providerGlobalMetaId: summary.providerGlobalMetaId,
        masterKind: 'review',
      },
      task: {
        userTask: 'Review the current patch for the highest regression risks.',
        question: 'What are the most important findings and next review actions for this patch?',
      },
      context: {
        workspaceSummary: 'Ask Master provider matrix fixture review request.',
        relevantFiles: [
          'src/daemon/defaultHandlers.ts',
          'src/core/master/masterProviderRuntime.ts',
        ],
        artifacts: [
          {
            kind: 'text',
            label: 'diff_summary',
            content: 'Patch touches provider routing, trusted auto send, and trace export logic.',
            mimeType: 'text/plain',
          },
        ],
      },
      trigger: {
        mode: 'manual',
        reason: 'Caller explicitly requested patch review help.',
      },
      desiredOutput: 'structured_review',
      extensions: {
        goal: 'Return the highest-priority review findings first.',
        diffSummary: 'Patch adds a second official master fixture and extends provider selection coverage.',
      },
    },
    providerIdentity: {
      globalMetaId: 'idq1reviewfixtureprovider',
      name: 'Review Fixture Provider',
    },
    publishedMasters: [published.record],
  });

  assert.equal(result.ok, true);
  assert.equal(result.response.status, 'completed');
  assert.equal(result.response.responder.masterKind, 'review');
  assert.match(result.response.summary, /review/i);
  assert.ok(Array.isArray(result.response.structuredData.findings));
  assert.ok(result.response.structuredData.findings.length > 0);
  assert.ok(Array.isArray(result.response.structuredData.recommendations));
  assert.ok(result.response.structuredData.recommendations.length > 0);
  assert.equal(result.traceSummary.masterKind, 'review');
});
