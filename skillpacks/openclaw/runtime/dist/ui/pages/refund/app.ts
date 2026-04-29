import type { LocalUiPageDefinition } from '../types';

export function buildRefundPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'refund',
    title: 'Manual Refund Confirmation',
    eyebrow: 'Human Action',
    heading: 'Confirm a provider-side refund when automation must pause',
    description: 'This is the main human interruption surface in V1: a precise local page for refund confirmation when the daemon cannot finish autonomously.',
    panels: [
      {
        title: 'Manual action only',
        body: 'Reserve this page for seller-side refund confirmation. Do not widen it into a general operations dashboard.',
      },
      {
        title: 'Exact identifiers',
        body: 'Display order id, refund request pin id, and session linkage so the human knows what they are confirming.',
      },
      {
        title: 'Back to machine-first flow',
        body: 'Once confirmed, the next state should be observable by the daemon, CLI, and trace route without bespoke UI logic.',
      },
    ],
    contentHtml: `
      <section class="refund-shell" data-refund-shell>
        <article class="refund-card">
          <div class="refund-header">
            <div>
              <div class="refund-eyebrow">Refund Target</div>
              <h2 data-refund-title>Load refund request</h2>
            </div>
            <span class="refund-status" data-refund-status>Loading provider summary...</span>
          </div>

          <dl class="refund-rows">
            <div class="refund-row">
              <dt>Order ID</dt>
              <dd data-refund-order-id>unknown-order</dd>
            </div>
            <div class="refund-row">
              <dt>Refund Request Pin</dt>
              <dd class="mono-text" data-refund-request-pin>pending</dd>
            </div>
            <div class="refund-row">
              <dt>Trace</dt>
              <dd><a data-refund-trace-link href="/ui/trace">Open trace</a></dd>
            </div>
            <div class="refund-row">
              <dt>Session Linkage</dt>
              <dd data-refund-session-id>pending</dd>
            </div>
          </dl>

          <div class="refund-actions">
            <button type="button" data-refund-confirm>Confirm refund</button>
          </div>
        </article>
      </section>
    `,
    script: `(() => {
  const params = new URL(window.location.href).searchParams;
  const orderId = params.get('orderId') || 'unknown-order';
  const elements = {
    title: document.querySelector('[data-refund-title]'),
    orderId: document.querySelector('[data-refund-order-id]'),
    requestPin: document.querySelector('[data-refund-request-pin]'),
    traceLink: document.querySelector('[data-refund-trace-link]'),
    sessionId: document.querySelector('[data-refund-session-id]'),
    confirm: document.querySelector('[data-refund-confirm]'),
    status: document.querySelector('[data-refund-status]'),
  };

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

  const render = (summary) => {
    const manualActions = summary && Array.isArray(summary.manualActions) ? summary.manualActions : [];
    const recentOrders = summary && Array.isArray(summary.recentOrders) ? summary.recentOrders : [];
    const action = manualActions.find((entry) => entry && entry.orderId === orderId) || null;
    const order = recentOrders.find((entry) => entry && entry.orderId === orderId) || null;
    const traceId = (action && action.traceId) || (order && order.traceId) || '';

    setText(elements.title, action ? 'Refund confirmation required' : 'Refund no longer pending');
    setText(elements.orderId, orderId);
    setText(elements.requestPin, action && action.refundRequestPinId ? action.refundRequestPinId : 'No pending refund request pin');
    setText(elements.sessionId, action && action.sessionId ? action.sessionId : 'No session linkage stored');
    if (elements.traceLink) {
      elements.traceLink.href = traceId ? '/ui/trace?traceId=' + encodeURIComponent(traceId) : '/ui/trace';
      elements.traceLink.textContent = traceId || 'Open trace';
    }
    if (elements.confirm) {
      elements.confirm.disabled = !action;
    }
    setStatus(action ? 'Awaiting human confirmation.' : 'No manual refund is pending for this order.', action ? 'busy' : 'ready');
  };

  const loadSummary = async () => {
    const response = await fetch('/api/provider/summary', { cache: 'no-store' });
    const payload = await response.json();
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.message) || 'Provider summary load failed.');
    }
    render(payload.data);
    return payload.data;
  };

  if (elements.confirm) {
    elements.confirm.addEventListener('click', async () => {
      elements.confirm.disabled = true;
      setStatus('Confirming refund...', 'busy');
      try {
        const response = await fetch('/api/provider/refund/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });
        const payload = await response.json();
        if (!payload || payload.ok !== true) {
          throw new Error((payload && payload.message) || 'Refund confirmation failed.');
        }
        await loadSummary();
        setStatus('Refund confirmed. Runtime state has been updated.', 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  }

  loadSummary().catch((error) => {
    setText(elements.orderId, orderId);
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  });
})();`,
  };
}
