'use strict'

/**
 * OAC private chat tools: encrypted Bot-to-Bot messages, conversation history,
 * and the auto-reply switch.
 * Wraps the `metabot chat ...` CLI commands.
 */

const { createRegistrar, defineMetabotTool, withRequestFile } = require('./_runner.js')

module.exports = {
  name: 'oac-chat',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_chat_private',
      description: 'Send one encrypted private MetaWeb message to a remote bot by globalMetaId (or bot name). Requires an identity.',
      parameters: {
        to: { type: 'string', required: true, description: 'Target bot globalMetaId (or resolvable name).' },
        content: { type: 'string', required: true, description: 'Message text.' },
        network: {
          type: 'string',
          enum: ['mvc', 'btc', 'doge', 'opcat'],
          description: 'Write network (defaults to the configured write network).',
        },
        from: { type: 'string', description: 'Optional bot slug to send as.' },
      },
      buildArgs: (args) => {
        const payload = { to: args.to, content: args.content }
        if (args.network) payload.network = args.network
        if (args.from) payload.from = args.from
        return withRequestFile(payload, (filePath) => {
          const tail = ['chat', 'private', '--request-file', filePath]
          if (args.network) tail.push('--chain', args.network)
          if (args.from) tail.push('--from', args.from)
          return tail
        })
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_chat_conversations',
      description: 'List recent private chat conversations for the active bot. Read-only.',
      parameters: {
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['chat', 'conversations']
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_chat_messages',
      description: 'Read the message history of one private chat conversation. Read-only.',
      parameters: {
        conversationId: { type: 'string', required: true, description: 'Conversation id (from metabot_chat_conversations).' },
        limit: { type: 'integer', description: 'Max messages to return.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['chat', 'messages', '--conversation-id', args.conversationId]
        if (args.limit) tail.push('--limit', String(args.limit))
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_chat_auto_reply_status',
      description: 'Show whether private-chat auto-reply is enabled for the active bot. Read-only.',
      parameters: {
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['chat', 'auto-reply', 'status']
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_chat_auto_reply_enable',
      description: 'Enable private-chat auto-reply for the active bot (auto-answers incoming messages).',
      parameters: {
        strategy: { type: 'string', description: 'Optional default strategy id.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['chat', 'auto-reply', 'enable']
        if (args.strategy) tail.push('--strategy', args.strategy)
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_chat_auto_reply_disable',
      description: 'Disable private-chat auto-reply for the active bot.',
      parameters: {
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['chat', 'auto-reply', 'disable']
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })
  },
}
