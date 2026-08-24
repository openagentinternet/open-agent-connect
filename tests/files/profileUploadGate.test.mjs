import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  createProfileScopedUpload,
  UploadOutsideWorkspaceError,
} = require('../../dist/core/files/profileUploadGate.js');
const { isPathInsideDir } = require('../../dist/core/files/chainUploadGate.js');

function makeHome(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'bot-1');
  mkdirSync(path.join(homeDir, 'workspace'), { recursive: true });
  return { systemHome, homeDir };
}

test('in-workspace file uploads; outside file refuses; consent flag honors approval', async () => {
  const { homeDir, systemHome } = makeHome('metabot-gate-p0-');
  const inside = path.join(homeDir, 'workspace', 'poster.png');
  writeFileSync(inside, 'png');
  const secret = path.join(systemHome, 'secret.env');
  writeFileSync(secret, 'KEY=1');

  const uploads = [];
  const logs = [];
  const gate = createProfileScopedUpload({
    profileHomeDir: async () => homeDir,
    upload: async ({ filePath }) => {
      uploads.push(filePath);
      return { metafileUri: `metafile://up-${uploads.length}`, pinId: `p${uploads.length}` };
    },
    log: (message) => logs.push(message),
  });

  const ok = await gate({ slug: 'bot-1', filePath: inside });
  assert.equal(ok.metafileUri, 'metafile://up-1');
  assert.deepEqual(uploads, [inside]);

  await assert.rejects(
    gate({ slug: 'bot-1', filePath: secret }),
    (error) => error instanceof UploadOutsideWorkspaceError,
  );
  assert.deepEqual(uploads, [inside], 'nothing left the machine on refusal');
  assert.ok(logs.some((line) => line.includes('REFUSED external upload')));

  const consentGate = createProfileScopedUpload({
    profileHomeDir: async () => homeDir,
    confirmExternalUpload: true,
    upload: async ({ filePath }) => {
      uploads.push(filePath);
      return { metafileUri: 'metafile://ok', pinId: 'p-ok' };
    },
  });
  const approved = await consentGate({ slug: 'bot-1', filePath: secret });
  assert.equal(approved.metafileUri, 'metafile://ok');
  assert.deepEqual(uploads, [inside, secret]);

  const callbackGate = createProfileScopedUpload({
    profileHomeDir: async () => homeDir,
    confirmExternalUpload: async ({ filePath }) => filePath === secret,
    upload: async ({ filePath }) => {
      uploads.push(filePath);
      return { metafileUri: 'metafile://cb', pinId: 'p-cb' };
    },
  });
  await callbackGate({ slug: 'bot-1', filePath: secret });
  await assert.rejects(callbackGate({ slug: 'bot-1', filePath: path.join(systemHome, 'other.txt') }),
    (error) => error instanceof UploadOutsideWorkspaceError);
});

test('unknown profile is outside by definition; symlink escape refused', async () => {
  const { homeDir, systemHome } = makeHome('metabot-gate-p0b-');
  const secret = path.join(systemHome, 'id_rsa');
  writeFileSync(secret, 'key');
  const link = path.join(homeDir, 'leak');
  symlinkSync(secret, link);

  const uploads = [];
  const gate = createProfileScopedUpload({
    profileHomeDir: async (slug) => (slug === 'bot-1' ? homeDir : null),
    upload: async ({ filePath }) => {
      uploads.push(filePath);
      return { metafileUri: 'x' };
    },
  });
  await assert.rejects(
    gate({ slug: 'ghost', filePath: path.join(homeDir, 'f.txt') }),
    (error) => error instanceof UploadOutsideWorkspaceError,
    'unknown profile cannot vouch for any path',
  );
  await assert.rejects(
    gate({ slug: 'bot-1', filePath: link }),
    (error) => error instanceof UploadOutsideWorkspaceError,
    'symlink inside workspace pointing outside is refused',
  );
  assert.deepEqual(uploads, []);
  assert.equal(isPathInsideDir(link, homeDir), false);
});

test('daemon engine construction passes a gated deliverable upload (source wiring)', async () => {
  const fs = await import('node:fs');
  const runtime = fs.readFileSync('src/cli/runtime.ts', 'utf8');
  assert.match(runtime, /uploadDeliverableFile: gatedDeliverableUpload/, 'engine gets the gated seam');
  assert.match(runtime, /createProfileScopedUpload\(/, 'gate helper is used');
  const handlers = fs.readFileSync('src/daemon/defaultHandlers.ts', 'utf8');
  assert.match(handlers, /publishSimpleNote\(\s*actor\.signer,\s*async \(\{ filePath, network: uploadNetwork \}\) => gatedUpload/, 'simplenote daemon path is gated');
  const tool = fs.readFileSync('dsh-plugin/src/simplenote-tools.ts', 'utf8');
  assert.match(tool, /confirmExternalUpload: true/, 'DSH tool forwards the consent flag');
});
