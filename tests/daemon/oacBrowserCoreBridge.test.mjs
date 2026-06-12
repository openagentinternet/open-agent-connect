import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { assertBrowserHostConformance } = require('@openagentinternet/agent-browser-test-harness');
const { createOacBrowserCoreHostAdapter } = require('../../dist/daemon/browser/oacBrowserCoreBridge.js');
const { createMetabotProfileFromIdentity, getMetabotProfile } = require('../../dist/core/bot/metabotProfileManager.js');
const { commandFailed } = require('../../dist/core/contracts/commandResult.js');
const { createMetaAppPreviewSessionRegistry } = require('../../dist/core/metaapp/previewSessions.js');

async function createAdapter(input) {
  return createOacBrowserCoreHostAdapter({
    homeDir: input.homeDir,
    systemHomeDir: input.systemHomeDir,
    metaAppPreviewSessions: createMetaAppPreviewSessionRegistry(),
    env: {},
    fetch: input.fetch,
    privateChat: input.privateChat,
    serviceCall: input.serviceCall,
    resolveActorWriteContext: async (rawActor) => {
      const slug = typeof rawActor === 'string' ? rawActor.trim() : '';
      if (!slug) return { homeDir: input.homeDir };
      const profile = await getMetabotProfile(input.systemHomeDir, slug);
      if (!profile) {
        return {
          failure: commandFailed('profile_not_found', `MetaBot profile not found: ${slug}`),
        };
      }
      return { homeDir: profile.homeDir };
    },
  });
}

test('OAC Browser core bridge satisfies the published host conformance harness', async (t) => {
  const profileHome = await createProfileHome('oac-browser-core-bridge-conformance');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Core Bridge Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1corebridge',
    mvcAddress: '18CoreBridge',
  });
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: '', data: fixture }),
    }),
  });

  await assertBrowserHostConformance({
    adapter,
    expectedHostKind: 'oac',
    sampleUri: 'metaid://idq1fixturebot',
  });
});

test('OAC Browser core bridge maps resolved Bot pages to BrowserResourceEnvelope sections and actions', async (t) => {
  const profileHome = await createProfileHome('oac-browser-core-bridge-envelope');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Envelope Bridge Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1envelopebridge',
    mvcAddress: '18EnvelopeBridge',
  });
  const fixture = JSON.parse(await readFile(new URL('../fixtures/browser/botHomepage.v1.json', import.meta.url), 'utf8'));
  fixture.actions = fixture.actions.map((action) => action.id === 'message'
    ? {
        ...action,
        payload: {
          targetGlobalMetaId: 'idq1fixturebot',
        },
      }
    : action);
  fixture.actions.push({
    id: 'service-call-current',
    label: 'Request Fixture Review',
    kind: 'service-call',
    enabled: true,
    serviceId: 'service-current-pin',
    payload: {
      providerGlobalMetaId: 'idq1fixturebot',
    },
  });
  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: '', data: fixture }),
    }),
  });

  const resolved = await adapter.resolveResource({ uri: 'metaid://idq1fixturebot' });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.resourceType, 'bot');
  assert.equal(resolved.data.renderer.type, 'bot-page');
  assert.deepEqual(resolved.data.owner, {
    kind: 'bot',
    globalMetaId: 'idq1fixturebot',
    address: '18FixtureAddress',
    name: 'Fixture Bot',
    label: 'Fixture Bot',
    avatar: 'https://so.example.test/content/avatar-pin',
    verificationState: 'partial',
  });
  assert.equal(resolved.data.sections.some((section) => section.id === 'services'), true);

  const privateChat = resolved.data.actions.find((action) => action.kind === 'private-chat');
  assert.deepEqual(privateChat, {
    id: 'message',
    label: 'Message',
    kind: 'private-chat',
    enabled: true,
    payload: {
      targetGlobalMetaId: 'idq1fixturebot',
    },
  });

  const serviceCall = resolved.data.actions.find((action) => action.kind === 'service-call');
  assert.deepEqual(serviceCall, {
    id: 'service-call-current',
    label: 'Request Fixture Review',
    kind: 'service-call',
    enabled: true,
    serviceId: 'service-current-pin',
    payload: {
      providerGlobalMetaId: 'idq1fixturebot',
    },
  });

  const copyUri = resolved.data.actions.find((action) => action.kind === 'copy');
  assert.deepEqual(copyUri, {
    id: 'copy-uri',
    label: 'Copy URI',
    kind: 'copy',
    enabled: true,
    uri: 'metaid://idq1fixturebot',
  });

  const copyResult = await adapter.runTrustedAction({
    resourceUri: resolved.data.normalizedUri,
    kind: 'copy-uri',
    payload: {
      uri: copyUri.uri,
    },
  });

  assert.equal(copyResult.ok, true);
  assert.deepEqual(copyResult.data, {
    kind: 'copy-uri',
    handled: true,
    data: {
      copiedText: 'metaid://idq1fixturebot',
    },
  });
});

test('OAC Browser core bridge maps non-terminal service-call states to contract successes', async (t) => {
  const profileHome = await createProfileHome('oac-browser-core-bridge-waiting-action');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Waiting Bridge Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1waitingbridge',
    mvcAddress: '18WaitingBridge',
  });
  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir,
    serviceCall: async (input) => {
      const userTask = input.request?.userTask;
      if (userTask === 'Use route fallback') {
        return {
          ok: false,
          state: 'waiting',
          code: 'order_sent_awaiting_provider',
          message: 'Order sent. Waiting for response...',
          pollAfterMs: 3000,
          data: { traceId: 'trace waiting/route' },
        };
      }
      if (userTask === 'Needs manual action') {
        return {
          ok: false,
          state: 'manual_action_required',
          code: 'service_call_needs_confirmation',
          message: 'Confirm the service request in the trace view.',
          localUiUrl: '/ui/trace?traceId=trace-manual',
          data: { traceId: 'trace-manual' },
        };
      }
      return {
        ok: false,
        state: 'waiting',
        code: 'order_sent_awaiting_provider',
        message: 'Order sent. Waiting for response...',
        pollAfterMs: 3000,
        localUiUrl: '/ui/trace?traceId=trace-waiting',
        data: { traceId: 'trace-waiting' },
      };
    },
  });

  const withHref = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1provider',
    kind: 'service-call',
    payload: {
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Use local UI URL',
    },
  });

  assert.equal(withHref.ok, true);
  assert.equal(withHref.state, 'success');
  assert.equal(withHref.data.kind, 'service-call');
  assert.equal(withHref.data.handled, true);
  assert.deepEqual(withHref.data.data, {
    message: 'Order sent. Waiting for response...',
    href: '/ui/trace?traceId=trace-waiting',
  });

  const withRoute = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1provider',
    kind: 'service-call',
    payload: {
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Use route fallback',
    },
  });

  assert.equal(withRoute.ok, true);
  assert.deepEqual(withRoute.data.data, {
    message: 'Order sent. Waiting for response...',
    route: '/ui/trace?traceId=trace%20waiting%2Froute',
  });

  const manualAction = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: 'metaid://idq1provider',
    kind: 'service-call',
    payload: {
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'idq1provider',
      userTask: 'Needs manual action',
    },
  });

  assert.equal(manualAction.ok, true);
  assert.deepEqual(manualAction.data.data, {
    message: 'Confirm the service request in the trace view.',
    href: '/ui/trace?traceId=trace-manual',
  });
});
