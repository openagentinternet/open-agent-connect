"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHubPageDefinition = buildHubPageDefinition;
const viewModel_1 = require("./viewModel");
function buildHubPageDefinition() {
    const buildHubServiceDirectoryViewModelSource = viewModel_1.buildHubServiceDirectoryViewModel.toString();
    return {
        page: 'hub',
        title: 'Agent Hub',
        eyebrow: 'Yellow Pages',
        heading: 'Browse online MetaBot services',
        description: 'A local-only view of discoverable MetaBot services, sorted for humans while the daemon stays machine-first.',
        panels: [
            {
                title: 'Online-first service listing',
                body: 'Mirror the GigSquare yellow-pages feeling: online bots first, then high-usage services.',
                items: [
                    'Show online availability at a glance',
                    'Highlight provider globalMetaId and service pin id',
                    'Keep service descriptions compact and scannable',
                ],
            },
            {
                title: 'Natural-language invocation',
                body: 'Humans browse here, but the real call path is still agent-to-agent over MetaWeb.',
                actionLabel: 'Open services API',
                actionHref: '/api/network/services?online=true',
            },
            {
                title: 'Traceable by design',
                body: 'Every successful remote call should lead to a trace page, not a hidden local side effect.',
            },
        ],
        script: `(() => {
  const buildHubServiceDirectoryViewModel = ${buildHubServiceDirectoryViewModelSource};
  const elements = {
    onlineCount: document.querySelector('[data-online-count]'),
    topService: document.querySelector('[data-top-service]'),
    directoryMode: document.querySelector('[data-directory-mode]'),
    directory: document.querySelector('[data-service-directory]'),
    serviceList: document.querySelector('[data-service-list]'),
    emptyState: document.querySelector('[data-directory-empty]'),
    emptyTitle: document.querySelector('[data-directory-empty-title]'),
    emptyBody: document.querySelector('[data-directory-empty-body]'),
    updatedAt: document.querySelector('[data-directory-updated]'),
  };

  const setText = (element, value) => {
    if (!element) return;
    element.textContent = value;
  };

  const clearChildren = (element) => {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  };

  const formatTime = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return 'unknown';
    }
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  };

  const appendMetaRow = (target, label, value) => {
    if (!target || !value) return;
    const row = document.createElement('div');
    row.className = 'service-meta-row';
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    row.appendChild(term);
    row.appendChild(description);
    target.appendChild(row);
  };

  const renderDirectory = (payload) => {
    const services = Array.isArray(payload && payload.data && payload.data.services)
      ? payload.data.services
      : [];
    const model = buildHubServiceDirectoryViewModel({ services });

    setText(elements.onlineCount, model.countLabel);
    setText(elements.directoryMode, 'chain-backed yellow pages');
    clearChildren(elements.serviceList);

    if (!model.entries.length) {
      if (elements.emptyState) {
        elements.emptyState.hidden = false;
      }
      setText(elements.topService, 'none visible');
      setText(elements.emptyTitle, model.emptyTitle);
      setText(elements.emptyBody, model.emptyBody);
      setText(elements.updatedAt, 'Directory checked just now.');
      return;
    }

    if (elements.emptyState) {
      elements.emptyState.hidden = true;
    }

    const topEntry = model.entries[0];
    setText(elements.topService, topEntry.displayName);
    setText(elements.updatedAt, 'Last refreshed ' + formatTime(Date.now()));

    model.entries.forEach((entry) => {
      if (!elements.serviceList) return;
      const card = document.createElement('article');
      card.className = 'service-card';

      const header = document.createElement('div');
      header.className = 'service-card-header';

      const titleBlock = document.createElement('div');
      titleBlock.className = 'service-card-title';
      const title = document.createElement('h2');
      title.textContent = entry.displayName;
      const capability = document.createElement('p');
      capability.className = 'service-capability';
      capability.textContent = entry.capabilityLabel;
      titleBlock.appendChild(title);
      titleBlock.appendChild(capability);

      const status = document.createElement('span');
      status.className = 'service-status service-status-' + entry.statusTone;
      status.textContent = entry.statusLabel;

      header.appendChild(titleBlock);
      header.appendChild(status);
      card.appendChild(header);

      const description = document.createElement('p');
      description.className = 'service-description';
      description.textContent = entry.description;
      card.appendChild(description);

      const meta = document.createElement('dl');
      meta.className = 'service-meta';
      appendMetaRow(meta, 'Provider', entry.providerLabel);
      appendMetaRow(meta, 'Service Pin', entry.servicePinId || 'not published');
      appendMetaRow(meta, 'Price', entry.priceLabel);
      appendMetaRow(meta, 'Skill', entry.capabilityLabel);
      appendMetaRow(meta, 'Last Seen', entry.lastSeenAtMs ? formatTime(entry.lastSeenAtMs) : 'not observed');
      appendMetaRow(meta, 'Updated', entry.updatedAtMs ? formatTime(entry.updatedAtMs) : 'not published');
      card.appendChild(meta);

      elements.serviceList.appendChild(card);
    });
  };

  fetch('/api/network/services?online=true', { cache: 'no-store' })
    .then((response) => response.json())
    .then((payload) => {
      renderDirectory(payload);
    })
    .catch(() => {
      setText(elements.onlineCount, '0');
      setText(elements.topService, 'load failed');
      setText(elements.directoryMode, 'directory unavailable');
      if (elements.emptyState) {
        elements.emptyState.hidden = false;
      }
      setText(elements.emptyTitle, 'Directory load failed');
      setText(elements.emptyBody, 'The local daemon could not load online services right now. Keep the page open and try again after the daemon reconnects.');
      setText(elements.updatedAt, 'No successful refresh yet.');
    });
})();`,
    };
}
