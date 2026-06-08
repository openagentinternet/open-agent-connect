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

function assertDeclaration(block, property, value) {
  const pattern = new RegExp(`${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`);
  assert.match(block, pattern);
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
  const toolbarMarkup = '<div class="browser-owner-toolbar" data-browser-owner-toolbar hidden></div>';
  const toolbarIndex = browserContent.indexOf(toolbarMarkup);
  const topbarCloseIndex = browserContent.indexOf('</header>');
  const viewportIndex = browserContent.indexOf('<main class="browser-viewport" data-browser-viewport>');

  assert.notEqual(toolbarIndex, -1, 'missing Owner Mode toolbar');
  assert.ok(topbarCloseIndex < toolbarIndex, 'Owner Mode toolbar must render after the topbar');
  assert.ok(toolbarIndex < viewportIndex, 'Owner Mode toolbar must render before the viewport');

  const viewportCloseIndex = browserContent.indexOf('</main>', viewportIndex);
  assert.ok(toolbarIndex < viewportIndex || toolbarIndex > viewportCloseIndex, 'Owner Mode toolbar must not be inside the viewport');

  const ownerToolbarBlock = cssBlock('.browser-owner-toolbar');
  assertDeclaration(ownerToolbarBlock, 'grid-row', '3');
  assertDeclaration(ownerToolbarBlock, 'grid-column', '1 / -1');
});
