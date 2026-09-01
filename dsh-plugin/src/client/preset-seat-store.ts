/**
 * Hero-chip controller: which preset the NEXT session gets.
 *
 * A pick is staged, then applied only when the current session is still blank.
 * After a successful `oac-*` select, the Bot's stored DSH provider/model is
 * applied when that pair is still advertised. Failures stay on the chip error
 * (preset) or are swallowed (model); the composer picker stays unlocked.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ChipBot, ChipPresetOption } from '../chip-logic.ts'
import {
  botsBySlugFromList,
  filterSelectablePresets,
  modelSelectionToApply,
  presetIdForSlug,
  shouldApplyStagedPreset,
} from '../chip-logic.ts'
import { messageOf } from './preset-display.ts'

/**
 * Structural mirrors of the generated Remote faces the seat drives
 * (`ctx.remote.agentPresets` / `ctx.remote.session`): failures arrive as
 * result objects, never throws. Kept local — the plugin resolves outside
 * DSH's cordis instance and types host services structurally.
 */
export type SeatRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string; readonly details?: unknown } }

/** Roster row as `agentPresets.list` returns it. */
export type SeatPresetRow = ChipPresetOption & { readonly isDefault: boolean }

/** `session.modelCatalog` value, cut down to the advertised provider groups. */
export type SeatModelCatalog = {
  readonly groups: ReadonlyArray<{ readonly id: string; readonly models: ReadonlyArray<{ readonly id: string }> }>
}

export type SeatApi = {
  agentPresets: {
    list: () => Promise<SeatRpcResult<{ readonly presets: readonly SeatPresetRow[] }>>
    select: (sessionId: string, agentPreset: string) => Promise<SeatRpcResult<string>>
  }
  sessions: {
    modelCatalog: () => Promise<SeatRpcResult<SeatModelCatalog>>
    selectModel: (input: { sessionId: string; provider: string; model: string }) => Promise<SeatRpcResult<unknown>>
  }
}

export type SeatSessionSummary = {
  id: string
  blank: boolean
  agentPreset?: string
}

export type BotPresetSeatState = {
  options: readonly ChipPresetOption[]
  current: string
  error: string | null
  busy: boolean
  botsBySlug: Record<string, ChipBot>
}

const INITIAL: BotPresetSeatState = {
  options: [],
  current: '',
  error: null,
  busy: false,
  botsBySlug: {},
}

export class BotPresetSeatController {
  readonly store: SnapshotStore<BotPresetSeatState> = createSnapshotStore(INITIAL)

  private fallback = ''
  private staged: string | undefined
  /** Blank sessions already defaulted to the Twin, so apply() stays idempotent. */
  private twinDefaulted = new Set<string>()

  constructor(
    private readonly api: SeatApi,
    private readonly listBots: () => Promise<ChipBot[]>,
    private readonly currentSession: () => SeatSessionSummary | undefined,
  ) {}

  private set(patch: Partial<BotPresetSeatState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  async load(): Promise<void> {
    try {
      const [roster, bots] = await Promise.all([
        this.api.agentPresets.list(),
        this.listBots().catch(() => [] as ChipBot[]),
      ])
      const botsBySlug = botsBySlugFromList(bots)
      if (!roster.ok) {
        this.set({ error: roster.error.message, botsBySlug })
        return
      }
      const { presets } = roster.value
      this.fallback = presets.find((preset) => preset.isDefault)?.id ?? presets[0]?.id ?? ''
      this.set({
        options: filterSelectablePresets(presets),
        current: this.staged ?? this.currentSession()?.agentPreset ?? this.fallback,
        error: null,
        botsBySlug,
      })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  async select(id: string): Promise<void> {
    if (this.store.getSnapshot().busy) return
    this.stage(id)
    await this.apply()
  }

  stage(id: string): void {
    this.staged = id
    this.set({ current: id, error: null })
  }

  /** The Twin's preset id, used as the default for new blank sessions. */
  private twinPresetId(): string | undefined {
    const bots = this.store.getSnapshot().botsBySlug
    const twinSlug = Object.values(bots).find((bot) => bot.botType === 'twin')?.slug
    if (!twinSlug) return undefined
    return presetIdForSlug(twinSlug)
  }

  async apply(): Promise<void> {
    const session = this.currentSession()
    if (session === undefined) return
    let staged = this.staged
    if (staged === undefined) {
      // New blank sessions default to the Twin Bot (the owner's chief-of-staff);
      // an explicit chip pick still wins, and each session is defaulted once.
      if (!session.blank || this.twinDefaulted.has(session.id)) return
      const twin = this.twinPresetId()
      if (!twin || session.agentPreset === twin) return
      staged = twin
      this.twinDefaulted.add(session.id)
    }
    if (!shouldApplyStagedPreset(session, staged)) {
      if (!session.blank || session.agentPreset === staged) this.staged = undefined
      return
    }
    this.set({ busy: true, error: null })
    try {
      const result = await this.api.agentPresets.select(session.id, staged)
      this.staged = undefined
      if (!result.ok) {
        this.set({ busy: false, error: refusalText(result.error), current: this.fallback })
        return
      }
      const agentPreset = result.value
      this.set({ busy: false, current: agentPreset })
      await this.applyStoredModel(session.id, agentPreset)
    } catch (error) {
      this.staged = undefined
      this.set({ busy: false, error: messageOf(error), current: this.fallback })
    }
  }

  private async applyStoredModel(sessionId: string, presetId: string): Promise<void> {
    try {
      const catalog = await this.api.sessions.modelCatalog()
      if (!catalog.ok) return
      const selection = modelSelectionToApply(
        presetId,
        this.store.getSnapshot().botsBySlug,
        catalog.value.groups,
      )
      if (selection === undefined) return
      const applied = await this.api.sessions.selectModel({
        sessionId,
        provider: selection.provider,
        model: selection.model,
      })
      if (!applied.ok) return
    } catch {
      // Soft fail: the composer model picker remains available.
    }
  }
}

/** A refusal carries its cause twice: wrapped in `message`, bare in `details.reason`. */
function refusalText(error: { message: string; details?: unknown }): string {
  const reason = (error.details as { reason?: unknown } | undefined)?.reason
  return typeof reason === 'string' ? reason : error.message
}
