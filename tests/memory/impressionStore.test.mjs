import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');
const { createExperienceStore } = require('../../dist/core/memory/experienceStore.js');
const { createImpressionStore } = require('../../dist/core/memory/impressionStore.js');
const {
  applyDreamImpressionUpdates,
  buildDreamImpressionSubjects,
} = require('../../dist/core/memory/impressionService.js');

const OBSERVER = 'gm-self-bot';
const SUBJECT = 'gm-peer-bot';

async function createTempProfileHome() {
  const base = await mkdtempTempRoot('metabot-impression-test-');
  const profileRoot = path.join(base, '.metabot', 'profiles', 'test-slug');
  await fs.mkdir(profileRoot, { recursive: true });
  await fs.mkdir(path.join(base, '.metabot', 'manager'), { recursive: true });
  return resolveMetabotPaths(profileRoot);
}

async function seedEpisode(paths, { at = Date.now(), withEvidence = true } = {}) {
  const experience = createExperienceStore(paths);
  const episode = await experience.createEpisode({
    ownerGlobalMetaId: OBSERVER,
    episodeType: 'direct_interaction',
    sourceChannel: 'metaweb_private',
    sourceKey: `conv-${at}`,
    startedAt: at,
  });
  await experience.addParticipant({
    episodeId: episode.id,
    globalMetaId: SUBJECT,
    role: 'peer',
    source: 'a2a',
  });
  let evidence = null;
  if (withEvidence) {
    evidence = await experience.addEvidence({
      episodeId: episode.id,
      evidenceType: 'message',
      sourceKey: `msg-${at}`,
      publisherGlobalMetaId: SUBJECT,
      contentHash: 'abc123',
      occurredAt: at,
    });
  }
  return { experience, episode, evidence };
}

test('episodes are idempotent on (owner, channel, key); participants and evidence dedupe', async () => {
  const paths = await createTempProfileHome();
  const experience = createExperienceStore(paths);
  const input = {
    ownerGlobalMetaId: OBSERVER,
    episodeType: 'direct_interaction',
    sourceChannel: 'metaweb_private',
    sourceKey: 'conv-1',
  };
  const first = await experience.createEpisode(input);
  const second = await experience.createEpisode(input);
  assert.equal(second.id, first.id);
  assert.equal((await experience.listEpisodes({ ownerGlobalMetaId: OBSERVER })).length, 1);

  await experience.addParticipant({ episodeId: first.id, globalMetaId: SUBJECT, role: 'peer', source: 'a2a' });
  await experience.addParticipant({ episodeId: first.id, globalMetaId: SUBJECT, role: 'peer', source: 'a2a' });
  assert.equal((await experience.listParticipants(first.id)).length, 1);

  await experience.addEvidence({ episodeId: first.id, evidenceType: 'message', sourceKey: 'm1' });
  await experience.addEvidence({ episodeId: first.id, evidenceType: 'message', sourceKey: 'm1' });
  assert.equal((await experience.listEvidence(first.id)).length, 1);
});

test('impression subjects group the day by counterparty with evidence refs and previous snapshot', async () => {
  const paths = await createTempProfileHome();
  const at = Date.now();
  await seedEpisode(paths, { at });

  const experience = createExperienceStore(paths);
  const impressions = createImpressionStore(paths, { experienceStore: experience });
  const subjects = await buildDreamImpressionSubjects({
    experienceStore: experience,
    impressionStore: impressions,
    observerGlobalMetaId: OBSERVER,
    fromTime: at - 1000,
    toTime: at + 1000,
  });
  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].subjectGlobalMetaID, SUBJECT);
  assert.equal(subjects[0].interactionCount, 1);
  assert.equal(subjects[0].directInteractionCount, 1);
  assert.equal(subjects[0].episodeIds.length, 1);
  assert.equal(subjects[0].evidenceIds.length, 1);
  assert.equal(subjects[0].previousSnapshot, null);

  // The observer itself is never a subject.
  const experience2 = experience;
  const ep2 = await experience2.createEpisode({
    ownerGlobalMetaId: OBSERVER,
    episodeType: 'direct_interaction',
    sourceChannel: 'metaweb_private',
    sourceKey: 'conv-self',
    startedAt: at,
  });
  await experience2.addParticipant({ episodeId: ep2.id, globalMetaId: OBSERVER, role: 'self', source: 'a2a' });
  await experience2.addEvidence({ episodeId: ep2.id, evidenceType: 'message', sourceKey: 'm-self', occurredAt: at });
  const subjects2 = await buildDreamImpressionSubjects({
    experienceStore: experience2,
    impressionStore: impressions,
    observerGlobalMetaId: OBSERVER,
    fromTime: at - 1000,
    toTime: at + 1000,
  });
  assert.ok(!subjects2.some((subject) => subject.subjectGlobalMetaID === OBSERVER));
});

test('dream impression updates are validated against the prompt candidates and rebuild snapshots', async () => {
  const paths = await createTempProfileHome();
  const at = Date.now();
  const { episode, evidence } = await seedEpisode(paths, { at });

  const experience = createExperienceStore(paths);
  const impressions = createImpressionStore(paths, { experienceStore: experience });
  const subjects = await buildDreamImpressionSubjects({
    experienceStore: experience,
    impressionStore: impressions,
    observerGlobalMetaId: OBSERVER,
    fromTime: at - 1000,
    toTime: at + 1000,
  });

  const result = await applyDreamImpressionUpdates({
    impressionStore: impressions,
    observerGlobalMetaId: OBSERVER,
    dreamDate: '2026-08-19',
    dreamVersion: 1,
    subjects,
    updates: [
      {
        subjectGlobalMetaId: SUBJECT,
        episodeIds: [episode.id],
        evidenceIds: [evidence.id],
        observation: '对方回复简短直接',
        interpretation: '对方偏好高效沟通，不喜欢寒暄',
        dimensions: { styleDescriptors: ['简短', '直接'], cooperation: '顺畅' },
        communicationGuidance: '下次直接给结论',
        confidence: { level: 'medium', uncertainty: '样本还少' },
      },
      // Out-of-candidate IDs are rejected.
      {
        subjectGlobalMetaId: SUBJECT,
        episodeIds: ['ep_not_offered'],
        evidenceIds: ['ev_not_offered'],
        observation: '伪造的观察',
        interpretation: '不应被接受',
        dimensions: {},
        communicationGuidance: null,
        confidence: {},
      },
      // Unknown subject is rejected.
      {
        subjectGlobalMetaId: 'gm-stranger',
        episodeIds: [episode.id],
        evidenceIds: [evidence.id],
        observation: '伪造主体',
        interpretation: '不应被接受',
        dimensions: {},
        communicationGuidance: null,
        confidence: {},
      },
    ],
  });
  assert.equal(result.accepted, 1);
  assert.equal(result.created, 1);
  assert.equal(result.rejected, 2);
  assert.equal(result.rebuilt, 1);

  const snapshot = await impressions.getSnapshot(OBSERVER, SUBJECT);
  assert.ok(snapshot);
  assert.match(snapshot.summaryText, /高效沟通/);
  assert.deepEqual(snapshot.styleDescriptors.sort(), ['直接', '简短']);
  assert.equal(snapshot.communicationGuidance, '下次直接给结论');
  assert.equal(snapshot.uncertaintyText, '样本还少');
  assert.equal(snapshot.interactionCount, 1);
  assert.equal(snapshot.directInteractionCount, 1);

  // Idempotent re-apply: same dream date + same candidate set creates nothing new.
  const again = await applyDreamImpressionUpdates({
    impressionStore: impressions,
    observerGlobalMetaId: OBSERVER,
    dreamDate: '2026-08-19',
    dreamVersion: 1,
    subjects,
    updates: [{
      subjectGlobalMetaId: SUBJECT,
      episodeIds: [episode.id],
      evidenceIds: [evidence.id],
      observation: '对方回复简短直接',
      interpretation: '对方偏好高效沟通，不喜欢寒暄',
      dimensions: { styleDescriptors: ['简短', '直接'], cooperation: '顺畅' },
      communicationGuidance: '下次直接给结论',
      confidence: { level: 'medium', uncertainty: '样本还少' },
    }],
  });
  assert.equal(again.accepted, 1);
  assert.equal(again.created, 0);
  const observations = await impressions.listObservations({
    observerGlobalMetaId: OBSERVER,
    subjectGlobalMetaId: SUBJECT,
  });
  assert.equal(observations.length, 1);
});

test('self-impressions and unknown episodes are refused', async () => {
  const paths = await createTempProfileHome();
  const experience = createExperienceStore(paths);
  const impressions = createImpressionStore(paths, { experienceStore: experience });

  await assert.rejects(
    () => impressions.appendObservation({
      observerGlobalMetaId: OBSERVER,
      subjectGlobalMetaId: OBSERVER,
      evidenceIds: [],
      observationText: 'x',
      interpretationText: 'y',
      dreamDate: '2026-08-19',
      dreamVersion: 1,
      sourceHash: 'h1',
    }),
    /Self-impressions/,
  );

  await assert.rejects(
    () => impressions.appendObservation({
      observerGlobalMetaId: OBSERVER,
      subjectGlobalMetaId: SUBJECT,
      episodeId: 'ep_missing',
      evidenceIds: [],
      observationText: 'x',
      interpretationText: 'y',
      dreamDate: '2026-08-19',
      dreamVersion: 1,
      sourceHash: 'h2',
    }),
    /not accessible/,
  );
});

test('supersede chains mark the prior observation superseded and rebuild reflects the latest', async () => {
  const paths = await createTempProfileHome();
  const at = Date.now();
  const { episode, evidence } = await seedEpisode(paths, { at });
  const experience = createExperienceStore(paths);
  const impressions = createImpressionStore(paths, { experienceStore: experience });

  const first = await impressions.appendObservation({
    observerGlobalMetaId: OBSERVER,
    subjectGlobalMetaId: SUBJECT,
    episodeId: episode.id,
    evidenceIds: [evidence.id],
    observationText: '初次观察',
    interpretationText: '初次印象：客气但疏远',
    dimensions: {},
    dreamDate: '2026-08-18',
    dreamVersion: 1,
    sourceHash: 'h-first',
  });
  await impressions.rebuildSnapshot(OBSERVER, SUBJECT);
  let snapshot = await impressions.getSnapshot(OBSERVER, SUBJECT);
  assert.match(snapshot.summaryText, /疏远/);

  const second = await impressions.appendObservation({
    observerGlobalMetaId: OBSERVER,
    subjectGlobalMetaId: SUBJECT,
    episodeId: episode.id,
    evidenceIds: [evidence.id],
    observationText: '新的观察',
    interpretationText: '修正印象：其实对方很热情',
    dimensions: {},
    dreamDate: '2026-08-19',
    dreamVersion: 1,
    sourceHash: 'h-second',
    supersedesObservationId: first.observation.id,
  });
  assert.equal(second.created, true);
  await impressions.rebuildSnapshot(OBSERVER, SUBJECT);
  snapshot = await impressions.getSnapshot(OBSERVER, SUBJECT);
  assert.match(snapshot.summaryText, /热情/);

  const active = await impressions.listObservations({ observerGlobalMetaId: OBSERVER, subjectGlobalMetaId: SUBJECT });
  assert.equal(active.length, 1);
  const all = await impressions.listObservations({
    observerGlobalMetaId: OBSERVER,
    subjectGlobalMetaId: SUBJECT,
    includeSuperseded: true,
  });
  assert.equal(all.length, 2);
  assert.ok(all.some((observation) => observation.status === 'superseded'));
});

test('collaboration facts sediment into snapshots and survive rebuilds', async () => {
  const paths = await createTempProfileHome();
  const store = createImpressionStore(paths);

  // No observations at all: a fact alone still materializes a snapshot.
  await store.appendCollaborationFact({
    observerGlobalMetaId: OBSERVER,
    subjectGlobalMetaId: SUBJECT,
    taskId: 7,
    title: 'Landing page',
    outcome: 'done',
    seatRole: 'worker',
    evidencePinIds: ['pin-1'],
  });
  let snapshot = await store.getSnapshot(OBSERVER, SUBJECT);
  assert.ok(snapshot, 'fact-only snapshot exists');
  assert.equal(snapshot.collaborationFacts.length, 1);
  assert.equal(snapshot.collaborationFacts[0].outcome, 'done');
  assert.equal(snapshot.collaborationFacts[0].seatRole, 'worker');
  assert.equal(snapshot.summaryText, '');

  // Multiple facts: last 10, chronological.
  for (let index = 0; index < 12; index += 1) {
    await store.appendCollaborationFact({
      observerGlobalMetaId: OBSERVER,
      subjectGlobalMetaId: SUBJECT,
      taskId: 8 + index,
      title: `Task ${index}`,
      outcome: index % 2 === 0 ? 'cancelled' : 'kicked',
    });
  }
  snapshot = await store.getSnapshot(OBSERVER, SUBJECT);
  assert.equal(snapshot.collaborationFacts.length, 10);
  assert.equal(snapshot.collaborationFacts[snapshot.collaborationFacts.length - 1].taskId, 19);

  // Rebuild after dream observations arrive keeps the facts attached.
  const observation = await store.appendObservation({
    observerGlobalMetaId: OBSERVER,
    subjectGlobalMetaId: SUBJECT,
    episodeId: null,
    evidenceIds: [],
    observationText: 'worked together',
    interpretationText: 'reliable collaborator',
    dimensions: {},
    communicationGuidance: null,
    confidence: {},
    dreamDate: '2026-08-24',
    dreamVersion: 1,
    modelId: null,
    sourceHash: 'hash-1',
  });
  assert.equal(observation.created, true);
  const rebuilt = await store.rebuildSnapshot(OBSERVER, SUBJECT);
  assert.ok(rebuilt.summaryText.includes('reliable'));
  assert.equal(rebuilt.collaborationFacts.length, 10);

  // Other subjects are untouched.
  assert.equal(await store.getSnapshot(OBSERVER, 'gm-someone-else'), null);
});

test('identity casing is normalized across dream observations and ledger facts', async () => {
  const paths = await createTempProfileHome();
  const store = createImpressionStore(paths);
  // Dream path writes with mixed case; the ledger fact path lowercases.
  await store.appendObservation({
    observerGlobalMetaId: 'GM-Self-Bot',
    subjectGlobalMetaId: 'GM-Peer-Bot',
    episodeId: null,
    evidenceIds: [],
    observationText: 'worked together',
    interpretationText: 'reliable',
    dimensions: {},
    communicationGuidance: null,
    confidence: {},
    dreamDate: '2026-08-24',
    dreamVersion: 1,
    modelId: null,
    sourceHash: 'hash-case-1',
  });
  await store.appendCollaborationFact({
    observerGlobalMetaId: 'gm-self-bot',
    subjectGlobalMetaId: 'gm-peer-bot',
    taskId: 3,
    title: 'Cased',
    outcome: 'done',
    seatRole: 'content',
  });
  // Rebuild (as the dream commit path does), then query in any casing.
  await store.rebuildSnapshot('gm-self-bot', 'gm-peer-bot');
  const snapshot = await store.getSnapshot('GM-SELF-BOT'.toUpperCase(), 'gm-peer-bot');
  assert.ok(snapshot, 'snapshot exists under the normalized key');
  assert.equal(snapshot.collaborationFacts.length, 1);
  assert.equal(snapshot.collaborationFacts[0].seatRole, 'content');
  assert.ok(snapshot.summaryText.includes('reliable'));
});
