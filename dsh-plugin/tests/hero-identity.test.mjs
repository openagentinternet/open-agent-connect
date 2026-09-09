import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = await import('../lib/index.js')

test('heroIdentityFor resolves the selected oac-* Bot with a trimmed name and avatar', () => {
  const botsBySlug = { alice: { name: '  Alice  ', avatarDataUrl: ' data:image/png;base64,AA ' } }
  assert.deepEqual(
    plugin.heroIdentityFor({ current: 'oac-alice', botsBySlug }),
    { slug: 'alice', name: 'Alice', avatarDataUrl: 'data:image/png;base64,AA' },
  )
})

test('heroIdentityFor omits a blank avatar instead of shipping whitespace', () => {
  const botsBySlug = { alice: { name: 'Alice', avatarDataUrl: '   ' } }
  assert.deepEqual(
    plugin.heroIdentityFor({ current: 'oac-alice', botsBySlug }),
    { slug: 'alice', name: 'Alice' },
  )
})

test('heroIdentityFor keeps the stock hero for stock presets, unknown slugs, and blank names', () => {
  const botsBySlug = { alice: { name: 'Alice' }, mute: { name: '   ' } }
  assert.equal(plugin.heroIdentityFor({ current: 'standard', botsBySlug }), undefined)
  assert.equal(plugin.heroIdentityFor({ current: '', botsBySlug }), undefined)
  assert.equal(plugin.heroIdentityFor({ current: 'oac-ghost', botsBySlug }), undefined)
  assert.equal(plugin.heroIdentityFor({ current: 'oac-alice', botsBySlug: {} }), undefined)
  assert.equal(plugin.heroIdentityFor({ current: 'oac-mute', botsBySlug }), undefined)
})

test('hero identity mount anchors on content (the whale svg), never positional walks', async () => {
  const mount = await readFile(join(root, 'src/client/hero-identity.ts'), 'utf8')
  assert.match(mount, /\[data-phase="hero"\]/)
  assert.match(mount, /\[data-composer-seat\]/)
  // The headline is found as the nearest div ancestor of the whale-logo svg —
  // immune to the renderer's display:contents slot/chain wrapper layers.
  assert.match(mount, /querySelector\('svg'\)/)
  assert.match(mount, /whale\.closest\('div'\)/)
  // Positional walks off the composer seat landed wrong twice (chip row,
  // HeroShell root) — they must not come back.
  assert.doesNotMatch(mount, /firstElementChild/)
  assert.doesNotMatch(mount, /querySelector\('\[class/)
  // Inserts directly above the headline row, and releases itself when the
  // hero unmounts (blank → active flip).
  assert.match(mount, /headline\.before\(host\)/)
  assert.match(mount, /isConnected/)
  assert.match(mount, /unmount/)
})

test('client wires the hero identity mount beside the preset chip and ships its CSS', async () => {
  const text = await readFile(join(root, 'src/client/index.ts'), 'utf8')
  assert.match(text, /startHeroIdentityMount\(seat\.store\)/)
  assert.match(text, /'oac-dsh: hero bot identity'/)
  assert.match(text, /BOTS_CSS \+ PRESETS_CSS \+ HERO_CSS/)
})

test('hero identity block sizes the avatar at 100px with a matched name', async () => {
  const styles = await readFile(join(root, 'src/client/styles.ts'), 'utf8')
  assert.match(styles, /\.oac-bot-avatar\.oac-hero-identity-avatar \{[^}]*width: 100px;[^}]*height: 100px/)
  assert.match(styles, /\.oac-hero-identity-name \{[^}]*font-size: 20px/)
})
