import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DEFAULT_LANGUAGE_PREFERENCE,
  DICTIONARIES,
  normalizeLanguagePreference,
  renderLanguageOptions,
  resolveConcreteLanguage,
  translate,
} = require('../../dist/ui/i18n.js');

test('i18n resolver maps Simplified Chinese locales to zh-CN and all others to en', () => {
  assert.equal(DEFAULT_LANGUAGE_PREFERENCE, 'auto');
  assert.equal(normalizeLanguagePreference(undefined), 'auto');
  assert.equal(normalizeLanguagePreference(''), 'auto');
  assert.equal(normalizeLanguagePreference('de'), 'auto');
  assert.equal(normalizeLanguagePreference('zh-CN'), 'zh-CN');
  assert.equal(normalizeLanguagePreference('en'), 'en');

  assert.equal(resolveConcreteLanguage('auto', ['zh-CN']), 'zh-CN');
  assert.equal(resolveConcreteLanguage('auto', ['zh-Hans']), 'zh-CN');
  assert.equal(resolveConcreteLanguage('auto', ['zh-SG']), 'zh-CN');
  assert.equal(resolveConcreteLanguage('auto', ['zh-TW']), 'en');
  assert.equal(resolveConcreteLanguage('auto', ['zh-HK']), 'en');
  assert.equal(resolveConcreteLanguage('auto', ['zh-MO']), 'en');
  assert.equal(resolveConcreteLanguage('auto', ['fr-FR']), 'en');
  assert.equal(resolveConcreteLanguage('auto', []), 'en');

  assert.equal(resolveConcreteLanguage('zh-CN', ['en-US']), 'zh-CN');
  assert.equal(resolveConcreteLanguage('en', ['zh-CN']), 'en');
});

test('i18n dictionaries include Bot Page Console copy in English and Simplified Chinese', () => {
  const requiredBotKeys = [
    'bot.localBots',
    'bot.createBot',
    'bot.liveByDefault',
    'bot.globalMetaId',
    'bot.botUri',
    'bot.copy',
    'bot.openPublicBotPage',
    'bot.viewConversations',
    'bot.publicIdentity',
    'bot.behavior',
    'bot.chatSkills',
    'bot.services',
    'bot.advanced',
    'bot.botName',
    'bot.avatar',
    'bot.publicBio',
    'bot.homepage',
    'bot.defaultRenderer',
    'bot.upload',
    'bot.savePublicIdentity',
    'bot.reset',
    'bot.role',
    'bot.soul',
    'bot.goal',
    'bot.primaryLlmProvider',
    'bot.fallbackLlmProvider',
    'bot.noLlmLabel',
    'bot.noLlmTitle',
    'bot.publishService',
    'bot.manageServices',
    'bot.wallet',
    'bot.backup',
    'bot.executionHistory',
    'bot.deleteBot',
    'bot.llmProviders',
    'bot.runtimeSummaryMany',
    'bot.noRuntimesFound',
    'bot.sessionId',
    'bot.outputError',
    'bot.fullPrompt',
    'bot.noTransactionIdReturned',
    'bot.transactionIds',
    'bot.balance',
    'bot.receiveAddress',
    'bot.transfer',
    'bot.confirmTransfer',
    'bot.backupMnemonic',
    'bot.deleteWarningTitle',
    'bot.confirmDeleteCountdown',
    'bot.refreshRuntimes',
    'bot.chainCreatePendingTitle',
    'bot.chainCreatePendingMessage',
    'bot.chainCreateSuccessTitle',
    'bot.chainCreateSuccessMessage',
    'bot.openBotHomepage',
  ];

  for (const key of requiredBotKeys) {
    assert.equal(typeof DICTIONARIES.en[key], 'string', `${key} missing from en dictionary`);
    assert.notEqual(DICTIONARIES.en[key], '', `${key} has empty en copy`);
    assert.equal(typeof DICTIONARIES['zh-CN'][key], 'string', `${key} missing from zh-CN dictionary`);
    assert.notEqual(DICTIONARIES['zh-CN'][key], '', `${key} has empty zh-CN copy`);
  }

  assert.equal(translate('en', 'bot.publicIdentity'), 'Basic');
  assert.equal(translate('zh-CN', 'bot.publicIdentity'), '基础');
  assert.equal(translate('en', 'bot.behavior'), 'Persona');
  assert.equal(translate('zh-CN', 'bot.behavior'), '人格');
  assert.equal(translate('en', 'bot.botUri'), 'Homepage URI');
  assert.equal(translate('zh-CN', 'bot.botUri'), 'Homepage URI');
  assert.equal(translate('en', 'bot.localBots'), 'Local Bots');
  assert.equal(translate('zh-CN', 'bot.localBots'), '本地 Bots');
  assert.equal(translate('en', 'bot.defaultRenderer'), 'Default Bot Page renderer');
  assert.equal(translate('zh-CN', 'bot.defaultRenderer'), '默认 Bot Page 渲染器');
  assert.equal(translate('en', 'bot.homepageUploadLater'), 'Homepage package upload will be available later. This Bot is using the default Bot Page renderer.');
  assert.equal(translate('zh-CN', 'bot.homepageUploadLater'), '主页包上传稍后开放。当前 Bot 使用默认 Bot Page 渲染器。');
  assert.equal(translate('en', 'bot.homepageMetafile'), 'Metafile');
  assert.equal(translate('zh-CN', 'bot.homepageMetafile'), 'MetaFile');
  assert.equal(translate('en', 'bot.homepageMetaApp'), 'MetaApp');
  assert.equal(translate('zh-CN', 'bot.homepageMetaApp'), 'MetaApp');
  assert.equal(translate('en', 'bot.homepageMetafileNote'), 'Upload a local file up to 50 MiB and save it as metafile://<pinId>.');
  assert.equal(translate('zh-CN', 'bot.homepageMetafileNote'), '上传不超过 50 MiB 的本地文件，并保存为 metafile://<pinId>。');
  assert.equal(translate('en', 'bot.homepageMetaAppHelp'), 'Use the metabot-homepage-guide skill and metabot-metaapp-publish skill to create a unique Bot Page, package and publish it on-chain through the MetaApp protocol, then paste the MetaApp pin ID here.');
  assert.equal(translate('zh-CN', 'bot.homepageMetaAppHelp'), '请先使用 metabot-homepage-guide 技能和 metabot-metaapp-publish 技能制作一个独一无二的 Bot Page，并以 MetaApp 协议封装上链，然后将 MetaApp pin ID 复制到这里。');
  assert.equal(translate('en', 'bot.homepageMetaAppHelpLabel'), 'How to get a MetaApp pin ID');
  assert.equal(translate('zh-CN', 'bot.homepageMetaAppHelpLabel'), '如何获取 MetaApp pin ID');
  assert.equal(translate('en', 'bot.homepagePreviewMetaApp'), 'Preview');
  assert.equal(translate('zh-CN', 'bot.homepagePreviewMetaApp'), 'Preview');
  assert.equal(translate('en', 'bot.homepageViewLink'), 'click here to view');
  assert.equal(translate('zh-CN', 'bot.homepageViewLink'), 'click here to view');
  assert.equal(translate('en', 'bot.homepageReadyToSave'), 'Homepage ready to save.');
  assert.equal(translate('zh-CN', 'bot.homepageReadyToSave'), '主页已准备保存。');
  assert.equal(translate('en', 'bot.homepageUploadRequired'), 'Upload a homepage file before saving.');
  assert.equal(translate('zh-CN', 'bot.homepageUploadRequired'), '请先上传主页文件再保存。');
  assert.equal(translate('en', 'bot.homepageUploadTooLarge'), 'Homepage file must be 50 MiB or smaller.');
  assert.equal(translate('zh-CN', 'bot.homepageUploadTooLarge'), '主页文件必须小于或等于 50 MiB。');
  assert.equal(translate('en', 'bot.homepageDefaultReadyToSave'), 'Default homepage ready to save.');
  assert.equal(translate('zh-CN', 'bot.homepageDefaultReadyToSave'), '默认主页已准备保存。');
  assert.equal(translate('en', 'bot.identityCreatedBasicInfoReady'), 'The on-chain identity has been created. Public Identity is ready for optional edits.');
  assert.equal(translate('zh-CN', 'bot.identityCreatedBasicInfoReady'), '链上身份已创建。公开身份已可继续编辑。');
  assert.equal(translate('en', 'bot.chainCreatePendingMessage'), 'Data is being written on-chain. Please wait 15-30 seconds.');
  assert.equal(translate('zh-CN', 'bot.chainCreatePendingMessage'), '数据正在写入链上，请等候 15-30 秒。');
  assert.equal(translate('en', 'bot.openBotHomepage'), 'Open Bot homepage');
  assert.equal(translate('zh-CN', 'bot.openBotHomepage'), '打开 Bot 主页');
  assert.equal(translate('en', 'bot.noLlmLabel'), 'NO LLM');
  assert.equal(translate('zh-CN', 'bot.noLlmLabel'), 'NO LLM');
  assert.equal(translate('en', 'bot.runtimeSummaryMany', { count: 2 }), '2 detected providers visible. Unavailable providers are hidden from this list.');
  assert.equal(translate('zh-CN', 'bot.runtimeSummaryMany', { count: 2 }), '检测到 2 个可见提供方。不可用提供方已隐藏。');
  assert.equal(translate('en', 'bot.confirmDeleteCountdown', { count: 5 }), 'Confirm Delete (5s)');
  assert.equal(translate('zh-CN', 'bot.confirmDeleteCountdown', { count: 5 }), '确认删除（5s）');
  assert.equal(translate('zh-CN', 'bot.refreshRuntimes'), '刷新运行时');
});

test('Simplified Chinese UI keeps Bot as a proper noun', () => {
  assert.equal(translate('zh-CN', 'nav.botPage'), 'Bots');
  assert.equal(translate('zh-CN', 'action.openBotPage'), '打开 Bot Page');
  assert.equal(translate('en', 'action.openInBrowser'), 'Open in Browser');
  assert.equal(translate('zh-CN', 'action.openInBrowser'), '在浏览器中打开');

  const botAsCommonNounEntries = Object.entries(DICTIONARIES['zh-CN'])
    .filter(([, copy]) => copy.includes('机器人'));

  assert.deepEqual(botAsCommonNounEntries, []);
});

test('language selector renders only concrete language options and selects the resolved language', () => {
  const t = (key) => ({
    'language.auto': 'Auto',
    'language.en': 'English',
    'language.zhCN': '简体中文',
  })[key] ?? key;

  const zhAutoOptions = renderLanguageOptions({ preference: 'auto', language: 'zh-CN', t });
  assert.doesNotMatch(zhAutoOptions, /value="auto"/);
  assert.doesNotMatch(zhAutoOptions, />Auto<\/option>/);
  assert.match(zhAutoOptions, /<option value="zh-CN" selected>简体中文<\/option>/);
  assert.match(zhAutoOptions, /<option value="en">English<\/option>/);

  const enAutoOptions = renderLanguageOptions({ preference: 'auto', language: 'en', t });
  assert.match(enAutoOptions, /<option value="en" selected>English<\/option>/);
  assert.doesNotMatch(enAutoOptions, /value="auto"/);
});
