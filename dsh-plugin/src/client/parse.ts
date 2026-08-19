export function interpolate(template: string, vars: Record<string, string | number> = {}): string {
  let text = template
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

export function asRecordArray(data: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((row) => row && typeof row === 'object') as Record<string, unknown>[]
  if (data && typeof data === 'object') {
    for (const key of keys) {
      const value = (data as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        return value.filter((row) => row && typeof row === 'object') as Record<string, unknown>[]
      }
    }
  }
  return []
}

export function textOf(row: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return fallback
}
