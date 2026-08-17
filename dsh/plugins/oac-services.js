'use strict'

/**
 * OAC remote skill-service tools: delegation, owned services, orders, refunds,
 * and T-stage rating. Wraps the `metabot services ...` and `metabot provider
 * ...` CLI commands.
 */

const { createRegistrar, defineMetabotTool, withRequestFile } = require('./_runner.js')

module.exports = {
  name: 'oac-services',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_services_call',
      description: 'Delegate a task to an online skill-service (A2A delegation). Returns a trace; when the result is `waiting`, poll with metabot_trace_get. Discover candidates first with metabot_network_services.',
      timeoutMs: 180000,
      parameters: {
        userTask: { type: 'string', required: true, description: 'The task description sent to the service.' },
        servicePinId: { type: 'string', description: 'Exact service pinId from metabot_network_services; required when the cache cannot auto-match.' },
        providerGlobalMetaId: { type: 'string', description: 'Provider bot globalMetaId from metabot_network_services.' },
        confirmed: { type: 'boolean', description: 'Pre-confirm the paid order (otherwise confirmation is requested first).' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const payload = { userTask: args.userTask }
        if (args.servicePinId) payload.servicePinId = args.servicePinId
        if (args.providerGlobalMetaId) payload.providerGlobalMetaId = args.providerGlobalMetaId
        if (args.confirmed === true) payload.confirmed = true
        if (args.from) payload.from = args.from
        return withRequestFile(payload, (filePath) => {
          const tail = ['services', 'call', '--request-file', filePath]
          if (args.from) tail.push('--from', args.from)
          return tail
        })
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_services_rate',
      description: 'Publish a T-stage rating (1-5) with a comment for a completed service trace. Requires traceId from the call result.',
      parameters: {
        traceId: { type: 'string', required: true, description: 'Trace id of the completed service call.' },
        rate: { type: 'integer', required: true, description: 'Rating score, 1-5.' },
        comment: { type: 'string', required: true, description: 'Rating comment.' },
        network: {
          type: 'string',
          enum: ['mvc', 'btc', 'doge', 'opcat'],
          description: 'Write network.',
        },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const payload = {
          traceId: args.traceId,
          rate: Number(args.rate),
          comment: args.comment,
        }
        if (args.network) payload.network = args.network
        if (args.from) payload.from = args.from
        return withRequestFile(payload, (filePath) => {
          const tail = ['services', 'rate', '--request-file', filePath]
          if (args.network) tail.push('--chain', args.network)
          if (args.from) tail.push('--from', args.from)
          return tail
        })
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_services_owned_list',
      description: 'List services the active bot owns/publishes. Read-only.',
      parameters: {
        all: { type: 'boolean', description: 'List all pages instead of the first page.' },
        page: { type: 'integer', description: 'Page number (default 1).' },
        pageSize: { type: 'integer', description: 'Page size (default 20).' },
        refresh: { type: 'boolean', description: 'Refresh from the chain first.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['services', 'owned', 'list']
        if (args.all) tail.push('--all')
        if (args.page) tail.push('--page', String(args.page))
        if (args.pageSize) tail.push('--page-size', String(args.pageSize))
        if (args.refresh) tail.push('--refresh')
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_services_owned_orders',
      description: 'List orders of one service the active bot owns. Read-only.',
      parameters: {
        serviceId: { type: 'string', required: true, description: 'Service id (from metabot_services_owned_list).' },
        all: { type: 'boolean', description: 'List all pages.' },
        page: { type: 'integer', description: 'Page number.' },
        pageSize: { type: 'integer', description: 'Page size.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['services', 'owned', 'orders', '--service-id', args.serviceId]
        if (args.all) tail.push('--all')
        if (args.page) tail.push('--page', String(args.page))
        if (args.pageSize) tail.push('--page-size', String(args.pageSize))
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_services_publish',
      description: 'Publish one skill as a paid service to the chain-backed service directory (provider side). Fields follow the CLI request shape.',
      timeoutMs: 180000,
      parameters: {
        serviceName: { type: 'string', required: true, description: 'Stable service id, e.g. weather-service.' },
        displayName: { type: 'string', description: 'Human display name.' },
        description: { type: 'string', description: 'One-line service description.' },
        providerSkill: { type: 'string', description: 'Skill the service executes (see metabot_services_publish_skills).' },
        price: { type: 'string', description: 'Per-call price, e.g. 0.00005.' },
        currency: { type: 'string', description: 'Currency code, e.g. SPACE.' },
        outputType: { type: 'string', enum: ['text', 'json', 'file'], description: 'Result type.' },
        skillDocument: { type: 'string', description: 'Markdown skill contract published with the service.' },
        network: {
          type: 'string',
          enum: ['mvc', 'btc', 'doge', 'opcat'],
          description: 'Write network.',
        },
        from: { type: 'string', description: 'Provider bot slug.' },
      },
      buildArgs: (args) => {
        const payload = { serviceName: args.serviceName }
        for (const key of ['displayName', 'description', 'providerSkill', 'price', 'currency', 'outputType', 'skillDocument']) {
          if (args[key] !== undefined) payload[key] = args[key]
        }
        if (args.network) payload.network = args.network
        if (args.from) payload.from = args.from
        return withRequestFile(payload, (filePath) => {
          const tail = ['services', 'publish', '--payload-file', filePath]
          if (args.network) tail.push('--chain', args.network)
          if (args.from) tail.push('--from', args.from)
          return tail
        })
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_services_owned_revoke',
      description: 'Revoke one service the active bot owns (stops accepting new orders).',
      parameters: {
        serviceId: { type: 'string', required: true, description: 'Service id to revoke.' },
        network: {
          type: 'string',
          enum: ['mvc', 'btc', 'doge', 'opcat'],
          description: 'Write network.',
        },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['services', 'owned', 'revoke', '--service-id', args.serviceId]
        if (args.network) tail.push('--chain', args.network)
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_services_publish_skills',
      description: 'List skills the active bot can publish as a paid skill-service. Read-only.',
      parameters: {
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['services', 'publish-skills']
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_services_refunds_list',
      description: 'List refund records (initiated/received) for the active bot. Read-only.',
      parameters: {
        kind: {
          type: 'string',
          enum: ['all', 'initiated', 'received'],
          description: 'Refund kind filter (default all).',
        },
        all: { type: 'boolean', description: 'Include both directions.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['services', 'refunds', 'list']
        if (args.kind) tail.push('--kind', args.kind)
        if (args.all) tail.push('--all')
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_services_orders_inspect',
      description: 'Inspect one order by orderId or paymentTxid. Read-only.',
      parameters: {
        orderId: { type: 'string', description: 'Order id.' },
        paymentTxid: { type: 'string', description: 'Payment transaction id.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['services', 'orders', 'inspect']
        if (args.orderId) tail.push('--order-id', args.orderId)
        if (args.paymentTxid) tail.push('--payment-txid', args.paymentTxid)
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_provider_order_inspect',
      description: 'Provider-side order inspection (the active bot as service provider). Read-only.',
      parameters: {
        orderId: { type: 'string', description: 'Order id.' },
        paymentTxid: { type: 'string', description: 'Payment transaction id.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['provider', 'order', 'inspect']
        if (args.orderId) tail.push('--order-id', args.orderId)
        if (args.paymentTxid) tail.push('--payment-txid', args.paymentTxid)
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_provider_refund_settle',
      description: 'Provider-side refund settlement for one order.',
      parameters: {
        orderId: { type: 'string', description: 'Order id.' },
        paymentTxid: { type: 'string', description: 'Payment transaction id.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['provider', 'refund', 'settle']
        if (args.orderId) tail.push('--order-id', args.orderId)
        if (args.paymentTxid) tail.push('--payment-txid', args.paymentTxid)
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })
  },
}
