import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createMetabotProfileFromIdentity } = require('../../dist/core/bot/metabotProfileManager.js');

test('Browser context defaults to the active local Bot and can switch using identity by slug', async (t) => {
  const profileHome = await createProfileHome('browser-default-context');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);

  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Active Browser Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1activebrowser',
    mvcAddress: '18ActiveBrowser',
  });
  const other = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Other Browser Bot',
    homeDir: path.join(systemHomeDir, '.metabot', 'profiles', 'other-browser-bot'),
    globalMetaId: 'idq1otherbrowser',
    mvcAddress: '18OtherBrowser',
  });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: active.homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  });

  const defaultContext = await handlers.browser.getContext({});
  assert.equal(defaultContext.ok, true);
  assert.equal(defaultContext.data.defaultUsingIdentity.slug, active.slug);
  assert.equal(defaultContext.data.defaultUri, `metaid://${active.globalMetaId}`);

  const selectedContext = await handlers.browser.getContext({ from: other.slug });
  assert.equal(selectedContext.ok, true);
  assert.equal(selectedContext.data.defaultUsingIdentity.slug, other.slug);
  assert.equal(selectedContext.data.defaultUri, `metaid://${other.globalMetaId}`);
});
