import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  uploadFileBufferToChain,
  uploadLocalFileToChain,
  inferUploadContentType,
} = require('../../dist/core/files/uploadFile.js');

test('inferUploadContentType maps common file extensions and falls back to octet-stream', () => {
  assert.equal(inferUploadContentType('/tmp/photo.png'), 'image/png');
  assert.equal(inferUploadContentType('/tmp/readme.md'), 'text/markdown');
  assert.equal(inferUploadContentType('/tmp/archive.unknown'), 'application/octet-stream');
});

test('uploadLocalFileToChain reads the local file, writes /file to chain, and returns a metafile URI', async () => {
  const tempDir = await mkdtempTempRoot('metabot-file-upload-');
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
  assert.equal(calls[0].encoding, 'binary');
  assert.equal(calls[0].contentType, 'image/png');
  assert.equal(Buffer.isBuffer(calls[0].payload), true);
  assert.equal(calls[0].payload.toString('utf8'), 'hello metabot file');

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
    metawebUrl: 'https://openagentinternet.org/browser/metafile/file-pin-1',
    globalMetaId: 'gm-local-alice',
  });
});

test('uploadLocalFileToChain appends a content type extension when the file name has none', async () => {
  const tempDir = await mkdtempTempRoot('metabot-file-upload-mime-');
  const filePath = path.join(tempDir, 'homepage');
  await writeFile(filePath, Buffer.from('<!doctype html>'));

  const result = await uploadLocalFileToChain({
    filePath,
    contentType: 'text/html',
    signer: {
      writePin: async (input) => ({
        pinId: 'html-pin-1',
        txids: ['html-tx-1'],
        totalCost: 99,
        network: 'mvc',
        operation: 'create',
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'gm-local-alice',
        mvcAddress: '1alice',
      }),
    },
  });

  assert.equal(result.extension, '.html');
  assert.equal(result.contentType, 'text/html');
  assert.equal(result.metafileUri, 'metafile://html-pin-1.html');
  assert.equal(result.metawebUrl, 'https://openagentinternet.org/browser/metafile/html-pin-1');
});

test('uploadFileBufferToChain appends a content type extension when the file name has none', async () => {
  const result = await uploadFileBufferToChain({
    fileName: 'avatar',
    data: Buffer.from('png bytes'),
    contentType: 'image/png',
    signer: {
      writePin: async (input) => ({
        pinId: 'buffer-pin-1',
        txids: ['buffer-tx-1'],
        totalCost: 100,
        network: 'mvc',
        operation: 'create',
        path: input.path,
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'gm-local-alice',
        mvcAddress: '1alice',
      }),
    },
  });

  assert.equal(result.extension, '.png');
  assert.equal(result.contentType, 'image/png');
  assert.equal(result.metafileUri, 'metafile://buffer-pin-1.png');
  assert.equal(result.metawebUrl, 'https://openagentinternet.org/browser/metafile/buffer-pin-1');
});

test('uploadLocalFileToChain rejects DOGE file uploads before writing to chain', async () => {
  const tempDir = await mkdtempTempRoot('metabot-file-upload-doge-');
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
