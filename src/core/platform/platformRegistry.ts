import path from 'node:path';

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
  | 'kiro'
  | 'codebuddy'
  | 'zcode'
  | 'workbuddy'
  | 'dsh';

export type RuntimePlatformId = PlatformId;

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
  | 'acp-kiro'
  | 'codebuddy-stream-json'
  | 'zcode-json';

export interface PlatformDefinition {
  id: PlatformId;
  displayName: string;
  logoPath: string;
  runtime?: {
    binaryNames: string[];
    versionArgs: string[];
    authEnv: string[];
    capabilities: string[];
    envAliases?: string[];
    pathSearchBinaryNames?: string[];
    defaultExecutablePaths?: string[];
    /**
     * Minimum CLI version a discovered binary must report. A parsed version
     * below this floor marks the runtime unavailable with an upgrade hint
     * (readiness is not attempted); an unparsable or missing version fails
     * open and the runtime is treated exactly as before.
     */
    minimumCliVersion?: string;
    /** Minimum Node.js version for CLIs launched through a Node shebang. */
    nodeRuntime?: {
      minimumVersion: string;
    };
    /**
     * Optional probe timing policy. App-embedded CLIs start slowly, so they
     * get wider windows. Missing fields fall back to the discovery defaults
     * (readiness 30s, version probe 5s, semantic inactivity min(readiness, 15s)).
     */
    probeHints?: {
      readinessTimeoutMs?: number;
      versionProbeTimeoutMs?: number;
      semanticInactivityTimeoutMs?: number;
      /**
       * Readiness probes run a real one-shot CLI turn. CLIs that record every
       * thread in a user-visible session history get their state home
       * redirected to an ephemeral directory during the probe (the paths in
       * `seedPaths` are copied in from the real home), so synthetic probe
       * turns never surface in the user's conversation history.
       */
      probeHome?: {
        /** Env var the CLI honors as its state-home directory override. */
        envName: string;
        /** State-home source when the env var is unset; relative to the user's home. */
        defaultSourceHome?: string;
        /** Files or directories copied from the source home into the ephemeral home before the probe. */
        seedPaths?: string[];
      };
    };
    /**
     * State-home policy for managed (bot-driven) executions. Bot turns run
     * unattended, and CLIs that record every thread in a user-visible session
     * history (the Kimi Code desktop sidebar, `claude --resume`, Codex
     * session list, ...) would otherwise flood the user's local conversation
     * list with one session per bot turn. When declared, the LLM executor
     * points `envName` at a persistent per-machine home under the executor
     * root (`LLM/executor/provider-homes/<provider>`) and seeds it with
     * links/copies of the auth and config entries in `seedPaths`, so managed
     * sessions stay out of the user's platform UI while credentials and
     * settings keep tracking the real home. Skipped when the request resumes
     * a caller-owned session or already sets the env var itself.
     */
    executionHome?: {
      /** Env var the CLI honors as its state-home directory override. */
      envName: string;
      /** State-home source when the env var is unset; relative to the user's home. */
      defaultSourceHome?: string;
      /** Files or directories linked (or copied) from the source home into the execution home. */
      seedPaths?: string[];
    };
  };
  skills: {
    roots: PlatformSkillRoot[];
  };
  executor?: {
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
  /**
   * Optional Windows-specific skill root path, used only on win32. POSIX-style
   * (forward slashes, `~/`-prefixed) so it can be resolved against %APPDATA% or
   * %LOCALAPPDATA%. When omitted, `path` is used on all platforms.
   */
  windowsPath?: string;
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

/** The ~/.agents/skills shared standard root (DSH sessions load it natively). */
export function getSharedAgentsSkillRoot(): PlatformSkillRoot {
  const { platformId: _platformId, ...root } = sharedAgentsSkillRoot;
  return { ...root };
}

const metabotSharedSkillRoot: InstallSkillRoot = {
  platformId: 'shared-agents',
  id: 'metabot-shared',
  kind: 'global',
  path: '~/.metabot/skills',
  autoBind: 'manual',
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
      // The stdin stream-json prompt channel and --disallowedTools need the 2.x
      // CLI line (floor mirrors multica's MinVersions).
      minimumCliVersion: '2.0.0',
      probeHints: {
        readinessTimeoutMs: 45_000,
        semanticInactivityTimeoutMs: 45_000,
        probeHome: {
          envName: 'CLAUDE_CONFIG_DIR',
          defaultSourceHome: '.claude',
          seedPaths: ['.credentials.json', 'settings.json'],
        },
      },
      // Claude Code records every thread under $CLAUDE_CONFIG_DIR/projects and
      // lists them in its session picker; managed executions redirect the
      // config dir so bot turns stay out of it.
      executionHome: {
        envName: 'CLAUDE_CONFIG_DIR',
        defaultSourceHome: '.claude',
        seedPaths: ['.credentials.json', 'settings.json', 'CLAUDE.md', 'skills', 'agents', 'commands'],
      },
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
      launchCommand: 'claude -p --output-format stream-json --input-format stream-json',
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
      // `codex app-server --listen stdio://` landed in 0.100.0.
      minimumCliVersion: '0.100.0',
      probeHints: {
        readinessTimeoutMs: 45_000,
        semanticInactivityTimeoutMs: 45_000,
        probeHome: {
          envName: 'CODEX_HOME',
          defaultSourceHome: '.codex',
          seedPaths: ['auth.json', 'config.toml'],
        },
      },
      // Codex stores rollout sessions under $CODEX_HOME/sessions; managed
      // executions redirect CODEX_HOME so bot turns stay out of the user's
      // session history.
      executionHome: {
        envName: 'CODEX_HOME',
        defaultSourceHome: '.codex',
        seedPaths: ['auth.json', 'config.toml'],
      },
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
      minimumCliVersion: '1.0.0',
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
      // Older OpenCode builds grow unbounded logs and fill the host disk
      // (multica #8392); 1.1.54 is the fixed line.
      minimumCliVersion: '1.1.54',
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
      launchCommand: 'opencode run --format json --dangerously-skip-permissions --dir <cwd>',
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
      minimumCliVersion: '2026.5.5',
      nodeRuntime: { minimumVersion: '22.14.0' },
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
      authEnv: ['GEMINI_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA'],
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
      // App-bundled CLI: cold start is slow, so both probes get wider windows.
      probeHints: { readinessTimeoutMs: 45_000, versionProbeTimeoutMs: 20_000, semanticInactivityTimeoutMs: 45_000 },
    },
    skills: {
      roots: [
        { id: 'cursor-home', kind: 'global', path: '~/.cursor/skills', autoBind: 'when-parent-exists' },
      ],
    },
    executor: {
      kind: 'cursor-stream-json',
      backendFactoryExport: 'cursorBackendFactory',
      launchCommand: 'cursor-agent agent --print --output-format json --force --trust <prompt>',
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
      probeHints: {
        // Kimi Code keeps sessions under $HOME/.kimi-code and lists them in
        // its session picker; a redirected HOME (seeded with auth/config)
        // keeps probe turns out of that list.
        probeHome: {
          envName: 'HOME',
          seedPaths: [
            '.kimi-code/config.toml',
            '.kimi-code/credentials',
            '.kimi-code/oauth',
            '.kimi-code/device_id',
            '.kimi-code/region',
            '.kimi-code/server.token',
          ],
        },
      },
      // Kimi Code resolves its data dir as $KIMI_CODE_HOME (falling back to
      // ~/.kimi-code) and the desktop app lists every session stored there.
      // Managed executions redirect KIMI_CODE_HOME only (HOME stays intact so
      // shell tools keep working), seeded with the user's auth, config, MCP,
      // plugin, skill, and workspace-trust entries for behavior parity.
      executionHome: {
        envName: 'KIMI_CODE_HOME',
        defaultSourceHome: '.kimi-code',
        seedPaths: [
          'config.toml',
          'credentials',
          'oauth',
          'device_id',
          'region',
          'server.token',
          'mcp.json',
          'plugins',
          'skills',
          'workspace-trust',
        ],
      },
    },
    skills: {
      roots: [
        { id: 'kimi-home', kind: 'global', path: '~/.kimi/skills', autoBind: 'when-parent-exists' },
        { id: 'kimi-config-agents', kind: 'global', path: '~/.config/agents/skills', autoBind: 'when-parent-exists' },
        {
          id: 'kimi-work-desktop',
          kind: 'global',
          path: '~/Library/Application Support/kimi-desktop/daimon-share/daimon/skills',
          windowsPath: '~/AppData/Roaming/kimi-desktop/daimon-share/daimon/skills',
          autoBind: 'when-parent-exists',
        },
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
  {
    id: 'codebuddy',
    displayName: 'CodeBuddy',
    logoPath: '/ui/assets/platforms/codebuddy.svg',
    runtime: {
      binaryNames: ['codebuddy'],
      versionArgs: ['--version'],
      authEnv: ['CODEBUDDY_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
    },
    skills: {
      roots: [
        { id: 'codebuddy-home', kind: 'global', path: '~/.codebuddy/skills', autoBind: 'when-parent-exists' },
        { id: 'codebuddy-project', kind: 'project', path: '.codebuddy/skills', autoBind: 'manual' },
      ],
    },
    executor: {
      kind: 'codebuddy-stream-json',
      backendFactoryExport: 'codeBuddyBackendFactory',
      launchCommand: 'codebuddy -p --output-format stream-json --input-format stream-json --permission-mode bypassPermissions',
      multicaReferencePath: 'agent/codebuddy.go',
    },
  },
  {
    id: 'zcode',
    displayName: 'ZCode',
    logoPath: '/ui/assets/platforms/zcode.svg',
    runtime: {
      binaryNames: ['zcode'],
      versionArgs: ['--version'],
      authEnv: ['ZCODE_API_KEY', 'Z_AI_API_KEY', 'ZAI_API_KEY', 'BIGMODEL_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
      defaultExecutablePaths: ['/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'],
      nodeRuntime: { minimumVersion: '22.5.0' },
      probeHints: {
        readinessTimeoutMs: 45_000,
        semanticInactivityTimeoutMs: 45_000,
        // ZCode stores rollout/session files under $HOME/.zcode; a redirected
        // HOME (seeded with the CLI configs) keeps probe turns out of them.
        probeHome: {
          envName: 'HOME',
          seedPaths: ['.zcode/v2/config.json', '.zcode/cli/config.json'],
        },
      },
    },
    skills: {
      roots: [
        { id: 'zcode-home', kind: 'global', path: '~/.zcode/skills', autoBind: 'when-parent-exists' },
        { id: 'zcode-project', kind: 'project', path: '.zcode/skills', autoBind: 'manual' },
      ],
    },
    executor: {
      kind: 'zcode-json',
      backendFactoryExport: 'zcodeBackendFactory',
      launchCommand: 'zcode --prompt <prompt> --json --mode yolo --no-browser',
      multicaReferencePath: 'agent/zcode.go',
    },
  },
  {
    id: 'workbuddy',
    displayName: 'WorkBuddy',
    logoPath: '/ui/assets/platforms/codebuddy.svg',
    runtime: {
      binaryNames: ['codebuddy', 'cbc'],
      versionArgs: ['--version'],
      authEnv: ['WORKBUDDY_API_KEY'],
      capabilities: DEFAULT_CAPABILITIES,
      envAliases: [],
      pathSearchBinaryNames: [],
      defaultExecutablePaths: ['/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy'],
      // App-bundled CLI: cold start is slow, so both probes get wider windows.
      probeHints: { readinessTimeoutMs: 45_000, versionProbeTimeoutMs: 20_000, semanticInactivityTimeoutMs: 45_000 },
    },
    skills: {
      roots: [
        { id: 'workbuddy-home', kind: 'global', path: '~/.workbuddy/skills', autoBind: 'when-parent-exists' },
        { id: 'workbuddy-codebuddy-home', kind: 'global', path: '~/.codebuddy/skills', autoBind: 'when-parent-exists' },
        { id: 'workbuddy-project', kind: 'project', path: '.workbuddy/skills', autoBind: 'manual' },
        { id: 'workbuddy-codebuddy-project', kind: 'project', path: '.codebuddy/skills', autoBind: 'manual' },
      ],
    },
    executor: {
      kind: 'codebuddy-stream-json',
      backendFactoryExport: 'codeBuddyBackendFactory',
      launchCommand: 'codebuddy -p --output-format stream-json --input-format stream-json --permission-mode bypassPermissions',
      multicaReferencePath: 'agent/codebuddy.go',
    },
  },
  {
    id: 'dsh',
    displayName: 'DeepSeek Harness',
    logoPath: '/ui/assets/platforms/dsh.svg',
    skills: {
      roots: [
        { id: 'dsh-home', kind: 'global', homeEnv: 'DSH_HOME', path: '~/.dsh/skills', autoBind: 'when-parent-exists' },
        { id: 'dsh-project', kind: 'project', path: '.dsh/skills', autoBind: 'manual' },
      ],
    },
  },
];

export const SUPPORTED_PLATFORM_IDS: PlatformId[] = PLATFORM_DEFINITIONS.map((platform) => platform.id);
export const RUNTIME_PLATFORM_IDS: RuntimePlatformId[] = PLATFORM_DEFINITIONS
  .filter((platform): platform is PlatformDefinition & {
    id: RuntimePlatformId;
    runtime: NonNullable<PlatformDefinition['runtime']>;
    executor: NonNullable<PlatformDefinition['executor']>;
  } => Boolean(platform.runtime && platform.executor))
  .map((platform) => platform.id);

export function getPlatformDefinition(id: PlatformId): PlatformDefinition {
  const definition = PLATFORM_DEFINITIONS.find((platform) => platform.id === id);
  if (!definition) {
    throw new Error(`Unsupported platform id: ${id}`);
  }
  return definition;
}

export function getRuntimePlatformDefinition(id: RuntimePlatformId): RuntimePlatformDefinition {
  const definition = getPlatformDefinition(id);
  if (!definition.runtime || !definition.executor) {
    throw new Error(`Platform id is not a managed runtime provider: ${id}`);
  }
  return definition as RuntimePlatformDefinition;
}

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === 'string' && SUPPORTED_PLATFORM_IDS.includes(value as PlatformId);
}

export function isRuntimePlatformId(value: unknown): value is RuntimePlatformId {
  return typeof value === 'string' && RUNTIME_PLATFORM_IDS.includes(value as RuntimePlatformId);
}

export type RuntimePlatformDefinition = PlatformDefinition & {
  id: RuntimePlatformId;
  runtime: NonNullable<PlatformDefinition['runtime']>;
  executor: NonNullable<PlatformDefinition['executor']>;
};

export function getRuntimePlatforms(): RuntimePlatformDefinition[] {
  return PLATFORM_DEFINITIONS.filter((platform): platform is RuntimePlatformDefinition =>
    Boolean(platform.runtime && platform.executor),
  );
}

export function getPlatformDisplayNames(): Record<string, string> {
  return Object.fromEntries(getRuntimePlatforms().map((platform) => [platform.id, platform.displayName]));
}

export function getPlatformBinaryMap(): Record<string, string> {
  return Object.fromEntries(getRuntimePlatforms().map((platform) => [platform.id, platform.runtime.binaryNames[0]]));
}

export function getPlatformSearchOrder(): RuntimePlatformId[] {
  return [...RUNTIME_PLATFORM_IDS];
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

export function getMetabotSharedSkillRoot(): InstallSkillRoot {
  return { ...metabotSharedSkillRoot };
}

export function getRuntimePortableSkillRoots(): InstallSkillRoot[] {
  return [getMetabotSharedSkillRoot(), ...getInstallSkillRoots()];
}

function normalizeOptionalEnvPath(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolvePlatformSkillRootPath(
  root: PlatformSkillRoot,
  systemHomeDir: string,
  env: NodeJS.ProcessEnv = {},
): string {
  if (root.homeEnv) {
    const homeOverride = normalizeOptionalEnvPath(env[root.homeEnv]);
    if (homeOverride) {
      return path.resolve(homeOverride, 'skills');
    }
  }
  const isWin = process.platform === 'win32';
  const rawPath = (isWin && root.windowsPath) ? root.windowsPath : root.path;
  if (isWin) {
    const roamingMatch = matchWindowsAppDataPrefix(rawPath, '~/AppData/Roaming');
    if (roamingMatch) {
      const appData = normalizeOptionalEnvPath(env.APPDATA);
      if (appData) {
        return path.resolve(appData, roamingMatch);
      }
    }
    const localMatch = matchWindowsAppDataPrefix(rawPath, '~/AppData/Local');
    if (localMatch) {
      const localAppData = normalizeOptionalEnvPath(env.LOCALAPPDATA);
      if (localAppData) {
        return path.resolve(localAppData, localMatch);
      }
    }
  }
  if (rawPath === '~') {
    return path.resolve(systemHomeDir);
  }
  if (rawPath.startsWith('~/')) {
    return path.resolve(systemHomeDir, rawPath.slice(2));
  }
  return path.resolve(systemHomeDir, rawPath);
}

/**
 * When `rawPath` starts with the given `~/AppData/...` prefix (case-insensitive),
 * returns the remaining relative path; otherwise returns null. Used to resolve
 * Windows app-data skill roots against %APPDATA% / %LOCALAPPDATA%.
 */
function matchWindowsAppDataPrefix(rawPath: string, prefix: string): string | null {
  if (rawPath.length < prefix.length || rawPath[prefix.length] !== '/') {
    return null;
  }
  const head = rawPath.slice(0, prefix.length);
  if (head.toLowerCase() !== prefix.toLowerCase()) {
    return null;
  }
  return rawPath.slice(prefix.length + 1);
}
