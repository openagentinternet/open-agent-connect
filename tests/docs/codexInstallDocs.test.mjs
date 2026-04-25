import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

test('README exposes the unified install guide as the primary install entrypoint', async () => {
  const readme = await readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');

  assert.match(readme, /Unified install guide/i);
  assert.match(readme, /docs\/install\/open-agent-connect\.md/);
  assert.match(readme, /Read https:\/\/github\.com\/openagentinternet\/open-agent-connect\/blob\/main\/docs\/install\/open-agent-connect\.md/i);
  assert.match(readme, /End users do not need to clone this repository or build it\s+locally/i);
  assert.match(readme, /Claude Code-compatible install path/i);
});

test('unified install guide defines the remote GitHub install and host bind flow', async () => {
  const guide = await readFile(
    path.join(REPO_ROOT, 'docs', 'install', 'open-agent-connect.md'),
    'utf8'
  );

  assert.match(guide, /does not need to clone this repository/i);
  assert.match(guide, /do not run `npm install`, `npm run build`, or `npm run build:skillpacks`/i);
  assert.match(guide, /OAC_HOST:=claude-code/);
  assert.match(guide, /github\.com\/\$OAC_REPO\/archive\/refs\/heads\/\$OAC_BRANCH\.tar\.gz/);
  assert.match(guide, /skillpacks\/\$OAC_HOST_PACK/);
  assert.match(guide, /\.\/install\.sh/);
  assert.match(guide, /metabot host bind-skills --host codex/);
  assert.match(guide, /metabot host bind-skills --host claude-code/);
  assert.match(guide, /metabot host bind-skills --host openclaw/);
  assert.match(guide, /Claude Code-Compatible Fallback/);
  assert.match(guide, /TARGET_SKILL_ROOT/);
  assert.match(guide, /~\/\.metabot\/skills\//);
  assert.match(guide, /~\/\.metabot\/bin/);
  assert.match(guide, /## Agent Response Contract \(Required\)/);
  assert.match(guide, /## Welcome Message Shape \(Required\)/);
  assert.match(guide, /Open Agent Connect: Connect your local AI agent to an open agent network\./);
  assert.match(guide, /related skills are bound and ready to use/i);
  assert.match(guide, /do not mention internal install constraints/i);
  assert.match(guide, /not running `npm install`/i);
  assert.match(guide, /Do not single out one installed skill/i);
  assert.match(guide, /unless\s+you are diagnosing a specific binding failure/i);
  assert.match(guide, /docs\/acceptance\/open-agent-connect-host-bind-checklist\.md/);
  assert.doesNotMatch(guide, /manual host acceptance checklist/i);
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

test('host docs thinly wrap the unified install guide and use shared-install language', async () => {
  const codex = await readFile(path.join(REPO_ROOT, 'docs', 'hosts', 'codex.md'), 'utf8');
  const claude = await readFile(path.join(REPO_ROOT, 'docs', 'hosts', 'claude-code.md'), 'utf8');
  const openclaw = await readFile(path.join(REPO_ROOT, 'docs', 'hosts', 'openclaw.md'), 'utf8');

  for (const content of [codex, claude, openclaw]) {
    assert.match(content, /docs\/install\/open-agent-connect\.md/);
    assert.match(content, /~\/\.metabot\/skills\//);
    assert.match(content, /bind/i);
    assert.match(content, /metabot skills resolve --skill metabot-network-directory --format markdown/);
  }

  assert.doesNotMatch(codex, /metabot skills resolve --skill metabot-network-directory --host codex --format markdown/);
  assert.doesNotMatch(claude, /metabot skills resolve --skill metabot-network-directory --host claude-code --format markdown/);
  assert.doesNotMatch(openclaw, /metabot skills resolve --skill metabot-network-directory --host openclaw --format markdown/);
});

test('Codex update and dev runbooks point back to the unified install guide', async () => {
  const updateRunbook = await readFile(
    path.join(REPO_ROOT, 'docs', 'hosts', 'codex-agent-update.md'),
    'utf8'
  );
  const devRunbook = await readFile(
    path.join(REPO_ROOT, 'docs', 'hosts', 'codex-dev-test-runbook.md'),
    'utf8'
  );

  for (const content of [updateRunbook, devRunbook]) {
    assert.match(content, /docs\/install\/open-agent-connect\.md/);
  }

  assert.doesNotMatch(updateRunbook, /cd skillpacks\/codex/);
  assert.doesNotMatch(devRunbook, /cd skillpacks\/codex/);
});

test('active Codex host runbooks describe the v2 manager/profile layout and forbid patching runtime files', async () => {
  const installRunbook = await readFile(
    path.join(REPO_ROOT, 'docs', 'hosts', 'codex-agent-install.md'),
    'utf8'
  );
  const identityRunbook = await readFile(
    path.join(REPO_ROOT, 'docs', 'hosts', 'codex-agent-identity-runbook.md'),
    'utf8'
  );
  const devRunbook = await readFile(
    path.join(REPO_ROOT, 'docs', 'hosts', 'codex-dev-test-runbook.md'),
    'utf8'
  );

  for (const content of [installRunbook, identityRunbook, devRunbook]) {
    assert.doesNotMatch(content, /\.metabot\/hot/);
    assert.doesNotMatch(content, /PROFILE_SLUG/);
  }

  assert.match(installRunbook, /~\/\.metabot\/manager\//);
  assert.match(installRunbook, /~\/\.metabot\/profiles\/<slug>\//);
  assert.match(installRunbook, /~\/\.metabot\/skills\//);
  assert.match(identityRunbook, /~\/\.metabot\/manager\//);
  assert.match(identityRunbook, /~\/\.metabot\/profiles\/<slug>\//);
  assert.match(installRunbook, /do not manually edit `\.runtime\/` files/i);
  assert.match(devRunbook, /do not manually edit `\.runtime\/` files/i);
  assert.match(identityRunbook, /metabot identity create --name "\$TARGET_NAME"/);
  assert.match(identityRunbook, /CLI resolves the canonical profile home/i);
  assert.match(identityRunbook, /metabot identity assign --name "\$TARGET_NAME"/);
});
