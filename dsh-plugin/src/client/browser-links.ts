/**
 * Make Agent Internet names and URIs clickable in DSH chat.
 *
 * DSH MarkdownText only keeps http(s)/mailto hrefs, so metaapp:// links are
 * stripped to plain text. Search results therefore use
 * https://openagentinternet.org/browser/... destinations. This module:
 * 1. intercepts those clicks (and leftover custom-scheme hrefs) to open the
 *    right-sidebar Bot Browser instead of a new tab,
 * 2. wraps bare metaapp:// / metaid:// / pin:// / pinid:// / pin ids in the
 *    conversation DOM,
 * 3. wraps exact titles from the latest search catalog when the model restates
 *    them as plain text.
 */
import {
  normalizeBotBrowserUri,
  publicBrowserHref,
  type BrowserCatalogEntry,
} from '../browser-protocol.ts'

const SKIP_WRAP = new Set(['A', 'BUTTON', 'CODE', 'INPUT', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA'])
const BARE_URI_RE = /(?:metaid|metaapp|map|metafile|pin|pinid|preview-metaapp):\/\/[A-Za-z0-9][A-Za-z0-9._~%/@-]*|(?:https:\/\/openagentinternet\.org\/browser\/[^\s)<>]+)|\b[0-9a-f]{64}i0\b/gi

let catalog: BrowserCatalogEntry[] = []

export function rememberCatalog(apps: readonly BrowserCatalogEntry[]): void {
  const next = apps.filter((entry) => entry.title.trim().length >= 2 && entry.uri)
  if (next.length === 0) return
  const byTitle = new Map<string, BrowserCatalogEntry>()
  for (const entry of catalog) byTitle.set(entry.title, entry)
  for (const entry of next) byTitle.set(entry.title, entry)
  catalog = [...byTitle.values()].sort((a, b) => b.title.length - a.title.length)
  enhanceConversationLinks()
}

export function catalogSnapshot(): readonly BrowserCatalogEntry[] {
  return catalog
}

export function enhanceConversationLinks(): void {
  if (typeof document === 'undefined' || !document.body) return
  enhanceTree(document.body)
}

function isSkippable(el: Element): boolean {
  if (SKIP_WRAP.has(el.tagName)) return true
  if (el.closest('a, code, pre, textarea, .oac-browser-shell')) return true
  return false
}

function wrapRange(textNode: Text, start: number, end: number, href: string, uri: string): Text | null {
  const value = textNode.nodeValue ?? ''
  const parent = textNode.parentNode
  if (!parent || start < 0 || end > value.length || start >= end) return null
  const after = value.slice(end)
  const mid = value.slice(start, end)
  textNode.nodeValue = value.slice(0, start)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.dataset.oacAgentLink = uri
  anchor.className = 'oac-agent-link'
  anchor.textContent = mid
  parent.insertBefore(anchor, textNode.nextSibling)
  if (!after) return null
  const tail = document.createTextNode(after)
  parent.insertBefore(tail, anchor.nextSibling)
  return tail
}

function wrapBareUris(textNode: Text): boolean {
  const value = textNode.nodeValue ?? ''
  BARE_URI_RE.lastIndex = 0
  const match = BARE_URI_RE.exec(value)
  if (!match || match.index === undefined) return false
  const raw = match[0]
  const uri = normalizeBotBrowserUri(raw)
  if (!uri) return false
  wrapRange(textNode, match.index, match.index + raw.length, publicBrowserHref(uri), uri)
  return true
}

function wrapCatalogTitle(textNode: Text): boolean {
  const value = textNode.nodeValue ?? ''
  if (!value) return false
  for (const entry of catalog) {
    const index = value.indexOf(entry.title)
    if (index < 0) continue
    wrapRange(textNode, index, index + entry.title.length, entry.href, entry.uri)
    return true
  }
  return false
}

function enhanceTree(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  for (const node of nodes) {
    const parent = node.parentElement
    if (!parent || isSkippable(parent)) continue
    if (!node.nodeValue) continue
    if (wrapBareUris(node)) continue
    wrapCatalogTitle(node)
  }
}

function hrefOfAnchor(anchor: HTMLAnchorElement): string {
  return (anchor.getAttribute('href') || anchor.href || '').trim()
}

/** Capture chat / tool-card clicks so Agent Internet hrefs open the Bot Browser. */
export function startAgentLinkInterceptor(openUri: (uri: string) => void): () => void {
  const onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a')
    if (!anchor) return
    const uri = anchor.dataset.oacAgentLink || normalizeBotBrowserUri(hrefOfAnchor(anchor))
    if (!uri) return
    event.preventDefault()
    event.stopPropagation()
    openUri(uri)
  }
  document.addEventListener('click', onClick, true)

  let timer: number | null = null
  const schedule = (): void => {
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      enhanceConversationLinks()
    }, 40)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  schedule()

  return () => {
    document.removeEventListener('click', onClick, true)
    observer.disconnect()
    if (timer !== null) window.clearTimeout(timer)
  }
}
