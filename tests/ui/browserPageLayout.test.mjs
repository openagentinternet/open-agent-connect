import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const template = readFileSync(new URL('../../src/ui/pages/browser/index.html', import.meta.url), 'utf8');

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
  assertDeclaration(browserShellBlock, 'grid-template-rows', '34px 58px minmax(0, 1fr) 32px');

  const viewportBlock = cssBlock('.browser-viewport');
  assertDeclaration(viewportBlock, 'min-height', '0');
  assertDeclaration(viewportBlock, 'overflow', 'auto');
});
