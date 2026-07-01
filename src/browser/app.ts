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
`;

const OAC_BROWSER_LOCALIZATION_SCRIPT = `
var oacBrowserLocalizedText = {
  'zh-CN': {
    'bookmark.added': '书签已添加',
    'bookmark.removeConfirm': '要移除此书签吗？',
    'bookmark.removed': '书签已移除',
    'bookmark.removeLabel': '移除',
    'bookmark.removeTitle': '移除书签',
    'bookmark.starLabel': '收藏此页面',
    'bookmark.starLabelActive': '已收藏，点击移除',
    'modal.cancel': '取消',
    'modal.close': '关闭',
    'modal.ok': '确定',
    'ownerPanel.copyMetaId': '复制 GlobalMetaId',
    'ownerPanel.sendMessage': '发送信息',
    'ownerPanel.visitHome': '访问主页',
    'privateChat.messageSentBody': '你的消息已发送。',
    'privateChat.messageSentTitle': '消息已发送',
    'privateChat.viewConversation': '查看对话',
    'resource.emptyTitle': '无资源',
    'runtime.noActorAction.label': '创建 Bot',
    'runtime.noActorBody': '本地 Agent 需要先拥有一个 Bot 身份，才能开始使用 Browser 操作。',
    'runtime.noActorTitle': '创建你的第一个 Bot',
    'standaloneUnsupported.title': '不支持',
    'status.rendererNone': 'renderer: none',
    'status.standaloneUnsupported': '此功能在网页版本中不支持。',
    'wallet.connect': '连接钱包',
    'wallet.installAction': '安装',
    'wallet.installBody': '请先安装一个钱包扩展。',
    'wallet.installTitle': '安装钱包',
    'wallet.logout': '退出',
    'wallet.selectTitle': '选择要连接的钱包',
    'wallet.unsupportedProvider': '即将推出',
    'welcome.gridHeading': '书签 / 最近',
    'welcome.promptPlaceholder': 'metaid://',
    'welcome.subtitle': '在地址栏输入 metaid:// URI 访问资源。',
    'welcome.title': 'Agent Internet Browser'
  }
};

function oacBrowserText(key, fallback) {
  var language = '';
  if (typeof document !== 'undefined' && document.documentElement) {
    language = textValue(document.documentElement.lang);
  }
  var dictionary = /^zh(?:-|$)/i.test(language) ? oacBrowserLocalizedText['zh-CN'] : null;
  if (dictionary && Object.prototype.hasOwnProperty.call(dictionary, key)) {
    return dictionary[key];
  }
  return fallback;
}
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

function injectOacBrowserLocalization(script: string): string {
  const browserTextPattern = /function browserText\(key, fallback\) \{\n  return fallback;\n\}/;
  const runtimeLabelValuePattern = /function runtimeLabelValue\(key, fallback\) \{\n  return textValue\(runtimeLabels\(\)\[key\]\) \|\| fallback;\n\}/;

  const withLocalizedText = script.replace(
    browserTextPattern,
    `${OAC_BROWSER_LOCALIZATION_SCRIPT}\nfunction browserText(key, fallback) {\n  return oacBrowserText(key, fallback);\n}`,
  );
  return withLocalizedText.replace(
    runtimeLabelValuePattern,
    `function runtimeLabelValue(key, fallback) {\n  var raw = textValue(runtimeLabels()[key]) || fallback;\n  return browserText('runtime.' + key, raw);\n}`,
  );
}

export function buildBrowserPageDefinition(): BrowserPageDefinition {
  const definition = buildAbcBrowserPageDefinition() as BrowserPageDefinition;
  return {
    ...definition,
    script: injectOacBrowserLocalization(injectOacBrowserScriptAdapters(definition.script)),
  };
}
