import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const plugin = await import('../lib/group-chat-tools.js')

// Openssl-pinned vector 1 (see tests/group/groupCrypto.test.mjs in the repo
// root): this groupId + plaintext must encrypt to exactly this hex.
const VEC1_GROUP = '4ffab5a80123456789abcdef0123456789abcdef0123456789abcdef01234567i0'
const VEC1_PLAINTEXT = 'hello group'
const VEC1_CIPHERTEXT = '62c543cdbbf7ec3115c55b20cc4ebdfe'

function fakeHost(overrides = {}) {
  const tools = []
  return {
    tools,
    ctx: {
      tools: { register: (definition) => tools.push(definition) },
      logger: { warn: () => undefined },
      ...overrides,
    },
  }
}

function fakeRun(result) {
  const calls = []
  return {
    calls,
    run: async (args, options) => {
      // runMetabotWithPayloadFile deletes its temp payload on return, so the
      // payload must be captured synchronously here.
      const flagIndex = args.indexOf('--request-file')
      const payload = flagIndex >= 0
        ? JSON.parse(readFileSync(args[flagIndex + 1], 'utf8'))
        : undefined
      calls.push({ args, options, payload })
      return result ?? {
        ok: true,
        state: 'success',
        data: { pinId: 'g1', txids: ['t1'], totalCost: 421 },
      }
    },
  }
}

function fakeCrypto() {
  return { encryptGroupMessage: (message, groupId) => `fakecipher:${groupId.slice(0, 8)}:${Buffer.from(message, 'utf8').toString('hex')}` }
}

function buildTool(host, run, loadGroupCrypto) {
  const [tool] = plugin.buildGroupChatToolDefinitions({
    host: host.ctx,
    hostAgent: { ctx: host.ctx },
    run,
    ...(loadGroupCrypto ? { loadGroupCrypto } : {}),
  })
  assert.equal(tool.name, 'group_chat')
  return tool
}

test('group_chat registers on the global layer', () => {
  const host = fakeHost()
  plugin.bindGroupChatToolInstall(host.ctx)
  assert.deepEqual(host.tools.map((tool) => tool.name), ['group_chat'])
})

test('invalid or missing action is rejected before any CLI call', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const tool = buildTool(host, run, fakeCrypto)

  const missing = await tool.execute({ group_id: VEC1_GROUP }, {})
  assert.match(missing, /requires `action`/)
  const bogus = await tool.execute({ action: 'orchestrate', group_id: VEC1_GROUP }, {})
  assert.match(bogus, /requires `action`/)
  assert.match(bogus, /join_group/)
  assert.equal(calls.length, 0)
})

test('group_id rejection branches teach the Task#65 defense before any CLI call', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const tool = buildTool(host, run, fakeCrypto)

  const empty = await tool.execute({ action: 'join_group' }, {})
  assert.match(empty, /requires `group_id`/)
  assert.match(empty, /Do not invent one — ask the user\./)

  // A bare number is the task NUMBER, not a group id.
  const taskNumber = await tool.execute({ action: 'join_group', group_id: '65' }, {})
  assert.match(taskNumber, /Invalid group_id "65"/)
  assert.match(taskNumber, /64 lowercase hex chars followed by "i0" \(66 characters\)/)
  assert.match(taskNumber, /"65" is the TASK number, not a group id/)

  const upper = await tool.execute({ action: 'join_group', group_id: '4FFAB5A80123456789ABCDEF0123456789ABCDEF0123456789ABCDEF01234567I0' }, {})
  assert.match(upper, /Invalid group_id/)
  const short = await tool.execute({ action: 'send_group_message', group_id: 'abc123', content: 'hi' }, {})
  assert.match(short, /Invalid group_id "abc123"/)

  assert.equal(calls.length, 0, 'no CLI call may happen on group_id validation failure')
})

test('join_group maps args to the chat group join CLI request', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost({ agentPresets: { composedPreset: () => 'oac-alice' } })
  const tool = buildTool(host, run)

  const ok = await tool.execute({
    action: 'join_group',
    group_id: VEC1_GROUP,
    referrer: 'idq1inviter',
    k: 'encoded-key',
  }, {})
  assert.match(ok, /Joined group on-chain \(SimpleGroupJoin\)\./)
  assert.match(ok, /- pinId: g1/)
  assert.match(ok, /- txids: t1/)
  assert.match(ok, /- cost: 421 sats/)
  assert.match(ok, /- pin link: \[pin:\/\/g1\]\(pin:\/\/g1\)/)

  assert.deepEqual(calls[0].args.slice(0, 6), ['chat', 'group', 'join', '--from', 'alice', '--request-file'])
  assert.deepEqual(calls[0].payload, {
    groupId: VEC1_GROUP,
    referrer: 'idq1inviter',
    k: 'encoded-key',
  })
})

test('join_group omits referrer/k/network when empty and forwards an explicit network', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const tool = buildTool(host, run)

  await tool.execute({ action: 'join_group', group_id: VEC1_GROUP }, {})
  assert.deepEqual(calls[0].payload, { groupId: VEC1_GROUP })

  await tool.execute({ action: 'join_group', group_id: VEC1_GROUP, network: 'doge' }, {})
  assert.deepEqual(calls[1].payload, { groupId: VEC1_GROUP, network: 'doge' })

  const invalidNetwork = await tool.execute({ action: 'join_group', group_id: VEC1_GROUP, network: 'eth' }, {})
  assert.match(invalidNetwork, /Invalid network "eth"/)
})

test('send_group_message carries CIPHERTEXT (never plaintext) and no model-supplied nickName', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const tool = buildTool(host, run, fakeCrypto)

  const ok = await tool.execute({
    action: 'send_group_message',
    group_id: VEC1_GROUP,
    content: VEC1_PLAINTEXT,
    // The model must never control the on-chain sender name; a sneaked
    // nickname has to be dropped on the floor.
    nick_name: 'claude bot',
    nickName: 'claude bot',
    reply_pin: 'rp1',
    channel_id: 'ch9',
    mention: ['idq1peer', ' ', 42],
  }, {})
  assert.match(ok, /Group message sent \(SimpleGroupChat\)\./)
  assert.match(ok, /- pinId: g1/)

  assert.deepEqual(calls[0].args.slice(0, 4), ['chat', 'group', 'send', '--request-file'])
  const payload = calls[0].payload
  assert.equal(payload.groupId, VEC1_GROUP)
  assert.equal(payload.replyPin, 'rp1')
  assert.equal(payload.channelId, 'ch9')
  assert.deepEqual(payload.mention, ['idq1peer'])
  // The content field is the loader's ciphertext output, not the plaintext.
  assert.equal(payload.content, `fakecipher:4ffab5a8:${Buffer.from(VEC1_PLAINTEXT, 'utf8').toString('hex')}`)
  assert.notEqual(payload.content, VEC1_PLAINTEXT)
  // No nickname of any spelling rides the wire.
  assert.ok(!('nickName' in payload))
  assert.ok(!('nick_name' in payload))
})

test('send_group_message omits reply/channel/mention when empty', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const tool = buildTool(host, run, fakeCrypto)

  await tool.execute({ action: 'send_group_message', group_id: VEC1_GROUP, content: 'hi', reply_pin: '', channel_id: '  ' }, {})
  assert.deepEqual(calls[0].payload, { groupId: VEC1_GROUP, content: `fakecipher:4ffab5a8:${Buffer.from('hi', 'utf8').toString('hex')}` })
})

test('send_group_message requires content', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const tool = buildTool(host, run, fakeCrypto)

  const missing = await tool.execute({ action: 'send_group_message', group_id: VEC1_GROUP }, {})
  assert.match(missing, /requires `content`/)
  assert.equal(calls.length, 0)
})

test('send_group_message fails closed when the group crypto module cannot be loaded', async () => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const tool = buildTool(host, run, () => null)

  const out = await tool.execute({ action: 'send_group_message', group_id: VEC1_GROUP, content: 'hi' }, {})
  assert.match(out, /could not load the OAC group crypto module/)
  assert.match(out, /NOT sent/)
  assert.equal(calls.length, 0, 'no CLI call may happen without encryption')
})

test('send_group_message encrypts through the default local-read loader (openssl vec1, byte-exact)', async (t) => {
  const { run, calls } = fakeRun()
  const host = fakeHost()
  const [tool] = plugin.buildGroupChatToolDefinitions({ host: host.ctx, hostAgent: { ctx: host.ctx }, run })

  const out = await tool.execute({ action: 'send_group_message', group_id: VEC1_GROUP, content: VEC1_PLAINTEXT }, {})
  if (/could not load the OAC group crypto module/.test(out)) {
    // Root dist not resolvable in this context (e.g. OAC_METABOT_CLI_PATH
    // pointing at an older runtime); the byte-exact vectors are pinned by
    // the root suite (tests/group/groupCrypto.test.mjs) and the bridge
    // wiring is proven by the injected-loader tests above.
    t.skip('OAC dist with core/group/groupCrypto.js not resolvable from this process')
    return
  }
  assert.match(out, /Group message sent/)
  assert.equal(calls[0].payload.content, VEC1_CIPHERTEXT, 'content is the openssl-pinned ciphertext')
  assert.notEqual(calls[0].payload.content, VEC1_PLAINTEXT, 'content is not the plaintext')
})

test('daemon failures pass through for both actions', async () => {
  const failing = fakeRun({ ok: false, state: 'failed', code: 'invalid_group_id', message: 'Invalid group_id "65": an on-chain group id is the group\'s pin id — exactly 64 lowercase hex chars followed by "i0" (66 characters). A bare number such as "65" is the TASK number, not a group id.' })
  const host = fakeHost()
  const joinTool = buildTool(host, failing.run)
  const joinErr = await joinTool.execute({ action: 'join_group', group_id: '65' }, {})
  assert.match(joinErr, /Invalid group_id "65"/)
  assert.match(joinErr, /TASK number/)

  const sendFailing = fakeRun({ ok: false, state: 'failed', code: 'identity_missing', message: 'Create a local MetaBot identity before sending a group message.' })
  const sendTool = buildTool(fakeHost(), sendFailing.run, fakeCrypto)
  const sendErr = await sendTool.execute({ action: 'send_group_message', group_id: VEC1_GROUP, content: 'hi' }, {})
  assert.match(sendErr, /Send group message failed: Create a local MetaBot identity before sending a group message\./)
})
