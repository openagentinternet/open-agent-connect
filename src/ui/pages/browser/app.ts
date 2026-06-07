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
        <div class="browser-titlebar" aria-label="Agent Internet Browser">
          <div class="browser-window-brand">
            <span class="browser-brand-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="8"></circle><path d="M4 12h16M12 4c2.2 2.3 3.3 5 3.3 8S14.2 17.7 12 20M12 4C9.8 6.3 8.7 9 8.7 12s1.1 5.7 3.3 8"></path></svg>
            </span>
            <span>Bot Browser</span>
          </div>
          <div class="browser-window-actions" aria-hidden="true"><span></span><span></span><span></span></div>
        </div>
        <header class="browser-topbar" data-browser-topbar>
          <nav class="browser-nav" aria-label="Browser navigation">
            <button type="button" class="browser-icon-button" data-browser-back aria-label="Back">
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M15 6l-6 6 6 6"></path></svg>
            </button>
            <button type="button" class="browser-icon-button" data-browser-forward aria-label="Forward">
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M9 6l6 6-6 6"></path></svg>
            </button>
            <button type="button" class="browser-icon-button" data-browser-reload aria-label="Reload">
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 5v6h-6"></path></svg>
            </button>
            <button type="button" class="browser-icon-button" data-browser-drawer-toggle aria-label="Bookmarks and history" aria-expanded="false">
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M9 5v14M13 9h4M13 13h4"></path></svg>
            </button>
          </nav>
          <form class="browser-address-form" data-browser-address-form>
            <span class="browser-address-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"></path><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"></path></svg>
            </span>
            <input data-browser-uri-input aria-label="Agent Internet URI" placeholder="metaid://idq1example" />
            <button type="submit" class="browser-address-submit" aria-label="Visit URI">
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path></svg>
            </button>
          </form>
          <button type="button" class="browser-resource-chip" data-browser-resource-chip aria-expanded="false">
            <span class="browser-chip-avatar browser-avatar-fallback" aria-hidden="true">R</span>
            <span class="browser-chip-copy"><span class="browser-chip-title">Resource</span><span class="browser-chip-subtitle">No resource</span></span>
            <span class="browser-chip-proof" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false"><path d="M12 3l7 3v5c0 4.1-2.8 7.9-7 10-4.2-2.1-7-5.9-7-10V6l7-3z"></path><path d="M8.8 12l2.1 2.1 4.5-4.7"></path></svg>
            </span>
          </button>
          <button type="button" class="browser-using-chip" data-browser-using-selector aria-expanded="false">
            <span class="browser-chip-avatar browser-avatar-fallback" aria-hidden="true">M</span>
            <span class="browser-chip-copy"><span class="browser-chip-title">Using: My Bot</span></span>
            <span class="browser-chip-caret" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false"><path d="M6 9l6 6 6-6"></path></svg>
            </span>
          </button>
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

function shortId(value) {
  var text = textValue(value);
  if (!text) return '';
  if (text.length <= 18) return text;
  return text.slice(0, 10) + '...' + text.slice(-6);
}

function compactText(value, limit) {
  var text = textValue(value).replace(/\\s+/g, ' ');
  var maxLength = limit || 260;
  if (text.length <= maxLength) return text;
  var truncated = text.slice(0, maxLength - 3).replace(/\\s+\\S*$/, '');
  return (truncated || text.slice(0, maxLength - 3)) + '...';
}

function readableText(value) {
  var text = textValue(value);
  if (!text) return '';
  var first = text.charAt(0);
  if (first === '{' || first === '[') {
    try {
      var parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        var preferred = [
          textValue(parsed.summary),
          textValue(parsed.bio),
          textValue(parsed.description),
          textValue(parsed.role),
          textValue(parsed.goal),
          textValue(parsed.soul)
        ].filter(Boolean);
        if (preferred.length) return compactText(preferred.slice(0, 2).join(' '));
      }
    } catch (error) {
      return compactText(text);
    }
  }
  return compactText(text);
}

function initials(value) {
  var text = textValue(value);
  if (!text) return 'B';
  var parts = text.split(/\\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  return text.slice(0, 2).toUpperCase();
}

function iconHtml(name) {
  var icons = {
    activity: '<path d="M4 12h4l2-6 4 12 2-6h4"></path>',
    bot: '<rect x="5" y="7" width="14" height="10" rx="3"></rect><path d="M9 7V5h6v2M9 12h.1M15 12h.1"></path>',
    bookmark: '<path d="M7 4h10v16l-5-3-5 3V4z"></path>',
    chevronDown: '<path d="M6 9l6 6 6-6"></path>',
    chevronRight: '<path d="M9 6l6 6-6 6"></path>',
    close: '<path d="M6 6l12 12M18 6L6 18"></path>',
    copy: '<rect x="8" y="8" width="10" height="10" rx="2"></rect><path d="M6 14H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1"></path>',
    external: '<path d="M14 5h5v5"></path><path d="M10 14L19 5"></path><path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"></path>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5M12 7v5l3 2"></path>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"></path><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"></path>',
    message: '<path d="M5 6h14v9H8l-3 3V6z"></path>',
    service: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"></path><path d="M4.4 7.8L12 12l7.6-4.2M12 12v8.5"></path>',
    shield: '<path d="M12 3l7 3v5c0 4.1-2.8 7.9-7 10-4.2-2.1-7-5.9-7-10V6l7-3z"></path><path d="M8.8 12l2.1 2.1 4.5-4.7"></path>'
  };
  return '<svg class="browser-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">' + (icons[name] || icons.link) + '</svg>';
}

function avatarHtml(rawUrl, label, className) {
  var url = safeUrl(rawUrl);
  var classValue = className || 'browser-chip-avatar';
  if (url) {
    return '<span class="' + classValue + ' browser-avatar-image-wrap" aria-hidden="true"><img class="browser-avatar-image" src="' + escapeHtml(url) + '" alt="" /></span>';
  }
  return '<span class="' + classValue + ' browser-avatar-fallback" aria-hidden="true">' + escapeHtml(initials(label)) + '</span>';
}

function proofTone(value) {
  var stateValue = textValue(value).toLowerCase();
  if (stateValue === 'verified' || stateValue === 'resolved') return 'verified';
  if (stateValue === 'partial') return 'partial';
  return 'unverified';
}

function proofIconHtml(value) {
  return '<span class="browser-proof-icon browser-proof-' + proofTone(value) + '" aria-hidden="true">' + iconHtml('shield') + '</span>';
}

function actionIconName(kind) {
  if (kind === 'private-chat') return 'message';
  if (kind === 'service-call' || kind === 'service-list') return 'service';
  if (kind === 'copy') return 'copy';
  if (kind === 'proof' || kind === 'creator') return 'shield';
  return 'chevronRight';
}

function closestWithAttribute(target, attributeName) {
  var cursor = target;
  while (cursor && typeof cursor.getAttribute === 'function') {
    if (typeof cursor.hasAttribute === 'function') {
      if (cursor.hasAttribute(attributeName)) return cursor;
    } else if (cursor.getAttribute(attributeName) !== null && cursor.getAttribute(attributeName) !== undefined) {
      return cursor;
    }
    cursor = cursor.parentElement;
  }
  return null;
}

function bindElements() {
  elements = {
    shell: document.querySelector('[data-browser-shell]'),
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
    var name = identity && identity.name ? textValue(identity.name) : 'No Bot';
    elements.usingChip.innerHTML = avatarHtml(identity && identity.avatar, name, 'browser-chip-avatar') +
      '<span class="browser-chip-copy"><span class="browser-chip-title">Using: ' + escapeHtml(name) + '</span></span>' +
      '<span class="browser-chip-caret" aria-hidden="true">' + iconHtml('chevronDown') + '</span>';
    if (typeof elements.usingChip.setAttribute === 'function') {
      elements.usingChip.setAttribute('aria-expanded', 'false');
    }
    elements.usingChip.disabled = !(state.context && Array.isArray(state.context.usingIdentities) && state.context.usingIdentities.length);
  }
}

function renderNoLocalBot() {
  setStatus('ready', '');
  state.current = null;
  if (elements.resourceChip) {
    elements.resourceChip.innerHTML = avatarHtml('', 'Resource', 'browser-chip-avatar') +
      '<span class="browser-chip-copy"><span class="browser-chip-title">No resource</span><span class="browser-chip-subtitle">Create a local Bot</span></span>' +
      '<span class="browser-chip-proof" aria-hidden="true">' + iconHtml('shield') + '</span>';
  }
  if (elements.statusProof) elements.statusProof.innerHTML = proofIconHtml('unverified') + '<span>unverified</span>';
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
  var ownerName = textValue(current.title) || textValue(current.owner && current.owner.name) || 'Resource';
  var ownerId = textValue(current.owner && (current.owner.globalMetaId || current.owner.metaid || current.owner.address)) || textValue(current.normalizedUri || current.uri);
  var ownerAvatar = textValue(current.owner && current.owner.avatar);
  var rendererType = textValue(current.renderer && current.renderer.type) || 'unsupported';
  var proofState = textValue(current.status && current.status.verificationState) || 'unverified';
  var txid = textValue(current.proof && current.proof.txid);
  if (elements.resourceChip) {
    elements.resourceChip.innerHTML = avatarHtml(ownerAvatar, ownerName, 'browser-chip-avatar') +
      '<span class="browser-chip-copy"><span class="browser-chip-title">' + escapeHtml(ownerName) + '</span>' +
      '<span class="browser-chip-subtitle">' + escapeHtml(shortId(ownerId)) + '</span></span>' +
      '<span class="browser-chip-proof" aria-hidden="true">' + iconHtml('shield') + '</span>';
  }
  if (elements.statusProof) elements.statusProof.innerHTML = proofIconHtml(proofState) + '<span>' + escapeHtml(proofState) + '</span>';
  if (elements.statusRenderer) elements.statusRenderer.textContent = 'renderer: ' + rendererType;
  if (elements.statusTxid) elements.statusTxid.textContent = 'TXID: ' + (shortId(txid) || '-');
  if (elements.viewport) {
    elements.viewport.innerHTML = renderRenderer(current);
  }
  syncPanelState();
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
    var resourceType = textValue(item.resourceType);
    var iconName = resourceType === 'metaapp' ? 'service' : resourceType === 'bot' ? 'bot' : 'history';
    var selected = state.current && textValue(state.current.normalizedUri || state.current.uri) === textValue(item.uri);
    return '<li><button type="button" class="browser-drawer-row"' + (selected ? ' aria-current="page"' : '') +
      ' data-browser-visit-uri="' + escapeHtml(item.uri) + '">' +
      '<span class="browser-drawer-icon" aria-hidden="true">' + iconHtml(iconName) + '</span>' +
      '<span class="browser-drawer-copy"><strong>' + escapeHtml(item.title || item.uri) + '</strong><span>' + escapeHtml(shortId(item.uri)) + '</span></span>' +
      '</button></li>';
  }).join('') + '</ul>';
}

function bookmarkItems() {
  var items = [];
  var defaultUri = textValue(state.context && state.context.defaultUri);
  if (defaultUri) {
    var identity = state.context && state.context.defaultUsingIdentity;
    items.push({
      uri: defaultUri,
      title: textValue(identity && identity.name) || 'My Bot',
      resourceType: 'bot'
    });
  }
  if (state.current) {
    items.push({
      uri: textValue(state.current.normalizedUri || state.current.uri),
      title: textValue(state.current.title) || textValue(state.current.owner && state.current.owner.name) || 'Current resource',
      resourceType: textValue(state.current.resourceType)
    });
  }
  var seen = {};
  return items.filter(function (item) {
    if (!item.uri || seen[item.uri]) return false;
    seen[item.uri] = true;
    return true;
  });
}

function renderDrawer() {
  if (!elements.drawer) return;
  elements.drawer.innerHTML = '<section class="browser-drawer-panel"><header class="browser-panel-header"><h2>Library</h2>' +
    '<button type="button" class="browser-icon-button" data-browser-drawer-close aria-label="Close drawer">' + iconHtml('close') + '</button></header>' +
    '<h3>Bookmarks</h3>' + renderVisitList(bookmarkItems()) +
    '<h2>Recent Bots</h2>' + renderVisitList(uniqueRecent('bot')) +
    '<h2>History</h2>' + renderVisitList(state.visits.slice().reverse()) + '</section>';
}

function syncPanelState() {
  if (elements.shell && elements.shell.classList) {
    elements.shell.classList.toggle('has-drawer', state.drawerOpen);
    elements.shell.classList.toggle('has-inspector', state.inspectorOpen);
  }
  if (elements.drawerToggle && typeof elements.drawerToggle.setAttribute === 'function') {
    elements.drawerToggle.setAttribute('aria-expanded', state.drawerOpen ? 'true' : 'false');
  }
  if (elements.resourceChip && typeof elements.resourceChip.setAttribute === 'function') {
    elements.resourceChip.setAttribute('aria-expanded', state.inspectorOpen ? 'true' : 'false');
  }
  if (elements.statusProof && typeof elements.statusProof.setAttribute === 'function') {
    elements.statusProof.setAttribute('aria-expanded', state.inspectorOpen ? 'true' : 'false');
  }
  if (elements.statusTxid && typeof elements.statusTxid.setAttribute === 'function') {
    elements.statusTxid.setAttribute('aria-expanded', state.inspectorOpen ? 'true' : 'false');
  }
}

function closeDrawer() {
  state.drawerOpen = false;
  if (elements.drawer) {
    elements.drawer.hidden = !state.drawerOpen;
  }
  syncPanelState();
}

function toggleDrawer() {
  state.drawerOpen = !state.drawerOpen;
  if (elements.drawer) {
    elements.drawer.hidden = !state.drawerOpen;
  }
  syncPanelState();
  if (state.drawerOpen) renderDrawer();
}

function keyValue(label, value) {
  var text = textValue(value);
  if (!text) return '';
  return '<dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(text) + '</dd>';
}

function requiredKeyValue(label, value) {
  var text = textValue(value) || '-';
  return '<dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(text) + '</dd>';
}

function renderInspector() {
  if (!elements.inspector || !state.current) return;
  var current = state.current;
  var owner = current.owner || {};
  var proof = current.proof || {};
  var source = current.source || {};
  var renderer = current.renderer || {};
  var proofState = textValue(proof.verificationState || (current.status && current.status.verificationState)) || 'unverified';
  var explorerUrl = safeUrl(proof.explorerUrl);
  var identityHeading = ['Identity'].join('');
  var proofHeading = ['Proof'].join('');
  var sourceHeading = ['Source'].join('');
  var explorerAction = explorerUrl
    ? '<a class="browser-inspector-action" href="' + escapeHtml(explorerUrl) + '" target="_blank" rel="noopener">View on Block Explorer ' + iconHtml('external') + '</a>'
    : '';
  elements.inspector.innerHTML = '<section class="browser-inspector-panel">' +
    '<header class="browser-panel-header"><h2>Inspector</h2><button type="button" class="browser-icon-button" data-browser-inspector-close aria-label="Close inspector">' + iconHtml('close') + '</button></header>' +
    '<div class="browser-proof-summary">' + proofIconHtml(proofState) + '<span>' + escapeHtml(proofState) + '</span></div>' +
    '<h3>' + identityHeading + '</h3><dl>' +
    keyValue('name', owner.name || current.title) +
    keyValue('GlobalMetaId', owner.globalMetaId) +
    keyValue('metaid', owner.metaid) +
    keyValue('address', owner.address) +
    keyValue('verification', owner.verificationState) +
    '</dl><h3>' + proofHeading + '</h3><dl>' +
    requiredKeyValue('TXID', proof.txid) +
    requiredKeyValue('pin id', proof.pinId) +
    requiredKeyValue('protocol path', proof.protocolPath) +
    requiredKeyValue('content hash', proof.contentHash) +
    requiredKeyValue('publisher GlobalMetaId', proof.publisherGlobalMetaId || owner.globalMetaId) +
    requiredKeyValue('block explorer action', explorerUrl ? 'available' : 'unavailable') +
    keyValue('verification', proof.verificationState) +
    '</dl>' + explorerAction + '<h3>' + sourceHeading + '</h3><dl>' +
    keyValue('resolved URI', current.normalizedUri || current.uri) +
    keyValue('content type', renderer.contentType) +
    keyValue('renderer', renderer.type) +
    keyValue('resolver', source.resolver) +
    keyValue('source URL', source.url) +
    keyValue('local path', source.localPath || source.path) +
    keyValue('fetched at', source.fetchedAt || source.cachedAt || source.resolvedAt) +
    keyValue('schema', source.schemaVersion) +
    '</dl>' + (source.raw ? '<pre>' + escapeHtml(JSON.stringify(source.raw || {}, null, 2)) + '</pre>' : '') + '</section>';
}

function openInspector() {
  state.inspectorOpen = true;
  if (elements.inspector) {
    elements.inspector.hidden = false;
  }
  syncPanelState();
  renderInspector();
}

function closeInspector() {
  state.inspectorOpen = false;
  if (elements.inspector) {
    elements.inspector.hidden = true;
  }
  syncPanelState();
}

function renderActionButtons(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return '';
  return '<div class="browser-action-row">' + actions.map(function (action) {
    var kind = textValue(action && action.kind);
    var label = textValue(action && action.label) || kind || 'Action';
    var disabled = action && action.enabled === false ? ' disabled' : '';
    return '<button type="button" data-browser-action="' + escapeHtml(kind) + '" data-browser-action-id="' + escapeHtml(textValue(action && action.id)) + '"' + disabled + '>' +
      iconHtml(actionIconName(kind)) + '<span>' + escapeHtml(label) + '</span></button>';
  }).join('') + '</div>';
}

function renderActivityRows(data, current) {
  var activity = Array.isArray(data.activity) ? data.activity : [];
  if (!activity.length) {
    var services = Array.isArray(data.services) ? data.services : [];
    activity = services.slice(0, 2).map(function (service) {
      return {
        label: 'Service available',
        detail: textValue(service.displayName) || textValue(service.serviceName) || textValue(service.id) || 'Service'
      };
    });
    activity.push({
      label: textValue(current.status && current.status.state) === 'resolved' ? 'Profile resolved' : (textValue(current.status && current.status.state) || 'Profile resolved'),
      detail: textValue(current.normalizedUri || current.uri)
    });
  }
  return activity.slice(0, 5).map(function (item) {
    var label = textValue(item && (item.label || item.title || item.kind)) || 'Activity';
    var detail = textValue(item && (item.detail || item.description || item.uri || item.createdAt || item.timestamp));
    return '<article class="browser-activity-row"><span class="browser-row-icon" aria-hidden="true">' + iconHtml('activity') + '</span>' +
      '<div><strong>' + escapeHtml(label) + '</strong>' +
      (detail ? '<p>' + escapeHtml(detail) + '</p>' : '') + '</div></article>';
  }).join('');
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
  var summary = readableText(homepage.summary) || readableText(profile.bio);
  var proofState = textValue(current.status && current.status.verificationState) || 'unverified';
  var overview = summary || 'This Bot has not published an overview yet.';
  var servicesHtml = services.length
    ? services.map(function (service) {
      var serviceName = textValue(service.displayName) || textValue(service.serviceName) || textValue(service.id) || 'Service';
      var serviceDescription = textValue(service.description);
      return '<article class="browser-service-row"><span class="browser-row-icon" aria-hidden="true">' + iconHtml('service') + '</span>' +
        '<div><strong>' + escapeHtml(serviceName) + '</strong>' +
        (serviceDescription ? '<p>' + escapeHtml(serviceDescription) + '</p>' : '') + '</div>' +
        '<button type="button" data-browser-action="service-call" data-service-id="' + escapeHtml(textValue(service.currentPinId || service.servicePinId || service.pinId || service.id)) + '">Request</button></article>';
    }).join('')
    : '<p class="browser-muted-row">No public services.</p>';
  return '<article class="browser-bot-page">' +
    '<header class="browser-bot-header">' +
    avatarHtml(avatar, name || 'Bot', 'browser-bot-avatar') +
    '<div class="browser-bot-identity"><div class="browser-bot-title-line"><h2>' + escapeHtml(name || 'Bot') + '</h2>' + proofIconHtml(proofState) + '</div>' +
    (globalMetaId ? '<p class="browser-globalmetaid">' + escapeHtml(globalMetaId) + '</p>' : '') +
    (summary ? '<p class="browser-bot-summary">' + escapeHtml(summary) + '</p>' : '') + '</div>' +
    renderActionButtons(current.actions) + '</header>' +
    '<section class="browser-document-section"><h3>Overview</h3><p>' + escapeHtml(overview) + '</p></section>' +
    '<section class="browser-document-section browser-bot-services"><h3>Services</h3>' + servicesHtml + '</section>' +
    '<section class="browser-document-section browser-bot-activity"><h3>Recent Activity</h3>' + renderActivityRows(data, current) + '</section>' +
    '</article>';
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
  if (elements.usingChip && typeof elements.usingChip.setAttribute === 'function') {
    elements.usingChip.setAttribute('aria-expanded', 'false');
  }
  if (elements.modalRoot) {
    elements.modalRoot.hidden = true;
    elements.modalRoot.innerHTML = '';
  }
}

function openUsingIdentitySelector() {
  var identities = state.context && Array.isArray(state.context.usingIdentities)
    ? state.context.usingIdentities
    : [];
  if (!identities.length) {
    renderNoLocalBot();
    return;
  }
  if (!elements.modalRoot) return;
  if (elements.usingChip && typeof elements.usingChip.setAttribute === 'function') {
    elements.usingChip.setAttribute('aria-expanded', 'true');
  }
  elements.modalRoot.hidden = false;
  elements.modalRoot.innerHTML = '<section class="browser-modal-panel" role="dialog" aria-modal="true">' +
    '<header><h2>Using Bot</h2><button type="button" data-browser-modal-close aria-label="Close">Close</button></header>' +
    '<div class="browser-modal-body"><div class="browser-using-options">' + identities.map(function (identity) {
      var slug = textValue(identity && identity.slug);
      var name = textValue(identity && identity.name) || slug || 'Bot';
      var globalMetaId = textValue(identity && identity.globalMetaId);
      var selected = state.usingSlug && slug === state.usingSlug;
      return '<button type="button" data-browser-using-slug="' + escapeHtml(slug) + '"' + (selected ? ' aria-current="true"' : '') + '>' +
        '<strong>' + escapeHtml(name) + '</strong>' +
        (globalMetaId ? '<span>' + escapeHtml(globalMetaId) + '</span>' : '') +
        '</button>';
    }).join('') + '</div></div></section>';
}

async function selectUsingIdentity(slug) {
  var selectedSlug = textValue(slug);
  var identities = state.context && Array.isArray(state.context.usingIdentities)
    ? state.context.usingIdentities
    : [];
  var selected = null;
  for (var index = 0; index < identities.length; index += 1) {
    if (textValue(identities[index] && identities[index].slug) === selectedSlug) {
      selected = identities[index];
      break;
    }
  }
  if (!selected) {
    setStatus('error', 'Using Bot not found.');
    return null;
  }
  if (!state.context) state.context = {};
  state.context.defaultUsingIdentity = selected;
  state.usingSlug = selectedSlug;
  renderUsingIdentity();
  closeModal();
  var uri = textValue(state.current && (state.current.normalizedUri || state.current.uri)) ||
    textValue(elements.input && elements.input.value);
  if (!uri) return null;
  return resolveUri(uri, { record: false });
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
    return '<iframe class="browser-html-frame" sandbox="allow-scripts" src="' + escapeHtml(url) + '"></iframe>';
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
      var target = closestWithAttribute(event && event.target, 'data-browser-action');
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
      var closeTarget = closestWithAttribute(event && event.target, 'data-browser-modal-close');
      if (closeTarget) {
        closeModal();
        return;
      }
      var target = closestWithAttribute(event && event.target, 'data-browser-modal-action') ||
        closestWithAttribute(event && event.target, 'data-browser-using-slug');
      if (!target) return;
      var action = target.getAttribute('data-browser-modal-action');
      var usingSlug = target.getAttribute('data-browser-using-slug');
      if (usingSlug) {
        selectUsingIdentity(usingSlug);
        return;
      }
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
  if (elements.drawer) {
    elements.drawer.addEventListener('click', function (event) {
      if (closestWithAttribute(event && event.target, 'data-browser-drawer-close')) {
        closeDrawer();
        return;
      }
      var target = closestWithAttribute(event && event.target, 'data-browser-visit-uri');
      if (!target) return;
      var uri = target.getAttribute('data-browser-visit-uri');
      if (uri) {
        closeDrawer();
        navigateTo(uri);
      }
    });
  }
  if (elements.inspector) {
    elements.inspector.addEventListener('click', function (event) {
      if (closestWithAttribute(event && event.target, 'data-browser-inspector-close')) {
        closeInspector();
      }
    });
  }
  document.addEventListener('error', function (event) {
    var target = event && event.target;
    if (target && target.classList && target.classList.contains('browser-avatar-image')) {
      target.hidden = true;
    }
  }, true);
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
  if (elements.usingChip) elements.usingChip.addEventListener('click', openUsingIdentitySelector);
  if (elements.resourceChip) elements.resourceChip.addEventListener('click', openInspector);
  if (elements.statusProof) elements.statusProof.addEventListener('click', openInspector);
  if (elements.statusTxid) elements.statusTxid.addEventListener('click', openInspector);

  var queryUri = new URLSearchParams(window.location.search || '').get('uri') || '';
  var context = await loadContext();
  if (queryUri) {
    if (elements.input) elements.input.value = queryUri;
    await navigateTo(queryUri);
    return;
  }

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
globalThis.closeDrawer = closeDrawer;
globalThis.openInspector = openInspector;
globalThis.closeInspector = closeInspector;
globalThis.renderInspector = renderInspector;
globalThis.openUsingIdentitySelector = openUsingIdentitySelector;
globalThis.selectUsingIdentity = selectUsingIdentity;
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
