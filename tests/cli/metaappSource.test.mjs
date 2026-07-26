import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { upsertIdentityProfile, setActiveMetabotHome } = require('../../dist/core/identity/identityProfiles.js');
const { createInfrastructureConfigStore } = require('../../dist/core/config/infrastructureConfigStore.js');
const { writeMetaAppZipArchive } = require('../../dist/core/metaapp/zipArchive.js');

const VALID_PIN_ID = `${'a1b2c3d4'.repeat(8)}i0`;

async function runMetaAppCli(args, context = {}) {
  const stdout = [];
  const exitCode = await runCli(args, {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    ...context,
  });
  return {
    exitCode,
    envelope: stdout.length ? JSON.parse(stdout.join('').trim()) : null,
  };
}

test('runCli dispatches `metabot metaapp source` with a normalized bare pinId', async () => {
  for (const pinIdInput of [VALID_PIN_ID, `metaapp://${VALID_PIN_ID}`]) {
    const calls = [];
    const { exitCode, envelope } = await runMetaAppCli([
      'metaapp',
      'source',
      '--pin-id', pinIdInput,
    ], {
      dependencies: {
        metaapp: {
          source: async (input) => {
            calls.push(input);
            return commandSuccess({ dir: '/cache/app', indexFile: 'index.html', title: 'App', sourcePinId: VALID_PIN_ID });
          },
        },
      },
    });

    assert.equal(exitCode, 0, `expected success for ${pinIdInput}`);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.sourcePinId, VALID_PIN_ID);
    assert.deepEqual(calls, [{ pinId: VALID_PIN_ID }]);
  }
});

test('runCli passes --out and --from through to the `metabot metaapp source` handler', async () => {
  const calls = [];
  const { exitCode } = await runMetaAppCli([
    'metaapp',
    'source',
    '--pin-id', VALID_PIN_ID,
    '--out', './my-remix',
    '--from', 'alice',
  ], {
    dependencies: {
      metaapp: {
        source: async (input) => {
          calls.push(input);
          return commandSuccess({ dir: '/workspace/my-remix', markerPath: '/workspace/my-remix/.metaapp-fork.json' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ pinId: VALID_PIN_ID, outDir: './my-remix', from: 'alice' }]);
});

test('runCli validates `metabot metaapp source` flags before handler lookup', async () => {
  const missing = await runMetaAppCli(['metaapp', 'source'], {
    dependencies: { metaapp: { source: async () => commandSuccess({ shouldNotRun: true }) } },
  });
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.envelope.code, 'missing_flag');

  for (const bad of ['not-a-pin', 'metaapp://', `${VALID_PIN_ID}/extra`]) {
    let sourceCalled = false;
    const { exitCode, envelope } = await runMetaAppCli(['metaapp', 'source', '--pin-id', bad], {
      dependencies: {
        metaapp: {
          source: async () => {
            sourceCalled = true;
            return commandSuccess({ shouldNotRun: true });
          },
        },
      },
    });
    assert.equal(exitCode, 1, `expected failure for ${bad}`);
    assert.equal(envelope.code, 'invalid_flag', `expected invalid_flag for ${bad}`);
    assert.equal(sourceCalled, false, `handler must not run for ${bad}`);
  }

  const outWithoutValue = await runMetaAppCli(['metaapp', 'source', '--pin-id', VALID_PIN_ID, '--out'], {
    dependencies: { metaapp: { source: async () => commandSuccess({ shouldNotRun: true }) } },
  });
  assert.equal(outWithoutValue.exitCode, 1);
  assert.equal(outWithoutValue.envelope.code, 'invalid_flag');
});

test('runMetaAppCommand reports not_implemented when the source handler is missing', async () => {
  // runCli always merges default dependencies, so the missing-handler guard is
  // exercised at the command layer with a bare context.
  const { runMetaAppCommand } = require('../../dist/cli/commands/metaapp.js');
  const { createCliRuntimeContext } = require('../../dist/cli/types.js');
  const result = await runMetaAppCommand(
    ['source', '--pin-id', VALID_PIN_ID],
    createCliRuntimeContext({
      stdout: { write: () => true },
      stderr: { write: () => true },
      dependencies: { metaapp: {} },
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_implemented');
});

// --- Default runtime handler tests (no dependency stubs; HTTP stubbed locally) ---

async function makeStubZipBuffer() {
  const sourceRoot = await mkdtempTempRoot('oac-cli-metaapp-source-tree-');
  await mkdir(path.join(sourceRoot, 'assets'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'index.html'), '<h1>Stub App</h1>');
  await writeFile(path.join(sourceRoot, 'assets', 'app.js'), 'console.log("stub");');
  const archiveRoot = await mkdtempTempRoot('oac-cli-metaapp-source-zip-');
  const archive = await writeMetaAppZipArchive({
    sourceDir: sourceRoot,
    outFile: path.join(archiveRoot, 'app.zip'),
  });
  return readFile(archive.filePath);
}

// Serves the manApi pin lookup and the zip archive. The protocol record is
// completed once the ephemeral port (and therefore the content URL) is known.
async function withStubMetaAppServer(run) {
  const zipBuffer = await makeStubZipBuffer();
  let protocol = null;
  const server = http.createServer((req, res) => {
    if (req.url === `/pin/${VALID_PIN_ID}` && protocol) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        path: '/protocols/metaapp',
        contentSummary: JSON.stringify(protocol),
        timestamp: 1_700_000_000,
      }));
      return;
    }
    if (req.url === '/app.zip') {
      res.writeHead(200, { 'content-type': 'application/zip' });
      res.end(zipBuffer);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  protocol = {
    title: 'Stub App',
    appName: 'stub-app',
    content: `${baseUrl}/app.zip`,
    contentType: 'application/zip',
    indexFile: 'index.html',
    tags: ['tool', 'game'],
  };
  try {
    await run({ baseUrl });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function makeActiveProfileSystemHome() {
  const systemHome = await mkdtempTempRoot('oac-cli-metaapp-source-');
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'alice');
  await upsertIdentityProfile({
    systemHomeDir: systemHome,
    name: 'alice',
    homeDir,
    globalMetaId: 'gmid-alice',
  });
  await setActiveMetabotHome({ systemHomeDir: systemHome, homeDir });
  return systemHome;
}

async function pointManApiAt(systemHome, baseUrl) {
  const infraStore = createInfrastructureConfigStore(systemHome);
  const infra = await infraStore.read();
  await infraStore.set({ ...infra, manApiBaseUrl: baseUrl });
}

test('runCli default `metabot metaapp source` handler downloads into the shared cache', async () => {
  const systemHome = await makeActiveProfileSystemHome();

  await withStubMetaAppServer(async ({ baseUrl }) => {
    await pointManApiAt(systemHome, baseUrl);

    const { exitCode, envelope } = await runMetaAppCli([
      'metaapp',
      'source',
      '--pin-id', VALID_PIN_ID,
    ], { env: { HOME: systemHome } });

    assert.equal(exitCode, 0);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.sourcePinId, VALID_PIN_ID);
    assert.equal(envelope.data.indexFile, 'index.html');
    assert.equal(envelope.data.title, 'Stub App');
    assert.equal('markerPath' in envelope.data, false);
    // The cache lives under the active profile home inside the temp system home.
    assert.ok(envelope.data.dir.startsWith(systemHome), `cache dir ${envelope.data.dir} must stay under the temp system home`);
    assert.equal(await readFile(path.join(envelope.data.dir, 'index.html'), 'utf8'), '<h1>Stub App</h1>');
  });
});

test('runCli default `metabot metaapp source --out` handler copies the source and writes the fork marker', async () => {
  const systemHome = await makeActiveProfileSystemHome();

  await withStubMetaAppServer(async ({ baseUrl }) => {
    await pointManApiAt(systemHome, baseUrl);

    const outDir = path.join(systemHome, 'workspace', 'my-remix');
    const { exitCode, envelope } = await runMetaAppCli([
      'metaapp',
      'source',
      '--pin-id', `metaapp://${VALID_PIN_ID}`,
      '--out', outDir,
    ], { env: { HOME: systemHome } });

    assert.equal(exitCode, 0);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.dir, outDir);
    assert.equal(envelope.data.sourcePinId, VALID_PIN_ID);
    assert.equal(envelope.data.sourceUri, `metaapp://${VALID_PIN_ID}`);
    assert.equal(envelope.data.markerPath, path.join(outDir, '.metaapp-fork.json'));

    assert.equal(await readFile(path.join(outDir, 'index.html'), 'utf8'), '<h1>Stub App</h1>');
    assert.equal(await readFile(path.join(outDir, 'assets', 'app.js'), 'utf8'), 'console.log("stub");');

    const marker = JSON.parse(await readFile(envelope.data.markerPath, 'utf8'));
    assert.equal(marker.sourcePinId, VALID_PIN_ID);
    assert.equal(marker.sourceUri, `metaapp://${VALID_PIN_ID}`);
    assert.equal(marker.title, 'Stub App');
    assert.equal(marker.indexFile, 'index.html');
    assert.deepEqual(marker.tags, ['tool', 'game']);
    assert.match(marker.forkedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

test('runCli default `metabot metaapp source` handler maps a missing pin to metaapp_not_found', async () => {
  const systemHome = await makeActiveProfileSystemHome();
  const missingPinId = `${'00000000'.repeat(8)}i0`;

  await withStubMetaAppServer(async ({ baseUrl }) => {
    await pointManApiAt(systemHome, baseUrl);

    const { exitCode, envelope } = await runMetaAppCli([
      'metaapp',
      'source',
      '--pin-id', missingPinId,
    ], { env: { HOME: systemHome } });

    assert.equal(exitCode, 1);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.code, 'metaapp_not_found');
  });
});
