"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSettingsPageDefinition = buildSettingsPageDefinition;
const i18n_1 = require("../../i18n");
function buildSettingsPageDefinition(i18n = (0, i18n_1.createI18nContext)()) {
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
          <div>
            <h1 data-i18n-key="settings.heading">${i18n.t('settings.heading')}</h1>
            <p data-settings-status data-i18n-key="settings.status.loading">${i18n.t('settings.status.loading')}</p>
          </div>
          <button class="btn" type="button" data-settings-refresh data-i18n-key="settings.refresh">${i18n.t('settings.refresh')}</button>
        </div>
        <div class="settings-grid">
          <article class="settings-panel" data-language-section>
            <div>
              <h2 data-i18n-key="settings.language.title">${i18n.t('settings.language.title')}</h2>
              <p data-i18n-key="settings.language.body">${i18n.t('settings.language.body')}</p>
            </div>
            <label class="settings-language-control">
              <span data-i18n-key="language.label">${i18n.t('language.label')}</span>
              <select data-language-select>
                ${(0, i18n_1.renderLanguageOptions)(i18n)}
              </select>
            </label>
          </article>
          <article class="settings-panel" data-user-section>
            <div>
              <h2 data-i18n-key="settings.user.title">${i18n.t('settings.user.title')}</h2>
              <p data-i18n-key="settings.user.body">${i18n.t('settings.user.body')}</p>
            </div>
            <div class="settings-user-live" data-user-live></div>
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
              <h2 data-i18n-key="settings.traffic.title">${i18n.t('settings.traffic.title')}</h2>
              <p data-i18n-key="settings.traffic.body">${i18n.t('settings.traffic.body')}</p>
            </div>
            <a class="btn btn-sm" href="/ui/traffic" data-i18n-key="action.openTrafficPage">${i18n.t('action.openTrafficPage')}</a>
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
      </section>
    `,
        script: `(() => {
  const status = document.querySelector('[data-settings-status]');
  const refresh = document.querySelector('[data-settings-refresh]');
  const configStatus = document.querySelector('[data-settings-config-status]');
  const llmStatus = document.querySelector('[data-settings-llm-status]');
  const networkStatus = document.querySelector('[data-settings-network-status]');
  const userLive = document.querySelector('[data-user-live]');
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
    } catch (error) {
      userState.busy = false;
      userState.deleteArmed = false;
      userState.message = { kind: 'error', text: userErrorText(error) };
      renderUser();
    }
  };

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
  };

  if (refresh) refresh.addEventListener('click', load);
  window.addEventListener('oac:i18n-changed', () => {
    renderStatus();
    renderUser();
  });
  load();
})();`,
    };
}
