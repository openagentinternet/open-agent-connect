/**
 * Right-sidebar Bot Browser store.
 *
 * The Browser lives in the official right Sidebar as the `bot-browser` page
 * tab kind; this tiny store is the reactive face the tab body and chip title
 * read through the inject `hooks` compartment. It carries only what the tab
 * components render: the live ABC active-tab URI (chip title) and the last
 * open failure (the tab body's landing state). The iframe URL itself is
 * navigation business — it travels as `openTab` params and is tracked by the
 * iframe bridge (`liveUrl()`), not here.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

export type BotBrowserState = {
  /** Live ABC active-tab URI reported by the iframe bridge. */
  activeUri: string | null
  /** Last open failure message (the tab body's landing state shows it). */
  error: string | null
}

export class BotBrowserStore implements SnapshotStore<BotBrowserState> {
  private readonly inner = createSnapshotStore<BotBrowserState>({ activeUri: null, error: null })

  readonly getSnapshot = (): BotBrowserState => this.inner.getSnapshot()

  readonly subscribe = (listener: () => void): (() => void) => this.inner.subscribe(listener)

  readonly update = (mutator: (draft: BotBrowserState) => void): void => this.inner.update(mutator)

  readonly set = (next: BotBrowserState): void => this.inner.set(next)

  setActiveUri(uri: string | null): void {
    if (this.inner.getSnapshot().activeUri === uri) return
    this.update((draft) => { draft.activeUri = uri })
  }

  /** Record an open failure for the tab body's landing state. */
  fail(message: string): void {
    this.update((draft) => { draft.error = message })
  }

  clearError(): void {
    if (this.inner.getSnapshot().error === null) return
    this.update((draft) => { draft.error = null })
  }
}
