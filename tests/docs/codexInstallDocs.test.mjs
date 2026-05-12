import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

test('README exposes one user-facing install prompt and the npm fallback', async () => {
  const readme = await readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');

  assert.match(readme, /## Install/i);
  assert.match(readme, /Recommended Agent Install/i);
  assert.match(readme, /npm i -g open-agent-connect/);
  assert.match(readme, /oac install/);
  assert.match(readme, /docs\/install\/open-agent-connect\.md/);
  assert.match(readme, /Read https:\/\/github\.com\/openagentinternet\/open-agent-connect\/blob\/main\/docs\/install\/open-agent-connect\.md/i);
  assert.match(readme, /docs\/install\/uninstall-open-agent-connect\.md/);
  assert.doesNotMatch(readme, /raw\.githubusercontent\.com\/openagentinternet\/open-agent-connect\/main\/docs\/install\/open-agent-connect\.md/i);
  assert.doesNotMatch(readme, /host roots contain symlinks/i);
  assert.doesNotMatch(readme, /platformRegistry\.ts/);
});

test('unified install guide defines the remote GitHub install and host bind flow', async () => {
  const guide = await readFile(
    path.join(REPO_ROOT, 'docs', 'install', 'open-agent-connect.md'),
    'utf8'
  );

  assert.match(guide, /Read https:\/\/github\.com\/openagentinternet\/open-agent-connect\/blob\/main\/docs\/install\/open-agent-connect\.md/i);
  assert.doesNotMatch(guide, /raw\.githubusercontent\.com\/openagentinternet\/open-agent-connect\/main\/docs\/install\/open-agent-connect\.md/i);
  assert.match(guide, /does not need to clone this repository/i);
  assert.match(guide, /do not run `npm run build` or `npm run build:skillpacks` for end-user installation/i);
  assert.match(guide, /do not run `npm install` from a source checkout for end-user installation/i);
  assert.match(guide, /do use `npm i -g open-agent-connect` for the recommended npm package path/i);
  assert.match(guide, /bare `oac install` binds\s+`~\/\.agents\/skills` and detected platform roots/i);
  assert.match(guide, /OAC_HOST:=claude-code/);
  assert.match(guide, /github\.com\/\$OAC_REPO\/releases\/latest\/download\/oac-\$\{OAC_HOST_PACK\}\.tar\.gz/);
  assert.match(guide, /OAC_TMP_DIR\/\$OAC_HOST_PACK/);
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
  assert.match(guide, /Do not create a Bot automatically/i);
  assert.match(guide, /Please choose a name for your first Bot/i);
  assert.match(guide, /Create a Bot named <your chosen name>/);
  assert.match(guide, /online Bots/i);
  assert.match(guide, /Bot services/i);
  assert.match(guide, /do not auto-create a default identity such as `Alice`/i);
  assert.match(guide, /docs\/acceptance\/open-agent-connect-host-bind-checklist\.md/);
  assert.match(guide, /docs\/install\/uninstall-open-agent-connect\.md/);
  assert.match(guide, /metabot system update/);
  assert.match(guide, /npm i -g open-agent-connect@latest/);
  assert.match(guide, /registry-driven platform binding for all supported platforms/i);
  assert.match(guide, /`--host` is legacy release-pack update mode/i);
  assert.match(guide, /preserve Bot identities, mnemonics, private keys, profile names, and\s+wallet-related local data/i);
  assert.doesNotMatch(guide, /manual host acceptance checklist/i);
  assert.doesNotMatch(guide, /metabot identity create --name "Alice"/);
  assert.doesNotMatch(guide, /first MetaBot/i);
  assert.doesNotMatch(guide, /Create a MetaBot named/i);
});

test('unified install guide documents registry-driven bare install and force host binding', async () => {
  const readme = await readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');
  const guide = await readFile(
    path.join(REPO_ROOT, 'docs', 'install', 'open-agent-connect.md'),
    'utf8'
  );

  assert.match(readme, /npm i -g open-agent-connect && oac install/);
  assert.match(readme, /Supported platforms/i);
  assert.doesNotMatch(readme, /~\/\.metabot\/skills/i);
  assert.doesNotMatch(readme, /host roots contain symlinks/i);
  assert.doesNotMatch(readme, /~\/\.metabot\/skills\/metabot-\*/);
  assert.doesNotMatch(readme, /~\/\.agents\/skills/i);
  assert.doesNotMatch(readme, /platformRegistry\.ts/);

  assert.match(guide, /npm i -g open-agent-connect && oac install/);
  assert.match(guide, /supported platforms/i);
  assert.match(guide, /~\/\.metabot\/skills/i);
  assert.match(guide, /host roots contain symlinks/i);
  assert.match(guide, /~\/\.metabot\/skills\/metabot-\*/);
  assert.match(guide, /~\/\.agents\/skills/i);
  assert.match(guide, /platformRegistry\.ts/);

  assert.match(guide, /bare `oac install` binds\s+`~\/\.agents\/skills` and detected platform roots/i);
  assert.match(guide, /`--host` is only needed when forcing a platform root before that platform home exists/i);
  assert.match(guide, /oac install --host openclaw/);
  assert.match(guide, /advanced force-bind/i);
  assert.match(guide, /runtime discovery and `\/ui\/bot` logos come from `platformRegistry\.ts`/i);

  assert.doesNotMatch(readme, /oac install --host codex/);
  assert.doesNotMatch(readme, /choose the host explicitly/i);
  assert.doesNotMatch(guide, /For unsupported but Claude Code-compatible platforms, set `?OAC_HOST=claude-code`?/);
  assert.doesNotMatch(guide, /For Claude Code-compatible hosts, set OAC_HOST=claude-code/);
  assert.doesNotMatch(guide, /For agent platforms outside `Codex`, `Claude Code`, and `OpenClaw`, first use:\s*```bash\s*OAC_HOST=claude-code/s);
});

test('uninstall guide defines safe, test cleanup, and danger-zone tiers', async () => {
  const guide = await readFile(
    path.join(REPO_ROOT, 'docs', 'install', 'uninstall-open-agent-connect.md'),
    'utf8'
  );

  assert.match(guide, /# Open Agent Connect Uninstall Guide/);
  assert.match(guide, /## Tier 1: Safe Uninstall \(Default\)/);
  assert.match(guide, /## Tier 2: Clean Reinstall \/ Test Cleanup/);
  assert.match(guide, /## Tier 3: Danger Zone Full Erase/);
  assert.match(guide, /Default uninstall must preserve Bot identities, mnemonics, private keys/i);
  assert.match(guide, /A Bot identity\s+mnemonic can\s+control funds/i);
  assert.match(guide, /~\/\.metabot\/profiles\/<slug>\/\.runtime\/identity-secrets\.json/);
  assert.match(guide, /~\/\.metabot\/profiles\/<slug>\/\.runtime\/provider-secrets\.json/);
  assert.match(guide, /DELETE_OPEN_AGENT_CONNECT_IDENTITY_AND_SECRETS/);
  assert.match(guide, /Shared standard root: `\$HOME\/\.agents\/skills`/);
  for (const platform of [
    'Codex',
    'Claude Code',
    'GitHub Copilot CLI',
    'OpenCode',
    'OpenClaw',
    'Hermes',
    'Gemini CLI',
    'Pi',
    'Cursor Agent',
    'Kimi',
    'Kiro CLI',
  ]) {
    assert.match(guide, new RegExp(platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(guide, /The preferred CLI path uses the same platform registry as `oac install`/i);
  assert.match(guide, /For Tier 1 or Tier 2, explicitly state that Bot identities, mnemonics,\s+private keys, profile names, and wallet-related local data were preserved/i);
  assert.doesNotMatch(guide, /\.metabot\/hot/);
});

test('Codex install runbook includes first-run handoff and response contract', async () => {
  const runbook = await readFile(
    path.join(REPO_ROOT, 'docs', 'hosts', 'codex-agent-install.md'),
    'utf8'
  );

  assert.match(runbook, /## First-Run Handoff \(Required\)/);
  assert.match(runbook, /Only run `metabot identity create --name \.\.\.` after the user has supplied/i);
  assert.match(runbook, /Create a Bot named <your chosen name>/);
  assert.match(runbook, /online Bots/i);
  assert.match(runbook, /Bot services/i);
  assert.match(runbook, /metabot ui open --page hub/);
  assert.match(runbook, /do not auto-create a default identity such as `Alice`/i);
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
  assert.match(runbook, /Open Agent Connect: Connect your local AI agent to an open agent network/i);
  assert.match(runbook, /what Open Agent Connect now enables/i);
  assert.match(runbook, /Do not return only raw command output/i);
  assert.match(runbook, /key `metabot doctor` verification fields only when an active identity exists/i);
  assert.doesNotMatch(runbook, /metabot identity create --name "Alice"/);
  assert.doesNotMatch(runbook, /first MetaBot/i);
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
    assert.match(content, /check my Bot identity/i);
    assert.match(content, /show me online Bots/i);
    assert.match(content, /open the Bot Hub/i);
    assert.match(content, /metabot identity create --name "<your chosen Bot name>"/);
    assert.doesNotMatch(content, /metabot identity create --name "Alice"/);
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
  assert.doesNotMatch(updateRunbook, /metabot system update --host codex/);
  assert.doesNotMatch(updateRunbook, /metaid-developers\/Open Agent Connect/);
  assert.match(updateRunbook, /Preferred apply command:\s*```bash\s*metabot system update\s*```/s);
  assert.match(updateRunbook, /no-`--host` npm-first update path/i);
  assert.match(updateRunbook, /openagentinternet\/open-agent-connect/);
  assert.doesNotMatch(devRunbook, /cd skillpacks\/codex/);
  assert.match(updateRunbook, /Open Agent Connect runtime refreshed; your local agent keeps its Bot\/network abilities/i);
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
  assert.match(identityRunbook, /# Codex Agent Bot Identity Runbook/);
  assert.match(identityRunbook, /CLI and storage paths still use `metabot` and `~\/\.metabot`/);
  assert.match(installRunbook, /do not manually edit `\.runtime\/` files/i);
  assert.match(devRunbook, /do not manually edit `\.runtime\/` files/i);
  assert.match(identityRunbook, /metabot identity create --name "\$TARGET_NAME"/);
  assert.match(identityRunbook, /CLI resolves the canonical profile home/i);
  assert.match(identityRunbook, /metabot identity assign --name "\$TARGET_NAME"/);
});
