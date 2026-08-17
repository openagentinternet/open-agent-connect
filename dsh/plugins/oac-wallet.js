'use strict'

/**
 * OAC wallet tools: native wallet balances and transfers.
 * Wraps the `metabot wallet ...` CLI commands. Transfers require explicit
 * `confirm: true` — the CLI refuses otherwise.
 */

const { createRegistrar, defineMetabotTool } = require('./_runner.js')

module.exports = {
  name: 'oac-wallet',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_wallet_balance',
      description: 'Query the active bot native wallet balance on a chain. Read-only.',
      timeoutMs: 60000,
      parameters: {
        chain: {
          type: 'string',
          required: true,
          enum: ['mvc', 'btc', 'doge', 'opcat'],
          description: 'Chain to query.',
        },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['wallet', 'balance', '--chain', args.chain]
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_wallet_transfer',
      description: 'Send native coins from the active bot wallet to an address. Requires confirm: true to execute; set confirm: false to preview first.',
      timeoutMs: 120000,
      parameters: {
        toAddress: { type: 'string', required: true, description: 'Recipient address.' },
        amountRaw: { type: 'string', required: true, description: 'Amount in raw units (satoshis for BTC-like chains).' },
        confirm: { type: 'boolean', required: true, description: 'true executes the transfer; false returns a preview.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['wallet', 'transfer', '--to', args.toAddress, '--amount', args.amountRaw]
        if (args.confirm === true) tail.push('--confirm')
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })
  },
}
