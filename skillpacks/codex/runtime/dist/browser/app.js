"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBrowserPageDefinition = buildBrowserPageDefinition;
const browser_1 = require("@openagentinternet/agent-browser-ui/browser");
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
// The ABC bridge client runs in the host (parent) document. OAC overrides three
// bridge behaviors that a headless Node host must own:
//   1. metafile.upload  -> host-owned <input type=file> picker + base64 POST
//   2. metaid.pin.write -> two-phase confirmation (phase 1 returns a host token
//      that never reaches the MetaApp iframe; the host completes phase 2)
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

  // Problem 2: two-phase pin-write confirmation. Phase 1 returns
  // manual_action_required + confirmRequest carrying a host token. The token is
  // consumed host-side (never handed to the MetaApp). The host re-submits the
  // action with confirmRequest.payload to complete phase 2.
  if (typeof handleBridgePinWrite === 'function') {
    handleBridgePinWrite = function oacHandleBridgePinWrite(sourceWindow, id, params) {
      var validation = validatePinWriteParams(params);
      if (!validation.ok) {
        bridgePostMessage(sourceWindow, bridgeResponse(id, false, validation.error));
        return;
      }
      function submitPinWrite(payload) {
        var body = JSON.stringify({
          resourceUri: currentResourceUri(),
          kind: 'metaid-pin-write',
          payload: payload
        });
        return commandApi(endpointWithActor(browserEndpoints.actions), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: body
        });
      }
      function fail(code, message) {
        bridgePostMessage(sourceWindow, bridgeResponse(id, false, {
          code: code || 'pin_write_failed',
          message: message || 'MetaID PIN write failed.'
        }));
      }
      submitPinWrite(validation.value).then(function (result) {
        bridgePostMessage(sourceWindow, bridgeResponse(id, true, result));
      }).catch(function (phase1Error) {
        var phase1 = phase1Error && phase1Error.payload ? phase1Error.payload : null;
        var confirmRequest = phase1 && phase1.data ? phase1.data.confirmRequest : null;
        // Only the OAC host returns confirmRequest. If absent, surface the error.
        if (!confirmRequest) {
          fail(textValue(phase1 && phase1.code) || textValue(phase1Error && phase1Error.code),
               textValue(phase1 && phase1.message) || textValue(phase1Error && phase1Error.message));
          return;
        }
        var confirmation = phase1.data.confirmation || {};
        var display = confirmation.display || {};
        var title = textValue(display.title) || 'Confirm on-chain write';
        var summary = textValue(display.summary);
        var rows = [
          row('Operation', confirmation.operation),
          row('Path', confirmation.path),
          row('Type', confirmation.contentType)
        ];
        if (typeof confirmation.payloadSize === 'number') {
          rows.push(row('Size', confirmation.payloadSize + ' bytes'));
        }
        if (summary) rows.unshift('<p class="browser-confirm-summary">' + escapeHtml(summary) + '</p>');
        var bodyHtml = '<section class="browser-confirm-panel">' + rows.join('') +
          '<p class="browser-confirm-note">Approving signs and broadcasts this MetaID write on chain.</p></section>';
        renderModal(title, bodyHtml, 'Confirm', 'oac-pin-confirm');
        function cleanup() {
          document.removeEventListener('click', onConfirm, true);
          document.removeEventListener('click', onCancel, true);
        }
        function onConfirm(event) {
          if (!closestWithAttribute(event.target, 'data-browser-modal-action') || closestWithAttribute(event.target, 'data-browser-modal-action').getAttribute('data-browser-modal-action') !== 'oac-pin-confirm') return;
          event.preventDefault();
          event.stopPropagation();
          cleanup();
          closeModal();
          submitPinWrite(confirmRequest.payload).then(function (phase2) {
            bridgePostMessage(sourceWindow, bridgeResponse(id, true, phase2));
          }).catch(function (phase2Error) {
            var p = phase2Error && phase2Error.payload ? phase2Error.payload : null;
            fail(textValue(p && p.code) || textValue(phase2Error && phase2Error.code),
                 textValue(p && p.message) || textValue(phase2Error && phase2Error.message));
          });
        }
        function onCancel(event) {
          var closeTarget = closestWithAttribute(event.target, 'data-browser-modal-close');
          if (!closeTarget) return;
          cleanup();
          closeModal();
          fail('user_cancelled', 'MetaID PIN write was cancelled.');
        }
        document.addEventListener('click', onConfirm, true);
        document.addEventListener('click', onCancel, true);
      });
    };
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

  function row(label, value) {
    var text = textValue(value);
    if (!text) return '';
    return '<div class="browser-confirm-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(text) + '</strong></div>';
  }
})();
`;
const BROWSER_INITIALIZATION_MARKER = `
if (document.readyState === 'loading') {`;
function injectOacBrowserScriptAdapters(script) {
    if (script.includes(BROWSER_INITIALIZATION_MARKER)) {
        return script.replace(BROWSER_INITIALIZATION_MARKER, `${OAC_BROWSER_SCRIPT_ADAPTERS}${BROWSER_INITIALIZATION_MARKER}`);
    }
    return `${script}\n${OAC_BROWSER_SCRIPT_ADAPTERS}`;
}
function buildBrowserPageDefinition() {
    const definition = (0, browser_1.buildBrowserPageDefinition)();
    return {
        ...definition,
        script: injectOacBrowserScriptAdapters(definition.script),
    };
}
