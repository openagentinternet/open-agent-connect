import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  uploadLocalFileToChain,
  inferUploadContentType,
} = require('../../dist/core/files/uploadFile.js');

test('inferUploadContentType maps common file extensions and falls back to octet-stream', () => {
  assert.equal(inferUploadContentType('/tmp/photo.png'), 'image/png');
  assert.equal(inferUploadContentType('/tmp/readme.md'), 'text/markdown');
  assert.equal(inferUploadContentType('/tmp/archive.unknown'), 'application/octet-stream');
});

test('uploadLocalFileToChain reads the local file, writes /file to chain, and returns a metafile URI', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-file-upload-'));
  const filePath = path.join(tempDir, 'photo.png');
  await writeFile(filePath, Buffer.from('hello metabot file'));

  const calls = [];
  const result = await uploadLocalFileToChain({
    filePath,
    signer: {
      writePin: async (input) => {
        calls.push(input);
        return {
          pinId: 'file-pin-1',
          txids: ['file-tx-1'],
          totalCost: 123,
          network: 'mvc',
          operation: 'create',
          path: '/file',
          contentType: input.contentType,
          encoding: input.encoding,
          globalMetaId: 'gm-local-alice',
          mvcAddress: '1alice',
        };
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/file');
  assert.equal(calls[0].encoding, 'base64');
  assert.equal(calls[0].contentType, 'image/png');
  assert.equal(typeof calls[0].payload, 'string');
  assert.equal(Buffer.from(calls[0].payload, 'base64').toString('utf8'), 'hello metabot file');

  assert.deepEqual(result, {
    pinId: 'file-pin-1',
    txids: ['file-tx-1'],
    totalCost: 123,
    network: 'mvc',
    filePath,
    fileName: 'photo.png',
    contentType: 'image/png',
    bytes: 18,
    extension: '.png',
    metafileUri: 'metafile://file-pin-1.png',
    globalMetaId: 'gm-local-alice',
  });
});

test('uploadLocalFileToChain rejects DOGE file uploads before writing to chain', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-file-upload-doge-'));
  const filePath = path.join(tempDir, 'photo.png');
  await writeFile(filePath, Buffer.from('hello doge guard'));

  const calls = [];
  await assert.rejects(
    () => uploadLocalFileToChain({
      filePath,
      network: 'doge',
      signer: {
        writePin: async (input) => {
          calls.push(input);
          throw new Error('writePin should not be called');
        },
      },
    }),
    /DOGE is not supported for file upload/i,
  );
  assert.equal(calls.length, 0);
});
