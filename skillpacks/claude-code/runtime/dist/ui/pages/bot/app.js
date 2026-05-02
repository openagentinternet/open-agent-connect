"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotPageDefinition = buildBotPageDefinition;
function buildBotPageDefinition() {
    return {
        page: 'bot',
        title: 'Bot Management — Open Agent Connect',
        eyebrow: 'LLM Runtime Bindings',
        heading: 'Bot Management',
        description: 'Discover local LLM runtimes and manage which MetaBot uses which LLM.',
        panels: [],
        script: buildBotPageScript(),
    };
}
function buildBotPageScript() {
    return "(function() {\n" +
        "var q = function(s) { return document.querySelector(s); };\n" +
        "var qq = function(s) { return document.querySelectorAll(s); };\n" +
        "\n" +
        "var state = { profiles: [], runtimes: [], bindings: [], preferredRuntimeId: null, selectedSlug: '' };\n" +
        "\n" +
        "function hdot(h) { return '<span class=\"health-dot ' + (h||'unknown') + '\" title=\"' + (h||'unknown') + '\"></span>'; }\n" +
        "\n" +
        "function api(url, opts) {\n" +
        "  return fetch(url, opts).then(function(r) {\n" +
        "    if (!r.ok) throw new Error('HTTP ' + r.status);\n" +
        "    return r.json();\n" +
        "  });\n" +
        "}\n" +
        "\n" +
        "function renderRuntimes() {\n" +
        "  var p = q('[data-runtimes-panel]'); if (!p) return;\n" +
        "  if (!state.runtimes.length) { p.innerHTML = '<p class=\"dim\">No runtimes discovered. Click Discover.</p>'; return; }\n" +
        "  p.innerHTML = state.runtimes.map(function(r) {\n" +
        "    return '<div class=\"runtime-card\" data-runtime-id=\"' + r.id + '\">' +\n" +
        "      '<div class=\"flex-row\"><span class=\"name\">' + hdot(r.health) + (r.displayName||r.provider) + '</span>' +\n" +
        "      '<span class=\"meta\">v' + (r.version||'?') + '</span></div>' +\n" +
        "      '<div class=\"meta\">' + (r.binaryPath||'no binary') + ' · ' + (r.authState||'unknown') + '</div></div>';\n" +
        "  }).join('');\n" +
        "}\n" +
        "\n" +
        "function renderBindings() {\n" +
        "  var p = q('[data-bindings-panel]'); var sl = q('[data-slug-label]');\n" +
        "  if (!p) return;\n" +
        "  if (sl) sl.textContent = state.selectedSlug ? 'Bindings for: ' + state.selectedSlug : '';\n" +
        "  if (!state.selectedSlug) { p.innerHTML = '<p class=\"dim\">Select a profile to manage its bindings.</p>'; renderAdd(false); return; }\n" +
        "  if (!state.bindings.length) { p.innerHTML = '<p class=\"dim\">No bindings. Add one below.</p>'; renderAdd(true); return; }\n" +
        "  var h = '';\n" +
        "  for (var i = 0; i < state.bindings.length; i++) {\n" +
        "    var b = state.bindings[i];\n" +
        "    var rn = b.llmRuntimeId;\n" +
        "    var rt = state.runtimes.find(function(r) { return r.id === b.llmRuntimeId; });\n" +
        "    if (rt) rn = rt.displayName || rt.provider;\n" +
        "    h += '<div class=\"binding-row' + (b.enabled?'':' disabled-row') + '\" data-binding-id=\"' + b.id + '\">' +\n" +
        "      '<span class=\"binding-role ' + b.role + '\">' + b.role + '</span>' +\n" +
        "      '<span class=\"binding-runtime\">' + rn + '</span>' +\n" +
        "      '<span class=\"meta\">priority=' + b.priority + '</span>' +\n" +
        "      '<label class=\"toggle-label\"><input type=\"checkbox\" data-tog data-bid=\"' + b.id + '\"' + (b.enabled?' checked':'') + '> enabled</label>' +\n" +
        "      '<button class=\"btn-sm\" data-del data-bid=\"' + b.id + '\">Remove</button></div>';\n" +
        "  }\n" +
        "  p.innerHTML = h;\n" +
        "  qq('[data-tog]').forEach(function(cb) {\n" +
        "    cb.addEventListener('change', function() {\n" +
        "      var id = this.getAttribute('data-bid');\n" +
        "      var b = state.bindings.find(function(x) { return x.id === id; });\n" +
        "      if (b) { b.enabled = this.checked; saveBindings(); }\n" +
        "    });\n" +
        "  });\n" +
        "  qq('[data-del]').forEach(function(btn) {\n" +
        "    btn.addEventListener('click', function() {\n" +
        "      var id = this.getAttribute('data-bid');\n" +
        "      state.bindings = state.bindings.filter(function(x) { return x.id !== id; });\n" +
        "      saveBindings();\n" +
        "    });\n" +
        "  });\n" +
        "  renderAdd(true); renderPref();\n" +
        "}\n" +
        "\n" +
        "function renderAdd(show) {\n" +
        "  var p = q('[data-add-binding-panel]'); if (!p) return;\n" +
        "  if (!show) { p.innerHTML = ''; return; }\n" +
        "  var ropts = state.runtimes.map(function(r) {\n" +
        "    return '<option value=\"' + r.id + '\">' + (r.displayName||r.provider) + ' (' + (r.health||'?') + ')</option>';\n" +
        "  }).join('');\n" +
        "  p.innerHTML = '<div class=\"add-binding-row\">' +\n" +
        "    '<select data-nr>' + ropts + '</select>' +\n" +
        "    '<select data-nrole><option value=\"primary\">primary</option><option value=\"fallback\">fallback</option><option value=\"reviewer\">reviewer</option><option value=\"specialist\">specialist</option></select>' +\n" +
        "    '<input type=\"number\" data-npri value=\"0\" min=\"0\" style=\"width:60px\">' +\n" +
        "    '<button class=\"btn\" data-add-btn>Add Binding</button></div>';\n" +
        "  q('[data-add-btn]').addEventListener('click', function() {\n" +
        "    var rid = q('[data-nr]').value; var role = q('[data-nrole]').value;\n" +
        "    var pri = parseInt(q('[data-npri]').value,10)||0;\n" +
        "    if (!rid) return;\n" +
        "    var id = 'lb_' + state.selectedSlug + '_' + rid + '_' + role;\n" +
        "    state.bindings = state.bindings.filter(function(b) { return !(b.llmRuntimeId===rid && b.role===role); });\n" +
        "    state.bindings.push({id:id,metaBotSlug:state.selectedSlug,llmRuntimeId:rid,role:role,priority:pri,enabled:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});\n" +
        "    saveBindings();\n" +
        "  });\n" +
        "}\n" +
        "\n" +
        "function renderPref() {\n" +
        "  var p = q('[data-preferred-panel]'); if (!p) return;\n" +
        "  var ropts = '<option value=\"\">(none)</option>' + state.runtimes.map(function(r) {\n" +
        "    var sel = state.preferredRuntimeId === r.id ? ' selected' : '';\n" +
        "    return '<option value=\"' + r.id + '\"' + sel + '>' + (r.displayName||r.provider) + '</option>';\n" +
        "  }).join('');\n" +
        "  p.innerHTML = '<div class=\"add-binding-row\"><label>Preferred Runtime: </label>' +\n" +
        "    '<select data-pr>' + ropts + '</select>' +\n" +
        "    '<button class=\"btn\" data-save-pr-btn>Save</button></div>';\n" +
        "  q('[data-save-pr-btn]').addEventListener('click', function() {\n" +
        "    savePref(q('[data-pr]').value || null);\n" +
        "  });\n" +
        "}\n" +
        "\n" +
        "function loadRuntimes() {\n" +
        "  var p = q('[data-runtimes-panel]'); if (p) p.innerHTML = '<p class=\"dim\">Loading...</p>';\n" +
        "  api('/api/llm/runtimes').then(function(r) {\n" +
        "    state.runtimes = r.data.runtimes || [];\n" +
        "    renderRuntimes();\n" +
        "    if (state.selectedSlug) loadBindingsFor(state.selectedSlug);\n" +
        "  }).catch(function() { if (p) p.innerHTML = '<p class=\"dim\">Failed to load runtimes.</p>'; });\n" +
        "}\n" +
        "\n" +
        "function loadProfiles() {\n" +
        "  api('/api/identity/profiles').then(function(r) {\n" +
        "    state.profiles = r.data.profiles || [];\n" +
        "    renderProfileSelector();\n" +
        "  }).catch(function() {});\n" +
        "}\n" +
        "\n" +
        "function loadBindingsFor(slug) {\n" +
        "  state.selectedSlug = slug;\n" +
        "  api('/api/llm/bindings/' + encodeURIComponent(slug)).then(function(r) {\n" +
        "    state.bindings = r.data.bindings || [];\n" +
        "    return api('/api/llm/preferred-runtime/' + encodeURIComponent(slug));\n" +
        "  }).then(function(pr) {\n" +
        "    state.preferredRuntimeId = (pr.data && pr.data.runtimeId) || null;\n" +
        "    renderBindings();\n" +
        "  }).catch(function() { state.bindings = []; state.preferredRuntimeId = null; renderBindings(); });\n" +
        "}\n" +
        "\n" +
        "function saveBindings() {\n" +
        "  api('/api/llm/bindings/' + encodeURIComponent(state.selectedSlug), {\n" +
        "    method: 'PUT', headers: {'content-type':'application/json'},\n" +
        "    body: JSON.stringify({bindings:state.bindings}),\n" +
        "  }).then(function() { renderBindings(); }).catch(function(e) { alert('Failed to save: ' + e.message); });\n" +
        "}\n" +
        "\n" +
        "function savePref(rid) {\n" +
        "  api('/api/llm/preferred-runtime/' + encodeURIComponent(state.selectedSlug), {\n" +
        "    method: 'PUT', headers: {'content-type':'application/json'},\n" +
        "    body: JSON.stringify({runtimeId:rid}),\n" +
        "  }).then(function() { state.preferredRuntimeId = rid; renderPref(); }).catch(function(e) { alert('Failed: ' + e.message); });\n" +
        "}\n" +
        "\n" +
        "function discoverRuntimes() {\n" +
        "  var btn = q('[data-discover-btn]'); btn.disabled = true; btn.textContent = 'Scanning...';\n" +
        "  api('/api/llm/runtimes/discover', {method:'POST'}).then(function() { loadRuntimes(); }).finally(function() {\n" +
        "    btn.disabled = false; btn.textContent = 'Discover Runtimes';\n" +
        "  });\n" +
        "}\n" +
        "\n" +
        "function renderProfileSelector() {\n" +
        "  var c = q('[data-profile-selector]'); if (!c || !state.profiles.length) return;\n" +
        "  var opts = state.profiles.map(function(p) {\n" +
        "    var sel = state.selectedSlug === p.slug ? ' selected' : '';\n" +
        "    return '<option value=\"' + p.slug + '\"' + sel + '>' + p.name + ' (' + p.slug + ')</option>';\n" +
        "  }).join('');\n" +
        "  c.innerHTML = '<label>MetaBot Profile: </label><select data-ps>' +\n" +
        "    '<option value=\"\">-- select --</option>' + opts + '</select>';\n" +
        "  q('[data-ps]').addEventListener('change', function() {\n" +
        "    var slug = this.value; if (slug) loadBindingsFor(slug);\n" +
        "  });\n" +
        "}\n" +
        "\n" +
        "document.addEventListener('DOMContentLoaded', function() {\n" +
        "  loadRuntimes(); loadProfiles();\n" +
        "  q('[data-discover-btn]').addEventListener('click', discoverRuntimes);\n" +
        "});\n" +
        "})()";
}
