import { createI18nContext } from '../../i18n';
import type { LocalUiI18nContext } from '../../i18n';
import type { LocalUiPageDefinition } from '../types';
import {
  METAAPP_CODE_TYPE_OPTIONS,
  METAAPP_CONTENT_TYPE_OPTIONS,
  METAAPP_METAFILE_REFERENCE_PATTERN,
} from '../../../core/metaapp/appsProtocol';

interface AppsPageRuntimeText {
  appNameLabel: string;
  assets: string;
  basicInformation: string;
  botFallback: string;
  cancel: string;
  close: string;
  copied: string;
  codeLabel: string;
  codeTypeLabel: string;
  contentHashLabel: string;
  contentLabel: string;
  contentTypeLabel: string;
  copyPinId: string;
  coverImgLabel: string;
  currentOption: string;
  details: string;
  disabled: string;
  disabledFieldHelp: string;
  disabledFieldLabel: string;
  deleteErrorTitle: string;
  deleteLabel: string;
  detailCreatedAt: string;
  detailChainData: string;
  detailFirstPinId: string;
  detailGlobalMetaId: string;
  detailModalDescription: string;
  detailModalTitle: string;
  detailOperation: string;
  detailOwnerAddress: string;
  detailPinId: string;
  detailProtocolFields: string;
  detailRawData: string;
  detailTabAI: string;
  detailTabDetails: string;
  detailTabRaw: string;
  detailTxid: string;
  detailTxids: string;
  detailUpdatedAt: string;
  edit: string;
  editModalDescription: string;
  editModalTitle: string;
  emptyMessage: string;
  emptyTitle: string;
  formErrorTitle: string;
  iconLabel: string;
  imageManualPinHelp: string;
  imageMultiPinPlaceholder: string;
  imageSinglePinPlaceholder: string;
  indexFileLabel: string;
  invalidPin: string;
  introImgsLabel: string;
  introLabel: string;
  loadErrorTitle: string;
  manualPinHelp: string;
  metadataInvalid: string;
  metadataLabel: string;
  metadataPlaceholder: string;
  multiPinPlaceholder: string;
  noLocalBotAvailable: string;
  noUploadResult: string;
  pageSizeLabel: string;
  promptLabel: string;
  publishModalDescription: string;
  publishModalTitle: string;
  publishOnChain: string;
  publishedByLabel: string;
  shareCopyLink: string;
  shareMetaAppUri: string;
  shareModalDescription: string;
  shareModalTitle: string;
  shareWebUrl: string;
  requestFailed: string;
  run: string;
  runtimeAndroid: string;
  runtimeBrowser: string;
  runtimeIos: string;
  runtimeLabel: string;
  runtimeLinux: string;
  runtimeMacOS: string;
  runtimeWindows: string;
  saveChanges: string;
  deleteConfirm: string;
  deleteModalDescription: string;
  deleteModalTitle: string;
  runnable: string;
  share: string;
  singlePinPlaceholder: string;
  tagsHelp: string;
  tagsLabel: string;
  technicalInformation: string;
  titleLabel: string;
  untitledMetaApp: string;
  upload: string;
  uploadFailed: string;
  uploadStored: string;
  versionLabel: string;
}

export function buildAppsPageDefinition(i18n: LocalUiI18nContext = createI18nContext()): LocalUiPageDefinition {
  const tx = i18n.t;
  const runtimeText: AppsPageRuntimeText = {
    appNameLabel: tx('apps.form.appName'),
    assets: tx('apps.form.assets'),
    basicInformation: tx('apps.form.basicInformation'),
    botFallback: tx('apps.botFallback'),
    cancel: tx('apps.form.cancel'),
    close: tx('apps.form.close'),
    copied: tx('apps.copied'),
    codeLabel: tx('apps.form.code'),
    codeTypeLabel: tx('apps.form.codeType'),
    contentHashLabel: tx('apps.form.contentHash'),
    contentLabel: tx('apps.form.content'),
    contentTypeLabel: tx('apps.form.contentType'),
    copyPinId: tx('apps.copyPinId'),
    coverImgLabel: tx('apps.form.coverImg'),
    currentOption: tx('apps.form.currentOption'),
    details: tx('apps.details'),
    disabled: tx('apps.disabled'),
    disabledFieldHelp: tx('apps.form.disabledHelp'),
    disabledFieldLabel: tx('apps.form.disabled'),
    deleteErrorTitle: tx('apps.delete.errorTitle'),
    deleteLabel: tx('apps.delete'),
    detailCreatedAt: tx('apps.detail.createdAt'),
    detailChainData: tx('apps.detail.chainData'),
    detailFirstPinId: tx('apps.detail.firstPinId'),
    detailGlobalMetaId: tx('apps.detail.globalMetaId'),
    detailModalDescription: tx('apps.detail.description'),
    detailModalTitle: tx('apps.detail.title'),
    detailOperation: tx('apps.detail.operation'),
    detailOwnerAddress: tx('apps.detail.ownerAddress'),
    detailPinId: tx('apps.detail.pinId'),
    detailProtocolFields: tx('apps.detail.protocolFields'),
    detailRawData: tx('apps.detail.rawData'),
    detailTabAI: tx('apps.detail.tabAI'),
    detailTabDetails: tx('apps.detail.tabDetails'),
    detailTabRaw: tx('apps.detail.tabRaw'),
    detailTxid: tx('apps.detail.txid'),
    detailTxids: tx('apps.detail.txids'),
    detailUpdatedAt: tx('apps.detail.updatedAt'),
    edit: tx('apps.edit'),
    editModalDescription: tx('apps.form.editDescription'),
    editModalTitle: tx('apps.form.editTitle'),
    emptyMessage: tx('apps.emptyMessage'),
    emptyTitle: tx('apps.emptyTitle'),
    formErrorTitle: tx('apps.form.errorTitle'),
    iconLabel: tx('apps.form.icon'),
    imageManualPinHelp: tx('apps.form.imageManualPinHelp'),
    imageMultiPinPlaceholder: tx('apps.form.imageMultiPinPlaceholder'),
    imageSinglePinPlaceholder: tx('apps.form.imageSinglePinPlaceholder'),
    indexFileLabel: tx('apps.form.indexFile'),
    invalidPin: tx('apps.form.invalidPin'),
    introImgsLabel: tx('apps.form.introImgs'),
    introLabel: tx('apps.form.intro'),
    loadErrorTitle: tx('apps.loadErrorTitle'),
    manualPinHelp: tx('apps.form.manualPinHelp'),
    metadataInvalid: tx('apps.form.metadataInvalid'),
    metadataLabel: tx('apps.form.metadata'),
    metadataPlaceholder: tx('apps.form.metadataPlaceholder'),
    multiPinPlaceholder: tx('apps.form.multiPinPlaceholder'),
    noLocalBotAvailable: tx('apps.noLocalBotAvailable'),
    noUploadResult: tx('apps.form.noUploadResult'),
    pageSizeLabel: tx('apps.pageSizeLabel'),
    promptLabel: tx('apps.form.prompt'),
    publishModalDescription: tx('apps.form.publishDescription'),
    publishModalTitle: tx('apps.form.publishTitle'),
    publishOnChain: tx('apps.form.publishOnChain'),
    publishedByLabel: tx('apps.form.publishedBy'),
    shareCopyLink: tx('apps.share.copyLink'),
    shareMetaAppUri: tx('apps.share.metaappUri'),
    shareModalDescription: tx('apps.share.description'),
    shareModalTitle: tx('apps.share.title'),
    shareWebUrl: tx('apps.share.webUrl'),
    requestFailed: tx('apps.requestFailed'),
    run: tx('apps.run'),
    runtimeAndroid: tx('apps.form.runtimeAndroid'),
    runtimeBrowser: tx('apps.form.runtimeBrowser'),
    runtimeIos: tx('apps.form.runtimeIos'),
    runtimeLabel: tx('apps.form.runtime'),
    runtimeLinux: tx('apps.form.runtimeLinux'),
    runtimeMacOS: tx('apps.form.runtimeMacOS'),
    runtimeWindows: tx('apps.form.runtimeWindows'),
    saveChanges: tx('apps.form.saveChanges'),
    deleteConfirm: tx('apps.delete.confirm'),
    deleteModalDescription: tx('apps.delete.description'),
    deleteModalTitle: tx('apps.delete.title'),
    runnable: tx('apps.runnable'),
    share: tx('apps.share'),
    singlePinPlaceholder: tx('apps.form.singlePinPlaceholder'),
    tagsHelp: tx('apps.form.tagsHelp'),
    tagsLabel: tx('apps.form.tags'),
    technicalInformation: tx('apps.form.technicalInformation'),
    titleLabel: tx('apps.form.title'),
    untitledMetaApp: tx('apps.untitledMetaApp'),
    upload: tx('apps.form.upload'),
    uploadFailed: tx('apps.form.uploadFailed'),
    uploadStored: tx('apps.form.uploadStored'),
    versionLabel: tx('apps.form.version'),
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
        <div class="apps-modal-root" data-apps-modal-root hidden></div>
      </section>
    `,
    script: buildAppsPageRuntimeSource(runtimeText, {
      codeTypeOptions: [...METAAPP_CODE_TYPE_OPTIONS],
      contentTypeOptions: [...METAAPP_CONTENT_TYPE_OPTIONS],
      metafileReferencePatternSource: METAAPP_METAFILE_REFERENCE_PATTERN.source,
    }),
  };
}

function buildAppsPageRuntimeSource(
  text: AppsPageRuntimeText,
  options: {
    codeTypeOptions: string[];
    contentTypeOptions: string[];
    metafileReferencePatternSource: string;
  },
): string {
  return `(() => {
  const APPS_API_BASE = '/api/metaapp/list';
  const PAGE_SIZE = 12;
  const UI_TEXT = ${JSON.stringify(text)};
  const CONTENT_TYPE_OPTIONS = ${JSON.stringify(options.contentTypeOptions)};
  const CODE_TYPE_OPTIONS = ${JSON.stringify(options.codeTypeOptions)};
  const METAAPP_METAFILE_REFERENCE_PATTERN = new RegExp(${JSON.stringify(options.metafileReferencePatternSource)}, 'i');
  const COPY_ICON_HTML = '<span aria-hidden="true">&#x29C9;</span>';
  const state = {
    profiles: [],
    selectedSlug: '',
    records: [],
    cursorStack: [''],
    cursor: '',
    nextCursor: '',
    loadingToken: 0,
    loading: false,
    botMenuOpen: false,
    modal: null,
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
    modalRoot: document.querySelector('[data-apps-modal-root]'),
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

  const uiText = (key, fallback, replacements) => {
    let text = String(fallback == null ? '' : fallback);
    try {
      if (typeof window !== 'undefined' && window.__oacLocalUiI18n && typeof window.__oacLocalUiI18n.t === 'function') {
        const translated = window.__oacLocalUiI18n.t(key, replacements || {});
        if (typeof translated === 'string' && translated && translated !== key) {
          return translated;
        }
      }
    } catch {}
    for (const [name, value] of Object.entries(replacements || {})) {
      text = text.replace(new RegExp('\\\\{' + name + '\\\\}', 'g'), String(value));
    }
    return text;
  };

  const FILE_CONTENT_PATH_PREFIXES = [
    '/content/',
    '/metafile-indexer/content/',
    '/metafile-indexer/thumbnail/',
    '/metafile-indexer/api/v1/files/content/',
    '/metafile-indexer/api/v1/files/accelerate/content/',
    '/metafile-indexer/api/v1/users/avatar/accelerate/',
  ];
  const isHttpUrl = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    return normalized.indexOf('http://') === 0 || normalized.indexOf('https://') === 0;
  };
  const isDirectImageUrl = (value) => /^(data:|blob:)/iu.test(normalizeText(value)) || isHttpUrl(value) || normalizeText(value).indexOf('/') === 0;
  const pathFromUrlLike = (value) => {
    const raw = normalizeText(value);
    if (!raw) return '';
    if (!isHttpUrl(raw)) return raw;
    try {
      const url = new URL(raw);
      return url.pathname;
    } catch {
      return '';
    }
  };
  const extractMetafilePinReference = (value) => {
    const raw = normalizeText(value);
    if (!raw) return '';
    if (raw.toLowerCase().indexOf('metafile://') === 0) {
      const suffix = raw.slice('metafile://'.length).trim().split(/[?#]/)[0] || '';
      return suffix;
    }
    const path = pathFromUrlLike(raw);
    for (const prefix of FILE_CONTENT_PATH_PREFIXES) {
      if (path.toLowerCase().indexOf(prefix.toLowerCase()) === 0) {
        return decodeURIComponent((path.slice(prefix.length).split(/[?#]/)[0] || '').trim());
      }
    }
    if (/^[0-9a-f]{64}(?:i[0-9]+)?$/iu.test(raw)) return raw;
    return '';
  };
  const imageUrlForReference = (value) => {
    const raw = normalizeText(value);
    if (!raw) return '';
    if (/^(data:|blob:)/iu.test(raw)) return raw;
    const pinRef = extractMetafilePinReference(raw);
    if (pinRef) return '/api/file/avatar?ref=' + encodeURIComponent(pinRef);
    if (isDirectImageUrl(raw)) return raw;
    return '';
  };
  const getInitialsAvatar = (name, seed) => {
    const text = normalizeText(name) || normalizeText(seed) || '?';
    const chars = Array.from(text).filter((char) => char.trim()).slice(0, 2);
    const label = (chars.join('') || '?').toUpperCase();
    const palette = [
      ['#2f6f7e', '#ffffff'],
      ['#4b6f9f', '#ffffff'],
      ['#7a4f9a', '#ffffff'],
      ['#2f7d4f', '#ffffff'],
      ['#8b3f5f', '#ffffff'],
      ['#9a5d2f', '#ffffff'],
    ];
    const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const pair = palette[Math.abs(hash) % palette.length];
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
      '<rect width="80" height="80" rx="16" fill="' + pair[0] + '"/>' +
      '<text x="40" y="49" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="25" font-weight="700" fill="' + pair[1] + '">' + escapeHtml(label) + '</text>' +
      '</svg>'
    );
  };
  const imageMarkup = (className, rawValue, label, attrs) => {
    const fallback = getInitialsAvatar(label, rawValue);
    const src = imageUrlForReference(rawValue) || fallback;
    return '<img class="' + escapeHtml(className) + '" src="' + escapeHtml(src) + '" alt="" loading="lazy" data-apps-image-fallback="' + escapeHtml(fallback) + '"' + (attrs || '') + '>';
  };
  const hydrateImageFallbacks = (root) => {
    (root || document).querySelectorAll('img[data-apps-image-fallback]:not([data-apps-image-bound])').forEach((img) => {
      img.setAttribute('data-apps-image-bound', 'true');
      img.addEventListener('error', () => {
        const fallback = img.getAttribute('data-apps-image-fallback') || '';
        if (fallback && img.getAttribute('src') !== fallback) img.setAttribute('src', fallback);
      });
    });
  };

  const RUNTIME_OPTIONS = [
    ['browser', 'apps.form.runtimeBrowser', UI_TEXT.runtimeBrowser],
    ['android', 'apps.form.runtimeAndroid', UI_TEXT.runtimeAndroid],
    ['ios', 'apps.form.runtimeIos', UI_TEXT.runtimeIos],
    ['windows', 'apps.form.runtimeWindows', UI_TEXT.runtimeWindows],
    ['macOS', 'apps.form.runtimeMacOS', UI_TEXT.runtimeMacOS],
    ['linux', 'apps.form.runtimeLinux', UI_TEXT.runtimeLinux],
  ];
  const ASSET_FIELDS = [
    ['icon', 'apps.form.icon', UI_TEXT.iconLabel, false, true],
    ['coverImg', 'apps.form.coverImg', UI_TEXT.coverImgLabel, false, true],
    ['introImgs', 'apps.form.introImgs', UI_TEXT.introImgsLabel, true, true],
    ['content', 'apps.form.content', UI_TEXT.contentLabel, false, false],
    ['code', 'apps.form.code', UI_TEXT.codeLabel, false, false],
  ];
  const UPLOAD_LARGE_THRESHOLD_BYTES = 4 * 1024 * 1024;

  const stripMetafileUri = (value) => {
    const text = normalizeText(value);
    return text.toLowerCase().startsWith('metafile://') ? text.slice('metafile://'.length).trim() : text;
  };

  const fieldValidationError = (fieldName, message) => {
    const error = new Error(message);
    error.fieldName = fieldName;
    return error;
  };

  const assertMetafileReference = (reference, fieldName) => {
    if (!METAAPP_METAFILE_REFERENCE_PATTERN.test(reference)) {
      throw fieldValidationError(fieldName, uiText('apps.form.invalidPin', UI_TEXT.invalidPin));
    }
  };

  const normalizeMetafileInput = (value, fieldName) => {
    const reference = stripMetafileUri(value);
    if (reference) assertMetafileReference(reference, fieldName);
    return reference ? 'metafile://' + reference : '';
  };

  const normalizeMetafileListInput = (value, fieldName) => {
    const values = Array.isArray(value) ? value : normalizeText(value).split(/[\\n,]/u);
    return values.map((item) => normalizeMetafileInput(item, fieldName)).filter(Boolean);
  };

  const normalizeImageAssetInput = (value, fieldName) => {
    const raw = normalizeText(value);
    if (!raw) return '';
    if (isHttpUrl(raw)) return raw;
    return normalizeMetafileInput(raw, fieldName);
  };

  const normalizeImageAssetListInput = (value, fieldName) => {
    const values = Array.isArray(value) ? value : normalizeText(value).split(/[\\n,]/u);
    return values.map((item) => normalizeImageAssetInput(item, fieldName)).filter(Boolean);
  };

  const splitListInput = (value) => normalizeText(value).split(/[\\n,]/u).map(normalizeText).filter(Boolean);

  const normalizeRuntimeSelection = (value) => {
    const rawValues = Array.isArray(value) ? value : normalizeText(value).split(/[\\/,\\n]/u);
    const values = rawValues.map(normalizeText).filter(Boolean);
    return values.length ? [...new Set(values)] : ['browser'];
  };

  const fieldValue = (record, name, fallback) => {
    if (!record || record[name] == null) return fallback || '';
    return record[name];
  };

  const assetInputValue = (value) => {
    if (Array.isArray(value)) {
      return value.map(stripMetafileUri).filter(Boolean).join('\\n');
    }
    return stripMetafileUri(value);
  };

  const metadataInputValue = (record) => {
    const metadata = record && record.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
    return JSON.stringify(metadata, null, 2);
  };

  const renderTextField = (name, label, value, wide) => {
    return '<label class="apps-form-field' + (wide ? ' wide' : '') + '">' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<input name="' + escapeHtml(name) + '" value="' + escapeHtml(value || '') + '">' +
    '</label>';
  };

  const renderTextareaField = (name, label, value, wide, placeholder) => {
    return '<label class="apps-form-field' + (wide ? ' wide' : '') + '">' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<textarea name="' + escapeHtml(name) + '"' + (placeholder ? ' placeholder="' + escapeHtml(placeholder) + '"' : '') + '>' + escapeHtml(value || '') + '</textarea>' +
    '</label>';
  };

  const renderSelectField = (name, label, value, options) => {
    const selectedValue = normalizeText(value) || options[0] || '';
    const hasSelectedOption = options.includes(selectedValue);
    const selectOptions = hasSelectedOption || !selectedValue ? options : [selectedValue, ...options];
    return '<label class="apps-form-field">' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<select name="' + escapeHtml(name) + '">' +
        selectOptions.map((option) => {
          const isCurrent = !hasSelectedOption && option === selectedValue;
          const optionLabel = isCurrent ? option + ' (' + uiText('apps.form.currentOption', UI_TEXT.currentOption) + ')' : option;
          return '<option value="' + escapeHtml(option) + '"' + (option === selectedValue ? ' selected' : '') + '>' + escapeHtml(optionLabel) + '</option>';
        }).join('') +
      '</select>' +
    '</label>';
  };

  const renderAssetField = (record, fieldName, labelKey, fallbackLabel, multiple, imageAsset) => {
    const value = assetInputValue(fieldValue(record, fieldName, ''));
    const placeholder = imageAsset
      ? (multiple ? uiText('apps.form.imageMultiPinPlaceholder', UI_TEXT.imageMultiPinPlaceholder) : uiText('apps.form.imageSinglePinPlaceholder', UI_TEXT.imageSinglePinPlaceholder))
      : (multiple ? uiText('apps.form.multiPinPlaceholder', UI_TEXT.multiPinPlaceholder) : uiText('apps.form.singlePinPlaceholder', UI_TEXT.singlePinPlaceholder));
    const manualControl = multiple
      ? '<textarea name="' + escapeHtml(fieldName) + '" placeholder="' + escapeHtml(placeholder) + '">' + escapeHtml(value) + '</textarea>'
      : '<input name="' + escapeHtml(fieldName) + '" value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(placeholder) + '">';
    return '<div class="apps-asset-field" data-apps-asset-field="' + escapeHtml(fieldName) + '">' +
      '<div class="apps-asset-heading">' +
        '<label>' + escapeHtml(uiText(labelKey, fallbackLabel)) + '</label>' +
        '<label class="apps-upload-button">' +
          '<input type="file" data-apps-asset-file="' + escapeHtml(fieldName) + '"' + (multiple ? ' multiple' : '') + '>' +
          '<span>' + escapeHtml(uiText('apps.form.upload', UI_TEXT.upload)) + '</span>' +
        '</label>' +
      '</div>' +
      '<div class="apps-metafile-input">' +
        '<span aria-hidden="true">' + escapeHtml(imageAsset ? 'ref' : 'metafile://') + '</span>' +
        manualControl +
      '</div>' +
      '<p class="apps-field-help">' + escapeHtml(imageAsset ? uiText('apps.form.imageManualPinHelp', UI_TEXT.imageManualPinHelp) : uiText('apps.form.manualPinHelp', UI_TEXT.manualPinHelp)) + '</p>' +
      '<p class="apps-field-error" data-apps-field-error="' + escapeHtml(fieldName) + '" hidden></p>' +
    '</div>';
  };

  const renderRuntimeOptions = (record) => {
    const selected = new Set(normalizeRuntimeSelection(record && record.runtime));
    return '<fieldset class="apps-runtime-field">' +
      '<legend>' + escapeHtml(uiText('apps.form.runtime', UI_TEXT.runtimeLabel)) + '</legend>' +
      '<div class="apps-runtime-options">' +
        RUNTIME_OPTIONS.map(([value, key, fallback]) => (
          '<label class="apps-runtime-option">' +
            '<input type="checkbox" name="runtime" value="' + escapeHtml(value) + '"' + (selected.has(value) ? ' checked' : '') + '>' +
            '<span>' + escapeHtml(uiText(key, fallback)) + '</span>' +
          '</label>'
        )).join('') +
      '</div>' +
    '</fieldset>';
  };

  const renderPublisherBadge = () => {
    const profile = selectedProfile();
    if (!profile) return '';
    const label = profileLabel(profile);
    const prefix = uiText('apps.form.publishedBy', UI_TEXT.publishedByLabel);
    const accessibleLabel = prefix + ' ' + label;
    return '<div class="apps-publisher-badge" data-apps-publisher-badge title="' + escapeHtml(accessibleLabel) + '" aria-label="' + escapeHtml(accessibleLabel) + '">' +
      '<span class="apps-publisher-label">' + escapeHtml(prefix) + '</span>' +
      profileAvatarMarkup(profile) +
      '<strong>' + escapeHtml(label) + '</strong>' +
    '</div>';
  };

  const renderMetaAppForm = (mode, record) => {
    const isEdit = mode === 'edit';
    const targetPinId = isEdit ? recordPinId(record) : '';
    const title = isEdit ? uiText('apps.form.editTitle', UI_TEXT.editModalTitle) : uiText('apps.form.publishTitle', UI_TEXT.publishModalTitle);
    const description = isEdit ? uiText('apps.form.editDescription', UI_TEXT.editModalDescription) : uiText('apps.form.publishDescription', UI_TEXT.publishModalDescription);
    const publisherBadge = isEdit ? '' : renderPublisherBadge();
    return '<div class="apps-modal-backdrop" data-apps-modal-close></div>' +
      '<section class="apps-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="apps-modal-title" tabindex="-1">' +
        '<header class="apps-modal-header">' +
          '<div class="apps-modal-header-main"><h2 id="apps-modal-title">' + escapeHtml(title) + '</h2><p>' + escapeHtml(description) + '</p></div>' +
          '<div class="apps-modal-header-actions">' +
            publisherBadge +
            '<button class="apps-modal-close" type="button" data-apps-modal-close aria-label="' + escapeHtml(uiText('apps.form.close', UI_TEXT.close)) + '">x</button>' +
          '</div>' +
        '</header>' +
        '<form data-apps-form data-apps-form-mode="' + escapeHtml(mode) + '" data-apps-target-pin-id="' + escapeHtml(targetPinId) + '">' +
          '<section class="apps-form-section" data-apps-form-section="basic">' +
            '<h3>' + escapeHtml(uiText('apps.form.basicInformation', UI_TEXT.basicInformation)) + '</h3>' +
            '<div class="apps-field-grid">' +
              renderTextField('appName', uiText('apps.form.appName', UI_TEXT.appNameLabel), fieldValue(record, 'appName', '')) +
              renderTextField('title', uiText('apps.form.title', UI_TEXT.titleLabel), fieldValue(record, 'title', '')) +
              renderTextareaField('prompt', uiText('apps.form.prompt', UI_TEXT.promptLabel), fieldValue(record, 'prompt', ''), true) +
              renderTextareaField('intro', uiText('apps.form.intro', UI_TEXT.introLabel), fieldValue(record, 'intro', ''), true) +
              renderTextField('tags', uiText('apps.form.tags', UI_TEXT.tagsLabel), Array.isArray(record && record.tags) ? record.tags.join(', ') : fieldValue(record, 'tags', ''), true) +
            '</div>' +
            '<p class="apps-field-help">' + escapeHtml(uiText('apps.form.tagsHelp', UI_TEXT.tagsHelp)) + '</p>' +
          '</section>' +
          '<section class="apps-form-section" data-apps-form-section="assets">' +
            '<h3>' + escapeHtml(uiText('apps.form.assets', UI_TEXT.assets)) + '</h3>' +
            '<div class="apps-asset-grid">' + ASSET_FIELDS.map(([name, key, fallback, multiple, imageAsset]) => renderAssetField(record, name, key, fallback, multiple, imageAsset)).join('') + '</div>' +
          '</section>' +
          '<section class="apps-form-section" data-apps-form-section="technical">' +
            '<h3>' + escapeHtml(uiText('apps.form.technicalInformation', UI_TEXT.technicalInformation)) + '</h3>' +
            renderRuntimeOptions(record) +
            '<div class="apps-field-grid">' +
              renderTextField('indexFile', uiText('apps.form.indexFile', UI_TEXT.indexFileLabel), fieldValue(record, 'indexFile', 'index.html')) +
              renderTextField('version', uiText('apps.form.version', UI_TEXT.versionLabel), fieldValue(record, 'version', 'v1.0.0')) +
              renderSelectField('contentType', uiText('apps.form.contentType', UI_TEXT.contentTypeLabel), fieldValue(record, 'contentType', 'application/zip'), CONTENT_TYPE_OPTIONS) +
              renderSelectField('codeType', uiText('apps.form.codeType', UI_TEXT.codeTypeLabel), fieldValue(record, 'codeType', 'application/zip'), CODE_TYPE_OPTIONS) +
              renderTextField('contentHash', uiText('apps.form.contentHash', UI_TEXT.contentHashLabel), fieldValue(record, 'contentHash', ''), true) +
              renderTextareaField('metadata', uiText('apps.form.metadata', UI_TEXT.metadataLabel), metadataInputValue(record), true, uiText('apps.form.metadataPlaceholder', UI_TEXT.metadataPlaceholder)) +
            '</div>' +
            '<label class="apps-disabled-row"><input type="checkbox" name="disabled" value="true"' + (record && record.disabled === true ? ' checked' : '') + '><span>' + escapeHtml(uiText('apps.form.disabled', UI_TEXT.disabledFieldLabel)) + '</span></label>' +
            '<p class="apps-field-help">' + escapeHtml(uiText('apps.form.disabledHelp', UI_TEXT.disabledFieldHelp)) + '</p>' +
          '</section>' +
          '<p class="apps-form-error" data-apps-form-error hidden></p>' +
          '<footer class="apps-modal-actions">' +
            '<button class="btn" type="button" data-apps-modal-close>' + escapeHtml(uiText('apps.form.cancel', UI_TEXT.cancel)) + '</button>' +
            '<button class="btn btn-primary" type="submit">' + escapeHtml(isEdit ? uiText('apps.form.saveChanges', UI_TEXT.saveChanges) : uiText('apps.form.publishOnChain', UI_TEXT.publishOnChain)) + '</button>' +
          '</footer>' +
        '</form>' +
      '</section>';
  };

  const renderModalShell = (title, description, bodyHtml, actionsHtml) => {
    return '<div class="apps-modal-backdrop" data-apps-modal-close></div>' +
      '<section class="apps-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="apps-modal-title" tabindex="-1">' +
        '<header class="apps-modal-header">' +
          '<div><h2 id="apps-modal-title">' + escapeHtml(title) + '</h2><p>' + escapeHtml(description) + '</p></div>' +
          '<button class="apps-modal-close" type="button" data-apps-modal-close aria-label="' + escapeHtml(uiText('apps.form.close', UI_TEXT.close)) + '">x</button>' +
        '</header>' +
        bodyHtml +
        (actionsHtml ? '<footer class="apps-modal-actions">' + actionsHtml + '</footer>' : '') +
      '</section>';
  };

  const displayValue = (value) => {
    if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join('\\n') || '-';
    if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
    return normalizeText(value) || '-';
  };

  const formatRecordTimestamp = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '-';
    const milliseconds = number < 1000000000000 ? number * 1000 : number;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? '-' : date.toISOString();
  };

  const metaAppUriForRecord = (record) => normalizeText(record && record.metaappUri) || 'metaapp://' + recordPinId(record);
  const metaWebUrlForRecord = (record) => normalizeText(record && record.metawebUrl) || 'https://metaweb.world/metaapp/' + recordPinId(record);

  const recordImageValue = (record, fieldNames) => {
    for (const fieldName of fieldNames) {
      const value = normalizeText(record && record[fieldName]);
      if (value) return value;
    }
    return '';
  };

  const recordIntroImageValues = (record) => {
    const value = record && record.introImgs;
    if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
    return splitListInput(value);
  };

  const renderDetailField = (label, value, wide) => {
    const text = displayValue(value);
    return '<div class="apps-detail-field' + (wide ? ' wide' : '') + '">' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<code>' + escapeHtml(text) + '</code>' +
    '</div>';
  };

  const renderDetailShot = (value) => {
    const src = imageUrlForReference(value);
    return '<div class="apps-detail-shot">' + (src ? '<img src="' + escapeHtml(src) + '" alt="" loading="lazy" data-apps-image-fallback="">' : '') + '</div>';
  };

  const renderProtocolFieldRows = (record, rawJson) => {
    const rows = [
      [uiText('apps.form.title', UI_TEXT.titleLabel), record && record.title, false],
      [uiText('apps.form.appName', UI_TEXT.appNameLabel), record && record.appName, false],
      [uiText('apps.form.prompt', UI_TEXT.promptLabel), record && record.prompt, true],
      [uiText('apps.form.intro', UI_TEXT.introLabel), record && record.intro, true],
      [uiText('apps.form.icon', UI_TEXT.iconLabel), recordImageValue(record, ['icon', 'iconImg', 'iconImage']), false],
      [uiText('apps.form.coverImg', UI_TEXT.coverImgLabel), recordImageValue(record, ['coverImg', 'coverImage', 'cover']), false],
      [uiText('apps.form.introImgs', UI_TEXT.introImgsLabel), recordIntroImageValues(record), true],
      [uiText('apps.form.runtime', UI_TEXT.runtimeLabel), record && record.runtime, false],
      [uiText('apps.form.version', UI_TEXT.versionLabel), record && record.version, false],
      [uiText('apps.form.contentType', UI_TEXT.contentTypeLabel), record && record.contentType, false],
      [uiText('apps.form.indexFile', UI_TEXT.indexFileLabel), record && record.indexFile, false],
      [uiText('apps.form.content', UI_TEXT.contentLabel), record && record.content, true],
      [uiText('apps.form.code', UI_TEXT.codeLabel), record && record.code, true],
      [uiText('apps.form.contentHash', UI_TEXT.contentHashLabel), record && record.contentHash, false],
      [uiText('apps.form.codeType', UI_TEXT.codeTypeLabel), record && record.codeType, false],
      [uiText('apps.form.disabled', UI_TEXT.disabledFieldLabel), record && record.disabled === true ? uiText('apps.disabled', UI_TEXT.disabled) : 'false', false],
      [uiText('apps.form.tags', UI_TEXT.tagsLabel), record && record.tags, true],
      [uiText('apps.form.metadata', UI_TEXT.metadataLabel), record && record.metadata, true],
      [uiText('apps.detail.pinId', UI_TEXT.detailPinId), recordPinId(record), false],
      [uiText('apps.detail.firstPinId', UI_TEXT.detailFirstPinId), record && record.firstPinId, false],
      [uiText('apps.detail.operation', UI_TEXT.detailOperation), record && record.operation, false],
      [uiText('apps.detail.ownerAddress', UI_TEXT.detailOwnerAddress), record && record.ownerAddress, false],
      [uiText('apps.detail.globalMetaId', UI_TEXT.detailGlobalMetaId), record && (record.globalMetaId || record.globalMetaID || (record.raw && (record.raw.globalMetaId || record.raw.globalMetaID))), false],
      [uiText('apps.detail.txid', UI_TEXT.detailTxid), record && record.txid, false],
      [uiText('apps.detail.txids', UI_TEXT.detailTxids), record && record.txids, true],
      [uiText('apps.detail.updatedAt', UI_TEXT.detailUpdatedAt), formatRecordTimestamp(record && record.timestamp), false],
      [uiText('apps.detail.createdAt', UI_TEXT.detailCreatedAt), formatRecordTimestamp(record && (record.createdAt || record.raw && (record.raw.createdAt || record.raw.timestamp))), false],
      [uiText('apps.detail.rawData', UI_TEXT.detailRawData), rawJson, true],
    ];
    return rows.map(([label, value, wide]) => renderDetailField(label, value, wide)).join('');
  };

  const renderDetailModal = (record) => {
    const pinId = recordPinId(record);
    const rawJson = JSON.stringify(record && record.raw ? record.raw : record || {}, null, 2);
    const title = normalizeText(record && (record.title || record.appName)) || uiText('apps.untitledMetaApp', UI_TEXT.untitledMetaApp);
    const description = normalizeText(record && (record.prompt || record.intro));
    const tags = Array.isArray(record && record.tags) ? record.tags.map(normalizeText).filter(Boolean).slice(0, 8) : [];
    const iconValue = recordImageValue(record, ['icon', 'iconImg', 'iconImage']);
    const coverValue = recordImageValue(record, ['coverImg', 'coverImage', 'cover']);
    const previewValues = [coverValue, ...recordIntroImageValues(record)].filter(Boolean).slice(0, 3);
    while (previewValues.length < 3) previewValues.push('');
    const body = '<div class="apps-protocol-detail">' +
      '<section class="apps-detail-top">' +
        imageMarkup('apps-detail-icon', iconValue, title, '') +
        '<div class="apps-detail-title">' +
          '<h3>' + escapeHtml(title) + '</h3>' +
          '<p>' + escapeHtml(description) + '</p>' +
          '<div class="apps-tags">' + tags.map((tag) => '<span>' + escapeHtml(tag) + '</span>').join('') + '</div>' +
        '</div>' +
        '<div class="apps-detail-actions">' +
          '<button class="btn btn-primary" type="button" data-apps-run="' + escapeHtml(pinId) + '"' + (record && record.disabled === true ? ' disabled' : '') + '>' + escapeHtml(uiText('apps.run', UI_TEXT.run)) + '</button>' +
          '<button class="btn" type="button" data-apps-share="' + escapeHtml(pinId) + '">' + escapeHtml(uiText('apps.share', UI_TEXT.share)) + '</button>' +
          '<button class="btn" type="button" data-apps-edit="' + escapeHtml(pinId) + '">' + escapeHtml(uiText('apps.edit', UI_TEXT.edit)) + '</button>' +
          '<button class="btn btn-danger" type="button" data-apps-delete-open="' + escapeHtml(pinId) + '">' + escapeHtml(uiText('apps.delete', UI_TEXT.deleteLabel)) + '</button>' +
        '</div>' +
      '</section>' +
      '<section class="apps-detail-shots">' + previewValues.map(renderDetailShot).join('') + '</section>' +
      '<div class="apps-detail-tabs" aria-hidden="true">' +
        '<span class="apps-detail-tab active">' + escapeHtml(uiText('apps.detail.tabDetails', UI_TEXT.detailTabDetails)) + '</span>' +
        '<span class="apps-detail-tab">' + escapeHtml(uiText('apps.detail.tabAI', UI_TEXT.detailTabAI)) + '</span>' +
        '<span class="apps-detail-tab">' + escapeHtml(uiText('apps.detail.tabRaw', UI_TEXT.detailTabRaw)) + '</span>' +
      '</div>' +
      '<section class="apps-detail-fields">' + renderProtocolFieldRows(record, rawJson) + '</section>' +
    '</div>';
    return renderModalShell(
      uiText('apps.detail.title', UI_TEXT.detailModalTitle),
      uiText('apps.detail.description', UI_TEXT.detailModalDescription),
      body,
      '',
    );
  };

  const renderShareLinkRow = (label, value) => {
    return '<div class="apps-share-row">' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<code>' + escapeHtml(value) + '</code>' +
      '<button class="apps-copy-btn" type="button" data-apps-copy-value="' + escapeHtml(value) + '">' + escapeHtml(uiText('apps.share.copyLink', UI_TEXT.shareCopyLink)) + '</button>' +
    '</div>';
  };

  const renderShareModal = (record) => {
    const body = '<div class="apps-detail-body">' +
      '<section class="apps-detail-section">' +
        '<div class="apps-share-list">' +
          renderShareLinkRow(uiText('apps.share.metaappUri', UI_TEXT.shareMetaAppUri), metaAppUriForRecord(record)) +
          renderShareLinkRow(uiText('apps.share.webUrl', UI_TEXT.shareWebUrl), metaWebUrlForRecord(record)) +
        '</div>' +
      '</section>' +
    '</div>';
    const actions = '<button class="btn" type="button" data-apps-modal-close>' + escapeHtml(uiText('apps.form.close', UI_TEXT.close)) + '</button>';
    return renderModalShell(
      uiText('apps.share.title', UI_TEXT.shareModalTitle),
      uiText('apps.share.description', UI_TEXT.shareModalDescription),
      body,
      actions,
    );
  };

  const renderDeleteModal = (record) => {
    const pinId = recordPinId(record);
    const title = normalizeText(record && (record.title || record.appName)) || pinId;
    const body = '<form data-apps-delete-form data-apps-target-pin-id="' + escapeHtml(pinId) + '">' +
      '<section class="apps-detail-body apps-delete-body">' +
        '<p>' + escapeHtml(uiText('apps.delete.description', UI_TEXT.deleteModalDescription)) + '</p>' +
        '<code>' + escapeHtml(title) + '</code>' +
        '<p class="apps-form-error" data-apps-delete-error hidden></p>' +
      '</section>' +
      '<footer class="apps-modal-actions">' +
        '<button class="btn" type="button" data-apps-modal-close>' + escapeHtml(uiText('apps.form.cancel', UI_TEXT.cancel)) + '</button>' +
        '<button class="btn btn-danger" type="submit">' + escapeHtml(uiText('apps.delete.confirm', UI_TEXT.deleteConfirm)) + '</button>' +
      '</footer>' +
    '</form>';
    return renderModalShell(
      uiText('apps.delete.title', UI_TEXT.deleteModalTitle),
      uiText('apps.delete.description', UI_TEXT.deleteModalDescription),
      body,
      '',
    );
  };

  const renderAppsModalContent = (mode, record) => {
    if (mode === 'detail') return renderDetailModal(record);
    if (mode === 'share') return renderShareModal(record);
    if (mode === 'delete') return renderDeleteModal(record);
    return renderMetaAppForm(mode, record);
  };

  const showNotice = (kind, title, body) => {
    if (!elements.notice) return;
    elements.notice.hidden = false;
    elements.notice.dataset.tone = kind;
    elements.notice.innerHTML = '<strong>' + escapeHtml(title) + '</strong>' + (body ? '<p>' + escapeHtml(body) + '</p>' : '');
  };

  const hideNotice = () => {
    if (elements.notice) elements.notice.hidden = true;
  };

  const setModalFieldStatus = (fieldName, message, tone) => {
    if (!elements.modalRoot) return;
    const status = elements.modalRoot.querySelector('[data-apps-field-error="' + fieldName + '"]');
    if (!status) return;
    status.hidden = !message;
    status.dataset.tone = tone || '';
    status.textContent = message || '';
  };

  const setModalFormError = (message) => {
    if (!elements.modalRoot) return;
    const status = elements.modalRoot.querySelector('[data-apps-form-error]');
    if (!status) return;
    status.hidden = !message;
    status.textContent = message || '';
  };

  const clearModalValidation = () => {
    setModalFormError('');
    for (const [fieldName] of ASSET_FIELDS) {
      setModalFieldStatus(fieldName, '', '');
    }
    setModalFieldStatus('metadata', '', '');
  };

  const findModalField = (fieldName) => elements.modalRoot
    ? elements.modalRoot.querySelector('[name="' + fieldName + '"]')
    : null;

  const findRecordByPinId = (pinId) => state.records.find((record) => recordPinId(record) === normalizeText(pinId)) || null;

  const closeAppsModal = () => {
    state.modal = null;
    if (!elements.modalRoot) return;
    elements.modalRoot.hidden = true;
    elements.modalRoot.innerHTML = '';
  };

  const openAppsModal = (mode, record) => {
    if (!elements.modalRoot) return;
    const needsRecord = mode === 'edit' || mode === 'detail' || mode === 'share' || mode === 'delete';
    const resolvedRecord = needsRecord ? record : null;
    if (needsRecord && !resolvedRecord) {
      closeAppsModal();
      return;
    }
    state.modal = {
      mode,
      targetPinId: resolvedRecord ? recordPinId(resolvedRecord) : '',
    };
    elements.modalRoot.hidden = false;
    elements.modalRoot.innerHTML = renderAppsModalContent(mode, resolvedRecord);
    hydrateImageFallbacks(elements.modalRoot);
    const dialog = elements.modalRoot.querySelector('.apps-modal-dialog');
    if (dialog && typeof dialog.focus === 'function') dialog.focus();
  };

  const readMetadataInput = (value) => {
    const raw = normalizeText(value);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(uiText('apps.form.metadataInvalid', UI_TEXT.metadataInvalid));
    }
    return parsed;
  };

  const readMetaAppFormPayload = (form) => {
    const data = new FormData(form);
    const runtime = Array.from(form.querySelectorAll('input[name="runtime"]:checked'))
      .map((input) => normalizeText(input.value))
      .filter(Boolean);
    return {
      from: state.selectedSlug,
      confirm: true,
      appName: normalizeText(data.get('appName')),
      title: normalizeText(data.get('title')),
      prompt: normalizeText(data.get('prompt')),
      intro: normalizeText(data.get('intro')),
      tags: splitListInput(data.get('tags')),
      icon: normalizeImageAssetInput(data.get('icon'), 'icon'),
      coverImg: normalizeImageAssetInput(data.get('coverImg'), 'coverImg'),
      introImgs: normalizeImageAssetListInput(data.get('introImgs'), 'introImgs'),
      content: normalizeMetafileInput(data.get('content'), 'content'),
      code: normalizeMetafileInput(data.get('code'), 'code'),
      runtime: runtime.length ? runtime : ['browser'],
      indexFile: normalizeText(data.get('indexFile')),
      version: normalizeText(data.get('version')),
      contentType: normalizeText(data.get('contentType')),
      codeType: normalizeText(data.get('codeType')),
      contentHash: normalizeText(data.get('contentHash')),
      metadata: readMetadataInput(data.get('metadata')),
      disabled: data.get('disabled') !== null,
    };
  };

  const fetchJson = async (url, options) => {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok || !payload || payload.ok === false || payload.state === 'failed') {
      throw new Error(payload && payload.message ? payload.message : uiText('apps.requestFailed', UI_TEXT.requestFailed));
    }
    return payload.data || payload;
  };

  const postJson = (url, payload) => fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const postRawFile = (url, file) => {
    const params = new URLSearchParams();
    params.set('mode', 'raw');
    if (state.selectedSlug) params.set('from', state.selectedSlug);
    const fileName = normalizeText(file && file.name);
    if (fileName) params.set('fileName', fileName);
    return fetchJson(url + '?' + params.toString(), {
      method: 'POST',
      headers: { 'content-type': normalizeText(file && file.type) || 'application/octet-stream' },
      body: file,
    });
  };

  const reloadFirstAppsPage = async () => {
    state.cursorStack = [''];
    state.cursor = '';
    state.nextCursor = '';
    await loadApps('');
  };

  const submitMetaAppForm = async (form) => {
    clearModalValidation();
    let payload;
    try {
      payload = readMetaAppFormPayload(form);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      setModalFieldStatus(error && error.fieldName ? error.fieldName : 'metadata', message, 'error');
      return;
    }
    const mode = form.getAttribute('data-apps-form-mode') || 'publish';
    const targetPinId = normalizeText(form.getAttribute('data-apps-target-pin-id'));
    if (mode === 'edit') payload.targetPinId = targetPinId;
    try {
      await postJson(mode === 'edit' ? '/api/metaapp/update' : '/api/metaapp/publish', payload);
      closeAppsModal();
      await reloadFirstAppsPage();
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      setModalFormError(uiText('apps.form.errorTitle', UI_TEXT.formErrorTitle) + ' ' + message);
    }
  };

  const setDeleteFormError = (message) => {
    if (!elements.modalRoot) return;
    const status = elements.modalRoot.querySelector('[data-apps-delete-error]');
    if (!status) return;
    status.hidden = !message;
    status.textContent = message || '';
  };

  const submitDeleteForm = async (form) => {
    const targetPinId = normalizeText(form.getAttribute('data-apps-target-pin-id'));
    if (!targetPinId) return;
    setDeleteFormError('');
    try {
      await postJson('/api/metaapp/delete', {
        from: state.selectedSlug,
        targetPinId,
        confirm: true,
      });
      state.records = state.records.filter((record) => recordPinId(record) !== targetPinId);
      closeAppsModal();
      renderGrid();
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      setDeleteFormError(uiText('apps.delete.errorTitle', UI_TEXT.deleteErrorTitle) + ' ' + message);
    }
  };

  const storeAssetUri = (fieldName, uri) => {
    const field = findModalField(fieldName);
    if (!field) return;
    if (fieldName === 'introImgs' && normalizeText(field.value)) {
      field.value = normalizeText(field.value) + '\\n' + uri;
      return;
    }
    field.value = uri;
  };

  const handleAssetFileUpload = async (target) => {
    const fieldName = normalizeText(target.getAttribute('data-apps-asset-file'));
    if (!fieldName) return;
    setModalFieldStatus(fieldName, '', '');
    const files = Array.from(target.files || []);
    if (!files.length) return;
    try {
      for (const file of files) {
        const result = await postRawFile(
          Number(file.size || 0) > UPLOAD_LARGE_THRESHOLD_BYTES ? '/api/file/upload-large' : '/api/file/upload',
          file,
        );
        const uri = normalizeText(result && result.metafileUri) || (normalizeText(result && result.pinId) ? 'metafile://' + normalizeText(result && result.pinId) : '');
        if (!uri) {
          throw new Error(uiText('apps.form.noUploadResult', UI_TEXT.noUploadResult));
        }
        storeAssetUri(fieldName, uri);
      }
      setModalFieldStatus(fieldName, uiText('apps.form.uploadStored', UI_TEXT.uploadStored), 'success');
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      setModalFieldStatus(fieldName, uiText('apps.form.uploadFailed', UI_TEXT.uploadFailed) + ' ' + message, 'error');
      return;
    }
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
    || uiText('apps.botFallback', UI_TEXT.botFallback);

  const profileAvatarSource = (profile) => {
    const avatar = profile && profile.avatar;
    if (typeof avatar === 'string') return normalizeText(avatar);
    return normalizeText(profile && (profile.avatarDataUrl || profile.avatarDataURL || profile.avatarUri || profile.avatarUrl || profile.avatarId || profile.avatarPinId || profile.avatarImage))
      || normalizeText(avatar && typeof avatar === 'object' && (avatar.dataUrl || avatar.dataURL || avatar.uri || avatar.url || avatar.id || avatar.pinId || avatar.ref || avatar.src || avatar.image))
      || '';
  };

  const profileAvatarMarkup = (profile) => {
    const label = profileLabel(profile);
    return imageMarkup('apps-bot-avatar', profileAvatarSource(profile), label, '');
  };

  const renderBotPicker = () => {
    if (!elements.botPicker) return;
    const selected = selectedProfile();
    const current = selected
      ? profileAvatarMarkup(selected)
        + '<span class="apps-bot-main"><strong>' + escapeHtml(profileLabel(selected)) + '</strong><span>' + escapeHtml(normalizeText(selected.globalMetaId) || state.selectedSlug) + '</span></span>'
      : '<span class="apps-bot-main"><strong>' + escapeHtml(uiText('apps.noLocalBotAvailable', UI_TEXT.noLocalBotAvailable)) + '</strong></span>';
    elements.botPicker.innerHTML =
      '<button class="apps-bot-trigger" type="button" data-apps-bot-trigger aria-expanded="' + (state.botMenuOpen ? 'true' : 'false') + '"' + (state.profiles.length ? '' : ' disabled') + '>' +
        current +
        '<span class="apps-bot-chevron" aria-hidden="true">v</span>' +
      '</button>' +
      '<div class="apps-bot-menu" data-apps-bot-menu role="listbox"' + (state.botMenuOpen ? '' : ' hidden') + '>' +
        state.profiles.map((profile) => {
          const slug = profileSlug(profile);
          return '<button class="apps-bot-option" type="button" role="option" data-apps-bot-option="' + escapeHtml(slug) + '" data-selected="' + (slug === state.selectedSlug ? 'true' : 'false') + '" aria-selected="' + (slug === state.selectedSlug ? 'true' : 'false') + '">' +
            profileAvatarMarkup(profile) +
            '<span>' + escapeHtml(profileLabel(profile)) + '</span>' +
          '</button>';
        }).join('') +
      '</div>';
    hydrateImageFallbacks(elements.botPicker);
  };

  const renderEmpty = () => {
    if (!elements.grid) return;
    elements.grid.innerHTML = '<div class="apps-empty"><strong>' + escapeHtml(uiText('apps.emptyTitle', UI_TEXT.emptyTitle)) + '</strong><p>' + escapeHtml(uiText('apps.emptyMessage', UI_TEXT.emptyMessage)) + '</p></div>';
  };

  const renderRecordCard = (record) => {
    const pinId = recordPinId(record);
    const disabled = record && record.disabled === true;
    const title = normalizeText(record && (record.title || record.appName)) || uiText('apps.untitledMetaApp', UI_TEXT.untitledMetaApp);
    const subtitle = [normalizeText(record && record.version), normalizeText(record && record.runtime)].filter(Boolean).join(' / ');
    const intro = normalizeText(record && record.intro);
    const tags = Array.isArray(record && record.tags) ? record.tags.map(normalizeText).filter(Boolean).slice(0, 4) : [];
    const iconValue = recordImageValue(record, ['icon', 'iconImg', 'iconImage']);
    const coverValue = recordImageValue(record, ['coverImg', 'coverImage', 'cover']);
    const coverSrc = imageUrlForReference(coverValue);
    return '<article class="apps-card" data-apps-card="' + escapeHtml(pinId) + '" tabindex="0">' +
      '<div class="apps-card-cover">' +
        (coverSrc ? '<img class="apps-card-cover-img" src="' + escapeHtml(coverSrc) + '" alt="" loading="lazy" data-apps-image-fallback="">' : '') +
        imageMarkup('apps-card-icon', iconValue, title, '') +
        '<span class="apps-state-pill' + (disabled ? ' disabled' : '') + '">' + escapeHtml(disabled ? uiText('apps.disabled', UI_TEXT.disabled) : uiText('apps.runnable', UI_TEXT.runnable)) + '</span>' +
      '</div>' +
      '<div class="apps-card-body">' +
        '<div class="apps-card-title">' +
          '<h3>' + escapeHtml(title) + '</h3>' +
          '<p>' + escapeHtml(subtitle) + '</p>' +
        '</div>' +
        '<div class="apps-pin-line"><code>' + escapeHtml(pinId) + '</code><button class="apps-copy-btn" type="button" data-apps-copy-pin="' + escapeHtml(pinId) + '" aria-label="' + escapeHtml(uiText('apps.copyPinId', UI_TEXT.copyPinId)) + '" title="' + escapeHtml(uiText('apps.copyPinId', UI_TEXT.copyPinId)) + '">' + COPY_ICON_HTML + '</button></div>' +
        '<p class="apps-card-intro">' + escapeHtml(intro) + '</p>' +
        '<div class="apps-tags">' + tags.map((tag) => '<span>' + escapeHtml(tag) + '</span>').join('') + '</div>' +
        '<div class="apps-card-actions">' +
          '<button class="btn btn-primary" type="button" data-apps-run="' + escapeHtml(pinId) + '"' + (disabled ? ' disabled' : '') + '>' + escapeHtml(uiText('apps.run', UI_TEXT.run)) + '</button>' +
          '<button class="btn" type="button" data-apps-edit="' + escapeHtml(pinId) + '">' + escapeHtml(uiText('apps.edit', UI_TEXT.edit)) + '</button>' +
          '<button class="btn" type="button" data-apps-share="' + escapeHtml(pinId) + '">' + escapeHtml(uiText('apps.share', UI_TEXT.share)) + '</button>' +
          '<button class="btn" type="button" data-apps-detail="' + escapeHtml(pinId) + '">' + escapeHtml(uiText('apps.details', UI_TEXT.details)) + '</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  };

  const renderPaginationControls = () => {
    const hasPrevious = state.cursorStack.length > 1;
    const hasNext = Boolean(state.nextCursor);
    if (elements.refresh) elements.refresh.disabled = state.loading;
    if (elements.prev) {
      elements.prev.hidden = !hasPrevious;
      elements.prev.disabled = state.loading || !hasPrevious;
    }
    if (elements.next) {
      elements.next.hidden = !hasNext;
      elements.next.disabled = state.loading || !hasNext;
    }
    if (elements.pageLabel) elements.pageLabel.textContent = uiText('apps.pageSizeLabel', UI_TEXT.pageSizeLabel);
  };

  const renderGrid = () => {
    if (!elements.grid) return;
    if (!state.records.length) {
      renderEmpty();
    } else {
      elements.grid.innerHTML = state.records.map(renderRecordCard).join('');
    }
    if (elements.gridCount) elements.gridCount.textContent = String(state.records.length);
    renderPaginationControls();
    hydrateImageFallbacks(elements.grid);
  };

  const setLoading = (loading) => {
    state.loading = loading;
    renderPaginationControls();
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
      throw new Error(uiText('apps.noLocalBotAvailable', UI_TEXT.noLocalBotAvailable));
    }
    const token = ++state.loadingToken;
    const params = new URLSearchParams();
    params.set('from', state.selectedSlug);
    params.set('size', String(PAGE_SIZE));
    if (cursor) params.set('cursor', cursor);
    setLoading(true);
    try {
      const data = await fetchJson(APPS_API_BASE + '?' + params.toString());
      if (token !== state.loadingToken) return false;
      state.records = Array.isArray(data && data.records) ? data.records : [];
      state.cursor = cursor || '';
      state.nextCursor = normalizeText(data && data.nextCursor);
      hideNotice();
      renderGrid();
      return true;
    } finally {
      if (token === state.loadingToken) {
        setLoading(false);
      }
    }
  };

  const refreshApps = async () => {
    if (state.loading) return;
    try {
      await loadApps(state.cursor);
    } catch (error) {
      showNotice('error', uiText('apps.loadErrorTitle', UI_TEXT.loadErrorTitle), error && error.message ? error.message : String(error));
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
      showNotice('error', uiText('apps.loadErrorTitle', UI_TEXT.loadErrorTitle), error && error.message ? error.message : String(error));
    }
  };

  document.addEventListener('click', async (event) => {
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (!eventTarget) return;
    const target = eventTarget.closest('[data-apps-bot-trigger], [data-apps-bot-option], [data-apps-copy-pin], [data-apps-copy-value], [data-apps-run], [data-apps-share], [data-apps-detail], [data-apps-edit], [data-apps-delete-open], [data-apps-card]');
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
        showNotice('error', uiText('apps.loadErrorTitle', UI_TEXT.loadErrorTitle), error && error.message ? error.message : String(error));
      }
      return;
    }
    if (target.matches('[data-apps-copy-pin]')) {
      const pinId = target.getAttribute('data-apps-copy-pin') || '';
      await navigator.clipboard?.writeText(pinId);
      target.textContent = uiText('apps.copied', UI_TEXT.copied);
      setTimeout(() => {
        target.innerHTML = COPY_ICON_HTML;
        target.setAttribute('aria-label', uiText('apps.copyPinId', UI_TEXT.copyPinId));
        target.setAttribute('title', uiText('apps.copyPinId', UI_TEXT.copyPinId));
      }, 1000);
      return;
    }
    if (target.matches('[data-apps-copy-value]')) {
      const value = target.getAttribute('data-apps-copy-value') || '';
      await navigator.clipboard?.writeText(value);
      target.textContent = uiText('apps.copied', UI_TEXT.copied);
      setTimeout(() => { target.textContent = uiText('apps.share.copyLink', UI_TEXT.shareCopyLink); }, 1000);
      return;
    }
    if (target.matches('[data-apps-run]')) {
      const pinId = target.getAttribute('data-apps-run') || '';
      const record = findRecordByPinId(pinId);
      if (pinId && record && record.disabled !== true && !target.disabled) {
        const runPath = '/browser/metaapp/' + encodeURIComponent(pinId);
        window.location.href = (window.location && window.location.origin ? window.location.origin : '') + runPath;
      }
      return;
    }
    if (target.matches('[data-apps-share]')) {
      const record = findRecordByPinId(target.getAttribute('data-apps-share') || '');
      if (record) openAppsModal('share', record);
      return;
    }
    if (target.matches('[data-apps-detail]')) {
      const record = findRecordByPinId(target.getAttribute('data-apps-detail') || '');
      if (record) openAppsModal('detail', record);
      return;
    }
    if (target.matches('[data-apps-edit]')) {
      const record = findRecordByPinId(target.getAttribute('data-apps-edit') || '');
      if (record) openAppsModal('edit', record);
      return;
    }
    if (target.matches('[data-apps-delete-open]')) {
      const record = findRecordByPinId(target.getAttribute('data-apps-delete-open') || '');
      if (record) openAppsModal('delete', record);
      return;
    }
    if (target.matches('[data-apps-card]')) {
      const record = findRecordByPinId(target.getAttribute('data-apps-card') || '');
      if (record) openAppsModal('detail', record);
    }
  });

  document.addEventListener('keydown', (event) => {
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (!eventTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    const card = eventTarget.matches('[data-apps-card]') ? eventTarget : null;
    if (!card) return;
    event.preventDefault();
    const record = findRecordByPinId(card.getAttribute('data-apps-card') || '');
    if (record) openAppsModal('detail', record);
  });

  if (elements.refresh) elements.refresh.addEventListener('click', refreshApps);
  if (elements.publish) elements.publish.addEventListener('click', () => openAppsModal('publish', null));
  if (elements.modalRoot) {
    elements.modalRoot.addEventListener('click', (event) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      if (eventTarget && eventTarget.closest('[data-apps-modal-close]')) closeAppsModal();
    });
    elements.modalRoot.addEventListener('submit', async (event) => {
      const form = event.target instanceof Element ? event.target.closest('[data-apps-form]') : null;
      const deleteForm = event.target instanceof Element ? event.target.closest('[data-apps-delete-form]') : null;
      if (!form && !deleteForm) return;
      event.preventDefault();
      if (deleteForm) {
        await submitDeleteForm(deleteForm);
      } else if (form) {
        await submitMetaAppForm(form);
      }
    });
    elements.modalRoot.addEventListener('change', async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.matches('[data-apps-asset-file]')) {
        await handleAssetFileUpload(target);
      }
    });
  }
  if (elements.next) elements.next.addEventListener('click', async () => {
    if (state.loading || !state.nextCursor) return;
    const nextCursor = state.nextCursor;
    try {
      const loaded = await loadApps(nextCursor);
      if (loaded) {
        state.cursorStack.push(nextCursor);
        renderPaginationControls();
      }
    } catch (error) {
      showNotice('error', uiText('apps.loadErrorTitle', UI_TEXT.loadErrorTitle), error && error.message ? error.message : String(error));
    }
  });
  if (elements.prev) elements.prev.addEventListener('click', async () => {
    if (state.loading || state.cursorStack.length <= 1) return;
    const previousCursor = state.cursorStack[state.cursorStack.length - 2] || '';
    try {
      const loaded = await loadApps(previousCursor);
      if (loaded) {
        state.cursorStack.pop();
        renderPaginationControls();
      }
    } catch (error) {
      showNotice('error', uiText('apps.loadErrorTitle', UI_TEXT.loadErrorTitle), error && error.message ? error.message : String(error));
    }
  });

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('oac:i18n-changed', () => {
      renderBotPicker();
      renderGrid();
      if (state.modal && elements.modalRoot && !elements.modalRoot.hidden) {
        openAppsModal(state.modal.mode, state.modal.targetPinId ? findRecordByPinId(state.modal.targetPinId) : null);
      }
    });
  }

  initialize();
  if (typeof window !== 'undefined') {
    window.__oacAppsPage = { apiBase: APPS_API_BASE };
  }
})();`;
}
