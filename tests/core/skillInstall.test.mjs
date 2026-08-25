import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  parseSkillFrontmatter,
  normalizeSkillName,
  extractSkillPinDescriptor,
  downloadSkillArchive,
  installSkillArchive,
  listInstalledSkills,
  readInstalledSkill,
  uninstallInstalledSkill,
  readInstalledSkillsRegistry,
  MAX_SKILL_PACKAGE_BYTES,
  SkillInstallError,
} = require('../../dist/core/skills/skillInstall.js');
const { writeMetaAppZipArchive } = require('../../dist/core/metaapp/zipArchive.js');
const { bindPlatformSkills } = require('../../dist/core/host/hostSkillBinding.js');

const ZIP_PIN_ID = 'a'.repeat(64) + 'i0';
const SKILL_PIN_ID = 'b'.repeat(64) + 'i0';

function skillDoc(name, version = '1.0.0', body = 'Follow the steps.') {
  return `---\nname: ${name}\nversion: ${version}\ndescription: "A test skill"\n---\n\n# ${name}\n\n${body}\n`;
}

async function makeSkillZip(dir, entries) {
  for (const [relativePath, content] of Object.entries(entries)) {
    const target = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  const outFile = path.join(dir, '..', `${path.basename(dir)}.zip`);
  await writeMetaAppZipArchive({ sourceDir: dir, outFile });
  return fs.readFile(outFile);
}

function zipResponse(buffer) {
  return {
    status: 200,
    ok: true,
    headers: { get: () => null },
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

test('parseSkillFrontmatter reads flat scalar fields', () => {
  assert.deepEqual(
    parseSkillFrontmatter('---\nname: metabot-example\nversion: 2.1.0\ndescription: "Does things"\n---\n\n# body\n'),
    { name: 'metabot-example', version: '2.1.0', description: 'Does things' },
  );
  assert.deepEqual(parseSkillFrontmatter('# no frontmatter\n'), {});
  assert.deepEqual(parseSkillFrontmatter('---\nname: x\n'), {});
});

test('normalizeSkillName accepts directory-safe names only', () => {
  assert.equal(normalizeSkillName('metabot-example'), 'metabot-example');
  assert.equal(normalizeSkillName('My_Skill.2'), 'My_Skill.2');
  assert.equal(normalizeSkillName(''), '');
  assert.equal(normalizeSkillName('.hidden'), '');
  assert.equal(normalizeSkillName('..'), '');
  assert.equal(normalizeSkillName('a/b'), '');
  assert.equal(normalizeSkillName('a\\b'), '');
  assert.equal(normalizeSkillName('x'.repeat(65)), '');
});

test('extractSkillPinDescriptor accepts known payload spellings', () => {
  assert.deepEqual(
    extractSkillPinDescriptor({
      payload: { name: 'metabot-example', 'skill-file': `metafile://${ZIP_PIN_ID}.zip`, version: '1.2', description: 'd' },
      creator: { globalMetaId: 'IDQ1', name: 'Fisher' },
    }),
    { name: 'metabot-example', description: 'd', version: '1.2', skillFileUri: `metafile://${ZIP_PIN_ID}.zip` },
  );
  assert.ok(extractSkillPinDescriptor({ payload: { skillName: 'x', skillFileUri: `metafile://${ZIP_PIN_ID}` } }));
  assert.equal(extractSkillPinDescriptor({ payload: { name: 'x' } }), null);
  assert.equal(extractSkillPinDescriptor({ payload: null }), null);
});

test('downloadSkillArchive resolves metafile URIs through the content URLs', async () => {
  const calls = [];
  const archive = Buffer.from('pk-zip-bytes');
  const fetched = await downloadSkillArchive({
    contentReference: `metafile://${ZIP_PIN_ID}.zip`,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? { status: 502, ok: false }
        : zipResponse(archive);
    },
  });
  assert.deepEqual(fetched, archive);
  assert.ok(calls[0].includes('/accelerate/content/'));
  assert.ok(calls[1].includes('/content/'));

  await assert.rejects(
    downloadSkillArchive({ contentReference: 'not-a-uri', fetchImpl: async () => zipResponse(archive) }),
    (error) => error instanceof SkillInstallError && error.code === 'invalid_source',
  );
  await assert.rejects(
    downloadSkillArchive({
      contentReference: `metafile://${ZIP_PIN_ID}`,
      fetchImpl: async () => ({ status: 500, ok: false }),
    }),
    (error) => error instanceof SkillInstallError && error.code === 'download_failed',
  );
});

test('downloadSkillArchive enforces the package size cap', async () => {
  const big = Buffer.alloc(MAX_SKILL_PACKAGE_BYTES + 1, 1);
  await assert.rejects(
    downloadSkillArchive({ contentReference: `metafile://${ZIP_PIN_ID}`, fetchImpl: async () => zipResponse(big) }),
    (error) => error instanceof SkillInstallError && error.code === 'invalid_package' && /exceeds/.test(error.message),
  );
  await assert.rejects(
    downloadSkillArchive({
      contentReference: `metafile://${ZIP_PIN_ID}`,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: { get: (name) => (name === 'content-length' ? String(MAX_SKILL_PACKAGE_BYTES + 10) : null) },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    }),
    (error) => error instanceof SkillInstallError && error.code === 'invalid_package',
  );
});

test('installSkillArchive installs a root-SKILL.md package with provenance', async () => {
  const root = mkdtempTempRootSync('skill-install-');
  const skillsRoot = path.join(root, '.metabot', 'skills');
  const staging = path.join(root, 'pkg');
  const archive = await makeSkillZip(staging, {
    'SKILL.md': skillDoc('metabot-demo', '3.2.1'),
    'scripts/run.js': 'console.log("demo");\n',
  });

  const installed = await installSkillArchive({
    skillsRoot,
    archive,
    source: { creatorMetaId: 'IDQ1', creatorName: 'Fisher', sourcePinId: SKILL_PIN_ID, skillFileUri: `metafile://${ZIP_PIN_ID}.zip` },
    now: () => 1_787_000_000_000,
  });

  assert.equal(installed.name, 'metabot-demo');
  assert.equal(installed.version, '3.2.1');
  assert.equal(installed.replaced, false);
  assert.equal(installed.skillDir, path.join(skillsRoot, 'metabot-demo'));
  assert.deepEqual(installed.files, ['SKILL.md', 'scripts/run.js']);
  await assert.equal(
    await fs.readFile(path.join(skillsRoot, 'metabot-demo', 'SKILL.md'), 'utf8'),
    skillDoc('metabot-demo', '3.2.1'),
  );

  const registry = await readInstalledSkillsRegistry(skillsRoot);
  assert.equal(registry.skills['metabot-demo'].creatorMetaId, 'IDQ1');
  assert.equal(registry.skills['metabot-demo'].sourcePinId, SKILL_PIN_ID);
  assert.equal(registry.skills['metabot-demo'].enabled, true);
  // Staging leftovers never survive an install.
  assert.equal((await fs.readdir(skillsRoot)).filter((name) => name.startsWith('.skill-install-')).length, 0);
});

test('installSkillArchive unwraps a single wrapping directory', async () => {
  const root = mkdtempTempRootSync('skill-unwrap-');
  const skillsRoot = path.join(root, '.metabot', 'skills');
  const archive = await makeSkillZip(path.join(root, 'pkg'), {
    'wrapped/SKILL.md': skillDoc('wrapped-skill'),
  });
  const installed = await installSkillArchive({ skillsRoot, archive });
  assert.equal(installed.name, 'wrapped-skill');
  await assert.ok(fs.stat(path.join(skillsRoot, 'wrapped-skill', 'SKILL.md')));
});

test('installSkillArchive rejects packages without SKILL.md', async () => {
  const root = mkdtempTempRootSync('skill-nodoc-');
  const archive = await makeSkillZip(path.join(root, 'pkg'), { 'README.md': '# no skill doc\n' });
  await assert.rejects(
    installSkillArchive({ skillsRoot: path.join(root, '.metabot', 'skills'), archive }),
    (error) => error instanceof SkillInstallError && error.code === 'invalid_package' && /SKILL.md/.test(error.message),
  );
});

test('installSkillArchive guards names against conflicts and supports publisher-stable upgrades', async () => {
  const root = mkdtempTempRootSync('skill-conflict-');
  const skillsRoot = path.join(root, '.metabot', 'skills');
  const archiveV1 = await makeSkillZip(path.join(root, 'pkg1'), { 'SKILL.md': skillDoc('metabot-demo', '1.0.0') });
  const archiveV2 = await makeSkillZip(path.join(root, 'pkg2'), { 'SKILL.md': skillDoc('metabot-demo', '2.0.0') });

  await installSkillArchive({ skillsRoot, archive: archiveV1, source: { creatorMetaId: 'IDQ1', sourcePinId: SKILL_PIN_ID } });

  // Different publisher claiming the same name is refused.
  await assert.rejects(
    installSkillArchive({ skillsRoot, archive: archiveV2, source: { creatorMetaId: 'IDQ2' } }),
    (error) => error instanceof SkillInstallError && error.code === 'name_conflict' && /different publisher/.test(error.message),
  );
  // Same publisher upgrades in place.
  const upgraded = await installSkillArchive({ skillsRoot, archive: archiveV2, source: { creatorMetaId: 'IDQ1' } });
  assert.equal(upgraded.replaced, true);
  assert.equal(upgraded.previousVersion, '1.0.0');
  assert.equal(upgraded.version, '2.0.0');
  // --force overrides the publisher check.
  const forced = await installSkillArchive({ skillsRoot, archive: archiveV2, source: { creatorMetaId: 'IDQ3' }, force: true });
  assert.equal(forced.version, '2.0.0');

  // A pre-existing local skill with no registry entry is never clobbered.
  await fs.mkdir(path.join(skillsRoot, 'local-skill'), { recursive: true });
  await fs.writeFile(path.join(skillsRoot, 'local-skill', 'SKILL.md'), skillDoc('local-skill'), 'utf8');
  const localArchive = await makeSkillZip(path.join(root, 'pkg3'), { 'SKILL.md': skillDoc('local-skill') });
  await assert.rejects(
    installSkillArchive({ skillsRoot, archive: localArchive }),
    (error) => error instanceof SkillInstallError && error.code === 'name_conflict' && /not installed from MetaWeb/.test(error.message),
  );
});

test('list, read, and uninstall round-trip one installed skill', async () => {
  const root = mkdtempTempRootSync('skill-roundtrip-');
  const skillsRoot = path.join(root, '.metabot', 'skills');
  const archive = await makeSkillZip(path.join(root, 'pkg'), {
    'SKILL.md': skillDoc('round-trip', '0.9.0', 'Steps here.'),
    'assets/data.txt': 'x',
  });
  await installSkillArchive({ skillsRoot, archive, source: { creatorMetaId: 'IDQ1' } });

  const listed = await listInstalledSkills(skillsRoot);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'round-trip');
  assert.equal(listed[0].present, true);

  const read = await readInstalledSkill({ skillsRoot, name: 'round-trip' });
  assert.match(read.skillMd, /# round-trip/);
  assert.deepEqual(read.files, ['SKILL.md', 'assets/data.txt']);

  const removed = await uninstallInstalledSkill({ skillsRoot, name: 'round-trip' });
  assert.equal(removed.removedDir, true);
  assert.deepEqual((await listInstalledSkills(skillsRoot)), []);
  await assert.rejects(
    uninstallInstalledSkill({ skillsRoot, name: 'round-trip' }),
    (error) => error instanceof SkillInstallError && error.code === 'name_conflict',
  );
});

test('bindPlatformSkills binds registry-installed skills into existing host roots', async () => {
  const root = mkdtempTempRootSync('skill-bind-');
  const systemHome = root;
  const skillsRoot = path.join(systemHome, '.metabot', 'skills');
  const dshHome = path.join(systemHome, '.dsh');
  await fs.mkdir(dshHome, { recursive: true });

  const archive = await makeSkillZip(path.join(root, 'pkg'), { 'SKILL.md': skillDoc('community-skill', '1.0.0') });
  await installSkillArchive({ skillsRoot, archive, source: { creatorMetaId: 'IDQ1' } });

  const results = await bindPlatformSkills({ systemHomeDir: systemHome, env: { DSH_HOME: dshHome }, mode: 'auto' });
  const dsh = results.find((entry) => entry.platformId === 'dsh');
  assert.equal(dsh.status, 'bound');
  assert.ok(dsh.boundSkills.includes('community-skill'), 'registry skill binds without the metabot- prefix');
  const link = path.join(dshHome, 'skills', 'community-skill');
  const stat = await fs.lstat(link);
  assert.equal(stat.isSymbolicLink(), true);
});
