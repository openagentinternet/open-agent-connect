import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  consumePrivateChatTurnQuota,
  MAX_INTERIM_MESSAGE_LENGTH,
  normalizeInterimMessageText,
  privateChatTurnContextPath,
  readPrivateChatTurnContext,
  writePrivateChatTurnContext,
} = require('../../dist/core/chat/privateChatInterimTurn.js');

async function createWorkspace() {
  const base = await mkdtempTempRoot('metabot-interim-turn-test-');
  const workspaceDir = path.join(base, 'chat-work');
  return workspaceDir;
}

test('a turn ticket issues, reads back, and spends its quota atomically', async () => {
  const workspaceDir = await createWorkspace();
  const now = 1_770_000_000_000;
  await writePrivateChatTurnContext({
    workspaceDir,
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'idq1peer0000000000000000000000000000000',
    now,
  });
  const ticketPath = privateChatTurnContextPath(workspaceDir);
  const first = await readPrivateChatTurnContext(ticketPath);
  assert.equal(first.version, 1);
  assert.equal(first.remaining, 3);
  assert.equal(first.peerGlobalMetaId, 'idq1peer0000000000000000000000000000000');

  for (let index = 0; index < 3; index += 1) {
    const result = await consumePrivateChatTurnQuota({ turnFilePath: ticketPath, now: now + 1000 });
    assert.equal(result.ok, true);
    assert.equal(result.context.remaining, 2 - index);
  }
  const exhausted = await consumePrivateChatTurnQuota({ turnFilePath: ticketPath, now: now + 2000 });
  assert.deepEqual(exhausted, { ok: false, error: 'ticket_exhausted' });
});

test('an expired or missing ticket is rejected', async () => {
  const workspaceDir = await createWorkspace();
  const now = 1_770_000_000_000;
  await writePrivateChatTurnContext({
    workspaceDir,
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'idq1peer0000000000000000000000000000000',
    now,
    ttlMs: 60_000,
  });
  const ticketPath = privateChatTurnContextPath(workspaceDir);
  const expired = await consumePrivateChatTurnQuota({ turnFilePath: ticketPath, now: now + 61_000 });
  assert.deepEqual(expired, { ok: false, error: 'ticket_expired' });

  const missing = await consumePrivateChatTurnQuota({
    turnFilePath: path.join(workspaceDir, 'nope.json'),
    now,
  });
  assert.deepEqual(missing, { ok: false, error: 'ticket_not_found' });
});

test('interim text is validated for presence, length, and close markers', async () => {
  assert.deepEqual(
    normalizeInterimMessageText('  Found the file, extracting now.  '),
    { ok: true, text: 'Found the file, extracting now.' },
  );
  assert.equal(normalizeInterimMessageText('   ').ok, false);
  assert.equal(normalizeInterimMessageText('x'.repeat(MAX_INTERIM_MESSAGE_LENGTH + 1)).ok, false);
  assert.equal(normalizeInterimMessageText('that is all for now\nBye').ok, false);
});

test('the ticket file survives in the workspace next to the skill documents', async () => {
  const workspaceDir = await createWorkspace();
  await writePrivateChatTurnContext({
    workspaceDir,
    conversationId: 'pc-self-peer',
    peerGlobalMetaId: 'idq1peer0000000000000000000000000000000',
  });
  const entries = await fs.readdir(workspaceDir);
  assert.ok(entries.includes('.oac-private-chat-turn.json'));
});
