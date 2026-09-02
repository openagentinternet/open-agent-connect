/**
 * Ordering for Bot rows in the Settings → Bots panel.
 */

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
