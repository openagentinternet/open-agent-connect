import type { LocalUiPageDefinition } from '../types';
import { buildHubServiceDirectoryViewModel } from './viewModel';

export function buildHubPageDefinition(): LocalUiPageDefinition {
  const buildHubServiceDirectoryViewModelSource = buildHubServiceDirectoryViewModel.toString();
  return {
    page: 'hub',
    title: 'MetaBot Service Hub',
    eyebrow: 'Service Hub',
    heading: 'Online MetaBot Services',
    description: 'Live directory of online MetaBot services on MetaWeb.',
    panels: [],
    script: `(() => {
  const buildHubServiceDirectoryViewModel = ${buildHubServiceDirectoryViewModelSource};

  const $ = (sel) => document.querySelector(sel);
  const setText = (el, v) => { if (el) el.textContent = v; };
  const modalBackdrop = $('[data-svc-get-modal-backdrop]');
  const modal = $('[data-svc-get-modal]');
  const modalPrompt = $('[data-svc-get-prompt]');
  const copyBtn = $('[data-svc-copy-btn]');
  const closeBtn = $('[data-svc-close-btn]');
  let currentPromptText = '';

  const formatAgo = (agoSec) => {
    if (typeof agoSec !== 'number') return null;
    if (agoSec < 60) return agoSec + 's ago';
    if (agoSec < 3600) return Math.floor(agoSec / 60) + 'm ago';
    return Math.floor(agoSec / 3600) + 'h ago';
  };

  const formatTime = (ms) => {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
    try { return new Date(ms).toLocaleString(); } catch { return null; }
  };

  const closeModal = () => {
    if (modalBackdrop) modalBackdrop.hidden = true;
  };

  const openGetServiceModal = (serviceName) => {
    const cleanName = String(serviceName || 'Unknown Service');
    currentPromptText = 'Please request execution of remote service: ' + cleanName;
    if (modalPrompt) {
      modalPrompt.value = currentPromptText;
      modalPrompt.focus();
      modalPrompt.select();
    }
    if (modalBackdrop) modalBackdrop.hidden = false;
  };

  const renderTable = (payload) => {
    const services = Array.isArray(payload && payload.data && payload.data.services)
      ? payload.data.services : [];
    const model = buildHubServiceDirectoryViewModel({ services });

    const onlineCount = model.entries.filter(e => e.statusTone === 'online').length;
    setText($('[data-online-count]'), String(onlineCount));
    setText($('[data-total-count]'), String(model.entries.length));
    setText($('[data-top-service]'), model.entries[0]?.displayName || '—');
    setText($('[data-directory-mode]'), payload?.data?.discoverySource || 'chain');
    setText($('[data-online-badge]'), onlineCount + ' online');
    setText($('[data-directory-updated]'), 'updated ' + new Date().toLocaleTimeString());

    const tbody = $('[data-service-list]');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!model.entries.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7" class="table-empty"><strong>' + model.emptyTitle + '</strong>' + model.emptyBody + '</td>';
      tbody.appendChild(tr);
      return;
    }

    model.entries.forEach((entry) => {
      const tr = document.createElement('tr');

      // Service name + description
      const tdSvc = document.createElement('td');
      const nameDiv = document.createElement('div');
      nameDiv.className = 'svc-name';
      nameDiv.textContent = entry.displayName;
      const descDiv = document.createElement('div');
      descDiv.className = 'svc-desc';
      descDiv.textContent = entry.description;
      tdSvc.appendChild(nameDiv);
      tdSvc.appendChild(descDiv);

      // Provider
      const tdProv = document.createElement('td');
      if (entry.providerName) {
        const nameDiv2 = document.createElement('div');
        nameDiv2.className = 'svc-provider-name';
        nameDiv2.textContent = entry.providerName;
        tdProv.appendChild(nameDiv2);
      }
      const gmidDiv = document.createElement('div');
      gmidDiv.className = 'svc-provider-gmid';
      gmidDiv.textContent = entry.providerGmid || entry.providerLabel;
      tdProv.appendChild(gmidDiv);

      // Price
      const tdPrice = document.createElement('td');
      tdPrice.className = 'svc-price';
      tdPrice.textContent = entry.priceLabel;

      // Skill
      const tdSkill = document.createElement('td');
      const skillSpan = document.createElement('span');
      skillSpan.className = 'svc-skill';
      skillSpan.textContent = entry.capabilityLabel;
      tdSkill.appendChild(skillSpan);

      // Status
      const tdStatus = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = 'status-pill status-' + entry.statusTone;
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      pill.appendChild(dot);
      pill.appendChild(document.createTextNode(entry.statusLabel));
      tdStatus.appendChild(pill);

      // Last seen
      const tdSeen = document.createElement('td');
      tdSeen.className = 'last-seen';
      const agoSec = typeof entry.lastSeenAgoSeconds === 'number' ? entry.lastSeenAgoSeconds : null;
      tdSeen.textContent = agoSec != null ? formatAgo(agoSec) : (entry.lastSeenAtMs ? formatTime(entry.lastSeenAtMs) : '—');

      // Action
      const tdAction = document.createElement('td');
      tdAction.className = 'svc-action';
      const actionBtn = document.createElement('button');
      actionBtn.className = 'btn btn-sm';
      actionBtn.type = 'button';
      actionBtn.textContent = 'Get Service';
      actionBtn.addEventListener('click', () => openGetServiceModal(entry.displayName));
      tdAction.appendChild(actionBtn);

      tr.appendChild(tdSvc);
      tr.appendChild(tdProv);
      tr.appendChild(tdPrice);
      tr.appendChild(tdSkill);
      tr.appendChild(tdStatus);
      tr.appendChild(tdSeen);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    });
  };

  const load = () => {
    fetch('/api/network/services?online=true', { cache: 'no-store' })
      .then(r => r.json())
      .then(renderTable)
      .catch(() => {
        const tbody = $('[data-service-list]');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="table-empty"><strong>Load failed</strong>Could not reach the local daemon. Is it running?</td></tr>';
        setText($('[data-online-count]'), '0');
        setText($('[data-total-count]'), '0');
        setText($('[data-directory-updated]'), 'failed ' + new Date().toLocaleTimeString());
      });
  };

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', load);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (modalBackdrop) modalBackdrop.addEventListener('click', (event) => {
    if (event.target === modalBackdrop) closeModal();
  });
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    if (!currentPromptText) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(currentPromptText);
      } else if (modalPrompt) {
        modalPrompt.focus();
        modalPrompt.select();
        document.execCommand('copy');
      }
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
    } catch {
      if (modalPrompt) {
        modalPrompt.focus();
        modalPrompt.select();
      }
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  load();
})();`,
  };
}
