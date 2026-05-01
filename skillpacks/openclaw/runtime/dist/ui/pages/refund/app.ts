import type { LocalUiPageDefinition } from '../types';

export function buildRefundPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'refund',
    title: 'Refunds I Initiated',
    eyebrow: 'Refund Ledger',
    heading: 'Buyer-side refund history from local runtime state',
    description: 'Shows refunds initiated by this local MetaBot, including pending and completed refund records with counterparty identity and payment linkage.',
    panels: [
      {
        title: 'Initiated refunds only',
        body: 'Only buyer-side refund records are listed here. Seller-side manual processing is intentionally excluded from this view.',
      },
      {
        title: 'Canonical local source',
        body: 'All entries come from local runtime trace records and are not backed by sqlite.',
      },
      {
        title: 'Identity enrichment',
        body: 'Counterparty names and avatars are resolved online by globalMetaId, then cached in memory for the current page session.',
      },
    ],
    contentHtml: `
      <section class="refund-shell" data-refund-shell>
        <article class="refund-card refund-summary">
          <div class="refund-header">
            <div>
              <div class="refund-eyebrow">Refunds I initiated</div>
              <h2>Local buyer refund records</h2>
            </div>
            <span class="refund-status" data-refund-status>Loading initiated refunds...</span>
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
          </div>
        </article>

        <article class="refund-card">
          <div class="refund-list" data-refund-list></div>
        </article>
      </section>
    `,
    script: `(() => {
  const elements = {
    status: document.querySelector('[data-refund-status]'),
    totalCount: document.querySelector('[data-refund-total-count]'),
    pendingCount: document.querySelector('[data-refund-pending-count]'),
    list: document.querySelector('[data-refund-list]'),
  };
  const profileCache = new Map();

  const setText = (target, value) => {
    if (target) {
      target.textContent = value;
    }
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
    if (rawAvatar.startsWith('http') || rawAvatar.startsWith('data:')) return rawAvatar;
    if (rawAvatar.startsWith('/')) return 'https://file.metaid.io' + rawAvatar;
    if (/^[0-9a-f]{64}i\\d+$/i.test(rawAvatar)) return 'https://file.metaid.io/content/' + rawAvatar;
    if (/^[0-9a-f]{64}$/i.test(rawAvatar)) return 'https://file.metaid.io/metafile-indexer/api/v1/files/content/' + rawAvatar;
    return '';
  };

  const resolveProfile = async (gmid) => {
    if (!gmid) {
      return { name: '', avatar: '' };
    }
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
    try {
      const resp = await fetch('https://file.metaid.io/metafile-indexer/api/v1/info/globalmetaid/' + encodeURIComponent(gmid));
      if (resp.ok) {
        const json = await resp.json();
        const data = json && (json.data || json) || {};
        name = String(data.name || data.showName || data.nickname || '').trim();
        avatarUrl = normalizeAvatarUrl(String(data.avatar || data.avatarUrl || data.avatarId || '').trim());
      }
    } catch { /* ignore */ }
    profileCache.set(gmid, { name, avatar: avatarUrl, fetching: null });
    resolveFn();
    return { name: name || gmid, avatar: avatarUrl || getInitialsAvatar(name, gmid) };
  };

  const buildStatusBadge = (status) => {
    const isPending = status === 'refund_pending';
    return '<span class="refund-badge" data-tone="' + (isPending ? 'pending' : 'refunded') + '">'
      + (isPending ? 'Pending' : 'Refunded')
      + '</span>';
  };

  const renderList = async (items) => {
    if (!elements.list) return;
    if (!items.length) {
      elements.list.innerHTML = '<p class="refund-empty">No initiated refund records were found in this local runtime.</p>';
      return;
    }
    const rows = await Promise.all(items.map(async (item) => {
      const gmid = String(item.counterpartyGlobalMetaId || '').trim();
      const profile = await resolveProfile(gmid);
      const displayName = String(item.counterpartyName || profile.name || gmid || 'Unknown').trim() || 'Unknown';
      const avatarSrc = profile.avatar || getInitialsAvatar(displayName, gmid);
      const amountLabel = [item.paymentAmount, item.paymentCurrency].filter(Boolean).join(' ') || '—';
      const dateLabel = item.status === 'refunded' ? 'Refunded at' : 'Requested at';
      const dateValue = item.status === 'refunded' ? item.refundCompletedAt : item.refundRequestedAt;
      const failureReason = String(item.failureReason || '').trim();
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
        + '    <div class="refund-field"><div class="refund-label">Service</div><div class="refund-value">' + escHtml(item.serviceName || 'Unknown service') + '</div></div>'
        + '    <div class="refund-field"><div class="refund-label">Amount</div><div class="refund-value">' + escHtml(amountLabel) + '</div></div>'
        + '    <div class="refund-field"><div class="refund-label">' + escHtml(dateLabel) + '</div><div class="refund-value">' + escHtml(formatDate(dateValue)) + '</div></div>'
        + '    <div class="refund-field refund-field-wide"><div class="refund-label">Payment Txid</div><div class="refund-value mono-text">' + escHtml(item.paymentTxid || '—') + '</div></div>'
        + '  </div>'
        + (failureReason ? '<div class="refund-note">Failure reason: ' + escHtml(failureReason) + '</div>' : '')
        + '</article>';
    }));
    elements.list.innerHTML = rows.join('');
  };

  const loadRefunds = async () => {
    const response = await fetch('/api/provider/refunds/initiated', { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || 'Initiated refunds load failed.');
    }
    const data = payload.data || {};
    const items = Array.isArray(data.initiatedByMe) ? data.initiatedByMe : [];
    setText(elements.totalCount, String(Number(data.totalCount) || items.length));
    setText(elements.pendingCount, String(Number(data.pendingCount) || items.filter((entry) => entry && entry.status === 'refund_pending').length));
    await renderList(items);
    setStatus(items.length ? 'Initiated refunds loaded.' : 'No initiated refunds found.', 'ready');
    return payload.data;
  };

  loadRefunds().catch((error) => {
    setText(elements.totalCount, '0');
    setText(elements.pendingCount, '0');
    if (elements.list) {
      elements.list.innerHTML = '<p class="refund-empty">Failed to load initiated refunds.</p>';
    }
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  });
})();`,
  };
}
