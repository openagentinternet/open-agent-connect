export function buildChatViewerScript(): string {
  return `
(() => {
  const SOCKET_ENDPOINTS = [
    { url: 'wss://api.idchat.io', path: '/socket/socket.io' },
    { url: 'wss://www.show.now', path: '/socket/socket.io' },
  ];

  const state = {
    peer: '',
    self: '',
    messages: [],
    nextPollAfterIndex: undefined,
    inFlight: false,
    peerName: '',
    peerAvatar: '',
    conversationStopped: false,
    socket: null,
    socketConnected: false,
    socketEndpointIndex: 0,
    initialLoadDone: false,
  };

  const list = document.querySelector('[data-chat-message-list]');
  const peerInput = document.querySelector('[data-chat-peer-input]');
  const selfLabel = document.querySelector('[data-chat-self]');
  const peerContainer = document.querySelector('[data-chat-peer-container]');
  const statusLabel = document.querySelector('[data-chat-status]');
  const countLabel = document.querySelector('[data-chat-count]');
  const refreshButton = document.querySelector('[data-chat-refresh]');
  const stopButton = document.querySelector('[data-chat-stop]');

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function setText(node, value) {
    if (node) node.textContent = String(value || '');
  }

  function setStatus(message, tone) {
    setText(statusLabel, message);
    if (statusLabel) statusLabel.dataset.tone = tone || 'neutral';
  }

  function setListState(patch) {
    if (!list) return;
    if (Object.prototype.hasOwnProperty.call(patch, 'loading')) list.loading = !!patch.loading;
    if (Object.prototype.hasOwnProperty.call(patch, 'error')) list.error = String(patch.error || '');
  }

  function messageKey(message) {
    const row = message && typeof message === 'object' ? message : {};
    const pinId = normalizeText(row.pinId);
    if (pinId) return 'pin:' + pinId;
    const txId = normalizeText(row.txId);
    if (txId) return 'tx:' + txId;
    return ['fallback', normalizeText(row.fromGlobalMetaId), normalizeText(row.toGlobalMetaId), String(row.index || ''), String(row.timestamp || ''), normalizeText(row.protocol)].join('|');
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

  function updatePeerDisplay() {
    if (!peerContainer) return;
    if (state.peerName || state.peerAvatar) {
      let html = '<div class="peer-info">';
      if (state.peerAvatar) {
        html += '<img class="peer-avatar" src="' + state.peerAvatar.replace(/"/g, '&quot;') + '" alt="" onerror="this.style.display=\\'none\\'" />';
      }
      html += '<span class="peer-name">' + (state.peerName || state.peer).replace(/</g, '&lt;') + '</span>';
      html += '</div>';
      peerContainer.innerHTML = html;
    } else {
      peerContainer.innerHTML = '<strong>' + (state.peer || 'No peer selected').replace(/</g, '&lt;') + '</strong>';
    }
  }

  function extractPeerInfo(messages) {
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
      if (!msg || !msg.fromUserInfo) continue;
      const fromGm = normalizeText(msg.fromGlobalMetaId);
      if (fromGm && fromGm !== state.self) {
        const info = msg.fromUserInfo;
        const name = normalizeText(info.name) || normalizeText(info.nickname);
        const avatar = normalizeText(info.avatarImage) || normalizeText(info.avatarUrl) || normalizeText(info.avatar) || normalizeText(info.avatarUri);
        if (name && !state.peerName) state.peerName = name;
        if (avatar && !state.peerAvatar) state.peerAvatar = avatar;
        if (state.peerName) break;
      }
    }
  }

  function forceScrollToBottom() {
    if (!list) return;
    // The component's _postRenderScrollAdjust checks _pendingForceBottomConversation
    // against snapshot.currentConversation (which equals the peer-global-metaid attribute).
    // Setting this flag makes the component scroll to bottom on next render cycle.
    if (state.peer) {
      list._pendingForceBottomConversation = state.peer;
    }
  }

  async function loadConversation(options) {
    const incremental = !!(options && options.incremental);
    if (state.inFlight) return;
    const peer = normalizeText(peerInput && peerInput.value ? peerInput.value : state.peer);
    if (!peer) {
      state.peer = '';
      updatePeerDisplay();
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

    const query = new URLSearchParams({ peer, limit: incremental ? '200' : '50' });
    if (incremental && Number.isFinite(Number(state.nextPollAfterIndex))) {
      query.set('afterIndex', String(state.nextPollAfterIndex));
    }

    state.inFlight = true;
    if (!incremental) {
      setListState({ loading: true, error: '' });
      setStatus('Loading conversation...', 'loading');
    }

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
      const prevCount = state.messages.length;
      state.self = normalizeText(payload.selfGlobalMetaId);
      state.peer = normalizeText(payload.peerGlobalMetaId) || peer;
      state.messages = incremental ? mergeMessages(state.messages, incoming) : mergeMessages([], incoming);
      state.nextPollAfterIndex = Number.isFinite(Number(payload.nextPollAfterIndex))
        ? Number(payload.nextPollAfterIndex)
        : maxMessageIndex(state.messages);

      extractPeerInfo(state.messages);

      if (list) {
        list.setAttribute('self-global-metaid', state.self);
        list.setAttribute('peer-global-metaid', state.peer);

        // Set the force-bottom flag BEFORE setting messages, so that the
        // component's _postRenderScrollAdjust (triggered synchronously by the
        // messages setter) sees the flag and scrolls to the newest messages.
        if (!incremental || state.messages.length > prevCount) {
          forceScrollToBottom();
        }

        list.messages = state.messages;
        list.loading = false;
        list.error = '';
      }
      setText(selfLabel, state.self || 'Local MetaBot');
      updatePeerDisplay();
      setText(countLabel, state.messages.length === 1 ? '1 message' : state.messages.length + ' messages');

      const statusText = state.conversationStopped
        ? 'Conversation ended.'
        : (state.socketConnected ? 'Connected (real-time).' : 'Connected.');
      setStatus(statusText, state.conversationStopped ? 'warning' : 'ready');

      // Connect socket after first successful load (we need state.self)
      if (!state.initialLoadDone && state.self) {
        state.initialLoadDone = true;
        connectSocket();
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      setListState({ loading: false, error: message });
      setStatus(message, 'error');
    } finally {
      state.inFlight = false;
    }
  }

  // Socket.io: single endpoint, fallback to secondary
  function connectSocket() {
    if (!state.self) return;
    disconnectSocket();

    const endpoint = SOCKET_ENDPOINTS[state.socketEndpointIndex] || SOCKET_ENDPOINTS[0];
    try {
      const socket = io(endpoint.url, {
        path: endpoint.path,
        query: { metaid: state.self, type: 'pc' },
        reconnection: true,
        reconnectionDelay: 3000,
        reconnectionDelayMax: 15000,
        transports: ['websocket'],
      });

      socket.on('connect', () => {
        state.socketConnected = true;
        setStatus('Connected (real-time).', 'ready');
      });

      socket.on('disconnect', () => {
        state.socketConnected = false;
        setStatus('Reconnecting...', 'warning');
      });

      socket.on('connect_error', () => {
        // Try fallback endpoint
        if (state.socketEndpointIndex === 0 && SOCKET_ENDPOINTS.length > 1) {
          state.socketEndpointIndex = 1;
          disconnectSocket();
          setTimeout(() => connectSocket(), 1000);
        }
      });

      const onNewMessage = () => {
        if (!state.peer || state.inFlight) return;
        loadConversation({ incremental: true });
      };

      socket.on('message', onNewMessage);
      socket.on('WS_SERVER_NOTIFY_PRIVATE_CHAT', onNewMessage);
      state.socket = socket;
    } catch (e) {
      // Socket failed, user can manually refresh
    }
  }

  function disconnectSocket() {
    if (state.socket) {
      try {
        state.socket.removeAllListeners();
        state.socket.disconnect();
      } catch (e) {}
      state.socket = null;
      state.socketConnected = false;
    }
  }

  async function stopConversation() {
    if (!state.peer) return;
    if (stopButton) stopButton.disabled = true;
    setStatus('Ending conversation...', 'loading');

    try {
      const response = await fetch('/api/chat/private/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ peer: state.peer }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || 'Failed to end conversation.');
      }
      state.conversationStopped = true;
      setStatus('Conversation ended. Your MetaBot will no longer auto-reply.', 'warning');
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), 'error');
    } finally {
      if (stopButton) stopButton.disabled = false;
    }
  }

  async function start() {
    if (!list) return;
    state.peer = readPeerFromLocation();
    if (peerInput) {
      peerInput.value = state.peer;
      peerInput.addEventListener('change', () => {
        state.conversationStopped = false;
        state.peerName = '';
        state.peerAvatar = '';
        loadConversation({ incremental: false });
      });
      peerInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          state.conversationStopped = false;
          state.peerName = '';
          state.peerAvatar = '';
          loadConversation({ incremental: false });
        }
      });
    }
    if (refreshButton) refreshButton.addEventListener('click', () => loadConversation({ incremental: false }));
    if (stopButton) stopButton.addEventListener('click', stopConversation);

    try {
      await import('/ui/chat/idframework/components/id-chat-msg-list.js');
    } catch (error) {
      setStatus('Failed to load the IDFramework chat message list.', 'error');
      setListState({ loading: false, error: error && error.message ? error.message : String(error) });
      return;
    }

    // Initial load via API
    await loadConversation({ incremental: false });

    // Load socket.io client from CDN, then connect
    try {
      const script = document.createElement('script');
      script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      script.onload = () => {
        if (state.self) connectSocket();
      };
      document.head.appendChild(script);
    } catch (e) {
      // Socket.io unavailable, user can refresh manually
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    return;
  }
  start();
})();
`.trim();
}
