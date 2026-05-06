export type PlatformId =
  | 'claude-code'
  | 'codex'
  | 'copilot'
  | 'opencode'
  | 'openclaw'
  | 'hermes'
  | 'gemini'
  | 'pi'
  | 'cursor'
  | 'kimi'
  | 'kiro';

export type PlatformExecutorKind =
  | 'claude-stream-json'
  | 'codex-app-server'
  | 'copilot-json'
  | 'opencode-json'
  | 'openclaw-json'
  | 'acp-hermes'
  | 'gemini-stream-json'
  | 'pi-json'
  | 'cursor-stream-json'
  | 'acp-kimi'
  | 'acp-kiro';

export interface PlatformDefinition {
  id: PlatformId;
  displayName: string;
  logoPath: string;
  runtime: {
    binaryNames: string[];
    versionArgs: string[];
    authEnv: string[];
    capabilities: string[];
  };
  skills: {
    roots: PlatformSkillRoot[];
  };
  executor: {
    kind: PlatformExecutorKind;
    backendFactoryExport: string;
    launchCommand: string;
    multicaReferencePath: string;
  };
}

export interface PlatformSkillRoot {
  id: string;
  kind: 'global' | 'project';
  homeEnv?: string;
  path: string;
  autoBind: 'always' | 'when-parent-exists' | 'manual';
  sharedStandard?: boolean;
}

export type InstallSkillRoot = PlatformSkillRoot & {
  platformId: PlatformId | 'shared-agents';
};

const DEFAULT_CAPABILITIES = ['tool-use'];

const sharedAgentsSkillRoot: InstallSkillRoot = {
  platformId: 'shared-agents',
  id: 'shared-agents',
  kind: 'global',
  path: '~/.agents/skills',
  autoBind: 'always',
  sharedStandard: true,
};

export const PLATFORM_DEFINITIONS: PlatformDefinition[] = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    logoPath: '/ui/assets/platforms/claude-code.svg',
    runtime: {
      binaryNames: ['claude'],
      versionArgs: ['--version'],
      authEnv: ['ANTHROPIC_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'claude-home', kind: 'global', homeEnv: 'CLAUDE_HOME', path: '~/.claude/skills', autoBind: 'when-parent-exists' },
        { id: 'claude-project', kind: 'project', path: '.claude/skills', autoBind: 'manual' },
      ],
    },
    executor: {
      kind: 'claude-stream-json',
      backendFactoryExport: 'claudeBackendFactory',
      launchCommand: 'claude -p --output-format stream-json',
      multicaReferencePath: 'agent/claude.go',
    },
  },
  {
    id: 'codex',
    displayName: 'Codex (OpenAI)',
    logoPath: '/ui/assets/platforms/codex.svg',
    runtime: {
      binaryNames: ['codex'],
      versionArgs: ['--version'],
      authEnv: ['OPENAI_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'codex-home', kind: 'global', homeEnv: 'CODEX_HOME', path: '~/.codex/skills', autoBind: 'when-parent-exists' },
        { id: 'codex-project', kind: 'project', path: '.codex/skills', autoBind: 'manual' },
      ],
    },
    executor: {
      kind: 'codex-app-server',
      backendFactoryExport: 'codexBackendFactory',
      launchCommand: 'codex app-server --listen stdio://',
      multicaReferencePath: 'agent/codex.go',
    },
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    logoPath: '/ui/assets/platforms/copilot.svg',
    runtime: {
      binaryNames: ['copilot'],
      versionArgs: ['--version'],
      authEnv: ['GITHUB_TOKEN', 'GH_TOKEN'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'copilot-home', kind: 'global', homeEnv: 'COPILOT_HOME', path: '~/.copilot/skills', autoBind: 'when-parent-exists' },
      ],
    },
    executor: {
      kind: 'copilot-json',
      backendFactoryExport: 'copilotBackendFactory',
      launchCommand: 'copilot -p <prompt> --output-format json --allow-all --no-ask-user',
      multicaReferencePath: 'agent/copilot.go',
    },
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    logoPath: '/ui/assets/platforms/opencode.svg',
    runtime: {
      binaryNames: ['opencode'],
      versionArgs: ['--version'],
      authEnv: ['OPENCODE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'opencode-config', kind: 'global', path: '~/.config/opencode/skills', autoBind: 'when-parent-exists' },
        { id: 'opencode-claude-compat', kind: 'global', path: '~/.claude/skills', autoBind: 'when-parent-exists' },
      ],
    },
    executor: {
      kind: 'opencode-json',
      backendFactoryExport: 'opencodeBackendFactory',
      launchCommand: 'opencode run --format json',
      multicaReferencePath: 'agent/opencode.go',
    },
  },
  {
    id: 'openclaw',
    displayName: 'OpenClaw',
    logoPath: '/ui/assets/platforms/openclaw.svg',
    runtime: {
      binaryNames: ['openclaw'],
      versionArgs: ['--version'],
      authEnv: ['OPENCLAW_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'openclaw-home', kind: 'global', homeEnv: 'OPENCLAW_HOME', path: '~/.openclaw/skills', autoBind: 'when-parent-exists' },
        { id: 'openclaw-project', kind: 'project', path: '.openclaw/skills', autoBind: 'manual' },
      ],
    },
    executor: {
      kind: 'openclaw-json',
      backendFactoryExport: 'openClawBackendFactory',
      launchCommand: 'openclaw agent --local --json --session-id <id> --message <prompt>',
      multicaReferencePath: 'agent/openclaw.go',
    },
  },
  {
    id: 'hermes',
    displayName: 'Hermes',
    logoPath: '/ui/assets/platforms/hermes.svg',
    runtime: {
      binaryNames: ['hermes'],
      versionArgs: ['--version'],
      authEnv: ['HERMES_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'hermes-home', kind: 'global', path: '~/.hermes/skills', autoBind: 'when-parent-exists' },
      ],
    },
    executor: {
      kind: 'acp-hermes',
      backendFactoryExport: 'hermesBackendFactory',
      launchCommand: 'hermes acp',
      multicaReferencePath: 'agent/hermes.go',
    },
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    logoPath: '/ui/assets/platforms/gemini.svg',
    runtime: {
      binaryNames: ['gemini'],
      versionArgs: ['--version'],
      authEnv: ['GEMINI_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'gemini-home', kind: 'global', path: '~/.gemini/skills', autoBind: 'when-parent-exists' },
        { id: 'gemini-project', kind: 'project', path: '.gemini/skills', autoBind: 'manual' },
      ],
    },
    executor: {
      kind: 'gemini-stream-json',
      backendFactoryExport: 'geminiBackendFactory',
      launchCommand: 'gemini -p <prompt> --yolo -o stream-json',
      multicaReferencePath: 'agent/gemini.go',
    },
  },
  {
    id: 'pi',
    displayName: 'Pi',
    logoPath: '/ui/assets/platforms/pi.svg',
    runtime: {
      binaryNames: ['pi'],
      versionArgs: ['--version'],
      authEnv: ['PI_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'pi-agent', kind: 'global', path: '~/.pi/agent/skills', autoBind: 'when-parent-exists' },
      ],
    },
    executor: {
      kind: 'pi-json',
      backendFactoryExport: 'piBackendFactory',
      launchCommand: 'pi -p --mode json --session <path>',
      multicaReferencePath: 'agent/pi.go',
    },
  },
  {
    id: 'cursor',
    displayName: 'Cursor Agent',
    logoPath: '/ui/assets/platforms/cursor.svg',
    runtime: {
      binaryNames: ['cursor-agent'],
      versionArgs: ['--version'],
      authEnv: ['CURSOR_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'cursor-home', kind: 'global', path: '~/.cursor/skills', autoBind: 'when-parent-exists' },
      ],
    },
    executor: {
      kind: 'cursor-stream-json',
      backendFactoryExport: 'cursorBackendFactory',
      launchCommand: 'cursor-agent chat -p <prompt> --output-format stream-json --yolo',
      multicaReferencePath: 'agent/cursor.go',
    },
  },
  {
    id: 'kimi',
    displayName: 'Kimi',
    logoPath: '/ui/assets/platforms/kimi.svg',
    runtime: {
      binaryNames: ['kimi'],
      versionArgs: ['--version'],
      authEnv: ['KIMI_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'kimi-home', kind: 'global', path: '~/.kimi/skills', autoBind: 'when-parent-exists' },
        { id: 'kimi-config-agents', kind: 'global', path: '~/.config/agents/skills', autoBind: 'when-parent-exists' },
      ],
    },
    executor: {
      kind: 'acp-kimi',
      backendFactoryExport: 'kimiBackendFactory',
      launchCommand: 'kimi acp',
      multicaReferencePath: 'agent/kimi.go',
    },
  },
  {
    id: 'kiro',
    displayName: 'Kiro CLI',
    logoPath: '/ui/assets/platforms/kiro.svg',
    runtime: {
      binaryNames: ['kiro-cli'],
      versionArgs: ['--version'],
      authEnv: ['KIRO_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'kiro-home', kind: 'global', path: '~/.kiro/skills', autoBind: 'when-parent-exists' },
      ],
    },
    executor: {
      kind: 'acp-kiro',
      backendFactoryExport: 'kiroBackendFactory',
      launchCommand: 'kiro-cli acp --trust-all-tools',
      multicaReferencePath: 'agent/kiro.go',
    },
  },
];

export const SUPPORTED_PLATFORM_IDS: PlatformId[] = PLATFORM_DEFINITIONS.map((platform) => platform.id);

export function getPlatformDefinition(id: PlatformId): PlatformDefinition {
  const definition = PLATFORM_DEFINITIONS.find((platform) => platform.id === id);
  if (!definition) {
    throw new Error(`Unsupported platform id: ${id}`);
  }
  return definition;
}

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === 'string' && SUPPORTED_PLATFORM_IDS.includes(value as PlatformId);
}

export function getRuntimePlatforms(): PlatformDefinition[] {
  return [...PLATFORM_DEFINITIONS];
}

export function getPlatformDisplayNames(): Record<string, string> {
  return Object.fromEntries(PLATFORM_DEFINITIONS.map((platform) => [platform.id, platform.displayName]));
}

export function getPlatformBinaryMap(): Record<string, string> {
  return Object.fromEntries(PLATFORM_DEFINITIONS.map((platform) => [platform.id, platform.runtime.binaryNames[0]]));
}

export function getPlatformSearchOrder(): PlatformId[] {
  return [...SUPPORTED_PLATFORM_IDS];
}

export function getPlatformSkillRoots(id: PlatformId): PlatformSkillRoot[] {
  return getPlatformDefinition(id).skills.roots.map((root) => ({ ...root }));
}

export function getProjectSkillRoot(id: PlatformId): PlatformSkillRoot | null {
  return getPlatformDefinition(id).skills.roots.find((root) => root.kind === 'project') ?? null;
}

export function getInstallSkillRoots(): InstallSkillRoot[] {
  const roots = PLATFORM_DEFINITIONS.flatMap((platform) =>
    platform.skills.roots
      .filter((root) => root.kind === 'global')
      .map((root) => ({ ...root, platformId: platform.id })),
  );
  return [sharedAgentsSkillRoot, ...roots];
}
