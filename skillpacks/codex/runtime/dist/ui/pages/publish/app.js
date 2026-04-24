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
        heading: 'Publish a local capability to MetaWeb',
        description: 'Humans can confirm one publish payload here while the daemon still owns the real chain write and result envelope.',
        panels: [
            {
                title: 'Chain-backed publish only',
                body: 'This page submits to the same daemon publish route that the CLI uses. No browser-side chain logic is allowed here.',
            },
            {
                title: 'Identity first',
                body: 'The page shows which local MetaBot identity will publish the service before you send anything on-chain.',
            },
            {
                title: 'One clear result card',
                body: 'After a successful publish, the human should immediately see the real service pin, price, and output type.',
            },
        ],
        contentHtml: `
      <section class="publish-shell" data-publish-shell>
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
              <input name="providerSkill" value="metabot-weather" required />
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
          <div class="publish-actions">
            <button type="submit" data-publish-submit>Publish Service</button>
            <span class="publish-status" data-publish-status>Ready to publish.</span>
          </div>
        </form>

        <section class="publish-cards">
          <article class="publish-card" data-publish-provider-card></article>
          <article class="publish-card" data-publish-result-card></article>
        </section>
      </section>
    `,
        script: `(() => {
  const buildPublishPageViewModel = ${buildPublishPageViewModelSource};
  const elements = {
    form: document.querySelector('[data-publish-form]'),
    submit: document.querySelector('[data-publish-submit]'),
    status: document.querySelector('[data-publish-status]'),
    providerCard: document.querySelector('[data-publish-provider-card]'),
    resultCard: document.querySelector('[data-publish-result-card]'),
  };

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

  const render = (providerSummary, publishResult) => {
    const model = buildPublishPageViewModel({ providerSummary, publishResult });
    renderCard(elements.providerCard, model.providerCard, 'No local provider identity is available.');
    renderCard(elements.resultCard, model.resultCard, 'No publish result yet.');
  };

  const loadSummary = async () => {
    const response = await fetch('/api/provider/summary', { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || 'Provider summary load failed.');
    }
    render(payload.data, null);
    return payload.data;
  };

  if (elements.form) {
    elements.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(elements.form);
      const payload = Object.fromEntries(formData.entries());
      if (elements.submit) {
        elements.submit.disabled = true;
      }
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
        const summary = await loadSummary();
        render(summary, result.data);
        setStatus('Published. Real chain pin received.', 'success');
      } catch (error) {
        render(null, null);
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        if (elements.submit) {
          elements.submit.disabled = false;
        }
      }
    });
  }

  loadSummary()
    .then(() => {
      setStatus('Provider identity loaded. Review the payload and publish when ready.', 'ready');
    })
    .catch((error) => {
      render(null, null);
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    });
})();`,
    };
}
