'use strict'

/**
 * OAC file tools: upload a local file to MetaWeb as a metafile.
 * Wraps the `metabot file upload / upload-large ...` CLI commands. The plugin
 * always passes an absolute file path in the request body.
 */

const { createRegistrar, defineMetabotTool, withRequestFile } = require('./_runner.js')

module.exports = {
  name: 'oac-files',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_file_upload',
      description: 'Upload a local file to MetaWeb and return its metafile URI / preview URL. Requires an identity.',
      timeoutMs: 300000,
      parameters: {
        filePath: { type: 'string', required: true, description: 'Absolute path of the local file to upload.' },
        chain: {
          type: 'string',
          enum: ['mvc', 'btc', 'opcat'],
          description: 'Upload chain (DOGE is not supported for uploads).',
        },
        verify: { type: 'boolean', description: 'Verify the upload after completing.' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const payload = { filePath: args.filePath }
        if (args.chain) payload.network = args.chain
        if (args.from) payload.from = args.from
        return withRequestFile(payload, (filePath) => {
          const tail = ['file', 'upload', '--request-file', filePath]
          if (args.chain) tail.push('--chain', args.chain)
          if (args.verify) tail.push('--verify')
          if (args.from) tail.push('--from', args.from)
          return tail
        })
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_file_upload_large',
      description: 'Upload a large local file to MetaWeb (chunked large-file upload) and return its metafile URI. Requires an identity.',
      timeoutMs: 600000,
      parameters: {
        filePath: { type: 'string', required: true, description: 'Absolute path of the local file to upload.' },
        contentType: { type: 'string', description: 'Content type override (auto-detected otherwise).' },
        chain: {
          type: 'string',
          enum: ['mvc', 'btc', 'opcat'],
          description: 'Upload chain (DOGE is not supported for uploads).',
        },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const payload = { filePath: args.filePath }
        if (args.contentType) payload.contentType = args.contentType
        if (args.chain) payload.network = args.chain
        if (args.from) payload.from = args.from
        return withRequestFile(payload, (filePath) => {
          const tail = ['file', 'upload-large', '--request-file', filePath]
          if (args.chain) tail.push('--chain', args.chain)
          if (args.from) tail.push('--from', args.from)
          return tail
        })
      },
    })
  },
}
