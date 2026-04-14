import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const BUILD_SCRIPT_URL = pathToFileURL(path.join(REPO_ROOT, 'scripts/build-metabot-skillpacks.mjs')).href;
const execFile = promisify(execFileCallback);

const HOSTS = ['codex', 'claude-code', 'openclaw'];
const EXPECTED_LEGACY_SKILLS = [
  'metabot-chat-privatechat',
  'metabot-post-buzz',
  'metabot-upload-file',
  'metabot-post-skillservice',
  'metabot-omni-reader',
  'metabot-bootstrap',
  'metabot-identity-manage',
  'metabot-network-directory',
  'metabot-network-sources',
  'metabot-call-remote-service',
  'metabot-trace-inspector',
];
const EXPECTED_CLI_PATH = 'metabot';
const EXPECTED_CLI_ALIAS = 'agent-connect';
const EXPECTED_COMPATIBILITY_MANIFEST = 'release/compatibility.json';
const EXPECTED_BUNDLED_COMPATIBILITY_COPY = 'runtime/compatibility.json';
const EXPECTED_CONFIRMATION_CONTRACT_LINE =
  'Before any paid remote call, show the provider, service, price, currency, and wait for explicit confirmation.';
const EXPECTED_TRACE_WATCH_LINE = 'metabot trace watch --trace-id trace-123';
const EXPECTED_TRACE_UI_LINE = 'metabot ui open --page trace --trace-id trace-123';
const EXPECTED_HUB_UI_LINE = 'metabot ui open --page hub';

async function assertFileExists(filePath) {
  const info = await stat(filePath);
  assert.equal(info.isFile(), true, `${filePath} should exist as a file`);
}

test('buildAgentConnectSkillpacks renders the shared Open Agent Connect skills into every host output', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  const result = await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  assert.deepEqual([...result.hosts].sort(), [...HOSTS].sort());

  for (const host of HOSTS) {
    const hostRoot = path.join(outputRoot, host);
    await assertFileExists(path.join(hostRoot, 'README.md'));
    await assertFileExists(path.join(hostRoot, 'install.sh'));

    for (const skillName of EXPECTED_LEGACY_SKILLS) {
      await assertFileExists(path.join(hostRoot, 'skills', skillName, 'SKILL.md'));
    }
  }
});

test('buildAgentConnectSkillpacks embeds one shared CLI path and one shared compatibility manifest across hosts', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  for (const host of HOSTS) {
    const readme = await readFile(path.join(outputRoot, host, 'README.md'), 'utf8');
    assert.match(readme, new RegExp(`\\b${EXPECTED_CLI_PATH}\\b`));
    assert.match(readme, new RegExp(`\\b${EXPECTED_CLI_ALIAS}\\b`));
    assert.match(readme, new RegExp(EXPECTED_COMPATIBILITY_MANIFEST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('buildAgentConnectSkillpacks copies the compatibility manifest into every host runtime bundle', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);
  const expectedManifest = JSON.parse(await readFile(path.join(REPO_ROOT, 'release', 'compatibility.json'), 'utf8'));

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  for (const host of HOSTS) {
    const bundledManifest = JSON.parse(await readFile(
      path.join(outputRoot, host, EXPECTED_BUNDLED_COMPATIBILITY_COPY),
      'utf8'
    ));
    assert.deepEqual(bundledManifest, expectedManifest);
  }
});

test('buildAgentConnectSkillpacks preserves one confirmation contract across all host packs', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  const renderedContracts = await Promise.all(
    HOSTS.map((host) => readFile(
      path.join(outputRoot, host, 'skills', 'metabot-call-remote-service', 'SKILL.md'),
      'utf8'
    ))
  );

  for (const content of renderedContracts) {
    assert.match(content, /## Confirmation Contract/);
    assert.match(content, new RegExp(EXPECTED_CONFIRMATION_CONTRACT_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.equal(new Set(renderedContracts).size, HOSTS.length, 'host packs may differ in metadata, but the confirmation contract text must remain intact in every host output');
});

test('buildAgentConnectSkillpacks publishes the shared remote-call demo transport contract across all host packs', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  for (const host of HOSTS) {
    const content = await readFile(
      path.join(outputRoot, host, 'skills', 'metabot-call-remote-service', 'SKILL.md'),
      'utf8'
    );
    assert.match(content, /services call --request-file/);
    assert.match(content, new RegExp(EXPECTED_TRACE_WATCH_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(content, /remote MetaBot/i);
    assert.match(content, /delegate/i);
    assert.doesNotMatch(content, /caller-to-provider daemon round-trip/i);
  }
});

test('buildAgentConnectSkillpacks renders metabot-network-directory as a stable runtime-resolve shim in every host pack', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  for (const host of HOSTS) {
    const content = await readFile(
      path.join(outputRoot, host, 'skills', 'metabot-network-directory', 'SKILL.md'),
      'utf8'
    );
    assert.match(content, /^name:\s*metabot-network-directory$/m);
    assert.match(content, /^description:\s*Use when an agent or human needs the local yellow-pages view of online MetaBots before deciding which remote MetaBot should receive a delegated task$/m);
    assert.match(
      content,
      new RegExp(`metabot skills resolve --skill metabot-network-directory --host ${host} --format markdown`)
    );
    assert.match(content, /runtime-resolve shim/i);
    assert.match(content, /follow the resolved contract/i);

    assert.doesNotMatch(content, /metabot network services --online/i);
    assert.doesNotMatch(content, /metabot ui open --page hub/i);
    assert.doesNotMatch(content, /providerDaemonBaseUrl/i);
    assert.doesNotMatch(content, /## Expectations/i);
  }
});

test('buildAgentConnectSkillpacks teaches hosts to append a trace inspector link after surfacing the remote raw result', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  for (const host of HOSTS) {
    const content = await readFile(
      path.join(outputRoot, host, 'skills', 'metabot-call-remote-service', 'SKILL.md'),
      'utf8'
    );
    assert.match(content, new RegExp(EXPECTED_TRACE_UI_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(content, /append the local Trace Inspector link/i);
    assert.match(content, /after the remote raw result/i);
  }
});

test('buildAgentConnectSkillpacks teaches when to recommend the local trace inspector across all host packs', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  for (const host of HOSTS) {
    const content = await readFile(
      path.join(outputRoot, host, 'skills', 'metabot-trace-inspector', 'SKILL.md'),
      'utf8'
    );
    assert.match(content, /trace get --trace-id/);
    assert.match(content, new RegExp(EXPECTED_TRACE_WATCH_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(content, /timeout/i);
    assert.match(content, /clarification/i);
    assert.match(content, /manual action/i);
    assert.match(content, /asks for details|user asks for details/i);
    assert.match(content, /remote MetaBot/i);
    assert.doesNotMatch(content, /endpoint/i);
  }
});

test('buildAgentConnectSkillpacks publishes the shared network-source registry skill across all host packs', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  for (const host of HOSTS) {
    const content = await readFile(
      path.join(outputRoot, host, 'skills', 'metabot-network-sources', 'SKILL.md'),
      'utf8'
    );
    assert.match(content, /network sources add/);
    assert.match(content, /network sources list/);
    assert.match(content, /network sources remove/);
  }
});

test('buildAgentConnectSkillpacks publishes the shared identity-manage workflow across all host packs', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  for (const host of HOSTS) {
    const content = await readFile(
      path.join(outputRoot, host, 'skills', 'metabot-identity-manage', 'SKILL.md'),
      'utf8'
    );
    assert.match(content, /^name:\s*metabot-identity-manage$/m);
    assert.match(content, /identity list/);
    assert.match(content, /identity assign --name/);
    assert.match(content, /METABOT_HOME="\$HOME\/\.metabot\/profiles\/\$PROFILE_SLUG"/);
    assert.match(content, /identity_name_taken/);
    assert.match(content, /identity_name_conflict/);
    assert.match(content, /identity who/);
    assert.match(content, /\/info\/avatar/);
    assert.match(content, /image\/png;binary/);
    assert.match(content, /encoding:\s*'base64'|"encoding":\s*"base64"/);
    assert.match(content, /metafile:\/\/\.\.\./);
  }
});

test('buildAgentConnectSkillpacks publishes the shared buzz and file writer skills across all host packs', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  for (const host of HOSTS) {
    const buzzContent = await readFile(
      path.join(outputRoot, host, 'skills', 'metabot-post-buzz', 'SKILL.md'),
      'utf8'
    );
    assert.match(buzzContent, /buzz post/);
    assert.match(buzzContent, /file upload/);

    const fileContent = await readFile(
      path.join(outputRoot, host, 'skills', 'metabot-upload-file', 'SKILL.md'),
      'utf8'
    );
    assert.match(fileContent, /file upload/);
    assert.match(fileContent, /\/file/);
  }
});

test('install.sh copies skills and installs runnable metabot and agent-connect shims from the source tree', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
  const skillDest = await mkdtemp(path.join(os.tmpdir(), 'metabot-skill-dest-'));
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-bin-'));
  const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);

  await buildAgentConnectSkillpacks({
    repoRoot: REPO_ROOT,
    outputRoot,
  });

  const hostRoot = path.join(outputRoot, 'codex');
  await execFile('bash', [path.join(hostRoot, 'install.sh')], {
    cwd: hostRoot,
    env: {
      ...process.env,
      AGENT_CONNECT_SOURCE_ROOT: REPO_ROOT,
      AGENT_CONNECT_SKILL_DEST: skillDest,
      AGENT_CONNECT_BIN_DIR: binDir,
    },
  });

  await assertFileExists(path.join(skillDest, 'metabot-bootstrap', 'SKILL.md'));
  await assertFileExists(path.join(binDir, 'agent-connect'));
  await assertFileExists(path.join(binDir, 'metabot'));

  let commandFailure = null;
  try {
    await execFile(path.join(binDir, 'metabot'), [], {
      env: {
        ...process.env,
      },
    });
  } catch (error) {
    commandFailure = error;
  }

  assert.ok(commandFailure, 'metabot shim should execute the CLI and return the missing-command envelope');
  assert.equal(commandFailure.code, 1);
  assert.deepEqual(JSON.parse(String(commandFailure.stdout).trim()), {
    ok: false,
    state: 'failed',
    code: 'missing_command',
    message: 'No command provided.',
  });
});

test('repository keeps no deprecated skill aliases after migration', async () => {
  const openAgentPrefix = ['open', 'agent'].join('-');
  const openAgentSkillPattern = `${openAgentPrefix}-(chat-privatechat|post-buzz|upload-file|post-skillservice|omni-reader|bootstrap|identity-manage|network-directory|network-sources|call-remote-service|trace-inspector)`;
  try {
    const result = await execFile('rg', ['-n', openAgentSkillPattern, '.'], {
      cwd: REPO_ROOT,
    });
    assert.fail(`found deprecated open-agent skill aliases:\n${result.stdout}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) {
      return;
    }
    throw error;
  }
});
