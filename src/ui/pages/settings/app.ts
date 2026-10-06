import type { LocalUiPageDefinition } from '../types';
import { createI18nContext, renderLanguageOptions } from '../../i18n';
import type { LocalUiI18nContext } from '../../i18n';

// Settings page: three tabs mirroring the DSH PluginSettingsPanel —
// User (owner identity + onboarding progress), Traffic (the former
// /ui/traffic page, merged in-place), and General (language, the browser
// infrastructure base URLs formerly edited in the topbar modal, network,
// wallet, LLM, browser, discovery, diagnostics). The topbar gear navigates
// here; /ui/traffic stays alive as a permanent redirect to
// /ui/settings?tab=traffic.
export function buildSettingsPageDefinition(i18n: LocalUiI18nContext = createI18nContext()): LocalUiPageDefinition {
  return {
    page: 'settings',
    title: i18n.t('settings.title'),
    eyebrow: 'Provider Console',
    heading: i18n.t('settings.heading'),
    description: i18n.t('settings.description'),
    panels: [],
    contentHtml: `
      <section class="settings-shell" data-settings-shell>
        <div class="settings-toolbar">
          <div class="settings-heading-block">
            <span class="settings-kicker" data-i18n-key="settings.eyebrow">${i18n.t('settings.eyebrow')}</span>
            <h1 data-i18n-key="settings.heading">${i18n.t('settings.heading')}</h1>
            <p class="settings-heading-copy" data-i18n-key="settings.description">${i18n.t('settings.description')}</p>
            <p class="settings-status-line" data-settings-status data-i18n-key="settings.status.loading">${i18n.t('settings.status.loading')}</p>
          </div>
          <button class="btn settings-refresh" type="button" data-settings-refresh data-i18n-key="settings.refresh">${i18n.t('settings.refresh')}</button>
        </div>
        <div class="settings-tabs" role="tablist" data-settings-tabs>
          <button class="settings-tab" type="button" role="tab" data-settings-tab="user" data-active="false" aria-selected="false" data-i18n-key="settings.tab.user">${i18n.t('settings.tab.user')}</button>
          <button class="settings-tab" type="button" role="tab" data-settings-tab="traffic" data-active="false" aria-selected="false" data-i18n-key="settings.tab.traffic">${i18n.t('settings.tab.traffic')}</button>
          <button class="settings-tab" type="button" role="tab" data-settings-tab="general" data-active="false" aria-selected="false" data-i18n-key="settings.tab.general">${i18n.t('settings.tab.general')}</button>
        </div>
        <div class="settings-tabpanel" data-settings-tabpanel="user">
          <article class="settings-panel" data-user-section>
            <div>
              <h2 data-i18n-key="settings.user.title">${i18n.t('settings.user.title')}</h2>
              <p data-i18n-key="settings.user.body">${i18n.t('settings.user.body')}</p>
            </div>
            <div class="settings-user-live" data-user-live></div>
          </article>
          <article class="settings-panel" data-onboarding-section>
            <div>
              <h2 data-i18n-key="settings.onboarding.title">${i18n.t('settings.onboarding.title')}</h2>
              <p data-i18n-key="settings.onboarding.body">${i18n.t('settings.onboarding.body')}</p>
            </div>
            <div class="settings-user-live" data-onboarding-live></div>
          </article>
        </div>
        <div class="settings-tabpanel traffic-pane" data-settings-tabpanel="traffic" data-traffic-shell hidden>
          <div class="traffic-intro">
            <div>
              <span class="settings-kicker" data-i18n-key="traffic.eyebrow">${i18n.t('traffic.eyebrow')}</span>
              <h2 data-i18n-key="traffic.heading">${i18n.t('traffic.heading')}</h2>
              <p data-i18n-key="traffic.description">${i18n.t('traffic.description')}</p>
            </div>
            <div class="traffic-intro-actions">
              <span class="traffic-status-dot" aria-hidden="true"></span>
              <p data-traffic-status data-i18n-key="traffic.status.loading">${i18n.t('traffic.status.loading')}</p>
              <button class="btn btn-sm" type="button" data-traffic-refresh data-i18n-key="traffic.refresh">${i18n.t('traffic.refresh')}</button>
            </div>
          </div>
          <article class="card traffic-card" data-traffic-gate hidden>
            <h2 class="card-title" data-i18n-key="traffic.identityRequired.title">${i18n.t('traffic.identityRequired.title')}</h2>
            <p class="field-hint" data-i18n-key="traffic.identityRequired.body">${i18n.t('traffic.identityRequired.body')}</p>
            <p><a class="btn btn-sm" href="/ui/settings?tab=user" data-i18n-key="traffic.identityRequired.action">${i18n.t('traffic.identityRequired.action')}</a></p>
          </article>
          <div class="traffic-grid" data-traffic-content hidden>
            <article class="card traffic-card">
              <div class="traffic-card-heading">
                <div>
                  <span class="traffic-card-index">01</span>
                  <h2 class="card-title" data-i18n-key="traffic.modeTitle">${i18n.t('traffic.modeTitle')}</h2>
                </div>
                <span class="traffic-card-label" data-i18n-key="traffic.modeLabel">${i18n.t('traffic.modeLabel')}</span>
              </div>
              <div class="traffic-seg" role="group" data-traffic-mode-seg aria-label="Billing mode">
                <button class="traffic-seg-btn" type="button" data-traffic-mode="traffic" data-active="false" data-i18n-key="traffic.modeTraffic">${i18n.t('traffic.modeTraffic')}</button>
                <button class="traffic-seg-btn" type="button" data-traffic-mode="selfpay" data-active="false" data-i18n-key="traffic.modeSelfpay">${i18n.t('traffic.modeSelfpay')}</button>
              </div>
              <p class="field-hint" data-traffic-mode-hint></p>
              <p class="status-msg" data-traffic-mode-status role="status" aria-live="polite"></p>
            </article>
            <article class="card traffic-card">
              <div class="traffic-card-heading">
                <div>
                  <span class="traffic-card-index">02</span>
                  <h2 class="card-title" data-i18n-key="traffic.balanceTitle">${i18n.t('traffic.balanceTitle')}</h2>
                </div>
                <span class="traffic-card-label" data-i18n-key="traffic.balanceLabel">${i18n.t('traffic.balanceLabel')}</span>
              </div>
              <div class="traffic-balance-value" data-traffic-balance-value title="">—</div>
              <p class="traffic-balance-stats" data-traffic-balance-stats></p>
              <div class="schedule-row-actions">
                <button class="btn btn-sm" type="button" data-traffic-balance-refresh data-i18n-key="traffic.balanceRefresh">${i18n.t('traffic.balanceRefresh')}</button>
              </div>
              <div class="traffic-grant" data-traffic-grant hidden>
                <span data-traffic-grant-hint></span>
                <button class="btn btn-primary btn-sm" type="button" data-traffic-claim></button>
              </div>
              <p class="status-msg" data-traffic-balance-status role="status" aria-live="polite"></p>
              <div class="traffic-warning" data-traffic-low hidden>
                <span data-i18n-key="traffic.lowBalance">${i18n.t('traffic.lowBalance')}</span>
              </div>
            </article>
          </div>
          <article class="card traffic-card" data-traffic-redeem-card hidden>
            <div class="traffic-card-heading">
              <div>
                <span class="traffic-card-index">03</span>
                <h2 class="card-title" data-i18n-key="traffic.redeemTitle">${i18n.t('traffic.redeemTitle')}</h2>
              </div>
              <span class="traffic-card-label" data-i18n-key="traffic.redeemLabel">${i18n.t('traffic.redeemLabel')}</span>
            </div>
            <p class="field-hint" data-i18n-key="traffic.redeemBody">${i18n.t('traffic.redeemBody')}</p>
            <form class="traffic-redeem-row" data-traffic-redeem-form>
              <label class="traffic-code-input">
                <span aria-hidden="true">✦</span>
                <input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" data-traffic-redeem-input />
              </label>
              <button class="btn btn-primary btn-sm" type="submit" data-traffic-redeem-submit data-i18n-key="traffic.redeemSubmit">${i18n.t('traffic.redeemSubmit')}</button>
            </form>
            <p class="status-msg" data-traffic-redeem-status role="status" aria-live="polite"></p>
          </article>
          <article class="card traffic-card" data-traffic-usage-card hidden>
            <h2 class="card-title" data-i18n-key="traffic.usageTitle">${i18n.t('traffic.usageTitle')}</h2>
            <div class="traffic-summary-grid" data-traffic-summary></div>
            <p class="field-hint" data-traffic-usage-note></p>
            <div class="table-wrap" data-traffic-usage-table></div>
          </article>
          <article class="card traffic-card" data-traffic-ledger-card hidden>
            <h2 class="card-title" data-i18n-key="traffic.ledgerTitle">${i18n.t('traffic.ledgerTitle')}</h2>
            <div class="table-wrap" data-traffic-ledger-table></div>
            <div class="traffic-ledger-more" data-traffic-ledger-more hidden>
              <button class="btn btn-sm" type="button" data-traffic-ledger-load-more data-i18n-key="traffic.ledgerLoadMore">${i18n.t('traffic.ledgerLoadMore')}</button>
            </div>
            <p class="status-msg" data-traffic-ledger-status role="status" aria-live="polite"></p>
          </article>
          <article class="card traffic-card" data-traffic-api-card hidden>
            <h2 class="card-title" data-i18n-key="traffic.apiBaseTitle">${i18n.t('traffic.apiBaseTitle')}</h2>
            <p class="traffic-code" data-traffic-api-current></p>
            <p class="field-hint" data-i18n-key="traffic.apiBaseDesc">${i18n.t('traffic.apiBaseDesc')}</p>
            <form class="traffic-api-base-row" data-traffic-api-form>
              <input type="text" autocomplete="off" spellcheck="false" data-traffic-api-input />
              <button class="btn btn-primary btn-sm" type="submit" data-traffic-api-save data-i18n-key="traffic.apiBaseSave">${i18n.t('traffic.apiBaseSave')}</button>
              <button class="btn btn-sm" type="button" data-traffic-api-reset data-i18n-key="traffic.apiBaseReset">${i18n.t('traffic.apiBaseReset')}</button>
            </form>
            <p class="status-msg" data-traffic-api-status role="status" aria-live="polite"></p>
          </article>
        </div>
        <div class="settings-tabpanel" data-settings-tabpanel="general" hidden>
          <div class="settings-grid">
            <article class="settings-panel" data-language-section>
              <div>
                <h2 data-i18n-key="settings.language.title">${i18n.t('settings.language.title')}</h2>
                <p data-i18n-key="settings.language.body">${i18n.t('settings.language.body')}</p>
              </div>
              <label class="settings-language-control">
                <span data-i18n-key="language.label">${i18n.t('language.label')}</span>
                <select data-language-select>
                  ${renderLanguageOptions(i18n)}
                </select>
              </label>
            </article>
            <article class="settings-panel" data-infrastructure-section>
              <div>
                <h2 data-i18n-key="settings.infrastructure.title">${i18n.t('settings.infrastructure.title')}</h2>
                <p data-i18n-key="settings.infrastructure.body">${i18n.t('settings.infrastructure.body')}</p>
              </div>
              <form class="settings-infra-form" data-infra-form>
                <label class="settings-infra-field">
                  <span data-i18n-key="settings.infrastructure.metasoP2PBaseUrl">${i18n.t('settings.infrastructure.metasoP2PBaseUrl')}</span>
                  <input type="url" inputmode="url" autocomplete="url" data-settings-field="metasoP2PBaseUrl" />
                </label>
                <label class="settings-infra-field">
                  <span data-i18n-key="settings.infrastructure.metafileBaseUrl">${i18n.t('settings.infrastructure.metafileBaseUrl')}</span>
                  <input type="url" inputmode="url" autocomplete="url" data-settings-field="metafileContentBaseUrl" />
                </label>
                <label class="settings-infra-field">
                  <span data-i18n-key="settings.infrastructure.manApiBaseUrl">${i18n.t('settings.infrastructure.manApiBaseUrl')}</span>
                  <input type="url" inputmode="url" autocomplete="url" data-settings-field="manApiBaseUrl" />
                </label>
                <p class="settings-user-note">
                  <span data-i18n-key="settings.infrastructure.prefix">${i18n.t('settings.infrastructure.prefix')}</span>
                  <a href="https://github.com/orgs/openagentinternet/repositories" target="_blank" rel="noopener">GitHub</a>
                  <span data-i18n-key="settings.infrastructure.suffix">${i18n.t('settings.infrastructure.suffix')}</span>
                </p>
                <p class="status-msg" data-infra-status role="status" aria-live="polite" hidden></p>
                <div class="settings-user-actions">
                  <button class="btn btn-primary btn-sm" type="submit" data-infra-save data-i18n-key="settings.infrastructure.save">${i18n.t('settings.infrastructure.save')}</button>
                </div>
              </form>
            </article>
            <article class="settings-panel">
              <div>
                <h2 data-i18n-key="settings.network.title">${i18n.t('settings.network.title')}</h2>
                <p data-i18n-key="settings.network.body">${i18n.t('settings.network.body')}</p>
              </div>
              <code data-settings-config-status>/api/config</code>
            </article>
            <article class="settings-panel">
              <div>
                <h2 data-i18n-key="settings.wallet.title">${i18n.t('settings.wallet.title')}</h2>
                <p data-i18n-key="settings.wallet.body">${i18n.t('settings.wallet.body')}</p>
              </div>
              <a class="btn btn-sm" href="/ui/bot" data-i18n-key="action.openBotPage">${i18n.t('action.openBotPage')}</a>
            </article>
            <article class="settings-panel">
              <div>
                <h2 data-i18n-key="settings.llm.title">${i18n.t('settings.llm.title')}</h2>
                <p data-i18n-key="settings.llm.body">${i18n.t('settings.llm.body')}</p>
              </div>
              <code data-settings-llm-status>/api/llm/runtimes</code>
            </article>
            <article class="settings-panel">
              <div>
                <h2 data-i18n-key="settings.browser.title">${i18n.t('settings.browser.title')}</h2>
                <p data-i18n-key="settings.browser.body">${i18n.t('settings.browser.body')}</p>
              </div>
              <a class="btn btn-sm" href="/browser" data-i18n-key="action.openBrowser">${i18n.t('action.openBrowser')}</a>
            </article>
            <article class="settings-panel">
              <div>
                <h2 data-i18n-key="settings.discovery.title">${i18n.t('settings.discovery.title')}</h2>
                <p data-i18n-key="settings.discovery.body">${i18n.t('settings.discovery.body')}</p>
              </div>
              <code data-settings-network-status>/api/network/sources</code>
            </article>
            <article class="settings-panel">
              <div>
                <h2 data-i18n-key="settings.diagnostics.title">${i18n.t('settings.diagnostics.title')}</h2>
                <p data-i18n-key="settings.diagnostics.body">${i18n.t('settings.diagnostics.body')}</p>
              </div>
              <div class="settings-links">
                <a href="/ui/conversations">Trace</a>
                <a href="/ui/refund">Refund</a>
                <a href="/ui/hub">Hub</a>
              </div>
            </article>
          </div>
        </div>
      </section>
    `,
    script: `(() => {
  const status = document.querySelector('[data-settings-status]');
  const refresh = document.querySelector('[data-settings-refresh]');
  const configStatus = document.querySelector('[data-settings-config-status]');
  const llmStatus = document.querySelector('[data-settings-llm-status]');
  const networkStatus = document.querySelector('[data-settings-network-status]');
  const userLive = document.querySelector('[data-user-live]');
  const onboardingLive = document.querySelector('[data-onboarding-live]');
  const tabsBar = document.querySelector('[data-settings-tabs]');
  const tabpanels = {
    user: document.querySelector('[data-settings-tabpanel="user"]'),
    traffic: document.querySelector('[data-settings-tabpanel="traffic"]'),
    general: document.querySelector('[data-settings-tabpanel="general"]'),
  };
  const setText = (element, value) => { if (element) element.textContent = value; };
  let currentStatus = { key: 'settings.status.loading', replacements: null, text: '' };
  const renderStatus = () => {
    if (!status) return;
    if (currentStatus.key) {
      setText(status, window.__oacLocalUiI18n.t(currentStatus.key, currentStatus.replacements || undefined));
      return;
    }
    setText(status, currentStatus.text);
  };
  const setStatusKey = (key, replacements) => {
    currentStatus = { key, replacements: replacements || null, text: '' };
    renderStatus();
  };
  const setStatusText = (text) => {
    currentStatus = { key: '', replacements: null, text };
    renderStatus();
  };

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const formatText = (template, replacements) => Object.keys(replacements || {}).reduce(
    (text, name) => text.split('{' + name + '}').join(String(replacements[name])),
    String(template == null ? '' : template)
  );
  const uiText = (key, fallback, replacements) => {
    try {
      if (typeof window !== 'undefined' && window.__oacLocalUiI18n && typeof window.__oacLocalUiI18n.t === 'function') {
        const translated = window.__oacLocalUiI18n.t(key, replacements || {});
        if (translated && translated !== key) return translated;
      }
    } catch {}
    return formatText(fallback, replacements || {});
  };
  const maskMnemonic = (mnemonic) => String(mnemonic || '').split(' ').map(() => '•••').join(' ');

  const fetchJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    return response.json();
  };

  // ---- Tabs (User / Traffic / General), DSH PluginSettingsPanel parity.

  const TAB_NAMES = ['user', 'traffic', 'general'];
  const tabState = { active: 'user' };
  const renderTabs = () => {
    if (!tabsBar) return;
    tabsBar.querySelectorAll('[data-settings-tab]').forEach((button) => {
      const name = button.getAttribute('data-settings-tab');
      button.setAttribute('data-active', name === tabState.active ? 'true' : 'false');
      button.setAttribute('aria-selected', name === tabState.active ? 'true' : 'false');
    });
    TAB_NAMES.forEach((name) => {
      if (tabpanels[name]) tabpanels[name].hidden = name !== tabState.active;
    });
  };
  const setTab = (tab) => {
    if (TAB_NAMES.indexOf(tab) < 0 || tab === tabState.active) return;
    tabState.active = tab;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      history.replaceState(null, '', url.pathname + url.search);
    } catch {}
    renderTabs();
  };
  if (tabsBar) {
    tabsBar.querySelectorAll('[data-settings-tab]').forEach((button) => {
      button.addEventListener('click', () => setTab(button.getAttribute('data-settings-tab')));
    });
    try {
      const fromQuery = new URLSearchParams(window.location.search).get('tab');
      if (fromQuery && TAB_NAMES.indexOf(fromQuery) >= 0) tabState.active = fromQuery;
    } catch {}
  }
  renderTabs();

  // ---- Live owner-identity card (/api/user/*, the metabot user * surface).

  const userState = {
    loading: true,
    identity: null,
    busy: false,
    message: { kind: '', text: '' },
    // Fresh create/import mnemonic: shown once with a backup warning.
    newMnemonic: '',
    newMnemonicVisible: false,
    // Two-step guards, surf/settings toggle parity.
    revealArmed: false,
    deleteArmed: false,
    renameEditing: false,
    renameValue: '',
    // Reveal result: masked by default with an explicit show toggle.
    revealedMnemonic: '',
    revealedMnemonicVisible: false,
  };

  const userPost = async (url, body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      const error = new Error((payload && payload.message) || uiText('settings.user.actionFailed', 'Owner identity request failed.'));
      error.code = payload && payload.code ? String(payload.code) : '';
      throw error;
    }
    return payload.data || {};
  };

  const userFixHint = (code) => {
    if (code === 'owner_exists') {
      return uiText('settings.user.fix.ownerExists', 'An identity already lives on this machine; delete it first only if you really want to replace it.');
    }
    if (code === 'invalid_mnemonic') {
      return uiText('settings.user.fix.invalidMnemonic', 'Check the word count and spelling, then try again.');
    }
    if (code === 'owner_missing') {
      return uiText('settings.user.fix.ownerMissing', 'Create or import an identity first.');
    }
    if (code === 'invalid_name') {
      return uiText('settings.user.fix.invalidName', 'Enter a non-empty name.');
    }
    return '';
  };

  const userErrorText = (error) => {
    const message = (error && error.message) || uiText('settings.user.actionFailed', 'Owner identity request failed.');
    const hint = userFixHint(error && error.code);
    return hint ? message + ' ' + hint : message;
  };

  const identityRows = (identity) => {
    const created = identity.createdAt ? String(identity.createdAt).slice(0, 10) : '';
    return '<dl class="def-list settings-user-identity">'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('settings.user.identityName', 'Name')) + '</dt><dd>' + escapeHtml(identity.name || '') + '</dd></div>'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('settings.user.identityGlobalMetaId', 'GlobalMetaID')) + '</dt><dd class="mono">' + escapeHtml(identity.globalMetaId || '') + '</dd></div>'
      + '<div class="def-row"><dt>' + escapeHtml(uiText('settings.user.identityMvcAddress', 'MVC address')) + '</dt><dd class="mono">' + escapeHtml(identity.mvcAddress || '') + '</dd></div>'
      + (created ? '<div class="def-row"><dt>' + escapeHtml(uiText('settings.user.identityCreated', 'Created')) + '</dt><dd class="mono">' + escapeHtml(created) + '</dd></div>' : '')
      + '</dl>';
  };

  const mnemonicBanner = () => {
    if (!userState.newMnemonic) return '';
    const visible = userState.newMnemonicVisible === true;
    const words = visible ? userState.newMnemonic : maskMnemonic(userState.newMnemonic);
    return '<div class="settings-user-mnemonic">'
      + '<p class="status-msg warning">' + escapeHtml(uiText('settings.user.mnemonicWarning', 'Back up these words now — anyone holding them controls this identity, and they will not be shown again.')) + '</p>'
      + '<p class="mono settings-user-mnemonic-words">' + escapeHtml(words) + '</p>'
      + '<button class="btn btn-sm" type="button" data-user-mnemonic-toggle>' + escapeHtml(visible ? uiText('settings.user.hideMnemonic', 'Hide') : uiText('settings.user.showMnemonic', 'Show')) + '</button>'
      + '</div>';
  };

  const renderUser = () => {
    if (!userLive) return;
    if (userState.loading) {
      userLive.innerHTML = '<p class="field-hint">' + escapeHtml(uiText('settings.user.loading', 'Loading the owner identity...')) + '</p>';
      return;
    }
    const message = userState.message.text
      ? '<p class="status-msg' + (userState.message.kind ? ' ' + userState.message.kind : '') + '" data-user-message>' + escapeHtml(userState.message.text) + '</p>'
      : '';
    if (!userState.identity) {
      const busy = userState.busy === true;
      userLive.innerHTML = message
        + '<div class="settings-user-empty"><strong>' + escapeHtml(uiText('settings.user.emptyTitle', 'No owner identity on this machine yet')) + '</strong>'
        + '<p>' + escapeHtml(uiText('settings.user.emptyBody', 'Create a new identity, or import one from an existing mnemonic, so your Bots have an owner to belong to.')) + '</p></div>'
        + mnemonicBanner()
        + '<form class="settings-user-create" data-user-create-form>'
        + '<label class="field"><span>' + escapeHtml(uiText('settings.user.fieldName', 'Display name')) + '</span>'
        + '<input type="text" data-user-create-name placeholder="' + escapeHtml(uiText('settings.user.namePlaceholder', 'e.g. Alice')) + '" /></label>'
        + '<button class="btn btn-primary btn-sm" type="submit" data-user-create-submit' + (busy ? ' disabled' : '') + '>' + escapeHtml(busy ? uiText('settings.user.creating', 'Creating...') : uiText('settings.user.create', 'Create identity')) + '</button>'
        + '</form>'
        + '<form class="settings-user-import" data-user-import-form>'
        + '<label class="field"><span>' + escapeHtml(uiText('settings.user.fieldMnemonic', 'Mnemonic (12 or 24 words)')) + '</span>'
        + '<textarea rows="3" data-user-import-mnemonic></textarea></label>'
        + '<div class="settings-user-import-row">'
        + '<label class="field"><span>' + escapeHtml(uiText('settings.user.fieldPath', 'Derivation path (optional)')) + '</span>'
        + '<input type="text" data-user-import-path placeholder="m/44\\'/10001\\'/0\\'/0/0" /></label>'
        + '<button class="btn btn-sm" type="submit" data-user-import-submit' + (busy ? ' disabled' : '') + '>' + escapeHtml(busy ? uiText('settings.user.importing', 'Importing...') : uiText('settings.user.import', 'Import identity')) + '</button>'
        + '</div></form>';
      userLive.querySelector('[data-user-create-form]').addEventListener('submit', createIdentity);
      userLive.querySelector('[data-user-import-form]').addEventListener('submit', importIdentity);
      bindMnemonicToggle();
      return;
    }

    const identity = userState.identity;
    const busy = userState.busy === true;
    let renameBlock;
    if (userState.renameEditing) {
      renameBlock = '<form class="settings-user-rename" data-user-rename-form>'
        + '<input type="text" data-user-rename-input value="' + escapeHtml(userState.renameValue) + '"' + (busy ? ' disabled' : '') + ' />'
        + '<button class="btn btn-primary btn-sm" type="submit" data-user-rename-save' + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('settings.user.renameSave', 'Save')) + '</button>'
        + '<button class="btn btn-sm" type="button" data-user-rename-cancel' + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('settings.user.renameCancel', 'Cancel')) + '</button>'
        + '</form>';
    } else {
      renameBlock = '<button class="btn btn-sm" type="button" data-user-rename' + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('settings.user.rename', 'Rename')) + '</button>';
    }
    const revealBlock = userState.revealArmed
      ? '<button class="btn btn-danger btn-sm" type="button" data-user-reveal-confirm' + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('settings.user.revealConfirm', 'Click again to reveal — anyone with these words controls this identity')) + '</button>'
      : '<button class="btn btn-sm" type="button" data-user-reveal' + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('settings.user.reveal', 'Reveal mnemonic')) + '</button>';
    const deleteBlock = userState.deleteArmed
      ? '<button class="btn btn-danger btn-sm" type="button" data-user-delete-confirm' + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('settings.user.deleteConfirm', 'This removes the owner identity from this machine. Click again to confirm.')) + '</button>'
      : '<button class="btn btn-danger btn-sm" type="button" data-user-delete' + (busy ? ' disabled' : '') + '>' + escapeHtml(uiText('settings.user.delete', 'Delete identity')) + '</button>';
    const revealed = userState.revealedMnemonic
      ? '<div class="settings-user-mnemonic">'
        + '<p class="mono settings-user-mnemonic-words">' + escapeHtml(userState.revealedMnemonicVisible ? userState.revealedMnemonic : maskMnemonic(userState.revealedMnemonic)) + '</p>'
        + '<button class="btn btn-sm" type="button" data-user-revealed-toggle>' + escapeHtml(userState.revealedMnemonicVisible ? uiText('settings.user.hideMnemonic', 'Hide') : uiText('settings.user.showMnemonic', 'Show')) + '</button>'
        + '</div>'
      : '';

    userLive.innerHTML = message
      + identityRows(identity)
      + renameBlock
      + '<div class="settings-user-actions">'
      + revealBlock
      + deleteBlock
      + '</div>'
      + revealed
      + mnemonicBanner();

    const renameForm = userLive.querySelector('[data-user-rename-form]');
    if (userState.renameEditing) {
      renameForm.addEventListener('submit', renameIdentity);
      userLive.querySelector('[data-user-rename-cancel]').addEventListener('click', () => {
        userState.renameEditing = false;
        userState.renameValue = '';
        renderUser();
      });
    } else {
      userLive.querySelector('[data-user-rename]').addEventListener('click', () => {
        userState.renameEditing = true;
        userState.renameValue = String((userState.identity && userState.identity.name) || '');
        renderUser();
      });
    }
    if (userState.revealArmed) {
      userLive.querySelector('[data-user-reveal-confirm]').addEventListener('click', revealMnemonic);
    } else {
      userLive.querySelector('[data-user-reveal]').addEventListener('click', () => {
        userState.revealArmed = true;
        userState.deleteArmed = false;
        renderUser();
      });
    }
    if (userState.deleteArmed) {
      userLive.querySelector('[data-user-delete-confirm]').addEventListener('click', deleteIdentity);
    } else {
      userLive.querySelector('[data-user-delete]').addEventListener('click', () => {
        userState.deleteArmed = true;
        userState.revealArmed = false;
        renderUser();
      });
    }
    if (userState.revealedMnemonic) {
      userLive.querySelector('[data-user-revealed-toggle]').addEventListener('click', () => {
        userState.revealedMnemonicVisible = !userState.revealedMnemonicVisible;
        renderUser();
      });
    }
    bindMnemonicToggle();
  };

  const bindMnemonicToggle = () => {
    if (!userState.newMnemonic) return;
    userLive.querySelector('[data-user-mnemonic-toggle]').addEventListener('click', () => {
      userState.newMnemonicVisible = !userState.newMnemonicVisible;
      renderUser();
    });
  };

  const loadUser = async () => {
    userState.loading = true;
    renderUser();
    try {
      const payload = await fetchJson('/api/user/who');
      if (!payload || payload.ok !== true) {
        throw new Error((payload && payload.message) || uiText('settings.user.actionFailed', 'Owner identity request failed.'));
      }
      const data = payload.data || {};
      userState.identity = data.identity || null;
      userState.loading = false;
      renderUser();
    } catch (error) {
      userState.loading = false;
      userState.identity = null;
      userState.message = { kind: 'error', text: userErrorText(error) };
      renderUser();
    }
  };

  const createIdentity = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (userState.busy) return;
    const input = userLive.querySelector('[data-user-create-name]');
    userState.busy = true;
    userState.message = { kind: '', text: '' };
    renderUser();
    try {
      const data = await userPost('/api/user/create', {
        name: input ? String(input.value || '').trim() : '',
      });
      userState.busy = false;
      userState.identity = data.identity || null;
      userState.newMnemonic = typeof data.mnemonic === 'string' ? data.mnemonic : '';
      userState.newMnemonicVisible = false;
      userState.message = { kind: 'success', text: uiText('settings.user.created', 'Owner identity created. Back up the mnemonic now — it will not be shown again.') };
      renderUser();
      loadOnboarding().catch(() => undefined);
    } catch (error) {
      userState.busy = false;
      userState.message = { kind: 'error', text: userErrorText(error) };
      renderUser();
    }
  };

  const importIdentity = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (userState.busy) return;
    const mnemonicInput = userLive.querySelector('[data-user-import-mnemonic]');
    const pathInput = userLive.querySelector('[data-user-import-path]');
    const mnemonic = mnemonicInput ? String(mnemonicInput.value || '').trim() : '';
    if (!mnemonic) {
      userState.message = { kind: 'error', text: uiText('settings.user.mnemonicRequired', 'Enter the mnemonic words to import.') };
      renderUser();
      return;
    }
    userState.busy = true;
    userState.message = { kind: '', text: '' };
    renderUser();
    try {
      const data = await userPost('/api/user/import', {
        mnemonic,
        name: '',
        ...(pathInput && String(pathInput.value || '').trim()
          ? { path: String(pathInput.value || '').trim() }
          : {}),
      });
      userState.busy = false;
      userState.identity = data.identity || null;
      userState.newMnemonic = typeof data.mnemonic === 'string' ? data.mnemonic : '';
      userState.newMnemonicVisible = false;
      userState.message = { kind: 'success', text: uiText('settings.user.imported', 'Owner identity imported.') };
      renderUser();
      loadOnboarding().catch(() => undefined);
    } catch (error) {
      userState.busy = false;
      userState.message = { kind: 'error', text: userErrorText(error) };
      renderUser();
    }
  };

  const renameIdentity = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (userState.busy) return;
    const input = userLive.querySelector('[data-user-rename-input]');
    const name = input ? String(input.value || '').trim() : '';
    if (!name) {
      userState.message = { kind: 'error', text: uiText('settings.user.fix.invalidName', 'Enter a non-empty name.') };
      renderUser();
      return;
    }
    userState.busy = true;
    renderUser();
    try {
      const data = await userPost('/api/user/rename', { name });
      userState.busy = false;
      userState.identity = data.identity || userState.identity;
      userState.renameEditing = false;
      userState.renameValue = '';
      userState.message = { kind: 'success', text: uiText('settings.user.renamed', 'Owner identity renamed.') };
      renderUser();
    } catch (error) {
      userState.busy = false;
      userState.message = { kind: 'error', text: userErrorText(error) };
      renderUser();
    }
  };

  const revealMnemonic = async () => {
    if (userState.busy) return;
    userState.busy = true;
    renderUser();
    try {
      const data = await userPost('/api/user/reveal', {});
      userState.busy = false;
      userState.revealArmed = false;
      userState.revealedMnemonic = typeof data.mnemonic === 'string' ? data.mnemonic : '';
      userState.revealedMnemonicVisible = false;
      renderUser();
    } catch (error) {
      userState.busy = false;
      userState.revealArmed = false;
      userState.message = { kind: 'error', text: userErrorText(error) };
      renderUser();
    }
  };

  const deleteIdentity = async () => {
    if (userState.busy) return;
    userState.busy = true;
    renderUser();
    try {
      await userPost('/api/user/delete', {});
      userState.busy = false;
      userState.identity = null;
      userState.deleteArmed = false;
      userState.revealArmed = false;
      userState.revealedMnemonic = '';
      userState.newMnemonic = '';
      userState.renameEditing = false;
      userState.message = { kind: 'success', text: uiText('settings.user.deleted', 'Owner identity deleted from this machine.') };
      renderUser();
      loadOnboarding().catch(() => undefined);
    } catch (error) {
      userState.busy = false;
      userState.deleteArmed = false;
      userState.message = { kind: 'error', text: userErrorText(error) };
      renderUser();
    }
  };

  // ---- Onboarding progress card (user account + traffic account + grant).

  const formatOnboardingTraffic = (bytes) => {
    const value = Number(bytes) || 0;
    const abs = Math.abs(value);
    const scaled = (v, roundAt) => (roundAt !== undefined && Math.abs(v) >= roundAt
      ? String(Math.round(v))
      : (Number.isInteger(v) ? String(v) : v.toFixed(1)));
    if (abs < 1000) return String(value) + ' ' + uiText('traffic.unit.bytes', 'B');
    if (abs < 1000000) return scaled(value / 1000) + ' ' + uiText('traffic.unit.kb', 'KB');
    return scaled(value / 1000000, 100) + ' ' + uiText('traffic.unit.mb', 'MB');
  };

  const onboardingState = {
    loading: true,
    snapshot: null,
    busy: false,
    message: { kind: '', text: '' },
  };

  const renderOnboarding = () => {
    if (!onboardingLive) return;
    if (onboardingState.loading) {
      onboardingLive.innerHTML = '<p class="field-hint">' + escapeHtml(uiText('settings.onboarding.loading', 'Loading onboarding progress...')) + '</p>';
      return;
    }
    const snapshot = onboardingState.snapshot;
    const message = onboardingState.message.text
      ? '<p class="status-msg' + (onboardingState.message.kind ? ' ' + onboardingState.message.kind : '') + '">' + escapeHtml(onboardingState.message.text) + '</p>'
      : '';
    if (!snapshot) {
      onboardingLive.innerHTML = message
        + '<p class="settings-user-note">' + escapeHtml(uiText('settings.onboarding.status.pending', 'Preparing your account and free traffic...')) + '</p>'
        + '<button class="btn btn-sm" type="button" data-onboarding-run>' + escapeHtml(uiText('settings.onboarding.retry', 'Run now')) + '</button>';
      bindOnboardingRun();
      return;
    }
    const state = snapshot.onboarding || null;
    const status = state ? state.status : 'pending';
    const statusLine = status === 'opted_out'
      ? '<p class="settings-user-note">' + escapeHtml(uiText('settings.onboarding.status.optedOut', 'Automatic account provisioning is turned off on this machine.')) + '</p>'
      : status === 'ready'
        ? '<p class="status-msg success">' + escapeHtml(uiText('settings.onboarding.status.ready', 'Account ready — traffic billing is active.')) + '</p>'
        : '<p class="settings-user-note">' + escapeHtml(uiText('settings.onboarding.status.pending', 'Preparing your account and free traffic...')) + '</p>';
    const grantBytes = state && Number(state.freeGrantBytes) > 0 ? Number(state.freeGrantBytes) : 0;
    const grantLine = grantBytes > 0
      ? '<div class="def-row"><dt>' + escapeHtml(uiText('settings.onboarding.granted', 'Free traffic granted')) + '</dt><dd class="mono">' + escapeHtml(formatOnboardingTraffic(grantBytes)) + '</dd></div>'
      : '';
    const steps = state ? state.steps : null;
    const lastError = state && state.lastError
      ? '<p class="status-msg warning">' + escapeHtml(String(state.lastError)) + '</p>'
      : '';
    const retryBlock = status === 'pending'
      ? '<button class="btn btn-sm" type="button" data-onboarding-run' + (onboardingState.busy ? ' disabled' : '') + '>'
        + escapeHtml(onboardingState.busy ? uiText('settings.onboarding.retrying', 'Running...') : uiText('settings.onboarding.retry', 'Run now')) + '</button>'
      : '';
    onboardingLive.innerHTML = message
      + statusLine
      + '<dl class="def-list settings-user-identity">'
      + (state ? '<div class="def-row"><dt>' + escapeHtml(uiText('settings.onboarding.attempts', 'Attempts')) + '</dt><dd class="mono">' + escapeHtml(String(Number(state.attempts) || 0)) + '</dd></div>' : '')
      + grantLine
      + (steps ? '<div class="def-row"><dt>' + escapeHtml(uiText('settings.onboarding.steps', 'Steps')) + '</dt><dd class="mono">'
        + escapeHtml(['identity', 'trafficAccount', 'freeGrant', 'subsidy', 'namePin']
          .map((step) => step + ': ' + String(steps[step] || 'pending'))
          .join(' · ')) + '</dd></div>' : '')
      + '</dl>'
      + lastError
      + retryBlock;
    bindOnboardingRun();
  };

  const bindOnboardingRun = () => {
    if (!onboardingLive) return;
    const button = onboardingLive.querySelector('[data-onboarding-run]');
    if (button) {
      button.addEventListener('click', () => { runOnboarding().catch(() => undefined); });
    }
  };

  const loadOnboarding = async () => {
    onboardingState.loading = true;
    renderOnboarding();
    try {
      const payload = await fetchJson('/api/user/onboarding');
      if (!payload || payload.ok !== true) {
        throw new Error((payload && payload.message) || 'Onboarding request failed.');
      }
      onboardingState.snapshot = payload.data || null;
      onboardingState.loading = false;
      renderOnboarding();
    } catch {
      onboardingState.loading = false;
      onboardingState.snapshot = null;
      renderOnboarding();
    }
  };

  const runOnboarding = async () => {
    if (onboardingState.busy) return;
    onboardingState.busy = true;
    onboardingState.message = { kind: '', text: '' };
    renderOnboarding();
    try {
      const data = await userPost('/api/user/onboarding', {});
      onboardingState.busy = false;
      onboardingState.snapshot = { onboarding: data.onboarding || null, identityPresent: true };
      onboardingState.message = { kind: 'success', text: uiText('settings.onboarding.ran', 'Onboarding step advanced.') };
      renderOnboarding();
    } catch (error) {
      onboardingState.busy = false;
      onboardingState.message = { kind: 'error', text: (error && error.message) || uiText('settings.onboarding.retryFailed', 'Onboarding run failed.') };
      renderOnboarding();
    }
  };

  // ---- General tab: browser infrastructure base URLs (topbar modal port).

  const infraForm = document.querySelector('[data-infra-form]');
  const infraStatus = document.querySelector('[data-infra-status]');
  const infraSave = document.querySelector('[data-infra-save]');
  const INFRA_FIELD_KEYS = ['metasoP2PBaseUrl', 'metafileContentBaseUrl', 'manApiBaseUrl'];
  const infraState = { busy: false, note: { kind: '', text: '' } };

  const infraInput = (key) => (infraForm ? infraForm.querySelector('[data-settings-field="' + key + '"]') : null);

  const renderInfrastructure = () => {
    if (infraStatus) {
      infraStatus.textContent = infraState.note.text;
      infraStatus.className = 'status-msg' + (infraState.note.kind ? ' ' + infraState.note.kind : '');
      infraStatus.hidden = !infraState.note.text;
    }
    if (infraSave) infraSave.disabled = infraState.busy;
    INFRA_FIELD_KEYS.forEach((key) => {
      const input = infraInput(key);
      if (input) input.disabled = infraState.busy;
    });
  };

  const populateInfrastructure = (settings) => {
    const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const browser = record(settings.browser);
    const effective = record(settings.effectiveBrowser);
    const defaults = record(settings.defaults);
    INFRA_FIELD_KEYS.forEach((key) => {
      const input = infraInput(key);
      if (!input) return;
      input.value = Object.prototype.hasOwnProperty.call(browser, key)
        ? String(browser[key] || '').trim()
        : String(effective[key] || '').trim();
      input.placeholder = String(defaults[key] || '').trim();
    });
  };

  const loadInfrastructure = async () => {
    try {
      const payload = await fetchJson('/api/browser/settings');
      if (!payload || payload.ok === false) {
        throw new Error((payload && payload.message) || uiText('settings.infrastructure.unknownError', 'Unknown error'));
      }
      populateInfrastructure(payload.data || payload);
      infraState.note = { kind: '', text: '' };
    } catch (error) {
      infraState.note = {
        kind: 'error',
        text: uiText('settings.infrastructure.loadFailed', 'Failed to load Base URLs: {message}', {
          message: (error && error.message) || uiText('settings.infrastructure.unknownError', 'Unknown error'),
        }),
      };
    }
    renderInfrastructure();
  };

  const saveInfrastructure = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (infraState.busy) return;
    infraState.busy = true;
    infraState.note = { kind: '', text: uiText('settings.infrastructure.saving', 'Saving Base URLs...') };
    renderInfrastructure();
    try {
      const browser = {};
      INFRA_FIELD_KEYS.forEach((key) => {
        const input = infraInput(key);
        browser[key] = input ? input.value : '';
      });
      const response = await fetch('/api/browser/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ browser }),
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error((payload && payload.message) || ('HTTP ' + response.status));
      }
      populateInfrastructure(payload.data || payload);
      infraState.busy = false;
      infraState.note = { kind: 'success', text: uiText('settings.infrastructure.saved', 'Base URLs saved.') };
    } catch (error) {
      infraState.busy = false;
      infraState.note = {
        kind: 'error',
        text: uiText('settings.infrastructure.saveFailed', 'Failed to save Base URLs: {message}', {
          message: (error && error.message) || uiText('settings.infrastructure.unknownError', 'Unknown error'),
        }),
      };
    }
    renderInfrastructure();
  };

  if (infraForm) infraForm.addEventListener('submit', saveInfrastructure);

  const load = async () => {
    setStatusKey('settings.status.loading');
    try {
      const [config, runtimes, networkSources] = await Promise.all([
        fetchJson('/api/config'),
        fetchJson('/api/llm/runtimes'),
        fetchJson('/api/network/sources'),
      ]);
      setText(configStatus, config && config.ok !== false ? window.__oacLocalUiI18n.t('settings.status.configLoaded') : window.__oacLocalUiI18n.t('settings.status.configUnavailable'));
      const runtimeCount = Array.isArray(runtimes && runtimes.data && runtimes.data.runtimes) ? runtimes.data.runtimes.length : 0;
      setText(llmStatus, window.__oacLocalUiI18n.t(runtimeCount === 1 ? 'settings.status.runtimeOne' : 'settings.status.runtimeMany', { count: runtimeCount }));
      const sourceCount = Array.isArray(networkSources && networkSources.data && networkSources.data.sources) ? networkSources.data.sources.length : 0;
      setText(networkStatus, window.__oacLocalUiI18n.t(sourceCount === 1 ? 'settings.status.sourceOne' : 'settings.status.sourceMany', { count: sourceCount }));
      setStatusKey('settings.status.loaded');
    } catch (error) {
      if (error && error.message) {
        setStatusText(error.message);
      } else {
        setStatusKey('settings.status.failed');
      }
    }
    loadUser().catch(() => undefined);
    loadOnboarding().catch(() => undefined);
    loadInfrastructure().catch(() => undefined);
  };

  if (refresh) refresh.addEventListener('click', load);
  window.addEventListener('oac:i18n-changed', () => {
    renderStatus();
    renderUser();
    renderOnboarding();
    renderInfrastructure();
  });
  load();
})();
(() => {
  const elements = {
    status: document.querySelector('[data-traffic-status]'),
    refresh: document.querySelector('[data-traffic-refresh]'),
    gate: document.querySelector('[data-traffic-gate]'),
    content: document.querySelector('[data-traffic-content]'),
    modeSeg: document.querySelector('[data-traffic-mode-seg]'),
    modeHint: document.querySelector('[data-traffic-mode-hint]'),
    modeStatus: document.querySelector('[data-traffic-mode-status]'),
    balanceValue: document.querySelector('[data-traffic-balance-value]'),
    balanceStats: document.querySelector('[data-traffic-balance-stats]'),
    balanceRefresh: document.querySelector('[data-traffic-balance-refresh]'),
    balanceStatus: document.querySelector('[data-traffic-balance-status]'),
    grant: document.querySelector('[data-traffic-grant]'),
    grantHint: document.querySelector('[data-traffic-grant-hint]'),
    claim: document.querySelector('[data-traffic-claim]'),
    low: document.querySelector('[data-traffic-low]'),
    redeemCard: document.querySelector('[data-traffic-redeem-card]'),
    redeemForm: document.querySelector('[data-traffic-redeem-form]'),
    redeemInput: document.querySelector('[data-traffic-redeem-input]'),
    redeemSubmit: document.querySelector('[data-traffic-redeem-submit]'),
    redeemStatus: document.querySelector('[data-traffic-redeem-status]'),
    usageCard: document.querySelector('[data-traffic-usage-card]'),
    usageSummary: document.querySelector('[data-traffic-summary]'),
    usageNote: document.querySelector('[data-traffic-usage-note]'),
    usageTable: document.querySelector('[data-traffic-usage-table]'),
    ledgerCard: document.querySelector('[data-traffic-ledger-card]'),
    ledgerTable: document.querySelector('[data-traffic-ledger-table]'),
    ledgerMore: document.querySelector('[data-traffic-ledger-more]'),
    ledgerLoadMore: document.querySelector('[data-traffic-ledger-load-more]'),
    ledgerStatus: document.querySelector('[data-traffic-ledger-status]'),
    apiCard: document.querySelector('[data-traffic-api-card]'),
    apiCurrent: document.querySelector('[data-traffic-api-current]'),
    apiForm: document.querySelector('[data-traffic-api-form]'),
    apiInput: document.querySelector('[data-traffic-api-input]'),
    apiSave: document.querySelector('[data-traffic-api-save]'),
    apiReset: document.querySelector('[data-traffic-api-reset]'),
    apiStatus: document.querySelector('[data-traffic-api-status]'),
  };

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const formatText = (template, replacements) => Object.keys(replacements || {}).reduce(
    (text, name) => text.split('{' + name + '}').join(String(replacements[name])),
    String(template == null ? '' : template)
  );
  const uiText = (key, fallback, replacements) => {
    try {
      if (typeof window !== 'undefined' && window.__oacLocalUiI18n && typeof window.__oacLocalUiI18n.t === 'function') {
        const translated = window.__oacLocalUiI18n.t(key, replacements || {});
        if (translated && translated !== key) return translated;
      }
    } catch {}
    return formatText(fallback, replacements || {});
  };
  const parseTime = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : 0;
    const ms = Date.parse(String(value || ''));
    return Number.isFinite(ms) ? ms : 0;
  };
  const formatDateTime = (value) => {
    const ms = parseTime(value);
    if (!ms) return '';
    const date = new Date(ms);
    const pad = (part) => String(part).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  };

  const state = {
    loading: false,
    identityChecked: false,
    hasIdentity: false,
    featureUnavailable: false,
    mode: 'traffic',
    modeBusy: false,
    identityAddress: '',
    account: null,
    freeGrant: null,
    balanceBusy: false,
    claimBusy: false,
    redeemBusy: false,
    redeemNote: { kind: '', text: '' },
    summary: null,
    daily: [],
    usageNote: '',
    ledger: [],
    ledgerCursor: '',
    ledgerDone: true,
    ledgerBusy: false,
    ledgerNote: '',
    ledgerNoteKind: '',
    apiBase: '',
    apiBaseBusy: false,
  };
  const modeNote = { kind: '', text: '' };
  const balanceNote = { kind: '', text: '' };
  const apiBaseNote = { kind: '', text: '' };
  const statusState = { key: 'traffic.status.loading', replacements: null, text: '' };

  const postJson = async (url, body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      const error = new Error((payload && payload.message) || uiText('traffic.requestFailed', 'Request failed.'));
      if (payload && typeof payload.data === 'object' && payload.data && typeof payload.data.errorCode === 'string') {
        error.errorCode = payload.data.errorCode;
      }
      throw error;
    }
    return payload.data || {};
  };

  const renderStatusLine = () => {
    if (!elements.status) return;
    if (statusState.key) {
      elements.status.textContent = uiText(statusState.key, statusState.key, statusState.replacements || {});
      return;
    }
    elements.status.textContent = statusState.text;
  };
  const setStatusKey = (key, replacements) => {
    statusState.key = key;
    statusState.replacements = replacements || null;
    statusState.text = '';
    renderStatusLine();
  };
  const setStatusText = (text) => {
    statusState.key = '';
    statusState.replacements = null;
    statusState.text = String(text || '');
    renderStatusLine();
  };

  const formatScaled = (value, roundAt) => {
    if (roundAt !== undefined && Math.abs(value) >= roundAt) return String(Math.round(value));
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(1);
  };
  const splitAmount = (bytes) => {
    const value = Number(bytes) || 0;
    const abs = Math.abs(value);
    if (abs < 1000) return { amount: String(value), unit: 'bytes' };
    if (abs < 1000000) return { amount: formatScaled(value / 1000), unit: 'kb' };
    return { amount: formatScaled(value / 1000000, 100), unit: 'mb' };
  };
  const formatTraffic = (bytes) => {
    const parts = splitAmount(bytes);
    return parts.amount + ' ' + uiText('traffic.unit.' + parts.unit, parts.unit.toUpperCase());
  };
  const formatBytesExact = (bytes) => (Number(bytes) || 0).toLocaleString() + ' ' + uiText('traffic.unit.bytes', 'B');
  const shortAddress = (value) => {
    const text = String(value || '');
    return text.length > 16 ? text.slice(0, 8) + '…' + text.slice(-6) : text;
  };

  const renderMode = () => {
    if (!elements.modeSeg) return;
    elements.modeSeg.querySelectorAll('[data-traffic-mode]').forEach((button) => {
      button.setAttribute('data-active', button.getAttribute('data-traffic-mode') === state.mode ? 'true' : 'false');
      button.disabled = state.modeBusy;
    });
    if (elements.modeHint) {
      elements.modeHint.textContent = state.mode === 'selfpay'
        ? uiText('traffic.modeSelfpayHint', 'Each Bot pays pin fees from its own wallet.')
        : uiText('traffic.modeTrafficHint', 'Pin fees are billed to the shared traffic account and every Bot writes through it.');
    }
    if (elements.modeStatus) {
      elements.modeStatus.textContent = modeNote.text;
      elements.modeStatus.className = 'status-msg' + (modeNote.kind ? ' ' + modeNote.kind : '');
    }
  };

  const renderBalance = () => {
    if (!elements.balanceValue) return;
    const account = state.account;
    if (account) {
      elements.balanceValue.textContent = formatTraffic(account.balanceBytes);
      elements.balanceValue.setAttribute('title', formatBytesExact(account.balanceBytes));
      if (elements.balanceStats) {
        elements.balanceStats.textContent = uiText('traffic.balanceStats', 'Reserved {reserved} · Total spent {spent}', {
          reserved: formatTraffic(account.reservedBytes),
          spent: formatTraffic(account.spentBytesTotal),
        });
      }
      if (elements.low) elements.low.hidden = (Number(account.balanceBytes) || 0) >= 5000000;
    } else {
      elements.balanceValue.textContent = '—';
      elements.balanceValue.setAttribute('title', '');
      if (elements.balanceStats) elements.balanceStats.textContent = '';
      if (elements.low) elements.low.hidden = true;
    }
    if (elements.balanceRefresh) elements.balanceRefresh.disabled = state.balanceBusy;
    if (elements.balanceStatus) {
      elements.balanceStatus.textContent = balanceNote.text;
      elements.balanceStatus.className = 'status-msg' + (balanceNote.kind ? ' ' + balanceNote.kind : '');
    }
    const campaign = state.freeGrant;
    const canClaim = state.hasIdentity && !state.featureUnavailable
      && (campaign ? !campaign.claimed && (campaign.claimable === true || campaign.enabled === true)
        : state.account !== null);
    if (elements.grant) {
      elements.grant.hidden = !canClaim;
      if (canClaim) {
        const grantBytes = Number(campaign && campaign.grantBytes) || 10000000;
        if (elements.grantHint) {
          elements.grantHint.textContent = uiText('traffic.grantHint', 'A one-time free grant is available for this account.');
        }
        if (elements.claim) {
          elements.claim.textContent = state.claimBusy
            ? uiText('traffic.grantClaiming', 'Claiming...')
            : uiText('traffic.grantClaim', 'Claim {amount} free', { amount: formatTraffic(grantBytes) });
          elements.claim.disabled = state.claimBusy;
        }
      }
    }
  };

  const botLabel = (address, hint) => {
    const normalized = String(address || '').trim().toLowerCase();
    if (!normalized) return '—';
    if (state.identityAddress && normalized === String(state.identityAddress).toLowerCase()) {
      return uiText('traffic.youIdentity', 'You') + ' · ' + shortAddress(address);
    }
    const name = String(hint || '').trim();
    return name ? name + ' · ' + shortAddress(address) : shortAddress(address);
  };

  const renderUsage = () => {
    if (!elements.usageSummary) return;
    const summary = state.summary;
    if (summary) {
      elements.usageSummary.hidden = false;
      const stats = [
        { label: uiText('traffic.summaryToday', 'Today'), value: formatTraffic(summary.todayBytes) },
        { label: uiText('traffic.summaryWeek', 'This week'), value: formatTraffic(summary.weekBytes) },
        { label: uiText('traffic.summaryMonth', 'This month'), value: formatTraffic(summary.monthBytes) },
      ];
      elements.usageSummary.innerHTML = stats.map((stat) => (
        '<div class="traffic-stat"><div class="traffic-stat-value">' + escapeHtml(stat.value)
        + '</div><div class="traffic-stat-label">' + escapeHtml(stat.label) + '</div></div>'
      )).join('');
    } else {
      elements.usageSummary.hidden = true;
      elements.usageSummary.innerHTML = '';
    }
    if (elements.usageNote) elements.usageNote.textContent = state.usageNote;
    if (!elements.usageTable) return;
    if (!state.daily.length) {
      elements.usageTable.innerHTML = state.usageNote
        ? ''
        : '<div class="table-empty"><strong>' + escapeHtml(uiText('traffic.usageEmpty', 'No usage recorded yet.')) + '</strong></div>';
      return;
    }
    const head = '<thead><tr>'
      + '<th>' + escapeHtml(uiText('traffic.colDate', 'Date')) + '</th>'
      + '<th>' + escapeHtml(uiText('traffic.colBot', 'Bot')) + '</th>'
      + '<th>' + escapeHtml(uiText('traffic.colTraffic', 'Traffic')) + '</th>'
      + '<th>' + escapeHtml(uiText('traffic.colWrites', 'Writes')) + '</th>'
      + '</tr></thead>';
    const rows = state.daily.map((row) => (
      '<tr>'
      + '<td class="mono">' + escapeHtml(String(row.date || '')) + '</td>'
      + '<td>' + escapeHtml(botLabel(row.botAddress, row.botName)) + '</td>'
      + '<td class="mono" title="' + escapeHtml(formatBytesExact(row.bytes)) + '">' + escapeHtml(formatTraffic(row.bytes)) + '</td>'
      + '<td class="mono">' + escapeHtml(String(Number(row.txCount) || 0)) + '</td>'
      + '</tr>'
    )).join('');
    elements.usageTable.innerHTML = '<table class="data-table">' + head + '<tbody>' + rows + '</tbody></table>';
  };

  const ledgerKindLabel = (kind) => {
    const normalized = String(kind || '').trim().toLowerCase();
    if (!normalized) return '';
    const translated = uiText('traffic.kind.' + normalized, '');
    if (translated) return translated;
    if (normalized.indexOf('/protocols/') === 0) return normalized.slice('/protocols/'.length);
    return normalized;
  };
  const ledgerDirectionLabel = (direction) => {
    const key = 'traffic.direction.' + direction;
    const translated = uiText(key, '');
    if (translated) return translated;
    return uiText('traffic.direction.unknown', 'Type {direction}', { direction });
  };
  const ledgerSourceLabel = (entry) => {
    const parts = [];
    const kindLabel = ledgerKindLabel(entry.kind);
    if (kindLabel) parts.push(kindLabel);
    if (entry.botAddress) parts.push(botLabel(entry.botAddress, entry.botName));
    if (parts.length) return parts.join(' · ');
    const sourceKey = 'traffic.source.' + String(entry.sourceType || '').trim().toLowerCase();
    const sourceLabel = uiText(sourceKey, String(entry.sourceType || ''));
    return entry.remark ? sourceLabel + ' · ' + entry.remark : sourceLabel;
  };
  const ledgerAmount = (entry) => {
    const direction = Number(entry.direction) || 0;
    const sign = direction === 1 || direction === 4 ? '+' : '-';
    return sign + formatTraffic(entry.amountBytes);
  };

  const renderLedger = () => {
    if (!elements.ledgerTable) return;
    if (!state.ledger.length) {
      elements.ledgerTable.innerHTML = '<div class="table-empty"><strong>'
        + escapeHtml(uiText('traffic.ledgerEmpty', 'No ledger entries yet.')) + '</strong></div>';
    } else {
      const head = '<thead><tr>'
        + '<th>' + escapeHtml(uiText('traffic.colTime', 'Time')) + '</th>'
        + '<th>' + escapeHtml(uiText('traffic.colDirection', 'Type')) + '</th>'
        + '<th>' + escapeHtml(uiText('traffic.colSource', 'Source')) + '</th>'
        + '<th>' + escapeHtml(uiText('traffic.colAmount', 'Amount')) + '</th>'
        + '</tr></thead>';
      const rows = state.ledger.map((entry) => (
        '<tr>'
        + '<td class="mono">' + escapeHtml(formatDateTime(entry.timestamp) || '—') + '</td>'
        + '<td>' + escapeHtml(ledgerDirectionLabel(entry.direction)) + '</td>'
        + '<td>' + escapeHtml(ledgerSourceLabel(entry)) + '</td>'
        + '<td class="mono">' + escapeHtml(ledgerAmount(entry)) + '</td>'
        + '</tr>'
      )).join('');
      elements.ledgerTable.innerHTML = '<table class="data-table">' + head + '<tbody>' + rows + '</tbody></table>';
    }
    if (elements.ledgerMore) elements.ledgerMore.hidden = state.ledgerDone || !state.ledger.length;
    if (elements.ledgerLoadMore) {
      elements.ledgerLoadMore.disabled = state.ledgerBusy;
      elements.ledgerLoadMore.textContent = state.ledgerBusy
        ? uiText('traffic.ledgerLoading', 'Loading...')
        : uiText('traffic.ledgerLoadMore', 'Load more');
    }
    if (elements.ledgerStatus) {
      elements.ledgerStatus.textContent = state.ledgerNote || '';
      elements.ledgerStatus.className = 'status-msg' + (state.ledgerNoteKind ? ' ' + state.ledgerNoteKind : '');
    }
  };

  const renderApiBase = () => {
    if (!elements.apiCurrent) return;
    const configured = String(state.apiBase || '');
    elements.apiCurrent.textContent = uiText('traffic.apiBaseCurrent', 'Current: {value}', {
      value: configured || uiText('traffic.apiBaseDefault', 'production default'),
    });
    if (elements.apiSave) elements.apiSave.disabled = state.apiBaseBusy;
    if (elements.apiReset) {
      elements.apiReset.disabled = state.apiBaseBusy || !configured;
      elements.apiReset.hidden = !configured;
    }
    if (elements.apiInput) elements.apiInput.disabled = state.apiBaseBusy;
    if (elements.apiStatus) {
      elements.apiStatus.textContent = apiBaseNote.text;
      elements.apiStatus.className = 'status-msg' + (apiBaseNote.kind ? ' ' + apiBaseNote.kind : '');
    }
  };

  const render = () => {
    const gated = state.identityChecked && !state.hasIdentity;
    if (elements.gate) elements.gate.hidden = !gated;
    const showContent = state.hasIdentity && !state.featureUnavailable;
    if (elements.content) elements.content.hidden = !showContent;
    if (elements.redeemCard) elements.redeemCard.hidden = !showContent;
    if (elements.usageCard) elements.usageCard.hidden = !showContent;
    if (elements.ledgerCard) elements.ledgerCard.hidden = !showContent;
    if (elements.apiCard) elements.apiCard.hidden = !showContent;
    renderMode();
    renderBalance();
    renderUsage();
    renderLedger();
    renderApiBase();
    if (elements.refresh) elements.refresh.disabled = state.loading;
  };

  const describeError = (error, fallbackKey, fallback) => {
    const errorCode = error && error.errorCode ? String(error.errorCode) : '';
    if (errorCode) {
      const mapped = uiText('traffic.error.' + errorCode, '');
      if (mapped) return mapped;
    }
    const message = error && error.message ? String(error.message) : '';
    return message || uiText(fallbackKey, fallback);
  };

  const applyStatus = (data) => {
    state.mode = data.mode === 'selfpay' ? 'selfpay' : 'traffic';
    state.apiBase = typeof data.apiBase === 'string' ? data.apiBase : state.apiBase;
    state.account = data.account || null;
    state.freeGrant = data.freeGrant || null;
    state.featureUnavailable = data.featureUnavailable === true;
    const identity = data.identity || null;
    state.identityAddress = identity && identity.mvcAddress ? String(identity.mvcAddress) : '';
    state.hasIdentity = !!identity;
  };

  const loadBalance = async (silent) => {
    state.balanceBusy = !silent;
    renderBalance();
    try {
      const data = await postJson('/api/traffic/balance', {});
      if (data.account) state.account = data.account;
      if (data.featureUnavailable) state.featureUnavailable = true;
      balanceNote.kind = '';
      balanceNote.text = '';
    } catch (error) {
      balanceNote.kind = 'error';
      balanceNote.text = describeError(error, 'traffic.balanceFailed', 'Balance failed to load.');
    } finally {
      state.balanceBusy = false;
      renderBalance();
    }
  };

  const loadUsage = async () => {
    try {
      const data = await postJson('/api/traffic/usage', {});
      state.summary = data.summary || null;
      state.daily = Array.isArray(data.daily) ? data.daily : [];
      state.usageNote = data.source === 'service' ? '' : uiText('traffic.usageUnavailable', 'Usage is unavailable from the assist service right now.');
    } catch (error) {
      state.summary = null;
      state.daily = [];
      state.usageNote = describeError(error, 'traffic.usageUnavailable', 'Usage is unavailable from the assist service right now.');
    }
    renderUsage();
  };

  const loadLedger = async (cursor) => {
    state.ledgerBusy = true;
    state.ledgerNote = '';
    state.ledgerNoteKind = '';
    renderLedger();
    try {
      const data = await postJson('/api/traffic/ledger', { ...(cursor ? { cursor } : {}), limit: 20 });
      const entries = Array.isArray(data.entries) ? data.entries : [];
      state.ledger = cursor ? state.ledger.concat(entries) : entries;
      state.ledgerCursor = data.nextCursor ? String(data.nextCursor) : '';
      state.ledgerDone = !state.ledgerCursor || entries.length === 0;
    } catch (error) {
      state.ledgerNote = describeError(error, 'traffic.ledgerFailed', 'Ledger failed to load.');
      state.ledgerNoteKind = 'error';
      if (!cursor) {
        state.ledger = [];
        state.ledgerDone = true;
      }
    } finally {
      state.ledgerBusy = false;
      renderLedger();
    }
  };

  const loadApiBase = async () => {
    try {
      const data = await postJson('/api/traffic/api-base', { action: 'get' });
      state.apiBase = typeof data.apiBase === 'string' ? data.apiBase : '';
    } catch (error) {
      apiBaseNote.kind = 'error';
      apiBaseNote.text = describeError(error, 'traffic.apiBaseFailed', 'Endpoint setting failed to load.');
    }
    renderApiBase();
  };

  const load = async () => {
    state.loading = true;
    setStatusKey('traffic.status.loading');
    render();
    try {
      const data = await postJson('/api/traffic/status', {});
      applyStatus(data);
      state.identityChecked = true;
      state.loading = false;
      if (!state.hasIdentity) {
        setStatusKey('traffic.status.noIdentity');
        render();
        return;
      }
      if (state.featureUnavailable) {
        setStatusText(uiText('traffic.featureUnavailable', 'The assist service does not expose traffic APIs for this deployment.'));
        render();
        return;
      }
      setStatusKey('traffic.status.loaded');
      render();
      await Promise.all([
        loadBalance(true),
        loadUsage(),
        loadLedger(''),
        loadApiBase(),
      ]);
      render();
    } catch (error) {
      state.loading = false;
      state.identityChecked = false;
      setStatusText((error && error.message) || uiText('traffic.status.failed', 'Traffic account failed to load.'));
      render();
    }
  };

  const switchMode = async (mode) => {
    if (state.modeBusy || !state.hasIdentity || mode === state.mode) return;
    state.modeBusy = true;
    modeNote.kind = '';
    modeNote.text = '';
    render();
    try {
      const data = await postJson('/api/traffic/mode', { mode });
      state.mode = data.mode === 'selfpay' ? 'selfpay' : 'traffic';
      if (state.mode === 'traffic') {
        const bindSummary = data.bindSummary || null;
        if (bindSummary) {
          const conflictText = Number(bindSummary.conflictCount) > 0
            ? ' ' + uiText('traffic.bindSummaryConflicts', '{count} conflicted', { count: Number(bindSummary.conflictCount) })
            : '';
          modeNote.kind = 'success';
          modeNote.text = uiText('traffic.bindSummary', 'Traffic mode on. Bound {bound} Bots to the account.', { bound: Number(bindSummary.boundCount) || 0 }) + conflictText;
        } else {
          modeNote.kind = 'success';
          modeNote.text = uiText('traffic.modeSaved', 'Billing mode updated.');
        }
        const fresh = await postJson('/api/traffic/status', {}).catch(() => null);
        if (fresh) applyStatus(fresh);
        await loadBalance(true).catch(() => undefined);
      } else {
        modeNote.kind = 'success';
        modeNote.text = uiText('traffic.modeSaved', 'Billing mode updated.');
      }
    } catch (error) {
      modeNote.kind = 'error';
      modeNote.text = describeError(error, 'traffic.modeFailed', 'Billing mode failed to update.');
    } finally {
      state.modeBusy = false;
      render();
    }
  };

  const claimGrant = async () => {
    if (state.claimBusy) return;
    state.claimBusy = true;
    balanceNote.kind = '';
    balanceNote.text = '';
    renderBalance();
    try {
      const data = await postJson('/api/traffic/claim', {});
      balanceNote.kind = 'success';
      balanceNote.text = uiText('traffic.grantClaimed', 'Claimed {amount}. New balance {balance}.', {
        amount: formatTraffic(data.grantBytes),
        balance: formatTraffic(data.balanceAfter),
      });
      state.freeGrant = state.freeGrant ? Object.assign({}, state.freeGrant, { claimed: true, claimable: false }) : state.freeGrant;
      const fresh = await postJson('/api/traffic/status', {}).catch(() => null);
      if (fresh) applyStatus(fresh);
      await loadLedger('').catch(() => undefined);
    } catch (error) {
      balanceNote.kind = 'error';
      balanceNote.text = describeError(error, 'traffic.claimFailed', 'Free grant claim failed.');
    } finally {
      state.claimBusy = false;
      render();
    }
  };

  const submitRedeem = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.redeemBusy) return;
    const code = elements.redeemInput ? String(elements.redeemInput.value || '').trim() : '';
    if (!code) {
      state.redeemNote = { kind: 'error', text: uiText('traffic.redeemCodeRequired', 'Enter a redeem code first.') };
      renderRedeem();
      return;
    }
    state.redeemBusy = true;
    state.redeemNote = { kind: '', text: '' };
    renderRedeem();
    try {
      const data = await postJson('/api/traffic/redeem', { code });
      state.redeemNote = {
        kind: 'success',
        text: uiText('traffic.redeemSuccess', 'Code redeemed: +{traffic}. New balance {balance}.', {
          traffic: formatTraffic(data.trafficBytes),
          balance: formatTraffic(data.balanceAfter),
        }),
      };
      if (elements.redeemInput) elements.redeemInput.value = '';
      await loadBalance(true).catch(() => undefined);
      await loadLedger('').catch(() => undefined);
    } catch (error) {
      state.redeemNote = { kind: 'error', text: describeError(error, 'traffic.redeemFailed', 'Code redeem failed.') };
    } finally {
      state.redeemBusy = false;
      renderRedeem();
      renderBalance();
    }
  };
  const renderRedeem = () => {
    if (elements.redeemInput) {
      elements.redeemInput.disabled = state.redeemBusy;
      elements.redeemInput.setAttribute('placeholder', uiText('traffic.redeemPlaceholder', 'ENTER-CODE'));
    }
    if (elements.redeemSubmit) {
      elements.redeemSubmit.disabled = state.redeemBusy;
      elements.redeemSubmit.textContent = state.redeemBusy
        ? uiText('traffic.redeeming', 'Redeeming...')
        : uiText('traffic.redeemSubmit', 'Redeem');
    }
    if (elements.redeemStatus) {
      elements.redeemStatus.textContent = state.redeemNote.text;
      elements.redeemStatus.className = 'status-msg' + (state.redeemNote.kind ? ' ' + state.redeemNote.kind : '');
    }
  };

  const saveApiBase = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (state.apiBaseBusy) return;
    const value = elements.apiInput ? String(elements.apiInput.value || '').trim() : '';
    state.apiBaseBusy = true;
    apiBaseNote.kind = '';
    apiBaseNote.text = '';
    renderApiBase();
    try {
      const data = value
        ? await postJson('/api/traffic/api-base', { action: 'set', value })
        : await postJson('/api/traffic/api-base', { action: 'reset' });
      state.apiBase = typeof data.apiBase === 'string' ? data.apiBase : '';
      if (elements.apiInput) elements.apiInput.value = '';
      apiBaseNote.kind = 'success';
      apiBaseNote.text = uiText('traffic.apiBaseSaved', 'Endpoint saved.');
    } catch (error) {
      apiBaseNote.kind = 'error';
      apiBaseNote.text = describeError(error, 'traffic.apiBaseSaveFailed', 'Endpoint failed to save.');
    } finally {
      state.apiBaseBusy = false;
      renderApiBase();
    }
  };
  const resetApiBase = async () => {
    if (state.apiBaseBusy) return;
    state.apiBaseBusy = true;
    apiBaseNote.kind = '';
    apiBaseNote.text = '';
    renderApiBase();
    try {
      const data = await postJson('/api/traffic/api-base', { action: 'reset' });
      state.apiBase = typeof data.apiBase === 'string' ? data.apiBase : '';
      if (elements.apiInput) elements.apiInput.value = '';
      apiBaseNote.kind = 'success';
      apiBaseNote.text = uiText('traffic.apiBaseSaved', 'Endpoint saved.');
    } catch (error) {
      apiBaseNote.kind = 'error';
      apiBaseNote.text = describeError(error, 'traffic.apiBaseSaveFailed', 'Endpoint failed to save.');
    } finally {
      state.apiBaseBusy = false;
      renderApiBase();
    }
  };

  if (elements.refresh) elements.refresh.addEventListener('click', () => {
    load().catch(() => undefined);
  });
  if (elements.modeSeg) {
    elements.modeSeg.querySelectorAll('[data-traffic-mode]').forEach((button) => {
      button.addEventListener('click', () => { switchMode(button.getAttribute('data-traffic-mode')); });
    });
  }
  if (elements.balanceRefresh) elements.balanceRefresh.addEventListener('click', () => { loadBalance(false).catch(() => undefined); });
  if (elements.claim) elements.claim.addEventListener('click', () => { claimGrant().catch(() => undefined); });
  if (elements.redeemForm) elements.redeemForm.addEventListener('submit', submitRedeem);
  if (elements.ledgerLoadMore) elements.ledgerLoadMore.addEventListener('click', () => { loadLedger(state.ledgerCursor).catch(() => undefined); });
  if (elements.apiForm) elements.apiForm.addEventListener('submit', saveApiBase);
  if (elements.apiReset) elements.apiReset.addEventListener('click', () => { resetApiBase().catch(() => undefined); });
  window.addEventListener('oac:i18n-changed', () => {
    renderStatusLine();
    render();
    renderRedeem();
  });

  renderRedeem();
  load();
})();`,
  };
}
