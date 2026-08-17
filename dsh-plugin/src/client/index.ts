/**
 * Browser half of open-agent-connect-dsh: locale dictionaries and the Bots
 * settings section (`oac-bots`). Conversations / Services / Apps sections
 * register in a later round. Does not shadow Settings → Agent presets.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { api } from './api.ts'
import { BotPanel } from './BotPanel.tsx'
import { en, NS, zh, type BotsLocaleKey } from './locale.ts'
import { BOTS_CSS } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.oac.bots': BotsLocaleKey
  }
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'open-agent-connect-dsh'
    tag.textContent = BOTS_CSS
    document.head.append(tag)
    return () => { tag.remove() }
  }, 'oac-dsh: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'oac-dsh: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'oac-bots',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({
      list: () => api.list(),
      create: (input: Parameters<typeof api.create>[0]) => api.create(input),
      update: (slug: string, patch: Record<string, unknown>) => api.update(slug, patch),
      remove: (slug: string) => api.remove(slug),
      llmDirectory: () => api.llmDirectory(),
    }),
  }, BotPanel))
}
