export type LanguagePreference = 'auto' | 'en' | 'zh-CN';
export type ConcreteLanguage = 'en' | 'zh-CN';

export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = 'auto';
export const SUPPORTED_LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ['auto', 'en', 'zh-CN'];
export const SUPPORTED_CONCRETE_LANGUAGES: readonly ConcreteLanguage[] = ['en', 'zh-CN'];
export const LANGUAGE_STORAGE_KEY = 'oac.localUi.languagePreference';

const SIMPLIFIED_CHINESE_LOCALES = new Set(['zh-cn', 'zh-hans', 'zh-sg']);

export const DICTIONARIES = {
  en: {
    'nav.botPage': 'Bot Page',
    'nav.conversations': 'Conversations',
    'nav.services': 'Services',
    'nav.settings': 'Settings',
    'action.openBrowser': 'Open Browser',
    'action.openBotPage': 'Open Bot Page',
    'bot.noBotsYet': 'No Bots yet',
    'bot.addBot': '+ Add Bot',
    'bot.name': 'Name',
    'bot.cancel': 'Cancel',
    'bot.create': 'Create',
    'bot.localBots': 'Local Bots',
    'bot.createBot': 'Create Bot',
    'bot.liveByDefault': 'Online',
    'bot.defaultHeroSummary': 'A public Bot Page for identity, messaging, and service entry points.',
    'bot.globalMetaId': 'GlobalMetaID',
    'bot.botUri': 'Homepage URI',
    'bot.copy': 'Copy',
    'bot.openPublicBotPage': 'Open Public Bot Page',
    'bot.viewConversations': 'View Conversations',
    'bot.publicIdentity': 'Basic',
    'bot.behavior': 'Persona',
    'bot.chatSkills': 'Chat Skills',
    'bot.services': 'Services',
    'bot.advanced': 'Advanced',
    'bot.botName': 'Bot Name',
    'bot.avatar': 'Avatar',
    'bot.removeAvatar': 'Remove',
    'bot.uploadReplace': 'Upload / Replace',
    'bot.publicBio': 'Public Bio',
    'bot.homepage': 'Homepage',
    'bot.defaultRenderer': 'Default Bot Page renderer',
    'bot.upload': 'Upload',
    'bot.homepageUploadLater': 'Homepage package upload will be available later. This Bot is using the default Bot Page renderer.',
    'bot.savePublicIdentity': 'Save Public Identity',
    'bot.saveBehavior': 'Save Behavior',
    'bot.saveChatSkills': 'Save Chat Skills',
    'bot.reset': 'Reset',
    'bot.behaviorPlaceholder': 'Behavior controls will be available here.',
    'bot.chatSkillsPlaceholder': 'Chat skill controls will be available here.',
    'bot.servicesPlaceholder': 'Service publishing entries will be available here.',
    'bot.role': 'Role',
    'bot.soul': 'Soul',
    'bot.goal': 'Goal',
    'bot.primaryLlmProvider': 'Primary LLM Provider',
    'bot.fallbackLlmProvider': 'Fallback LLM Provider',
    'bot.chatSkillsNote': 'Choose which skills can be used for private conversation replies.',
    'bot.chatAllowedSkills': 'Chat Allowed Skills',
    'bot.noChatSkillsAllowed': 'No chat skills allowed yet.',
    'bot.selectSkill': 'Select a skill',
    'bot.add': 'Add',
    'bot.loadingChatSkills': 'Loading chat skills...',
    'bot.chatSkillsLoadFailed': 'Failed to load chat skills.',
    'bot.publishService': 'Publish Service',
    'bot.manageServices': 'Manage Services',
    'bot.wallet': 'Wallet',
    'bot.backup': 'Backup',
    'bot.executionHistory': 'Execution History',
    'bot.time': 'Time',
    'bot.provider': 'Provider',
    'bot.runtime': 'Runtime',
    'bot.status': 'Status',
    'bot.duration': 'Duration',
    'bot.prompt': 'Prompt',
    'bot.details': 'Details',
    'bot.sessionId': 'Session ID',
    'bot.outputError': 'Output/Error',
    'bot.fullPrompt': 'Full Prompt',
    'bot.noExecutionsYet': 'No executions yet for this Bot',
    'bot.selectBot': 'Select a Bot',
    'bot.loadingSettings': 'Loading settings...',
    'bot.defaultWriteNetwork': 'Default Write Network',
    'bot.defaultWriteNetworkNote': 'Used by write commands when no explicit chain is supplied. Wallet balance and transfer keep their own chain selection rules.',
    'bot.saveSettings': 'Save Settings',
    'bot.deleteBot': 'Delete Bot',
    'bot.llmProviders': 'LLM Providers',
    'bot.runtimeSummaryOne': '{count} detected provider visible. Unavailable providers are hidden from this list.',
    'bot.runtimeSummaryMany': '{count} detected providers visible. Unavailable providers are hidden from this list.',
    'bot.noRuntimesFound': 'No healthy or detected LLM providers were found.',
    'bot.path': 'Path',
    'bot.version': 'Version',
    'bot.model': 'Model',
    'bot.auth': 'Auth',
    'bot.lastSeen': 'Last seen',
    'bot.checked': 'Checked',
    'bot.health': 'Health',
    'bot.reason': 'Reason',
    'bot.providerUnavailable': 'Provider unavailable',
    'bot.none': 'None',
    'bot.noHealthyRuntimes': 'No healthy runtimes found',
    'bot.refreshRuntimes': 'Refresh Runtimes',
    'bot.refresh': 'Refresh',
    'bot.refreshing': 'Refreshing...',
    'bot.test': 'Test',
    'bot.testing': 'Testing...',
    'bot.nameRequired': 'Name is required',
    'bot.creating': 'Creating...',
    'bot.chainCreatePendingTitle': 'Writing to chain',
    'bot.chainCreatePendingMessage': 'Data is being written on-chain. Please wait 15-30 seconds.',
    'bot.chainCreateSuccessTitle': 'Bot created',
    'bot.chainCreateSuccessMessage': 'The Bot identity has been written on-chain.',
    'bot.openBotHomepage': 'Open Bot homepage',
    'bot.createFailed': 'Bot creation failed',
    'bot.noChanges': 'No changes',
    'bot.saving': 'Saving...',
    'bot.saved': 'Saved',
    'bot.onChainUpdateConfirmed': 'On-chain update confirmed.',
    'bot.profileUpdatedOnChain': 'Profile Updated On-Chain',
    'bot.profileChangesWrittenOnChain': 'Profile changes were written on-chain before local data was saved.',
    'bot.onChainOperationConfirmed': 'The on-chain operation has been confirmed.',
    'bot.transactionIds': 'Transaction IDs',
    'bot.transactionId': 'Transaction ID',
    'bot.noTransactionIdReturned': 'No transaction ID was returned by the chain writer.',
    'bot.copyTxid': 'Copy txid',
    'bot.metaBotCreatedOnChain': 'Bot Created On-Chain',
    'bot.identityCreatedBasicInfoReady': 'The on-chain identity has been created. Public Identity is ready for optional edits.',
    'bot.botPageUnavailable': 'Bot Page is unavailable until GlobalMetaID is ready',
    'bot.selectBotBeforeConversations': 'Select a Bot before opening conversations',
    'bot.avatarTooLarge': 'Avatar must be 200KB or smaller.',
    'bot.readyToSave': 'Ready to save',
    'bot.uploadFailed': 'Upload failed',
    'bot.runtimeRefreshFailed': 'Runtime refresh failed',
    'bot.runtimeTestFailed': 'Runtime test failed',
    'bot.nothingToCopy': 'Nothing to copy',
    'bot.copied': 'Copied!',
    'bot.copyFailed': 'Copy failed',
    'bot.ok': 'OK',
    'bot.close': 'Close',
    'bot.balance': 'Balance',
    'bot.unavailable': 'Unavailable',
    'bot.receiveAddress': 'Receive Address',
    'bot.copyAddress': 'Copy address',
    'bot.transfer': 'Transfer',
    'bot.chain': 'Chain',
    'bot.available': 'Available',
    'bot.fromAddress': 'From Address',
    'bot.recipient': 'Recipient',
    'bot.amount': 'Amount',
    'bot.estimatedFee': 'Estimated Fee',
    'bot.next': 'Next',
    'bot.back': 'Back',
    'bot.confirmTransfer': 'Confirm Transfer',
    'bot.transferBroadcast': 'Transfer Broadcast',
    'bot.transferBroadcastStatus': 'Transfer broadcast',
    'bot.recipientRequired': 'Recipient is required.',
    'bot.enterPositiveAmount': 'Enter a positive {unit} amount.',
    'bot.amountExceedsBalance': 'Amount exceeds available balance: {balance}',
    'bot.preparingTransferPreview': 'Preparing transfer preview...',
    'bot.broadcastingTransfer': 'Broadcasting transfer...',
    'bot.loadingWalletAddresses': 'Loading wallet addresses...',
    'bot.backupMnemonic': 'Backup Mnemonic',
    'bot.loadingBackupPhrase': 'Loading backup phrase...',
    'bot.backupWarningTitle': 'Write these 12 words down and store them offline.',
    'bot.backupWarningBody': 'Anyone who gets this phrase can control this Bot and access its assets.',
    'bot.deleteWarningTitle': 'Deleting this Bot will remove all local information.',
    'bot.deleteWarningBody': 'Please make sure you have backed up the mnemonic, otherwise it cannot be recovered after deletion.',
    'bot.confirmDelete': 'Confirm Delete',
    'bot.confirmDeleteCountdown': 'Confirm Delete ({count}s)',
    'bot.deletingLocalBotData': 'Deleting local Bot data...',
    'language.label': 'Language',
    'language.auto': 'Auto',
    'language.en': 'English',
    'language.zhCN': '简体中文',
    'settings.title': 'Settings — Open Agent Connect',
    'settings.heading': 'Settings',
    'settings.description': 'Review Bot provider runtime, network, wallet, and browser settings.',
    'settings.status.loading': 'Loading local runtime settings...',
    'settings.status.loaded': 'Settings snapshot loaded.',
    'settings.status.failed': 'Settings snapshot failed to load.',
    'settings.status.configLoaded': 'Config loaded from /api/config',
    'settings.status.configUnavailable': 'Config unavailable at /api/config',
    'settings.status.runtimeOne': '{count} runtime from /api/llm/runtimes',
    'settings.status.runtimeMany': '{count} runtimes from /api/llm/runtimes',
    'settings.status.sourceOne': '{count} source from /api/network/sources',
    'settings.status.sourceMany': '{count} sources from /api/network/sources',
    'settings.refresh': 'Refresh',
    'settings.language.title': 'Language and Localization',
    'settings.language.body': 'Choose the language for OAC-owned local UI chrome and Settings.',
    'settings.network.title': 'Network and Indexers',
    'settings.network.body': 'Directory sources, MetaID gateway, and indexer connectivity.',
    'settings.wallet.title': 'Wallet and Payments',
    'settings.wallet.body': 'Bot wallet readiness and payment-sensitive operations remain under Bot Page actions.',
    'settings.llm.title': 'LLM Providers',
    'settings.llm.body': 'Detected local runtimes and provider health for service execution.',
    'settings.browser.title': 'Browser and Gateway',
    'settings.browser.body': 'Browser is a high-level tool outside the Provider Console tab set.',
    'settings.discovery.title': 'Service Discovery',
    'settings.discovery.body': 'Network source health for online Bot and service listings.',
    'settings.diagnostics.title': 'Advanced Diagnostics',
    'settings.diagnostics.body': 'Legacy diagnostics remain directly available without becoming top-level navigation.',
  },
  'zh-CN': {
    'nav.botPage': '机器人页面',
    'nav.conversations': '对话',
    'nav.services': '服务',
    'nav.settings': '设置',
    'action.openBrowser': '打开浏览器',
    'action.openBotPage': '打开机器人页面',
    'bot.noBotsYet': '还没有 Bot',
    'bot.addBot': '创建 Bot',
    'bot.name': 'Bot 名称',
    'bot.cancel': '取消',
    'bot.create': '创建',
    'bot.localBots': '本地 Bots',
    'bot.createBot': '创建 Bot',
    'bot.liveByDefault': '在线',
    'bot.defaultHeroSummary': '用于身份、消息和服务入口的公开 Bot Page。',
    'bot.globalMetaId': 'GlobalMetaID',
    'bot.botUri': 'Homepage URI',
    'bot.copy': '复制',
    'bot.openPublicBotPage': '打开公开 Bot Page',
    'bot.viewConversations': '查看对话',
    'bot.publicIdentity': '基础',
    'bot.behavior': '人格',
    'bot.chatSkills': '聊天技能',
    'bot.services': '服务',
    'bot.advanced': '高级',
    'bot.botName': 'Bot 名称',
    'bot.avatar': '头像',
    'bot.removeAvatar': '移除',
    'bot.uploadReplace': '上传 / 替换',
    'bot.publicBio': '公开简介',
    'bot.homepage': '主页',
    'bot.defaultRenderer': '默认 Bot Page 渲染器',
    'bot.upload': '上传',
    'bot.homepageUploadLater': '主页包上传稍后开放。当前 Bot 使用默认 Bot Page 渲染器。',
    'bot.savePublicIdentity': '保存公开身份',
    'bot.saveBehavior': '保存行为',
    'bot.saveChatSkills': '保存聊天技能',
    'bot.reset': '重置',
    'bot.behaviorPlaceholder': '行为设置将在这里显示。',
    'bot.chatSkillsPlaceholder': '聊天技能设置将在这里显示。',
    'bot.servicesPlaceholder': '服务发布入口将在这里显示。',
    'bot.role': '角色',
    'bot.soul': '灵魂',
    'bot.goal': '目标',
    'bot.primaryLlmProvider': '主 LLM 提供方',
    'bot.fallbackLlmProvider': '备用 LLM 提供方',
    'bot.chatSkillsNote': '选择可用于私聊回复的技能。',
    'bot.chatAllowedSkills': '聊天允许技能',
    'bot.noChatSkillsAllowed': '还没有允许的聊天技能。',
    'bot.selectSkill': '选择技能',
    'bot.add': '添加',
    'bot.loadingChatSkills': '正在加载聊天技能...',
    'bot.chatSkillsLoadFailed': '聊天技能加载失败。',
    'bot.publishService': '发布服务',
    'bot.manageServices': '管理服务',
    'bot.wallet': '钱包',
    'bot.backup': '备份',
    'bot.executionHistory': '执行历史',
    'bot.time': '时间',
    'bot.provider': '提供方',
    'bot.runtime': '运行时',
    'bot.status': '状态',
    'bot.duration': '耗时',
    'bot.prompt': '提示词',
    'bot.details': '详情',
    'bot.sessionId': '会话 ID',
    'bot.outputError': '输出 / 错误',
    'bot.fullPrompt': '完整提示词',
    'bot.noExecutionsYet': '此 Bot 还没有执行记录',
    'bot.selectBot': '选择一个 Bot',
    'bot.loadingSettings': '正在加载设置...',
    'bot.defaultWriteNetwork': '默认写入网络',
    'bot.defaultWriteNetworkNote': '当写入命令没有显式指定链时使用。钱包余额和转账保留各自的链选择规则。',
    'bot.saveSettings': '保存设置',
    'bot.deleteBot': '删除 Bot',
    'bot.llmProviders': 'LLM 提供方',
    'bot.runtimeSummaryOne': '检测到 {count} 个可见提供方。不可用提供方已隐藏。',
    'bot.runtimeSummaryMany': '检测到 {count} 个可见提供方。不可用提供方已隐藏。',
    'bot.noRuntimesFound': '未发现健康或已检测到的 LLM 提供方。',
    'bot.path': '路径',
    'bot.version': '版本',
    'bot.model': '模型',
    'bot.auth': '认证',
    'bot.lastSeen': '上次发现',
    'bot.checked': '检查时间',
    'bot.health': '健康状态',
    'bot.reason': '原因',
    'bot.providerUnavailable': '提供方不可用',
    'bot.none': '无',
    'bot.noHealthyRuntimes': '未发现健康运行时',
    'bot.refreshRuntimes': '刷新运行时',
    'bot.refresh': '刷新',
    'bot.refreshing': '刷新中...',
    'bot.test': '测试',
    'bot.testing': '测试中...',
    'bot.nameRequired': '请输入 Bot 名称',
    'bot.creating': '正在创建...',
    'bot.chainCreatePendingTitle': '正在上链',
    'bot.chainCreatePendingMessage': '数据正在写入链上，请等候 15-30 秒。',
    'bot.chainCreateSuccessTitle': 'Bot 创建成功',
    'bot.chainCreateSuccessMessage': 'Bot 身份已写入链上。',
    'bot.openBotHomepage': '打开 Bot 主页',
    'bot.createFailed': 'Bot 创建失败',
    'bot.noChanges': '没有变更',
    'bot.saving': '正在保存...',
    'bot.saved': '已保存',
    'bot.onChainUpdateConfirmed': '链上更新已确认。',
    'bot.profileUpdatedOnChain': '资料已写入链上',
    'bot.profileChangesWrittenOnChain': '资料变更已先写入链上，然后保存到本地。',
    'bot.onChainOperationConfirmed': '链上操作已确认。',
    'bot.transactionIds': '交易 ID',
    'bot.transactionId': '交易 ID',
    'bot.noTransactionIdReturned': '链写入器没有返回交易 ID。',
    'bot.copyTxid': '复制 txid',
    'bot.metaBotCreatedOnChain': 'Bot 已在链上创建',
    'bot.identityCreatedBasicInfoReady': '链上身份已创建。公开身份已可继续编辑。',
    'bot.botPageUnavailable': 'GlobalMetaID 准备好后才能打开 Bot Page',
    'bot.selectBotBeforeConversations': '请先选择一个 Bot 再打开对话',
    'bot.avatarTooLarge': '头像必须不超过 200KB。',
    'bot.readyToSave': '可以保存',
    'bot.uploadFailed': '上传失败',
    'bot.runtimeRefreshFailed': '运行时刷新失败',
    'bot.runtimeTestFailed': '运行时测试失败',
    'bot.nothingToCopy': '没有可复制内容',
    'bot.copied': '已复制',
    'bot.copyFailed': '复制失败',
    'bot.ok': '确定',
    'bot.close': '关闭',
    'bot.balance': '余额',
    'bot.unavailable': '不可用',
    'bot.receiveAddress': '收款地址',
    'bot.copyAddress': '复制地址',
    'bot.transfer': '转账',
    'bot.chain': '链',
    'bot.available': '可用',
    'bot.fromAddress': '转出地址',
    'bot.recipient': '收款方',
    'bot.amount': '金额',
    'bot.estimatedFee': '预估手续费',
    'bot.next': '下一步',
    'bot.back': '返回',
    'bot.confirmTransfer': '确认转账',
    'bot.transferBroadcast': '转账已广播',
    'bot.transferBroadcastStatus': '转账已广播',
    'bot.recipientRequired': '请输入收款方。',
    'bot.enterPositiveAmount': '请输入正数 {unit} 金额。',
    'bot.amountExceedsBalance': '金额超过可用余额：{balance}',
    'bot.preparingTransferPreview': '正在准备转账预览...',
    'bot.broadcastingTransfer': '正在广播转账...',
    'bot.loadingWalletAddresses': '正在加载钱包地址...',
    'bot.backupMnemonic': '备份助记词',
    'bot.loadingBackupPhrase': '正在加载备份短语...',
    'bot.backupWarningTitle': '请写下这 12 个词并离线保存。',
    'bot.backupWarningBody': '任何获得这组词的人都可以控制此 Bot 并访问其资产。',
    'bot.deleteWarningTitle': '删除此 Bot 将移除全部本地信息。',
    'bot.deleteWarningBody': '请确认已经备份助记词，否则删除后无法恢复。',
    'bot.confirmDelete': '确认删除',
    'bot.confirmDeleteCountdown': '确认删除（{count}s）',
    'bot.deletingLocalBotData': '正在删除本地 Bot 数据...',
    'language.label': '语言',
    'language.auto': 'Auto',
    'language.en': 'English',
    'language.zhCN': '简体中文',
    'settings.title': '设置 — Open Agent Connect',
    'settings.heading': '设置',
    'settings.description': '查看机器人服务方运行时、网络、钱包和浏览器设置。',
    'settings.status.loading': '正在加载本地运行时设置...',
    'settings.status.loaded': '设置快照已加载。',
    'settings.status.failed': '设置快照加载失败。',
    'settings.status.configLoaded': '已从 /api/config 加载配置',
    'settings.status.configUnavailable': '/api/config 配置不可用',
    'settings.status.runtimeOne': '来自 /api/llm/runtimes 的 {count} 个运行时',
    'settings.status.runtimeMany': '来自 /api/llm/runtimes 的 {count} 个运行时',
    'settings.status.sourceOne': '来自 /api/network/sources 的 {count} 个来源',
    'settings.status.sourceMany': '来自 /api/network/sources 的 {count} 个来源',
    'settings.refresh': '刷新',
    'settings.language.title': '语言和本地化',
    'settings.language.body': '选择 OAC 本地界面导航和设置页面使用的语言。',
    'settings.network.title': '网络和索引器',
    'settings.network.body': '目录来源、MetaID 网关和索引器连接状态。',
    'settings.wallet.title': '钱包和支付',
    'settings.wallet.body': '机器人钱包状态和支付敏感操作仍保留在机器人页面。',
    'settings.llm.title': 'LLM 提供方',
    'settings.llm.body': '检测到的本地运行时和服务执行健康状态。',
    'settings.browser.title': '浏览器和网关',
    'settings.browser.body': '浏览器是 Provider Console 标签页之外的高级工具。',
    'settings.discovery.title': '服务发现',
    'settings.discovery.body': '在线机器人和服务列表的网络来源健康状态。',
    'settings.diagnostics.title': '高级诊断',
    'settings.diagnostics.body': '旧版诊断入口保持直接可用，但不进入顶层导航。',
  },
} as const;

export type I18nKey = keyof typeof DICTIONARIES.en;

export interface LocalUiI18nContext {
  preference: LanguagePreference;
  language: ConcreteLanguage;
  t: (key: I18nKey, replacements?: Record<string, string | number>) => string;
}

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  if (value === 'en' || value === 'zh-CN' || value === 'auto') {
    return value;
  }
  return DEFAULT_LANGUAGE_PREFERENCE;
}

function normalizeLocale(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/_/g, '-') : '';
}

export function resolveConcreteLanguage(
  preference: unknown = DEFAULT_LANGUAGE_PREFERENCE,
  detectedLocales: readonly unknown[] = [],
): ConcreteLanguage {
  const normalizedPreference = normalizeLanguagePreference(preference);
  if (normalizedPreference === 'en' || normalizedPreference === 'zh-CN') {
    return normalizedPreference;
  }

  for (const locale of detectedLocales) {
    if (SIMPLIFIED_CHINESE_LOCALES.has(normalizeLocale(locale))) {
      return 'zh-CN';
    }
  }
  return 'en';
}

export function translate(
  language: ConcreteLanguage,
  key: I18nKey,
  replacements: Record<string, string | number> = {},
): string {
  const template = DICTIONARIES[language]?.[key] ?? DICTIONARIES.en[key] ?? key;
  let text = String(template);
  for (const [name, value] of Object.entries(replacements)) {
    text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
  }
  return text;
}

export function createI18nContext(
  preference: unknown = DEFAULT_LANGUAGE_PREFERENCE,
  detectedLocales: readonly unknown[] = [],
): LocalUiI18nContext {
  const normalizedPreference = normalizeLanguagePreference(preference);
  const language = resolveConcreteLanguage(normalizedPreference, detectedLocales);
  return {
    preference: normalizedPreference,
    language,
    t: (key, replacements) => translate(language, key, replacements),
  };
}

export function renderLanguageOptions(i18n: LocalUiI18nContext): string {
  const options: Array<{ value: LanguagePreference; labelKey: I18nKey }> = [
    { value: 'en', labelKey: 'language.en' },
    { value: 'zh-CN', labelKey: 'language.zhCN' },
  ];
  const selectedValue = i18n.preference === 'en' || i18n.preference === 'zh-CN' ? i18n.preference : i18n.language;
  return options.map((option) => {
    const selected = option.value === selectedValue ? ' selected' : '';
    return `<option value="${option.value}"${selected}>${i18n.t(option.labelKey)}</option>`;
  }).join('');
}

export function renderClientI18nScript(i18n: LocalUiI18nContext): string {
  return `(() => {
  const STORAGE_KEY = ${JSON.stringify(LANGUAGE_STORAGE_KEY)};
  const DEFAULT_PREFERENCE = ${JSON.stringify(DEFAULT_LANGUAGE_PREFERENCE)};
  const SERVER_PREFERENCE = ${JSON.stringify(i18n.preference)};
  const DICTIONARIES = ${JSON.stringify(DICTIONARIES)};
  const SIMPLIFIED_CHINESE_LOCALES = ['zh-cn', 'zh-hans', 'zh-sg'];
  const OPTION_KEYS_BY_VALUE = { en: 'language.en', 'zh-CN': 'language.zhCN' };
  const normalizePreference = (value) => value === 'en' || value === 'zh-CN' || value === 'auto' ? value : DEFAULT_PREFERENCE;
  const normalizeLocale = (value) => typeof value === 'string' ? value.trim().toLowerCase().replace(/_/g, '-') : '';
  const detectedLocales = () => {
    if (typeof navigator !== 'undefined' && Array.isArray(navigator.languages) && navigator.languages.length > 0) return navigator.languages;
    if (typeof navigator !== 'undefined' && navigator.language) return [navigator.language];
    return [];
  };
  const resolveLanguage = (preference) => {
    const normalized = normalizePreference(preference);
    if (normalized === 'en' || normalized === 'zh-CN') return normalized;
    return detectedLocales().some((locale) => SIMPLIFIED_CHINESE_LOCALES.includes(normalizeLocale(locale))) ? 'zh-CN' : 'en';
  };
  const format = (template, replacements) => Object.entries(replacements || {}).reduce(
    (text, [name, value]) => text.replace(new RegExp('\\\\{' + name + '\\\\}', 'g'), String(value)),
    template
  );
  let currentPreference = SERVER_PREFERENCE;
  let currentLanguage = resolveLanguage(currentPreference);
  const t = (key, replacements) => {
    const dictionary = DICTIONARIES[currentLanguage] || DICTIONARIES.en;
    return format(dictionary[key] || DICTIONARIES.en[key] || key, replacements);
  };
  const queryAll = (selector) => {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return [];
    return document.querySelectorAll(selector);
  };
  const setPreference = (preference, options = {}) => {
    currentPreference = normalizePreference(preference);
    currentLanguage = resolveLanguage(currentPreference);
    if (options.persist) {
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, currentPreference); } catch {}
    }
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = currentLanguage;
    queryAll('[data-i18n-key]').forEach((element) => {
      element.textContent = t(element.getAttribute('data-i18n-key') || '');
    });
    queryAll('[data-language-select]').forEach((element) => {
      element.value = currentPreference === 'auto' ? currentLanguage : currentPreference;
      if (typeof element.querySelectorAll !== 'function') return;
      element.querySelectorAll('option').forEach((option) => {
        const key = OPTION_KEYS_BY_VALUE[option.value];
        if (key) option.textContent = t(key);
      });
    });
    if (typeof window !== 'undefined') {
      window.__oacLocalUiI18n = { t, getPreference: () => currentPreference, getLanguage: () => currentLanguage };
      if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('oac:i18n-changed', { detail: { preference: currentPreference, language: currentLanguage } }));
      }
    }
  };
  const queryPreference = new URLSearchParams(typeof window !== 'undefined' && window.location ? window.location.search : '').get('lang');
  if (queryPreference) {
    setPreference(queryPreference, { persist: true });
  } else {
    let storedPreference = null;
    try { if (typeof localStorage !== 'undefined') storedPreference = localStorage.getItem(STORAGE_KEY); } catch {}
    setPreference(storedPreference || DEFAULT_PREFERENCE);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('change', (event) => {
      const target = event.target && event.target.closest ? event.target.closest('[data-language-select]') : null;
      if (!target) return;
      setPreference(target.value, { persist: true });
    });
  }
})();`;
}
