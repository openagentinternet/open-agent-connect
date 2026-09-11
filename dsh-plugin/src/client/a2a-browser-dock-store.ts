/**
 * A2A in-panel Bot Browser dock store.
 *
 * Opens that originate inside the A2A global main panel (link, avatar, and
 * group-task clicks) cannot use the official right Sidebar — its Session seat
 * unmounts while a global main panel is selected, so revealing it would flip
 * the main column back to the Conversation. The A2A panel therefore hosts its
 * own browser dock column, and this store is the reactive face the panel
 * reads through the inject `hooks` compartment: visibility, the iframe URL,
 * the target URI (header fallback), and the last open failure (landing copy).
 * The store lives at apply scope, so the dock keeps its URL across main-panel
 * switches (the iframe itself reloads on remount, matching native tab
 * semantics).
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

export type A2ABrowserDockState = {
  /** Whether the dock column is shown inside the A2A panel. */
  open: boolean
  /** The iframe URL while loaded; null while landing on an error. */
  url: string | null
  /** The resource URI the last open targeted (header fallback before ABC reports). */
  uri: string | null
  /** Last open failure message (the dock's landing state shows it). */
  error: string | null
}

const CLOSED: A2ABrowserDockState = { open: false, url: null, uri: null, error: null }

export class A2ABrowserDockStore implements SnapshotStore<A2ABrowserDockState> {
  private readonly inner = createSnapshotStore<A2ABrowserDockState>(CLOSED)

  readonly getSnapshot = (): A2ABrowserDockState => this.inner.getSnapshot()

  readonly subscribe = (listener: () => void): (() => void) => this.inner.subscribe(listener)

  readonly update = (mutator: (draft: A2ABrowserDockState) => void): void => this.inner.update(mutator)

  readonly set = (next: A2ABrowserDockState): void => this.inner.set(next)

  /** Show the dock on a resolved URL (the `openA2ABrowserDock` flow's show face). */
  show(url: string, uri: string | null): void {
    this.update((draft) => {
      draft.open = true
      draft.url = url
      draft.uri = uri
      draft.error = null
    })
  }

  /** Record an open failure: the dock lands on the error copy. */
  fail(message: string): void {
    this.update((draft) => {
      draft.open = true
      draft.url = null
      draft.error = message
    })
  }

  close(): void {
    if (!this.inner.getSnapshot().open) return
    this.set(CLOSED)
  }
}
