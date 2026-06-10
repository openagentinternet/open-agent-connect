import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  DEFAULT_LANGUAGE_PREFERENCE,
  DICTIONARIES,
  normalizeLanguagePreference,
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
  ];

  for (const key of requiredBotKeys) {
    assert.equal(typeof DICTIONARIES.en[key], 'string', `${key} missing from en dictionary`);
    assert.notEqual(DICTIONARIES.en[key], '', `${key} has empty en copy`);
    assert.equal(typeof DICTIONARIES['zh-CN'][key], 'string', `${key} missing from zh-CN dictionary`);
    assert.notEqual(DICTIONARIES['zh-CN'][key], '', `${key} has empty zh-CN copy`);
  }

  assert.equal(translate('en', 'bot.publicIdentity'), 'Public Identity');
  assert.equal(translate('zh-CN', 'bot.publicIdentity'), '公开身份');
  assert.equal(translate('en', 'bot.localBots'), 'Local Bots');
  assert.equal(translate('zh-CN', 'bot.localBots'), '本地 Bots');
  assert.equal(translate('en', 'bot.liveByDefault'), 'Live by default');
  assert.equal(translate('zh-CN', 'bot.liveByDefault'), '默认在线');
  assert.equal(translate('en', 'bot.defaultRenderer'), 'Default Bot Page renderer');
  assert.equal(translate('zh-CN', 'bot.defaultRenderer'), '默认 Bot Page 渲染器');
  assert.equal(translate('en', 'bot.homepageUploadLater'), 'Homepage package upload will be available later. This Bot is using the default Bot Page renderer.');
  assert.equal(translate('zh-CN', 'bot.homepageUploadLater'), '主页包上传稍后开放。当前 Bot 使用默认 Bot Page 渲染器。');
  assert.equal(translate('en', 'bot.identityCreatedBasicInfoReady'), 'The on-chain identity has been created. Public Identity is ready for optional edits.');
  assert.equal(translate('zh-CN', 'bot.identityCreatedBasicInfoReady'), '链上身份已创建。公开身份已可继续编辑。');
  assert.equal(translate('en', 'bot.runtimeSummaryMany', { count: 2 }), '2 detected providers visible. Unavailable providers are hidden from this list.');
  assert.equal(translate('zh-CN', 'bot.runtimeSummaryMany', { count: 2 }), '检测到 2 个可见提供方。不可用提供方已隐藏。');
  assert.equal(translate('en', 'bot.confirmDeleteCountdown', { count: 5 }), 'Confirm Delete (5s)');
  assert.equal(translate('zh-CN', 'bot.confirmDeleteCountdown', { count: 5 }), '确认删除（5s）');
  assert.equal(translate('zh-CN', 'bot.refreshRuntimes'), '刷新运行时');
});
