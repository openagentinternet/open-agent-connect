import type { PluginHttpRequest, PluginHttpResponse } from './context-types.js'

export function writeJson(res: PluginHttpResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function apiMethod(req: PluginHttpRequest, prefix: string): string | undefined {
  const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
  if (!pathname.startsWith(`${prefix}/`)) return undefined
  const method = pathname.slice(prefix.length + 1)
  if (method === '' || method.includes('/')) return undefined
  return method
}
