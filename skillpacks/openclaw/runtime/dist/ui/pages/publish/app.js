"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPublishPageDefinition = buildPublishPageDefinition;
const viewModel_1 = require("./viewModel");
function buildPublishPageDefinition() {
    const buildPublishPageViewModelSource = viewModel_1.buildPublishPageViewModel.toString();
    return {
        page: 'publish',
        title: 'Publish Service',
        eyebrow: 'Provider Console',
        heading: 'Publish Service',
        description: 'Publish one local capability with the active MetaBot primary runtime.',
        panels: [],
        contentHtml: `
      <section class="publish-shell" data-publish-shell>
        <div class="publish-main">
          <div class="publish-availability" data-publish-availability data-tone="neutral">
            Loading provider runtime...
          </div>

          <form class="publish-form" data-publish-form>
            <div class="publish-form-grid">
              <label class="publish-field">
                <span>Service Name</span>
                <input name="serviceName" value="weather-service" required />
              </label>
              <label class="publish-field">
                <span>Display Name</span>
                <input name="displayName" value="Weather Service" required />
              </label>
              <label class="publish-field publish-field-wide">
                <span>Description</span>
                <textarea name="description" rows="3" required>Returns one concise weather answer from this local MetaBot.</textarea>
              </label>
              <label class="publish-field">
                <span>Provider Skill</span>
                <select name="providerSkill" data-provider-skill-select required disabled>
                  <option value="">Loading primary runtime skills...</option>
                </select>
              </label>
              <label class="publish-field">
                <span>Price</span>
                <input name="price" value="0.00001" required />
              </label>
              <label class="publish-field">
                <span>Currency</span>
                <input name="currency" value="SPACE" required />
              </label>
              <label class="publish-field">
                <span>Output Type</span>
                <input name="outputType" value="text" required />
              </label>
              <label class="publish-field publish-field-wide">
                <span>Skill Document</span>
                <textarea name="skillDocument" rows="4"># Weather Service</textarea>
              </label>
              <label class="publish-field publish-field-wide">
                <span>Service Icon URI</span>
                <input name="serviceIconUri" placeholder="Optional metafile:// URI" />
              </label>
            </div>
            <p class="publish-skill-summary" data-publish-skill-summary>No skill selected.</p>
            <div class="publish-actions">
              <button class="btn btn-primary" type="submit" data-publish-submit disabled>Publish Service</button>
              <span class="publish-status" data-publish-status>Loading publish context.</span>
            </div>
          </form>
        </div>

        <section class="publish-cards">
          <article class="publish-card" data-publish-provider-card></article>
          <article class="publish-card" data-publish-runtime-card></article>
          <article class="publish-card" data-publish-result-card></article>
        </section>
      </section>
    `,
        script: `(() => {
  const buildPublishPageViewModel = ${buildPublishPageViewModelSource};
  const PUBLISH_FIELDS = [
    'serviceName',
    'displayName',
    'description',
    'providerSkill',
    'price',
    'currency',
    'outputType',
    'skillDocument',
    'serviceIconUri',
  ];
  const elements = {
    form: document.querySelector('[data-publish-form]'),
    submit: document.querySelector('[data-publish-submit]'),
    status: document.querySelector('[data-publish-status]'),
    availability: document.querySelector('[data-publish-availability]'),
    skillSelect: document.querySelector('[data-provider-skill-select]'),
    skillSummary: document.querySelector('[data-publish-skill-summary]'),
    providerCard: document.querySelector('[data-publish-provider-card]'),
    runtimeCard: document.querySelector('[data-publish-runtime-card]'),
    resultCard: document.querySelector('[data-publish-result-card]'),
  };
  const state = {
    providerSummary: null,
    publishSkills: null,
    publishSkillsError: null,
    publishResult: null,
  };
  let currentModel = null;
  let busy = false;

  const setStatus = (text, tone) => {
    if (!elements.status) return;
    elements.status.textContent = text;
    elements.status.dataset.tone = tone || 'neutral';
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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

  const selectedSkill = () => elements.skillSelect ? String(elements.skillSelect.value || '') : '';

  const skillExists = (value) => Boolean(
    currentModel
    && Array.isArray(currentModel.skills)
    && currentModel.skills.some((skill) => skill.value === value)
  );

  const updateSubmitState = () => {
    if (!elements.submit) return;
    const skill = selectedSkill();
    const canPublish = Boolean(currentModel && currentModel.availability && currentModel.availability.canPublish);
    elements.submit.disabled = busy || !canPublish || !skill || !skillExists(skill);
  };

  const renderSkillSelect = (model) => {
    if (!elements.skillSelect) return;
    const previous = selectedSkill();
    elements.skillSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = model.skills.length ? 'Select a primary runtime skill' : 'No primary runtime skills available';
    elements.skillSelect.appendChild(placeholder);

    for (const skill of model.skills) {
      const option = document.createElement('option');
      option.value = skill.value;
      option.textContent = skill.title ? skill.value + ' - ' + skill.title : skill.value;
      option.dataset.description = skill.description || '';
      elements.skillSelect.appendChild(option);
    }

    if (previous && skillExists(previous)) {
      elements.skillSelect.value = previous;
    } else if (model.skills.length === 1) {
      elements.skillSelect.value = model.skills[0].value;
    } else {
      elements.skillSelect.value = '';
    }
    elements.skillSelect.disabled = !model.availability.canPublish || model.skills.length === 0;
  };

  const renderSkillSummary = () => {
    if (!elements.skillSummary || !currentModel) return;
    const skill = currentModel.skills.find((entry) => entry.value === selectedSkill());
    if (!skill) {
      elements.skillSummary.textContent = currentModel.availability.message;
      return;
    }
    elements.skillSummary.textContent = skill.description || skill.title || skill.value;
  };

  const renderAvailability = (model) => {
    if (!elements.availability) return;
    elements.availability.textContent = model.availability.message;
    elements.availability.dataset.tone = model.availability.canPublish ? 'ready' : 'blocked';
    elements.availability.dataset.reason = model.availability.reasonCode;
  };

  const render = () => {
    currentModel = buildPublishPageViewModel({
      providerSummary: state.providerSummary,
      publishSkills: state.publishSkills,
      publishSkillsError: state.publishSkillsError,
      publishResult: state.publishResult,
    });
    renderCard(elements.providerCard, currentModel.providerCard, 'No local provider identity is available.');
    renderCard(elements.runtimeCard, currentModel.runtimeCard, 'No primary runtime diagnostics are available.');
    renderCard(elements.resultCard, currentModel.resultCard, 'No publish result yet.');
    renderSkillSelect(currentModel);
    renderSkillSummary();
    renderAvailability(currentModel);
    updateSubmitState();
  };

  const loadJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    return response.json();
  };

  const loadPublishContext = async () => {
    const [summaryEnvelope, skillsEnvelope] = await Promise.all([
      loadJson('/api/provider/summary').catch((error) => ({
        ok: false,
        code: 'provider_summary_failed',
        message: error instanceof Error ? error.message : String(error),
      })),
      loadJson('/api/services/publish/skills').catch((error) => ({
        ok: false,
        code: 'publish_skills_failed',
        message: error instanceof Error ? error.message : String(error),
      })),
    ]);

    state.providerSummary = summaryEnvelope && summaryEnvelope.ok === true ? summaryEnvelope.data : null;
    if (skillsEnvelope && skillsEnvelope.ok === true) {
      state.publishSkills = skillsEnvelope.data;
      state.publishSkillsError = null;
    } else {
      state.publishSkills = null;
      state.publishSkillsError = {
        code: skillsEnvelope && skillsEnvelope.code,
        message: skillsEnvelope && skillsEnvelope.message,
      };
    }
    render();
    if (currentModel && currentModel.availability.canPublish) {
      setStatus(currentModel.availability.message, 'ready');
    } else if (currentModel) {
      setStatus(currentModel.availability.message, 'error');
    }
  };

  const buildSubmitPayload = () => {
    const formData = new FormData(elements.form);
    const payload = {};
    for (const field of PUBLISH_FIELDS) {
      const raw = field === 'providerSkill' ? selectedSkill() : formData.get(field);
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (field === 'serviceIconUri' && !value) {
        continue;
      }
      payload[field] = value;
    }
    return payload;
  };

  if (elements.skillSelect) {
    elements.skillSelect.addEventListener('change', () => {
      renderSkillSummary();
      updateSubmitState();
    });
  }

  if (elements.form) {
    elements.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const skill = selectedSkill();
      if (!currentModel || !currentModel.availability.canPublish || !skill || !skillExists(skill)) {
        setStatus(currentModel ? currentModel.availability.message : 'Publish context is not ready.', 'error');
        updateSubmitState();
        return;
      }

      busy = true;
      updateSubmitState();
      setStatus('Publishing to MetaWeb...', 'busy');
      try {
        const response = await fetch('/api/services/publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildSubmitPayload()),
        });
        const result = await response.json();
        if (!result || result.ok !== true) {
          throw new Error((result && result.message) || 'Publish failed.');
        }
        state.publishResult = result.data;
        render();
        setStatus('Published. Real chain pin received.', 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        busy = false;
        updateSubmitState();
      }
    });
  }

  loadPublishContext();
})();`,
    };
}
