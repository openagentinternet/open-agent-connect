'use strict'

/**
 * OAC trace tools: read A2A delegation traces and session lists.
 * Wraps the `metabot trace ...` CLI commands (read paths only; `trace watch`
 * streams text and is intentionally not exposed).
 */

const { createRegistrar, defineMetabotTool } = require('./_runner.js')

module.exports = {
  name: 'oac-trace',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_trace_get',
      description: 'Read one A2A delegation trace by traceId or sessionId. Use this to poll a `waiting` result from metabot_services_call until it completes. Read-only.',
      timeoutMs: 60000,
      parameters: {
        traceId: { type: 'string', description: 'Trace id to read.' },
        sessionId: { type: 'string', description: 'Session id to read (alternative selector).' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['trace', 'get']
        if (args.traceId) tail.push('--trace-id', args.traceId)
        if (args.sessionId) tail.push('--session-id', args.sessionId)
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_trace_sessions',
      description: 'List recent A2A delegation sessions for the active bot. Read-only.',
      parameters: {
        all: { type: 'boolean', description: 'List all sessions, not only recent ones.' },
        limit: { type: 'integer', description: 'Max sessions (default 50).' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['trace', 'sessions']
        if (args.all) tail.push('--all')
        if (args.limit) tail.push('--limit', String(args.limit))
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })
  },
}
