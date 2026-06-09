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
    { value: 'auto', labelKey: 'language.auto' },
    { value: 'en', labelKey: 'language.en' },
    { value: 'zh-CN', labelKey: 'language.zhCN' },
  ];
  return options.map((option) => {
    const selected = option.value === i18n.preference ? ' selected' : '';
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
  const OPTION_KEYS_BY_VALUE = { auto: 'language.auto', en: 'language.en', 'zh-CN': 'language.zhCN' };
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
      element.value = currentPreference;
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
