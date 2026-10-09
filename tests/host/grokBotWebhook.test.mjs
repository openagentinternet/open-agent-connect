import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { deliverGrokBotPrivateChat } = require('../../dist/core/host/grokBotWebhook.js');
const {
  grokBotBindingPathForProfile,
  readGrokBotBinding,
  writeGrokBotBinding,
  normalizeGrokBotBinding,
} = require('../../dist/core/host/grokBotBinding.js');

async function createProfileHome(prefix, slug = 'nori') {
  const systemHome = await mkdtempTempRoot(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  await fs.mkdir(homeDir, { recursive: true });
  return { systemHome, homeDir };
}

async function writeBinding(homeDir, patch) {
  await writeGrokBotBinding(grokBotBindingPathForProfile(homeDir), {
    ...normalizeGrokBotBinding(null),
    assistantId: 'asst-1',
    assistantName: 'Nori',
    boundAt: '2026-10-10T01:02:03.000Z',
    ...patch,
  });
}

function sampleMessage() {
  return {
    fromGlobalMetaId: 'metaid-sender',
    content: 'hello from the chain',
    contentType: 'text',
    messagePinId: 'pin-123',
    fromChatPublicKey: null,
    timestamp: 1789000000,
    rawMessage: null,
  };
}

test('returns not_configured and sends nothing when no webhook is recorded', async () => {
  const { homeDir } = await createProfileHome('grok-webhook-unconfigured-');
  let calls = 0;
  const outcome = await deliverGrokBotPrivateChat({
    homeDir,
    message: sampleMessage(),
    fetchImpl: async () => { calls += 1; return new Response('ok', { status: 200 }); },
  });
  assert.equal(outcome, 'not_configured');
  assert.equal(calls, 0);
});

test('posts the full message with bearer auth and records an ok delivery', async () => {
  const { homeDir } = await createProfileHome('grok-webhook-ok-');
  await writeBinding(homeDir, {
    webhook: { url: 'https://grok.example.com/routine/abc', secret: 'tok-1', configuredAt: '2026-10-10T01:02:03.000Z' },
  });

  const seen = [];
  const outcome = await deliverGrokBotPrivateChat({
    homeDir,
    message: sampleMessage(),
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response('{}', { status: 200 });
    },
  });

  assert.equal(outcome, 'delivered');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://grok.example.com/routine/abc');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok-1');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.type, 'metaweb-private-chat');
  assert.equal(body.host, 'grok-bot');
  assert.equal(body.slug, 'nori');
  assert.equal(body.fromGlobalMetaId, 'metaid-sender');
  assert.equal(body.text, 'hello from the chain');
  assert.equal(body.messageId, 'pin-123');
  assert.equal(body.receivedAt, new Date(1789000000 * 1000).toISOString());

  const binding = await readGrokBotBinding(grokBotBindingPathForProfile(homeDir));
  assert.equal(binding.lastWebhookDelivery.status, 'ok');
  assert.equal(binding.lastWebhookDelivery.kind, 'private-chat');
  assert.equal(binding.lastWebhookDelivery.error, null);
});

test('non-2xx records one failed delivery and does not retry', async () => {
  const { homeDir } = await createProfileHome('grok-webhook-500-');
  await writeBinding(homeDir, {
    webhook: { url: 'https://grok.example.com/routine/abc', secret: null, configuredAt: '2026-10-10T01:02:03.000Z' },
  });

  let calls = 0;
  const outcome = await deliverGrokBotPrivateChat({
    homeDir,
    message: sampleMessage(),
    fetchImpl: async () => { calls += 1; return new Response('nope', { status: 502 }); },
  });

  assert.equal(outcome, 'failed');
  assert.equal(calls, 1);
  const binding = await readGrokBotBinding(grokBotBindingPathForProfile(homeDir));
  assert.equal(binding.lastWebhookDelivery.status, 'failed');
  assert.equal(binding.lastWebhookDelivery.error, 'HTTP 502');
});

test('network errors are recorded once and reported as failed', async () => {
  const { homeDir } = await createProfileHome('grok-webhook-offline-');
  await writeBinding(homeDir, {
    webhook: { url: 'https://grok.example.com/routine/abc', secret: null, configuredAt: '2026-10-10T01:02:03.000Z' },
  });

  const outcome = await deliverGrokBotPrivateChat({
    homeDir,
    message: sampleMessage(),
    fetchImpl: async () => { throw new Error('socket hang up'); },
  });

  assert.equal(outcome, 'failed');
  const binding = await readGrokBotBinding(grokBotBindingPathForProfile(homeDir));
  assert.equal(binding.lastWebhookDelivery.status, 'failed');
  assert.match(binding.lastWebhookDelivery.error, /socket hang up/);
});
