import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildLoomPageDefinition } = require('../../dist/ui/pages/loom/app.js');

const NOW = 1_775_000_000_000;
const TASK_PIN = `${'a'.repeat(64)}i0`;
const CLAIM_PIN = `${'b'.repeat(64)}i0`;
const INACTIVE_CLAIM_PIN = `${'d'.repeat(64)}i0`;
const DELIVERY_PIN = `${'c'.repeat(64)}i0`;
const PAYMENT_TXID = `${'e'.repeat(64)}`;
const STATUS_PIN = `${'f'.repeat(64)}i0`;
const ACCEPTANCE_PIN = `${'1'.repeat(64)}i0`;
const CLAIM_REJECT_PIN = `${'2'.repeat(64)}i0`;

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');
}

function shellQuotedHtml(value) {
  return `&#39;${String(value).replace(/'/gu, '&#39;\\&#39;&#39;')}&#39;`;
}

function sectionHtml(html, heading, nextHeading) {
  const start = html.indexOf(`<h3>${heading}</h3>`);
  if (start < 0) return '';
  const end = nextHeading ? html.indexOf(`<h3>${nextHeading}</h3>`, start) : -1;
  return end < 0 ? html.slice(start) : html.slice(start, end);
}

function matchCount(value, pattern) {
  return Array.from(String(value).matchAll(pattern)).length;
}

class FakeElement {
  constructor(value = '') {
    this.textContent = '';
    this.value = value;
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.attrs = {};
    this.nodes = [];
    this.focusCount = 0;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.nodes = [];
    const tagPattern = /<(button|a|article)\b([^>]*)>/gu;
    for (const match of this._innerHTML.matchAll(tagPattern)) {
      const node = new FakeElement();
      node.tagName = match[1].toUpperCase();
      const attrs = match[2] || '';
      for (const attrMatch of attrs.matchAll(/\s([a-zA-Z0-9_-]+)="([^"]*)"/gu)) {
        node.attrs[attrMatch[1]] = decodeHtmlAttribute(attrMatch[2]);
        if (attrMatch[1].startsWith('data-')) {
          const key = attrMatch[1]
            .slice(5)
            .replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
          node.dataset[key] = node.attrs[attrMatch[1]];
        }
      }
      this.nodes.push(node);
    }
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  addEventListener(eventName, handler) {
    this.listeners.set(eventName, handler);
  }

  focus() {
    this.focusCount += 1;
  }

  getAttribute(name) {
    return this.attrs[name] || '';
  }

  querySelectorAll(selector) {
    if (selector === '[data-loom-card]') {
      return this.nodes.filter((node) => node.attrs['data-loom-card'] !== undefined);
    }
    if (selector === '[data-loom-copy]') {
      return this.nodes.filter((node) => node.attrs['data-loom-copy'] !== undefined);
    }
    return [];
  }

  contains(target) {
    return target === this || this.nodes.includes(target);
  }
}

function waitFor(condition, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 1000) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

function bot(overrides = {}) {
  return {
    role: 'requester',
    displayName: 'Requester Bot',
    fallbackLabel: 'requester:gm-requester',
    initials: 'RB',
    globalMetaId: 'gm-requester',
    address: '1RequesterAddress',
    avatarUri: '',
    ...overrides,
  };
}

function dashboard(overrides = {}) {
  const requester = bot();
  const developer = bot({
    role: 'developer',
    displayName: 'Active Developer Bot',
    fallbackLabel: 'developer:gm-dev',
    initials: 'AD',
    globalMetaId: 'gm-dev',
    address: '1DeveloperAddress',
  });
  const inactiveDeveloper = bot({
    role: 'developer',
    displayName: 'Inactive Developer Bot',
    fallbackLabel: 'developer:gm-inactive',
    initials: 'ID',
    globalMetaId: 'gm-inactive',
    address: '1InactiveDeveloperAddress',
  });
  const card = {
    taskPinId: TASK_PIN,
    state: 'delivered',
    stateTone: 'review',
    columnId: 'review',
    title: 'Wire Loom board UI',
    requester,
    developer,
    bounty: { amount: '0.5', currency: 'SPACE' },
    repo: { repoUri: 'https://github.com/openagentinternet/open-agent-connect', baseBranch: 'main' },
    tags: ['ui', 'phase-3'],
    createdAt: NOW - 20_000,
    updatedAt: NOW - 5_000,
    activeClaimCount: 1,
    latestStatusSummary: 'Delivery is ready for review.',
    prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/77',
    paymentTxId: PAYMENT_TXID,
    warningCount: 1,
    actorContext: { needsMyAction: true },
  };

  return {
    dashboard: {
      version: 1,
      updatedAt: NOW - 5_000,
      actor: {},
      summary: {
        totalTasks: 1,
        open: 0,
        claimed: 0,
        inProgress: 0,
        delivered: 1,
        revisionNeeded: 0,
        rejected: 0,
        acceptedPaid: 0,
        failed: 0,
        invalidRecords: 1,
        needsMyAction: 1,
        newestActivityAt: NOW - 5_000,
      },
      columns: [{ id: 'review', title: 'Review', cards: [card] }],
      tasks: [card],
      details: [{
        taskPinId: TASK_PIN,
        state: 'delivered',
        columnId: 'review',
        title: card.title,
        requirement: 'Create the built-in Loom operations board.',
        criteria: 'Route, filters, cards, detail, and refresh are covered.',
        requester,
        claims: [
          {
            pinId: INACTIVE_CLAIM_PIN,
            active: false,
            message: 'Older inactive claim.',
            timestamp: NOW - 18_000,
            payoutAddress: '1InactivePayoutAddress',
            developer: inactiveDeveloper,
          },
          {
            pinId: CLAIM_PIN,
            active: true,
            message: 'I can implement the UI.',
            timestamp: NOW - 15_000,
            payoutAddress: '1ActivePayoutAddress',
            developer,
          },
        ],
        warnings: [{
          recordPinId: 'invalid-status-pin',
          protocol: 'metabot-loom-status',
          code: 'invalid-author',
          message: 'Status author is not the active developer.',
          timestamp: NOW - 12_000,
        }],
        localWorkflow: [{
          claimPinId: CLAIM_PIN,
          developerMetaBotSlug: 'active-dev',
          branchName: 'codex/loom-board',
          workspacePath: '/tmp/loom-workspace',
          llmSessionIds: ['llm-session-123'],
          processLogPaths: ['/tmp/loom-process.md'],
          processLogUris: ['metafile://loom-process-log'],
          commits: [{
            sha: '1234567890abcdef',
            message: 'Render local workflow commits',
            files: ['src/ui/pages/loom/app.ts', 'tests/ui/loomPageScript.test.mjs'],
          }],
        }],
        validRecords: {
          claims: [],
          statuses: [{
            pinId: STATUS_PIN,
            timestamp: NOW - 10_000,
            globalMetaId: 'gm-status-author',
            creatorAddress: '1StatusAuthorAddress',
            payload: {
              status: 'in_progress',
              progressSummary: 'Raw status says tests are passing.',
              branchName: 'codex/raw-status-branch',
              commits: [{
                sha: 'abcdef1234567890',
                message: 'Add raw status evidence',
                files: ['src/ui/pages/loom/app.ts'],
              }],
              processLogs: ['metafile://raw-process-log'],
              artifactUris: ['metafile://raw-artifact'],
            },
          }],
          deliveries: [{
            pinId: DELIVERY_PIN,
            timestamp: NOW - 5_000,
            globalMetaId: 'gm-delivery-author',
            creatorAddress: '1DeliveryAuthorAddress',
            payload: {
              deliverySummary: 'Raw delivery summary ready.',
              delivery: {
                prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/77',
                prTitle: 'Loom board PR',
                prBranch: 'codex/loom-board',
                prBaseBranch: 'main',
              },
              reviewChecklist: [
                { item: 'Tests pass', status: 'done' },
                { item: 'UI checked', status: 'done' },
              ],
              attachments: ['metafile://delivery-attachment'],
            },
          }],
          acceptances: [{
            pinId: ACCEPTANCE_PIN,
            timestamp: NOW - 1_000,
            globalMetaId: 'gm-acceptance-author',
            creatorAddress: '1AcceptanceAuthorAddress',
            payload: {
              verdict: 'accepted',
              score: 5,
              comment: 'Accepted with payment.',
              releasePayment: true,
              paymentTxId: PAYMENT_TXID,
              attachments: ['metafile://acceptance-attachment'],
            },
          }],
          claimRejects: [{
            pinId: CLAIM_REJECT_PIN,
            timestamp: NOW - 17_000,
            globalMetaId: 'gm-reject-author',
            creatorAddress: '1RejectAuthorAddress',
            payload: {
              claimPinId: INACTIVE_CLAIM_PIN,
              reason: 'Requester selected a newer claim.',
            },
          }],
        },
        timeline: [
          { id: `task:${TASK_PIN}`, kind: 'task', title: 'Task posted', timestamp: NOW - 20_000, pinId: TASK_PIN },
          { id: `claim:${CLAIM_PIN}`, kind: 'claim', title: 'Claim posted', summary: 'Developer Bot claimed the task.', timestamp: NOW - 15_000, pinId: CLAIM_PIN },
          { id: `delivery:${DELIVERY_PIN}`, kind: 'delivery', title: 'Delivery posted', summary: 'PR is ready.', timestamp: NOW - 5_000, pinId: DELIVERY_PIN },
        ],
      }],
      ...overrides,
    },
  };
}

async function runLoomScript(options = {}) {
  const elements = {
    '[data-loom-status]': new FakeElement(),
    '[data-loom-refresh]': new FakeElement(),
    '[data-loom-new-task]': new FakeElement(),
    '[data-loom-scope-label]': new FakeElement(),
    '[data-loom-stale-warning]': new FakeElement(),
    '[data-loom-state-filter]': new FakeElement(options.state || ''),
    '[data-loom-role-filter]': new FakeElement(options.role || ''),
    '[data-loom-query-filter]': new FakeElement(options.query || ''),
    '[data-loom-metrics]': new FakeElement(),
    '[data-loom-board]': new FakeElement(),
    '[data-loom-detail-modal]': new FakeElement(),
    '[data-loom-detail-dialog]': new FakeElement(),
    '[data-loom-detail-body]': new FakeElement(),
    '[data-loom-detail-actions]': new FakeElement(),
    '[data-loom-detail-close]': new FakeElement(),
    '[data-loom-error]': new FakeElement(),
  };
  elements['[data-loom-detail-modal]'].hidden = true;
  const fetchCalls = [];
  const writes = [];
  const payloads = options.payloads || [dashboard(), dashboard({
    summary: {
      totalTasks: 2,
      open: 1,
      claimed: 0,
      inProgress: 0,
      delivered: 1,
      revisionNeeded: 0,
      rejected: 0,
      acceptedPaid: 0,
      failed: 0,
      invalidRecords: 1,
      needsMyAction: 1,
      newestActivityAt: NOW,
    },
  })];
  let dashboardRead = 0;

  const context = {
    console,
    Date: class FakeDate extends Date {
      constructor(...args) {
        super(...(args.length ? args : [NOW]));
      }

      static now() {
        return NOW;
      }
    },
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Number,
    String,
    Error,
    Array,
    window: {
      location: { search: options.search || '' },
    },
    navigator: {
      clipboard: {
        writeText: async (value) => writes.push(value),
      },
    },
    document: {
      readyState: 'complete',
      listeners: new Map(),
      activeElement: null,
      addEventListener(eventName, handler) {
        this.listeners.set(eventName, handler);
      },
      querySelector: (selector) => elements[selector] || null,
    },
    fetch: async (url, requestOptions = {}) => {
      fetchCalls.push({ url: String(url), options: requestOptions });
      if (options.fail) {
        return {
          ok: false,
          json: async () => ({ ok: false, message: 'Dashboard exploded.' }),
        };
      }
      if (String(url).startsWith('/api/loom/dashboard')) {
        return {
          ok: true,
          json: async () => payloads[Math.min(dashboardRead++, payloads.length - 1)],
        };
      }
      if (String(url) === '/api/loom/refresh') {
        return {
          ok: true,
          json: async () => payloads[Math.min(dashboardRead++, payloads.length - 1)],
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };

  vm.runInNewContext(buildLoomPageDefinition().script, context);
  await waitFor(() => elements['[data-loom-board]'].innerHTML.includes('Wire Loom board UI') || elements['[data-loom-error]'].textContent, 'initial Loom render');
  return { elements, fetchCalls, writes, document: context.document };
}

test('loom page script loads dashboard JSON and renders board cards with Bot names without an initial detail panel', async () => {
  const { elements, fetchCalls, writes } = await runLoomScript();

  const contentHtml = buildLoomPageDefinition().contentHtml;
  assert.equal(fetchCalls[0].url, '/api/loom/dashboard');
  assert.equal(elements['[data-loom-scope-label]'].textContent, 'Global');
  assert.equal(elements['[data-loom-new-task]'].disabled, true);
  assert.doesNotMatch(contentHtml, /data-loom-actor|data-loom-updated/);
  assert.match(contentHtml, /class="loom-filters"[^>]*hidden/u);
  assert.doesNotMatch(contentHtml, /later phase/i);
  assert.doesNotMatch(elements['[data-loom-metrics]'].innerHTML, /Needs my action/);
  assert.match(elements['[data-loom-metrics]'].innerHTML, /1 task/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Review/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Review[\s\S]*1 task/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Open[\s\S]*0 tasks/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Wire Loom board UI/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Delivery is ready for review/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Requester Bot/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Active Developer Bot/);
  assert.match(elements['[data-loom-board]'].innerHTML, /1 warning/);
  assert.doesNotMatch(elements['[data-loom-board]'].innerHTML, /Needs my action/);
  assert.doesNotMatch(elements['[data-loom-board]'].innerHTML, /phase-3/);
  assert.doesNotMatch(elements['[data-loom-board]'].innerHTML, /0\.5 SPACE/);
  assert.doesNotMatch(elements['[data-loom-board]'].innerHTML, /openagentinternet\/open-agent-connect/);
  assert.doesNotMatch(elements['[data-loom-board]'].innerHTML, new RegExp(PAYMENT_TXID.slice(0, 8)));
  assert.match(elements['[data-loom-board]'].innerHTML, /just now/);
  assert.doesNotMatch(contentHtml, /data-loom-detail aria-label="Selected Loom task detail"/);
  assert.equal(elements['[data-loom-detail-modal]'].hidden, true);
  assert.equal(elements['[data-loom-detail-body]'].innerHTML, '');

  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');
  await card.listeners.get('click')();
  assert.equal(elements['[data-loom-detail-modal]'].hidden, false);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Create the built-in Loom operations board/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Requirement/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Acceptance criteria/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Participants/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Delivery/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Payment/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Process evidence/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Timeline/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Warnings/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Raw records/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /CLI fallback/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Repository/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /openagentinternet\/open-agent-connect/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /href="https:\/\/github\.com\/openagentinternet\/open-agent-connect"/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Base branch:.*main/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Active Developer Bot/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /gm-dev/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /1DeveloperAddress/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /1ActivePayoutAddress/);
  const participantsHtml = sectionHtml(elements['[data-loom-detail-body]'].innerHTML, 'Participants', 'Claims');
  assert.match(participantsHtml, /Requester Bot/);
  assert.match(participantsHtml, /gm-requester/);
  assert.match(participantsHtml, /1RequesterAddress/);
  assert.match(participantsHtml, /Active Developer Bot/);
  assert.match(participantsHtml, /gm-dev/);
  assert.match(participantsHtml, /1DeveloperAddress/);
  assert.match(participantsHtml, /1ActivePayoutAddress/);
  assert.doesNotMatch(participantsHtml, /1InactivePayoutAddress/);
  assert.doesNotMatch(elements['[data-loom-detail-body]'].innerHTML.split('Requirement')[0], /Inactive Developer Bot/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Status author is not the active developer/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Delivery posted/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /codex\/loom-board/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /\/tmp\/loom-workspace/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /llm-session-123/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /\/tmp\/loom-process\.md/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /metafile:\/\/loom-process-log/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /1234567/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Render local workflow commits/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Raw status says tests are passing/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /gm-status-author/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /1StatusAuthorAddress/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /abcdef1/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Add raw status evidence/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /metafile:\/\/raw-process-log/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /metafile:\/\/raw-artifact/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Loom board PR/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /gm-delivery-author/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /1DeliveryAuthorAddress/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Branches:.*codex\/loom-board -&gt; main/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Tests pass/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /done/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /accepted/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /gm-acceptance-author/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /1AcceptanceAuthorAddress/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Score: 5/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Accepted with payment/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Requester selected a newer claim/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /gm-reject-author/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /1RejectAuthorAddress/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, new RegExp(PAYMENT_TXID.slice(0, 8)));
  assert.equal(matchCount(elements['[data-loom-detail-body]'].innerHTML, /<h3>Status records<\/h3>/gu), 1);
  assert.equal(matchCount(elements['[data-loom-detail-body]'].innerHTML, /<h3>Delivery records<\/h3>/gu), 1);
  assert.equal(matchCount(elements['[data-loom-detail-body]'].innerHTML, /<h3>Acceptance records<\/h3>/gu), 1);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, new RegExp("metabot loom state " + shellQuotedHtml(TASK_PIN) + " --refresh"));
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, new RegExp("--delivery-pin-id " + shellQuotedHtml(DELIVERY_PIN)));
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /metabot loom accept-and-pay/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /metabot loom review-delivery/);
  assert.doesNotMatch(elements['[data-loom-detail-actions]'].innerHTML, /state --task-pin-id/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /target="_blank"/);

  const [copyButton] = elements['[data-loom-detail-body]'].querySelectorAll('[data-loom-copy]');
  await copyButton.listeners.get('click')();
  assert.equal(writes[0], TASK_PIN);
});

test('loom detail modal closes with Escape or button and returns focus to the selected card', async () => {
  const { elements, document } = await runLoomScript();
  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');

  await card.listeners.get('click')();
  assert.equal(elements['[data-loom-detail-modal]'].hidden, false);

  elements['[data-loom-detail-modal]'].listeners.get('click')({
    target: elements['[data-loom-detail-modal]'],
  });
  assert.equal(elements['[data-loom-detail-modal]'].hidden, true);
  assert.equal(card.focusCount, 1);

  await card.listeners.get('click')();
  elements['[data-loom-detail-modal]'].dataset.confirmationActive = 'true';
  elements['[data-loom-detail-modal]'].listeners.get('click')({
    target: elements['[data-loom-detail-modal]'],
  });
  assert.equal(elements['[data-loom-detail-modal]'].hidden, false);
  elements['[data-loom-detail-modal]'].dataset.confirmationActive = '';

  elements['[data-loom-detail-close]'].listeners.get('click')();
  assert.equal(elements['[data-loom-detail-modal]'].hidden, true);
  assert.equal(card.focusCount, 2);

  await card.listeners.get('click')();
  elements['[data-loom-detail-modal]'].listeners.get('keydown')({
    key: 'Escape',
    preventDefault() {},
  });
  assert.equal(elements['[data-loom-detail-modal]'].hidden, true);
  assert.equal(card.focusCount, 3);

  await card.listeners.get('click')();
  document.listeners.get('keydown')({
    key: 'Escape',
    preventDefault() {},
  });
  assert.equal(elements['[data-loom-detail-modal]'].hidden, true);
  assert.equal(card.focusCount, 4);
});

test('loom detail modal stays hidden when a card has no matching detail record', async () => {
  const missingDetail = dashboard({ details: [] });
  const { elements } = await runLoomScript({ payloads: [missingDetail] });
  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');

  await card.listeners.get('click')();

  assert.equal(elements['[data-loom-detail-modal]'].hidden, true);
  assert.equal(elements['[data-loom-detail-body]'].innerHTML, '');
  assert.equal(elements['[data-loom-detail-actions]'].innerHTML, '');
});

test('loom page script uses dashboard actor presence for scoped action labels', async () => {
  const noActorDashboard = dashboard({ actor: {} });
  const noActorResult = await runLoomScript({ search: '?from=eric', payloads: [noActorDashboard] });

  assert.equal(noActorResult.fetchCalls[0].url, '/api/loom/dashboard?from=eric');
  assert.equal(noActorResult.elements['[data-loom-scope-label]'].textContent, 'From eric');
  assert.doesNotMatch(noActorResult.elements['[data-loom-board]'].innerHTML, /Needs my action/);

  const actorDashboard = dashboard({
    actor: { profileSlug: 'eric', globalMetaId: 'gm-eric', address: '1EricAddress' },
  });
  const actorResult = await runLoomScript({ search: '?from=eric', payloads: [actorDashboard] });

  assert.equal(actorResult.fetchCalls[0].url, '/api/loom/dashboard?from=eric');
  assert.match(actorResult.elements['[data-loom-board]'].innerHTML, /Needs my action/);
});

test('loom page stylesheet keeps tablet layout inside the board shell', () => {
  const template = readFileSync(new URL('../../src/ui/pages/loom/index.html', import.meta.url), 'utf8');

  assert.match(template, /@supports \(height: 100svh\)/u);
  assert.doesNotMatch(template, /\.loom-workspace\s*\{[^}]*overflow:\s*auto/);
  assert.doesNotMatch(template, /\.loom-workspace\s*\{[^}]*flex-direction:\s*column/);
  assert.doesNotMatch(template, /\.loom-board\s*\{[^}]*min-height:\s*560px/);
  assert.match(template, /\.loom-detail-dialog\s*\{[^}]*width:\s*min\(1040px,\s*calc\(100vw - 48px\)\)[^}]*max-height:\s*calc\(100vh - 64px\)/u);
  assert.match(template, /\.loom-detail-body\s*\{[^}]*overflow:\s*auto/su);
  assert.match(template, /@media \(max-width: 680px\)\s*\{[\s\S]*?\.loom-board\s*\{[^}]*overflow-x:\s*auto[^}]*\}/u);
  assert.match(template, /@media \(max-width: 680px\)\s*\{[\s\S]*?\.loom-column\s*\{[^}]*width:\s*280px[^}]*flex-basis:\s*280px[^}]*\}/u);
  assert.match(template, /\.loom-column-list\s*\{[^}]*overflow-y:\s*auto/su);
});

test('loom page filters reload dashboard and refresh preserves current filters', async () => {
  const { elements, fetchCalls } = await runLoomScript({
    search: '?from=eric',
    payloads: [dashboard(), dashboard(), dashboard()],
  });

  elements['[data-loom-state-filter]'].value = 'delivered';
  elements['[data-loom-role-filter]'].value = 'needs_action';
  elements['[data-loom-query-filter]'].value = 'github';
  await elements['[data-loom-state-filter]'].listeners.get('change')();

  assert.equal(fetchCalls.at(-1).url, '/api/loom/dashboard?from=eric&state=delivered&role=needs_action&query=github');

  await elements['[data-loom-refresh]'].listeners.get('click')();
  const refreshCall = fetchCalls.find((call) => call.url === '/api/loom/refresh');
  assert.ok(refreshCall, 'expected refresh endpoint to be called');
  assert.equal(refreshCall.options.method, 'POST');
  assert.deepEqual(JSON.parse(refreshCall.options.body), {
    from: 'eric',
    state: 'delivered',
    role: 'needs_action',
    query: 'github',
  });
  assert.match(elements['[data-loom-metrics]'].innerHTML, /Total tasks[\s\S]*<strong>1 task<\/strong>/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Wire Loom board UI/);
});

test('loom page script displays dashboard load errors without throwing', async () => {
  const { elements } = await runLoomScript({ fail: true });

  assert.match(elements['[data-loom-error]'].textContent, /Dashboard exploded/);
  assert.match(elements['[data-loom-status]'].textContent, /Dashboard exploded/);
});

test('loom page does not render unsafe dashboard URLs as clickable links', async () => {
  const unsafe = dashboard();
  unsafe.dashboard.tasks[0].prUrl = 'javascript:alert(1)';
  unsafe.dashboard.columns[0].cards[0].prUrl = 'javascript:alert(1)';
  unsafe.dashboard.details[0].validRecords.deliveries[0].payload.delivery.prUrl = 'data:text/html,x';
  const { elements } = await runLoomScript({ payloads: [unsafe] });

  assert.doesNotMatch(elements['[data-loom-board]'].innerHTML, /href="javascript:/i);

  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');
  await card.listeners.get('click')();
  assert.doesNotMatch(elements['[data-loom-detail-body]'].innerHTML, /href="javascript:/i);
  assert.doesNotMatch(elements['[data-loom-detail-body]'].innerHTML, /href="data:/i);
  assert.doesNotMatch(elements['[data-loom-board]'].innerHTML, /javascript:alert\(1\)/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /javascript:alert\(1\)/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /data:text\/html,x/);
});

test('loom page shell-quotes URL-controlled CLI handoff arguments', async () => {
  const { elements, writes } = await runLoomScript({ search: '?from=eric%20--confirm-payment' });

  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');
  await card.listeners.get('click')();

  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /--from &#39;eric --confirm-payment&#39;/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, new RegExp("metabot loom state " + shellQuotedHtml(TASK_PIN) + " --refresh"));
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, new RegExp("--delivery-pin-id " + shellQuotedHtml(DELIVERY_PIN)));
  assert.doesNotMatch(elements['[data-loom-detail-actions]'].innerHTML, /--from eric --confirm-payment/);

  const cliCopyButton = elements['[data-loom-detail-actions]']
    .querySelectorAll('[data-loom-copy]')
    .find((button) => button.getAttribute('title') === 'Copy Copy CLI');
  assert.ok(cliCopyButton, 'expected CLI copy button');
  await cliCopyButton.listeners.get('click')();
  assert.match(writes.at(-1), /--from 'eric --confirm-payment'/);
  assert.doesNotMatch(writes.at(-1), /--from eric --confirm-payment/);
});
