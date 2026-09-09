/**
 * One SSE stream for every A2A unread signal: `private-conversations-changed`
 * (per Bot, when that Bot's a2a conversation store file changes) and
 * `group-task-update` (per task, diffed from the synced grouptask stores).
 *
 * This replaces the 2026-09-07 polling badge (disabled after it starved the
 * browser connection pool): the HOST watches the profile stores through the
 * filesystem — one recursive watcher on the profiles root (per-directory
 * watches where the platform has no recursive fs.watch) — and pushes events,
 * so the browser keeps a single idle EventSource instead of issuing
 * O(bots × threads) requests every 15 s. The stream also feeds nothing
 * else: chain-profile warm-up events stay on the per-Bot daemon proxy the
 * open panel already uses.
 */

import { watch, readdirSync, existsSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { PluginHttpRequest, PluginHttpResponse } from './context-types.js'
import { localGrouptaskList, localSystemHomeDir } from './local-read.js'
import { diffGroupTasks, type GroupTaskRow } from './unread-logic.js'

const PRIVATE_DEBOUNCE_MS = 500
const GROUP_DEBOUNCE_MS = 800
const HEARTBEAT_MS = 25_000

/** `chat-<local-prefix>-<peer-prefix>.json` under `<slug>/.runtime/a2a/`. */
const PRIVATE_FILE = /^([^/]+)\/\.runtime\/a2a\/chat-[^/]+\.json$/
/** Any synced grouptask store file under `<slug>/.runtime/grouptask/`. */
const GROUP_FILE = /^([^/]+)\/\.runtime\/grouptask\/./

type TaskSummaryRow = { chairSlug: string; id: number; updatedAt: number }

function taskRowsOf(payload: unknown): TaskSummaryRow[] {
  const tasks = (payload as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(tasks)) return []
  return tasks.filter((task): task is TaskSummaryRow => {
    if (task === null || typeof task !== 'object') return false
    const row = task as Record<string, unknown>
    return typeof row.chairSlug === 'string' && row.chairSlug !== ''
      && typeof row.id === 'number' && Number.isFinite(row.id)
      && typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)
  })
}

/**
 * Serve `/oac/api/chat/events/all`: watch the profile stores until the
 * client disconnects, then tear everything down.
 */
export function streamAllChatEvents(req: PluginHttpRequest, res: PluginHttpResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write?.('retry: 3000\n\n')

  let stopped = false
  const watchers: FSWatcher[] = []
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let groupTimer: ReturnType<typeof setTimeout> | null = null
  let groupSnapshot: Record<string, number> = {}
  const heartbeat = setInterval(() => {
    try {
      res.write?.(': ping\n\n')
    } catch {
      stop()
    }
  }, HEARTBEAT_MS)

  const emit = (event: string, data: unknown): void => {
    try {
      res.write?.(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    } catch {
      stop()
    }
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    clearInterval(heartbeat)
    if (groupTimer !== null) clearTimeout(groupTimer)
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    for (const watcher of watchers) {
      try {
        watcher.close()
      } catch {
        // already closed
      }
    }
    watchers.length = 0
    try {
      res.end?.()
    } catch {
      // already ended
    }
  }

  const onPrivate = (slug: string): void => {
    const timer = timers.get(slug)
    if (timer !== undefined) clearTimeout(timer)
    timers.set(slug, setTimeout(() => {
      timers.delete(slug)
      emit('private-conversations-changed', { from: slug })
    }, PRIVATE_DEBOUNCE_MS))
  }

  const onGroupFile = (): void => {
    if (groupTimer !== null) return
    groupTimer = setTimeout(() => {
      groupTimer = null
      void localGrouptaskList('all', true).then((result) => {
        if (stopped) return
        if (result === null || !result.ok) return
        const rows = taskRowsOf(result.data)
        const { next, updates } = diffGroupTasks(groupSnapshot, rows)
        groupSnapshot = next
        if (updates.length > 0) emit('group-task-update', { updates })
      }).catch(() => {
        // a failed store read is retried on the next store change
      })
    }, GROUP_DEBOUNCE_MS)
  }

  const onPath = (logical: string): void => {
    if (stopped || logical === '') return
    const normalized = logical.replaceAll('\\', '/')
    const privateMatch = PRIVATE_FILE.exec(normalized)
    if (privateMatch !== null) {
      onPrivate(privateMatch[1])
      return
    }
    if (GROUP_FILE.test(normalized)) onGroupFile()
  }

  const watchDir = (target: string, base: string, recursive: boolean): boolean => {
    try {
      const watcher = watch(target, { recursive, persistent: false }, (_event, filename) => {
        if (typeof filename === 'string') onPath(base === '' ? filename : `${base}/${filename}`)
      })
      watcher.on('error', () => { /* store watching stops silently; SSE reconnects restart it */ })
      watchers.push(watcher)
      return true
    } catch {
      return false
    }
  }

  const home = localSystemHomeDir()
  if (home !== null) {
    const profilesRoot = join(home, 'profiles')
    // Preferred: one recursive watcher over the whole profiles tree (FSEvents
    // on darwin). Platforms without recursive fs.watch fall back to
    // per-directory watches on the store dirs that exist.
    if (!watchDir(profilesRoot, '', true)) {
      try {
        for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          for (const area of ['.runtime/a2a', '.runtime/grouptask', '.runtime/grouptask/messages']) {
            watchDir(join(profilesRoot, entry.name, area), `${entry.name}/${area}`, false)
          }
        }
      } catch {
        // no profiles root: nothing to watch
      }
    }
  }

  emit('watch-ready', {})
  req.on?.('close', stop)
}
