/** Locale namespace for the right-Sidebar Bot Browser tab. */
export const BROWSER_NS = 'settings.oac.browser'

export const browserEn = {
  title: 'Bot Browser',
  guideTitle: 'Bot Browser',
  guideDesc: 'Open Agent Internet pages and MetaApps beside the conversation.',
  empty: 'Open a Bot page or ask the Agent to open a page, and it will show up here.',
  emptyAction: 'Open home',
}

export const browserZh = {
  title: 'Bot 浏览器',
  guideTitle: 'Bot 浏览器',
  guideDesc: '在对话旁打开 Agent Internet 页面和 MetaApp。',
  empty: '打开某个 Bot 的主页，或让 Agent 打开一个页面，内容会显示在这里。',
  emptyAction: '打开首页',
}

export type BrowserLocaleKey = keyof typeof browserEn
