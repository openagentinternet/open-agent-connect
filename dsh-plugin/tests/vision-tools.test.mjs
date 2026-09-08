import test from 'node:test'
import assert from 'node:assert/strict'
import { bindMediaDescriptionTools, buildMediaDescriptionToolDefinitions } from '../lib/vision-tools.js'

test('registers describe_image, describe_video, and describe_audio with IDBots-shaped inputs', async () => {
  const calls = []
  const defs = buildMediaDescriptionToolDefinitions({
    describeImage: async (input) => { calls.push(['image', input]); return 'image text' },
    describeVideo: async (input) => { calls.push(['video', input]); return 'video text' },
    describeAudio: async (input) => { calls.push(['audio', input]); return 'audio text' },
  })
  assert.deepEqual(defs.map((entry) => entry.name), ['describe_image', 'describe_video', 'describe_audio'])
  await defs[0].execute({ image_path: '/tmp/a.png', question: 'what?' }, {})
  await defs[1].execute({ video_path: '/tmp/a.mp4' }, {})
  await defs[2].execute({ audio: 'https://example.test/a.mp3' }, {})
  assert.deepEqual(calls, [
    ['image', { path: '/tmp/a.png', question: 'what?' }],
    ['video', { path: '/tmp/a.mp4', question: undefined }],
    ['audio', { source: 'https://example.test/a.mp3', prompt: undefined }],
  ])
})

test('rejects relative media paths', async () => {
  const defs = buildMediaDescriptionToolDefinitions({ describeImage: async () => '', describeVideo: async () => '', describeAudio: async () => '' })
  await assert.rejects(() => defs[0].execute({ image_path: 'relative.png' }, {}), /absolute local path/)
  await assert.rejects(() => defs[1].execute({ video_path: 'relative.mp4' }, {}), /absolute local path/)
  await assert.rejects(() => defs[2].execute({ audio: 'relative.mp3' }, {}), /absolute local path/)
})

test('bind survives a Cordis context that guards undeclared media services', () => {
  const registered = []
  const base = {
    get() { return undefined },
    tools: { register(definition) { registered.push(definition) } },
    logger: { warn() {} },
  }
  const ctx = new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'mediaDescription') throw new Error('cannot get property "mediaDescription" without inject')
      return Reflect.get(target, property, receiver)
    },
  })
  bindMediaDescriptionTools(ctx)
  assert.deepEqual(registered.map((entry) => entry.name), ['describe_image', 'describe_video', 'describe_audio'])
})
