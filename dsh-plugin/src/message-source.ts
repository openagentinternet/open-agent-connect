/**
 * Producer identity for plugin-injected user messages. DSH 0.1.7 (session
 * format v4) retired the `{ kind: 'plugin', plugin: '<name>' }` wrapper:
 * durable messages now require a producer-owned source kind, and the v3→v4
 * migrator rewrites our v3 wrapper to `plugin:oac-dsh`. Emit that same kind
 * natively on v4 hosts so new and migrated messages carry one identity;
 * ≤0.1.6 kernels keep the v3 wrapper (their native write path admits it,
 * while the v2→v3 migration admission rejects kinds outside its fixed
 * vocabulary, so the wrapper must stay on the old lines).
 *
 * The host generation is fixed for the process lifetime: apply() flips the
 * flag once, before any message is built. The default is the v3 wrapper so
 * tests and partial boots behave like the old kernels.
 */
import type { HostUserMessage } from './context-types.js'

let v4Host = false

/**
 * Called once from apply(). The 0.1.7 agent-preset registry trait stands in
 * for the session-format generation (both land with the 0.1.7 kernel).
 */
export function configureMessageSources(hostRequiresProducerKind: boolean): void {
  v4Host = hostRequiresProducerKind
}

/** Source record for one plugin-injected user message, shaped for the host's session format. */
export function oacMessageSource(form: string): HostUserMessage['source'] {
  return v4Host
    ? { kind: 'plugin:oac-dsh', form }
    : { kind: 'plugin', plugin: 'oac-dsh', form }
}
