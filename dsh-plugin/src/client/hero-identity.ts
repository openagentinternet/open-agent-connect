/**
 * Hero Bot identity mount. DSH has no slot above the blank-session hero
 * headline (whale logo + slogan), so this mounts a small React root into the
 * hero stack through the DOM, the same technique the Bot Browser sidebar and
 * the browser-iframe layout push already use.
 *
 * Anchoring lesson (five live rounds): the slot renderer wraps EVERY
 * renderSlot/renderSlotChain output — including the whale mark itself — in
 * `display: contents` divs (`[data-slot="…"]`, and for overlay chains a
 * second `[data-chain-overlay-fallback="…"]` around the fallback). Child
 * walks and bare ancestor matches from any slot output therefore land on a
 * wrapper, not the layout element: rounds 1/3 dropped the block into the
 * chip row and the HeroShell flex-row root, round 4 into the 34px brand-mark
 * wrapper beside the whale. Round 5 (DSH 0.1.5-rc): the "first svg under the
 * seat is the whale" assumption broke — the rc kernel moved the conversation
 * column under new main/main.conversation chain wrappers and the hero mounts
 * in multi-pass commits, so the whale is briefly absent while
 * `[data-phase="hero"]` and the composer seat already exist. The climb then
 * started from the workspace-chip folder icon or an input-bar icon and
 * anchored the block on those rows — rows that PERSIST into the active
 * phase, leaving the avatar stuck above the input box after the first
 * message (it only cleared when switching sessions unmounted the column),
 * or stranded below the whale above the workspace row, sometimes doubled.
 *
 * The mount now (a) accepts an ancestor row only when the brand svg reaches
 * it through a DIRECT SPAN child — HeroShell's fish hitbox; every mis-anchor
 * svg (folder, input icons) lives inside BUTTON rows and can never satisfy
 * that — so a missing whale fails safe instead of mis-anchoring, (b) sweeps
 * orphaned identity hosts (a stale client instance would render a second
 * block), (c) re-validates the placement on every mutation and re-anchors
 * when the hero reconciles around the foreign node, and (d) releases with
 * try/finally so a React unmount throw cannot strand the host in the DOM.
 * The host inserts directly before the headline row, making the block a
 * regular child of the hero stack's stretch flex column — horizontally
 * centered, above the whale and slogan. When the first message flips the
 * session active the hero subtree unmounts, the host disconnects, and the
 * mount releases itself until the next blank session. A future DSH layout
 * change that breaks the anchor fails safe: the block stops appearing.
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { HeroBotIdentity } from './HeroBotIdentity.tsx'
import type { BotPresetSeatState } from './preset-seat-store.ts'

/**
 * Does the brand svg reach {@link row} through a DIRECT span child?
 * HeroShell seats the whale inside `span.fishHitbox` — a direct child of the
 * headline row (slot wrappers live INSIDE the span). Every other svg under
 * the composer seat (the workspace chip's folder mark, the input-bar icons)
 * sits inside BUTTON rows and can never satisfy this, which is exactly what
 * pins the climb to the real headline.
 */
function spansBrandMark(row: HTMLElement, brand: SVGElement): boolean {
  for (const child of row.children) {
    if (child instanceof HTMLSpanElement && child.contains(brand)) return true
  }
  return false
}

/**
 * The headline row (whale logo + slogan + preview badge) of the on-screen
 * blank-session hero.
 * @returns the row to insert before, or null when no hero is on screen (or
 * the brand mark is not mounted — the rc kernel's multi-pass hero commits
 * have such windows; anchoring anywhere else strays, so we fail safe).
 */
function heroHeadline(): HTMLElement | null {
  const phaseRoot = document.querySelector('[data-phase="hero"]')
  if (!(phaseRoot instanceof HTMLElement)) return null
  const seat = phaseRoot.querySelector('[data-composer-seat]')
  if (!(seat instanceof HTMLElement)) return null
  const brand = seat.querySelector('svg')
  if (!(brand instanceof SVGElement)) return null
  // Climb past every slot wrapper (content-hugging display:contents divs) to
  // the wide, un-wrapped div that can only be the headline grid. The span
  // check keeps the climb from adopting the workspace row or the input bar
  // when the whale is the absent one; zero-width (hidden) seats never anchor.
  const columnWidth = seat.getBoundingClientRect().width
  if (columnWidth <= 0) return null
  let node: HTMLElement | null = brand.parentElement
  while (node !== null && node !== seat) {
    if (node instanceof HTMLElement
      && node.tagName === 'DIV'
      && node.dataset.slot === undefined
      && node.dataset.chainOverlayFallback === undefined
      && node.getBoundingClientRect().width >= columnWidth / 2
      && spansBrandMark(node, brand)) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Watch the DOM and keep the hero Bot identity mounted above the headline of
 * every blank-session hero.
 * @param store the hero chip controller's store (current preset + Bot roster).
 * @returns stop function (disconnect observer, unmount root, drop host).
 */
export function startHeroIdentityMount(store: SnapshotStore<BotPresetSeatState>): () => void {
  let root: Root | null = null
  let host: HTMLElement | null = null

  const release = (): void => {
    // try/finally: a throwing root.unmount() must not skip the host removal —
    // a stranded host is exactly the stuck-avatar bug this mount exists to
    // avoid.
    try {
      root?.unmount()
    } finally {
      root = null
      host?.remove()
      host = null
    }
  }

  const attach = (): void => {
    // Sweep orphaned identity hosts first: a stale client instance (reload
    // churn) or an exception-stranded host would render a duplicate block
    // beside this watcher's own.
    for (const stray of document.querySelectorAll('[data-oac-hero-identity]')) {
      if (stray !== host) stray.remove()
    }
    const headline = heroHeadline()
    if (host !== null) {
      if (host.isConnected) {
        // Connected AND still directly above the live headline: nothing to
        // do. Anything else — the hero reconciled around the foreign node, or
        // the headline subtree was replaced/removed (avatar-without-whale) —
        // releases so the mount re-anchors (or fails safe when the whale is
        // gone).
        if (headline !== null && host.nextElementSibling === headline) return
      }
      release()
    }
    if (headline === null) return
    host = document.createElement('div')
    host.dataset.oacHeroIdentity = ''
    headline.before(host)
    root = createRoot(host)
    root.render(createElement(HeroBotIdentity, { store }))
  }

  const observer = new MutationObserver(() => { attach() })
  observer.observe(document.body, { childList: true, subtree: true })
  attach()
  return release
}
