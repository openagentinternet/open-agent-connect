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

const LOCAL_GLOBAL_META_ID = 'idq1j3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';
const PEER_GLOBAL_META_ID = 'idq1x3yu9vmwxkqdqrrt39qxl8u69vs0esjhwg6l5k';

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

test('OAC Browser core bridge maps resolved Bot pages to BrowserResolveResult actions', async (t) => {
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
    metaid: 'metaid-fixture',
    address: '18FixtureAddress',
    name: 'Fixture Bot',
    avatar: 'https://so.example.test/content/avatar-pin',
    online: true,
    verificationState: 'partial',
  });
  const privateChat = resolved.data.actions.find((action) => action.kind === 'private-chat');
  assert.deepEqual(privateChat, {
    id: 'message',
    label: 'Message',
    kind: 'private-chat',
    enabled: true,
    requiresUsingIdentity: true,
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

test('OAC Browser core bridge preserves non-terminal service-call command states', async (t) => {
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

  assert.equal(withHref.ok, false);
  assert.equal(withHref.state, 'waiting');
  assert.equal(withHref.code, 'order_sent_awaiting_provider');
  assert.match(withHref.message, /^Order sent\. Waiting for response/);
  assert.deepEqual(withHref.action, {
    label: 'Open details',
    href: '/ui/trace?traceId=trace-waiting',
  });
  assert.deepEqual(withHref.data, { traceId: 'trace-waiting' });

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

  assert.equal(withRoute.ok, false);
  assert.equal(withRoute.state, 'waiting');
  assert.equal(withRoute.code, 'order_sent_awaiting_provider');
  assert.match(withRoute.message, /^Order sent\. Waiting for response/);
  assert.deepEqual(withRoute.action, {
    label: 'Open details',
    route: '/ui/trace?traceId=trace%20waiting%2Froute',
  });
  assert.deepEqual(withRoute.data, { traceId: 'trace waiting/route' });

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

  assert.equal(manualAction.ok, false);
  assert.equal(manualAction.state, 'manual_action_required');
  assert.equal(manualAction.code, 'service_call_needs_confirmation');
  assert.match(manualAction.message, /^Confirm the service request/);
  assert.deepEqual(manualAction.action, {
    label: 'Open details',
    href: '/ui/trace?traceId=trace-manual',
  });
  assert.deepEqual(manualAction.data, { traceId: 'trace-manual' });
});

test('OAC Browser core bridge bridges open-conversation trusted actions', async (t) => {
  const profileHome = await createProfileHome('oac-browser-core-bridge-open-conversation');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Conversation Bridge Bot',
    homeDir: profileHome,
    globalMetaId: LOCAL_GLOBAL_META_ID,
    mvcAddress: '18ConversationBridge',
  });
  const adapter = await createAdapter({
    homeDir: profileHome,
    systemHomeDir,
  });

  const result = await adapter.runTrustedAction({
    actorId: active.slug,
    resourceUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
    kind: 'open-conversation',
    payload: {
      conversationUri: `map://simplemsg/conversation?peer=${PEER_GLOBAL_META_ID}`,
      peerGlobalMetaId: PEER_GLOBAL_META_ID,
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    kind: 'open-conversation',
    handled: true,
    data: {
      href: `/ui/conversations?local=${LOCAL_GLOBAL_META_ID}&peer=${PEER_GLOBAL_META_ID}`,
    },
  });
});
