import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

async function withLlmServer(fn) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const bodyText = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: req.method,
      url: req.url,
      body: bodyText ? JSON.parse(bodyText) : null,
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, state: 'success', data: { accepted: true } }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await fn({
      port: address.port,
      requests,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runLlm(args, port) {
  const stdout = [];
  const exitCode = await runCli(args, {
    env: {
      ...process.env,
      METABOT_DAEMON_PORT: String(port),
    },
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  return {
    exitCode,
    payload: JSON.parse(stdout.join('').trim()),
  };
}

test('runCli uses --from as the canonical LLM binding actor selector', async () => {
  await withLlmServer(async ({ port, requests }) => {
    const bindings = await runLlm(['llm', 'bindings', '--from', 'alice'], port);
    const bind = await runLlm(['llm', 'bind', '--from', 'alice', '--runtime-id', 'runtime-1', '--role', 'primary'], port);

    assert.equal(bindings.exitCode, 0);
    assert.equal(bind.exitCode, 0);
    assert.equal(bindings.payload.ok, true);
    assert.equal(bind.payload.ok, true);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].url, '/api/llm/bindings/alice');
    assert.equal(requests[1].method, 'PUT');
    assert.equal(requests[1].url, '/api/llm/bindings/alice');
    assert.equal(requests[1].body.bindings[0].metaBotSlug, 'alice');
  });
});

test('runCli forwards --from to LLM unbind and preferred runtime commands', async () => {
  await withLlmServer(async ({ port, requests }) => {
    await runLlm(['llm', 'unbind', '--from', 'alice', '--binding-id', 'binding-1'], port);
    await runLlm(['llm', 'set-preferred', '--from', 'alice', '--runtime-id', 'runtime-1'], port);
    await runLlm(['llm', 'get-preferred', '--from', 'alice'], port);

    assert.deepEqual(requests.map((entry) => [entry.method, entry.url]), [
      ['DELETE', '/api/llm/bindings/binding-1/delete?from=alice'],
      ['PUT', '/api/llm/preferred-runtime/alice'],
      ['GET', '/api/llm/preferred-runtime/alice'],
    ]);
    assert.deepEqual(requests[1].body, { runtimeId: 'runtime-1' });
  });
});
