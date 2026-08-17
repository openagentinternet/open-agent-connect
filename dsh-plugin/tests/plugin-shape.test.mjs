import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const plugin = await import('../lib/index.js')

test('host export has the namespace-plugin shape (no stray default)', () => {
  assert.equal('default' in plugin, false)
  assert.equal(plugin.name, 'oac-dsh')
  assert.deepEqual(plugin.inject, ['webServer', 'webRuntime', 'agentPresets', 'llm'])
  assert.equal(typeof plugin.apply, 'function')
})

test('Loader.unwrapExports keeps name/inject/apply when there is no default', async () => {
  const { default: Loader } = await importLoader()
  const loader = Object.create(Loader.prototype)
  const unwrapped = loader.unwrapExports(plugin)
  assert.equal(unwrapped, plugin)
  assert.equal(unwrapped.name, 'oac-dsh')
  assert.equal(typeof unwrapped.apply, 'function')
})

/**
 * Optional: use the same Loader.unwrapExports guard better-sidebar ships.
 * If @cordisjs/plugin-loader is not installed, fall back to the documented
 * unwrap (a stray default-only module would drop name/inject).
 */
async function importLoader() {
  try {
    return await import('@cordisjs/plugin-loader')
  } catch {
    return {
      default: class {
        unwrapExports(module) {
          if (module && typeof module === 'object' && 'default' in module) {
            const keys = Object.keys(module)
            if (keys.length === 1) return module.default
          }
          return module
        }
      },
    }
  }
}

test('parseMetabotStdout reads pretty-printed MetabotCommandResult', () => {
  const raw = JSON.stringify({ ok: true, state: 'success', data: { slug: 'alice' } }, null, 2)
  const result = plugin.parseMetabotStdout(raw)
  assert.equal(result.ok, true)
  assert.equal(result.state, 'success')
  assert.equal(result.data.slug, 'alice')
})

test('parseMetabotStdout reads a failed envelope', () => {
  const result = plugin.parseMetabotStdout(
    JSON.stringify({ ok: false, state: 'failed', code: 'not_found', message: 'no identity' }),
  )
  assert.equal(result.ok, false)
  assert.equal(result.state, 'failed')
  assert.equal(result.code, 'not_found')
})

test('parseMetabotStdout rejects non-envelope JSON', () => {
  assert.throws(() => plugin.parseMetabotStdout('{"hello":true}'), /MetabotCommandResult/)
})

test('isSupportedNodeVersion matches OAC engines >=20 <25', () => {
  assert.equal(plugin.isSupportedNodeVersion('v20.19.0'), true)
  assert.equal(plugin.isSupportedNodeVersion('v24.13.1'), true)
  assert.equal(plugin.isSupportedNodeVersion('v19.9.0'), false)
  assert.equal(plugin.isSupportedNodeVersion('v25.0.0'), false)
  assert.equal(plugin.isSupportedNodeVersion('v26.7.0'), false)
})

test('resolveMetabotCliPath honors OAC_METABOT_CLI_PATH', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-cli-'))
  const fake = join(dir, 'main.js')
  await writeFile(fake, 'export {}\n')
  const resolved = plugin.resolveMetabotCliPath({ OAC_METABOT_CLI_PATH: fake })
  assert.equal(resolved, fake)
})

test('runMetabot parses stdout from a fake CLI entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oac-dsh-run-'))
  const fake = join(dir, 'metabot.js')
  await writeFile(fake, [
    'const args = process.argv.slice(2)',
    'process.stdout.write(JSON.stringify({ ok: true, state: "success", data: { args } }, null, 2) + "\\n")',
    '',
  ].join('\n'))
  const result = await plugin.runMetabot(['identity', 'who'], {
    resolution: {
      cliPath: fake,
      oacPath: null,
      nodePath: process.execPath,
      nodeVersion: process.version,
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.state, 'success')
  assert.deepEqual(result.data.args, ['identity', 'who'])
})

test('isTrustedApiRequest allows loopback and refuses cross-site', () => {
  assert.equal(
    plugin.isTrustedApiRequest({ headers: { host: '127.0.0.1:8787' } }, []),
    true,
  )
  assert.equal(
    plugin.isTrustedApiRequest(
      { headers: { host: '127.0.0.1:8787', 'sec-fetch-site': 'cross-site' } },
      [],
    ),
    false,
  )
  assert.equal(
    plugin.isTrustedApiRequest({ headers: { host: 'evil.example:443' } }, []),
    false,
  )
  assert.equal(
    plugin.isTrustedApiRequest({ headers: { host: 'office.example:443' } }, ['office.example:443']),
    true,
  )
})

test('apply registers /oac/api and fences untrusted requests', async () => {
  const routes = []
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(fn) {
      fn()
    },
  }
  await plugin.apply(ctx, { skipBootstrap: true })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/oac/api')
  assert.equal(routes[0].kind, 'prefix')

  const forbidden = capture()
  await routes[0].handler(
    request('POST', '/oac/api/health', { host: 'evil.example' }),
    forbidden.res,
  )
  assert.equal(forbidden.status, 403)

  const health = capture()
  await routes[0].handler(
    request('GET', '/oac/api/health', { host: '127.0.0.1:8787' }),
    health.res,
  )
  assert.equal(health.status, 200)
  const body = JSON.parse(health.body)
  assert.equal(body.ok, false)
  assert.equal(body.error, 'bootstrap skipped')
  assert.equal(body.cliPath, null)
})

test('bootstrapHealth records CLI/daemon/bind failures without throwing', async () => {
  const health = await plugin.bootstrapHealth(
    {},
    async (args) => {
      if (args[0] === 'daemon') {
        return { ok: true, state: 'success', data: { running: true } }
      }
      return { ok: false, state: 'failed', code: 'bind_failed', message: 'no dsh home' }
    },
    () => ({
      cliPath: '/tmp/metabot.js',
      oacPath: null,
      nodePath: '/tmp/node',
      nodeVersion: 'v24.13.1',
    }),
  )
  assert.equal(health.ok, false)
  assert.equal(health.cliPath, '/tmp/metabot.js')
  assert.equal(health.daemon.ok, true)
  assert.equal(health.skillBind.ok, false)
  assert.match(health.error, /skillBind/)
})

function request(method, url, headers) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {},
  }
}

function capture() {
  const box = { status: 0, body: '', res: null }
  box.res = {
    statusCode: 0,
    writeHead(status) {
      box.status = status
    },
    end(body) {
      box.body = body === undefined ? '' : String(body)
    },
  }
  return box
}
