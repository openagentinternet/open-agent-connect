import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

test('README exposes agent-first Codex install runbook entry', async () => {
  const readme = await readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');

  assert.match(readme, /Agent-first install entry/i);
  assert.match(readme, /docs\/hosts\/codex-agent-install\.md/);
  assert.match(readme, /install, verification, and first-run next steps/i);
});

test('Codex install runbook includes first-run handoff and response contract', async () => {
  const runbook = await readFile(
    path.join(REPO_ROOT, 'docs', 'hosts', 'codex-agent-install.md'),
    'utf8'
  );

  assert.match(runbook, /## First-Run Handoff \(Required\)/);
  assert.match(runbook, /metabot identity create --name "Alice"/);
  assert.match(runbook, /metabot network bots --online --limit 10/);
  assert.match(runbook, /metabot chat private --request-file chat-request\.json/);
  assert.match(runbook, /## Agent Response Contract \(Required\)/);
  assert.match(runbook, /do not ask the user to type raw CLI commands/i);
  assert.match(runbook, /natural-language prompts/i);
  assert.match(runbook, /same language the user is currently using/i);
  assert.match(runbook, /Do not lock prompts to fixed English phrases/i);
  assert.match(runbook, /Prompt wording can vary as long as intent is equivalent/i);
  assert.match(runbook, /if identity already exists, report current name and globalMetaId/i);
  assert.match(runbook, /## Welcome Message Shape \(Required\)/);
  assert.match(runbook, /Do not use one fixed canned paragraph/i);
  assert.match(runbook, /what changed for the user after install/i);
  assert.match(runbook, /what to do next right now/i);
  assert.match(runbook, /what `Open Agent Connect` now enables/i);
  assert.match(runbook, /Do not return only raw command output/i);
});
