import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const dist = require('../../dist/core/qanda/publish.js');

function fakeSigner() {
  const writes = [];
  return {
    writes,
    signer: {
      getIdentity: async () => ({}),
      getPrivateChatIdentity: async () => ({}),
      writePin: async (request) => {
        writes.push(request);
        return {
          pinId: `${'a'.repeat(64)}i0`,
          txids: ['tx1'],
          totalCost: 1234,
          network: request.network,
        };
      },
    },
  };
}

function fakeUpload() {
  const uploads = [];
  return {
    uploads,
    upload: async ({ filePath, network }) => {
      uploads.push({ filePath, network });
      return { metafileUri: `metafile://${path.basename(filePath)}.i0` };
    },
  };
}

test('simplequestion payload is minimal: no createTime, empty optionals omitted, contentType only with content', async () => {
  const { signer, writes } = fakeSigner();
  const { upload } = fakeUpload();
  const result = await dist.publishSimpleQuestion(signer, upload, { title: 'How do I recover a wallet?' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/protocols/simplequestion');
  assert.equal(writes[0].version, '1.0.0');
  assert.equal(writes[0].encryption, '0');
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].contentType, 'application/json');
  assert.deepEqual(JSON.parse(writes[0].payload), { title: 'How do I recover a wallet?' });
  assert.equal(result.pinId, 'a'.repeat(64) + 'i0');
  assert.equal(result.title, 'How do I recover a wallet?');
});

test('simplequestion with content/tags/uploads builds the full payload', async () => {
  const { signer, writes } = fakeSigner();
  const { upload, uploads } = fakeUpload();
  const tmpDir = mkdtempTempRootSync('metabot-qa-question-files-');
  const filePath = path.join(tmpDir, 'screenshot.png');
  const fs = await import('node:fs');
  fs.writeFileSync(filePath, 'png');
  await dist.publishSimpleQuestion(signer, upload, {
    title: 'Stuck task',
    content: 'Full context',
    tags: ['oac', ' '],
    attachments: [filePath, 'metafile://existing.i0'],
  });
  const payload = JSON.parse(writes[0].payload);
  assert.deepEqual(payload, {
    title: 'Stuck task',
    content: 'Full context',
    contentType: 'text/markdown',
    tags: ['oac'],
    attachments: [`metafile://screenshot.png.i0`, 'metafile://existing.i0'],
  });
  assert.deepEqual(uploads, [{ filePath, network: 'mvc' }], 'metafile:// passes through untouched');
});

test('simplequestion validates title and rejects relative/missing attachments', async () => {
  const { signer } = fakeSigner();
  const { upload } = fakeUpload();
  await assert.rejects(
    () => dist.publishSimpleQuestion(signer, upload, { title: '   ' }),
    /requires `title`/,
  );
  await assert.rejects(
    () => dist.publishSimpleQuestion(signer, upload, { title: 'q', attachments: ['relative.png'] }),
    /ABSOLUTE local file paths/,
  );
  await assert.rejects(
    () => dist.publishSimpleQuestion(signer, upload, { title: 'q', attachments: ['/no/such/file.png'] }),
    /file not found/,
  );
});

test('doge write uploads files on mvc only', async () => {
  const { signer, writes } = fakeSigner();
  const { upload, uploads } = fakeUpload();
  const tmpDir = mkdtempTempRootSync('metabot-qa-doge-');
  const filePath = path.join(tmpDir, 'log.txt');
  const fs = await import('node:fs');
  fs.writeFileSync(filePath, 'log');
  await dist.publishSimpleAnswer(signer, upload, {
    answerTo: 'b'.repeat(64) + 'i0',
    content: 'answer body',
    attachments: [filePath],
    network: 'doge',
  });
  assert.equal(uploads[0].network, 'mvc', 'file upload forced to mvc for a doge pin write');
  assert.equal(writes[0].network, 'doge');
});

test('simpleanswer payload: contentType only when passed, no default', async () => {
  const { signer, writes } = fakeSigner();
  const { upload } = fakeUpload();
  await dist.publishSimpleAnswer(signer, upload, {
    answerTo: 'c'.repeat(64) + 'i0',
    content: 'the answer',
  });
  assert.deepEqual(JSON.parse(writes[0].payload), {
    answerTo: 'c'.repeat(64) + 'i0',
    content: 'the answer',
  });
  assert.equal(writes[0].path, '/protocols/simpleanswer');

  await dist.publishSimpleAnswer(signer, upload, {
    answerTo: 'c'.repeat(64) + 'i0',
    content: 'the answer',
    contentType: 'text/plain',
    tags: ['x'],
  });
  assert.deepEqual(JSON.parse(writes[1].payload), {
    answerTo: 'c'.repeat(64) + 'i0',
    content: 'the answer',
    contentType: 'text/plain',
    tags: ['x'],
  });
});

test('simpleanswer validates both required fields', async () => {
  const { signer } = fakeSigner();
  const { upload } = fakeUpload();
  await assert.rejects(
    () => dist.publishSimpleAnswer(signer, upload, { answerTo: '', content: 'x' }),
    /requires both `answer_to`/,
  );
  await assert.rejects(
    () => dist.publishSimpleAnswer(signer, upload, { answerTo: 'p', content: '' }),
    /requires both `answer_to`/,
  );
});

test('like_pin writes the exact paylike payload and validates is_like defensively', async () => {
  const { signer, writes } = fakeSigner();
  const target = 'd'.repeat(64) + 'i0';
  for (const isLike of [1, -1, 0]) {
    await dist.publishLikePin(signer, { pinId: target, isLike });
  }
  assert.equal(writes.length, 3);
  for (const write of writes) {
    assert.equal(write.path, '/protocols/paylike');
    assert.equal(write.version, '1.0.0');
    assert.deepEqual(Object.keys(JSON.parse(write.payload)).sort(), ['isLike', 'likeTo']);
    assert.equal(JSON.parse(write.payload).likeTo, target);
  }
  assert.deepEqual(writes.map((write) => JSON.parse(write.payload).isLike), [1, -1, 0]);
  await assert.rejects(
    () => dist.publishLikePin(signer, { pinId: target, isLike: 2 }),
    /must be exactly 1/,
  );
  await assert.rejects(
    () => dist.publishLikePin(signer, { pinId: '', isLike: 1 }),
    /requires `pin_id`/,
  );
});

test('success sheets carry pin:// view links and the answer-count note', () => {
  const question = dist.formatSimpleQuestionResult({
    pinId: 'e'.repeat(64) + 'i0',
    txids: ['tx'],
    totalCost: 55,
    title: 'T',
    attachments: [],
  });
  assert.match(question, /Question published on-chain\./);
  assert.match(question, /\[pin:\/\//);
  const answer = dist.formatSimpleAnswerResult({
    pinId: 'f'.repeat(64) + 'i0',
    txids: [],
    totalCost: 66,
    questionPinId: 'q',
    attachments: [],
    priorAnswerCount: 2,
  });
  assert.match(answer, /this is answer #3 you published to this question from this host/);
  const like = dist.formatLikePinResult({
    reactionPinId: '1'.repeat(64) + 'i0',
    txids: [],
    totalCost: 77,
    targetPinId: 't',
    isLike: -1,
  });
  assert.match(like, /Disliked pin t/);
  assert.match(like, /view link: \[pin:\/\//);
});
