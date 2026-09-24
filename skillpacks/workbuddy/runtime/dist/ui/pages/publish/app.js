"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublishPageDefinition = buildPublishPageDefinition;
const i18n_1 = require("../../i18n");
const viewModel_1 = require("./viewModel");
function buildPublishPageDefinition(i18n = (0, i18n_1.createI18nContext)()) {
    const buildPublishPageViewModelSource = viewModel_1.buildPublishPageViewModel.toString();
    return {
        page: 'publish',
        title: i18n.t('publish.title'),
        eyebrow: i18n.t('publish.eyebrow'),
        heading: i18n.t('publish.heading'),
        description: i18n.t('publish.description'),
        panels: [],
        contentHtml: `
      <section class="publish-shell" data-publish-shell>
        <div class="publish-main">
          <div class="publish-availability" data-publish-availability data-tone="neutral" data-i18n-key="publish.loadingRuntime">
            ${i18n.t('publish.loadingRuntime')}
          </div>

          <form class="publish-form" data-publish-form>
            <div class="publish-form-grid">
              <label class="publish-field">
                <span data-i18n-key="publish.providerMetabot">${i18n.t('publish.providerMetabot')}</span>
                <select name="from" data-metabot-select required disabled>
                  <option value="" data-i18n-key="publish.loadingMetabots">${i18n.t('publish.loadingMetabots')}</option>
                </select>
              </label>

              <label class="publish-field">
                <span data-i18n-key="publish.displayName">${i18n.t('publish.displayName')}</span>
                <input name="displayName" data-display-name-input placeholder="Weather Oracle" required />
              </label>

              <div class="publish-field publish-field-wide">
                <span data-i18n-key="publish.providerSkills">${i18n.t('publish.providerSkills')}</span>
                <div class="skill-picker" data-provider-skill-picker aria-label="${i18n.t('publish.providerSkillsAria')}">
                  <div class="skill-picker-row">
                    <select data-provider-skill-select aria-label="${i18n.t('publish.providerSkillAddAria')}" disabled>
                      <option value="" data-i18n-key="publish.loadingSkills">${i18n.t('publish.loadingSkills')}</option>
                    </select>
                    <button class="btn" type="button" data-provider-skill-add disabled data-i18n-key="publish.add">${i18n.t('publish.add')}</button>
                  </div>
                  <div class="skill-chip-list" data-provider-skill-chips aria-live="polite">
                    <p class="field-hint" data-i18n-key="publish.noSkillSelected">${i18n.t('publish.noSkillSelected')}</p>
                  </div>
                </div>
              </div>

              <label class="publish-field">
                <span data-i18n-key="publish.serviceName">${i18n.t('publish.serviceName')}</span>
                <input name="serviceName" data-service-name-input placeholder="weather-oracle-service" required />
              </label>

              <label class="publish-field publish-field-wide">
                <span data-i18n-key="publish.descriptionField">${i18n.t('publish.descriptionField')}</span>
                <textarea name="description" rows="4" placeholder="${i18n.t('publish.descriptionPlaceholder')}" required></textarea>
              </label>

              <label class="publish-field publish-field-wide">
                <span data-i18n-key="publish.executionReminder">${i18n.t('publish.executionReminder')}</span>
                <textarea name="executionReminder" rows="3" placeholder="${i18n.t('publish.executionReminderPlaceholder')}"></textarea>
              </label>

              <div class="publish-field publish-field-wide" data-payment-timing-field>
                <span data-i18n-key="publish.paymentTiming">${i18n.t('publish.paymentTiming')}</span>
                <div class="segmented-control" data-payment-timing>
                  <label><input type="radio" name="paymentTiming" value="free" checked /> <span data-i18n-key="publish.free">${i18n.t('publish.free')}</span></label>
                  <label><input type="radio" name="paymentTiming" value="prepaid" /> <span data-i18n-key="publish.prepaid">${i18n.t('publish.prepaid')}</span></label>
                </div>
              </div>

              <div class="publish-inline-row publish-field-wide" data-price-currency-row hidden>
                <label class="publish-field" data-price-field>
                  <span data-i18n-key="publish.price">${i18n.t('publish.price')}</span>
                  <input name="price" data-price-input inputmode="decimal" placeholder="0.00001" required />
                </label>

                <label class="publish-field" data-currency-field>
                  <span data-i18n-key="publish.settlementCurrency">${i18n.t('publish.settlementCurrency')}</span>
                  <select name="currency" data-currency-select required>
                    <option value="BTC" selected>BTC</option>
                    <option value="SPACE">SPACE</option>
                    <option value="DOGE">DOGE</option>
                    <option value="BTC-OPCAT">BTC-OPCAT</option>
                  </select>
                </label>
              </div>

              <div class="publish-inline-row publish-field-wide" data-io-type-row>
                <label class="publish-field">
                  <span data-i18n-key="publish.inputType">${i18n.t('publish.inputType')}</span>
                  <input name="inputType" value="text" readonly aria-readonly="true" />
                </label>

                <label class="publish-field">
                  <span data-i18n-key="publish.outputType">${i18n.t('publish.outputType')}</span>
                  <select name="outputType" required>
                    <option value="text">text</option>
                    <option value="image">image</option>
                    <option value="video">video</option>
                    <option value="audio">audio</option>
                    <option value="other">other</option>
                  </select>
                </label>
              </div>

              <div class="publish-field publish-field-wide publish-icon-field">
                <span data-i18n-key="publish.serviceCover">${i18n.t('publish.serviceCover')}</span>
                <div class="publish-icon-uploader">
                  <div class="publish-icon-preview" data-service-icon-preview>
                    <img alt="" data-service-icon-preview-img hidden />
                    <span data-service-icon-placeholder>IMG</span>
                  </div>
                  <div class="publish-icon-controls">
                    <input
                      id="publish-service-cover-input"
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml"
                      data-service-icon-input
                    />
                    <div class="publish-icon-actions">
                      <label
                        class="btn publish-upload-label"
                        for="publish-service-cover-input"
                        role="button"
                        tabindex="0"
                        data-service-icon-trigger
                      data-i18n-key="publish.uploadImage">${i18n.t('publish.uploadImage')}</label>
                      <button class="btn" type="button" data-service-icon-remove hidden data-i18n-key="publish.remove">${i18n.t('publish.remove')}</button>
                    </div>
                    <p class="publish-field-note" data-service-icon-note data-i18n-key="publish.coverNote">${i18n.t('publish.coverNote')}</p>
                  </div>
                </div>
              </div>
            </div>

            <p class="publish-skill-summary" data-publish-skill-summary data-i18n-key="publish.noSkillSelected">${i18n.t('publish.noSkillSelected')}</p>

            <div class="publish-actions">
              <button class="btn btn-primary" type="submit" data-publish-submit disabled data-i18n-key="publish.publishService">${i18n.t('publish.publishService')}</button>
              <span class="publish-status" data-publish-status data-i18n-key="publish.loadingContext">${i18n.t('publish.loadingContext')}</span>
            </div>

            <div class="publish-status-panel" data-publish-status-panel hidden>
              <div class="publish-status-dialog" role="status" aria-live="polite">
                <div class="publish-status-mark" data-publish-status-panel-mark></div>
                <div class="publish-status-copy">
                  <h2 data-publish-status-panel-title data-i18n-key="publish.publishingTitle">${i18n.t('publish.publishingTitle')}</h2>
                  <p data-publish-status-panel-message data-i18n-key="publish.publishingMessage">${i18n.t('publish.publishingMessage')}</p>
                  <div class="publish-status-tx" data-publish-status-tx hidden>
                    <span data-i18n-key="publish.txid">${i18n.t('publish.txid')}</span>
                    <code data-publish-status-txid></code>
                    <button
                      class="publish-copy-button"
                      type="button"
                      title="${i18n.t('publish.copyTxid')}"
                      aria-label="${i18n.t('publish.copyTxid')}"
                      data-status-panel-action
                      data-publish-status-copy
                    >
                      <span class="publish-copy-icon" aria-hidden="true"></span>
                    </button>
                  </div>
                </div>
                <button class="btn btn-primary" type="button" data-status-panel-action data-publish-status-panel-close hidden data-i18n-key="publish.done">${i18n.t('publish.done')}</button>
              </div>
            </div>
          </form>
        </div>

        <section class="publish-cards" aria-label="${i18n.t('publish.cardsAria')}">
          <article class="publish-card" data-publish-provider-card></article>
          <article class="publish-card" data-publish-runtime-card></article>
        </section>
      </section>
    `,
        script: `(() => {
  const buildPublishPageViewModel = ${buildPublishPageViewModelSource};
  const ICON_MAX_BYTES = 2 * 1024 * 1024;
  const ICON_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml']);
  const OUTPUT_TYPES = new Set(['text', 'image', 'video', 'audio', 'other']);
  const elements = {
    form: document.querySelector('[data-publish-form]'),
    submit: document.querySelector('[data-publish-submit]'),
    status: document.querySelector('[data-publish-status]'),
    availability: document.querySelector('[data-publish-availability]'),
    metaBotSelect: document.querySelector('[data-metabot-select]'),
    skillSelect: document.querySelector('[data-provider-skill-select]'),
    skillAdd: document.querySelector('[data-provider-skill-add]'),
    skillChips: document.querySelector('[data-provider-skill-chips]'),
    skillSummary: document.querySelector('[data-publish-skill-summary]'),
    providerCard: document.querySelector('[data-publish-provider-card]'),
    runtimeCard: document.querySelector('[data-publish-runtime-card]'),
    displayNameInput: document.querySelector('[data-display-name-input]'),
    serviceNameInput: document.querySelector('[data-service-name-input]'),
    priceCurrencyRow: document.querySelector('[data-price-currency-row]'),
    priceInput: document.querySelector('[data-price-input]'),
    currencySelect: document.querySelector('[data-currency-select]'),
    iconInput: document.querySelector('[data-service-icon-input]'),
    iconTrigger: document.querySelector('[data-service-icon-trigger]'),
    iconRemove: document.querySelector('[data-service-icon-remove]'),
    iconPreview: document.querySelector('[data-service-icon-preview]'),
    iconPreviewImg: document.querySelector('[data-service-icon-preview-img]'),
    iconPlaceholder: document.querySelector('[data-service-icon-placeholder]'),
    iconNote: document.querySelector('[data-service-icon-note]'),
    statusPanel: document.querySelector('[data-publish-status-panel]'),
    statusPanelMark: document.querySelector('[data-publish-status-panel-mark]'),
    statusPanelTitle: document.querySelector('[data-publish-status-panel-title]'),
    statusPanelMessage: document.querySelector('[data-publish-status-panel-message]'),
    statusPanelTx: document.querySelector('[data-publish-status-tx]'),
    statusPanelTxid: document.querySelector('[data-publish-status-txid]'),
    statusPanelCopy: document.querySelector('[data-publish-status-copy]'),
    statusPanelClose: document.querySelector('[data-publish-status-panel-close]'),
  };
  const state = {
    providerSummary: null,
    profiles: [],
    runtimes: [],
    selectedMetaBotSlug: '',
    publishSkills: null,
    publishSkillsError: null,
    publishResult: null,
    serviceIconDataUrl: '',
    selectedProviderSkillValues: [],
    candidateProviderSkillValue: '',
  };
  let currentModel = null;
  let busy = false;
  let statusPanelOpen = false;
  let statusPanelState = 'idle';
  let statusPanelMessage = '';
  let serviceNameDirty = false;
  let displayNameDirty = false;
  let skillLoadToken = 0;

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

  const setStatus = (text, tone) => {
    if (!elements.status) return;
    elements.status.textContent = text;
    elements.status.dataset.tone = tone || 'neutral';
  };

  const setStatusPanel = (stateName, message) => {
    statusPanelState = stateName || 'idle';
    statusPanelOpen = statusPanelState !== 'idle';
    statusPanelMessage = String(message || '');
    const title = statusPanelState === 'success'
      ? uiText('publish.statusPublished', 'Service published')
      : statusPanelState === 'error'
        ? uiText('publish.statusFailed', 'Publish failed')
        : uiText('publish.publishingTitle', 'Publishing service');
    const body = statusPanelMessage || (
      statusPanelState === 'success'
        ? uiText('publish.statusPublishedBody', 'The service has been published to MetaWeb.')
        : statusPanelState === 'error'
          ? uiText('publish.statusErrorBody', 'The service could not be published.')
          : uiText('publish.publishingMessage', 'Writing the service payload to MetaWeb...')
    );
    if (elements.statusPanel) {
      elements.statusPanel.hidden = !statusPanelOpen;
      elements.statusPanel.dataset.state = statusPanelState;
    }
    if (elements.statusPanelTitle) elements.statusPanelTitle.textContent = title;
    if (elements.statusPanelMessage) elements.statusPanelMessage.textContent = body;
    if (elements.statusPanelMark) elements.statusPanelMark.dataset.state = statusPanelState;
    const txid = statusPanelState === 'success' ? extractPublishTxid(state.publishResult) : '';
    if (elements.statusPanelTx) {
      elements.statusPanelTx.hidden = !txid;
    }
    if (elements.statusPanelTxid) {
      elements.statusPanelTxid.textContent = txid;
    }
    if (elements.statusPanelCopy) {
      elements.statusPanelCopy.disabled = !txid;
      elements.statusPanelCopy.dataset.copied = 'false';
      elements.statusPanelCopy.title = uiText('publish.copyTxid', 'Copy txid');
      elements.statusPanelCopy.setAttribute('aria-label', uiText('publish.copyTxid', 'Copy txid'));
    }
    if (elements.statusPanelClose) {
      elements.statusPanelClose.hidden = statusPanelState === 'submitting' || !statusPanelOpen;
      elements.statusPanelClose.textContent = statusPanelState === 'error' ? uiText('publish.close', 'Close') : uiText('publish.done', 'Done');
    }
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const normalizeText = (value) => String(value || '').trim();
  const extractPublishTxid = (result) => {
    const txids = Array.isArray(result && result.txids) ? result.txids : [];
    for (const txid of txids) {
      const normalized = normalizeText(txid);
      if (normalized) return normalized;
    }
    return normalizeText(result && result.txid);
  };
  const copyText = async (text) => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return;
    }
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', 'true');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    const copied = document.execCommand('copy');
    scratch.remove();
    if (!copied) {
      throw new Error(uiText('publish.copyFailed', 'Copy failed.'));
    }
  };

  const selectedMetaBotSlug = () => elements.metaBotSelect ? normalizeText(elements.metaBotSelect.value) : state.selectedMetaBotSlug;
  const readQueryFromSlug = () => {
    try {
      return normalizeText(new URLSearchParams(window.location.search).get('from'));
    } catch {
      return '';
    }
  };
  const replaceQueryFromSlug = (slug) => {
    try {
      if (!window.history || typeof window.history.replaceState !== 'function') return;
      const params = new URLSearchParams(window.location.search);
      if (slug) params.set('from', slug);
      else params.delete('from');
      const query = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (query ? '?' + query : ''));
    } catch { /* ignore URL updates */ }
  };
  const normalizeSkillValues = (values) => {
    const seen = new Set();
    const normalized = [];
    for (const value of Array.isArray(values) ? values : [values]) {
      const skillValue = normalizeText(value);
      if (!skillValue || seen.has(skillValue)) continue;
      seen.add(skillValue);
      normalized.push(skillValue);
    }
    return normalized;
  };
  const selectedSkillValues = () => normalizeSkillValues(state.selectedProviderSkillValues);
  const selectedSkills = () => {
    if (!currentModel || !Array.isArray(currentModel.skills)) return null;
    const skillByValue = new Map(currentModel.skills.map((skill) => [skill.value, skill]));
    return selectedSkillValues()
      .map((value) => skillByValue.get(value))
      .filter(Boolean);
  };
  const selectedPrimarySkill = () => {
    const skills = selectedSkills();
    return skills && skills.length ? skills[0] : null;
  };
  const selectedPaymentTiming = () => {
    if (!elements.form) return 'free';
    const formData = new FormData(elements.form);
    const timing = normalizeText(formData.get('paymentTiming')).toLowerCase();
    return timing === 'free' ? 'free' : 'prepaid';
  };

  const skillExists = (value) => Boolean(
    currentModel
    && Array.isArray(currentModel.skills)
    && currentModel.skills.some((skill) => skill.value === value)
  );

  const renderCard = (target, card, emptyText) => {
    if (!target) return;
    const rows = Array.isArray(card && card.rows) ? card.rows : [];
    target.innerHTML = [
      '<h2>' + escapeHtml(card && card.title) + '</h2>',
      '<p class="publish-card-summary">' + escapeHtml(card && card.summary) + '</p>',
      rows.length
        ? '<dl class="publish-card-rows">' + rows.map((row) => (
            '<div class="publish-card-row"><dt>' + escapeHtml(row.label) + '</dt><dd>' + escapeHtml(row.value) + '</dd></div>'
          )).join('') + '</dl>'
        : '<p class="publish-card-empty">' + escapeHtml(emptyText) + '</p>',
    ].join('');
  };

  const renderMetaBotSelect = (model) => {
    if (!elements.metaBotSelect) return;
    const previous = state.selectedMetaBotSlug || selectedMetaBotSlug();
    elements.metaBotSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = model.metabots.length
      ? uiText('publish.selectMetabot', 'Select a MetaBot')
      : uiText('publish.noMetabotRuntime', 'No MetaBot has an available primary runtime');
    elements.metaBotSelect.appendChild(placeholder);

    for (const bot of model.metabots) {
      const option = document.createElement('option');
      option.value = bot.value;
      option.textContent = bot.primaryProvider ? bot.label + ' - ' + bot.primaryProvider : bot.label;
      option.dataset.globalMetaId = bot.globalMetaId || '';
      elements.metaBotSelect.appendChild(option);
    }

    if (previous && model.metabots.some((bot) => bot.value === previous)) {
      elements.metaBotSelect.value = previous;
      state.selectedMetaBotSlug = previous;
    } else if (model.metabots.length > 0) {
      elements.metaBotSelect.value = model.metabots[0].value;
      state.selectedMetaBotSlug = model.metabots[0].value;
    } else {
      elements.metaBotSelect.value = '';
      state.selectedMetaBotSlug = '';
    }
    elements.metaBotSelect.disabled = busy || model.metabots.length === 0;
  };

  const renderSkillPicker = (model) => {
    if (!elements.skillSelect || !elements.skillAdd || !elements.skillChips) return;
    if (!model || !Array.isArray(model.skills)) return;
    const availableValues = new Set(model.skills.map((skill) => skill.value));
    const selectedValues = selectedSkillValues().filter((value) => availableValues.has(value));
    const selected = new Set(selectedValues);
    state.selectedProviderSkillValues = selectedValues;
    const disabled = busy || !model.availability.canPublish || model.skills.length === 0;
    if (!model.skills.length) {
      elements.skillSelect.innerHTML = '<option value="">' + escapeHtml(uiText('publish.noSkills', 'No primary runtime skills available')) + '</option>';
      elements.skillSelect.disabled = true;
      elements.skillAdd.disabled = true;
      elements.skillChips.innerHTML = '<p class="field-hint">' + escapeHtml(uiText('publish.noSkillsHint', 'No primary runtime skills available.')) + '</p>';
      return;
    }

    const addableSkills = model.skills.filter((skill) => !selected.has(skill.value));
    if (!addableSkills.some((skill) => skill.value === state.candidateProviderSkillValue)) {
      state.candidateProviderSkillValue = '';
    }
    elements.skillSelect.innerHTML = '<option value="">' + escapeHtml(uiText('publish.selectSkillToAdd', 'Select a skill to add')) + '</option>' + addableSkills.map((skill) => (
      '<option value="' + escapeHtml(skill.value) + '">' + escapeHtml(skill.title || skill.value) + '</option>'
    )).join('');
    elements.skillSelect.value = state.candidateProviderSkillValue;
    elements.skillSelect.disabled = disabled || addableSkills.length === 0;
    elements.skillAdd.disabled = disabled || !state.candidateProviderSkillValue;

    const selectedSkills = selectedValues
      .map((value) => model.skills.find((skill) => skill.value === value))
      .filter(Boolean);
    elements.skillChips.innerHTML = selectedSkills.length
      ? selectedSkills.map((skill) => (
          '<span class="skill-chip">'
          + '<span title="' + escapeHtml(skill.value) + '">' + escapeHtml(skill.title || skill.value) + '</span>'
          + '<button type="button" aria-label="' + escapeHtml(uiText('publish.removeSkillAria', 'Remove {skill}', { skill: skill.value })) + '" title="' + escapeHtml(uiText('publish.removeSkill', 'Remove')) + '" data-provider-skill-remove="' + escapeHtml(skill.value) + '"' + (disabled ? ' disabled' : '') + '>x</button>'
          + '</span>'
        )).join('')
      : '<p class="field-hint">' + escapeHtml(uiText('publish.noSkillSelected', 'No skill selected.')) + '</p>';
  };

  const renderSkillSummary = () => {
    if (!elements.skillSummary || !currentModel) return;
    const skills = selectedSkills() || [];
    if (!skills.length) {
      elements.skillSummary.textContent = currentModel.availability && currentModel.availability.canPublish
        ? uiText('publish.noSkillSelected', 'No skill selected.')
        : currentModel.availability.message;
      return;
    }
    if (skills.length === 1) {
      const skill = skills[0];
      elements.skillSummary.textContent = skill.description || skill.title || skill.value;
      return;
    }
    elements.skillSummary.textContent = uiText('publish.skillsSelected', '{count} skills selected: {skills}', {
      count: skills.length,
      skills: skills.map((skill) => skill.value).join(', '),
    });
  };

  const renderAvailability = (model) => {
    if (!elements.availability) return;
    elements.availability.textContent = model.availability.message;
    elements.availability.dataset.tone = model.availability.canPublish ? 'ready' : 'blocked';
    elements.availability.dataset.reason = model.availability.reasonCode;
  };

  const renderIconPreview = () => {
    const hasIcon = Boolean(state.serviceIconDataUrl);
    const coverDisabled = busy || statusPanelOpen;
    if (elements.iconPreviewImg) {
      elements.iconPreviewImg.hidden = !hasIcon;
      if (hasIcon) elements.iconPreviewImg.src = state.serviceIconDataUrl;
      else elements.iconPreviewImg.removeAttribute('src');
    }
    if (elements.iconPlaceholder) {
      elements.iconPlaceholder.hidden = hasIcon;
    }
    if (elements.iconRemove) {
      elements.iconRemove.hidden = !hasIcon;
      elements.iconRemove.disabled = coverDisabled;
    }
    if (elements.iconTrigger) {
      elements.iconTrigger.setAttribute('aria-disabled', coverDisabled ? 'true' : 'false');
      elements.iconTrigger.tabIndex = coverDisabled ? -1 : 0;
    }
    if (elements.iconInput) {
      elements.iconInput.disabled = coverDisabled;
    }
    if (elements.iconPreview) {
      elements.iconPreview.dataset.hasIcon = hasIcon ? 'true' : 'false';
    }
  };

  const syncPaymentTimingFields = () => {
    if (!elements.priceInput) return;
    const isFree = selectedPaymentTiming() === 'free';
    if (elements.priceCurrencyRow) {
      elements.priceCurrencyRow.hidden = isFree;
    }
    if (isFree) {
      elements.priceInput.value = '0';
    }
    elements.priceInput.disabled = isFree || busy || statusPanelOpen;
  };

  const syncFormDisabled = () => {
    if (!elements.form) return;
    const forcedDisabled = busy || statusPanelOpen;
    elements.form.querySelectorAll('input, select, textarea, button').forEach((control) => {
      if (control.hasAttribute('data-status-panel-action')) {
        return;
      }
      control.disabled = forcedDisabled;
    });
    if (forcedDisabled) {
      return;
    }
    if (elements.metaBotSelect) {
      elements.metaBotSelect.disabled = !currentModel || !Array.isArray(currentModel.metabots) || currentModel.metabots.length === 0;
    }
    if (elements.skillSelect && elements.skillAdd) {
      const skillsDisabled = !currentModel || !currentModel.availability.canPublish || currentModel.skills.length === 0;
      const selected = new Set(selectedSkillValues());
      const addableSkills = currentModel && Array.isArray(currentModel.skills)
        ? currentModel.skills.filter((skill) => !selected.has(skill.value))
        : [];
      elements.skillSelect.disabled = skillsDisabled || addableSkills.length === 0;
      elements.skillAdd.disabled = skillsDisabled || !state.candidateProviderSkillValue;
      if (elements.skillChips) {
        elements.skillChips.querySelectorAll('[data-provider-skill-remove]').forEach((button) => {
          button.disabled = skillsDisabled;
        });
      }
    }
    syncPaymentTimingFields();
  };

  const isFormReady = () => {
    if (!currentModel || !currentModel.availability || !currentModel.availability.canPublish) return false;
    const skills = selectedSkillValues();
    if (!skills.length || !skills.every((skill) => skillExists(skill))) return false;
    if (!selectedMetaBotSlug()) return false;
    if (!elements.form) return false;
    const formData = new FormData(elements.form);
    const paymentTiming = selectedPaymentTiming();
    const price = paymentTiming === 'free' ? '0' : normalizeText(formData.get('price'));
    const outputType = normalizeText(formData.get('outputType')).toLowerCase();
    return Boolean(
      normalizeText(formData.get('displayName'))
      && normalizeText(formData.get('serviceName'))
      && normalizeText(formData.get('description'))
      && /^\\d+(?:\\.\\d+)?$/u.test(price)
      && Number(price) >= 0
      && (paymentTiming === 'free' || Number(price) > 0)
      && OUTPUT_TYPES.has(outputType)
    );
  };

  const updateSubmitState = () => {
    if (!elements.submit) return;
    syncFormDisabled();
    if (statusPanelOpen) {
      elements.submit.disabled = true;
      return;
    }
    elements.submit.disabled = busy || !isFormReady();
  };

  const applySkillDefaults = () => {
    const skill = selectedPrimarySkill();
    if (!skill) {
      updateSubmitState();
      return;
    }
    if (elements.serviceNameInput && !serviceNameDirty) {
      elements.serviceNameInput.value = skill.value + '-service';
    }
    renderSkillSummary();
    updateSubmitState();
  };

  const render = () => {
    currentModel = buildPublishPageViewModel({
      providerSummary: state.providerSummary,
      profiles: state.profiles,
      runtimes: state.runtimes,
      selectedMetaBotSlug: state.selectedMetaBotSlug,
      publishSkills: state.publishSkills,
      publishSkillsError: state.publishSkillsError,
      publishResult: state.publishResult,
      t: uiText,
    });
    renderCard(elements.providerCard, currentModel.providerCard, uiText('publish.noProviderIdentity', 'No selected provider identity is available.'));
    renderCard(elements.runtimeCard, currentModel.runtimeCard, uiText('publish.noRuntimeDiagnostics', 'No primary runtime diagnostics are available.'));
    renderMetaBotSelect(currentModel);
    renderSkillPicker(currentModel);
    renderSkillSummary();
    renderAvailability(currentModel);
    renderIconPreview();
    updateSubmitState();
    if (statusPanelOpen) {
      setStatusPanel(statusPanelState, statusPanelMessage);
    }
  };

  const loadJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    return response.json();
  };

  const loadPublishSkills = async (slug) => {
    const token = ++skillLoadToken;
    state.publishSkills = null;
    state.publishSkillsError = null;
    state.publishResult = null;
    render();
    if (!slug) {
      setStatus(uiText('publish.selectBeforePublishing', 'Select a MetaBot before publishing.'), 'error');
      return;
    }
    setStatus(uiText('publish.loadingSkillsStatus', 'Loading selected MetaBot primary runtime skills...'), 'busy');
    try {
      const envelope = await loadJson('/api/services/skills?from=' + encodeURIComponent(slug));
      if (token !== skillLoadToken) return;
      if (envelope && envelope.ok === true) {
        state.publishSkills = envelope.data;
        state.publishSkillsError = null;
      } else {
        state.publishSkills = null;
        state.publishSkillsError = {
          code: envelope && envelope.code,
          message: envelope && envelope.message,
        };
      }
    } catch (error) {
      if (token !== skillLoadToken) return;
      state.publishSkills = null;
      state.publishSkillsError = {
        code: 'publish_skills_failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    render();
    applySkillDefaults();
    if (currentModel && currentModel.availability.canPublish) {
      setStatus(currentModel.availability.message, 'ready');
    } else if (currentModel) {
      setStatus(currentModel.availability.message, 'error');
    }
  };

  const loadPublishContext = async () => {
    setStatus(uiText('publish.loadingContextStatus', 'Loading MetaBots and runtimes...'), 'busy');
    const [profilesEnvelope, runtimesEnvelope] = await Promise.all([
      loadJson('/api/bot/profiles').catch((error) => ({
        ok: false,
        code: 'metabot_profiles_failed',
        message: error instanceof Error ? error.message : String(error),
      })),
      loadJson('/api/bot/runtimes').catch((error) => ({
        ok: false,
        code: 'runtimes_failed',
        message: error instanceof Error ? error.message : String(error),
      })),
    ]);

    state.providerSummary = null;
    state.profiles = profilesEnvelope && profilesEnvelope.ok === true && profilesEnvelope.data && Array.isArray(profilesEnvelope.data.profiles)
      ? profilesEnvelope.data.profiles
      : [];
    state.runtimes = runtimesEnvelope && runtimesEnvelope.ok === true && runtimesEnvelope.data && Array.isArray(runtimesEnvelope.data.runtimes)
      ? runtimesEnvelope.data.runtimes
      : [];
    const queryFromSlug = readQueryFromSlug();
    if (queryFromSlug) {
      const queryModel = buildPublishPageViewModel({
        profiles: state.profiles,
        runtimes: state.runtimes,
        selectedMetaBotSlug: queryFromSlug,
        t: uiText,
      });
      if (queryModel.metabots.some((bot) => bot.value === queryFromSlug)) {
        state.selectedMetaBotSlug = queryFromSlug;
      }
    }
    render();
    const slug = state.selectedMetaBotSlug || selectedMetaBotSlug();
    if (slug) {
      await loadPublishSkills(slug);
    } else {
      setStatus(uiText('publish.noMetabotFound', 'No MetaBot with an available primary runtime was found.'), 'error');
    }
  };

  const readIconFile = (file) => new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }
    if (file.size > ICON_MAX_BYTES) {
      reject(new Error(uiText('publish.coverTooLarge', 'Service cover must be 2MB or less.')));
      return;
    }
    if (!ICON_MIME_TYPES.has(String(file.type || '').toLowerCase())) {
      reject(new Error(uiText('publish.coverBadType', 'Service cover must be PNG, JPG, WebP, GIF, or SVG.')));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(uiText('publish.coverReadFailed', 'Service cover could not be read.')));
    reader.readAsDataURL(file);
  });

  const validateClientPayload = (payload) => {
    if (!payload.from) return uiText('publish.validationMetabot', 'Provider MetaBot is required.');
    if (!Array.isArray(payload.providerSkills) || payload.providerSkills.length === 0) return uiText('publish.validationSkill', 'At least one provider skill is required.');
    if (!payload.displayName) return uiText('publish.validationDisplayName', 'Display name is required.');
    if (!payload.serviceName) return uiText('publish.validationServiceName', 'Service name is required.');
    if (!payload.description) return uiText('publish.validationDescription', 'Description is required.');
    if (payload.paymentTiming !== 'free' && payload.paymentTiming !== 'prepaid') {
      return uiText('publish.validationTiming', 'Payment timing must be free or prepaid.');
    }
    if (!/^\\d+(?:\\.\\d+)?$/u.test(payload.price) || !Number.isFinite(Number(payload.price)) || Number(payload.price) < 0) {
      return uiText('publish.validationPrice', 'Price must be a non-negative decimal number.');
    }
    if (payload.paymentTiming === 'prepaid' && Number(payload.price) <= 0) {
      return uiText('publish.validationPrepaidPrice', 'Prepaid service price must be greater than zero.');
    }
    if (['BTC', 'SPACE', 'DOGE', 'BTC-OPCAT'].indexOf(payload.currency) < 0) {
      return uiText('publish.validationCurrency', 'Settlement currency must be BTC, SPACE, DOGE, or BTC-OPCAT.');
    }
    if (!OUTPUT_TYPES.has(payload.outputType)) {
      return uiText('publish.validationOutputType', 'Output type must be text, image, video, audio, or other.');
    }
    return '';
  };

  const buildSubmitPayload = () => {
    const formData = new FormData(elements.form);
    const paymentTiming = selectedPaymentTiming();
    const payload = {
      from: selectedMetaBotSlug(),
      providerSkills: selectedSkillValues(),
      displayName: normalizeText(formData.get('displayName')),
      serviceName: normalizeText(formData.get('serviceName')),
      description: normalizeText(formData.get('description')),
      executionReminder: normalizeText(formData.get('executionReminder')),
      paymentTiming,
      settlementKind: 'native',
      price: paymentTiming === 'free' ? '0' : normalizeText(formData.get('price')),
      currency: normalizeText(formData.get('currency')).toUpperCase(),
      inputType: 'text',
      outputType: normalizeText(formData.get('outputType')).toLowerCase(),
    };
    if (state.serviceIconDataUrl) {
      payload.serviceIconDataUrl = state.serviceIconDataUrl;
    }
    return payload;
  };

  if (elements.metaBotSelect) {
    elements.metaBotSelect.addEventListener('change', () => {
      state.selectedMetaBotSlug = selectedMetaBotSlug();
      serviceNameDirty = false;
      displayNameDirty = false;
      state.selectedProviderSkillValues = [];
      state.candidateProviderSkillValue = '';
      if (elements.displayNameInput) elements.displayNameInput.value = '';
      if (elements.serviceNameInput) elements.serviceNameInput.value = '';
      replaceQueryFromSlug(state.selectedMetaBotSlug);
      void loadPublishSkills(state.selectedMetaBotSlug);
    });
  }

  if (elements.skillSelect) {
    elements.skillSelect.addEventListener('change', () => {
      state.candidateProviderSkillValue = normalizeText(elements.skillSelect.value);
      renderSkillPicker(currentModel);
      updateSubmitState();
    });
  }

  if (elements.skillAdd) {
    elements.skillAdd.addEventListener('click', () => {
      const candidate = normalizeText(state.candidateProviderSkillValue);
      if (!candidate || !skillExists(candidate) || selectedSkillValues().includes(candidate)) return;
      state.selectedProviderSkillValues = normalizeSkillValues([...selectedSkillValues(), candidate]);
      state.candidateProviderSkillValue = '';
      renderSkillPicker(currentModel);
      applySkillDefaults();
    });
  }

  if (elements.skillChips) {
    elements.skillChips.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-provider-skill-remove]') : null;
      if (!target) return;
      const skillValue = normalizeText(target.getAttribute('data-provider-skill-remove'));
      state.selectedProviderSkillValues = selectedSkillValues().filter((value) => value !== skillValue);
      renderSkillPicker(currentModel);
      applySkillDefaults();
    });
  }

  if (elements.form) {
    elements.form.querySelectorAll('input[name="paymentTiming"]').forEach((input) => {
      input.addEventListener('change', () => {
        syncPaymentTimingFields();
        updateSubmitState();
      });
    });
  }

  if (elements.serviceNameInput) {
    elements.serviceNameInput.addEventListener('input', () => {
      serviceNameDirty = true;
      updateSubmitState();
    });
  }

  if (elements.displayNameInput) {
    elements.displayNameInput.addEventListener('input', () => {
      displayNameDirty = true;
      updateSubmitState();
    });
  }

  if (elements.form) {
    elements.form.addEventListener('input', updateSubmitState);
    elements.form.addEventListener('change', updateSubmitState);
    elements.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentModel || !currentModel.availability.canPublish) {
        setStatus(currentModel ? currentModel.availability.message : uiText('publish.contextNotReady', 'Publish context is not ready.'), 'error');
        updateSubmitState();
        return;
      }
      const payload = buildSubmitPayload();
      const clientError = validateClientPayload(payload);
      if (clientError) {
        setStatus(clientError, 'error');
        updateSubmitState();
        return;
      }

      busy = true;
      setStatusPanel('submitting', uiText('publish.publishingMessage', 'Writing the service payload to MetaWeb...'));
      renderIconPreview();
      updateSubmitState();
      setStatus(uiText('publish.publishingStatus', 'Publishing to MetaWeb...'), 'busy');
      try {
        const response = await fetch('/api/services/publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!result || result.ok !== true) {
          throw new Error((result && result.message) || uiText('publish.publishFailed', 'Publish failed.'));
        }
        state.publishResult = result.data;
        render();
        setStatusPanel('success', uiText('publish.publishedMessage', 'The service has been published to MetaWeb and now has a real chain pin.'));
        setStatus(uiText('publish.publishedStatus', 'Published. Real chain pin received.'), 'success');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatusPanel('error', message);
        setStatus(message, 'error');
      } finally {
        busy = false;
        renderIconPreview();
        updateSubmitState();
      }
    });
  }

  if (elements.iconTrigger && elements.iconInput) {
    elements.iconTrigger.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (!elements.iconInput.disabled) elements.iconInput.click();
    });
  }

  if (elements.iconInput) {
    elements.iconInput.addEventListener('change', async () => {
      const file = elements.iconInput.files && elements.iconInput.files[0];
      try {
        state.serviceIconDataUrl = await readIconFile(file);
        setStatus(currentModel ? currentModel.availability.message : uiText('publish.coverReady', 'Service cover ready.'), currentModel && currentModel.availability.canPublish ? 'ready' : 'neutral');
      } catch (error) {
        state.serviceIconDataUrl = '';
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        elements.iconInput.value = '';
        renderIconPreview();
        updateSubmitState();
      }
    });
  }

  if (elements.iconRemove) {
    elements.iconRemove.addEventListener('click', () => {
      state.serviceIconDataUrl = '';
      renderIconPreview();
      updateSubmitState();
    });
  }

  if (elements.statusPanelCopy) {
    elements.statusPanelCopy.addEventListener('click', async () => {
      const txid = normalizeText(elements.statusPanelTxid && elements.statusPanelTxid.textContent);
      if (!txid) return;
      try {
        await copyText(txid);
        elements.statusPanelCopy.dataset.copied = 'true';
        elements.statusPanelCopy.title = uiText('publish.copied', 'Copied');
        elements.statusPanelCopy.setAttribute('aria-label', uiText('publish.copied', 'Copied'));
        setStatus(uiText('publish.txidCopied', 'TXID copied.'), 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : uiText('publish.copyFailed', 'Copy failed.'), 'error');
      }
    });
  }

  if (elements.statusPanelClose) {
    elements.statusPanelClose.addEventListener('click', () => {
      setStatusPanel('idle');
      renderIconPreview();
      syncFormDisabled();
      updateSubmitState();
    });
  }

  window.addEventListener('oac:i18n-changed', () => {
    render();
  });

  void loadPublishContext();
})();`,
    };
}
