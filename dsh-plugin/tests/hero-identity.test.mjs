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

test('hero identity mount climbs past slot wrappers to a span-validated headline', async () => {
  const mount = await readFile(join(root, 'src/client/hero-identity.ts'), 'utf8')
  assert.match(mount, /\[data-phase="hero"\]/)
  assert.match(mount, /\[data-composer-seat\]/)
  // The whale svg is slot output too: it sits inside span.fishHitbox >
  // div[data-slot="conversation.hero.brand.mark"], so the climb must skip
  // slot anchors AND prove the target is the wide headline (wrappers hug
  // content at 34px; only the headline spans the hero column).
  assert.match(mount, /querySelector\('svg'\)/)
  assert.match(mount, /dataset\.slot === undefined/)
  assert.match(mount, /dataset\.chainOverlayFallback === undefined/)
  assert.match(mount, /getBoundingClientRect\(\)\.width >= columnWidth \/ 2/)
  // 0.1.5-rc regression: while the whale is briefly absent (multi-pass hero
  // commits) the first seat svg is the workspace folder / an input icon, and
  // a bare width climb anchored the block on those persistent rows — the
  // avatar then stuck above the input box after the first message. Only a
  // row the brand svg reaches through a DIRECT span child (the fish hitbox)
  // may anchor.
  assert.match(mount, /spansBrandMark/)
  assert.match(mount, /HTMLSpanElement/)
  // Duplicate-proof: orphaned hosts (stale client instance, exception-
  // stranded node) are swept before every attach.
  assert.match(mount, /querySelectorAll\('\[data-oac-hero-identity\]'\)/)
  assert.match(mount, /stray\.remove\(\)/)
  // Self-healing: a connected host must still sit directly above the live
  // headline, or it releases and re-anchors.
  assert.match(mount, /nextElementSibling === headline/)
  // Exception-safe release: a throwing unmount must not strand the host.
  assert.match(mount, /finally \{/)
  // Positional walks and bare ancestor matches each shipped a wrong spot —
  // they must not come back.
  assert.doesNotMatch(mount, /firstElementChild/)
  assert.doesNotMatch(mount, /closest\('div'\)/)
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
