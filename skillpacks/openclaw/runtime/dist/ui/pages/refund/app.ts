import type { LocalUiPageDefinition } from '../types';

export function buildRefundPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'refund',
    title: 'Refund Operations',
    eyebrow: 'Refund Ledger',
    heading: 'Buyer and seller refund operations from local runtime state',
    description: 'Inspect refund requests initiated by this MetaBot and refund requests received by this MetaBot as a provider.',
    panels: [
      {
        title: 'Buyer initiated',
        body: 'Shows refund requests this local MetaBot created after buyer-side timeout, invalid delivery, or failed artifact validation.',
      },
      {
        title: 'Seller received',
        body: 'Shows provider-side refund work, including transfer/finalization proof and any blocking reason that requires operator action.',
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
            <span class="refund-status" data-refund-status>Loading refunds...</span>
          </div>
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
          </div>
        </article>

        <article class="refund-card">
          <div class="refund-section-header">
            <div>
              <div class="refund-eyebrow">Buyer initiated</div>
              <h2>Refunds I requested</h2>
            </div>
            <span class="refund-section-count" data-refund-buyer-count>0</span>
          </div>
          <div class="refund-list" data-refund-buyer-list></div>
        </article>

        <article class="refund-card">
          <div class="refund-section-header">
            <div>
              <div class="refund-eyebrow">Seller received</div>
              <h2>Refunds I need to settle</h2>
            </div>
            <span class="refund-section-count" data-refund-seller-count>0</span>
          </div>
          <div class="refund-list" data-refund-seller-list></div>
        </article>
      </section>
    `,
    script: `(() => {
  const elements = {
    status: document.querySelector('[data-refund-status]'),
    totalCount: document.querySelector('[data-refund-total-count]'),
    pendingCount: document.querySelector('[data-refund-pending-count]'),
    manualCount: document.querySelector('[data-refund-manual-count]'),
    buyerCount: document.querySelector('[data-refund-buyer-count]'),
    sellerCount: document.querySelector('[data-refund-seller-count]'),
    buyerList: document.querySelector('[data-refund-buyer-list]'),
    sellerList: document.querySelector('[data-refund-seller-list]'),
  };
  const profileCache = new Map();

  const setText = (target, value) => {
    if (target) target.textContent = value;
  };

  const setStatus = (value, tone) => {
    if (!elements.status) return;
    elements.status.textContent = value;
    elements.status.dataset.tone = tone || 'neutral';
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

  const buildStatusBadge = (status) => {
    const tone = status === 'refunded' ? 'refunded' : status === 'failed' ? 'failed' : 'pending';
    const label = status === 'refunded' ? 'Refunded' : status === 'failed' ? 'Blocked' : 'Pending';
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
      const primaryDateValue = item.status === 'refunded' ? item.refundCompletedAt : (item.refundRequestedAt || item.updatedAt || item.createdAt);
      const blockingReason = String(item.blockingReason || item.failureReason || '').trim();
      const traceLink = item.traceHref
        ? '<a href="' + escHtml(item.traceHref) + '">Open trace</a>'
        : '';
      const settleButton = role === 'seller' && item.manualActionRequired
        ? '<button type="button" class="refund-action" data-settle-refund="' + escHtml(item.orderId) + '">Settle refund</button>'
        : '';
      return ''
        + '<article class="refund-item">'
        + '  <div class="refund-item-top">'
        + '    <div class="refund-counterparty">'
        + '      <img class="refund-avatar" src="' + escHtml(avatarSrc) + '" alt="" loading="lazy" />'
        + '      <div class="refund-counterparty-meta">'
        + '        <div class="refund-counterparty-name">' + escHtml(displayName) + '</div>'
        + '        <div class="mono-text">' + escHtml(gmid || 'unknown-global-metaid') + '</div>'
        + '      </div>'
        + '    </div>'
        +      buildStatusBadge(item.status)
        + '  </div>'
        + '  <div class="refund-grid">'
        +      field('Service', item.serviceName || 'Unknown service', false)
        +      field('Amount', amountLabel, false)
        +      field(item.status === 'refunded' ? 'Refunded at' : 'Last update', formatDate(primaryDateValue), false)
        +      field('Payment Txid', item.paymentTxid, true)
        +      field('Refund request', item.refundRequestPinId, true)
        +      field('Refund txid', item.refundTxid, true)
        +      field('Finalization pin', item.refundFinalizePinId, true)
        + '  </div>'
        + (blockingReason ? '<div class="refund-note">Blocking reason: ' + escHtml(blockingReason) + '</div>' : '')
        + ((traceLink || settleButton) ? '<div class="refund-actions">' + traceLink + settleButton + '</div>' : '')
        + '</article>';
    }));
    target.innerHTML = rows.join('');
    target.querySelectorAll('[data-settle-refund]').forEach((button) => {
      button.addEventListener('click', async () => {
        const orderId = button.getAttribute('data-settle-refund') || '';
        button.disabled = true;
        button.textContent = 'Settling...';
        try {
          const response = await fetch('/api/provider/refund/settle', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderId }),
          });
          const payload = await response.json();
          if (!payload || payload.ok !== true) {
            throw new Error((payload && (payload.code || payload.message)) || 'Refund settlement is blocked.');
          }
          await loadRefunds();
        } catch (error) {
          button.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          button.disabled = false;
        }
      });
    });
  };

  const loadRefunds = async () => {
    const response = await fetch('/api/provider/refunds', { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || 'Refunds load failed.');
    }
    const data = payload.data || {};
    const buyer = Array.isArray(data.initiatedByMe) ? data.initiatedByMe : [];
    const seller = Array.isArray(data.receivedByMe) ? data.receivedByMe : [];
    const manualCount = seller.filter((entry) => entry && entry.manualActionRequired).length;
    setText(elements.totalCount, String(Number(data.totalCount) || buyer.length + seller.length));
    setText(elements.pendingCount, String(Number(data.pendingCount) || buyer.concat(seller).filter((entry) => entry && entry.status !== 'refunded').length));
    setText(elements.manualCount, String(manualCount));
    setText(elements.buyerCount, String(buyer.length));
    setText(elements.sellerCount, String(seller.length));
    await renderRefundRows(elements.buyerList, buyer, 'No buyer-initiated refund records were found in this local runtime.', 'buyer');
    await renderRefundRows(elements.sellerList, seller, 'No seller-received refund work is pending in this local runtime.', 'seller');
    setStatus(buyer.length || seller.length ? 'Refund records loaded.' : 'No refund records found.', 'ready');
    return payload.data;
  };

  loadRefunds().catch((error) => {
    setText(elements.totalCount, '0');
    setText(elements.pendingCount, '0');
    setText(elements.manualCount, '0');
    if (elements.buyerList) {
      elements.buyerList.innerHTML = '<p class="refund-empty">Failed to load buyer refund records.</p>';
    }
    if (elements.sellerList) {
      elements.sellerList.innerHTML = '<p class="refund-empty">Failed to load seller refund records.</p>';
    }
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  });
})();`,
  };
}
