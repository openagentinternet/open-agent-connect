import type { LocalUiPageDefinition } from '../types';
import { buildMyServicesPageViewModelRuntimeSource } from './viewModel';

export function buildMyServicesPageDefinition(): LocalUiPageDefinition {
  const buildMyServicesPageViewModelSource = buildMyServicesPageViewModelRuntimeSource();
  return {
    page: 'my-services',
    title: 'My Services',
    eyebrow: 'Service Ledger',
    heading: 'My Services',
    description: 'Manage locally published MetaBot skill services.',
    panels: [],
    contentHtml: `
      <section class="my-services-shell" data-my-services-shell>
        <div class="my-services-toolbar">
          <div>
            <h1>My Services</h1>
            <p data-my-services-page-label>Loading local services...</p>
          </div>
          <div class="my-services-toolbar-actions">
            <button class="btn" type="button" data-my-services-refresh>Refresh</button>
          </div>
        </div>

        <div class="my-services-notice" data-my-services-notice hidden></div>

        <div class="my-services-workspace">
          <section class="my-services-list-panel" aria-label="Published services">
            <div class="ledger-section-header">
              <h2>Published Services</h2>
              <span data-my-services-list-count>0</span>
            </div>
            <div class="my-services-list" data-my-services-list></div>
          </section>

          <section class="my-services-detail-panel" data-my-service-detail aria-label="Selected service details">
            <div class="ledger-section-header">
              <h2>Service Detail</h2>
              <span data-my-service-order-page-label>0 orders</span>
            </div>
            <div class="my-service-detail-summary" data-my-service-detail-summary></div>
            <div class="my-service-orders" data-my-service-orders></div>
          </section>
        </div>

        <div class="my-services-modal" data-my-service-edit-modal hidden>
          <form class="my-services-modal-dialog my-services-edit-form" data-my-service-edit-form>
            <div class="modal-heading">
              <div>
                <h2>Edit Service</h2>
                <p>Broadcast a MetaID modify operation and update the local profile record.</p>
              </div>
              <button class="modal-close" type="button" data-my-service-edit-close aria-label="Close edit modal">x</button>
            </div>

            <div class="edit-form-grid">
              <label>
                <span>Display Name</span>
                <input name="displayName" required />
              </label>
              <label>
                <span>Service Name</span>
                <input name="serviceName" required />
              </label>
              <label class="wide-field">
                <span>Description</span>
                <textarea name="description" rows="4" required></textarea>
              </label>
              <label>
                <span>Provider Skill</span>
                <select name="providerSkill" data-edit-provider-skill required></select>
              </label>
              <label>
                <span>Output Type</span>
                <select name="outputType" data-edit-output-type required></select>
              </label>
              <label>
                <span>Price</span>
                <input name="price" inputmode="decimal" required />
              </label>
              <label>
                <span>Currency</span>
                <select name="currency" data-edit-currency required></select>
              </label>
              <div class="wide-field edit-cover-field">
                <span>Cover Image</span>
                <div class="edit-cover-row">
                  <div class="edit-cover-preview" data-edit-cover-preview></div>
                  <div class="edit-cover-controls">
                    <input id="my-services-cover-input" type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml" data-edit-cover-input />
                    <label class="btn" for="my-services-cover-input">Upload Image</label>
                    <button class="btn" type="button" data-edit-cover-remove>Remove</button>
                    <p data-edit-cover-note>Optional PNG, JPG, WebP, GIF, or SVG. Maximum 2MB.</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="modal-actions">
              <button class="btn" type="button" data-my-service-edit-close>Cancel</button>
              <button class="btn btn-primary" type="submit" data-my-service-edit-submit>Save Modify</button>
            </div>
          </form>
        </div>

        <div class="my-services-modal" data-my-service-revoke-modal hidden>
          <div class="my-services-modal-dialog revoke-dialog">
            <div class="modal-heading">
              <div>
                <h2>Revoke Service</h2>
                <p data-my-service-revoke-copy>This will broadcast a MetaID revoke operation.</p>
              </div>
              <button class="modal-close" type="button" data-my-service-revoke-close aria-label="Close revoke modal">x</button>
            </div>
            <div class="modal-actions">
              <button class="btn" type="button" data-my-service-revoke-close>Cancel</button>
              <button class="btn btn-danger" type="button" data-my-service-revoke-confirm>Revoke</button>
            </div>
          </div>
        </div>
      </section>
    `,
    script: `(() => {
  ${buildMyServicesPageViewModelSource}

  const ICON_MAX_BYTES = 2 * 1024 * 1024;
  const ICON_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml']);
  const elements = {
    pageLabel: document.querySelector('[data-my-services-page-label]'),
    refresh: document.querySelector('[data-my-services-refresh]'),
    notice: document.querySelector('[data-my-services-notice]'),
    list: document.querySelector('[data-my-services-list]'),
    listCount: document.querySelector('[data-my-services-list-count]'),
    detail: document.querySelector('[data-my-service-detail]'),
    detailSummary: document.querySelector('[data-my-service-detail-summary]'),
    orders: document.querySelector('[data-my-service-orders]'),
    orderPageLabel: document.querySelector('[data-my-service-order-page-label]'),
    editModal: document.querySelector('[data-my-service-edit-modal]'),
    editForm: document.querySelector('[data-my-service-edit-form]'),
    editProviderSkill: document.querySelector('[data-edit-provider-skill]'),
    editOutputType: document.querySelector('[data-edit-output-type]'),
    editCurrency: document.querySelector('[data-edit-currency]'),
    editCoverInput: document.querySelector('[data-edit-cover-input]'),
    editCoverPreview: document.querySelector('[data-edit-cover-preview]'),
    editCoverRemove: document.querySelector('[data-edit-cover-remove]'),
    editCoverNote: document.querySelector('[data-edit-cover-note]'),
    revokeModal: document.querySelector('[data-my-service-revoke-modal]'),
    revokeCopy: document.querySelector('[data-my-service-revoke-copy]'),
    revokeConfirm: document.querySelector('[data-my-service-revoke-confirm]'),
  };

  const state = {
    servicesPage: null,
    ordersPage: null,
    selectedServiceId: '',
    mutationResult: null,
    error: null,
    busy: false,
    editServiceId: '',
    revokeServiceId: '',
    editCoverDataUrl: '',
    editCoverUri: '',
    editCoverRemoved: false,
    editSkillOptions: [],
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const normalizeTextClient = (value) => String(value || '').trim();
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
      '<div class="notice-tx"><code>' + escapeHtml(txid) + '</code><button class="btn btn-sm" type="button" data-copy-value="' + escapeHtml(txid) + '">Copy</button></div>'
    )).join('');
    elements.notice.innerHTML = '<div><strong>' + escapeHtml(notice.title) + '</strong><p>' + escapeHtml(notice.message) + '</p></div>'
      + (notice.pinId ? '<code>' + escapeHtml(notice.pinId) + '</code>' : '')
      + txids;
  };

  const renderServices = (model) => {
    if (elements.pageLabel) elements.pageLabel.textContent = model.pageLabel;
    if (elements.listCount) elements.listCount.textContent = String(model.services.length);
    if (!elements.list) return;
    if (!model.services.length) {
      elements.list.innerHTML = '<div class="ledger-empty"><strong>' + escapeHtml(model.emptyState.title) + '</strong><p>' + escapeHtml(model.emptyState.message) + '</p></div>';
      return;
    }
    elements.list.innerHTML = model.services.map((service) => {
      const selected = service.currentPinId === state.selectedServiceId ? ' data-selected="true"' : '';
      const metrics = service.metrics.map((metric) => (
        '<div class="service-metric"><span>' + escapeHtml(metric.label) + '</span><strong>' + escapeHtml(metric.value) + '</strong></div>'
      )).join('');
      const icon = service.iconUri
        ? '<img alt="" src="' + escapeHtml(service.iconUri) + '" />'
        : '<span>' + escapeHtml(service.iconLabel) + '</span>';
      return '<article class="service-row"' + selected + ' data-service-row="' + escapeHtml(service.currentPinId) + '">'
        + '<div class="service-cover">' + icon + '</div>'
        + '<div class="service-main">'
        + '<div class="service-title-line"><h3>' + escapeHtml(service.title) + '</h3><span>' + escapeHtml(service.priceLabel) + '</span></div>'
        + '<p>' + escapeHtml(service.description || service.serviceName) + '</p>'
        + '<div class="service-meta"><span>' + escapeHtml(service.skillLabel) + '</span><span>' + escapeHtml(service.outputTypeLabel) + '</span><span>' + escapeHtml(service.creatorLabel) + '</span><span>' + escapeHtml(service.updatedAtLabel) + '</span></div>'
        + '<div class="service-metrics">' + metrics + '</div>'
        + '</div>'
        + '<div class="service-actions">'
        + '<button class="btn btn-sm" type="button" data-service-action="details" data-service-id="' + escapeHtml(service.currentPinId) + '">Details</button>'
        + '<button class="btn btn-sm" type="button" data-service-action="edit" data-service-id="' + escapeHtml(service.currentPinId) + '"' + (service.canModify ? '' : ' disabled') + '>Edit</button>'
        + '<button class="btn btn-sm btn-danger" type="button" data-service-action="revoke" data-service-id="' + escapeHtml(service.currentPinId) + '"' + (service.canRevoke ? '' : ' disabled') + '>Revoke</button>'
        + (service.blockedReason ? '<small>' + escapeHtml(service.blockedReason) + '</small>' : '')
        + '</div>'
        + '</article>';
    }).join('');
  };

  const renderDetail = (model) => {
    if (elements.orderPageLabel) elements.orderPageLabel.textContent = model.orderPageLabel;
    if (!elements.detailSummary || !elements.orders) return;
    const selected = model.selectedService;
    if (!selected) {
      elements.detailSummary.innerHTML = '<div class="ledger-empty"><strong>No service selected</strong><p>Select a service to inspect orders and lifecycle actions.</p></div>';
      elements.orders.innerHTML = '';
      return;
    }
    elements.detailSummary.innerHTML = '<div class="detail-heading"><div><h3>' + escapeHtml(selected.title) + '</h3><p>' + escapeHtml(selected.description || selected.serviceName) + '</p></div>'
      + '<div class="detail-actions">'
      + '<button class="btn btn-sm" type="button" data-service-action="edit" data-service-id="' + escapeHtml(selected.currentPinId) + '"' + (selected.canModify ? '' : ' disabled') + '>Edit</button>'
      + '<button class="btn btn-sm btn-danger" type="button" data-service-action="revoke" data-service-id="' + escapeHtml(selected.currentPinId) + '"' + (selected.canRevoke ? '' : ' disabled') + '>Revoke</button>'
      + '</div></div>'
      + '<dl class="detail-fields">'
      + '<div><dt>Current Pin</dt><dd>' + escapeHtml(selected.currentPinId) + '</dd></div>'
      + '<div><dt>Source Pin</dt><dd>' + escapeHtml(selected.sourceServicePinId) + '</dd></div>'
      + '<div><dt>Skill</dt><dd>' + escapeHtml(selected.skillLabel) + '</dd></div>'
      + '<div><dt>Price</dt><dd>' + escapeHtml(selected.priceLabel) + '</dd></div>'
      + '</dl>';

    if (!model.orders.length) {
      elements.orders.innerHTML = '<div class="ledger-empty"><strong>' + escapeHtml(model.orderEmptyState.title) + '</strong><p>' + escapeHtml(model.orderEmptyState.message) + '</p></div>';
      return;
    }
    elements.orders.innerHTML = model.orders.map((order) => (
      '<article class="order-row">'
      + '<div><strong>' + escapeHtml(order.statusLabel) + '</strong><p>' + escapeHtml(order.buyerLabel) + '</p><p class="mono-text">' + escapeHtml(order.timeLabel) + '</p></div>'
      + '<div><span>Payment</span><p class="mono-text">' + escapeHtml(order.paymentLabel) + '</p><p class="mono-text">' + escapeHtml(order.orderTxid) + '</p></div>'
      + '<div><span>Rating</span><p>' + escapeHtml(order.ratingLabel) + '</p>' + (order.ratingComment ? '<p>' + escapeHtml(order.ratingComment) + '</p>' : '') + (order.ratingPinId ? '<p class="mono-text">' + escapeHtml(order.ratingPinId) + '</p>' : '') + '</div>'
      + '<div><span>Runtime</span><p class="mono-text">' + escapeHtml(order.runtimeLabel) + '</p><p class="mono-text">' + escapeHtml(order.sessionLabel) + '</p></div>'
      + '<a class="btn btn-sm" href="' + escapeHtml(order.traceHref) + '">Trace</a>'
      + '</article>'
    )).join('');
  };

  const render = () => {
    const model = buildModel();
    renderNotice(model);
    renderServices(model);
    renderDetail(model);
  };

  const loadOrders = async (serviceId, refresh) => {
    if (!serviceId) {
      state.ordersPage = null;
      render();
      return;
    }
    state.ordersPage = await fetchJson('/api/services/my/orders?serviceId=' + encodeURIComponent(serviceId) + '&page=1&pageSize=10&refresh=' + (refresh ? 'true' : 'false'));
    render();
  };

  const loadServices = async (refresh) => {
    state.error = null;
    state.servicesPage = await fetchJson('/api/services/my?page=1&pageSize=20&refresh=' + (refresh ? 'true' : 'false'));
    const items = getServiceItems();
    const hasSelected = items.some((service) => normalizeTextClient(service && (service.currentPinId || service.id)) === state.selectedServiceId);
    if (!state.selectedServiceId || !hasSelected) {
      state.selectedServiceId = normalizeTextClient(items[0] && (items[0].currentPinId || items[0].id));
    }
    await loadOrders(state.selectedServiceId, refresh);
  };

  const setError = (error) => {
    state.error = { message: error instanceof Error ? error.message : String(error) };
    render();
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Cover image could not be read.'));
    reader.readAsDataURL(file);
  });

  const renderEditCover = () => {
    if (!elements.editCoverPreview) return;
    const source = state.editCoverDataUrl || state.editCoverUri;
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

  const openEdit = async (serviceId) => {
    state.selectedServiceId = serviceId;
    state.editServiceId = serviceId;
    state.editCoverDataUrl = '';
    state.editCoverRemoved = false;
    const model = buildModel();
    const service = findModelService(model, serviceId);
    const raw = getSelectedRawService();
    if (!service || !model.editForm || !elements.editForm) return;
    state.editCoverUri = model.editForm.serviceIconUri;
    elements.editForm.elements.displayName.value = model.editForm.displayName;
    elements.editForm.elements.serviceName.value = model.editForm.serviceName;
    elements.editForm.elements.description.value = model.editForm.description;
    elements.editForm.elements.price.value = model.editForm.price;
    populateSelect(elements.editCurrency, model.currencyOptions, model.editForm.currency);
    populateSelect(elements.editOutputType, model.outputTypeOptions, model.editForm.outputType);
    populateSelect(elements.editProviderSkill, [{ value: model.editForm.providerSkill, label: model.editForm.providerSkill }], model.editForm.providerSkill);
    renderEditCover();
    if (elements.editModal) elements.editModal.hidden = false;

    const slug = normalizeTextClient(raw && raw.creatorMetabotSlug);
    if (slug) {
      try {
        const data = await fetchJson('/api/services/publish/skills?slug=' + encodeURIComponent(slug));
        const skills = Array.isArray(data.skills) ? data.skills.map((skill) => ({
          value: normalizeTextClient(skill && skill.skillName),
          label: normalizeTextClient(skill && (skill.title || skill.skillName)),
        })).filter((skill) => skill.value) : [];
        if (!skills.some((skill) => skill.value === model.editForm.providerSkill)) {
          skills.unshift({ value: model.editForm.providerSkill, label: model.editForm.providerSkill });
        }
        populateSelect(elements.editProviderSkill, skills, model.editForm.providerSkill);
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
    state.editCoverRemoved = false;
  };

  const openRevoke = (serviceId) => {
    state.revokeServiceId = serviceId;
    const model = buildModel();
    const service = findModelService(model, serviceId);
    if (elements.revokeCopy) {
      elements.revokeCopy.textContent = service
        ? 'Revoke ' + service.title + ' at ' + service.currentPinId + '.'
        : 'This will broadcast a MetaID revoke operation.';
    }
    if (elements.revokeModal) elements.revokeModal.hidden = false;
  };

  const closeRevoke = () => {
    if (elements.revokeModal) elements.revokeModal.hidden = true;
    state.revokeServiceId = '';
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      serviceId: state.editServiceId,
      displayName: normalizeTextClient(formData.get('displayName')),
      serviceName: normalizeTextClient(formData.get('serviceName')),
      description: normalizeTextClient(formData.get('description')),
      providerSkill: normalizeTextClient(formData.get('providerSkill')),
      outputType: normalizeTextClient(formData.get('outputType')),
      price: normalizeTextClient(formData.get('price')),
      currency: normalizeTextClient(formData.get('currency')),
      serviceIconUri: state.editCoverDataUrl ? '' : state.editCoverUri,
      serviceIconDataUrl: state.editCoverDataUrl,
      removeServiceIcon: state.editCoverRemoved,
    };
    try {
      state.mutationResult = await fetchJson('/api/services/my/modify', {
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
      state.mutationResult = await fetchJson('/api/services/my/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceId: state.revokeServiceId }),
      });
      closeRevoke();
      state.selectedServiceId = '';
      await loadServices(true);
    } catch (error) {
      setError(error);
    }
  };

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-service-action], [data-copy-value], [data-my-services-refresh], [data-my-service-edit-close], [data-my-service-revoke-close]') : null;
    if (!target) return;
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
    const copyValue = target.getAttribute('data-copy-value');
    if (copyValue) {
      await navigator.clipboard?.writeText(copyValue).catch(() => undefined);
      target.textContent = 'Copied';
      return;
    }
    const action = target.getAttribute('data-service-action');
    const serviceId = target.getAttribute('data-service-id') || '';
    if (action === 'details') {
      state.selectedServiceId = serviceId;
      state.mutationResult = null;
      try {
        await loadOrders(serviceId, false);
      } catch (error) {
        setError(error);
      }
    }
    if (action === 'edit') {
      await openEdit(serviceId);
    }
    if (action === 'revoke') {
      openRevoke(serviceId);
    }
  });

  if (elements.editForm) {
    elements.editForm.addEventListener('submit', submitEdit);
  }
  if (elements.editCoverInput) {
    elements.editCoverInput.addEventListener('change', async () => {
      const file = elements.editCoverInput.files && elements.editCoverInput.files[0];
      if (!file) return;
      if (!ICON_MIME_TYPES.has(file.type) || file.size > ICON_MAX_BYTES) {
        if (elements.editCoverNote) elements.editCoverNote.textContent = 'Cover image must be a supported image of 2MB or less.';
        elements.editCoverInput.value = '';
        return;
      }
      state.editCoverDataUrl = await readFileAsDataUrl(file);
      state.editCoverRemoved = false;
      renderEditCover();
    });
  }
  if (elements.editCoverRemove) {
    elements.editCoverRemove.addEventListener('click', () => {
      state.editCoverDataUrl = '';
      state.editCoverUri = '';
      state.editCoverRemoved = true;
      if (elements.editCoverInput) elements.editCoverInput.value = '';
      renderEditCover();
    });
  }
  if (elements.revokeConfirm) {
    elements.revokeConfirm.addEventListener('click', confirmRevoke);
  }

  loadServices(false).catch(setError);
})();`,
  };
}
