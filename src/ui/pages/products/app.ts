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
          <span class="products-status">Read-only preview</span>
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
              <span>Directory</span>
            </div>
            <p>Browse Product Commerce listings and inspect virtual goods before purchase.</p>
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
  const tabs = Array.from(document.querySelectorAll('[data-products-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-products-panel]'));
  const validTabNames = tabs
    .map((tab) => tab.getAttribute('data-products-tab'))
    .filter(Boolean);

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
})();`;
}
