import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const {
  MAIL_TTL_MS,
  createSessionMailQueue,
} = require('../../dist/core/sessions/mailQueue.js');
const { createMcpSessionServer } = require('../../dist/core/sessions/mcpServer.js');
const { createSessionsDaemonHandlers } = require('../../dist/daemon/sessionsHandlers.js');

function fixedNow(startMs) {
  let current = startMs;
  return {
    now: () => current,
    advanceMs: (delta) => {
      current += delta;
    },
  };
}

// ---------- mail queue ----------

test('mailQueue hands over queued mail via checkInbox and marks it delivered', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-mail-');
  const clock = fixedNow(1_000_000);
  const queue = createSessionMailQueue({ statePath: path.join(root, 'session-mail.json'), now: clock.now });

  const entry = await queue.enqueue({
    sessionKey: 'mcp-client:pid:1',
    from: 'peer-gmid',
    fromName: 'Grok Bot',
    body: 'Did the token format change?',
  });
  assert.ok(entry.id.startsWith('mail-'));

  const handed = await queue.checkInbox({ sessionKey: 'mcp-client:pid:1' });
  assert.equal(handed.length, 1);
  assert.equal(handed[0].body, 'Did the token format change?');
  assert.ok(handed[0].deliveredAt, 'handover marks delivered');

  // Second check: nothing new (already delivered).
  assert.deepEqual(await queue.checkInbox({ sessionKey: 'mcp-client:pid:1' }), []);
  assert.equal(await queue.pendingCount('mcp-client:pid:1'), 0);

  const receipts = await queue.ackRead('mcp-client:pid:1', [handed[0].id]);
  assert.equal(receipts[0].status, 'read');
  const status = await queue.status([entry.id]);
  assert.equal(status[0].status, 'read');
  assert.equal(status[0].body, undefined, 'receipts are content-free');
});

test('mailQueue long-polls until mail arrives', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-mail-poll-');
  const queue = createSessionMailQueue({ statePath: path.join(root, 'session-mail.json') });
  const delayed = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await queue.enqueue({ sessionKey: 's:1', from: 'peer', body: 'hello' });
  })();
  const started = Date.now();
  const handed = await queue.checkInbox({ sessionKey: 's:1', waitSecs: 5 });
  assert.ok(Date.now() - started >= 400, 'waited for the mail');
  assert.equal(handed.length, 1);
  await delayed;
});

test('mailQueue expires mail after the 24h TTL', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-mail-ttl-');
  const clock = fixedNow(1_000_000);
  const statePath = path.join(root, 'session-mail.json');
  const queue = createSessionMailQueue({ statePath, now: clock.now });
  const entry = await queue.enqueue({ sessionKey: 's:ttl', from: 'peer', body: 'too late' });

  clock.advanceMs(MAIL_TTL_MS + 1);
  assert.deepEqual(await queue.checkInbox({ sessionKey: 's:ttl' }), [], 'expired mail is not handed over');
  const status = await queue.status([entry.id]);
  assert.equal(status[0].status, 'expired');

  // Read mail is retained for the TTL then dropped.
  clock.advanceMs(MAIL_TTL_MS + 1);
  await queue.status([entry.id]);
  const persisted = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(persisted.entries.length, 0, 'expired mail is pruned from the store');
});

// ---------- MCP server protocol ----------

test('mcpServer answers initialize, tools/list, tools/call and ignores notifications', async () => {
  const backend = {
    listSessions: async () => ({ ok: true, state: 'success', data: { sessions: [] } }),
    registerSession: async () => ({ ok: true, state: 'success', data: { record: { sessionKey: 'mcp-client:pid:9' } } }),
    checkInbox: async ({ sessionKey, waitSecs }) => ({
      ok: true,
      state: 'success',
      data: { messages: [{ id: 'mail-1', from: 'peer', body: 'hi' }], pending: 0, sessionKey, waitSecs },
    }),
    messageStatus: async ({ ids }) => ({ ok: true, state: 'success', data: { receipts: ids.map((id) => ({ id, status: 'queued' })) } }),
  };

  const requestLines = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_inbox', arguments: { wait_secs: 0 } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'message_status', arguments: { ids: ['a'] } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'ping' }),
    JSON.stringify('not-an-object'),
    '{broken json',
    JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'no/such_method' }),
  ];

  const responses = [];
  const server = createMcpSessionServer(
    {
      input: (async function* generate() {
        for (const line of requestLines) {
          yield line;
          await new Promise((resolve) => setImmediate(resolve));
        }
      })(),
      write: (line) => responses.push(JSON.parse(line)),
    },
    backend,
    { sessionKey: 'mcp-client:pid:9' },
  );
  await server.run();

  assert.equal(responses.length, 8, 'notification produced no response');
  const [init, tools, inbox, status, ping, badObject, badJson, unknown] = responses;
  assert.equal(init.result.protocolVersion, '2025-03-26', 'initialize echoes the requested version');
  assert.equal(init.result.serverInfo.name, 'metabot-sessions');
  assert.equal(tools.result.tools.length, 4);
  const toolNames = tools.result.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames, ['list_sessions', 'check_inbox', 'message_status', 'send_message']);
  assert.equal(inbox.result.isError, false);
  const inboxPayload = JSON.parse(inbox.result.content[0].text);
  assert.equal(inboxPayload.data.messages[0].body, 'hi');
  assert.equal(status.result.isError, false);
  assert.deepEqual(ping.result, {});
  assert.equal(badObject.error.code, -32600);
  assert.equal(badJson.error.code, -32700);
  assert.equal(unknown.error.code, -32601);
});

test('mcpServer check_inbox without a bound session errors; failing tools report isError', async () => {
  const responses = [];
  const server = createMcpSessionServer(
    {
      input: (async function* generate() {
        yield JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_inbox', arguments: {} } });
        yield JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_sessions', arguments: {} } });
        await new Promise((resolve) => setTimeout(resolve, 20));
      })(),
      write: (line) => responses.push(JSON.parse(line)),
    },
    {
      listSessions: async () => { throw new Error('daemon down'); },
      registerSession: async () => ({}),
      checkInbox: async () => ({}),
      messageStatus: async () => ({}),
    },
    {},
  );
  await server.run();
  assert.equal(responses.length, 2);
  assert.equal(responses[0].result.isError, true, 'no bound session -> tool error');
  assert.match(responses[0].result.content[0].text, /no bound session/);
  assert.equal(responses[1].result.isError, true, 'backend throw -> tool error');
  assert.match(responses[1].result.content[0].text, /daemon down/);
});

// ---------- daemon handler verbs ----------

test('sessions handlers register a session and serve its inbox end to end', async () => {
  const root = await mkdtempTempRoot('metabot-sessions-handlers-p2-');
  const handlers = createSessionsDaemonHandlers({ systemHomeDir: root });

  const registered = await handlers.register({ agent: 'mcp-client', pid: 4242 });
  assert.equal(registered.ok, true);
  assert.equal(registered.data.record.sessionKey, 'mcp-client:pid:4242');
  assert.equal(registered.data.record.deliverable, true);
  assert.equal(registered.data.record.source, 'mcp');

  const badAgent = await handlers.register({ agent: '' });
  assert.equal(badAgent.ok, false);
  assert.equal(badAgent.code, 'invalid_session_agent');

  const enqueued = await handlers.inboxEnqueue({
    sessionKey: 'mcp-client:pid:4242',
    from: 'peer-gmid',
    fromName: 'Grok Bot',
    body: 'hello session',
  });
  assert.equal(enqueued.ok, true);

  const checked = await handlers.inboxCheck({ sessionKey: 'mcp-client:pid:4242' });
  assert.equal(checked.ok, true);
  assert.equal(checked.data.messages.length, 1);
  assert.equal(checked.data.messages[0].body, 'hello session');
  assert.equal(checked.data.pending, 0);

  const status = await handlers.messageStatus({ ids: [enqueued.data.entry.id] });
  assert.equal(status.data.receipts[0].status, 'delivered');

  const badEnqueue = await handlers.inboxEnqueue({ sessionKey: '', from: 'x', body: 'y' });
  assert.equal(badEnqueue.ok, false);
  assert.equal(badEnqueue.code, 'invalid_session_mail');

  const emptyKey = await handlers.inboxCheck({ sessionKey: '' });
  assert.equal(emptyKey.ok, false);
  assert.equal(emptyKey.code, 'invalid_session_key');
});
