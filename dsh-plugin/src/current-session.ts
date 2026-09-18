/**
 * "Current session" derivation for the conversation column, shared by the
 * A2A overlay navigation watch and the Bot preset seat summary.
 *
 * DSH 0.1.6 removed `SessionListState.current`: client sessions became
 * multi-instance (several Conversations mounted at once, each retaining its
 * own session), so the conversation column's session is now the one the main
 * view retains — `retainedBy.mainView > 0` on the row. Kernels ≤0.1.5 carry
 * an explicit `current` id on the list snapshot instead; it stays as the
 * fallback so one plugin build serves both kernel lines.
 */
export interface SessionListCurrentLike {
  current?: string | undefined
  byId?: Record<string, { id: string; retainedBy?: Record<string, number> }>
}

export function currentMainViewSessionId(state: SessionListCurrentLike): string | undefined {
  if (state.byId !== undefined) {
    for (const summary of Object.values(state.byId)) {
      if ((summary.retainedBy?.mainView ?? 0) > 0) return summary.id
    }
  }
  return state.current
}
