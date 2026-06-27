import type { LocalUiPageDefinition } from '../types';

export function buildBotPageDefinition(): LocalUiPageDefinition {
  return {
    page: 'bot',
    title: 'Bot Page — Open Agent Connect',
    eyebrow: 'Provider Console',
    heading: 'Bot Page',
    description: 'Manage your Bot identity, public page, provider settings, and execution history.',
    panels: [],
    script: buildBotPageScript(),
  };
}

function buildBotPageScript(): string {
  return String.raw`var q=function(s){return document.querySelector(s)};
var qq=function(s){return document.querySelectorAll(s)};
var state={profiles:[],runtimes:[],sessions:[],stats:{botCount:0,healthyRuntimes:0,totalExecutions:0,successRate:0},profileConfigs:{},chatSkillOptionsBySlug:{},chatSkillOptionsStatusBySlug:{},chatSkillOptionsErrorBySlug:{},chatAllowedSkillsBySlug:{},selectedSlug:'',selectedTab:'publicIdentity',originalProfile:null,_pendingAvatar:undefined,_pendingHomepage:undefined,_homepageSource:'',_homepageUploadWorking:false,_homepageUploadToken:0,_createdBotPageUrl:'',_toastTimer:null,_modalClose:null,_modalRequestSeq:0,_sensitiveModalToken:null,_deleteCountdownTimer:null,_deleteCountdown:5,_deleteWorking:false,_runtimeModalOpen:false,_runtimeTestById:{},_runtimesLoaded:false,_walletPanel:null,_walletTransfer:null,_managementRouteRequest:null};
var LEGACY_DEFAULT_ROLE='You are a helpful AI assistant.';
var LEGACY_DEFAULT_SOUL='You are friendly and professional.';
var LEGACY_DEFAULT_GOAL='Your goal is to help users accomplish their tasks effectively.';
var WALLET_CHAINS=[
  {chain:'btc',label:'BTC',displayUnit:'BTC',inputUnit:'BTC'},
  {chain:'mvc',label:'MVC',displayUnit:'SPACE',inputUnit:'SPACE'},
  {chain:'doge',label:'DOGE',displayUnit:'Doge',inputUnit:'DOGE'},
  {chain:'opcat',label:'OPCAT',displayUnit:'OPCAT-BTC',inputUnit:'OPCAT'}
];

function api(url,opts){return fetch(url,opts).then(function(r){return r.json().catch(function(){return{ok:false,message:String(r.status)}}).then(function(body){if(!r.ok||body.ok===false){throw new Error(body.message||body.code||String(r.status))}return body})})}
function fmtTime(t){if(!t)return'-';var d=new Date(t);if(Number.isNaN(d.getTime()))return'-';return d.toLocaleString()}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){if(c==='&')return'&amp;';if(c==='<')return'&lt;';if(c==='>')return'&gt;';if(c==='"')return'&quot;';return'&#39;'})}
function uiText(key,fallback,replacements){try{if(typeof window!=='undefined'&&window.__oacLocalUiI18n&&typeof window.__oacLocalUiI18n.t==='function'){var text=window.__oacLocalUiI18n.t(key,replacements||{});if(text&&text!==key)return text}}catch(error){}var out=String(fallback==null?'':fallback);Object.keys(replacements||{}).forEach(function(name){out=out.split('{'+name+'}').join(String(replacements[name]))});return out}
function statusPill(s){var m={completed:'online',running:'active',starting:'active',failed:'offline',timeout:'offline',cancelled:'offline'};var c=m[s]||'offline';return'<span class="status-pill status-'+c+'"><span class="status-dot"></span>'+esc(s||'unknown')+'</span>'}
function shortText(v,n){n=n||120;v=String(v==null?'':v).replace(/\s+/g,' ').trim();if(!v)return'-';return v.length>n?v.slice(0,Math.max(0,n-3))+'...':v}
function clampBlock(v){v=String(v==null?'':v).trim();if(!v)return'-';return v.length>700?v.slice(0,700)+'...':v}
function duration(s){var d=s&&s.result&&typeof s.result.durationMs==='number'?s.result.durationMs:null;if(d===null&&s&&s.startedAt&&s.completedAt){var a=new Date(s.startedAt).getTime();var b=new Date(s.completedAt).getTime();if(Number.isFinite(a)&&Number.isFinite(b)&&b>=a)d=b-a}return d===null?'-':d+'ms'}
function resultSummary(s){if(!s||!s.result)return'-';if(s.result.output)return s.result.output;if(s.result.error)return s.result.error;return s.result.status||'-'}
function runtimeLabel(r){var name=r.displayName||r.provider||r.id||'-';var bits=[name];if(r.health)bits.push(r.health);if(r.version)bits.push('v'+r.version);return bits.join(' / ')}
function shortId(v){v=String(v||'');if(!v)return'-';return v.length>18?v.slice(0,12)+'...'+v.slice(-4):v}
function botBrowserPath(globalMetaId){return '/browser/metaid/'+encodeURIComponent(String(globalMetaId||'').trim())}
function metaAppBrowserPath(pinId){return '/browser/metaapp/'+encodeURIComponent(String(pinId||'').trim())}
function viewSelectedBotPage(){var profile=selectedProfile();if(!profile||!profile.globalMetaId){showToast(uiText('bot.botPageUnavailable','Bot Page is unavailable until GlobalMetaID is ready'));return}window.location.href=botBrowserPath(profile.globalMetaId)}
function viewSelectedConversations(){var profile=selectedProfile();if(!profile||!profile.globalMetaId){showToast(uiText('bot.selectBotBeforeConversations','Select a Bot before opening conversations'));return}window.location.href='/ui/conversations?local='+encodeURIComponent(profile.globalMetaId)}
function avatarMarkup(profile,large){var value=profile&&profile.avatarDataUrl;var initials=((profile&&profile.name)||'MB').trim().slice(0,2).toUpperCase()||'MB';if(value)return'<img src="'+esc(value)+'" alt="">';return esc(initials)}
function selectedProfile(){return state.profiles.find(function(p){return p.slug===state.selectedSlug})||null}
function publicPersonaValues(profile){
  var role=String(profile&&profile.role||'').trim();
  var soul=String(profile&&profile.soul||'').trim();
  var goal=String(profile&&profile.goal||'').trim();
  if(role===LEGACY_DEFAULT_ROLE&&soul===LEGACY_DEFAULT_SOUL&&goal===LEGACY_DEFAULT_GOAL){
    return {role:'',soul:'',goal:''};
  }
  return {role:role,soul:soul,goal:goal};
}
function clearSelectedProfileDrafts(){
  state._pendingAvatar=undefined;
  state._pendingHomepage=undefined;
  state._homepageSource='';
  state._homepageUploadWorking=false;
  state._homepageUploadToken+=1;
}
function setSelectedSlug(slug,options){
  options=options||{};
  var next=String(slug||'');
  var changed=state.selectedSlug!==next;
  state.selectedSlug=next;
  if(changed||options.clearDrafts)clearSelectedProfileDrafts();
  state.originalProfile=selectedProfile();
}
function normalizeHomepage(value){
  if(!value||typeof value!=='object')return null;
  var uri=String(value.uri||'').trim();
  if(!uri)return null;
  var renderer=String(value.renderer||'').trim()||(/^metaapp:\/\//i.test(uri)?'metaapp':'auto');
  var contentType=String(value.contentType||'').trim()||(renderer==='metaapp'?'application/vnd.metaapp':'application/octet-stream');
  return {uri:uri,renderer:renderer,contentType:contentType};
}
function sameHomepage(left,right){
  left=normalizeHomepage(left);right=normalizeHomepage(right);
  if(!left&&!right)return true;
  if(!left||!right)return false;
  return left.uri===right.uri&&left.renderer===right.renderer&&left.contentType===right.contentType;
}
function homepageDraft(profile){
  if(state._pendingHomepage!==undefined)return state._pendingHomepage;
  return normalizeHomepage(profile&&profile.homepage);
}
function homepageSourceFromHomepage(homepage){
  homepage=normalizeHomepage(homepage);
  if(!homepage)return'default';
  return /^metaapp:\/\//i.test(homepage.uri)?'metaapp':'metafile';
}
function homepageSourceValue(profile){
  if(state._homepageSource)return state._homepageSource;
  return homepageSourceFromHomepage(homepageDraft(profile));
}
function selectedHomepageSource(profile){
  var select=q('[data-field="homepage-source"]');
  var value=String(select&&select.value||'').trim();
  if(value==='default'||value==='metafile'||value==='metaapp')return value;
  var metaAppInput=q('[data-field="homepage-metaapp-pin"]');
  if(!select&&String(metaAppInput&&metaAppInput.value||'').trim())return'metaapp';
  return homepageSourceValue(profile);
}
function homepageSourceOptionMarkup(value,label,selected){
  return '<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';
}
function homepageSourceOptionsMarkup(selected){
  return homepageSourceOptionMarkup('default',uiText('bot.homepageDefault','Default'),selected)+
    homepageSourceOptionMarkup('metafile',uiText('bot.homepageMetafile','Metafile'),selected)+
    homepageSourceOptionMarkup('metaapp',uiText('bot.homepageMetaApp','MetaApp'),selected);
}
function normalizeMetaAppHomepageInput(value){
  var pin=String(value==null?'':value).trim();
  if(/^metaapp:\/\//i.test(pin))pin=pin.slice('metaapp://'.length).trim();
  if(!pin||/\s/u.test(pin)||/:\/\//.test(pin))throw new Error(uiText('bot.homepageInvalidMetaAppPin','Enter a MetaApp pin ID without spaces.'));
  return {uri:'metaapp://'+pin,renderer:'metaapp',contentType:'application/vnd.metaapp'};
}
function metaAppPinFromHomepage(homepage){
  homepage=normalizeHomepage(homepage);
  if(!homepage||!/^metaapp:\/\//i.test(homepage.uri))return '';
  return homepage.uri.slice('metaapp://'.length);
}
function dataUrlBase64(value){
  var text=String(value||'');
  var marker=';base64,';
  var index=text.indexOf(marker);
  return index>=0?text.slice(index+marker.length):'';
}
function readFileAsDataUrl(file){
  return new Promise(function(resolve,reject){
    var reader=new FileReader();
    reader.onload=function(){resolve(String(reader.result||''))};
    reader.onerror=function(){reject(new Error(uiText('bot.uploadFailed','Upload failed')))};
    reader.readAsDataURL(file);
  });
}
function availableRuntimes(){return state.runtimes.filter(function(r){return r.health==='healthy'&&r.provider})}
function providerDisplayName(provider){var rt=availableRuntimes().find(function(r){return r.provider===provider});return rt?runtimeLabel(rt):(provider||'No provider')}
function runtimeHealthRank(runtime){var health=runtime&&runtime.health;return health==='healthy'?3:(health==='detected'?2:(health==='unavailable'?0:1))}
function runtimeActivityMs(runtime){
  var values=[runtime&&runtime.healthCheckedAt,runtime&&runtime.lastSeenAt,runtime&&runtime.updatedAt,runtime&&runtime.createdAt];
  return values.reduce(function(max,value){var parsed=Date.parse(value||'');return Number.isFinite(parsed)?Math.max(max,parsed):max},0);
}
function compareProviderRuntime(left,right){
  var healthDelta=runtimeHealthRank(right)-runtimeHealthRank(left);
  if(healthDelta)return healthDelta;
  var activityDelta=runtimeActivityMs(right)-runtimeActivityMs(left);
  if(activityDelta)return activityDelta;
  return String(left&&left.id||'').localeCompare(String(right&&right.id||''));
}
function providerRuntime(provider){
  var rows=state.runtimes.filter(function(r){return r.provider===provider});
  rows.sort(compareProviderRuntime);
  return rows[0]||null;
}
function providerLogoPath(provider){var rt=providerRuntime(provider);return rt&&rt.logoPath?rt.logoPath:'/ui/assets/platforms/generic.svg'}
function providerIconMarkup(provider){
  var key=String(provider||'generic');
  var path=providerLogoPath(key);
  return '<span class="provider-logo provider-logo-'+esc(key.replace(/[^a-z0-9_-]+/gi,'-'))+'" data-provider-icon="'+esc(key)+'" aria-hidden="true"><img src="'+esc(path)+'" alt="" loading="lazy" /></span>';
}
function profileLlmProviders(profile){
  var providers=[];
  function addProvider(value){var provider=String(value||'').trim();if(provider&&providers.indexOf(provider)<0)providers.push(provider)}
  addProvider(profile&&profile.primaryProvider);
  addProvider(profile&&profile.fallbackProvider);
  if(profile&&Array.isArray(profile.fallbackProviders))profile.fallbackProviders.forEach(addProvider);
  return providers;
}
function providerIsHealthy(provider){
  provider=String(provider||'').trim();
  if(!provider)return false;
  return state.runtimes.some(function(r){return r&&r.provider===provider&&r.health==='healthy'});
}
function profileHasUsableLlm(profile){
  return profileLlmProviders(profile).some(providerIsHealthy);
}
function shouldShowNoLlmLabel(profile){
  var providers=profileLlmProviders(profile);
  if(!providers.length)return true;
  if(!state._runtimesLoaded&&!state.runtimes.length)return false;
  return !profileHasUsableLlm(profile);
}
function noLlmLabelMarkup(profile){
  if(!shouldShowNoLlmLabel(profile))return '';
  var title=uiText('bot.noLlmTitle','No healthy Primary or Fallback LLM configured.');
  return '<span class="metabot-no-llm-label" title="'+esc(title)+'" aria-label="'+esc(title)+'">'+esc(uiText('bot.noLlmLabel','NO LLM'))+'</span>';
}
function runtimeIconMarkup(runtime){
  var key=String((runtime&&runtime.provider)||'generic');
  var path=(runtime&&runtime.logoPath)||providerLogoPath(key);
  return '<span class="provider-logo provider-logo-'+esc(key.replace(/[^a-z0-9_-]+/gi,'-'))+'" data-provider-icon="'+esc(key)+'" aria-hidden="true"><img src="'+esc(path)+'" alt="" loading="lazy" /></span>';
}
function visibleRuntimeRows(){
  return state.runtimes.filter(function(r){
    return r&&(r.health==='healthy'||r.health==='detected');
  });
}
function runtimeHealthMarkup(runtime){
  var health=runtime&&runtime.health||'detected';
  var cls=health==='healthy'?'runtime-health-healthy':'runtime-health-detected';
  return '<span class="runtime-health-dot '+cls+'" aria-hidden="true"></span>';
}
function runtimeDetailCell(label,value,isCode,extraClass){
  var content=value==null||value===''?'-':value;
  return '<div class="'+esc(extraClass||'')+'"><span>'+esc(label)+'</span>'+(isCode?'<code>'+esc(content)+'</code>':'<strong>'+esc(content)+'</strong>')+'</div>';
}
function runtimeDetailMarkup(runtime){
  return '<div class="runtime-row-meta">'+
    runtimeDetailCell(uiText('bot.path','Path'),runtime.binaryPath,true,'runtime-path')+
    runtimeDetailCell(uiText('bot.version','Version'),runtime.version,false,'')+
    runtimeDetailCell(uiText('bot.model','Model'),runtime.model,false,'')+
    runtimeDetailCell(uiText('bot.auth','Auth'),runtime.authState,false,'')+
    runtimeDetailCell(uiText('bot.lastSeen','Last seen'),fmtTime(runtime.lastSeenAt),false,'')+
    runtimeDetailCell(uiText('bot.checked','Checked'),fmtTime(runtime.healthCheckedAt),false,'')+
    runtimeDetailCell(uiText('bot.health','Health'),runtime.health,false,'')+
    (runtime.healthReason?runtimeDetailCell(uiText('bot.reason','Reason'),runtime.healthReason,false,'runtime-reason'):'')+
  '</div>';
}
function runtimeModalBodyMarkup(){
  var rows=visibleRuntimeRows();
  var summaryKey=rows.length===1?'bot.runtimeSummaryOne':'bot.runtimeSummaryMany';
  var summaryFallback=rows.length===1?'{count} detected provider visible. Unavailable providers are hidden from this list.':'{count} detected providers visible. Unavailable providers are hidden from this list.';
  var body='<div class="runtime-modal-head">'+
    '<div><div class="runtime-modal-title">'+esc(uiText('bot.llmProviders','LLM Providers'))+'</div><div class="runtime-modal-summary" data-runtime-modal-status>'+esc(uiText(summaryKey,summaryFallback,{count:rows.length}))+'</div></div>'+
    '<div class="runtime-modal-actions"><button class="btn btn-sm" data-act="refresh-runtime-modal">'+esc(uiText('bot.refresh','Refresh'))+'</button><button class="icon-btn" data-act="close-runtime-modal" aria-label="Close">x</button></div>'+
  '</div>';
  if(!rows.length){
    return body+'<div class="runtime-empty">'+esc(uiText('bot.noRuntimesFound','No healthy or detected LLM providers were found.'))+'</div>';
  }
  body+='<div class="runtime-list">'+rows.map(function(runtime){
    var testing=state._runtimeTestById[runtime.id]==='testing';
    return '<div class="runtime-row" data-runtime-row="'+esc(runtime.id)+'">'+
      '<div class="runtime-row-main">'+
        '<div class="runtime-row-title">'+runtimeHealthMarkup(runtime)+runtimeIconMarkup(runtime)+'<strong>'+esc(runtime.displayName||runtime.provider||runtime.id)+'</strong><code>'+esc(runtime.provider||'-')+'</code></div>'+
        runtimeDetailMarkup(runtime)+
      '</div>'+
      '<div><button class="btn btn-sm" data-act="test-runtime" data-runtime-id="'+esc(runtime.id)+'"'+(testing?' disabled':'')+'>'+esc(testing?uiText('bot.testing','Testing...'):uiText('bot.test','Test'))+'</button></div>'+
    '</div>';
  }).join('')+'</div>';
  return body;
}
function closeRuntimeModal(){
  state._runtimeModalOpen=false;
  closeDynamicModal();
}
function renderRuntimeModal(){
  if(!state._runtimeModalOpen)return;
  var root=modalRoot();if(!root)return;
  root.innerHTML='<div class="modal-box runtime-modal-box">'+runtimeModalBodyMarkup()+'</div>';
  root.classList.remove('hidden');
  root.onclick=function(event){if(event.target===root)closeRuntimeModal()};
  qq('[data-act="close-runtime-modal"]').forEach(function(el){el.addEventListener('click',closeRuntimeModal)});
  qq('[data-act="refresh-runtime-modal"]').forEach(function(el){el.addEventListener('click',function(){loadRuntimes()})});
  qq('[data-act="test-runtime"]').forEach(function(el){el.addEventListener('click',function(){testRuntime(this.getAttribute('data-runtime-id')||'')})});
}
function openRuntimeModal(){
  state._runtimeModalOpen=true;
  renderRuntimeModal();
}
function defaultWriteNetwork(){
  var config=state.profileConfigs[state.selectedSlug]||{};
  var value=config&&config.chain&&config.chain.defaultWriteNetwork;
  return ['mvc','btc','doge','opcat'].indexOf(value)>=0?value:'mvc';
}
function uniqueProviderRuntimes(){
  var seen={};var rows=[];
  availableRuntimes().forEach(function(r){if(!r.provider||seen[r.provider])return;seen[r.provider]=true;rows.push(r)});
  return rows;
}
function providerPickerMarkup(field,label,selected,allowNone,touched){
  var current=selected||'';var rows=uniqueProviderRuntimes();
  var active=rows.find(function(r){return r.provider===current});
  var buttonLabel=active?runtimeLabel(active):(current?uiText('bot.providerUnavailable','Provider unavailable')+': '+current:uiText('bot.none','None'));
  var buttonIcon=current?providerIconMarkup(current):providerIconMarkup('generic');
  var html='<div class="field provider-field"><label>'+esc(label)+'</label>'+
    '<div class="provider-picker" data-provider-picker="'+esc(field)+'">'+
    '<input type="hidden" data-field="'+esc(field)+'" value="'+esc(current)+'"'+(touched?' data-provider-touched="1"':'')+' />'+
    '<button type="button" class="provider-trigger" data-provider-toggle="'+esc(field)+'">'+buttonIcon+'<span>'+esc(buttonLabel)+'</span><span class="provider-caret">v</span></button>'+
    '<div class="provider-menu" data-provider-menu="'+esc(field)+'" hidden>';
  if(allowNone){
    html+='<button type="button" class="provider-option" data-provider-option="none" data-provider-value=""'+(!current?' selected':'')+'>'+providerIconMarkup('generic')+'<span>'+esc(uiText('bot.none','None'))+'</span></button>';
  }
  rows.forEach(function(r){
    var selectedAttr=current===r.provider?' selected':'';
    html+='<button type="button" class="provider-option" data-provider-option="'+esc(r.provider)+'" data-provider-value="'+esc(r.provider)+'"'+selectedAttr+'>'+providerIconMarkup(r.provider)+'<span>'+esc(runtimeLabel(r))+'</span></button>';
  });
  if(!rows.length){
    html+='<div class="provider-empty">'+esc(uiText('bot.noHealthyRuntimes','No healthy runtimes found'))+'</div>';
  }
  html+='</div></div></div>';
  return html;
}
function homepagePanelMarkup(profile){
  var homepage=homepageDraft(profile);
  var source=homepageSourceValue(profile);
  var status=source==='default'?uiText('bot.homepageDefault','Default'):(source==='metaapp'?uiText('bot.homepageMetaApp','MetaApp'):uiText('bot.homepageMetafile','Metafile'));
  var viewDisabled=profile&&profile.globalMetaId?'':' disabled';
  var viewLink=' <button type="button" class="homepage-view-link" data-act="view-homepage"'+viewDisabled+'>'+esc(uiText('bot.homepageViewLink','click here to view'))+'</button>';
  var helpCopy=uiText('bot.homepageMetaAppHelp','Use the metabot-homepage-guide skill and metabot-metaapp-publish skill to create a unique Bot Page, package and publish it on-chain through the MetaApp protocol, then paste the MetaApp pin ID here.');
  var metaAppSource=source==='metaapp'?(state._pendingHomepage!==undefined?state._pendingHomepage:profile&&profile.homepage):null;
  var metaAppPin=metaAppPinFromHomepage(metaAppSource);
  var control='';
  if(source==='default'){
    control='<div class="homepage-final-uri">'+esc(uiText('bot.homepageDefaultActive','Default Bot Page renderer is active.'))+viewLink+'</div>';
  }else if(source==='metafile'){
    control='<div class="homepage-source-note">'+esc(uiText('bot.homepageMetafileNote','Upload a local file and save it as metafile://<pinId>.'))+'</div>'+
      '<div class="homepage-control-row"><button type="button" class="btn btn-sm" data-act="upload-homepage"'+(state._homepageUploadWorking?' disabled':'')+'>'+esc(uiText('bot.upload','Upload'))+'</button><input type="file" data-homepage-file-input hidden /></div>';
  }else{
    control='<div class="homepage-source-note">'+esc(uiText('bot.homepageMetaAppNote','Paste a MetaApp pin ID and save it as metaapp://<pinId>.'))+'</div>'+
      '<div class="homepage-control-row homepage-metaapp-row"><input data-field="homepage-metaapp-pin" placeholder="'+esc(uiText('bot.homepagePinPlaceholder','MetaApp pin ID'))+'" value="'+esc(metaAppPin)+'" /><button type="button" class="btn btn-sm" data-act="preview-homepage-metaapp">'+esc(uiText('bot.homepagePreviewMetaApp','Preview'))+'</button><span class="homepage-help-wrap" data-homepage-help><button type="button" class="homepage-help" data-act="toggle-homepage-help" aria-label="'+esc(uiText('bot.homepageMetaAppHelpLabel','How to get a MetaApp pin ID'))+'" aria-expanded="false" aria-controls="homepage-metaapp-help">?</button><span class="homepage-help-popover" id="homepage-metaapp-help" data-homepage-help-popover role="tooltip">'+esc(helpCopy)+'</span></span></div>';
  }
  return '<div class="field field-full"><label>'+esc(uiText('bot.homepage','Homepage'))+'</label>'+
    '<div class="homepage-panel" data-homepage-panel>'+
      '<div class="homepage-panel-head"><div><div class="homepage-panel-title">'+esc(uiText('bot.homepage','Homepage'))+'</div><div class="homepage-panel-subtitle">'+esc(uiText('bot.homepageSource','Custom Bot page source'))+'</div></div><span class="homepage-status-pill">'+esc(status)+'</span></div>'+
      '<div class="homepage-source-row">'+
        '<div class="homepage-source-select"><label for="homepage-source">'+esc(uiText('bot.homepageSource','Custom Bot page source'))+'</label><select id="homepage-source" data-field="homepage-source">'+homepageSourceOptionsMarkup(source)+'</select></div>'+
        '<div class="homepage-control-slot" data-homepage-control-slot>'+control+'</div>'+
      '</div>'+
      '<div class="save-status" data-homepage-status></div>'+
    '</div></div>';
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
      if(trigger){trigger.innerHTML=(value?providerIconMarkup(value):providerIconMarkup('generic'))+'<span>'+esc(value?providerDisplayName(value):uiText('bot.none','None'))+'</span><span class="provider-caret">v</span>'}
      picker.querySelectorAll('[data-provider-value]').forEach(function(row){row.removeAttribute('selected')});
      this.setAttribute('selected','');
      var menu=q('[data-provider-menu="'+field+'"]');if(menu)menu.setAttribute('hidden','');
    });
  });
}
function normalizeChatSkillList(value){
  var seen={};var out=[];
  if(!Array.isArray(value))return out;
  value.forEach(function(item){
    var skill=String(item==null?'':item).trim();
    if(!skill||seen[skill])return;
    seen[skill]=true;out.push(skill);
  });
  return out;
}
function sameChatSkillList(left,right){
  left=normalizeChatSkillList(left);right=normalizeChatSkillList(right);
  if(left.length!==right.length)return false;
  for(var i=0;i<left.length;i++){if(left[i]!==right[i])return false}
  return true;
}
function rerenderChatSkillsTabForLoad(slug){
  var panel=q('[data-chat-skills-profile-slug]');
  if(state.selectedTab==='chatSkills'&&slug===state.selectedSlug&&panel&&panel.getAttribute&&panel.getAttribute('data-chat-skills-profile-slug')===slug)renderChatSkillsTab();
}
function selectedChatSkills(profile){
  var slug=profile&&profile.slug||state.selectedSlug;
  if(slug&&Object.prototype.hasOwnProperty.call(state.chatAllowedSkillsBySlug,slug)){
    return normalizeChatSkillList(state.chatAllowedSkillsBySlug[slug]);
  }
  return normalizeChatSkillList(profile&&profile.allowChatSkills);
}
function ensureSelectedChatSkills(profile){
  var slug=profile&&profile.slug;
  if(!slug)return [];
  if(!Object.prototype.hasOwnProperty.call(state.chatAllowedSkillsBySlug,slug)){
    state.chatAllowedSkillsBySlug[slug]=normalizeChatSkillList(profile.allowChatSkills);
  }
  return selectedChatSkills(profile);
}
function loadChatSkillOptions(slug){
  slug=String(slug||'').trim();
  if(!slug)return Promise.resolve([]);
  state.chatSkillOptionsStatusBySlug[slug]='loading';
  state.chatSkillOptionsErrorBySlug[slug]='';
  rerenderChatSkillsTabForLoad(slug);
  return api('/api/services/skills?from='+encodeURIComponent(slug)).then(function(r){
    var data=r&&r.data?r.data:r;
    var skills=Array.isArray(data&&data.skills)?data.skills:[];
    var rows=[];var seen={};
    skills.forEach(function(skill){
      var skillName=String(skill&&skill.skillName||'').trim();
      if(!skillName||seen[skillName])return;
      seen[skillName]=true;
      rows.push({
        skillName:skillName,
        title:String(skill&&skill.title||skillName).trim()||skillName,
        description:String(skill&&skill.description||'').trim(),
      });
    });
    state.chatSkillOptionsBySlug[slug]=rows;
    state.chatSkillOptionsStatusBySlug[slug]='loaded';
    rerenderChatSkillsTabForLoad(slug);
    return rows;
  }).catch(function(error){
    state.chatSkillOptionsBySlug[slug]=[];
    state.chatSkillOptionsStatusBySlug[slug]='error';
    state.chatSkillOptionsErrorBySlug[slug]=error&&error.message?error.message:String(error||'Failed to load chat skills');
    rerenderChatSkillsTabForLoad(slug);
    return [];
  });
}
function chatAllowedSkillsMarkup(profile){
  var slug=profile&&profile.slug||'';
  var selected=ensureSelectedChatSkills(profile);
  var options=state.chatSkillOptionsBySlug[slug]||[];
  var status=state.chatSkillOptionsStatusBySlug[slug]||'';
  var error=state.chatSkillOptionsErrorBySlug[slug]||'';
  var chips=selected.length?selected.map(function(skill){
    return '<span class="skill-chip" data-chat-skill-chip="'+esc(skill)+'"><code>'+esc(skill)+'</code><button type="button" class="icon-btn" data-act="remove-chat-skill" data-skill="'+esc(skill)+'" aria-label="Remove '+esc(skill)+'">x</button></span>';
  }).join(''):'<div class="provider-empty">'+esc(uiText('bot.noChatSkillsAllowed','No chat skills allowed yet.'))+'</div>';
  var optionHtml='<option value="">'+esc(uiText('bot.selectSkill','Select a skill'))+'</option>'+options.map(function(skill){
    var label=skill.title&&skill.title!==skill.skillName?skill.title+' ('+skill.skillName+')':skill.skillName;
    return '<option value="'+esc(skill.skillName)+'">'+esc(label)+'</option>';
  }).join('');
  var note=status==='loading'?'<div class="save-status saving">'+esc(uiText('bot.loadingChatSkills','Loading chat skills...'))+'</div>':(status==='error'?'<div class="save-status error">'+esc(error||uiText('bot.chatSkillsLoadFailed','Failed to load chat skills.'))+'</div>':'');
  return '<div class="field field-full chat-skills-field"><label>'+esc(uiText('bot.chatAllowedSkills','Private Chat Allowed Skills：'))+'</label>'+
    '<div class="chat-skill-chips">'+chips+'</div>'+
    '<div class="chat-skill-picker"><select data-field="chatSkillSelect"'+(status==='loading'?' disabled':'')+'>'+optionHtml+'</select><button type="button" class="btn btn-primary btn-sm" data-act="add-chat-skill"'+(status==='loading'?' disabled':'')+'>'+esc(uiText('bot.add','Add'))+'</button></div>'+
    note+
  '</div>';
}
function wireChatSkillControls(){
  qq('[data-act="add-chat-skill"]').forEach(function(el){
    el.addEventListener('click',function(event){
      event.preventDefault();
      var profile=selectedProfile();if(!profile)return;
      var select=q('[data-field="chatSkillSelect"]');var skill=String(select&&select.value||'').trim();
      if(!skill)return;
      state.chatAllowedSkillsBySlug[profile.slug]=normalizeChatSkillList(selectedChatSkills(profile).concat([skill]));
      if(state.selectedTab==='chatSkills')renderChatSkillsTab();else renderInfoTab();
    });
  });
  qq('[data-act="remove-chat-skill"]').forEach(function(el){
    el.addEventListener('click',function(event){
      event.preventDefault();
      var profile=selectedProfile();if(!profile)return;
      var skill=this.getAttribute('data-skill')||'';
      state.chatAllowedSkillsBySlug[profile.slug]=normalizeChatSkillList(selectedChatSkills(profile).filter(function(item){return item!==skill}));
      if(state.selectedTab==='chatSkills')renderChatSkillsTab();else renderInfoTab();
    });
  });
}
function infoFieldValue(field,fallback){
  var el=q('[data-field="'+field+'"]');
  return el?el.value:fallback;
}
function infoProviderTouched(field){
  var el=q('[data-field="'+field+'"]');
  return Boolean(el&&el.getAttribute&&el.getAttribute('data-provider-touched')==='1');
}
function queryWithin(root,selector){
  return root&&typeof root.querySelector==='function'?root.querySelector(selector):null;
}
function fieldValueWithin(root,field,fallback){
  var el=queryWithin(root,'[data-field="'+field+'"]');
  return el?el.value:fallback;
}
function providerTouchedWithin(root,field){
  var el=queryWithin(root,'[data-field="'+field+'"]');
  return Boolean(el&&el.getAttribute&&el.getAttribute('data-provider-touched')==='1');
}
function behaviorPanelForProfile(profile){
  var slug=profile&&profile.slug||'';
  var panel=q('[data-behavior-profile-slug]');
  if(!slug||!panel||!panel.getAttribute||panel.getAttribute('data-behavior-profile-slug')!==slug)return null;
  return panel;
}
function chatSkillsPanelForProfile(profile){
  var slug=profile&&profile.slug||'';
  var panel=q('[data-chat-skills-profile-slug]');
  if(!slug||!panel||!panel.getAttribute||panel.getAttribute('data-chat-skills-profile-slug')!==slug)return null;
  return panel;
}
function currentInfoFormDraft(profile){
  if(!profile||!profile.slug)return null;
  var panel=q('[data-info-profile-slug]');
  if(!panel||!panel.getAttribute||panel.getAttribute('data-info-profile-slug')!==profile.slug)return null;
  return {
    name:infoFieldValue('name',profile.name||''),
    role:infoFieldValue('role',profile.role||''),
    soul:infoFieldValue('soul',profile.soul||''),
    goal:infoFieldValue('goal',profile.goal||''),
    primaryProvider:infoFieldValue('primaryProvider',profile.primaryProvider||''),
    primaryProviderTouched:infoProviderTouched('primaryProvider'),
    fallbackProvider:infoFieldValue('fallbackProvider',profile.fallbackProvider||''),
    fallbackProviderTouched:infoProviderTouched('fallbackProvider'),
  };
}
function currentPublicIdentityDraft(profile){
  if(!profile||!profile.slug)return null;
  var panel=q('[data-public-identity-profile-slug]');
  if(!panel||!panel.getAttribute||panel.getAttribute('data-public-identity-profile-slug')!==profile.slug)return null;
  return {
    name:infoFieldValue('name',profile.name||''),
    bio:infoFieldValue('bio',profile.bio||''),
    primaryProvider:infoFieldValue('primaryProvider',profile.primaryProvider||''),
    primaryProviderTouched:infoProviderTouched('primaryProvider'),
    fallbackProvider:infoFieldValue('fallbackProvider',profile.fallbackProvider||''),
    fallbackProviderTouched:infoProviderTouched('fallbackProvider'),
  };
}
function currentBehaviorDraft(profile){
  var panel=behaviorPanelForProfile(profile);
  if(!panel)return null;
  var persona=publicPersonaValues(profile);
  return {
    role:fieldValueWithin(panel,'role',persona.role),
    soul:fieldValueWithin(panel,'soul',persona.soul),
    goal:fieldValueWithin(panel,'goal',persona.goal),
  };
}

function renderStats(){
  state.stats=state.stats||{};
}

function renderMetabotList(){
  var list=q('[data-metabot-list]');var count=q('[data-metabot-count]');if(!list)return;
  if(count)count.textContent=String(state.profiles.length);
  if(!state.profiles.length){list.innerHTML='<div class="session-empty"><p>'+esc(uiText('bot.noBotsYet','No Bots yet'))+'</p></div>';return}
  list.innerHTML=state.profiles.map(function(p){
    var selected=p.slug===state.selectedSlug?' selected':'';
    return'<div class="metabot-item'+selected+'" role="button" tabindex="0" data-slug="'+esc(p.slug)+'">'+
      '<div class="metabot-avatar">'+avatarMarkup(p,false)+'</div>'+
      '<div class="metabot-item-info"><div class="metabot-item-name-row">'+noLlmLabelMarkup(p)+'<div class="metabot-item-name">'+esc(p.name||p.slug)+'</div></div>'+
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

function renderBotHero(profile){
  var hero=q('[data-bot-hero]');if(!hero)return;
  if(!profile){hero.hidden=true;return}
  hero.hidden=false;
  var globalMetaId=String(profile.globalMetaId||'').trim();
  var botUri=globalMetaId?'metaid://'+globalMetaId:'';
  var avatar=q('[data-hero-avatar]');if(avatar)avatar.innerHTML=avatarMarkup(profile,true);
  var name=q('[data-hero-name]');if(name)name.textContent=profile.name||profile.slug||'Bot';
  var live=q('[data-live-indicator]');if(live){var online=uiText('bot.liveByDefault','Online');live.textContent='';live.setAttribute('aria-label',online);live.setAttribute('title',online)}
  var summary=q('[data-hero-summary]');if(summary){var bio=String(profile.bio||'').trim();summary.textContent=bio;summary.hidden=!bio}
  var id=q('[data-hero-global-meta-id]');if(id)id.textContent=globalMetaId||'Pending GlobalMetaID';
  var uri=q('[data-hero-bot-uri]');if(uri)uri.textContent=botUri||'metaid://pending';
  var copyGlobal=q('[data-copy-global-meta-id]');if(copyGlobal){copyGlobal.disabled=!globalMetaId;copyGlobal.setAttribute('data-value',globalMetaId);copyGlobal.setAttribute('aria-label','Copy GlobalMetaID');copyGlobal.setAttribute('title','Copy GlobalMetaID')}
  var copyUri=q('[data-copy-bot-uri]');if(copyUri){copyUri.disabled=!botUri;copyUri.setAttribute('data-value',botUri);copyUri.setAttribute('aria-label','Copy Homepage URI');copyUri.setAttribute('title','Copy Homepage URI')}
  var view=q('[data-act="view-bot-page"]');if(view)view.disabled=!globalMetaId;
  var conversations=q('[data-act="view-conversations"]');if(conversations)conversations.disabled=!globalMetaId;
}
function renderDetailHeader(profile){renderBotHero(profile)}

function setDetailVisible(visible){
  var empty=q('[data-detail-empty]');var bar=q('[data-tab-bar]');var content=q('[data-tab-content]');
  if(empty)empty.hidden=visible;
  if(bar)bar.hidden=!visible;
  if(content)content.hidden=!visible;
}

function selectMetabot(slug){
  if(!slug)return;
  state._sensitiveModalToken=null;
  setSelectedSlug(slug,{clearDrafts:true});
  renderMetabotList();
  renderDetailHeader(state.originalProfile);
  setDetailVisible(Boolean(state.originalProfile));
  renderCurrentTab();
}

function renderCurrentTab(){
  switchTab(state.selectedTab||'publicIdentity',true);
}

function renderInfoTab(options){
  options=options||{};
  var profile=selectedProfile();var root=q('[data-info-content]');if(!root)return;
  if(!profile){root.innerHTML='';return}
  state.originalProfile=profile;
  var draft=options.preserveDraft===false?null:currentInfoFormDraft(profile);
  var nameValue=draft?draft.name:(profile.name||'');
  var roleValue=draft?draft.role:(profile.role||'');
  var soulValue=draft?draft.soul:(profile.soul||'');
  var goalValue=draft?draft.goal:(profile.goal||'');
  var primaryProviderValue=draft?draft.primaryProvider:(profile.primaryProvider||'');
  var fallbackProviderValue=draft?draft.fallbackProvider:(profile.fallbackProvider||'');
  var avatar=state._pendingAvatar!==undefined?state._pendingAvatar:profile.avatarDataUrl;
  root.innerHTML='<div class="info-edit-panel" data-info-profile-slug="'+esc(profile.slug)+'">'+
    '<div class="info-avatar-section">'+
    '<div class="info-avatar-preview" data-avatar-preview>'+avatarMarkup({name:nameValue,avatarDataUrl:avatar},true)+'</div>'+
    '<div class="info-avatar-actions">'+
      '<button class="btn btn-sm" data-act="upload-avatar">Upload</button>'+
      '<button class="btn btn-sm btn-danger" data-act="remove-avatar"'+(avatar?'':' hidden')+'>Remove</button>'+
      '<input type="file" data-avatar-input accept="image/png,image/jpeg,image/webp,image/gif" hidden />'+
      '<span class="save-status" data-avatar-status></span>'+
    '</div></div>'+
    '<div class="info-id-row"><code>'+esc(profile.globalMetaId||'-')+'</code><button class="icon-btn" data-act="copy-profile-gmid" title="Copy GlobalMetaID" aria-label="Copy GlobalMetaID">⧉</button></div>'+
    '<div class="info-form-grid">'+
      '<div class="field"><label for="bot-name">Name</label><input id="bot-name" data-field="name" value="'+esc(nameValue)+'" /></div>'+
      providerPickerMarkup('primaryProvider','Primary Provider',primaryProviderValue,false,draft&&draft.primaryProviderTouched)+
      '<div class="field field-full"><label for="bot-role">Role</label><textarea id="bot-role" data-field="role">'+esc(roleValue)+'</textarea></div>'+
      '<div class="field field-full"><label for="bot-soul">Soul</label><textarea id="bot-soul" data-field="soul">'+esc(soulValue)+'</textarea></div>'+
      '<div class="field field-full"><label for="bot-goal">Goal</label><textarea id="bot-goal" data-field="goal">'+esc(goalValue)+'</textarea></div>'+
      providerPickerMarkup('fallbackProvider','Fallback Provider',fallbackProviderValue,true,draft&&draft.fallbackProviderTouched)+
    '</div>'+
    '<div class="info-save-row"><button class="btn btn-primary" data-act="save-info">Save Changes</button><span class="save-status" data-save-status></span></div></div>';
  var input=q('[data-avatar-input]');
  var upload=q('[data-act="upload-avatar"]');if(upload&&input)upload.addEventListener('click',function(){input.click()});
  var remove=q('[data-act="remove-avatar"]');if(remove)remove.addEventListener('click',function(){state._pendingAvatar='';renderAvatarPreview('');this.hidden=true});
  if(input)input.addEventListener('change',function(){var file=this.files&&this.files[0];if(file)handleAvatarUpload(file)});
  wireProviderPickers();
  var copy=q('[data-act="copy-profile-gmid"]');if(copy)copy.addEventListener('click',function(){copyToClipboard(profile.globalMetaId||'')});
  var save=q('[data-act="save-info"]');if(save)save.addEventListener('click',saveInfo);
  focusBotManagementTarget();
}

function renderPublicIdentityTab(options){
  options=options||{};
  var profile=selectedProfile();var root=q('[data-info-content]');if(!root)return;
  if(!profile){root.innerHTML='';return}
  state.originalProfile=profile;
  var draft=options.preserveDraft===false?null:currentPublicIdentityDraft(profile);
  var nameValue=draft?draft.name:(profile.name||'');
  var bioValue=draft?draft.bio:(profile.bio||'');
  var primaryProviderValue=draft?draft.primaryProvider:(profile.primaryProvider||'');
  var fallbackProviderValue=draft?draft.fallbackProvider:(profile.fallbackProvider||'');
  var avatar=state._pendingAvatar!==undefined?state._pendingAvatar:profile.avatarDataUrl;
  root.innerHTML='<div class="info-edit-panel" data-public-identity-profile-slug="'+esc(profile.slug)+'">'+
    '<div class="info-avatar-section">'+
    '<div class="info-avatar-preview" data-avatar-preview>'+avatarMarkup({name:nameValue,avatarDataUrl:avatar},true)+'</div>'+
    '<div class="info-avatar-actions">'+
      '<div class="info-avatar-label">'+esc(uiText('bot.avatar','Avatar'))+'</div>'+
      '<button class="btn btn-sm" data-act="upload-avatar">'+esc(uiText('bot.uploadReplace','Upload / Replace'))+'</button>'+
      '<button class="btn btn-sm btn-danger" data-act="remove-avatar"'+(avatar?'':' hidden')+'>'+esc(uiText('bot.removeAvatar','Remove'))+'</button>'+
      '<input type="file" data-avatar-input accept="image/png,image/jpeg,image/webp,image/gif" hidden />'+
      '<span class="save-status" data-avatar-status></span>'+
    '</div></div>'+
    '<div class="info-form-grid">'+
      '<div class="field field-full"><label for="bot-name">'+esc(uiText('bot.botName','Bot Name'))+'</label><input id="bot-name" data-field="name" value="'+esc(nameValue)+'" /></div>'+
      '<div class="provider-row">'+
        providerPickerMarkup('primaryProvider',uiText('bot.primaryLlmProvider','Primary LLM Provider'),primaryProviderValue,false,draft&&draft.primaryProviderTouched)+
        providerPickerMarkup('fallbackProvider',uiText('bot.fallbackLlmProvider','Fallback LLM Provider'),fallbackProviderValue,true,draft&&draft.fallbackProviderTouched)+
      '</div>'+
      '<div class="field field-full"><label for="bot-bio">'+esc(uiText('bot.publicBio','Public Bio'))+'</label><textarea id="bot-bio" data-field="bio">'+esc(bioValue)+'</textarea></div>'+
      homepagePanelMarkup(profile)+
    '</div>'+
    '<div class="info-save-row"><button class="btn btn-primary" data-act="save-public-identity">'+esc(uiText('bot.savePublicIdentity','Save Public Identity'))+'</button><span class="save-status" data-save-status></span></div></div>';
  var input=q('[data-avatar-input]');
  var upload=q('[data-act="upload-avatar"]');if(upload&&input)upload.addEventListener('click',function(){input.click()});
  var remove=q('[data-act="remove-avatar"]');if(remove)remove.addEventListener('click',function(){state._pendingAvatar='';renderAvatarPreview('');this.hidden=true});
  if(input)input.addEventListener('change',function(){var file=this.files&&this.files[0];if(file)handleAvatarUpload(file)});
  wireProviderPickers();
  wireHomepageControls();
  var save=q('[data-act="save-public-identity"]');if(save)save.addEventListener('click',savePublicIdentity);
  focusBotManagementTarget();
}

function renderBehaviorTab(options){
  options=options||{};
  var profile=selectedProfile();var root=q('[data-behavior-content]');if(!root)return;
  if(!profile){root.innerHTML='';return}
  state.originalProfile=profile;
  var draft=options.preserveDraft===false?null:currentBehaviorDraft(profile);
  var persona=publicPersonaValues(profile);
  var roleValue=draft?draft.role:persona.role;
  var soulValue=draft?draft.soul:persona.soul;
  var goalValue=draft?draft.goal:persona.goal;
  root.innerHTML='<div class="info-edit-panel" data-behavior-profile-slug="'+esc(profile.slug)+'">'+
    '<div class="info-form-grid">'+
      '<div class="field field-full"><label for="bot-role">'+esc(uiText('bot.role','Role'))+'</label><textarea id="bot-role" data-field="role" placeholder="'+esc(uiText('bot.rolePlaceholder','Describe what this Bot should be or specialize in.'))+'">'+esc(roleValue)+'</textarea></div>'+
      '<div class="field field-full"><label for="bot-soul">'+esc(uiText('bot.soul','Soul'))+'</label><textarea id="bot-soul" data-field="soul" placeholder="'+esc(uiText('bot.soulPlaceholder','Describe the tone, style, and boundaries.'))+'">'+esc(soulValue)+'</textarea></div>'+
      '<div class="field field-full"><label for="bot-goal">'+esc(uiText('bot.goal','Goal'))+'</label><textarea id="bot-goal" data-field="goal" placeholder="'+esc(uiText('bot.goalPlaceholder','Describe what this Bot should help users accomplish.'))+'">'+esc(goalValue)+'</textarea></div>'+
    '</div>'+
    '<div class="info-save-row"><button class="btn btn-primary" data-act="save-behavior">'+esc(uiText('bot.saveBehavior','Save Behavior'))+'</button><span class="save-status" data-save-status></span></div></div>';
  var panel=behaviorPanelForProfile(profile);
  var save=queryWithin(panel,'[data-act="save-behavior"]');if(save)save.addEventListener('click',saveBehavior);
  focusBotManagementTarget();
}

function renderChatSkillsTab(){
  var profile=selectedProfile();var root=q('[data-chat-skills-content]');if(!root)return;
  if(!profile){root.innerHTML='';return}
  state.originalProfile=profile;
  root.innerHTML='<div class="info-edit-panel" data-chat-skills-profile-slug="'+esc(profile.slug)+'">'+
    '<div class="info-form-grid">'+
      chatAllowedSkillsMarkup(profile)+
    '</div>'+
    '<div class="info-save-row"><button class="btn btn-primary" data-act="save-chat-skills">'+esc(uiText('bot.saveChatSkills','Save Chat Skills'))+'</button><span class="save-status" data-save-status></span></div></div>';
  wireChatSkillControls();
  if(!state.chatSkillOptionsStatusBySlug[profile.slug])loadChatSkillOptions(profile.slug);
  var panel=chatSkillsPanelForProfile(profile);
  var save=queryWithin(panel,'[data-act="save-chat-skills"]');if(save)save.addEventListener('click',saveChatSkills);
  focusBotManagementTarget();
}

function renderAvatarPreview(dataUrl){
  var preview=q('[data-avatar-preview]');if(!preview)return;
  var profile=selectedProfile()||{};
  preview.innerHTML=avatarMarkup({name:profile.name,avatarDataUrl:dataUrl},true);
}

function readAvatarFile(file,status,onReady){
  if(file.size>200*1024){if(status){status.textContent=uiText('bot.avatarTooLarge','Avatar must be 200KB or smaller.');status.className='save-status error'}return}
  var reader=new FileReader();
  reader.onload=function(){
    onReady(String(reader.result||''));
    if(status){status.textContent=uiText('bot.readyToSave','Ready to save');status.className='save-status success'}
  };
  reader.onerror=function(){if(status){status.textContent=uiText('bot.uploadFailed','Upload failed');status.className='save-status error'}};
  reader.readAsDataURL(file);
}
function handleAvatarUpload(file){
  var status=q('[data-avatar-status]');
  readAvatarFile(file,status,function(dataUrl){
    state._pendingAvatar=dataUrl;
    renderAvatarPreview(state._pendingAvatar);
    var remove=q('[data-act="remove-avatar"]');if(remove)remove.hidden=false;
  });
}
function renderHomepageDraftStatus(message,tone){
  var status=q('[data-homepage-status]');
  if(status){status.textContent=message||'';status.className='save-status '+(tone||'')}
}
function rerenderPublicIdentityForHomepage(){
  renderPublicIdentityTab({preserveDraft:true});
}
function toggleHomepageHelp(button){
  var wrap=button&&button.closest&&button.closest('[data-homepage-help]');
  if(!wrap||!wrap.classList)return;
  var open=!(wrap.classList.contains&&wrap.classList.contains('open'));
  wrap.classList.toggle('open',open);
  if(button.setAttribute)button.setAttribute('aria-expanded',open?'true':'false');
}
function readMetaAppHomepageDraftFromInput(options){
  options=options||{};
  var input=q('[data-field="homepage-metaapp-pin"]');
  var value=String(input&&input.value||'').trim();
  if(!value)return undefined;
  try{
    return normalizeMetaAppHomepageInput(value);
  }catch(error){
    if(options.optional)return undefined;
    throw error;
  }
}
function readHomepageDraftForSave(profile){
  var source=selectedHomepageSource(profile);
  if(source==='default')return null;
  if(source==='metaapp'){
    var metaAppDraft=readMetaAppHomepageDraftFromInput();
    if(!metaAppDraft)throw new Error(uiText('bot.homepageInvalidMetaAppPin','Enter a MetaApp pin ID without spaces.'));
    return metaAppDraft;
  }
  var pending=normalizeHomepage(state._pendingHomepage);
  if(pending&&homepageSourceFromHomepage(pending)==='metafile')return pending;
  var current=normalizeHomepage(profile&&profile.homepage);
  if(current&&homepageSourceFromHomepage(current)==='metafile')return current;
  throw new Error(uiText('bot.homepageUploadRequired','Upload a homepage file before saving.'));
}
function previewHomepageMetaApp(){
  try{
    var draft=readMetaAppHomepageDraftFromInput();
    if(!draft)throw new Error(uiText('bot.homepageInvalidMetaAppPin','Enter a MetaApp pin ID without spaces.'));
    state._pendingHomepage=draft;
    state._homepageSource='metaapp';
    window.location.href=metaAppBrowserPath(metaAppPinFromHomepage(draft));
  }catch(error){
    renderHomepageDraftStatus(error.message,'error');
  }
}
function handleHomepageSourceChange(){
  var profile=selectedProfile();
  var source=selectedHomepageSource(profile);
  state._homepageSource=source;
  state._homepageUploadWorking=false;
  state._homepageUploadToken+=1;
  if(source==='default')state._pendingHomepage=null;
  else state._pendingHomepage=undefined;
  rerenderPublicIdentityForHomepage();
  if(source==='default')renderHomepageDraftStatus(uiText('bot.homepageDefaultReadyToSave','Default homepage ready to save.'),'success');
}
function handleHomepageUploadFile(file){
  var profile=selectedProfile();if(!profile||!profile.slug||!file)return Promise.resolve();
  var profileSlug=profile.slug;
  var uploadToken=++state._homepageUploadToken;
  state._homepageUploadWorking=true;
  renderHomepageDraftStatus(uiText('bot.homepageUploading','Uploading homepage file...'),'saving');
  return readFileAsDataUrl(file).then(function(dataUrl){
    var base64=dataUrlBase64(dataUrl);
    return api('/api/bot/profiles/'+encodeURIComponent(profileSlug)+'/homepage/upload',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        fileName:file.name||'homepage-upload',
        contentType:file.type||'application/octet-stream',
        base64:base64,
      }),
    });
  }).then(function(r){
    if(state.selectedSlug!==profileSlug||state._homepageUploadToken!==uploadToken)return;
    var data=r.data||{};
    var uri=String(data.metafileUri||data.uri||'').trim();
    if(!uri&&data.pinId)uri='metafile://'+data.pinId;
    if(!uri)throw new Error(uiText('bot.uploadFailed','Upload failed'));
    state._pendingHomepage={
      uri:uri,
      renderer:'auto',
      contentType:data.contentType||file.type||'application/octet-stream',
    };
    state._homepageSource='metafile';
    var metaAppInput=q('[data-field="homepage-metaapp-pin"]');if(metaAppInput)metaAppInput.value='';
    rerenderPublicIdentityForHomepage();
    renderHomepageDraftStatus(uiText('bot.homepageReadyToSave','Homepage ready to save.'),'success');
  }).catch(function(error){
    if(state.selectedSlug===profileSlug&&state._homepageUploadToken===uploadToken)renderHomepageDraftStatus(error.message||String(error),'error');
  }).finally(function(){
    if(state._homepageUploadToken===uploadToken)state._homepageUploadWorking=false;
    if(state.selectedSlug===profileSlug){var upload=q('[data-act="upload-homepage"]');if(upload)upload.disabled=false}
  });
}
function wireHomepageControls(){
  var input=q('[data-homepage-file-input]');
  var upload=q('[data-act="upload-homepage"]');
  var source=q('[data-field="homepage-source"]');if(source)source.addEventListener('change',handleHomepageSourceChange);
  if(upload&&input)upload.addEventListener('click',function(){input.click()});
  if(input)input.addEventListener('change',function(){var file=this.files&&this.files[0];if(file)handleHomepageUploadFile(file)});
  var preview=q('[data-act="preview-homepage-metaapp"]');if(preview)preview.addEventListener('click',previewHomepageMetaApp);
  var help=q('[data-act="toggle-homepage-help"]');if(help)help.addEventListener('click',function(event){if(event&&event.preventDefault)event.preventDefault();toggleHomepageHelp(this)});
  var view=q('[data-act="view-homepage"]');if(view)view.addEventListener('click',viewSelectedBotPage);
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
  wireWalletModalActions();
}
function chainWritesList(chainWrites){
  var rows=[];
  (chainWrites||[]).forEach(function(write){
    (write.txids||[]).forEach(function(txid){rows.push({path:write.path||'transaction',txid:txid})});
  });
  if(!rows.length)return '<div class="modal-note">'+esc(uiText('bot.noTransactionIdReturned','No transaction ID was returned by the chain writer.'))+'</div>';
  var copyTxid=uiText('bot.copyTxid','Copy txid');
  return '<div class="txid-list">'+rows.map(function(row){
    return '<div class="txid-row"><div><span class="txid-path">'+esc(row.path)+'</span><code>'+esc(row.txid)+'</code></div><button class="icon-btn" data-copy-value="'+esc(row.txid)+'" title="'+esc(copyTxid)+'" aria-label="'+esc(copyTxid)+'">⧉</button></div>';
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
    '<p class="modal-note">'+esc(input.message||uiText('bot.onChainOperationConfirmed','The on-chain operation has been confirmed.'))+'</p>'+
    '<div class="identity-result">'+
      '<div><span>'+esc(uiText('bot.globalMetaId','GlobalMetaID'))+'</span><code>'+esc(profile.globalMetaId||'-')+'</code></div>'+
      '<button class="icon-btn" data-copy-value="'+esc(profile.globalMetaId||'')+'" title="Copy GlobalMetaID" aria-label="Copy GlobalMetaID">⧉</button>'+
    '</div>'+
    '<div class="modal-section-title">'+esc(uiText('bot.transactionIds','Transaction IDs'))+'</div>'+
    chainWritesList(input.chainWrites||[])+
  '</div><div class="modal-actions"><button class="btn btn-primary" data-act="modal-close">'+esc(uiText('bot.ok','OK'))+'</button></div>';
}
function showChainSuccessModal(input){
  openDynamicModal(input.title,chainSuccessBodyMarkup(input),{boxClass:'modal-box-wide'});
}
function walletChainConfig(chain){return WALLET_CHAINS.find(function(row){return row.chain===chain})||WALLET_CHAINS[0]}
function walletDisplayUnit(chain){return walletChainConfig(chain).displayUnit}
function walletInputUnit(chain){return walletChainConfig(chain).inputUnit}
function formatWalletBalance(balance,chain){
  if(!balance||typeof balance.totalSatoshis!=='number')return uiText('bot.balance','Balance')+': '+uiText('bot.unavailable','Unavailable').toLowerCase();
  return uiText('bot.balance','Balance')+': '+(balance.totalSatoshis/100000000).toFixed(8)+' '+walletDisplayUnit(chain);
}
function normalizeWalletDisplayAmount(value,chain){
  var text=String(value==null?'':value);
  var inputUnit=walletInputUnit(chain);
  var displayUnit=walletDisplayUnit(chain);
  if(!text||inputUnit===displayUnit)return text;
  var suffix=' '+inputUnit;
  if(text===inputUnit)return displayUnit;
  if(text.slice(-suffix.length)===suffix)return text.slice(0,-inputUnit.length)+displayUnit;
  return text;
}
function walletChainRowsMarkup(wallet){
  var addresses=wallet&&wallet.addresses||{};
  var balances=wallet&&wallet.balances||{};
  return WALLET_CHAINS.map(function(row){
    var address=addresses[row.chain]||'';
    var copyAddress=uiText('bot.copyAddress','Copy address');
    return '<div class="wallet-row" data-wallet-chain="'+esc(row.chain)+'"><div>'+
      '<span>'+esc(row.label+' '+uiText('bot.receiveAddress','Receive Address'))+'</span>'+
      '<code>'+esc(address||'-')+'</code>'+
      '<div class="wallet-balance">'+esc(formatWalletBalance(balances[row.chain],row.chain))+'</div>'+
      '</div><div class="wallet-row-actions">'+
      '<button class="icon-btn" data-act="copy-wallet-value" data-copy-value="'+esc(address)+'" title="'+esc(copyAddress)+'" aria-label="'+esc(copyAddress)+'">⧉</button>'+
      '<button class="btn btn-sm" data-act="wallet-transfer" data-chain="'+esc(row.chain)+'">'+esc(uiText('bot.transfer','Transfer'))+'</button>'+
      '</div></div>';
  }).join('');
}
function walletBodyMarkup(wallet){
  return '<div class="modal-body">'+
    walletChainRowsMarkup(wallet)+
  '</div><div class="modal-actions"><button class="btn" data-act="modal-close">'+esc(uiText('bot.close','Close'))+'</button></div>';
}
function walletBalanceSatoshis(wallet,chain){
  var balance=wallet&&wallet.balances&&wallet.balances[chain];
  return balance&&typeof balance.totalSatoshis==='number'?balance.totalSatoshis:null;
}
function walletAmountToSatoshis(amount){
  var text=String(amount||'').trim();
  if(!/^\d+(\.\d{1,8})?$/.test(text))return NaN;
  var parts=text.split('.');
  var whole=Number(parts[0]||'0');
  var frac=String(parts[1]||'').padEnd(8,'0');
  if(!Number.isSafeInteger(whole))return NaN;
  return whole*100000000+Number(frac);
}
function walletRoutePayload(response,nestedKey){
  var data=response&&response.data;
  return data&&data[nestedKey]?data[nestedKey]:(data||{});
}
function walletTransferFormMarkup(wallet,chain,status){
  var unit=walletDisplayUnit(chain);
  var balance=wallet&&wallet.balances&&wallet.balances[chain];
  var address=wallet&&wallet.addresses&&wallet.addresses[chain]||'-';
  var balanceText=formatWalletBalance(balance,chain);
  var balancePrefix=uiText('bot.balance','Balance')+': ';
  var available=balanceText.slice(0,balancePrefix.length)===balancePrefix?balanceText.slice(balancePrefix.length):balanceText;
  return '<div class="modal-body">'+
    '<div class="wallet-transfer-grid">'+
      '<div><span>'+esc(uiText('bot.chain','Chain'))+'</span><strong>'+esc(walletChainConfig(chain).label)+'</strong></div>'+
      '<div><span>'+esc(uiText('bot.available','Available'))+'</span><strong>'+esc(available)+'</strong></div>'+
      '<div class="field field-full"><label>'+esc(uiText('bot.fromAddress','From Address'))+'</label><code>'+esc(address)+'</code></div>'+
      '<div class="field field-full"><label for="wallet-transfer-to">'+esc(uiText('bot.recipient','Recipient'))+'</label><input id="wallet-transfer-to" data-field="wallet-transfer-to" autocomplete="off" /></div>'+
      '<div class="field"><label for="wallet-transfer-amount">'+esc(uiText('bot.amount','Amount'))+' ('+esc(unit)+')</label><input id="wallet-transfer-amount" data-field="wallet-transfer-amount" inputmode="decimal" autocomplete="off" /></div>'+
    '</div>'+
    '<div class="save-status '+esc(status&&status.type||'')+'" data-wallet-transfer-status>'+esc(status&&status.text||'')+'</div>'+
  '</div><div class="modal-actions"><button class="btn" data-act="modal-close">'+esc(uiText('bot.close','Close'))+'</button><button class="btn btn-primary" data-act="wallet-transfer-preview">'+esc(uiText('bot.next','Next'))+'</button></div>';
}
function walletTransferPreviewMarkup(wallet,chain,preview,status){
  var transfer=state._walletTransfer||{};
  var unit=walletDisplayUnit(chain);
  var fee=preview&&preview.estimatedFee?normalizeWalletDisplayAmount(preview.estimatedFee,chain):(preview&&typeof preview.feeSatoshis==='number'?(preview.feeSatoshis/100000000).toFixed(8)+' '+unit:null);
  var amount=preview&&preview.amount?normalizeWalletDisplayAmount(preview.amount,chain):((transfer.amount||'-')+' '+unit);
  var fromAddress=preview&&preview.fromAddress||(wallet&&wallet.addresses&&wallet.addresses[chain])||'-';
  return '<div class="modal-body">'+
    '<div class="wallet-confirm-grid">'+
      '<div><span>'+esc(uiText('bot.chain','Chain'))+'</span><strong>'+esc(walletChainConfig(chain).label)+'</strong></div>'+
      '<div><span>'+esc(uiText('bot.amount','Amount'))+'</span><strong>'+esc(amount)+'</strong></div>'+
      '<div><span>'+esc(uiText('bot.fromAddress','From Address'))+'</span><code>'+esc(fromAddress)+'</code></div>'+
      '<div><span>'+esc(uiText('bot.recipient','Recipient'))+'</span><code>'+esc(preview&&preview.toAddress||transfer.toAddress||'-')+'</code></div>'+
      '<div><span>'+esc(uiText('bot.estimatedFee','Estimated Fee'))+'</span><strong>'+esc(fee||uiText('bot.unavailable','Unavailable'))+'</strong></div>'+
    '</div>'+
    '<div class="save-status '+esc(status&&status.type||'')+'" data-wallet-transfer-status>'+esc(status&&status.text||'')+'</div>'+
  '</div><div class="modal-actions"><button class="btn" data-act="wallet-transfer-back">'+esc(uiText('bot.back','Back'))+'</button><button class="btn btn-primary" data-act="wallet-transfer-confirm">'+esc(uiText('bot.confirmTransfer','Confirm Transfer'))+'</button></div>';
}
function walletTransferSuccessMarkup(result){
  var transfer=state._walletTransfer||{};
  var unit=walletDisplayUnit(transfer.chain);
  var txid=result&&result.txid||result&&result.transactionId||'';
  var amount=result&&result.amount?normalizeWalletDisplayAmount(result.amount,transfer.chain):((transfer.amount||'-')+' '+unit);
  var copyTxid=uiText('bot.copyTxid','Copy txid');
  return '<div class="modal-body">'+
    '<div class="save-status success">'+esc(uiText('bot.transferBroadcastStatus','Transfer broadcast'))+': '+esc(amount)+'</div>'+
    '<div class="txid-row"><div><span>'+esc(uiText('bot.transactionId','Transaction ID'))+'</span><code>'+esc(txid||'-')+'</code></div><button class="icon-btn" data-copy-value="'+esc(txid)+'" title="'+esc(copyTxid)+'" aria-label="'+esc(copyTxid)+'">⧉</button></div>'+
  '</div><div class="modal-actions"><button class="btn btn-primary" data-act="modal-close">'+esc(uiText('bot.ok','OK'))+'</button></div>';
}
function openWalletTransferForm(chain,status){
  var slug=state.selectedSlug;
  var token=beginSensitiveModal('wallet-transfer',slug);
  var wallet=state._walletPanel||{};
  state._walletTransfer={wallet:wallet,chain:chain,slug:slug,token:token};
  openDynamicModal(uiText('bot.transfer','Transfer')+' '+walletChainConfig(chain).label,walletTransferFormMarkup(wallet,chain,status),{boxClass:'modal-box-wide'});
}
function setWalletTransferStatus(type,text){
  var status=q('[data-wallet-transfer-status]');
  if(status){status.textContent=text;status.className='save-status '+(type||'')}
}
function submitWalletTransferPreview(){
  var transfer=state._walletTransfer||{};
  var chain=transfer.chain;
  var slug=transfer.slug||state.selectedSlug;
  var token=transfer.token;
  if(!slug||!isSensitiveModalCurrent(token,slug))return Promise.resolve();
  var toAddress=(q('[data-field="wallet-transfer-to"]')||{}).value||'';
  var amount=(q('[data-field="wallet-transfer-amount"]')||{}).value||'';
  toAddress=toAddress.trim();amount=amount.trim();
  var amountSatoshis=walletAmountToSatoshis(amount);
  if(!toAddress){setWalletTransferStatus('error',uiText('bot.recipientRequired','Recipient is required.'));return Promise.resolve()}
  if(!Number.isFinite(amountSatoshis)||amountSatoshis<=0){setWalletTransferStatus('error',uiText('bot.enterPositiveAmount','Enter a positive {unit} amount.',{unit:walletDisplayUnit(chain)}));return Promise.resolve()}
  var balanceSatoshis=walletBalanceSatoshis(transfer.wallet||state._walletPanel,chain);
  if(balanceSatoshis!==null&&amountSatoshis>balanceSatoshis){setWalletTransferStatus('error',uiText('bot.amountExceedsBalance','Amount exceeds available balance: {balance}',{balance:(balanceSatoshis/100000000).toFixed(8)+' '+walletDisplayUnit(chain)}));return Promise.resolve()}
  var btn=q('[data-act="wallet-transfer-preview"]');if(btn)btn.disabled=true;
  setWalletTransferStatus('saving',uiText('bot.preparingTransferPreview','Preparing transfer preview...'));
  var body={chain:chain,toAddress:toAddress,amount:amount};
  return api('/api/bot/profiles/'+encodeURIComponent(slug)+'/wallet/transfer/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){
    if(!isSensitiveModalCurrent(token,slug))return;
    var preview=walletRoutePayload(r,'preview');
    state._walletTransfer={wallet:transfer.wallet||state._walletPanel,chain:chain,slug:slug,token:token,toAddress:toAddress,amount:amount,preview:preview};
    openDynamicModal(uiText('bot.confirmTransfer','Confirm Transfer')+' '+walletChainConfig(chain).label,walletTransferPreviewMarkup(transfer.wallet||state._walletPanel||{},chain,preview),{boxClass:'modal-box-wide'});
  }).catch(function(error){
    if(!isSensitiveModalCurrent(token,slug))return;
    setWalletTransferStatus('error',error.message);
  }).finally(function(){btn=q('[data-act="wallet-transfer-preview"]');if(btn)btn.disabled=false});
}
function submitWalletTransferConfirm(){
  var transfer=state._walletTransfer||{};
  var slug=transfer.slug||state.selectedSlug;
  var token=transfer.token;
  if(!slug||!isSensitiveModalCurrent(token,slug))return Promise.resolve();
  var btn=q('[data-act="wallet-transfer-confirm"]');if(btn)btn.disabled=true;
  setWalletTransferStatus('saving',uiText('bot.broadcastingTransfer','Broadcasting transfer...'));
  var body={chain:transfer.chain,toAddress:transfer.toAddress,amount:transfer.amount};
  return api('/api/bot/profiles/'+encodeURIComponent(slug)+'/wallet/transfer/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){
    if(!isSensitiveModalCurrent(token,slug))return;
    var result=walletRoutePayload(r,'result');
    return api('/api/bot/profiles/'+encodeURIComponent(slug)+'/wallet').then(function(walletResponse){
      if(!isSensitiveModalCurrent(token,slug))return;
      state._walletPanel=walletResponse.data&&walletResponse.data.wallet||state._walletPanel;
      openDynamicModal(uiText('bot.transferBroadcast','Transfer Broadcast'),walletTransferSuccessMarkup(result),{boxClass:'modal-box-wide'});
    }).catch(function(){
      if(!isSensitiveModalCurrent(token,slug))return;
      openDynamicModal(uiText('bot.transferBroadcast','Transfer Broadcast'),walletTransferSuccessMarkup(result),{boxClass:'modal-box-wide'});
    });
  }).catch(function(error){
    if(!isSensitiveModalCurrent(token,slug))return;
    setWalletTransferStatus('error',error.message);
  }).finally(function(){btn=q('[data-act="wallet-transfer-confirm"]');if(btn)btn.disabled=false});
}
function wireWalletModalActions(){
  qq('[data-act="wallet-transfer"]').forEach(function(el){el.addEventListener('click',function(){openWalletTransferForm(this.getAttribute('data-chain')||'btc')})});
  var preview=q('[data-act="wallet-transfer-preview"]');if(preview)preview.addEventListener('click',submitWalletTransferPreview);
  var confirm=q('[data-act="wallet-transfer-confirm"]');if(confirm)confirm.addEventListener('click',submitWalletTransferConfirm);
  var back=q('[data-act="wallet-transfer-back"]');if(back)back.addEventListener('click',function(){var transfer=state._walletTransfer||{};openWalletTransferForm(transfer.chain||'btc')});
}
function backupBodyMarkup(backup){
  var words=(backup&&backup.words)||[];
  return '<div class="modal-body">'+
    '<div class="warning-panel"><strong>'+esc(uiText('bot.backupWarningTitle','Write these 12 words down and store them offline.'))+'</strong><span>'+esc(uiText('bot.backupWarningBody','Anyone who gets this phrase can control this Bot and access its assets.'))+'</span></div>'+
    '<ol class="mnemonic-grid">'+words.map(function(word,index){return '<li class="mnemonic-word"><span>'+String(index+1)+'.</span><code>'+esc(word)+'</code></li>'}).join('')+'</ol>'+
  '</div><div class="modal-actions"><button class="btn" data-act="modal-close">'+esc(uiText('bot.close','Close'))+'</button></div>';
}
function deleteConfirmMarkup(profile,count,canConfirm,status){
  return '<div class="modal-body">'+
    '<div class="warning-panel danger"><strong>'+esc(uiText('bot.deleteWarningTitle','Deleting this Bot will remove all local information.'))+'</strong><span>'+esc(uiText('bot.deleteWarningBody','Please make sure you have backed up the mnemonic, otherwise it cannot be recovered after deletion.'))+'</span></div>'+
    '<div class="delete-target"><span>Bot</span><strong>'+esc((profile&&profile.name)||((profile&&profile.slug)||'-'))+'</strong></div>'+
    (status?'<div class="save-status '+esc(status.type||'')+'">'+esc(status.text||'')+'</div>':'')+
  '</div><div class="modal-actions"><button class="btn" data-act="modal-close"'+(state._deleteWorking?' disabled':'')+'>'+esc(uiText('bot.cancel','Cancel'))+'</button>'+
    '<button class="btn btn-danger" data-act="confirm-delete"'+(canConfirm&&!state._deleteWorking?'':' disabled')+'>'+esc(canConfirm?uiText('bot.confirmDelete','Confirm Delete'):uiText('bot.confirmDeleteCountdown','Confirm Delete ({count}s)',{count:count}))+'</button></div>';
}
function openWalletPanel(){
  var profile=selectedProfile();if(!profile)return;
  var token=beginSensitiveModal('wallet',profile.slug);
  openDynamicModal(uiText('bot.wallet','Wallet'),'<div class="modal-body"><div class="modal-note">'+esc(uiText('bot.loadingWalletAddresses','Loading wallet addresses...'))+'</div></div>');
  api('/api/bot/profiles/'+encodeURIComponent(profile.slug)+'/wallet').then(function(r){
    if(!isSensitiveModalCurrent(token,profile.slug))return;
    state._walletPanel=r.data&&r.data.wallet||{};
    openDynamicModal(uiText('bot.wallet','Wallet'),walletBodyMarkup(state._walletPanel),{boxClass:'modal-box-wide'});
  }).catch(function(error){if(!isSensitiveModalCurrent(token,profile.slug))return;openDynamicModal(uiText('bot.wallet','Wallet'),'<div class="modal-body"><div class="save-status error">'+esc(error.message)+'</div></div><div class="modal-actions"><button class="btn" data-act="modal-close">'+esc(uiText('bot.close','Close'))+'</button></div>')});
}
function openBackupPanel(){
  var profile=selectedProfile();if(!profile)return;
  var token=beginSensitiveModal('backup',profile.slug);
  openDynamicModal(uiText('bot.backupMnemonic','Backup Mnemonic'),'<div class="modal-body"><div class="modal-note">'+esc(uiText('bot.loadingBackupPhrase','Loading backup phrase...'))+'</div></div>');
  api('/api/bot/profiles/'+encodeURIComponent(profile.slug)+'/backup').then(function(r){
    if(!isSensitiveModalCurrent(token,profile.slug))return;
    openDynamicModal(uiText('bot.backupMnemonic','Backup Mnemonic'),backupBodyMarkup(r.data&&r.data.backup||{}),{boxClass:'modal-box-wide'});
  }).catch(function(error){if(!isSensitiveModalCurrent(token,profile.slug))return;openDynamicModal(uiText('bot.backupMnemonic','Backup Mnemonic'),'<div class="modal-body"><div class="save-status error">'+esc(error.message)+'</div></div><div class="modal-actions"><button class="btn" data-act="modal-close">'+esc(uiText('bot.close','Close'))+'</button></div>')});
}
function renderDeleteModal(profile,status){
  openDynamicModal(uiText('bot.deleteBot','Delete Bot'),deleteConfirmMarkup(profile,state._deleteCountdown,state._deleteCountdown<=0,status),{locked:state._deleteWorking});
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
  renderDeleteModal(profile,{type:'saving',text:uiText('bot.deletingLocalBotData','Deleting local Bot data...')});
  api('/api/bot/profiles/'+encodeURIComponent(profile.slug),{method:'DELETE'}).then(function(){
    closeDynamicModal();
    setSelectedSlug('');
    state.sessions=[];
    return loadProfiles().then(function(){return loadSessions()});
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
  var nextChatSkills=selectedChatSkills(profile);
  if(!sameChatSkillList(nextChatSkills,profile.allowChatSkills||[]))payload.allowChatSkills=nextChatSkills;
  if(state._pendingAvatar!==undefined)changedValue(payload,'avatarDataUrl',state._pendingAvatar,profile.avatarDataUrl||'');
  if(!Object.keys(payload).length){if(status){status.textContent=uiText('bot.noChanges','No changes');status.className='save-status'}return}
  if(status){status.textContent=uiText('bot.saving','Saving...');status.className='save-status saving'}
  if(btn)btn.disabled=true;
  return api('/api/bot/profiles/'+encodeURIComponent(state.selectedSlug),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(function(r){
    var updated=r.data.profile;
    state.chatAllowedSkillsBySlug[updated.slug]=normalizeChatSkillList(updated.allowChatSkills!==undefined?updated.allowChatSkills:(payload.allowChatSkills!==undefined?payload.allowChatSkills:profile.allowChatSkills));
    state.profiles=state.profiles.map(function(p){return p.slug===updated.slug?updated:p});
    state.originalProfile=updated;
    state._pendingAvatar=undefined;
    renderMetabotList();
    renderDetailHeader(updated);
    renderInfoTab({preserveDraft:false});
    renderStats();
    status=q('[data-save-status]');if(status){status.textContent=uiText('bot.onChainUpdateConfirmed','On-chain update confirmed.');status.className='save-status success'}
    showChainSuccessModal({
      title:uiText('bot.profileUpdatedOnChain','Profile Updated On-Chain'),
      message:uiText('bot.profileChangesWrittenOnChain','Profile changes were written on-chain before local data was saved.'),
      profile:updated,
      chainWrites:(r.data&&r.data.chainWrites)||[],
    });
    return Promise.resolve();
  }).catch(function(error){
    if(status){status.textContent=error.message;status.className='save-status error'}
  }).finally(function(){btn=q('[data-act="save-info"]');if(btn)btn.disabled=false});
}

function savePublicIdentity(){
  var profile=state.originalProfile||selectedProfile();if(!profile||!state.selectedSlug)return;
  var profileSlug=profile.slug||state.selectedSlug;
  var status=q('[data-save-status]');var btn=q('[data-act="save-public-identity"]');
  var payload={};
  changedValue(payload,'name',(q('[data-field="name"]')||{}).value||'',profile.name||'');
  changedValue(payload,'bio',(q('[data-field="bio"]')||{}).value||'',profile.bio||'');
  if(state._pendingAvatar!==undefined)changedValue(payload,'avatarDataUrl',state._pendingAvatar,profile.avatarDataUrl||'');
  var primaryEl=q('[data-field="primaryProvider"]');var fallbackEl=q('[data-field="fallbackProvider"]');
  if(primaryEl&&primaryEl.getAttribute('data-provider-touched')==='1')changedValue(payload,'primaryProvider',primaryEl.value||null,profile.primaryProvider||null);
  if(fallbackEl&&fallbackEl.getAttribute('data-provider-touched')==='1')changedValue(payload,'fallbackProvider',fallbackEl.value||null,profile.fallbackProvider||null);
  try{
    var inputHomepage=readHomepageDraftForSave(profile);
    if(inputHomepage!==undefined)state._pendingHomepage=inputHomepage;
  }catch(error){
    renderHomepageDraftStatus(error.message,'error');
    return Promise.resolve();
  }
  if(state._pendingHomepage!==undefined&&!sameHomepage(state._pendingHomepage,profile.homepage))payload.homepage=state._pendingHomepage;
  if(!Object.keys(payload).length){if(status){status.textContent=uiText('bot.noChanges','No changes');status.className='save-status'}return}
  if(status){status.textContent=uiText('bot.saving','Saving...');status.className='save-status saving'}
  if(btn)btn.disabled=true;
  return api('/api/bot/profiles/'+encodeURIComponent(profileSlug),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(function(r){
    var updated=r.data.profile;
    state.profiles=state.profiles.map(function(p){return p.slug===updated.slug?updated:p});
    if(state.selectedSlug!==profileSlug)return;
    state.originalProfile=updated;
    state._pendingAvatar=undefined;
    state._pendingHomepage=undefined;
    state._homepageSource='';
    renderMetabotList();
    renderDetailHeader(updated);
    renderPublicIdentityTab({preserveDraft:false});
    status=q('[data-save-status]');if(status){status.textContent=uiText('bot.onChainUpdateConfirmed','On-chain update confirmed.');status.className='save-status success'}
    showChainSuccessModal({
      title:uiText('bot.profileUpdatedOnChain','Profile Updated On-Chain'),
      message:uiText('bot.profileChangesWrittenOnChain','Profile changes were written on-chain before local data was saved.'),
      profile:updated,
      chainWrites:(r.data&&r.data.chainWrites)||[],
    });
  }).catch(function(error){
    if(status){status.textContent=error.message;status.className='save-status error'}
  }).finally(function(){btn=q('[data-act="save-public-identity"]');if(btn)btn.disabled=false});
}

function saveBehavior(){
  var profile=state.originalProfile||selectedProfile();if(!profile||!state.selectedSlug)return;
  var profileSlug=profile.slug||state.selectedSlug;
  var panel=behaviorPanelForProfile(profile);if(!panel)return;
  var status=queryWithin(panel,'[data-save-status]');var btn=queryWithin(panel,'[data-act="save-behavior"]');
  var payload={};
  var persona=publicPersonaValues(profile);
  changedValue(payload,'role',fieldValueWithin(panel,'role',''),persona.role);
  changedValue(payload,'soul',fieldValueWithin(panel,'soul',''),persona.soul);
  changedValue(payload,'goal',fieldValueWithin(panel,'goal',''),persona.goal);
  if(!Object.keys(payload).length){if(status){status.textContent=uiText('bot.noChanges','No changes');status.className='save-status'}return}
  if(status){status.textContent=uiText('bot.saving','Saving...');status.className='save-status saving'}
  if(btn)btn.disabled=true;
  return api('/api/bot/profiles/'+encodeURIComponent(profileSlug),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(function(r){
    var updated=r.data.profile;
    state.profiles=state.profiles.map(function(p){return p.slug===updated.slug?updated:p});
    if(state.selectedSlug!==profileSlug)return;
    state.originalProfile=updated;
    renderMetabotList();
    renderDetailHeader(updated);
    renderBehaviorTab({preserveDraft:false});
    panel=behaviorPanelForProfile(updated);status=queryWithin(panel,'[data-save-status]');if(status){status.textContent=uiText('bot.onChainUpdateConfirmed','On-chain update confirmed.');status.className='save-status success'}
    showChainSuccessModal({
      title:uiText('bot.profileUpdatedOnChain','Profile Updated On-Chain'),
      message:uiText('bot.profileChangesWrittenOnChain','Profile changes were written on-chain before local data was saved.'),
      profile:updated,
      chainWrites:(r.data&&r.data.chainWrites)||[],
    });
  }).catch(function(error){
    if(state.selectedSlug===profileSlug&&status){status.textContent=error.message;status.className='save-status error'}
  }).finally(function(){if(state.selectedSlug===profileSlug){panel=behaviorPanelForProfile(profile);btn=queryWithin(panel,'[data-act="save-behavior"]');if(btn)btn.disabled=false}});
}

function saveChatSkills(){
  var profile=state.originalProfile||selectedProfile();if(!profile||!state.selectedSlug)return;
  var profileSlug=profile.slug||state.selectedSlug;
  var panel=chatSkillsPanelForProfile(profile);if(!panel)return;
  var status=queryWithin(panel,'[data-save-status]');var btn=queryWithin(panel,'[data-act="save-chat-skills"]');
  var nextChatSkills=selectedChatSkills(profile);
  var payload={};
  if(!sameChatSkillList(nextChatSkills,profile.allowChatSkills||[]))payload.allowChatSkills=nextChatSkills;
  if(!Object.keys(payload).length){if(status){status.textContent=uiText('bot.noChanges','No changes');status.className='save-status'}return}
  if(status){status.textContent=uiText('bot.saving','Saving...');status.className='save-status saving'}
  if(btn)btn.disabled=true;
  return api('/api/bot/profiles/'+encodeURIComponent(profileSlug),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(function(r){
    var updated=r.data.profile;
    state.chatAllowedSkillsBySlug[updated.slug]=normalizeChatSkillList(updated.allowChatSkills!==undefined?updated.allowChatSkills:payload.allowChatSkills);
    state.profiles=state.profiles.map(function(p){return p.slug===updated.slug?updated:p});
    if(state.selectedSlug!==profileSlug)return;
    state.originalProfile=updated;
    renderMetabotList();
    renderDetailHeader(updated);
    renderChatSkillsTab();
    panel=chatSkillsPanelForProfile(updated);status=queryWithin(panel,'[data-save-status]');if(status){status.textContent=uiText('bot.onChainUpdateConfirmed','On-chain update confirmed.');status.className='save-status success'}
    showChainSuccessModal({
      title:uiText('bot.profileUpdatedOnChain','Profile Updated On-Chain'),
      message:uiText('bot.profileChangesWrittenOnChain','Profile changes were written on-chain before local data was saved.'),
      profile:updated,
      chainWrites:(r.data&&r.data.chainWrites)||[],
    });
  }).catch(function(error){
    if(state.selectedSlug===profileSlug&&status){status.textContent=error.message;status.className='save-status error'}
  }).finally(function(){if(state.selectedSlug===profileSlug){panel=chatSkillsPanelForProfile(profile);btn=queryWithin(panel,'[data-act="save-chat-skills"]');if(btn)btn.disabled=false}});
}

function resetPublicIdentity(){
  state._pendingAvatar=undefined;
  state._pendingHomepage=undefined;
  state._homepageSource='';
  var profile=selectedProfile();
  state.originalProfile=profile;
  renderPublicIdentityTab({preserveDraft:false});
}

function renderHistoryTab(){
  var tb=q('[data-execution-history-list]');if(!tb)return;
  var rows=state.sessions.filter(function(s){return s.metaBotSlug===state.selectedSlug});
  if(!rows.length){tb.innerHTML='<tr><td colspan="7" class="table-empty"><strong>'+esc(uiText('bot.noExecutionsYet','No executions yet for this Bot'))+'</strong></td></tr>';focusBotManagementTarget();return}
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
      '<td><button class="btn btn-sm" data-act="toggle-exec" data-detail="'+detailId+'" aria-expanded="false">'+esc(uiText('bot.details','Details'))+'</button></td></tr>'+
      '<tr class="exec-detail-row" id="'+detailId+'" hidden><td colspan="7"><div class="exec-detail">'+
        '<div><div class="exec-detail-label">'+esc(uiText('bot.sessionId','Session ID'))+'</div><pre>'+esc(s.sessionId||'-')+'</pre></div>'+
        '<div><div class="exec-detail-label">'+esc(uiText('bot.outputError','Output/Error'))+'</div><pre>'+esc(clampBlock(resultSummary(s)))+'</pre></div>'+
        '<div><div class="exec-detail-label">'+esc(uiText('bot.fullPrompt','Full Prompt'))+'</div><pre>'+esc(clampBlock(s.prompt))+'</pre></div>'+
        '<div><div class="exec-detail-label">'+esc(uiText('bot.runtime','Runtime'))+'</div><pre>'+esc((s.runtimeId||'-')+'\n'+provider)+'</pre></div>'+
      '</div></td></tr>'
  }).join('');
  qq('[data-act="toggle-exec"]').forEach(function(el){el.addEventListener('click',function(){toggleExecDetail(this)})});
  focusBotManagementTarget();
}

function renderRuntimeSummary(){
  var root=q('[data-runtime-summary]');if(!root)return;
  var profile=selectedProfile();
  var rows=[];
  var roles=[['primary',profile&&(profile.primaryProvider||''),'Primary'],['fallback',profile&&(profile.fallbackProvider||''),'Fallback']];
  roles.forEach(function(entry){
    var provider=entry[1];
    var rt=providerRuntime(provider);
    var health=rt&&(rt.health)||'';
    var dotCls=health==='healthy'?'healthy':(health&&health!=='healthy'?'unhealthy':'');
    var name=rt?(rt.displayName||rt.provider||rt.id||'-'):(provider||uiText('bot.noProvider','No provider'));
    var metaBits=[];
    if(rt&&rt.provider)metaBits.push(rt.provider);
    if(health)metaBits.push(health);
    if(rt&&rt.version)metaBits.push('v'+rt.version);
    var meta=metaBits.join(' · ')||uiText('bot.notConfigured','Not configured');
    rows.push('<div class="runtime-summary-row">'+
      '<span class="runtime-summary-role">'+esc(entry[2])+'</span>'+
      '<span class="runtime-summary-dot '+dotCls+'" aria-hidden="true"></span>'+
      '<span class="runtime-summary-name">'+esc(name)+'</span>'+
      '<span class="runtime-summary-meta">'+esc(meta)+'</span>'+
    '</div>');
  });
  root.innerHTML=rows.join('');
}

function renderSettingsTab(){
  var root=q('[data-settings-content]');if(!root)return;
  var profile=selectedProfile();
  if(!profile){root.innerHTML='';return}
  if(!state.profileConfigs[profile.slug]){
    root.innerHTML='<div class="settings-form"><div class="settings-note">'+esc(uiText('bot.loadingSettings','Loading settings...'))+'</div></div>';
    return;
  }
  var current=defaultWriteNetwork();
  root.setAttribute('data-default-write-network',current);
  var options=['mvc','btc','doge','opcat'].map(function(network){
    return '<option value="'+network+'"'+(network===current?' selected':'')+'>'+network.toUpperCase()+'</option>';
  }).join('');
  root.innerHTML='<div class="settings-form">'+
    '<div class="field"><label for="default-write-network">'+esc(uiText('bot.defaultWriteNetwork','Default Write Network'))+'</label><select id="default-write-network" data-field="defaultWriteNetwork">'+options+'</select></div>'+
    '<div class="settings-note">'+esc(uiText('bot.defaultWriteNetworkNote','Used by write commands when no explicit chain is supplied. Wallet balance and transfer keep their own chain selection rules.'))+'</div>'+
    '<div class="settings-save-row"><button class="btn btn-primary" data-act="save-settings">'+esc(uiText('bot.saveSettings','Save Settings'))+'</button><span class="save-status" data-settings-status></span></div>'+
  '</div>';
  var save=q('[data-act="save-settings"]');if(save)save.addEventListener('click',saveSettings);
}

function renderAdvancedTab(){
  renderSettingsTab();
  renderRuntimeSummary();
  loadSelectedProfileConfig();
  loadSessions();
}

function toggleExecDetail(btn){
  var id=btn.getAttribute('data-detail');var row=document.getElementById(id);if(!row)return;
  var open=row.hasAttribute('hidden');
  if(open){row.removeAttribute('hidden');btn.setAttribute('aria-expanded','true')}else{row.setAttribute('hidden','');btn.setAttribute('aria-expanded','false')}
}

function renderPlaceholderTab(tab){
  var selector=tab==='behavior'?'[data-behavior-content]':tab==='chatSkills'?'[data-chat-skills-content]':'';
  var root=selector?q(selector):null;
  if(!root)return;
  var copy=tab==='behavior'?uiText('bot.behaviorPlaceholder','Behavior controls will be available here.'):uiText('bot.chatSkillsPlaceholder','Chat skill controls will be available here.');
  root.innerHTML='<div class="session-empty"><p>'+esc(copy)+'</p></div>';
}

function switchTab(tab,silent){
  var allowed={publicIdentity:1,behavior:1,chatSkills:1,advanced:1};
  state.selectedTab=allowed[tab]?tab:'publicIdentity';
  qq('[data-tab]').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-tab')===state.selectedTab)});
  qq('[data-tab-panel]').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-tab-panel')===state.selectedTab)});
  if(state.selectedTab==='advanced')renderAdvancedTab();
  else if(state.selectedTab==='publicIdentity')renderPublicIdentityTab();
  else if(state.selectedTab==='behavior')renderBehaviorTab();
  else if(state.selectedTab==='chatSkills')renderChatSkillsTab();
  else renderPlaceholderTab(state.selectedTab);
}

function loadStats(){renderStats();return Promise.resolve()}
function loadProfiles(){return api('/api/bot/profiles').then(function(r){state.profiles=(r.data&&r.data.profiles)||[];state.profiles.forEach(function(profile){if(profile&&profile.slug&&!Object.prototype.hasOwnProperty.call(state.chatAllowedSkillsBySlug,profile.slug))state.chatAllowedSkillsBySlug[profile.slug]=normalizeChatSkillList(profile.allowChatSkills)});applyBotManagementRouteRequest();if(!state.selectedSlug&&state.profiles.length)setSelectedSlug(state.profiles[0].slug);if(state.selectedSlug&&!state.profiles.some(function(p){return p.slug===state.selectedSlug}))setSelectedSlug(state.profiles[0]&&state.profiles[0].slug||'');state.originalProfile=selectedProfile();renderMetabotList();renderDetailHeader(state.originalProfile);setDetailVisible(Boolean(state.originalProfile));renderCurrentTab();renderStats()})}
function loadRuntimes(){return api('/api/bot/runtimes').then(function(r){state.runtimes=(r.data&&r.data.runtimes)||[];state._runtimesLoaded=true;renderMetabotList();renderCurrentTab();renderStats();if(state._runtimeModalOpen)renderRuntimeModal()}).catch(function(){state.runtimes=[];state._runtimesLoaded=true;renderMetabotList();renderCurrentTab();renderStats();if(state._runtimeModalOpen)renderRuntimeModal()})}
function loadSessions(slug){var activeSlug=slug||state.selectedSlug;if(!activeSlug){state.sessions=[];renderHistoryTab();renderStats();return Promise.resolve()}return api('/api/bot/sessions?slug='+encodeURIComponent(activeSlug)+'&limit=50').then(function(r){if(activeSlug!==state.selectedSlug)return;state.sessions=(r.data&&r.data.sessions)||[];renderHistoryTab();renderStats()}).catch(function(){if(activeSlug!==state.selectedSlug)return;state.sessions=[];renderHistoryTab();renderStats()})}
function loadSelectedProfileConfig(force){
  var slug=state.selectedSlug;
  if(!slug)return Promise.resolve();
  if(!force&&state.profileConfigs[slug])return Promise.resolve(state.profileConfigs[slug]);
  return api('/api/bot/profiles/'+encodeURIComponent(slug)+'/config').then(function(r){
    if(slug!==state.selectedSlug)return;
    state.profileConfigs[slug]=r.data||{chain:{defaultWriteNetwork:'mvc'}};
    renderSettingsTab();
  }).catch(function(error){
    if(slug!==state.selectedSlug)return;
    var root=q('[data-settings-content]');
    if(root)root.innerHTML='<div class="settings-form"><div class="save-status error">'+esc(error.message)+'</div></div>';
  });
}
function loadAll(){return Promise.all([loadProfiles(),loadRuntimes()])}

function saveSettings(){
  var profile=selectedProfile();if(!profile)return;
  var select=q('[data-field="defaultWriteNetwork"]');var status=q('[data-settings-status]');var btn=q('[data-act="save-settings"]');
  var value=(select&&select.value)||defaultWriteNetwork();
  if(status){status.textContent=uiText('bot.saving','Saving...');status.className='save-status saving'}
  if(btn)btn.disabled=true;
  return api('/api/bot/profiles/'+encodeURIComponent(profile.slug)+'/config',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({chain:{defaultWriteNetwork:value}})}).then(function(r){
    state.profileConfigs[profile.slug]=r.data||state.profileConfigs[profile.slug]||{chain:{defaultWriteNetwork:'mvc'}};
    renderSettingsTab();
    status=q('[data-settings-status]');if(status){status.textContent=uiText('bot.saved','Saved');status.className='save-status success'}
  }).catch(function(error){
    if(status){status.textContent=error.message;status.className='save-status error'}
  }).finally(function(){btn=q('[data-act="save-settings"]');if(btn)btn.disabled=false});
}

function discoverRuntimes(){
  var btn=q('[data-act="discover-runtimes"]');if(btn){btn.disabled=true;btn.textContent=uiText('bot.refreshing','Refreshing...')}
  api('/api/bot/runtimes/discover',{method:'POST'}).then(function(){return loadRuntimes()}).catch(function(error){showToast(error.message||uiText('bot.runtimeRefreshFailed','Runtime refresh failed'))}).finally(function(){btn=q('[data-act="discover-runtimes"]');if(btn){btn.disabled=false;btn.textContent=uiText('bot.refreshRuntimes','Refresh Runtimes')}})
}
function testRuntime(runtimeId){
  if(!runtimeId)return Promise.resolve();
  state._runtimeTestById[runtimeId]='testing';
  renderRuntimeModal();
  return api('/api/bot/runtimes/'+encodeURIComponent(runtimeId)+'/test',{method:'POST'})
    .then(function(r){
      var data=r.data||{};
      if(Array.isArray(data.runtimes)){
        state.runtimes=data.runtimes;
      }else if(data.runtime){
        var found=false;
        state.runtimes=state.runtimes.map(function(existing){
          if(existing.id===data.runtime.id){found=true;return data.runtime}
          return existing;
        });
        if(!found)state.runtimes.push(data.runtime);
      }
      renderStats();
      renderMetabotList();
      renderCurrentTab();
      renderRuntimeModal();
    })
    .catch(function(error){
      showToast(error.message||uiText('bot.runtimeTestFailed','Runtime test failed'));
      renderRuntimeModal();
    })
    .finally(function(){
      delete state._runtimeTestById[runtimeId];
      renderRuntimeModal();
    });
}

function createModalMarkup(){
  return '<div class="modal-box">'+
    '<div class="modal-title" id="add-metabot-title">'+esc(uiText('bot.createBot','Create Bot'))+'</div>'+
    '<div class="modal-body">'+
      '<div class="field">'+
        '<label for="new-metabot-name">'+esc(uiText('bot.botName','Bot Name'))+'</label>'+
        '<input id="new-metabot-name" type="text" data-field="new-name" maxlength="60" autocomplete="off" />'+
      '</div>'+
    '</div>'+
    '<div class="modal-actions">'+
      '<button class="btn" data-act="cancel-add">'+esc(uiText('bot.cancel','Cancel'))+'</button>'+
      '<button class="btn btn-primary" data-act="confirm-add">'+esc(uiText('bot.create','Create'))+'</button>'+
    '</div>'+
    '<div class="save-status" data-add-status></div>'+
  '</div>';
}
function createChainVisualMarkup(done){
  return '<div class="create-chain-visual'+(done?' create-chain-visual-done':'')+'" aria-hidden="true">'+
    '<span class="create-chain-link"></span>'+
    '<span class="create-chain-node create-chain-node-left"></span>'+
    '<span class="create-chain-core"></span>'+
    '<span class="create-chain-node create-chain-node-right"></span>'+
  '</div>';
}
function createChainPendingMarkup(name){
  return '<div class="modal-box create-chain-modal">'+
    '<div class="modal-title" id="add-metabot-title">'+esc(uiText('bot.chainCreatePendingTitle','Writing to chain'))+'</div>'+
    '<div class="modal-body create-chain-body">'+
      createChainVisualMarkup(false)+
      '<div class="create-chain-copy">'+
        '<strong>'+esc(name)+'</strong>'+
        '<p>'+esc(uiText('bot.chainCreatePendingMessage','Data is being written on-chain. Please wait 15-30 seconds.'))+'</p>'+
      '</div>'+
    '</div>'+
  '</div>';
}
function createChainSuccessMarkup(profile,url){
  var openDisabled=url?'':' disabled';
  return '<div class="modal-box create-chain-modal">'+
    '<div class="modal-title" id="add-metabot-title">'+esc(uiText('bot.chainCreateSuccessTitle','Bot created'))+'</div>'+
    '<div class="modal-body create-chain-body">'+
      createChainVisualMarkup(true)+
      '<div class="create-chain-copy">'+
        '<strong>'+esc(profile&&profile.name||uiText('bot.createBot','Create Bot'))+'</strong>'+
        '<p>'+esc(uiText('bot.chainCreateSuccessMessage','The Bot identity has been written on-chain.'))+'</p>'+
      '</div>'+
    '</div>'+
    '<div class="modal-actions create-chain-actions">'+
      '<button class="btn" data-act="close-created-bot">'+esc(uiText('bot.close','Close'))+'</button>'+
      '<button class="btn btn-primary" data-act="open-created-bot-homepage" data-url="'+esc(url||'')+'"'+openDisabled+'>'+esc(uiText('bot.openBotHomepage','Open Bot homepage'))+'</button>'+
    '</div>'+
  '</div>';
}
function createChainErrorMarkup(message){
  return '<div class="modal-box create-chain-modal">'+
    '<div class="modal-title" id="add-metabot-title">'+esc(uiText('bot.createFailed','Bot creation failed'))+'</div>'+
    '<div class="modal-body create-chain-body">'+
      '<p class="save-status error">'+esc(message||uiText('bot.createFailed','Bot creation failed'))+'</p>'+
    '</div>'+
    '<div class="modal-actions create-chain-actions">'+
      '<button class="btn btn-primary" data-act="close-created-bot">'+esc(uiText('bot.close','Close'))+'</button>'+
    '</div>'+
  '</div>';
}
function renderCreateModal(markup){
  var modal=q('[data-modal="add-metabot"]');
  if(!modal)return;
  modal.innerHTML=markup;
  modal.classList.remove('hidden');
}
function renderCreateChainPending(name){
  renderCreateModal(createChainPendingMarkup(name));
}
function renderCreateChainSuccess(profile){
  var url=profile&&profile.globalMetaId?botBrowserPath(profile.globalMetaId):'';
  state._createdBotPageUrl=url;
  renderCreateModal(createChainSuccessMarkup(profile||{},url));
  wireCreateSuccessControls();
}
function renderCreateChainError(message){
  renderCreateModal(createChainErrorMarkup(message));
  wireCreateSuccessControls();
}
function openCreatedBotHomepage(){
  var button=q('[data-act="open-created-bot-homepage"]');
  var url=button&&button.getAttribute?button.getAttribute('data-url'):state._createdBotPageUrl;
  url=url||state._createdBotPageUrl;
  if(!url){showToast(uiText('bot.botPageUnavailable','Bot Page is unavailable until GlobalMetaID is ready'));return}
  if(typeof window!=='undefined'&&window&&typeof window.open==='function'){
    window.open(url,'_blank','noopener');
  }
}
function wireCreateSuccessControls(){
  var close=q('[data-act="close-created-bot"]');if(close)close.addEventListener('click',closeAddModal);
  var open=q('[data-act="open-created-bot-homepage"]');if(open)open.addEventListener('click',openCreatedBotHomepage);
}
function wireCreateModalControls(){
  var cancel=q('[data-act="cancel-add"]');if(cancel)cancel.addEventListener('click',closeAddModal);
  var confirm=q('[data-act="confirm-add"]');if(confirm)confirm.addEventListener('click',createMetabot);
  var name=q('[data-field="new-name"]');if(name)name.addEventListener('keydown',function(event){if(event.key==='Enter')createMetabot();if(event.key==='Escape')closeAddModal()});
}
function openAddModal(){
  var modal=q('[data-modal="add-metabot"]');
  state._createdBotPageUrl='';
  if(modal)modal.innerHTML=createModalMarkup();
  var input=q('[data-field="new-name"]');var status=q('[data-add-status]');
  if(status){status.textContent='';status.className='save-status'}
  if(input)input.value='';
  wireCreateModalControls();
  if(modal)modal.classList.remove('hidden');
  if(input)input.focus();
}
function closeAddModal(){var modal=q('[data-modal="add-metabot"]');if(modal)modal.classList.add('hidden');state._createdBotPageUrl=''}
function createMetabot(){
  var input=q('[data-field="new-name"]');var status=q('[data-add-status]');var btn=q('[data-act="confirm-add"]');var name=(input&&input.value||'').trim();
  if(!name){if(status){status.textContent=uiText('bot.nameRequired','Name is required');status.className='save-status error'}return}
  renderCreateChainPending(name);
  if(btn)btn.disabled=true;
  var body={name:name,creationSource:'ui'};
  var host=createHostHint();
  if(host)body.host=host;
  return api('/api/bot/profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){
    var profile=r.data&&r.data.profile||{};
    setSelectedSlug(profile.slug||state.selectedSlug);
    state.selectedTab='publicIdentity';
    renderCreateChainSuccess(profile);
    return loadProfiles().catch(function(error){showToast(error.message)});
  }).catch(function(error){renderCreateChainError(error.message)}).finally(function(){if(btn)btn.disabled=false});
}

function showToast(text){
  var toast=q('[data-copy-toast]');if(!toast)return;
  toast.textContent=text||uiText('bot.copied','Copied!');
  toast.classList.add('show');
  if(state._toastTimer)clearTimeout(state._toastTimer);
  state._toastTimer=setTimeout(function(){toast.classList.remove('show')},1500);
}

function copyToClipboard(text){
  if(!text){showToast(uiText('bot.nothingToCopy','Nothing to copy'));return}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){showToast(uiText('bot.copied','Copied!'))}).catch(function(){fallbackCopy(text)})}else{fallbackCopy(text)}
}
function fallbackCopy(text){
  var el=document.createElement('textarea');el.value=text;el.setAttribute('readonly','');el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);el.select();try{document.execCommand('copy');showToast(uiText('bot.copied','Copied!'))}catch(error){showToast(uiText('bot.copyFailed','Copy failed'))}document.body.removeChild(el)
}
function createModeRequested(){
  try{
    var search=typeof window!=='undefined'&&window.location?window.location.search:'';
    return new URLSearchParams(search||'').get('mode')==='create';
  }catch(error){return false}
}
function createHostHint(){
  try{
    var search=typeof window!=='undefined'&&window.location?window.location.search:'';
    var host=(new URLSearchParams(search||'').get('host')||'').trim();
    return /^[a-z0-9][a-z0-9-]{0,63}$/i.test(host)?host:'';
  }catch(error){return ''}
}
function botManagementRouteRequest(){
  if(state._managementRouteRequest)return state._managementRouteRequest;
  try{
    var search=typeof window!=='undefined'&&window.location?window.location.search:'';
    var query=new URLSearchParams(search||'');
    var tab=query.get('tab')||'';
    var focus=(query.get('focus')||'').trim();
    var mappedTab='';
    if(tab==='info')mappedTab=focus==='chat'?'chatSkills':'publicIdentity';
    else if(tab==='history'||focus==='messages')mappedTab='advanced';
    else if(tab==='settings')mappedTab='advanced';
    else if(tab==='publicIdentity'||tab==='behavior'||tab==='chatSkills'||tab==='advanced')mappedTab=tab;
    state._managementRouteRequest={
      profile:(query.get('profile')||'').trim(),
      tab:mappedTab,
      focus:focus,
    };
    return state._managementRouteRequest;
  }catch(error){state._managementRouteRequest={profile:'',tab:'',focus:''};return state._managementRouteRequest}
}
function applyBotManagementRouteRequest(){
  var request=botManagementRouteRequest();
  if(request.profile&&state.profiles.some(function(profile){return profile.slug===request.profile}))setSelectedSlug(request.profile);
  if(request.tab)state.selectedTab=request.tab;
}
function focusBotManagementTarget(){
  var focus=botManagementRouteRequest().focus;
  var target=null;
  if(focus==='profile')target=q('[data-field="name"]')||q('[data-field="role"]');
  else if(focus==='chat')target=q('[data-field="chatSkillSelect"]')||q('[data-act="add-chat-skill"]');
  else if(focus==='messages')target=q('[data-execution-history-list]');
  if(!target)return;
  var handled=false;
  if(typeof target.scrollIntoView==='function'){target.scrollIntoView({block:'start'});handled=true}
  if(typeof target.focus==='function'){target.focus();handled=true}
  if(handled)botManagementRouteRequest().focus='';
}
function modalIsOpen(el){
  return Boolean(el&&el.classList&&typeof el.classList.contains==='function'&&!el.classList.contains('hidden'));
}
function anyModalOpen(){
  return modalIsOpen(q('[data-modal="add-metabot"]'))||modalIsOpen(modalRoot());
}
function rerenderLocalizedBotPage(){
  renderMetabotList();
  renderDetailHeader(selectedProfile());
  if(state.selectedTab==='advanced'){
    renderSettingsTab();
    renderRuntimeSummary();
    renderHistoryTab();
  }else if(state.selectedTab==='publicIdentity')renderPublicIdentityTab();
  else if(state.selectedTab==='behavior')renderBehaviorTab();
  else if(state.selectedTab==='chatSkills')renderChatSkillsTab();
  if(state._runtimeModalOpen)renderRuntimeModal();
}
if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('oac:i18n-changed',rerenderLocalizedBotPage);
}

document.addEventListener('DOMContentLoaded',function(){
  var initialLoad=loadAll();
  if(initialLoad&&typeof initialLoad.then==='function'){
    initialLoad.then(function(){if(createModeRequested()&&!anyModalOpen())openAddModal()});
  }else if(createModeRequested()&&!anyModalOpen()){
    openAddModal();
  }
  var add=q('[data-act="add-metabot"]');if(add)add.addEventListener('click',openAddModal);
  var cancel=q('[data-act="cancel-add"]');if(cancel)cancel.addEventListener('click',closeAddModal);
  var confirm=q('[data-act="confirm-add"]');if(confirm)confirm.addEventListener('click',createMetabot);
  var modal=q('[data-modal="add-metabot"]');if(modal)modal.addEventListener('click',function(event){if(event.target===modal)closeAddModal()});
  var name=q('[data-field="new-name"]');if(name)name.addEventListener('keydown',function(event){if(event.key==='Enter')createMetabot();if(event.key==='Escape')closeAddModal()});
  qq('[data-tab]').forEach(function(el){el.addEventListener('click',function(){switchTab(this.getAttribute('data-tab'))})});
  var runtimeModal=q('[data-act="open-runtime-modal"]');if(runtimeModal)runtimeModal.addEventListener('click',openRuntimeModal);
  var viewBotPage=q('[data-act="view-bot-page"]');if(viewBotPage)viewBotPage.addEventListener('click',viewSelectedBotPage);
  var viewConversations=q('[data-act="view-conversations"]');if(viewConversations)viewConversations.addEventListener('click',viewSelectedConversations);
  var copyGlobal=q('[data-copy-global-meta-id]');if(copyGlobal)copyGlobal.addEventListener('click',function(){copyToClipboard(this.getAttribute('data-value')||'')});
  var copyBotUri=q('[data-copy-bot-uri]');if(copyBotUri)copyBotUri.addEventListener('click',function(){copyToClipboard(this.getAttribute('data-value')||'')});
  var discover=q('[data-act="discover-runtimes"]');if(discover)discover.addEventListener('click',discoverRuntimes);
  var wallet=q('[data-act="open-wallet"]');if(wallet)wallet.addEventListener('click',openWalletPanel);
  var backup=q('[data-act="open-backup"]');if(backup)backup.addEventListener('click',openBackupPanel);
  var del=q('[data-act="open-delete"]');if(del)del.addEventListener('click',openDeletePanel);
  setInterval(function(){if(state.selectedTab==='advanced')loadSessions()},15000);
})`;
}
