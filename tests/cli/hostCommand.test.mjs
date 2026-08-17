import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

function deriveSystemHome(homeDir) {
  const normalizedHomeDir = path.resolve(homeDir);
  const profilesRoot = path.dirname(normalizedHomeDir);
  const metabotRoot = path.dirname(profilesRoot);
  if (path.basename(profilesRoot) === 'profiles' && path.basename(metabotRoot) === '.metabot') {
    return path.dirname(metabotRoot);
  }
  return normalizedHomeDir;
}

async function createProfileHome(prefix, slug = 'test-profile') {
  const systemHome = await mkdtempTempRoot(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
  const managerRoot = path.join(systemHome, '.metabot', 'manager');
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(managerRoot, { recursive: true });
  const now = Date.now();
  await fs.writeFile(
    path.join(managerRoot, 'identity-profiles.json'),
    `${JSON.stringify({
      profiles: [
        {
          name: slug,
          slug,
          aliases: [slug, slug.replace(/-/g, ' ')],
          homeDir,
          globalMetaId: '',
          mvcAddress: '',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(managerRoot, 'active-home.json'),
    `${JSON.stringify({ homeDir, updatedAt: now }, null, 2)}\n`,
    'utf8',
  );
  return { homeDir, systemHome };
}

function createRuntimeEnv(homeDir, overrides = {}) {
  return {
    ...process.env,
    HOME: deriveSystemHome(homeDir),
    METABOT_HOME: homeDir,
    ...overrides,
  };
}

function hostHomeEnvName(host) {
  switch (host) {
    case 'codex':
      return 'CODEX_HOME';
    case 'claude-code':
      return 'CLAUDE_HOME';
    case 'openclaw':
      return 'OPENCLAW_HOME';
    case 'dsh':
      return 'DSH_HOME';
    case 'gemini':
      return '';
    default:
      throw new Error(`Unsupported host for env resolution: ${host}`);
  }
}

function defaultHostHome(systemHome, host) {
  switch (host) {
    case 'codex':
      return path.join(systemHome, '.codex');
    case 'claude-code':
      return path.join(systemHome, '.claude');
    case 'openclaw':
      return path.join(systemHome, '.openclaw');
    case 'dsh':
      return path.join(systemHome, '.dsh');
    case 'gemini':
      return path.join(systemHome, '.gemini');
    default:
      throw new Error(`Unsupported host for default path resolution: ${host}`);
  }
}

function expectedHostSkillRoot(systemHome, host, overrides = {}) {
  const envName = hostHomeEnvName(host);
  const hostHome = envName ? overrides[envName] || defaultHostHome(systemHome, host) : defaultHostHome(systemHome, host);
  return path.join(hostHome, 'skills');
}

async function createSharedSkill(systemHome, skillName, body = `# ${skillName}\n`) {
  const skillRoot = path.join(systemHome, '.metabot', 'skills', skillName);
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, 'SKILL.md'), body, 'utf8');
  return skillRoot;
}

async function writePersona(homeDir, overrides = {}) {
  const content = {
    'ROLE.md': '# Role\nFrontend product engineer',
    'SOUL.md': '# Soul\nPrecise, candid, and design-conscious',
    'GOAL.md': '# Goal\nBuild durable interfaces that feel intentional',
    'BIO.md': '# Bio\nEric specializes in frontend product design and implementation.',
    ...overrides,
  };
  await Promise.all(Object.entries(content).map(([name, body]) => (
    fs.writeFile(path.join(homeDir, name), `${body}\n`, 'utf8')
  )));
}

async function runHostCli(homeDir, args, envOverrides = {}) {
  const stdout = [];
  const exitCode = await runCli(args, {
    env: createRuntimeEnv(homeDir, envOverrides),
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  return {
    exitCode,
    stdout: stdout.join(''),
    payload: stdout.length ? JSON.parse(stdout.join('').trim()) : null,
  };
}

async function assertSymlinkPointsTo(entryPath, targetPath) {
  const stat = await fs.lstat(entryPath);
  assert.equal(stat.isSymbolicLink(), true);
  const resolved = await fs.readlink(entryPath);
  assert.equal(path.resolve(path.dirname(entryPath), resolved), targetPath);
}

for (const host of ['codex', 'claude-code', 'openclaw', 'dsh']) {
  test(`runCli supports \`metabot host bind-skills --host ${host}\``, async (t) => {
    const { homeDir, systemHome } = await createProfileHome(`metabot-cli-host-${host}-`);
    t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

    const sharedSkillRoot = await createSharedSkill(systemHome, 'metabot-help');
    await createSharedSkill(systemHome, 'metabot-network-directory');

    const result = await runHostCli(homeDir, ['host', 'bind-skills', '--host', host]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.data.host, host);
    assert.equal(result.payload.data.hostSkillRoot, expectedHostSkillRoot(systemHome, host));
    assert.equal(result.payload.data.sharedSkillRoot, path.join(systemHome, '.metabot', 'skills'));
    assert.deepEqual(result.payload.data.boundSkills, ['metabot-help', 'metabot-network-directory']);
    assert.deepEqual(result.payload.data.replacedEntries, []);
    assert.deepEqual(result.payload.data.unchangedEntries, []);
    assert.ok(result.payload.data.boundRoots.some((root) => root.platformId === host && root.status === 'bound'));

    await assertSymlinkPointsTo(
      path.join(expectedHostSkillRoot(systemHome, host), 'metabot-help'),
      sharedSkillRoot,
    );
    const catalog = await fs.readdir(expectedHostSkillRoot(systemHome, host));
    assert.ok(catalog.includes('metabot-help'));
    assert.ok(catalog.includes('metabot-network-directory'));
    assert.ok(catalog.every((name) => name.startsWith('metabot-')));
  });
}

test('runCli supports registry-derived `metabot host bind-skills --host gemini`', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-gemini-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const sharedSkillRoot = await createSharedSkill(systemHome, 'metabot-help');
  const result = await runHostCli(homeDir, ['host', 'bind-skills', '--host', 'gemini']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.ok(result.payload.data.boundRoots.some((root) => root.platformId === 'gemini' && root.status === 'bound'));
  await assertSymlinkPointsTo(
    path.join(expectedHostSkillRoot(systemHome, 'gemini'), 'metabot-help'),
    sharedSkillRoot,
  );
});

test('runCli treats whitespace-only host home overrides as empty and falls back to the default host home', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-whitespace-home-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const sourceSharedSkillPath = await createSharedSkill(systemHome, 'metabot-help');

  const result = await runHostCli(
    homeDir,
    ['host', 'bind-skills', '--host', 'codex'],
    { CODEX_HOME: '   ' },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.hostSkillRoot, expectedHostSkillRoot(systemHome, 'codex'));
  await assertSymlinkPointsTo(
    path.join(expectedHostSkillRoot(systemHome, 'codex'), 'metabot-help'),
    sourceSharedSkillPath,
  );
});

test('runCli prints host group help for `metabot host --help`', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-help-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const stdout = [];
  const exitCode = await runCli(['host', '--help'], {
    env: createRuntimeEnv(homeDir),
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = stdout.join('');
  assert.match(output, /^Usage:\s+metabot host <subcommand>/m);
  assert.match(output, /^Commands:/m);
  assert.match(output, /^\s+bind-skills\s+/m);
  assert.match(output, /^\s+persona\s+/m);
  assert.match(output, /project shared MetaBot skills into one host-native skills root/i);
});

test('runCli binds, inspects, refreshes, and unbinds a Codex persona projection', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-persona-', 'eric');
  const codexHome = path.join(systemHome, 'custom-codex-home');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));
  await writePersona(homeDir);
  await fs.mkdir(path.join(codexHome, 'skills', 'local-frontend-skill'), { recursive: true });
  await fs.writeFile(path.join(codexHome, 'skills', 'local-frontend-skill', 'SKILL.md'), '# Local skill\n', 'utf8');

  const bind = await runHostCli(
    homeDir,
    ['host', 'persona', 'bind', '--host', 'codex', '--from', 'eric'],
    { CODEX_HOME: codexHome },
  );
  const agentFilePath = path.join(codexHome, 'agents', 'metabot-eric.toml');
  assert.equal(bind.exitCode, 0);
  assert.equal(bind.payload.data.action, 'created');
  assert.equal(bind.payload.data.state, 'current');
  assert.equal(bind.payload.data.agentFilePath, agentFilePath);
  assert.equal(bind.payload.data.agentName, 'eric');

  const generated = await fs.readFile(agentFilePath, 'utf8');
  assert.match(generated, /^# Generated by Open Agent Connect\. Do not edit\./m);
  assert.match(generated, /^# OAC MetaBot profile: eric$/m);
  assert.match(generated, /^name = "eric"$/m);
  assert.match(generated, /^description = "Eric specializes in frontend product design and implementation\."$/m);
  assert.match(generated, /developer_instructions = ".*## Role\\nFrontend product engineer/);
  assert.match(generated, /Use the host's available skills, tools, MCP servers, sandbox, and approval policy normally/);
  assert.doesNotMatch(generated, /^(model|sandbox|approval_policy|tools|skills|mcp_servers)\s*=/m);
  assert.equal(
    await fs.readFile(path.join(codexHome, 'skills', 'local-frontend-skill', 'SKILL.md'), 'utf8'),
    '# Local skill\n',
  );

  const unchanged = await runHostCli(
    homeDir,
    ['host', 'persona', 'bind', '--host', 'codex', '--from', 'eric'],
    { CODEX_HOME: codexHome },
  );
  assert.equal(unchanged.payload.data.action, 'unchanged');

  await fs.writeFile(path.join(homeDir, 'GOAL.md'), '# Goal\nShip a refreshed goal\n', 'utf8');
  const stale = await runHostCli(
    homeDir,
    ['host', 'persona', 'status', '--host', 'codex', '--from', 'eric'],
    { CODEX_HOME: codexHome },
  );
  assert.equal(stale.payload.data.state, 'stale');

  const refreshed = await runHostCli(
    homeDir,
    ['host', 'persona', 'bind', '--host', 'codex', '--from', 'eric'],
    { CODEX_HOME: codexHome },
  );
  assert.equal(refreshed.payload.data.action, 'updated');
  assert.match(await fs.readFile(agentFilePath, 'utf8'), /Ship a refreshed goal/);

  await Promise.all(['ROLE.md', 'SOUL.md', 'GOAL.md'].map((name) => fs.rm(path.join(homeDir, name))));

  const staleWithoutSources = await runHostCli(
    homeDir,
    ['host', 'persona', 'status', '--host', 'codex', '--from', 'eric'],
    { CODEX_HOME: codexHome },
  );
  assert.equal(staleWithoutSources.payload.data.state, 'stale');

  const unbind = await runHostCli(
    homeDir,
    ['host', 'persona', 'unbind', '--host', 'codex', '--from', 'eric'],
    { CODEX_HOME: codexHome },
  );
  assert.equal(unbind.payload.data.removed, true);
  assert.equal(unbind.payload.data.state, 'unbound');
  await assert.rejects(fs.access(agentFilePath), { code: 'ENOENT' });
  await fs.access(path.join(codexHome, 'skills', 'local-frontend-skill', 'SKILL.md'));
});

test('Codex persona projection uses the active profile and refuses unowned agent files', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-persona-conflict-', 'eric');
  const codexHome = path.join(systemHome, '.codex-test');
  const agentFilePath = path.join(codexHome, 'agents', 'metabot-eric.toml');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));
  await writePersona(homeDir);
  await fs.mkdir(path.dirname(agentFilePath), { recursive: true });
  await fs.writeFile(agentFilePath, 'name = "User owned Eric"\n', 'utf8');

  const status = await runHostCli(
    homeDir,
    ['host', 'persona', 'status', '--host', 'codex'],
    { CODEX_HOME: codexHome },
  );
  assert.equal(status.exitCode, 0);
  assert.equal(status.payload.data.profile.slug, 'eric');
  assert.equal(status.payload.data.state, 'conflict');

  for (const action of ['bind', 'unbind']) {
    const result = await runHostCli(
      homeDir,
      ['host', 'persona', action, '--host', 'codex'],
      { CODEX_HOME: codexHome },
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.payload.code, 'host_persona_conflict');
  }
  assert.equal(await fs.readFile(agentFilePath, 'utf8'), 'name = "User owned Eric"\n');
});

test('Codex persona projection rejects unsupported hosts and missing persona content', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-persona-invalid-', 'eric');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const unsupported = await runHostCli(homeDir, [
    'host', 'persona', 'bind', '--host', 'claude-code', '--from', 'eric',
  ]);
  assert.equal(unsupported.exitCode, 1);
  assert.equal(unsupported.payload.code, 'invalid_argument');
  assert.match(unsupported.payload.message, /Supported values: codex/);

  const missing = await runHostCli(homeDir, [
    'host', 'persona', 'bind', '--host', 'codex', '--from', 'eric',
  ]);
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.payload.code, 'host_persona_source_missing');
});

test('runCli prints machine-readable help for Codex persona binding', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-persona-help-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));
  const stdout = [];
  const exitCode = await runCli(['host', 'persona', 'bind', '--help', '--json'], {
    env: createRuntimeEnv(homeDir),
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['host', 'persona', 'bind']);
  assert.equal(output.usage, 'metabot host persona bind --host codex [--from <bot-slug>]');
  assert.ok(output.successFields.includes('agentFilePath'));
  assert.ok(output.successFields.includes('action'));
});

test('runCli prints machine-readable help for `metabot host bind-skills --help --json`', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-help-json-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const stdout = [];
  const exitCode = await runCli(['host', 'bind-skills', '--help', '--json'], {
    env: createRuntimeEnv(homeDir),
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 0);
  const output = JSON.parse(stdout.join(''));
  assert.deepEqual(output.commandPath, ['host', 'bind-skills']);
  assert.equal(output.command, 'metabot host bind-skills');
  assert.equal(output.usage, 'metabot host bind-skills --host <claude-code|codex|copilot|opencode|openclaw|hermes|gemini|pi|cursor|kimi|kiro|codebuddy|zcode|workbuddy|dsh>');
  assert.ok(output.successFields.includes('hostSkillRoot'));
  assert.ok(output.failureSemantics.includes('Fails with shared_skills_missing when ~/.metabot/skills has no shared metabot-* directories to bind.'));
});

test('runCli rejects unsupported explicit hosts for `metabot host bind-skills`', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-invalid-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const result = await runHostCli(homeDir, ['host', 'bind-skills', '--host', 'shared']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'invalid_argument');
  assert.match(result.payload.message, /Unsupported --host value: shared/);
  assert.match(result.payload.message, /claude-code, codex, copilot/);
});

test('runCli returns shared_skills_missing when no shared metabot skills are installed', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-missing-shared-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  await fs.mkdir(path.join(systemHome, '.metabot', 'skills'), { recursive: true });
  await fs.mkdir(path.join(systemHome, '.metabot', 'skills', 'not-metabot'), { recursive: true });

  const result = await runHostCli(homeDir, ['host', 'bind-skills', '--host', 'codex']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'shared_skills_missing');
  assert.match(result.payload.message, /\.metabot\/skills/);
});

test('runCli returns host_skill_bind_failed with shared root path context when listing shared skills fails', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-shared-root-failed-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const sharedSkillRoot = path.join(systemHome, '.metabot', 'skills');
  await fs.mkdir(path.dirname(sharedSkillRoot), { recursive: true });
  await fs.writeFile(sharedSkillRoot, 'not-a-directory', 'utf8');

  const result = await runHostCli(homeDir, ['host', 'bind-skills', '--host', 'codex']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'host_skill_bind_failed');
  assert.equal(result.payload.data.sharedSkillRoot, sharedSkillRoot);
  assert.equal(result.payload.data.failedPath, sharedSkillRoot);
});

test('runCli returns host_skill_root_unresolved with host and resolved host root path context', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-root-unresolved-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  await createSharedSkill(systemHome, 'metabot-help');
  const blockedCodexHome = path.join(systemHome, 'blocked-codex-home');
  await fs.writeFile(blockedCodexHome, 'not-a-directory', 'utf8');

  const result = await runHostCli(
    homeDir,
    ['host', 'bind-skills', '--host', 'codex'],
    { CODEX_HOME: blockedCodexHome },
  );

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'host_skill_root_unresolved');
  assert.equal(result.payload.data.host, 'codex');
  assert.equal(result.payload.data.hostSkillRoot, path.join(blockedCodexHome, 'skills'));
});

test('runCli returns host_skill_bind_failed with source and destination path context', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-bind-failed-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const sourceSharedSkillPath = await createSharedSkill(systemHome, 'metabot-help');
  const hostSkillRoot = expectedHostSkillRoot(systemHome, 'codex');
  await fs.mkdir(hostSkillRoot, { recursive: true });
  await fs.writeFile(path.join(hostSkillRoot, 'metabot-help'), 'blocking file', 'utf8');

  const result = await runHostCli(homeDir, ['host', 'bind-skills', '--host', 'codex']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'host_skill_bind_failed');
  assert.equal(result.payload.data.sourceSharedSkillPath, sourceSharedSkillPath);
  assert.equal(result.payload.data.destinationHostPath, path.join(hostSkillRoot, 'metabot-help'));
});

test('runCli preflights later blocked destinations so earlier skills are not modified on failure', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-preflight-blocked-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const earlierSkillSourcePath = await createSharedSkill(systemHome, 'metabot-help');
  await createSharedSkill(systemHome, 'metabot-network-directory');
  const hostSkillRoot = expectedHostSkillRoot(systemHome, 'codex');
  await fs.mkdir(hostSkillRoot, { recursive: true });
  await fs.writeFile(path.join(hostSkillRoot, 'metabot-network-directory'), 'blocking file', 'utf8');

  const result = await runHostCli(homeDir, ['host', 'bind-skills', '--host', 'codex']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.code, 'host_skill_bind_failed');
  assert.equal(
    result.payload.data.destinationHostPath,
    path.join(hostSkillRoot, 'metabot-network-directory'),
  );

  const earlierSkillHostPath = path.join(hostSkillRoot, 'metabot-help');
  await assert.rejects(fs.lstat(earlierSkillHostPath), { code: 'ENOENT' });
  assert.equal(
    await fs.readFile(path.join(earlierSkillSourcePath, 'SKILL.md'), 'utf8'),
    '# metabot-help\n',
  );
});

test('runCli returns an idempotent bind-skills success envelope shape', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-idempotent-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const sourceSharedSkillPath = await createSharedSkill(systemHome, 'metabot-help');

  const first = await runHostCli(homeDir, ['host', 'bind-skills', '--host', 'codex']);
  const second = await runHostCli(homeDir, ['host', 'bind-skills', '--host', 'codex']);

  assert.equal(first.exitCode, 0);
  assert.equal(second.exitCode, 0);
  assert.equal(first.payload.data.host, 'codex');
  assert.equal(first.payload.data.hostSkillRoot, expectedHostSkillRoot(systemHome, 'codex'));
  assert.equal(first.payload.data.sharedSkillRoot, path.join(systemHome, '.metabot', 'skills'));
  assert.deepEqual(first.payload.data.boundSkills, ['metabot-help']);
  assert.deepEqual(first.payload.data.replacedEntries, []);
  assert.deepEqual(first.payload.data.unchangedEntries, []);
  assert.ok(first.payload.data.boundRoots.some((root) => root.platformId === 'codex' && root.status === 'bound'));
  assert.equal(second.payload.data.host, 'codex');
  assert.equal(second.payload.data.hostSkillRoot, expectedHostSkillRoot(systemHome, 'codex'));
  assert.equal(second.payload.data.sharedSkillRoot, path.join(systemHome, '.metabot', 'skills'));
  assert.deepEqual(second.payload.data.boundSkills, ['metabot-help']);
  assert.deepEqual(second.payload.data.replacedEntries, []);
  assert.deepEqual(second.payload.data.unchangedEntries, ['metabot-help']);
  assert.ok(second.payload.data.boundRoots.some((root) =>
    root.platformId === 'codex'
      && root.status === 'bound'
      && root.unchangedEntries.includes('metabot-help')
  ));

  await assertSymlinkPointsTo(
    path.join(expectedHostSkillRoot(systemHome, 'codex'), 'metabot-help'),
    sourceSharedSkillPath,
  );
});

test('runCli replaces copied legacy `metabot-*` directories with symlinks', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-legacy-dir-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  const sourceSharedSkillPath = await createSharedSkill(systemHome, 'metabot-help', '# shared version\n');
  const hostSkillRoot = expectedHostSkillRoot(systemHome, 'codex');
  const legacyCopyRoot = path.join(hostSkillRoot, 'metabot-help');
  await fs.mkdir(legacyCopyRoot, { recursive: true });
  await fs.writeFile(path.join(legacyCopyRoot, 'SKILL.md'), '# copied legacy version\n', 'utf8');

  const result = await runHostCli(homeDir, ['host', 'bind-skills', '--host', 'codex']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.deepEqual(result.payload.data.replacedEntries, ['metabot-help']);
  await assertSymlinkPointsTo(legacyCopyRoot, sourceSharedSkillPath);
});

test('runCli preserves unrelated host-native skills while binding shared MetaBot skills', async (t) => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-host-preserve-native-');
  t.after(async () => fs.rm(systemHome, { recursive: true, force: true }));

  await createSharedSkill(systemHome, 'metabot-help');
  const hostSkillRoot = expectedHostSkillRoot(systemHome, 'codex');
  const nativeSkillRoot = path.join(hostSkillRoot, 'native-helper');
  await fs.mkdir(nativeSkillRoot, { recursive: true });
  await fs.writeFile(path.join(nativeSkillRoot, 'SKILL.md'), '# native helper\n', 'utf8');

  const result = await runHostCli(homeDir, ['host', 'bind-skills', '--host', 'codex']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  const nativeStat = await fs.lstat(nativeSkillRoot);
  assert.equal(nativeStat.isDirectory(), true);
  assert.equal(nativeStat.isSymbolicLink(), false);
  const nativeSkillBody = await fs.readFile(path.join(nativeSkillRoot, 'SKILL.md'), 'utf8');
  assert.equal(nativeSkillBody, '# native helper\n');
});
