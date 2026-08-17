import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface DshLlmBinding {
  dshLlmProvider?: string | null;
  dshLlmModel?: string | null;
  dshLlmFallbackProvider?: string | null;
  dshLlmFallbackModel?: string | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeOptionalDshLlmId(value: unknown): string | null {
  if (value === null) return null;
  const normalized = normalizeText(value);
  return normalized || null;
}

export function normalizeDshLlmBinding(value: unknown): DshLlmBinding {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    dshLlmProvider: normalizeOptionalDshLlmId(record.dshLlmProvider),
    dshLlmModel: normalizeOptionalDshLlmId(record.dshLlmModel),
    dshLlmFallbackProvider: normalizeOptionalDshLlmId(record.dshLlmFallbackProvider),
    dshLlmFallbackModel: normalizeOptionalDshLlmId(record.dshLlmFallbackModel),
  };
}

function hasAnyDshLlmValue(binding: DshLlmBinding): boolean {
  return Boolean(
    binding.dshLlmProvider
    || binding.dshLlmModel
    || binding.dshLlmFallbackProvider
    || binding.dshLlmFallbackModel,
  );
}

export async function readDshLlmBinding(filePath: string): Promise<DshLlmBinding> {
  try {
    return normalizeDshLlmBinding(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        dshLlmProvider: null,
        dshLlmModel: null,
        dshLlmFallbackProvider: null,
        dshLlmFallbackModel: null,
      };
    }
    throw error;
  }
}

export async function writeDshLlmBinding(filePath: string, binding: DshLlmBinding): Promise<void> {
  const next = normalizeDshLlmBinding(binding);
  if (!hasAnyDshLlmValue(next)) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify({
    ...next,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
}

export function mergeDshLlmBinding(
  current: DshLlmBinding,
  patch: DshLlmBinding,
): DshLlmBinding {
  return {
    dshLlmProvider: patch.dshLlmProvider !== undefined ? patch.dshLlmProvider : (current.dshLlmProvider ?? null),
    dshLlmModel: patch.dshLlmModel !== undefined ? patch.dshLlmModel : (current.dshLlmModel ?? null),
    dshLlmFallbackProvider: patch.dshLlmFallbackProvider !== undefined
      ? patch.dshLlmFallbackProvider
      : (current.dshLlmFallbackProvider ?? null),
    dshLlmFallbackModel: patch.dshLlmFallbackModel !== undefined
      ? patch.dshLlmFallbackModel
      : (current.dshLlmFallbackModel ?? null),
  };
}
