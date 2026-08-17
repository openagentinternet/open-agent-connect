'use strict'

/**
 * OAC bot profile tools: local MetaBot profile management (list/show/create/
 * update/delete), per-profile config, wallet, sessions, and LLM runtimes.
 * Wraps the `metabot bot ...` CLI commands.
 */

const { createRegistrar, defineMetabotTool, withRequestFile } = require('./_runner.js')

module.exports = {
  name: 'oac-bot',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_bot_list',
      description: 'List every local MetaBot profile on this machine. Read-only.',
      parameters: {},
      buildArgs: () => ['bot', 'list'],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_bot_show',
      description: 'Show one local MetaBot profile (slug -> public profile, keys, runtimes). Read-only.',
      parameters: {
        from: { type: 'string', required: true, description: 'Bot slug (--from).' },
      },
      buildArgs: (args) => ['bot', 'show', '--from', args.from],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_bot_create',
      description: 'Create a new local MetaBot profile (see also metabot_identity_create for bootstrap).',
      parameters: {
        name: { type: 'string', required: true, description: 'Profile/bot name.' },
        host: { type: 'string', description: 'Optional host platform hint.' },
      },
      buildArgs: (args) => {
        const tail = ['bot', 'create', '--name', args.name]
        if (args.host) tail.push('--host', args.host)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_bot_config_get',
      description: 'Read one profile config JSON document (chain defaults, a2a settings). Read-only.',
      parameters: {
        from: { type: 'string', required: true, description: 'Bot slug (--from).' },
      },
      buildArgs: (args) => ['bot', 'config', 'get', '--from', args.from],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_bot_config_set',
      description: 'Write one profile config JSON document (e.g. { "chain": { "defaultWriteNetwork": "mvc" } }).',
      parameters: {
        from: { type: 'string', required: true, description: 'Bot slug (--from).' },
        configJson: { type: 'string', required: true, description: 'JSON config patch, e.g. {"chain":{"defaultWriteNetwork":"mvc"}}.' },
      },
      buildArgs: (args) => {
        let payload
        try {
          payload = JSON.parse(args.configJson)
        } catch (error) {
          throw new Error(`invalid configJson: ${error.message}`)
        }
        return withRequestFile(payload, (filePath) => ['bot', 'config', 'set', '--from', args.from, '--payload-file', filePath])
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_bot_wallet',
      description: 'Show the native wallet addresses of one profile. Read-only.',
      parameters: {
        from: { type: 'string', required: true, description: 'Bot slug (--from).' },
      },
      buildArgs: (args) => ['bot', 'wallet', '--from', args.from],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_bot_sessions',
      description: 'List recent A2A sessions of a profile. Read-only.',
      parameters: {
        from: { type: 'string', description: 'Bot slug (--from).' },
        limit: { type: 'integer', description: 'Max sessions (default 50).' },
      },
      buildArgs: (args) => {
        const tail = ['bot', 'sessions']
        if (args.from) tail.push('--from', args.from)
        if (args.limit) tail.push('--limit', String(args.limit))
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_bot_runtimes_list',
      description: 'List configured LLM runtimes for the active bot. Read-only.',
      parameters: {
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['bot', 'runtimes', 'list']
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_bot_runtimes_discover',
      description: 'Discover available LLM runtimes for the active bot (may take a while).',
      timeoutMs: 120000,
      parameters: {
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['bot', 'runtimes', 'discover']
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })
  },
}
