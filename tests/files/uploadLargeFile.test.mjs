import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DIRECT_UPLOAD_MAX_BYTES,
  LARGE_UPLOAD_MAX_BYTES,
  uploadLargeFileToChain,
} = require('../../dist/core/files/uploadLargeFile.js');

async function tempFile(name, sizeOrContent) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-large-upload-'));
  const filePath = path.join(tempDir, name);
  const content = typeof sizeOrContent === 'number'
    ? Buffer.alloc(sizeOrContent, 0x61)
    : Buffer.from(sizeOrContent);
  await writeFile(filePath, content);
  return { filePath, bytes: content.byteLength };
}

function fakeSigner(calls = []) {
  return {
    writePin: async (input) => {
      calls.push(input);
      return {
        pinId: 'direct-pin-1',
        txids: ['direct-tx-1'],
        totalCost: 321,
        network: input.network,
        operation: 'create',
        path: '/file',
        contentType: input.contentType,
        encoding: input.encoding,
        globalMetaId: 'gm-direct-alice',
        mvcAddress: '1alice',
      };
    },
  };
}

test('uploadLargeFileToChain requires a file path', async () => {
  await assert.rejects(
    () => uploadLargeFileToChain({
      filePath: '  ',
      signer: fakeSigner(),
    }),
    /filePath/i,
  );
});

test('uploadLargeFileToChain fails missing files before any upload dependency is called', async () => {
  const directCalls = [];
  const largeCalls = [];
  const missingPath = path.join(os.tmpdir(), `missing-${Date.now()}.png`);

  await assert.rejects(
    () => uploadLargeFileToChain({
      filePath: missingPath,
      signer: fakeSigner(directCalls),
      largeUploader: {
        upload: async (input) => {
          largeCalls.push(input);
          throw new Error('large uploader should not be called');
        },
      },
    }),
    (error) => {
      assert.match(error.message, /File not found/i);
      assert.doesNotMatch(error.message, new RegExp(missingPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    },
  );

  assert.equal(directCalls.length, 0);
  assert.equal(largeCalls.length, 0);
});

test('uploadLargeFileToChain rejects non-regular files without exposing absolute paths', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-large-upload-dir-'));
  const directCalls = [];

  await assert.rejects(
    () => uploadLargeFileToChain({
      filePath: tempDir,
      signer: fakeSigner(directCalls),
    }),
    (error) => {
      assert.match(error.message, /regular file/i);
      assert.doesNotMatch(error.message, new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    },
  );

  assert.equal(directCalls.length, 0);
});

test('uploadLargeFileToChain uses direct upload at exactly DIRECT_UPLOAD_MAX_BYTES', async () => {
  const { filePath } = await tempFile('exact.png', DIRECT_UPLOAD_MAX_BYTES);
  const directCalls = [];
  const largeCalls = [];

  const result = await uploadLargeFileToChain({
    filePath,
    signer: fakeSigner(directCalls),
    largeUploader: {
      upload: async (input) => {
        largeCalls.push(input);
        throw new Error('large uploader should not be called');
      },
    },
  });

  assert.equal(directCalls.length, 1);
  assert.equal(largeCalls.length, 0);
  assert.equal(result.uploadMode, 'direct');
  assert.equal(result.bytes, DIRECT_UPLOAD_MAX_BYTES);
  assert.equal(result.fileName, 'exact.png');
  assert.equal(result.filePath, filePath);
  assert.equal(result.metafileUri, 'metafile://direct-pin-1.png');
  assert.equal(result.previewUrl, 'https://file.metaid.io/metafile-indexer/api/v1/files/content/direct-pin-1');
  assert.equal(result.downloadUrl, 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/direct-pin-1');
  assert.equal(result.pinId, 'direct-pin-1');
  assert.deepEqual(result.txids, ['direct-tx-1']);
  assert.equal(result.totalCost, 321);
  assert.equal(result.network, 'mvc');
  assert.equal(result.globalMetaId, 'gm-direct-alice');
});

test('uploadLargeFileToChain calls the injected large uploader for files above DIRECT_UPLOAD_MAX_BYTES', async () => {
  const { filePath } = await tempFile('movie.mp4', DIRECT_UPLOAD_MAX_BYTES + 1);
  const directCalls = [];
  const largeCalls = [];

  const result = await uploadLargeFileToChain({
    filePath,
    network: 'mvc',
    signer: fakeSigner(directCalls),
    verify: true,
    verifyAvailability: async (pinId) => ({
      ok: pinId === 'large-pin-1',
      url: 'https://verify.example/large-pin-1',
      attempts: 2,
    }),
    largeUploader: {
      upload: async (input) => {
        largeCalls.push(input);
        return {
          pinId: 'large-pin-1',
          txids: ['large-tx-1'],
          totalCost: 999,
          network: input.network,
          fileName: input.fileName,
          contentType: input.contentType,
          bytes: input.bytes,
          extension: input.extension,
          metafileUri: 'metafile://large-pin-1.mp4',
          previewUrl: 'file:///tmp/provider/preview.mp4',
          downloadUrl: 'file:///tmp/provider/download.mp4',
          globalMetaId: 'gm-large-alice',
          uploadMode: 'chunked',
        };
      },
    },
  });

  assert.equal(directCalls.length, 0);
  assert.equal(largeCalls.length, 1);
  assert.equal(largeCalls[0].filePath, filePath);
  assert.equal(largeCalls[0].fileName, 'movie.mp4');
  assert.equal(largeCalls[0].contentType, 'video/mp4');
  assert.equal(largeCalls[0].bytes, DIRECT_UPLOAD_MAX_BYTES + 1);
  assert.equal(largeCalls[0].extension, '.mp4');
  assert.equal(largeCalls[0].network, 'mvc');

  assert.deepEqual(result, {
    pinId: 'large-pin-1',
    txids: ['large-tx-1'],
    totalCost: 999,
    network: 'mvc',
    fileName: 'movie.mp4',
    contentType: 'video/mp4',
    bytes: DIRECT_UPLOAD_MAX_BYTES + 1,
    extension: '.mp4',
    metafileUri: 'metafile://large-pin-1.mp4',
    previewUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/large-pin-1',
    downloadUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/large-pin-1',
    globalMetaId: 'gm-large-alice',
    uploadMode: 'chunked',
    verification: {
      ok: true,
      url: 'https://verify.example/large-pin-1',
      attempts: 2,
    },
  });
});

test('uploadLargeFileToChain uses orchestrator-owned metadata in large upload results', async () => {
  const { filePath } = await tempFile('source.md', 16);

  const result = await uploadLargeFileToChain({
    filePath,
    contentType: 'text/x-explicit',
    directMaxBytes: 8,
    hardMaxBytes: 64,
    network: 'mvc',
    signer: fakeSigner(),
    largeUploader: {
      upload: async () => ({
        pinId: 'large-pin-metadata',
        txids: ['large-tx-metadata'],
        totalCost: 7,
        network: 'btc',
        fileName: 'provider-secret-path.bin',
        contentType: 'application/provider-secret',
        bytes: 123456,
        extension: '.secret',
        metafileUri: 'metafile://large-pin-metadata.secret',
        previewUrl: 'file:///tmp/provider/preview',
        downloadUrl: 'file:///tmp/provider/download',
        globalMetaId: 'gm-large-metadata',
        uploadMode: 'chunked',
      }),
    },
  });

  assert.equal(result.network, 'mvc');
  assert.equal(result.fileName, 'source.md');
  assert.equal(result.contentType, 'text/x-explicit');
  assert.equal(result.bytes, 16);
  assert.equal(result.extension, '.md');
  assert.equal(result.pinId, 'large-pin-metadata');
  assert.equal(result.metafileUri, 'metafile://large-pin-metadata.secret');
  assert.equal(result.globalMetaId, 'gm-large-metadata');
  assert.equal(result.previewUrl, 'https://file.metaid.io/metafile-indexer/api/v1/files/content/large-pin-metadata');
  assert.equal(result.downloadUrl, 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/large-pin-metadata');
  assert.equal('filePath' in result, false);
});

test('uploadLargeFileToChain rejects invalid provider-owned large upload fields', async () => {
  const { filePath } = await tempFile('invalid-provider.bin', 16);

  await assert.rejects(
    () => uploadLargeFileToChain({
      filePath,
      directMaxBytes: 8,
      hardMaxBytes: 64,
      signer: fakeSigner(),
      largeUploader: {
        upload: async () => ({
          pinId: '  ',
          txids: ['large-tx-invalid'],
          totalCost: 7,
          network: 'mvc',
          fileName: 'invalid-provider.bin',
          contentType: 'application/octet-stream',
          bytes: 16,
          extension: '.bin',
          metafileUri: 'metafile://invalid-provider.bin',
          previewUrl: '',
          downloadUrl: '',
          globalMetaId: 'gm-large-invalid',
          uploadMode: 'chunked',
        }),
      },
    }),
    /pinId/i,
  );
});

test('uploadLargeFileToChain fails above LARGE_UPLOAD_MAX_BYTES before upload', async () => {
  const { filePath } = await tempFile('too-large.bin', 9);
  const directCalls = [];
  const largeCalls = [];

  await assert.rejects(
    () => uploadLargeFileToChain({
      filePath,
      directMaxBytes: 4,
      hardMaxBytes: 8,
      signer: fakeSigner(directCalls),
      largeUploader: {
        upload: async (input) => {
          largeCalls.push(input);
          throw new Error('large uploader should not be called');
        },
      },
    }),
    /8 bytes/,
  );

  assert.equal(directCalls.length, 0);
  assert.equal(largeCalls.length, 0);
});

test('uploadLargeFileToChain rejects DOGE before upload', async () => {
  const { filePath } = await tempFile('doge.png', 'doge');
  const directCalls = [];
  const largeCalls = [];

  await assert.rejects(
    () => uploadLargeFileToChain({
      filePath,
      network: 'doge',
      signer: fakeSigner(directCalls),
      largeUploader: {
        upload: async (input) => {
          largeCalls.push(input);
          throw new Error('large uploader should not be called');
        },
      },
    }),
    /DOGE is not supported/i,
  );

  assert.equal(directCalls.length, 0);
  assert.equal(largeCalls.length, 0);
});

test('uploadLargeFileToChain infers content type from extension when omitted', async () => {
  const { filePath } = await tempFile('notes.md', DIRECT_UPLOAD_MAX_BYTES + 1);
  const largeCalls = [];

  await uploadLargeFileToChain({
    filePath,
    signer: fakeSigner(),
    largeUploader: {
      upload: async (input) => {
        largeCalls.push(input);
        return {
          pinId: 'large-pin-md',
          txids: [],
          totalCost: 0,
          network: input.network,
          fileName: input.fileName,
          contentType: input.contentType,
          bytes: input.bytes,
          extension: input.extension,
          metafileUri: 'metafile://large-pin-md.md',
          previewUrl: '',
          downloadUrl: '',
          globalMetaId: 'gm-large-alice',
          uploadMode: 'chunked',
        };
      },
    },
  });

  assert.equal(largeCalls[0].contentType, 'text/markdown');
});

test('uploadLargeFileToChain honors explicit content type', async () => {
  const { filePath } = await tempFile('photo.png', DIRECT_UPLOAD_MAX_BYTES + 1);
  const largeCalls = [];

  await uploadLargeFileToChain({
    filePath,
    contentType: 'application/x-custom-image',
    signer: fakeSigner(),
    largeUploader: {
      upload: async (input) => {
        largeCalls.push(input);
        return {
          pinId: 'large-pin-custom',
          txids: [],
          totalCost: 0,
          network: input.network,
          fileName: input.fileName,
          contentType: input.contentType,
          bytes: input.bytes,
          extension: input.extension,
          metafileUri: 'metafile://large-pin-custom.png',
          previewUrl: '',
          downloadUrl: '',
          globalMetaId: 'gm-large-alice',
          uploadMode: 'chunked',
        };
      },
    },
  });

  assert.equal(largeCalls[0].contentType, 'application/x-custom-image');
});

test('uploadLargeFileToChain requires an injected large uploader for large files', async () => {
  const { filePath } = await tempFile('large.zip', DIRECT_UPLOAD_MAX_BYTES + 1);
  const directCalls = [];

  await assert.rejects(
    () => uploadLargeFileToChain({
      filePath,
      signer: fakeSigner(directCalls),
    }),
    /large_file_upload_unavailable/i,
  );

  assert.equal(directCalls.length, 0);
});

test('uploadLargeFileToChain rejects non-MVC large uploads before upload', async () => {
  const { filePath } = await tempFile('large.zip', DIRECT_UPLOAD_MAX_BYTES + 1);
  const largeCalls = [];

  await assert.rejects(
    () => uploadLargeFileToChain({
      filePath,
      network: 'btc',
      signer: fakeSigner(),
      largeUploader: {
        upload: async (input) => {
          largeCalls.push(input);
          throw new Error('large uploader should not be called');
        },
      },
    }),
    /Large file upload currently supports MVC only/i,
  );

  assert.equal(largeCalls.length, 0);
});
