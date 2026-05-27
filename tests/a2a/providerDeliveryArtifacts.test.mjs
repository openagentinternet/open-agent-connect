import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  LARGE_UPLOAD_MAX_BYTES,
} = require('../../dist/core/files/uploadLargeFile.js');
const {
  classifyProviderOutputType,
  isTextLikeProviderOutputType,
  resolveProviderDeliveryArtifacts,
} = require('../../dist/core/a2a/provider/providerDeliveryArtifacts.js');

function fakeSigner() {
  return {
    writePin: async () => {
      throw new Error('signer should not be called directly by provider artifact tests');
    },
  };
}

async function tempWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'oac-provider-artifacts-'));
}

async function writeWorkspaceFile(workspace, relativePath, content = 'artifact') {
  const filePath = path.join(workspace, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

function okVerifier(calls = []) {
  return async (pinId) => {
    calls.push(pinId);
    return {
      ok: true,
      url: `https://verify.example/${pinId}`,
      attempts: 1,
    };
  };
}

function fakeUploadResult(input, overrides = {}) {
  const extension = path.extname(input.filePath).toLowerCase();
  const pinId = overrides.pinId || `uploaded-${path.basename(input.filePath, extension)}`;
  const contentType = extension === '.mp4'
    ? 'video/mp4'
    : extension === '.mp3'
      ? 'audio/mpeg'
      : extension === '.png'
        ? 'image/png'
        : 'application/octet-stream';
  return {
    pinId,
    txids: ['tx-uploaded'],
    totalCost: 7,
    network: input.network || 'mvc',
    fileName: path.basename(input.filePath),
    contentType,
    bytes: overrides.bytes ?? 12,
    extension,
    metafileUri: `metafile://${pinId}${extension}`,
    previewUrl: `https://preview.example/${pinId}`,
    downloadUrl: `https://download.example/${pinId}`,
    globalMetaId: 'gm-provider',
    uploadMode: 'direct',
    verification: {
      ok: true,
      url: `https://verify.example/${pinId}`,
      attempts: 1,
    },
  };
}

function fakeUploader(calls = [], overrides = {}) {
  return async (input) => {
    calls.push(input);
    return fakeUploadResult(input, overrides);
  };
}

async function assertRejectCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => {
      assert.equal(error.code, code);
      assert.match(error.message, new RegExp(code));
      return true;
    },
  );
}

async function captureRejectCode(promise, code) {
  let capturedError = null;
  await assert.rejects(
    promise,
    (error) => {
      assert.equal(error.code, code);
      assert.match(error.message, new RegExp(code));
      capturedError = error;
      return true;
    },
  );
  return capturedError;
}

async function assertNoUnsafeProviderUploadSuccess(input, unsafeHints) {
  let result = null;
  try {
    result = await resolveProviderDeliveryArtifacts(input);
  } catch (error) {
    assert.match(error.code, /^provider_artifact_/);
    for (const unsafeHint of unsafeHints) {
      assert.equal(error.message.includes(unsafeHint), false);
    }
    return;
  }

  assert.equal(result.artifacts.length, 1);
  assert.match(result.artifacts[0].uri, /^metafile:\/\//);
  assert.equal(JSON.stringify(result.artifacts).includes('file:///'), false);

  for (const unsafeHint of unsafeHints) {
    assert.equal(result.responseText.includes(unsafeHint), false);
    assert.equal(JSON.stringify(result.artifacts).includes(unsafeHint), false);
  }
}

test('classifyProviderOutputType treats text-like and non-text service outputs consistently', () => {
  assert.equal(classifyProviderOutputType(undefined), 'text');
  assert.equal(classifyProviderOutputType(''), 'text');
  assert.equal(classifyProviderOutputType('text'), 'text');
  assert.equal(classifyProviderOutputType('markdown'), 'text');
  assert.equal(classifyProviderOutputType('image'), 'image');
  assert.equal(classifyProviderOutputType('video'), 'video');
  assert.equal(classifyProviderOutputType('audio'), 'audio');
  assert.equal(classifyProviderOutputType('file'), 'file');
  assert.equal(classifyProviderOutputType('attachment'), 'file');
  assert.equal(classifyProviderOutputType('other'), 'file');
  assert.equal(classifyProviderOutputType('spreadsheet'), 'file');
  assert.equal(isTextLikeProviderOutputType('markdown'), true);
  assert.equal(isTextLikeProviderOutputType('image'), false);
});

test('existing metafile URI in response text is normalized and reused for an image service', async () => {
  const verifierCalls = [];
  const publicPreviewUrl = 'https://cdn.example/artifacts/abc123i0.png';

  const result = await resolveProviderDeliveryArtifacts({
    responseText: `Done: metafile://abc123i0.png.\nPreview: ${publicPreviewUrl}`,
    outputType: 'image',
    signer: fakeSigner(),
    verifyAvailability: okVerifier(verifierCalls),
  });

  assert.match(result.responseText, /Done: metafile:\/\/abc123i0\.png\./);
  assert.match(result.responseText, new RegExp(publicPreviewUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.responseText, /Artifact: metafile:\/\/abc123i0\.png/);
  assert.match(result.responseText, /PINID: abc123i0/);
  assert.match(result.responseText, /File: abc123i0\.png/);
  assert.match(
    result.responseText,
    /Download: https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/abc123i0/,
  );
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://abc123i0.png');
  assert.equal(result.artifacts[0].pinId, 'abc123i0');
  assert.equal(result.artifacts[0].kind, 'image');
  assert.deepEqual(verifierCalls, ['abc123i0']);
});

test('existing metafile URI reuse calls injected availability verifier before success', async () => {
  const verifierCalls = [];

  await resolveProviderDeliveryArtifacts({
    responseText: 'metafile://abc123i0.png',
    outputType: 'image',
    signer: fakeSigner(),
    verifyAvailability: okVerifier(verifierCalls),
  });

  assert.deepEqual(verifierCalls, ['abc123i0']);
});

test('existing metafile URI reuse rejects local workspace absolute path prose', async () => {
  const workspace = await tempWorkspace();
  const filePath = await writeWorkspaceFile(workspace, 'out/chart.png');
  const artifactDirectory = path.dirname(filePath);
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: `Saved image to ${filePath}; output dir ${artifactDirectory}; public artifact metafile://abc123i0.png`,
      outputType: 'image',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes(filePath), false);
  assert.equal(error.message.includes(artifactDirectory), false);
  assert.equal(error.message.includes(workspace), false);
});

test('existing metafile URI reuse scrubs relative local path prose', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'out/chart.png');
  const verifierCalls = [];
  const uploadCalls = [];

  const result = await resolveProviderDeliveryArtifacts({
    responseText: 'Saved image to out/chart.png and public artifact metafile://abc123i0.png',
    outputType: 'image',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(uploadCalls),
    verifyAvailability: okVerifier(verifierCalls),
  });

  assert.deepEqual(verifierCalls, ['abc123i0']);
  assert.equal(uploadCalls.length, 0);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://abc123i0.png');
  assert.match(result.responseText, /metafile:\/\/abc123i0\.png/);
  assert.equal(result.responseText.includes('out/chart.png'), false);
  assert.equal(result.responseText.includes('chart.png'), false);
  assert.equal(result.responseText.includes(workspace), false);
});

test('existing metafile URI reuse scrubs missing relative local path prose', async () => {
  const workspace = await tempWorkspace();
  const verifierCalls = [];
  const uploadCalls = [];

  const result = await resolveProviderDeliveryArtifacts({
    responseText: 'Saved image to out/chart.png and public artifact metafile://abc123i0.png',
    outputType: 'image',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(uploadCalls),
    verifyAvailability: okVerifier(verifierCalls),
  });

  assert.deepEqual(verifierCalls, ['abc123i0']);
  assert.equal(uploadCalls.length, 0);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://abc123i0.png');
  assert.match(result.responseText, /metafile:\/\/abc123i0\.png/);
  assert.equal(result.responseText.includes('out/chart.png'), false);
  assert.equal(result.responseText.includes('chart.png'), false);
  assert.equal(result.responseText.includes(workspace), false);
});

test('existing metafile URI reuse rejects secret-like attachment marker line', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'attachment: .npmrc\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
});

test('existing metafile URI reuse rejects hidden-directory attachment marker line', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'attachment: ./.config/report.pdf\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
});

test('existing metafile URI reuse rejects bare secret-like local path line', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: '.npmrc\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
});

test('existing metafile URI reuse rejects bare hidden-directory local path line without execution cwd', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: './.config/report.pdf\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('./.config/report.pdf'), false);
});

test('existing metafile URI reuse rejects mixed public URI and ordinary credential path marker', async () => {
  for (const fileName of ['token.txt', 'secret.txt', 'api-key.json', 'password.txt', '.config/settings.json']) {
    const verifierCalls = [];
    const uploadCalls = [];

    await assertRejectCode(
      resolveProviderDeliveryArtifacts({
        responseText: `attachment: ${fileName}\nPublic artifact: metafile://abc123.pdf`,
        outputType: 'file',
        signer: fakeSigner(),
        uploadLargeFile: fakeUploader(uploadCalls),
        verifyAvailability: okVerifier(verifierCalls),
      }),
      'provider_artifact_secret_rejected',
    );

    assert.deepEqual(verifierCalls, []);
    assert.equal(uploadCalls.length, 0);
  }
});

test('existing metafile URI reuse rejects inline hidden-directory prose before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'Saved a copy under ./.config/report.pdf beside public artifact metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('./.config/report.pdf'), false);
});

test('existing metafile URI reuse rejects inline secret-like prose before verifier reuse', async () => {
  for (const secretHint of ['The notes mention token.txt. metafile://abc123.pdf', 'See .npmrc before using metafile://abc123.pdf']) {
    const verifierCalls = [];
    const uploadCalls = [];

    await assertRejectCode(
      resolveProviderDeliveryArtifacts({
        responseText: secretHint,
        outputType: 'file',
        signer: fakeSigner(),
        uploadLargeFile: fakeUploader(uploadCalls),
        verifyAvailability: okVerifier(verifierCalls),
      }),
      'provider_artifact_secret_rejected',
    );

    assert.deepEqual(verifierCalls, []);
    assert.equal(uploadCalls.length, 0);
  }
});

test('existing metafile URI reuse rejects inline absolute POSIX hidden path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'Saved copy at /home/me/.config/report.pdf beside metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('/home/me/.config/report.pdf'), false);
});

test('existing metafile URI reuse rejects bare absolute POSIX secret path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: '/home/me/.ssh/id_ed25519\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('/home/me/.ssh/id_ed25519'), false);
});

test('existing metafile URI reuse rejects Windows backslash hidden path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'C:\\repo\\.config\\report.pdf\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('C:\\repo\\.config\\report.pdf'), false);
});

test('existing metafile URI reuse rejects Windows slash secret path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'C:/repo/.ssh/id_ed25519\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('C:/repo/.ssh/id_ed25519'), false);
});

test('existing metafile URI reuse rejects file URI hidden path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'file:///home/me/.config/report.pdf\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('file:///home/me/.config/report.pdf'), false);
});

test('existing metafile URI reuse rejects public-looking absolute POSIX path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: '/home/me/out/report.pdf\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('/home/me/out/report.pdf'), false);
});

test('existing metafile URI reuse rejects public-looking Windows backslash path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'C:\\repo\\out\\report.pdf\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('C:\\repo\\out\\report.pdf'), false);
});

test('existing metafile URI reuse rejects public-looking Windows slash path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'C:/repo/out/report.pdf\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('C:/repo/out/report.pdf'), false);
});

test('existing metafile URI reuse rejects public-looking bare UNC path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];
  const uncPath = '\\\\server\\share\\out\\report.pdf';

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: `${uncPath}\nPublic artifact: metafile://abc123.pdf`,
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes(uncPath), false);
});

test('existing metafile URI reuse rejects public-looking inline UNC path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];
  const uncPath = '\\\\server\\share\\out\\report.pdf';

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: `Saved at ${uncPath} beside metafile://abc123.pdf`,
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes(uncPath), false);
});

test('existing metafile URI reuse rejects secret-like UNC path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];
  const uncPath = '\\\\server\\share\\.ssh\\id_ed25519';

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: `${uncPath}\nPublic artifact: metafile://abc123.pdf`,
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes(uncPath), false);
});

test('existing metafile URI reuse rejects public-looking file URI path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'file:///home/me/out/report.pdf\nPublic artifact: metafile://abc123.pdf',
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('file:///home/me/out/report.pdf'), false);
});

test('existing metafile URI reuse rejects single-slash file URI before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];
  const fileUri = 'file:/home/me/out/report.pdf';

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: `${fileUri}\nPublic artifact: metafile://abc123.pdf`,
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes(fileUri), false);
});

test('existing metafile URI reuse rejects drive-qualified file URI before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];
  const fileUri = 'file:C:/repo/out/report.pdf';

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: `${fileUri}\nPublic artifact: metafile://abc123.pdf`,
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes(fileUri), false);
});

test('existing metafile URI reuse rejects drive-relative Windows path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];
  const driveRelativePath = 'C:repo\\out\\report.pdf';

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: `${driveRelativePath}\nPublic artifact: metafile://abc123.pdf`,
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes(driveRelativePath), false);
});

test('existing metafile URI reuse rejects basename-only drive-relative path before verifier reuse', async () => {
  const verifierCalls = [];
  const uploadCalls = [];
  const driveRelativePath = 'C:report.pdf';

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: `Saved report at ${driveRelativePath}\nPublic artifact: metafile://abc123.pdf`,
      outputType: 'file',
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(verifierCalls),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.deepEqual(verifierCalls, []);
  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes(driveRelativePath), false);
});

test('existing metafile URI reuse rejects secret-looking basename-only drive-relative paths before verifier reuse', async () => {
  for (const driveRelativePath of ['C:token.txt', 'C:.env']) {
    const verifierCalls = [];
    const uploadCalls = [];

    const error = await captureRejectCode(
      resolveProviderDeliveryArtifacts({
        responseText: `Saved report at ${driveRelativePath}\nPublic artifact: metafile://abc123.pdf`,
        outputType: 'file',
        signer: fakeSigner(),
        uploadLargeFile: fakeUploader(uploadCalls),
        verifyAvailability: okVerifier(verifierCalls),
      }),
      'provider_artifact_secret_rejected',
    );

    assert.deepEqual(verifierCalls, []);
    assert.equal(uploadCalls.length, 0);
    assert.equal(error.message.includes(driveRelativePath), false);
  }
});

test('existing metafile URI verifier failure maps to provider_artifact_unavailable', async () => {
  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'metafile://abc123i0.png',
      outputType: 'image',
      signer: fakeSigner(),
      verifyAvailability: async () => ({
        ok: false,
        url: null,
        attempts: 2,
        error: 'not propagated',
      }),
    }),
    'provider_artifact_unavailable',
  );
});

test('existing video metafile URI fails media validation for an image service', async () => {
  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'metafile://abc123i0.mp4',
      outputType: 'image',
      signer: fakeSigner(),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_type_mismatch',
  );
});

test('explicit local path marker resolves relative to executionCwd', async () => {
  const workspace = await tempWorkspace();
  const filePath = await writeWorkspaceFile(workspace, 'out/chart.png');
  const uploadCalls = [];

  const result = await resolveProviderDeliveryArtifacts({
    responseText: 'Here is the chart.\nartifactPath: ./out/chart.png',
    outputType: 'image',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(uploadCalls),
    verifyAvailability: okVerifier(),
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].filePath, await realpath(filePath));
  assert.equal(uploadCalls[0].verify, true);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://uploaded-chart.png');
  assert.equal(result.responseText.includes('./out/chart.png'), false);
  assert.equal(result.responseText.includes('artifactPath:'), false);
});

test('bare local path line resolves when it is the only explicit candidate', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'out/clip.mp4');
  const uploadCalls = [];

  const result = await resolveProviderDeliveryArtifacts({
    responseText: './out/clip.mp4',
    outputType: 'video',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(uploadCalls),
    verifyAvailability: okVerifier(),
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(result.artifacts[0].kind, 'video');
  assert.equal(result.responseText.includes('./out/clip.mp4'), false);
});

test('fallback workspace scan succeeds only when exactly one file matches the requested media family', async () => {
  const singleWorkspace = await tempWorkspace();
  await writeWorkspaceFile(singleWorkspace, 'nested/only.png');
  const singleCalls = [];

  const single = await resolveProviderDeliveryArtifacts({
    responseText: 'Generated the requested image.',
    outputType: 'image',
    executionCwd: singleWorkspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(singleCalls),
    verifyAvailability: okVerifier(),
  });

  assert.equal(single.artifacts.length, 1);
  assert.equal(single.artifacts[0].uri, 'metafile://uploaded-only.png');

  const ambiguousWorkspace = await tempWorkspace();
  await writeWorkspaceFile(ambiguousWorkspace, 'a.png');
  await writeWorkspaceFile(ambiguousWorkspace, 'b.jpg');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'Generated the requested image.',
      outputType: 'image',
      executionCwd: ambiguousWorkspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_ambiguous',
  );
});

test('fallback workspace scan scrubs local path prose for the resolved artifact', async () => {
  const workspace = await tempWorkspace();
  const filePath = await writeWorkspaceFile(workspace, 'out/chart.png');
  const uploadCalls = [];

  const result = await resolveProviderDeliveryArtifacts({
    responseText: `Saved image to ${filePath}; relative copy at out/chart.png for inspection.`,
    outputType: 'image',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(uploadCalls),
    verifyAvailability: okVerifier(),
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].filePath, await realpath(filePath));
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://uploaded-chart.png');
  assert.equal(result.responseText.includes(filePath), false);
  assert.equal(result.responseText.includes(workspace), false);
  assert.equal(result.responseText.includes('out/chart.png'), false);
  assert.match(result.responseText, /Saved image to/);
  assert.match(result.responseText, /Artifact: metafile:\/\/uploaded-chart\.png/);
});

test('fallback workspace scan scrubs file URI workspace path prose for the resolved artifact', async () => {
  const workspace = await tempWorkspace();
  const filePath = await writeWorkspaceFile(workspace, 'out/chart.png');
  const uploadCalls = [];

  const result = await resolveProviderDeliveryArtifacts({
    responseText: `Saved image to file://${filePath}; final file is out/chart.png`,
    outputType: 'image',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(uploadCalls),
    verifyAvailability: okVerifier(),
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].filePath, await realpath(filePath));
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://uploaded-chart.png');
  assert.equal(result.responseText.includes(filePath), false);
  assert.equal(result.responseText.includes(workspace), false);
  assert.equal(result.responseText.includes('out/chart.png'), false);
  assert.equal(result.responseText.includes('file://[uploaded artifact]'), false);
  assert.match(result.responseText, /Saved image to/);
  assert.match(result.responseText, /Artifact: metafile:\/\/uploaded-chart\.png/);
});

test('fallback workspace scan scrubs local directory path prose for the resolved artifact', async () => {
  const workspace = await tempWorkspace();
  const filePath = await writeWorkspaceFile(workspace, 'out/chart.png');
  const artifactDirectory = path.join(workspace, 'out');
  const uploadCalls = [];

  const result = await resolveProviderDeliveryArtifacts({
    responseText: `Saved image in ${artifactDirectory} with filename chart.png`,
    outputType: 'image',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(uploadCalls),
    verifyAvailability: okVerifier(),
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].filePath, await realpath(filePath));
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.responseText.includes(artifactDirectory), false);
  assert.equal(result.responseText.includes(`${workspace}/out`), false);
  assert.equal(result.responseText.includes('workspace/out'), false);
  assert.match(result.responseText, /Saved image in/);
  assert.match(result.responseText, /Artifact: metafile:\/\/uploaded-chart\.png/);
});

test('local upload scrubs unrelated execution workspace descendant path prose', async () => {
  const workspace = await tempWorkspace();
  const filePath = await writeWorkspaceFile(workspace, 'out/chart.png');
  await writeWorkspaceFile(workspace, 'logs/debug.log', 'debug details');
  const debugPath = path.join(workspace, 'logs/debug.log');
  const uploadCalls = [];

  const result = await resolveProviderDeliveryArtifacts({
    responseText: `Saved image to ${filePath}; debug log ${debugPath}; relative log logs/debug.log`,
    outputType: 'image',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(uploadCalls),
    verifyAvailability: okVerifier(),
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://uploaded-chart.png');
  assert.equal(result.responseText.includes(workspace), false);
  assert.equal(result.responseText.includes(filePath), false);
  assert.equal(result.responseText.includes(debugPath), false);
  assert.equal(result.responseText.includes('logs/debug.log'), false);
  assert.equal(result.responseText.includes('[uploaded artifact]/logs'), false);
  assert.match(result.responseText, /Artifact: metafile:\/\/uploaded-chart\.png/);
});

test('local upload does not leak bare UNC prose when no metafile URI was provided', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');
  const uncPath = '\\\\server\\share\\out\\report.pdf';

  await assertNoUnsafeProviderUploadSuccess({
    responseText: `${uncPath}\nattachment: ./report.pdf`,
    outputType: 'file',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(),
    verifyAvailability: okVerifier(),
  }, [uncPath]);
});

test('fallback upload does not leak inline UNC prose when no metafile URI was provided', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');
  const uncPath = '\\\\server\\share\\out\\report.pdf';

  await assertNoUnsafeProviderUploadSuccess({
    responseText: `Saved report at ${uncPath}`,
    outputType: 'file',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(),
    verifyAvailability: okVerifier(),
  }, [uncPath]);
});

test('local upload does not leak POSIX absolute prose outside executionCwd when no metafile URI was provided', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');
  const absolutePath = '/home/me/out/report.pdf';

  await assertNoUnsafeProviderUploadSuccess({
    responseText: `Saved report at ${absolutePath}\nattachment: ./report.pdf`,
    outputType: 'file',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(),
    verifyAvailability: okVerifier(),
  }, [absolutePath]);
});

test('local upload does not leak Windows drive prose when no metafile URI was provided', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');
  const backslashPath = 'C:\\repo\\out\\report.pdf';
  const slashPath = 'C:/repo/out/report.pdf';
  const driveRelativeBackslashPath = 'C:repo\\out\\report.pdf';
  const driveRelativeSlashPath = 'C:repo/out/report.pdf';
  const driveRelativeBasenamePath = 'C:report.pdf';

  await assertNoUnsafeProviderUploadSuccess({
    responseText: `Saved reports at ${backslashPath}, ${slashPath}, ${driveRelativeBackslashPath}, ${driveRelativeSlashPath}, and ${driveRelativeBasenamePath}\nattachment: ./report.pdf`,
    outputType: 'file',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(),
    verifyAvailability: okVerifier(),
  }, [backslashPath, slashPath, driveRelativeBackslashPath, driveRelativeSlashPath, driveRelativeBasenamePath]);
});

test('local upload does not leak secret-looking basename-only drive-relative prose when no metafile URI was provided', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');

  for (const driveRelativePath of ['C:token.txt', 'C:.env']) {
    await assertNoUnsafeProviderUploadSuccess({
      responseText: `Saved report at ${driveRelativePath}\nattachment: ./report.pdf`,
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(),
      verifyAvailability: okVerifier(),
    }, [driveRelativePath]);
  }
});

test('local upload does not leak file URI prose when no metafile URI was provided', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');
  const posixFileUri = 'file:///home/me/out/report.pdf';
  const windowsFileUri = 'file:///C:/repo/out/report.pdf';
  const singleSlashFileUri = 'file:/home/me/out/report.pdf';
  const driveFileUri = 'file:C:/repo/out/report.pdf';

  await assertNoUnsafeProviderUploadSuccess({
    responseText: `Saved reports at ${posixFileUri}, ${windowsFileUri}, ${singleSlashFileUri}, and ${driveFileUri}\nattachment: ./report.pdf`,
    outputType: 'file',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(),
    verifyAvailability: okVerifier(),
  }, [posixFileUri, windowsFileUri, singleSlashFileUri, driveFileUri]);
});

test('fallback workspace scan scrubs execution workspace root path prose for the resolved artifact', async () => {
  const root = await tempWorkspace();
  const workspace = path.join(root, 'workspace-root');
  const requestedCwd = path.join(root, 'requested-workspace');
  await mkdir(workspace);
  await symlink(workspace, requestedCwd);
  const filePath = await writeWorkspaceFile(workspace, 'out/chart.png');
  const executionCwd = await realpath(workspace);
  const uploadCalls = [];

  const result = await resolveProviderDeliveryArtifacts({
    responseText: `Saved image in ${executionCwd}; requested cwd ${requestedCwd}; final file is out/chart.png`,
    outputType: 'image',
    executionCwd: requestedCwd,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(uploadCalls),
    verifyAvailability: okVerifier(),
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].filePath, await realpath(filePath));
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://uploaded-chart.png');
  assert.equal(result.responseText.includes(executionCwd), false);
  assert.equal(result.responseText.includes(requestedCwd), false);
  assert.equal(result.responseText.includes('workspace'), false);
  assert.match(result.responseText, /Saved image in/);
  assert.match(result.responseText, /Artifact: metafile:\/\/uploaded-chart\.png/);
});

test('resolution rejects files outside executionCwd including parent paths and symlink escapes', async () => {
  const workspace = await tempWorkspace();
  const outsideRoot = await tempWorkspace();
  const childWorkspace = path.join(outsideRoot, 'child');
  await mkdir(childWorkspace);
  const outsideFile = await writeWorkspaceFile(outsideRoot, 'outside.png');
  await symlink(outsideFile, path.join(workspace, 'escape.png'));

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'artifactPath: ../outside.png',
      outputType: 'image',
      executionCwd: childWorkspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_outside_workspace',
  );

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'artifactPath: ./escape.png',
      outputType: 'image',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_outside_workspace',
  );
});

test('resolution rejects secret-like local artifact names', async () => {
  for (const fileName of [
    '.env',
    'id_rsa',
    'wallet.json',
    'private-key.txt',
    'mnemonic.txt',
    'token.txt',
    'secret.txt',
    'api-key.json',
    'password.txt',
    '.config/settings.json',
    'credentials.json',
    'private_key.pem',
  ]) {
    const workspace = await tempWorkspace();
    await writeWorkspaceFile(workspace, fileName, 'secret');

    await assertRejectCode(
      resolveProviderDeliveryArtifacts({
        responseText: `artifactPath: ./${fileName}`,
        outputType: 'file',
        executionCwd: workspace,
        signer: fakeSigner(),
        uploadLargeFile: fakeUploader(),
        verifyAvailability: okVerifier(),
      }),
      'provider_artifact_secret_rejected',
    );
  }
});

test('explicit hidden directory artifact marker rejects before upload', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, '.config/report.pdf', 'public-looking report');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'attachment: ./.config/report.pdf',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
});

test('fallback workspace scan rejects npm credential config before upload', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, '.npmrc', '//registry.npmjs.org/:_authToken=secret');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'Generated the requested file.',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
});

test('fallback workspace scan rejects hidden directory candidate before upload', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, '.config/report.pdf', 'public-looking report');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'Generated the requested file.',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
});

test('fallback workspace scan rejects ordinary credential and config names before upload', async () => {
  for (const fileName of ['token.txt', 'secret.txt', 'api-key.json', 'password.txt', '.config/settings.json']) {
    const workspace = await tempWorkspace();
    const uploadCalls = [];
    await writeWorkspaceFile(workspace, fileName, 'secret');
    await writeWorkspaceFile(workspace, 'report.pdf', 'public report');

    await assertRejectCode(
      resolveProviderDeliveryArtifacts({
        responseText: 'Generated the requested file.',
        outputType: 'file',
        executionCwd: workspace,
        signer: fakeSigner(),
        uploadLargeFile: fakeUploader(uploadCalls),
        verifyAvailability: okVerifier(),
      }),
      'provider_artifact_secret_rejected',
    );

    assert.equal(uploadCalls.length, 0);
  }
});

test('fallback workspace scan rejects mixed secret and public candidates before upload', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, '.npmrc', '//registry.npmjs.org/:_authToken=secret');
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'Generated the requested file.',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
});

test('fallback workspace scan rejects hidden config secrets before uploading public candidates', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, '.config/.npmrc', '//registry.npmjs.org/:_authToken=secret');
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'Generated the requested file.',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
});

test('bare secret basename response rejects before fallback scan can upload a public file', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, '.npmrc', '//registry.npmjs.org/:_authToken=secret');
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: '.npmrc',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
});

test('fallback workspace scan rejects SSH private key before upload', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, '.ssh/id_ed25519', 'PRIVATE KEY');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'Generated the requested file.',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
});

test('explicit attachment marker rejects SSH private key before upload', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, '.ssh/id_ed25519', 'PRIVATE KEY');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'attachment: ./.ssh/id_ed25519',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
});

test('bare local path rejects SSH private key before upload', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, '.ssh/id_ed25519', 'PRIVATE KEY');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: './.ssh/id_ed25519',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
});

test('missing bare SSH private key path rejects before fallback scan can upload public file', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: '.ssh/id_ed25519',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('.ssh/id_ed25519'), false);
});

test('missing backslash bare SSH private key path rejects before fallback scan can upload public file', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: '.ssh\\id_ed25519',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('.ssh\\id_ed25519'), false);
});

test('missing dot-relative SSH private key path rejects before fallback scan can upload public file', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: './.ssh/id_ed25519',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
  assert.equal(error.message.includes('./.ssh/id_ed25519'), false);
});

test('missing explicit SSH private key marker rejects as secret before missing-artifact handling', async () => {
  const workspace = await tempWorkspace();
  const uploadCalls = [];
  await writeWorkspaceFile(workspace, 'report.pdf', 'public report');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'artifactPath: ./.ssh/id_ed25519',
      outputType: 'file',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_secret_rejected',
  );

  assert.equal(uploadCalls.length, 0);
});

test('missing backslash explicit SSH private key markers reject as secret before missing-artifact handling', async () => {
  for (const marker of ['artifactPath', 'attachment']) {
    const workspace = await tempWorkspace();
    const uploadCalls = [];
    await writeWorkspaceFile(workspace, 'report.pdf', 'public report');

    await assertRejectCode(
      resolveProviderDeliveryArtifacts({
        responseText: `${marker}: .ssh\\id_ed25519`,
        outputType: 'file',
        executionCwd: workspace,
        signer: fakeSigner(),
        uploadLargeFile: fakeUploader(uploadCalls),
        verifyAvailability: okVerifier(),
      }),
      'provider_artifact_secret_rejected',
    );

    assert.equal(uploadCalls.length, 0);
  }
});

test('local file upload uses an injected uploader with verify true', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'out/chart.png');
  const uploadCalls = [];

  await resolveProviderDeliveryArtifacts({
    responseText: 'filePath: ./out/chart.png',
    outputType: 'image',
    executionCwd: workspace,
    network: 'mvc',
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(uploadCalls),
    largeUploader: {
      upload: async () => {
        throw new Error('large uploader should be passed through, not called here');
      },
    },
    verifyAvailability: okVerifier(),
  });

  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].network, 'mvc');
  assert.equal(uploadCalls[0].verify, true);
  assert.equal(typeof uploadCalls[0].signer.writePin, 'function');
  assert.equal(typeof uploadCalls[0].verifyAvailability, 'function');
  assert.equal(typeof uploadCalls[0].largeUploader.upload, 'function');
});

test('direct small-file upload result becomes one artifact and final response text with no local path', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'out/chart.png');

  const result = await resolveProviderDeliveryArtifacts({
    responseText: 'Chart ready.\noutputFile: ./out/chart.png',
    outputType: 'image',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: fakeUploader(),
    verifyAvailability: okVerifier(),
  });

  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://uploaded-chart.png');
  assert.equal(result.artifacts[0].kind, 'image');
  assert.equal(result.artifacts[0].fileName, 'chart.png');
  assert.equal(result.artifacts[0].contentType, 'image/png');
  assert.equal(result.responseText.includes('./out/chart.png'), false);
  assert.match(result.responseText, /Artifact: metafile:\/\/uploaded-chart\.png/);
  assert.match(result.responseText, /PINID: uploaded-chart/);
});

test('upload result metadata is sanitized before becoming a structured artifact', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'out/chart.png');

  const result = await resolveProviderDeliveryArtifacts({
    responseText: 'Chart ready.\noutputFile: ./out/chart.png',
    outputType: 'image',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: async (input) => ({
      ...fakeUploadResult(input),
      fileName: '/tmp/workspace/secret.png',
      contentType: 'image/png\r\nX-Local-Path: /tmp/workspace/secret.png',
    }),
    verifyAvailability: okVerifier(),
  });

  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://uploaded-chart.png');
  assert.equal(result.artifacts[0].fileName, 'uploaded-chart.png');
  assert.equal(result.artifacts[0].contentType, null);
  assert.equal(result.responseText.includes('/tmp/workspace/secret.png'), false);
  assert.equal(result.responseText.includes('X-Local-Path'), false);
});

test('upload result does not trust unsafe extension metadata without a URI extension', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'out/chart.png');

  const result = await resolveProviderDeliveryArtifacts({
    responseText: 'Chart ready.\noutputFile: ./out/chart.png',
    outputType: 'image',
    executionCwd: workspace,
    signer: fakeSigner(),
    uploadLargeFile: async (input) => ({
      ...fakeUploadResult(input),
      metafileUri: 'metafile://uploaded-chart',
      extension: '../secret\r\n.png',
    }),
    verifyAvailability: okVerifier(),
  });

  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].uri, 'metafile://uploaded-chart');
  assert.equal(result.artifacts[0].kind, 'image');
  assert.equal(result.artifacts[0].extension, null);
  assert.equal(result.responseText.includes('../secret'), false);
});

test('upload result fails closed when returned pinId and metafile URI disagree', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'out/chart.png');

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'Chart ready.\noutputFile: ./out/chart.png',
      outputType: 'image',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: async (input) => ({
        ...fakeUploadResult(input),
        pinId: 'uploaded-other',
        metafileUri: 'metafile://uploaded-chart.png',
        verification: {
          ok: true,
          url: 'https://verify.example/uploaded-other',
          attempts: 1,
        },
      }),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_upload_invalid',
  );
});

test('uploader failure with large_file_upload_unavailable preserves provider failure code', async () => {
  const workspace = await tempWorkspace();
  await writeWorkspaceFile(workspace, 'out/movie.mp4');
  const uploadError = new Error('large_file_upload_unavailable: no uploader configured');
  uploadError.code = 'large_file_upload_unavailable';

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'attachment: ./out/movie.mp4',
      outputType: 'video',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: async () => {
        throw uploadError;
      },
      verifyAvailability: okVerifier(),
    }),
    'large_file_upload_unavailable',
  );
});

test('uploader failure message scrubs execution workspace descendant paths', async () => {
  const workspace = await tempWorkspace();
  const filePath = await writeWorkspaceFile(workspace, 'out/chart.png');
  const debugPath = path.join(workspace, 'logs/debug.log');

  const error = await captureRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: `attachment: ${filePath}`,
      outputType: 'image',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: async () => {
        throw new Error(`upload failed while reading ${debugPath}`);
      },
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_upload_failed',
  );

  assert.equal(error.message.includes(workspace), false);
  assert.equal(error.message.includes(debugPath), false);
  assert.equal(error.message.includes('logs/debug.log'), false);
});

test('files above 50 MiB fail before upload', async () => {
  const workspace = await tempWorkspace();
  const hugePath = await writeWorkspaceFile(workspace, 'out/huge.mp4', Buffer.alloc(1));
  await truncate(hugePath, LARGE_UPLOAD_MAX_BYTES + 1);
  const uploadCalls = [];

  await assertRejectCode(
    resolveProviderDeliveryArtifacts({
      responseText: 'artifactPath: ./out/huge.mp4',
      outputType: 'video',
      executionCwd: workspace,
      signer: fakeSigner(),
      uploadLargeFile: fakeUploader(uploadCalls),
      verifyAvailability: okVerifier(),
    }),
    'provider_artifact_too_large',
  );

  assert.equal(uploadCalls.length, 0);
});
