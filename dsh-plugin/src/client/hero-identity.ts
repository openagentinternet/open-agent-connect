/**
 * Hero Bot identity mount. DSH has no slot above the blank-session hero
 * headline (whale logo + slogan), so this mounts a small React root into the
 * hero stack through the DOM, the same technique the Bot Browser sidebar and
 * the browser-iframe layout push already use.
 *
 * Anchors are structural, never css-module class names (those rehash per
 * build): the conversation root's `data-phase="hero"`, the composer seat's
 * `data-composer-seat`, and — critically — the slot renderer's own
 * `data-slot="conversation.composer"` anchor div. renderSlot/renderSlotChain
 * wrap EVERY slot's output in such a `display: contents` div, so positional
 * firstElementChild walks off the composer seat land one level short; the
 * first round shipped exactly that bug (the block rendered inside the
 * workspace/preset chip row). Traversal: composer chain anchor → composer
 * stack → HeroShell root → hero stack; the host is inserted BEFORE the
 * stack's first child (the headline), putting the avatar + name directly
 * above the whale and slogan. When the first message flips the session
 * active the hero subtree unmounts, the host disconnects, and the mount
 * releases itself until the next blank session. A future DSH layout that
 * breaks the traversal fails safe: the block simply stops appearing.
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { HeroBotIdentity } from './HeroBotIdentity.tsx'
import type { BotPresetSeatState } from './preset-seat-store.ts'

/**
 * The hero stack element to insert into, plus its first child (the headline
 * row: whale logo + slogan + preview badge).
 * @returns the mount anchor, or null when no hero is on screen.
 */
function heroAnchor(): { stack: HTMLElement; headline: Element } | null {
  const phaseRoot = document.querySelector('[data-phase="hero"]')
  if (!(phaseRoot instanceof HTMLElement)) return null
  const seat = phaseRoot.querySelector('[data-composer-seat]')
  if (!(seat instanceof HTMLElement)) return null
  const composer = seat.querySelector(':scope > [data-slot="conversation.composer"]')
  if (!(composer instanceof HTMLElement)) return null
  const composerStack = composer.firstElementChild
  const heroRoot = composerStack?.firstElementChild
  const stack = heroRoot?.firstElementChild
  if (!(stack instanceof HTMLElement)) return null
  const headline = stack.firstElementChild
  if (headline === null) return null
  return { stack, headline }
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
    const anchor = heroAnchor()
    if (anchor === null) return
    host = document.createElement('div')
    host.dataset.oacHeroIdentity = ''
    anchor.headline.before(host)
    root = createRoot(host)
    root.render(createElement(HeroBotIdentity, { store }))
  }

  const observer = new MutationObserver(() => { attach() })
  observer.observe(document.body, { childList: true, subtree: true })
  attach()
  return release
}
