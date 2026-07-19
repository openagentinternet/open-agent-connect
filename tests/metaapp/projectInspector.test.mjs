import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  inspectMetaAppProject,
} = require('../../dist/core/metaapp/projectInspector.js');
const {
  buildMetaAppManifestDraft,
} = require('../../dist/core/metaapp/manifest.js');
const {
  normalizeMetaAppPinId,
} = require('../../dist/core/metaapp/pinId.js');
const {
  writeMetaAppZipArchive,
} = require('../../dist/core/metaapp/zipArchive.js');

async function makeTempProject(prefix) {
  return mkdtempTempRoot(`metabot-metaapp-${prefix}-`);
}

async function writeProjectFile(projectDir, relativePath, content) {
  const filePath = path.join(projectDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

function listZipEntries(buffer) {
  const entries = [];
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  assert.notEqual(eocdOffset, -1, 'zip end-of-central-directory record should exist');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(centralOffset), 0x02014b50);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const nameStart = centralOffset + 46;
    entries.push(buffer.subarray(nameStart, nameStart + nameLength).toString('utf8'));
    centralOffset = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

test('inspectMetaAppProject detects a static index.html project at the project root', async () => {
  const projectDir = await makeTempProject('static');
  await writeProjectFile(projectDir, 'index.html', '<h1>Static app</h1>');

  const plan = await inspectMetaAppProject({ projectDir });
  const manifest = buildMetaAppManifestDraft(plan);

  assert.equal(plan.projectType, 'static');
  assert.equal(plan.projectDir, projectDir);
  assert.equal(plan.artifactDir, projectDir);
  assert.equal(plan.indexFile, 'index.html');
  assert.equal(plan.manualAction, undefined);
  assert.equal(manifest.runtime, 'browser');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.contentType, 'application/zip');
  assert.equal(manifest.codeType, 'application/zip');
  assert.equal(manifest.indexFile, 'index.html');
  assert.equal(manifest.code, '');
  assert.equal(manifest.content, '');
  assert.equal(manifest.metadata, undefined);
});

test('inspectMetaAppProject detects an npm package with an existing dist/index.html output', async () => {
  const projectDir = await makeTempProject('npm-dist');
  await writeProjectFile(projectDir, 'package.json', JSON.stringify({
    scripts: {
      build: 'vite build',
    },
  }));
  await writeProjectFile(projectDir, 'package-lock.json', '{}');
  await writeProjectFile(projectDir, 'dist/index.html', '<h1>Built app</h1>');

  const plan = await inspectMetaAppProject({ projectDir });

  assert.equal(plan.projectType, 'npm');
  assert.equal(plan.artifactDir, path.join(projectDir, 'dist'));
  assert.equal(plan.indexFile, 'index.html');
  assert.equal(plan.buildCommand, 'npm run build');
  assert.equal(plan.packageManager, 'npm');
  assert.equal(plan.manualAction, undefined);
});

test('inspectMetaAppProject returns manual action when package build output is missing', async () => {
  const projectDir = await makeTempProject('missing-output');
  await writeProjectFile(projectDir, 'package.json', JSON.stringify({
    scripts: {
      build: 'vite build',
    },
  }));

  const plan = await inspectMetaAppProject({ projectDir });

  assert.equal(plan.projectType, 'npm');
  assert.equal(plan.artifactDir, null);
  assert.equal(plan.manualAction.code, 'metaapp_build_output_missing');
});

test('inspectMetaAppProject applies .metaapp.json manifest overrides', async () => {
  const projectDir = await makeTempProject('local-manifest');
  await writeProjectFile(projectDir, 'index.html', '<h1>Manifest app</h1>');
  await writeProjectFile(projectDir, '.metaapp.json', JSON.stringify({
    title: 'Manifest Title',
    appName: 'manifest-app',
    intro: 'A local manifest override',
    version: '2.3.4',
    tags: ['game', 'demo'],
    icon: 'icon.png',
    coverImg: 'cover.png',
    indexFile: 'app.html',
  }));

  const plan = await inspectMetaAppProject({ projectDir });
  const manifest = buildMetaAppManifestDraft(plan);

  assert.equal(manifest.title, 'Manifest Title');
  assert.equal(manifest.appName, 'manifest-app');
  assert.equal(manifest.intro, 'A local manifest override');
  assert.equal(manifest.version, '2.3.4');
  assert.deepEqual(manifest.tags, ['game', 'demo']);
  assert.equal(manifest.icon, 'icon.png');
  assert.equal(manifest.coverImg, 'cover.png');
  assert.equal(manifest.indexFile, 'app.html');
});

test('inspectMetaAppProject resolves --manifest-file overrides against caller cwd', async () => {
  const cwd = await makeTempProject('caller-cwd');
  const projectDir = path.join(cwd, 'site');
  await writeProjectFile(projectDir, 'index.html', '<h1>Manifest file app</h1>');
  await writeProjectFile(cwd, 'manifest.json', JSON.stringify({
    title: 'External Title',
    appName: 'external-app',
    intro: 'An external manifest override',
    version: '3.0.0',
    tags: ['external'],
    icon: 'assets/icon.png',
    coverImg: 'assets/cover.png',
    indexFile: 'custom.html',
    metadata: {
      user: {
        campaign: 'launch',
      },
    },
    ignoredUnknownField: 'not copied',
  }));

  const plan = await inspectMetaAppProject({
    cwd,
    projectDir: 'site',
    manifestFile: 'manifest.json',
  });
  const manifest = buildMetaAppManifestDraft(plan);

  assert.equal(plan.projectDir, projectDir);
  assert.equal(manifest.title, 'External Title');
  assert.equal(manifest.appName, 'external-app');
  assert.equal(manifest.intro, 'An external manifest override');
  assert.equal(manifest.version, '3.0.0');
  assert.deepEqual(manifest.tags, ['external']);
  assert.equal(manifest.icon, 'assets/icon.png');
  assert.equal(manifest.coverImg, 'assets/cover.png');
  assert.equal(manifest.indexFile, 'custom.html');
  assert.deepEqual(manifest.metadata.user, { campaign: 'launch' });
  assert.equal(manifest.metadata.ignoredUnknownField, undefined);
});

test('inspectMetaAppProject returns manual action for unsupported project shapes', async () => {
  const projectDir = await makeTempProject('unsupported');
  await writeProjectFile(projectDir, 'README.md', '# Not a browser app');

  const plan = await inspectMetaAppProject({ projectDir });

  assert.equal(plan.projectType, 'manual');
  assert.equal(plan.artifactDir, null);
  assert.equal(plan.manualAction.code, 'metaapp_project_unrecognized');
});

test('normalizeMetaAppPinId accepts canonical pinIds and rejects blank or path-like values', () => {
  const pinId = `${'a'.repeat(64)}i0`;

  assert.equal(normalizeMetaAppPinId(pinId), pinId);
  assert.equal(normalizeMetaAppPinId(''), null);
  assert.equal(normalizeMetaAppPinId('   '), null);
  assert.equal(normalizeMetaAppPinId('../secret'), null);
  assert.equal(normalizeMetaAppPinId('/tmp/secret'), null);
  assert.equal(normalizeMetaAppPinId(`${'a'.repeat(64)}i1`), null);
});

test('writeMetaAppZipArchive includes nested relative files and excludes unsafe paths', async () => {
  const projectDir = await makeTempProject('zip');
  // Keep the archive outside the source dir but inside a tracked temp root so
  // it does not leak into the shared os.tmpdir().
  const outFile = path.join(await mkdtempTempRoot('metabot-metaapp-zip-out-'), 'metaapp.zip');
  await writeProjectFile(projectDir, 'index.html', '<h1>Zip app</h1>');
  await writeProjectFile(projectDir, 'assets/app.js', 'console.log("zip");');
  await writeProjectFile(projectDir, 'nested/deep/style.css', 'body { color: black; }');
  await writeProjectFile(projectDir, '.git/config', '[core]');
  await writeProjectFile(projectDir, 'node_modules/pkg/index.js', 'module.exports = {};');
  await writeProjectFile(projectDir, '.runtime/state.json', '{}');
  await writeProjectFile(projectDir, '.DS_Store', 'noise');

  const result = await writeMetaAppZipArchive({ sourceDir: projectDir, outFile });
  const buffer = await readFile(result.filePath);
  const entries = listZipEntries(buffer);

  assert.deepEqual(result.entries, [
    'assets/app.js',
    'index.html',
    'nested/deep/style.css',
  ]);
  assert.deepEqual(entries, result.entries);
  assert.equal(entries.some((entry) => path.isAbsolute(entry)), false);
  assert.equal(entries.some((entry) => entry.includes('..')), false);
  assert.equal(entries.some((entry) => entry.startsWith('.git/')), false);
  assert.equal(entries.some((entry) => entry.startsWith('node_modules/')), false);
  assert.equal(entries.some((entry) => entry.startsWith('.runtime/')), false);
  assert.equal(entries.includes('.DS_Store'), false);
  assert.equal(result.bytes, buffer.byteLength);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});
