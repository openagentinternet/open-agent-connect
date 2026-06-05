"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRefundPageDefinition = buildRefundPageDefinition;
function buildRefundPageDefinition() {
    return {
        page: 'refund',
        title: 'Refund Operations',
        eyebrow: 'Refund Ledger',
        heading: 'Buyer and seller refund operations from local runtime state',
        description: 'Inspect refund requests initiated by this MetaBot and refund requests received by this MetaBot as a provider.',
        panels: [
            {
                title: 'Refunds for my action',
                body: 'Shows provider-side refund work that this local MetaBot can process or has already finalized.',
            },
            {
                title: 'Refunds I Initiated',
                body: 'Shows refund requests this local MetaBot created after buyer-side timeout, invalid delivery, or failed artifact validation.',
            },
            {
                title: 'Manual settlement',
                body: 'Seller rows expose settlement actions only when the local order state says a refund still requires operator handling.',
            },
        ],
        contentHtml: `
      <section class="refund-shell" data-refund-shell>
        <article class="refund-card refund-summary">
          <div class="refund-header">
            <div>
              <div class="refund-eyebrow">Refund Operations</div>
              <h2>Local refund work queue</h2>
            </div>
            <div class="refund-toolbar">
              <button type="button" class="refund-refresh" data-refund-refresh>Refresh</button>
              <span class="refund-status" data-refund-status>Loading refunds...</span>
            </div>
          </div>
          <div class="refund-sync-status" data-refund-sync-status>Sync has not run yet.</div>
          <div class="refund-manual-alert" data-refund-manual-alert hidden></div>
          <div class="refund-summary-grid">
            <div class="refund-summary-item">
              <div class="refund-summary-label">Total</div>
              <div class="refund-summary-value" data-refund-total-count>0</div>
            </div>
            <div class="refund-summary-item">
              <div class="refund-summary-label">Pending</div>
              <div class="refund-summary-value" data-refund-pending-count>0</div>
            </div>
            <div class="refund-summary-item">
              <div class="refund-summary-label">Manual</div>
              <div class="refund-summary-value" data-refund-manual-count>0</div>
            </div>
            <div class="refund-summary-item">
              <div class="refund-summary-label">Blocked</div>
              <div class="refund-summary-value" data-refund-blocked-count>0</div>
            </div>
            <div class="refund-summary-item">
              <div class="refund-summary-label">Completed</div>
              <div class="refund-summary-value" data-refund-completed-count>0</div>
            </div>
          </div>
        </article>

        <div class="refund-tabs" role="tablist" aria-label="Refund queues">
          <button type="button" class="refund-tab" role="tab" aria-controls="seller-refunds" data-refund-tab="action">
            <span>Refunds for my action</span>
            <span class="refund-tab-count" data-refund-action-tab-count>0</span>
          </button>
          <button type="button" class="refund-tab" role="tab" aria-controls="buyer-refunds" data-refund-tab="initiated">
            <span>Refunds I Initiated</span>
            <span class="refund-tab-count" data-refund-initiated-tab-count>0</span>
          </button>
        </div>

        <section class="refund-panels">
          <article class="refund-card refund-panel" id="seller-refunds" role="tabpanel" data-refund-panel="action">
            <div class="refund-section-header">
              <div>
                <div class="refund-eyebrow">Provider side</div>
                <h2>Refunds for my action</h2>
              </div>
              <span class="refund-section-count" data-refund-seller-count>0</span>
            </div>
            <div class="refund-list" data-refund-seller-list></div>
          </article>

          <article class="refund-card refund-panel" id="buyer-refunds" role="tabpanel" data-refund-panel="initiated" hidden>
            <div class="refund-section-header">
              <div>
                <div class="refund-eyebrow">Buyer initiated</div>
                <h2>Refunds I Initiated</h2>
              </div>
              <span class="refund-section-count" data-refund-buyer-count>0</span>
            </div>
            <div class="refund-list" data-refund-buyer-list></div>
          </article>
        </section>
      </section>
    `,
        script: `(() => {
  const elements = {
    status: document.querySelector('[data-refund-status]'),
    totalCount: document.querySelector('[data-refund-total-count]'),
    pendingCount: document.querySelector('[data-refund-pending-count]'),
    manualCount: document.querySelector('[data-refund-manual-count]'),
    blockedCount: document.querySelector('[data-refund-blocked-count]'),
    completedCount: document.querySelector('[data-refund-completed-count]'),
    buyerCount: document.querySelector('[data-refund-buyer-count]'),
    sellerCount: document.querySelector('[data-refund-seller-count]'),
    buyerList: document.querySelector('[data-refund-buyer-list]'),
    sellerList: document.querySelector('[data-refund-seller-list]'),
    syncStatus: document.querySelector('[data-refund-sync-status]'),
    manualAlert: document.querySelector('[data-refund-manual-alert]'),
    refresh: document.querySelector('[data-refund-refresh]'),
    actionTabCount: document.querySelector('[data-refund-action-tab-count]'),
    initiatedTabCount: document.querySelector('[data-refund-initiated-tab-count]'),
    tabs: Array.from(document.querySelectorAll('[data-refund-tab]')),
    panels: Array.from(document.querySelectorAll('[data-refund-panel]')),
  };
  const profileCache = new Map();
  let lastSyncSucceeded = false;
  let activeRefundTab = 'action';

  const setText = (target, value) => {
    if (target) target.textContent = value;
  };

  const setStatus = (value, tone) => {
    if (!elements.status) return;
    elements.status.textContent = value;
    elements.status.dataset.tone = tone || 'neutral';
  };

  const setSyncStatus = (value, tone) => {
    if (!elements.syncStatus) return;
    elements.syncStatus.textContent = value;
    elements.syncStatus.dataset.tone = tone || 'neutral';
  };

  const getFocusedOrderId = () => {
    try {
      return String(new URLSearchParams(window.location.search).get('orderId') || '').trim();
    } catch {
      return '';
    }
  };

  const activateRefundTab = (requestedTab) => {
    const nextTab = requestedTab === 'initiated' ? 'initiated' : 'action';
    activeRefundTab = nextTab;
    elements.tabs.forEach((tab) => {
      const isActive = tab.getAttribute('data-refund-tab') === nextTab;
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.dataset.active = isActive ? 'true' : 'false';
    });
    elements.panels.forEach((panel) => {
      panel.hidden = panel.getAttribute('data-refund-panel') !== nextTab;
    });
  };

  const escHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const formatDate = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return '—';
    const date = new Date(parsed);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
  };

  const getInitialsAvatar = (name, gmid) => {
    const text = name || gmid || '?';
    const char = text.charAt(0).toUpperCase();
    const hue = Math.abs(text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % 360;
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">' +
      '<circle cx="18" cy="18" r="18" fill="hsl(' + hue + ',55%,45%)"/>' +
      '<text x="18" y="23" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="14" font-weight="600" fill="#fff">' + char + '</text>' +
      '</svg>'
    );
  };

  const normalizeAvatarUrl = (rawAvatar) => {
    if (!rawAvatar) return '';
    if (rawAvatar === '/content/' || rawAvatar === 'content/' || rawAvatar.endsWith('/content/')) return '';
    if (rawAvatar.startsWith('http') || rawAvatar.startsWith('data:')) return rawAvatar;
    if (rawAvatar.startsWith('/')) return 'https://file.metaid.io' + rawAvatar;
    if (/^[0-9a-f]{64}i\\d+$/i.test(rawAvatar)) return 'https://file.metaid.io/content/' + rawAvatar;
    if (/^[0-9a-f]{64}$/i.test(rawAvatar)) return 'https://file.metaid.io/metafile-indexer/api/v1/files/content/' + rawAvatar;
    return '';
  };

  const resolveProfile = async (gmid) => {
    if (!gmid) return { name: '', avatar: '' };
    if (profileCache.has(gmid)) {
      const cached = profileCache.get(gmid);
      if (cached.fetching) await cached.fetching;
      return {
        name: cached.name || gmid,
        avatar: cached.avatar || getInitialsAvatar(cached.name, gmid),
      };
    }

    let resolveFn;
    const fetchPromise = new Promise((resolve) => { resolveFn = resolve; });
    profileCache.set(gmid, { name: '', avatar: '', fetching: fetchPromise });
    let name = '';
    let avatarUrl = '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const resp = await fetch('https://file.metaid.io/metafile-indexer/api/v1/info/globalmetaid/' + encodeURIComponent(gmid), {
        signal: controller.signal,
      });
      if (resp.ok) {
        const json = await resp.json();
        const data = json && (json.data || json) || {};
        name = String(data.name || data.showName || data.nickname || '').trim();
        avatarUrl = normalizeAvatarUrl(String(data.avatar || data.avatarUrl || data.avatarId || '').trim());
      }
    } catch { /* ignore */ }
    clearTimeout(timeout);
    profileCache.set(gmid, { name, avatar: avatarUrl, fetching: null });
    resolveFn();
    return { name: name || gmid, avatar: avatarUrl || getInitialsAvatar(name, gmid) };
  };

  const isUnsupportedBlocker = (item) => {
    const blocker = String((item && (item.blockingReason || item.failureReason)) || '').trim();
    return blocker === 'refund_settlement_unsupported';
  };

  const isZeroAmount = (value) => {
    const text = String(value || '').trim();
    if (!text) return false;
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric === 0;
  };

  const isBlockedRefund = (item) => Boolean(item && (item.status === 'failed' || item.blockingReason || isUnsupportedBlocker(item)));

  const needsManualRefundWork = (item, role) => (
    role === 'seller'
    && item
    && item.role === 'seller'
    && item.status !== 'refunded'
    && !isUnsupportedBlocker(item)
    && (
      item.manualActionRequired === true
      || (
        item.status === 'failed'
        && String(item.paymentTxid || '').trim()
        && !isZeroAmount(item.paymentAmount)
      )
      || (
        item.status === 'refund_pending'
        && String(item.refundRequestPinId || '').trim()
      )
    )
  );

  const canProcessRefund = (item, role) => (
    needsManualRefundWork(item, role)
    && !isUnsupportedBlocker(item)
  );

  const updateManualAlert = (manualCount, processableCount, waitingRequestCount) => {
    if (!elements.manualAlert) return;
    if (!manualCount) {
      elements.manualAlert.hidden = true;
      elements.manualAlert.innerHTML = '';
      return;
    }
    elements.manualAlert.hidden = false;
    elements.manualAlert.dataset.tone = 'manual';
    const noun = manualCount === 1 ? 'seller refund needs' : 'seller refunds need';
    const detail = processableCount
      ? String(processableCount) + ' ready to process'
      : waitingRequestCount
        ? String(waitingRequestCount) + ' waiting for refund request proof'
        : 'review the seller refund queue';
    elements.manualAlert.innerHTML =
      '<div class="refund-manual-alert-copy">'
      + '<strong>' + manualCount + ' ' + noun + ' operator attention.</strong>'
      + '<span>' + escHtml(detail) + '</span>'
      + '</div>'
      + '<button type="button" class="refund-manual-alert-action" data-refund-tab-jump="action">Process seller refunds</button>';
    elements.manualAlert.querySelectorAll('[data-refund-tab-jump]').forEach((button) => {
      button.addEventListener('click', () => activateRefundTab(button.getAttribute('data-refund-tab-jump') || 'action'));
    });
  };

  const buildStatusBadge = (item, role) => {
    const status = item && item.status;
    const blocked = isBlockedRefund(item);
    const manual = needsManualRefundWork(item, role);
    const tone = status === 'refunded' ? 'refunded' : manual ? 'manual' : blocked ? 'failed' : 'pending';
    const label = status === 'refunded'
      ? 'Refunded'
      : role === 'buyer' && status === 'refund_pending'
        ? 'Waiting for provider'
        : manual
          ? 'Action required'
          : blocked
            ? 'Blocked'
            : 'Pending';
    return '<span class="refund-badge" data-tone="' + tone + '">' + label + '</span>';
  };

  const field = (label, value, wide) => (
    '<div class="refund-field' + (wide ? ' refund-field-wide' : '') + '">'
    + '<div class="refund-label">' + escHtml(label) + '</div>'
    + '<div class="refund-value mono-text">' + escHtml(value || '—') + '</div>'
    + '</div>'
  );

  const renderRefundRows = async (target, items, emptyText, role) => {
    if (!target) return;
    if (!items.length) {
      target.innerHTML = '<p class="refund-empty">' + escHtml(emptyText) + '</p>';
      return;
    }
    const rows = await Promise.all(items.map(async (item) => {
      const gmid = String(item.counterpartyGlobalMetaId || '').trim();
      const providedName = String(item.counterpartyName || '').trim();
      const profile = providedName ? { name: providedName, avatar: '' } : await resolveProfile(gmid);
      const displayName = String(providedName || profile.name || gmid || 'Unknown').trim() || 'Unknown';
      const avatarSrc = profile.avatar || getInitialsAvatar(displayName, gmid);
      const amountLabel = [item.paymentAmount, item.paymentCurrency].filter(Boolean).join(' ') || '—';
      const blockingReason = String(item.blockingReason || '').trim();
      const failureReason = String(item.failureReason || '').trim();
      const manualWork = needsManualRefundWork(item, role);
      const processable = canProcessRefund(item, role);
      const providerStatus = item.status === 'refunded'
        ? 'Finalized'
        : role === 'buyer' && item.status === 'refund_pending'
          ? 'Waiting for provider refund'
        : processable
          ? 'Ready to process'
          : manualWork
            ? String(item.refundRequestPinId || '').trim()
              ? 'Needs operator attention'
              : 'Needs refund request proof'
          : blockingReason
            ? 'Blocked'
            : 'Waiting';
      const statusFieldLabel = role === 'buyer' ? 'Refund status' : 'Provider status';
      const buyerWaitingNote = role === 'buyer' && item.status === 'refund_pending' && !blockingReason
        ? '<div class="refund-note">Waiting for the provider to process this refund request.</div>'
        : '';
      const traceHref = String(item.traceHref || '').trim();
      const traceLink = traceHref
        ? '<a class="refund-trace-link" href="' + escHtml(traceHref) + '">Open trace</a>'
        : '';
      const localMetabotSlug = String(item.localMetabotSlug || '').trim();
      const settleButton = processable
        ? '<button type="button" class="refund-action" data-settle-refund="' + escHtml(item.orderId) + '" data-refund-from="' + escHtml(localMetabotSlug) + '">Process refund</button>'
        : '';
      const focused = getFocusedOrderId() && String(item.orderId || '').trim() === getFocusedOrderId();
      return ''
        + '<article class="refund-item' + (manualWork ? ' refund-item-manual' : '') + (focused ? ' refund-item-focus' : '') + '" data-refund-order-id="' + escHtml(item.orderId) + '">'
        + '  <div class="refund-item-top">'
        + '    <div class="refund-counterparty">'
        + '      <img class="refund-avatar" src="' + escHtml(avatarSrc) + '" alt="" loading="lazy" />'
        + '      <div class="refund-counterparty-meta">'
        + '        <div class="refund-counterparty-name">' + escHtml(displayName) + '</div>'
        + '        <div class="mono-text">' + escHtml(gmid || 'unknown-global-metaid') + '</div>'
        + '      </div>'
        + '    </div>'
        +      buildStatusBadge(item, role)
        + '  </div>'
        + '  <div class="refund-grid">'
        +      field('Service', item.serviceName || 'Unknown service', false)
        +      field('Amount', amountLabel, false)
        +      field('Order created', formatDate(item.createdAt), false)
        +      field('Requested at', formatDate(item.refundRequestedAt), false)
        +      field(statusFieldLabel, providerStatus, false)
        +      field('Failure reason', failureReason, true)
        +      field('Payment Txid', item.paymentTxid, true)
        +      field('Refund request', item.refundRequestPinId, true)
        +      field('Refund txid', item.refundTxid, true)
        +      field('Finalization pin', item.refundFinalizePinId, true)
        +      field('Refunded at', formatDate(item.refundCompletedAt), false)
        + '  </div>'
        + (blockingReason ? '<div class="refund-note">Blocking reason: ' + escHtml(blockingReason) + '</div>' : buyerWaitingNote)
        + ((traceLink || settleButton) ? '<div class="refund-actions">' + traceLink + settleButton + '</div>' : '')
        + '</article>';
    }));
    target.innerHTML = rows.join('');
    target.querySelectorAll('[data-settle-refund]').forEach((button) => {
      button.addEventListener('click', async () => {
        const orderId = button.getAttribute('data-settle-refund') || '';
        button.disabled = true;
        button.textContent = 'Processing...';
        try {
          const from = button.getAttribute('data-refund-from') || '';
          const response = await fetch('/api/services/refunds/settle', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderId, ...(from ? { from } : {}) }),
          });
          const payload = await response.json();
          if (!payload || payload.ok !== true) {
            throw new Error((payload && (payload.code || payload.message)) || 'Refund settlement is blocked.');
          }
          await refreshRefunds();
        } catch (error) {
          button.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          button.disabled = false;
        }
      });
    });
  };

  const loadRefunds = async () => {
    const response = await fetch('/api/services/refunds?all=true', { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || 'Refunds load failed.');
    }
    const data = payload.data || {};
    const buyer = Array.isArray(data.initiatedByMe) ? data.initiatedByMe : [];
    const seller = Array.isArray(data.receivedByMe) ? data.receivedByMe : [];
    const allRows = buyer.concat(seller);
    const manualCount = seller.filter((entry) => needsManualRefundWork(entry, 'seller')).length;
    const processableCount = seller.filter((entry) => canProcessRefund(entry, 'seller')).length;
    const waitingRequestCount = seller.filter((entry) => needsManualRefundWork(entry, 'seller') && !String(entry.refundRequestPinId || '').trim()).length;
    const blockedCount = allRows.filter(isBlockedRefund).length;
    const completedCount = allRows.filter((entry) => entry && entry.status === 'refunded').length;
    const pendingCount = allRows.filter((entry) => entry && entry.status !== 'refunded' && !isBlockedRefund(entry)).length;
    setText(elements.totalCount, String(Number(data.totalCount) || buyer.length + seller.length));
    setText(elements.pendingCount, String(pendingCount));
    setText(elements.manualCount, String(manualCount));
    setText(elements.blockedCount, String(blockedCount));
    setText(elements.completedCount, String(completedCount));
    setText(elements.buyerCount, String(buyer.length));
    setText(elements.sellerCount, String(seller.length));
    setText(elements.actionTabCount, String(seller.length));
    setText(elements.initiatedTabCount, String(buyer.length));
    updateManualAlert(manualCount, processableCount, waitingRequestCount);
    await renderRefundRows(elements.buyerList, buyer, 'No buyer-initiated refund records were found in this local runtime.', 'buyer');
    await renderRefundRows(elements.sellerList, seller, 'No seller-received refund work is pending in this local runtime.', 'seller');
    const focusedOrderId = getFocusedOrderId();
    if (focusedOrderId) {
      const sellerFocused = seller.some((entry) => String((entry && entry.orderId) || '').trim() === focusedOrderId);
      const buyerFocused = buyer.some((entry) => String((entry && entry.orderId) || '').trim() === focusedOrderId);
      if (sellerFocused) {
        activateRefundTab('action');
      } else if (buyerFocused) {
        activateRefundTab('initiated');
      }
    } else if (activeRefundTab !== 'initiated') {
      activateRefundTab('action');
    }
    setStatus(
      buyer.length || seller.length
        ? (lastSyncSucceeded ? 'Refund records loaded.' : 'Refund records loaded from local ledger.')
        : 'No refund records found.',
      'ready'
    );
    return payload.data;
  };

  const syncRefunds = async () => {
    setSyncStatus('Syncing refund requests from chain...', 'busy');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/services/refunds/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error((payload && (payload.message || payload.code)) || 'Refund sync failed.');
      }
      lastSyncSucceeded = true;
      setSyncStatus('Refund sync completed.', 'success');
      return true;
    } catch (error) {
      lastSyncSucceeded = false;
      setSyncStatus('Sync failed: ' + (error instanceof Error ? error.message : String(error)), 'error');
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  const showLoadError = (error) => {
    setText(elements.totalCount, '0');
    setText(elements.pendingCount, '0');
    setText(elements.manualCount, '0');
    setText(elements.blockedCount, '0');
    setText(elements.completedCount, '0');
    if (elements.buyerList) {
      elements.buyerList.innerHTML = '<p class="refund-empty">Failed to load buyer refund records.</p>';
    }
    if (elements.sellerList) {
      elements.sellerList.innerHTML = '<p class="refund-empty">Failed to load seller refund records.</p>';
    }
    updateManualAlert(0, 0, 0);
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  };

  const refreshRefunds = async () => {
    if (elements.refresh) {
      elements.refresh.disabled = true;
      elements.refresh.textContent = 'Refreshing...';
    }
    setStatus('Loading refunds...', 'busy');
    await syncRefunds();
    try {
      await loadRefunds();
    } catch (error) {
      showLoadError(error);
    } finally {
      if (elements.refresh) {
        elements.refresh.disabled = false;
        elements.refresh.textContent = 'Refresh';
      }
    }
  };

  if (elements.refresh) {
    elements.refresh.addEventListener('click', refreshRefunds);
  }
  elements.tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateRefundTab(tab.getAttribute('data-refund-tab') || 'action'));
  });
  activateRefundTab('action');

  refreshRefunds();
})();`,
    };
}
