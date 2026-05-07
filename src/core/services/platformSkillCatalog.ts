import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  getPlatformDefinition,
  getPlatformSkillRoots,
  isPlatformId,
  resolvePlatformSkillRootPath,
  type PlatformDefinition,
  type PlatformId,
  type PlatformSkillRoot,
} from '../platform/platformRegistry';
import type { LlmBinding } from '../llm/llmTypes';
import type { LlmBindingStore } from '../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../llm/llmRuntimeStore';
import type { LlmRuntime } from '../llm/llmTypes';

export type PlatformSkillRootStatus = 'readable' | 'missing' | 'unreadable';

export interface PlatformSkillRootDiagnostic {
  rootId: string;
  kind: PlatformSkillRoot['kind'];
  absolutePath: string;
  status: PlatformSkillRootStatus;
  message?: string;
}

export interface PlatformSkillCatalogEntry {
  skillName: string;
  title?: string;
  description?: string;
  platformId: PlatformId;
  platformDisplayName: string;
  rootId: string;
  rootKind: PlatformSkillRoot['kind'];
  absolutePath: string;
  skillDocumentPath: string;
}

export interface PrimaryRuntimeSkillCatalogSuccess {
  ok: true;
  metaBotSlug: string;
  runtime: LlmRuntime;
  binding: LlmBinding;
  platform: Pick<PlatformDefinition, 'id' | 'displayName' | 'logoPath'>;
  skills: PlatformSkillCatalogEntry[];
  rootDiagnostics: PlatformSkillRootDiagnostic[];
}

export interface PrimaryRuntimeSkillCatalogFailure {
  ok: false;
  code:
    | 'primary_runtime_missing'
    | 'primary_runtime_unavailable'
    | 'primary_runtime_provider_unsupported';
  message: string;
  metaBotSlug: string;
  runtime?: LlmRuntime;
  binding?: LlmBinding;
  rootDiagnostics: PlatformSkillRootDiagnostic[];
}

export type PrimaryRuntimeSkillCatalogResult =
  | PrimaryRuntimeSkillCatalogSuccess
  | PrimaryRuntimeSkillCatalogFailure;

export interface PlatformSkillCatalog {
  listPrimaryRuntimeSkills(input: { metaBotSlug: string }): Promise<PrimaryRuntimeSkillCatalogResult>;
}

export interface CreatePlatformSkillCatalogOptions {
  runtimeStore: LlmRuntimeStore;
  bindingStore: LlmBindingStore;
  systemHomeDir: string;
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isSafeProviderSkillName(value: unknown): boolean {
  const skillName = normalizeText(value);
  if (!skillName) {
    return false;
  }
  if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
    return false;
  }
  return path.basename(skillName) === skillName;
}

function selectPrimaryBinding(bindings: LlmBinding[], metaBotSlug: string): LlmBinding | null {
  const candidates = bindings
    .filter((binding) => (
      binding.metaBotSlug === metaBotSlug
      && binding.role === 'primary'
      && binding.enabled
    ))
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt.localeCompare(left.updatedAt);
      }
      return left.id.localeCompare(right.id);
    });
  return candidates[0] ?? null;
}

function resolveCatalogRoot(input: {
  root: PlatformSkillRoot;
  systemHomeDir: string;
  projectRoot: string;
  env: NodeJS.ProcessEnv;
}): string {
  if (input.root.kind === 'project') {
    return path.resolve(input.projectRoot, input.root.path);
  }
  return resolvePlatformSkillRootPath(input.root, input.systemHomeDir, input.env);
}

function parseFrontMatterMetadata(body: string): { title?: string; description?: string } {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith('---')) {
    const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return heading ? { title: heading } : {};
  }

  const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const metadata: { title?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'title' || key === 'name') {
      metadata.title = value || metadata.title;
    }
    if (key === 'description') {
      metadata.description = value;
    }
  }
  return metadata;
}

async function readSkillMetadata(skillDocumentPath: string): Promise<{ title?: string; description?: string }> {
  try {
    return parseFrontMatterMetadata(await fs.readFile(skillDocumentPath, 'utf8'));
  } catch {
    return {};
  }
}

async function scanRoot(input: {
  platform: PlatformDefinition;
  root: PlatformSkillRoot;
  absolutePath: string;
}): Promise<{
  diagnostic: PlatformSkillRootDiagnostic;
  skills: PlatformSkillCatalogEntry[];
}> {
  let entries;
  try {
    entries = await fs.readdir(input.absolutePath, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      diagnostic: {
        rootId: input.root.id,
        kind: input.root.kind,
        absolutePath: input.absolutePath,
        status: code === 'ENOENT' ? 'missing' : 'unreadable',
        message: error instanceof Error ? error.message : String(error),
      },
      skills: [],
    };
  }

  const skills: PlatformSkillCatalogEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeProviderSkillName(entry.name)) {
      continue;
    }

    const absolutePath = path.join(input.absolutePath, entry.name);
    const skillDocumentPath = path.join(absolutePath, 'SKILL.md');
    try {
      const stat = await fs.stat(skillDocumentPath);
      if (!stat.isFile()) {
        continue;
      }
    } catch {
      continue;
    }

    const metadata = await readSkillMetadata(skillDocumentPath);
    skills.push({
      skillName: entry.name,
      title: metadata.title,
      description: metadata.description,
      platformId: input.platform.id,
      platformDisplayName: input.platform.displayName,
      rootId: input.root.id,
      rootKind: input.root.kind,
      absolutePath,
      skillDocumentPath,
    });
  }

  return {
    diagnostic: {
      rootId: input.root.id,
      kind: input.root.kind,
      absolutePath: input.absolutePath,
      status: 'readable',
    },
    skills,
  };
}

export function createPlatformSkillCatalog(options: CreatePlatformSkillCatalogOptions): PlatformSkillCatalog {
  const env = options.env ?? process.env;

  return {
    async listPrimaryRuntimeSkills(input) {
      const metaBotSlug = normalizeText(input.metaBotSlug);
      const [runtimeState, bindingState] = await Promise.all([
        options.runtimeStore.read(),
        options.bindingStore.read(),
      ]);
      const binding = selectPrimaryBinding(bindingState.bindings, metaBotSlug);
      if (!binding) {
        return {
          ok: false,
          code: 'primary_runtime_missing',
          message: 'The selected MetaBot has no enabled primary runtime binding.',
          metaBotSlug,
          rootDiagnostics: [],
        };
      }

      const runtime = runtimeState.runtimes.find((entry) => entry.id === binding.llmRuntimeId);
      if (!runtime) {
        return {
          ok: false,
          code: 'primary_runtime_missing',
          message: 'The selected MetaBot primary runtime binding points to a missing runtime.',
          metaBotSlug,
          binding,
          rootDiagnostics: [],
        };
      }

      if (runtime.health === 'unavailable') {
        return {
          ok: false,
          code: 'primary_runtime_unavailable',
          message: 'The selected MetaBot primary runtime is unavailable.',
          metaBotSlug,
          runtime,
          binding,
          rootDiagnostics: [],
        };
      }

      if (!isPlatformId(runtime.provider)) {
        return {
          ok: false,
          code: 'primary_runtime_provider_unsupported',
          message: 'The selected MetaBot primary runtime provider is not supported by the platform skill registry.',
          metaBotSlug,
          runtime,
          binding,
          rootDiagnostics: [],
        };
      }

      if (runtime.health !== 'healthy') {
        return {
          ok: false,
          code: 'primary_runtime_unavailable',
          message: 'The selected MetaBot primary runtime is not healthy.',
          metaBotSlug,
          runtime,
          binding,
          rootDiagnostics: [],
        };
      }

      if (!normalizeText(runtime.binaryPath)) {
        return {
          ok: false,
          code: 'primary_runtime_unavailable',
          message: 'The selected MetaBot primary runtime has no binary path.',
          metaBotSlug,
          runtime,
          binding,
          rootDiagnostics: [],
        };
      }

      const platform = getPlatformDefinition(runtime.provider);
      const roots = getPlatformSkillRoots(platform.id);
      const rootResults = await Promise.all(roots.map(async (root) => scanRoot({
        platform,
        root,
        absolutePath: resolveCatalogRoot({
          root,
          systemHomeDir: options.systemHomeDir,
          projectRoot: options.projectRoot,
          env,
        }),
      })));

      const byName = new Map<string, PlatformSkillCatalogEntry>();
      for (const result of rootResults) {
        for (const skill of result.skills) {
          if (!byName.has(skill.skillName)) {
            byName.set(skill.skillName, skill);
          }
        }
      }

      return {
        ok: true,
        metaBotSlug,
        runtime,
        binding,
        platform: {
          id: platform.id,
          displayName: platform.displayName,
          logoPath: platform.logoPath,
        },
        skills: [...byName.values()].sort((left, right) => left.skillName.localeCompare(right.skillName)),
        rootDiagnostics: rootResults.map((result) => result.diagnostic),
      };
    },
  };
}
