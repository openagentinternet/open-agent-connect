/**
 * Compact relative time, mirroring the IDBots chat/group-task lists:
 * `now` under a minute, then `Nm`, `Nh`, and unbounded `Nd`. The absolute
 * timestamp stays available as a hover tooltip at the call sites.
 */
export function relativeTimeLabel(value: number, now = Date.now()): string {
  if (!Number.isFinite(value) || value <= 0) return '-'
  const diff = now - value
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  return `${days}d`
}
