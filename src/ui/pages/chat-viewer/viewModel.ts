export function buildChatViewerScript(): string {
  return `
(() => {
  const POLL_INTERVAL_MS = 4000;
  const state = {
    peer: '',
    self: '',
    messages: [],
    nextPollAfterIndex: undefined,
    pollTimer: null,
    inFlight: false,
  };

  const list = document.querySelector('[data-chat-message-list]');
  const peerInput = document.querySelector('[data-chat-peer-input]');
  const selfLabel = document.querySelector('[data-chat-self]');
  const peerLabel = document.querySelector('[data-chat-peer]');
  const statusLabel = document.querySelector('[data-chat-status]');
  const countLabel = document.querySelector('[data-chat-count]');
  const refreshButton = document.querySelector('[data-chat-refresh]');

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function setText(node, value) {
    if (node) node.textContent = String(value || '');
  }

  function setStatus(message, tone) {
    setText(statusLabel, message);
    if (statusLabel) {
      statusLabel.dataset.tone = tone || 'neutral';
    }
  }

  function setListState(patch) {
    if (!list) return;
    if (Object.prototype.hasOwnProperty.call(patch, 'loading')) {
      list.loading = !!patch.loading;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'error')) {
      list.error = String(patch.error || '');
    }
  }

  function messageKey(message) {
    const row = message && typeof message === 'object' ? message : {};
    const pinId = normalizeText(row.pinId);
    if (pinId) return 'pin:' + pinId;
    const txId = normalizeText(row.txId);
    if (txId) return 'tx:' + txId;
    return [
      'fallback',
      normalizeText(row.fromGlobalMetaId),
      normalizeText(row.toGlobalMetaId),
      String(row.index || ''),
      String(row.timestamp || ''),
      normalizeText(row.protocol),
    ].join('|');
  }

  function sortMessages(messages) {
    return messages.slice().sort((a, b) => {
      const ai = Number(a && a.index ? a.index : 0);
      const bi = Number(b && b.index ? b.index : 0);
      if (ai !== bi) return ai - bi;
      return Number(a && a.timestamp ? a.timestamp : 0) - Number(b && b.timestamp ? b.timestamp : 0);
    });
  }

  function mergeMessages(existing, incoming) {
    const byKey = new Map();
    const merged = [];
    [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])].forEach((message) => {
      const key = messageKey(message);
      if (!byKey.has(key)) {
        byKey.set(key, message);
        merged.push(message);
        return;
      }
      const next = { ...byKey.get(key), ...message };
      byKey.set(key, next);
      const index = merged.findIndex((item) => messageKey(item) === key);
      if (index >= 0) merged[index] = next;
    });
    return sortMessages(merged);
  }

  function readPeerFromLocation() {
    const params = new URLSearchParams(window.location.search);
    return normalizeText(params.get('peer'));
  }

  function updateLocationPeer(peer) {
    const url = new URL(window.location.href);
    url.searchParams.set('peer', peer);
    window.history.replaceState(null, '', url.toString());
  }

  function maxMessageIndex(messages) {
    return (Array.isArray(messages) ? messages : []).reduce((max, message) => {
      const index = Number(message && message.index ? message.index : 0);
      return Number.isFinite(index) ? Math.max(max, index) : max;
    }, 0);
  }

  async function loadConversation(options) {
    const incremental = !!(options && options.incremental);
    if (state.inFlight) return;
    const peer = normalizeText(peerInput && peerInput.value ? peerInput.value : state.peer);
    if (!peer) {
      state.peer = '';
      setText(peerLabel, 'No peer selected');
      setText(selfLabel, 'Waiting for local identity');
      setText(countLabel, '0 messages');
      setStatus('Add a peer globalMetaId to view a private conversation.', 'warning');
      setListState({ loading: false, error: 'peer query parameter is required.' });
      return;
    }

    state.peer = peer;
    updateLocationPeer(peer);
    if (!incremental) {
      state.messages = [];
      state.nextPollAfterIndex = undefined;
      if (list) list.messages = [];
    }

    const query = new URLSearchParams({
      peer,
      limit: incremental ? '200' : '50',
    });
    if (incremental && Number.isFinite(Number(state.nextPollAfterIndex))) {
      query.set('afterIndex', String(state.nextPollAfterIndex));
    }

    state.inFlight = true;
    setListState({ loading: !incremental, error: '' });
    setStatus(incremental ? 'Checking for new messages...' : 'Loading conversation...', 'loading');

    try {
      const response = await fetch('/api/chat/private/conversation?' + query.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || payload.code || 'Failed to load private chat conversation.');
      }

      const incoming = Array.isArray(payload.messages) ? payload.messages : [];
      state.self = normalizeText(payload.selfGlobalMetaId);
      state.peer = normalizeText(payload.peerGlobalMetaId) || peer;
      state.messages = incremental ? mergeMessages(state.messages, incoming) : mergeMessages([], incoming);
      state.nextPollAfterIndex = Number.isFinite(Number(payload.nextPollAfterIndex))
        ? Number(payload.nextPollAfterIndex)
        : maxMessageIndex(state.messages);

      if (list) {
        list.setAttribute('self-global-metaid', state.self);
        list.setAttribute('peer-global-metaid', state.peer);
        list.messages = state.messages;
        list.loading = false;
        list.error = '';
      }
      setText(selfLabel, state.self || 'Local MetaBot');
      setText(peerLabel, state.peer || peer);
      setText(countLabel, state.messages.length === 1 ? '1 message' : state.messages.length + ' messages');
      setStatus('Live polling every 4 seconds.', 'ready');
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      setListState({ loading: false, error: message });
      setStatus(message, 'error');
    } finally {
      state.inFlight = false;
    }
  }

  function schedulePolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
    }
    state.pollTimer = setInterval(() => {
      if (!state.peer) return;
      loadConversation({ incremental: true });
    }, POLL_INTERVAL_MS);
  }

  async function start() {
    if (!list) return;
    state.peer = readPeerFromLocation();
    if (peerInput) {
      peerInput.value = state.peer;
      peerInput.addEventListener('change', () => loadConversation({ incremental: false }));
      peerInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          loadConversation({ incremental: false });
        }
      });
    }
    if (refreshButton) {
      refreshButton.addEventListener('click', () => loadConversation({ incremental: false }));
    }

    try {
      await import('/ui/chat/idframework/components/id-chat-msg-list.js');
    } catch (error) {
      setStatus('Failed to load the IDFramework chat message list.', 'error');
      setListState({ loading: false, error: error && error.message ? error.message : String(error) });
      return;
    }

    await loadConversation({ incremental: false });
    schedulePolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    return;
  }
  start();
})();
`.trim();
}
