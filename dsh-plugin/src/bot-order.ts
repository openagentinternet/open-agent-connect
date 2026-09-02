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

/**
 * Default Bot for pickers (A2A Chat, …): the Twin Bot wins, then the active
 * Bot, then the first row. Returns '' for an empty list.
 */
export function pickDefaultBotSlug(
  rows: readonly { slug: string; botType?: 'twin' | 'worker' | null; isActive?: boolean }[],
): string {
  const twin = rows.find((row) => row.botType === 'twin')
  if (twin) return twin.slug
  const active = rows.find((row) => row.isActive === true)
  return (active ?? rows[0])?.slug ?? ''
}
