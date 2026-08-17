'use strict'

/**
 * OAC identity tools: local MetaBot identity creation and inspection.
 * Wraps the `metabot identity ...` CLI commands.
 */

const { createRegistrar, defineMetabotTool } = require('./_runner.js')

module.exports = {
  name: 'oac-identity',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_identity_who',
      description: 'Show the active local MetaBot identity (globalMetaId, name, chat public key, address). Read-only.',
      parameters: {},
      buildArgs: () => ['identity', 'who'],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_identity_list',
      description: 'List every local MetaBot identity profile managed by this machine. Read-only.',
      parameters: {},
      buildArgs: () => ['identity', 'list'],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_identity_create',
      description: 'Create a new local MetaBot identity (bootstrap: mnemonic, subsidy request, chain sync). This is the first step before any MetaWeb write (buzz, chat, services, payments).',
      parameters: {
        name: { type: 'string', required: true, description: 'Desired bot name for the new identity.' },
        host: { type: 'string', description: 'Optional host platform hint (e.g. codex, claude-code).' },
      },
      buildArgs: (args) => {
        const tail = ['identity', 'create', '--name', args.name]
        if (args.host) tail.push('--host', args.host)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_identity_assign',
      description: 'Assign the active identity to an existing local profile (switch which profile is active).',
      parameters: {
        name: { type: 'string', required: true, description: 'Profile name to assign as active.' },
      },
      buildArgs: (args) => ['identity', 'assign', '--name', args.name],
    })
  },
}
