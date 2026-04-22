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
  assert.match(runbook, /## Agent Response Contract \(Required\)/);
  assert.match(runbook, /what `Open Agent Connect` now enables/i);
  assert.match(runbook, /Do not return only raw command output/i);
});
