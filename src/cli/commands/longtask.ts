/**
 * `metabot longtask …` — the command surface for long-running tasks. Unlike the
 * group and meta task commands this needs no daemon round trip: the store is
 * file-backed under the profile's runtime dir, so the command either has the
 * injected handler or reports it as unconfigured.
 */
import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { commandMissingFlag, commandUnknownSubcommand, readFlagValue, readFromFlag } from './helpers';
import type { CliRuntimeContext } from '../types';

/** Sub-verbs this command accepts, in help order. */
export const LONG_TASK_SUBCOMMANDS = [
  'create', 'list', 'show', 'board', 'advance', 'add-subtask', 'set-status',
  'note', 'set-stage', 'update',
] as const;

/**
 * Stages `set-stage` accepts: the four lifecycle moves. `defining` is excluded
 * on purpose — this surface creates tasks as active (no draft ceremony), so
 * `defining` is not a stage a caller can move anything into.
 */
const SET_STAGE_STAGES = ['active', 'paused', 'cancelled', 'done'] as const;

export async function runLongTaskCommand(
  args: string[],
  context: CliRuntimeContext,
): Promise<MetabotCommandResult<unknown>> {
  const [subcommand] = args;
  const from = readFromFlag(args);
  const deps = context.dependencies.longtask;
  if (!deps) {
    return commandFailed('not_implemented', 'Long-task handlers are not configured.');
  }

  switch (subcommand) {
    case 'create': {
      if (!deps.create) return commandFailed('not_implemented', 'Long-task create is not configured.');
      const id = readFlagValue(args, '--id');
      const title = readFlagValue(args, '--title');
      if (!id) return commandMissingFlag('--id');
      if (!title) return commandMissingFlag('--title');
      return deps.create({ from, id, title, goal: readFlagValue(args, '--goal') ?? undefined });
    }
    case 'list':
      if (!deps.list) return commandFailed('not_implemented', 'Long-task list is not configured.');
      return deps.list({ from });
    case 'board':
      if (!deps.board) return commandFailed('not_implemented', 'Long-task board is not configured.');
      return deps.board({ from });
    case 'advance':
      if (!deps.advance) return commandFailed('not_implemented', 'Long-task advance is not configured.');
      return deps.advance({ from });
    case 'show': {
      if (!deps.show) return commandFailed('not_implemented', 'Long-task show is not configured.');
      const id = readFlagValue(args, '--id');
      if (!id) return commandMissingFlag('--id');
      return deps.show({ from, id });
    }
    case 'add-subtask': {
      if (!deps.addSubtask) return commandFailed('not_implemented', 'Long-task addSubtask is not configured.');
      const id = readFlagValue(args, '--id');
      const subtaskId = readFlagValue(args, '--subtask');
      const title = readFlagValue(args, '--title');
      const ordinalRaw = readFlagValue(args, '--ordinal');
      if (!id) return commandMissingFlag('--id');
      if (!subtaskId) return commandMissingFlag('--subtask');
      if (!title) return commandMissingFlag('--title');
      if (ordinalRaw === null) return commandMissingFlag('--ordinal');
      const ordinal = Number(ordinalRaw);
      if (!Number.isInteger(ordinal)) {
        return commandFailed('invalid_flag_value', `--ordinal must be an integer, got "${ordinalRaw}".`);
      }
      const dependsRaw = readFlagValue(args, '--depends-on');
      // The store has validated expectedMinutes since the port; only the CLI
      // flag was missing. Positive integer minutes, null-ish when absent.
      const expectedRaw = readFlagValue(args, '--expected-minutes');
      let expectedMinutes: number | undefined;
      if (expectedRaw !== null) {
        const parsed = Number(expectedRaw);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return commandFailed(
            'invalid_flag_value',
            `--expected-minutes must be a positive integer, got "${expectedRaw}".`,
          );
        }
        expectedMinutes = parsed;
      }
      return deps.addSubtask({
        from, id, subtaskId, ordinal, title,
        dependsOn: dependsRaw
          ? dependsRaw.split(',').map((entry) => entry.trim()).filter(Boolean)
          : undefined,
        expectedMinutes,
      });
    }
    case 'set-status': {
      if (!deps.setSubtaskStatus) {
        return commandFailed('not_implemented', 'Long-task setSubtaskStatus is not configured.');
      }
      const id = readFlagValue(args, '--id');
      const subtaskId = readFlagValue(args, '--subtask');
      const status = readFlagValue(args, '--status');
      if (!id) return commandMissingFlag('--id');
      if (!subtaskId) return commandMissingFlag('--subtask');
      if (!status) return commandMissingFlag('--status');
      return deps.setSubtaskStatus({ from, id, subtaskId, status });
    }
    case 'note': {
      if (!deps.note) return commandFailed('not_implemented', 'Long-task note is not configured.');
      const id = readFlagValue(args, '--id');
      const text = readFlagValue(args, '--text');
      if (!id) return commandMissingFlag('--id');
      if (!text) return commandMissingFlag('--text');
      const subtaskId = readFlagValue(args, '--subtask');
      return deps.note({ from, id, subtaskId: subtaskId ?? undefined, text });
    }
    case 'set-stage': {
      if (!deps.setStage) return commandFailed('not_implemented', 'Long-task setStage is not configured.');
      const id = readFlagValue(args, '--id');
      const stage = readFlagValue(args, '--stage');
      if (!id) return commandMissingFlag('--id');
      if (!stage) return commandMissingFlag('--stage');
      if (!(SET_STAGE_STAGES as readonly string[]).includes(stage)) {
        return commandFailed(
          'invalid_flag_value',
          `--stage must be one of ${SET_STAGE_STAGES.join('|')}, got "${stage}".`,
        );
      }
      return deps.setStage({ from, id, stage });
    }
    case 'update': {
      if (!deps.updateTask) return commandFailed('not_implemented', 'Long-task updateTask is not configured.');
      const id = readFlagValue(args, '--id');
      if (!id) return commandMissingFlag('--id');
      const title = readFlagValue(args, '--title');
      const goal = readFlagValue(args, '--goal');
      if (!title && !goal) return commandMissingFlag('--title or --goal');
      return deps.updateTask({ from, id, title: title ?? undefined, goal: goal ?? undefined });
    }
    default:
      return commandUnknownSubcommand(`longtask${subcommand ? ` ${subcommand}` : ''}`);
  }
}
