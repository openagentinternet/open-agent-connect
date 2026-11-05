/**
 * One-shot "open this Bot in the editor" requests (client half).
 *
 * The DSH 0.2.2+ unified session context menu contributes an OAC action on
 * `oac-*` session rows (edit the Bot behind the session's preset). The
 * editor selection is BotPanel-local React state, so the menu publishes a
 * request here instead: BotPanel opens the matching profile when it has the
 * roster, and a request that lands before the panel mounts is simply dropped
 * (the Bots page still opens on the list).
 */

type Listener = (slug: string) => void

const listeners = new Set<Listener>()

/** Publish an open-in-editor request for one Bot slug. */
export function requestBotEditor(slug: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(slug)
    } catch {
      // one panel's failure must not break the rest
    }
  }
}

/** Run `listener` for every editor request; returns an unsubscribe. */
export function subscribeToBotEditorRequests(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
