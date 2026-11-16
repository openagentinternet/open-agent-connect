/** Locale namespace for the `metaid` fence card (chat code-block rendering). */
export const METAID_NS = 'settings.oac.metaidFence'

export const metaidEn = {
  cardTitle: 'MetaID resource',
  open: 'Open',
  copy: 'Copy link',
  copied: 'Copied',
}

export const metaidZh = {
  cardTitle: 'MetaID 资源',
  open: '打开',
  copy: '复制链接',
  copied: '已复制',
}

export type MetaidFenceLocaleKey = keyof typeof metaidEn
