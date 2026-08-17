'use strict'

/**
 * OAC MetaApp tools: discover, read, and publish Agent Internet MetaApps.
 * Wraps the `metabot metaapp ...` CLI commands (read paths plus publish/delete).
 */

const { createRegistrar, defineMetabotTool, withRequestFile } = require('./_runner.js')

module.exports = {
  name: 'oac-metaapp',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_metaapp_search',
      description: 'Search the on-chain MetaApp index by keyword, tag, publisher, runtime, chain, or time window. Read-only.',
      timeoutMs: 60000,
      parameters: {
        query: { type: 'string', description: 'Free-text keyword.' },
        tag: { type: 'string', description: 'Tag filter.' },
        publisher: { type: 'string', description: 'Publisher globalMetaId filter.' },
        runtime: { type: 'string', description: 'Runtime filter (e.g. static, remotion, vue).' },
        chain: { type: 'string', description: 'Chain filter.' },
        sinceDays: { type: 'integer', description: 'Only apps published within the last N days.' },
        untilDays: { type: 'integer', description: 'Only apps published at least N days ago.' },
        limit: { type: 'integer', description: 'Max results (1-20).' },
        cursor: { type: 'string', description: 'Pagination cursor.' },
      },
      buildArgs: (args) => {
        const tail = ['metaapp', 'search']
        for (const flag of ['query', 'tag', 'publisher', 'runtime', 'chain', 'cursor']) {
          if (args[flag]) tail.push(`--${flag}`, args[flag])
        }
        if (args.sinceDays) tail.push('--since-days', String(args.sinceDays))
        if (args.untilDays) tail.push('--until-days', String(args.untilDays))
        if (args.limit) tail.push('--limit', String(args.limit))
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_metaapp_list',
      description: 'List MetaApps, optionally only the ones owned by the active bot. Read-only.',
      parameters: {
        mine: { type: 'boolean', description: 'List apps owned by the active bot.' },
        size: { type: 'integer', description: 'Page size (default 12).' },
        cursor: { type: 'string', description: 'Pagination cursor.' },
        from: { type: 'string', description: 'Optional bot slug (owner scope).' },
      },
      buildArgs: (args) => {
        const tail = ['metaapp', 'list']
        if (args.mine) tail.push('--mine')
        if (args.size) tail.push('--size', String(args.size))
        if (args.cursor) tail.push('--cursor', args.cursor)
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_metaapp_view',
      description: 'View one MetaApp by pinId (or metaapp:// URI). Read-only.',
      parameters: {
        pinId: { type: 'string', required: true, description: 'MetaApp pinId or metaapp://<pinId> URI.' },
      },
      buildArgs: (args) => ['metaapp', 'view', '--pin-id', args.pinId],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_metaapp_source',
      description: 'Fetch the source manifest of one MetaApp by pinId. Read-only.',
      parameters: {
        pinId: { type: 'string', required: true, description: 'MetaApp pinId or metaapp://<pinId> URI.' },
      },
      buildArgs: (args) => ['metaapp', 'source', '--pin-id', args.pinId],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_metaapp_forks',
      description: 'List remix forks of one MetaApp by pinId. Read-only.',
      parameters: {
        pinId: { type: 'string', required: true, description: 'MetaApp pinId or metaapp://<pinId> URI.' },
        limit: { type: 'integer', description: 'Max results.' },
        cursor: { type: 'string', description: 'Pagination cursor.' },
      },
      buildArgs: (args) => {
        const tail = ['metaapp', 'forks', '--pin-id', args.pinId]
        if (args.limit) tail.push('--limit', String(args.limit))
        if (args.cursor) tail.push('--cursor', args.cursor)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_metaapp_publish',
      description: 'Publish a new MetaApp from a prepared protocol payload (JSON object with the MetaApp protocol fields, e.g. manifest, entry, metawebUrl). Requires confirm: true to execute.',
      timeoutMs: 180000,
      parameters: {
        payloadJson: { type: 'string', required: true, description: 'JSON object payload for the MetaApp protocol (see `metabot metaapp publish --help`).' },
        network: {
          type: 'string',
          enum: ['mvc', 'btc', 'doge', 'opcat'],
          description: 'Write network.',
        },
        confirm: { type: 'boolean', description: 'true executes the publish; false previews.' },
        announce: { type: 'boolean', description: 'Also post a buzz announcement.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        let payload
        try {
          payload = JSON.parse(args.payloadJson)
        } catch (error) {
          throw new Error(`invalid payloadJson: ${error.message}`)
        }
        if (args.network) payload.network = args.network
        if (args.from) payload.from = args.from
        return withRequestFile(payload, (filePath) => {
          const tail = ['metaapp', 'publish', '--payload-file', filePath]
          if (args.network) tail.push('--chain', args.network)
          if (args.confirm === true) tail.push('--confirm')
          if (args.announce) tail.push('--announce')
          if (args.from) tail.push('--from', args.from)
          return tail
        })
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_metaapp_delete',
      description: 'Delete one MetaApp the active bot owns (by pinId). Requires confirm: true.',
      timeoutMs: 120000,
      parameters: {
        pinId: { type: 'string', required: true, description: 'MetaApp pinId to delete (passed as --target-pin-id).' },
        confirm: { type: 'boolean', description: 'true executes the delete.' },
      },
      buildArgs: (args) => {
        const tail = ['metaapp', 'delete', '--target-pin-id', args.pinId]
        if (args.confirm === true) tail.push('--confirm')
        return tail
      },
    })
  },
}
