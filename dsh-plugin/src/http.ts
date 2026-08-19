import type { PluginHttpRequest, PluginHttpResponse } from './context-types.js'

export function writeJson(res: PluginHttpResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function apiMethod(req: PluginHttpRequest, prefix: string): string | undefined {
  const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
  if (!pathname.startsWith(`${prefix}/`)) return undefined
  const method = pathname.slice(prefix.length + 1)
  if (method === '') return undefined
  return method
}

const MAX_BODY_BYTES = 1 << 20

export async function readJsonBody(req: PluginHttpRequest): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      throw new Error('request body too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text) as unknown
}

const MAX_RAW_BODY_BYTES = 24 * 1024 * 1024

/** Read the request as raw bytes (asset upload body), capped like the JSON path. */
export async function readRawBody(req: PluginHttpRequest, cap = MAX_RAW_BODY_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > cap) {
      throw new Error('request body too large')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}
