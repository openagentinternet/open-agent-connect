import type { LocalUiI18nContext } from './i18n';

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

// The former topbar settings modal was folded into the Settings page: the
// gear now navigates to /ui/settings (its General tab hosts the browser
// infrastructure base URLs that the modal used to edit).
export function renderTopbarControls(i18n: LocalUiI18nContext): string {
  const languageLabel = escapeHtml(i18n.t('language.toggle'));
  const settingsLabel = escapeHtml(i18n.t('nav.settings'));
  return [
    '<span class="topbar-icon-wrap">',
    `<button class="topbar-icon-button" type="button" data-language-toggle data-i18n-aria-label="language.toggle" aria-label="${languageLabel}">${languageIcon()}</button>`,
    `<span class="topbar-tooltip" role="tooltip" data-i18n-key="language.toggle">${languageLabel}</span>`,
    '</span>',
    '<span class="topbar-icon-wrap">',
    `<a class="topbar-icon-button" href="/ui/settings" data-settings-link data-i18n-aria-label="nav.settings" aria-label="${settingsLabel}">${settingsIcon()}</a>`,
    `<span class="topbar-tooltip" role="tooltip" data-i18n-key="nav.settings">${settingsLabel}</span>`,
    '</span>',
    `<a class="topbar-action" href="/browser" data-i18n-key="action.openBrowser">${escapeHtml(i18n.t('action.openBrowser'))}</a>`,
  ].join('');
}
