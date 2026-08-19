/** Locale namespace for the right-sidebar Bot Browser surface. */
export const BROWSER_NS = 'settings.oac.browser'

export const browserEn = {
  title: 'Bot Browser',
  close: 'Close',
  home: 'Open Bot Browser home',
  empty: 'Open a Bot page or ask the Agent to open a page, and it will show up here.',
  emptyAction: 'Open home',
  daemonUnreachable: 'OAC daemon is not reachable. Start it with “metabot daemon start”.',
  landing: 'Bot Browser',
}

export const browserZh = {
  title: 'Bot 浏览器',
  close: '关闭',
  home: '打开 Bot 浏览器首页',
  empty: '打开某个 Bot 的主页，或让 Agent 打开一个页面，内容会显示在这里。',
  emptyAction: '打开首页',
  daemonUnreachable: 'OAC 守护进程不可达，请先运行“metabot daemon start”。',
  landing: 'Bot 浏览器',
}

export type BrowserLocaleKey = keyof typeof browserEn
