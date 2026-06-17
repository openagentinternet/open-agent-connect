import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const DOC_PATH = path.join(REPO_ROOT, 'docs/metaid_protocols/06-bot-info.md');

test('Bot /info protocol document covers current public profile fields', async () => {
  const content = await readFile(DOC_PATH, 'utf8');

  for (const protocolPath of [
    '/info/name',
    '/info/chatpubkey',
    '/info/avatar',
    '/info/bio',
    '/info/llm',
    '/info/homepage',
    '/info/persona',
    '/info/chatSkills',
  ]) {
    assert.match(content, new RegExp(protocolPath.replace('/', '\\/'), 'u'));
  }

  assert.match(content, /operation: create/u);
  assert.match(content, /identity bootstrap record/u);
  assert.match(content, /must not change it/u);
  assert.match(content, /Do not write replacement records, empty clears, `modify`, or `revoke`/u);
  assert.match(content, /image\/\*;binary/u);
  assert.match(content, /raw image bytes/u);
  assert.match(content, /allowPrivateChatSkills/u);
  assert.match(content, /allowGroupChatSkills/u);
  assert.match(content, /examples only/u);
  assert.match(content, /actual configuration/u);
  assert.match(content, /include this field as an empty array/u);
});
