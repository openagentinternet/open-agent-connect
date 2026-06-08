import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildBrowserPageDefinition } = require('../../dist/ui/pages/browser/app.js');
const template = readFileSync(new URL('../../src/browser/index.html', import.meta.url), 'utf8');

function cssBlock(selector) {
  const marker = `${selector} {`;
  const start = template.indexOf(marker);
  assert.notEqual(start, -1, `missing CSS block for ${selector}`);
  const bodyStart = start + marker.length;
  const end = template.indexOf('\n      }', bodyStart);
  assert.notEqual(end, -1, `missing CSS block end for ${selector}`);
  return template.slice(bodyStart, end);
}

function cssBlockAfter(marker, selector) {
  const markerIndex = template.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing marker ${marker}`);
  const selectorMarker = `${selector} {`;
  const start = template.indexOf(selectorMarker, markerIndex);
  assert.notEqual(start, -1, `missing CSS block for ${selector} after ${marker}`);
  const bodyStart = start + selectorMarker.length;
  const end = template.indexOf('\n        }', bodyStart);
  assert.notEqual(end, -1, `missing CSS block end for ${selector} after ${marker}`);
  return template.slice(bodyStart, end);
}

function assertDeclaration(block, property, value) {
  const pattern = new RegExp(`${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`);
  assert.match(block, pattern);
}

function assertNoDeclaration(block, property, value) {
  const pattern = new RegExp(`${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`);
  assert.doesNotMatch(block, pattern);
}

test('Browser page locks outer document while renderer viewport owns content scrolling', () => {
  const bodyBlock = cssBlock('body:has(.browser-shell)');
  assertDeclaration(bodyBlock, 'overflow', 'hidden');

  const pageShellBlock = cssBlock('.shell:has(.browser-shell)');
  assertDeclaration(pageShellBlock, 'height', '100vh');
  assertDeclaration(pageShellBlock, 'overflow', 'hidden');

  const contentBlock = cssBlock('.content:has(.browser-shell)');
  assertDeclaration(contentBlock, 'height', 'calc(100vh - 52px)');
  assertDeclaration(contentBlock, 'min-height', '0');
  assertDeclaration(contentBlock, 'overflow', 'hidden');

  const browserShellBlock = cssBlock('.browser-shell');
  assertDeclaration(browserShellBlock, 'height', '100%');
  assertDeclaration(browserShellBlock, 'min-height', '0');
  assertDeclaration(browserShellBlock, 'overflow', 'hidden');
  assertDeclaration(browserShellBlock, 'grid-template-rows', '34px 58px auto minmax(0, 1fr) 32px');

  const viewportBlock = cssBlock('.browser-viewport');
  assertDeclaration(viewportBlock, 'grid-row', '4');
  assertDeclaration(viewportBlock, 'min-height', '0');
  assertDeclaration(viewportBlock, 'overflow', 'auto');
});

test('Browser Owner Mode toolbar is Browser chrome outside the renderer viewport', () => {
  const browserContent = buildBrowserPageDefinition().contentHtml;
  const toolbarMatch = browserContent.match(/<div[^>]*data-browser-owner-toolbar[^>]*><\/div>/);
  assert.ok(toolbarMatch, 'missing Owner Mode toolbar');
  const toolbarIndex = toolbarMatch.index;
  const topbarCloseIndex = browserContent.indexOf('</header>');
  const viewportIndex = browserContent.indexOf('<main class="browser-viewport" data-browser-viewport>');

  assert.ok(topbarCloseIndex < toolbarIndex, 'Owner Mode toolbar must render after the topbar');
  assert.ok(toolbarIndex < viewportIndex, 'Owner Mode toolbar must render before the viewport');

  const viewportCloseIndex = browserContent.indexOf('</main>', viewportIndex);
  assert.ok(toolbarIndex < viewportIndex || toolbarIndex > viewportCloseIndex, 'Owner Mode toolbar must not be inside the viewport');

  const ownerToolbarBlock = cssBlock('.browser-owner-toolbar');
  assertDeclaration(ownerToolbarBlock, 'grid-row', '3');
  assertDeclaration(ownerToolbarBlock, 'grid-column', '1 / -1');
});

test('Browser Owner Mode toolbar keeps actions reachable on narrow widths', () => {
  const ownerToolbarBlock = cssBlock('.browser-owner-toolbar');
  assertDeclaration(ownerToolbarBlock, 'overflow-x', 'auto');
  assertDeclaration(ownerToolbarBlock, 'overflow-y', 'hidden');

  const ownerButtonBlock = cssBlock('.browser-owner-toolbar button');
  assertDeclaration(ownerButtonBlock, 'flex', '0 0 auto');
});

test('Responsive Browser drawer and inspector overlay the viewport row, not owner chrome', () => {
  const responsivePanelBlock = cssBlockAfter(
    '@media (max-width: 900px)',
    '.browser-drawer,\n        .browser-inspector,\n        .browser-shell.has-drawer .browser-inspector'
  );

  assertDeclaration(responsivePanelBlock, 'position', 'absolute');
  assertDeclaration(responsivePanelBlock, 'grid-row', '4');
  assertDeclaration(responsivePanelBlock, 'top', '0');
  assertDeclaration(responsivePanelBlock, 'bottom', '0');
  assertNoDeclaration(responsivePanelBlock, 'position', 'fixed');
  assertNoDeclaration(responsivePanelBlock, 'top', '120px');
});
