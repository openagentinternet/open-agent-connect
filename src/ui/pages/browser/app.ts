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
    elements.viewport.innerHTML = '<section class="browser-resource-loading"><h2>' + escapeHtml(current.title || ownerName) + '</h2></section>';
  }
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
  if (elements.form) {
    elements.form.addEventListener('submit', function (event) {
      event.preventDefault();
      navigateTo(elements.input ? elements.input.value : '');
    });
  }
  if (elements.back) elements.back.addEventListener('click', goBack);
  if (elements.forward) elements.forward.addEventListener('click', goForward);
  if (elements.reload) elements.reload.addEventListener('click', reloadCurrent);

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
