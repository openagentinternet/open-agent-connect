"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRefundPageDefinition = buildRefundPageDefinition;
const i18n_1 = require("../../i18n");
function buildRefundPageDefinition(i18n = (0, i18n_1.createI18nContext)()) {
    return {
        page: 'refund',
        title: i18n.t('refund.title'),
        eyebrow: i18n.t('refund.eyebrow'),
        heading: i18n.t('refund.heading'),
        description: i18n.t('refund.description'),
        panels: [
            {
                title: i18n.t('refund.panel.actionTitle'),
                body: i18n.t('refund.panel.actionBody'),
            },
            {
                title: i18n.t('refund.panel.initiatedTitle'),
                body: i18n.t('refund.panel.initiatedBody'),
            },
            {
                title: i18n.t('refund.panel.manualTitle'),
                body: i18n.t('refund.panel.manualBody'),
            },
        ],
        contentHtml: `
      <section class="refund-shell" data-refund-shell>
        <article class="refund-card refund-summary">
          <div class="refund-header">
            <div>
              <div class="refund-eyebrow" data-i18n-key="refund.cardEyebrow">${i18n.t('refund.cardEyebrow')}</div>
              <h2 data-i18n-key="refund.summaryTitle">${i18n.t('refund.summaryTitle')}</h2>
            </div>
            <div class="refund-toolbar">
              <button type="button" class="refund-refresh" data-refund-refresh data-i18n-key="refund.refresh">${i18n.t('refund.refresh')}</button>
              <span class="refund-status" data-refund-status data-i18n-key="refund.statusLoading">${i18n.t('refund.statusLoading')}</span>
            </div>
          </div>
          <div class="refund-sync-status" data-refund-sync-status data-i18n-key="refund.syncNever">${i18n.t('refund.syncNever')}</div>
          <div class="refund-manual-alert" data-refund-manual-alert hidden></div>
          <div class="refund-summary-grid">
            <div class="refund-summary-item">
              <div class="refund-summary-label" data-i18n-key="refund.summaryTotal">${i18n.t('refund.summaryTotal')}</div>
              <div class="refund-summary-value" data-refund-total-count>0</div>
            </div>
            <div class="refund-summary-item">
              <div class="refund-summary-label" data-i18n-key="refund.summaryPending">${i18n.t('refund.summaryPending')}</div>
              <div class="refund-summary-value" data-refund-pending-count>0</div>
            </div>
            <div class="refund-summary-item">
              <div class="refund-summary-label" data-i18n-key="refund.summaryManual">${i18n.t('refund.summaryManual')}</div>
              <div class="refund-summary-value" data-refund-manual-count>0</div>
            </div>
            <div class="refund-summary-item">
              <div class="refund-summary-label" data-i18n-key="refund.summaryBlocked">${i18n.t('refund.summaryBlocked')}</div>
              <div class="refund-summary-value" data-refund-blocked-count>0</div>
            </div>
            <div class="refund-summary-item">
              <div class="refund-summary-label" data-i18n-key="refund.summaryCompleted">${i18n.t('refund.summaryCompleted')}</div>
              <div class="refund-summary-value" data-refund-completed-count>0</div>
            </div>
          </div>
        </article>

        <div class="refund-tabs" role="tablist" aria-label="${i18n.t('refund.queuesAria')}">
          <button type="button" class="refund-tab" role="tab" aria-controls="seller-refunds" data-refund-tab="action">
            <span data-i18n-key="refund.tabAction">${i18n.t('refund.tabAction')}</span>
            <span class="refund-tab-count" data-refund-action-tab-count>0</span>
          </button>
          <button type="button" class="refund-tab" role="tab" aria-controls="buyer-refunds" data-refund-tab="initiated">
            <span data-i18n-key="refund.tabInitiated">${i18n.t('refund.tabInitiated')}</span>
            <span class="refund-tab-count" data-refund-initiated-tab-count>0</span>
          </button>
        </div>

        <section class="refund-panels">
          <article class="refund-card refund-panel" id="seller-refunds" role="tabpanel" data-refund-panel="action">
            <div class="refund-section-header">
              <div>
                <div class="refund-eyebrow" data-i18n-key="refund.sectionProvider">${i18n.t('refund.sectionProvider')}</div>
                <h2 data-i18n-key="refund.tabAction">${i18n.t('refund.tabAction')}</h2>
              </div>
              <span class="refund-section-count" data-refund-seller-count>0</span>
            </div>
            <div class="refund-list" data-refund-seller-list></div>
          </article>

          <article class="refund-card refund-panel" id="buyer-refunds" role="tabpanel" data-refund-panel="initiated" hidden>
            <div class="refund-section-header">
              <div>
                <div class="refund-eyebrow" data-i18n-key="refund.sectionBuyer">${i18n.t('refund.sectionBuyer')}</div>
                <h2 data-i18n-key="refund.tabInitiated">${i18n.t('refund.tabInitiated')}</h2>
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
  let lastData = null;

  const formatText = (template, replacements) => Object.keys(replacements || {}).reduce(
    (text, name) => text.split('{' + name + '}').join(String(replacements[name])),
    String(template == null ? '' : template)
  );
  const uiText = (key, fallback, replacements) => {
    try {
      if (typeof window !== 'undefined' && window.__oacLocalUiI18n && typeof window.__oacLocalUiI18n.t === 'function') {
        const translated = window.__oacLocalUiI18n.t(key, replacements || {});
        if (translated && translated !== key) return translated;
      }
    } catch {}
    return formatText(fallback, replacements || {});
  };

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
  const getScopedRefundFrom = () => {
    try {
      return String(new URLSearchParams(window.location.search).get('from') || '').trim();
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
    if (!Number.isFinite(parsed) || parsed <= 0) return uiText('refund.none', '—');
    const date = new Date(parsed);
    return Number.isNaN(date.getTime()) ? uiText('refund.none', '—') : date.toLocaleString();
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
    const detail = processableCount
      ? uiText('refund.manualReady', '{count} ready to process', { count: processableCount })
      : waitingRequestCount
        ? uiText('refund.manualWaiting', '{count} waiting for refund request proof', { count: waitingRequestCount })
        : uiText('refund.manualReview', 'review the seller refund queue');
    elements.manualAlert.innerHTML =
      '<div class="refund-manual-alert-copy">'
      + '<strong>' + escHtml(uiText(manualCount === 1 ? 'refund.manualNeedsOne' : 'refund.manualNeedsMany', manualCount === 1 ? '{count} seller refund needs operator attention.' : '{count} seller refunds need operator attention.', { count: manualCount })) + '</strong>'
      + '<span>' + escHtml(detail) + '</span>'
      + '</div>'
      + '<button type="button" class="refund-manual-alert-action" data-refund-tab-jump="action">' + escHtml(uiText('refund.processSellerRefunds', 'Process seller refunds')) + '</button>';
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
      ? uiText('refund.badgeRefunded', 'Refunded')
      : role === 'buyer' && status === 'refund_pending'
        ? uiText('refund.badgeWaitingProvider', 'Waiting for provider')
        : manual
          ? uiText('refund.badgeActionRequired', 'Action required')
          : blocked
            ? uiText('refund.badgeBlocked', 'Blocked')
            : uiText('refund.badgePending', 'Pending');
    return '<span class="refund-badge" data-tone="' + tone + '">' + label + '</span>';
  };

  const field = (label, value, wide) => (
    '<div class="refund-field' + (wide ? ' refund-field-wide' : '') + '">'
    + '<div class="refund-label">' + escHtml(label) + '</div>'
    + '<div class="refund-value mono-text">' + escHtml(value || uiText('refund.none', '—')) + '</div>'
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
      const displayName = String(providedName || profile.name || gmid || uiText('refund.unknown', 'Unknown')).trim() || uiText('refund.unknown', 'Unknown');
      const avatarSrc = profile.avatar || getInitialsAvatar(displayName, gmid);
      const amountLabel = [item.paymentAmount, item.paymentCurrency].filter(Boolean).join(' ') || uiText('refund.none', '—');
      const blockingReason = String(item.blockingReason || '').trim();
      const failureReason = String(item.failureReason || '').trim();
      const manualWork = needsManualRefundWork(item, role);
      const processable = canProcessRefund(item, role);
      const providerStatus = item.status === 'refunded'
        ? uiText('refund.providerFinalized', 'Finalized')
        : role === 'buyer' && item.status === 'refund_pending'
          ? uiText('refund.providerWaitingRefund', 'Waiting for provider refund')
        : processable
          ? uiText('refund.providerReady', 'Ready to process')
          : manualWork
            ? String(item.refundRequestPinId || '').trim()
              ? uiText('refund.providerNeedsAttention', 'Needs operator attention')
              : uiText('refund.providerNeedsProof', 'Needs refund request proof')
          : blockingReason
            ? uiText('refund.providerBlocked', 'Blocked')
            : uiText('refund.providerWaiting', 'Waiting');
      const statusFieldLabel = role === 'buyer' ? uiText('refund.fieldRefundStatus', 'Refund status') : uiText('refund.fieldProviderStatus', 'Provider status');
      const buyerWaitingNote = role === 'buyer' && item.status === 'refund_pending' && !blockingReason
        ? '<div class="refund-note">' + escHtml(uiText('refund.buyerWaitingNote', 'Waiting for the provider to process this refund request.')) + '</div>'
        : '';
      const traceHref = String(item.traceHref || '').trim();
      const traceLink = traceHref
        ? '<a class="refund-trace-link" href="' + escHtml(traceHref) + '">' + escHtml(uiText('refund.openTrace', 'Open trace')) + '</a>'
        : '';
      const localMetabotSlug = String(item.localMetabotSlug || '').trim();
      const settleButton = processable
        ? '<button type="button" class="refund-action" data-settle-refund="' + escHtml(item.orderId) + '" data-refund-from="' + escHtml(localMetabotSlug) + '">' + escHtml(uiText('refund.processRefund', 'Process refund')) + '</button>'
        : '';
      const focused = getFocusedOrderId() && String(item.orderId || '').trim() === getFocusedOrderId();
      return ''
        + '<article class="refund-item' + (manualWork ? ' refund-item-manual' : '') + (focused ? ' refund-item-focus' : '') + '" data-refund-order-id="' + escHtml(item.orderId) + '">'
        + '  <div class="refund-item-top">'
        + '    <div class="refund-counterparty">'
        + '      <img class="refund-avatar" src="' + escHtml(avatarSrc) + '" alt="" loading="lazy" />'
        + '      <div class="refund-counterparty-meta">'
        + '        <div class="refund-counterparty-name">' + escHtml(displayName) + '</div>'
        + '        <div class="mono-text">' + escHtml(gmid || uiText('refund.unknownGlobalMetaId', 'unknown-global-metaid')) + '</div>'
        + '      </div>'
        + '    </div>'
        +      buildStatusBadge(item, role)
        + '  </div>'
        + '  <div class="refund-grid">'
        +      field(uiText('refund.fieldService', 'Service'), item.serviceName || uiText('refund.unknownService', 'Unknown service'), false)
        +      field(uiText('refund.fieldAmount', 'Amount'), amountLabel, false)
        +      field(uiText('refund.fieldOrderCreated', 'Order created'), formatDate(item.createdAt), false)
        +      field(uiText('refund.fieldRequestedAt', 'Requested at'), formatDate(item.refundRequestedAt), false)
        +      field(statusFieldLabel, providerStatus, false)
        +      field(uiText('refund.fieldFailureReason', 'Failure reason'), failureReason, true)
        +      field(uiText('refund.fieldPaymentTxid', 'Payment Txid'), item.paymentTxid, true)
        +      field(uiText('refund.fieldRefundRequest', 'Refund request'), item.refundRequestPinId, true)
        +      field(uiText('refund.fieldRefundTxid', 'Refund txid'), item.refundTxid, true)
        +      field(uiText('refund.fieldFinalizationPin', 'Finalization pin'), item.refundFinalizePinId, true)
        +      field(uiText('refund.fieldRefundedAt', 'Refunded at'), formatDate(item.refundCompletedAt), false)
        + '  </div>'
        + (blockingReason ? '<div class="refund-note">' + escHtml(uiText('refund.blockingReason', 'Blocking reason: {reason}', { reason: blockingReason })) + '</div>' : buyerWaitingNote)
        + ((traceLink || settleButton) ? '<div class="refund-actions">' + traceLink + settleButton + '</div>' : '')
        + '</article>';
    }));
    target.innerHTML = rows.join('');
    target.querySelectorAll('[data-settle-refund]').forEach((button) => {
      button.addEventListener('click', async () => {
        const orderId = button.getAttribute('data-settle-refund') || '';
        button.disabled = true;
        button.textContent = uiText('refund.processing', 'Processing...');
        try {
          const from = button.getAttribute('data-refund-from') || '';
          const response = await fetch('/api/services/refunds/settle', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderId, ...(from ? { from } : {}) }),
          });
          const payload = await response.json();
          if (!payload || payload.ok !== true) {
            throw new Error((payload && (payload.code || payload.message)) || uiText('refund.settlementBlocked', 'Refund settlement is blocked.'));
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
    const scopedFrom = getScopedRefundFrom();
    const response = await fetch(
      scopedFrom
        ? '/api/services/refunds?from=' + encodeURIComponent(scopedFrom)
        : '/api/services/refunds?all=true',
      { cache: 'no-store' }
    );
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || uiText('refund.loadFailed', 'Refunds load failed.'));
    }
    const data = payload.data || {};
    lastData = data;
    await renderRefundData(data);
    return data;
  };

  const renderRefundData = async (data) => {
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
    await renderRefundRows(elements.buyerList, buyer, uiText('refund.emptyBuyer', 'No buyer-initiated refund records were found in this local runtime.'), 'buyer');
    await renderRefundRows(elements.sellerList, seller, uiText('refund.emptySeller', 'No seller-received refund work is pending in this local runtime.'), 'seller');
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
        ? (lastSyncSucceeded ? uiText('refund.recordsLoaded', 'Refund records loaded.') : uiText('refund.recordsLoadedLocal', 'Refund records loaded from local ledger.'))
        : uiText('refund.recordsNone', 'No refund records found.'),
      'ready'
    );
  };

  const syncRefunds = async () => {
    setSyncStatus(uiText('refund.syncing', 'Syncing refund requests from chain...'), 'busy');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/services/refunds/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(getScopedRefundFrom() ? { from: getScopedRefundFrom() } : { all: true }),
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error((payload && (payload.message || payload.code)) || uiText('refund.syncFailed', 'Refund sync failed.'));
      }
      lastSyncSucceeded = true;
      setSyncStatus(uiText('refund.syncCompleted', 'Refund sync completed.'), 'success');
      return true;
    } catch (error) {
      lastSyncSucceeded = false;
      setSyncStatus(uiText('refund.syncFailedPrefix', 'Sync failed: {message}', { message: error instanceof Error ? error.message : String(error) }), 'error');
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
      elements.buyerList.innerHTML = '<p class="refund-empty">' + escHtml(uiText('refund.buyerLoadFailed', 'Failed to load buyer refund records.')) + '</p>';
    }
    if (elements.sellerList) {
      elements.sellerList.innerHTML = '<p class="refund-empty">' + escHtml(uiText('refund.sellerLoadFailed', 'Failed to load seller refund records.')) + '</p>';
    }
    updateManualAlert(0, 0, 0);
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  };

  const refreshRefunds = async () => {
    if (elements.refresh) {
      elements.refresh.disabled = true;
      elements.refresh.textContent = uiText('refund.refreshing', 'Refreshing...');
    }
    setStatus(uiText('refund.statusLoading', 'Loading refunds...'), 'busy');
    await syncRefunds();
    try {
      await loadRefunds();
    } catch (error) {
      showLoadError(error);
    } finally {
      if (elements.refresh) {
        elements.refresh.disabled = false;
        elements.refresh.textContent = uiText('refund.refresh', 'Refresh');
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
  window.addEventListener('oac:i18n-changed', () => {
    if (lastData) renderRefundData(lastData).catch(() => undefined);
  });

  refreshRefunds();
})();`,
    };
}
