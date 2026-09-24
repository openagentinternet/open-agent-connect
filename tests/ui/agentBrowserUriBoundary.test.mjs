import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { renderPinInspectorHtml } = require('@openagentinternet/agent-browser-renderers');

// Pins whose markdown payloads mix prose with bare URIs must link exactly the
// URI: since Agent Browser Core 0.6.1, URI recognition stops at non-ASCII
// text instead of absorbing trailing CJK prose into the matched URI.
const pinId = `${'a'.repeat(64)}i1`;
const pinUri = `pin://${pinId}`;

function markdownEnvelope(markdown) {
  return {
    uri: pinUri,
    normalizedUri: pinUri,
    resourceType: 'pin',
    title: 'URI boundary fixture',
    owner: { kind: 'bot', globalMetaId: 'idq1fixturebot', name: 'Fixture Bot', verificationState: 'partial' },
    renderer: { type: 'pin-inspector', contentType: 'text/markdown', data: { payload: markdown } },
    actions: [],
    sections: [],
    status: { state: 'resolved', verificationState: 'partial', message: '' },
    source: { resolver: 'fixture-resolver', url: 'https://resolver.example' },
  };
}

function hrefs(html) {
  return [...html.matchAll(/href="([^"]*)"/gu)].map((match) => match[1]);
}

function assertExactHref(html, uri) {
  assert.ok(hrefs(html).includes(uri), `expected exact href ${uri}, got ${JSON.stringify(hrefs(html))}`);
  assert.ok(
    !hrefs(html).some((href) => href.startsWith(uri) && href !== uri),
    `a href extended past the URI boundary: ${JSON.stringify(hrefs(html))}`,
  );
}

test('pin inspector autolinks a MetaWeb URI followed by CJK prose without absorbing it', () => {
  const html = renderPinInspectorHtml(markdownEnvelope(`请查看 ${pinUri}，这是本次更新的详细说明。`));
  assertExactHref(html, pinUri);
  assert.ok(html.includes('这是本次更新的详细说明'), 'CJK prose must stay outside the link');
});

test('pin inspector autolinks an external URL followed by CJK prose at the exact boundary', () => {
  const html = renderPinInspectorHtml(markdownEnvelope('文档地址 https://example.com/doc 中文版随后发布。'));
  assertExactHref(html, 'https://example.com/doc');
  assert.ok(html.includes('中文版随后发布'), 'CJK prose must stay outside the link');
});

test('pin inspector keeps full-width punctuation out of recognized URIs', () => {
  const html = renderPinInspectorHtml(markdownEnvelope(`（详情见 ${pinUri}）`));
  assertExactHref(html, pinUri);
});
