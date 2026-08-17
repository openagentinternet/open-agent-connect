import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtempTempRootSync } from '../../tests/helpers/tempRoots.mjs'

const require = createRequire(import.meta.url)
const runner = require('../plugins/_runner.js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('parseCliResult parses a MetabotCommandResult JSON document', () => {
  const stdout = JSON.stringify({ ok: true, state: 'success', data: { version: '1.2.3' } }, null, 2)
  const result = runner.parseCliResult(stdout, '')
  assert.equal(result.ok, true)
  assert.equal(result.state, 'success')
  assert.equal(result.data.version, '1.2.3')
})

test('parseCliResult surfaces non-JSON stdout as a failed result', () => {
  const result = runner.parseCliResult('metabot 0.3.6\n', '')
  assert.equal(result.ok, false)
  assert.equal(result.state, 'failed')
  assert.equal(result.code, 'unparseable_output')
})

test('parseCliResult reports empty stdout with stderr detail', () => {
  const result = runner.parseCliResult('', 'some daemon warning')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'no_stdout')
  assert.match(result.message, /some daemon warning/)
})

test('compileParameters builds raw JSON schema with required fields', () => {
  const schema = runner.compileParameters({
    name: { type: 'string', required: true, description: 'The name.' },
    limit: { type: 'integer' },
  })
  assert.deepEqual(schema, {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name.' },
      limit: { type: 'integer' },
    },
    required: ['name'],
  })
})

test('validateRequiredArgs flags missing required fields only', () => {
  const spec = {
    a: { type: 'string', required: true },
    b: { type: 'string', required: true },
    c: { type: 'string' },
  }
  assert.deepEqual(runner.validateRequiredArgs({ a: 'x', c: 'y' }, spec), ['b is required'])
  assert.deepEqual(runner.validateRequiredArgs({ a: 'x', b: 'y' }, spec), [])
})

test('runMetabot spawns the CLI and parses its JSON result', async () => {
  const root = mkdtempTempRootSync('oac-test-')
  const cliPath = path.join(root, 'fake-cli.js')
  writeFileSync(cliPath, [
    'process.stdout.write(JSON.stringify({ ok: true, state: "success", data: { echoed: process.argv[2] } }, null, 2) + "\\n")',
  ].join('\n'))

  const outcome = await runner.runMetabot({ cliPath, nodePath: process.execPath }, ['hello'])
  assert.equal(outcome.error, undefined)
  assert.equal(outcome.exitCode, 0)
  assert.equal(outcome.result.data.echoed, 'hello')
})

test('runMetabot reports a failure when the CLI path is bogus', async () => {
  const outcome = await runner.runMetabot({ cliPath: '/nonexistent/main.js', nodePath: process.execPath }, [])
  const reported = outcome.error !== undefined
    || (outcome.result !== null && outcome.result.ok === false)
  assert.equal(reported, true)
})

test('runMetabot reports a kill/timeout when the CLI hangs', async () => {
  const root = mkdtempTempRootSync('oac-test-')
  const cliPath = path.join(root, 'hang-cli.js')
  writeFileSync(cliPath, 'setInterval(() => {}, 1000)\n')

  const outcome = await runner.runMetabot(
    { cliPath, nodePath: process.execPath },
    [],
    { timeoutMs: 200 },
  )
  assert.match(outcome.error ?? '', /killed|timed out|timeout/i)
})

test('withRequestFile writes a request file, runs the work, and cleans up', async () => {
  const seen = await runner.withRequestFile({ content: 'hi' }, async (filePath) => {
    const { readFileSync, existsSync } = await import('node:fs')
    assert.equal(existsSync(filePath), true)
    return JSON.parse(readFileSync(filePath, 'utf8'))
  })
  assert.deepEqual(seen, { content: 'hi' })
})

test('defineMetabotTool wires validation, async buildArgs, spawn, and rendering', async () => {
  const root = mkdtempTempRootSync('oac-test-')
  const cliPath = path.join(root, 'echo-cli.js')
  // Echoes the argv back inside the result so the test sees the built args.
  writeFileSync(cliPath, [
    'process.stdout.write(JSON.stringify({ ok: true, state: "success", data: { args: process.argv.slice(2) } }) + "\\n")',
  ].join('\n'))

  let registered
  const fakeTools = {
    register(definition) {
      registered = definition
      return () => {}
    },
  }
  const ctx = { get: (name) => (name === 'tools' ? fakeTools : undefined) }
  const registrar = runner.createRegistrar(ctx, { cliPath, nodePath: process.execPath })

  const tool = runner.defineMetabotTool(registrar, {
    name: 'fake_buzz_post',
    description: 'Fake.',
    parameters: {
      content: { type: 'string', required: true, description: 'Text.' },
      chain: { type: 'string', enum: ['mvc', 'btc'] },
    },
    buildArgs: (args) => runner.withRequestFile({ content: args.content }, (filePath) =>
      ['buzz', 'post', '--request-file', filePath]),
  })

  // Registration shape: plain-object ToolDefinition with an open output schema.
  assert.equal(registered.name, 'fake_buzz_post')
  assert.deepEqual(registered.output.schema, {})
  assert.deepEqual(registered.parameters.required, ['content'])

  // Required-arg validation throws before any spawn happens.
  await assert.rejects(() => tool.execute({}, {}), /content is required/)

  // A full call surfaces the normalized result (data + exitCode).
  const result = await tool.execute({ content: 'hello' }, {})
  assert.equal(result.ok, true)
  assert.equal(result.state, 'success')
  assert.equal(result.exitCode, 0)
  assert.equal(result.data.args[0], 'buzz')

  // The render callback produces a text block.
  const blocks = registered.output.render({ content: 'hello' }, result)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /metabot: success/)
})
