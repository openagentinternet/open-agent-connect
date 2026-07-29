import {
  buildBrowserPageDefinition as buildAbcBrowserPageDefinition,
} from '@openagentinternet/agent-browser-ui/browser';

export interface BrowserPagePanelDefinition {
  title: string;
  body: string;
  items?: string[];
  actionLabel?: string;
  actionHref?: string;
}

export interface BrowserPageDefinition {
  page: 'browser';
  title: string;
  eyebrow: string;
  heading: string;
  description: string;
  panels: BrowserPagePanelDefinition[];
  contentHtml?: string;
  script: string;
}

const OAC_BROWSER_SCRIPT_ADAPTERS = `
if (
  typeof endpointWithActor === 'function'
  && typeof browserSettingsEndpoint === 'function'
  && browserEndpoints
  && typeof browserEndpoints === 'object'
  && typeof browserEndpoints.settings === 'string'
) {
  browserSettingsEndpoint = function browserSettingsEndpoint() {
    return endpointWithActor(browserEndpoints.settings);
  };
}

// ---- OAC Browser host bridge adapters ----
// The ABC bridge client runs in the host (parent) document. OAC overrides
// bridge behaviors that a headless Node host must own:
//   1. metafile.upload  -> host-owned <input type=file> picker + base64 POST
//   2. tab actions      -> subscribe to daemon-pushed tab opens and feed them to
//      ABC's client-only AgentBrowserTabs API (fire-and-forget transport only)
//   3. loadRuntime      -> re-emit browser.actor.changed once runtime is ready
// All referenced helpers (commandApi, renderModal, closeModal, showToast, ...) are
// declared at the same script scope, so they are in scope here.
(function oacBrowserHostAdapters() {
  function oacReadFileAsBase64(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = reader.result;
        if (typeof result !== 'string') { resolve(''); return; }
        var comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = function () { resolve(''); };
      reader.readAsDataURL(file);
    });
  }

  function oacUploadEntryPayload(file) {
    return oacReadFileAsBase64(file).then(function (base64) {
      return { name: file.name || 'upload', contentType: file.type || '', data: base64 };
    });
  }

  // Problem 1: host-owned file picker. The MetaApp requests a host picker; OAC
  // opens a real <input type=file>, reads the bytes, and POSTs them to the
  // /api/browser/metafile-upload endpoint which signs and broadcasts the PIN.
  if (typeof handleBridgeMetafileUpload === 'function') {
    handleBridgeMetafileUpload = function oacHandleBridgeMetafileUpload(sourceWindow, id, params) {
      var validation = validateMetafileUploadParams(params);
      if (!validation.ok) {
        bridgePostMessage(sourceWindow, bridgeResponse(id, false, validation.error));
        return;
      }
      var picker = document.createElement('input');
      picker.type = 'file';
      picker.style.display = 'none';
      var accept = validation.value && validation.value.source && validation.value.source.accept;
      if (Array.isArray(accept) && accept.length) picker.accept = accept.join(',');
      picker.multiple = !!(validation.value && validation.value.source && validation.value.source.multiple);
      picker.addEventListener('change', function () {
        var fileList = picker.files;
        document.body.removeChild(picker);
        if (!fileList || !fileList.length) {
          bridgePostMessage(sourceWindow, bridgeResponse(id, false, {
            code: 'user_cancelled',
            message: 'MetaFile upload was cancelled.'
          }));
          return;
        }
        var selected = Array.prototype.slice.call(fileList, 0);
        if (!picker.multiple) selected = selected.slice(0, 1);
        Promise.all(selected.map(oacUploadEntryPayload)).then(function (entries) {
          var body = {
            resourceUri: currentResourceUri(),
            source: validation.value.source,
            entries: entries
          };
          if (validation.value.purpose) body.purpose = validation.value.purpose;
          return commandApi(endpointWithActor(browserEndpoints.metafileUpload), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          });
        }).then(function (data) {
          bridgePostMessage(sourceWindow, bridgeResponse(id, true, data));
        }).catch(function (error) {
          var payload = error && error.payload ? error.payload : null;
          bridgePostMessage(sourceWindow, bridgeResponse(id, false, {
            code: textValue(payload && payload.code) || textValue(error && error.code) || 'upload_failed',
            message: textValue(payload && payload.message) || textValue(error && error.message) || 'MetaFile upload failed.'
          }));
        });
      });
      document.body.appendChild(picker);
      picker.click();
    };
  }

  // Problem 2: subscribe to daemon-pushed tab actions (e.g. an external
  // "metabot browser tab open --uri" call) and feed them to ABC's built-in
  // AgentBrowserTabs API. ABC tabs are strictly client-only and session-level,
  // so this listener carries fire-and-forget transport only; it holds no tab
  // state and never reports tab ids back to the daemon.
  if (typeof globalThis !== 'undefined'
    && typeof globalThis.EventSource === 'function'
    && !globalThis.__oacBrowserTabEventSource) {
    try {
      var tabSource = new globalThis.EventSource('/api/browser/events');
      globalThis.__oacBrowserTabEventSource = tabSource;
      tabSource.addEventListener('agent-browser:open-tab', function (event) {
        if (!globalThis.AgentBrowserTabs || typeof globalThis.AgentBrowserTabs.openTab !== 'function') return;
        var data = {};
        try { data = event.data ? JSON.parse(event.data) : {}; } catch (_) { /* best-effort */ }
        var uri = data && typeof data.uri === 'string' ? data.uri : '';
        globalThis.AgentBrowserTabs.openTab(uri || undefined);
      });
    } catch (_) { /* EventSource is best-effort; never break the page */ }
  }

  // Problem 3: once runtime is ready, re-emit browser.actor.changed so MetaApps
  // that subscribe to the event (instead of polling browser.actor.current) learn
  // the current actor. Also warn when the selected Bot has no Global MetaID.
  if (typeof loadRuntime === 'function') {
    var originalLoadRuntime = loadRuntime;
    loadRuntime = function oacLoadRuntime() {
      return originalLoadRuntime.apply(this, arguments).then(function (data) {
        try {
          var actor = sanitizedActorSnapshot(selectedActor());
          emitBridgeEvent('browser.actor.changed', { actor: actor });
          if (!actor && state.actorId) {
            showToast('The selected Bot has no Global MetaID; some MetaApps cannot identify it.');
          }
        } catch (_) { /* bridge events are best-effort */ }
        return data;
      });
    };
    if (typeof globalThis !== 'undefined') globalThis.loadRuntime = loadRuntime;
  }
})();
`;

const BROWSER_INITIALIZATION_MARKER = `
if (document.readyState === 'loading') {`;

function injectOacBrowserScriptAdapters(script: string): string {
  if (script.includes(BROWSER_INITIALIZATION_MARKER)) {
    return script.replace(
      BROWSER_INITIALIZATION_MARKER,
      `${OAC_BROWSER_SCRIPT_ADAPTERS}${BROWSER_INITIALIZATION_MARKER}`,
    );
  }
  return `${script}\n${OAC_BROWSER_SCRIPT_ADAPTERS}`;
}

export function buildBrowserPageDefinition(): BrowserPageDefinition {
  const definition = buildAbcBrowserPageDefinition() as BrowserPageDefinition;
  return {
    ...definition,
    script: injectOacBrowserScriptAdapters(definition.script),
  };
}
