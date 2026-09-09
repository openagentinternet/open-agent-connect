/**
 * Hero Bot identity mount. DSH has no slot between the blank-session hero
 * headline (logo + slogan) and the workspace/preset chip row, so this mounts
 * a small React root into the hero stack's reserved — stock-empty — body
 * hole through the DOM, the same technique the Bot Browser sidebar and the
 * browser-iframe layout push already use.
 *
 * Anchors are structural, never css-module class names (those rehash per
 * build): the conversation root's `data-phase="hero"` and the composer
 * seat's `data-composer-seat`, both asserted by DSH's own tests. When the
 * first message flips the session active the hero subtree unmounts, the
 * host disconnects, and the mount releases itself until the next blank
 * session. A future DSH layout that breaks the traversal fails safe: the
 * block simply stops appearing.
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { HeroBotIdentity } from './HeroBotIdentity.tsx'
import type { BotPresetSeatState } from './preset-seat-store.ts'

/**
 * The hero stack's body hole: conversation root (hero phase) → composer
 * seat → chain fallback (composer stack) → HeroShell root → stack; the
 * stack's second child is the reserved empty body under the headline.
 * Falls back to the stack itself when DSH ever fills that hole.
 * @returns the element to mount into, or null when no hero is on screen.
 */
function heroHole(): HTMLElement | null {
  const phaseRoot = document.querySelector('[data-phase="hero"]')
  if (!(phaseRoot instanceof HTMLElement)) return null
  const seat = phaseRoot.querySelector('[data-composer-seat]')
  if (!(seat instanceof HTMLElement)) return null
  const composerStack = seat.firstElementChild
  const heroRoot = composerStack?.firstElementChild
  const stack = heroRoot?.firstElementChild
  if (!(stack instanceof HTMLElement)) return null
  const hole = stack.children[1]
  return hole instanceof HTMLElement ? hole : stack
}

/**
 * Watch the DOM and keep the hero Bot identity mounted under the headline of
 * every blank-session hero.
 * @param store the hero chip controller's store (current preset + Bot roster).
 * @returns stop function (disconnect observer, unmount root, drop host).
 */
export function startHeroIdentityMount(store: SnapshotStore<BotPresetSeatState>): () => void {
  let root: Root | null = null
  let host: HTMLElement | null = null

  const release = (): void => {
    root?.unmount()
    root = null
    host?.remove()
    host = null
  }

  const attach = (): void => {
    if (host !== null) {
      if (host.isConnected) return
      // The hero unmounted underneath us (session left the blank phase).
      release()
    }
    const hole = heroHole()
    if (hole === null) return
    host = document.createElement('div')
    host.dataset.oacHeroIdentity = ''
    hole.append(host)
    root = createRoot(host)
    root.render(createElement(HeroBotIdentity, { store }))
  }

  const observer = new MutationObserver(() => { attach() })
  observer.observe(document.body, { childList: true, subtree: true })
  attach()
  return release
}
