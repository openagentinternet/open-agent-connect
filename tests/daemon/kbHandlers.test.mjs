import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createKbDaemonHandlers } = require('../../dist/daemon/kbHandlers.js');

// #12: every KB verb must single-source the owner slug from resolveBot
// (bot.slug) — never from basename(profileRoot), which disagrees with the
// study verbs when no Twin exists and no --from was passed.
test('kb handlers scope ownership by bot.slug, matching the study verbs', async () => {
  const systemHome = mkdtempTempRootSync('metabot-kb-handlers-');
  // The profile dir basename deliberately differs from the slug: with the
  // old basename(profileRoot) derivation these verbs would have used
  // "<random temp name>" as the owner slug while the study verbs used
  // "twin-bot".
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'dir-name-mismatch');
  mkdirSync(homeDir, { recursive: true });
  const handlers = createKbDaemonHandlers({
    resolveBot: async () => ({ slug: 'twin-bot', name: 'Twin', homeDir }),
  });

  const created = await handlers.create({ name: 'Parity', description: 'owned by the slug' });
  assert.equal(created.ok, true);
  assert.equal(created.data.knowledgeBase.metabotSlug, 'twin-bot');

  const kbId = created.data.knowledgeBase.id;
  const listed = await handlers.list({});
  assert.ok(listed.data.knowledgeBases.some((row) => row.id === kbId && row.metabotSlug === 'twin-bot'));

  const saved = await handlers.addDocument({ id: kbId, title: 'Doc', content: '塔罗牌占卜内容。' });
  assert.equal(saved.ok, true);

  const learned = await handlers.learn({ id: kbId });
  assert.equal(learned.ok, true);
  assert.equal(learned.data.knowledgeBase.docCount, 1);

  const queried = await handlers.query({ text: '塔罗牌 占卜', id: kbId });
  assert.equal(queried.ok, true);
  assert.equal(queried.data.results.length, 1);

  const enqueued = await handlers.studyEnqueue({ topic: 'MetaID 协议' });
  assert.equal(enqueued.data.job.metabotSlug, 'twin-bot', 'study verbs already used bot.slug; both agree now');

  const updated = await handlers.update({ id: kbId, description: 'updated' });
  assert.equal(updated.ok, true);

  const removed = await handlers.remove({ id: kbId });
  assert.equal(removed.ok, true);
  assert.equal(removed.data.removed, true);
});
