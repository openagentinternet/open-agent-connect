import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  previewSkillProject,
  publishSkill,
  buildSkillPinPayload,
  SKILL_PROTOCOL_PATH,
  SkillPublishError,
} = require('../../dist/core/skills/skillPublish.js');
const {
  installSkillArchive,
  extractSkillPinDescriptor,
  readInstalledSkillsRegistry,
  MAX_SKILL_PACKAGE_BYTES,
} = require('../../dist/core/skills/skillInstall.js');

const UPLOAD_PIN_ID = 'f'.repeat(64) + 'i0';
const PROTOCOL_PIN_ID = 'e'.repeat(64) + 'i0';

function skillDoc(name, version = '1.2.3', description = 'Publish test skill') {
  return `---\nname: ${name}\nversion: ${version}\ndescription: "${description}"\n---\n\n# ${name}\n\nFollow the steps.\n`;
}

async function makeSkillDir(parent, name, extra = {}) {
  const dir = path.join(parent, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), skillDoc(name), 'utf8');
  for (const [relativePath, content] of Object.entries(extra)) {
    const target = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  return dir;
}

function fakeDeps(overrides = {}) {
  const uploads = [];
  const writes = [];
  const state = { capturedArchive: null };
  const deps = {
    uploadFile: async (input) => {
      uploads.push(input);
      state.capturedArchive = await fs.readFile(input.filePath);
      return overrides.uploadResult ?? {
        pinId: UPLOAD_PIN_ID,
        metafileUri: `metafile://${UPLOAD_PIN_ID}.zip`,
        txids: ['tx-file'],
      };
    },
    writeChain: async (input) => {
      writes.push(input);
      return overrides.chainResult ?? { pinId: PROTOCOL_PIN_ID, txids: ['tx-protocol'], totalCost: 1 };
    },
  };
  return { deps, uploads, writes, state };
}

test('previewSkillProject derives metadata from frontmatter and reports real archive stats', async () => {
  const root = mkdtempTempRootSync();
  const dir = await makeSkillDir(root, 'demo-skill', { 'scripts/run.js': 'export {}\n' });
  const plan = await previewSkillProject({ skillDir: dir });
  assert.equal(plan.name, 'demo-skill');
  assert.equal(plan.version, '1.2.3');
  assert.equal(plan.description, 'Publish test skill');
  assert.equal(plan.network, 'mvc');
  assert.equal(plan.payload.name, 'demo-skill');
  assert.equal(plan.payload.version, '1.2.3');
  assert.equal(plan.payload['skill-file'], 'metafile://<uploaded-skill-zip-pin>.zip');
  assert.equal(Object.keys(plan.payload).length, 4);
  assert.ok(plan.archive.bytes > 0);
  assert.match(plan.archive.sha256, /^[0-9a-f]{64}$/);
  assert.equal(plan.archive.fileCount, 2);
  assert.deepEqual(plan.warnings, []);
});

test('flag overrides beat frontmatter and must still validate', async () => {
  const root = mkdtempTempRootSync();
  const dir = await makeSkillDir(root, 'demo-skill');
  const plan = await previewSkillProject({
    skillDir: dir,
    name: 'renamed-skill',
    version: '2.0.0',
    description: 'Overridden',
    network: 'mvc',
  });
  assert.equal(plan.name, 'renamed-skill');
  assert.equal(plan.version, '2.0.0');
  assert.equal(plan.description, 'Overridden');

  await assert.rejects(
    previewSkillProject({ skillDir: dir, name: '.hidden' }),
    (error) => error instanceof SkillPublishError && error.code === 'invalid_metadata',
  );
});

test('version is required — frontmatter without version and no flag is refused', async () => {
  const root = mkdtempTempRootSync();
  const dir = path.join(root, 'noversion');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), skillDoc('noversion').replace('version: 1.2.3\n', ''), 'utf8');
  await assert.rejects(
    previewSkillProject({ skillDir: dir }),
    (error) => error instanceof SkillPublishError && error.code === 'invalid_metadata' && /version/i.test(error.message),
  );
  const plan = await previewSkillProject({ skillDir: dir, version: '0.0.1' });
  assert.equal(plan.version, '0.0.1');
});

test('resolveSkillPackageRoot: direct, single wrapping dir, ambiguous, and missing', async () => {
  const root = mkdtempTempRootSync();
  const dir = await makeSkillDir(root, 'direct-skill');
  const plan = await previewSkillProject({ skillDir: dir });
  assert.equal(plan.skillDir, path.resolve(dir));

  const parent = path.join(root, 'parent');
  await makeSkillDir(parent, 'wrapped-skill');
  const wrapped = await previewSkillProject({ skillDir: parent });
  assert.equal(wrapped.name, 'wrapped-skill');
  assert.equal(wrapped.skillDir, path.join(parent, 'wrapped-skill'));
  assert.equal(wrapped.warnings.length, 1);

  const twin = path.join(root, 'twin-parent');
  await makeSkillDir(twin, 'skill-a');
  await makeSkillDir(twin, 'skill-b');
  await assert.rejects(
    previewSkillProject({ skillDir: twin }),
    (error) => error instanceof SkillPublishError && error.code === 'invalid_project' && /ambiguous/i.test(error.message),
  );

  const empty = path.join(root, 'empty');
  await fs.mkdir(empty, { recursive: true });
  await assert.rejects(
    previewSkillProject({ skillDir: empty }),
    (error) => error instanceof SkillPublishError && error.code === 'invalid_project' && /SKILL\.md/i.test(error.message),
  );
  await assert.rejects(
    previewSkillProject({ skillDir: path.join(root, 'no-such-dir') }),
    (error) => error instanceof SkillPublishError && error.code === 'invalid_project',
  );
});

test('packages above the 4MB cap are refused before upload', async () => {
  const root = mkdtempTempRootSync();
  const dir = await makeSkillDir(root, 'big-skill', {
    'assets/blob.bin': Buffer.alloc(MAX_SKILL_PACKAGE_BYTES + 1024, 7),
  });
  await assert.rejects(
    previewSkillProject({ skillDir: dir }),
    (error) => error instanceof SkillPublishError && error.code === 'package_too_large',
  );
});

test('publishSkill without confirm returns the awaiting-confirmation plan', async () => {
  const root = mkdtempTempRootSync();
  const dir = await makeSkillDir(root, 'demo-skill');
  const { deps, uploads, writes } = fakeDeps();
  const envelope = await publishSkill({ skillDir: dir }, deps);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.state, 'awaiting_confirmation');
  assert.equal(envelope.data.plan.name, 'demo-skill');
  assert.match(envelope.data.formatted, /--confirm/);
  assert.equal(uploads.length, 0);
  assert.equal(writes.length, 0);
});

test('publishSkill with confirm uploads the zip then writes the protocol pin', async () => {
  const root = mkdtempTempRootSync();
  const dir = await makeSkillDir(root, 'demo-skill', { 'scripts/run.js': 'export {}\n' });
  const { deps, uploads, writes } = fakeDeps();
  const envelope = await publishSkill({ skillDir: dir, confirm: true }, deps);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.state, 'success');
  const result = envelope.data;

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].contentType, 'application/zip');
  assert.equal(uploads[0].network, 'mvc');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].path, SKILL_PROTOCOL_PATH);
  assert.equal(writes[0].contentType, 'application/json');

  const payload = JSON.parse(writes[0].payload);
  assert.deepEqual(Object.keys(payload).sort(), ['description', 'name', 'skill-file', 'version']);
  assert.equal(payload.name, 'demo-skill');
  assert.equal(payload.version, '1.2.3');
  assert.equal(payload['skill-file'], `metafile://${UPLOAD_PIN_ID}.zip`);

  assert.equal(result.pinId, PROTOCOL_PIN_ID);
  assert.equal(result.skillFileUri, `metafile://${UPLOAD_PIN_ID}.zip`);
  assert.deepEqual(result.payload, payload);
  assert.match(result.formatted, new RegExp(`skills install --pin ${PROTOCOL_PIN_ID}`));
});

test('upload without metafileUri falls back to the pinId URI', async () => {
  const root = mkdtempTempRootSync();
  const dir = await makeSkillDir(root, 'fallback-skill');
  const { deps } = fakeDeps({ uploadResult: { pinId: UPLOAD_PIN_ID } });
  const envelope = await publishSkill({ skillDir: dir, confirm: true }, deps);
  assert.equal(envelope.state, 'success');
  assert.equal(envelope.data.skillFileUri, `metafile://${UPLOAD_PIN_ID}.zip`);
});

test('dependency failures surface as publish_failed', async () => {
  const root = mkdtempTempRootSync();
  const dir = await makeSkillDir(root, 'doomed-skill');
  const { deps } = fakeDeps({ uploadResult: null });
  deps.uploadFile = async () => {
    throw new Error('node unreachable');
  };
  await assert.rejects(
    publishSkill({ skillDir: dir, confirm: true }, deps),
    (error) => error instanceof SkillPublishError && error.code === 'publish_failed' && /node unreachable/.test(error.message),
  );
});

test('round trip: a published package installs cleanly from its pin payload', async () => {
  const root = mkdtempTempRootSync();
  const dir = await makeSkillDir(root, 'roundtrip-skill', {
    'scripts/run.js': 'export {}\n',
    'assets/note.txt': 'payload\n',
  });
  const { deps, writes, state } = fakeDeps();
  const envelope = await publishSkill({ skillDir: dir, confirm: true }, deps);
  assert.equal(envelope.state, 'success');
  const result = envelope.data;

  const descriptor = extractSkillPinDescriptor({ payload: JSON.parse(writes[0].payload) });
  assert.equal(descriptor.name, 'roundtrip-skill');
  assert.equal(descriptor.version, '1.2.3');
  assert.equal(descriptor.skillFileUri, result.skillFileUri);

  const skillsRoot = path.join(root, 'skills');
  const installed = await installSkillArchive({
    skillsRoot,
    archive: state.capturedArchive,
    source: {
      creatorMetaId: 'did:metaid:publisher',
      creatorName: 'Pub Bot',
      sourcePinId: result.pinId,
      skillFileUri: result.skillFileUri,
      payloadName: descriptor.name,
      payloadVersion: descriptor.version,
      payloadDescription: descriptor.description,
    },
  });
  assert.equal(installed.name, 'roundtrip-skill');
  assert.equal(installed.version, '1.2.3');
  assert.equal(installed.description, 'Publish test skill');
  assert.ok(installed.files.includes('SKILL.md'));
  assert.ok(installed.files.includes('scripts/run.js'));
  assert.ok(installed.files.includes('assets/note.txt'));

  const registry = await readInstalledSkillsRegistry(skillsRoot);
  assert.equal(registry.skills['roundtrip-skill'].sourcePinId, result.pinId);
  assert.equal(registry.skills['roundtrip-skill'].skillFileUri, result.skillFileUri);
  assert.equal(registry.skills['roundtrip-skill'].creatorName, 'Pub Bot');
});
