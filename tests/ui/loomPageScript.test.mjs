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
const LATEST_DELIVERY_PIN = `${'4'.repeat(64)}i0`;
const PAYMENT_TXID = `${'e'.repeat(64)}`;
const STATUS_PIN = `${'f'.repeat(64)}i0`;
const ACCEPTANCE_PIN = `${'1'.repeat(64)}i0`;
const CLAIM_REJECT_PIN = `${'2'.repeat(64)}i0`;
const POSTED_TASK_PIN = `${'3'.repeat(64)}i0`;

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
    if (selector === '[data-loom-detail-action]') {
      return this.nodes.filter((node) => node.attrs['data-loom-detail-action'] !== undefined);
    }
    if (selector === '[data-loom-confirm-detail-action]') {
      return this.nodes.filter((node) => node.attrs['data-loom-confirm-detail-action'] !== undefined);
    }
    if (selector === '[data-loom-cancel-detail-action]') {
      return this.nodes.filter((node) => node.attrs['data-loom-cancel-detail-action'] !== undefined);
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
        nextActions: [
          {
            id: 'acceptAndPay',
            label: 'Accept and pay',
            tone: 'primary',
            actorRole: 'requester',
            requiresActor: false,
            requiresConfirmation: true,
            cliFallback: `metabot loom accept-and-pay --task-pin-id '${TASK_PIN}' --delivery-pin-id '${DELIVERY_PIN}' --score 5 --comment accepted --confirm-payment`,
          },
          {
            id: 'requestRevision',
            label: 'Request revision',
            tone: 'warning',
            actorRole: 'requester',
            requiresActor: false,
            requiresConfirmation: true,
            cliFallback: `metabot loom review-delivery --task-pin-id '${TASK_PIN}' --delivery-pin-id '${DELIVERY_PIN}' --verdict revision_needed --score 3 --comment "needs revision"`,
          },
          {
            id: 'reject',
            label: 'Reject',
            tone: 'danger',
            actorRole: 'requester',
            requiresActor: false,
            requiresConfirmation: true,
            cliFallback: `metabot loom review-delivery --task-pin-id '${TASK_PIN}' --delivery-pin-id '${DELIVERY_PIN}' --verdict rejected --score 1 --comment rejected`,
          },
          {
            id: 'openPr',
            label: 'Open PR',
            tone: 'neutral',
            actorRole: 'any',
            requiresActor: false,
            requiresConfirmation: false,
            cliFallback: 'open https://github.com/openagentinternet/open-agent-connect/pull/77',
          },
        ],
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

function dashboardWithPublishedTask(options = {}) {
  const payload = dashboard();
  const sourceCard = payload.dashboard.tasks[0];
  const postedCard = {
    ...sourceCard,
    taskPinId: POSTED_TASK_PIN,
    state: 'open',
    stateTone: 'open',
    columnId: 'open',
    title: 'Edited after preview',
    developer: null,
    bounty: { amount: '0.125', currency: 'SPACE' },
    tags: ['ui', 'loom'],
    createdAt: NOW,
    updatedAt: NOW,
    activeClaimCount: 0,
    latestStatusSummary: 'Ready for developers.',
    prUrl: '',
    paymentTxId: '',
    warningCount: 0,
    actorContext: {},
  };
  const postedDetail = {
    ...payload.dashboard.details[0],
    taskPinId: POSTED_TASK_PIN,
    state: 'open',
    columnId: 'open',
    title: 'Edited after preview',
    requirement: 'Build a compact modal for publishing tasks.',
    criteria: 'Preview must happen before confirm.',
    claims: [],
    warnings: [],
    localWorkflow: [],
    validRecords: {
      claims: [],
      statuses: [],
      deliveries: [],
      acceptances: [],
      claimRejects: [],
    },
    timeline: [
      { id: `task:${POSTED_TASK_PIN}`, kind: 'task', title: 'Task posted', timestamp: NOW, pinId: POSTED_TASK_PIN },
    ],
  };

  payload.dashboard.summary = {
    ...payload.dashboard.summary,
    totalTasks: 2,
    open: 1,
    newestActivityAt: NOW,
  };
  payload.dashboard.tasks = [postedCard, ...payload.dashboard.tasks];
  payload.dashboard.columns = [
    { id: 'open', title: 'Open', cards: [postedCard] },
    ...payload.dashboard.columns,
  ];
  payload.dashboard.details = options.omitDetail
    ? payload.dashboard.details
    : [postedDetail, ...payload.dashboard.details];
  return payload;
}

async function runLoomScript(options = {}) {
  const elements = {
    '[data-loom-status]': new FakeElement(),
    '[data-loom-refresh]': new FakeElement(),
    '[data-loom-new-task]': new FakeElement(),
    '[data-loom-new-task-modal]': new FakeElement(),
    '[data-loom-new-task-dialog]': new FakeElement(),
    '[data-loom-new-task-form]': new FakeElement(),
    '[data-loom-new-task-close]': new FakeElement(),
    '[data-loom-new-task-from]': new FakeElement(options.newTaskFrom || ''),
    '[data-loom-new-task-title]': new FakeElement(),
    '[data-loom-new-task-requirement]': new FakeElement(),
    '[data-loom-new-task-requirement-content-type]': new FakeElement(),
    '[data-loom-new-task-criteria]': new FakeElement(),
    '[data-loom-new-task-criteria-content-type]': new FakeElement(),
    '[data-loom-new-task-repo-uri]': new FakeElement(),
    '[data-loom-new-task-project-base]': new FakeElement(),
    '[data-loom-new-task-base-branch]': new FakeElement(),
    '[data-loom-new-task-bounty-amount]': new FakeElement(),
    '[data-loom-new-task-currency]': new FakeElement(),
    '[data-loom-new-task-deadline]': new FakeElement(),
    '[data-loom-new-task-tags]': new FakeElement(),
    '[data-loom-new-task-attachments]': new FakeElement(),
    '[data-loom-new-task-preview]': new FakeElement(),
    '[data-loom-new-task-confirm]': new FakeElement(),
    '[data-loom-new-task-summary]': new FakeElement(),
    '[data-loom-new-task-error]': new FakeElement(),
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
  elements['[data-loom-new-task-modal]'].hidden = true;
  elements['[data-loom-new-task-base-branch]'].value = 'main';
  elements['[data-loom-new-task-currency]'].value = 'SPACE';
  elements['[data-loom-new-task-requirement-content-type]'].value = 'text/markdown';
  elements['[data-loom-new-task-criteria-content-type]'].value = 'text/markdown';
  elements['[data-loom-new-task-project-base]'].value = 'github';
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
      ...(options.windowOpen ? { open: options.windowOpen } : {}),
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
      if (String(url) === '/api/loom/actions') {
        const actionCallCount = fetchCalls.filter((call) => call.url === '/api/loom/actions').length;
        const result = options.actionResults
          ? options.actionResults[Math.min(actionCallCount - 1, options.actionResults.length - 1)]
          : { ok: true, state: 'awaiting_confirmation', data: { preview: { dryRun: true }, cliFallback: 'metabot loom post-task --from requester' } };
        return {
          ok: result.httpOk !== false,
          json: async () => result,
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };

  vm.runInNewContext(buildLoomPageDefinition().script, context);
  await waitFor(() => elements['[data-loom-board]'].innerHTML.includes('Wire Loom board UI') || elements['[data-loom-error]'].textContent, 'initial Loom render');
  return { elements, fetchCalls, writes, document: context.document };
}

function fillValidNewTask(elements, overrides = {}) {
  const values = {
    '[data-loom-new-task-from]': 'requester-bot',
    '[data-loom-new-task-title]': 'Ship Loom publish modal',
    '[data-loom-new-task-requirement]': 'Build a compact modal for publishing tasks.',
    '[data-loom-new-task-requirement-content-type]': 'text/markdown',
    '[data-loom-new-task-criteria]': 'Preview must happen before confirm.',
    '[data-loom-new-task-criteria-content-type]': 'text/markdown',
    '[data-loom-new-task-repo-uri]': 'https://github.com/openagentinternet/open-agent-connect',
    '[data-loom-new-task-project-base]': 'github',
    '[data-loom-new-task-base-branch]': 'main',
    '[data-loom-new-task-bounty-amount]': '0.125',
    '[data-loom-new-task-currency]': 'SPACE',
    '[data-loom-new-task-deadline]': '2026-06-01T12:30',
    '[data-loom-new-task-tags]': ' ui, loom, ui ',
    '[data-loom-new-task-attachments]': 'metafile://alpha\nmetafile://beta',
    ...overrides,
  };
  for (const [selector, value] of Object.entries(values)) {
    elements[selector].value = value;
  }
}

test('loom page script loads dashboard JSON and renders board cards with Bot names without an initial detail panel', async () => {
  const { elements, fetchCalls, writes } = await runLoomScript();

  const contentHtml = buildLoomPageDefinition().contentHtml;
  assert.equal(fetchCalls[0].url, '/api/loom/dashboard');
  assert.equal(elements['[data-loom-scope-label]'].textContent, 'Global');
  assert.equal(elements['[data-loom-new-task]'].disabled, false);
  assert.match(contentHtml, /data-loom-new-task-modal/);
  assert.match(contentHtml, /data-loom-new-task-form/);
  assert.match(contentHtml, /data-loom-new-task-requirement/);
  assert.match(contentHtml, /data-loom-new-task-requirement-content-type/);
  assert.match(contentHtml, /data-loom-new-task-criteria-content-type/);
  assert.match(contentHtml, /data-loom-new-task-project-base/);
  assert.match(contentHtml, /<div class="loom-new-task-error" data-loom-new-task-error role="alert" aria-live="polite"><\/div>/u);
  assert.match(contentHtml, /<select[^>]+data-loom-new-task-currency[\s\S]*<option value="SPACE">SPACE<\/option>[\s\S]*<option value="BTC">BTC<\/option>[\s\S]*<option value="DOGE">DOGE<\/option>[\s\S]*<option value="OPCAT">OPCAT<\/option>/u);
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
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /--verdict rejected/);
  assert.doesNotMatch(elements['[data-loom-detail-actions]'].innerHTML, /state --task-pin-id/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /target="_blank"/);

  const [copyButton] = elements['[data-loom-detail-body]'].querySelectorAll('[data-loom-copy]');
  await copyButton.listeners.get('click')();
  assert.equal(writes[0], TASK_PIN);
});

test('loom new task modal opens and validation blocks preview without closing it', async () => {
  const { elements, fetchCalls } = await runLoomScript();

  await elements['[data-loom-new-task]'].listeners.get('click')();

  assert.equal(elements['[data-loom-new-task-modal]'].hidden, false);
  assert.equal(elements['[data-loom-new-task-from]'].value, '');
  assert.equal(elements['[data-loom-new-task-base-branch]'].value, 'main');
  assert.equal(elements['[data-loom-new-task-currency]'].value, 'SPACE');

  await elements['[data-loom-new-task-form]'].listeners.get('submit')({
    preventDefault() {},
  });

  assert.equal(elements['[data-loom-new-task-modal]'].hidden, false);
  assert.match(elements['[data-loom-new-task-error]'].textContent, /From is required/);
  assert.match(elements['[data-loom-new-task-error]'].textContent, /Title is required/);
  assert.equal(fetchCalls.filter((call) => call.url === '/api/loom/actions').length, 0);
});

test('loom new task preview builds protocol payload and confirm publishes only a fresh preview', async () => {
  const { elements, fetchCalls } = await runLoomScript({
    search: '?from=query-requester',
    actionResults: [
      { ok: true, state: 'awaiting_confirmation', data: { chain: { path: '/protocols/loom-task' }, cliFallback: 'metabot loom post-task --from requester' } },
      { ok: true, state: 'success', data: { taskPinId: 'posted-task-pin', chain: { txId: 'tx-1' }, cliFallback: 'metabot loom post-task --confirm' } },
    ],
    payloads: [dashboard(), dashboard()],
  });

  await elements['[data-loom-new-task]'].listeners.get('click')();
  fillValidNewTask(elements, { '[data-loom-new-task-from]': 'requester-bot' });
  await elements['[data-loom-new-task-form]'].listeners.get('submit')({
    preventDefault() {},
  });

  const previewCall = fetchCalls.find((call) => call.url === '/api/loom/actions');
  assert.ok(previewCall, 'expected preview action call');
  assert.equal(previewCall.options.method, 'POST');
  const previewBody = JSON.parse(previewCall.options.body);
  assert.equal(previewBody.action, 'postTask');
  assert.equal(previewBody.from, 'requester-bot');
  assert.equal(previewBody.confirm, false);
  assert.deepEqual(previewBody.payload, {
    title: 'Ship Loom publish modal',
    requirementContentType: 'text/markdown',
    requirement: 'Build a compact modal for publishing tasks.',
    criteriaContentType: 'text/markdown',
    criteria: 'Preview must happen before confirm.',
    projectBase: 'github',
    project: {
      repoUri: 'https://github.com/openagentinternet/open-agent-connect',
      baseBranch: 'main',
    },
    bounty: {
      amount: '0.125',
      currency: 'SPACE',
    },
    deadline: Date.parse('2026-06-01T12:30'),
    tags: ['ui', 'loom'],
    attachments: ['metafile://alpha', 'metafile://beta'],
  });
  assert.equal(elements['[data-loom-new-task-confirm]'].disabled, false);
  assert.match(elements['[data-loom-new-task-summary]'].innerHTML, /requester-bot/);
  assert.match(elements['[data-loom-new-task-summary]'].innerHTML, /Ship Loom publish modal/);
  assert.match(elements['[data-loom-new-task-summary]'].innerHTML, /open-agent-connect/);
  assert.match(elements['[data-loom-new-task-summary]'].innerHTML, /0\.125 SPACE/);
  assert.match(elements['[data-loom-new-task-summary]'].innerHTML, /\/protocols\/loom-task/);
  assert.match(elements['[data-loom-new-task-summary]'].innerHTML, /metabot loom post-task/);

  elements['[data-loom-new-task-title]'].value = 'Edited after preview';
  elements['[data-loom-new-task-title]'].listeners.get('input')();
  assert.equal(elements['[data-loom-new-task-confirm]'].disabled, true);
  assert.equal(elements['[data-loom-new-task-summary]'].innerHTML, '');

  await elements['[data-loom-new-task-confirm]'].listeners.get('click')();
  assert.equal(fetchCalls.filter((call) => call.url === '/api/loom/actions').length, 1);

  await elements['[data-loom-new-task-form]'].listeners.get('submit')({
    preventDefault() {},
  });
  const refreshedPreviewBody = JSON.parse(fetchCalls.filter((call) => call.url === '/api/loom/actions').at(-1).options.body);
  assert.equal(refreshedPreviewBody.confirm, false);
  assert.equal(refreshedPreviewBody.payload.title, 'Edited after preview');

  await elements['[data-loom-new-task-confirm]'].listeners.get('click')();
  const actionBodies = fetchCalls
    .filter((call) => call.url === '/api/loom/actions')
    .map((call) => JSON.parse(call.options.body));
  assert.equal(actionBodies.length, 3);
  assert.equal(actionBodies[2].confirm, true);
  assert.deepEqual(actionBodies[2].payload, actionBodies[1].payload);
  assert.equal(actionBodies[2].payload.title, 'Edited after preview');
  assert.equal(elements['[data-loom-new-task-modal]'].hidden, true);
  assert.match(elements['[data-loom-status]'].textContent, /Task published/);
  assert.ok(fetchCalls.some((call) => call.url === '/api/loom/refresh'), 'expected success refresh');
});

test('loom confirmed new task publish opens and highlights the returned task after refresh', async () => {
  const { elements } = await runLoomScript({
    actionResults: [
      { ok: true, state: 'awaiting_confirmation', data: { cliFallback: 'metabot loom post-task' } },
      { ok: true, state: 'success', data: { taskPinId: POSTED_TASK_PIN } },
    ],
    payloads: [dashboard(), dashboardWithPublishedTask()],
  });

  await elements['[data-loom-new-task]'].listeners.get('click')();
  fillValidNewTask(elements);
  await elements['[data-loom-new-task-form]'].listeners.get('submit')({
    preventDefault() {},
  });
  await elements['[data-loom-new-task-confirm]'].listeners.get('click')();

  assert.equal(elements['[data-loom-new-task-modal]'].hidden, true);
  assert.equal(elements['[data-loom-detail-modal]'].hidden, false);
  assert.match(elements['[data-loom-board]'].innerHTML, new RegExp(`is-selected" data-loom-card="${POSTED_TASK_PIN}"`));
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Edited after preview/);
  assert.match(elements['[data-loom-detail-body]'].innerHTML, /Build a compact modal for publishing tasks/);
});

test('loom new task validates decimals, currency, metafile attachments, dedupes tags, and ignores Enter confirm', async () => {
  const { elements, fetchCalls } = await runLoomScript();

  await elements['[data-loom-new-task]'].listeners.get('click')();
  fillValidNewTask(elements, {
    '[data-loom-new-task-bounty-amount]': '0',
    '[data-loom-new-task-currency]': 'ETH',
    '[data-loom-new-task-attachments]': 'metafile://alpha\nmetafile://\nmetafile://   \nhttps://bad',
  });
  await elements['[data-loom-new-task-form]'].listeners.get('submit')({
    preventDefault() {},
  });

  assert.match(elements['[data-loom-new-task-error]'].textContent, /Bounty amount must be a positive decimal/);
  assert.match(elements['[data-loom-new-task-error]'].textContent, /Currency must be SPACE, BTC, DOGE, or OPCAT/);
  assert.match(elements['[data-loom-new-task-error]'].textContent, /Attachments must use metafile:\/\/ URIs/);
  assert.equal(fetchCalls.filter((call) => call.url === '/api/loom/actions').length, 0);

  elements['[data-loom-new-task-bounty-amount]'].value = '3.50';
  elements['[data-loom-new-task-currency]'].value = 'DOGE';
  elements['[data-loom-new-task-attachments]'].value = 'metafile://alpha';
  elements['[data-loom-new-task-tags]'].value = 'backend, backend, api';
  let fieldEnterPrevented = false;
  await elements['[data-loom-new-task-form]'].listeners.get('keydown')({
    key: 'Enter',
    target: { tagName: 'INPUT' },
    preventDefault() {
      fieldEnterPrevented = true;
    },
  });
  assert.equal(fieldEnterPrevented, true);
  let buttonEnterPrevented = false;
  await elements['[data-loom-new-task-form]'].listeners.get('keydown')({
    key: 'Enter',
    target: { tagName: 'BUTTON' },
    preventDefault() {
      buttonEnterPrevented = true;
    },
  });
  assert.equal(buttonEnterPrevented, false);
  assert.equal(fetchCalls.filter((call) => call.url === '/api/loom/actions').length, 0);

  await elements['[data-loom-new-task-form]'].listeners.get('submit')({
    preventDefault() {},
  });
  const previewBody = JSON.parse(fetchCalls.find((call) => call.url === '/api/loom/actions').options.body);
  assert.equal(previewBody.payload.bounty.amount, '3.50');
  assert.equal(previewBody.payload.bounty.currency, 'DOGE');
  assert.deepEqual(previewBody.payload.tags, ['backend', 'api']);
  assert.deepEqual(previewBody.payload.attachments, ['metafile://alpha']);
});

test('loom new task modal returns focus to New task after close paths and success', async () => {
  const { elements, document } = await runLoomScript({
    actionResults: [
      { ok: true, state: 'awaiting_confirmation', data: { cliFallback: 'metabot loom post-task' } },
      { ok: true, state: 'success', data: { taskPinId: 'posted-task-pin' } },
    ],
    payloads: [dashboard(), dashboard()],
  });

  await elements['[data-loom-new-task]'].listeners.get('click')();
  elements['[data-loom-new-task-close]'].listeners.get('click')();
  assert.equal(elements['[data-loom-new-task-modal]'].hidden, true);
  assert.equal(elements['[data-loom-new-task]'].focusCount, 1);

  await elements['[data-loom-new-task]'].listeners.get('click')();
  elements['[data-loom-new-task-modal]'].listeners.get('click')({
    target: elements['[data-loom-new-task-modal]'],
  });
  assert.equal(elements['[data-loom-new-task]'].focusCount, 2);

  await elements['[data-loom-new-task]'].listeners.get('click')();
  document.listeners.get('keydown')({
    key: 'Escape',
    preventDefault() {},
  });
  assert.equal(elements['[data-loom-new-task]'].focusCount, 3);

  await elements['[data-loom-new-task]'].listeners.get('click')();
  fillValidNewTask(elements);
  await elements['[data-loom-new-task-form]'].listeners.get('submit')({
    preventDefault() {},
  });
  await elements['[data-loom-new-task-confirm]'].listeners.get('click')();
  assert.equal(elements['[data-loom-new-task-modal]'].hidden, true);
  assert.equal(elements['[data-loom-new-task]'].focusCount, 4);
});

test('loom new task failures preserve input and display action errors', async () => {
  const { elements, fetchCalls } = await runLoomScript({
    actionResults: [
      { httpOk: false, ok: false, state: 'failed', message: 'Preview failed.' },
      { ok: true, state: 'awaiting_confirmation', data: { cliFallback: 'metabot loom post-task' } },
      { httpOk: false, ok: false, state: 'failed', message: 'Confirm failed.' },
    ],
  });

  await elements['[data-loom-new-task]'].listeners.get('click')();
  fillValidNewTask(elements);
  await elements['[data-loom-new-task-form]'].listeners.get('submit')({
    preventDefault() {},
  });

  assert.equal(elements['[data-loom-new-task-modal]'].hidden, false);
  assert.equal(elements['[data-loom-new-task-title]'].value, 'Ship Loom publish modal');
  assert.match(elements['[data-loom-new-task-error]'].textContent, /Preview failed/);

  await elements['[data-loom-new-task-form]'].listeners.get('submit')({
    preventDefault() {},
  });
  assert.equal(elements['[data-loom-new-task-confirm]'].disabled, false);
  await elements['[data-loom-new-task-confirm]'].listeners.get('click')();

  assert.equal(elements['[data-loom-new-task-modal]'].hidden, false);
  assert.equal(elements['[data-loom-new-task-title]'].value, 'Ship Loom publish modal');
  assert.match(elements['[data-loom-new-task-error]'].textContent, /Confirm failed/);
  assert.equal(fetchCalls.filter((call) => call.url === '/api/loom/actions').length, 3);
});

test('loom delivered detail renders review actions and accept/pay previews before confirm', async () => {
  const refreshed = dashboard();
  refreshed.dashboard.details[0].state = 'accepted_paid';
  refreshed.dashboard.details[0].validRecords.acceptances = [];
  refreshed.dashboard.tasks[0].state = 'accepted_paid';
  refreshed.dashboard.tasks[0].columnId = 'closed';
  const { elements, fetchCalls } = await runLoomScript({
    search: '?from=requester-bot',
    actionResults: [
      {
        ok: true,
        state: 'awaiting_confirmation',
        data: {
          preview: {
            amount: '0.5',
            currency: 'SPACE',
            payoutAddress: '1ActivePayoutAddress',
            chain: { name: 'mainnet', path: '/protocols/loom-acceptance' },
          },
          cliFallback: 'metabot loom accept-and-pay --task-pin-id task --delivery-pin-id delivery',
        },
      },
      { ok: true, state: 'success', data: { paymentTxId: PAYMENT_TXID } },
    ],
    payloads: [dashboard(), refreshed],
  });
  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');

  await card.listeners.get('click')();

  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /Accept and pay/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /Request revision/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /Reject/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /Open PR/);

  const acceptButton = elements['[data-loom-detail-actions]']
    .querySelectorAll('[data-loom-detail-action]')
    .find((button) => button.getAttribute('data-loom-detail-action') === 'acceptAndPay');
  assert.ok(acceptButton, 'expected accept/pay action button');
  await acceptButton.listeners.get('click')();

  const previewBody = JSON.parse(fetchCalls.filter((call) => call.url === '/api/loom/actions').at(-1).options.body);
  assert.equal(previewBody.action, 'acceptAndPay');
  assert.equal(previewBody.from, 'requester-bot');
  assert.equal(previewBody.taskPinId, TASK_PIN);
  assert.equal(previewBody.deliveryPinId, DELIVERY_PIN);
  assert.equal(previewBody.score, 5);
  assert.equal(previewBody.comment, 'Accepted.');
  assert.equal(previewBody.confirm, false);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /Confirm Accept and pay/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /0\.5/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /SPACE/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /1ActivePayoutAddress/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /requester-bot/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, new RegExp(TASK_PIN.slice(0, 8)));
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, new RegExp(DELIVERY_PIN.slice(0, 8)));
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /mainnet/);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /\/protocols\/loom-acceptance/);

  const confirmButton = elements['[data-loom-detail-actions]']
    .querySelectorAll('[data-loom-confirm-detail-action]')[0];
  assert.ok(confirmButton, 'expected action confirm button');
  await confirmButton.listeners.get('click')();

  const actionBodies = fetchCalls
    .filter((call) => call.url === '/api/loom/actions')
    .map((call) => JSON.parse(call.options.body));
  assert.equal(actionBodies.length, 2);
  assert.deepEqual({ ...actionBodies[1], confirm: false }, actionBodies[0]);
  assert.equal(actionBodies[1].confirm, true);
  assert.ok(fetchCalls.some((call) => call.url === '/api/loom/refresh'), 'expected success refresh');
  assert.equal(elements['[data-loom-detail-modal]'].hidden, false);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /Action completed/);
  assert.doesNotMatch(elements['[data-loom-detail-actions]'].innerHTML, /Do not pay again/i);
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, new RegExp(PAYMENT_TXID.slice(0, 8)));
});

test('loom review actions target the newest delivery after revision cycles', async () => {
  const multiDelivery = dashboard();
  const newerDelivery = JSON.parse(JSON.stringify(multiDelivery.dashboard.details[0].validRecords.deliveries[0]));
  newerDelivery.pinId = LATEST_DELIVERY_PIN;
  newerDelivery.timestamp = NOW - 100;
  newerDelivery.payload.delivery.deliverySummary = 'Newest delivery after revision.';
  multiDelivery.dashboard.details[0].validRecords.deliveries.push(newerDelivery);
  multiDelivery.dashboard.details[0].timeline.push({
    id: `delivery:${LATEST_DELIVERY_PIN}`,
    kind: 'delivery',
    title: 'Delivery posted',
    summary: 'Newest delivery after revision.',
    timestamp: NOW - 100,
    pinId: LATEST_DELIVERY_PIN,
  });
  multiDelivery.dashboard.details[0].nextActions = multiDelivery.dashboard.details[0].nextActions.map((action) => ({
    ...action,
    cliFallback: action.cliFallback.replaceAll(DELIVERY_PIN, LATEST_DELIVERY_PIN),
  }));

  const { elements, fetchCalls } = await runLoomScript({
    search: '?from=requester-bot',
    actionResults: [
      { ok: true, state: 'awaiting_confirmation', data: { verdict: 'revision_needed' } },
    ],
    payloads: [multiDelivery],
  });
  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');

  await card.listeners.get('click')();
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, new RegExp("--delivery-pin-id " + shellQuotedHtml(LATEST_DELIVERY_PIN)));
  assert.doesNotMatch(elements['[data-loom-detail-actions]'].innerHTML, new RegExp("--delivery-pin-id " + shellQuotedHtml(DELIVERY_PIN)));
  const revisionButton = elements['[data-loom-detail-actions]']
    .querySelectorAll('[data-loom-detail-action]')
    .find((button) => button.getAttribute('data-loom-detail-action') === 'requestRevision');
  await revisionButton.listeners.get('click')();

  const previewBody = JSON.parse(fetchCalls.filter((call) => call.url === '/api/loom/actions').at(-1).options.body);
  assert.equal(previewBody.action, 'requestRevision');
  assert.equal(previewBody.deliveryPinId, LATEST_DELIVERY_PIN);
  assert.notEqual(previewBody.deliveryPinId, DELIVERY_PIN);
});

test('loom delivered detail sends revision and reject defaults through preview and confirm', async () => {
  const { elements, fetchCalls } = await runLoomScript({
    search: '?from=requester-bot',
    actionResults: [
      { ok: true, state: 'awaiting_confirmation', data: { verdict: 'revision_needed', cliFallback: 'metabot loom review-delivery --verdict revision_needed' } },
      { ok: true, state: 'success', data: { acceptancePinId: 'revision-pin' } },
      { ok: true, state: 'awaiting_confirmation', data: { verdict: 'rejected', cliFallback: 'metabot loom review-delivery --verdict rejected' } },
      { ok: true, state: 'success', data: { acceptancePinId: 'reject-pin' } },
    ],
    payloads: [dashboard(), dashboard(), dashboard()],
  });
  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');

  await card.listeners.get('click')();
  const revisionButton = elements['[data-loom-detail-actions]']
    .querySelectorAll('[data-loom-detail-action]')
    .find((button) => button.getAttribute('data-loom-detail-action') === 'requestRevision');
  await revisionButton.listeners.get('click')();
  await elements['[data-loom-detail-actions]'].querySelectorAll('[data-loom-confirm-detail-action]')[0].listeners.get('click')();

  await card.listeners.get('click')();
  const rejectButton = elements['[data-loom-detail-actions]']
    .querySelectorAll('[data-loom-detail-action]')
    .find((button) => button.getAttribute('data-loom-detail-action') === 'reject');
  await rejectButton.listeners.get('click')();
  await elements['[data-loom-detail-actions]'].querySelectorAll('[data-loom-confirm-detail-action]')[0].listeners.get('click')();

  const actionBodies = fetchCalls
    .filter((call) => call.url === '/api/loom/actions')
    .map((call) => JSON.parse(call.options.body));
  assert.equal(actionBodies[0].action, 'requestRevision');
  assert.equal(actionBodies[0].score, 3);
  assert.match(actionBodies[0].comment, /revision/i);
  assert.equal(actionBodies[0].confirm, false);
  assert.equal(actionBodies[1].action, 'requestRevision');
  assert.equal(actionBodies[1].confirm, true);
  assert.equal(actionBodies[2].action, 'reject');
  assert.equal(actionBodies[2].score, 1);
  assert.match(actionBodies[2].comment, /rejected/i);
  assert.equal(actionBodies[2].confirm, false);
  assert.equal(actionBodies[3].action, 'reject');
  assert.equal(actionBodies[3].confirm, true);
});

test('loom detail action failures and disabled reasons keep detail open with recovery guidance', async () => {
  const disabled = dashboard();
  disabled.dashboard.details[0].nextActions[0].disabledReason = 'Only the requester can accept and pay.';
  const { elements } = await runLoomScript({ payloads: [disabled] });
  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');
  await card.listeners.get('click')();
  assert.match(elements['[data-loom-detail-actions]'].innerHTML, /Only the requester can accept and pay/);

  const failureResult = await runLoomScript({
    search: '?from=requester-bot',
    actionResults: [
      { ok: true, state: 'awaiting_confirmation', data: { preview: { amount: '0.5', currency: 'SPACE' } } },
      {
        httpOk: false,
        ok: false,
        state: 'failed',
        code: 'acceptance_write_failed_after_payment',
        message: 'Payment succeeded, but writing loom-acceptance failed.',
        data: {
          paymentTxId: PAYMENT_TXID,
          retryGuidance: 'Do not call wallet transfer again. Publish the saved acceptance request.',
          acceptancePayload: { verdict: 'passed', releasePayment: true },
        },
      },
    ],
  });
  const [failureCard] = failureResult.elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');
  await failureCard.listeners.get('click')();
  const acceptButton = failureResult.elements['[data-loom-detail-actions]']
    .querySelectorAll('[data-loom-detail-action]')
    .find((button) => button.getAttribute('data-loom-detail-action') === 'acceptAndPay');
  await acceptButton.listeners.get('click')();
  await failureResult.elements['[data-loom-detail-actions]'].querySelectorAll('[data-loom-confirm-detail-action]')[0].listeners.get('click')();

  assert.equal(failureResult.elements['[data-loom-detail-modal]'].hidden, false);
  assert.match(failureResult.elements['[data-loom-detail-actions]'].innerHTML, /Do not pay again/i);
  assert.match(failureResult.elements['[data-loom-detail-actions]'].innerHTML, new RegExp(PAYMENT_TXID.slice(0, 8)));
  assert.match(failureResult.elements['[data-loom-detail-actions]'].innerHTML, /Publish the saved acceptance request/);

  const permissionResult = await runLoomScript({
    search: '?from=wrong-actor',
    actionResults: [
      {
        httpOk: false,
        ok: false,
        state: 'failed',
        code: 'loom_requester_actor_required',
        message: 'Only the requester can review this delivery.',
      },
    ],
  });
  const [permissionCard] = permissionResult.elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');
  await permissionCard.listeners.get('click')();
  const revisionButton = permissionResult.elements['[data-loom-detail-actions]']
    .querySelectorAll('[data-loom-detail-action]')
    .find((button) => button.getAttribute('data-loom-detail-action') === 'requestRevision');
  await revisionButton.listeners.get('click')();
  assert.equal(permissionResult.elements['[data-loom-detail-modal]'].hidden, false);
  assert.match(permissionResult.elements['[data-loom-detail-actions]'].innerHTML, /Only the requester can review this delivery/);
});

test('loom Open PR action is non-mutating and preserves safe URL behavior', async () => {
  const opened = [];
  const { elements, fetchCalls, writes } = await runLoomScript({
    windowOpen: (url, target, features) => opened.push({ url, target, features }),
  });
  const [card] = elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');
  await card.listeners.get('click')();

  const openButton = elements['[data-loom-detail-actions]']
    .querySelectorAll('[data-loom-detail-action]')
    .find((button) => button.getAttribute('data-loom-detail-action') === 'openPr');
  assert.ok(openButton, 'expected open PR button');
  await openButton.listeners.get('click')();

  assert.equal(fetchCalls.filter((call) => call.url === '/api/loom/actions').length, 0);
  assert.equal(writes.at(-1), 'https://github.com/openagentinternet/open-agent-connect/pull/77');
  assert.deepEqual(opened[0], {
    url: 'https://github.com/openagentinternet/open-agent-connect/pull/77',
    target: '_blank',
    features: 'noreferrer',
  });

  const unsafe = dashboard();
  unsafe.dashboard.tasks[0].prUrl = 'javascript:alert(1)';
  unsafe.dashboard.columns[0].cards[0].prUrl = 'javascript:alert(1)';
  unsafe.dashboard.details[0].validRecords.deliveries[0].payload.delivery.prUrl = 'javascript:alert(1)';
  unsafe.dashboard.details[0].nextActions[3].cliFallback = 'open javascript:alert(1)';
  const unsafeResult = await runLoomScript({ payloads: [unsafe] });
  const [unsafeCard] = unsafeResult.elements['[data-loom-board]'].querySelectorAll('[data-loom-card]');
  await unsafeCard.listeners.get('click')();
  const unsafeOpenButton = unsafeResult.elements['[data-loom-detail-actions]']
    .querySelectorAll('[data-loom-detail-action]')
    .find((button) => button.getAttribute('data-loom-detail-action') === 'openPr');
  assert.equal(Boolean(unsafeOpenButton), false);
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
    .find((button) => (button.getAttribute('data-loom-copy') || '').startsWith('metabot loom state '));
  assert.ok(cliCopyButton, 'expected CLI copy button');
  await cliCopyButton.listeners.get('click')();
  assert.match(writes.at(-1), /--from 'eric --confirm-payment'/);
  assert.doesNotMatch(writes.at(-1), /--from eric --confirm-payment/);
});
