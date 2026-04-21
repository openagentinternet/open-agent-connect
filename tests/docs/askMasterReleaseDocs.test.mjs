import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

test('README points Ask Master verification at the Ask Master release runbook', async () => {
  const readme = await readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');

  assert.match(readme, /Ask Master release acceptance: \[docs\/acceptance\/ask-master-release-runbook\.md\]/);
  assert.match(readme, /DACT service-call\/rating closure demo: \[docs\/acceptance\/cross-host-demo-runbook\.md\]/);
  assert.match(readme, /2026-04-17-metaweb-ask-master-design\.zh-CN\.md/);
});

test('Ask Master release runbook documents the shipped manual and suggest release contract', async () => {
  const runbook = await readFile(
    path.join(REPO_ROOT, 'docs', 'acceptance', 'ask-master-release-runbook.md'),
    'utf8'
  );

  assert.match(runbook, /manual/i);
  assert.match(runbook, /suggest/i);
  assert.match(runbook, /askMaster\.enabled/);
  assert.match(runbook, /askMaster\.triggerMode/);
  assert.match(runbook, /reject `askMaster\.triggerMode auto`/i);
  assert.match(runbook, /preview\/confirm/i);
  assert.match(runbook, /private chat, `\/protocols\/simplemsg`, or old advisor commands/i);
  assert.match(runbook, /metabot master ask --request-file/);
  assert.match(runbook, /metabot master suggest --request-file/);
  assert.match(runbook, /accept_suggest/);
  assert.match(runbook, /metabot master host-action --request-file/);
  assert.match(runbook, /master-suggest-request\.json/);
  assert.match(runbook, /metabot master trace --id/);
});
