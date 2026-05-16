import assert from 'node:assert/strict';
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

class FakeElement {
  constructor(value = '') {
    this.textContent = '';
    this.value = value;
    this.dataset = {};
    this.disabled = false;
    this.listeners = new Map();
    this.attrs = {};
    this.nodes = [];
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
      actor: { profileSlug: 'eric', globalMetaId: 'gm-eric', address: '1EricAddress' },
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
    '[data-loom-actor]': new FakeElement(),
    '[data-loom-updated]': new FakeElement(),
    '[data-loom-stale-warning]': new FakeElement(),
    '[data-loom-state-filter]': new FakeElement(options.state || ''),
    '[data-loom-role-filter]': new FakeElement(options.role || ''),
    '[data-loom-query-filter]': new FakeElement(options.query || ''),
    '[data-loom-metrics]': new FakeElement(),
    '[data-loom-board]': new FakeElement(),
    '[data-loom-detail]': new FakeElement(),
    '[data-loom-error]': new FakeElement(),
  };
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
      location: { search: options.search || '?from=eric' },
    },
    navigator: {
      clipboard: {
        writeText: async (value) => writes.push(value),
      },
    },
    document: {
      readyState: 'complete',
      addEventListener() {},
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
  return { elements, fetchCalls, writes };
}

test('loom page script loads dashboard JSON, renders board cards with Bot names, and selects task detail', async () => {
  const { elements, fetchCalls, writes } = await runLoomScript();

  assert.equal(fetchCalls[0].url, '/api/loom/dashboard?from=eric');
  assert.match(elements['[data-loom-actor]'].textContent, /eric/);
  assert.match(elements['[data-loom-metrics]'].innerHTML, /Needs my action/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Review/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Wire Loom board UI/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Requester Bot/);
  assert.match(elements['[data-loom-board]'].innerHTML, /Active Developer Bot/);
  assert.match(elements['[data-loom-board]'].innerHTML, /phase-3/);
  assert.match(elements['[data-loom-board]'].innerHTML, /1 claim/);
  assert.match(elements['[data-loom-board]'].innerHTML, new RegExp(PAYMENT_TXID.slice(0, 8)));
  assert.match(elements['[data-loom-board]'].innerHTML, /just now/);

  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');
  await card.listeners.get('click')();
  assert.match(elements['[data-loom-detail]'].innerHTML, /Create the built-in Loom operations board/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Repository/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /openagentinternet\/open-agent-connect/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /href="https:\/\/github\.com\/openagentinternet\/open-agent-connect"/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Base branch:.*main/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Active Developer Bot/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /gm-dev/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /1DeveloperAddress/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /1ActivePayoutAddress/);
  assert.doesNotMatch(elements['[data-loom-detail]'].innerHTML.split('Requirement')[0], /Inactive Developer Bot/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Status author is not the active developer/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Delivery posted/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /codex\/loom-board/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /\/tmp\/loom-workspace/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /llm-session-123/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /\/tmp\/loom-process\.md/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /metafile:\/\/loom-process-log/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /1234567/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Render local workflow commits/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Raw status says tests are passing/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /gm-status-author/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /1StatusAuthorAddress/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /abcdef1/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Add raw status evidence/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /metafile:\/\/raw-process-log/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /metafile:\/\/raw-artifact/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Loom board PR/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /gm-delivery-author/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /1DeliveryAuthorAddress/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Branches:.*codex\/loom-board -&gt; main/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Tests pass/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /done/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /accepted/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /gm-acceptance-author/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /1AcceptanceAuthorAddress/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Score: 5/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Accepted with payment/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /Requester selected a newer claim/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /gm-reject-author/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /1RejectAuthorAddress/);
  assert.match(elements['[data-loom-detail]'].innerHTML, new RegExp(PAYMENT_TXID.slice(0, 8)));
  assert.match(elements['[data-loom-detail]'].innerHTML, new RegExp("metabot loom state " + shellQuotedHtml(TASK_PIN) + " --refresh"));
  assert.match(elements['[data-loom-detail]'].innerHTML, new RegExp("--delivery-pin-id " + shellQuotedHtml(DELIVERY_PIN)));
  assert.match(elements['[data-loom-detail]'].innerHTML, /metabot loom accept-and-pay/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /metabot loom review-delivery/);
  assert.doesNotMatch(elements['[data-loom-detail]'].innerHTML, /state --task-pin-id/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /target="_blank"/);

  const [copyButton] = elements['[data-loom-detail]'].querySelectorAll('[data-loom-copy]');
  await copyButton.listeners.get('click')();
  assert.equal(writes[0], TASK_PIN);
});

test('loom page filters reload dashboard and refresh posts the selected actor', async () => {
  const { elements, fetchCalls } = await runLoomScript();

  elements['[data-loom-state-filter]'].value = 'review';
  elements['[data-loom-role-filter]'].value = 'needs_action';
  elements['[data-loom-query-filter]'].value = 'github';
  await elements['[data-loom-state-filter]'].listeners.get('change')();

  assert.equal(fetchCalls.at(-1).url, '/api/loom/dashboard?from=eric&state=review&role=needs_action&query=github');

  await elements['[data-loom-refresh]'].listeners.get('click')();
  const refreshCall = fetchCalls.find((call) => call.url === '/api/loom/refresh');
  assert.ok(refreshCall, 'expected refresh endpoint to be called');
  assert.equal(refreshCall.options.method, 'POST');
  assert.deepEqual(JSON.parse(refreshCall.options.body), { from: 'eric' });
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
  assert.doesNotMatch(elements['[data-loom-detail]'].innerHTML, /href="javascript:/i);
  assert.doesNotMatch(elements['[data-loom-detail]'].innerHTML, /href="data:/i);
  assert.match(elements['[data-loom-board]'].innerHTML, /javascript:alert\(1\)/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /javascript:alert\(1\)/);
  assert.match(elements['[data-loom-detail]'].innerHTML, /data:text\/html,x/);
});

test('loom page shell-quotes URL-controlled CLI handoff arguments', async () => {
  const { elements, writes } = await runLoomScript({ search: '?from=eric%20--confirm-payment' });

  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');
  await card.listeners.get('click')();

  assert.match(elements['[data-loom-detail]'].innerHTML, /--from &#39;eric --confirm-payment&#39;/);
  assert.match(elements['[data-loom-detail]'].innerHTML, new RegExp("metabot loom state " + shellQuotedHtml(TASK_PIN) + " --refresh"));
  assert.match(elements['[data-loom-detail]'].innerHTML, new RegExp("--delivery-pin-id " + shellQuotedHtml(DELIVERY_PIN)));
  assert.doesNotMatch(elements['[data-loom-detail]'].innerHTML, /--from eric --confirm-payment/);

  const cliCopyButton = elements['[data-loom-detail]']
    .querySelectorAll('[data-loom-copy]')
    .find((button) => button.getAttribute('title') === 'Copy Copy CLI');
  assert.ok(cliCopyButton, 'expected CLI copy button');
  await cliCopyButton.listeners.get('click')();
  assert.match(writes.at(-1), /--from 'eric --confirm-payment'/);
  assert.doesNotMatch(writes.at(-1), /--from eric --confirm-payment/);
});
