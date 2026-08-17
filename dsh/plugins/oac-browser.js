'use strict'

/**
 * OAC Agent Internet Browser tools: open the local Browser, open deep-link
 * URIs, and resolve URIs to clickable URLs.
 * Wraps the `metabot browser ...` CLI commands.
 */

const { createRegistrar, defineMetabotTool } = require('./_runner.js')

module.exports = {
  name: 'oac-browser',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_browser_open',
      description: 'Open the local Agent Internet Browser (Bot Browser), optionally at a deep-link URI (metaid://, metaapp://, metafile://, pin:// or a bot domain).',
      parameters: {
        uri: { type: 'string', description: 'Optional deep-link URI to open.' },
      },
      buildArgs: (args) => {
        const tail = ['browser', 'open']
        if (args.uri) tail.push('--uri', args.uri)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_browser_tab',
      description: 'Open a deep-link URI in a new tab of the local Agent Internet Browser.',
      parameters: {
        uri: { type: 'string', required: true, description: 'Deep-link URI to open (metaid://, metaapp://, metafile://, pin://, domain).' },
      },
      buildArgs: (args) => ['browser', 'tab', 'open', '--uri', args.uri],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_browser_link',
      description: 'Resolve a deep-link URI into its clickable local Browser http URL. Read-only.',
      parameters: {
        uri: { type: 'string', required: true, description: 'Deep-link URI to resolve.' },
      },
      buildArgs: (args) => ['browser', 'link', '--uri', args.uri],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_ui_open',
      description: 'Open a local MetaBot inspection UI page (hub, buzz, chat, services, trace, my-services, refund, metaapps, ...).',
      parameters: {
        page: {
          type: 'string',
          required: true,
          enum: ['hub', 'bot', 'conversations', 'services', 'apps', 'settings', 'buzz', 'chat', 'publish', 'my-services', 'trace', 'refund', 'metaapps'],
          description: 'UI page to open.',
        },
        from: { type: 'string', description: 'Optional bot slug.' },
        traceId: { type: 'string', description: 'Optional trace id context.' },
        sessionId: { type: 'string', description: 'Optional session id context.' },
        serviceId: { type: 'string', description: 'Optional service id context.' },
      },
      buildArgs: (args) => {
        const tail = ['ui', 'open', '--page', args.page]
        if (args.from) tail.push('--from', args.from)
        if (args.traceId) tail.push('--trace-id', args.traceId)
        if (args.sessionId) tail.push('--session-id', args.sessionId)
        if (args.serviceId) tail.push('--service-id', args.serviceId)
        return tail
      },
    })
  },
}
