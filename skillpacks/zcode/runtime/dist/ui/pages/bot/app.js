"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBotPageDefinition = buildBotPageDefinition;
const personaPresets_1 = require("../../../core/bot/personaPresets");
function inlineScriptJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
function buildBotPageDefinition() {
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
function buildBotPageScript() {
    return String.raw `var q=function(s){return document.querySelector(s)};
var qq=function(s){return document.querySelectorAll(s)};
var HOMEPAGE_UPLOAD_MAX_BYTES=50*1024*1024;
var AUTO_REPLY_MAX_TURNS_OPTIONS=[5,10,15,20,25,30];
var AUTO_REPLY_COOLDOWN_MS_OPTIONS=[60000,300000,600000,1800000,3600000];
var DEFAULT_AUTO_REPLY_MAX_TURNS=5;
var DEFAULT_AUTO_REPLY_COOLDOWN_MS=300000;
var PERSONA_PRESET_CATALOG=${inlineScriptJson(personaPresets_1.PERSONA_PRESET_CATALOG)};
var state={profiles:[],runtimes:[],sessions:[],stats:{botCount:0,healthyRuntimes:0,totalExecutions:0,successRate:0},profileConfigs:{},chatSkillOptionsBySlug:{},chatSkillOptionsStatusBySlug:{},chatSkillOptionsErrorBySlug:{},chatAllowedSkillsBySlug:{},autoReplyBySlug:{},autoReplyStatusBySlug:{},autoReplyMaxTurnsBySlug:{},autoReplyCooldownMsBySlug:{},selectedSlug:'',selectedTab:'publicIdentity',originalProfile:null,_pendingAvatar:undefined,_pendingHomepage:undefined,_homepageSource:'',_homepageUploadWorking:false,_homepageUploadToken:0,_homepageMetaAppsBySlug:{},_homepageMetaAppsStatusBySlug:{},_homepageMetaAppsErrorBySlug:{},_homepageMetaAppPickerOpen:false,_createdBotPageUrl:'',_toastTimer:null,_modalClose:null,_modalRequestSeq:0,_sensitiveModalToken:null,_deleteCountdownTimer:null,_deleteCountdown:5,_deleteWorking:false,_runtimeModalOpen:false,_runtimeTestById:{},_runtimesLoaded:false,runtimeDiscoveryStatus:null,_runtimeDiscoveryPolling:false,_runtimeDiscoveryPollTimer:null,_runtimeDiscoveryStopTimer:null,_runtimeDiscoveryObservedRunning:false,_runtimeDiscoveryStopWhenHealthy:false,_runtimeDiscoveryAutoTriggered:false,_walletPanel:null,_walletTransfer:null,_managementRouteRequest:null,_personaPresetModalOpen:false,_personaPresetCategory:'all',_personaPresetQuery:'',_personaPresetSelectedId:'gentle-listener',_personaPresetPendingId:'',_personaPresetApplied:false};
var LEGACY_DEFAULT_ROLE='You are a helpful AI assistant.';
var LEGACY_DEFAULT_SOUL='You are friendly and professional.';
var LEGACY_DEFAULT_GOAL='Your goal is to help users accomplish their tasks effectively.';
var WALLET_CHAINS=[
  {chain:'btc',label:'BTC',displayUnit:'BTC',inputUnit:'BTC'},
  {chain:'mvc',label:'MVC',displayUnit:'SPACE',inputUnit:'SPACE'},
  {chain:'doge',label:'DOGE',displayUnit:'Doge',inputUnit:'DOGE'},
  {chain:'opcat',label:'OPCAT',displayUnit:'OPCAT-BTC',inputUnit:'OPCAT'}
];
var WRITE_NETWORKS=[
  {network:'mvc',label:'MVC',iconPath:'/ui/assets/chains/mvc.png'},
  {network:'btc',label:'BTC',iconPath:'/ui/assets/chains/btc.svg'},
  {network:'doge',label:'DOGE',iconPath:'/ui/assets/chains/doge.svg'},
  {network:'opcat',label:'OPCAT',iconPath:'/ui/assets/chains/opcat.png'}
];
var PROVIDER_LOGO_PATHS={
  'claude-code':'/ui/assets/platforms/claude-code.svg',
  codex:'/ui/assets/platforms/codex.svg',
  copilot:'/ui/assets/platforms/copilot.svg',
  opencode:'/ui/assets/platforms/opencode.svg',
  openclaw:'/ui/assets/platforms/openclaw.svg',
  hermes:'/ui/assets/platforms/hermes.svg',
  gemini:'/ui/assets/platforms/gemini.svg',
  pi:'/ui/assets/platforms/pi.svg',
  cursor:'/ui/assets/platforms/cursor.svg',
  kimi:'/ui/assets/platforms/kimi.svg',
  kiro:'/ui/assets/platforms/kiro.svg',
  codebuddy:'/ui/assets/platforms/codebuddy.svg',
  zcode:'/ui/assets/platforms/zcode.svg',
  workbuddy:'/ui/assets/platforms/codebuddy.svg',
  generic:'/ui/assets/platforms/generic.svg'
};

function api(url,opts){return fetch(url,opts).then(function(r){return r.json().catch(function(){return{ok:false,message:String(r.status)}}).then(function(body){if(!r.ok||body.ok===false){throw new Error(body.message||body.code||String(r.status))}return body})})}
function fmtTime(t){if(!t)return'-';var d=new Date(t);if(Number.isNaN(d.getTime()))return'-';return d.toLocaleString()}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){if(c==='&')return'&amp;';if(c==='<')return'&lt;';if(c==='>')return'&gt;';if(c==='"')return'&quot;';return'&#39;'})}
function uiText(key,fallback,replacements){try{if(typeof window!=='undefined'&&window.__oacLocalUiI18n&&typeof window.__oacLocalUiI18n.t==='function'){var text=window.__oacLocalUiI18n.t(key,replacements||{});if(text&&text!==key)return text}}catch(error){}var out=String(fallback==null?'':fallback);Object.keys(replacements||{}).forEach(function(name){out=out.split('{'+name+'}').join(String(replacements[name]))});return out}
function personaProjectionStatus(projection){
  if(!projection)return{text:uiText('bot.onChainUpdateConfirmed','On-chain update confirmed.'),className:'save-status success'};
  if(projection.ok===false)return{text:uiText('bot.personaSavedProjectionFailed','Persona saved, but Codex sync failed: {message}',{message:projection.message||projection.code||'Unknown error'}),className:'save-status error'};
  if(projection.operation==='unbind')return{text:uiText('bot.personaSavedProjectionRemoved','Persona saved. The empty persona was removed from Codex.'),className:'save-status success'};
  return{text:uiText('bot.personaSavedProjectionSynced','Persona saved and synced to Codex.'),className:'save-status success'};
}
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
function setSelectedBotDefault(toggle){
  var profile=selectedProfile();if(!profile||!profile.slug)return;
  if(toggle&&(toggle.disabled||toggle.classList.contains('on')||toggle.classList.contains('loading')))return;
  var slug=profile.slug;
  if(toggle)toggle.classList.toggle('loading',true);
  var status=q('[data-default-bot-status]');if(status){status.textContent=uiText('bot.saving','Saving...');status.className='save-status saving'}
  return api('/api/bot/profiles/'+encodeURIComponent(slug)+'/activate',{method:'POST'}).then(function(){
    state.profiles.forEach(function(p){p.isActive=p.slug===slug});
    renderMetabotList();
    renderDetailHeader(selectedProfile());
    var done=q('[data-default-bot-status]');if(done){done.textContent=uiText('bot.defaultBotSaved','Default Bot updated.');done.className='save-status success'}
  }).catch(function(error){
    if(toggle)toggle.classList.toggle('loading',false);
    var failed=q('[data-default-bot-status]');if(failed){failed.textContent=error&&error.message?error.message:uiText('bot.defaultBotSaveFailed','Failed to update the default Bot.');failed.className='save-status error'}
  });
}
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
  state._homepageMetaAppPickerOpen=false;
}
function setSelectedSlug(slug,options){
  options=options||{};
  var next=String(slug||'');
  var changed=state.selectedSlug!==next;
  state.selectedSlug=next;
  if(changed||options.clearDrafts){clearSelectedProfileDrafts();state._personaPresetApplied=false}
  state.originalProfile=selectedProfile();
}
function normalizeHomepage(value){
  if(!value||typeof value!=='object')return null;
  var uri=String(value.uri||'').trim();
  if(!uri)return null;
  var renderer=String(value.renderer||'').trim()||(/^metaapp:\/\//i.test(uri)?'metaapp':'auto');
	  var contentType=String(value.contentType||'').trim()||(renderer==='metaapp'?'application/vnd.metaapp':'application/octet-stream');
	  uri=appendMetafileUriExtension(uri,contentTypeExtensionSuffix(contentType));
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
function fileExtensionSuffix(fileName){
  var base=String(fileName||'').trim().split(/[\\/]/).pop()||'';
  var index=base.lastIndexOf('.');
  if(index<=0||index>=base.length-1)return'';
  var suffix=base.slice(index).toLowerCase();
	  return /^\.[a-z0-9][a-z0-9+-]{0,31}$/.test(suffix)?suffix:'';
	}
	function contentTypeExtensionSuffix(contentType){
	  var type=String(contentType||'').trim().toLowerCase().split(';')[0];
	  var map={'application/json':'.json','application/zip':'.zip','image/gif':'.gif','image/jpeg':'.jpg','image/jpg':'.jpg','image/png':'.png','image/svg+xml':'.svg','image/webp':'.webp','text/html':'.html','text/markdown':'.md','text/plain':'.txt'};
	  return map[type]||'';
	}
	function appendMetafileUriExtension(uri,extension){
	  uri=String(uri||'').trim();
	  extension=String(extension||'').trim().toLowerCase();
	  if(!uri||!extension||!/^metafile:\/\//i.test(uri))return uri;
	  var match=uri.match(/^metafile:\/\/([^?#]+)([?#].*)?$/i);
	  if(!match)return uri;
	  var pinPath=match[1]||'';
	  if(!pinPath||pinPath.indexOf('/')>=0||pinPath.indexOf('\\')>=0||/\.[^.?/#\\]+$/.test(pinPath))return uri;
	  return 'metafile://'+pinPath+extension+(match[2]||'');
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
function homepageProtocolInputMarkup(input){
  return '<label class="homepage-protocol-input">'+
    '<span class="homepage-protocol-prefix" aria-hidden="true">'+esc(input.prefix)+'</span>'+
    '<input data-field="'+esc(input.field)+'" value="'+esc(input.value||'')+'" placeholder="'+esc(input.placeholder||'')+'" spellcheck="false" autocomplete="off" aria-invalid="false" />'+
  '</label>';
}
function normalizeMetaAppHomepageInput(value){
  var pin=normalizeHomepagePinInput(value,'metaapp://',uiText('bot.homepageEmptyMetaAppPin','Enter a MetaApp pin ID before saving.'),uiText('bot.homepageInvalidMetaAppPin','Enter a MetaApp pin ID without spaces.'));
  return {uri:'metaapp://'+pin,renderer:'metaapp',contentType:'application/vnd.metaapp'};
}
function normalizeMetafileHomepageInput(value,contentType){
  var pin=normalizeHomepagePinInput(value,'metafile://',uiText('bot.homepageEmptyMetafilePin','Enter a Metafile pin ID before saving.'),uiText('bot.homepageInvalidMetafilePin','Enter a Metafile pin ID without spaces.'));
  return {uri:'metafile://'+pin,renderer:'auto',contentType:contentType||'application/octet-stream'};
}
function normalizeHomepagePinInput(value,scheme,emptyMessage,invalidMessage){
  var pin=String(value==null?'':value).trim();
  if(pin.toLowerCase().indexOf(scheme)===0)pin=pin.slice(scheme.length).trim();
  if(!pin)throw new Error(emptyMessage);
  if(/\s/u.test(pin)||/:\/\//.test(pin))throw new Error(invalidMessage);
  return pin;
}
function metaAppPinFromHomepage(homepage){
  homepage=normalizeHomepage(homepage);
  if(!homepage||!/^metaapp:\/\//i.test(homepage.uri))return '';
  return homepage.uri.slice('metaapp://'.length);
}
function metafilePinFromHomepage(homepage){
  homepage=normalizeHomepage(homepage);
  if(!homepage||!/^metafile:\/\//i.test(homepage.uri))return '';
  return homepage.uri.slice('metafile://'.length);
}
function fieldInputInvalid(field,invalid){
  var input=q('[data-field="'+field+'"]');
  if(input&&input.setAttribute)input.setAttribute('aria-invalid',invalid?'true':'false');
  if(invalid&&input&&input.focus)input.focus();
}
function clearHomepageInputInvalid(field){
  fieldInputInvalid(field,false);
  renderHomepageDraftStatus('', '');
}
function selectedProfileSlug(){
  var profile=selectedProfile();
  return profile&&profile.slug?profile.slug:state.selectedSlug;
}
function recordPinId(record){
  return String(record&&record.pinId||record&&record.firstPinId||'').trim();
}
function recordMetaAppName(record){
  return String(record&&record.appName||record&&record.title||record&&record.name||uiText('bot.homepageUntitledMetaApp','Untitled MetaApp')).trim();
}
function normalizeMetaAppListResponse(response){
  var data=response&&response.data!==undefined?response.data:response;
  var records=Array.isArray(data&&data.records)?data.records:(Array.isArray(data)?data:[]);
  return records.filter(function(record){return Boolean(recordPinId(record))});
}
function metafileRefFromValue(value){
  var raw=String(value==null?'':value).trim();
  if(!raw)return '';
  if(/^metafile:\/\//i.test(raw))return raw.slice('metafile://'.length).trim().split(/[?#]/)[0]||'';
  if(/^[0-9a-f]{64}(?:i[0-9]+)?(?:\.[a-z0-9][a-z0-9+-]{0,31})?$/iu.test(raw))return raw;
  return '';
}
function imageUrlForMetaAppIcon(value){
  var raw=String(value==null?'':value).trim();
  if(!raw)return '';
  if(/^(data:|blob:|https?:\/\/|\/)/iu.test(raw))return raw;
  var ref=metafileRefFromValue(raw);
  return ref?'/api/file/avatar?ref='+encodeURIComponent(ref):'';
}
function metaAppIconMarkup(record){
  var name=recordMetaAppName(record);
  var icon=imageUrlForMetaAppIcon(record&&record.icon||record&&record.iconImg||record&&record.iconImage);
  if(icon)return '<img src="'+esc(icon)+'" alt="" loading="lazy" />';
  var chars=Array.from(name||'?').filter(function(char){return char.trim()}).slice(0,2).join('').toUpperCase()||'?';
  return '<span>'+esc(chars)+'</span>';
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
function providerLogoPath(provider){
  var key=String(provider||'generic');
  if(PROVIDER_LOGO_PATHS[key])return PROVIDER_LOGO_PATHS[key];
  var rt=providerRuntime(key);
  return rt&&rt.logoPath&&rt.logoPath!==PROVIDER_LOGO_PATHS.generic?rt.logoPath:PROVIDER_LOGO_PATHS.generic;
}
function runtimeLogoPath(runtime){
  var key=String((runtime&&runtime.provider)||'generic');
  if(PROVIDER_LOGO_PATHS[key])return PROVIDER_LOGO_PATHS[key];
  return runtime&&runtime.logoPath&&runtime.logoPath!==PROVIDER_LOGO_PATHS.generic?runtime.logoPath:PROVIDER_LOGO_PATHS.generic;
}
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
function noLlmLabelMarkup(profile){
  var providers=profileLlmProviders(profile);
  if(!providers.length){
    var boundTitle=uiText('bot.noLlmBoundTitle','No Primary or Fallback LLM bound to this bot.');
    return '<span class="metabot-no-llm-label" title="'+esc(boundTitle)+'" aria-label="'+esc(boundTitle)+'">'+esc(uiText('bot.noLlmBoundLabel','NO LLM BOUND'))+'</span>';
  }
  if(!state._runtimesLoaded&&!state.runtimes.length)return '';
  if(profileHasUsableLlm(profile))return '';
  var title=uiText('bot.llmNotReadyTitle','Bound LLM runtimes are not ready yet. Open LLM runtimes to test or refresh.');
  return '<span class="metabot-no-llm-label" title="'+esc(title)+'" aria-label="'+esc(title)+'">'+esc(uiText('bot.llmNotReadyLabel','LLM NOT READY'))+'</span>';
}
function defaultBotLabelMarkup(profile){
  if(!profile||profile.isActive!==true)return '';
  if(state.profiles.length<2)return '';
  var title=uiText('bot.isDefaultBot','This is the default Bot');
  return '<span class="metabot-default-label" title="'+esc(title)+'" aria-label="'+esc(title)+'">'+esc(uiText('bot.defaultBadge','Default'))+'</span>';
}
function runtimeIconMarkup(runtime){
  var key=String((runtime&&runtime.provider)||'generic');
  var path=runtimeLogoPath(runtime);
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
  var refreshing=state._runtimeDiscoveryPolling;
  var summaryKey=rows.length===1?'bot.runtimeSummaryOne':'bot.runtimeSummaryMany';
  var summaryFallback=rows.length===1?'{count} detected provider visible. Unavailable providers are hidden from this list.':'{count} detected providers visible. Unavailable providers are hidden from this list.';
  var body='<div class="runtime-modal-head">'+
    '<div><div class="runtime-modal-title">'+esc(uiText('bot.llmProviders','LLM Providers'))+'</div><div class="runtime-modal-summary" data-runtime-modal-status>'+esc(uiText(summaryKey,summaryFallback,{count:rows.length}))+'</div></div>'+
    '<div class="runtime-modal-actions"><button class="btn btn-sm" data-act="refresh-runtime-modal"'+(refreshing?' disabled':'')+'>'+esc(refreshing?uiText('bot.refreshing','Refreshing...'):uiText('bot.refresh','Refresh'))+'</button><button class="icon-btn" data-act="close-runtime-modal" aria-label="Close">x</button></div>'+
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
  qq('[data-act="refresh-runtime-modal"]').forEach(function(el){el.addEventListener('click',discoverRuntimes)});
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
function writeNetworkEntry(network){
  return WRITE_NETWORKS.find(function(entry){return entry.network===network})||WRITE_NETWORKS[0];
}
function chainIconMarkup(network){
  var entry=writeNetworkEntry(network);
  return '<span class="chain-logo" data-chain-icon="'+esc(entry.network)+'" aria-hidden="true"><img src="'+esc(entry.iconPath)+'" alt="" loading="lazy" /></span>';
}
function writeNetworkPickerMarkup(field,label,current){
  var active=writeNetworkEntry(current);
  var html='<div class="field chain-field"><label for="default-write-network">'+esc(label)+'</label>'+
    '<div class="chain-picker" data-chain-picker="'+esc(field)+'">'+
      '<input type="hidden" id="default-write-network" data-field="'+esc(field)+'" value="'+esc(active.network)+'" />'+
      '<button type="button" class="chain-trigger" data-chain-trigger="'+esc(field)+'" aria-haspopup="listbox" aria-expanded="false">'+chainIconMarkup(active.network)+'<span>'+esc(active.label)+'</span><span class="provider-caret">v</span></button>'+
      '<div class="chain-menu" data-chain-menu="'+esc(field)+'" role="listbox" hidden>';
  WRITE_NETWORKS.forEach(function(entry){
    html+='<button type="button" class="chain-option" data-chain-option="'+esc(entry.network)+'" data-chain-value="'+esc(entry.network)+'" role="option"'+(entry.network===active.network?' selected aria-selected="true"':' aria-selected="false"')+'>'+chainIconMarkup(entry.network)+'<span>'+esc(entry.label)+'</span></button>';
  });
  html+='</div></div></div>';
  return html;
}
function uniqueProviderRuntimes(){
  var seen={};var rows=[];
  availableRuntimes().forEach(function(r){if(!r.provider||seen[r.provider])return;seen[r.provider]=true;rows.push(r)});
  return rows;
}
function anyHealthyRuntime(){return state.runtimes.some(function(r){return r&&r.health==='healthy'})}
function notReadyProviderRuntimes(){
  var healthyProviders={};var seen={};var rows=[];
  availableRuntimes().forEach(function(r){if(r.provider)healthyProviders[r.provider]=true});
  state.runtimes.forEach(function(r){
    if(!r||!r.provider||seen[r.provider]||healthyProviders[r.provider])return;
    if(r.health!=='detected'&&r.health!=='degraded')return;
    seen[r.provider]=true;
    var best=providerRuntime(r.provider);
    if(best)rows.push(best);
  });
  return rows;
}
function runtimeDiscoveryInProgress(){
  if(state._runtimeDiscoveryPolling)return true;
  return Boolean(state.runtimeDiscoveryStatus&&state.runtimeDiscoveryStatus.running);
}
function pickerEmptyCopy(){
  if(runtimeDiscoveryInProgress()){
    return esc(uiText('bot.checkingRuntimes','Checking local LLM runtimes…'))+'<div class="provider-empty-hint">'+esc(uiText('bot.checkingRuntimesHint','This can take up to a minute on the first run.'))+'</div>';
  }
  var notReady=notReadyProviderRuntimes();
  if(notReady.length){
    var one=notReady.length===1;
    return esc(uiText(one?'bot.detectedNotReadyOne':'bot.detectedNotReadyMany',one?'1 runtime detected but not ready — open LLM runtimes to test.':'{count} runtimes detected but not ready — open LLM runtimes to test.',{count:notReady.length}));
  }
  return esc(uiText('bot.noRuntimesYet','No LLM runtimes discovered yet.'));
}
function providerPickerMarkup(field,label,selected,allowNone,touched){
  var current=selected||'';var rows=uniqueProviderRuntimes();var notReadyRows=notReadyProviderRuntimes();
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
  if(rows.length){
    html+='<div class="provider-group-label">'+esc(uiText('bot.runtimeGroupReady','Ready'))+'</div>';
    rows.forEach(function(r){
      var selectedAttr=current===r.provider?' selected':'';
      html+='<button type="button" class="provider-option" data-provider-option="'+esc(r.provider)+'" data-provider-value="'+esc(r.provider)+'"'+selectedAttr+'>'+providerIconMarkup(r.provider)+'<span>'+esc(runtimeLabel(r))+'</span></button>';
    });
  }
  if(notReadyRows.length){
    html+='<div class="provider-group-label">'+esc(uiText('bot.runtimeGroupDetected','Detected (not ready)'))+'</div>';
    notReadyRows.forEach(function(r){
      var name=r.displayName||r.provider||r.id||'-';
      var title=r.healthReason||'';
      html+='<button type="button" class="provider-option provider-option-not-ready" disabled aria-disabled="true"'+(title?' title="'+esc(title)+'"':'')+'>'+providerIconMarkup(r.provider)+'<span>'+esc(name+' ('+uiText('bot.runtimeNotReadySuffix','not ready')+')')+'</span></button>';
    });
  }
  if(!rows.length){
    html+='<div class="provider-empty">'+pickerEmptyCopy()+'</div>';
  }
  html+='</div></div>';
  if(current&&!active){
    html+='<button type="button" class="provider-unavailable-link" data-provider-open-runtimes="1">'+esc(uiText('bot.providerUnavailable','Provider unavailable')+': '+current)+'</button>';
  }
  html+='</div>';
  return html;
}
function homepagePanelMarkup(profile){
  var homepage=homepageDraft(profile);
  var source=homepageSourceValue(profile);
  var status=source==='default'?uiText('bot.homepageDefault','Default'):(source==='metaapp'?uiText('bot.homepageMetaApp','MetaApp'):uiText('bot.homepageMetafile','Metafile'));
  var viewDisabled=profile&&profile.globalMetaId?'':' disabled';
  var viewLink=' <button type="button" class="homepage-view-link" data-act="view-homepage"'+viewDisabled+'>'+esc(uiText('bot.homepageViewLink','click here to view'))+'</button>';
  var metaAppSource=source==='metaapp'?(state._pendingHomepage!==undefined?state._pendingHomepage:profile&&profile.homepage):null;
  var metaAppPin=metaAppPinFromHomepage(metaAppSource);
  var metafileSource=source==='metafile'?(state._pendingHomepage!==undefined?state._pendingHomepage:profile&&profile.homepage):null;
  var metafilePin=metafilePinFromHomepage(metafileSource);
  var control='';
  if(source==='default'){
    control='<div class="homepage-final-uri">'+esc(uiText('bot.homepageDefaultActive','Default home page renderer is active.'))+viewLink+'</div>';
  }else if(source==='metafile'){
    control='<div class="homepage-control-row homepage-protocol-row">'+
      homepageProtocolInputMarkup({prefix:'metafile://',field:'homepage-metafile-pin',value:metafilePin,placeholder:uiText('bot.homepageMetafilePinPlaceholder','pinId.ext')})+
      '<button type="button" class="btn btn-sm" data-act="upload-homepage"'+(state._homepageUploadWorking?' disabled':'')+'>'+esc(uiText('bot.upload','Upload'))+'</button>'+
      '<input type="file" data-homepage-file-input hidden />'+
    '</div>';
  }else{
    control='<div class="homepage-control-row homepage-protocol-row homepage-metaapp-row">'+
      homepageProtocolInputMarkup({prefix:'metaapp://',field:'homepage-metaapp-pin',value:metaAppPin,placeholder:uiText('bot.homepagePinPlaceholder','MetaApp pin ID')})+
      '<span class="homepage-metaapp-picker-wrap">'+
        '<button type="button" class="btn btn-sm" data-act="select-homepage-metaapp" aria-haspopup="dialog" aria-expanded="'+(state._homepageMetaAppPickerOpen?'true':'false')+'">'+esc(uiText('bot.homepageSelectMetaApp','Select'))+'</button>'+
        (state._homepageMetaAppPickerOpen?homepageMetaAppPickerMarkup(profile):'')+
      '</span>'+
    '</div>';
  }
  return '<div class="field field-full"><label>'+esc(uiText('bot.homepage','Homepage'))+'</label>'+
    '<div class="homepage-panel" data-homepage-panel>'+
      '<div class="homepage-panel-head"><div><div class="homepage-panel-title">'+esc(uiText('bot.homepage','Homepage'))+'</div><div class="homepage-panel-subtitle">'+esc(uiText('bot.homepageSource','Custom home page source'))+'</div></div><span class="homepage-status-pill">'+esc(status)+'</span></div>'+
      '<div class="homepage-source-row">'+
        '<div class="homepage-source-select"><label for="homepage-source">'+esc(uiText('bot.homepageSource','Custom home page source'))+'</label><select id="homepage-source" data-field="homepage-source">'+homepageSourceOptionsMarkup(source)+'</select></div>'+
        '<div class="homepage-control-slot" data-homepage-control-slot>'+control+'</div>'+
      '</div>'+
      '<div class="save-status" data-homepage-status></div>'+
    '</div></div>';
}
function homepageMetaAppPickerMarkup(profile){
  var slug=profile&&profile.slug||state.selectedSlug||'';
  var status=state._homepageMetaAppsStatusBySlug[slug]||'';
  var error=state._homepageMetaAppsErrorBySlug[slug]||'';
  var records=state._homepageMetaAppsBySlug[slug]||[];
  var body='';
  if(status==='loading'||(!status&&!records.length)){
    body='<div class="homepage-metaapp-loading">'+esc(uiText('bot.homepageLoadingMetaApps','Loading MetaApps...'))+'</div>';
  }else if(error){
    body='<div class="homepage-metaapp-empty"><strong>'+esc(uiText('bot.homepageMetaAppsLoadFailed','MetaApps could not be loaded.'))+'</strong><p>'+esc(error)+'</p><button type="button" class="btn btn-sm" data-act="reload-homepage-metaapps">'+esc(uiText('bot.retry','Retry'))+'</button></div>';
  }else if(!records.length){
    var appsHref='/ui/apps'+(slug?'?from='+encodeURIComponent(slug):'');
    body='<div class="homepage-metaapp-empty">'+
      '<strong>'+esc(uiText('bot.homepageNoMetaAppsTitle','No MetaApps published for this Bot.'))+'</strong>'+
      '<p>'+esc(uiText('bot.homepageNoMetaAppsMessage','Publish the first MetaApp on-chain in Apps, then return here and select it as the homepage.'))+'</p>'+
      '<a class="btn btn-sm btn-primary" href="'+esc(appsHref)+'">'+esc(uiText('bot.homepageCreateMetaApp','Create MetaApp'))+'</a>'+
    '</div>';
  }else{
    body='<div class="homepage-metaapp-list" data-homepage-metaapp-list>'+records.map(function(record){
      var pinId=recordPinId(record);
      var name=recordMetaAppName(record);
      return '<button type="button" class="homepage-metaapp-option" data-act="choose-homepage-metaapp" data-metaapp-pin="'+esc(pinId)+'">'+
        '<span class="homepage-metaapp-icon">'+metaAppIconMarkup(record)+'</span>'+
        '<span class="homepage-metaapp-copy"><strong>'+esc(name)+'</strong><code>'+esc(pinId)+'</code></span>'+
      '</button>';
    }).join('')+'</div>';
  }
  return '<div class="homepage-metaapp-picker" role="dialog" aria-label="'+esc(uiText('bot.homepageSelectMetaApp','Select'))+'">'+body+'</div>';
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
      var unavailable=picker.parentElement&&picker.parentElement.querySelector('[data-provider-open-runtimes]');if(unavailable)unavailable.remove();
    });
  });
  qq('[data-provider-open-runtimes]').forEach(function(el){
    el.addEventListener('click',function(event){event.preventDefault();openRuntimeModal()});
  });
}
function wireChainPickers(){
  qq('[data-chain-trigger]').forEach(function(btn){
    btn.addEventListener('click',function(event){
      event.preventDefault();
      var field=this.getAttribute('data-chain-trigger');var menu=q('[data-chain-menu="'+field+'"]');
      if(!menu)return;
      qq('.chain-menu').forEach(function(other){if(other!==menu)other.setAttribute('hidden','')});
      qq('.provider-menu').forEach(function(other){other.setAttribute('hidden','')});
      var open=menu.hasAttribute('hidden');
      if(open){menu.removeAttribute('hidden');this.setAttribute('aria-expanded','true')}else{menu.setAttribute('hidden','');this.setAttribute('aria-expanded','false')}
    });
  });
  qq('[data-chain-value]').forEach(function(option){
    option.addEventListener('click',function(event){
      event.preventDefault();
      var picker=this.closest('[data-chain-picker]');if(!picker)return;
      var field=picker.getAttribute('data-chain-picker');var input=picker.querySelector('[data-field="'+field+'"]');var trigger=picker.querySelector('[data-chain-trigger="'+field+'"]');
      var value=this.getAttribute('data-chain-value')||'mvc';var entry=writeNetworkEntry(value);
      if(input)input.value=entry.network;
      if(trigger){trigger.innerHTML=chainIconMarkup(entry.network)+'<span>'+esc(entry.label)+'</span><span class="provider-caret">v</span>';trigger.setAttribute('aria-expanded','false')}
      picker.querySelectorAll('[data-chain-value]').forEach(function(row){row.removeAttribute('selected');row.setAttribute('aria-selected','false')});
      this.setAttribute('selected','');this.setAttribute('aria-selected','true');
      var menu=q('[data-chain-menu="'+field+'"]');if(menu)menu.setAttribute('hidden','');
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
  return api('/api/services/skills?from='+encodeURIComponent(slug)+'&allowFallbackRuntime=true').then(function(r){
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
function normalizeAutoReplyMaxTurns(value){
  value=Number(value);
  return AUTO_REPLY_MAX_TURNS_OPTIONS.indexOf(value)>=0?value:DEFAULT_AUTO_REPLY_MAX_TURNS;
}
function normalizeAutoReplyCooldownMs(value){
  value=Number(value);
  return AUTO_REPLY_COOLDOWN_MS_OPTIONS.indexOf(value)>=0?value:DEFAULT_AUTO_REPLY_COOLDOWN_MS;
}
function loadAutoReplyStatus(slug){
  slug=String(slug||'').trim();
  if(!slug)return Promise.resolve();
  state.autoReplyStatusBySlug[slug]='loading';
  rerenderChatSkillsTabForLoad(slug);
  return api('/api/chat/auto-reply/status?from='+encodeURIComponent(slug)).then(function(r){
    var data=r&&r.data?r.data:r;
    var enabled=Boolean(data&&data.enabled);
    var maxTurns=normalizeAutoReplyMaxTurns(data&&data.maxTurns);
    var cooldownMs=normalizeAutoReplyCooldownMs(data&&data.cooldownMs);
    var previous=state.autoReplyBySlug[slug];
    var previousMaxTurns=state.autoReplyMaxTurnsBySlug[slug];
    var previousCooldownMs=state.autoReplyCooldownMsBySlug[slug];
    state.autoReplyBySlug[slug]=enabled;
    state.autoReplyMaxTurnsBySlug[slug]=maxTurns;
    state.autoReplyCooldownMsBySlug[slug]=cooldownMs;
    state.autoReplyStatusBySlug[slug]='ready';
    // Only re-render if a value actually changed, to avoid clobbering an in-flight toggle click.
    // On first load the markup was rendered with optimistic defaults, so re-render
    // when the persisted params differ from them.
    if(
      (previous!==undefined&&previous!==enabled)
      ||(previousMaxTurns!==undefined&&previousMaxTurns!==maxTurns)
      ||(previousCooldownMs!==undefined&&previousCooldownMs!==cooldownMs)
      ||(previous===undefined&&(maxTurns!==DEFAULT_AUTO_REPLY_MAX_TURNS||cooldownMs!==DEFAULT_AUTO_REPLY_COOLDOWN_MS))
    ){rerenderChatSkillsTabForLoad(slug)}
    else{var note=q('[data-auto-reply-status]');if(note)note.textContent='';var toggle=q('[data-auto-reply-toggle]');if(toggle)toggle.classList.toggle('loading',false)}
    return enabled;
  }).catch(function(error){
    state.autoReplyStatusBySlug[slug]='error';
    var note=q('[data-auto-reply-status]');if(note)note.textContent=error&&error.message?error.message:uiText('bot.autoReplyLoadFailed','Failed to load auto-reply status.');
    var toggle=q('[data-auto-reply-toggle]');if(toggle)toggle.classList.toggle('loading',false);
    return null;
  });
}
function autoReplyToggleMarkup(profile){
  var slug=profile&&profile.slug||'';
  var status=state.autoReplyStatusBySlug[slug]||'';
  var enabled=Boolean(state.autoReplyBySlug[slug]);
  // While loading and no cached value yet, optimistically render as ON (the default).
  if(status==='loading'&&!Object.prototype.hasOwnProperty.call(state.autoReplyBySlug,slug)){enabled=true}
  var onLabel=uiText('bot.autoReplyOn','On');
  var offLabel=uiText('bot.autoReplyOff','Off');
  var note=status==='loading'&&!Object.prototype.hasOwnProperty.call(state.autoReplyBySlug,slug)
    ? '<span class="save-status saving" data-auto-reply-status>'+esc(uiText('bot.loadingAutoReply','Loading...'))+'</span>'
    : (status==='error'?'<span class="save-status error" data-auto-reply-status>'+esc(uiText('bot.autoReplyLoadFailed','Failed to load auto-reply status.'))+'</span>':'<span class="save-status" data-auto-reply-status></span>');
  var maxTurns=normalizeAutoReplyMaxTurns(state.autoReplyMaxTurnsBySlug[slug]);
  var cooldownMs=normalizeAutoReplyCooldownMs(state.autoReplyCooldownMsBySlug[slug]);
  var maxTurnsOptionHtml=AUTO_REPLY_MAX_TURNS_OPTIONS.map(function(value){
    return '<option value="'+value+'"'+(value===maxTurns?' selected':'')+'>'+value+'</option>';
  }).join('');
  var cooldownOptionHtml=AUTO_REPLY_COOLDOWN_MS_OPTIONS.map(function(value){
    return '<option value="'+value+'"'+(value===cooldownMs?' selected':'')+'>'+(value/60000)+' '+esc(uiText('bot.autoReplyCooldownMinutes','min'))+'</option>';
  }).join('');
  var paramsMarkup='<div class="auto-reply-params">'+
    '<div class="auto-reply-param">'+
      '<div class="auto-reply-param-text">'+
        '<span class="auto-reply-param-label">'+esc(uiText('bot.autoReplyMaxTurns','Max messages per round'))+'</span>'+
        '<span class="auto-reply-param-hint">'+esc(uiText('bot.autoReplyMaxTurnsHint','After this many replies in one session, the Bot wraps up and ends with "Bye".'))+'</span>'+
      '</div>'+
      '<select data-auto-reply-max-turns data-auto-reply-slug="'+esc(slug)+'"'+(status==='loading'?' disabled':'')+'>'+maxTurnsOptionHtml+'</select>'+
    '</div>'+
    '<div class="auto-reply-param">'+
      '<div class="auto-reply-param-text">'+
        '<span class="auto-reply-param-label">'+esc(uiText('bot.autoReplyCooldown','Cooldown after end'))+'</span>'+
        '<span class="auto-reply-param-hint">'+esc(uiText('bot.autoReplyCooldownHint','After a chat ends, new messages arriving within the cooldown are recorded but not replied to.'))+'</span>'+
      '</div>'+
      '<select data-auto-reply-cooldown data-auto-reply-slug="'+esc(slug)+'"'+(status==='loading'?' disabled':'')+'>'+cooldownOptionHtml+'</select>'+
    '</div>'+
  '</div>';
  return '<div class="field field-full auto-reply-field">'+
    '<div class="auto-reply-row">'+
      '<div class="auto-reply-label">'+
        '<span class="auto-reply-title">'+esc(uiText('bot.autoReplyToggle','Auto-Reply'))+'</span>'+
        '<span class="auto-reply-hint">'+esc(uiText('bot.autoReplyHint','When on, this Bot replies to incoming private messages using its local LLM. Turn off to stay online without auto-replying.'))+'</span>'+
      '</div>'+
      '<button type="button" class="toggle-switch'+(enabled?' on':'')+'" data-auto-reply-toggle data-auto-reply-slug="'+esc(slug)+'" role="switch" aria-checked="'+(enabled?'true':'false')+'" aria-label="'+esc(uiText('bot.autoReplyToggle','Auto-Reply'))+'"'+(status==='loading'?' disabled':'')+'>'+
        '<span class="toggle-track"><span class="toggle-thumb"></span></span>'+
        '<span class="toggle-text">'+esc(enabled?onLabel:offLabel)+'</span>'+
      '</button>'+
    '</div>'+
    paramsMarkup+
    note+
  '</div>';
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
function wireAutoReplyToggle(){
  qq('[data-auto-reply-toggle]').forEach(function(el){
    el.addEventListener('click',function(event){
      event.preventDefault();
      var slug=el.getAttribute('data-auto-reply-slug')||'';
      var profile=selectedProfile();
      if(!slug||!profile||profile.slug!==slug)return;
      if(el.classList.contains('loading'))return;
      var next=!el.classList.contains('on');
      // Optimistically flip the UI and mark loading; POST persists locally (no on-chain write).
      el.classList.toggle('on',next);
      el.classList.toggle('loading',true);
      el.setAttribute('aria-checked',next?'true':'false');
      var onLabel=uiText('bot.autoReplyOn','On');
      var offLabel=uiText('bot.autoReplyOff','Off');
      var labelEl=queryWithin(el,'.toggle-text');if(labelEl)labelEl.textContent=next?onLabel:offLabel;
      toggleAutoReply(profile,next);
    });
  });
}
function toggleAutoReply(profile,nextEnabled){
  if(!profile||!profile.slug)return;
  var slug=profile.slug;
  var note=q('[data-auto-reply-status]');
  if(note){note.textContent=uiText('bot.autoReplySaving','Saving...');note.className='save-status saving'}
  return api('/api/chat/auto-reply/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({from:slug,enabled:nextEnabled})}).then(function(r){
    var data=r&&r.data?r.data:r;
    var enabled=Boolean(data&&data.enabled);
    state.autoReplyBySlug[slug]=enabled;
    state.autoReplyStatusBySlug[slug]='ready';
    if(state.selectedTab==='chatSkills'&&state.selectedSlug===slug){
      var panel=chatSkillsPanelForProfile(profile);
      var toggle=queryWithin(panel,'[data-auto-reply-toggle]');
      if(toggle){toggle.classList.toggle('on',enabled);toggle.classList.toggle('loading',false);toggle.setAttribute('aria-checked',enabled?'true':'false');var labelEl=queryWithin(toggle,'.toggle-text');if(labelEl)labelEl.textContent=enabled?uiText('bot.autoReplyOn','On'):uiText('bot.autoReplyOff','Off')}
      var status=queryWithin(panel,'[data-auto-reply-status]');if(status){status.textContent=uiText('bot.autoReplySaved','Auto-reply setting saved.');status.className='save-status success'}
    }
    return enabled;
  }).catch(function(error){
    // Revert the optimistic flip on failure.
    state.autoReplyStatusBySlug[slug]='ready';
    if(state.selectedTab==='chatSkills'&&state.selectedSlug===slug){
      var panel=chatSkillsPanelForProfile(profile);
      var toggle=queryWithin(panel,'[data-auto-reply-toggle]');
      var enabled=Boolean(state.autoReplyBySlug[slug]);
      if(toggle){toggle.classList.toggle('on',enabled);toggle.classList.toggle('loading',false);toggle.setAttribute('aria-checked',enabled?'true':'false');var labelEl=queryWithin(toggle,'.toggle-text');if(labelEl)labelEl.textContent=enabled?uiText('bot.autoReplyOn','On'):uiText('bot.autoReplyOff','Off')}
      var status=queryWithin(panel,'[data-auto-reply-status]');if(status){status.textContent=error&&error.message?error.message:String(error||'Failed to save.');status.className='save-status error'}
    }
  });
}
function wireAutoReplyParams(){
  qq('[data-auto-reply-max-turns]').forEach(function(el){
    el.addEventListener('change',function(){
      var slug=el.getAttribute('data-auto-reply-slug')||'';
      var profile=selectedProfile();
      if(!slug||!profile||profile.slug!==slug)return;
      saveAutoReplyParams(profile,el,{maxTurns:normalizeAutoReplyMaxTurns(el.value)});
    });
  });
  qq('[data-auto-reply-cooldown]').forEach(function(el){
    el.addEventListener('change',function(){
      var slug=el.getAttribute('data-auto-reply-slug')||'';
      var profile=selectedProfile();
      if(!slug||!profile||profile.slug!==slug)return;
      saveAutoReplyParams(profile,el,{cooldownMs:normalizeAutoReplyCooldownMs(el.value)});
    });
  });
}
function saveAutoReplyParams(profile,select,update){
  if(!profile||!profile.slug)return Promise.resolve();
  var slug=profile.slug;
  var key=typeof update.maxTurns==='number'?'maxTurns':'cooldownMs';
  var note=q('[data-auto-reply-status]');
  if(note){note.textContent=uiText('bot.autoReplySaving','Saving...');note.className='save-status saving'}
  var body={from:slug};
  body[key]=update[key];
  return api('/api/chat/auto-reply/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){
    var data=r&&r.data?r.data:r;
    var savedValue=typeof (data&&data[key])==='number'?data[key]:update[key];
    if(key==='maxTurns')state.autoReplyMaxTurnsBySlug[slug]=normalizeAutoReplyMaxTurns(savedValue);
    else state.autoReplyCooldownMsBySlug[slug]=normalizeAutoReplyCooldownMs(savedValue);
    if(state.selectedTab==='chatSkills'&&state.selectedSlug===slug){
      var panel=chatSkillsPanelForProfile(profile);
      var status=queryWithin(panel,'[data-auto-reply-status]');if(status){status.textContent=uiText('bot.autoReplySaved','Auto-reply setting saved.');status.className='save-status success'}
    }
    return savedValue;
  }).catch(function(error){
    // Revert the select to the last saved value on failure.
    var cached=key==='maxTurns'?normalizeAutoReplyMaxTurns(state.autoReplyMaxTurnsBySlug[slug]):normalizeAutoReplyCooldownMs(state.autoReplyCooldownMsBySlug[slug]);
    if(select)select.value=String(cached);
    if(state.selectedTab==='chatSkills'&&state.selectedSlug===slug){
      var panel=chatSkillsPanelForProfile(profile);
      var status=queryWithin(panel,'[data-auto-reply-status]');if(status){status.textContent=error&&error.message?error.message:String(error||'Failed to save.');status.className='save-status error'}
    }
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
      '<div class="metabot-item-info"><div class="metabot-item-name-row">'+defaultBotLabelMarkup(p)+noLlmLabelMarkup(p)+'<div class="metabot-item-name">'+esc(p.name||p.slug)+'</div></div>'+
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
  var defaultControl=q('[data-default-bot-control]');if(defaultControl)defaultControl.hidden=state.profiles.length<2;
  var defaultToggle=q('[data-default-bot-toggle]');
  if(defaultToggle){
    var isDefault=profile.isActive===true;
    defaultToggle.classList.toggle('on',isDefault);
    defaultToggle.classList.toggle('loading',false);
    defaultToggle.disabled=isDefault;
    defaultToggle.setAttribute('aria-checked',isDefault?'true':'false');
    var defaultTitle=isDefault?uiText('bot.isDefaultBot','This is the default Bot'):uiText('bot.setAsDefault','Set as default');
    defaultToggle.setAttribute('aria-label',defaultTitle);
    defaultToggle.setAttribute('title',defaultTitle);
    var defaultText=queryWithin(defaultToggle,'.toggle-text');if(defaultText)defaultText.textContent=isDefault?uiText('bot.autoReplyOn','On'):uiText('bot.autoReplyOff','Off');
  }
  var defaultStatus=q('[data-default-bot-status]');if(defaultStatus){defaultStatus.textContent='';defaultStatus.className='save-status';defaultStatus.hidden=state.profiles.length<2}
}
function renderBotSetupAlert(profile){
  var alert=q('[data-bot-setup-alert]');if(!alert)return;
  var setup=profile&&profile.setup;
  if(!setup||setup.state==='ready'){alert.hidden=true;alert.innerHTML='';return}
  var subsidyFailed=setup.state==='subsidy_failed';
  var title=subsidyFailed
    ?uiText('bot.subsidyFailedTitle','Subsidy claim failed')
    :uiText('bot.setupIncompleteTitle','Bot setup is incomplete');
  var message=setup.error||(subsidyFailed
    ?uiText('bot.subsidyFailedMessage','The Bot was created, but its MVC subsidy could not be claimed.')
    :uiText('bot.setupIncompleteMessage','The Bot was created locally, but its on-chain setup is incomplete.'));
  alert.hidden=false;
  alert.innerHTML='<div><strong>'+esc(title)+'</strong><p>'+esc(message)+'</p></div>'+
    (setup.retryable?'<button class="btn btn-sm" data-act="retry-bot-setup" data-slug="'+esc(profile.slug||'')+'">'+esc(subsidyFailed?uiText('bot.retrySubsidy','Retry subsidy'):uiText('bot.retrySetup','Retry setup'))+'</button>':'');
  var retry=q('[data-act="retry-bot-setup"]');if(retry)retry.addEventListener('click',function(){retryMetabotSetup(this.getAttribute('data-slug')||'',false,this)});
}
function renderDetailHeader(profile){renderBotHero(profile);renderBotSetupAlert(profile)}

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
    '<div class="persona-preset-entry">'+
      '<div><div class="persona-preset-entry-title">'+esc(uiText('bot.personaPresetIntro','Choose what kind of partner this Bot should become.'))+'</div>'+
      '<div class="persona-preset-entry-copy">'+esc(uiText('bot.personaPresetIntroDetail','Start with a preset, then adjust Role, Soul, and Goal to make it your own.'))+'</div></div>'+
      '<button class="btn" data-act="open-persona-presets">'+esc(uiText('bot.choosePersona','Choose a Persona'))+'</button>'+
    '</div>'+
    '<div class="info-form-grid">'+
      '<div class="field field-full"><label for="bot-role">'+esc(uiText('bot.role','Role'))+'</label><textarea id="bot-role" data-field="role" placeholder="'+esc(uiText('bot.rolePlaceholder','Describe what this Bot should be or specialize in.'))+'">'+esc(roleValue)+'</textarea></div>'+
      '<div class="field field-full"><label for="bot-soul">'+esc(uiText('bot.soul','Soul'))+'</label><textarea id="bot-soul" data-field="soul" placeholder="'+esc(uiText('bot.soulPlaceholder','Describe the tone, style, and boundaries.'))+'">'+esc(soulValue)+'</textarea></div>'+
      '<div class="field field-full"><label for="bot-goal">'+esc(uiText('bot.goal','Goal'))+'</label><textarea id="bot-goal" data-field="goal" placeholder="'+esc(uiText('bot.goalPlaceholder','Describe what this Bot should help users accomplish.'))+'">'+esc(goalValue)+'</textarea></div>'+
    '</div>'+
    '<div class="info-save-row"><button class="btn btn-primary" data-act="save-behavior">'+esc(uiText('bot.saveBehavior','Save Behavior'))+'</button><span class="save-status'+(state._personaPresetApplied?' success':'')+'" data-save-status>'+(state._personaPresetApplied?esc(uiText('bot.personaPresetApplied','Preset applied. Review the fields, then save when ready.')):'')+'</span></div></div>';
  var panel=behaviorPanelForProfile(profile);
  var choose=queryWithin(panel,'[data-act="open-persona-presets"]');if(choose)choose.addEventListener('click',openPersonaPresetModal);
  var save=queryWithin(panel,'[data-act="save-behavior"]');if(save)save.addEventListener('click',saveBehavior);
  focusBotManagementTarget();
}

function personaPresetLanguage(){
  try{if(window.__oacLocalUiI18n&&window.__oacLocalUiI18n.getLanguage&&window.__oacLocalUiI18n.getLanguage()==='zh-CN')return'zh-CN'}catch(error){}
  return'en';
}
function personaPresetCopy(preset){return preset.locales[personaPresetLanguage()]||preset.locales.en}
function personaPresetById(id){return PERSONA_PRESET_CATALOG.presets.find(function(preset){return preset.id===id})||null}
function personaPresetCategoryLabel(category){
  var labels={all:['bot.personaPresetAll','All'],relationship:['bot.personaPresetRelationship','Companions'],everyday:['bot.personaPresetEveryday','Everyday'],learning:['bot.personaPresetLearning','Learning'],creative:['bot.personaPresetCreative','Creative'],professional:['bot.personaPresetProfessional','Professional']};
  var label=labels[category]||labels.all;return uiText(label[0],label[1]);
}
function filteredPersonaPresets(){
  var query=String(state._personaPresetQuery||'').trim().toLowerCase();
  return PERSONA_PRESET_CATALOG.presets.filter(function(preset){
    if(state._personaPresetCategory!=='all'&&preset.category!==state._personaPresetCategory)return false;
    if(!query)return true;
    var local=personaPresetCopy(preset);var english=preset.locales.en;
    return [local.name,local.summary,english.name,english.summary].join(' ').toLowerCase().indexOf(query)>=0;
  });
}
function personaPresetCardMarkup(preset){
  var copy=personaPresetCopy(preset);var selected=preset.id===state._personaPresetSelectedId;
  return '<button class="persona-preset-card'+(selected?' selected':'')+'" data-persona-id="'+esc(preset.id)+'" role="option" aria-selected="'+(selected?'true':'false')+'">'+
    '<span class="persona-preset-emoji" aria-hidden="true">'+esc(preset.emoji)+'</span><span><strong>'+esc(copy.name)+'</strong><small>'+esc(copy.summary)+'</small></span></button>';
}
function personaPresetPreviewMarkup(preset){
  if(!preset)return '<div class="persona-preset-empty">'+esc(uiText('bot.personaPresetSelectPrompt','Select a Persona to preview it.'))+'</div>';
  var copy=personaPresetCopy(preset);var warning=state._personaPresetPendingId===preset.id;
  return '<div class="persona-preset-preview-head"><span class="persona-preset-preview-emoji" aria-hidden="true">'+esc(preset.emoji)+'</span><div><h3>'+esc(copy.name)+'</h3><p>'+esc(copy.summary)+'</p></div></div>'+
    '<div class="persona-preset-field"><span>'+esc(uiText('bot.role','Role'))+'</span><p>'+esc(copy.role)+'</p></div>'+
    '<div class="persona-preset-field"><span>'+esc(uiText('bot.soul','Soul'))+'</span><p>'+esc(copy.soul)+'</p></div>'+
    '<div class="persona-preset-field"><span>'+esc(uiText('bot.goal','Goal'))+'</span><p>'+esc(copy.goal)+'</p></div>'+
    (warning?'<div class="persona-preset-warning"><strong>'+esc(uiText('bot.personaPresetReplaceTitle','Replace the current Persona?'))+'</strong><p>'+esc(uiText('bot.personaPresetReplaceMessage','This will replace the current Role, Soul, and Goal drafts. Nothing is saved yet.'))+'</p><div><button class="btn" data-act="cancel-persona-replace">'+esc(uiText('bot.personaPresetKeepEditing','Keep current fields'))+'</button><button class="btn btn-primary" data-act="confirm-persona-replace">'+esc(uiText('bot.personaPresetReplace','Replace fields'))+'</button></div></div>':'<button class="btn btn-primary persona-preset-apply" data-act="apply-persona-preset">'+esc(uiText('bot.personaPresetApply','Apply to fields'))+'</button>');
}
function renderPersonaPresetModal(){
  var presets=filteredPersonaPresets();
  if(presets.length&&!presets.some(function(preset){return preset.id===state._personaPresetSelectedId}))state._personaPresetSelectedId=presets[0].id;
  var selected=presets.find(function(preset){return preset.id===state._personaPresetSelectedId})||null;
  var categories=['all'].concat(PERSONA_PRESET_CATALOG.presets.map(function(preset){return preset.category}).filter(function(value,index,list){return list.indexOf(value)===index}));
  var body='<div class="persona-preset-modal-body"><p class="persona-preset-modal-copy">'+esc(uiText('bot.personaPresetModalDescription','Choose a starting point. Applying a preset only fills the three fields; you can edit them before saving.'))+'</p>'+
    '<div class="persona-preset-toolbar"><label class="persona-preset-search"><span>'+esc(uiText('bot.personaPresetSearch','Search'))+'</span><input data-persona-search value="'+esc(state._personaPresetQuery)+'" placeholder="'+esc(uiText('bot.personaPresetSearchPlaceholder','Search Personas'))+'" /></label>'+
    '<div class="persona-preset-categories">'+categories.map(function(category){return'<button class="persona-preset-category'+(state._personaPresetCategory===category?' selected':'')+'" data-persona-category="'+esc(category)+'">'+esc(personaPresetCategoryLabel(category))+'</button>'}).join('')+'</div></div>'+
    '<div class="persona-preset-layout"><div class="persona-preset-list" role="listbox">'+(presets.length?presets.map(personaPresetCardMarkup).join(''):'<div class="persona-preset-empty">'+esc(uiText('bot.personaPresetNoResults','No matching Personas.'))+'</div>')+'</div><div class="persona-preset-preview">'+personaPresetPreviewMarkup(selected)+'</div></div></div>';
  openDynamicModal(uiText('bot.personaPresetModalTitle','Persona Presets'),body,{boxClass:'persona-preset-modal-box',onClose:function(){state._personaPresetModalOpen=false;state._personaPresetPendingId=''}});
  state._personaPresetModalOpen=true;
  var search=q('[data-persona-search]');if(search)search.addEventListener('input',function(){state._personaPresetQuery=this.value;state._personaPresetPendingId='';renderPersonaPresetModal();var nextSearch=q('[data-persona-search]');if(nextSearch&&nextSearch.focus){nextSearch.focus();if(nextSearch.setSelectionRange)nextSearch.setSelectionRange(nextSearch.value.length,nextSearch.value.length)}});
  qq('[data-persona-category]').forEach(function(button){button.addEventListener('click',function(){state._personaPresetCategory=this.getAttribute('data-persona-category')||'all';state._personaPresetPendingId='';renderPersonaPresetModal()})});
  qq('[data-persona-id]').forEach(function(button){button.addEventListener('click',function(){state._personaPresetSelectedId=this.getAttribute('data-persona-id')||'';state._personaPresetPendingId='';renderPersonaPresetModal()})});
  var apply=q('[data-act="apply-persona-preset"]');if(apply)apply.addEventListener('click',function(){applyPersonaPresetById(state._personaPresetSelectedId,false)});
  var cancel=q('[data-act="cancel-persona-replace"]');if(cancel)cancel.addEventListener('click',function(){state._personaPresetPendingId='';renderPersonaPresetModal()});
  var replace=q('[data-act="confirm-persona-replace"]');if(replace)replace.addEventListener('click',function(){applyPersonaPresetById(state._personaPresetSelectedId,true)});
}
function openPersonaPresetModal(){
  state._personaPresetCategory='all';state._personaPresetQuery='';state._personaPresetPendingId='';
  if(!personaPresetById(state._personaPresetSelectedId))state._personaPresetSelectedId=PERSONA_PRESET_CATALOG.presets[0].id;
  renderPersonaPresetModal();
}
function applyPersonaPresetById(id,replaceExisting){
  var preset=personaPresetById(id);var profile=selectedProfile();var panel=behaviorPanelForProfile(profile);if(!preset||!panel)return false;
  var copy=personaPresetCopy(preset);var role=queryWithin(panel,'[data-field="role"]');var soul=queryWithin(panel,'[data-field="soul"]');var goal=queryWithin(panel,'[data-field="goal"]');if(!role||!soul||!goal)return false;
  var hasDifferentDraft=[role,soul,goal].some(function(field,index){var expected=[copy.role,copy.soul,copy.goal][index];return String(field.value||'').trim()&&field.value!==expected});
  if(hasDifferentDraft&&!replaceExisting){state._personaPresetSelectedId=id;state._personaPresetPendingId=id;renderPersonaPresetModal();return false}
  role.value=copy.role;soul.value=copy.soul;goal.value=copy.goal;state._personaPresetApplied=true;state._personaPresetPendingId='';closeDynamicModal();
  var status=queryWithin(panel,'[data-save-status]');if(status){status.textContent=uiText('bot.personaPresetApplied','Preset applied. Review the fields, then save when ready.');status.className='save-status success'}
  return true;
}

function renderChatSkillsTab(){
  var profile=selectedProfile();var root=q('[data-chat-skills-content]');if(!root)return;
  if(!profile){root.innerHTML='';return}
  state.originalProfile=profile;
  root.innerHTML='<div class="info-edit-panel" data-chat-skills-profile-slug="'+esc(profile.slug)+'">'+
    autoReplyToggleMarkup(profile)+
    '<div class="info-form-grid">'+
      chatAllowedSkillsMarkup(profile)+
    '</div>'+
    '<div class="info-save-row"><button class="btn btn-primary" data-act="save-chat-skills">'+esc(uiText('bot.saveChatSkills','Save Chat Skills'))+'</button><span class="save-status" data-save-status></span></div></div>';
  wireChatSkillControls();
  wireAutoReplyToggle();
  wireAutoReplyParams();
  if(!state.chatSkillOptionsStatusBySlug[profile.slug])loadChatSkillOptions(profile.slug);
  if(!state.autoReplyStatusBySlug[profile.slug])loadAutoReplyStatus(profile.slug);
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
function readMetaAppHomepageDraftFromInput(options){
  options=options||{};
  var input=q('[data-field="homepage-metaapp-pin"]');
  var value=String(input&&input.value||'').trim();
  try{
    var draft=normalizeMetaAppHomepageInput(value);
    fieldInputInvalid('homepage-metaapp-pin',false);
    return draft;
  }catch(error){
    fieldInputInvalid('homepage-metaapp-pin',true);
    if(options.optional)return undefined;
    throw error;
  }
}
function readMetafileHomepageDraftFromInput(profile){
  var input=q('[data-field="homepage-metafile-pin"]');
  var pending=normalizeHomepage(state._pendingHomepage);
  var current=normalizeHomepage(profile&&profile.homepage);
  if(!input){
    if(pending&&homepageSourceFromHomepage(pending)==='metafile')return pending;
    if(current&&homepageSourceFromHomepage(current)==='metafile')return current;
    throw new Error(uiText('bot.homepageUploadRequired','Upload a homepage file before saving.'));
  }
  var value=String(input&&input.value||'').trim();
  var contentType=(pending&&homepageSourceFromHomepage(pending)==='metafile'&&pending.contentType)||(current&&homepageSourceFromHomepage(current)==='metafile'&&current.contentType)||'application/octet-stream';
  try{
    var draft=normalizeMetafileHomepageInput(value,contentType);
    fieldInputInvalid('homepage-metafile-pin',false);
    if(pending&&pending.uri===draft.uri)return pending;
    if(current&&current.uri===draft.uri)return current;
    return draft;
  }catch(error){
    fieldInputInvalid('homepage-metafile-pin',true);
    throw error;
  }
}
function readHomepageDraftForSave(profile){
  var source=selectedHomepageSource(profile);
  if(source==='default')return null;
  if(source==='metaapp'){
    var metaAppDraft=readMetaAppHomepageDraftFromInput();
    return metaAppDraft;
  }
  return readMetafileHomepageDraftFromInput(profile);
}
function handleHomepageSourceChange(){
  var profile=selectedProfile();
  var source=selectedHomepageSource(profile);
  state._homepageSource=source;
  state._homepageUploadWorking=false;
  state._homepageUploadToken+=1;
  state._homepageMetaAppPickerOpen=false;
  if(source==='default')state._pendingHomepage=null;
  else state._pendingHomepage=undefined;
  rerenderPublicIdentityForHomepage();
  if(source==='default')renderHomepageDraftStatus(uiText('bot.homepageDefaultReadyToSave','Default homepage ready to save.'),'success');
}
function loadHomepageMetaApps(slug,force){
  slug=String(slug||'').trim();
  if(!slug)return Promise.resolve([]);
  var status=state._homepageMetaAppsStatusBySlug[slug]||'';
  if(!force&&(status==='loading'||status==='loaded'))return Promise.resolve(state._homepageMetaAppsBySlug[slug]||[]);
  state._homepageMetaAppsStatusBySlug[slug]='loading';
  state._homepageMetaAppsErrorBySlug[slug]='';
  rerenderPublicIdentityForHomepage();
  return api('/api/metaapp/list?from='+encodeURIComponent(slug)+'&size=24').then(function(response){
    var records=normalizeMetaAppListResponse(response);
    state._homepageMetaAppsBySlug[slug]=records;
    state._homepageMetaAppsStatusBySlug[slug]='loaded';
    state._homepageMetaAppsErrorBySlug[slug]='';
    if(slug===selectedProfileSlug()&&state._homepageMetaAppPickerOpen)rerenderPublicIdentityForHomepage();
    return records;
  }).catch(function(error){
    state._homepageMetaAppsBySlug[slug]=[];
    state._homepageMetaAppsStatusBySlug[slug]='error';
    state._homepageMetaAppsErrorBySlug[slug]=error&&error.message?error.message:String(error||uiText('bot.homepageMetaAppsLoadFailed','MetaApps could not be loaded.'));
    if(slug===selectedProfileSlug()&&state._homepageMetaAppPickerOpen)rerenderPublicIdentityForHomepage();
    return [];
  });
}
function toggleHomepageMetaAppPicker(forceReload){
  var slug=selectedProfileSlug();
  if(!slug)return;
  state._homepageMetaAppPickerOpen=!state._homepageMetaAppPickerOpen||Boolean(forceReload);
  rerenderPublicIdentityForHomepage();
  if(state._homepageMetaAppPickerOpen)loadHomepageMetaApps(slug,Boolean(forceReload));
}
function chooseHomepageMetaAppPin(pinId){
  var pin=String(pinId||'').trim();
  if(!pin)return;
  try{
    state._pendingHomepage=normalizeMetaAppHomepageInput(pin);
    state._homepageSource='metaapp';
    state._homepageMetaAppPickerOpen=false;
    rerenderPublicIdentityForHomepage();
    renderHomepageDraftStatus(uiText('bot.homepageReadyToSave','Homepage ready to save.'),'success');
  }catch(error){
    renderHomepageDraftStatus(error.message,'error');
  }
}
function handleHomepageUploadFile(file){
  var profile=selectedProfile();if(!profile||!profile.slug||!file)return Promise.resolve();
  var profileSlug=profile.slug;
  var uploadToken=++state._homepageUploadToken;
  if(Number(file.size||0)>HOMEPAGE_UPLOAD_MAX_BYTES){
    renderHomepageDraftStatus(uiText('bot.homepageUploadTooLarge','Homepage file must be 50 MiB or smaller.'),'error');
    return Promise.resolve();
  }
  state._homepageUploadWorking=true;
  renderHomepageDraftStatus(uiText('bot.homepageUploading','Uploading homepage file...'),'saving');
  return api('/api/bot/profiles/'+encodeURIComponent(profileSlug)+'/homepage/upload?fileName='+encodeURIComponent(file.name||'homepage-upload.bin'),{
    method:'POST',
    headers:{'content-type':file.type||'application/octet-stream'},
    body:file,
  }).then(function(r){
    if(state.selectedSlug!==profileSlug||state._homepageUploadToken!==uploadToken)return;
    var data=r.data||{};
	    var uri=String(data.metafileUri||data.uri||'').trim();
	    var ext=fileExtensionSuffix(file.name)||contentTypeExtensionSuffix(data.contentType||file.type);
	    if(!uri&&data.pinId)uri='metafile://'+data.pinId;
	    uri=appendMetafileUriExtension(uri,ext);
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
  var metafilePin=q('[data-field="homepage-metafile-pin"]');if(metafilePin)metafilePin.addEventListener('input',function(){clearHomepageInputInvalid('homepage-metafile-pin')});
  var metaappPin=q('[data-field="homepage-metaapp-pin"]');if(metaappPin)metaappPin.addEventListener('input',function(){clearHomepageInputInvalid('homepage-metaapp-pin')});
  var selectMetaApp=q('[data-act="select-homepage-metaapp"]');if(selectMetaApp)selectMetaApp.addEventListener('click',function(event){if(event&&event.preventDefault)event.preventDefault();toggleHomepageMetaAppPicker(false)});
  var reloadMetaApps=q('[data-act="reload-homepage-metaapps"]');if(reloadMetaApps)reloadMetaApps.addEventListener('click',function(event){if(event&&event.preventDefault)event.preventDefault();toggleHomepageMetaAppPicker(true)});
  qq('[data-act="choose-homepage-metaapp"]').forEach(function(option){option.addEventListener('click',function(event){if(event&&event.preventDefault)event.preventDefault();chooseHomepageMetaAppPin(this.getAttribute('data-metaapp-pin')||'')})});
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
    state._personaPresetApplied=false;
    renderMetabotList();
    renderDetailHeader(updated);
    renderBehaviorTab({preserveDraft:false});
    panel=behaviorPanelForProfile(updated);status=queryWithin(panel,'[data-save-status]');if(status){var projectionStatus=personaProjectionStatus(r.data&&r.data.hostPersonaProjection);status.textContent=projectionStatus.text;status.className=projectionStatus.className}
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
    var iconRuntime=rt||(provider?{provider:provider}:null);
    var metaBits=[];
    if(rt&&rt.provider)metaBits.push(rt.provider);
    if(health)metaBits.push(health);
    if(rt&&rt.version)metaBits.push('v'+rt.version);
    var meta=metaBits.join(' · ')||uiText('bot.notConfigured','Not configured');
    rows.push('<div class="runtime-summary-row">'+
      '<span class="runtime-summary-role">'+esc(entry[2])+'</span>'+
      '<span class="runtime-summary-dot '+dotCls+'" aria-hidden="true"></span>'+
      runtimeIconMarkup(iconRuntime)+
      '<span class="runtime-summary-name">'+esc(name)+'</span>'+
      '<span class="runtime-summary-meta">'+esc(meta)+'</span>'+
    '</div>');
  });
  if(runtimeDiscoveryInProgress()&&!anyHealthyRuntime()){
    rows.push('<div class="runtime-summary-row runtime-summary-checking">'+
      '<span class="runtime-summary-name">'+esc(uiText('bot.checkingRuntimes','Checking local LLM runtimes…'))+'</span>'+
      '<span class="runtime-summary-meta">'+esc(uiText('bot.checkingRuntimesHint','This can take up to a minute on the first run.'))+'</span>'+
    '</div>');
  }
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
  root.innerHTML='<div class="settings-form">'+
    writeNetworkPickerMarkup('defaultWriteNetwork',uiText('bot.defaultWriteNetwork','Default Write Network'),current)+
    '<div class="settings-note">'+esc(uiText('bot.defaultWriteNetworkNote','Used by write commands when no explicit chain is supplied. Wallet balance and transfer keep their own chain selection rules.'))+'</div>'+
    '<div class="settings-save-row"><button class="btn btn-primary" data-act="save-settings">'+esc(uiText('bot.saveSettings','Save Settings'))+'</button><span class="save-status" data-settings-status></span></div>'+
  '</div>';
  wireChainPickers();
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
function loadRuntimes(){return api('/api/bot/runtimes').then(function(r){state.runtimes=(r.data&&r.data.runtimes)||[];state.runtimeDiscoveryStatus=(r.data&&r.data.discoveryStatus)||null;state._runtimesLoaded=true;renderMetabotList();renderCurrentTab();renderStats();if(state._runtimeModalOpen)renderRuntimeModal()}).catch(function(){state.runtimes=[];state.runtimeDiscoveryStatus=null;state._runtimesLoaded=true;renderMetabotList();renderCurrentTab();renderStats();if(state._runtimeModalOpen)renderRuntimeModal()}).then(maybeAutoDiscoverRuntimes)}
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

function updateDiscoverRuntimesButton(){
  var btn=q('[data-act="discover-runtimes"]');if(!btn)return;
  if(state._runtimeDiscoveryPolling){btn.disabled=true;btn.textContent=uiText('bot.refreshing','Refreshing...')}
  else{btn.disabled=false;btn.textContent=uiText('bot.refreshRuntimes','Refresh Runtimes')}
}
function stopRuntimeDiscoveryPolling(){
  state._runtimeDiscoveryPolling=false;
  state._runtimeDiscoveryObservedRunning=false;
  state._runtimeDiscoveryStopWhenHealthy=false;
  // Drop the last-polled status: once we stop polling it will never refresh,
  // so a stale running:true must not keep the UI on the checking state.
  state.runtimeDiscoveryStatus=null;
  if(state._runtimeDiscoveryPollTimer){clearInterval(state._runtimeDiscoveryPollTimer);state._runtimeDiscoveryPollTimer=null}
  if(state._runtimeDiscoveryStopTimer){clearTimeout(state._runtimeDiscoveryStopTimer);state._runtimeDiscoveryStopTimer=null}
  updateDiscoverRuntimesButton();
  renderMetabotList();renderCurrentTab();renderStats();if(state._runtimeModalOpen)renderRuntimeModal();
}
function pollRuntimeDiscoveryOnce(){
  return loadRuntimes().then(function(){
    if(state._runtimeDiscoveryStopWhenHealthy&&anyHealthyRuntime()){stopRuntimeDiscoveryPolling();return}
    var status=state.runtimeDiscoveryStatus;
    if(status&&status.running===true){state._runtimeDiscoveryObservedRunning=true;return}
    if(status&&status.running===false&&state._runtimeDiscoveryObservedRunning)stopRuntimeDiscoveryPolling();
  });
}
function startRuntimeDiscoveryPolling(stopWhenHealthy){
  if(state._runtimeDiscoveryPolling)return false;
  state._runtimeDiscoveryPolling=true;
  state._runtimeDiscoveryObservedRunning=false;
  state._runtimeDiscoveryStopWhenHealthy=stopWhenHealthy===true;
  updateDiscoverRuntimesButton();
  state._runtimeDiscoveryPollTimer=setInterval(pollRuntimeDiscoveryOnce,2000);
  state._runtimeDiscoveryStopTimer=setTimeout(stopRuntimeDiscoveryPolling,60000);
  return true;
}
function triggerBackgroundRuntimeDiscovery(){
  return api('/api/bot/runtimes/discover',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({background:true})})
    .then(function(r){
      if(r.data&&r.data.status==='running')state._runtimeDiscoveryObservedRunning=true;
      return pollRuntimeDiscoveryOnce();
    })
    .catch(function(error){showToast(error.message||uiText('bot.runtimeRefreshFailed','Runtime refresh failed'));stopRuntimeDiscoveryPolling()});
}
function maybeAutoDiscoverRuntimes(){
  if(state._runtimeDiscoveryAutoTriggered)return;
  if(!state._runtimesLoaded)return;
  if(anyHealthyRuntime())return;
  state._runtimeDiscoveryAutoTriggered=true;
  if(!startRuntimeDiscoveryPolling(true))return;
  triggerBackgroundRuntimeDiscovery();
}
function discoverRuntimes(){
  if(state._runtimeDiscoveryPolling)return;
  if(!startRuntimeDiscoveryPolling(false))return;
  triggerBackgroundRuntimeDiscovery();
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
function createLlmBindingMarkup(llmBinding){
  if(!llmBinding||!llmBinding.status)return '';
  var provider=String(llmBinding.primaryProvider||'').trim();
  if(llmBinding.status==='healthy'&&provider){
    return '<p class="create-chain-llm create-chain-llm-bound">'+esc(uiText('bot.createLlmBound','LLM bound: {provider}',{provider:provider}))+'</p>';
  }
  if(llmBinding.status==='pending'&&provider){
    return '<p class="create-chain-llm create-chain-llm-pending">'+esc(uiText('bot.createLlmPending','Selected {provider} — verifying availability…',{provider:provider}))+'</p>'+
      '<p class="create-chain-llm-hint">'+esc(uiText('bot.createLlmPendingHint','It becomes usable automatically once ready; you can also test it under LLM runtimes.'))+'</p>';
  }
  if(llmBinding.status==='none'){
    return '<p class="create-chain-llm create-chain-llm-none">'+esc(uiText('bot.createLlmNone','No LLM discovered on this machine yet — detecting in the background.'))+'</p>'+
      '<p class="create-chain-llm-hint">'+esc(uiText('bot.createLlmNoneHint','Bind one later from the bot settings page.'))+'</p>';
  }
  return '';
}
function createChainSuccessMarkup(profile,url,llmBinding){
  var openDisabled=url?'':' disabled';
  return '<div class="modal-box create-chain-modal">'+
    '<div class="modal-title" id="add-metabot-title">'+esc(uiText('bot.chainCreateSuccessTitle','Bot created'))+'</div>'+
    '<div class="modal-body create-chain-body">'+
      createChainVisualMarkup(true)+
      '<div class="create-chain-copy">'+
        '<strong>'+esc(profile&&profile.name||uiText('bot.createBot','Create Bot'))+'</strong>'+
        '<p>'+esc(uiText('bot.chainCreateSuccessMessage','The Bot identity has been written on-chain.'))+'</p>'+
        createLlmBindingMarkup(llmBinding)+
      '</div>'+
    '</div>'+
    '<div class="modal-actions create-chain-actions">'+
      '<button class="btn" data-act="close-created-bot">'+esc(uiText('bot.close','Close'))+'</button>'+
      '<button class="btn btn-primary" data-act="open-created-bot-homepage" data-url="'+esc(url||'')+'"'+openDisabled+'>'+esc(uiText('bot.openBotHomepage','Open Bot homepage'))+'</button>'+
    '</div>'+
  '</div>';
}
function createChainWarningMarkup(profile,setup){
  var subsidyFailed=setup&&setup.state==='subsidy_failed';
  var message=setup&&setup.error||(subsidyFailed
    ?uiText('bot.subsidyFailedMessage','The Bot was created, but its MVC subsidy could not be claimed.')
    :uiText('bot.setupIncompleteMessage','The Bot was created locally, but its on-chain setup is incomplete.'));
  return '<div class="modal-box create-chain-modal">'+
    '<div class="modal-title" id="add-metabot-title">'+esc(uiText('bot.createdSetupIncompleteTitle','Bot created; setup incomplete'))+'</div>'+
    '<div class="modal-body create-chain-body">'+
      '<div class="create-chain-copy">'+
        '<strong>'+esc(profile&&profile.name||uiText('bot.createBot','Create Bot'))+'</strong>'+
        '<p>'+esc(message)+'</p>'+
      '</div>'+
    '</div>'+
    '<div class="modal-actions create-chain-actions">'+
      '<button class="btn" data-act="close-created-bot">'+esc(uiText('bot.close','Close'))+'</button>'+
      '<button class="btn btn-primary" data-act="retry-created-bot-setup" data-slug="'+esc(profile&&profile.slug||'')+'">'+esc(subsidyFailed?uiText('bot.retrySubsidy','Retry subsidy'):uiText('bot.retrySetup','Retry setup'))+'</button>'+
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
function renderCreateChainSuccess(profile,llmBinding){
  var url=profile&&profile.globalMetaId?botBrowserPath(profile.globalMetaId):'';
  state._createdBotPageUrl=url;
  renderCreateModal(createChainSuccessMarkup(profile||{},url,llmBinding));
  wireCreateSuccessControls();
}
function renderCreateChainWarning(profile,setup){
  renderCreateModal(createChainWarningMarkup(profile||{},setup||{}));
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
  var retry=q('[data-act="retry-created-bot-setup"]');if(retry)retry.addEventListener('click',function(){retryMetabotSetup(this.getAttribute('data-slug')||'',true,this)});
}
function wireCreateModalControls(){
  var cancel=q('[data-act="cancel-add"]');if(cancel)cancel.addEventListener('click',closeAddModal);
  var confirm=q('[data-act="confirm-add"]');if(confirm)confirm.addEventListener('click',createMetabot);
  var name=q('[data-field="new-name"]');if(name)name.addEventListener('keydown',function(event){if(event.key==='Escape')closeAddModal()});
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
function retryMetabotSetup(slug,fromCreateModal,button){
  slug=String(slug||'').trim();if(!slug)return Promise.resolve();
  if(button){button.disabled=true;button.textContent=uiText('bot.retrying','Retrying...')}
  return api('/api/bot/profiles/'+encodeURIComponent(slug)+'/setup/retry',{method:'POST'}).then(function(r){
    var profile=r.data&&r.data.profile||selectedProfile()||{};
    if(fromCreateModal)renderCreateChainSuccess(profile);
    showToast(uiText('bot.setupRetrySucceeded','Bot setup completed'));
    return loadProfiles().catch(function(error){showToast(error.message)});
  }).catch(function(error){
    if(fromCreateModal){
      var profile=state.profiles.find(function(entry){return entry.slug===slug})||{slug:slug};
      renderCreateChainWarning(profile,{state:'subsidy_failed',error:error.message});
    }else{
      showToast(error.message);
      if(button){button.disabled=false;button.textContent=uiText('bot.retry','Retry')}
    }
  });
}
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
    var llmBinding=r.data&&r.data.llmBinding||null;
    setSelectedSlug(profile.slug||state.selectedSlug);
    state.selectedTab='publicIdentity';
    if(r.data&&r.data.setup&&r.data.setup.state!=='ready')renderCreateChainWarning(profile,r.data.setup);
    else renderCreateChainSuccess(profile,llmBinding);
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
  else if(state._personaPresetModalOpen)renderPersonaPresetModal();
}
if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('oac:i18n-changed',rerenderLocalizedBotPage);
  window.addEventListener('beforeunload',stopRuntimeDiscoveryPolling);
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
  var name=q('[data-field="new-name"]');if(name)name.addEventListener('keydown',function(event){if(event.key==='Escape')closeAddModal()});
  qq('[data-tab]').forEach(function(el){el.addEventListener('click',function(){switchTab(this.getAttribute('data-tab'))})});
  var runtimeModal=q('[data-act="open-runtime-modal"]');if(runtimeModal)runtimeModal.addEventListener('click',openRuntimeModal);
  var viewBotPage=q('[data-act="view-bot-page"]');if(viewBotPage)viewBotPage.addEventListener('click',viewSelectedBotPage);
  var viewConversations=q('[data-act="view-conversations"]');if(viewConversations)viewConversations.addEventListener('click',viewSelectedConversations);
  var defaultBotToggle=q('[data-default-bot-toggle]');if(defaultBotToggle)defaultBotToggle.addEventListener('click',function(){setSelectedBotDefault(this)});
  var copyGlobal=q('[data-copy-global-meta-id]');if(copyGlobal)copyGlobal.addEventListener('click',function(){copyToClipboard(this.getAttribute('data-value')||'')});
  var copyBotUri=q('[data-copy-bot-uri]');if(copyBotUri)copyBotUri.addEventListener('click',function(){copyToClipboard(this.getAttribute('data-value')||'')});
  var discover=q('[data-act="discover-runtimes"]');if(discover)discover.addEventListener('click',discoverRuntimes);
  var wallet=q('[data-act="open-wallet"]');if(wallet)wallet.addEventListener('click',openWalletPanel);
  var backup=q('[data-act="open-backup"]');if(backup)backup.addEventListener('click',openBackupPanel);
  var del=q('[data-act="open-delete"]');if(del)del.addEventListener('click',openDeletePanel);
  setInterval(function(){if(state.selectedTab==='advanced')loadSessions()},15000);
})`;
}
