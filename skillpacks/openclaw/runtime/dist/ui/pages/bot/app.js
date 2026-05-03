"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotPageDefinition = buildBotPageDefinition;
function buildBotPageDefinition() {
    return {
        page: 'bot',
        title: 'Bot Management — Open Agent Connect',
        eyebrow: 'LLM Runtime Bindings',
        heading: 'Bot Management',
        description: 'Discover local LLM runtimes and manage MetaBot bindings.',
        panels: [],
        script: buildBotPageScript(),
    };
}
function buildBotPageScript() {
    return "var q=function(s){return document.querySelector(s)};\n" +
        "var qq=function(s){return document.querySelectorAll(s)};\n" +
        "var state={profiles:[],runtimes:[],bindings:[],preferredRuntimeId:null,selectedSlug:''};\n" +
        "\n" +
        "function api(url,opts){return fetch(url,opts).then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})}\n" +
        "function ago(t){if(!t)return'never';var d=Date.now()-new Date(t).getTime();if(d<6e4)return'just now';if(d<36e5)return Math.floor(d/6e4)+'m ago';if(d<864e5)return Math.floor(d/36e5)+'h ago';return Math.floor(d/864e5)+'d ago'}\n" +
        "\n" +
        "function pill(h){var m={healthy:'online',degraded:'recent',unavailable:'offline'};var c=m[h]||'offline';return'<span class=\"status-pill status-'+c+'\"><span class=\"status-dot\"></span>'+h+'</span>'}\n" +
        "\n" +
        "function renderStats(){\n" +
        "  q('[data-stat-runtimes]').textContent=state.runtimes.length||'—';\n" +
        "  q('[data-stat-profiles]').textContent=state.profiles.length||'—';\n" +
        "  q('[data-stat-bindings]').textContent=state.bindings.length||'—';\n" +
        "  q('[data-stat-active]').textContent=state.selectedSlug||'—';\n" +
        "  var b=q('[data-runtime-count-badge]');if(b)b.textContent=state.runtimes.length+' available';\n" +
        "}\n" +
        "\n" +
        "function renderRuntimes(){\n" +
        "  var tb=q('[data-runtime-list]');if(!tb)return;\n" +
        "  if(!state.runtimes.length){tb.innerHTML='<tr><td colspan=\"5\" class=\"table-empty\"><strong>No runtimes discovered</strong>Click discover to scan PATH.</td></tr>';return}\n" +
        "  tb.innerHTML=state.runtimes.map(function(r){return'<tr>'+\n" +
        "    '<td><div class=\"rt-name\">'+(r.displayName||r.provider)+'</div></td>'+\n" +
        "    '<td><div class=\"rt-path\">'+(r.binaryPath||'—')+'</div></td>'+\n" +
        "    '<td><span class=\"rt-version\">'+(r.version?'v'+r.version:'—')+'</span></td>'+\n" +
        "    '<td><span class=\"rt-auth '+(r.authState==='authenticated'?'ok':'nope')+'\">'+(r.authState||'unknown')+'</span></td>'+\n" +
        "    '<td>'+pill(r.health)+'</td></tr>'}).join('');\n" +
        "  var b=q('[data-runtime-count-badge]');if(b)b.textContent=state.runtimes.length+' available';\n" +
        "}\n" +
        "\n" +
        "function renderBindings(){\n" +
        "  var tb=q('[data-binding-list]');var w=q('[data-bindings-table-wrap]');var em=q('[data-no-bindings]');\n" +
        "  var bdg=q('[data-binding-count-badge]');var pf=q('[data-preferred-label]');if(!tb)return;\n" +
        "  if(!state.selectedSlug){if(w)w.style.display='none';if(em)em.style.display='none';if(bdg)bdg.textContent='—';if(pf)pf.textContent='';tb.innerHTML='';return}\n" +
        "  if(pf){var prt=state.runtimes.find(function(r){return r.id===state.preferredRuntimeId});pf.textContent=prt?'preferred: '+(prt.displayName||prt.provider):'no preferred runtime'}\n" +
        "  if(!state.bindings.length){\n" +
        "    if(w)w.style.display='none';if(em)em.style.display='';if(bdg)bdg.textContent='0 bindings';tb.innerHTML='';renderPrefSelect();return}\n" +
        "  if(w)w.style.display='';if(em)em.style.display='none';if(bdg)bdg.textContent=state.bindings.length+' binding'+(state.bindings.length>1?'s':'');\n" +
        "  tb.innerHTML=state.bindings.map(function(b){\n" +
        "    var rn=b.llmRuntimeId;var rt=state.runtimes.find(function(r){return r.id===b.llmRuntimeId});if(rt)rn=rt.displayName||rt.provider;\n" +
        "    var ip=state.preferredRuntimeId===b.llmRuntimeId?' <span class=\"preferred-indicator\">★ preferred</span>':'';\n" +
        "    return'<tr class=\"'+(b.enabled?'':'disabled-row')+'\" data-bid=\"'+b.id+'\">'+\n" +
        "      '<td><span class=\"binding-role-badge '+b.role+'\">'+b.role+'</span></td>'+\n" +
        "      '<td><span class=\"binding-runtime-name\">'+rn+ip+'</span></td>'+\n" +
        "      '<td><span class=\"binding-priority\">'+b.priority+'</span></td>'+\n" +
        "      '<td><span class=\"binding-last-used\">'+ago(b.lastUsedAt)+'</span></td>'+\n" +
        "      '<td class=\"toggle-cell\" data-act=\"toggle\" data-bid=\"'+b.id+'\">'+(b.enabled?'✔':'✘')+'</td>'+\n" +
        "      '<td><button class=\"btn btn-sm btn-danger\" data-act=\"delete\" data-bid=\"'+b.id+'\">remove</button></td></tr>'}).join('');\n" +
        "  qq('[data-act=\"toggle\"]').forEach(function(el){el.addEventListener('click',function(){var id=this.getAttribute('data-bid');var b=state.bindings.find(function(x){return x.id===id});if(b){b.enabled=!b.enabled;saveBindings()}})});\n" +
        "  qq('[data-act=\"delete\"]').forEach(function(el){el.addEventListener('click',function(){var id=this.getAttribute('data-bid');state.bindings=state.bindings.filter(function(x){return x.id!==id});saveBindings()})});\n" +
        "  renderAddForm();renderPrefSelect();\n" +
        "}\n" +
        "\n" +
        "function renderAddForm(){\n" +
        "  var s=q('[data-new-runtime]');if(!s)return;\n" +
        "  s.innerHTML=state.runtimes.map(function(r){return'<option value=\"'+r.id+'\">'+(r.displayName||r.provider)+' ('+(r.health||'?')+')</option>'}).join('');\n" +
        "}\n" +
        "\n" +
        "function renderPrefSelect(){\n" +
        "  var s=q('[data-preferred-runtime]');if(!s)return;\n" +
        "  s.innerHTML='<option value=\"\">(none — fall back to priority bindings)</option>'+state.runtimes.map(function(r){var sel=state.preferredRuntimeId===r.id?' selected':'';return'<option value=\"'+r.id+'\"'+sel+'>'+(r.displayName||r.provider)+'</option>'}).join('');\n" +
        "}\n" +
        "\n" +
        "function renderProfileSelect(){\n" +
        "  var s=q('[data-profile-select]');if(!s)return;\n" +
        "  s.innerHTML='<option value=\"\">-- select a profile --</option>'+state.profiles.map(function(p){var sel=state.selectedSlug===p.slug?' selected':'';return'<option value=\"'+p.slug+'\"'+sel+'>'+p.name+' ('+p.slug+')</option>'}).join('');\n" +
        "  s.addEventListener('change',function(){var slug=this.value;if(slug)loadProfile(slug)});\n" +
        "}\n" +
        "\n" +
        "function loadRuntimes(){\n" +
        "  var tb=q('[data-runtime-list]');if(tb)tb.innerHTML='<tr><td colspan=\"5\" class=\"table-empty\"><strong>Loading…</strong></td></tr>';\n" +
        "  api('/api/llm/runtimes').then(function(r){state.runtimes=r.data.runtimes||[];renderRuntimes();renderStats();if(state.selectedSlug)renderBindings();else renderAddForm()}).catch(function(){if(tb)tb.innerHTML='<tr><td colspan=\"5\" class=\"table-empty\"><strong>Failed to load</strong>Is the daemon running?</td></tr>'})\n" +
        "}\n" +
        "\n" +
        "function loadProfiles(){\n" +
        "  api('/api/identity/profiles').then(function(r){state.profiles=r.data.profiles||[];renderProfileSelect();renderStats()}).catch(function(){})\n" +
        "}\n" +
        "\n" +
        "function loadProfile(slug){\n" +
        "  state.selectedSlug=slug;\n" +
        "  var m=q('[data-profile-meta]');var p=state.profiles.find(function(x){return x.slug===slug});if(m)m.textContent=p?(p.globalMetaId||''):'';\n" +
        "  api('/api/llm/bindings/'+encodeURIComponent(slug)).then(function(r){state.bindings=r.data.bindings||[];return api('/api/llm/preferred-runtime/'+encodeURIComponent(slug))}).then(function(pr){state.preferredRuntimeId=(pr.data&&pr.data.runtimeId)||null;renderBindings();renderStats()}).catch(function(){state.bindings=[];state.preferredRuntimeId=null;renderBindings();renderStats()})\n" +
        "}\n" +
        "\n" +
        "function saveBindings(){\n" +
        "  api('/api/llm/bindings/'+encodeURIComponent(state.selectedSlug),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({bindings:state.bindings})}).then(function(){renderBindings();renderStats()}).catch(function(e){alert('Failed: '+e.message)})\n" +
        "}\n" +
        "\n" +
        "function savePreferred(rid){\n" +
        "  api('/api/llm/preferred-runtime/'+encodeURIComponent(state.selectedSlug),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({runtimeId:rid||null})}).then(function(){state.preferredRuntimeId=rid;renderBindings()}).catch(function(e){alert('Failed: '+e.message)})\n" +
        "}\n" +
        "\n" +
        "function discoverRuntimes(){\n" +
        "  var btn=q('#discover-btn');btn.disabled=true;btn.textContent='scanning…';\n" +
        "  api('/api/llm/runtimes/discover',{method:'POST'}).then(function(){return loadRuntimes()}).finally(function(){btn.disabled=false;btn.textContent='↻ discover'})\n" +
        "}\n" +
        "\n" +
        "document.addEventListener('DOMContentLoaded',function(){\n" +
        "  loadRuntimes();loadProfiles();\n" +
        "  q('#discover-btn').addEventListener('click',discoverRuntimes);\n" +
        "  q('#add-binding-btn').addEventListener('click',function(){\n" +
        "    var rid=q('[data-new-runtime]').value;var role=q('[data-new-role]').value;var pri=parseInt(q('[data-new-priority]').value,10)||0;\n" +
        "    if(!rid||!state.selectedSlug)return;\n" +
        "    var id='lb_'+state.selectedSlug+'_'+rid+'_'+role;\n" +
        "    state.bindings=state.bindings.filter(function(b){return!(b.llmRuntimeId===rid&&b.role===role)});\n" +
        "    state.bindings.push({id:id,metaBotSlug:state.selectedSlug,llmRuntimeId:rid,role:role,priority:pri,enabled:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});\n" +
        "    saveBindings();\n" +
        "  });\n" +
        "  q('#save-preferred-btn').addEventListener('click',function(){var val=q('[data-preferred-runtime]').value||null;savePreferred(val)});\n" +
        "})";
}
