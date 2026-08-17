'use strict'

/**
 * OAC buzz tools: publish a simplebuzz post to MetaWeb.
 * Wraps the `metabot buzz post --request-file ...` CLI command; the plugin
 * builds the JSON request body from structured args.
 */

const { createRegistrar, defineMetabotTool, withRequestFile } = require('./_runner.js')

module.exports = {
  name: 'oac-buzz',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_buzz_post',
      description: 'Publish a simplebuzz post to MetaWeb (on-chain pin) from the active local MetaBot identity. Requires an identity (see metabot_identity_create).',
      parameters: {
        content: { type: 'string', required: true, description: 'Buzz post text content.' },
        attachments: {
          type: 'string',
          description: 'Optional JSON array of local file paths to upload and attach (e.g. ["/path/a.png"]).',
        },
        quotePin: { type: 'string', description: 'Optional pinId to quote in the post.' },
        network: {
          type: 'string',
          enum: ['mvc', 'btc', 'doge', 'opcat'],
          description: 'Write network (defaults to the configured write network).',
        },
        from: { type: 'string', description: 'Optional bot slug to post as (active profile is used otherwise).' },
      },
      buildArgs: (args) => {
        const payload = { content: args.content }
        if (args.attachments) {
          try {
            const parsed = JSON.parse(args.attachments)
            if (!Array.isArray(parsed)) throw new Error('not an array')
            payload.attachments = parsed
          } catch (error) {
            throw new Error(`invalid attachments JSON: ${error.message}`)
          }
        }
        if (args.quotePin) payload.quotePin = args.quotePin
        if (args.network) payload.network = args.network
        if (args.from) payload.from = args.from
        return withRequestFile(payload, (filePath) => {
          const tail = ['buzz', 'post', '--request-file', filePath]
          if (args.network) tail.push('--chain', args.network)
          if (args.from) tail.push('--from', args.from)
          return tail
        })
      },
    })
  },
}
