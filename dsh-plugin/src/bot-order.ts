/**
 * Ordering for Bot rows in the Bots page's Bots section.
 */

import { isChipBotAvailable } from './chip-logic.js'

export type BotOrderFields = {
  createdAt?: number
  botType?: 'twin' | 'worker' | null
}

/**
 * Twin Bot first, then workers oldest-first by profile creation time.
 * Rows without a `botType` count as workers; a missing `createdAt` sorts as 0.
 * Returns a new array; the input is not mutated.
 */
export function sortBotsTwinFirst<T extends BotOrderFields>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftRank = left.botType === 'twin' ? 0 : 1
    const rightRank = right.botType === 'twin' ? 0 : 1
    if (leftRank !== rightRank) return leftRank - rightRank
    return (left.createdAt ?? 0) - (right.createdAt ?? 0)
  })
}

/** Fields the availability rule reads (the preset chip's `isChipBotAvailable`). */
export type BotAvailabilityFields = {
  isAvailable?: boolean
  dshLlmProvider?: string | null
  dshLlmModel?: string | null
}

/**
 * Bot-picker rows (the shared BotPicker): available Bots only — availability
 * toggle on AND a DSH LLM pair, the preset-chip rule — then twin-first,
 * oldest-first. Returns a new array; the input is not mutated.
 */
export function sortAvailableBotsTwinFirst<T extends BotOrderFields & BotAvailabilityFields>(
  rows: readonly T[],
): T[] {
  return sortBotsTwinFirst(rows.filter((row) => isChipBotAvailable(row)))
}

/**
 * Default Bot for pickers that show available Bots only (the shared
 * BotPicker): the available Twin, else the first available Bot. Returns ''
 * when no Bot is available.
 */
export function pickDefaultAvailableBotSlug(
  rows: readonly ({ slug: string } & BotOrderFields & BotAvailabilityFields)[],
): string {
  return sortAvailableBotsTwinFirst(rows)[0]?.slug ?? ''
}
