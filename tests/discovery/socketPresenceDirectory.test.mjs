import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  readOnlineMetaBotsFromSocketPresence,
} = require('../../dist/core/discovery/socketPresenceDirectory.js');

test('readOnlineMetaBotsFromSocketPresence returns normalized bot rows from online-users API', async () => {
  const calls = [];
  const result = await readOnlineMetaBotsFromSocketPresence({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              total: 2,
              cursor: 0,
              size: 10,
              onlineWindowSeconds: 1200,
              list: [
                {
                  globalMetaId: 'idq1bot-a',
                  lastSeenAt: 1776836184230,
                  lastSeenAgoSeconds: 13,
                  deviceCount: 1,
                },
                {
                  globalMetaId: 'idq1bot-b',
                  lastSeenAt: 1776836183000,
                  lastSeenAgoSeconds: 16,
                  deviceCount: 2,
                },
              ],
            },
          };
        },
      };
    },
    apiBaseUrl: 'https://api.idchat.io',
    limit: 10,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /group-chat\/socket\/online-users\?cursor=0&size=10&withUserInfo=true$/);
  assert.deepEqual(result, {
    source: 'socket_presence',
    total: 2,
    onlineWindowSeconds: 1200,
    bots: [
      {
        globalMetaId: 'idq1bot-a',
        lastSeenAt: 1776836184230,
        lastSeenAgoSeconds: 13,
        deviceCount: 1,
        online: true,
        name: '',
        goal: '',
      },
      {
        globalMetaId: 'idq1bot-b',
        lastSeenAt: 1776836183000,
        lastSeenAgoSeconds: 16,
        deviceCount: 2,
        online: true,
        name: '',
        goal: '',
      },
    ],
  });
});

test('readOnlineMetaBotsFromSocketPresence clamps limit to API maximum size 100', async () => {
  const calls = [];
  await readOnlineMetaBotsFromSocketPresence({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            code: 0,
            data: {
              total: 0,
              cursor: 0,
              size: 100,
              onlineWindowSeconds: 1200,
              list: [],
            },
          };
        },
      };
    },
    apiBaseUrl: 'https://api.idchat.io',
    limit: 999,
  });

  assert.match(calls[0], /group-chat\/socket\/online-users\?cursor=0&size=100&withUserInfo=true$/);
});

test('readOnlineMetaBotsFromSocketPresence throws when API envelope is not successful', async () => {
  await assert.rejects(
    async () => readOnlineMetaBotsFromSocketPresence({
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            code: 1001,
            message: 'invalid request',
          };
        },
      }),
      apiBaseUrl: 'https://api.idchat.io',
      limit: 10,
    }),
    /socket_presence_semantic_error/
  );
});
