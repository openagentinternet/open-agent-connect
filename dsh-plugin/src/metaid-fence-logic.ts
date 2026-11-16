/**
 * `metaid` fence parsing (chat code-block rendering by language, DSH rc.2+).
 *
 * DSH 0.2.2 routes every Markdown fence in the Chat flow that carries a
 * language through the session-scoped `conversation.chat.markdown.fence`
 * hoc slot, keyed by the lowercased language; a registered layer may
 * replace the plain code block (omit `children`) or decorate it (render
 * `children`). This parser gives the plugin's `metaid` layer its payload:
 * a fence that names at least one MetaID-network URI renders as a resource
 * card; anything else falls back to the plain code block.
 *
 * Fence shape (each nonblank line is one of):
 * - `title: …` / `note: …` — card metadata (first one wins).
 * - a line containing a `metaid://`-family URI — a resource row (mirrors
 *   the browser-links bare-URI scheme families, so the card opens exactly
 *   what the link interceptor would).
 * Anything else is ignored: a fence is explicit author intent, and the
 * fallback keeps unparseable content readable as code.
 */

export interface MetaidFenceContent {
  title?: string
  note?: string
  uris: string[]
}

/**
 * URI schemes the card treats as MetaID-network resources. Kept in sync
 * with BARE_URI_RE in client/browser-links.ts (without the bare i0 id
 * branch — a bare txid has no canonical scheme to open). Global so every
 * URI on one line becomes a row.
 */
const METAID_URI_RE = /(?:metaid|metaapp|map|metafile|pin|pinid|preview-metaapp):\/\/[A-Za-z0-9][A-Za-z0-9._~%/@-]*/gi

const FIELD_LINE_RE = /^(title|note)\s*:\s*(.*)$/i

/**
 * Parse a fence body into card content.
 * @param code - the fence's raw text.
 * @param meta - the info string after the language tag, if any; a nonblank
 *   one seeds the title (an explicit `title:` line still wins).
 * @returns the content, or null when no URI was found (render the plain
 *   code block instead).
 */
export function parseMetaidFence(code: string, meta?: string | undefined): MetaidFenceContent | null {
  const content: MetaidFenceContent = { uris: [] }
  let titleFromLine: string | undefined
  let noteFromLine: string | undefined
  if (meta !== undefined && meta.trim() !== '') content.title = meta.trim()
  for (const rawLine of code.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    const field = FIELD_LINE_RE.exec(line)
    if (field !== null) {
      const value = field[2].trim()
      if (value === '') continue
      if (field[1].toLowerCase() === 'title') titleFromLine ??= value
      else noteFromLine ??= value
      continue
    }
    // String.match with a global regex returns every URI on the line (and
    // ignores lastIndex, unlike exec).
    for (const match of line.match(METAID_URI_RE) ?? []) {
      // The scheme charset includes '.', so sentence punctuation after a URI
      // rides along — strip trailing dots (a URI never ends in one).
      content.uris.push(match.replace(/\.+$/, ''))
    }
  }
  if (titleFromLine !== undefined) content.title = titleFromLine
  if (noteFromLine !== undefined) content.note = noteFromLine
  return content.uris.length === 0 ? null : content
}
