import type { LocalUiPageDefinition } from '../types';
import { buildProductCommercePageViewModelRuntimeSource } from './viewModel';

export function buildProductsPageDefinition(): LocalUiPageDefinition {
  const buildProductCommercePageViewModelSource = buildProductCommercePageViewModelRuntimeSource();
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
              <span>Publisher</span>
            </div>
            <p>Prepare seller listings and validate fulfillment skills before publication.</p>
          </section>

          <section id="orders" class="products-panel" data-products-panel="orders" role="tabpanel" aria-labelledby="products-tab-orders" hidden>
            <div class="products-panel-header">
              <h2>Orders</h2>
              <span>Activity</span>
            </div>
            <p>Inspect buyer and seller order state from the local Product Commerce cache.</p>
          </section>
        </section>
      </section>
    `,
    script: `(() => {
  ${buildProductCommercePageViewModelSource}
  ${buildProductsPageScript()}
})();`,
  };
}

export function buildProductsPageScript(): string {
  return `(() => {
  const state = {
    profiles: [],
    marketplace: null,
    marketplaceError: null,
    selectedListingPinId: '',
    selectedSkuId: '',
    buyerSlug: '',
    query: '',
    busy: false,
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
    error: document.querySelector('[data-products-error]'),
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
    const error = state.marketplaceError;
    elements.error.textContent = error ? [error.code, error.message].filter(Boolean).join(': ') : '';
    elements.error.hidden = !error;
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
  const buildModel = () => buildProductCommercePageViewModel({
    products: productList(),
    selectedListing: selectedProduct() || {},
    selectedSku: { skus: selectedSkus() },
  });
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
    const reason = disabledReason();
    const previewUnavailableReason = 'Preview purchase is not wired yet.';
    if (elements.preview) {
      elements.preview.disabled = true;
      elements.preview.setAttribute('data-product-purchase-control', 'preview');
    }
    if (elements.purchaseReason) {
      elements.purchaseReason.textContent = reason || previewUnavailableReason;
    }
  };
  const render = () => {
    syncSelectedDefaults();
    renderBuyerSelect();
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
    if (elements.refresh) elements.refresh.disabled = state.busy;
    if (elements.query) elements.query.disabled = state.busy;
  };
  const loadProfiles = async () => {
    const envelope = await loadJson('/api/bot/profiles');
    state.profiles = envelope.data && Array.isArray(envelope.data.profiles) ? envelope.data.profiles : [];
  };
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
      state.marketplaceError = {
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
  };

  const navigateTo = (name, options) => {
    const nextName = validTabNames.includes(name) ? name : 'marketplace';
    const nextHash = '#' + nextName;
    if (window.location.hash === nextHash) {
      activate(nextName, options);
      return;
    }
    window.location.hash = nextName;
    if (options && options.focus) {
      activate(nextName, options);
    }
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
      await loadMarketplace();
    });
  }
  if (elements.refresh) {
    elements.refresh.addEventListener('click', () => {
      state.query = elements.query ? normalizeText(elements.query.value) : state.query;
      loadMarketplace();
    });
  }
  if (elements.buyer) {
    elements.buyer.addEventListener('change', () => {
      state.buyerSlug = normalizeText(elements.buyer.value);
      render();
    });
  }
  [elements.spendCap, elements.comment].forEach((input) => {
    if (input) input.addEventListener('input', renderPurchaseControls);
  });
  loadInitial();
})();`;
}
