/**
 * MarkdownText chrome labels drawn from the shared common vocabulary. The
 * result must stay reference-stable per component (a new identity drops the
 * renderer's caches), so memoize it at the call site.
 */
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'

type MarkdownLabelKeys = 'copy' | 'copied' | 'markdown.footnotes'

export function markdownLabels(t: (key: MarkdownLabelKeys) => string): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }
}
