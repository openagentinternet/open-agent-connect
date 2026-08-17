'use strict'

/**
 * OAC network discovery tools: online bots and services on MetaWeb.
 * Wraps the `metabot network ...` CLI commands.
 */

const { createRegistrar, defineMetabotTool } = require('./_runner.js')

module.exports = {
  name: 'oac-network',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_network_bots',
      description: 'Discover online MetaBots/agents on MetaWeb (bot directory). Returns bot globalMetaId, name, goal and last-seen info. Read-only.',
      parameters: {
        online: { type: 'boolean', description: 'Only include currently online bots (defaults to online when set).' },
        limit: { type: 'integer', description: 'Max results (1-100).' },
      },
      buildArgs: (args) => {
        const tail = ['network', 'bots']
        if (args.online) tail.push('--online')
        if (args.limit) tail.push('--limit', String(args.limit))
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_network_services',
      description: 'Discover online skill-services on MetaWeb (service directory). Returns service name, provider, price and last-seen info. Read-only. Use this before metabot_services_call to pick a servicePinId and providerGlobalMetaId.',
      parameters: {
        online: { type: 'boolean', description: 'Only include currently online services.' },
        cached: { type: 'boolean', description: 'Use the local cached service list instead of refreshing from the chain.' },
        query: { type: 'string', description: 'Keyword filter on service name/description.' },
        limit: { type: 'integer', description: 'Max results (1-100).' },
      },
      buildArgs: (args) => {
        const tail = ['network', 'services']
        if (args.online) tail.push('--online')
        if (args.cached) tail.push('--cached')
        if (args.query) tail.push('--query', args.query)
        if (args.limit) tail.push('--limit', String(args.limit))
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_network_sources_list',
      description: 'List the local network sources (registry endpoints) this bot syncs discovery data from. Read-only.',
      parameters: {},
      buildArgs: () => ['network', 'sources', 'list'],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_network_sources_add',
      description: 'Add a local network source endpoint to the discovery registry.',
      parameters: {
        baseUrl: { type: 'string', required: true, description: 'Source base URL.' },
        label: { type: 'string', description: 'Optional human label.' },
      },
      buildArgs: (args) => {
        const tail = ['network', 'sources', 'add', '--base-url', args.baseUrl]
        if (args.label) tail.push('--label', args.label)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_network_sources_remove',
      description: 'Remove a local network source endpoint from the discovery registry.',
      parameters: {
        baseUrl: { type: 'string', required: true, description: 'Source base URL to remove.' },
      },
      buildArgs: (args) => ['network', 'sources', 'remove', '--base-url', args.baseUrl],
    })
  },
}
