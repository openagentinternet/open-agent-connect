import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { writeBotRoleInfo } = require('../../dist/core/bot/botRole.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { writeMetaAppZipArchive } = require('../../dist/core/metaapp/zipArchive.js');

const SKILL_PIN_ID = 'b'.repeat(64) + 'i0';
const ZIP_PIN_ID = 'a'.repeat(64) + 'i0';
const SKILL_NAME = 'metabot-e2e-skill';

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
        { name: slug, slug, aliases: [slug], homeDir, globalMetaId: '', mvcAddress: '', createdAt: now, updatedAt: now },
      ],
    }, null, 2)}\n`,
    'utf8',
  );
  await writeBotRoleInfo(resolveMetabotPaths(homeDir).botRoleStatePath, { botType: 'twin' });
  return { homeDir, systemHome };
}

async function runSkillsCli(homeDir, args, envOverrides = {}) {
  const stdout = [];
  const exitCode = await runCli(['skills', ...args], {
    env: {
      ...process.env,
      HOME: homeDir.split(path.join('.metabot', 'profiles'))[0],
      METABOT_HOME: homeDir,
      METABOT_METAWEB_API_BASE_URL: 'https://so.test',
      ...envOverrides,
    },
    cwd: homeDir,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  const raw = stdout.join('').trim();
  return { exitCode, result: raw ? JSON.parse(raw) : null };
}

async function makePackageZip(systemHome) {
  const sourceDir = path.join(systemHome, 'pkg-src');
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'SKILL.md'), `---\nname: ${SKILL_NAME}\nversion: 1.4.2\ndescription: E2E skill\n---\n\n# Demo\n\nDo the thing.\n`, 'utf8');
  const outFile = path.join(systemHome, 'pkg.zip');
  await writeMetaAppZipArchive({ sourceDir, outFile });
  return fs.readFile(outFile);
}

/** Fake metaweb node + metafile indexer: pin read + package download. */
function installFakeFetch(zipBuffer) {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    seen.push(target);
    if (target.startsWith('https://so.test/api/metaweb/pin/')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            pinId: SKILL_PIN_ID,
            currentPinId: SKILL_PIN_ID,
            protocol: 'metabot-skill',
            path: '/protocols/metabot-skill',
            chainName: 'mvc',
            operation: 'create',
            creator: { globalMetaId: 'IDQ1', metaid: 'm1', name: 'Fisher', address: '' },
            createdAt: 1787000000,
            contentType: 'application/json',
            payload: {
              name: SKILL_NAME,
              'skill-file': `metafile://${ZIP_PIN_ID}.zip`,
              version: '1.4.2',
              description: 'E2E skill',
            },
            text: null,
            attachments: [],
            source: 'local',
          },
        }),
      };
    }
    if (target.includes('file.metaid.io')) {
      return {
        status: 200,
        ok: true,
        headers: { get: () => String(zipBuffer.byteLength) },
        arrayBuffer: async () => zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength),
      };
    }
    return { status: 404, ok: false };
  };
  return async () => {
    globalThis.fetch = originalFetch;
    return seen;
  };
}

test('skills install previews without --confirm and installs end-to-end with it', async () => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-skills-');
  const dshHome = path.join(systemHome, '.dsh');
  await fs.mkdir(dshHome, { recursive: true });
  const restoreFetch = installFakeFetch(await makePackageZip(systemHome));
  try {
    const preview = await runSkillsCli(homeDir, ['install', '--pin', SKILL_PIN_ID], { DSH_HOME: dshHome });
    assert.equal(preview.exitCode, 1);
    assert.equal(preview.result.ok, false);
    assert.equal(preview.result.code, 'confirm_required');
    assert.match(preview.result.message, new RegExp(SKILL_NAME));
    assert.match(preview.result.message, /--confirm/);

    const installed = await runSkillsCli(homeDir, ['install', '--pin', SKILL_PIN_ID, '--confirm'], { DSH_HOME: dshHome });
    assert.equal(installed.exitCode, 0);
    assert.equal(installed.result.ok, true);
    assert.equal(installed.result.data.skill.name, SKILL_NAME);
    assert.equal(installed.result.data.skill.version, '1.4.2');
    assert.match(installed.result.data.formatted, new RegExp(`metabot skills read --name ${SKILL_NAME}`));

    const skillMd = await fs.readFile(path.join(systemHome, '.metabot', 'skills', SKILL_NAME, 'SKILL.md'), 'utf8');
    assert.match(skillMd, /# Demo/);
    // The post-install rebind landed the skill in the existing DSH root.
    const dshLink = path.join(dshHome, 'skills', SKILL_NAME);
    assert.equal((await fs.lstat(dshLink)).isSymbolicLink(), true);

    const listed = await runSkillsCli(homeDir, ['list']);
    assert.equal(listed.result.ok, true);
    assert.equal(listed.result.data.skills.length, 1);
    assert.equal(listed.result.data.skills[0].name, SKILL_NAME);
    assert.equal(listed.result.data.skills[0].creatorMetaId, 'IDQ1');
    assert.equal(listed.result.data.skills[0].present, true);

    const read = await runSkillsCli(homeDir, ['read', '--name', SKILL_NAME]);
    assert.equal(read.result.ok, true);
    assert.match(read.result.data.skillMd, /# Demo/);
    assert.ok(read.result.data.skillDir.endsWith(SKILL_NAME));

    const unconfirmed = await runSkillsCli(homeDir, ['uninstall', '--name', SKILL_NAME]);
    assert.equal(unconfirmed.result.code, 'confirm_required');
    const removed = await runSkillsCli(homeDir, ['uninstall', '--name', SKILL_NAME, '--confirm']);
    assert.equal(removed.result.ok, true);
    await assert.rejects(fs.stat(path.join(systemHome, '.metabot', 'skills', SKILL_NAME)));
    await assert.rejects(fs.lstat(dshLink), 'host symlink cleaned after uninstall');
  } finally {
    await restoreFetch();
  }
});

test('skills install rejects malformed invocations and non-skill pins', async () => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-skills-bad-');
  const restoreFetch = installFakeFetch(await makePackageZip(systemHome));
  try {
    const missing = await runSkillsCli(homeDir, ['install']);
    assert.equal(missing.result.code, 'invalid_argument');
    assert.match(missing.result.message, /--pin/);

    // The mocked pin is a valid skill pin; corrupt the payload to test the guard.
    const originalJson = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).startsWith('https://so.test/api/metaweb/pin/')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              pinId: SKILL_PIN_ID,
              protocol: 'simplenote',
              path: '/protocols/simplenote',
              creator: { globalMetaId: 'IDQ1', metaid: 'm1', name: 'Fisher', address: '' },
              payload: { note: 'just a note' },
              text: 'body',
              source: 'local',
            },
          }),
        };
      }
      return { status: 404, ok: false };
    };
    const notSkill = await runSkillsCli(homeDir, ['install', '--pin', SKILL_PIN_ID, '--confirm']);
    assert.equal(notSkill.result.ok, false);
    assert.equal(notSkill.result.code, 'invalid_skill_pin');
    globalThis.fetch = originalJson;
  } finally {
    await restoreFetch();
  }
});

const DAEMON_BASE_URL = 'http://127.0.0.1:10099';
const PUBLISH_PIN_ID = 'c'.repeat(64) + 'i0';

/** Fake daemon: records /api/skills/publish requests, returns envelopes. */
function installFakeDaemonFetch() {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (!target.startsWith(DAEMON_BASE_URL)) {
      return originalFetch(url, init);
    }
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url: target, method: init?.method, body });
    if (target.endsWith('/api/skills/publish') && body?.confirm === true) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          ok: true,
          state: 'success',
          data: {
            name: body.name ?? 'publish-e2e-skill',
            version: body.version ?? '0.9.0',
            pinId: PUBLISH_PIN_ID,
            skillFileUri: 'metafile://' + 'd'.repeat(64) + 'i0.zip',
            formatted: `Skill published; others install with: metabot skills install --pin ${PUBLISH_PIN_ID} --confirm`,
          },
        }),
      };
    }
    return {
      status: 200,
      ok: true,
      json: async () => ({
        ok: true,
        state: 'awaiting_confirmation',
        data: {
          plan: { name: body?.name ?? 'publish-e2e-skill', archive: { bytes: 512, sha256: 'f'.repeat(64), fileCount: 2 } },
          formatted: 'preview — re-run with --confirm',
        },
      }),
    };
  };
  return async () => {
    globalThis.fetch = originalFetch;
    return requests;
  };
}

test('skills publish requires --dir and previews through the daemon without --confirm', async () => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-skills-pub-');
  const missing = await runSkillsCli(homeDir, ['publish'], { METABOT_DAEMON_BASE_URL: DAEMON_BASE_URL });
  assert.equal(missing.result.ok, false);
  assert.equal(missing.result.code, 'invalid_argument');

  const skillDir = path.join(systemHome, 'publish-src');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: publish-e2e-skill\nversion: 0.9.0\ndescription: E2E\n---\n\n# Demo\n', 'utf8');

  const restoreDaemon = installFakeDaemonFetch();
  try {
    const preview = await runSkillsCli(
      homeDir,
      ['publish', '--dir', skillDir, '--from', 'test-profile'],
      { METABOT_DAEMON_BASE_URL: DAEMON_BASE_URL },
    );
    assert.equal(preview.exitCode, 0);
    assert.equal(preview.result.ok, true);
    assert.equal(preview.result.state, 'awaiting_confirmation');
    assert.equal(preview.result.data.plan.name, 'publish-e2e-skill');
  } finally {
    await restoreDaemon();
  }
});

test('skills publish --confirm forwards the resolved dir and flags to the daemon', async () => {
  const { homeDir, systemHome } = await createProfileHome('metabot-cli-skills-pub2-');
  const skillDir = path.join(systemHome, 'publish-src');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: publish-e2e-skill\nversion: 0.9.0\n---\n\n# Demo\n', 'utf8');

  const restoreDaemon = installFakeDaemonFetch();
  try {
    const published = await runSkillsCli(
      homeDir,
      [
        'publish', '--dir', skillDir,
        '--name', 'publish-e2e-skill', '--skill-version', '1.0.0', '--description', 'Bumped',
        '--from', 'test-profile', '--confirm',
      ],
      { METABOT_DAEMON_BASE_URL: DAEMON_BASE_URL },
    );
    assert.equal(published.exitCode, 0);
    assert.equal(published.result.state, 'success');
    assert.equal(published.result.data.pinId, PUBLISH_PIN_ID);
    assert.match(published.result.data.formatted, /skills install --pin/);

    const seen = await restoreDaemon();
    const publishRequests = seen.filter((request) => request.url.endsWith('/api/skills/publish'));
    assert.equal(publishRequests.length, 1);
    assert.equal(publishRequests[0].method, 'POST');
    assert.equal(publishRequests[0].body.confirm, true);
    assert.equal(publishRequests[0].body.from, 'test-profile');
    assert.equal(publishRequests[0].body.name, 'publish-e2e-skill');
    assert.equal(publishRequests[0].body.version, '1.0.0');
    assert.equal(publishRequests[0].body.description, 'Bumped');
    assert.equal(publishRequests[0].body.skillDir, skillDir);
  } finally {
    await restoreDaemon();
  }
});
