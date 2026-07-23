import type { LocalUiI18nContext } from './i18n';

const SETTINGS_FIELDS = [
  { key: 'metasoP2PBaseUrl', labelKey: 'settings.modal.metasoP2PBaseUrl' },
  { key: 'metafileContentBaseUrl', labelKey: 'settings.modal.metafileBaseUrl' },
  { key: 'manApiBaseUrl', labelKey: 'settings.modal.manApiBaseUrl' },
] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function languageIcon(): string {
  return [
    '<svg viewBox="0 0 24 24" aria-hidden="true">',
    '<circle cx="12" cy="12" r="9"></circle>',
    '<path d="M3 12h18"></path>',
    '<path d="M12 3a15.3 15.3 0 0 1 0 18"></path>',
    '<path d="M12 3a15.3 15.3 0 0 0 0 18"></path>',
    '</svg>',
  ].join('');
}

function settingsIcon(): string {
  return [
    '<svg viewBox="0 0 24 24" aria-hidden="true">',
    '<circle cx="12" cy="12" r="3"></circle>',
    '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20.3h-3v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.56-1.03H5.3v-3h.14A1.7 1.7 0 0 0 7 9.94a1.7 1.7 0 0 0-.34-1.88L6.6 8l2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.69 4.7v-.08h3v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 8l-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.04v3h-.04A1.7 1.7 0 0 0 19.4 15Z"></path>',
    '</svg>',
  ].join('');
}

function closeIcon(): string {
  return [
    '<svg viewBox="0 0 24 24" aria-hidden="true">',
    '<path d="M18 6 6 18"></path>',
    '<path d="m6 6 12 12"></path>',
    '</svg>',
  ].join('');
}

export function renderTopbarControls(i18n: LocalUiI18nContext): string {
  const languageLabel = escapeHtml(i18n.t('language.toggle'));
  const settingsLabel = escapeHtml(i18n.t('nav.settings'));
  return [
    '<span class="topbar-icon-wrap">',
    `<button class="topbar-icon-button" type="button" data-language-toggle data-i18n-aria-label="language.toggle" aria-label="${languageLabel}">${languageIcon()}</button>`,
    `<span class="topbar-tooltip" role="tooltip" data-i18n-key="language.toggle">${languageLabel}</span>`,
    '</span>',
    '<span class="topbar-icon-wrap">',
    `<button class="topbar-icon-button" type="button" data-settings-open data-i18n-aria-label="nav.settings" aria-label="${settingsLabel}" aria-haspopup="dialog" aria-expanded="false">${settingsIcon()}</button>`,
    `<span class="topbar-tooltip" role="tooltip" data-i18n-key="nav.settings">${settingsLabel}</span>`,
    '</span>',
    `<a class="topbar-action" href="/browser" data-i18n-key="action.openBrowser">${escapeHtml(i18n.t('action.openBrowser'))}</a>`,
  ].join('');
}

export function renderTopbarSettingsModal(i18n: LocalUiI18nContext): string {
  const fields = SETTINGS_FIELDS.map((field) => [
    '<label class="topbar-settings-field">',
    `<span data-i18n-key="${field.labelKey}">${escapeHtml(i18n.t(field.labelKey))}</span>`,
    `<input type="url" inputmode="url" autocomplete="url" data-settings-field="${field.key}" />`,
    '</label>',
  ].join('')).join('');

  return [
    '<div class="topbar-settings-modal" data-settings-modal hidden>',
    '<form class="topbar-settings-panel" data-settings-form role="dialog" aria-modal="true" aria-labelledby="topbar-settings-title">',
    '<header>',
    `<h2 id="topbar-settings-title" data-i18n-key="settings.heading">${escapeHtml(i18n.t('settings.heading'))}</h2>`,
    `<button class="topbar-settings-close" type="button" data-settings-close data-i18n-aria-label="settings.modal.close" aria-label="${escapeHtml(i18n.t('settings.modal.close'))}">${closeIcon()}</button>`,
    '</header>',
    '<div class="topbar-settings-body">',
    `<h3 data-i18n-key="settings.modal.baseUrls">${escapeHtml(i18n.t('settings.modal.baseUrls'))}</h3>`,
    `<div class="topbar-settings-fields">${fields}</div>`,
    '<p class="topbar-settings-note">',
    `<span data-i18n-key="settings.modal.infrastructurePrefix">${escapeHtml(i18n.t('settings.modal.infrastructurePrefix'))}</span>`,
    '<a href="https://github.com/orgs/openagentinternet/repositories" target="_blank" rel="noopener">GitHub</a>',
    `<span data-i18n-key="settings.modal.infrastructureSuffix">${escapeHtml(i18n.t('settings.modal.infrastructureSuffix'))}</span>`,
    '</p>',
    '<p class="topbar-settings-status" data-settings-status role="status" aria-live="polite" hidden></p>',
    '</div>',
    '<footer>',
    `<button type="button" data-settings-close data-i18n-key="settings.modal.close">${escapeHtml(i18n.t('settings.modal.close'))}</button>`,
    `<button class="topbar-settings-save" type="submit" data-settings-save data-i18n-key="settings.modal.save">${escapeHtml(i18n.t('settings.modal.save'))}</button>`,
    '</footer>',
    '</form>',
    '</div>',
  ].join('');
}

export function renderTopbarSettingsScript(): string {
  return `(() => {
  const modal = document.querySelector('[data-settings-modal]');
  const trigger = document.querySelector('[data-settings-open]');
  const form = document.querySelector('[data-settings-form]');
  const status = document.querySelector('[data-settings-status]');
  const saveButton = document.querySelector('[data-settings-save]');
  const closeButtons = document.querySelectorAll('[data-settings-close]');
  const fieldKeys = ${JSON.stringify(SETTINGS_FIELDS.map((field) => field.key))};
  if (!modal || !trigger || !form) return;

  let statusState = { key: '', replacements: null };
  const textValue = (value) => typeof value === 'string' ? value.trim() : '';
  const objectValue = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const translate = (key, replacements) => window.__oacLocalUiI18n
    ? window.__oacLocalUiI18n.t(key, replacements || undefined)
    : key;
  const renderStatus = () => {
    if (!status) return;
    const message = statusState.key ? translate(statusState.key, statusState.replacements) : '';
    status.textContent = message;
    status.hidden = !message;
  };
  const setStatus = (key, replacements) => {
    statusState = { key, replacements: replacements || null };
    renderStatus();
  };
  const setBusy = (busy) => {
    if (saveButton) saveButton.disabled = busy;
    fieldKeys.forEach((key) => {
      const input = form.querySelector('[data-settings-field="' + key + '"]');
      if (input) input.disabled = busy;
    });
  };
  const responseData = async (response) => {
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok || !payload || payload.ok === false) {
      const message = textValue(payload && payload.message)
        || textValue(payload && payload.error && payload.error.message)
        || ('HTTP ' + response.status);
      throw new Error(message);
    }
    return objectValue(payload.data || payload);
  };
  const populateFields = (settings) => {
    const browser = objectValue(settings.browser);
    const effective = objectValue(settings.effectiveBrowser);
    const defaults = objectValue(settings.defaults);
    fieldKeys.forEach((key) => {
      const input = form.querySelector('[data-settings-field="' + key + '"]');
      if (!input) return;
      input.value = Object.prototype.hasOwnProperty.call(browser, key)
        ? textValue(browser[key])
        : textValue(effective[key]);
      input.placeholder = textValue(defaults[key]);
    });
  };
  const openModal = async () => {
    modal.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (document.body && document.body.classList) document.body.classList.add('topbar-settings-open');
    const firstClose = modal.querySelector('[data-settings-close]');
    if (firstClose && typeof firstClose.focus === 'function') firstClose.focus();
    setBusy(true);
    setStatus('settings.modal.loading');
    try {
      const response = await fetch('/api/browser/settings', { cache: 'no-store' });
      populateFields(await responseData(response));
      setStatus('');
    } catch (error) {
      setStatus('settings.modal.loadFailed', {
        message: error && error.message ? error.message : translate('settings.modal.unknownError'),
      });
    } finally {
      setBusy(false);
    }
  };
  const closeModal = () => {
    modal.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (document.body && document.body.classList) document.body.classList.remove('topbar-settings-open');
    if (typeof trigger.focus === 'function') trigger.focus();
  };
  const saveSettings = async (event) => {
    event.preventDefault();
    const browser = {};
    fieldKeys.forEach((key) => {
      const input = form.querySelector('[data-settings-field="' + key + '"]');
      browser[key] = input ? input.value : '';
    });
    setBusy(true);
    setStatus('settings.modal.saving');
    try {
      const response = await fetch('/api/browser/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ browser }),
      });
      populateFields(await responseData(response));
      setStatus('settings.modal.saved');
    } catch (error) {
      setStatus('settings.modal.saveFailed', {
        message: error && error.message ? error.message : translate('settings.modal.unknownError'),
      });
    } finally {
      setBusy(false);
    }
  };

  trigger.addEventListener('click', openModal);
  closeButtons.forEach((button) => button.addEventListener('click', closeModal));
  form.addEventListener('submit', saveSettings);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });
  window.addEventListener('oac:i18n-changed', renderStatus);
})();`;
}
