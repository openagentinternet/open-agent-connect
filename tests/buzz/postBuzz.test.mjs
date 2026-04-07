import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { postBuzzToChain } = require('../../dist/core/buzz/postBuzz.js');

test('postBuzzToChain uploads attachments first and then writes a simplebuzz payload with metafile URIs', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-buzz-post-'));
  const attachmentPath = path.join(tempDir, 'photo.png');
  await writeFile(attachmentPath, Buffer.from('hello photo'));

  const calls = [];
  const result = await postBuzzToChain({
    content: 'hello metabot buzz',
    attachments: [attachmentPath],
    signer: {
      writePin: async (input) => {
        calls.push(input);
        if (input.path === '/file') {
          return {
            pinId: 'file-pin-1',
            txids: ['file-tx-1'],
            totalCost: 111,
            network: 'mvc',
            operation: 'create',
            path: '/file',
            contentType: input.contentType,
            encoding: input.encoding,
            globalMetaId: 'gm-local-alice',
            mvcAddress: '1alice',
          };
        }
        return {
          pinId: 'buzz-pin-1',
          txids: ['buzz-tx-1'],
          totalCost: 222,
          network: 'mvc',
          operation: 'create',
          path: '/protocols/simplebuzz',
          contentType: input.contentType,
          encoding: input.encoding,
          globalMetaId: 'gm-local-alice',
          mvcAddress: '1alice',
        };
      },
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, '/file');
  assert.equal(calls[1].path, '/protocols/simplebuzz');

  const payload = JSON.parse(calls[1].payload);
  assert.deepEqual(payload, {
    content: 'hello metabot buzz',
    contentType: 'text/plain;utf-8',
    attachments: ['metafile://file-pin-1.png'],
    quotePin: '',
  });

  assert.deepEqual(result, {
    pinId: 'buzz-pin-1',
    txids: ['buzz-tx-1'],
    totalCost: 222,
    network: 'mvc',
    content: 'hello metabot buzz',
    contentType: 'text/plain;utf-8',
    attachments: ['metafile://file-pin-1.png'],
    uploadedFiles: [
      {
        pinId: 'file-pin-1',
        txids: ['file-tx-1'],
        totalCost: 111,
        network: 'mvc',
        filePath: attachmentPath,
        fileName: 'photo.png',
        contentType: 'image/png',
        bytes: 11,
        extension: '.png',
        metafileUri: 'metafile://file-pin-1.png',
        globalMetaId: 'gm-local-alice',
      },
    ],
    globalMetaId: 'gm-local-alice',
  });
});
