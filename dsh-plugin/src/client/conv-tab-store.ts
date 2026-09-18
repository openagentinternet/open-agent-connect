/**
 * Conversation-list tab state (client half).
 *
 * Apply-scope store behind the mounted tab strip: the strip, the lists, and
 * the navigation watchers (session switch / 新会话 force the local tab) all
 * read and write this one snapshot, and the choice persists in localStorage
 * (IDBots `taskRecordTab` parity).
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { loadConvTab, saveConvTab, type ConvTab } from '../conv-tab-logic.ts'

export type ConvTabState = {
  /** Which tab owns the left browsing region. */
  tab: ConvTab
}

export class ConvTabStore implements SnapshotStore<ConvTabState> {
  private readonly inner = createSnapshotStore<ConvTabState>({ tab: loadConvTab(window.localStorage) })

  readonly getSnapshot = (): ConvTabState => this.inner.getSnapshot()

  readonly subscribe = (listener: () => void): (() => void) => this.inner.subscribe(listener)

  readonly update = (mutator: (draft: ConvTabState) => void): void => this.inner.update(mutator)

  readonly set = (next: ConvTabState): void => this.inner.set(next)

  /** Switch tabs (the strip click); persists the choice. */
  setTab(tab: ConvTab): void {
    saveConvTab(window.localStorage, tab)
    const current = this.inner.getSnapshot()
    if (current.tab !== tab) this.inner.set({ tab })
  }
}
