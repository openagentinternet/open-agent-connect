/**
 * Symlink-aware containment check shared with the OAC core gate
 * (core/files/chainUploadGate). Thin in-process re-export so the plugin
 * side does not duplicate the realpath logic.
 */
import { core } from './local-read.js'

type GateModule = {
  isPathInsideDir(filePath: string, dir: string): boolean
}

let cached: GateModule | undefined

export function isPathInsideDir(filePath: string, dir: string): boolean {
  cached ??= core('core/files/chainUploadGate.js') as GateModule
  return cached.isPathInsideDir(filePath, dir)
}
