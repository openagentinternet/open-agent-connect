import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readlink, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const BUILD_SCRIPT_URL = pathToFileURL(path.join(REPO_ROOT, 'scripts/build-metabot-skillpacks.mjs')).href;
const execFile = promisify(execFileCallback);

const SHARED_PACK = 'shared';
const HOSTS = ['codex', 'claude-code', 'openclaw'];
const EXPECTED_METABOT_SKILLS = [
  'metabot-ask-master',
  'metabot-identity-manage',
  'metabot-network-manage',
  'metabot-call-remote-service',
  'metabot-chat-privatechat',
  'metabot-omni-reader',
  'metabot-post-buzz',
  'metabot-post-skillservice',
  'metabot-upload-file',
  'metabot-wallet-manage',
];
const REMOVED_SKILLS = [
  'metabot-bootstrap',
  'metabot-network-directory',
  'metabot-network-sources',
  'metabot-trace-inspector',
];
const EXPECTED_CLI_PATH = 'metabot';
const EXPECTED_COMPATIBILITY_MANIFEST = 'release/compatibility.json';
const EXPECTED_BUNDLED_COMPATIBILITY_COPY = 'runtime/compatibility.json';
const EXPECTED_CONFIRMATION_CONTRACT_LINE =
  'Before any paid remote call, show the provider, service, price, currency, and wait for explicit confirmation.';
const EXPECTED_TRACE_WATCH_LINE = 'metabot trace watch --trace-id trace-123';
const EXPECTED_TRACE_GET_LINE = 'metabot trace get --trace-id trace-123';
const EXPECTED_TRACE_UI_LINE = 'metabot ui open --page trace --trace-id trace-123';

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sharedPackRoot(root) {
  return path.join(root, SHARED_PACK);
}

function sharedSkillFile(root, skillName) {
  return path.join(sharedPackRoot(root), 'skills', skillName, 'SKILL.md');
}

function hostWrapperSharedSkillFile(root, host, skillName) {
  return path.join(root, host, 'runtime', 'shared-skills', skillName, 'SKILL.md');
}

function expectedHostSkillRoot(homeDir, host) {
  switch (host) {
    case 'codex':
      return path.join(homeDir, '.codex', 'skills');
    case 'claude-code':
      return path.join(homeDir, '.claude', 'skills');
    case 'openclaw':
      return path.join(homeDir, '.openclaw', 'skills');
    default:
      throw new Error(`Unsupported host: ${host}`);
  }
}

async function assertFileExists(filePath) {
  const info = await stat(filePath);
  assert.equal(info.isFile(), true, `${filePath} should exist as a file`);
}

async function assertFileMissing(filePath) {
  await assert.rejects(
    async () => stat(filePath),
    /ENOENT/,
    `${filePath} should not exist`
  );
}

async function writeRecordingNodeShim(nodePath, logPath) {
  await writeFile(
    nodePath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [ "${1:-}" = "-p" ]; then',
      '  printf "%s\\n" "22"',
      '  exit 0',
      'fi',
      `printf '%s\\n' "$0" > ${JSON.stringify(logPath)}`,
      `printf '%s\\n' "$@" >> ${JSON.stringify(logPath)}`,
      `exec ${JSON.stringify(process.execPath)} "$@"`,
      '',
    ].join('\n'),
    'utf8',
  );
  await chmod(nodePath, 0o755);
}

async function assertRepoFileTracked(repoRelativePath) {
  await execFile('git', ['ls-files', '--error-unmatch', repoRelativePath], {
    cwd: REPO_ROOT,
  });
}

let builtSkillpacksPromise;

async function getBuiltSkillpacks() {
  if (!builtSkillpacksPromise) {
    builtSkillpacksPromise = (async () => {
      const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'metabot-skillpacks-'));
      const { buildAgentConnectSkillpacks } = await import(BUILD_SCRIPT_URL);
      const result = await buildAgentConnectSkillpacks({
        repoRoot: REPO_ROOT,
        outputRoot,
      });
      return { outputRoot, result };
    })();
  }
  return builtSkillpacksPromise;
}

test('buildAgentConnectSkillpacks renders one shared pack plus self-contained host wrapper packs', async () => {
  const { outputRoot, result } = await getBuiltSkillpacks();

  assert.deepEqual([...result.hosts].sort(), [...HOSTS].sort());

  await assertFileExists(path.join(sharedPackRoot(outputRoot), 'README.md'));
  await assertFileExists(path.join(sharedPackRoot(outputRoot), 'install.sh'));
  await assertFileExists(path.join(sharedPackRoot(outputRoot), EXPECTED_BUNDLED_COMPATIBILITY_COPY));

  for (const skillName of EXPECTED_METABOT_SKILLS) {
    await assertFileExists(sharedSkillFile(outputRoot, skillName));
  }

  for (const skillName of REMOVED_SKILLS) {
    await assertFileMissing(path.join(sharedPackRoot(outputRoot), 'skills', skillName, 'SKILL.md'));
  }

  for (const host of HOSTS) {
    const hostRoot = path.join(outputRoot, host);
    await assertFileExists(path.join(hostRoot, 'README.md'));
    await assertFileExists(path.join(hostRoot, 'install.sh'));
    await assertFileExists(path.join(hostRoot, 'runtime', 'shared-install.sh'));
    await assertFileExists(path.join(hostRoot, EXPECTED_BUNDLED_COMPATIBILITY_COPY));

    for (const skillName of EXPECTED_METABOT_SKILLS) {
      await assertFileExists(hostWrapperSharedSkillFile(outputRoot, host, skillName));
    }

    for (const skillName of REMOVED_SKILLS) {
      await assertFileMissing(path.join(hostRoot, 'runtime', 'shared-skills', skillName, 'SKILL.md'));
    }
  }
});

test('buildAgentConnectSkillpacks includes the Ask Master skill with only master command semantics in the shared pack', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  const content = await readFile(sharedSkillFile(outputRoot, 'metabot-ask-master'), 'utf8');
  assert.match(content, /^name:\s*metabot-ask-master$/m);
  assert.match(content, /metabot master list/);
  assert.match(content, /metabot master suggest --request-file/);
  assert.match(content, /metabot master ask --request-file/);
  assert.match(content, /metabot master trace --id/);
  assert.match(content, /manual \/ suggest|manual and suggest/i);
  assert.match(content, /preview first, then explicit confirmation|preview\/confirm\/send path/i);
  assert.match(content, /accepted `suggest` enters the same preview\/confirm\/send path as `manual`/i);
  assert.match(content, /single-machine two-terminal smoke|single machine dual terminal/i);
  assert.match(content, /Do not call `services call` directly/i);
  assert.doesNotMatch(content, /metabot advisor (list|ask|trace)/);
  assert.doesNotMatch(content, /type":\s*"advisor_request"/);
});

test('buildAgentConnectSkillpacks renders shared skills without host-specific adapter sections or host override flags', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  const askMaster = await readFile(sharedSkillFile(outputRoot, 'metabot-ask-master'), 'utf8');
  assert.doesNotMatch(askMaster, /## Host Adapter/);
  assert.doesNotMatch(askMaster, /Generated for (Codex|Claude Code|OpenClaw)/);
  assert.doesNotMatch(askMaster, /Default skill root:/);
  assert.doesNotMatch(askMaster, /Host pack id:/);
  assert.doesNotMatch(askMaster, /--host codex/);
  assert.doesNotMatch(askMaster, /--host claude-code/);
  assert.doesNotMatch(askMaster, /--host openclaw/);
});

test('repository tracked shared and host-wrapper skillpack artifacts stay in sync with a fresh build', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  const freshSharedReadme = await readFile(path.join(sharedPackRoot(outputRoot), 'README.md'), 'utf8');
  const trackedSharedReadme = await readFile(path.join(REPO_ROOT, 'skillpacks', SHARED_PACK, 'README.md'), 'utf8');
  assert.equal(trackedSharedReadme, freshSharedReadme, 'tracked shared README should match a fresh build');

  const freshSharedInstall = await readFile(path.join(sharedPackRoot(outputRoot), 'install.sh'), 'utf8');
  const trackedSharedInstall = await readFile(path.join(REPO_ROOT, 'skillpacks', SHARED_PACK, 'install.sh'), 'utf8');
  assert.equal(trackedSharedInstall, freshSharedInstall, 'tracked shared install.sh should match a fresh build');

  const freshSharedCli = await readFile(
    path.join(sharedPackRoot(outputRoot), 'runtime', 'dist', 'cli', 'main.js'),
    'utf8',
  );
  const trackedSharedCli = await readFile(
    path.join(REPO_ROOT, 'skillpacks', SHARED_PACK, 'runtime', 'dist', 'cli', 'main.js'),
    'utf8',
  );
  assert.equal(trackedSharedCli, freshSharedCli, 'tracked shared bundled CLI should match a fresh build');

  const freshSharedCliShimDoctor = await readFile(
    path.join(sharedPackRoot(outputRoot), 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.js'),
    'utf8',
  );
  const trackedSharedCliShimDoctor = await readFile(
    path.join(REPO_ROOT, 'skillpacks', SHARED_PACK, 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.js'),
    'utf8',
  );
  assert.equal(
    trackedSharedCliShimDoctor,
    freshSharedCliShimDoctor,
    'tracked shared cliShimDoctor.js should match a fresh build',
  );

  const freshSharedCliShimDoctorTypes = await readFile(
    path.join(sharedPackRoot(outputRoot), 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.d.ts'),
    'utf8',
  );
  const trackedSharedCliShimDoctorTypes = await readFile(
    path.join(REPO_ROOT, 'skillpacks', SHARED_PACK, 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.d.ts'),
    'utf8',
  );
  assert.equal(
    trackedSharedCliShimDoctorTypes,
    freshSharedCliShimDoctorTypes,
    'tracked shared cliShimDoctor.d.ts should match a fresh build',
  );

  const freshSharedDependency = await readFile(
    path.join(sharedPackRoot(outputRoot), 'runtime', 'node_modules', 'meta-contract', 'package.json'),
    'utf8',
  );
  const trackedSharedDependency = await readFile(
    path.join(REPO_ROOT, 'skillpacks', SHARED_PACK, 'runtime', 'node_modules', 'meta-contract', 'package.json'),
    'utf8',
  );
  assert.equal(
    trackedSharedDependency,
    freshSharedDependency,
    'tracked shared bundled runtime dependencies should match a fresh build',
  );

  for (const skillName of EXPECTED_METABOT_SKILLS) {
    const freshSharedSkill = await readFile(sharedSkillFile(outputRoot, skillName), 'utf8');
    const trackedSharedSkill = await readFile(
      path.join(REPO_ROOT, 'skillpacks', SHARED_PACK, 'skills', skillName, 'SKILL.md'),
      'utf8'
    );
    assert.equal(trackedSharedSkill, freshSharedSkill, `tracked shared ${skillName} should match a fresh build`);
  }

  for (const host of HOSTS) {
    const freshReadme = await readFile(path.join(outputRoot, host, 'README.md'), 'utf8');
    const trackedReadme = await readFile(path.join(REPO_ROOT, 'skillpacks', host, 'README.md'), 'utf8');
    assert.equal(trackedReadme, freshReadme, `tracked ${host} README should match a fresh build`);

    const freshInstall = await readFile(path.join(outputRoot, host, 'install.sh'), 'utf8');
    const trackedInstall = await readFile(path.join(REPO_ROOT, 'skillpacks', host, 'install.sh'), 'utf8');
    assert.equal(trackedInstall, freshInstall, `tracked ${host} install.sh should match a fresh build`);

    const freshSharedInstall = await readFile(path.join(outputRoot, host, 'runtime', 'shared-install.sh'), 'utf8');
    const trackedWrapperSharedInstall = await readFile(
      path.join(REPO_ROOT, 'skillpacks', host, 'runtime', 'shared-install.sh'),
      'utf8'
    );
    assert.equal(
      trackedWrapperSharedInstall,
      freshSharedInstall,
      `tracked ${host} runtime/shared-install.sh should match a fresh build`
    );

    const freshWrapperCli = await readFile(
      path.join(outputRoot, host, 'runtime', 'dist', 'cli', 'main.js'),
      'utf8',
    );
    const trackedWrapperCli = await readFile(
      path.join(REPO_ROOT, 'skillpacks', host, 'runtime', 'dist', 'cli', 'main.js'),
      'utf8',
    );
    assert.equal(trackedWrapperCli, freshWrapperCli, `tracked ${host} bundled CLI should match a fresh build`);

    const freshWrapperCliShimDoctor = await readFile(
      path.join(outputRoot, host, 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.js'),
      'utf8',
    );
    const trackedWrapperCliShimDoctor = await readFile(
      path.join(REPO_ROOT, 'skillpacks', host, 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.js'),
      'utf8',
    );
    assert.equal(
      trackedWrapperCliShimDoctor,
      freshWrapperCliShimDoctor,
      `tracked ${host} cliShimDoctor.js should match a fresh build`,
    );

    const freshWrapperCliShimDoctorTypes = await readFile(
      path.join(outputRoot, host, 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.d.ts'),
      'utf8',
    );
    const trackedWrapperCliShimDoctorTypes = await readFile(
      path.join(REPO_ROOT, 'skillpacks', host, 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.d.ts'),
      'utf8',
    );
    assert.equal(
      trackedWrapperCliShimDoctorTypes,
      freshWrapperCliShimDoctorTypes,
      `tracked ${host} cliShimDoctor.d.ts should match a fresh build`,
    );

    const freshWrapperDependency = await readFile(
      path.join(outputRoot, host, 'runtime', 'node_modules', 'meta-contract', 'package.json'),
      'utf8',
    );
    const trackedWrapperDependency = await readFile(
      path.join(REPO_ROOT, 'skillpacks', host, 'runtime', 'node_modules', 'meta-contract', 'package.json'),
      'utf8',
    );
    assert.equal(
      trackedWrapperDependency,
      freshWrapperDependency,
      `tracked ${host} runtime dependencies should match a fresh build`,
    );

    for (const skillName of EXPECTED_METABOT_SKILLS) {
      const freshWrapperSkill = await readFile(hostWrapperSharedSkillFile(outputRoot, host, skillName), 'utf8');
      const trackedWrapperSkill = await readFile(
        path.join(REPO_ROOT, 'skillpacks', host, 'runtime', 'shared-skills', skillName, 'SKILL.md'),
        'utf8'
      );
      assert.equal(
        trackedWrapperSkill,
        freshWrapperSkill,
        `tracked ${host} wrapper ${skillName} should match a fresh build`,
      );
    }
  }
});

test('cliShimDoctor source and bundled runtime artifacts are tracked in git', async () => {
  await assertRepoFileTracked(path.join('src', 'core', 'state', 'cliShimDoctor.ts'));
  await assertRepoFileTracked(path.join('skillpacks', SHARED_PACK, 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.js'));
  await assertRepoFileTracked(path.join('skillpacks', SHARED_PACK, 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.d.ts'));

  for (const host of HOSTS) {
    await assertRepoFileTracked(path.join('skillpacks', host, 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.js'));
    await assertRepoFileTracked(path.join('skillpacks', host, 'runtime', 'dist', 'core', 'state', 'cliShimDoctor.d.ts'));
  }
});

test('buildAgentConnectSkillpacks host README lists the active metabot skills including Ask Master', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  for (const host of HOSTS) {
    const readme = await readFile(path.join(outputRoot, host, 'README.md'), 'utf8');

    for (const skillName of EXPECTED_METABOT_SKILLS) {
      assert.equal(readme.includes(`- \`${skillName}\``), true);
    }

    for (const removed of REMOVED_SKILLS) {
      assert.equal(readme.includes(`- \`${removed}\``), false);
    }
  }
});

test('buildAgentConnectSkillpacks host README advertises the phase-3 Ask Master smoke contract', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  for (const host of HOSTS) {
    const readme = await readFile(path.join(outputRoot, host, 'README.md'), 'utf8');
    assert.match(readme, /manual.*suggest/i);
    assert.match(readme, /single-machine two-terminal|single machine dual terminal/i);
    assert.match(readme, /preview\/confirm|preview first/i);
    assert.match(readme, /metabot config get askMaster.enabled/);
    assert.match(readme, /metabot config set askMaster.triggerMode suggest/);
    assert.match(readme, /accepted suggestions follow the same preview\/confirm\/send path as manual asks/i);
    assert.match(readme, /metabot master suggest --request-file/);
    assert.match(readme, /metabot master ask --request-file/);
    assert.doesNotMatch(readme, /metabot advisor (list|ask|trace)/);
  }
});

test('buildAgentConnectSkillpacks embeds one shared CLI path and one shared compatibility manifest across hosts', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  for (const host of HOSTS) {
    const readme = await readFile(path.join(outputRoot, host, 'README.md'), 'utf8');
    assert.match(readme, new RegExp(`\\b${EXPECTED_CLI_PATH}\\b`));
    assert.doesNotMatch(readme, /`agent-connect`|\bagent-connect\s+(?:identity|network|services|chat|ui|doctor|skills|master)\b/);
    assert.match(readme, new RegExp(escapeForRegex(EXPECTED_COMPATIBILITY_MANIFEST)));
  }
});

test('buildAgentConnectSkillpacks copies the compatibility manifest into the shared pack and every host runtime bundle', async () => {
  const { outputRoot } = await getBuiltSkillpacks();
  const expectedManifest = JSON.parse(await readFile(path.join(REPO_ROOT, 'release', 'compatibility.json'), 'utf8'));

  const sharedBundledManifest = JSON.parse(await readFile(
    path.join(sharedPackRoot(outputRoot), EXPECTED_BUNDLED_COMPATIBILITY_COPY),
    'utf8'
  ));
  assert.deepEqual(sharedBundledManifest, expectedManifest);

  for (const host of HOSTS) {
    const bundledManifest = JSON.parse(await readFile(
      path.join(outputRoot, host, EXPECTED_BUNDLED_COMPATIBILITY_COPY),
      'utf8'
    ));
    assert.deepEqual(bundledManifest, expectedManifest);
  }
});

test('tracked bundled MetaApp route serves Buzz entry from the repository source fallback', async () => {
  const routeModule = await import(pathToFileURL(
    path.join(REPO_ROOT, 'skillpacks', SHARED_PACK, 'runtime', 'dist', 'daemon', 'routes', 'uiMetaApps.js')
  ).href);
  const handleBundledMetaAppRoutes =
    routeModule.handleBundledMetaAppRoutes ?? routeModule.default.handleBundledMetaAppRoutes;
  let response = null;

  const handled = await handleBundledMetaAppRoutes({
    url: new URL('http://127.0.0.1:62860/ui/buzz/app/index.html?pinId=test-pin'),
    req: { method: 'GET' },
    sendMethodNotAllowed: (methods) => {
      response = { type: 'method_not_allowed', methods };
    },
    sendJson: (status, body) => {
      response = { type: 'json', status, body };
    },
    sendHtml: (status, html) => {
      response = { type: 'html', status, html };
    },
    sendText: (status, body, contentType) => {
      response = { type: 'text', status, body, contentType };
    },
  });

  assert.equal(handled, true);
  assert.equal(response?.type, 'html');
  assert.equal(response.status, 200);
  assert.match(response.html, /IDFramework - Buzz Feed Demo/);
  assert.match(response.html, /<base href="\/ui\/buzz\/app\/">/);
  assert.match(response.html, /data-oac-buzz-context-banner/);
  assert.match(response.html, /params\.get\('pinId'\)/);
});

test('buildAgentConnectSkillpacks preserves one confirmation contract in shared skills and bundles the same shared copy into host wrappers', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  const sharedContract = await readFile(sharedSkillFile(outputRoot, 'metabot-call-remote-service'), 'utf8');
  assert.match(sharedContract, /## Confirmation Contract/);
  assert.match(sharedContract, new RegExp(escapeForRegex(EXPECTED_CONFIRMATION_CONTRACT_LINE)));

  for (const host of HOSTS) {
    const bundledContract = await readFile(
      hostWrapperSharedSkillFile(outputRoot, host, 'metabot-call-remote-service'),
      'utf8'
    );
    assert.equal(bundledContract, sharedContract, `${host} should bundle the shared remote-call skill verbatim`);
  }
});

test('buildAgentConnectSkillpacks publishes shared remote-call plus trace-inspection workflow in the shared pack', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  const content = await readFile(sharedSkillFile(outputRoot, 'metabot-call-remote-service'), 'utf8');
  assert.match(content, /services call --request-file/);
  assert.match(content, new RegExp(escapeForRegex(EXPECTED_TRACE_WATCH_LINE)));
  assert.match(content, new RegExp(escapeForRegex(EXPECTED_TRACE_GET_LINE)));
  assert.match(content, new RegExp(escapeForRegex(EXPECTED_TRACE_UI_LINE)));
  assert.match(content, /timeout/i);
  assert.match(content, /clarification/i);
  assert.match(content, /manual action/i);
  assert.match(content, /remote Bot/i);
  assert.match(content, /Bot, bot, and MetaBot wording as equivalent and case-insensitive/i);
  assert.match(content, /rating/i);
});

test('buildAgentConnectSkillpacks publishes merged network-manage workflow in the shared pack', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  const content = await readFile(sharedSkillFile(outputRoot, 'metabot-network-manage'), 'utf8');
  assert.match(content, /^name:\s*metabot-network-manage$/m);
  assert.match(content, /network bots --online --limit 10/);
  assert.match(content, /network services --online/);
  assert.match(content, /ui open --page hub/);
  assert.match(content, /online Bots\/MetaBots/i);
  assert.match(content, /Bot, bot, and MetaBot as equivalent and case-insensitive/i);
  assert.match(content, /"online Bots", "online bot", or "online MetaBots"/i);
  assert.match(content, /online Bot services/i);
  assert.match(content, /Bot Hub/i);
  assert.match(content, /network sources add/);
  assert.match(content, /network sources list/);
  assert.match(content, /network sources remove/);
  assert.match(content, /Markdown table \(max 10 rows\)/i);
  assert.match(content, /\|\s*#\s*\|\s*name\s*\|\s*globalmetaid\s*\|\s*bio\s*\|\s*Last Seen\s*\|/);
  assert.match(content, /When no online bots or services are found, explicitly say the list is currently empty/i);
  assert.match(content, /metabot chat private --request-file/);
  assert.match(content, /offer natural-language follow-up prompts/i);
  assert.match(content, /Do not ask the human to type CLI commands directly/i);
  assert.match(content, /same language the human is currently using/i);
  assert.match(content, /Do not lock follow-up prompts to fixed wording/i);
  assert.match(content, /intent is equivalent and triggers the same skills/i);
  assert.match(content, /## In Scope/);
  assert.match(content, /## Out of Scope/);
  assert.match(content, /## Handoff To/);
  assert.match(content, /metabot-chat-privatechat/);
  assert.match(content, /metabot-call-remote-service/);
  assert.doesNotMatch(content, /runtime-resolve shim/i);
});

test('buildAgentConnectSkillpacks publishes merged identity-manage workflow in the shared pack', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  const content = await readFile(sharedSkillFile(outputRoot, 'metabot-identity-manage'), 'utf8');
  assert.match(content, /^name:\s*metabot-identity-manage$/m);
  assert.match(content, /identity create --name/);
  assert.match(content, /identity list/);
  assert.match(content, /identity assign --name/);
  assert.match(content, /identity who/);
  assert.match(content, /metabot doctor/);
  assert.match(content, /## First Bot Creation Handoff/);
  assert.match(content, /Bot, bot, and MetaBot as equivalent and case-insensitive/i);
  assert.match(content, /user chosen\s+name as part of the onboarding experience/i);
  assert.match(content, /show online Bots/i);
  assert.match(content, /show available Bot services/i);
  assert.match(content, /create a MetaBot/i);
  assert.match(content, /create a Bot/i);
  assert.match(content, /create a bot/i);
  assert.match(content, /CLI resolves the canonical profile home/i);
  assert.match(content, /~\/\.metabot\/manager\//);
  assert.match(content, /~\/\.metabot\/profiles\/<slug>\//);
  assert.match(content, /identity_name_taken/);
  assert.match(content, /identity_name_conflict/);
  assert.match(content, /\/info\/avatar/);
  assert.match(content, /image\/png;binary/);
  assert.match(content, /encoding:\s*'base64'|"encoding":\s*"base64"/);
  assert.match(content, /## In Scope/);
  assert.match(content, /## Out of Scope/);
  assert.match(content, /## Handoff To/);
  assert.doesNotMatch(content, /PROFILE_SLUG/);
  assert.doesNotMatch(content, /\.metabot\/hot/);
});

test('buildAgentConnectSkillpacks publishes the shared buzz and file writer skills in the shared pack', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  const chatContent = await readFile(sharedSkillFile(outputRoot, 'metabot-chat-privatechat'), 'utf8');
  assert.match(chatContent, /\/protocols\/simplemsg/);
  assert.match(chatContent, /pinId/);
  assert.match(chatContent, /txids/);
  assert.match(chatContent, /## Response Shape/);
  assert.match(chatContent, /do not reply with one rigid fixed sentence/i);
  assert.match(chatContent, /delivery proof/i);
  assert.match(chatContent, /natural-language next prompts/i);
  assert.match(chatContent, /same language as the user/i);
  assert.match(chatContent, /do not lock to one fixed phrase template/i);
  assert.match(chatContent, /localUiUrl/);
  assert.match(chatContent, /unified A2A trace/i);
  assert.match(chatContent, /Bot, bot, and MetaBot wording as equivalent and case-insensitive/i);
  assert.match(chatContent, /hello from my local Bot/);
  assert.doesNotMatch(chatContent, /private chat viewer/i);

  const privateChatDeclarations = await readFile(
    path.join(sharedPackRoot(outputRoot), 'runtime', 'dist', 'core', 'chat', 'privateChat.d.ts'),
    'utf8'
  );
  assert.doesNotMatch(privateChatDeclarations, /privateKeyHex/);
  assert.doesNotMatch(privateChatDeclarations, /peerChatPublicKey/);
  assert.doesNotMatch(privateChatDeclarations, /encryptedContent/);
  assert.doesNotMatch(privateChatDeclarations, /sharedSecret/);

  for (const host of HOSTS) {
    const hostPrivateChatDeclarations = await readFile(
      path.join(outputRoot, host, 'runtime', 'dist', 'core', 'chat', 'privateChat.d.ts'),
      'utf8'
    );
    assert.equal(hostPrivateChatDeclarations, privateChatDeclarations);
  }

  const buzzContent = await readFile(sharedSkillFile(outputRoot, 'metabot-post-buzz'), 'utf8');
  assert.match(buzzContent, /buzz post/);
  assert.match(buzzContent, /Bot, bot, and MetaBot as equivalent user wording/i);
  assert.match(buzzContent, /file upload/);
  assert.match(buzzContent, /localUiUrl/);
  assert.match(buzzContent, /Do not auto-open the local Buzz page/i);

  const fileContent = await readFile(sharedSkillFile(outputRoot, 'metabot-upload-file'), 'utf8');
  assert.match(fileContent, /file upload/);
  assert.match(fileContent, /\/file/);
  assert.match(fileContent, /Bot, bot, and MetaBot as equivalent user wording/i);
});

test('shared install.sh copies shared skills and installs a runnable metabot shim from the bundled runtime', async () => {
  const { outputRoot } = await getBuiltSkillpacks();
  const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-install-home-'));

  const sharedRoot = sharedPackRoot(outputRoot);
  await execFile('/bin/bash', [path.join(sharedRoot, 'install.sh')], {
    cwd: sharedRoot,
    env: {
      ...process.env,
      HOME: fakeHome,
    },
  });

  const skillDest = path.join(fakeHome, '.metabot', 'skills');
  const binDir = path.join(fakeHome, '.metabot', 'bin');

  await assertFileExists(path.join(skillDest, 'metabot-ask-master', 'SKILL.md'));
  await assertFileExists(path.join(skillDest, 'metabot-network-manage', 'SKILL.md'));
  await assertFileMissing(path.join(skillDest, 'metabot-network-directory', 'SKILL.md'));
  await assertFileExists(path.join(binDir, 'metabot'));
  await assertFileMissing(path.join(binDir, 'agent-connect'));

  const sharedInstall = await readFile(path.join(sharedRoot, 'install.sh'), 'utf8');
  assert.match(sharedInstall, /resolve_node_bin/);
  assert.match(sharedInstall, /METABOT_NODE/);
  assert.match(sharedInstall, /node@22/);
  assert.match(sharedInstall, /Node\.js >=20 <25/);
  assert.doesNotMatch(sharedInstall, /exec node "\$CLI_ENTRY"/);

  const shim = await readFile(path.join(binDir, 'metabot'), 'utf8');
  assert.match(shim, /METABOT_NODE/);
  assert.match(shim, /node@22/);
  assert.match(shim, /exec "\$NODE_BIN" "\$CLI_ENTRY" "\$@"/);
  assert.doesNotMatch(shim, /exec node "\$CLI_ENTRY"/);

  const installedAskMaster = await readFile(path.join(skillDest, 'metabot-ask-master', 'SKILL.md'), 'utf8');
  assert.match(installedAskMaster, /metabot master ask --request-file/);
  assert.doesNotMatch(installedAskMaster, /metabot advisor ask/);

  const fakeNodePath = path.join(fakeHome, 'fake-node22');
  const fakeNodeLog = path.join(fakeHome, 'fake-node22.log');
  await writeRecordingNodeShim(fakeNodePath, fakeNodeLog);

  let commandFailure = null;
  try {
    await execFile(path.join(binDir, 'metabot'), [], {
      env: {
        ...process.env,
        HOME: fakeHome,
        METABOT_NODE: fakeNodePath,
        PATH: '/usr/bin:/bin',
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
  const fakeNodeInvocation = await readFile(fakeNodeLog, 'utf8');
  assert.match(fakeNodeInvocation, new RegExp(escapeForRegex(fakeNodePath)));
  assert.match(fakeNodeInvocation, /runtime\/dist\/cli\/main\.js/);
});

test('host wrapper install.sh runs the packaged shared install flow and binds host skills without relying on an adjacent shared pack directory', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  for (const host of HOSTS) {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), `metabot-${host}-wrapper-home-`));
    const isolatedPackRoot = await mkdtemp(path.join(os.tmpdir(), `metabot-${host}-wrapper-pack-`));
    const hostRoot = path.join(isolatedPackRoot, host);
    await cp(path.join(outputRoot, host), hostRoot, { recursive: true });

    await execFile('/bin/bash', [path.join(hostRoot, 'install.sh')], {
      cwd: hostRoot,
      env: {
        ...process.env,
        HOME: fakeHome,
      },
    });

    const sharedSkillRoot = path.join(fakeHome, '.metabot', 'skills');
    await assertFileExists(path.join(sharedSkillRoot, 'metabot-ask-master', 'SKILL.md'));

    for (const skillName of EXPECTED_METABOT_SKILLS) {
      const boundSkillPath = path.join(expectedHostSkillRoot(fakeHome, host), skillName);
      const boundSkillStat = await lstat(boundSkillPath);
      assert.equal(boundSkillStat.isSymbolicLink(), true, `${boundSkillPath} should be a symlink`);

      const boundSkillTarget = await readlink(boundSkillPath);
      assert.equal(
        path.resolve(path.dirname(boundSkillPath), boundSkillTarget),
        path.join(sharedSkillRoot, skillName),
      );
    }
  }
});

test('repository keeps no deprecated skill aliases after migration', async () => {
  const openAgentPrefix = ['open', 'agent'].join('-');
  const openAgentSkillPattern = `${openAgentPrefix}-(chat-privatechat|post-buzz|upload-file|post-skillservice|omni-reader|bootstrap|identity-manage|network-directory|network-sources|call-remote-service|trace-inspector)`;
  try {
    const result = await execFile('git', ['grep', '-nE', openAgentSkillPattern, '--', '.'], {
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

test('codex install runbook documents install verification and first-run handoff contract', async () => {
  const installRunbook = await readFile(
    path.join(REPO_ROOT, 'docs', 'hosts', 'codex-agent-install.md'),
    'utf8'
  );

  assert.match(installRunbook, /docs\/install\/open-agent-connect\.md/);
  assert.match(installRunbook, /npm run build:skillpacks/);
  assert.match(installRunbook, /cd skillpacks\/shared/);
  assert.match(installRunbook, /metabot host bind-skills --host codex/);
  assert.match(installRunbook, /\$HOME\/\.metabot\/skills\/metabot-ask-master\/SKILL\.md/);
  assert.match(installRunbook, /\$HOME\/\.metabot\/skills\/metabot-network-manage\/SKILL\.md/);
  assert.match(installRunbook, /\$HOME\/\.metabot\/skills\/metabot-chat-privatechat\/SKILL\.md/);
  assert.doesNotMatch(installRunbook, /\$\{CODEX_HOME:-\$HOME\/\.codex\}\/skills\/metabot-ask-master\/SKILL\.md/);
  assert.match(installRunbook, /metabot doctor/);
  assert.match(installRunbook, /Only run `metabot identity create --name \.\.\.` after the user has supplied/i);
  assert.match(installRunbook, /Create a Bot named <your chosen name>/);
  assert.match(installRunbook, /do not auto-create a default identity such as `Alice`/i);
  assert.match(installRunbook, /metabot network bots --online --limit 10/);
  assert.match(installRunbook, /## Agent Response Contract \(Required\)/);
  assert.match(installRunbook, /do not ask the user to type raw CLI commands/i);
  assert.match(installRunbook, /natural-language prompts/i);
  assert.match(installRunbook, /same language the user is currently using/i);
  assert.match(installRunbook, /Do not lock prompts to fixed English phrases/i);
  assert.match(installRunbook, /Prompt wording can vary as long as intent is equivalent/i);
  assert.match(installRunbook, /if identity already exists, report current name and globalMetaId/i);
  assert.match(installRunbook, /Open Agent Connect: Connect your local AI agent to an open agent network/i);
  assert.match(installRunbook, /what Open Agent Connect now enables/i);
  assert.match(installRunbook, /Do not return only raw command output/i);
  assert.match(installRunbook, /key `metabot doctor` verification fields only when an active identity exists/i);
  assert.match(installRunbook, /~\/\.metabot\/manager\//);
  assert.match(installRunbook, /~\/\.metabot\/profiles\/<slug>\//);
  assert.match(installRunbook, /~\/\.metabot\/skills\//);
  assert.match(installRunbook, /do not manually edit `\.runtime\/` files/i);
  assert.doesNotMatch(installRunbook, /metabot identity create --name "Alice"/);
  assert.doesNotMatch(installRunbook, /\.metabot\/hot/);
});
