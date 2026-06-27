import { createI18nContext } from '../../i18n';
import type { LocalUiI18nContext } from '../../i18n';
import type { LocalUiPageDefinition } from '../types';

export function buildAppsPageDefinition(i18n: LocalUiI18nContext = createI18nContext()): LocalUiPageDefinition {
  const tx = i18n.t;
  return {
    page: 'apps',
    title: tx('apps.title'),
    eyebrow: tx('apps.eyebrow'),
    heading: tx('apps.heading'),
    description: tx('apps.description'),
    panels: [],
    contentHtml: `
      <section class="apps-shell" data-apps-shell>
        <div class="apps-workspace-card">
          <div class="apps-toolbar">
            <div>
              <h1 data-i18n-key="apps.toolbarTitle">${tx('apps.toolbarTitle')}</h1>
              <p data-i18n-key="apps.toolbarLabel">${tx('apps.toolbarLabel')}</p>
            </div>
            <div class="apps-toolbar-actions">
              <button class="btn" type="button" data-apps-refresh data-i18n-key="apps.refresh">${tx('apps.refresh')}</button>
              <button class="btn btn-primary" type="button" data-apps-publish-open data-i18n-key="apps.publishMetaApp">${tx('apps.publishMetaApp')}</button>
            </div>
          </div>

          <div class="apps-bot-filter">
            <label id="apps-bot-picker-label" data-i18n-key="apps.localBot">${tx('apps.localBot')}</label>
            <div class="apps-bot-picker" data-apps-bot-picker aria-labelledby="apps-bot-picker-label">
              <button class="apps-bot-trigger" type="button" disabled>
                <span data-i18n-key="apps.botPickerPlaceholder">${tx('apps.botPickerPlaceholder')}</span>
                <span class="apps-bot-chevron" aria-hidden="true">v</span>
              </button>
            </div>
          </div>

          <div class="apps-notice" data-apps-notice hidden></div>

          <section class="apps-gallery" aria-label="${tx('apps.galleryAria')}">
            <div class="apps-section-header">
              <div>
                <h2 data-i18n-key="apps.galleryTitle">${tx('apps.galleryTitle')}</h2>
                <p data-i18n-key="apps.galleryDescription">${tx('apps.galleryDescription')}</p>
              </div>
              <span data-apps-grid-count>0</span>
            </div>
            <div class="apps-grid" data-apps-grid>
              <div class="apps-empty">
                <strong data-i18n-key="apps.emptyTitle">${tx('apps.emptyTitle')}</strong>
                <p data-i18n-key="apps.emptyMessage">${tx('apps.emptyMessage')}</p>
              </div>
            </div>
            <div class="apps-pagination">
              <button class="btn btn-sm" type="button" data-apps-page-prev data-i18n-key="apps.previous">${tx('apps.previous')}</button>
              <span data-apps-page-label data-i18n-key="apps.pageLabel">${tx('apps.pageLabel')}</span>
              <button class="btn btn-sm" type="button" data-apps-page-next data-i18n-key="apps.next">${tx('apps.next')}</button>
            </div>
          </section>
        </div>
      </section>
    `,
    script: `(() => {
  const APPS_API_BASE = '/api/apps';
  const elements = {
    shell: document.querySelector('[data-apps-shell]'),
    grid: document.querySelector('[data-apps-grid]'),
    notice: document.querySelector('[data-apps-notice]'),
    refresh: document.querySelector('[data-apps-refresh]'),
    publish: document.querySelector('[data-apps-publish-open]'),
    prev: document.querySelector('[data-apps-page-prev]'),
    next: document.querySelector('[data-apps-page-next]'),
  };
  if (elements.shell) {
    elements.shell.dataset.appsApi = APPS_API_BASE;
  }
  [elements.refresh, elements.prev, elements.next].forEach((button) => {
    if (button) button.disabled = true;
  });
  if (typeof window !== 'undefined') {
    window.__oacAppsPage = { apiBase: APPS_API_BASE };
  }
})();`,
  };
}
