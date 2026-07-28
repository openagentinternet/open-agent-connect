import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { publishMetaApp, updateMetaApp } = require('../../dist/core/metaapp/publish.js');

const CREATE_PIN = `${'a'.repeat(64)}i0`;
const SOURCE_PIN = `${'f'.repeat(64)}i0`;
const OVERRIDE_PIN = `${'0'.repeat(64)}i0`;
const UPDATE_TARGET_PIN = `${'b'.repeat(64)}i0`;
const UPDATE_PIN = `${'c'.repeat(64)}i0`;

async function writeProjectFile(projectDir, relativePath, content) {
  const filePath = path.join(projectDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

async function makeStaticProject(prefix, { manifest = {}, marker, appDoc } = {}) {
  const projectDir = await mkdtempTempRoot(`metabot-metaapp-fork-${prefix}-`);
  await writeProjectFile(projectDir, 'index.html', '<h1>Remixed MetaApp</h1>');
  await writeProjectFile(projectDir, 'assets/app.js', 'console.log("remix");');
  if (Object.keys(manifest).length > 0) {
    await writeProjectFile(projectDir, '.metaapp.json', JSON.stringify(manifest));
  }
  if (marker) {
    await writeProjectFile(projectDir, '.metaapp-fork.json', JSON.stringify({
      sourcePinId: SOURCE_PIN,
      sourceUri: `metaapp://${SOURCE_PIN}`,
      title: 'Original App',
      indexFile: 'index.html',
      tags: ['game', 'simplebuzz'],
      forkedAt: '2026-07-26T10:00:00.000Z',
      ...marker,
    }));
  }
  if (appDoc) {
    await writeProjectFile(projectDir, 'APP.md', '# Remixed MetaApp\n\nA dark-mode remix of the original app.\n');
  }
  return projectDir;
}

function createDeps(overrides = {}) {
  const calls = [];
  const deps = {
    calls,
    now: () => 1_700_000_000_000,
    async makeTempDir() {
      return mkdtempTempRoot('metabot-metaapp-fork-archive-');
    },
    async uploadFile(input) {
      calls.push({ type: 'upload', input });
      return {
        pinId: 'upload-pin',
        txids: ['upload-tx'],
        network: input.network ?? 'mvc',
        filePath: input.filePath,
        contentType: input.contentType,
        bytes: 123,
        metafileUri: 'metafile://upload-pin.zip',
        globalMetaId: 'owner-meta-id',
      };
    },
    async writeChain(input) {
      calls.push({ type: 'write', input });
      const pinId = input.operation === 'modify' ? UPDATE_PIN : CREATE_PIN;
      return {
        pinId,
        firstPinId: input.operation === 'modify' ? UPDATE_TARGET_PIN : CREATE_PIN,
        txids: [`${pinId.slice(0, 6)}-tx`],
        totalCost: 1,
        network: input.network ?? 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
        globalMetaId: 'owner-meta-id',
        mvcAddress: 'owner-address',
      };
    },
    async upsertLocal(record) {
      calls.push({ type: 'upsert', input: record });
      return { ok: true };
    },
    ...overrides,
  };
  return deps;
}

function writePayload(calls, index = 0) {
  const write = calls.filter((call) => call.type === 'write')[index];
  assert.ok(write, 'expected a chain write call');
  return JSON.parse(write.input.payload);
}

test('publishMetaApp defaults forkedFrom and tags from the fork marker', async () => {
  const projectDir = await makeStaticProject('defaults', { marker: true });
  const deps = createDeps();

  const result = await publishMetaApp({ projectDir, confirm: true }, deps);

  assert.equal(result.state, 'success');
  const payload = writePayload(deps.calls);
  assert.equal(payload.forkedFrom, SOURCE_PIN);
  assert.deepEqual(payload.tags, ['game', 'simplebuzz']);
  // No APP.md in this project: the envelope must say so for the skill nudge.
  assert.equal(result.data.hasAppDoc, false);
  // The marker is local provenance and must never ship inside the zip.
  assert.ok(result.data.archive.entries.includes('index.html'));
  assert.ok(result.data.archive.entries.includes('assets/app.js'));
  assert.ok(!result.data.archive.entries.includes('.metaapp-fork.json'));
});

test('publishMetaApp explicit manifest tags and forkedFrom win over marker defaults', async () => {
  const projectDir = await makeStaticProject('override', {
    marker: true,
    manifest: { tags: ['custom'], forkedFrom: OVERRIDE_PIN, prompt: 'make it dark mode' },
  });
  const deps = createDeps();

  const result = await publishMetaApp({ projectDir, confirm: true }, deps);

  assert.equal(result.state, 'success');
  const payload = writePayload(deps.calls);
  assert.equal(payload.forkedFrom, OVERRIDE_PIN);
  assert.deepEqual(payload.tags, ['custom']);
  // The modification instruction keeps flowing through the manifest prompt field.
  assert.equal(payload.prompt, 'make it dark mode');
});

test('publishMetaApp without a fork marker leaves forkedFrom unset', async () => {
  const projectDir = await makeStaticProject('original', { manifest: { tags: ['tool'] } });
  const deps = createDeps();

  const result = await publishMetaApp({ projectDir, confirm: true }, deps);

  assert.equal(result.state, 'success');
  const payload = writePayload(deps.calls);
  assert.equal(payload.forkedFrom, undefined);
  assert.deepEqual(payload.tags, ['tool']);
  assert.equal(result.data.hasAppDoc, false);
});

test('publishMetaApp ships APP.md and reports hasAppDoc when the doc exists at the package root', async () => {
  const projectDir = await makeStaticProject('appdoc', { marker: true, appDoc: true });
  const deps = createDeps();

  const preview = await publishMetaApp({ projectDir, confirm: false }, deps);
  assert.equal(preview.state, 'awaiting_confirmation');
  assert.equal(preview.data.hasAppDoc, true);
  assert.equal(preview.data.payloadPreview.forkedFrom, SOURCE_PIN);
  assert.deepEqual(preview.data.payloadPreview.tags, ['game', 'simplebuzz']);
  assert.ok(preview.data.archivePreview.entries.includes('APP.md'));
  assert.ok(!preview.data.archivePreview.entries.includes('.metaapp-fork.json'));

  const result = await publishMetaApp({ projectDir, confirm: true }, deps);
  assert.equal(result.state, 'success');
  assert.equal(result.data.hasAppDoc, true);
  assert.ok(result.data.archive.entries.includes('APP.md'));
  assert.ok(!result.data.archive.entries.includes('.metaapp-fork.json'));
  assert.equal(writePayload(deps.calls).forkedFrom, SOURCE_PIN);
});

test('updateMetaApp keeps marker-driven forkedFrom and reports hasAppDoc', async () => {
  const projectDir = await makeStaticProject('update', { marker: true, appDoc: true });
  const deps = createDeps();

  const result = await updateMetaApp({ projectDir, targetPinId: UPDATE_TARGET_PIN, confirm: true }, deps);

  assert.equal(result.state, 'success');
  const payload = writePayload(deps.calls);
  assert.equal(payload.forkedFrom, SOURCE_PIN);
  assert.deepEqual(payload.tags, ['game', 'simplebuzz']);
  assert.equal(result.data.hasAppDoc, true);
  assert.ok(result.data.archive.entries.includes('APP.md'));
  assert.ok(!result.data.archive.entries.includes('.metaapp-fork.json'));
});
