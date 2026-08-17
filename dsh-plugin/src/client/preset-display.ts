/**
 * Display copy for stock DSH presets. Built-in ids use the DSH-owned
 * `settings.agentPreset` dictionary (do not re-register that namespace).
 * User / OAC presets keep their own metadata.
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'

export type AgentPresetTranslate = TranslateNS<'settings.agentPreset'>

export type PresetDisplaySource = {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly name?: string
  readonly description?: string
}

export type PresetDisplayText = {
  readonly name: string
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: Parameters<AgentPresetTranslate>[0]
  readonly description: Parameters<AgentPresetTranslate>[0]
}

const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  code: { name: 'presetCodeName', description: 'presetCodeDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
}

export function presetDisplayText(
  preset: PresetDisplaySource,
  t: AgentPresetTranslate,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...(preset.description === undefined ? {} : { description: preset.description }),
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
