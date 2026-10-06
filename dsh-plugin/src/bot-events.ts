/**
 * Bot-set change feed (host half).
 *
 * Every Bot picker in the client (the new-session preset chip, the shared
 * BotPicker surfaces) fetches its roster once on mount, and the surfaces
 * stay mounted across Bot edits — the Bots page overlays the conversation
 * column, visited sections stay alive, and 新会话 reuses the current blank
 * session without remounting the hero. A Bot created after a picker mounted
 * therefore stayed invisible until the next full DSH reload.
 *
 * This module closes the gap with one push-only SSE feed:
 *
 * - `/oac/api/bots/events` streams `bots-changed` frames (plus a heartbeat)
 *   to every connected client; the mutation routes (`bots/create|update|
 *   delete`) notify the hub directly on success.
 * - A host-lifetime filesystem watch over the bot registry files covers
 *   writes from outside the plugin's routes (the `metabot` CLI, the
 *   daemon): the manager's `identity-profiles.json` index for
 *   create/delete/rename, and each profile's `.runtime/bot-role.json` /
 *   `.runtime/dsh-llm.json` for availability and DSH LLM pair edits. Each
 *   debounced change first runs `reconcilePresets` — outside writes never
 *   registered the matching `oac-*` preset in this host process — and then
 *   notifies, so the refetching pickers see both the Bot and its preset.
 */

import { readdirSync, watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import type { HostContext, PluginHttpRequest, PluginHttpResponse } from './context-types.js'
import { runMetabot, type MetabotCommandResult } from './cli-bridge.js'
import { localBotList, localIdentityManagerPaths, localProfilesRoot } from './local-read.js'
import { reconcilePresets } from './preset.js'

const CHANGE_DEBOUNCE_MS = 400
const HEARTBEAT_MS = 25_000

/** `manager/identity-profiles.json` under the metabot root — the Bot set index. */
export const BOT_INDEX_FILE = /^manager\/identity-profiles\.json$/
/** A profile's picker-relevant state: availability + DSH LLM pair. */
export const BOT_STATE_FILE = /^profiles\/[^/]+\/\.runtime\/(?:bot-role|dsh-llm)\.json$/

/** Watched-path filter (paths are relative to the metabot root). */
export function isBotRegistryPath(logical: string): boolean {
  if (logical === '') return false
  const normalized = logical.replaceAll('\\', '/')
  return BOT_INDEX_FILE.test(normalized) || BOT_STATE_FILE.test(normalized)
}

export type BotEventFrame = { event: string; data: unknown }

/** Fan-out for `bots-changed`; route mutations and the registry watch both notify. */
export class BotChangeEventHub {
  private readonly clients = new Set<(frame: BotEventFrame) => void>()

  addClient(listener: (frame: BotEventFrame) => void): () => void {
    this.clients.add(listener)
    return () => {
      this.clients.delete(listener)
    }
  }

  notify(): void {
    for (const client of [...this.clients]) {
      try {
        client({ event: 'bots-changed', data: {} })
      } catch {
        // one dead client must not break the rest
      }
    }
  }
}

export type BotRegistryWatchOptions = {
  /** Test hooks: override the roots the watcher reads (null disables that watch). */
  metabotRoot?: () => string | null
  profilesRoot?: () => string | null
  debounceMs?: number
  /** Test hook: override the bot lister fed into reconcilePresets. */
  listBots?: () => Promise<MetabotCommandResult>
}

function defaultMetabotRoot(): string | null {
  const paths = localIdentityManagerPaths()
  return paths === null ? null : dirname(paths.managerRoot)
}

/**
 * Watch the bot registry files for the host's lifetime. Each debounced
 * change reconciles the `oac-*` presets (in the local-read fast path, then
 * the CLI) and notifies the hub; reconcile failures still notify — the Bot
 * set changed even when the preset sync did not keep up.
 */
export function watchBotRegistry(
  ctx: HostContext,
  hub: BotChangeEventHub,
  options: BotRegistryWatchOptions = {},
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let dirty = false
  const watchers: FSWatcher[] = []
  const debounceMs = options.debounceMs ?? CHANGE_DEBOUNCE_MS
  const listBots = options.listBots ?? (async () => (await localBotList()) ?? runMetabot(['bot', 'list']))

  const schedule = (): void => {
    if (stopped) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void run()
    }, debounceMs)
  }

  const run = async (): Promise<void> => {
    if (running) {
      dirty = true
      return
    }
    running = true
    try {
      if (ctx.agentPresets !== undefined) {
        await reconcilePresets(ctx, listBots)
      }
    } catch (error) {
      ctx.logger?.warn?.(`[oac-dsh] bot registry reconcile failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      running = false
      hub.notify()
      if (dirty && !stopped) {
        dirty = false
        schedule()
      }
    }
  }

  const watchDir = (target: string, base: string, recursive: boolean): boolean => {
    try {
      const watcher = watch(target, { recursive, persistent: false }, (_event, filename) => {
        if (typeof filename === 'string' && isBotRegistryPath(base === '' ? filename : `${base}/${filename}`)) {
          schedule()
        }
      })
      watcher.on('error', () => { /* registry watching stops silently; the route notifies still fire */ })
      watchers.push(watcher)
      return true
    } catch {
      return false
    }
  }

  const metabotRoot = options.metabotRoot?.() ?? defaultMetabotRoot()
  if (metabotRoot !== null) {
    // Preferred: one recursive watcher over the metabot root (FSEvents on
    // darwin); irrelevant writes (chats, memory, dreams) are filtered by
    // filename. Platforms without recursive fs.watch fall back to the
    // manager dir plus every existing profile's .runtime dir — a profile
    // created afterwards is still caught through the index write.
    if (!watchDir(metabotRoot, '', true)) {
      watchDir(join(metabotRoot, 'manager'), 'manager', false)
      const profilesRoot = options.profilesRoot?.() ?? localProfilesRoot()
      if (profilesRoot !== null) {
        try {
          for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            watchDir(
              join(profilesRoot, entry.name, '.runtime'),
              `profiles/${entry.name}/.runtime`,
              false,
            )
          }
        } catch {
          // no readable profiles root: the manager watch still catches creates
        }
      }
    }
  }

  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    for (const watcher of watchers) {
      try {
        watcher.close()
      } catch {
        // already closed
      }
    }
    watchers.length = 0
  }
}

/** Serve `/oac/api/bots/events`: heartbeat plus every hub frame. */
export function streamBotEvents(
  req: PluginHttpRequest,
  res: PluginHttpResponse,
  hub: BotChangeEventHub,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write?.('retry: 3000\n\n')

  let stopped = false
  const heartbeat = setInterval(() => {
    try {
      res.write?.(': ping\n\n')
    } catch {
      stop()
    }
  }, HEARTBEAT_MS)
  const unsubscribe = hub.addClient((frame) => {
    try {
      res.write?.(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`)
    } catch {
      stop()
    }
  })

  function stop(): void {
    if (stopped) return
    stopped = true
    clearInterval(heartbeat)
    unsubscribe()
    try {
      res.end?.()
    } catch {
      // already ended
    }
  }

  req.on?.('close', stop)
}
