/**
 * Hero-chip controller: which preset the NEXT session gets.
 *
 * A pick is staged, then applied only when the current session is still blank.
 * After a successful `oac-*` select, the Bot's stored DSH provider/model is
 * applied when that pair is still advertised. Failures stay on the chip error
 * (preset) or are swallowed (model); the composer picker stays unlocked.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChipBot, ChipPresetOption } from '../chip-logic.ts'
import {
  botsBySlugFromList,
  filterSelectablePresets,
  modelSelectionToApply,
  presetIdForSlug,
  shouldApplyStagedPreset,
} from '../chip-logic.ts'
import { messageOf } from './preset-display.ts'

type RpcOk<T> = { result: { ok: true; value: T } }
type RpcErr = { result: { ok: false; error: { message: string } } }
type RpcResponse<T> = RpcOk<T> | RpcErr

export type SeatApi = {
  agentPresets: {
    list: (input: Record<string, never>) => Promise<RpcResponse<{
      presets: Array<ChipPresetOption & { isDefault?: boolean; broken?: string }>
    }>>
    select: (input: { sessionId: string; agentPreset: string }) => Promise<RpcResponse<{ agentPreset: string }>>
  }
  sessions: {
    models: (input: { sessionId: string }) => Promise<RpcResponse<{
      groups: Array<{ id: string; models: Array<{ id: string }> }>
    }>>
    selectModel: (input: {
      sessionId: string
      provider: string
      model: string
    }) => Promise<RpcResponse<unknown>>
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
    private readonly onApplied?: (sessionId: string, agentPreset: string) => void,
  ) {}

  private set(patch: Partial<BotPresetSeatState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  async load(): Promise<void> {
    try {
      const [response, bots] = await Promise.all([
        this.api.agentPresets.list({}),
        this.listBots().catch(() => [] as ChipBot[]),
      ])
      const botsBySlug = botsBySlugFromList(bots)
      if (!response.result.ok) {
        this.set({ error: response.result.error.message, botsBySlug })
        return
      }
      const { presets } = response.result.value
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
      const response = await this.api.agentPresets.select({ sessionId: session.id, agentPreset: staged })
      this.staged = undefined
      if (!response.result.ok) {
        this.set({ busy: false, error: response.result.error.message, current: this.fallback })
        return
      }
      const agentPreset = response.result.value.agentPreset
      this.set({ busy: false, current: agentPreset })
      this.onApplied?.(session.id, agentPreset)
      await this.applyStoredModel(session.id, agentPreset)
    } catch (error) {
      this.staged = undefined
      this.set({ busy: false, error: messageOf(error), current: this.fallback })
    }
  }

  private async applyStoredModel(sessionId: string, presetId: string): Promise<void> {
    try {
      const catalog = await this.api.sessions.models({ sessionId })
      if (!catalog.result.ok) return
      const selection = modelSelectionToApply(
        presetId,
        this.store.getSnapshot().botsBySlug,
        catalog.result.value.groups,
      )
      if (selection === undefined) return
      await this.api.sessions.selectModel({
        sessionId,
        provider: selection.provider,
        model: selection.model,
      })
    } catch {
      // Soft fail: the composer model picker remains available.
    }
  }
}
