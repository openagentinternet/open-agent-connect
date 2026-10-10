import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  bindGrokBotAssistant,
  configureGrokBotWebhook,
  doctorGrokBotBindings,
  getGrokBotBindingStatus,
  grokBotBindingPathForProfile,
  normalizeGrokBotBinding,
  readGrokBotBinding,
  recordGrokBotWebhookDelivery,
  unbindGrokBotAssistant,
  writeGrokBotBinding,
} = require('../../dist/core/host/grokBotBinding.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

async function createSystemHomeWithProfiles(prefix, slugs) {
  const systemHome = await mkdtempTempRoot(prefix);
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  await fs.mkdir(managerRoot, { recursive: true });
  const now = Date.now();
  const profiles = [];
  for (const slug of slugs) {
    const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
    await fs.mkdir(homeDir, { recursive: true });
    profiles.push({
      name: slug,
      slug,
      aliases: [slug],
      homeDir,
      globalMetaId: `metaid-${slug}`,
      mvcAddress: '',
      createdAt: now,
      updatedAt: now,
    });
  }
  await fs.writeFile(
    path.join(managerRoot, 'identity-profiles.json'),
    `${JSON.stringify({ profiles }, null, 2)}\n`,
    'utf8',
  );
  return { systemHome, profiles };
}

test('normalizeGrokBotBinding tolerates garbage and preserves a valid record', () => {
  const empty = normalizeGrokBotBinding('not-json');
  assert.equal(empty.host, 'grok-bot');
  assert.equal(empty.assistantId, null);
  assert.equal(empty.webhook, null);

  const normalized = normalizeGrokBotBinding({
    assistantId: '  asst-1 ',
    assistantName: ' Nori ',
    boundAt: '2026-10-10T01:02:03.000Z',
    webhook: { url: ' https://example.com/hook ', secret: ' s3 ', configuredAt: '2026-10-10T01:02:03.000Z' },
    lastWebhookDelivery: { at: '2026-10-10T02:00:00.000Z', status: 'failed', kind: 'llm-task', error: ' 500 ' },
  });
  assert.equal(normalized.assistantId, 'asst-1');
  assert.equal(normalized.assistantName, 'Nori');
  assert.equal(normalized.webhook.url, 'https://example.com/hook');
  assert.equal(normalized.webhook.secret, 's3');
  assert.equal(normalized.lastWebhookDelivery.status, 'failed');
  assert.equal(normalized.lastWebhookDelivery.kind, 'llm-task');
  assert.equal(normalized.lastWebhookDelivery.error, '500');

  // Invalid timestamps and statuses fall back to null instead of crashing.
  const broken = normalizeGrokBotBinding({ boundAt: 'not-a-date', lastWebhookDelivery: { at: 'x', status: 'weird' } });
  assert.equal(broken.boundAt, null);
  assert.equal(broken.lastWebhookDelivery, null);
});

test('read/write roundtrip and empty-write deletes the file', async () => {
  const { profiles } = await createSystemHomeWithProfiles('grok-binding-rw-', ['nori']);
  const filePath = grokBotBindingPathForProfile(profiles[0].homeDir);
  assert.equal((await readGrokBotBinding(filePath)).assistantId, null);

  await writeGrokBotBinding(filePath, {
    ...normalizeGrokBotBinding(null),
    assistantId: 'asst-1',
    assistantName: 'Nori',
    boundAt: '2026-10-10T01:02:03.000Z',
  });
  const readBack = await readGrokBotBinding(filePath);
  assert.equal(readBack.assistantId, 'asst-1');
  assert.equal(readBack.assistantName, 'Nori');

  await writeGrokBotBinding(filePath, normalizeGrokBotBinding(null));
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
});

test('bind creates, stays unchanged on repeat, and keeps identity across rename', async () => {
  const { systemHome } = await createSystemHomeWithProfiles('grok-binding-bind-', ['nori']);

  const created = await bindGrokBotAssistant({ systemHomeDir: systemHome, from: 'nori', assistantId: 'asst-1', assistantName: 'Nori' });
  assert.equal(created.action, 'created');
  assert.equal(created.bound, true);
  assert.equal(created.binding.assistantId, 'asst-1');
  assert.match(created.hint, /Webhook not configured/);
  assert.match(created.hint, /host binding webhook --from nori/);
  const boundAt = created.binding.boundAt;
  assert.ok(boundAt);

  const repeated = await bindGrokBotAssistant({ systemHomeDir: systemHome, from: 'nori', assistantId: 'asst-1', assistantName: 'Nori' });
  assert.equal(repeated.action, 'unchanged');

  // Rename: same assistant id, new display name — no new identity, boundAt kept.
  const renamed = await bindGrokBotAssistant({ systemHomeDir: systemHome, from: 'nori', assistantId: 'asst-1', assistantName: 'Nori 2' });
  assert.equal(renamed.action, 'updated');
  assert.equal(renamed.binding.assistantName, 'Nori 2');
  assert.equal(renamed.binding.boundAt, boundAt);
});

test('bind refuses to share one assistant id across two profiles without --force', async () => {
  const { systemHome } = await createSystemHomeWithProfiles('grok-binding-conflict-', ['nori', 'sunnybot']);
  await bindGrokBotAssistant({ systemHomeDir: systemHome, from: 'nori', assistantId: 'asst-1', assistantName: 'Nori' });

  await assert.rejects(
    bindGrokBotAssistant({ systemHomeDir: systemHome, from: 'sunnybot', assistantId: 'asst-1', assistantName: 'Sunny' }),
    (error) => {
      assert.equal(error.code, 'grok_bot_binding_conflict');
      assert.equal(error.data.ownerSlug, 'nori');
      return true;
    },
  );

  const moved = await bindGrokBotAssistant({ systemHomeDir: systemHome, from: 'sunnybot', assistantId: 'asst-1', assistantName: 'Sunny', force: true });
  assert.equal(moved.action, 'created');
  assert.equal(moved.profile.slug, 'sunnybot');
});

test('webhook requires https, roundtrips, and clears with its delivery ledger', async () => {
  const { systemHome, profiles } = await createSystemHomeWithProfiles('grok-binding-webhook-', ['nori']);
  await bindGrokBotAssistant({ systemHomeDir: systemHome, from: 'nori', assistantId: 'asst-1', assistantName: 'Nori' });

  await assert.rejects(
    configureGrokBotWebhook({ systemHomeDir: systemHome, from: 'nori', url: 'http://insecure.example.com/hook' }),
    (error) => {
      assert.equal(error.code, 'invalid_argument');
      assert.match(error.message, /https/);
      return true;
    },
  );
  await assert.rejects(
    configureGrokBotWebhook({ systemHomeDir: systemHome, from: 'nori', url: 'not a url' }),
    (error) => error.code === 'invalid_argument',
  );

  const configured = await configureGrokBotWebhook({
    systemHomeDir: systemHome,
    from: 'nori',
    url: 'https://grok.example.com/routine/abc',
    secret: 'bearer-token',
  });
  assert.equal(configured.binding.webhook.url, 'https://grok.example.com/routine/abc');
  assert.equal(configured.binding.webhook.secretConfigured, true);
  assert.equal(configured.binding.webhook.secret, undefined);
  assert.equal(configured.hint, null);

  const filePath = grokBotBindingPathForProfile(profiles[0].homeDir);
  await recordGrokBotWebhookDelivery(filePath, {
    at: new Date().toISOString(),
    status: 'failed',
    kind: 'private-chat',
    error: 'HTTP 502',
  });
  const withLedger = await readGrokBotBinding(filePath);
  assert.equal(withLedger.lastWebhookDelivery.status, 'failed');
  assert.equal(withLedger.lastWebhookDelivery.error, 'HTTP 502');
  const failedStatus = await getGrokBotBindingStatus({ systemHomeDir: systemHome, from: 'nori' });
  assert.match(failedStatus.hint, /Last webhook delivery failed \(HTTP 502\)/);

  const cleared = await configureGrokBotWebhook({ systemHomeDir: systemHome, from: 'nori', clear: true });
  assert.equal(cleared.binding.webhook, null);
  assert.equal(cleared.binding.lastWebhookDelivery, null);
  // Clearing the webhook must not drop the assistant binding itself.
  assert.equal(cleared.binding.assistantId, 'asst-1');
});

test('unbind removes the record; doctor reports bound/unbound and webhook states', async () => {
  const { systemHome } = await createSystemHomeWithProfiles('grok-binding-doctor-', ['nori', 'sunnybot', 'eric']);
  await bindGrokBotAssistant({ systemHomeDir: systemHome, from: 'nori', assistantId: 'asst-1', assistantName: 'Nori' });
  await bindGrokBotAssistant({ systemHomeDir: systemHome, from: 'sunnybot', assistantId: 'asst-2', assistantName: 'SunnyBot' });
  await configureGrokBotWebhook({ systemHomeDir: systemHome, from: 'sunnybot', url: 'https://grok.example.com/routine/def' });

  const doctor = await doctorGrokBotBindings({ systemHomeDir: systemHome });
  assert.equal(doctor.host, 'grok-bot');
  assert.equal(doctor.entries.length, 3);
  const bySlug = Object.fromEntries(doctor.entries.map((entry) => [entry.slug, entry]));

  assert.equal(bySlug.nori.bound, true);
  assert.equal(bySlug.nori.webhookState, 'not_configured');
  assert.ok(bySlug.nori.issues.some((issue) => issue.includes('webhook is not configured')));

  assert.equal(bySlug.sunnybot.bound, true);
  assert.equal(bySlug.sunnybot.webhookConfigured, true);
  assert.equal(bySlug.sunnybot.webhookState, 'pending');
  assert.equal(bySlug.sunnybot.globalMetaId, 'metaid-sunnybot');

  assert.equal(bySlug.eric.bound, false);
  assert.deepEqual(bySlug.eric.issues, []);

  // A successful delivery flips the webhook state to ok.
  const sunny = doctor.entries.find((entry) => entry.slug === 'sunnybot');
  const sunnyHome = path.join(systemHome, '.metabot', 'profiles', 'sunnybot');
  await recordGrokBotWebhookDelivery(resolveMetabotPaths(sunnyHome).grokBotBindingPath, {
    at: new Date().toISOString(),
    status: 'ok',
    kind: 'private-chat',
    error: null,
  });
  const after = await doctorGrokBotBindings({ systemHomeDir: systemHome });
  assert.equal(after.entries.find((entry) => entry.slug === sunny.slug).webhookState, 'ok');

  const unbound = await unbindGrokBotAssistant({ systemHomeDir: systemHome, from: 'nori' });
  assert.equal(unbound.removed, true);
  assert.equal(unbound.bound, false);
  const status = await getGrokBotBindingStatus({ systemHomeDir: systemHome, from: 'nori' });
  assert.equal(status.binding.assistantId, null);
});
