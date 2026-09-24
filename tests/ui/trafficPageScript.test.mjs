import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildTrafficPageDefinition } = require('../../dist/ui/pages/traffic/app.js');
const { translate } = require('../../dist/ui/i18n.js');

function makeElement(tag = 'div') {
  const listeners = new Map();
  return {
    tagName: tag,
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    hidden: false,
    className: '',
    style: {},
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    listener: (eventName) => listeners.get(eventName),
    querySelectorAll: () => [],
  };
}

function makeModeButton(mode) {
  const listeners = new Map();
  return {
    attrs: { 'data-traffic-mode': mode },
    disabled: false,
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    listener: (eventName) => listeners.get(eventName),
  };
}

function createHarness(fetchImpl, options = {}) {
  const modeSeg = makeElement('div');
  const modeButtons = [makeModeButton('traffic'), makeModeButton('selfpay')];
  modeSeg.querySelectorAll = (selector) => (selector === '[data-traffic-mode]' ? modeButtons : []);
  const elements = {
    '[data-traffic-status]': makeElement(),
    '[data-traffic-refresh]': makeElement('button'),
    '[data-traffic-gate]': makeElement('article'),
    '[data-traffic-content]': makeElement('div'),
    '[data-traffic-mode-seg]': modeSeg,
    '[data-traffic-mode-hint]': makeElement(),
    '[data-traffic-mode-status]': makeElement(),
    '[data-traffic-balance-value]': makeElement('div'),
    '[data-traffic-meter]': makeElement('div'),
    '[data-traffic-meter-fill]': makeElement('div'),
    '[data-traffic-balance-stats]': makeElement('p'),
    '[data-traffic-balance-refresh]': makeElement('button'),
    '[data-traffic-balance-status]': makeElement(),
    '[data-traffic-grant]': makeElement('div'),
    '[data-traffic-grant-hint]': makeElement('span'),
    '[data-traffic-claim]': makeElement('button'),
    '[data-traffic-low]': makeElement('div'),
    '[data-traffic-redeem-card]': makeElement('article'),
    '[data-traffic-redeem-form]': makeElement('form'),
    '[data-traffic-redeem-input]': makeElement('input'),
    '[data-traffic-redeem-submit]': makeElement('button'),
    '[data-traffic-redeem-status]': makeElement(),
    '[data-traffic-usage-card]': makeElement('article'),
    '[data-traffic-summary]': makeElement('div'),
    '[data-traffic-usage-note]': makeElement(),
    '[data-traffic-usage-table]': makeElement('div'),
    '[data-traffic-ledger-card]': makeElement('article'),
    '[data-traffic-ledger-table]': makeElement('div'),
    '[data-traffic-ledger-more]': makeElement('div'),
    '[data-traffic-ledger-load-more]': makeElement('button'),
    '[data-traffic-ledger-status]': makeElement(),
    '[data-traffic-api-card]': makeElement('article'),
    '[data-traffic-api-current]': makeElement('p'),
    '[data-traffic-api-form]': makeElement('form'),
    '[data-traffic-api-input]': makeElement('input'),
    '[data-traffic-api-save]': makeElement('button'),
    '[data-traffic-api-reset]': makeElement('button'),
    '[data-traffic-api-status]': makeElement(),
  };
  const calls = [];
  const listeners = new Map();
  const context = {
    fetch: async (url, fetchOptions) => {
      calls.push({ url, options: fetchOptions });
      return fetchImpl(url, fetchOptions);
    },
    document: {
      querySelector: (selector) => elements[selector] ?? null,
    },
    window: {
      location: { search: options.search ?? '' },
      __oacLocalUiI18n: {
        t: (key, replacements = {}) => translate('en', key, replacements),
      },
      addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    },
  };
  return { elements, calls, context, listeners, modeButtons };
}

const jsonResponse = (payload) => ({
  json: async () => payload,
});

function createAccount(balanceBytes = 10_000_000) {
  return {
    accountId: 'acc-1',
    identityAddress: 'mvc-owner-address',
    balanceBytes,
    reservedBytes: 0,
    grantedBytesTotal: 10_000_000,
    spentBytesTotal: 0,
    status: 1,
  };
}

function statusPayload(overrides = {}) {
  return {
    ok: true,
    state: 'success',
    data: {
      mode: 'traffic',
      apiBase: '',
      account: createAccount(),
      freeGrant: { enabled: true, grantBytes: 10_000_000, claimed: false, claimable: true },
      featureUnavailable: false,
      identity: { name: 'Owner', globalMetaId: 'idq1owner', mvcAddress: 'mvc-owner-address' },
      ...overrides,
    },
  };
}

function usagePayload() {
  return {
    ok: true,
    state: 'success',
    data: {
      summary: { todayBytes: 1200, weekBytes: 50_000, monthBytes: 900_000 },
      daily: [
        { date: '2026-09-24', botAddress: 'mvc-owner-address', bytes: 1200, txCount: 3, botName: 'Alice' },
        { date: '2026-09-23', botAddress: 'mvc9f2ab17c44ef01', bytes: 48_800, txCount: 12 },
      ],
      source: 'service',
    },
  };
}

function ledgerPayload(entries, nextCursor = null) {
  return { ok: true, state: 'success', data: { entries, nextCursor } };
}

function ledgerEntry(overrides = {}) {
  return {
    id: 1,
    direction: 1,
    amountBytes: 10_000_000,
    balanceAfter: 10_000_000,
    sourceType: 'free_grant',
    sourceId: 'grant-1',
    remark: '',
    timestamp: Date.now() - 3600_000,
    ...overrides,
  };
}

function fullHarness(overrides = {}) {
  const state = {
    balanceBytes: 10_000_000,
    ledgerCalls: 0,
    ...overrides,
  };
  const calls = [];
  const h = createHarness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/traffic/status') return jsonResponse(statusPayload({ account: createAccount(state.balanceBytes) }));
    if (url === '/api/traffic/balance') {
      return jsonResponse({ ok: true, state: 'success', data: { account: createAccount(state.balanceBytes), featureUnavailable: false } });
    }
    if (url === '/api/traffic/usage') return jsonResponse(usagePayload());
    if (url === '/api/traffic/ledger') {
      state.ledgerCalls += 1;
      return jsonResponse(state.ledgerCalls === 1
        ? ledgerPayload([ledgerEntry()], '40')
        : ledgerPayload([ledgerEntry({ id: 2, direction: 2, amountBytes: 1200, sourceType: 'spend', timestamp: Date.now() - 600_000 })], null));
    }
    if (url === '/api/traffic/api-base') {
      return jsonResponse({ ok: true, state: 'success', data: { apiBase: '', effectiveApiBase: 'https://www.metaso.network/assist-open-api' } });
    }
    if (url === '/api/traffic/claim') {
      state.balanceBytes = 20_000_000;
      return jsonResponse({ ok: true, state: 'success', data: { grantId: '7', grantBytes: 10_000_000, balanceAfter: 20_000_000 } });
    }
    if (url === '/api/traffic/redeem') {
      state.balanceBytes += 5_000_000;
      return jsonResponse({ ok: true, state: 'success', data: { codeId: 3, trafficBytes: 5_000_000, balanceAfter: state.balanceBytes } });
    }
    if (url === '/api/traffic/mode') {
      const body = JSON.parse(options.body || '{}');
      if (body.mode === 'selfpay') return jsonResponse({ ok: true, state: 'success', data: { mode: 'selfpay' } });
      return jsonResponse({
        ok: true,
        state: 'success',
        data: {
          mode: 'traffic',
          bindSummary: { accountId: 'acc-1', results: [], boundCount: 2, conflictCount: 0, failedCount: 0 },
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  return { ...h, state, recordedCalls: calls };
}

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

test('traffic page loads the account, renders balance and usage, and offers the free grant', async () => {
  const h = fullHarness();
  vm.runInNewContext(buildTrafficPageDefinition().script, h.context);
  await flush();

  const { elements } = h;
  assert.equal(elements['[data-traffic-status]'].textContent, 'Traffic account loaded.');
  assert.equal(elements['[data-traffic-gate]'].hidden, true);
  assert.equal(elements['[data-traffic-content]'].hidden, false);
  // Balance with the metered share bar.
  assert.equal(elements['[data-traffic-balance-value]'].textContent, '10 MB');
  assert.equal(elements['[data-traffic-meter]'].hidden, false);
  assert.equal(elements['[data-traffic-meter-fill]'].style.width, '100%');
  assert.match(elements['[data-traffic-balance-stats]'].textContent, /Reserved 0 B · Total spent 0 B/);
  // Free grant claimable.
  assert.equal(elements['[data-traffic-grant]'].hidden, false);
  assert.equal(elements['[data-traffic-claim]'].textContent, 'Claim 10 MB free');
  // Mode segmented control shows Traffic active.
  assert.equal(h.modeButtons[0].attrs['data-active'], 'true');
  assert.equal(h.modeButtons[1].attrs['data-active'], 'false');
  assert.match(elements['[data-traffic-mode-hint]'].textContent, /shared traffic account/);
  // Usage summary + daily table with bot name resolution.
  assert.match(elements['[data-traffic-summary]'].innerHTML, /Today/);
  assert.match(elements['[data-traffic-summary]'].innerHTML, /1\.2 KB/);
  const usageTable = elements['[data-traffic-usage-table]'].innerHTML;
  assert.match(usageTable, /You · mvc-owne…ddress/);
  assert.match(usageTable, /mvc9f2ab…44ef01/);
  // Ledger renders the credit with sign and source label.
  const ledgerTable = elements['[data-traffic-ledger-table]'].innerHTML;
  assert.match(ledgerTable, /Free grant/);
  assert.match(ledgerTable, /\+10 MB/);
  // Load more is offered because the first page returns a cursor.
  assert.equal(elements['[data-traffic-ledger-more]'].hidden, false);
  // Assist endpoint displays the production default.
  assert.match(elements['[data-traffic-api-current]'].textContent, /production default/);
});

test('traffic page claims the free grant and shows the result envelope plainly', async () => {
  const h = fullHarness();
  vm.runInNewContext(buildTrafficPageDefinition().script, h.context);
  await flush();

  const { elements } = h;
  await elements['[data-traffic-claim]'].listener('click')();
  await flush();
  assert.ok(h.recordedCalls.some((call) => call.url === '/api/traffic/claim'));
  assert.equal(elements['[data-traffic-balance-status]'].textContent, 'Claimed 10 MB. New balance 20 MB.');
  assert.match(elements['[data-traffic-balance-status]'].className, /success/);
  assert.equal(elements['[data-traffic-balance-value]'].textContent, '20 MB');
});

test('traffic page redeems a code and shows the result envelope plainly', async () => {
  const h = fullHarness();
  vm.runInNewContext(buildTrafficPageDefinition().script, h.context);
  await flush();

  const { elements } = h;
  // Empty code is rejected client-side.
  const submit = elements['[data-traffic-redeem-form]'].listener('submit');
  await submit({ preventDefault() {} });
  assert.equal(elements['[data-traffic-redeem-status]'].textContent, 'Enter a redeem code first.');
  assert.equal(h.recordedCalls.filter((call) => call.url === '/api/traffic/redeem').length, 0);

  elements['[data-traffic-redeem-input]'].value = 'RECHARGE-123';
  await submit({ preventDefault() {} });
  await flush();
  const redeemCall = h.recordedCalls.find((call) => call.url === '/api/traffic/redeem');
  assert.ok(redeemCall, 'redeem endpoint should be called');
  assert.deepEqual(JSON.parse(redeemCall.options.body), { code: 'RECHARGE-123' });
  assert.equal(elements['[data-traffic-redeem-status]'].textContent, 'Code redeemed: +5 MB. New balance 15 MB.');
  assert.match(elements['[data-traffic-redeem-status]'].className, /success/);
  assert.equal(elements['[data-traffic-redeem-input]'].value, '');
});

test('traffic page switches billing mode with a visible confirm note and bind summary', async () => {
  const h = fullHarness();
  vm.runInNewContext(buildTrafficPageDefinition().script, h.context);
  await flush();

  const { elements } = h;
  // Switch to self-pay first.
  await h.modeButtons[1].listener('click')();
  await flush();
  const selfpayCall = h.recordedCalls.find((call) => call.url === '/api/traffic/mode');
  assert.deepEqual(JSON.parse(selfpayCall.options.body), { mode: 'selfpay' });
  assert.equal(elements['[data-traffic-mode-status]'].textContent, 'Billing mode updated.');
  assert.equal(h.modeButtons[1].attrs['data-active'], 'true');

  // Switch back to traffic: ensure-account + bind-all runs and reports the summary.
  await h.modeButtons[0].listener('click')();
  await flush();
  assert.match(elements['[data-traffic-mode-status]'].textContent, /Traffic mode on\. Bound 2 Bots to the account\./);
});

test('traffic page pages the ledger with the cursor', async () => {
  const h = fullHarness();
  vm.runInNewContext(buildTrafficPageDefinition().script, h.context);
  await flush();

  const { elements } = h;
  assert.match(elements['[data-traffic-ledger-table]'].innerHTML, /Free grant/);
  await elements['[data-traffic-ledger-load-more]'].listener('click')();
  await flush();
  const ledgerCalls = h.recordedCalls.filter((call) => call.url === '/api/traffic/ledger');
  assert.equal(ledgerCalls.length, 2); // initial page + one load-more page
  assert.deepEqual(JSON.parse(ledgerCalls[1].options.body), { cursor: '40', limit: 20 });
  const ledgerTable = elements['[data-traffic-ledger-table]'].innerHTML;
  assert.match(ledgerTable, /Free grant/);
  assert.match(ledgerTable, /-1\.2 KB/);
  assert.equal(elements['[data-traffic-ledger-more]'].hidden, true);
});

test('traffic page gates on the owner identity and surfaces backend error codes', async () => {
  // No identity: full-page gate, sections stay hidden.
  const gated = createHarness(async (url) => {
    if (url === '/api/traffic/status') {
      return jsonResponse(statusPayload({ identity: null, account: null, freeGrant: null }));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vm.runInNewContext(buildTrafficPageDefinition().script, gated.context);
  await flush();
  assert.equal(gated.elements['[data-traffic-gate]'].hidden, false);
  assert.equal(gated.elements['[data-traffic-content]'].hidden, true);
  assert.equal(gated.elements['[data-traffic-status]'].textContent, 'No owner identity yet.');

  // Identity present but the redeem code was already used: friendly envelope.
  const h = fullHarness();
  const original = h.context.fetch;
  h.context.fetch = async (url, options) => {
    if (url === '/api/traffic/redeem') {
      return jsonResponse({
        ok: false,
        state: 'failed',
        code: 'traffic_redeem_failed',
        message: 'redeem failed',
        data: { errorCode: 'CODE_USED' },
      });
    }
    return original(url, options);
  };
  vm.runInNewContext(buildTrafficPageDefinition().script, h.context);
  await flush();
  h.elements['[data-traffic-redeem-input]'].value = 'USED-CODE';
  await h.elements['[data-traffic-redeem-form]'].listener('submit')({ preventDefault() {} });
  await flush();
  assert.equal(h.elements['[data-traffic-redeem-status]'].textContent, 'This recharge code has already been used.');
  assert.match(h.elements['[data-traffic-redeem-status]'].className, /error/);
});
