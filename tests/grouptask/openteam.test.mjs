import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempTempRootSync } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const openteam = require('../../dist/core/grouptask/openteam.js');
const {
  buildOpenTeamInviteMessage,
  buildOpenTeamAcceptMessage,
  buildOpenTeamDeclineMessage,
  buildOpenTeamKickMessage,
  generateOpenTeamInviteId,
  isOpenTeamEnvelopeText,
  parseOpenTeamEnvelope,
} = openteam;
const { createOpenTeamStore } = require('../../dist/core/grouptask/openteamStore.js');
const { createGroupTaskEngine } = require('../../dist/core/grouptask/engine.js');
const { createGroupTaskStore } = require('../../dist/core/grouptask/store.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { inviteRemoteMember, listOpenTeamCollabs } = require('../../dist/core/grouptask/openteamService.js');
const { classifySimplemsgContent } = require('../../dist/core/a2a/simplemsgClassifier.js');
const { decryptGroupContent } = require('../../dist/core/appSession/groupChat.js');

// ---------------------------------------------------------------------------
// Protocol round trips
// ---------------------------------------------------------------------------

function samplePayload(overrides = {}) {
  return {
    v: 1,
    inviteId: generateOpenTeamInviteId(),
    groupId: 'grp-ot',
    taskTitle: 'Haiku sprint',
    goalSummary: 'Write three haiku',
    requiredSkills: ['poetry'],
    inviterGlobalMetaId: 'IDCHAIR',
    inviterName: 'twin bot',
    chairGlobalMetaId: 'IDCHAIR',
    targetGlobalMetaId: 'IDREMOTE',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
}

test('openteam protocol: invite/accept/decline/kick round-trip the exact wire shapes', () => {
  const payload = samplePayload();
  const inviteText = buildOpenTeamInviteMessage(payload);
  assert.ok(inviteText.startsWith('[OPENTEAM_INVITE] {'));
  const parsedInvite = parseOpenTeamEnvelope(inviteText);
  assert.equal(parsedInvite.kind, 'invite');
  assert.deepEqual(parsedInvite.payload, payload);

  const acceptText = buildOpenTeamAcceptMessage(payload.inviteId, 'join-pin-1');
  assert.equal(acceptText, `[OPENTEAM_ACCEPT:${payload.inviteId}] {"joinedPinId":"join-pin-1"}`);
  const parsedAccept = parseOpenTeamEnvelope(acceptText);
  assert.deepEqual(parsedAccept, { kind: 'accept', inviteId: payload.inviteId, joinedPinId: 'join-pin-1' });

  const declineText = buildOpenTeamDeclineMessage(payload.inviteId, 'remote_collab_disabled');
  const parsedDecline = parseOpenTeamEnvelope(declineText);
  assert.deepEqual(parsedDecline, {
    kind: 'decline',
    inviteId: payload.inviteId,
    reason: 'remote_collab_disabled',
  });

  const kickText = buildOpenTeamKickMessage({ v: 1, groupId: 'grp-ot', taskTitle: 'Haiku sprint', reason: 'idle' });
  const parsedKick = parseOpenTeamEnvelope(kickText);
  assert.equal(parsedKick.kind, 'kick');
  assert.equal(parsedKick.payload.groupId, 'grp-ot');
  assert.equal(parsedKick.payload.reason, 'idle');
});

test('openteam protocol: tolerant parsing — wrapper JSON, malformed bodies, non-envelopes', () => {
  const payload = samplePayload();
  const wrapped = JSON.stringify({ content: buildOpenTeamInviteMessage(payload), extensions: { a: 1 } });
  assert.equal(parseOpenTeamEnvelope(wrapped).kind, 'invite');

  assert.equal(parseOpenTeamEnvelope('[OPENTEAM_INVITE] not-json'), null);
  assert.equal(parseOpenTeamEnvelope('[OPENTEAM_INVITE] {"inviteId":"bad"}'), null);
  assert.equal(parseOpenTeamEnvelope('hello world'), null);
  assert.equal(parseOpenTeamEnvelope('[OPENTEAM_ACCEPT:not-a-pin] {}'), null);

  // Bare accept without the JSON body still parses (joinedPinId null).
  const bare = parseOpenTeamEnvelope(`[OPENTEAM_ACCEPT:${payload.inviteId}]`);
  assert.deepEqual(bare, { kind: 'accept', inviteId: payload.inviteId, joinedPinId: null });

  assert.equal(isOpenTeamEnvelopeText('[OPENTEAM_KICK] {}'), true);
  assert.equal(isOpenTeamEnvelopeText('[ORDER:abc]'), false);
});

test('simplemsg classifier: openteam envelopes are their own record-only kind', () => {
  assert.equal(classifySimplemsgContent('[OPENTEAM_INVITE] {"x":1}').kind, 'openteam_envelope');
  assert.equal(classifySimplemsgContent(`[OPENTEAM_ACCEPT:${'a'.repeat(64)}i0] {}`).tag, 'OPENTEAM_ACCEPT');
  assert.equal(classifySimplemsgContent('[OPENTEAM_DECLINE:abc] no').kind, 'openteam_envelope');
  assert.equal(classifySimplemsgContent('plain chat').kind, 'private_chat');
  assert.equal(classifySimplemsgContent('[ORDER_END done]').kind, 'order_protocol');
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

test('openteam store: invite, guest invite, and membership lifecycles persist', async () => {
  const root = mkdtempTempRootSync('metabot-openteam-store-');
  const home = path.join(root, '.metabot', 'profiles', 'bot');
  mkdirSync(home, { recursive: true });
  const store = createOpenTeamStore(resolveMetabotPaths(home));

  const invite = await store.createInvite({
    taskId: 1,
    groupId: 'grp-1',
    inviteId: generateOpenTeamInviteId(),
    inviteeGlobalMetaId: 'IDREMOTE',
    inviteeName: 'Remote Bot',
    requiredSkills: ['poetry'],
    expiresAt: 1000,
  });
  assert.equal(invite.status, 'pending');
  await store.updateInvite(invite.inviteId, { status: 'accepted', joinedPinId: 'jp-1', respondedAt: 5 });
  assert.equal((await store.getInviteByInviteId(invite.inviteId)).status, 'accepted');
  assert.equal((await store.listInvites(1)).length, 1);
  assert.equal((await store.listInvites(2)).length, 0);

  const guest = await store.createGuestInvite({
    groupId: 'grp-2',
    inviteId: generateOpenTeamInviteId(),
    inviterGlobalMetaId: 'IDCHAIR',
    taskTitle: 'T',
    targetGlobalMetaId: 'IDME',
    expiresAt: 2000,
    status: 'invited',
  });
  await store.updateGuestInvite(guest.inviteId, { status: 'accepted', joinedPinId: 'jp-2' });
  assert.equal((await store.getGuestInviteByInviteId(guest.inviteId)).joinedPinId, 'jp-2');

  await store.createMembership({
    groupId: 'grp-2',
    slug: 'bot',
    inviterGlobalMetaId: 'IDCHAIR',
    inviterName: 'Chair',
    taskTitle: 'T',
    inviteId: guest.inviteId,
    joinedPinId: 'jp-2',
  });
  await store.updateMembershipCursor('grp-2', 'bot', 7);
  assert.equal((await store.getMembership('grp-2', 'bot')).lastProcessedIndex, 7);
  await store.leaveMembership('grp-2', 'bot', 'kick', 'idle');
  const left = await store.getMembership('grp-2', 'bot');
  assert.equal(left.status, 'left');
  assert.equal(left.leftCause, 'kick');
  assert.equal((await store.listMemberships({ activeOnly: true })).length, 0);

  // Re-invite reactivates the same (groupId, slug) row.
  await store.createMembership({
    groupId: 'grp-2',
    slug: 'bot',
    inviterGlobalMetaId: 'IDCHAIR',
    taskTitle: 'T2',
    inviteId: generateOpenTeamInviteId(),
  });
  const revived = await store.getMembership('grp-2', 'bot');
  assert.equal(revived.status, 'active');
  assert.equal(revived.taskTitle, 'T2');
  assert.equal((await store.listMemberships()).length, 1);

  await store.kvSet('k', 'v');
  assert.equal(await store.kvGet('k'), 'v');
  await store.kvDelete('k');
  assert.equal(await store.kvGet('k'), undefined);
});

// ---------------------------------------------------------------------------
// Engine harness with OpenTeam seams
// ---------------------------------------------------------------------------

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

function createHarness(prefix) {
  const systemHome = mkdtempTempRootSync(prefix);
  const pins = [];
  const privateSends = [];
  let pinSeq = 0;

  const makeProfile = (slug, botType, gmid) => {
    const homeDir = path.join(systemHome, '.metabot', 'profiles', slug);
    mkdirSync(homeDir, { recursive: true });
    return {
      slug,
      homeDir,
      name: slug.replace(/-/gu, ' '),
      globalMetaId: gmid,
      metaId: `meta-${slug}`,
      botType,
      avatar: null,
    };
  };
  const profiles = [
    makeProfile('twin-bot', 'twin', 'IDTWIN'),
    makeProfile('worker-1', 'worker', 'IDWORKER1'),
  ];

  const makeSigner = (label) => ({
    async writePin(request) {
      pinSeq += 1;
      const pinId = `pin-${label}-${pinSeq}`;
      pins.push({ label, pinId, ...request });
      return { pinId, txId: `tx-${pinSeq}` };
    },
  });

  const indexer = {
    groupInfo: new Map(),   // groupId -> { createUserGlobalMetaId }
    members: new Map(),     // groupId -> string[]
    history: new Map(),     // groupId -> rows
  };
  const fetchImpl = async (input) => {
    const url = String(input);
    const parsed = new URL(url);
    const groupId = parsed.searchParams.get('groupId');
    if (url.includes('/group-info')) {
      const info = indexer.groupInfo.get(groupId);
      if (!info) return jsonResponse({ code: 1, data: null });
      return jsonResponse({ code: 0, data: { groupId, ...info } });
    }
    if (url.includes('/group-member-list')) {
      const list = indexer.members.get(groupId) ?? [];
      return jsonResponse({ code: 0, data: { list: list.map((id) => ({ metaId: id, globalMetaId: id })) } });
    }
    if (url.includes('/group-chat-list-by-index')) {
      const start = Number(parsed.searchParams.get('startIndex'));
      const size = Number(parsed.searchParams.get('size'));
      const rows = (indexer.history.get(groupId) ?? []).filter((item) => item.index >= start).slice(0, size);
      return jsonResponse({ code: 0, data: { list: rows } });
    }
    throw new Error(`Unexpected fake indexer URL: ${url}`);
  };

  const stores = new Map();
  const openteamStores = new Map();
  const storeForProfile = (profile) => {
    let store = stores.get(profile.slug);
    if (!store) {
      store = createGroupTaskStore(resolveMetabotPaths(profile.homeDir));
      stores.set(profile.slug, store);
    }
    return store;
  };
  const openteamStoreForProfile = (profile) => {
    let store = openteamStores.get(profile.slug);
    if (!store) {
      store = createOpenTeamStore(resolveMetabotPaths(profile.homeDir));
      openteamStores.set(profile.slug, store);
    }
    return store;
  };

  /** Per-slug inbound private messages the envelope scan reads. */
  const inbox = new Map();
  let inboxSeq = 0;
  const pushInbound = (slug, senderGmid, content) => {
    inboxSeq += 1;
    const list = inbox.get(slug) ?? [];
    list.push({
      messageId: `pm-${inboxSeq}`,
      senderGlobalMetaId: senderGmid,
      content,
      timestamp: Math.floor(Date.now() / 1000),
    });
    inbox.set(slug, list);
  };

  const llmTurns = [];
  const llmCalls = [];
  const runLlmTurn = async (turn) => {
    llmCalls.push(turn);
    const script = llmTurns.shift();
    if (!script) throw new Error(`Unscripted LLM turn for ${turn.profile.slug}`);
    if (typeof script === 'function') return script(turn);
    return script;
  };

  const ctx = {
    listProfiles: async () => profiles,
    getProfile: async (slug) => profiles.find((profile) => profile.slug === slug) ?? null,
    signerForSlug: async (slug) => makeSigner(slug),
    ownerIdentity: async () => ({
      globalMetaId: 'IDOWNER', metaId: 'meta-owner', name: 'Owner', signer: makeSigner('owner'),
    }),
    storeForProfile,
    openteamStoreForProfile,
    sendPrivateMessage: async (input) => {
      pinSeq += 1;
      const pinId = `pmsg-${pinSeq}`;
      privateSends.push({ ...input, pinId });
      return { pinId };
    },
    transport: { indexerHosts: ['https://fake-indexer.test'], fetchImpl },
  };

  const engine = createGroupTaskEngine({
    ctx,
    runLlmTurn,
    loadPersona: async () => ({}),
    readInboundPrivateMessages: async (profile) => inbox.get(profile.slug) ?? [],
    workerCooldownMs: 0,
    chairCooldownMs: 0,
  });

  const pushHistory = (groupId, index, gmid, content, opts = {}) => {
    const rows = indexer.history.get(groupId) ?? [];
    rows.push({
      index,
      txId: `tx-h${index}`,
      pinId: `hpin-${groupId}-${index}`,
      groupId,
      globalMetaId: gmid,
      metaId: `meta-h${index}`,
      content,
      contentType: 'text/plain',
      encryption: '0',
      timestamp: 1_700_000_000 + index,
      userInfo: { name: gmid.toLowerCase() },
      ...(opts.mention ? { mention: opts.mention } : {}),
    });
    indexer.history.set(groupId, rows);
  };

  const chairStore = storeForProfile(profiles[0]);
  const seedChairedTask = async () => {
    const task = await chairStore.createTask({
      groupId: 'grp-ot',
      title: 'Haiku sprint',
      goal: 'Write three haiku',
      acceptanceCriteria: 'Three verses',
      chairSlug: 'twin-bot',
      chairGlobalMetaId: 'IDTWIN',
      createdBy: 'user',
    });
    await chairStore.addMember({ taskId: task.id, slug: 'twin-bot', globalMetaId: 'IDTWIN', role: 'chair' });
    await chairStore.updateTaskStatus(task.id, 'executing');
    await chairStore.kvSet(`group_task_chair_planned:${task.id}`, '1');
    indexer.groupInfo.set('grp-ot', { createUserGlobalMetaId: 'IDTWIN' });
    indexer.members.set('grp-ot', ['IDTWIN']);
    return (await chairStore.getTaskById(task.id));
  };

  return {
    ctx, engine, pins, privateSends, llmTurns, llmCalls, indexer,
    pushInbound, pushHistory, chairStore, openteamStoreForProfile,
    seedChairedTask, profiles,
  };
}

function pinPlaintext(pin) {
  try {
    const payload = JSON.parse(pin.payload);
    return decryptGroupContent(String(payload.content ?? ''), String(payload.groupId ?? ''));
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Inviter flow
// ---------------------------------------------------------------------------

test('openteam inviter: invite → accept envelope → indexer join confirm → remote member + welcome', async () => {
  const h = createHarness('metabot-ot-inviter-');
  const task = await h.seedChairedTask();

  const invite = await inviteRemoteMember(h.ctx, 'twin-bot', task.id, {
    globalMetaId: 'IDREMOTE',
    name: 'Remote Poet',
    requiredSkills: ['poetry'],
  });
  assert.equal(invite.status, 'pending');
  assert.equal(h.privateSends.length, 1);
  assert.equal(h.privateSends[0].toGlobalMetaId, 'IDREMOTE');
  const sentEnvelope = parseOpenTeamEnvelope(h.privateSends[0].content);
  assert.equal(sentEnvelope.kind, 'invite');
  assert.equal(sentEnvelope.payload.groupId, 'grp-ot');
  assert.equal(sentEnvelope.payload.inviterGlobalMetaId, 'IDTWIN');

  // Duplicate pending invite is rejected.
  await assert.rejects(
    () => inviteRemoteMember(h.ctx, 'twin-bot', task.id, { globalMetaId: 'IDREMOTE' }),
    /pending invite/u,
  );

  // Remote accepts: envelope arrives in the chair's private inbox.
  h.pushInbound('twin-bot', 'IDREMOTE', buildOpenTeamAcceptMessage(invite.inviteId, 'join-pin-9'));
  await h.engine.tick();

  const openteamStore = h.openteamStoreForProfile(h.profiles[0]);
  let stored = await openteamStore.getInviteByInviteId(invite.inviteId);
  assert.equal(stored.status, 'accepted');
  assert.equal(stored.joinedPinId, 'join-pin-9');
  assert.equal(stored.memberAddedAt, null, 'join not visible on the indexer yet');

  // The join lands on the indexer member list.
  h.indexer.members.set('grp-ot', ['IDTWIN', 'IDREMOTE']);
  await h.engine.tick();

  stored = await openteamStore.getInviteByInviteId(invite.inviteId);
  assert.ok(stored.memberAddedAt != null, 'member seated');
  const members = await h.chairStore.listMembers(task.id);
  const remote = members.find((member) => member.slug == null);
  assert.ok(remote, 'remote member row added');
  assert.equal(remote.globalMetaId, 'IDREMOTE');
  assert.equal(remote.displayName, 'Remote Poet');
  assert.equal(remote.joinedPinId, 'join-pin-9');
  const welcome = h.pins.find((pin) => pinPlaintext(pin).includes('[GROUP_TASK_NOTICE:openteam_joined]'));
  assert.ok(welcome, 'welcome notice posted');
  const detailSummaryMembers = await h.chairStore.listMembers(task.id);
  assert.equal(detailSummaryMembers.length, 2);

  // Idempotent: another tick must not duplicate the seat.
  await h.engine.tick();
  assert.equal((await h.chairStore.listMembers(task.id)).length, 2);
});

test('openteam inviter: decline envelope and pending expiry settle the invite', async () => {
  const h = createHarness('metabot-ot-decline-');
  const task = await h.seedChairedTask();
  const invite = await inviteRemoteMember(h.ctx, 'twin-bot', task.id, { globalMetaId: 'IDREMOTE' });

  h.pushInbound('twin-bot', 'IDREMOTE', buildOpenTeamDeclineMessage(invite.inviteId, 'busy'));
  await h.engine.tick();
  const openteamStore = h.openteamStoreForProfile(h.profiles[0]);
  const declined = await openteamStore.getInviteByInviteId(invite.inviteId);
  assert.equal(declined.status, 'declined');
  assert.equal(declined.declineReason, 'busy');

  // A pending invite whose deadline (expiresAt + 5min margin) has passed is
  // expired by the engine on the next tick.
  const stale = await openteamStore.createInvite({
    taskId: task.id,
    groupId: 'grp-ot',
    inviteId: generateOpenTeamInviteId(),
    inviteeGlobalMetaId: 'IDSLOWPOKE',
    expiresAt: Math.floor(Date.now() / 1000) - 1200,
  });
  await h.engine.tick();
  const settled = await openteamStore.getInviteByInviteId(stale.inviteId);
  assert.equal(settled.status, 'expired');
  assert.equal(settled.declineReason, 'invite_response_timeout');
});

// ---------------------------------------------------------------------------
// Guest flow
// ---------------------------------------------------------------------------

test('openteam guest: valid invite → verify chair → sign join → membership + ACCEPT reply', async () => {
  const h = createHarness('metabot-ot-guest-');
  const inviteId = generateOpenTeamInviteId();
  h.indexer.groupInfo.set('grp-remote', { createUserGlobalMetaId: 'IDCHAIR' });
  h.indexer.members.set('grp-remote', ['IDCHAIR']);

  h.pushInbound('worker-1', 'IDCHAIR', buildOpenTeamInviteMessage({
    v: 1,
    inviteId,
    groupId: 'grp-remote',
    taskTitle: 'Translate docs',
    goalSummary: 'Translate the README',
    requiredSkills: ['translation'],
    inviterGlobalMetaId: 'IDCHAIR',
    inviterName: 'Remote Chair',
    chairGlobalMetaId: 'IDCHAIR',
    targetGlobalMetaId: 'IDWORKER1',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  }));
  await h.engine.tick();

  const guestStore = h.openteamStoreForProfile(h.profiles[1]);
  const guestInvite = await guestStore.getGuestInviteByInviteId(inviteId);
  assert.equal(guestInvite.status, 'accepted');
  const membership = await guestStore.getMembership('grp-remote', 'worker-1');
  assert.equal(membership.status, 'active');
  assert.equal(membership.inviterName, 'Remote Chair');

  const joinPin = h.pins.find((pin) => pin.path === '/protocols/simplegroupjoin' && pin.label === 'worker-1');
  assert.ok(joinPin, 'guest signed the simplegroupjoin itself');
  assert.equal(guestInvite.joinedPinId, joinPin.pinId);

  const acceptReply = h.privateSends.find((send) => send.content.startsWith('[OPENTEAM_ACCEPT:'));
  assert.ok(acceptReply, 'ACCEPT reply sent');
  assert.equal(acceptReply.toGlobalMetaId, 'IDCHAIR');
  assert.equal(parseOpenTeamEnvelope(acceptReply.content).joinedPinId, joinPin.pinId);

  // Duplicate invite is silently skipped.
  h.pushInbound('worker-1', 'IDCHAIR', buildOpenTeamInviteMessage({
    v: 1,
    inviteId,
    groupId: 'grp-remote',
    taskTitle: 'Translate docs',
    goalSummary: '',
    requiredSkills: [],
    inviterGlobalMetaId: 'IDCHAIR',
    inviterName: 'Remote Chair',
    chairGlobalMetaId: 'IDCHAIR',
    targetGlobalMetaId: 'IDWORKER1',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  }));
  await h.engine.tick();
  assert.equal(h.privateSends.filter((send) => send.content.startsWith('[OPENTEAM_ACCEPT:')).length, 1);
});

test('openteam guest: expired and non-chair invites are declined with reasons', async () => {
  const h = createHarness('metabot-ot-guest-decline-');
  h.indexer.groupInfo.set('grp-x', { createUserGlobalMetaId: 'IDSOMEONE_ELSE' });

  const expiredId = generateOpenTeamInviteId();
  h.pushInbound('worker-1', 'IDCHAIR', buildOpenTeamInviteMessage({
    v: 1,
    inviteId: expiredId,
    groupId: 'grp-x',
    taskTitle: 'Old task',
    goalSummary: '',
    requiredSkills: [],
    inviterGlobalMetaId: 'IDCHAIR',
    inviterName: 'Chair',
    chairGlobalMetaId: 'IDCHAIR',
    targetGlobalMetaId: 'IDWORKER1',
    expiresAt: Math.floor(Date.now() / 1000) - 600,
  }));
  const notChairId = generateOpenTeamInviteId();
  h.pushInbound('worker-1', 'IDCHAIR', buildOpenTeamInviteMessage({
    v: 1,
    inviteId: notChairId,
    groupId: 'grp-x',
    taskTitle: 'Fake chair task',
    goalSummary: '',
    requiredSkills: [],
    inviterGlobalMetaId: 'IDCHAIR',
    inviterName: 'Chair',
    chairGlobalMetaId: 'IDCHAIR',
    targetGlobalMetaId: 'IDWORKER1',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  }));
  await h.engine.tick();

  const guestStore = h.openteamStoreForProfile(h.profiles[1]);
  assert.equal((await guestStore.getGuestInviteByInviteId(expiredId)).status, 'expired');
  assert.equal((await guestStore.getGuestInviteByInviteId(notChairId)).status, 'declined');
  assert.equal((await guestStore.getGuestInviteByInviteId(notChairId)).declineReason, 'inviter_not_chair');
  const declines = h.privateSends.filter((send) => send.content.startsWith('[OPENTEAM_DECLINE:'));
  assert.equal(declines.length, 2);
  assert.equal((await guestStore.listMemberships()).length, 0);
  assert.equal(h.pins.filter((pin) => pin.path === '/protocols/simplegroupjoin').length, 0);
});

test('openteam guest: replies when @-mentioned, stays silent otherwise, and honors [OPENTEAM_KICK]', async () => {
  const h = createHarness('metabot-ot-guest-reply-');
  const guestStore = h.openteamStoreForProfile(h.profiles[1]);
  await guestStore.createMembership({
    groupId: 'grp-g',
    slug: 'worker-1',
    inviterGlobalMetaId: 'IDCHAIR',
    inviterName: 'Remote Chair',
    taskTitle: 'Translate docs',
    goalSummary: 'Translate the README',
    inviteId: generateOpenTeamInviteId(),
    joinedPinId: 'jp-1',
  });
  h.indexer.members.set('grp-g', ['IDCHAIR', 'IDWORKER1']);
  h.pushHistory('grp-g', 0, 'IDCHAIR', 'welcome everyone');
  h.pushHistory('grp-g', 1, 'IDCHAIR', '@worker 1 please translate section 2', { mention: ['IDWORKER1'] });

  h.llmTurns.push('[WORKING] translating section 2');
  await h.engine.tick();

  assert.equal(h.llmCalls.length, 1, 'one guest turn (mention only)');
  assert.equal(h.llmCalls[0].role, 'worker');
  const groupReply = h.pins.find((pin) => pin.label === 'worker-1' && pin.path === '/protocols/simplegroupchat');
  assert.ok(groupReply, 'guest replied on-chain');
  assert.ok(pinPlaintext(groupReply).includes('[WORKING]'));
  assert.equal((await guestStore.getMembership('grp-g', 'worker-1')).lastProcessedIndex, 1);

  // Kick envelope: membership left, no further replies.
  h.pushInbound('worker-1', 'IDCHAIR', buildOpenTeamKickMessage({
    v: 1, groupId: 'grp-g', taskTitle: 'Translate docs', reason: 'done',
  }));
  h.pushHistory('grp-g', 2, 'IDCHAIR', '@worker 1 anything else?', { mention: ['IDWORKER1'] });
  await h.engine.tick();

  const membership = await guestStore.getMembership('grp-g', 'worker-1');
  assert.equal(membership.status, 'left');
  assert.equal(membership.leftCause, 'kick');
  assert.equal(h.llmCalls.length, 1, 'no reply after the kick');
});

test('openteam collabs view aggregates memberships and guest invites', async () => {
  const h = createHarness('metabot-ot-collabs-');
  const guestStore = h.openteamStoreForProfile(h.profiles[1]);
  await guestStore.createMembership({
    groupId: 'grp-c',
    slug: 'worker-1',
    inviterGlobalMetaId: 'IDCHAIR',
    taskTitle: 'T',
    inviteId: generateOpenTeamInviteId(),
  });
  await guestStore.createGuestInvite({
    groupId: 'grp-d',
    inviteId: generateOpenTeamInviteId(),
    inviterGlobalMetaId: 'IDCHAIR2',
    taskTitle: 'T2',
    targetGlobalMetaId: 'IDWORKER1',
    expiresAt: 1,
    status: 'declined',
    declineReason: 'busy',
  });

  const view = await listOpenTeamCollabs(h.ctx);
  assert.equal(view.memberships.length, 1);
  assert.equal(view.memberships[0].botName, 'worker 1');
  assert.equal(view.guestInvites.length, 1);
  assert.equal(view.guestInvites[0].slug, 'worker-1');
});
