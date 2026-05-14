import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDefaultCliDependencies } = require('../../dist/cli/runtime.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

async function startRecordingDaemon() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (url.pathname === '/api/daemon/status') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(commandSuccess({ state: 'online' })));
        return;
      }

      const bodyText = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: req.method,
        pathname: url.pathname,
        query: Object.fromEntries([...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right))),
        body: bodyText ? JSON.parse(bodyText) : null,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(commandSuccess({ route: url.pathname })));
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP daemon address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

test('default CLI service dependencies use canonical service daemon routes', async (t) => {
  const daemon = await startRecordingDaemon();
  t.after(async () => daemon.close());

  const dependencies = createDefaultCliDependencies({
    cwd: process.cwd(),
    env: {
      METABOT_DAEMON_BASE_URL: daemon.baseUrl,
    },
    stdout: { write: () => true },
    stderr: { write: () => true },
  });

  await dependencies.services.listOwned({
    from: 'alice',
    all: true,
    page: 2,
    pageSize: 10,
    refresh: true,
  });
  await dependencies.services.listOwnedOrders({
    serviceId: 'svc-1',
    from: 'alice',
    all: false,
    page: 3,
    pageSize: 5,
    refresh: false,
  });
  await dependencies.services.modifyOwned({ serviceId: 'svc-1', from: 'alice' });
  await dependencies.services.revokeOwned({ serviceId: 'svc-1', from: 'alice' });
  await dependencies.services.listRefunds({ from: 'seller', all: false, kind: 'initiated' });
  await dependencies.services.settleRefund({ from: 'seller', orderId: 'order-1' });
  await dependencies.services.inspectOrder({ from: 'seller', orderId: 'order-1' });
  await dependencies.provider.inspectOrder({ from: 'seller', paymentTxid: 'payment-1' });
  await dependencies.provider.settleRefund({ orderId: 'order-2' });

  assert.deepEqual(daemon.requests, [
    {
      method: 'GET',
      pathname: '/api/services/owned',
      query: { all: 'true', from: 'alice', page: '2', pageSize: '10', refresh: 'true' },
      body: null,
    },
    {
      method: 'GET',
      pathname: '/api/services/owned/orders',
      query: { all: 'false', from: 'alice', page: '3', pageSize: '5', refresh: 'false', serviceId: 'svc-1' },
      body: null,
    },
    {
      method: 'POST',
      pathname: '/api/services/owned/modify',
      query: {},
      body: { serviceId: 'svc-1', from: 'alice' },
    },
    {
      method: 'POST',
      pathname: '/api/services/owned/revoke',
      query: {},
      body: { serviceId: 'svc-1', from: 'alice' },
    },
    {
      method: 'GET',
      pathname: '/api/services/refunds',
      query: { all: 'false', from: 'seller', kind: 'initiated' },
      body: null,
    },
    {
      method: 'POST',
      pathname: '/api/services/refunds/settle',
      query: {},
      body: { from: 'seller', orderId: 'order-1' },
    },
    {
      method: 'GET',
      pathname: '/api/services/orders/inspect',
      query: { from: 'seller', orderId: 'order-1' },
      body: null,
    },
    {
      method: 'GET',
      pathname: '/api/services/orders/inspect',
      query: { from: 'seller', paymentTxid: 'payment-1' },
      body: null,
    },
    {
      method: 'POST',
      pathname: '/api/services/refunds/settle',
      query: {},
      body: { orderId: 'order-2' },
    },
  ]);
});
