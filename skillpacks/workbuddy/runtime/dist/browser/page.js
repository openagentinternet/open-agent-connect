"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBrowserPageHtml = renderBrowserPageHtml;
const browser_1 = require("@openagentinternet/agent-browser-ui/browser");
const ZH_BROWSER_TEXT_REPLACEMENTS = [
    [/\bCreate your first Bot\b/g, '创建你的第一个 Bot'],
    [/\bYour local Agent needs a Bot identity before it can appear on the Agent Internet\./g, '本地 Agent 需要先拥有一个 Bot 身份，才能开始使用 Browser 操作。'],
    [/\bCreate Bot\b/g, '创建 Bot'],
    [/\bNo Browser actor\b/g, '创建你的第一个 Bot'],
    [/\bConnect an actor before using Browser actions\./g, '请先连接一个 Bot 身份后再使用 Browser 操作。'],
    [/\bNo resource\b/g, '无资源'],
    [/\bVisit home\b/g, '访问主页'],
    [/\bSend message\b/g, '发送信息'],
    [/\bCopy GlobalMetaId\b/g, '复制 GlobalMetaId'],
    [/\bVisit homepage\b/g, '访问主页'],
    [/\brenderer: none\b/g, 'renderer: none'],
    [/\bBookmark this page\b/g, '收藏此页面'],
    [/\bBookmarked — click to remove\b/g, '已收藏，点击移除'],
    [/\bBookmark added\b/g, '书签已添加'],
    [/\bBookmark removed\b/g, '书签已移除'],
    [/\bRemove bookmark\b/g, '移除书签'],
    [/\bRemove this bookmark\?\b/g, '要移除此书签吗？'],
    [/\bRemove\b/g, '移除'],
    [/\bCancel\b/g, '取消'],
    [/\bClose\b/g, '关闭'],
    [/\bOK\b/g, '确定'],
    [/\bMessage sent\b/g, '消息已发送'],
    [/\bYour message has been sent\.\b/g, '你的消息已发送。'],
    [/\bView conversation\b/g, '查看对话'],
    [/\bNot supported\b/g, '不支持'],
    [/\bThis feature is not supported in the web version\./g, '此功能在网页版本中不支持。'],
    [/\bSelect a wallet to connect\b/g, '选择要连接的钱包'],
    [/\bConnect Wallet\b/g, '连接钱包'],
    [/\bInstall Wallet\b/g, '安装钱包'],
    [/\bPlease install a wallet extension first\./g, '请先安装一个钱包扩展。'],
    [/\bInstall\b/g, '安装'],
    [/\bComing soon\b/g, '即将推出'],
    [/\bWallet\b/g, '钱包'],
    [/\bLogout\b/g, '退出'],
    [/\bAgent Internet\b/g, 'Agent Internet'],
    [/\bEnter a metaid:\/\/ URI in the address bar to visit a resource\./g, '在地址栏输入 metaid:// URI 访问资源。'],
    [/\bBookmarks \/ Recent\b/g, '书签 / 最近'],
    [/\bmetaid:\/\/\b/g, 'metaid://'],
];
function normalizeBrowserLanguage(languagePreference) {
    const language = String(languagePreference ?? '').trim();
    if (/^zh(?:-|$)/i.test(language)) {
        return 'zh-CN';
    }
    return 'en';
}
function renderBrowserPageHtml(definition, languagePreference) {
    return (0, browser_1.renderBrowserPageHtml)(definition, languagePreference).then((html) => {
        const language = normalizeBrowserLanguage(languagePreference);
        if (language !== 'zh-CN') {
            return html;
        }
        return ZH_BROWSER_TEXT_REPLACEMENTS.reduce((output, [pattern, replacement]) => output.replace(pattern, replacement), html.replace(/<html lang="[^"]+">/, '<html lang="zh-CN">'));
    });
}
