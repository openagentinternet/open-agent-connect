import type { LocalUiPageDefinition } from '../types';
import { buildPublishPageViewModel } from './viewModel';

export function buildPublishPageDefinition(): LocalUiPageDefinition {
  const buildPublishPageViewModelSource = buildPublishPageViewModel.toString();
  return {
    page: 'publish',
    title: 'Publish Service',
    eyebrow: 'Provider Console',
    heading: 'Publish Service',
    description: 'Publish one local capability with a selected MetaBot primary runtime.',
    panels: [],
    contentHtml: `
      <section class="publish-shell" data-publish-shell>
        <div class="publish-main">
          <div class="publish-availability" data-publish-availability data-tone="neutral">
            Loading provider runtime...
          </div>

          <form class="publish-form" data-publish-form>
            <div class="publish-form-grid">
              <div class="publish-field publish-field-wide">
                <span>Provider Skills</span>
                <div class="skill-picker" data-provider-skill-picker aria-label="Provider skills">
                  <div class="skill-picker-row">
                    <select data-provider-skill-select aria-label="Provider skill to add" disabled>
                      <option value="">Loading skills...</option>
                    </select>
                    <button class="btn" type="button" data-provider-skill-add disabled>Add</button>
                  </div>
                  <div class="skill-chip-list" data-provider-skill-chips aria-live="polite">
                    <p class="field-hint">No skill selected.</p>
                  </div>
                </div>
              </div>

              <label class="publish-field">
                <span>Provider MetaBot</span>
                <select name="from" data-metabot-select required disabled>
                  <option value="">Loading MetaBots...</option>
                </select>
              </label>

              <label class="publish-field">
                <span>Display Name</span>
                <input name="displayName" data-display-name-input placeholder="Weather Oracle" required />
              </label>

              <label class="publish-field">
                <span>Service Name</span>
                <input name="serviceName" data-service-name-input placeholder="weather-oracle-service" required />
              </label>

              <label class="publish-field publish-field-wide">
                <span>Description</span>
                <textarea name="description" rows="4" placeholder="Describe exactly what the service does for buyers." required></textarea>
              </label>

              <label class="publish-field publish-field-wide">
                <span>Execution Reminder</span>
                <textarea name="executionReminder" rows="3" placeholder="Optional reminder inserted into the provider runtime before execution."></textarea>
              </label>

              <div class="publish-field">
                <span>Payment Timing</span>
                <div class="segmented-control" data-payment-timing>
                  <label><input type="radio" name="paymentTiming" value="free" /> Free</label>
                  <label><input type="radio" name="paymentTiming" value="prepaid" checked /> Prepaid</label>
                </div>
              </div>

              <label class="publish-field">
                <span>Price</span>
                <input name="price" data-price-input inputmode="decimal" placeholder="0.00001" required />
              </label>

              <label class="publish-field">
                <span>Settlement Currency</span>
                <select name="currency" required>
                  <option value="BTC" selected>BTC</option>
                  <option value="SPACE">SPACE</option>
                  <option value="DOGE">DOGE</option>
                  <option value="BTC-OPCAT">BTC-OPCAT</option>
                </select>
              </label>

              <label class="publish-field">
                <span>Input Type</span>
                <input name="inputType" value="text" readonly aria-readonly="true" />
              </label>

              <label class="publish-field">
                <span>Output Type</span>
                <select name="outputType" required>
                  <option value="text">text</option>
                  <option value="image">image</option>
                  <option value="video">video</option>
                  <option value="audio">audio</option>
                  <option value="other">other</option>
                </select>
              </label>

              <div class="publish-field publish-field-wide publish-icon-field">
                <span>Service Cover</span>
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
                      >Upload Image</label>
                      <button class="btn" type="button" data-service-icon-remove hidden>Remove</button>
                    </div>
                    <p class="publish-field-note" data-service-icon-note>Optional PNG, JPG, WebP, GIF, or SVG. Maximum 2MB.</p>
                  </div>
                </div>
              </div>
            </div>

            <p class="publish-skill-summary" data-publish-skill-summary>No skill selected.</p>

            <div class="publish-actions">
              <button class="btn btn-primary" type="submit" data-publish-submit disabled>Publish Service</button>
              <span class="publish-status" data-publish-status>Loading publish context.</span>
            </div>

            <div class="publish-status-panel" data-publish-status-panel hidden>
              <div class="publish-status-dialog" role="status" aria-live="polite">
                <div class="publish-status-mark" data-publish-status-panel-mark></div>
                <div class="publish-status-copy">
                  <h2 data-publish-status-panel-title>Publishing service</h2>
                  <p data-publish-status-panel-message>Writing the service payload to MetaWeb...</p>
                  <div class="publish-status-tx" data-publish-status-tx hidden>
                    <span>TXID</span>
                    <code data-publish-status-txid></code>
                    <button
                      class="publish-copy-button"
                      type="button"
                      title="Copy txid"
                      aria-label="Copy txid"
                      data-status-panel-action
                      data-publish-status-copy
                    >
                      <span class="publish-copy-icon" aria-hidden="true"></span>
                    </button>
                  </div>
                </div>
                <button class="btn btn-primary" type="button" data-status-panel-action data-publish-status-panel-close hidden>Done</button>
              </div>
            </div>
          </form>
        </div>

        <section class="publish-cards" aria-label="Selected publish context">
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
    priceInput: document.querySelector('[data-price-input]'),
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
    providerSkillSelectionInitialized: false,
  };
  let currentModel = null;
  let busy = false;
  let statusPanelOpen = false;
  let statusPanelState = 'idle';
  let serviceNameDirty = false;
  let displayNameDirty = false;
  let skillLoadToken = 0;

  const setStatus = (text, tone) => {
    if (!elements.status) return;
    elements.status.textContent = text;
    elements.status.dataset.tone = tone || 'neutral';
  };

  const setStatusPanel = (stateName, message) => {
    statusPanelState = stateName || 'idle';
    statusPanelOpen = statusPanelState !== 'idle';
    const title = statusPanelState === 'success'
      ? 'Service published'
      : statusPanelState === 'error'
        ? 'Publish failed'
        : 'Publishing service';
    const body = message || (
      statusPanelState === 'success'
        ? 'The service has been published to MetaWeb.'
        : statusPanelState === 'error'
          ? 'The service could not be published.'
          : 'Writing the service payload to MetaWeb...'
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
      elements.statusPanelCopy.title = 'Copy txid';
      elements.statusPanelCopy.setAttribute('aria-label', 'Copy txid');
    }
    if (elements.statusPanelClose) {
      elements.statusPanelClose.hidden = statusPanelState === 'submitting' || !statusPanelOpen;
      elements.statusPanelClose.textContent = statusPanelState === 'error' ? 'Close' : 'Done';
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
      throw new Error('Copy failed.');
    }
  };

  const selectedMetaBotSlug = () => elements.metaBotSelect ? normalizeText(elements.metaBotSelect.value) : state.selectedMetaBotSlug;
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
    if (!elements.form) return 'prepaid';
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
    placeholder.textContent = model.metabots.length ? 'Select a MetaBot' : 'No MetaBot has an available primary runtime';
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
    const previous = selectedSkillValues().filter((value) => availableValues.has(value));
    const selectedValues = previous.length
      ? previous
      : (!state.providerSkillSelectionInitialized && model.skills[0] ? [model.skills[0].value] : []);
    const selected = new Set(selectedValues);
    state.selectedProviderSkillValues = selectedValues;
    const disabled = busy || !model.availability.canPublish || model.skills.length === 0;
    if (!model.skills.length) {
      elements.skillSelect.innerHTML = '<option value="">No primary runtime skills available</option>';
      elements.skillSelect.disabled = true;
      elements.skillAdd.disabled = true;
      elements.skillChips.innerHTML = '<p class="field-hint">No primary runtime skills available.</p>';
      return;
    }
    state.providerSkillSelectionInitialized = true;

    const addableSkills = model.skills.filter((skill) => !selected.has(skill.value));
    if (!addableSkills.some((skill) => skill.value === state.candidateProviderSkillValue)) {
      state.candidateProviderSkillValue = '';
    }
    elements.skillSelect.innerHTML = '<option value="">Select a skill to add</option>' + addableSkills.map((skill) => (
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
          + '<button type="button" aria-label="Remove ' + escapeHtml(skill.value) + '" title="Remove" data-provider-skill-remove="' + escapeHtml(skill.value) + '"' + (disabled ? ' disabled' : '') + '>x</button>'
          + '</span>'
        )).join('')
      : '<p class="field-hint">No skill selected.</p>';
  };

  const renderSkillSummary = () => {
    if (!elements.skillSummary || !currentModel) return;
    const skills = selectedSkills() || [];
    if (!skills.length) {
      elements.skillSummary.textContent = currentModel.availability.message;
      return;
    }
    if (skills.length === 1) {
      const skill = skills[0];
      elements.skillSummary.textContent = skill.description || skill.title || skill.value;
      return;
    }
    elements.skillSummary.textContent = skills.length + ' skills selected: ' + skills.map((skill) => skill.value).join(', ');
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
    });
    renderCard(elements.providerCard, currentModel.providerCard, 'No selected provider identity is available.');
    renderCard(elements.runtimeCard, currentModel.runtimeCard, 'No primary runtime diagnostics are available.');
    renderMetaBotSelect(currentModel);
    renderSkillPicker(currentModel);
    renderSkillSummary();
    renderAvailability(currentModel);
    renderIconPreview();
    updateSubmitState();
    if (statusPanelOpen) {
      setStatusPanel(statusPanelState);
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
      setStatus('Select a MetaBot before publishing.', 'error');
      return;
    }
    setStatus('Loading selected MetaBot primary runtime skills...', 'busy');
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
    setStatus('Loading MetaBots and runtimes...', 'busy');
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
    render();
    const slug = state.selectedMetaBotSlug || selectedMetaBotSlug();
    if (slug) {
      await loadPublishSkills(slug);
    } else {
      setStatus('No MetaBot with an available primary runtime was found.', 'error');
    }
  };

  const readIconFile = (file) => new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }
    if (file.size > ICON_MAX_BYTES) {
      reject(new Error('Service cover must be 2MB or less.'));
      return;
    }
    if (!ICON_MIME_TYPES.has(String(file.type || '').toLowerCase())) {
      reject(new Error('Service cover must be PNG, JPG, WebP, GIF, or SVG.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Service cover could not be read.'));
    reader.readAsDataURL(file);
  });

  const validateClientPayload = (payload) => {
    if (!payload.from) return 'Provider MetaBot is required.';
    if (!Array.isArray(payload.providerSkills) || payload.providerSkills.length === 0) return 'At least one provider skill is required.';
    if (!payload.displayName) return 'Display name is required.';
    if (!payload.serviceName) return 'Service name is required.';
    if (!payload.description) return 'Description is required.';
    if (payload.paymentTiming !== 'free' && payload.paymentTiming !== 'prepaid') {
      return 'Payment timing must be free or prepaid.';
    }
    if (!/^\\d+(?:\\.\\d+)?$/u.test(payload.price) || !Number.isFinite(Number(payload.price)) || Number(payload.price) < 0) {
      return 'Price must be a non-negative decimal number.';
    }
    if (payload.paymentTiming === 'prepaid' && Number(payload.price) <= 0) {
      return 'Prepaid service price must be greater than zero.';
    }
    if (['BTC', 'SPACE', 'DOGE', 'BTC-OPCAT'].indexOf(payload.currency) < 0) {
      return 'Settlement currency must be BTC, SPACE, DOGE, or BTC-OPCAT.';
    }
    if (!OUTPUT_TYPES.has(payload.outputType)) {
      return 'Output type must be text, image, video, audio, or other.';
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
      state.providerSkillSelectionInitialized = false;
      if (elements.displayNameInput) elements.displayNameInput.value = '';
      if (elements.serviceNameInput) elements.serviceNameInput.value = '';
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
        setStatus(currentModel ? currentModel.availability.message : 'Publish context is not ready.', 'error');
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
      setStatusPanel('submitting', 'Writing the service payload to MetaWeb...');
      renderIconPreview();
      updateSubmitState();
      setStatus('Publishing to MetaWeb...', 'busy');
      try {
        const response = await fetch('/api/services/publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!result || result.ok !== true) {
          throw new Error((result && result.message) || 'Publish failed.');
        }
        state.publishResult = result.data;
        render();
        setStatusPanel('success', 'The service has been published to MetaWeb and now has a real chain pin.');
        setStatus('Published. Real chain pin received.', 'success');
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
        setStatus(currentModel ? currentModel.availability.message : 'Service cover ready.', currentModel && currentModel.availability.canPublish ? 'ready' : 'neutral');
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
        elements.statusPanelCopy.title = 'Copied';
        elements.statusPanelCopy.setAttribute('aria-label', 'Copied');
        setStatus('TXID copied.', 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Copy failed.', 'error');
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

  void loadPublishContext();
})();`,
  };
}
