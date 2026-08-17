'use strict'

/**
 * OAC system/ops tools: daemon lifecycle, doctor, system update, config, skill
 * resolution, and host persona binding.
 * Wraps the `metabot daemon/doctor/system/config/skills/host ...` CLI commands.
 */

const { createRegistrar, defineMetabotTool, withRequestFile } = require('./_runner.js')

module.exports = {
  name: 'oac-system',
  inject: ['tools'],
  apply(ctx, config = {}) {
    const registrar = createRegistrar(ctx, config)

    defineMetabotTool(registrar, {
      name: 'metabot_daemon_start',
      description: 'Start the local MetaBot daemon (HTTP + SSE server for the active home). Idempotent; the CLI auto-starts it on demand anyway.',
      timeoutMs: 120000,
      parameters: {},
      buildArgs: () => ['daemon', 'start'],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_daemon_stop',
      description: 'Stop the local MetaBot daemon.',
      timeoutMs: 60000,
      parameters: {},
      buildArgs: () => ['daemon', 'stop'],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_doctor_run',
      description: 'Run the MetaBot doctor checks (identity, daemon, chain, secrets) and report the diagnosis. Read-only.',
      timeoutMs: 120000,
      parameters: {},
      buildArgs: () => ['doctor'],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_system_update',
      description: 'Update the local OAC/MetaBot installation to the latest release (or a target version).',
      timeoutMs: 600000,
      parameters: {
        host: { type: 'string', description: 'Optional host platform override.' },
        targetVersion: { type: 'string', description: 'Explicit target version.' },
        dryRun: { type: 'boolean', description: 'Preview the update without applying.' },
      },
      buildArgs: (args) => {
        const tail = ['system', 'update']
        if (args.host) tail.push('--host', args.host)
        if (args.targetVersion) tail.push('--target-version', args.targetVersion)
        if (args.dryRun) tail.push('--dry-run')
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_config_get',
      description: 'Read one local config value (positional key). Read-only.',
      parameters: {
        key: { type: 'string', required: true, description: 'Config key (positional).' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['config', 'get', args.key]
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_config_set',
      description: 'Write one local config value (positional key and value; "true"/"false" become booleans).',
      parameters: {
        key: { type: 'string', required: true, description: 'Config key (positional).' },
        value: { type: 'string', required: true, description: 'Config value (positional).' },
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['config', 'set', args.key, args.value]
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_skills_resolve',
      description: 'Resolve one skill contract for a host (what a skill would bind/install). Read-only.',
      parameters: {
        skill: { type: 'string', required: true, description: 'Skill name.' },
        host: { type: 'string', description: 'Host platform (codex, claude-code, ...).' },
        format: { type: 'string', enum: ['markdown', 'json'], description: 'Render format.' },
      },
      buildArgs: (args) => {
        const tail = ['skills', 'resolve', '--skill', args.skill]
        if (args.host) tail.push('--host', args.host)
        if (args.format) tail.push('--format', args.format)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_host_persona_status',
      description: 'Show whether a Codex host persona projection is bound for the active bot. Read-only.',
      parameters: {},
      buildArgs: () => ['host', 'persona', 'status'],
    })

    defineMetabotTool(registrar, {
      name: 'metabot_host_persona_bind',
      description: 'Bind the host persona projection (Codex) for the active bot.',
      parameters: {
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['host', 'persona', 'bind']
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_host_persona_unbind',
      description: 'Unbind the host persona projection (Codex) for the active bot.',
      parameters: {
        from: { type: 'string', description: 'Optional bot slug.' },
      },
      buildArgs: (args) => {
        const tail = ['host', 'persona', 'unbind']
        if (args.from) tail.push('--from', args.from)
        return tail
      },
    })

    defineMetabotTool(registrar, {
      name: 'metabot_host_bind_skills',
      description: 'Bind the OAC skillpack skills for a host platform (codex, claude-code, ...).',
      timeoutMs: 180000,
      parameters: {
        host: {
          type: 'string',
          required: true,
          description: 'Host platform id (codex, claude-code, openclaw, ...).',
        },
      },
      buildArgs: (args) => ['host', 'bind-skills', '--host', args.host],
    })
  },
}
