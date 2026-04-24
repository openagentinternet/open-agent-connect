"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMyServicesPageDefinition = buildMyServicesPageDefinition;
const viewModel_1 = require("./viewModel");
function buildMyServicesPageDefinition() {
    const buildMyServicesPageViewModelSource = viewModel_1.buildMyServicesPageViewModel.toString();
    return {
        page: 'my-services',
        title: 'My Services',
        eyebrow: 'Provider Ledger',
        heading: 'Inspect your published services and recent orders',
        description: 'A compact local console for provider presence, service inventory, seller-side order flow, and manual refund work.',
        panels: [
            {
                title: 'Service inventory',
                body: 'List current services, last on-chain publish time, and whether each service is currently available to remote MetaBots.',
            },
            {
                title: 'Recent order activity',
                body: 'Expose the seller-side order flow that matters to a human operator, including trace linkage back into the inspector.',
            },
            {
                title: 'Manual actions',
                body: 'Surface refund interruptions and other human-required steps without creating a separate provider status model.',
            },
        ],
        contentHtml: `
      <section class="provider-console" data-provider-console>
        <article class="console-card presence-card" data-provider-presence-card></article>

        <section class="console-grid">
          <article class="console-card console-section">
            <div class="section-header">
              <h2>Service Inventory</h2>
              <span class="section-count" data-service-count>0</span>
            </div>
            <div class="table-wrap">
              <table class="console-table" data-service-inventory>
                <thead>
                  <tr>
                    <th>Display</th>
                    <th>Capability</th>
                    <th>Status</th>
                    <th>Price</th>
                    <th>Chain Pin</th>
                    <th>Last Publish</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
          </article>

          <article class="console-card console-section">
            <div class="section-header">
              <h2>Recent Orders</h2>
              <span class="section-count" data-order-count>0</span>
            </div>
            <div class="table-wrap">
              <table class="console-table" data-recent-orders>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Buyer</th>
                    <th>State</th>
                    <th>Trace</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
          </article>
        </section>

        <article class="console-card console-section">
          <div class="section-header">
            <h2>Manual Actions</h2>
            <span class="section-count" data-manual-action-count>0</span>
          </div>
          <div class="manual-actions" data-manual-actions></div>
        </article>
      </section>
    `,
        script: `(() => {
  const buildMyServicesPageViewModel = ${buildMyServicesPageViewModelSource};
  const elements = {
    presenceCard: document.querySelector('[data-provider-presence-card]'),
    serviceInventory: document.querySelector('[data-service-inventory] tbody'),
    recentOrders: document.querySelector('[data-recent-orders] tbody'),
    manualActions: document.querySelector('[data-manual-actions]'),
    serviceCount: document.querySelector('[data-service-count]'),
    orderCount: document.querySelector('[data-order-count]'),
    manualActionCount: document.querySelector('[data-manual-action-count]'),
  };

  let lastSummary = null;

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const renderPresenceCard = (card, enabled) => {
    if (!elements.presenceCard) return;
    const rows = Array.isArray(card && card.rows) ? card.rows : [];
    elements.presenceCard.innerHTML = [
      '<div class="presence-header">',
      '<div>',
      '<div class="presence-eyebrow">' + escapeHtml(card && card.title) + '</div>',
      '<h2>' + escapeHtml(card && card.statusLabel) + '</h2>',
      '</div>',
      '<button type="button" class="presence-toggle" data-provider-presence-toggle>' + escapeHtml(card && card.actionLabel) + '</button>',
      '</div>',
      rows.length
        ? '<dl class="presence-rows">' + rows.map((row) => (
            '<div class="presence-row"><dt>' + escapeHtml(row.label) + '</dt><dd>' + escapeHtml(row.value) + '</dd></div>'
          )).join('') + '</dl>'
        : '<p class="console-empty">No provider identity is loaded yet.</p>',
    ].join('');

    const toggle = elements.presenceCard.querySelector('[data-provider-presence-toggle]');
    if (toggle) {
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          const response = await fetch('/api/provider/presence', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: !enabled }),
          });
          const payload = await response.json();
          if (!payload || payload.ok !== true) {
            throw new Error((payload && payload.message) || 'Provider presence update failed.');
          }
          await loadSummary();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          toggle.textContent = message;
        } finally {
          toggle.disabled = false;
        }
      });
    }
  };

  const renderServices = (entries) => {
    if (!elements.serviceInventory) return;
    if (elements.serviceCount) {
      elements.serviceCount.textContent = String(entries.length);
    }
    if (!entries.length) {
      elements.serviceInventory.innerHTML = '<tr><td colspan="6" class="console-empty-cell">No services have been published from this local MetaBot yet.</td></tr>';
      return;
    }
    elements.serviceInventory.innerHTML = entries.map((entry) => (
      '<tr>'
      + '<td><strong>' + escapeHtml(entry.displayName) + '</strong></td>'
      + '<td>' + escapeHtml(entry.serviceName) + '</td>'
      + '<td>' + escapeHtml(entry.availabilityLabel) + '</td>'
      + '<td>' + escapeHtml(entry.priceLabel) + '</td>'
      + '<td class="mono-cell">' + escapeHtml(entry.servicePinId) + '</td>'
      + '<td>' + escapeHtml(entry.lastPublishAt) + '</td>'
      + '</tr>'
    )).join('');
  };

  const renderOrders = (entries) => {
    if (!elements.recentOrders) return;
    if (elements.orderCount) {
      elements.orderCount.textContent = String(entries.length);
    }
    if (!entries.length) {
      elements.recentOrders.innerHTML = '<tr><td colspan="5" class="console-empty-cell">No seller-side orders are stored yet.</td></tr>';
      return;
    }
    elements.recentOrders.innerHTML = entries.map((entry) => (
      '<tr>'
      + '<td><strong>' + escapeHtml(entry.serviceName) + '</strong>' + (entry.requiresManualRefund ? '<div class="flag-text">Manual refund pending</div>' : '') + '</td>'
      + '<td>' + escapeHtml(entry.buyerLabel) + '</td>'
      + '<td><strong>' + escapeHtml(entry.stateLabel) + '</strong>'
        + (entry.statusDetail ? '<div class="flag-text">' + escapeHtml(entry.statusDetail) + '</div>' : '')
        + (entry.ratingCommentPreview ? '<div class="flag-text">' + escapeHtml(entry.ratingCommentPreview) + '</div>' : '')
        + (entry.ratingPinId ? '<div class="mono-text">' + escapeHtml(entry.ratingPinId) + '</div>' : '')
        + '</td>'
      + '<td><a href="' + escapeHtml(entry.traceHref) + '">' + escapeHtml(entry.traceLabel) + '</a></td>'
      + '<td>' + escapeHtml(entry.createdAt) + '</td>'
      + '</tr>'
    )).join('');
  };

  const renderManualActions = (entries) => {
    if (!elements.manualActions) return;
    if (elements.manualActionCount) {
      elements.manualActionCount.textContent = String(entries.length);
    }
    if (!entries.length) {
      elements.manualActions.innerHTML = '<p class="console-empty">No human follow-up is required right now.</p>';
      return;
    }
    elements.manualActions.innerHTML = entries.map((entry) => (
      '<article class="manual-action-item">'
      + '<div><strong>' + escapeHtml(entry.kindLabel) + '</strong><p>Order ' + escapeHtml(entry.orderId) + '</p><p class="mono-text">' + escapeHtml(entry.refundRequestPinId) + '</p></div>'
      + '<div class="manual-action-links"><a href="' + escapeHtml(entry.refundHref) + '">Open refund page</a><a href="' + escapeHtml(entry.traceHref) + '">Open trace</a></div>'
      + '</article>'
    )).join('');
  };

  const render = (providerSummary) => {
    lastSummary = providerSummary;
    const model = buildMyServicesPageViewModel({ providerSummary });
    renderPresenceCard(model.presenceCard, providerSummary && providerSummary.presence && providerSummary.presence.enabled === true);
    renderServices(Array.isArray(model.serviceInventory) ? model.serviceInventory : []);
    renderOrders(Array.isArray(model.recentOrders) ? model.recentOrders : []);
    renderManualActions(Array.isArray(model.manualActions) ? model.manualActions : []);
  };

  const loadSummary = async () => {
    const response = await fetch('/api/provider/summary', { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || 'Provider summary load failed.');
    }
    render(payload.data);
    return payload.data;
  };

  loadSummary().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    render(lastSummary);
    if (elements.manualActions) {
      elements.manualActions.innerHTML = '<p class="console-empty">' + escapeHtml(message) + '</p>';
    }
  });
})();`,
    };
}
