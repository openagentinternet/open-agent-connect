/**
 * Conversation-list tabs DOM mount (client half).
 *
 * DSH offers no slot above the official browsing region (`sidebar.workspaces`
 * is one single-kind cell), so the tab surface mounts through the DOM like
 * the hero Bot identity — but on a far stabler anchor: the slot renderer
 * wraps EVERY renderSlot output in a `[data-slot="…"]` div, and that
 * attribute is part of the slot machinery itself (not hashed CSS), so
 * `document.querySelector('[data-slot="sidebar.workspaces"]')` is the
 * official region's stable address across themes and builds. The host
 * inserts as the wrapper's previous sibling inside the sidebar's flex
 * column: strip above, official browser below.
 *
 * While a non-local tab is active the mount hides the official region with
 * one namespaced html class (see conv-tab-logic.ts) instead of unmounting
 * it — the official component keeps its state and returns the moment the
 * user picks 本地对话. Every failure path fails SAFE: a missing anchor, a
 * component crash (ErrorBoundary releases the mount), or a sidebar collapse
 * to the 56px rail each drop the class and leave the stock region exactly
 * as DSH shipped it.
 */

import { Component, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConvTabs, type ConvTabsInjected, type ConvTabsTranslate } from './ConvTabs.tsx'
import type { ConvTabStore } from './conv-tab-store.ts'
import { CONV_TAB_RAIL_PX, CONV_TABS_ACTIVE_CLASS } from '../conv-tab-logic.ts'

/** DOM marker the mount's host carries (orphan sweep + tests). */
export const CONV_TAB_HOST_MARK = 'data-oac-conv-tabs'

/** Everything the mounted surface needs besides the tab store itself. */
export type ConvTabMountFace = Omit<ConvTabsInjected, 'setTab' | 'hooks'> & {
  hooks: { unread: ConvTabsInjected['hooks']['unread'] }
  t: ConvTabsTranslate
}

/** The official browsing region's stable anchor (the slot renderer's own wrapper). */
function regionWrapper(): HTMLElement | null {
  const wrapper = document.querySelector('[data-slot="sidebar.workspaces"]')
  return wrapper instanceof HTMLElement ? wrapper : null
}

/** Release-and-stay-released boundary: a crashed tab surface must not strand the official list hidden. */
class ConvTabsBoundary extends Component<{ onCrash: () => void; children?: ReactNode }, { dead: boolean }> {
  state = { dead: false }

  static getDerivedStateFromError(): { dead: boolean } {
    return { dead: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('[oac-dsh] conversation tabs surface crashed, releasing mount:', error)
    this.props.onCrash()
  }

  render(): ReactNode {
    return this.state.dead ? null : this.props.children
  }
}

/**
 * Keep the tab surface mounted above the official browsing region.
 * @returns stop function (observers + heartbeat + root + host + html class).
 */
export function startConvTabMount(store: ConvTabStore, face: ConvTabMountFace): () => void {
  let root: Root | null = null
  let host: HTMLElement | null = null
  let rail = false
  let stopped = false

  const syncActiveClass = (): void => {
    const active = !rail && store.getSnapshot().tab !== 'local'
    document.documentElement.classList.toggle(CONV_TABS_ACTIVE_CLASS, active)
  }

  const release = (): void => {
    // try/finally: a throwing root.unmount() must not skip the host cleanup
    // (hero-identity parity — a stranded host is exactly the stuck-strip bug
    // this mount must avoid).
    try {
      root?.unmount()
    } finally {
      root = null
      host?.remove()
      host = null
      document.documentElement.classList.remove(CONV_TABS_ACTIVE_CLASS)
    }
  }

  // Rail watch: the collapsed sidebar is a 56px rail — tabs do not fit and
  // the official region's rail icons must show. The host never goes
  // display:none (a zero-width box could never un-rail); it collapses to
  // height 0 + hidden instead, so its width keeps tracking the column and
  // the rail state lifts the moment the sidebar expands again.
  const railObserver = new ResizeObserver(() => {
    const width = host?.getBoundingClientRect().width ?? 0
    const nextRail = width > 0 && width < CONV_TAB_RAIL_PX
    if (nextRail === rail) return
    rail = nextRail
    if (host !== null) {
      host.style.height = rail ? '0px' : ''
      host.style.visibility = rail ? 'hidden' : ''
      host.style.overflow = rail ? 'hidden' : ''
    }
    if (rail && store.getSnapshot().tab !== 'local') store.setTab('local')
    syncActiveClass()
  })

  const attach = (): void => {
    if (stopped) return
    // Sweep orphaned hosts first: a stale client instance (reload churn) or
    // an exception-stranded host would render a duplicate strip.
    for (const stray of Array.from(document.querySelectorAll(`[${CONV_TAB_HOST_MARK}]`))) {
      if (stray !== host) stray.remove()
    }
    const wrapper = regionWrapper()
    if (wrapper === null) {
      // No official region on screen: release (and drop the class) so the
      // stock layout is untouched. Fails safe on any upstream restructure.
      if (host !== null) release()
      return
    }
    if (host !== null && host.isConnected) {
      if (host.nextElementSibling === wrapper && host.parentElement === wrapper.parentElement) return
      // The sidebar reconciled around the foreign node: re-anchor.
      release()
    }
    host = document.createElement('div')
    host.dataset.oacConvTabs = ''
    wrapper.before(host)
    root = createRoot(host)
    root.render(createElement(ConvTabsBoundary, {
      onCrash: () => { release() },
    }, createElement(ConvTabs, {
      ...face,
      setTab: (tab) => { store.setTab(tab) },
      hooks: { tabs: store, unread: face.hooks.unread },
      t: face.t,
    })))
    railObserver.disconnect()
    railObserver.observe(host)
    syncActiveClass()
  }

  const stopStoreWatch = store.subscribe(syncActiveClass)

  const domObserver = new MutationObserver(() => { attach() })
  domObserver.observe(document.body, { childList: true, subtree: true })
  // The observer only sees committed mutations; multi-pass React commits can
  // pass through states worth re-deciding after (hero-identity lesson).
  const heartbeat = setInterval(attach, 300)

  attach()

  return () => {
    stopped = true
    clearInterval(heartbeat)
    domObserver.disconnect()
    railObserver.disconnect()
    stopStoreWatch()
    release()
  }
}
