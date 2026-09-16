import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('agent-link enhancement never rewrites text inside editable surfaces', async () => {
  const src = await readFile(join(root, 'src/client/browser-links.ts'), 'utf8')
  // The DSH composer is a Lexical contenteditable: a foreign <a>/text-node
  // rewrite desyncs the editor's DOM reconciliation, which then destroys the
  // anchor AND the text around it — pasting "head <64-hex>i0 tail" into the
  // composer kept only "head ". Every text node under a contenteditable
  // region must be skipped, regardless of the attribute's value (chips inside
  // the composer carry contenteditable="false" and are editor-owned too).
  assert.match(src, /closest\('\[contenteditable\]'\) !== null\)/)
  // The fence must live in isSkippable, the gate every wrapped text node
  // passes through — not on some call sites only.
  const gate = src.slice(src.indexOf('function isSkippable'), src.indexOf('function setAgentHref'))
  assert.match(gate, /closest\('\[contenteditable\]'\)/)
  // The regression the fence exists for: bare pinIds stay linkifiable in
  // transcripts (messages are plain, non-editable DOM).
  assert.match(src, /\\b\[0-9a-f\]\{64\}i0\\b/)
})
