import type { LocalUiPageDefinition } from '../types';

export function buildBotPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'bot',
    title: 'Bot Management — Open Agent Connect',
    eyebrow: 'MetaBot Management',
    heading: 'Bot Management',
    description: 'Manage MetaBots, provider settings, and execution history.',
    panels: [],
    script: buildBotPageScript(),
  };
}

function buildBotPageScript(): string {
  return String.raw`var q=function(s){return document.querySelector(s)};
var qq=function(s){return document.querySelectorAll(s)};
var state={profiles:[],runtimes:[],sessions:[],stats:{botCount:0,healthyRuntimes:0,totalExecutions:0,successRate:0},selectedSlug:'',selectedTab:'info',originalProfile:null,_pendingAvatar:undefined,_toastTimer:null,_modalClose:null,_modalRequestSeq:0,_sensitiveModalToken:null,_deleteCountdownTimer:null,_deleteCountdown:5,_deleteWorking:false};

function api(url,opts){return fetch(url,opts).then(function(r){return r.json().catch(function(){return{ok:false,message:String(r.status)}}).then(function(body){if(!r.ok||body.ok===false){throw new Error(body.message||body.code||String(r.status))}return body})})}
function fmtTime(t){if(!t)return'-';var d=new Date(t);if(Number.isNaN(d.getTime()))return'-';return d.toLocaleString()}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){if(c==='&')return'&amp;';if(c==='<')return'&lt;';if(c==='>')return'&gt;';if(c==='"')return'&quot;';return'&#39;'})}
function statusPill(s){var m={completed:'online',running:'active',starting:'active',failed:'offline',timeout:'offline',cancelled:'offline'};var c=m[s]||'offline';return'<span class="status-pill status-'+c+'"><span class="status-dot"></span>'+esc(s||'unknown')+'</span>'}
function shortText(v,n){n=n||120;v=String(v==null?'':v).replace(/\s+/g,' ').trim();if(!v)return'-';return v.length>n?v.slice(0,Math.max(0,n-3))+'...':v}
function clampBlock(v){v=String(v==null?'':v).trim();if(!v)return'-';return v.length>700?v.slice(0,700)+'...':v}
function duration(s){var d=s&&s.result&&typeof s.result.durationMs==='number'?s.result.durationMs:null;if(d===null&&s&&s.startedAt&&s.completedAt){var a=new Date(s.startedAt).getTime();var b=new Date(s.completedAt).getTime();if(Number.isFinite(a)&&Number.isFinite(b)&&b>=a)d=b-a}return d===null?'-':d+'ms'}
function resultSummary(s){if(!s||!s.result)return'-';if(s.result.output)return s.result.output;if(s.result.error)return s.result.error;return s.result.status||'-'}
function runtimeLabel(r){var name=r.displayName||r.provider||r.id||'-';var bits=[name];if(r.health)bits.push(r.health);if(r.version)bits.push('v'+r.version);return bits.join(' / ')}
function shortId(v){v=String(v||'');if(!v)return'-';return v.length>18?v.slice(0,12)+'...'+v.slice(-4):v}
function avatarMarkup(profile,large){var value=profile&&profile.avatarDataUrl;var initials=((profile&&profile.name)||'MB').trim().slice(0,2).toUpperCase()||'MB';if(value)return'<img src="'+esc(value)+'" alt="">';return esc(initials)}
function selectedProfile(){return state.profiles.find(function(p){return p.slug===state.selectedSlug})||null}
function availableRuntimes(){return state.runtimes.filter(function(r){return (r.health==='healthy'||r.health==='degraded')&&r.provider})}
function providerDisplayName(provider){var rt=availableRuntimes().find(function(r){return r.provider===provider});return rt?runtimeLabel(rt):(provider||'No provider')}
function providerIconMarkup(provider){
  var key=String(provider||'generic');
  var icons={
    codex:'<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"></path></svg>',
    'claude-code':'<svg viewBox="0 0 16 16" fill="#D97757"><path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"></path></svg>',
    openclaw:'<svg viewBox="0 0 16 16" fill="none"><path d="M8 2C5.5 2 3.5 4 3.5 6.5S5 10.5 6.5 11v1.5H8V11c.3.1.7.1 1 0v1.5h1.5V11c1.5-.5 3-2.5 3-4.5S10.5 2 8 2Z" fill="#E8453A"></path><path d="M3.5 5.5C2 5 1 6 1.5 7s2 .5 2.2-.7M12.5 5.5c1.5-.5 2.5.5 2 1.5s-2 .5-2.2-.7" fill="#FF6B5A"></path><circle cx="6.2" cy="5.2" r=".9" fill="#050810"></circle><circle cx="9.8" cy="5.2" r=".9" fill="#050810"></circle></svg>',
    generic:'<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="11" rx="2" stroke="currentColor" stroke-width="2"></rect><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>'
  };
  var icon=icons[key]||icons.generic;
  return '<span class="provider-logo provider-logo-'+esc(key.replace(/[^a-z0-9_-]+/gi,'-'))+'" data-provider-icon="'+esc(key)+'" aria-hidden="true">'+icon+'</span>';
}
function uniqueProviderRuntimes(){
  var seen={};var rows=[];
  availableRuntimes().forEach(function(r){if(!r.provider||seen[r.provider])return;seen[r.provider]=true;rows.push(r)});
  return rows;
}
function providerPickerMarkup(field,label,selected,allowNone){
  var current=selected||'';var rows=uniqueProviderRuntimes();
  var active=rows.find(function(r){return r.provider===current});
  var buttonLabel=active?runtimeLabel(active):(current?'Provider unavailable: '+current:'(none)');
  var buttonIcon=current?providerIconMarkup(current):providerIconMarkup('generic');
  var html='<div class="field provider-field"><label>'+esc(label)+'</label>'+
    '<div class="provider-picker" data-provider-picker="'+esc(field)+'">'+
    '<input type="hidden" data-field="'+esc(field)+'" value="'+esc(current)+'" />'+
    '<button type="button" class="provider-trigger" data-provider-toggle="'+esc(field)+'">'+buttonIcon+'<span>'+esc(buttonLabel)+'</span><span class="provider-caret">v</span></button>'+
    '<div class="provider-menu" data-provider-menu="'+esc(field)+'" hidden>';
  if(allowNone){
    html+='<button type="button" class="provider-option" data-provider-option="none" data-provider-value=""'+(!current?' selected':'')+'>'+providerIconMarkup('generic')+'<span>(none)</span></button>';
  }
  rows.forEach(function(r){
    var selectedAttr=current===r.provider?' selected':'';
    html+='<button type="button" class="provider-option" data-provider-option="'+esc(r.provider)+'" data-provider-value="'+esc(r.provider)+'"'+selectedAttr+'>'+providerIconMarkup(r.provider)+'<span>'+esc(runtimeLabel(r))+'</span></button>';
  });
  if(!rows.length){
    html+='<div class="provider-empty">No healthy or degraded runtimes found</div>';
  }
  html+='</div></div></div>';
  return html;
}
function wireProviderPickers(){
  qq('[data-provider-toggle]').forEach(function(btn){
    btn.addEventListener('click',function(event){
      event.preventDefault();
      var field=this.getAttribute('data-provider-toggle');var menu=q('[data-provider-menu="'+field+'"]');
      if(!menu)return;
      qq('.provider-menu').forEach(function(other){if(other!==menu)other.setAttribute('hidden','')});
      if(menu.hasAttribute('hidden'))menu.removeAttribute('hidden');else menu.setAttribute('hidden','');
    });
  });
  qq('[data-provider-value]').forEach(function(option){
    option.addEventListener('click',function(event){
      event.preventDefault();
      var picker=this.closest('[data-provider-picker]');if(!picker)return;
      var field=picker.getAttribute('data-provider-picker');var input=picker.querySelector('[data-field="'+field+'"]');var trigger=picker.querySelector('[data-provider-toggle="'+field+'"]');
      var value=this.getAttribute('data-provider-value')||'';
      if(input){input.value=value;input.setAttribute('data-provider-touched','1')}
      if(trigger){trigger.innerHTML=(value?providerIconMarkup(value):providerIconMarkup('generic'))+'<span>'+esc(value?providerDisplayName(value):'(none)')+'</span><span class="provider-caret">v</span>'}
      picker.querySelectorAll('[data-provider-value]').forEach(function(row){row.removeAttribute('selected')});
      this.setAttribute('selected','');
      var menu=q('[data-provider-menu="'+field+'"]');if(menu)menu.setAttribute('hidden','');
    });
  });
}

function renderStats(){
  var stats=state.stats||{};
  var bots=stats.botCount!=null?stats.botCount:state.profiles.length;
  var healthy=stats.healthyRuntimes!=null?stats.healthyRuntimes:state.runtimes.filter(function(r){return r.health==='healthy'}).length;
  var total=stats.totalExecutions!=null?stats.totalExecutions:state.sessions.length;
  var rate=stats.successRate!=null?stats.successRate:(total?Math.round(state.sessions.filter(function(s){return s.status==='completed'}).length/total*100):0);
  var botEl=q('[data-stat-bots]');if(botEl)botEl.textContent=String(bots);
  var rtEl=q('[data-stat-runtimes]');if(rtEl)rtEl.textContent=String(healthy);
  var execEl=q('[data-stat-executions]');if(execEl)execEl.textContent=String(total);
  var successEl=q('[data-stat-success]');if(successEl){successEl.textContent=String(rate)+'%';successEl.className='stat-value '+(rate>=90?'green':rate>=60?'amber':total?'red':'')}
}

function renderMetabotList(){
  var list=q('[data-metabot-list]');var count=q('[data-metabot-count]');if(!list)return;
  if(count)count.textContent=String(state.profiles.length);
  if(!state.profiles.length){list.innerHTML='<div class="session-empty"><p>No MetaBots yet</p></div>';return}
  list.innerHTML=state.profiles.map(function(p){
    var selected=p.slug===state.selectedSlug?' selected':'';
    return'<div class="metabot-item'+selected+'" role="button" tabindex="0" data-slug="'+esc(p.slug)+'">'+
      '<div class="metabot-avatar">'+avatarMarkup(p,false)+'</div>'+
      '<div class="metabot-item-info"><div class="metabot-item-name">'+esc(p.name||p.slug)+'</div>'+
      '<div class="metabot-item-id-row"><span class="metabot-item-id">'+esc(shortId(p.globalMetaId||p.slug))+'</span>'+
      '<button class="icon-btn" data-act="copy-gmid" data-value="'+esc(p.globalMetaId||'')+'" title="Copy GlobalMetaID" aria-label="Copy GlobalMetaID">⧉</button></div></div></div>'
  }).join('');
  qq('.metabot-item').forEach(function(el){
    el.addEventListener('click',function(event){if(event.target&&event.target.closest('[data-act="copy-gmid"]'))return;selectMetabot(this.getAttribute('data-slug'))});
    el.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();selectMetabot(this.getAttribute('data-slug'))}});
  });
  qq('[data-act="copy-gmid"]').forEach(function(el){
    el.addEventListener('click',function(event){event.stopPropagation();copyToClipboard(this.getAttribute('data-value')||'')});
  });
}

function renderDetailHeader(profile){
  var header=q('[data-detail-header]');if(!header)return;
  if(!profile){header.hidden=true;return}
  header.hidden=false;
  var avatar=q('[data-detail-avatar]');if(avatar)avatar.innerHTML=avatarMarkup(profile,true);
  var name=q('[data-detail-name]');if(name)name.textContent=profile.name||profile.slug;
  var id=q('[data-detail-id]');if(id)id.textContent=profile.globalMetaId||profile.slug||'-';
}

function setDetailVisible(visible){
  var empty=q('[data-detail-empty]');var bar=q('[data-tab-bar]');var content=q('[data-tab-content]');
  if(empty)empty.hidden=visible;
  if(bar)bar.hidden=!visible;
  if(content)content.hidden=!visible;
}

function selectMetabot(slug){
  if(!slug)return;
  state._sensitiveModalToken=null;
  state.selectedSlug=slug;
  state.originalProfile=state.profiles.find(function(p){return p.slug===slug})||null;
  state._pendingAvatar=undefined;
  renderMetabotList();
  renderDetailHeader(state.originalProfile);
  setDetailVisible(Boolean(state.originalProfile));
  renderCurrentTab();
}

function renderCurrentTab(){
  switchTab(state.selectedTab||'info',true);
}

function renderInfoTab(){
  var profile=selectedProfile();var root=q('[data-info-content]');if(!root)return;
  if(!profile){root.innerHTML='';return}
  state.originalProfile=profile;
  var avatar=state._pendingAvatar!==undefined?state._pendingAvatar:profile.avatarDataUrl;
  root.innerHTML='<div class="info-avatar-section">'+
    '<div class="info-avatar-preview" data-avatar-preview>'+avatarMarkup({name:profile.name,avatarDataUrl:avatar},true)+'</div>'+
    '<div class="info-avatar-actions">'+
      '<button class="btn btn-sm" data-act="upload-avatar">Upload</button>'+
      '<button class="btn btn-sm btn-danger" data-act="remove-avatar"'+(avatar?'':' hidden')+'>Remove</button>'+
      '<input type="file" data-avatar-input accept="image/png,image/jpeg,image/webp,image/gif" hidden />'+
      '<span class="save-status" data-avatar-status></span>'+
    '</div></div>'+
    '<div class="info-id-row"><code>'+esc(profile.globalMetaId||'-')+'</code><button class="icon-btn" data-act="copy-profile-gmid" title="Copy GlobalMetaID" aria-label="Copy GlobalMetaID">⧉</button></div>'+
    '<div class="info-form-grid">'+
      '<div class="field"><label for="bot-name">Name</label><input id="bot-name" data-field="name" value="'+esc(profile.name||'')+'" /></div>'+
      providerPickerMarkup('primaryProvider','Primary Provider',profile.primaryProvider||'',false)+
      '<div class="field field-full"><label for="bot-role">Role</label><textarea id="bot-role" data-field="role">'+esc(profile.role||'')+'</textarea></div>'+
      '<div class="field field-full"><label for="bot-soul">Soul</label><textarea id="bot-soul" data-field="soul">'+esc(profile.soul||'')+'</textarea></div>'+
      '<div class="field field-full"><label for="bot-goal">Goal</label><textarea id="bot-goal" data-field="goal">'+esc(profile.goal||'')+'</textarea></div>'+
      providerPickerMarkup('fallbackProvider','Fallback Provider',profile.fallbackProvider||'',true)+
    '</div>'+
    '<div class="info-save-row"><button class="btn btn-primary" data-act="save-info">Save Changes</button><span class="save-status" data-save-status></span></div>';
  var input=q('[data-avatar-input]');
  var upload=q('[data-act="upload-avatar"]');if(upload&&input)upload.addEventListener('click',function(){input.click()});
  var remove=q('[data-act="remove-avatar"]');if(remove)remove.addEventListener('click',function(){state._pendingAvatar='';renderAvatarPreview('');this.hidden=true});
  if(input)input.addEventListener('change',function(){var file=this.files&&this.files[0];if(file)handleAvatarUpload(file)});
  wireProviderPickers();
  var copy=q('[data-act="copy-profile-gmid"]');if(copy)copy.addEventListener('click',function(){copyToClipboard(profile.globalMetaId||'')});
  var save=q('[data-act="save-info"]');if(save)save.addEventListener('click',saveInfo);
}

function renderAvatarPreview(dataUrl){
  var preview=q('[data-avatar-preview]');if(!preview)return;
  var profile=selectedProfile()||{};
  preview.innerHTML=avatarMarkup({name:profile.name,avatarDataUrl:dataUrl},true);
}

function handleAvatarUpload(file){
  var status=q('[data-avatar-status]');
  if(file.size>200*1024){if(status){status.textContent='Avatar must be 200KB or smaller.';status.className='save-status error'}return}
  var reader=new FileReader();
  reader.onload=function(){
    state._pendingAvatar=String(reader.result||'');
    renderAvatarPreview(state._pendingAvatar);
    var remove=q('[data-act="remove-avatar"]');if(remove)remove.hidden=false;
    if(status){status.textContent='Ready to save';status.className='save-status success'}
  };
  reader.onerror=function(){if(status){status.textContent='Upload failed';status.className='save-status error'}};
  reader.readAsDataURL(file);
}

function changedValue(payload,field,next,current){
  if(next!==current)payload[field]=next;
}

function modalRoot(){return q('[data-modal-root]')}
function clearDeleteCountdown(){if(state._deleteCountdownTimer){clearInterval(state._deleteCountdownTimer);state._deleteCountdownTimer=null}}
function beginSensitiveModal(kind,slug){var token=String(kind||'modal')+':'+String(slug||'')+':'+String(++state._modalRequestSeq);state._sensitiveModalToken=token;return token}
function isSensitiveModalCurrent(token,slug){return Boolean(token&&state._sensitiveModalToken===token&&state.selectedSlug===slug)}
function closeDynamicModal(){
  clearDeleteCountdown();
  state._sensitiveModalToken=null;
  var root=modalRoot();if(root){root.classList.add('hidden');root.innerHTML=''}
  var close=state._modalClose;state._modalClose=null;
  if(close)close();
}
function openDynamicModal(title,body,options){
  options=options||{};
  var root=modalRoot();if(!root)return;
  state._modalClose=options.onClose||null;
  root.innerHTML='<div class="modal-box '+esc(options.boxClass||'')+'">'+
    '<div class="modal-title-row"><div class="modal-title">'+esc(title)+'</div><button class="icon-btn" data-act="close-dynamic-modal" aria-label="Close">x</button></div>'+
    body+
  '</div>';
  root.classList.remove('hidden');
  root.onclick=function(event){if(event.target===root&&!options.locked)closeDynamicModal()};
  qq('[data-act="close-dynamic-modal"],[data-act="modal-close"]').forEach(function(el){el.addEventListener('click',closeDynamicModal)});
  qq('[data-copy-value]').forEach(function(el){el.addEventListener('click',function(){copyToClipboard(this.getAttribute('data-copy-value')||'')})});
}
function chainWritesList(chainWrites){
  var rows=[];
  (chainWrites||[]).forEach(function(write){
    (write.txids||[]).forEach(function(txid){rows.push({path:write.path||'transaction',txid:txid})});
  });
  if(!rows.length)return '<div class="modal-note">No transaction ID was returned by the chain writer.</div>';
  return '<div class="txid-list">'+rows.map(function(row){
    return '<div class="txid-row"><div><span class="txid-path">'+esc(row.path)+'</span><code>'+esc(row.txid)+'</code></div><button class="icon-btn" data-copy-value="'+esc(row.txid)+'" title="Copy txid" aria-label="Copy txid">⧉</button></div>';
  }).join('')+'</div>';
}
function createChainWritesFromResponse(data){
  var writes=(data&&data.chainWrites)||[];
  var subsidy=data&&data.subsidy&&data.subsidy.step2&&data.subsidy.step2.txid;
  if(subsidy)writes=writes.concat([{path:'mvc-gas-subsidy',txids:[subsidy]}]);
  return writes;
}
function chainSuccessBodyMarkup(input){
  var profile=input.profile||{};
  return '<div class="modal-body">'+
    '<p class="modal-note">'+esc(input.message||'The on-chain operation has been confirmed.')+'</p>'+
    '<div class="identity-result">'+
      '<div><span>GlobalMetaID</span><code>'+esc(profile.globalMetaId||'-')+'</code></div>'+
      '<button class="icon-btn" data-copy-value="'+esc(profile.globalMetaId||'')+'" title="Copy GlobalMetaID" aria-label="Copy GlobalMetaID">⧉</button>'+
    '</div>'+
    '<div class="modal-section-title">Transaction IDs</div>'+
    chainWritesList(input.chainWrites||[])+
  '</div><div class="modal-actions"><button class="btn btn-primary" data-act="modal-close">OK</button></div>';
}
function showChainSuccessModal(input){
  openDynamicModal(input.title,chainSuccessBodyMarkup(input),{boxClass:'modal-box-wide'});
}
function walletBodyMarkup(wallet){
  var addresses=wallet&&wallet.addresses||{};
  return '<div class="modal-body">'+
    '<div class="wallet-row"><div><span>BTC Receive Address</span><code>'+esc(addresses.btc||'-')+'</code></div><button class="icon-btn" data-act="copy-wallet-value" data-copy-value="'+esc(addresses.btc||'')+'" title="Copy BTC address" aria-label="Copy BTC address">⧉</button></div>'+
    '<div class="wallet-row"><div><span>MVC Receive Address</span><code>'+esc(addresses.mvc||'-')+'</code></div><button class="icon-btn" data-act="copy-wallet-value" data-copy-value="'+esc(addresses.mvc||'')+'" title="Copy MVC address" aria-label="Copy MVC address">⧉</button></div>'+
  '</div><div class="modal-actions"><button class="btn" data-act="modal-close">Close</button></div>';
}
function backupBodyMarkup(backup){
  var words=(backup&&backup.words)||[];
  return '<div class="modal-body">'+
    '<div class="warning-panel"><strong>Write these 12 words down and store them offline.</strong><span>Anyone who gets this phrase can control this MetaBot and access its assets.</span></div>'+
    '<ol class="mnemonic-grid">'+words.map(function(word,index){return '<li class="mnemonic-word"><span>'+String(index+1)+'.</span><code>'+esc(word)+'</code></li>'}).join('')+'</ol>'+
  '</div><div class="modal-actions"><button class="btn" data-act="modal-close">Close</button></div>';
}
function deleteConfirmMarkup(profile,count,canConfirm,status){
  return '<div class="modal-body">'+
    '<div class="warning-panel danger"><strong>Deleting this MetaBot will remove all local information.</strong><span>Please make sure you have backed up the mnemonic, otherwise it cannot be recovered after deletion.</span></div>'+
    '<div class="delete-target"><span>MetaBot</span><strong>'+esc((profile&&profile.name)||((profile&&profile.slug)||'-'))+'</strong></div>'+
    (status?'<div class="save-status '+esc(status.type||'')+'">'+esc(status.text||'')+'</div>':'')+
  '</div><div class="modal-actions"><button class="btn" data-act="modal-close"'+(state._deleteWorking?' disabled':'')+'>Cancel</button>'+
    '<button class="btn btn-danger" data-act="confirm-delete"'+(canConfirm&&!state._deleteWorking?'':' disabled')+'>'+(canConfirm?'Confirm Delete':'Confirm Delete ('+String(count)+'s)')+'</button></div>';
}
function openWalletPanel(){
  var profile=selectedProfile();if(!profile)return;
  var token=beginSensitiveModal('wallet',profile.slug);
  openDynamicModal('Wallet','<div class="modal-body"><div class="modal-note">Loading wallet addresses...</div></div>');
  api('/api/bot/profiles/'+encodeURIComponent(profile.slug)+'/wallet').then(function(r){
    if(!isSensitiveModalCurrent(token,profile.slug))return;
    openDynamicModal('Wallet',walletBodyMarkup(r.data&&r.data.wallet||{}),{boxClass:'modal-box-wide'});
  }).catch(function(error){if(!isSensitiveModalCurrent(token,profile.slug))return;openDynamicModal('Wallet','<div class="modal-body"><div class="save-status error">'+esc(error.message)+'</div></div><div class="modal-actions"><button class="btn" data-act="modal-close">Close</button></div>')});
}
function openBackupPanel(){
  var profile=selectedProfile();if(!profile)return;
  var token=beginSensitiveModal('backup',profile.slug);
  openDynamicModal('Backup Mnemonic','<div class="modal-body"><div class="modal-note">Loading backup phrase...</div></div>');
  api('/api/bot/profiles/'+encodeURIComponent(profile.slug)+'/backup').then(function(r){
    if(!isSensitiveModalCurrent(token,profile.slug))return;
    openDynamicModal('Backup Mnemonic',backupBodyMarkup(r.data&&r.data.backup||{}),{boxClass:'modal-box-wide'});
  }).catch(function(error){if(!isSensitiveModalCurrent(token,profile.slug))return;openDynamicModal('Backup Mnemonic','<div class="modal-body"><div class="save-status error">'+esc(error.message)+'</div></div><div class="modal-actions"><button class="btn" data-act="modal-close">Close</button></div>')});
}
function renderDeleteModal(profile,status){
  openDynamicModal('Delete MetaBot',deleteConfirmMarkup(profile,state._deleteCountdown,state._deleteCountdown<=0,status),{locked:state._deleteWorking});
  var confirm=q('[data-act="confirm-delete"]');if(confirm)confirm.addEventListener('click',function(){confirmDeleteMetabot(profile)});
}
function openDeletePanel(){
  var profile=selectedProfile();if(!profile)return;
  clearDeleteCountdown();
  state._deleteCountdown=5;state._deleteWorking=false;
  renderDeleteModal(profile);
  state._deleteCountdownTimer=setInterval(function(){
    state._deleteCountdown-=1;
    if(state._deleteCountdown<=0){state._deleteCountdown=0;clearDeleteCountdown()}
    renderDeleteModal(profile);
  },1000);
}
function confirmDeleteMetabot(profile){
  if(!profile||state._deleteCountdown>0||state._deleteWorking)return;
  state._deleteWorking=true;
  renderDeleteModal(profile,{type:'saving',text:'Deleting local MetaBot data...'});
  api('/api/bot/profiles/'+encodeURIComponent(profile.slug),{method:'DELETE'}).then(function(){
    closeDynamicModal();
    state.selectedSlug='';
    state.originalProfile=null;
    state.sessions=[];
    return loadProfiles().then(function(){return loadStats()}).then(function(){return loadSessions()});
  }).catch(function(error){
    state._deleteWorking=false;
    renderDeleteModal(profile,{type:'error',text:error.message});
  });
}

function saveInfo(){
  var profile=state.originalProfile;if(!profile||!state.selectedSlug)return;
  var status=q('[data-save-status]');var btn=q('[data-act="save-info"]');
  var payload={};
  changedValue(payload,'name',(q('[data-field="name"]')||{}).value||'',profile.name||'');
  changedValue(payload,'role',(q('[data-field="role"]')||{}).value||'',profile.role||'');
  changedValue(payload,'soul',(q('[data-field="soul"]')||{}).value||'',profile.soul||'');
  changedValue(payload,'goal',(q('[data-field="goal"]')||{}).value||'',profile.goal||'');
  var primaryEl=q('[data-field="primaryProvider"]');var fallbackEl=q('[data-field="fallbackProvider"]');
  if(primaryEl&&primaryEl.getAttribute('data-provider-touched')==='1')changedValue(payload,'primaryProvider',primaryEl.value||null,profile.primaryProvider||null);
  if(fallbackEl&&fallbackEl.getAttribute('data-provider-touched')==='1')changedValue(payload,'fallbackProvider',fallbackEl.value||null,profile.fallbackProvider||null);
  if(state._pendingAvatar!==undefined)changedValue(payload,'avatarDataUrl',state._pendingAvatar,profile.avatarDataUrl||'');
  if(!Object.keys(payload).length){if(status){status.textContent='No changes';status.className='save-status'}return}
  if(status){status.textContent='Saving...';status.className='save-status saving'}
  if(btn)btn.disabled=true;
  return api('/api/bot/profiles/'+encodeURIComponent(state.selectedSlug),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(function(r){
    var updated=r.data.profile;
    state.profiles=state.profiles.map(function(p){return p.slug===updated.slug?updated:p});
    state.originalProfile=updated;
    state._pendingAvatar=undefined;
    renderMetabotList();
    renderDetailHeader(updated);
    renderInfoTab();
    renderStats();
    status=q('[data-save-status]');if(status){status.textContent='On-chain update confirmed.';status.className='save-status success'}
    showChainSuccessModal({
      title:'Profile Updated On-Chain',
      message:'Profile changes were written on-chain before local data was saved.',
      profile:updated,
      chainWrites:(r.data&&r.data.chainWrites)||[],
    });
    return loadStats();
  }).catch(function(error){
    if(status){status.textContent=error.message;status.className='save-status error'}
  }).finally(function(){btn=q('[data-act="save-info"]');if(btn)btn.disabled=false});
}

function renderHistoryTab(){
  var tb=q('[data-execution-history-list]');if(!tb)return;
  var rows=state.sessions.filter(function(s){return s.metaBotSlug===state.selectedSlug});
  if(!rows.length){tb.innerHTML='<tr><td colspan="7" class="table-empty"><strong>No executions yet for this MetaBot</strong></td></tr>';return}
  tb.innerHTML=rows.map(function(s,i){
    var detailId='exec-detail-'+esc(state.selectedSlug)+'-'+i;
    var rt=state.runtimes.find(function(r){return r.id===s.runtimeId});
    var rn=rt?(rt.displayName||rt.provider):(s.runtimeId||'-');
    var provider=s.provider||(rt&&rt.provider)||'-';
    return'<tr>'+
      '<td><span class="exec-time">'+esc(fmtTime(s.startedAt||s.createdAt))+'</span></td>'+
      '<td><span class="exec-provider">'+esc(provider)+'</span></td>'+
      '<td><span class="exec-runtime">'+esc(rn)+'</span></td>'+
      '<td>'+statusPill(s.status)+'</td>'+
      '<td><span class="exec-duration">'+duration(s)+'</span></td>'+
      '<td><div class="exec-prompt">'+esc(shortText(s.prompt,120))+'</div></td>'+
      '<td><button class="btn btn-sm" data-act="toggle-exec" data-detail="'+detailId+'" aria-expanded="false">Details</button></td></tr>'+
      '<tr class="exec-detail-row" id="'+detailId+'" hidden><td colspan="7"><div class="exec-detail">'+
        '<div><div class="exec-detail-label">Session ID</div><pre>'+esc(s.sessionId||'-')+'</pre></div>'+
        '<div><div class="exec-detail-label">Output/Error</div><pre>'+esc(clampBlock(resultSummary(s)))+'</pre></div>'+
        '<div><div class="exec-detail-label">Full Prompt</div><pre>'+esc(clampBlock(s.prompt))+'</pre></div>'+
        '<div><div class="exec-detail-label">Runtime</div><pre>'+esc((s.runtimeId||'-')+'\n'+provider)+'</pre></div>'+
      '</div></td></tr>'
  }).join('');
  qq('[data-act="toggle-exec"]').forEach(function(el){el.addEventListener('click',function(){toggleExecDetail(this)})});
}

function toggleExecDetail(btn){
  var id=btn.getAttribute('data-detail');var row=document.getElementById(id);if(!row)return;
  var open=row.hasAttribute('hidden');
  if(open){row.removeAttribute('hidden');btn.setAttribute('aria-expanded','true')}else{row.setAttribute('hidden','');btn.setAttribute('aria-expanded','false')}
}

function switchTab(tab,silent){
  state.selectedTab=tab||'info';
  qq('[data-tab]').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-tab')===state.selectedTab)});
  qq('[data-tab-panel]').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-tab-panel')===state.selectedTab)});
  if(state.selectedTab==='history')loadSessions();else renderInfoTab();
}

function loadStats(){return api('/api/bot/stats').then(function(r){state.stats=r.data||{};renderStats()}).catch(function(){renderStats()})}
function loadProfiles(){return api('/api/bot/profiles').then(function(r){state.profiles=(r.data&&r.data.profiles)||[];if(!state.selectedSlug&&state.profiles.length)state.selectedSlug=state.profiles[0].slug;if(state.selectedSlug&&!state.profiles.some(function(p){return p.slug===state.selectedSlug}))state.selectedSlug=state.profiles[0]&&state.profiles[0].slug||'';state.originalProfile=selectedProfile();renderMetabotList();renderDetailHeader(state.originalProfile);setDetailVisible(Boolean(state.originalProfile));renderCurrentTab();renderStats()})}
function loadRuntimes(){return api('/api/bot/runtimes').then(function(r){state.runtimes=(r.data&&r.data.runtimes)||[];renderCurrentTab();renderStats()}).catch(function(){state.runtimes=[];renderCurrentTab();renderStats()})}
function loadSessions(slug){var activeSlug=slug||state.selectedSlug;if(!activeSlug){state.sessions=[];renderHistoryTab();renderStats();return Promise.resolve()}return api('/api/bot/sessions?slug='+encodeURIComponent(activeSlug)+'&limit=50').then(function(r){if(activeSlug!==state.selectedSlug)return;state.sessions=(r.data&&r.data.sessions)||[];renderHistoryTab();renderStats()}).catch(function(){if(activeSlug!==state.selectedSlug)return;state.sessions=[];renderHistoryTab();renderStats()})}
function loadAll(){return Promise.all([loadStats(),loadProfiles(),loadRuntimes()]).then(function(){return loadSessions()})}

function discoverRuntimes(){
  var btn=q('[data-act="discover-runtimes"]');if(btn){btn.disabled=true;btn.textContent='Refreshing...'}
  api('/api/bot/runtimes/discover',{method:'POST'}).then(function(){return loadRuntimes()}).catch(function(error){showToast(error.message||'Runtime refresh failed')}).finally(function(){btn=q('[data-act="discover-runtimes"]');if(btn){btn.disabled=false;btn.textContent='Refresh Runtimes'}})
}

function openAddModal(){
  var modal=q('[data-modal="add-metabot"]');var input=q('[data-field="new-name"]');var status=q('[data-add-status]');
  if(status){status.textContent='';status.className='save-status'}
  if(input)input.value='';
  if(modal)modal.classList.remove('hidden');
  if(input)input.focus();
}
function closeAddModal(){var modal=q('[data-modal="add-metabot"]');if(modal)modal.classList.add('hidden')}
function createMetabot(){
  var input=q('[data-field="new-name"]');var status=q('[data-add-status]');var btn=q('[data-act="confirm-add"]');var name=(input&&input.value||'').trim();
  if(!name){if(status){status.textContent='Name is required';status.className='save-status error'}return}
  if(status){status.textContent='Creating...';status.className='save-status saving'}
  if(btn)btn.disabled=true;
  return api('/api/bot/profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name})}).then(function(r){
    closeAddModal();
    var profile=r.data&&r.data.profile||{};
    state.selectedSlug=profile.slug||state.selectedSlug;
    state.selectedTab='info';
    return loadProfiles().then(function(){
      showChainSuccessModal({
        title:'MetaBot Created On-Chain',
        message:'The on-chain identity has been created. Basic Info is ready for optional edits.',
        profile:profile,
        chainWrites:createChainWritesFromResponse(r.data||{}),
      });
    });
  }).catch(function(error){if(status){status.textContent=error.message;status.className='save-status error'}}).finally(function(){if(btn)btn.disabled=false});
}

function showToast(text){
  var toast=q('[data-copy-toast]');if(!toast)return;
  toast.textContent=text||'Copied!';
  toast.classList.add('show');
  if(state._toastTimer)clearTimeout(state._toastTimer);
  state._toastTimer=setTimeout(function(){toast.classList.remove('show')},1500);
}

function copyToClipboard(text){
  if(!text){showToast('Nothing to copy');return}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){showToast('Copied!')}).catch(function(){fallbackCopy(text)})}else{fallbackCopy(text)}
}
function fallbackCopy(text){
  var el=document.createElement('textarea');el.value=text;el.setAttribute('readonly','');el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);el.select();try{document.execCommand('copy');showToast('Copied!')}catch(error){showToast('Copy failed')}document.body.removeChild(el)
}

document.addEventListener('DOMContentLoaded',function(){
  loadAll();
  var add=q('[data-act="add-metabot"]');if(add)add.addEventListener('click',openAddModal);
  var cancel=q('[data-act="cancel-add"]');if(cancel)cancel.addEventListener('click',closeAddModal);
  var confirm=q('[data-act="confirm-add"]');if(confirm)confirm.addEventListener('click',createMetabot);
  var modal=q('[data-modal="add-metabot"]');if(modal)modal.addEventListener('click',function(event){if(event.target===modal)closeAddModal()});
  var name=q('[data-field="new-name"]');if(name)name.addEventListener('keydown',function(event){if(event.key==='Enter')createMetabot();if(event.key==='Escape')closeAddModal()});
  qq('[data-tab]').forEach(function(el){el.addEventListener('click',function(){switchTab(this.getAttribute('data-tab'))})});
  var discover=q('[data-act="discover-runtimes"]');if(discover)discover.addEventListener('click',discoverRuntimes);
  var wallet=q('[data-act="open-wallet"]');if(wallet)wallet.addEventListener('click',openWalletPanel);
  var backup=q('[data-act="open-backup"]');if(backup)backup.addEventListener('click',openBackupPanel);
  var del=q('[data-act="open-delete"]');if(del)del.addEventListener('click',openDeletePanel);
  setInterval(function(){loadStats();loadSessions()},15000);
})`;
}
