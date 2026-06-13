import type { LocalUiPageDefinition } from '../types';
import { createI18nContext, renderLanguageOptions } from '../../i18n';
import type { LocalUiI18nContext } from '../../i18n';

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
                ${renderLanguageOptions(i18n)}
              </select>
            </label>
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
              <a href="/ui/trace">Trace</a>
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

  const fetchJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    return response.json();
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
  };

  if (refresh) refresh.addEventListener('click', load);
  window.addEventListener('oac:i18n-changed', () => {
    renderStatus();
  });
  load();
})();`,
  };
}
