import type { LocalUiPageDefinition } from '../types';

export function buildProductsPageDefinition(): LocalUiPageDefinition {
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
          <span class="products-status">Read-only preview</span>
        </header>

        <nav class="products-tabs" aria-label="Product workspace tabs">
          <a href="#marketplace" data-products-tab="marketplace" data-active="true">Marketplace</a>
          <a href="#sell" data-products-tab="sell">Sell</a>
          <a href="#orders" data-products-tab="orders">Orders</a>
        </nav>

        <section class="products-workspace" aria-label="Product commerce workspace">
          <section id="marketplace" class="products-panel" data-products-panel="marketplace">
            <div class="products-panel-header">
              <h2>Marketplace</h2>
              <span>Directory</span>
            </div>
            <p>Browse Product Commerce listings and inspect virtual goods before purchase.</p>
          </section>

          <section id="sell" class="products-panel" data-products-panel="sell" hidden>
            <div class="products-panel-header">
              <h2>Sell</h2>
              <span>Publisher</span>
            </div>
            <p>Prepare seller listings and validate fulfillment skills before publication.</p>
          </section>

          <section id="orders" class="products-panel" data-products-panel="orders" hidden>
            <div class="products-panel-header">
              <h2>Orders</h2>
              <span>Activity</span>
            </div>
            <p>Inspect buyer and seller order state from the local Product Commerce cache.</p>
          </section>
        </section>
      </section>
    `,
    script: buildProductsPageScript(),
  };
}

export function buildProductsPageScript(): string {
  return `(() => {
  const tabs = Array.from(document.querySelectorAll('[data-products-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-products-panel]'));

  const activate = (name) => {
    tabs.forEach((tab) => {
      const isActive = tab.getAttribute('data-products-tab') === name;
      tab.toggleAttribute('data-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panels.forEach((panel) => {
      panel.hidden = panel.getAttribute('data-products-panel') !== name;
    });
  };

  tabs.forEach((tab) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', tab.hasAttribute('data-active') ? 'true' : 'false');
    tab.addEventListener('click', (event) => {
      const name = tab.getAttribute('data-products-tab');
      if (!name) return;
      event.preventDefault();
      activate(name);
      history.replaceState(null, '', '#' + name);
    });
  });
})();`;
}
