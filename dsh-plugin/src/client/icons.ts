/**
 * Icon compatibility layer across the DSH 0.1.6 → 0.1.7 rename.
 *
 * 0.1.7 replaced the pixel-size suffixes (`IconSendOutline14`) with stroke
 * weights (`IconSendOutlineRegular` / `Medium`), rebuilt the artwork from
 * filled paths to strokes on a 16px grid, and moved the default `size` to 14
 * for every icon. The primitives package is an external resolved from the
 * host's module table at runtime, so a single plugin build serves both kernel
 * lines: look the modern name up first, fall back to the legacy one, and
 * restore the legacy default pixel size the surrounding CSS was tuned to.
 */
import { createElement, type ComponentType } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

export interface CompatIconProps {
  size?: number
  className?: string
}

type IconComponent = ComponentType<CompatIconProps>

const table = primitives as unknown as Record<string, IconComponent | undefined>

function compatIcon(legacyName: string, modernName: string, legacySize: number): IconComponent {
  const found = table[modernName] ?? table[legacyName]
  if (found === undefined) {
    throw new Error(`oac-dsh: host provides neither "${modernName}" nor "${legacyName}"`)
  }
  const Compat = ({ size = legacySize, ...rest }: CompatIconProps) => createElement(found, { size, ...rest })
  Compat.displayName = legacyName
  return Compat
}

export const IconAgentPresetOutline16 = compatIcon('IconAgentPresetOutline16', 'IconAgentPresetOutlineRegular', 16)
export const IconArchiveOutline20 = compatIcon('IconArchiveOutline20', 'IconArchiveOutlineRegular', 20)
export const IconBranchOutline16 = compatIcon('IconBranchOutline16', 'IconBranchOutlineRegular', 16)
export const IconBrowseOutline16 = compatIcon('IconBrowseOutline16', 'IconBrowseOutlineRegular', 16)
export const IconCheckOutline16 = compatIcon('IconCheckOutline16', 'IconCheckOutlineRegular', 16)
export const IconChevronDownOutline14 = compatIcon('IconChevronDownOutline14', 'IconChevronDownOutlineRegular', 14)
export const IconChevronLeftOutline14 = compatIcon('IconChevronLeftOutline14', 'IconChevronLeftOutlineRegular', 14)
export const IconChevronRightOutline14 = compatIcon('IconChevronRightOutline14', 'IconChevronRightOutlineRegular', 14)
export const IconCloseOutline16 = compatIcon('IconCloseOutline16', 'IconCloseOutlineRegular', 16)
export const IconCopyOutline16 = compatIcon('IconCopyOutline16', 'IconCopyOutlineRegular', 16)
export const IconDownloadOutline16 = compatIcon('IconDownloadOutline16', 'IconDownloadOutlineRegular', 16)
export const IconEditOutline16 = compatIcon('IconEditOutline16', 'IconEditOutlineRegular', 16)
export const IconEllipsisOutline16 = compatIcon('IconEllipsisOutline16', 'IconEllipsisOutlineRegular', 16)
export const IconLoadingOutline16 = compatIcon('IconLoadingOutline16', 'IconLoadingOutlineRegular', 16)
export const IconNewChatOutline16 = compatIcon('IconNewChatOutline16', 'IconNewChatOutlineRegular', 16)
export const IconPanelLeftOutline16 = compatIcon('IconPanelLeftOutline16', 'IconPanelLeftOutlineRegular', 16)
export const IconPlayOutline16 = compatIcon('IconPlayOutline16', 'IconPlayOutlineRegular', 16)
export const IconPlusOutline16 = compatIcon('IconPlusOutline16', 'IconPlusOutlineRegular', 16)
export const IconQuestionOutline14 = compatIcon('IconQuestionOutline14', 'IconQuestionOutlineRegular', 14)
export const IconRefreshOutline16 = compatIcon('IconRefreshOutline16', 'IconRefreshOutlineRegular', 16)
export const IconRightUpOutline16 = compatIcon('IconRightUpOutline16', 'IconRightUpOutlineRegular', 16)
export const IconSendOutline14 = compatIcon('IconSendOutline14', 'IconSendOutlineRegular', 14)
export const IconShareOutline16 = compatIcon('IconShareOutline16', 'IconShareOutlineRegular', 16)
export const IconSparkle16 = compatIcon('IconSparkle16', 'IconSparkleRegular', 16)
export const IconTrashOutline16 = compatIcon('IconTrashOutline16', 'IconTrashOutlineRegular', 16)
export const IconUserOutline16 = compatIcon('IconUserOutline16', 'IconUserOutlineRegular', 16)
export const IconWarningOutline16 = compatIcon('IconWarningOutline16', 'IconWarningOutlineRegular', 16)
