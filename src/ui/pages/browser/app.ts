import type { LocalUiPageDefinition } from '../types';

export function buildBrowserPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'browser',
    title: 'Agent Internet Browser',
    eyebrow: 'Bot Browser',
    heading: 'Agent Internet Browser',
    description: 'Visit Agent Internet resources by URI.',
    panels: [],
    contentHtml: `
      <section class="browser-shell" data-browser-shell>
        <header class="browser-topbar" data-browser-topbar>
          <nav class="browser-nav" aria-label="Browser navigation">
            <button type="button" data-browser-back aria-label="Back">Back</button>
            <button type="button" data-browser-forward aria-label="Forward">Forward</button>
            <button type="button" data-browser-reload aria-label="Reload">Reload</button>
            <button type="button" data-browser-drawer-toggle aria-label="Bookmarks and history">Bookmarks</button>
          </nav>
          <form class="browser-address-form" data-browser-address-form>
            <input data-browser-uri-input aria-label="Agent Internet URI" placeholder="metaid://idq1example" />
            <button type="submit">Open</button>
          </form>
          <button type="button" class="browser-resource-chip" data-browser-resource-chip>Resource</button>
          <button type="button" class="browser-using-chip" data-browser-using-selector>Using: My Bot</button>
        </header>
        <aside class="browser-drawer" data-browser-drawer hidden></aside>
        <main class="browser-viewport" data-browser-viewport></main>
        <footer class="browser-status-strip" data-browser-status-strip>
          <button type="button" data-browser-status-state>loading</button>
          <button type="button" data-browser-status-proof>unverified</button>
          <span data-browser-status-renderer>renderer: unsupported</span>
          <button type="button" data-browser-status-txid>TXID: -</button>
        </footer>
        <aside class="browser-inspector" data-browser-inspector hidden></aside>
        <div class="browser-modal" data-browser-modal-root hidden></div>
      </section>
    `,
    script: buildBrowserPageScript(),
  };
}

function buildBrowserPageScript(): string {
  return `var browserEndpoints = {
  context: '/api/browser/context',
  resolve: '/api/browser/resolve',
  privateChat: '/api/chat/private',
  serviceCall: '/api/services/call',
};

var state = {
  history: [],
  historyIndex: -1,
  current: null,
  context: null,
  usingSlug: '',
  drawerOpen: false,
  inspectorOpen: false,
  pendingPrivateChat: null,
  pendingServiceCall: null,
  visits: [],
  status: 'loading',
  error: ''
};

var elements = {};

function textValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, function (char) {
    return ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char];
  });
}

function safeUrl(rawValue) {
  var value = textValue(rawValue);
  if (!value) return '';
  if (value.charAt(0) === '/' && value.slice(0, 2) !== '//') return value;
  try {
    var parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch (error) {
    return '';
  }
}

function bindElements() {
  elements = {
    input: document.querySelector('[data-browser-uri-input]'),
    form: document.querySelector('[data-browser-address-form]'),
    back: document.querySelector('[data-browser-back]'),
    forward: document.querySelector('[data-browser-forward]'),
    reload: document.querySelector('[data-browser-reload]'),
    drawerToggle: document.querySelector('[data-browser-drawer-toggle]'),
    resourceChip: document.querySelector('[data-browser-resource-chip]'),
    usingChip: document.querySelector('[data-browser-using-selector]'),
    viewport: document.querySelector('[data-browser-viewport]'),
    statusState: document.querySelector('[data-browser-status-state]'),
    statusProof: document.querySelector('[data-browser-status-proof]'),
    statusRenderer: document.querySelector('[data-browser-status-renderer]'),
    statusTxid: document.querySelector('[data-browser-status-txid]'),
    drawer: document.querySelector('[data-browser-drawer]'),
    inspector: document.querySelector('[data-browser-inspector]'),
    modalRoot: document.querySelector('[data-browser-modal-root]')
  };
}

async function api(url, options) {
  var response = await fetch(url, options || {});
  var payload = await response.json();
  if (!payload || payload.ok !== true) {
    var message = payload && payload.message ? payload.message : 'Request failed.';
    var error = new Error(message);
    error.payload = payload;
    throw error;
  }
  return payload.data;
}

function setStatus(nextStatus, message) {
  state.status = nextStatus;
  state.error = message || '';
  if (elements.statusState) elements.statusState.textContent = nextStatus;
}

function renderUsingIdentity() {
  var identity = state.context && state.context.defaultUsingIdentity;
  if (elements.usingChip) {
    elements.usingChip.textContent = identity && identity.name
      ? 'Using: ' + identity.name
      : 'Using: No Bot';
  }
}

function renderNoLocalBot() {
  setStatus('ready', '');
  state.current = null;
  if (elements.resourceChip) elements.resourceChip.textContent = 'No resource';
  if (elements.statusProof) elements.statusProof.textContent = 'unverified';
  if (elements.statusRenderer) elements.statusRenderer.textContent = 'renderer: none';
  if (elements.statusTxid) elements.statusTxid.textContent = 'TXID: -';
  if (elements.viewport) {
    elements.viewport.innerHTML = '<section class="browser-empty-state" data-browser-empty-state><h2>No local Bot</h2><a class="browser-primary-action" href="/ui/bot">Create Bot</a></section>';
  }
}

function pushHistory(uri) {
  if (!uri) return;
  if (state.history[state.historyIndex] === uri) return;
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(uri);
  state.historyIndex = state.history.length - 1;
}

function renderCurrent() {
  var current = state.current;
  if (!current) return;
  var ownerName = textValue(current.owner && current.owner.name) || textValue(current.title) || 'Resource';
  var rendererType = textValue(current.renderer && current.renderer.type) || 'unsupported';
  var proofState = textValue(current.status && current.status.verificationState) || 'unverified';
  var txid = textValue(current.proof && current.proof.txid);
  if (elements.resourceChip) elements.resourceChip.textContent = ownerName;
  if (elements.statusProof) elements.statusProof.textContent = proofState;
  if (elements.statusRenderer) elements.statusRenderer.textContent = 'renderer: ' + rendererType;
  if (elements.statusTxid) elements.statusTxid.textContent = 'TXID: ' + (txid || '-');
  if (elements.viewport) {
    elements.viewport.innerHTML = renderRenderer(current);
  }
}

function recordVisit(current) {
  if (!current) return;
  state.visits.push({
    uri: textValue(current.normalizedUri) || textValue(current.uri),
    title: textValue(current.title) || textValue(current.owner && current.owner.name) || textValue(current.normalizedUri),
    resourceType: textValue(current.resourceType)
  });
}

function uniqueRecent(type) {
  var seen = {};
  var output = [];
  for (var index = state.visits.length - 1; index >= 0; index -= 1) {
    var visit = state.visits[index];
    if (type && visit.resourceType !== type) continue;
    if (!visit.uri || seen[visit.uri]) continue;
    seen[visit.uri] = true;
    output.push(visit);
    if (output.length >= 6) break;
  }
  return output;
}

function renderVisitList(items) {
  if (!items.length) return '<p class="browser-panel-empty">None</p>';
  return '<ul>' + items.map(function (item) {
    return '<li><button type="button" data-browser-visit-uri="' + escapeHtml(item.uri) + '">' + escapeHtml(item.title || item.uri) + '</button><span>' + escapeHtml(item.uri) + '</span></li>';
  }).join('') + '</ul>';
}

function renderDrawer() {
  if (!elements.drawer) return;
  elements.drawer.innerHTML = '<section class="browser-drawer-panel"><h2>Bookmarks</h2><p class="browser-panel-empty">No bookmarks</p>' +
    '<h2>Recent Bots</h2>' + renderVisitList(uniqueRecent('bot')) +
    '<h2>Recent MetaApps</h2>' + renderVisitList(uniqueRecent('metaapp')) +
    '<h2>Visit History</h2>' + renderVisitList(state.visits.slice().reverse()) + '</section>';
}

function toggleDrawer() {
  state.drawerOpen = !state.drawerOpen;
  if (elements.drawer) {
    elements.drawer.hidden = !state.drawerOpen;
  }
  if (state.drawerOpen) renderDrawer();
}

function keyValue(label, value) {
  var text = textValue(value);
  if (!text) return '';
  return '<dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(text) + '</dd>';
}

function renderInspector() {
  if (!elements.inspector || !state.current) return;
  var current = state.current;
  var owner = current.owner || {};
  var proof = current.proof || {};
  var source = current.source || {};
  elements.inspector.innerHTML = '<section class="browser-inspector-panel">' +
    '<h3>Identity</h3><dl>' +
    keyValue('name', owner.name || current.title) +
    keyValue('GlobalMetaId', owner.globalMetaId) +
    keyValue('metaid', owner.metaid) +
    keyValue('address', owner.address) +
    keyValue('verification', owner.verificationState) +
    '</dl><h3>Proof</h3><dl>' +
    keyValue('TXID', proof.txid) +
    keyValue('pin id', proof.pinId) +
    keyValue('protocol path', proof.protocolPath) +
    keyValue('content hash', proof.contentHash) +
    keyValue('publisher GlobalMetaId', proof.publisherGlobalMetaId) +
    keyValue('block explorer URL', proof.explorerUrl) +
    keyValue('verification', proof.verificationState) +
    '</dl><h3>Source</h3><dl>' +
    keyValue('resolver', source.resolver) +
    keyValue('URL', source.url) +
    keyValue('schema', source.schemaVersion) +
    '</dl><pre>' + escapeHtml(JSON.stringify(source.raw || {}, null, 2)) + '</pre></section>';
}

function openInspector() {
  state.inspectorOpen = true;
  if (elements.inspector) {
    elements.inspector.hidden = false;
  }
  renderInspector();
}

function renderActionButtons(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return '';
  return '<div class="browser-action-row">' + actions.map(function (action) {
    var kind = textValue(action && action.kind);
    var label = textValue(action && action.label) || kind || 'Action';
    var disabled = action && action.enabled === false ? ' disabled' : '';
    return '<button type="button" data-browser-action="' + escapeHtml(kind) + '" data-browser-action-id="' + escapeHtml(textValue(action && action.id)) + '"' + disabled + '>' + escapeHtml(label) + '</button>';
  }).join('') + '</div>';
}

function renderBotPage(current) {
  var data = current.renderer && current.renderer.data && typeof current.renderer.data === 'object'
    ? current.renderer.data
    : {};
  var profile = data.profile && typeof data.profile === 'object' ? data.profile : {};
  var homepage = data.homepage && typeof data.homepage === 'object' ? data.homepage : {};
  var services = Array.isArray(data.services) ? data.services : [];
  var avatar = safeUrl(profile.avatar || (current.owner && current.owner.avatar));
  var name = textValue(profile.name) || textValue(homepage.title) || textValue(current.title);
  var globalMetaId = textValue(data.globalMetaId) || textValue(current.owner && current.owner.globalMetaId);
  var summary = textValue(homepage.summary) || textValue(profile.bio);
  var servicesHtml = services.length
    ? '<section class="browser-bot-services"><h3>Services</h3>' + services.map(function (service) {
      var serviceName = textValue(service.displayName) || textValue(service.serviceName) || textValue(service.id) || 'Service';
      var serviceDescription = textValue(service.description);
      return '<article class="browser-service-row"><strong>' + escapeHtml(serviceName) + '</strong>' +
        (serviceDescription ? '<p>' + escapeHtml(serviceDescription) + '</p>' : '') +
        '<button type="button" data-browser-action="service-call" data-service-id="' + escapeHtml(textValue(service.currentPinId || service.servicePinId || service.pinId || service.id)) + '">Request</button></article>';
    }).join('') + '</section>'
    : '';
  return '<article class="browser-bot-page">' +
    (avatar ? '<img class="browser-bot-avatar" src="' + escapeHtml(avatar) + '" alt="" />' : '') +
    '<div class="browser-bot-main"><h2>' + escapeHtml(name || 'Bot') + '</h2>' +
    (globalMetaId ? '<p class="browser-globalmetaid">' + escapeHtml(globalMetaId) + '</p>' : '') +
    (summary ? '<p class="browser-bot-summary">' + escapeHtml(summary) + '</p>' : '') +
    renderActionButtons(current.actions) +
    servicesHtml + '</div></article>';
}

function servicesFromCurrent() {
  var current = state.current || {};
  var renderer = current.renderer || {};
  var data = renderer.data && typeof renderer.data === 'object' ? renderer.data : {};
  return Array.isArray(data.services) ? data.services : [];
}

function servicePinId(service) {
  return textValue(service && (service.currentPinId || service.servicePinId || service.pinId || service.id));
}

function findService(serviceId) {
  var services = servicesFromCurrent();
  var targetId = textValue(serviceId);
  if (!targetId) return services[0] || null;
  for (var index = 0; index < services.length; index += 1) {
    var service = services[index];
    if (servicePinId(service) === targetId || textValue(service && service.id) === targetId) {
      return service;
    }
  }
  return services[0] || null;
}

function renderModal(title, bodyHtml, confirmLabel, confirmAction) {
  if (!elements.modalRoot) return;
  elements.modalRoot.hidden = false;
  elements.modalRoot.innerHTML = '<section class="browser-modal-panel" role="dialog" aria-modal="true">' +
    '<header><h2>' + escapeHtml(title) + '</h2><button type="button" data-browser-modal-close aria-label="Close">Close</button></header>' +
    '<div class="browser-modal-body">' + bodyHtml + '</div>' +
    '<footer><button type="button" data-browser-modal-close>Cancel</button>' +
    '<button type="button" data-browser-modal-confirm data-browser-modal-action="' + escapeHtml(confirmAction) + '">' + escapeHtml(confirmLabel) + '</button></footer></section>';
}

function closeModal() {
  state.pendingPrivateChat = null;
  state.pendingServiceCall = null;
  if (elements.modalRoot) {
    elements.modalRoot.hidden = true;
    elements.modalRoot.innerHTML = '';
  }
}

function usingLabel() {
  var identity = state.context && state.context.defaultUsingIdentity;
  return textValue(identity && identity.name) || textValue(state.usingSlug) || 'Current Bot';
}

async function copyUri(action) {
  var uri = textValue(action && action.uri) ||
    textValue(state.current && state.current.normalizedUri) ||
    textValue(state.current && state.current.uri);
  if (!uri) {
    setStatus('error', 'No URI to copy.');
    return;
  }
  if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(uri);
  }
  setStatus('copied', '');
}

function openPrivateChatModal() {
  if (!state.current || !state.current.owner || !state.current.owner.globalMetaId) {
    setStatus('error', 'Target Bot is missing.');
    return;
  }
  state.pendingPrivateChat = {
    to: state.current.owner.globalMetaId,
    targetName: textValue(state.current.owner.name) || textValue(state.current.title) || state.current.owner.globalMetaId
  };
  renderModal(
    'Private Chat',
    '<dl>' + keyValue('using', usingLabel()) + keyValue('target', state.pendingPrivateChat.targetName) + '</dl>' +
      '<textarea data-browser-private-chat-message rows="5" placeholder="Message"></textarea>',
    'Send',
    'private-chat'
  );
}

async function confirmPrivateChat(messageText) {
  var pending = state.pendingPrivateChat;
  var content = textValue(messageText);
  if (!pending || !content) {
    setStatus('error', 'Message is required.');
    return null;
  }
  var result = await api(browserEndpoints.privateChat, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: state.usingSlug || undefined,
      to: pending.to,
      content: content
    })
  });
  closeModal();
  setStatus('sent', '');
  return result;
}

function openServiceCallModal(action) {
  var service = findService(action && action.serviceId);
  if (!service) {
    setStatus('error', 'No callable service found.');
    return;
  }
  var pinId = servicePinId(service);
  var providerGlobalMetaId = textValue(service.providerGlobalMetaId) || textValue(state.current && state.current.owner && state.current.owner.globalMetaId);
  var serviceName = textValue(service.displayName) || textValue(service.serviceName) || textValue(service.name) || pinId || 'Service';
  state.pendingServiceCall = {
    service: service,
    servicePinId: pinId,
    providerGlobalMetaId: providerGlobalMetaId,
    serviceName: serviceName
  };
  renderModal(
    'Request Service',
    '<dl>' + keyValue('using', usingLabel()) + keyValue('service', serviceName) +
      keyValue('service pin id', pinId) + keyValue('provider GlobalMetaId', providerGlobalMetaId) +
      keyValue('price', textValue(service.price) ? textValue(service.price) + ' ' + textValue(service.currency || '') : '') + '</dl>' +
      '<textarea data-browser-service-task rows="5" placeholder="Request"></textarea>',
    'Request',
    'service-call'
  );
}

async function confirmServiceCall(userTaskText) {
  var pending = state.pendingServiceCall;
  var userTask = textValue(userTaskText);
  if (!pending || !pending.servicePinId || !pending.providerGlobalMetaId || !userTask) {
    setStatus('error', 'Service request is incomplete.');
    return null;
  }
  var result = await api(browserEndpoints.serviceCall, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: state.usingSlug || undefined,
      request: {
        servicePinId: pending.servicePinId,
        providerGlobalMetaId: pending.providerGlobalMetaId,
        userTask: userTask,
        taskContext: 'Requested from Agent Internet Browser',
        rawRequest: userTask,
        confirmed: true
      }
    })
  });
  closeModal();
  setStatus('requested', '');
  return result;
}

async function handleTrustedAction(action) {
  var kind = textValue(action && action.kind);
  if (kind === 'copy') return copyUri(action);
  if (kind === 'private-chat') return openPrivateChatModal(action);
  if (kind === 'service-call') return openServiceCallModal(action);
  if (kind === 'service-list') return openServiceCallModal(action);
  if (kind === 'proof' || kind === 'creator') return openInspector();
  setStatus('error', 'Unsupported action.');
  return null;
}

function renderBlockedRenderer(message) {
  return '<section class="browser-empty-state" data-browser-renderer-blocked><h2>Renderer URL blocked</h2><p>' + escapeHtml(message || 'Renderer URL blocked.') + '</p></section>';
}

function renderRenderer(current) {
  var renderer = current.renderer || {};
  var type = textValue(renderer.type) || 'unsupported';
  var url = safeUrl(renderer.url);
  if (type === 'bot-page') {
    return renderBotPage(current);
  }
  if (['html-iframe', 'pdf', 'image', 'video'].includes(type) && !url) {
    return renderBlockedRenderer('Renderer URL blocked.');
  }
  if (type === 'html-iframe') {
    return '<iframe class="browser-html-frame" sandbox src="' + escapeHtml(url) + '"></iframe>';
  }
  if (type === 'pdf') {
    return '<section class="browser-pdf-wrap"><iframe class="browser-pdf" src="' + escapeHtml(url) + '"></iframe><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">Open PDF</a></section>';
  }
  if (type === 'image') {
    return '<img class="browser-image" src="' + escapeHtml(url) + '" alt="" />';
  }
  if (type === 'video') {
    return '<video class="browser-video" src="' + escapeHtml(url) + '" controls></video>';
  }
  return '<section class="browser-empty-state" data-browser-unsupported-renderer><h2>Unsupported renderer</h2><p>' + escapeHtml(renderer.error || 'Unsupported renderer.') + '</p></section>';
}

function resolveUrl(uri) {
  var query = new URLSearchParams();
  query.set('uri', uri);
  if (state.usingSlug) query.set('from', state.usingSlug);
  return browserEndpoints.resolve + '?' + query.toString();
}

async function resolveUri(uri, options) {
  var normalizedUri = textValue(uri);
  if (!normalizedUri) return null;
  var shouldRecord = !options || options.record !== false;
  if (elements.input) elements.input.value = normalizedUri;
  if (shouldRecord) pushHistory(normalizedUri);
  setStatus('loading', '');
  try {
    var result = await api(resolveUrl(normalizedUri));
    state.current = result;
    recordVisit(result);
    setStatus('resolved', '');
    renderCurrent();
    return result;
  } catch (error) {
    setStatus('error', error && error.message ? error.message : 'Resolve failed.');
    if (elements.viewport) {
      elements.viewport.innerHTML = '<section class="browser-empty-state"><h2>Resolve failed</h2><p>' + escapeHtml(state.error) + '</p></section>';
    }
    return null;
  }
}

function navigateTo(uri) {
  return resolveUri(uri, { record: true });
}

function reloadCurrent() {
  var uri = state.history[state.historyIndex] || (elements.input && elements.input.value) || '';
  return resolveUri(uri, { record: false });
}

function goBack() {
  if (state.historyIndex <= 0) return null;
  state.historyIndex -= 1;
  return resolveUri(state.history[state.historyIndex], { record: false });
}

function goForward() {
  if (state.historyIndex >= state.history.length - 1) return null;
  state.historyIndex += 1;
  return resolveUri(state.history[state.historyIndex], { record: false });
}

async function loadContext() {
  var data = await api(browserEndpoints.context);
  state.context = data;
  var identity = data && data.defaultUsingIdentity;
  state.usingSlug = identity && identity.slug ? identity.slug : '';
  renderUsingIdentity();
  return data;
}

async function initialize() {
  bindElements();
  if (elements.viewport) {
    elements.viewport.addEventListener('click', function (event) {
      var target = event && event.target && event.target.getAttribute ? event.target : null;
      if (!target) return;
      var kind = target.getAttribute('data-browser-action');
      if (!kind) return;
      handleTrustedAction({
        kind: kind,
        id: target.getAttribute('data-browser-action-id') || '',
        serviceId: target.getAttribute('data-service-id') || ''
      });
    });
  }
  if (elements.modalRoot) {
    elements.modalRoot.addEventListener('click', function (event) {
      var target = event && event.target && event.target.getAttribute ? event.target : null;
      if (!target) return;
      if (target.getAttribute('data-browser-modal-close') !== null) {
        closeModal();
        return;
      }
      var action = target.getAttribute('data-browser-modal-action');
      if (action === 'private-chat') {
        var input = elements.modalRoot.querySelector('[data-browser-private-chat-message]');
        confirmPrivateChat(input ? input.value : '');
      }
      if (action === 'service-call') {
        var task = elements.modalRoot.querySelector('[data-browser-service-task]');
        confirmServiceCall(task ? task.value : '');
      }
    });
  }
  if (elements.form) {
    elements.form.addEventListener('submit', function (event) {
      event.preventDefault();
      navigateTo(elements.input ? elements.input.value : '');
    });
  }
  if (elements.back) elements.back.addEventListener('click', goBack);
  if (elements.forward) elements.forward.addEventListener('click', goForward);
  if (elements.reload) elements.reload.addEventListener('click', reloadCurrent);
  if (elements.drawerToggle) elements.drawerToggle.addEventListener('click', toggleDrawer);
  if (elements.resourceChip) elements.resourceChip.addEventListener('click', openInspector);
  if (elements.statusProof) elements.statusProof.addEventListener('click', openInspector);
  if (elements.statusTxid) elements.statusTxid.addEventListener('click', openInspector);

  var queryUri = new URLSearchParams(window.location.search || '').get('uri') || '';
  if (queryUri) {
    if (elements.input) elements.input.value = queryUri;
    await navigateTo(queryUri);
    return;
  }

  var context = await loadContext();
  if (context && context.defaultUri) {
    await navigateTo(context.defaultUri);
    return;
  }
  renderNoLocalBot();
}

globalThis.browserEndpoints = browserEndpoints;
globalThis.state = state;
globalThis.api = api;
globalThis.bindElements = bindElements;
globalThis.safeUrl = safeUrl;
globalThis.renderRenderer = renderRenderer;
globalThis.renderDrawer = renderDrawer;
globalThis.openInspector = openInspector;
globalThis.renderInspector = renderInspector;
globalThis.handleTrustedAction = handleTrustedAction;
globalThis.confirmPrivateChat = confirmPrivateChat;
globalThis.confirmServiceCall = confirmServiceCall;
globalThis.closeModal = closeModal;
globalThis.loadContext = loadContext;
globalThis.resolveUri = resolveUri;
globalThis.navigateTo = navigateTo;
globalThis.reloadCurrent = reloadCurrent;
globalThis.goBack = goBack;
globalThis.goForward = goForward;
globalThis.initialize = initialize;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}`;
}
