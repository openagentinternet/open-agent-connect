import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildPrivateFileMsgPayload,
  decryptPrivateFileHex,
  encryptPrivateFileHex,
  parseMetafileAttachmentUri,
  parsePrivateFileChatContent,
  PRIVATE_FILE_MAX_BYTES,
  sendPrivateFileChat,
} = require('../../dist/core/chat/privateChat.js');

function createKeyPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    privateKeyHex: ecdh.getPrivateKey('hex'),
    publicKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
  };
}

test('file cipher round-trips through the IDBots raw-CBC format', () => {
  const secret = 'a'.repeat(64);
  const fileHex = Buffer.from('hello private file', 'utf8').toString('hex');
  const cipher = encryptPrivateFileHex(fileHex, secret);
  assert.match(cipher, /^[0-9a-f]+$/iu);
  // CBC pads to full 16-byte blocks, so the cipher is longer than the input.
  assert.ok(cipher.length > fileHex.length);
  const plain = decryptPrivateFileHex(cipher, secret);
  assert.ok(plain);
  assert.equal(plain.toString('utf8'), 'hello private file');
  // A wrong secret fails cleanly instead of returning garbage bytes.
  assert.equal(decryptPrivateFileHex(cipher, 'b'.repeat(64)), null);
});

test('parseMetafileAttachmentUri accepts extension-bearing pin ids only', () => {
  assert.deepEqual(
    parseMetafileAttachmentUri('metafile://' + 'a'.repeat(64) + 'i0.png'),
    { pinId: 'a'.repeat(64) + 'i0', extension: 'png' },
  );
  assert.deepEqual(
    parseMetaFileHelper('metafile://' + 'b'.repeat(64) + 'i0'),
    { pinId: 'b'.repeat(64) + 'i0', extension: '' },
  );
  assert.equal(parseMetafileAttachmentUri('https://example.test/x.png'), null);
  assert.equal(parseMetafileAttachmentUri('metafile://short'), null);
});

function parseMetaFileHelper(value) {
  return parseMetafileAttachmentUri(value);
}

test('parsePrivateFileChatContent separates file bodies from text chat', () => {
  const attachment = 'metafile://' + 'c'.repeat(64) + 'i0.jpg';
  const body = JSON.stringify({
    to: 'idq1peer0000000000000000000000000000000',
    encrypt: 'ecdh',
    attachment,
    fileType: 'image/jpeg',
    timestamp: 1_770_000_000,
    replyPin: '',
  });
  const parsed = parsePrivateFileChatContent(body);
  assert.equal(parsed.attachment, attachment);
  assert.equal(parsed.fileType, 'image/jpeg');

  // Extension-carrying text chat (the {"content","extensions"} envelope)
  // must never read as a file body.
  assert.equal(parsePrivateFileChatContent(JSON.stringify({ content: 'hello', extensions: {} })), null);
  assert.equal(parsePrivateFileChatContent('plain text'), null);
  assert.equal(parsePrivateFileChatContent('{"attachment": "metafile://nope"}'), null);
});

test('sendPrivateFileChat builds the /file pin and the simplefilemsg pointer inputs', () => {
  const local = createKeyPair();
  const peer = createKeyPair();
  const payload = Buffer.from('pngbytes').toString('base64');
  const result = sendPrivateFileChat({
    fromIdentity: { globalMetaId: 'idq1local0000000000000000000000000000000', privateKeyHex: local.privateKeyHex },
    toGlobalMetaId: 'idq1peer0000000000000000000000000000000',
    peerChatPublicKey: peer.publicKeyHex,
    fileDataBase64: payload,
    fileType: 'image/png',
  });
  assert.equal(result.fileWrite.path, '/file');
  assert.equal(result.fileWrite.encoding, 'hex');
  assert.equal(result.fileWrite.contentType, 'image/png');
  assert.match(result.fileWrite.payload, /^[0-9a-f]+$/iu);
  assert.equal(result.msgWrite.path, '/protocols/simplefilemsg');
  assert.equal(result.msgWrite.contentType, 'application/json');
  // The secret decrypts what the cipher produced.
  const plain = decryptPrivateFileHex(result.fileWrite.payload, result.sharedSecret);
  assert.equal(plain && plain.toString('utf8'), 'pngbytes');

  const message = buildPrivateFileMsgPayload({
    toGlobalMetaId: 'idq1peer0000000000000000000000000000000',
    attachment: 'metafile://' + 'd'.repeat(64) + 'i0.png',
    fileType: 'image/png',
  });
  const parsed = JSON.parse(message);
  assert.equal(parsed.encrypt, 'ecdh');
  assert.equal(parsed.fileType, 'image/png');
  assert.equal(parsed.attachment, 'metafile://' + 'd'.repeat(64) + 'i0.png');

  // Size cap enforced before any crypto work.
  assert.throws(
    () => sendPrivateFileChat({
      fromIdentity: { globalMetaId: 'idq1local0000000000000000000000000000000', privateKeyHex: local.privateKeyHex },
      toGlobalMetaId: 'idq1peer0000000000000000000000000000000',
      peerChatPublicKey: peer.publicKeyHex,
      fileDataBase64: Buffer.alloc(PRIVATE_FILE_MAX_BYTES + 1).toString('base64'),
      fileType: 'image/png',
    }),
    /1-1048576 bytes/u,
  );
});
