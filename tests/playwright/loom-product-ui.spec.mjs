// Isolated Playwright acceptance for /ui/loom.
// Run after a build with:
//   npm run build && node --test tests/playwright/loom-product-ui.spec.mjs
// The spec serves mocked Loom endpoints locally and never reaches chain, wallet, or GitHub.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const playwright = await import('playwright').catch(() => null);

const { buildLoomPageDefinition } = require('../../dist/ui/pages/loom/app.js');

const NOW = 1_775_000_000_000;
const TASK_PIN = `${'a'.repeat(64)}i0`;
const OPEN_TASK_PIN = `${'b'.repeat(64)}i0`;
const CLAIM_PIN = `${'c'.repeat(64)}i0`;
const DELIVERY_PIN = `${'d'.repeat(64)}i0`;

function bot(role, overrides = {}) {
  return {
    role,
    displayName: role === 'requester' ? 'Requester Bot' : 'Developer Bot',
    fallbackLabel: `${role}:mock`,
    initials: role === 'requester' ? 'RB' : 'DB',
    globalMetaId: `gm-${role}`,
    address: `1${role}Address`,
    avatarUri: '',
    ...overrides,
  };
}

function deliveredCard() {
  return {
    taskPinId: TASK_PIN,
    state: 'delivered',
    stateTone: 'warning',
    columnId: 'review',
    title: 'Review compact Loom board',
    requester: bot('requester'),
    developer: bot('developer'),
    bounty: { amount: '0.5', currency: 'SPACE' },
    repo: { repoUri: 'https://github.com/openagentinternet/open-agent-connect', baseBranch: 'main' },
    tags: ['ui'],
    createdAt: NOW - 20_000,
    updatedAt: NOW - 5_000,
    activeClaimCount: 1,
    latestStatusSummary: 'Delivery is ready for review.',
    prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/77',
    warningCount: 0,
    actorContext: { needsMyAction: false },
  };
}

function openCard(index = 0) {
  return {
    taskPinId: index ? `${String(index).padStart(64, '0')}i0` : OPEN_TASK_PIN,
    state: 'open',
    stateTone: 'neutral',
    columnId: 'open',
    title: index ? `Open density task ${index}` : 'Claim compact Loom task',
    requester: bot('requester'),
    developer: null,
    bounty: { amount: '0.25', currency: 'SPACE' },
    repo: { repoUri: 'https://github.com/openagentinternet/open-agent-connect', baseBranch: 'main' },
    tags: [],
    createdAt: NOW - index,
    updatedAt: NOW - index,
    activeClaimCount: 0,
    latestStatusSummary: 'Ready for a developer.',
    prUrl: '',
    warningCount: 0,
    actorContext: { needsMyAction: false },
  };
}

function detailFor(card, nextActions) {
  return {
    taskPinId: card.taskPinId,
    state: card.state,
    columnId: card.columnId,
    title: card.title,
    requirement: 'Keep the Loom operations UI dense and readable.',
    criteria: 'Board, modal, preview, and confirm controls are covered.',
    requester: card.requester,
    claims: card.state === 'open' ? [] : [{
      pinId: CLAIM_PIN,
      taskPinId: card.taskPinId,
      timestamp: NOW - 15_000,
      active: true,
      message: 'Ready to finish this task.',
      payoutAddress: '1DeveloperPayoutAddress',
      developer: card.developer,
    }],
    warnings: [],
    localWorkflow: card.state === 'open' ? [] : [{
      claimPinId: CLAIM_PIN,
      developerMetaBotSlug: 'developer-bot',
      branchName: 'codex/loom-board',
      workspacePath: '/tmp/loom-workspace',
      llmSessionIds: ['llm-session-1'],
      processLogPaths: ['/tmp/loom-process.md'],
      processLogUris: ['metafile://loom-process'],
      commits: [{ sha: '1234567890abcdef', message: 'Mock commit', files: ['src/ui/pages/loom/app.ts'] }],
    }],
    nextActions,
    validRecords: {
      claims: [],
      statuses: [],
      deliveries: card.state === 'open' ? [] : [{
        pinId: DELIVERY_PIN,
        timestamp: NOW - 5_000,
        globalMetaId: 'gm-developer',
        creatorAddress: '1developerAddress',
        payload: {
          deliverySummary: 'Ready for review.',
          delivery: {
            prUrl: card.prUrl,
            prTitle: 'Loom board delivery',
            prBranch: 'codex/loom-board',
            prBaseBranch: 'main',
          },
        },
      }],
      acceptances: [],
      claimRejects: [],
    },
    timeline: [
      { id: `task:${card.taskPinId}`, kind: 'task', title: 'Task posted', timestamp: NOW - 20_000, pinId: card.taskPinId },
    ],
  };
}

function dashboard() {
  const delivered = deliveredCard();
  const open = openCard();
  const openCards = [open, ...Array.from({ length: 24 }, (_, index) => openCard(index + 1))];
  const reviewActions = [
    {
      id: 'acceptAndPay',
      label: 'Accept and pay',
      tone: 'primary',
      actorRole: 'requester',
      requiresActor: false,
      requiresConfirmation: true,
      cliFallback: `metabot loom accept-and-pay --task-pin-id '${TASK_PIN}' --delivery-pin-id '${DELIVERY_PIN}'`,
    },
    {
      id: 'requestRevision',
      label: 'Request revision',
      tone: 'warning',
      actorRole: 'requester',
      requiresActor: false,
      requiresConfirmation: true,
      cliFallback: `metabot loom review-delivery --task-pin-id '${TASK_PIN}' --delivery-pin-id '${DELIVERY_PIN}'`,
    },
  ];
  const developerActions = [{
    id: 'claimAndStart',
    label: 'Claim and start',
    tone: 'primary',
    actorRole: 'developer',
    requiresActor: false,
    requiresConfirmation: true,
    cliFallback: `metabot loom claim-and-start --task-pin-id '${OPEN_TASK_PIN}'`,
  }];
  return {
    dashboard: {
      version: 1,
      updatedAt: NOW,
      actor: {},
      summary: {
        totalTasks: openCards.length + 1,
        open: openCards.length,
        claimed: 0,
        inProgress: 0,
        delivered: 1,
        revisionNeeded: 0,
        rejected: 0,
        acceptedPaid: 0,
        failed: 0,
        invalidRecords: 0,
        needsMyAction: 0,
        newestActivityAt: NOW,
      },
      columns: [
        { id: 'open', title: 'Open', cards: openCards },
        { id: 'review', title: 'Review', cards: [delivered] },
      ],
      tasks: [delivered, ...openCards],
      details: [
        detailFor(delivered, reviewActions),
        detailFor(open, developerActions),
      ],
      refresh: { updatedAt: NOW },
    },
  };
}

function renderLoomPage() {
  const template = readFileSync(new URL('../../src/ui/pages/loom/index.html', import.meta.url), 'utf8');
  const definition = buildLoomPageDefinition();
  return template
    .replaceAll('__PAGE_TITLE__', definition.title)
    .replaceAll('__PAGE_EYEBROW__', definition.eyebrow)
    .replaceAll('__PAGE_NAV__', '')
    .replaceAll('__PAGE_CONTENT__', definition.contentHtml)
    .replaceAll('__PAGE_SCRIPT__', definition.script);
}

async function startMockServer() {
  const requests = [];
  const actions = [];
  const html = renderLoomPage();
  const sharedCss = readFileSync(new URL('../../src/ui/shared.css', import.meta.url), 'utf8')
    .replace(/^@import[^\n]+\n\n?/u, '');
  const server = createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (req.url === '/ui/shared.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(sharedCss);
      return;
    }
    if (req.url?.startsWith('/ui/loom')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.url?.startsWith('/api/loom/dashboard') || req.url === '/api/loom/refresh') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(dashboard()));
      return;
    }
    if (req.url === '/api/loom/actions') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      actions.push(body);
      const preview = body.action === 'postTask'
        ? { chain: { path: '/protocols/loom-task' }, cliFallback: 'metabot loom post-task' }
        : body.action === 'acceptAndPay'
          ? { preview: { amount: '0.5', currency: 'SPACE', payoutAddress: '1DeveloperPayoutAddress' } }
          : { preview: { dryRun: true, workspacePath: '/tmp/loom-workspace', branchName: 'codex/loom-board' } };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body.confirm
        ? { ok: true, state: 'success', data: { taskPinId: body.taskPinId || TASK_PIN, paymentTxId: 'mock-payment-txid' } }
        : { ok: true, state: 'awaiting_confirmation', data: preview }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    actions,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('loom product UI uses mocked endpoints for compact board and action acceptance', {
  skip: playwright ? false : 'Playwright is not installed in this repo; install it to run this acceptance spec.',
}, async () => {
  const server = await startMockServer();
  let browser;
  let page;
  try {
    browser = await playwright.chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const allowedOrigin = new URL(server.baseUrl).origin;
    const externalRequests = [];
    await page.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === allowedOrigin || ['data:', 'blob:'].includes(requestUrl.protocol)) {
        await route.continue();
        return;
      }
      externalRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    });
    await page.goto(`${server.baseUrl}/ui/loom`, { waitUntil: 'networkidle' });
    await page.getByText('Review compact Loom board').waitFor();

    assert.equal(new URL(server.requests.find((request) => request.url.startsWith('/api/loom/dashboard')).url, server.baseUrl).search, '');

    const layout = await page.evaluate(() => {
      const board = document.querySelector('[data-loom-board]').getBoundingClientRect();
      const shell = document.querySelector('[data-loom-shell]').getBoundingClientRect();
      const openColumnList = document.querySelector('[data-column="open"] .loom-column-list');
      const firstCard = document.querySelector('[data-loom-card]').getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        pageScrollHeight: document.scrollingElement.scrollHeight,
        pageClientHeight: document.scrollingElement.clientHeight,
        boardWidth: board.width,
        shellWidth: shell.width,
        openColumnScrollHeight: openColumnList.scrollHeight,
        openColumnClientHeight: openColumnList.clientHeight,
        firstCardHeight: firstCard.height,
      };
    });
    assert.ok(layout.boardWidth >= layout.viewportWidth - 40, `board width ${layout.boardWidth} should fill viewport ${layout.viewportWidth}`);
    assert.ok(layout.shellWidth >= layout.viewportWidth - 1);
    assert.ok(layout.pageScrollHeight <= layout.pageClientHeight + 2, `outer page scrolled: ${layout.pageScrollHeight} > ${layout.pageClientHeight}`);
    assert.ok(layout.openColumnScrollHeight > layout.openColumnClientHeight, 'expected open column to scroll internally');
    assert.ok(layout.firstCardHeight <= 155, `card exceeded density budget: ${layout.firstCardHeight}px`);

    await page.getByText('Review compact Loom board').click();
    const centered = await page.evaluate(() => {
      const dialog = document.querySelector('[data-loom-detail-dialog]').getBoundingClientRect();
      const viewportCenterX = window.innerWidth / 2;
      const viewportCenterY = (52 + window.innerHeight) / 2;
      return {
        centerDeltaX: Math.abs((dialog.left + dialog.width / 2) - viewportCenterX),
        centerDeltaY: Math.abs((dialog.top + dialog.height / 2) - viewportCenterY),
      };
    });
    assert.ok(centered.centerDeltaX < 8);
    assert.ok(centered.centerDeltaY < 8);

    await page.getByRole('button', { name: 'Accept and pay' }).click();
    await page.getByRole('button', { name: 'Confirm Accept and pay' }).click();
    assert.deepEqual(server.actions.slice(-2).map((action) => [action.action, action.confirm]), [
      ['acceptAndPay', false],
      ['acceptAndPay', true],
    ]);

    await page.getByLabel('Close task detail').click();
    await page.getByText('Claim compact Loom task').click();
    await page.getByRole('button', { name: 'Claim and start' }).click();
    await page.getByRole('button', { name: 'Confirm Claim and start' }).click();
    assert.deepEqual(server.actions.slice(-2).map((action) => [action.action, action.confirm]), [
      ['claimAndStart', false],
      ['claimAndStart', true],
    ]);

    await page.getByLabel('Close task detail').click();
    await page.getByRole('button', { name: 'New task' }).click();
    await page.locator('[data-loom-new-task-from]').fill('requester-bot');
    await page.locator('[data-loom-new-task-title]').fill('Publish mocked task');
    await page.locator('[data-loom-new-task-requirement]').fill('Use mocked endpoints only.');
    await page.locator('[data-loom-new-task-criteria]').fill('Preview and confirm are observable.');
    await page.locator('[data-loom-new-task-repo-uri]').fill('https://github.com/openagentinternet/open-agent-connect');
    await page.locator('[data-loom-new-task-bounty-amount]').fill('0.125');
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.getByRole('button', { name: 'Confirm publish' }).click();
    assert.deepEqual(server.actions.slice(-2).map((action) => [action.action, action.confirm]), [
      ['postTask', false],
      ['postTask', true],
    ]);
    assert.deepEqual(externalRequests, []);
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await server.close();
  }
});
