import type { LocalUiPageDefinition } from '../types';
import { createI18nContext } from '../../i18n';
import type { I18nKey, LocalUiI18nContext } from '../../i18n';
import { buildMyServicesPageViewModelRuntimeSource } from './viewModel';

export interface MyServicesPageDefinitionOptions {
  page?: LocalUiPageDefinition['page'];
  i18n?: LocalUiI18nContext;
  title?: string;
  eyebrow?: string;
  heading?: string;
  description?: string;
  toolbarTitle?: string;
  toolbarTitleKey?: I18nKey;
  toolbarLabel?: string;
  toolbarLabelKey?: I18nKey;
  includePublishAction?: boolean;
  includeRefundsAction?: boolean;
  publishActionKey?: I18nKey;
  refundsActionKey?: I18nKey;
  orderTraceActionLabel?: string;
  orderTraceActionKey?: I18nKey;
  orderSessionActionLabel?: string;
  orderSessionActionKey?: I18nKey;
}

export function buildMyServicesPageDefinition(options: MyServicesPageDefinitionOptions = {}): LocalUiPageDefinition {
  const i18n = options.i18n ?? createI18nContext();
  const buildMyServicesPageViewModelSource = buildMyServicesPageViewModelRuntimeSource();
  const page = options.page ?? 'my-services';
  const title = options.title ?? i18n.t('myServices.title');
  const eyebrow = options.eyebrow ?? i18n.t('myServices.eyebrow');
  const heading = options.heading ?? i18n.t('myServices.heading');
  const description = options.description ?? i18n.t('myServices.description');
  const toolbarTitleKey = options.toolbarTitleKey ?? 'myServices.toolbarTitle';
  const toolbarLabelKey = options.toolbarLabelKey ?? 'myServices.toolbarLabel';
  const publishActionKey = options.publishActionKey ?? 'services.publishService';
  const refundsActionKey = options.refundsActionKey ?? 'services.serviceRefunds';
  const toolbarTitle = options.toolbarTitle ?? i18n.t(toolbarTitleKey);
  const toolbarLabel = options.toolbarLabel ?? i18n.t(toolbarLabelKey);
  const tx = (key: I18nKey, replacements?: Record<string, string | number>) => i18n.t(key, replacements);
  const publishAction = options.includePublishAction
    ? `<a class="btn btn-primary" href="/ui/publish" data-my-services-publish data-i18n-key="${publishActionKey}">${tx(publishActionKey)}</a>`
    : '';
  const refundsAction = options.includeRefundsAction
    ? `<a class="btn btn-primary" href="/ui/refund" data-my-services-refunds data-i18n-key="${refundsActionKey}">${tx(refundsActionKey)}</a>`
    : '';
  const orderTraceActionLabel = JSON.stringify(options.orderTraceActionLabel ?? tx('services.trace'));
  const orderSessionActionLabel = JSON.stringify(options.orderSessionActionLabel ?? tx('services.session'));
  const orderTraceActionKey = JSON.stringify(options.orderTraceActionKey ?? 'services.trace');
  const orderSessionActionKey = JSON.stringify(options.orderSessionActionKey ?? 'services.session');
  return {
    page,
    title,
    eyebrow,
    heading,
    description,
    panels: [],
    contentHtml: `
      <section class="my-services-shell" data-my-services-shell>
        <div class="my-services-workspace-card">
          <div class="my-services-toolbar">
            <div>
              <h1 data-i18n-key="${toolbarTitleKey}">${toolbarTitle}</h1>
              <p data-my-services-page-label data-i18n-key="${toolbarLabelKey}">${toolbarLabel}</p>
            </div>
            <div class="my-services-toolbar-actions">
              ${publishAction}
              ${refundsAction}
              <button class="btn" type="button" data-my-services-refresh data-i18n-key="services.refresh">${tx('services.refresh')}</button>
            </div>
          </div>

          <div class="my-services-notice" data-my-services-notice hidden></div>

          <div class="services-bot-filter">
            <label id="services-bot-picker-label" data-i18n-key="services.localBot">${tx('services.localBot')}</label>
            <div class="services-bot-picker" data-services-bot-picker>
              <button class="services-bot-trigger" type="button" data-services-bot-trigger aria-labelledby="services-bot-picker-label" aria-haspopup="listbox" aria-expanded="false">
                <span class="services-bot-current" data-services-bot-current></span>
                <span class="services-bot-chevron" aria-hidden="true">▾</span>
              </button>
              <div class="services-bot-menu" data-services-bot-menu role="listbox" hidden></div>
            </div>
          </div>

          <div class="my-services-workspace">
            <section class="my-services-list-panel" aria-label="Published services">
              <div class="ledger-section-header">
                <h2 data-i18n-key="services.publishedServices">${tx('services.publishedServices')}</h2>
                <span data-my-services-list-count>0</span>
              </div>
              <div class="my-services-list" data-my-services-list></div>
              <div class="ledger-pagination">
                <button class="btn btn-sm" type="button" data-services-page-prev data-i18n-key="services.previous">${tx('services.previous')}</button>
                <button class="btn btn-sm" type="button" data-services-page-next data-i18n-key="services.next">${tx('services.next')}</button>
              </div>
            </section>
          </div>
        </div>

        <div class="my-services-modal" data-my-service-detail-modal hidden>
          <div class="my-services-modal-dialog my-service-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="my-service-detail-title">
            <div class="modal-heading">
              <div>
                <h2 id="my-service-detail-title" data-i18n-key="services.serviceDetail">${tx('services.serviceDetail')}</h2>
                <p data-my-service-order-page-label data-i18n-key="services.ordersZero">${tx('services.ordersZero')}</p>
              </div>
              <button class="modal-close" type="button" data-my-service-detail-close aria-label="${tx('services.closeServiceDetailModal')}">x</button>
            </div>
            <div data-my-service-detail-modal-body></div>
            <div class="ledger-pagination" data-my-service-order-pagination>
              <button class="btn btn-sm" type="button" data-orders-page-prev data-i18n-key="services.previous">${tx('services.previous')}</button>
              <button class="btn btn-sm" type="button" data-orders-page-next data-i18n-key="services.next">${tx('services.next')}</button>
            </div>
          </div>
        </div>

        <div class="my-services-modal" data-my-service-edit-modal hidden>
          <form class="my-services-modal-dialog my-services-edit-form" data-my-service-edit-form>
            <div class="modal-heading">
              <div>
                <h2 data-i18n-key="services.editService">${tx('services.editService')}</h2>
                <p data-i18n-key="services.editDescription">${tx('services.editDescription')}</p>
              </div>
              <button class="modal-close" type="button" data-my-service-edit-close aria-label="${tx('bot.close')}">x</button>
            </div>

            <div class="edit-form-grid">
              <label>
                <span data-i18n-key="services.displayName">${tx('services.displayName')}</span>
                <input name="displayName" required />
              </label>
              <label>
                <span data-i18n-key="services.serviceName">${tx('services.serviceName')}</span>
                <input name="serviceName" required />
              </label>
              <label class="wide-field">
                <span data-i18n-key="services.descriptionLabel">${tx('services.descriptionLabel')}</span>
                <textarea name="description" rows="4" required></textarea>
              </label>
              <div class="wide-field">
                <span data-i18n-key="services.providerSkills">${tx('services.providerSkills')}</span>
                <div class="skill-picker" data-edit-provider-skill-picker aria-label="${tx('services.providerSkillAria')}">
                  <div class="skill-picker-row">
                    <select data-edit-provider-skill-select aria-label="${tx('services.providerSkillSelectAria')}">
                      <option value="" data-i18n-key="services.selectSkillToAdd">${tx('services.selectSkillToAdd')}</option>
                    </select>
                    <button class="btn" type="button" data-edit-provider-skill-add data-i18n-key="services.add">${tx('services.add')}</button>
                  </div>
                  <div class="skill-chip-list" data-edit-provider-skill-chips aria-live="polite">
                    <p class="field-hint" data-i18n-key="services.noSkillSelected">${tx('services.noSkillSelected')}</p>
                  </div>
                </div>
              </div>
              <label>
                <span data-i18n-key="services.outputType">${tx('services.outputType')}</span>
                <select name="outputType" data-edit-output-type required></select>
              </label>
              <label class="wide-field">
                <span data-i18n-key="services.executionReminder">${tx('services.executionReminder')}</span>
                <textarea name="executionReminder" rows="3"></textarea>
              </label>
              <div>
                <span data-i18n-key="services.paymentTiming">${tx('services.paymentTiming')}</span>
                <div class="segmented-control" data-edit-payment-timing>
                  <label><input type="radio" name="paymentTiming" value="free" /> <span data-i18n-key="services.free">${tx('services.free')}</span></label>
                  <label><input type="radio" name="paymentTiming" value="prepaid" /> <span data-i18n-key="services.prepaid">${tx('services.prepaid')}</span></label>
                </div>
              </div>
              <label>
                <span data-i18n-key="services.price">${tx('services.price')}</span>
                <input name="price" data-edit-price inputmode="decimal" required />
              </label>
              <label>
                <span data-i18n-key="services.currency">${tx('services.currency')}</span>
                <select name="currency" data-edit-currency required></select>
              </label>
              <div class="wide-field edit-cover-field">
                <span data-i18n-key="services.coverImage">${tx('services.coverImage')}</span>
                <div class="edit-cover-row">
                  <div class="edit-cover-preview" data-edit-cover-preview></div>
                  <div class="edit-cover-controls">
                    <input id="my-services-cover-input" type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml" data-edit-cover-input />
                    <label class="btn" for="my-services-cover-input" data-i18n-key="services.uploadImage">${tx('services.uploadImage')}</label>
                    <button class="btn" type="button" data-edit-cover-remove data-i18n-key="services.remove">${tx('services.remove')}</button>
                    <p data-edit-cover-note data-i18n-key="services.coverNote">${tx('services.coverNote')}</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="modal-actions">
              <button class="btn" type="button" data-my-service-edit-close data-i18n-key="services.cancel">${tx('services.cancel')}</button>
              <button class="btn btn-primary" type="submit" data-my-service-edit-submit data-i18n-key="services.saveModify">${tx('services.saveModify')}</button>
            </div>
          </form>
        </div>

        <div class="my-services-modal" data-my-service-revoke-modal hidden>
          <div class="my-services-modal-dialog revoke-dialog">
            <div class="modal-heading">
              <div>
                <h2 data-i18n-key="services.revokeService">${tx('services.revokeService')}</h2>
                <p data-my-service-revoke-copy data-i18n-key="services.revokeDefaultCopy">${tx('services.revokeDefaultCopy')}</p>
              </div>
              <button class="modal-close" type="button" data-my-service-revoke-close aria-label="${tx('bot.close')}">x</button>
            </div>
            <div class="modal-actions">
              <button class="btn" type="button" data-my-service-revoke-close data-i18n-key="services.cancel">${tx('services.cancel')}</button>
              <button class="btn btn-danger" type="button" data-my-service-revoke-confirm data-i18n-key="services.revoke">${tx('services.revoke')}</button>
            </div>
          </div>
        </div>
      </section>
    `,
    script: `(() => {
  ${buildMyServicesPageViewModelSource}
  const ORDER_TRACE_ACTION_LABEL = ${orderTraceActionLabel};
  const ORDER_SESSION_ACTION_LABEL = ${orderSessionActionLabel};
  const ORDER_TRACE_ACTION_KEY = ${orderTraceActionKey};
  const ORDER_SESSION_ACTION_KEY = ${orderSessionActionKey};

  const ICON_MAX_BYTES = 2 * 1024 * 1024;
  const ICON_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml']);
  const elements = {
    pageLabel: document.querySelector('[data-my-services-page-label]'),
    publish: document.querySelector('[data-my-services-publish]'),
    refunds: document.querySelector('[data-my-services-refunds]'),
    refresh: document.querySelector('[data-my-services-refresh]'),
    notice: document.querySelector('[data-my-services-notice]'),
    botPicker: document.querySelector('[data-services-bot-picker]'),
    botTrigger: document.querySelector('[data-services-bot-trigger]'),
    botCurrent: document.querySelector('[data-services-bot-current]'),
    botMenu: document.querySelector('[data-services-bot-menu]'),
    list: document.querySelector('[data-my-services-list]'),
    listCount: document.querySelector('[data-my-services-list-count]'),
    servicesPagePrev: document.querySelector('[data-services-page-prev]'),
    servicesPageNext: document.querySelector('[data-services-page-next]'),
    ordersPagePrev: document.querySelector('[data-orders-page-prev]'),
    ordersPageNext: document.querySelector('[data-orders-page-next]'),
    orderPageLabel: document.querySelector('[data-my-service-order-page-label]'),
    detailModal: document.querySelector('[data-my-service-detail-modal]'),
    detailClose: document.querySelector('[data-my-service-detail-close]'),
    detailModalBody: document.querySelector('[data-my-service-detail-modal-body]'),
    editModal: document.querySelector('[data-my-service-edit-modal]'),
    editForm: document.querySelector('[data-my-service-edit-form]'),
    editProviderSkillSelect: document.querySelector('[data-edit-provider-skill-select]'),
    editProviderSkillAdd: document.querySelector('[data-edit-provider-skill-add]'),
    editProviderSkillChips: document.querySelector('[data-edit-provider-skill-chips]'),
    editOutputType: document.querySelector('[data-edit-output-type]'),
    editCurrency: document.querySelector('[data-edit-currency]'),
    editPrice: document.querySelector('[data-edit-price]'),
    editCoverInput: document.querySelector('[data-edit-cover-input]'),
    editCoverPreview: document.querySelector('[data-edit-cover-preview]'),
    editCoverRemove: document.querySelector('[data-edit-cover-remove]'),
    editCoverNote: document.querySelector('[data-edit-cover-note]'),
    revokeModal: document.querySelector('[data-my-service-revoke-modal]'),
    revokeCopy: document.querySelector('[data-my-service-revoke-copy]'),
    revokeConfirm: document.querySelector('[data-my-service-revoke-confirm]'),
  };

  const state = {
    profiles: [],
    selectedBotSlug: '',
    servicesPage: null,
    ordersPage: null,
    selectedServiceId: '',
    mutationResult: null,
    error: null,
    busy: false,
    servicesPageNumber: 1,
    servicesPageSize: 20,
    ordersPageNumber: 1,
    ordersPageSize: 10,
    servicesLoadToken: 0,
    ordersLoadToken: 0,
    editServiceId: '',
    revokeServiceId: '',
    editCoverDataUrl: '',
    editCoverUri: '',
    editCoverPreviewUri: '',
    editCoverRemoved: false,
    editSkillOptions: [],
    editSelectedProviderSkillValues: [],
    editCandidateProviderSkillValue: '',
    botMenuOpen: false,
    detailModalOpener: null,
  };

  const escapeHtml = (value) => String(value || '')
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
  const countLabel = (pagination, oneKey, manyKey, oneFallback, manyFallback) => {
    const page = pagination || {};
    const currentPage = Math.max(1, Math.trunc(Number(page.page) || 1));
    const totalPages = Math.max(1, Math.trunc(Number(page.totalPages) || 1));
    const total = Math.max(0, Math.trunc(Number(page.total) || 0));
    const noun = total === 1
      ? uiText(oneKey, oneFallback)
      : uiText(manyKey, manyFallback);
    return currentPage + ' / ' + totalPages + ' · ' + total + ' ' + noun;
  };
  const knownTextKeys = {
    'Free': 'services.free',
    'Prepaid': 'services.prepaid',
    'No price': 'services.noPrice',
    'No payment': 'services.noPayment',
    'No rating': 'services.noRating',
    'Success': 'services.success',
    'Refunded': 'services.refunded',
    'Gross': 'services.gross',
    'Net': 'services.net',
    'Rating': 'services.rating',
    'Completed': 'services.completed',
    'Runtime unavailable': 'services.runtimeUnavailable',
    'Unknown buyer': 'services.unknownBuyer',
    'No session': 'services.noSession',
    'Trace unavailable': 'services.traceUnavailable',
    'Unbound skill': 'services.unboundSkill',
    'Unknown MetaBot': 'services.unknownMetaBot',
    'Unknown': 'services.unknown',
  };
  const localizeKnownText = (value) => {
    const text = String(value == null ? '' : value);
    const key = knownTextKeys[text];
    return key ? uiText(key, text) : text;
  };

  const normalizeTextClient = (value) => String(value || '').trim();
  const profileSlug = (profile) => normalizeTextClient(profile && profile.slug);
  const selectedBotProfile = () => state.profiles.find((profile) => profileSlug(profile) === state.selectedBotSlug) || null;
  const getServiceItems = () => Array.isArray(state.servicesPage && state.servicesPage.items) ? state.servicesPage.items : [];
  const getSelectedRawService = () => {
    const serviceId = state.editServiceId || state.revokeServiceId || state.selectedServiceId;
    return getServiceItems().find((service) => (
      normalizeTextClient(service && (service.currentPinId || service.id)) === serviceId
      || normalizeTextClient(service && service.sourceServicePinId) === serviceId
    )) || null;
  };
  const buildModel = () => buildMyServicesPageViewModel({
    servicesPage: state.servicesPage,
    ordersPage: state.ordersPage,
    selectedServiceId: state.selectedServiceId,
    mutationResult: state.mutationResult,
    error: state.error,
  });
  const findModelService = (model, serviceId) => model.services.find((service) => (
    service.currentPinId === serviceId || service.id === serviceId || service.sourceServicePinId === serviceId
  )) || null;

  const fetchJson = async (url, options) => {
    const response = await fetch(url, options || {});
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || 'Request failed.');
    }
    return payload.data;
  };

  const fromQuery = () => new URLSearchParams((typeof window !== 'undefined' && window.location && window.location.search) || '').get('from') || '';
  const setUrlState = () => {
    if (typeof window === 'undefined' || !window.history || !window.location || !state.selectedBotSlug) return;
    const next = new URLSearchParams(window.location.search || '');
    next.set('from', state.selectedBotSlug);
    const suffix = next.toString();
    window.history.replaceState(null, '', window.location.pathname + (suffix ? '?' + suffix : ''));
  };
  const syncActionLinks = () => {
    const suffix = state.selectedBotSlug ? '?from=' + encodeURIComponent(state.selectedBotSlug) : '';
    if (elements.publish) elements.publish.setAttribute('href', '/ui/publish' + suffix);
    if (elements.refunds) elements.refunds.setAttribute('href', '/ui/refund' + suffix);
  };
  const chooseSelectedBot = () => {
    const querySlug = normalizeTextClient(fromQuery());
    const queryProfile = state.profiles.find((profile) => profileSlug(profile) === querySlug);
    const activeProfile = state.profiles.find((profile) => profile && profile.isActive === true);
    const selected = queryProfile || activeProfile || state.profiles[0] || null;
    state.selectedBotSlug = profileSlug(selected);
    setUrlState();
    syncActionLinks();
  };
  const profileAvatarMarkup = (profile) => {
    const avatar = profile && profile.avatar;
    const avatarValue = normalizeTextClient(profile && (profile.avatarDataUrl || profile.avatarUri || profile.avatarUrl || profile.avatarImage || (typeof avatar === 'string' ? avatar : '')));
    const label = normalizeTextClient(profile && profile.name) || profileSlug(profile) || 'Bot';
    const fallback = normalizeTextClient(avatar && typeof avatar === 'object' && avatar.label) || label.slice(0, 2).toUpperCase() || 'BT';
    return avatarValue
      ? '<img class="avatar" src="' + escapeHtml(avatarValue) + '" alt="" loading="lazy" />'
      : '<span class="avatar">' + escapeHtml(fallback) + '</span>';
  };
  const renderBotPicker = () => {
    if (!elements.botCurrent || !elements.botMenu || !elements.botTrigger) return;
    const selected = selectedBotProfile();
    elements.botCurrent.innerHTML = selected
      ? profileAvatarMarkup(selected) + '<span>' + escapeHtml(normalizeTextClient(selected.name) || state.selectedBotSlug) + '</span>'
      : '<span>' + escapeHtml(uiText('services.noLocalBot', 'No local Bot')) + '</span>';
    elements.botTrigger.disabled = state.profiles.length === 0;
    elements.botMenu.innerHTML = state.profiles.map((profile) => {
      const slug = profileSlug(profile);
      return '<button type="button" class="services-bot-option" role="option" data-services-bot-option data-bot-slug="' + escapeHtml(slug) + '" data-selected="' + (slug === state.selectedBotSlug ? 'true' : 'false') + '" aria-selected="' + (slug === state.selectedBotSlug ? 'true' : 'false') + '">'
        + profileAvatarMarkup(profile)
        + '<span>' + escapeHtml(normalizeTextClient(profile && profile.name) || slug) + '</span>'
        + '</button>';
    }).join('');
    elements.botMenu.hidden = !state.botMenuOpen;
    elements.botTrigger.setAttribute('aria-expanded', state.botMenuOpen ? 'true' : 'false');
  };

  const closeBotMenu = () => {
    state.botMenuOpen = false;
    renderBotPicker();
  };

  const toggleBotMenu = () => {
    if (!state.profiles.length) return;
    state.botMenuOpen = !state.botMenuOpen;
    renderBotPicker();
  };

  const resetSelectedServiceState = () => {
    state.servicesPage = null;
    state.ordersPage = null;
    state.selectedServiceId = '';
    state.ordersPageNumber = 1;
    state.servicesLoadToken += 1;
    state.ordersLoadToken += 1;
    state.editServiceId = '';
    state.revokeServiceId = '';
    state.mutationResult = null;
  };

  const selectBot = async (slug) => {
    const nextSlug = normalizeTextClient(slug);
    if (!nextSlug || nextSlug === state.selectedBotSlug) {
      closeBotMenu();
      return;
    }
    state.selectedBotSlug = nextSlug;
    state.servicesPageNumber = 1;
    resetSelectedServiceState();
    closeBotMenu();
    setUrlState();
    syncActionLinks();
    render();
    await loadServices(false);
  };

  const renderNotice = (model) => {
    if (!elements.notice) return;
    const notice = model.notice;
    if (!notice) {
      elements.notice.hidden = true;
      elements.notice.innerHTML = '';
      return;
    }
    elements.notice.hidden = false;
    elements.notice.dataset.tone = notice.tone;
    const txids = notice.txids.map((txid) => (
      '<div class="notice-tx"><code>' + escapeHtml(txid) + '</code><button class="btn btn-sm" type="button" data-copy-value="' + escapeHtml(txid) + '">' + escapeHtml(uiText('services.copy', 'Copy')) + '</button></div>'
    )).join('');
    elements.notice.innerHTML = '<div><strong>' + escapeHtml(notice.title) + '</strong><p>' + escapeHtml(notice.message) + '</p></div>'
      + (notice.pinId ? '<code>' + escapeHtml(notice.pinId) + '</code>' : '')
      + txids;
  };

  const renderServices = (model) => {
    if (elements.pageLabel) elements.pageLabel.textContent = countLabel(model.pagination, 'services.pageNounOne', 'services.pageNounMany', 'service', 'services');
    if (elements.listCount) elements.listCount.textContent = String(model.pagination.total);
    if (elements.servicesPagePrev) {
      elements.servicesPagePrev.hidden = !model.pagination.canPrevious;
      elements.servicesPagePrev.disabled = !model.pagination.canPrevious;
    }
    if (elements.servicesPageNext) {
      elements.servicesPageNext.hidden = !model.pagination.canNext;
      elements.servicesPageNext.disabled = !model.pagination.canNext;
    }
    if (!elements.list) return;
    if (!model.services.length) {
      elements.list.innerHTML = '<div class="ledger-empty"><strong>' + escapeHtml(uiText('services.noPublishedServicesTitle', model.emptyState.title)) + '</strong><p>' + escapeHtml(uiText('services.noPublishedServicesMessage', model.emptyState.message)) + '</p></div>';
      return;
    }
    elements.list.innerHTML = model.services.map((service) => {
      const selected = service.currentPinId === state.selectedServiceId ? ' data-selected="true"' : '';
      const metrics = service.metrics.map((metric) => (
        '<div class="service-metric"><span>' + escapeHtml(localizeKnownText(metric.label)) + '</span><strong>' + escapeHtml(localizeKnownText(metric.value)) + '</strong></div>'
      )).join('');
      const icon = service.iconUri
        ? '<img alt="" src="' + escapeHtml(service.iconUri) + '" />'
        : '<span>' + escapeHtml(service.iconLabel) + '</span>';
      return '<article class="service-row"' + selected + ' data-service-row="' + escapeHtml(service.currentPinId) + '">'
        + '<div class="service-cover">' + icon + '</div>'
        + '<div class="service-main">'
        + '<div class="service-title-line"><h3><button class="service-title-button" type="button" data-service-title-action="details" data-service-id="' + escapeHtml(service.currentPinId) + '">' + escapeHtml(service.title) + '</button></h3><span>' + escapeHtml(localizeKnownText(service.priceLabel)) + '</span></div>'
        + '<p>' + escapeHtml(service.description || service.serviceName) + '</p>'
        + '<div class="service-meta"><span>' + escapeHtml(localizeKnownText(service.skillLabel)) + '</span><span>' + escapeHtml(service.outputTypeLabel) + '</span><span>' + escapeHtml(localizeKnownText(service.creatorLabel)) + '</span><span>' + escapeHtml(localizeKnownText(service.updatedAtLabel)) + '</span></div>'
        + '<div class="service-metrics">' + metrics + '</div>'
        + '</div>'
        + '<div class="service-actions">'
        + '<button class="btn btn-sm" type="button" data-service-action="details" data-service-id="' + escapeHtml(service.currentPinId) + '">' + escapeHtml(uiText('services.details', 'Details')) + '</button>'
        + '<button class="btn btn-sm" type="button" data-service-action="edit" data-service-id="' + escapeHtml(service.currentPinId) + '"' + (service.canModify ? '' : ' disabled') + '>' + escapeHtml(uiText('services.edit', 'Edit')) + '</button>'
        + '<button class="btn btn-sm btn-danger" type="button" data-service-action="revoke" data-service-id="' + escapeHtml(service.currentPinId) + '"' + (service.canRevoke ? '' : ' disabled') + '>' + escapeHtml(uiText('services.revoke', 'Revoke')) + '</button>'
        + (service.blockedReason ? '<small>' + escapeHtml(service.blockedReason) + '</small>' : '')
        + '</div>'
        + '</article>';
    }).join('');
  };

  const renderDetail = (model) => {
    if (elements.orderPageLabel) elements.orderPageLabel.textContent = countLabel(model.orderPagination, 'services.orderNounOne', 'services.orderNounMany', 'order', 'orders');
    if (elements.ordersPagePrev) elements.ordersPagePrev.disabled = !model.orderPagination.canPrevious || !model.selectedService;
    if (elements.ordersPageNext) elements.ordersPageNext.disabled = !model.orderPagination.canNext || !model.selectedService;
    if (!elements.detailModalBody) return;
    const selected = model.selectedService;
    if (!selected) {
      elements.detailModalBody.innerHTML = '<div class="ledger-empty"><strong>' + escapeHtml(uiText('services.noServiceSelectedTitle', 'No service selected')) + '</strong><p>' + escapeHtml(uiText('services.noServiceSelectedMessage', 'Select a service to inspect orders and lifecycle actions.')) + '</p></div>';
      return;
    }
    const summaryHtml = '<div class="my-service-detail-summary"><div class="detail-heading"><div><h3>' + escapeHtml(selected.title) + '</h3><p>' + escapeHtml(selected.description || selected.serviceName) + '</p></div>'
      + '<div class="detail-actions">'
      + '<button class="btn btn-sm" type="button" data-service-action="edit" data-service-id="' + escapeHtml(selected.currentPinId) + '"' + (selected.canModify ? '' : ' disabled') + '>' + escapeHtml(uiText('services.edit', 'Edit')) + '</button>'
      + '<button class="btn btn-sm btn-danger" type="button" data-service-action="revoke" data-service-id="' + escapeHtml(selected.currentPinId) + '"' + (selected.canRevoke ? '' : ' disabled') + '>' + escapeHtml(uiText('services.revoke', 'Revoke')) + '</button>'
      + '</div></div>'
      + '<dl class="detail-fields">'
      + '<div><dt>' + escapeHtml(uiText('services.currentPin', 'Current Pin')) + '</dt><dd>' + escapeHtml(selected.currentPinId) + '</dd></div>'
      + '<div><dt>' + escapeHtml(uiText('services.sourcePin', 'Source Pin')) + '</dt><dd>' + escapeHtml(selected.sourceServicePinId) + '</dd></div>'
      + '<div><dt>' + escapeHtml(uiText('services.skill', 'Skill')) + '</dt><dd>' + escapeHtml(selected.skillLabel) + '</dd></div>'
      + '<div><dt>' + escapeHtml(uiText('services.price', 'Price')) + '</dt><dd>' + escapeHtml(selected.priceLabel) + '</dd></div>'
      + '</dl></div>';

    if (!model.orders.length) {
      elements.detailModalBody.innerHTML = summaryHtml + '<div class="ledger-empty"><strong>' + escapeHtml(uiText('services.noClosedOrdersTitle', model.orderEmptyState.title)) + '</strong><p>' + escapeHtml(uiText('services.noClosedOrdersMessage', model.orderEmptyState.message)) + '</p></div>';
      return;
    }
    const ordersHtml = model.orders.map((order) => (
      '<article class="order-row">'
      + '<div><strong>' + escapeHtml(localizeKnownText(order.statusLabel)) + '</strong><p>' + escapeHtml(localizeKnownText(order.buyerLabel)) + '</p><p class="mono-text">' + escapeHtml(order.timeLabel) + '</p></div>'
      + '<div><span>' + escapeHtml(uiText('services.payment', 'Payment')) + '</span><p class="mono-text">' + escapeHtml(localizeKnownText(order.paymentLabel)) + '</p><p class="mono-text">' + escapeHtml(order.orderTxid) + '</p></div>'
      + '<div><span>' + escapeHtml(uiText('services.rating', 'Rating')) + '</span><p>' + escapeHtml(localizeKnownText(order.ratingLabel)) + '</p>' + (order.ratingComment ? '<p>' + escapeHtml(order.ratingComment) + '</p>' : '') + (order.ratingPinId ? '<p class="mono-text">' + escapeHtml(order.ratingPinId) + '</p>' : '') + '</div>'
      + '<div><span>' + escapeHtml(uiText('services.runtime', 'Runtime')) + '</span><p class="mono-text">' + escapeHtml(localizeKnownText(order.runtimeLabel)) + '</p><p class="mono-text">' + escapeHtml(localizeKnownText(order.sessionLabel)) + '</p></div>'
      + '<div class="order-actions">'
      + '<a class="btn btn-sm" href="' + escapeHtml(order.traceHref) + '">' + escapeHtml(uiText(ORDER_TRACE_ACTION_KEY, ORDER_TRACE_ACTION_LABEL)) + '</a>'
      + (order.sessionHref ? '<a class="btn btn-sm" href="' + escapeHtml(order.sessionHref) + '">' + escapeHtml(uiText(ORDER_SESSION_ACTION_KEY, ORDER_SESSION_ACTION_LABEL)) + '</a>' : '')
      + '</div>'
      + '</article>'
    )).join('');
    elements.detailModalBody.innerHTML = summaryHtml + '<div class="my-service-orders">' + ordersHtml + '</div>';
  };

  const render = () => {
    const model = buildModel();
    renderBotPicker();
    renderNotice(model);
    renderServices(model);
    renderDetail(model);
  };

  const loadOrders = async (serviceId, refresh) => {
    const loadToken = ++state.ordersLoadToken;
    const selectedBotSlug = state.selectedBotSlug;
    if (!serviceId) {
      state.ordersPage = null;
      render();
      return;
    }
    const isStaleLoad = () => loadToken !== state.ordersLoadToken || state.selectedServiceId !== serviceId || state.selectedBotSlug !== selectedBotSlug;
    const fetchOrdersPage = () => fetchJson('/api/services/owned/orders?serviceId=' + encodeURIComponent(serviceId) + '&from=' + encodeURIComponent(selectedBotSlug) + '&page=' + encodeURIComponent(String(state.ordersPageNumber)) + '&pageSize=' + encodeURIComponent(String(state.ordersPageSize)) + '&refresh=' + (refresh ? 'true' : 'false'));
    state.ordersPage = null;
    render();
    let ordersPage;
    try {
      ordersPage = await fetchOrdersPage();
    } catch (error) {
      if (isStaleLoad()) return;
      throw error;
    }
    if (isStaleLoad()) return;
    state.ordersPage = ordersPage;
    const totalPages = Number(ordersPage && ordersPage.totalPages) || 0;
    if (state.ordersPageNumber > 1 && totalPages > 0 && state.ordersPageNumber > totalPages) {
      state.ordersPageNumber = totalPages;
      let adjustedOrdersPage;
      try {
        adjustedOrdersPage = await fetchOrdersPage();
      } catch (error) {
        if (isStaleLoad()) return;
        throw error;
      }
      if (isStaleLoad()) return;
      state.ordersPage = adjustedOrdersPage;
    }
    render();
  };

  const loadServices = async (refresh) => {
    const loadToken = ++state.servicesLoadToken;
    const selectedBotSlug = state.selectedBotSlug;
    state.error = null;
    if (!selectedBotSlug) {
      throw new Error(uiText('services.noLocalBotAvailable', 'No local Bot profile is available for Services.'));
    }
    const isStaleLoad = () => loadToken !== state.servicesLoadToken || state.selectedBotSlug !== selectedBotSlug;
    const fetchServicesPage = () => fetchJson('/api/services/owned?from=' + encodeURIComponent(selectedBotSlug) + '&page=' + encodeURIComponent(String(state.servicesPageNumber)) + '&pageSize=' + encodeURIComponent(String(state.servicesPageSize)) + '&refresh=' + (refresh ? 'true' : 'false'));
    let servicesPage;
    try {
      servicesPage = await fetchServicesPage();
    } catch (error) {
      if (isStaleLoad()) return;
      throw error;
    }
    if (isStaleLoad()) return;
    state.servicesPage = servicesPage;
    const totalPages = Number(state.servicesPage && state.servicesPage.totalPages) || 0;
    if (state.servicesPageNumber > 1 && totalPages > 0 && state.servicesPageNumber > totalPages) {
      state.servicesPageNumber = totalPages;
      let adjustedServicesPage;
      try {
        adjustedServicesPage = await fetchServicesPage();
      } catch (error) {
        if (isStaleLoad()) return;
        throw error;
      }
      if (isStaleLoad()) return;
      state.servicesPage = adjustedServicesPage;
    }
    const items = getServiceItems();
    const hasSelected = items.some((service) => normalizeTextClient(service && (service.currentPinId || service.id)) === state.selectedServiceId);
    if (!state.selectedServiceId || !hasSelected) {
      state.selectedServiceId = normalizeTextClient(items[0] && (items[0].currentPinId || items[0].id));
      state.ordersPageNumber = 1;
    }
    await loadOrders(state.selectedServiceId, refresh);
  };

  const loadProfiles = async () => {
    const data = await fetchJson('/api/bot/profiles');
    state.profiles = Array.isArray(data && data.profiles)
      ? data.profiles.filter((profile) => profileSlug(profile))
      : [];
    chooseSelectedBot();
    renderBotPicker();
  };

  const initialize = async () => {
    await loadProfiles();
    await loadServices(false);
  };

  const setError = (error) => {
    state.error = { message: error instanceof Error ? error.message : String(error) };
    render();
  };

  const validateEditPayload = (payload) => {
    if (payload.paymentTiming !== 'free' && payload.paymentTiming !== 'prepaid') {
      return uiText('services.paymentTimingInvalid', 'Payment timing must be free or prepaid.');
    }
    if (!/^\\d+(?:\\.\\d+)?$/u.test(payload.price) || !Number.isFinite(Number(payload.price)) || Number(payload.price) < 0) {
      return uiText('services.priceInvalid', 'Price must be a non-negative decimal number.');
    }
    if (payload.paymentTiming === 'prepaid' && Number(payload.price) <= 0) {
      return uiText('services.prepaidPriceInvalid', 'Prepaid service price must be greater than zero.');
    }
    return '';
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(uiText('services.coverReadFailed', 'Cover image could not be read.')));
    reader.readAsDataURL(file);
  });

  const renderEditCover = () => {
    if (!elements.editCoverPreview) return;
    const source = state.editCoverDataUrl || state.editCoverPreviewUri || state.editCoverUri;
    elements.editCoverPreview.innerHTML = source
      ? '<img alt="" src="' + escapeHtml(source) + '" />'
      : '<span>IMG</span>';
  };

  const populateSelect = (select, options, selected) => {
    if (!select) return;
    select.innerHTML = options.map((option) => (
      '<option value="' + escapeHtml(option.value || option) + '"' + ((option.value || option) === selected ? ' selected' : '') + '>' + escapeHtml(option.label || option) + '</option>'
    )).join('');
  };

  const normalizeEditSkillValues = (values) => {
    const seen = new Set();
    const normalized = [];
    for (const value of Array.isArray(values) ? values : [values]) {
      const skillValue = normalizeTextClient(value);
      if (!skillValue || seen.has(skillValue)) continue;
      seen.add(skillValue);
      normalized.push(skillValue);
    }
    return normalized;
  };

  const selectedEditSkillValues = () => normalizeEditSkillValues(state.editSelectedProviderSkillValues);

  const renderEditSkillPicker = (options, selectedValues) => {
    if (!elements.editProviderSkillSelect || !elements.editProviderSkillAdd || !elements.editProviderSkillChips) return;
    const normalizedSelected = normalizeEditSkillValues(selectedValues);
    const optionByValue = new Map();
    for (const option of Array.isArray(options) ? options : []) {
      const value = normalizeTextClient(option.value || option);
      const label = normalizeTextClient(option.label || option) || value;
      if (!value || optionByValue.has(value)) continue;
      optionByValue.set(value, { value, label });
    }
    for (const value of normalizedSelected) {
      if (!optionByValue.has(value)) {
        optionByValue.set(value, { value, label: value });
      }
    }
    const normalizedOptions = Array.from(optionByValue.values());
    state.editSkillOptions = normalizedOptions;
    state.editSelectedProviderSkillValues = normalizedSelected;

    if (!normalizedOptions.length) {
      elements.editProviderSkillSelect.innerHTML = '<option value="">' + escapeHtml(uiText('services.noRuntimeSkills', 'No primary runtime skills available')) + '</option>';
      elements.editProviderSkillSelect.disabled = true;
      elements.editProviderSkillAdd.disabled = true;
      elements.editProviderSkillChips.innerHTML = '<p class="field-hint">' + escapeHtml(uiText('services.noRuntimeSkillsSentence', 'No primary runtime skills available.')) + '</p>';
      return;
    }

    const selected = new Set(normalizedSelected);
    const addableOptions = normalizedOptions.filter((option) => !selected.has(option.value));
    if (!addableOptions.some((option) => option.value === state.editCandidateProviderSkillValue)) {
      state.editCandidateProviderSkillValue = '';
    }
    elements.editProviderSkillSelect.innerHTML = '<option value="">' + escapeHtml(uiText('services.selectSkillToAdd', 'Select a skill to add')) + '</option>' + addableOptions.map((option) => (
      '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>'
    )).join('');
    elements.editProviderSkillSelect.value = state.editCandidateProviderSkillValue;
    elements.editProviderSkillSelect.disabled = addableOptions.length === 0;
    elements.editProviderSkillAdd.disabled = !state.editCandidateProviderSkillValue;

    elements.editProviderSkillChips.innerHTML = normalizedSelected.length
      ? normalizedSelected.map((value) => {
          const option = optionByValue.get(value) || { value, label: value };
          return '<span class="skill-chip">'
            + '<span title="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</span>'
            + '<button type="button" aria-label="' + escapeHtml(uiText('services.remove', 'Remove') + ' ' + option.value) + '" title="' + escapeHtml(uiText('services.remove', 'Remove')) + '" data-edit-provider-skill-remove="' + escapeHtml(option.value) + '">x</button>'
            + '</span>';
        }).join('')
      : '<p class="field-hint">' + escapeHtml(uiText('services.noSkillSelected', 'No skill selected.')) + '</p>';
  };

  const selectedEditPaymentTiming = () => {
    if (!elements.editForm) return 'prepaid';
    const formData = new FormData(elements.editForm);
    const timing = normalizeTextClient(formData.get('paymentTiming')).toLowerCase();
    return timing === 'free' ? 'free' : 'prepaid';
  };

  const syncEditPaymentTimingFields = () => {
    if (!elements.editPrice) return;
    const isFree = selectedEditPaymentTiming() === 'free';
    if (isFree) {
      elements.editPrice.value = '0';
    }
    elements.editPrice.disabled = isFree;
  };

  const openEdit = async (serviceId) => {
    state.selectedServiceId = serviceId;
    state.editServiceId = serviceId;
    state.editCoverDataUrl = '';
    state.editCoverRemoved = false;
    state.editSelectedProviderSkillValues = [];
    state.editCandidateProviderSkillValue = '';
    const model = buildModel();
    const service = findModelService(model, serviceId);
    const raw = getSelectedRawService();
    if (!service || !model.editForm || !elements.editForm) return;
    state.editCoverUri = model.editForm.serviceIconUri;
    state.editCoverPreviewUri = model.editForm.serviceIconPreviewUri;
    elements.editForm.elements.displayName.value = model.editForm.displayName;
    elements.editForm.elements.serviceName.value = model.editForm.serviceName;
    elements.editForm.elements.description.value = model.editForm.description;
    elements.editForm.elements.executionReminder.value = model.editForm.executionReminder;
    elements.editForm.elements.price.value = model.editForm.price;
    const paymentTimingInput = elements.editForm.querySelector('input[name="paymentTiming"][value="' + model.editForm.paymentTiming + '"]');
    if (paymentTimingInput) paymentTimingInput.checked = true;
    populateSelect(elements.editCurrency, model.currencyOptions, model.editForm.currency);
    populateSelect(elements.editOutputType, model.outputTypeOptions, model.editForm.outputType);
    state.editSelectedProviderSkillValues = normalizeEditSkillValues(model.editForm.providerSkills);
    renderEditSkillPicker(model.editForm.providerSkills.map((skill) => ({ value: skill, label: skill })), state.editSelectedProviderSkillValues);
    syncEditPaymentTimingFields();
    renderEditCover();
    if (elements.editModal) elements.editModal.hidden = false;

    const slug = normalizeTextClient(raw && raw.creatorMetabotSlug);
    if (slug) {
      try {
        const data = await fetchJson('/api/services/skills?from=' + encodeURIComponent(slug));
        const skills = Array.isArray(data.skills) ? data.skills.map((skill) => ({
          value: normalizeTextClient(skill && skill.skillName),
          label: normalizeTextClient(skill && (skill.title || skill.skillName)),
        })).filter((skill) => skill.value) : [];
        for (const providerSkill of model.editForm.providerSkills) {
          if (!skills.some((skill) => skill.value === providerSkill)) {
            skills.unshift({ value: providerSkill, label: providerSkill });
          }
        }
        renderEditSkillPicker(skills, state.editSelectedProviderSkillValues);
      } catch (error) {
        if (elements.editCoverNote) {
          elements.editCoverNote.textContent = error instanceof Error ? error.message : String(error);
        }
      }
    }
  };

  const closeEdit = () => {
    if (elements.editModal) elements.editModal.hidden = true;
    state.editServiceId = '';
    state.editCoverDataUrl = '';
    state.editCoverPreviewUri = '';
    state.editCoverRemoved = false;
    state.editSelectedProviderSkillValues = [];
    state.editCandidateProviderSkillValue = '';
    state.editSkillOptions = [];
  };

  const openRevoke = (serviceId) => {
    state.revokeServiceId = serviceId;
    const model = buildModel();
    const service = findModelService(model, serviceId);
    if (elements.revokeCopy) {
      elements.revokeCopy.textContent = service
        ? uiText('services.revokeSpecificCopy', 'Revoke {title} at {pinId}.', { title: service.title, pinId: service.currentPinId })
        : uiText('services.revokeDefaultCopy', 'This will broadcast a MetaID revoke operation.');
    }
    if (elements.revokeModal) elements.revokeModal.hidden = false;
  };

  const closeRevoke = () => {
    if (elements.revokeModal) elements.revokeModal.hidden = true;
    state.revokeServiceId = '';
  };

  const focusElement = (element) => {
    if (element && typeof element.focus === 'function') {
      element.focus();
    }
  };

  const setDetailModalLock = (locked) => {
    if (typeof document === 'undefined' || !document.body || !document.body.classList) return;
    document.body.classList[locked ? 'add' : 'remove']('my-services-modal-open');
  };

  const openDetail = async (serviceId, opener) => {
    state.selectedServiceId = serviceId;
    state.ordersPageNumber = 1;
    state.mutationResult = null;
    state.detailModalOpener = opener || null;
    closeBotMenu();
    if (elements.detailModal) elements.detailModal.hidden = false;
    setDetailModalLock(true);
    focusElement(elements.detailClose);
    try {
      await loadOrders(serviceId, false);
    } catch (error) {
      setError(error);
    }
  };

  const closeDetail = () => {
    if (!elements.detailModal || elements.detailModal.hidden) return;
    elements.detailModal.hidden = true;
    setDetailModalLock(false);
    const opener = state.detailModalOpener;
    state.detailModalOpener = null;
    focusElement(opener);
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const raw = getSelectedRawService();
    const from = normalizeTextClient(raw && raw.creatorMetabotSlug);
    const paymentTiming = selectedEditPaymentTiming();
    const payload = {
      serviceId: state.editServiceId,
      ...(from ? { from } : {}),
      displayName: normalizeTextClient(formData.get('displayName')),
      serviceName: normalizeTextClient(formData.get('serviceName')),
      description: normalizeTextClient(formData.get('description')),
      executionReminder: normalizeTextClient(formData.get('executionReminder')),
      providerSkills: selectedEditSkillValues(),
      outputType: normalizeTextClient(formData.get('outputType')),
      paymentTiming,
      settlementKind: normalizeTextClient(raw && raw.settlementKind).toLowerCase() || 'native',
      price: paymentTiming === 'free' ? '0' : normalizeTextClient(formData.get('price')),
      currency: normalizeTextClient(formData.get('currency')),
      serviceIconUri: state.editCoverDataUrl ? '' : state.editCoverUri,
      serviceIconDataUrl: state.editCoverDataUrl,
      removeServiceIcon: state.editCoverRemoved,
    };
    const validationError = validateEditPayload(payload);
    if (validationError) {
      setError(new Error(validationError));
      return;
    }
    try {
      state.mutationResult = await fetchJson('/api/services/owned/modify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      closeEdit();
      await loadServices(true);
    } catch (error) {
      setError(error);
    }
  };

  const confirmRevoke = async () => {
    if (!state.revokeServiceId) return;
    try {
      const raw = getSelectedRawService();
      const from = normalizeTextClient(raw && raw.creatorMetabotSlug);
      state.mutationResult = await fetchJson('/api/services/owned/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceId: state.revokeServiceId, ...(from ? { from } : {}) }),
      });
      closeRevoke();
      state.selectedServiceId = '';
      await loadServices(true);
    } catch (error) {
      setError(error);
    }
  };

  document.addEventListener('click', async (event) => {
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (state.botMenuOpen && eventTarget && !eventTarget.closest('[data-services-bot-picker]')) {
      closeBotMenu();
    }
    if (eventTarget && elements.detailModal && eventTarget === elements.detailModal && !elements.detailModal.hidden) {
      closeDetail();
      return;
    }
    const target = eventTarget ? eventTarget.closest('[data-services-bot-trigger], [data-services-bot-option], [data-service-action], [data-service-title-action], [data-copy-value], [data-my-services-refresh], [data-services-page-prev], [data-services-page-next], [data-orders-page-prev], [data-orders-page-next], [data-my-service-detail-close], [data-my-service-edit-close], [data-my-service-revoke-close], [data-edit-provider-skill-add], [data-edit-provider-skill-remove]') : null;
    if (!target) {
      return;
    }
    if (target.matches('[data-services-bot-trigger]')) {
      toggleBotMenu();
      return;
    }
    if (target.matches('[data-services-bot-option]')) {
      try {
        await selectBot(target.getAttribute('data-bot-slug') || target.getAttribute('data-services-bot-option') || '');
      } catch (error) {
        setError(error);
      }
      return;
    }
    if (target.matches('[data-edit-provider-skill-add]')) {
      const candidate = normalizeTextClient(state.editCandidateProviderSkillValue);
      const exists = state.editSkillOptions.some((option) => option.value === candidate);
      if (candidate && exists && !selectedEditSkillValues().includes(candidate)) {
        state.editSelectedProviderSkillValues = normalizeEditSkillValues([...selectedEditSkillValues(), candidate]);
        state.editCandidateProviderSkillValue = '';
        renderEditSkillPicker(state.editSkillOptions, state.editSelectedProviderSkillValues);
      }
      return;
    }
    if (target.matches('[data-edit-provider-skill-remove]')) {
      const skillValue = normalizeTextClient(target.getAttribute('data-edit-provider-skill-remove'));
      state.editSelectedProviderSkillValues = selectedEditSkillValues().filter((value) => value !== skillValue);
      renderEditSkillPicker(state.editSkillOptions, state.editSelectedProviderSkillValues);
      return;
    }
    if (target.matches('[data-my-services-refresh]')) {
      try {
        await loadServices(true);
      } catch (error) {
        setError(error);
      }
      return;
    }
    if (target.matches('[data-my-service-edit-close]')) {
      closeEdit();
      return;
    }
    if (target.matches('[data-my-service-revoke-close]')) {
      closeRevoke();
      return;
    }
    if (target.matches('[data-my-service-detail-close]')) {
      closeDetail();
      return;
    }
    if (target.matches('[data-services-page-prev]') || target.matches('[data-services-page-next]')) {
      const delta = target.matches('[data-services-page-prev]') ? -1 : 1;
      state.servicesPageNumber = Math.max(1, state.servicesPageNumber + delta);
      state.mutationResult = null;
      try {
        await loadServices(false);
      } catch (error) {
        setError(error);
      }
      return;
    }
    if (target.matches('[data-orders-page-prev]') || target.matches('[data-orders-page-next]')) {
      const delta = target.matches('[data-orders-page-prev]') ? -1 : 1;
      state.ordersPageNumber = Math.max(1, state.ordersPageNumber + delta);
      state.mutationResult = null;
      try {
        await loadOrders(state.selectedServiceId, false);
      } catch (error) {
        setError(error);
      }
      return;
    }
    const copyValue = target.getAttribute('data-copy-value');
    if (copyValue) {
      await navigator.clipboard?.writeText(copyValue).catch(() => undefined);
      target.textContent = uiText('services.copied', 'Copied');
      return;
    }
    const action = target.getAttribute('data-service-action') || target.getAttribute('data-service-title-action');
    const serviceId = target.getAttribute('data-service-id') || '';
    if (action === 'details') {
      await openDetail(serviceId, target);
    }
    if (action === 'edit') {
      await openEdit(serviceId);
    }
    if (action === 'revoke') {
      openRevoke(serviceId);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.botMenuOpen) {
      closeBotMenu();
    }
    if (event.key === 'Escape' && elements.detailModal && !elements.detailModal.hidden) {
      closeDetail();
    }
  });

  if (elements.editForm) {
    elements.editForm.addEventListener('submit', submitEdit);
    elements.editForm.addEventListener('change', (event) => {
      const target = event.target;
      if (target && target.name === 'paymentTiming') {
        syncEditPaymentTimingFields();
      }
    });
  }
  if (elements.editProviderSkillSelect) {
    elements.editProviderSkillSelect.addEventListener('change', () => {
      state.editCandidateProviderSkillValue = normalizeTextClient(elements.editProviderSkillSelect.value);
      renderEditSkillPicker(state.editSkillOptions, state.editSelectedProviderSkillValues);
    });
  }
  if (elements.editCoverInput) {
    elements.editCoverInput.addEventListener('change', async () => {
      const file = elements.editCoverInput.files && elements.editCoverInput.files[0];
      if (!file) return;
      if (!ICON_MIME_TYPES.has(file.type) || file.size > ICON_MAX_BYTES) {
        if (elements.editCoverNote) elements.editCoverNote.textContent = uiText('services.coverImageInvalid', 'Cover image must be a supported image of 2MB or less.');
        elements.editCoverInput.value = '';
        return;
      }
      state.editCoverDataUrl = await readFileAsDataUrl(file);
      state.editCoverRemoved = false;
      state.editCoverPreviewUri = '';
      renderEditCover();
    });
  }
  if (elements.editCoverRemove) {
    elements.editCoverRemove.addEventListener('click', () => {
      state.editCoverDataUrl = '';
      state.editCoverUri = '';
      state.editCoverPreviewUri = '';
      state.editCoverRemoved = true;
      if (elements.editCoverInput) elements.editCoverInput.value = '';
      renderEditCover();
    });
  }
  if (elements.revokeConfirm) {
    elements.revokeConfirm.addEventListener('click', confirmRevoke);
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('oac:i18n-changed', () => render());
  }

  initialize().catch(setError);
})();`,
  };
}
