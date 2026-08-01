import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildOrderPayload,
  createOrderMetadataLineRegex,
} = require('../../dist/core/orders/orderMessage.js');
const {
  buildDelegationOrderPayload,
} = require('../../dist/core/orders/delegationOrderMessage.js');
const {
  cleanServiceResultText,
} = require('../../dist/core/orders/serviceOrderProtocols.js');
const {
  normalizeGeneratedOrderProtocolText,
} = require('../../dist/core/a2a/orderProtocolTextGenerator.js');

function buildFullyPopulatedPayload() {
  return buildOrderPayload({
    displayText: 'generate a release note',
    rawRequest: 'generate a release note',
    price: '0.01',
    currency: 'SPACE',
    paymentTxid: 'b'.repeat(64),
    paymentCommitTxid: 'c'.repeat(64),
    paymentChain: 'mvc',
    settlementKind: 'mrc20',
    mrc20Ticker: 'SPACE',
    mrc20Id: 'mrc20-space-id',
    orderReference: 'skill-service-order-pin-1',
    serviceId: 'service-pin',
    skillName: 'release-note',
    outputType: 'text',
  });
}

// Everything after the raw_request block in a buildOrderPayload output is a
// metadata line; the block itself and the [ORDER] display line are not.
function extractMetadataLines(payload) {
  const lines = payload.split('\n');
  const blockEnd = lines.findIndex((line) => line === '</raw_request>');
  assert.notEqual(blockEnd, -1);
  return lines.slice(blockEnd + 1);
}

test('buildOrderPayload emits every canonical metadata line kind', () => {
  const metadataLines = extractMetadataLines(buildFullyPopulatedPayload());
  assert.deepEqual(metadataLines, [
    '支付金额 0.01 SPACE',
    'order id: skill-service-order-pin-1',
    `txid: ${'b'.repeat(64)}`,
    `commit txid: ${'c'.repeat(64)}`,
    'payment chain: mvc',
    'settlement kind: mrc20',
    'mrc20 ticker: SPACE',
    'mrc20 id: mrc20-space-id',
    'service id: service-pin',
    'skill name: release-note',
    'output type: text',
  ]);
});

test('the shared metadata-line grammar matches every metadata line kind buildOrderPayload emits', () => {
  const metadataLine = createOrderMetadataLineRegex();
  for (const line of extractMetadataLines(buildFullyPopulatedPayload())) {
    assert.ok(metadataLine.test(line), `canonical grammar should match: ${line}`);
  }
});

test('the shared grammar keeps consumer matching modes behind documented options', () => {
  const canonical = createOrderMetadataLineRegex();

  // `=` separators are only enabled for the order-text sanitizer.
  assert.equal(canonical.test('txid = abc123'), false);
  assert.equal(
    createOrderMetadataLineRegex({ allowEqualsSeparator: true }).test('txid = abc123'),
    true,
  );

  // Markdown bullets/bold are only enabled for the result-text cleaner.
  assert.equal(canonical.test('- **txid: abc123**'), false);
  assert.equal(
    createOrderMetadataLineRegex({ allowMarkdownPrefix: true }).test('- **txid: abc123**'),
    true,
  );

  // Bare label prefixes without a separator only match in optional-separator
  // mode (the generated-text rejector).
  assert.equal(canonical.test('skill name release-note'), false);
  assert.equal(
    createOrderMetadataLineRegex({ optionalSeparator: true }).test('skill name release-note'),
    true,
  );

  // Prose that merely starts with metadata-like words is not a metadata line.
  assert.equal(canonical.test('output type markdown keeps formatting for this release note'), false);
  assert.equal(canonical.test('支付金额 不能超过预算。'), false);
});

test('cleanServiceResultText strips every emitted metadata line kind from result text', () => {
  const metadataLines = extractMetadataLines(buildFullyPopulatedPayload());
  const cleaned = cleanServiceResultText(
    [...metadataLines, 'The generated release note is ready.'].join('\n'),
  );
  assert.equal(cleaned, 'The generated release note is ready.');
});

test('buildDelegationOrderPayload strips every emitted metadata line kind from task text', () => {
  const metadataLines = extractMetadataLines(buildFullyPopulatedPayload());
  const payload = buildDelegationOrderPayload({
    userTask: metadataLines.join('\n'),
    price: '0.01',
    currency: 'SPACE',
    paymentTxid: 'd'.repeat(64),
    serviceName: 'Release Service',
    servicePinId: 'service-pin',
    providerSkill: 'release-note',
    outputType: 'text',
  });

  // With every task line stripped as metadata, the payload falls back to the
  // service name instead of quoting the task metadata.
  const rawRequest = payload.match(/<raw_request>\n([\s\S]*?)\n<\/raw_request>/)?.[1];
  assert.equal(rawRequest, 'Release Service');
});

test('normalizeGeneratedOrderProtocolText rejects text quoting any emitted metadata line kind', () => {
  for (const line of extractMetadataLines(buildFullyPopulatedPayload())) {
    const generated = `First line of prose.\n${line}\nLast line of prose.`;
    assert.equal(
      normalizeGeneratedOrderProtocolText(generated),
      '',
      `generated text quoting "${line}" should be rejected`,
    );
  }
});
