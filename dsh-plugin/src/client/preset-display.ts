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
  /** 0.1.6 directory presets carried a trust tier; the 0.1.7 registry roster drops it. */
  readonly trust?: 'system' | 'user'
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
  ptc: { name: 'presetPtcName', description: 'presetPtcDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
}

export function presetDisplayText(
  preset: PresetDisplaySource,
  t: AgentPresetTranslate,
): PresetDisplayText {
  // 0.1.7 roster rows carry no trust tier; the built-in ids still resolve
  // through the DSH-owned dictionary there, so only an explicit 'user' tier
  // (0.1.6) skips it.
  const keys = preset.trust === 'user' ? undefined : BUILT_IN_PRESET_KEYS[preset.id]
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...(preset.description === undefined ? {} : { description: preset.description }),
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
