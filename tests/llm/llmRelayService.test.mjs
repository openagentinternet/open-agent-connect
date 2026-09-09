// Tests for src/core/llm/llmRelayService.ts (MetaID free LLM relay client
// backing describe_image/describe_video/describe_audio). Real MVC keys verify
// the bootstrap signature string; the fetch layer is stubbed; media prep
// (image load, video transcode, audio extraction) is injected; state lives in
// mkdtempTempRoot-backed system homes so no daemon and no network are needed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { mvc } = require('meta-contract');
const {
  LlmRelayError,
  buildLlmRelayBootstrapMessage,
  createLlmRelayService,
  deriveVisionRecognizeUrl,
  formatMediaRelayError,
  inferAudioMimeType,
  parseFfmpegDuration,
  sniffImageMime,
} = require('../../dist/core/llm/llmRelayService.js');
const { importOwnerIdentity } = require('../../dist/core/owner/ownerIdentity.js');

const IDENTITY_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function verifyMessage(address, message, signature) {
  try {
    return mvc.Message(message).verify(address, signature);
  } catch {
    return false;
  }
}

test('buildLlmRelayBootstrapMessage follows the backend canonical string', () => {
  assert.equal(
    buildLlmRelayBootstrapMessage('1AbCdEfG', 1788600000),
    'llm-relay-bootstrap:1AbCdEfG:1788600000',
  );
});

test('deriveVisionRecognizeUrl tolerates chat v1, gateway base, and explicit recognize URLs', () => {
  assert.equal(
    deriveVisionRecognizeUrl('https://www.metaso.network/assist-open-api/v2/assist/llm/v1'),
    'https://www.metaso.network/assist-open-api/v2/assist/llm/vision/recognize',
  );
  assert.equal(
    deriveVisionRecognizeUrl('https://gw.example.test/assist-open-api'),
    'https://gw.example.test/assist-open-api/llm/vision/recognize',
  );
  assert.equal(
    deriveVisionRecognizeUrl('https://gw.example.test/v2/assist/llm/vision/recognize/'),
    'https://gw.example.test/v2/assist/llm/vision/recognize',
  );
  assert.throws(() => deriveVisionRecognizeUrl('  '), LlmRelayError);
});

test('sniffImageMime recognizes the four relay image formats', () => {
  assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')]);
  assert.equal(sniffImageMime(webp), 'image/webp');
  assert.equal(sniffImageMime(Buffer.from('GIF89a??')), 'image/gif');
  assert.equal(sniffImageMime(Buffer.from('not an image')), null);
});

test('inferAudioMimeType maps extensions and URLs', () => {
  assert.equal(inferAudioMimeType('/tmp/a.wav'), 'audio/wav');
  assert.equal(inferAudioMimeType('/tmp/a.MP3'), 'audio/mpeg');
  assert.equal(inferAudioMimeType('https://example.test/x/note.m4a'), 'audio/m4a');
  assert.equal(inferAudioMimeType('/tmp/a.flac'), 'audio/wav');
  assert.equal(inferAudioMimeType('/tmp/a.ogg', 'audio/webm'), 'audio/webm');
});

test('parseFfmpegDuration reads the Duration header', () => {
  assert.equal(parseFfmpegDuration('  Duration: 00:03:05.12, start: 0.5'), 185.12);
  assert.equal(parseFfmpegDuration('no header'), null);
});

test('formatMediaRelayError maps the backend stable messages', () => {
  assert.match(formatMediaRelayError('image', 'vision daily quota exhausted'), /Daily image quota used up/);
  assert.match(
    formatMediaRelayError('audio', 'vision relay error: vision request rate limited'),
    /rate limited/,
  );
  assert.match(formatMediaRelayError('video', 'something novel'), /Video watching failed: something novel/);
});

test('describeImage posts base64 + mime + prompt with the relay key', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-llm-relay-test-');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ code: 0, data: { content: 'a red square', model: 'metaid-free-vision', remainingToday: 41 } });
  };
  const service = createLlmRelayService({
    systemHomeDir,
    fetchImpl,
    staticCredentials: { apiKey: 'mrk_test', baseUrl: 'https://gw.example.test/assist-open-api' },
    loadImageBase64Impl: async () => ({ base64: 'QUJD', bytes: 3, mimeType: 'image/png' }),
  });
  const result = await service.describeImage({ path: '/tmp/a.png', question: 'what is it?' });
  assert.equal(result.content, 'a red square');
  assert.equal(result.remainingToday, 41);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://gw.example.test/assist-open-api/llm/vision/recognize');
  assert.equal(calls[0].init.headers.authorization, 'Bearer mrk_test');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    imageBase64: 'QUJD',
    mimeType: 'image/png',
    prompt: 'what is it?',
  });
});

test('bootstrap signs with the owner identity and persists 0600 credentials', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-llm-relay-test-');
  const owner = await importOwnerIdentity(systemHomeDir, { name: 'Test Owner', mnemonic: IDENTITY_MNEMONIC });

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/v2/assist/llm/bootstrap')) {
      const message = buildLlmRelayBootstrapMessage(
        init.headers['X-Identity-Address'],
        Number(init.headers['X-Timestamp']),
      );
      assert.equal(init.headers['X-Identity-Address'], owner.mvcAddress);
      assert.ok(verifyMessage(owner.mvcAddress, message, init.headers['X-Signature']));
      return jsonResponse({
        code: 0,
        data: {
          apiKey: 'mrk_boot1',
          baseUrl: 'https://gw.example.test/assist-open-api/v2/assist/llm/v1',
        },
      });
    }
    return jsonResponse({ code: 0, data: { content: 'ok' } });
  };
  const service = createLlmRelayService({
    systemHomeDir,
    fetchImpl,
    baseUrl: 'https://gw.example.test/assist-open-api',
    loadImageBase64Impl: async () => ({ base64: 'QUJD', bytes: 3, mimeType: 'image/jpeg' }),
  });
  await service.describeImage({ path: '/tmp/a.jpg' });

  const relayFile = path.join(systemHomeDir, '.metabot', 'owner', 'llm-relay.json');
  const persisted = JSON.parse(await fs.readFile(relayFile, 'utf8'));
  assert.equal(persisted.apiKey, 'mrk_boot1');
  assert.equal(persisted.baseUrl, 'https://gw.example.test/assist-open-api/v2/assist/llm/v1');
  if (process.platform !== 'win32') {
    const mode = (await fs.stat(relayFile)).mode & 0o777;
    assert.equal(mode, 0o600);
  }
  const recognize = calls.find((call) => call.url.endsWith('/vision/recognize'));
  assert.equal(recognize.init.headers.authorization, 'Bearer mrk_boot1');
});

test('a rejected relay key re-bootstraps exactly once and retries', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-llm-relay-test-');
  await importOwnerIdentity(systemHomeDir, { name: 'Test Owner', mnemonic: IDENTITY_MNEMONIC });
  // Seed a stale persisted key so the first recognize is rejected.
  const ownerDir = path.join(systemHomeDir, '.metabot', 'owner');
  await fs.mkdir(ownerDir, { recursive: true });
  await fs.writeFile(path.join(ownerDir, 'llm-relay.json'), JSON.stringify({
    version: 1,
    apiKey: 'mrk_stale',
    baseUrl: 'https://gw.example.test/v2/assist/llm/v1',
    updatedAt: 1,
  }));

  let bootstraps = 0;
  let recognizeCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/v2/assist/llm/bootstrap')) {
      bootstraps += 1;
      return jsonResponse({ code: 0, data: { apiKey: `mrk_boot${bootstraps}`, baseUrl: 'https://gw.example.test/v2/assist/llm/v1' } });
    }
    recognizeCalls += 1;
    return recognizeCalls === 1
      ? jsonResponse({ code: 1, message: 'relay key invalid or revoked' })
      : jsonResponse({ code: 0, data: { content: 'after retry' } });
  };
  const service = createLlmRelayService({
    systemHomeDir,
    fetchImpl,
    baseUrl: 'https://gw.example.test',
    loadImageBase64Impl: async () => ({ base64: 'QUJD', bytes: 3, mimeType: 'image/jpeg' }),
  });
  const result = await service.describeImage({ path: '/tmp/a.jpg' });
  assert.equal(result.content, 'after retry');
  assert.equal(bootstraps, 1);
  assert.equal(recognizeCalls, 2);
});

test('backend error envelopes surface the stable relay message', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-llm-relay-test-');
  const fetchImpl = async () => jsonResponse({ code: 1, message: 'vision daily quota exhausted' });
  const service = createLlmRelayService({
    systemHomeDir,
    fetchImpl,
    staticCredentials: { apiKey: 'mrk_test', baseUrl: 'https://gw.example.test/assist-open-api' },
    loadImageBase64Impl: async () => ({ base64: 'QUJD', bytes: 3, mimeType: 'image/jpeg' }),
  });
  await assert.rejects(
    () => service.describeImage({ path: '/tmp/a.jpg' }),
    (error) => error instanceof LlmRelayError
      && error.relayMessage === 'vision daily quota exhausted'
      && /vision daily quota exhausted/.test(error.message),
  );
});

test('describeVideo sends the transcoded mp4 and reports truncation', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-llm-relay-test-');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ code: 0, data: { content: 'a cat jumps', remainingToday: 35 } });
  };
  let transcodedPath = '';
  const service = createLlmRelayService({
    systemHomeDir,
    fetchImpl,
    staticCredentials: { apiKey: 'mrk_test', baseUrl: 'https://gw.example.test/assist-open-api' },
    transcodeVideoImpl: async (videoPath) => {
      transcodedPath = videoPath;
      return { base64: 'TVA0', bytes: 1024, durationSec: 401, truncated: true };
    },
  });
  const result = await service.describeVideo({ path: '/tmp/a.mov', question: 'what animal?' });
  assert.equal(result.content, 'a cat jumps');
  assert.equal(result.truncated, true);
  assert.equal(result.durationSec, 401);
  assert.equal(transcodedPath, '/tmp/a.mov');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    videoBase64: 'TVA0',
    mimeType: 'video/mp4',
    prompt: 'what animal?',
  });
});

test('describeVideo rejects payloads that stay over the byte ceiling', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-llm-relay-test-');
  const service = createLlmRelayService({
    systemHomeDir,
    fetchImpl: async () => { throw new Error('should not reach the relay'); },
    staticCredentials: { apiKey: 'mrk_test', baseUrl: 'https://gw.example.test/assist-open-api' },
    transcodeVideoImpl: async () => ({ base64: 'eA==', bytes: 8 * 1024 * 1024, durationSec: 10, truncated: false }),
  });
  await assert.rejects(
    () => service.describeVideo({ path: '/tmp/huge.mov' }),
    /too large after compression/,
  );
});

test('describeAudio handles local files, URLs, data URIs, and video-container extraction', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-llm-relay-test-');
  const wavBytes = Buffer.from('RIFF----WAVEfmt ');
  const audioFile = path.join(systemHomeDir, 'note.wav');
  await fs.writeFile(audioFile, wavBytes);
  await fs.writeFile(path.join(systemHomeDir, 'extracted.mp3'), Buffer.from('ID3mp3data'));

  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return jsonResponse({ code: 0, data: { content: 'transcribed' } });
  };
  let extractedFrom = '';
  const service = createLlmRelayService({
    systemHomeDir,
    fetchImpl,
    staticCredentials: { apiKey: 'mrk_test', baseUrl: 'https://gw.example.test/assist-open-api' },
    extractAudioImpl: async (videoPath) => {
      extractedFrom = videoPath;
      return { audioPath: path.join(systemHomeDir, 'extracted.mp3'), mimeType: 'audio/mpeg', bytes: 11 };
    },
  });

  await service.describeAudio({ source: audioFile });
  assert.equal(seen[0].body.audioBase64, wavBytes.toString('base64'));
  assert.equal(seen[0].body.mimeType, 'audio/wav');
  assert.match(seen[0].body.prompt, /请完整转写这段音频/);
  assert.match(seen[0].body.prompt, /逐字母念出的字母序列/, 'letter-by-letter sequences must be preserved (FIX-4)');

  await service.describeAudio({ source: 'https://example.test/a.mp3', prompt: 'summarize' });
  assert.equal(seen[1].body.audioUrl, 'https://example.test/a.mp3');
  assert.equal(seen[1].body.mimeType, 'audio/mpeg');
  assert.equal(seen[1].body.prompt, 'summarize');

  await service.describeAudio({ source: 'data:audio/wav;base64,QUJD' });
  assert.equal(seen[2].body.audioBase64, 'QUJD');
  assert.equal(seen[2].body.mimeType, 'audio/wav');

  await service.describeAudio({ source: path.join(systemHomeDir, 'clip.mp4') });
  assert.equal(extractedFrom, path.join(systemHomeDir, 'clip.mp4'));
  assert.equal(seen[3].body.audioBase64, Buffer.from('ID3mp3data').toString('base64'));
  assert.equal(seen[3].body.mimeType, 'audio/mpeg');
});

test('describeAudio rejects unsupported local audio formats and oversized payloads', async () => {
  const systemHomeDir = await mkdtempTempRoot('oac-llm-relay-test-');
  const service = createLlmRelayService({
    systemHomeDir,
    fetchImpl: async () => { throw new Error('should not reach the relay'); },
    staticCredentials: { apiKey: 'mrk_test', baseUrl: 'https://gw.example.test/assist-open-api' },
  });
  const flac = path.join(systemHomeDir, 'song.flac');
  await fs.writeFile(flac, Buffer.alloc(16));
  await assert.rejects(() => service.describeAudio({ source: flac }), /audio payload is invalid/);

  const big = path.join(systemHomeDir, 'big.wav');
  await fs.writeFile(big, Buffer.alloc(9 * 1024 * 1024));
  await assert.rejects(() => service.describeAudio({ source: big }), /audio too large/);
});
