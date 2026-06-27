import { createI18nContext } from '../../i18n';
import type { LocalUiI18nContext } from '../../i18n';
import type { LocalUiPageDefinition } from '../types';

interface AppsPageRuntimeText {
  botFallback: string;
  copied: string;
  copyPinId: string;
  details: string;
  disabled: string;
  emptyMessage: string;
  emptyTitle: string;
  loadErrorTitle: string;
  noLocalBotAvailable: string;
  pageSizeLabel: string;
  requestFailed: string;
  run: string;
  runnable: string;
  share: string;
  untitledMetaApp: string;
}

export function buildAppsPageDefinition(i18n: LocalUiI18nContext = createI18nContext()): LocalUiPageDefinition {
  const tx = i18n.t;
  const runtimeText: AppsPageRuntimeText = {
    botFallback: tx('apps.botFallback'),
    copied: tx('apps.copied'),
    copyPinId: tx('apps.copyPinId'),
    details: tx('apps.details'),
    disabled: tx('apps.disabled'),
    emptyMessage: tx('apps.emptyMessage'),
    emptyTitle: tx('apps.emptyTitle'),
    loadErrorTitle: tx('apps.loadErrorTitle'),
    noLocalBotAvailable: tx('apps.noLocalBotAvailable'),
    pageSizeLabel: tx('apps.pageSizeLabel'),
    requestFailed: tx('apps.requestFailed'),
    run: tx('apps.run'),
    runnable: tx('apps.runnable'),
    share: tx('apps.share'),
    untitledMetaApp: tx('apps.untitledMetaApp'),
  };
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
                <h2 data-i18n-key="apps.publishedMetaApps">${tx('apps.publishedMetaApps')}</h2>
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
    script: buildAppsPageRuntimeSource(runtimeText),
  };
}

function buildAppsPageRuntimeSource(text: AppsPageRuntimeText): string {
  return `(() => {
  const APPS_API_BASE = '/api/apps';
  const PAGE_SIZE = 12;
  const UI_TEXT = ${JSON.stringify(text)};
  const state = {
    profiles: [],
    selectedSlug: '',
    records: [],
    cursorStack: [''],
    cursor: '',
    nextCursor: '',
    loadingToken: 0,
    botMenuOpen: false,
  };
  const elements = {
    shell: document.querySelector('[data-apps-shell]'),
    grid: document.querySelector('[data-apps-grid]'),
    gridCount: document.querySelector('[data-apps-grid-count]'),
    notice: document.querySelector('[data-apps-notice]'),
    refresh: document.querySelector('[data-apps-refresh]'),
    publish: document.querySelector('[data-apps-publish-open]'),
    prev: document.querySelector('[data-apps-page-prev]'),
    next: document.querySelector('[data-apps-page-next]'),
    pageLabel: document.querySelector('[data-apps-page-label]'),
    botPicker: document.querySelector('[data-apps-bot-picker]'),
  };
  if (elements.shell) {
    elements.shell.dataset.appsApi = APPS_API_BASE;
  }

  const normalizeText = (value) => typeof value === 'string' ? value.trim() : '';
  const profileSlug = (profile) => normalizeText(profile && profile.slug);
  const recordPinId = (record) => normalizeText(record && record.pinId);
  const selectedProfile = () => state.profiles.find((profile) => profileSlug(profile) === state.selectedSlug) || null;
  const fromQuery = () => new URLSearchParams(window.location.search || '').get('from') || '';

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const showNotice = (kind, title, body) => {
    if (!elements.notice) return;
    elements.notice.hidden = false;
    elements.notice.dataset.tone = kind;
    elements.notice.innerHTML = '<strong>' + escapeHtml(title) + '</strong>' + (body ? '<p>' + escapeHtml(body) + '</p>' : '');
  };

  const hideNotice = () => {
    if (elements.notice) elements.notice.hidden = true;
  };

  const fetchJson = async (url, options) => {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok || !payload || payload.ok === false || payload.state === 'failed') {
      throw new Error(payload && payload.message ? payload.message : UI_TEXT.requestFailed);
    }
    return payload.data || payload;
  };

  const setUrlState = () => {
    if (!state.selectedSlug || !window.history || !window.location) return;
    const next = new URLSearchParams(window.location.search || '');
    next.set('from', state.selectedSlug);
    const suffix = next.toString();
    window.history.replaceState(null, '', window.location.pathname + (suffix ? '?' + suffix : ''));
  };

  const chooseSelectedBot = (data) => {
    const querySlug = normalizeText(fromQuery());
    const queryProfile = state.profiles.find((profile) => profileSlug(profile) === querySlug);
    const activeSlug = normalizeText(data && data.activeSlug);
    const activeProfile = state.profiles.find((profile) => profileSlug(profile) === activeSlug)
      || state.profiles.find((profile) => profile && profile.isActive === true);
    const selected = queryProfile || activeProfile || state.profiles[0] || null;
    state.selectedSlug = profileSlug(selected);
    setUrlState();
  };

  const profileLabel = (profile) => normalizeText(profile && profile.name)
    || profileSlug(profile)
    || normalizeText(profile && profile.globalMetaId)
    || UI_TEXT.botFallback;

  const profileAvatar = (profile) => {
    const avatar = profile && profile.avatar;
    return normalizeText(avatar && typeof avatar === 'object' && avatar.label)
      || profileLabel(profile).slice(0, 2).toUpperCase()
      || 'BT';
  };

  const renderBotPicker = () => {
    if (!elements.botPicker) return;
    const selected = selectedProfile();
    const current = selected
      ? '<span class="apps-bot-avatar">' + escapeHtml(profileAvatar(selected)) + '</span>'
        + '<span class="apps-bot-main"><strong>' + escapeHtml(profileLabel(selected)) + '</strong><span>' + escapeHtml(normalizeText(selected.globalMetaId) || state.selectedSlug) + '</span></span>'
      : '<span class="apps-bot-main"><strong>' + escapeHtml(UI_TEXT.noLocalBotAvailable) + '</strong></span>';
    elements.botPicker.innerHTML =
      '<button class="apps-bot-trigger" type="button" data-apps-bot-trigger aria-expanded="' + (state.botMenuOpen ? 'true' : 'false') + '"' + (state.profiles.length ? '' : ' disabled') + '>' +
        current +
        '<span class="apps-bot-chevron" aria-hidden="true">v</span>' +
      '</button>' +
      '<div class="apps-bot-menu" data-apps-bot-menu role="listbox"' + (state.botMenuOpen ? '' : ' hidden') + '>' +
        state.profiles.map((profile) => {
          const slug = profileSlug(profile);
          return '<button class="apps-bot-option" type="button" role="option" data-apps-bot-option="' + escapeHtml(slug) + '" data-selected="' + (slug === state.selectedSlug ? 'true' : 'false') + '" aria-selected="' + (slug === state.selectedSlug ? 'true' : 'false') + '">' +
            '<span class="apps-bot-avatar">' + escapeHtml(profileAvatar(profile)) + '</span>' +
            '<span>' + escapeHtml(profileLabel(profile)) + '</span>' +
          '</button>';
        }).join('') +
      '</div>';
  };

  const renderEmpty = () => {
    if (!elements.grid) return;
    elements.grid.innerHTML = '<div class="apps-empty"><strong>' + escapeHtml(UI_TEXT.emptyTitle) + '</strong><p>' + escapeHtml(UI_TEXT.emptyMessage) + '</p></div>';
  };

  const renderRecordCard = (record) => {
    const pinId = recordPinId(record);
    const disabled = record && record.disabled === true;
    const title = normalizeText(record && (record.title || record.appName)) || UI_TEXT.untitledMetaApp;
    const subtitle = [normalizeText(record && record.version), normalizeText(record && record.runtime)].filter(Boolean).join(' / ');
    const intro = normalizeText(record && record.intro);
    const tags = Array.isArray(record && record.tags) ? record.tags.map(normalizeText).filter(Boolean).slice(0, 4) : [];
    const initials = (normalizeText(record && (record.appName || record.title)) || 'MA').slice(0, 2).toUpperCase();
    return '<article class="apps-card" data-apps-card="' + escapeHtml(pinId) + '" tabindex="0">' +
      '<div class="apps-card-cover">' +
        '<span class="apps-card-icon">' + escapeHtml(initials) + '</span>' +
        '<span class="apps-state-pill' + (disabled ? ' disabled' : '') + '">' + escapeHtml(disabled ? UI_TEXT.disabled : UI_TEXT.runnable) + '</span>' +
      '</div>' +
      '<div class="apps-card-body">' +
        '<div class="apps-card-title">' +
          '<h3>' + escapeHtml(title) + '</h3>' +
          '<p>' + escapeHtml(subtitle) + '</p>' +
        '</div>' +
        '<div class="apps-pin-line"><code>' + escapeHtml(pinId) + '</code><button class="apps-copy-btn" type="button" data-apps-copy-pin="' + escapeHtml(pinId) + '" aria-label="' + escapeHtml(UI_TEXT.copyPinId) + '">' + escapeHtml(UI_TEXT.copyPinId) + '</button></div>' +
        '<p class="apps-card-intro">' + escapeHtml(intro) + '</p>' +
        '<div class="apps-tags">' + tags.map((tag) => '<span>' + escapeHtml(tag) + '</span>').join('') + '</div>' +
        '<div class="apps-card-actions">' +
          '<button class="btn btn-primary" type="button" data-apps-run="' + escapeHtml(pinId) + '"' + (disabled ? ' disabled' : '') + '>' + escapeHtml(UI_TEXT.run) + '</button>' +
          '<button class="btn" type="button" data-apps-share="' + escapeHtml(pinId) + '">' + escapeHtml(UI_TEXT.share) + '</button>' +
          '<button class="btn" type="button" data-apps-detail="' + escapeHtml(pinId) + '">' + escapeHtml(UI_TEXT.details) + '</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  };

  const renderGrid = () => {
    if (!elements.grid) return;
    if (!state.records.length) {
      renderEmpty();
    } else {
      elements.grid.innerHTML = state.records.map(renderRecordCard).join('');
    }
    if (elements.gridCount) elements.gridCount.textContent = String(state.records.length);
    if (elements.prev) {
      elements.prev.hidden = state.cursorStack.length <= 1;
      elements.prev.disabled = state.cursorStack.length <= 1;
    }
    if (elements.next) {
      elements.next.hidden = !state.nextCursor;
      elements.next.disabled = !state.nextCursor;
    }
    if (elements.pageLabel) elements.pageLabel.textContent = UI_TEXT.pageSizeLabel;
  };

  const loadProfiles = async () => {
    const data = await fetchJson('/api/bot/profiles');
    state.profiles = Array.isArray(data && data.profiles)
      ? data.profiles.filter((profile) => profileSlug(profile))
      : [];
    chooseSelectedBot(data);
    renderBotPicker();
  };

  const loadApps = async (cursor) => {
    if (!state.selectedSlug) {
      state.records = [];
      state.nextCursor = '';
      renderGrid();
      throw new Error(UI_TEXT.noLocalBotAvailable);
    }
    const token = ++state.loadingToken;
    const params = new URLSearchParams();
    params.set('from', state.selectedSlug);
    params.set('size', String(PAGE_SIZE));
    if (cursor) params.set('cursor', cursor);
    const data = await fetchJson(APPS_API_BASE + '?' + params.toString());
    if (token !== state.loadingToken) return;
    state.records = Array.isArray(data && data.records) ? data.records : [];
    state.cursor = cursor || '';
    state.nextCursor = normalizeText(data && data.nextCursor);
    hideNotice();
    renderGrid();
  };

  const refreshApps = async () => {
    try {
      await loadApps(state.cursor);
    } catch (error) {
      showNotice('error', UI_TEXT.loadErrorTitle, error && error.message ? error.message : String(error));
    }
  };

  const selectBot = async (slug) => {
    const nextSlug = normalizeText(slug);
    if (!nextSlug || nextSlug === state.selectedSlug) {
      state.botMenuOpen = false;
      renderBotPicker();
      return;
    }
    state.selectedSlug = nextSlug;
    state.cursorStack = [''];
    state.cursor = '';
    state.nextCursor = '';
    state.records = [];
    state.botMenuOpen = false;
    setUrlState();
    renderBotPicker();
    renderGrid();
    await loadApps('');
  };

  const initialize = async () => {
    try {
      renderGrid();
      await loadProfiles();
      await loadApps('');
    } catch (error) {
      showNotice('error', UI_TEXT.loadErrorTitle, error && error.message ? error.message : String(error));
    }
  };

  document.addEventListener('click', async (event) => {
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (!eventTarget) return;
    const target = eventTarget.closest('[data-apps-bot-trigger], [data-apps-bot-option], [data-apps-copy-pin], [data-apps-run], [data-apps-share], [data-apps-detail]');
    if (!target) {
      if (state.botMenuOpen && !eventTarget.closest('[data-apps-bot-picker]')) {
        state.botMenuOpen = false;
        renderBotPicker();
      }
      return;
    }
    if (target.matches('[data-apps-bot-trigger]')) {
      state.botMenuOpen = !state.botMenuOpen;
      renderBotPicker();
      return;
    }
    if (target.matches('[data-apps-bot-option]')) {
      try {
        await selectBot(target.getAttribute('data-apps-bot-option') || '');
      } catch (error) {
        showNotice('error', UI_TEXT.loadErrorTitle, error && error.message ? error.message : String(error));
      }
      return;
    }
    if (target.matches('[data-apps-copy-pin]')) {
      const pinId = target.getAttribute('data-apps-copy-pin') || '';
      await navigator.clipboard?.writeText(pinId);
      target.textContent = UI_TEXT.copied;
      setTimeout(() => { target.textContent = UI_TEXT.copyPinId; }, 1000);
      return;
    }
    if (target.matches('[data-apps-run]') && !target.disabled) {
      const pinId = target.getAttribute('data-apps-run') || '';
      if (pinId) window.location.href = '/browser/metaapp/' + encodeURIComponent(pinId);
    }
  });

  if (elements.refresh) elements.refresh.addEventListener('click', refreshApps);
  if (elements.next) elements.next.addEventListener('click', async () => {
    if (!state.nextCursor) return;
    const nextCursor = state.nextCursor;
    state.cursorStack.push(nextCursor);
    try {
      await loadApps(nextCursor);
    } catch (error) {
      state.cursorStack.pop();
      showNotice('error', UI_TEXT.loadErrorTitle, error && error.message ? error.message : String(error));
    }
  });
  if (elements.prev) elements.prev.addEventListener('click', async () => {
    if (state.cursorStack.length <= 1) return;
    state.cursorStack.pop();
    try {
      await loadApps(state.cursorStack[state.cursorStack.length - 1] || '');
    } catch (error) {
      showNotice('error', UI_TEXT.loadErrorTitle, error && error.message ? error.message : String(error));
    }
  });

  initialize();
  if (typeof window !== 'undefined') {
    window.__oacAppsPage = { apiBase: APPS_API_BASE };
  }
})();`;
}
