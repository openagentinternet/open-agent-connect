import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { validateMasterServicePayload } = require('../../dist/core/master/masterServiceSchema.js');
const { buildPublishedMaster } = require('../../dist/core/master/masterServicePublish.js');
const { summarizePublishedMaster } = require('../../dist/core/master/masterDirectory.js');
const { buildMasterAskPreview } = require('../../dist/core/master/masterPreview.js');

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PROVIDER_FIXTURE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/provider-service.json');
const CALLER_FIXTURE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/caller-request.json');
const MASTER_PROVIDER_FIXTURE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/master-service-debug.json');
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
