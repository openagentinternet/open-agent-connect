"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProductsPageDefinition = buildProductsPageDefinition;
exports.buildProductsPageScript = buildProductsPageScript;
const viewModel_1 = require("./viewModel");
function buildProductsPageDefinition() {
    const buildProductCommercePageViewModelSource = (0, viewModel_1.buildProductCommercePageViewModelRuntimeSource)();
    return {
        page: 'products',
        title: 'Products',
        eyebrow: 'Product Commerce',
        heading: 'Products',
        description: 'Publish, buy, and inspect Product Commerce V1 virtual goods.',
        panels: [],
        contentHtml: `
      <section class="products-shell" data-products-shell>
        <header class="products-toolbar">
          <div>
            <p class="products-eyebrow">Product Commerce</p>
            <h1>Products</h1>
            <p>Publish, buy, and inspect Product Commerce V1 virtual goods.</p>
          </div>
          <span class="products-status" data-products-status>Loading marketplace</span>
        </header>

        <nav class="products-tabs" aria-label="Product workspace tabs" role="tablist">
          <a id="products-tab-marketplace" href="#marketplace" data-products-tab="marketplace" data-active="true" role="tab" aria-selected="true" aria-controls="marketplace" tabindex="0">Marketplace</a>
          <a id="products-tab-sell" href="#sell" data-products-tab="sell" role="tab" aria-selected="false" aria-controls="sell" tabindex="-1">Sell</a>
          <a id="products-tab-orders" href="#orders" data-products-tab="orders" role="tab" aria-selected="false" aria-controls="orders" tabindex="-1">Orders</a>
        </nav>

        <section class="products-workspace" aria-label="Product commerce workspace">
          <section id="marketplace" class="products-panel" data-products-panel="marketplace" role="tabpanel" aria-labelledby="products-tab-marketplace">
            <div class="products-panel-header">
              <h2>Marketplace</h2>
              <span>Online directory</span>
            </div>
            <div class="products-marketplace-toolbar" aria-label="Marketplace filters">
              <label class="products-field products-field-grow">
                <span>Query</span>
                <input data-products-query type="search" placeholder="mobile top-up" autocomplete="off" />
              </label>
              <button class="products-secondary-button" type="button" data-products-refresh>Refresh</button>
            </div>
            <div class="products-error" data-products-error role="alert" aria-live="polite"></div>
            <div class="products-marketplace-grid">
              <section class="products-list-region" aria-label="Product listings">
                <div class="products-region-heading">
                  <h3>Listings</h3>
                  <span>online=true</span>
                </div>
                <div class="products-list" data-products-list></div>
              </section>
              <section class="products-detail-region" aria-label="Selected product">
                <div class="products-region-heading">
                  <h3>Detail</h3>
                  <span>Preview only</span>
                </div>
                <div class="products-detail" data-products-detail></div>
                <div class="products-skus" data-products-skus></div>
                <div class="products-purchase-panel" aria-label="Purchase preview">
                  <label class="products-field">
                    <span>Buyer actor</span>
                    <select data-products-buyer></select>
                  </label>
                  <div class="products-spend-row">
                    <label class="products-field">
                      <span>Spend cap</span>
                      <input data-products-spend-cap type="text" inputmode="decimal" placeholder="0.0001" />
                    </label>
                    <label class="products-field">
                      <span>Comment</span>
                      <input data-products-comment type="text" placeholder="Optional order note" />
                    </label>
                  </div>
                  <div class="products-purchase-actions">
                    <button class="products-primary-button" type="button" data-products-preview>Preview purchase</button>
                    <span data-products-purchase-reason></span>
                  </div>
                </div>
              </section>
            </div>
          </section>

          <section id="sell" class="products-panel" data-products-panel="sell" role="tabpanel" aria-labelledby="products-tab-sell" hidden>
            <div class="products-panel-header">
              <h2>Sell</h2>
              <span>/protocols/product-listing</span>
            </div>
            <div class="products-sell-layout">
              <section class="products-sell-form" aria-label="Product listing form">
                <div class="products-form-grid">
                  <label class="products-field">
                    <span>Seller actor</span>
                    <select data-products-seller></select>
                  </label>
                  <label class="products-field">
                    <span>Publish network</span>
                    <select data-products-network>
                      <option value="mvc">mvc</option>
                      <option value="btc">btc</option>
                      <option value="doge">doge</option>
                      <option value="opcat">opcat</option>
                    </select>
                  </label>
                </div>
                <div class="products-error" data-products-sell-error role="alert" aria-live="polite"></div>
                <div class="products-region-heading">
                  <h3>Fulfillment skills</h3>
                  <span>Returned catalog only</span>
                </div>
                <div class="products-skill-list" data-products-sell-skills></div>
                <div class="products-region-heading">
                  <h3>Listing fields</h3>
                  <span>Product V1 virtual goods</span>
                </div>
                <div class="products-form-grid">
                  <label class="products-field">
                    <span>Name</span>
                    <input data-products-listing-name type="text" autocomplete="off" placeholder="mobile-credit" />
                  </label>
                  <label class="products-field">
                    <span>Title</span>
                    <input data-products-listing-title type="text" autocomplete="off" placeholder="Mobile Credit" />
                  </label>
                  <label class="products-field products-field-wide">
                    <span>Cover image URI</span>
                    <input data-products-cover-image type="text" autocomplete="off" placeholder="metafile://..." />
                  </label>
                  <label class="products-field products-field-wide">
                    <span>Gallery image URIs</span>
                    <textarea data-products-gallery-images rows="3" placeholder="metafile://..."></textarea>
                  </label>
                  <label class="products-field">
                    <span>Description type</span>
                    <select data-products-description-content-type>
                      <option value="text/markdown">text/markdown</option>
                      <option value="text/html">text/html</option>
                    </select>
                  </label>
                  <label class="products-field">
                    <span>Estimated delivery seconds</span>
                    <input data-products-estimated-delivery-seconds type="text" inputmode="numeric" placeholder="60" />
                  </label>
                  <label class="products-field products-field-wide">
                    <span>Description</span>
                    <textarea data-products-description rows="5" placeholder="Markdown description"></textarea>
                  </label>
                  <label class="products-field products-field-wide">
                    <span>Deliverable description</span>
                    <input data-products-deliverable-description type="text" autocomplete="off" placeholder="Activation code sent by simplemsg" />
                  </label>
                </div>
                <div class="products-region-heading">
                  <h3>SKUs</h3>
                  <button class="products-secondary-button" type="button" data-products-add-sku>Add SKU</button>
                </div>
                <div class="products-sku-editor" data-products-sku-list></div>
              </section>
              <aside class="products-sell-preview" aria-label="Publish preview">
                <div class="products-region-heading">
                  <h3>JSON preview</h3>
                  <span>Exact payload</span>
                </div>
                <pre class="products-preview-code" data-products-listing-preview-json></pre>
                <div class="products-publish-actions">
                  <button class="products-primary-button" type="button" data-products-publish>Review publish</button>
                  <span data-products-publish-reason></span>
                </div>
                <div class="products-success-block" data-products-publish-success></div>
                <div class="products-region-heading">
                  <h3>Owned listings</h3>
                  <button class="products-secondary-button" type="button" data-products-owned-refresh>Refresh</button>
                </div>
                <div class="products-error" data-products-owned-error role="alert" aria-live="polite"></div>
                <div class="products-owned-list" data-products-owned-list></div>
              </aside>
            </div>
          </section>

          <section id="orders" class="products-panel" data-products-panel="orders" role="tabpanel" aria-labelledby="products-tab-orders" hidden>
            <div class="products-panel-header">
              <h2>Orders</h2>
              <span>/api/products/orders</span>
            </div>
            <div class="products-orders-toolbar" aria-label="Order filters">
              <label class="products-field">
                <span>Actor</span>
                <select data-products-order-actor></select>
              </label>
              <label class="products-field">
                <span>Role</span>
                <select data-products-order-role>
                  <option value="buyer">buyer</option>
                  <option value="seller">seller</option>
                  <option value="all">all</option>
                </select>
              </label>
              <label class="products-field">
                <span>State</span>
                <select data-products-order-state>
                  <option value="">Any state</option>
                  <option value="created">created</option>
                  <option value="payment_pending">payment_pending</option>
                  <option value="paid">paid</option>
                  <option value="notified">notified</option>
                  <option value="accepted">accepted</option>
                  <option value="fulfilling">fulfilling</option>
                  <option value="delivered">delivered</option>
                  <option value="failed">failed</option>
                  <option value="closed">closed</option>
                </select>
              </label>
              <label class="products-field">
                <span>Page size</span>
                <select data-products-order-page-size>
                  <option value="10">10</option>
                  <option value="20" selected>20</option>
                  <option value="50">50</option>
                </select>
              </label>
              <button class="products-secondary-button" type="button" data-products-order-refresh>Refresh</button>
            </div>
            <div class="products-orders-inspect-row">
              <label class="products-field products-field-grow">
                <span>Inspect selector</span>
                <input data-products-order-selector type="text" autocomplete="off" placeholder="product-order pin, payment txid, order txid, or order id" />
              </label>
              <select data-products-order-selector-kind aria-label="Order selector type">
                <option value="auto">Auto</option>
                <option value="productOrderPinId">Product-order pin</option>
                <option value="paymentTxid">Payment txid</option>
                <option value="orderTxid">Order txid</option>
                <option value="orderId">Order id</option>
              </select>
              <button class="products-primary-button" type="button" data-products-order-inspect>Inspect</button>
            </div>
            <div class="products-error" data-products-order-error role="alert" aria-live="polite"></div>
            <div class="products-orders-table-wrap">
              <table class="products-orders-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>State</th>
                    <th>Listing</th>
                    <th>SKU</th>
                    <th>Payment txid</th>
                    <th>Product-order pin</th>
                    <th>Delivery</th>
                  </tr>
                </thead>
                <tbody data-products-orders-list></tbody>
              </table>
            </div>
            <div class="products-pagination">
              <button class="products-secondary-button" type="button" data-products-order-prev>Previous</button>
              <span data-products-order-page-label>Page 1</span>
              <button class="products-secondary-button" type="button" data-products-order-next>Next</button>
            </div>
          </section>
        </section>
        <div class="products-modal-backdrop" data-products-confirmation-modal hidden>
          <section class="products-confirmation" role="dialog" aria-modal="true" aria-labelledby="products-confirmation-title">
            <div class="products-confirmation-head">
              <div>
                <p class="products-eyebrow">Purchase confirmation</p>
                <h2 id="products-confirmation-title">Confirm payment</h2>
              </div>
              <button class="products-secondary-button" type="button" data-products-cancel-confirmation>Cancel</button>
            </div>
            <div data-products-confirmation-summary></div>
            <details class="products-json-preview">
              <summary>JSON preview</summary>
              <pre data-products-confirmation-json></pre>
            </details>
            <div class="products-confirmation-actions">
              <button class="products-primary-button products-danger-button" type="button" data-products-confirm>Confirm and pay</button>
            </div>
          </section>
        </div>
        <div class="products-modal-backdrop" data-products-publish-confirmation-modal hidden>
          <section class="products-confirmation" role="dialog" aria-modal="true" aria-labelledby="products-publish-confirmation-title">
            <div class="products-confirmation-head">
              <div>
                <p class="products-eyebrow">Publish confirmation</p>
                <h2 id="products-publish-confirmation-title">Confirm listing publish</h2>
              </div>
              <button class="products-secondary-button" type="button" data-products-cancel-publish>Cancel</button>
            </div>
            <div data-products-publish-confirmation-summary></div>
            <details class="products-json-preview" open>
              <summary>JSON payload</summary>
              <pre data-products-publish-confirmation-json></pre>
            </details>
            <div class="products-confirmation-actions">
              <button class="products-primary-button products-danger-button" type="button" data-products-confirm-publish>Publish listing</button>
            </div>
          </section>
        </div>
        <div class="products-modal-backdrop" data-products-order-detail-modal hidden>
          <section class="products-confirmation products-order-detail" role="dialog" aria-modal="true" aria-labelledby="products-order-detail-title">
            <div class="products-confirmation-head">
              <div>
                <p class="products-eyebrow">Order inspection</p>
                <h2 id="products-order-detail-title">Product order detail</h2>
              </div>
              <button class="products-secondary-button" type="button" data-products-order-detail-close>Close</button>
            </div>
            <div data-products-order-detail></div>
          </section>
        </div>
      </section>
    `,
        script: `(() => {
  ${buildProductCommercePageViewModelSource}
  ${buildProductsPageScript()}
})();`,
    };
}
function buildProductsPageScript() {
    return `(() => {
  const state = {
    profiles: [],
    profileError: null,
    marketplace: null,
    marketplaceError: null,
    selectedListingPinId: '',
    selectedSkuId: '',
    buyerSlug: '',
    query: '',
    busy: false,
    purchase: {
      open: false,
      busy: false,
      previewEnvelope: null,
      confirmRequest: null,
      success: null,
      successSelection: null,
      error: null,
    },
    sell: {
      sellerSlug: '',
      skills: [],
      selectedSkills: [],
      skillsLoadedFor: '',
      skillError: null,
      previewPayload: null,
      previewError: null,
      publishOpen: false,
      publishBusy: false,
      publishSuccess: null,
      form: {
        skus: [{
          skuId: 'sku-5',
          name: '5 SPACE credit',
          image: 'metafile://sku-five',
          descriptionContentType: 'text/markdown',
          description: 'Small top-up.',
          price: { amount: '5', currency: 'SPACE' },
          initialStock: '10',
        }],
      },
    },
    ownedListings: null,
    ownedListingsError: null,
    ordersPage: null,
    orderInspect: null,
    orderError: null,
    orderRole: 'buyer',
    orderState: '',
    orderPage: 1,
    orderPageSize: 20,
    orderActorSlug: '',
  };
  const elements = {
    status: document.querySelector('[data-products-status]'),
    query: document.querySelector('[data-products-query]'),
    refresh: document.querySelector('[data-products-refresh]'),
    list: document.querySelector('[data-products-list]'),
    detail: document.querySelector('[data-products-detail]'),
    skus: document.querySelector('[data-products-skus]'),
    buyer: document.querySelector('[data-products-buyer]'),
    spendCap: document.querySelector('[data-products-spend-cap]'),
    comment: document.querySelector('[data-products-comment]'),
    preview: document.querySelector('[data-products-preview]'),
    purchaseReason: document.querySelector('[data-products-purchase-reason]'),
    confirmationModal: document.querySelector('[data-products-confirmation-modal]'),
    confirmationSummary: document.querySelector('[data-products-confirmation-summary]'),
    confirmationJson: document.querySelector('[data-products-confirmation-json]'),
    confirm: document.querySelector('[data-products-confirm]'),
    cancelConfirmation: document.querySelector('[data-products-cancel-confirmation]'),
    error: document.querySelector('[data-products-error]'),
    seller: document.querySelector('[data-products-seller]'),
    sellSkills: document.querySelector('[data-products-sell-skills]'),
    sellError: document.querySelector('[data-products-sell-error]'),
    listingName: document.querySelector('[data-products-listing-name]'),
    listingTitle: document.querySelector('[data-products-listing-title]'),
    coverImage: document.querySelector('[data-products-cover-image]'),
    galleryImages: document.querySelector('[data-products-gallery-images]'),
    descriptionContentType: document.querySelector('[data-products-description-content-type]'),
    description: document.querySelector('[data-products-description]'),
    estimatedDeliverySeconds: document.querySelector('[data-products-estimated-delivery-seconds]'),
    deliverableDescription: document.querySelector('[data-products-deliverable-description]'),
    skuList: document.querySelector('[data-products-sku-list]'),
    addSku: document.querySelector('[data-products-add-sku]'),
    network: document.querySelector('[data-products-network]'),
    listingPreviewJson: document.querySelector('[data-products-listing-preview-json]'),
    publish: document.querySelector('[data-products-publish]'),
    publishReason: document.querySelector('[data-products-publish-reason]'),
    publishConfirmationModal: document.querySelector('[data-products-publish-confirmation-modal]'),
    publishConfirmationSummary: document.querySelector('[data-products-publish-confirmation-summary]'),
    publishConfirmationJson: document.querySelector('[data-products-publish-confirmation-json]'),
    confirmPublish: document.querySelector('[data-products-confirm-publish]'),
    cancelPublish: document.querySelector('[data-products-cancel-publish]'),
    publishSuccess: document.querySelector('[data-products-publish-success]'),
    ownedRefresh: document.querySelector('[data-products-owned-refresh]'),
    ownedError: document.querySelector('[data-products-owned-error]'),
    ownedList: document.querySelector('[data-products-owned-list]'),
    orderActor: document.querySelector('[data-products-order-actor]'),
    orderRole: document.querySelector('[data-products-order-role]'),
    orderState: document.querySelector('[data-products-order-state]'),
    orderPageSize: document.querySelector('[data-products-order-page-size]'),
    orderRefresh: document.querySelector('[data-products-order-refresh]'),
    orderSelector: document.querySelector('[data-products-order-selector]'),
    orderSelectorKind: document.querySelector('[data-products-order-selector-kind]'),
    orderInspectButton: document.querySelector('[data-products-order-inspect]'),
    orderError: document.querySelector('[data-products-order-error]'),
    ordersList: document.querySelector('[data-products-orders-list]'),
    orderPrev: document.querySelector('[data-products-order-prev]'),
    orderNext: document.querySelector('[data-products-order-next]'),
    orderPageLabel: document.querySelector('[data-products-order-page-label]'),
    orderDetailModal: document.querySelector('[data-products-order-detail-modal]'),
    orderDetail: document.querySelector('[data-products-order-detail]'),
    orderDetailClose: document.querySelector('[data-products-order-detail-close]'),
  };
  const tabs = Array.from(document.querySelectorAll('[data-products-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-products-panel]'));
  const validTabNames = tabs
    .map((tab) => tab.getAttribute('data-products-tab'))
    .filter(Boolean);
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const normalizeText = (value) => String(value || '').trim();
  const readArrayValue = (value) => Array.isArray(value) ? value : [];
  const readObjectValue = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const formatPriceLabel = (sku) => {
    const price = readObjectValue(readObjectValue(sku).price);
    return [normalizeText(price.amount), normalizeText(price.currency).toUpperCase()].filter(Boolean).join(' ') || 'No price';
  };
  const productList = () => readArrayValue(state.marketplace && state.marketplace.products);
  const currentPurchaseSelection = () => ({
    buyerSlug: normalizeText(state.buyerSlug),
    listingPinId: normalizeText(state.selectedListingPinId),
    skuId: normalizeText(state.selectedSkuId),
    query: normalizeText(state.query),
    spendCap: elements.spendCap ? normalizeText(elements.spendCap.value) : '',
    comment: elements.comment ? normalizeText(elements.comment.value) : '',
  });
  const pageItems = (page) => readArrayValue(page && (page.items || page.orders || page.listings));
  const appendQuery = (base, params) => {
    const query = Object.keys(params)
      .filter((key) => params[key] !== undefined && params[key] !== null && normalizeText(params[key]) !== '')
      .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])))
      .join('&');
    return base + (query ? '?' + query : '');
  };
  const ownedListingsUrl = (refresh) => appendQuery('/api/products/owned', {
    ...(state.sell.sellerSlug ? { from: state.sell.sellerSlug } : { all: true }),
    page: 1,
    pageSize: 20,
    ...(refresh ? { refresh: true } : {}),
  });
  const ordersUrl = () => appendQuery('/api/products/orders', {
    ...(state.orderActorSlug ? { from: state.orderActorSlug } : { all: true }),
    role: state.orderRole || 'buyer',
    ...(state.orderState ? { state: state.orderState } : {}),
    page: state.orderPage,
    pageSize: state.orderPageSize,
  });
  const purchaseSelectionKey = (selection) => JSON.stringify([
    normalizeText(selection.buyerSlug),
    normalizeText(selection.listingPinId),
    normalizeText(selection.skuId),
    normalizeText(selection.query),
    normalizeText(selection.spendCap),
    normalizeText(selection.comment),
  ]);
  const resetPurchaseOutcome = () => {
    state.purchase.open = false;
    state.purchase.busy = false;
    state.purchase.previewEnvelope = null;
    state.purchase.confirmRequest = null;
    state.purchase.success = null;
    state.purchase.successSelection = null;
    state.purchase.error = null;
  };
  const syncPurchaseOutcomeToSelection = () => {
    if (state.purchase.success && state.purchase.successSelection !== purchaseSelectionKey(currentPurchaseSelection())) {
      resetPurchaseOutcome();
    }
  };
  const selectedProduct = () => {
    const products = productList();
    if (!state.selectedListingPinId) return products[0] || null;
    return products.find((product) => normalizeText(product && product.listingPinId) === state.selectedListingPinId) || products[0] || null;
  };
  const selectedSkus = () => {
    const product = readObjectValue(selectedProduct());
    const listing = readObjectValue(product.listing);
    return readArrayValue(product.skus || listing.skus);
  };
  const selectedSku = () => {
    const skus = selectedSkus();
    if (!state.selectedSkuId) return skus[0] || null;
    return skus.find((sku) => normalizeText(sku && sku.skuId) === state.selectedSkuId) || skus[0] || null;
  };
  const setStatus = (text, tone) => {
    if (!elements.status) return;
    elements.status.textContent = text;
    elements.status.dataset.tone = tone || 'neutral';
  };
  const renderError = () => {
    if (!elements.error) return;
    const errors = [state.profileError, state.marketplaceError].filter(Boolean);
    elements.error.textContent = errors
      .map((error) => [error.code, error.message].filter(Boolean).join(': '))
      .join(' | ');
    elements.error.hidden = errors.length === 0;
  };
  const loadJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      const error = new Error(payload && payload.message ? payload.message : 'Request failed.');
      error.code = payload && payload.code ? payload.code : 'request_failed';
      error.payload = payload;
      throw error;
    }
    return payload;
  };
  const postJson = async (url, body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      const error = new Error(payload && payload.message ? payload.message : 'Request failed.');
      error.code = payload && payload.code ? payload.code : 'request_failed';
      error.payload = payload;
      throw error;
    }
    return payload;
  };
  const marketplaceUrl = () => {
    const query = normalizeText(state.query);
    return '/api/network/products?online=true' + (query ? '&query=' + encodeURIComponent(query) : '') + '&limit=20';
  };
  const priceAmountForSku = (sku) => normalizeText(readObjectValue(readObjectValue(sku).price).amount);
  const isPositiveDecimal = (value) => {
    const normalized = normalizeText(value);
    return /^(?:0|[1-9]\\d*)(?:\\.\\d+)?$/u.test(normalized) && /[1-9]/u.test(normalized.replace('.', ''));
  };
  const disabledReason = () => {
    const product = readObjectValue(selectedProduct());
    const sku = readObjectValue(selectedSku());
    const fulfillment = readObjectValue(product.fulfillment || readObjectValue(product.listing).fulfillment);
    const productType = normalizeText(product.productType || readObjectValue(product.listing).productType);
    const fulfillmentType = normalizeText(fulfillment.fulfillmentType);
    const deliveryEndpoint = normalizeText(fulfillment.deliveryEndpoint);
    if (!state.buyerSlug) return 'Select a buyer actor.';
    if (!normalizeText(product.listingPinId)) return 'Select a product.';
    if (!normalizeText(sku.skuId)) return 'Select a SKU.';
    if (product.online !== true) return 'Product seller is offline or unavailable.';
    if (productType !== 'virtual') return 'Physical products are not supported in Product V1.';
    if (fulfillmentType !== 'digital_delivery' || deliveryEndpoint !== 'simplemsg') {
      return 'Only digital delivery through simplemsg is supported in Product V1.';
    }
    if (!isPositiveDecimal(elements.spendCap && elements.spendCap.value)) return 'Enter a valid positive spend cap.';
    return '';
  };
  const syncSelectedDefaults = () => {
    const product = selectedProduct();
    if (product) {
      state.selectedListingPinId = normalizeText(product.listingPinId);
    }
    const sku = selectedSku();
    if (sku) {
      state.selectedSkuId = normalizeText(sku.skuId);
      if (elements.spendCap && !normalizeText(elements.spendCap.value)) {
        elements.spendCap.value = priceAmountForSku(sku);
      }
    }
  };
  const renderBuyerSelect = () => {
    if (!elements.buyer) return;
    const previous = state.buyerSlug || elements.buyer.value;
    elements.buyer.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.profiles.length ? 'Select buyer' : 'No local MetaBot profiles';
    elements.buyer.appendChild(placeholder);
    state.profiles.forEach((profile) => {
      const option = document.createElement('option');
      option.value = normalizeText(profile.slug);
      option.textContent = normalizeText(profile.name || profile.displayName || profile.slug) || option.value;
      elements.buyer.appendChild(option);
    });
    if (previous && state.profiles.some((profile) => normalizeText(profile.slug) === previous)) {
      elements.buyer.value = previous;
      state.buyerSlug = previous;
    } else if (state.profiles.length > 0) {
      state.buyerSlug = normalizeText(state.profiles[0].slug);
      elements.buyer.value = state.buyerSlug;
    } else {
      state.buyerSlug = '';
      elements.buyer.value = '';
    }
  };
  const skillName = (skill) => normalizeText(skill && (skill.name || skill.id || skill.slug || skill));
  const skillLabel = (skill) => normalizeText(skill && (skill.title || skill.displayName || skill.name || skill.id || skill.slug || skill));
  const sellerLabel = () => {
    const profile = state.profiles.find((item) => normalizeText(item.slug) === state.sell.sellerSlug);
    return normalizeText(profile && (profile.name || profile.displayName || profile.slug)) || state.sell.sellerSlug;
  };
  const renderOrderActorSelect = () => {
    if (!elements.orderActor) return;
    const previous = state.orderActorSlug || elements.orderActor.value;
    elements.orderActor.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All local profiles';
    elements.orderActor.appendChild(allOption);
    state.profiles.forEach((profile) => {
      const option = document.createElement('option');
      option.value = normalizeText(profile.slug);
      option.textContent = normalizeText(profile.name || profile.displayName || profile.slug) || option.value;
      elements.orderActor.appendChild(option);
    });
    if (previous && state.profiles.some((profile) => normalizeText(profile.slug) === previous)) {
      state.orderActorSlug = previous;
      elements.orderActor.value = previous;
    } else if (state.profiles.length > 0) {
      state.orderActorSlug = normalizeText(state.profiles[0].slug);
      elements.orderActor.value = state.orderActorSlug;
    } else {
      state.orderActorSlug = '';
      elements.orderActor.value = '';
    }
  };
  const renderSellerSelect = () => {
    if (!elements.seller) return;
    const previous = state.sell.sellerSlug || elements.seller.value;
    elements.seller.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = state.profiles.length ? 'Select seller' : 'No local MetaBot profiles';
    elements.seller.appendChild(placeholder);
    state.profiles.forEach((profile) => {
      const option = document.createElement('option');
      option.value = normalizeText(profile.slug);
      option.textContent = normalizeText(profile.name || profile.displayName || profile.slug) || option.value;
      elements.seller.appendChild(option);
    });
    if (previous && state.profiles.some((profile) => normalizeText(profile.slug) === previous)) {
      state.sell.sellerSlug = previous;
      elements.seller.value = previous;
    } else if (state.profiles.length > 0) {
      state.sell.sellerSlug = normalizeText(state.profiles[0].slug);
      elements.seller.value = state.sell.sellerSlug;
    } else {
      state.sell.sellerSlug = '';
      elements.seller.value = '';
    }
  };
  const readGalleryImages = () => normalizeText(elements.galleryImages && elements.galleryImages.value)
    .split(/[\\n,]+/u)
    .map((item) => normalizeText(item))
    .filter(Boolean);
  const readSellForm = () => ({
    name: elements.listingName ? elements.listingName.value : '',
    title: elements.listingTitle ? elements.listingTitle.value : '',
    coverImage: elements.coverImage ? elements.coverImage.value : '',
    galleryImages: readGalleryImages(),
    descriptionContentType: elements.descriptionContentType ? elements.descriptionContentType.value : 'text/markdown',
    description: elements.description ? elements.description.value : '',
    fulfillmentSkills: state.sell.selectedSkills,
    fulfillmentType: 'digital_delivery',
    deliveryEndpoint: 'simplemsg',
    estimatedDeliverySeconds: elements.estimatedDeliverySeconds ? elements.estimatedDeliverySeconds.value : '',
    deliverableDescription: elements.deliverableDescription ? elements.deliverableDescription.value : '',
    skus: state.sell.form.skus,
  });
  const updateSkuFromDom = () => {
    if (!elements.skuList) return;
    const next = state.sell.form.skus.map((sku) => ({
      ...sku,
      price: { ...readObjectValue(sku.price) },
    }));
    elements.skuList.querySelectorAll('[data-product-sell-sku-field]').forEach((field) => {
      const index = Number(field.getAttribute('data-sku-index'));
      const key = field.getAttribute('data-product-sell-sku-field');
      if (!Number.isInteger(index) || !next[index] || !key) return;
      if (key === 'priceAmount') next[index].price.amount = field.value;
      else if (key === 'priceCurrency') next[index].price.currency = field.value;
      else next[index][key] = field.value;
    });
    state.sell.form.skus = next;
  };
  const renderSkuEditor = () => {
    if (!elements.skuList) return;
    elements.skuList.innerHTML = state.sell.form.skus.map((sku, index) => {
      const price = readObjectValue(sku.price);
      const field = (name, label, value, extra) => (
        '<label class="products-field">' +
          '<span>' + escapeHtml(label) + '</span>' +
          '<input data-product-sell-sku-field="' + escapeHtml(name) + '" data-sku-index="' + index + '" type="text" value="' + escapeHtml(value) + '"' + (extra || '') + ' />' +
        '</label>'
      );
      return [
        '<section class="products-sku-editor-row">',
          '<div class="products-sku-editor-head"><h4>SKU ' + String(index + 1) + '</h4>',
            state.sell.form.skus.length > 1 ? '<button class="products-secondary-button" type="button" data-product-sell-sku-remove="' + index + '">Remove</button>' : '',
          '</div>',
          '<div class="products-form-grid">',
            field('skuId', 'SKU id', sku.skuId || ''),
            field('name', 'Name', sku.name || ''),
            field('image', 'Image URI', sku.image || ''),
            '<label class="products-field"><span>Description type</span><select data-product-sell-sku-field="descriptionContentType" data-sku-index="' + index + '" value="' + escapeHtml(sku.descriptionContentType || 'text/markdown') + '"><option value="text/markdown"' + (sku.descriptionContentType === 'text/html' ? '' : ' selected') + '>text/markdown</option><option value="text/html"' + (sku.descriptionContentType === 'text/html' ? ' selected' : '') + '>text/html</option></select></label>',
            field('priceAmount', 'Price amount', price.amount || '', ' inputmode="decimal"'),
            field('priceCurrency', 'Price currency', price.currency || ''),
            field('initialStock', 'Stock', sku.initialStock || '', ' inputmode="numeric"'),
            '<label class="products-field products-field-wide"><span>Description</span><textarea data-product-sell-sku-field="description" data-sku-index="' + index + '" rows="3" value="' + escapeHtml(sku.description || '') + '">' + escapeHtml(sku.description || '') + '</textarea></label>',
          '</div>',
        '</section>',
      ].join('');
    }).join('');
    elements.skuList.querySelectorAll('[data-product-sell-sku-field]').forEach((field) => {
      field.addEventListener('input', () => {
        updateSkuFromDom();
        renderSellPreview();
      });
      field.addEventListener('change', () => {
        updateSkuFromDom();
        renderSellPreview();
      });
    });
    elements.skuList.querySelectorAll('[data-product-sell-sku-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-product-sell-sku-remove'));
        if (Number.isInteger(index) && state.sell.form.skus.length > 1) {
          state.sell.form.skus.splice(index, 1);
          renderSkuEditor();
          renderSellPreview();
        }
      });
    });
  };
  const renderSkillList = () => {
    if (!elements.sellSkills) return;
    const skills = readArrayValue(state.sell.skills).map((skill) => ({ name: skillName(skill), label: skillLabel(skill) })).filter((skill) => skill.name);
    if (state.sell.skillError) {
      elements.sellSkills.innerHTML = '<p class="products-empty">Fulfillment skills are unavailable.</p>';
    } else if (!state.sell.sellerSlug) {
      elements.sellSkills.innerHTML = '<p class="products-empty">Select a seller actor to load skills.</p>';
    } else if (!skills.length) {
      elements.sellSkills.innerHTML = '<p class="products-empty">No fulfillment skills returned for this seller.</p>';
    } else {
      elements.sellSkills.innerHTML = skills.map((skill) => (
        '<label class="products-skill-chip">' +
          '<input type="checkbox" data-product-sell-skill="' + escapeHtml(skill.name) + '" value="' + escapeHtml(skill.name) + '"' + (state.sell.selectedSkills.includes(skill.name) ? ' checked' : '') + ' />' +
          '<span>' + escapeHtml(skill.label || skill.name) + '</span>' +
        '</label>'
      )).join('');
    }
    elements.sellSkills.querySelectorAll('[data-product-sell-skill]').forEach((input) => {
      input.addEventListener('change', () => {
        const name = input.getAttribute('data-product-sell-skill');
        if (!name) return;
        if (input.checked && !state.sell.selectedSkills.includes(name)) {
          state.sell.selectedSkills.push(name);
        } else if (!input.checked) {
          state.sell.selectedSkills = state.sell.selectedSkills.filter((item) => item !== name);
        }
        renderSellPreview();
      });
    });
  };
  const sellSkillNames = () => readArrayValue(state.sell.skills).map(skillName).filter(Boolean);
  const renderSellError = () => {
    if (!elements.sellError) return;
    const errors = [state.sell.skillError, state.sell.previewError].filter(Boolean);
    elements.sellError.textContent = errors.map((error) => [error.code, error.message].filter(Boolean).join(': ')).join(' | ');
    elements.sellError.hidden = errors.length === 0;
  };
  const renderSellPreview = () => {
    updateSkuFromDom();
    state.sell.previewError = null;
    state.sell.previewPayload = null;
    try {
      if (!state.sell.skillError) {
        const model = buildProductCommercePageViewModel({
          skillCatalog: sellSkillNames(),
          listingForm: readSellForm(),
        });
        state.sell.previewPayload = model.listingPreviewPayload;
      }
    } catch (error) {
      state.sell.previewError = {
        code: 'product_listing_invalid',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (elements.listingPreviewJson) {
      elements.listingPreviewJson.textContent = state.sell.previewPayload
        ? JSON.stringify(state.sell.previewPayload, null, 2)
        : '';
    }
    renderSellError();
    renderPublishControls();
    renderPublishModal();
  };
  const renderPublishControls = () => {
    const reason = state.sell.skillError
      ? 'Fulfillment skills must load before publishing.'
      : state.sell.previewError
        ? state.sell.previewError.message
        : !state.sell.previewPayload
          ? 'Complete required listing fields.'
          : 'Review required before publish.';
    if (elements.publish) {
      elements.publish.disabled = Boolean(state.sell.skillError || state.sell.previewError || !state.sell.previewPayload || state.sell.publishBusy);
    }
    if (elements.publishReason) {
      elements.publishReason.textContent = reason;
    }
  };
  const renderPublishModal = () => {
    if (!elements.publishConfirmationModal) return;
    elements.publishConfirmationModal.hidden = !state.sell.publishOpen;
    elements.publishConfirmationModal.toggleAttribute('data-modal-open', state.sell.publishOpen);
    const payload = readObjectValue(state.sell.previewPayload);
    const fulfillment = readObjectValue(payload.fulfillment);
    const skuCount = readArrayValue(payload.skus).length;
    if (elements.publishConfirmationJson) {
      elements.publishConfirmationJson.textContent = state.sell.previewPayload ? JSON.stringify(state.sell.previewPayload, null, 2) : '';
    }
    if (elements.publishConfirmationSummary) {
      elements.publishConfirmationSummary.innerHTML = renderFacts([
        { label: 'Seller actor', value: sellerLabel() },
        { label: 'Network', value: elements.network ? elements.network.value : 'mvc' },
        { label: 'Listing title', value: payload.title },
        { label: 'SKU count', value: skuCount + ' SKU' + (skuCount === 1 ? '' : 's') },
        { label: 'Fulfillment skills', value: readArrayValue(fulfillment.fulfillmentSkills).join(', ') },
        { label: 'Protocol path', value: '/protocols/product-listing' },
      ]);
    }
    if (elements.confirmPublish) {
      elements.confirmPublish.disabled = state.sell.publishBusy;
      elements.confirmPublish.textContent = state.sell.publishBusy ? 'Publishing...' : 'Publish listing';
    }
    if (elements.cancelPublish) elements.cancelPublish.disabled = state.sell.publishBusy;
  };
  const renderPublishSuccess = () => {
    if (!elements.publishSuccess) return;
    const data = readObjectValue(state.sell.publishSuccess && state.sell.publishSuccess.data);
    if (!state.sell.publishSuccess) {
      elements.publishSuccess.innerHTML = '';
      return;
    }
    elements.publishSuccess.innerHTML = [
      '<h3>Listing published</h3>',
      renderFacts([
        { label: 'Listing pin id', value: data.listingPinId || data.pinId },
        { label: 'Txids', value: readArrayValue(data.txids || data.txIds).join(', ') || normalizeText(data.txid) },
      ]),
    ].join('');
  };
  const renderOwnedListings = () => {
    if (elements.ownedError) {
      elements.ownedError.textContent = state.ownedListingsError
        ? [state.ownedListingsError.code, state.ownedListingsError.message].filter(Boolean).join(': ')
        : '';
      elements.ownedError.hidden = !state.ownedListingsError;
    }
    if (!elements.ownedList) return;
    const model = buildProductCommercePageViewModel({
      ownedListings: pageItems(state.ownedListings),
    });
    if (!model.ownedListingRows.length) {
      elements.ownedList.innerHTML = '<p class="products-empty">No owned product listings found.</p>';
      return;
    }
    elements.ownedList.innerHTML = model.ownedListingRows.map((row) => (
      '<section class="products-owned-row">' +
        '<div class="products-row-main">' +
          '<strong>' + escapeHtml(row.title || row.listingPinId) + '</strong>' +
          '<span>' + escapeHtml(row.listingPinId) + '</span>' +
        '</div>' +
        '<dl class="products-mini-facts">' +
          '<div><dt>SKUs</dt><dd>' + escapeHtml(row.skuCountLabel) + '</dd></div>' +
          '<div><dt>Fulfillment</dt><dd>' + escapeHtml(row.fulfillmentSkillsLabel) + '</dd></div>' +
          '<div><dt>State</dt><dd>' + escapeHtml(row.stateLabel) + '</dd></div>' +
        '</dl>' +
        '<div class="products-row-actions">' +
          '<button class="products-secondary-button" type="button" data-product-owned-inspect="' + escapeHtml(row.listingPinId) + '">Inspect</button>' +
          '<button class="products-secondary-button" type="button" data-product-owned-copy="' + escapeHtml(row.listingPinId) + '">Copy</button>' +
        '</div>' +
      '</section>'
    )).join('');
    elements.ownedList.querySelectorAll('[data-product-owned-copy]').forEach((button) => {
      button.addEventListener('click', () => {
        const value = button.getAttribute('data-product-owned-copy');
        if (typeof navigator !== 'undefined' && navigator.clipboard && value) navigator.clipboard.writeText(value).catch(() => {});
      });
    });
    elements.ownedList.querySelectorAll('[data-product-owned-inspect]').forEach((button) => {
      button.addEventListener('click', () => {
        const pinId = button.getAttribute('data-product-owned-inspect');
        const source = pageItems(state.ownedListings).find((item) => normalizeText(item && item.listingPinId) === pinId);
        const payload = readObjectValue(source && source.payload);
        state.ownedListingsError = {
          code: 'listing_inspect',
          message: JSON.stringify(payload && Object.keys(payload).length ? payload : source || {}, null, 2),
        };
        renderOwnedListings();
      });
    });
  };
  const loadOwnedListings = async (refresh) => {
    setStatus('Loading owned listings', 'busy');
    state.ownedListingsError = null;
    try {
      const envelope = await loadJson(ownedListingsUrl(refresh));
      state.ownedListings = envelope.data || { items: [] };
      setStatus('Owned listings loaded', 'ready');
    } catch (error) {
      state.ownedListings = { items: [] };
      state.ownedListingsError = {
        code: error && error.code ? error.code : 'products_owned_failed',
        message: error instanceof Error ? error.message : String(error),
      };
      setStatus('Owned listings failed', 'error');
    } finally {
      renderOwnedListings();
    }
  };
  const loadSellerSkills = async () => {
    if (!state.sell.sellerSlug) {
      state.sell.skills = [];
      state.sell.selectedSkills = [];
      state.sell.skillsLoadedFor = '';
      renderSkillList();
      renderSellPreview();
      await loadOwnedListings(false);
      return;
    }
    const sellerSlug = state.sell.sellerSlug;
    const requestSequence = ++sellEntrySequence;
    setStatus('Loading seller skills', 'busy');
    state.sell.skillError = null;
    state.sell.skills = [];
    state.sell.selectedSkills = [];
    renderSkillList();
    renderSellPreview();
    try {
      const envelope = await loadJson('/api/products/skills?from=' + encodeURIComponent(sellerSlug));
      if (requestSequence !== sellEntrySequence || state.sell.sellerSlug !== sellerSlug) {
        return;
      }
      state.sell.skills = readArrayValue(envelope.data && (envelope.data.skills || envelope.data.catalog));
      state.sell.skillsLoadedFor = sellerSlug;
      setStatus('Seller skills loaded', 'ready');
      await loadOwnedListings(false);
    } catch (error) {
      if (requestSequence !== sellEntrySequence || state.sell.sellerSlug !== sellerSlug) {
        return;
      }
      state.sell.skillError = {
        code: error && error.code ? error.code : 'products_skills_failed',
        message: error instanceof Error ? error.message : String(error),
      };
      setStatus('Seller skills failed', 'error');
    } finally {
      renderSkillList();
      renderSellPreview();
    }
  };
  let sellEntrySequence = 0;
  const enterSellTab = async () => {
    const sequence = ++sellEntrySequence;
    setStatus('Loading seller profiles', 'busy');
    try {
      await loadProfiles();
      state.profileError = null;
    } catch (error) {
      if (sequence !== sellEntrySequence) return;
      state.profiles = [];
      state.profileError = {
        code: error && error.code ? error.code : 'metabot_profiles_failed',
        message: error instanceof Error ? error.message : String(error),
      };
      state.sell.skillError = state.profileError;
      setStatus('Seller profiles failed', 'error');
      renderSellerSelect();
      renderSkillList();
      renderSellPreview();
      return;
    }
    if (sequence !== sellEntrySequence) return;
    renderSellerSelect();
    state.sell.skillError = null;
    state.sell.skillsLoadedFor = '';
    await loadSellerSkills();
  };
  const openPublishModal = () => {
    renderSellPreview();
    if (!state.sell.previewPayload || state.sell.previewError || state.sell.skillError) return;
    state.sell.publishOpen = true;
    renderPublishModal();
    if (elements.confirmPublish) elements.confirmPublish.focus();
  };
  const closePublishModal = () => {
    if (state.sell.publishBusy) return;
    state.sell.publishOpen = false;
    renderPublishModal();
    if (elements.publish) elements.publish.focus();
  };
  const confirmPublish = async () => {
    if (!state.sell.publishOpen || state.sell.publishBusy || !state.sell.previewPayload) return;
    state.sell.publishBusy = true;
    renderPublishModal();
    try {
      const envelope = await postJson('/api/products/publish', {
        from: state.sell.sellerSlug,
        network: elements.network ? elements.network.value : 'mvc',
        ...state.sell.previewPayload,
      });
      state.sell.publishSuccess = envelope;
      state.sell.publishOpen = false;
      setStatus('Listing published', 'ready');
    } catch (error) {
      state.sell.previewError = {
        code: error && error.code ? error.code : 'product_publish_failed',
        message: error instanceof Error ? error.message : String(error),
      };
      setStatus('Publish failed', 'error');
    } finally {
      state.sell.publishBusy = false;
      renderPublishModal();
      renderSellPreview();
      renderPublishSuccess();
    }
  };
  const buildModel = (options) => buildProductCommercePageViewModel({
    products: productList(),
    selectedListing: selectedProduct() || {},
    selectedSku: { skus: selectedSkus() },
    ...(options && options.purchaseSelection ? { purchaseSelection: options.purchaseSelection } : {}),
  });
  const inferOrderSelector = (value) => {
    const normalized = normalizeText(value);
    const kind = elements.orderSelectorKind ? elements.orderSelectorKind.value : 'auto';
    if (kind && kind !== 'auto') return kind;
    if (normalized.startsWith('product-order-') || normalized.startsWith('pin:')) return 'productOrderPinId';
    if (normalized.startsWith('payment-')) return 'paymentTxid';
    if (normalized.startsWith('order-tx-')) return 'orderTxid';
    if (/^[a-f0-9]{64}$/iu.test(normalized)) return 'paymentTxid';
    return 'orderId';
  };
  const orderInspectUrl = (selectorValue, selectorKind) => {
    const selector = selectorKind || inferOrderSelector(selectorValue);
    return appendQuery('/api/products/orders/inspect', {
      ...(state.orderActorSlug ? { from: state.orderActorSlug } : { all: true }),
      [selector]: selectorValue,
    });
  };
  const bestOrderSelector = (row) => {
    if (normalizeText(row.productOrderPinId)) return { kind: 'productOrderPinId', value: normalizeText(row.productOrderPinId) };
    if (normalizeText(row.paymentTxid)) return { kind: 'paymentTxid', value: normalizeText(row.paymentTxid) };
    if (normalizeText(row.orderTxid)) return { kind: 'orderTxid', value: normalizeText(row.orderTxid) };
    return { kind: 'orderId', value: normalizeText(row.orderId) };
  };
  const renderOrders = () => {
    if (elements.orderError) {
      elements.orderError.textContent = state.orderError
        ? [state.orderError.code, state.orderError.message].filter(Boolean).join(': ')
        : '';
      elements.orderError.hidden = !state.orderError;
    }
    if (elements.orderRole) elements.orderRole.value = state.orderRole;
    if (elements.orderState) elements.orderState.value = state.orderState;
    if (elements.orderPageSize) elements.orderPageSize.value = String(state.orderPageSize);
    if (elements.ordersList) {
      const model = buildProductCommercePageViewModel({ orderRows: pageItems(state.ordersPage) });
      elements.ordersList.innerHTML = model.orderRows.length
        ? model.orderRows.map((row) => {
          const selector = bestOrderSelector(row);
          return (
          '<tr data-product-order-row="' + escapeHtml(selector.value) + '" data-product-order-selector-kind="' + escapeHtml(selector.kind) + '">' +
            '<td>' + escapeHtml(row.roleLabel) + '</td>' +
            '<td>' + escapeHtml(row.stateLabel) + '</td>' +
            '<td>' + escapeHtml(row.listingPinId) + '</td>' +
            '<td>' + escapeHtml(row.skuId) + '</td>' +
            '<td>' + escapeHtml(row.paymentTxid) + '</td>' +
            '<td>' + escapeHtml(row.productOrderPinId) + '</td>' +
            '<td>' + escapeHtml(row.deliveryLabel) + '</td>' +
          '</tr>'
          );
        }).join('')
        : '<tr><td colspan="7">No product orders found.</td></tr>';
    elements.ordersList.querySelectorAll('[data-product-order-row]').forEach((row) => {
        row.setAttribute('tabindex', '0');
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', 'Inspect product order ' + row.getAttribute('data-product-order-row'));
        row.addEventListener('click', () => inspectOrder(
          row.getAttribute('data-product-order-row'),
          row.getAttribute('data-product-order-selector-kind'),
        ));
        row.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          inspectOrder(
            row.getAttribute('data-product-order-row'),
            row.getAttribute('data-product-order-selector-kind'),
          );
        });
      });
    }
    const totalPages = Number(state.ordersPage && state.ordersPage.totalPages) || 1;
    if (elements.orderPageLabel) elements.orderPageLabel.textContent = 'Page ' + state.orderPage + ' of ' + totalPages;
    if (elements.orderPrev) elements.orderPrev.disabled = state.orderPage <= 1;
    if (elements.orderNext) elements.orderNext.disabled = state.orderPage >= totalPages;
    renderOrderDetail();
  };
  const loadOrders = async () => {
    const requestSequence = ++orderRequestSequence;
    setStatus('Loading orders', 'busy');
    state.orderError = null;
    try {
      const envelope = await loadJson(ordersUrl());
      if (requestSequence !== orderRequestSequence) return;
      state.ordersPage = envelope.data || { items: [] };
      setStatus('Orders loaded', 'ready');
    } catch (error) {
      if (requestSequence !== orderRequestSequence) return;
      state.ordersPage = { items: [] };
      state.orderError = {
        code: error && error.code ? error.code : 'products_orders_failed',
        message: error instanceof Error ? error.message : String(error),
      };
      setStatus('Orders failed', 'error');
    } finally {
      if (requestSequence === orderRequestSequence) renderOrders();
    }
  };
  const renderOrderDetail = () => {
    if (!elements.orderDetailModal || !elements.orderDetail) return;
    elements.orderDetailModal.hidden = !state.orderInspect;
    elements.orderDetailModal.toggleAttribute('data-modal-open', Boolean(state.orderInspect));
    const model = buildProductCommercePageViewModel({ orderInspect: state.orderInspect }).orderInspect;
    if (!model) {
      elements.orderDetail.innerHTML = '';
      return;
    }
    elements.orderDetail.innerHTML = renderFacts([
      { label: 'Role', value: model.roleLabel },
      { label: 'State', value: model.stateLabel },
      { label: 'Listing pin id', value: model.listingPinId },
      { label: 'SKU id', value: model.skuId },
      { label: 'Selected SKU', value: model.selectedSkuLabel },
      { label: 'Payment txid', value: model.paymentTxid },
      { label: 'Payment verified', value: model.paymentVerificationLabel },
      { label: 'Product-order pin id', value: model.productOrderPinId },
      { label: 'Fulfillment skills', value: model.fulfillmentSkillsLabel },
      { label: 'Trace id', value: model.traceLabel },
      { label: 'Session id', value: model.sessionLabel },
      { label: 'Trace link', value: model.traceUrl },
      { label: 'Delivery pin id', value: model.deliveryPinId },
      { label: 'Delivery summary', value: model.deliverySummaryLabel },
      { label: 'Failure reason', value: model.failureReason },
    ]);
  };
  const inspectOrder = async (selectorValue, selectorKind) => {
    const value = normalizeText(selectorValue || (elements.orderSelector && elements.orderSelector.value));
    if (!value) {
      state.orderError = { code: 'missing_product_order_selector', message: 'Enter an order selector.' };
      renderOrders();
      return;
    }
    setStatus('Inspecting order', 'busy');
    state.orderError = null;
    try {
      const envelope = await loadJson(orderInspectUrl(value, selectorKind));
      state.orderInspect = envelope.data || null;
      setStatus('Order inspected', 'ready');
    } catch (error) {
      state.orderInspect = null;
      state.orderError = {
        code: error && error.code ? error.code : 'products_order_inspect_failed',
        message: error instanceof Error ? error.message : String(error),
      };
      setStatus('Order inspect failed', 'error');
    } finally {
      renderOrders();
    }
  };
  const selectedBuyerLabel = () => {
    const profile = state.profiles.find((item) => normalizeText(item.slug) === state.buyerSlug);
    return normalizeText(profile && (profile.name || profile.displayName || profile.slug)) || state.buyerSlug;
  };
  const buildPreviewRequest = () => {
    const model = buildModel({
      purchaseSelection: {
        listingPinId: state.selectedListingPinId,
        skuId: state.selectedSkuId,
        spendCap: elements.spendCap ? elements.spendCap.value : '',
        comment: elements.comment ? elements.comment.value : '',
      },
    });
    if (!model.purchasePreviewRequest) {
      throw new Error('Purchase preview request could not be built.');
    }
    return {
      from: state.buyerSlug,
      ...model.purchasePreviewRequest,
    };
  };
  const buildCliCommand = () => {
    return 'metabot products buy --from ' + state.buyerSlug + ' --request-file purchase-request.json --json';
  };
  const renderFacts = (items) => (
    '<dl class="products-confirmation-facts">' +
      items.map((item) => (
        '<div><dt>' + escapeHtml(item.label) + '</dt><dd>' + escapeHtml(item.value || 'Not provided') + '</dd></div>'
      )).join('') +
    '</dl>'
  );
  const renderConfirmationModal = () => {
    if (!elements.confirmationModal) return;
    elements.confirmationModal.hidden = !state.purchase.open;
    elements.confirmationModal.toggleAttribute('data-modal-open', state.purchase.open);
    const previewData = readObjectValue(state.purchase.previewEnvelope && state.purchase.previewEnvelope.data);
    const successData = readObjectValue(state.purchase.success && state.purchase.success.data);
    const product = readObjectValue(previewData.product);
    const sku = readObjectValue(previewData.sku);
    const payment = readObjectValue(previewData.payment);
    const seller = readObjectValue(previewData.seller);
    const confirmRequest = readObjectValue(state.purchase.confirmRequest);
    if (elements.confirmationJson) {
      const jsonSource = state.purchase.success || state.purchase.confirmRequest || state.purchase.previewEnvelope || {};
      elements.confirmationJson.textContent = JSON.stringify(jsonSource, null, 2);
    }
    if (elements.confirmationSummary) {
      if (state.purchase.success) {
        elements.confirmationSummary.innerHTML = [
          '<div class="products-success-block">',
            '<h3>Purchase submitted</h3>',
            renderFacts([
              { label: 'Product-order pin id', value: successData.productOrderPinId },
              { label: 'Payment txid', value: successData.paymentTxid },
              { label: 'Order txid', value: successData.orderTxid },
              { label: 'Trace id', value: successData.traceId },
              { label: 'Local UI', value: successData.localUiUrl },
            ]),
          '</div>',
        ].join('');
      } else {
        elements.confirmationSummary.innerHTML = [
          renderFacts([
            { label: 'Buyer actor', value: selectedBuyerLabel() },
            { label: 'Listing pin id', value: normalizeText(product.listingPinId || confirmRequest.listingPinId || state.selectedListingPinId) },
            { label: 'SKU id', value: normalizeText(sku.skuId || confirmRequest.skuId || state.selectedSkuId) },
            { label: 'Amount', value: normalizeText(payment.amount || readObjectValue(confirmRequest.spendCap).amount || (elements.spendCap && elements.spendCap.value)) },
            { label: 'Currency', value: normalizeText(payment.currency || readObjectValue(confirmRequest.spendCap).currency) },
            { label: 'Seller', value: normalizeText(seller.name || seller.globalMetaId) },
            { label: 'CLI equivalent', value: buildCliCommand() },
          ]),
          state.purchase.error ? '<p class="products-blocked">' + escapeHtml(state.purchase.error) + '</p>' : '',
        ].join('');
      }
    }
    if (elements.confirm) {
      elements.confirm.hidden = Boolean(state.purchase.success);
      elements.confirm.disabled = state.purchase.busy;
      elements.confirm.textContent = state.purchase.busy ? 'Paying...' : 'Confirm and pay';
    }
    if (elements.cancelConfirmation) {
      elements.cancelConfirmation.disabled = state.purchase.busy;
      elements.cancelConfirmation.textContent = state.purchase.success ? 'Close' : 'Cancel';
    }
  };
  const openConfirmationModal = (previewEnvelope) => {
    const data = readObjectValue(previewEnvelope && previewEnvelope.data);
    const confirmRequest = readObjectValue(readObjectValue(data.confirmRequest).request);
    state.purchase = {
      open: true,
      busy: false,
      previewEnvelope,
      confirmRequest,
      success: null,
      successSelection: null,
      error: null,
    };
    renderConfirmationModal();
    if (elements.confirm && !elements.confirm.hidden) elements.confirm.focus();
  };
  const closeConfirmationModal = () => {
    if (state.purchase.busy) return;
    state.purchase.open = false;
    renderConfirmationModal();
    if (elements.preview) elements.preview.focus();
  };
  const previewPurchase = async () => {
    syncPurchaseOutcomeToSelection();
    if (state.purchase.success && state.purchase.successSelection === purchaseSelectionKey(currentPurchaseSelection())) {
      renderPurchaseControls();
      return;
    }
    const reason = disabledReason();
    if (reason || state.busy || state.purchase.busy || state.purchase.open) {
      renderPurchaseControls();
      return;
    }
    state.busy = true;
    setStatus('Previewing purchase', 'busy');
    renderPurchaseControls();
    try {
      const envelope = await postJson('/api/products/buy', buildPreviewRequest());
      if (envelope.state !== 'awaiting_confirmation') {
        throw new Error('Purchase preview did not return an awaiting_confirmation envelope.');
      }
      openConfirmationModal(envelope);
      setStatus('Purchase awaits confirmation', 'ready');
    } catch (error) {
      state.marketplaceError = {
        code: error && error.code ? error.code : 'product_purchase_preview_failed',
        message: error instanceof Error ? error.message : String(error),
      };
      setStatus('Purchase preview failed', 'error');
      renderError();
    } finally {
      state.busy = false;
      renderPurchaseControls();
      if (elements.refresh) elements.refresh.disabled = false;
      if (elements.query) elements.query.disabled = false;
    }
  };
  const confirmPurchase = async () => {
    if (!state.purchase.open || state.purchase.busy || state.purchase.success) return;
    state.purchase.busy = true;
    state.purchase.error = null;
    renderConfirmationModal();
    try {
      const request = readObjectValue(state.purchase.confirmRequest);
      const envelope = await postJson('/api/products/buy', {
        from: state.buyerSlug,
        ...request,
        confirmed: true,
      });
      state.purchase.success = envelope;
      state.purchase.successSelection = purchaseSelectionKey(currentPurchaseSelection());
      setStatus('Purchase submitted', 'ready');
    } catch (error) {
      state.purchase.error = error instanceof Error ? error.message : String(error);
      setStatus('Purchase failed', 'error');
    } finally {
      state.purchase.busy = false;
      renderConfirmationModal();
    }
  };
  const renderList = (model) => {
    if (!elements.list) return;
    if (!model.productRows.length) {
      elements.list.innerHTML = '<p class="products-empty">No online products match this query.</p>';
      return;
    }
    elements.list.innerHTML = model.productRows.map((row) => (
      '<button class="products-row" type="button" data-product-row="' + escapeHtml(row.listingPinId) + '" data-selected="' + (row.listingPinId === state.selectedListingPinId ? 'true' : 'false') + '">' +
        '<span class="products-row-main">' +
          '<strong>' + escapeHtml(row.title || row.listingPinId) + '</strong>' +
          '<span>' + escapeHtml(row.sellerLabel) + '</span>' +
        '</span>' +
        '<span class="products-row-meta">' +
          '<span>' + escapeHtml(row.skuCountLabel) + '</span>' +
          '<span>' + escapeHtml(row.firstPriceLabel) + '</span>' +
          '<span data-state="' + escapeHtml(row.onlineStateLabel.toLowerCase()) + '">' + escapeHtml(row.onlineStateLabel) + '</span>' +
        '</span>' +
      '</button>'
    )).join('');
    elements.list.querySelectorAll('[data-product-row]').forEach((row) => {
      row.addEventListener('click', () => {
        state.selectedListingPinId = row.getAttribute('data-product-row');
        state.selectedSkuId = '';
        if (elements.spendCap) elements.spendCap.value = '';
        render();
      });
    });
  };
  const renderDetail = (model) => {
    const product = readObjectValue(selectedProduct());
    const listing = readObjectValue(product.listing);
    const fulfillment = readObjectValue(product.fulfillment || listing.fulfillment);
    const selectedRow = model.selectedProductRow;
    if (!elements.detail || !selectedRow) {
      if (elements.detail) elements.detail.innerHTML = '<p class="products-empty">Select a product to inspect listing details.</p>';
      return;
    }
    elements.detail.innerHTML = [
      '<div class="products-detail-head">',
        '<h3>' + escapeHtml(selectedRow.title || product.listingPinId) + '</h3>',
        '<span data-state="' + escapeHtml(selectedRow.onlineStateLabel.toLowerCase()) + '">' + escapeHtml(selectedRow.onlineStateLabel) + '</span>',
      '</div>',
      '<dl class="products-facts">',
        '<div><dt>Seller</dt><dd>' + escapeHtml(selectedRow.sellerLabel) + '</dd></div>',
        '<div><dt>Listing pin</dt><dd>' + escapeHtml(product.listingPinId) + '</dd></div>',
        '<div><dt>Product type</dt><dd>' + escapeHtml(product.productType || listing.productType || 'Unknown') + '</dd></div>',
        '<div><dt>Fulfillment</dt><dd>' + escapeHtml([fulfillment.fulfillmentType, fulfillment.deliveryEndpoint].filter(Boolean).join(' / ') || 'Unknown') + '</dd></div>',
      '</dl>',
      '<p>' + escapeHtml(product.description || listing.description || 'No description provided.') + '</p>',
      selectedRow.blockedReason ? '<p class="products-blocked">Purchase disabled: ' + escapeHtml(selectedRow.blockedReason) + '</p>' : '',
    ].join('');
  };
  const renderSkus = (model) => {
    if (!elements.skus) return;
    if (!model.selectedSkuRows.length) {
      elements.skus.innerHTML = '<p class="products-empty">No SKUs are available for this listing.</p>';
      return;
    }
    elements.skus.innerHTML = '<table class="products-sku-table"><thead><tr><th>SKU</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>' +
      model.selectedSkuRows.map((sku) => (
        '<tr data-product-sku-choice="' + escapeHtml(sku.skuId) + '" data-selected="' + (sku.skuId === state.selectedSkuId ? 'true' : 'false') + '">' +
          '<td><strong>' + escapeHtml(sku.name || sku.skuId) + '</strong><span>' + escapeHtml(sku.skuId) + '</span></td>' +
          '<td>' + escapeHtml(sku.priceLabel) + '</td>' +
          '<td>' + escapeHtml(sku.stockLabel || 'Unknown') + '</td>' +
          '<td><button type="button" data-product-sku-choice="' + escapeHtml(sku.skuId) + '">Select</button></td>' +
        '</tr>'
      )).join('') +
      '</tbody></table>';
    elements.skus.querySelectorAll('[data-product-sku-choice]').forEach((choice) => {
      choice.addEventListener('click', () => {
        state.selectedSkuId = choice.getAttribute('data-product-sku-choice');
        const sku = selectedSku();
        if (elements.spendCap) elements.spendCap.value = priceAmountForSku(sku);
        render();
      });
    });
  };
  const renderPurchaseControls = () => {
    syncPurchaseOutcomeToSelection();
    const reason = disabledReason();
    const purchaseSubmitted = state.purchase.success && state.purchase.successSelection === purchaseSelectionKey(currentPurchaseSelection());
    if (elements.preview) {
      elements.preview.disabled = Boolean(reason || state.busy || state.purchase.busy || state.purchase.open || purchaseSubmitted);
      elements.preview.setAttribute('data-product-purchase-control', 'preview');
    }
    if (elements.purchaseReason) {
      elements.purchaseReason.textContent = purchaseSubmitted
        ? 'Purchase submitted for this selection.'
        : (reason || 'Preview required before payment.');
    }
  };
  const render = () => {
    syncSelectedDefaults();
    renderBuyerSelect();
    renderSellerSelect();
    renderError();
    let model;
    try {
      model = buildModel();
    } catch (error) {
      state.marketplaceError = { code: 'products_view_model_failed', message: error instanceof Error ? error.message : String(error) };
      renderError();
      return;
    }
    renderList(model);
    renderDetail(model);
    renderSkus(model);
    renderPurchaseControls();
    renderConfirmationModal();
    renderSkillList();
    renderSkuEditor();
    renderSellPreview();
    renderPublishSuccess();
    renderOwnedListings();
    renderOrderActorSelect();
    renderOrders();
    if (elements.refresh) elements.refresh.disabled = state.busy;
    if (elements.query) elements.query.disabled = state.busy;
  };
  const loadProfiles = async () => {
    const envelope = await loadJson('/api/bot/profiles');
    state.profiles = envelope.data && Array.isArray(envelope.data.profiles) ? envelope.data.profiles : [];
    state.profileError = null;
  };
  let orderRequestSequence = 0;
  const loadMarketplace = async () => {
    state.busy = true;
    state.marketplaceError = null;
    setStatus('Loading marketplace', 'busy');
    render();
    try {
      const envelope = await loadJson(marketplaceUrl());
      state.marketplace = envelope.data || { products: [] };
      state.marketplaceError = null;
      setStatus(String(productList().length) + ' listings loaded', 'ready');
    } catch (error) {
      state.marketplace = { products: [] };
      state.marketplaceError = {
        code: error && error.code ? error.code : 'network_products_failed',
        message: error instanceof Error ? error.message : String(error),
      };
      setStatus('Marketplace load failed', 'error');
    } finally {
      state.busy = false;
      render();
    }
  };
  const loadInitial = async () => {
    try {
      await loadProfiles();
    } catch (error) {
      state.profiles = [];
      state.profileError = {
        code: error && error.code ? error.code : 'metabot_profiles_failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    await loadMarketplace();
  };

  const readHashTabName = () => {
    const hash = window.location.hash.replace(/^#/, '');
    return validTabNames.includes(hash) ? hash : 'marketplace';
  };

  const tabIdForName = (name) => 'products-tab-' + name;

  const activate = (name, options) => {
    const nextName = validTabNames.includes(name) ? name : 'marketplace';
    const shouldFocus = !!(options && options.focus);
    tabs.forEach((tab) => {
      const tabName = tab.getAttribute('data-products-tab');
      const isActive = tabName === nextName;
      if (tabName && !tab.id) tab.id = tabIdForName(tabName);
      tab.toggleAttribute('data-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
      tab.setAttribute('role', 'tab');
      if (tabName) tab.setAttribute('aria-controls', tabName);
      if (isActive && shouldFocus) tab.focus();
    });
    panels.forEach((panel) => {
      const panelName = panel.getAttribute('data-products-panel');
      panel.hidden = panelName !== nextName;
      panel.setAttribute('role', 'tabpanel');
      if (panelName) panel.setAttribute('aria-labelledby', tabIdForName(panelName));
    });
    if (nextName === 'sell') enterSellTab();
    if (nextName === 'orders') {
      loadProfiles()
        .catch(() => {})
        .then(() => {
          renderOrderActorSelect();
          return loadOrders();
        });
    }
  };

  const navigateTo = (name, options) => {
    const nextName = validTabNames.includes(name) ? name : 'marketplace';
    const nextHash = '#' + nextName;
    if (window.location.hash === nextHash) {
      activate(nextName, options);
      return;
    }
    window.location.hash = nextName;
    activate(nextName, options);
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      const name = tab.getAttribute('data-products-tab');
      if (!name) return;
      event.preventDefault();
      navigateTo(name);
    });
    tab.addEventListener('keydown', (event) => {
      const currentIndex = tabs.indexOf(tab);
      if (currentIndex < 0) return;
      let nextIndex = currentIndex;
      if (event.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      } else if (event.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % tabs.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      const nextName = tabs[nextIndex].getAttribute('data-products-tab');
      if (nextName) navigateTo(nextName, { focus: true });
    });
  });

  window.addEventListener('hashchange', () => activate(readHashTabName()));
  window.addEventListener('popstate', () => activate(readHashTabName()));
  activate(readHashTabName());
  if (elements.query) {
    state.query = normalizeText(elements.query.value);
    elements.query.addEventListener('input', async () => {
      state.query = normalizeText(elements.query.value);
      state.selectedListingPinId = '';
      state.selectedSkuId = '';
      if (elements.spendCap) elements.spendCap.value = '';
      syncPurchaseOutcomeToSelection();
      await loadMarketplace();
    });
  }
  if (elements.refresh) {
    elements.refresh.addEventListener('click', () => {
      state.query = elements.query ? normalizeText(elements.query.value) : state.query;
      syncPurchaseOutcomeToSelection();
      loadMarketplace();
    });
  }
  if (elements.preview) {
    elements.preview.addEventListener('click', previewPurchase);
  }
  if (elements.confirm) {
    elements.confirm.addEventListener('click', confirmPurchase);
  }
  if (elements.cancelConfirmation) {
    elements.cancelConfirmation.addEventListener('click', closeConfirmationModal);
  }
  const visibleModal = () => document.querySelector('[data-modal-open]:not([hidden])');
  const focusableSelector = [
    'button:not([disabled]):not([hidden])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    'details summary',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const trapModalFocus = (event) => {
    if (event.key !== 'Tab') return;
    const modal = visibleModal();
    if (!modal) return;
    const focusable = Array.from(modal.querySelectorAll(focusableSelector))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
      });
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', (event) => {
    trapModalFocus(event);
    if (event.key === 'Escape') {
      if (state.purchase.open && !state.purchase.busy) {
        closeConfirmationModal();
      } else if (state.sell.publishOpen && !state.sell.publishBusy) {
        closePublishModal();
      } else if (state.orderInspect) {
        state.orderInspect = null;
        renderOrderDetail();
        if (elements.orderInspectButton) elements.orderInspectButton.focus();
      }
    }
  });
  if (elements.buyer) {
    elements.buyer.addEventListener('change', () => {
      state.buyerSlug = normalizeText(elements.buyer.value);
      syncPurchaseOutcomeToSelection();
      render();
    });
  }
  if (elements.seller) {
    elements.seller.addEventListener('change', () => {
      state.sell.sellerSlug = normalizeText(elements.seller.value);
      state.sell.skillsLoadedFor = '';
      state.sell.skillError = null;
      state.sell.publishSuccess = null;
      loadSellerSkills();
    });
  }
  if (elements.ownedRefresh) elements.ownedRefresh.addEventListener('click', () => loadOwnedListings(true));
  if (elements.orderActor) {
    elements.orderActor.addEventListener('change', () => {
      state.orderActorSlug = normalizeText(elements.orderActor.value);
      state.orderPage = 1;
      loadOrders();
    });
  }
  if (elements.orderRole) {
    elements.orderRole.addEventListener('change', () => {
      state.orderRole = elements.orderRole.value || 'buyer';
      state.orderPage = 1;
      loadOrders();
    });
  }
  if (elements.orderState) {
    elements.orderState.addEventListener('change', () => {
      state.orderState = normalizeText(elements.orderState.value);
      state.orderPage = 1;
      loadOrders();
    });
  }
  if (elements.orderPageSize) {
    elements.orderPageSize.addEventListener('change', () => {
      state.orderPageSize = Number(elements.orderPageSize.value) || 20;
      state.orderPage = 1;
      loadOrders();
    });
  }
  if (elements.orderRefresh) elements.orderRefresh.addEventListener('click', loadOrders);
  if (elements.orderInspectButton) elements.orderInspectButton.addEventListener('click', () => inspectOrder());
  if (elements.orderPrev) {
    elements.orderPrev.addEventListener('click', () => {
      if (state.orderPage > 1) {
        state.orderPage -= 1;
        loadOrders();
      }
    });
  }
  if (elements.orderNext) {
    elements.orderNext.addEventListener('click', () => {
      state.orderPage += 1;
      loadOrders();
    });
  }
  if (elements.orderDetailClose) {
    elements.orderDetailClose.addEventListener('click', () => {
      state.orderInspect = null;
      renderOrderDetail();
      if (elements.orderInspectButton) elements.orderInspectButton.focus();
    });
  }
  [
    elements.listingName,
    elements.listingTitle,
    elements.coverImage,
    elements.galleryImages,
    elements.descriptionContentType,
    elements.description,
    elements.estimatedDeliverySeconds,
    elements.deliverableDescription,
    elements.network,
  ].forEach((input) => {
    if (input) {
      input.addEventListener('input', renderSellPreview);
      input.addEventListener('change', renderSellPreview);
    }
  });
  if (elements.addSku) {
    elements.addSku.addEventListener('click', () => {
      state.sell.form.skus.push({
        skuId: '',
        name: '',
        image: '',
        descriptionContentType: 'text/markdown',
        description: '',
        price: { amount: '', currency: 'SPACE' },
        initialStock: '',
      });
      renderSkuEditor();
      renderSellPreview();
    });
  }
  if (elements.publish) elements.publish.addEventListener('click', openPublishModal);
  if (elements.confirmPublish) elements.confirmPublish.addEventListener('click', confirmPublish);
  if (elements.cancelPublish) elements.cancelPublish.addEventListener('click', closePublishModal);
  [elements.spendCap, elements.comment].forEach((input) => {
    if (input) input.addEventListener('input', () => {
      syncPurchaseOutcomeToSelection();
      renderPurchaseControls();
      renderConfirmationModal();
    });
  });
  loadInitial();
})();`;
}
