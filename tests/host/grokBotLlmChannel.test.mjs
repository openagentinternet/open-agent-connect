import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createGrokBotWebhookCompletion } = require('../../dist/core/host/grokBotLlmChannel.js');
const {
  grokBotBindingPathForProfile,
  normalizeGrokBotBinding,
  readGrokBotBinding,
  writeGrokBotBinding,
} = require('../../dist/core/host/grokBotBinding.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

async function createProfileHome(prefix, slug = 'nori') {
  const systemHome = await mkdtempTempRoot(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  await fs.mkdir(homeDir, { recursive: true });
  return { systemHome, homeDir };
}

async function bindWithWebhook(homeDir) {
  await writeGrokBotBinding(grokBotBindingPathForProfile(homeDir), {
    ...normalizeGrokBotBinding(null),
    assistantId: 'asst-1',
    assistantName: 'Nori',
    boundAt: '2026-10-10T01:02:03.000Z',
    webhook: { url: 'https://grok.example.com/routine/abc', secret: 'tok-1', configuredAt: '2026-10-10T01:02:03.000Z' },
  });
}

const REQUEST = { botSlug: 'nori', system: 'system prompt', user: 'deep-read this pin' };

test('returns null without a webhook and never posts', async () => {
  const { homeDir } = await createProfileHome('grok-llm-unconfigured-');
  let calls = 0;
  const complete = createGrokBotWebhookCompletion({
    homeDir,
    fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
  });
  assert.equal(await complete(REQUEST), null);
  assert.equal(calls, 0);
});

test('posts an llm-task envelope and resolves the response file output', async () => {
  const { homeDir } = await createProfileHome('grok-llm-ok-');
  await bindWithWebhook(homeDir);

  const seen = [];
  const complete = createGrokBotWebhookCompletion({
    homeDir,
    createTaskId: () => 'task-1',
    pollIntervalMs: 5,
    timeoutMs: 5_000,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      const body = JSON.parse(init.body);
      await fs.mkdir(path.dirname(body.responsePath), { recursive: true });
      await fs.writeFile(body.responsePath, JSON.stringify({ taskId: body.taskId, status: 'ok', output: 'deep-read summary' }), 'utf8');
      return new Response('{}', { status: 200 });
    },
  });

  const output = await complete(REQUEST);
  assert.equal(output, 'deep-read summary');
  assert.equal(seen.length, 1);
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.type, 'llm-task');
  assert.equal(body.host, 'grok-bot');
  assert.equal(body.slug, 'nori');
  assert.equal(body.taskId, 'task-1');
  assert.equal(body.prompt, 'deep-read this pin');
  assert.equal(body.system, 'system prompt');
  assert.match(body.responsePath, /grok-bot-llm-tasks\/task-1\.response\.json$/);
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok-1');

  // The ledger records the llm-task delivery and the task files are cleaned up.
  const binding = await readGrokBotBinding(grokBotBindingPathForProfile(homeDir));
  assert.equal(binding.lastWebhookDelivery.kind, 'llm-task');
  assert.equal(binding.lastWebhookDelivery.status, 'ok');
  const leftovers = await fs.readdir(resolveMetabotPaths(homeDir).grokBotLlmTasksRoot).catch(() => []);
  assert.deepEqual(leftovers, []);
});

test('a failed task response falls through as null', async () => {
  const { homeDir } = await createProfileHome('grok-llm-failed-response-');
  await bindWithWebhook(homeDir);
  const warnings = [];
  const complete = createGrokBotWebhookCompletion({
    homeDir,
    createTaskId: () => 'task-2',
    pollIntervalMs: 5,
    timeoutMs: 5_000,
    logWarning: (_scope, message) => warnings.push(message),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      await fs.mkdir(path.dirname(body.responsePath), { recursive: true });
      await fs.writeFile(body.responsePath, JSON.stringify({ taskId: body.taskId, status: 'failed', error: 'assistant refused' }), 'utf8');
      return new Response('{}', { status: 200 });
    },
  });
  assert.equal(await complete(REQUEST), null);
  assert.ok(warnings.some((message) => message.includes('assistant refused')));
});

test('a failed webhook POST is recorded once and falls through as null', async () => {
  const { homeDir } = await createProfileHome('grok-llm-post-failed-');
  await bindWithWebhook(homeDir);
  let calls = 0;
  const complete = createGrokBotWebhookCompletion({
    homeDir,
    createTaskId: () => 'task-3',
    pollIntervalMs: 5,
    fetchImpl: async () => { calls += 1; return new Response('down', { status: 503 }); },
  });
  assert.equal(await complete(REQUEST), null);
  assert.equal(calls, 1);
  const binding = await readGrokBotBinding(grokBotBindingPathForProfile(homeDir));
  assert.equal(binding.lastWebhookDelivery.status, 'failed');
  assert.equal(binding.lastWebhookDelivery.error, 'HTTP 503');
});

test('no response file before the deadline resolves null and cleans up', async () => {
  const { homeDir } = await createProfileHome('grok-llm-timeout-');
  await bindWithWebhook(homeDir);
  const complete = createGrokBotWebhookCompletion({
    homeDir,
    createTaskId: () => 'task-4',
    pollIntervalMs: 5,
    timeoutMs: 60,
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });
  assert.equal(await complete(REQUEST), null);
  const leftovers = await fs.readdir(resolveMetabotPaths(homeDir).grokBotLlmTasksRoot).catch(() => []);
  assert.deepEqual(leftovers, []);
});
