import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

test('ProductPurchaseRequest type documents the daemon purchase request contract', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'src/core/products/productTypes.ts'), 'utf8');
  const match = source.match(/export interface ProductPurchaseRequest \{([\s\S]*?)\n\}/);
  assert.ok(match, 'ProductPurchaseRequest interface should exist');
  const body = match[1];

  assert.match(body, /spendCap\?:\s*ProductPrice/);
  assert.match(body, /policyMode\?:\s*'confirm_paid_only'\s*\|\s*'confirm_all'\s*\|\s*'auto_when_safe'\s*\|\s*'never'/);
  assert.doesNotMatch(body, /maxAmount/);
  assert.doesNotMatch(body, /\bcurrency\?:/);
});
