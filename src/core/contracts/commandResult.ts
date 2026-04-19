export type MetabotCommandState = 'success' | 'awaiting_confirmation' | 'waiting' | 'manual_action_required' | 'failed';

type CommandBase = {
  state: MetabotCommandState;
  code?: string;
  message?: string;
};

type CommandSuccess<T> = CommandBase & {
  ok: true;
  state: 'success';
  data: T;
};

type CommandAwaitingConfirmation<T> = CommandBase & {
  ok: true;
  state: 'awaiting_confirmation';
  data: T;
};

type CommandWaiting = CommandBase & {
  ok: false;
  state: 'waiting';
  pollAfterMs: number;
};

type CommandManualActionRequired = CommandBase & {
  ok: false;
  state: 'manual_action_required';
  localUiUrl?: string;
};

type CommandFailed = CommandBase & {
  ok: false;
  state: 'failed';
};

export type MetabotCommandResult<T> =
  | CommandSuccess<T>
  | CommandAwaitingConfirmation<T>
  | CommandWaiting
  | CommandManualActionRequired
  | CommandFailed;

export const commandSuccess = <T>(data: T): MetabotCommandResult<T> => ({
  ok: true,
  state: 'success',
  data
});

export const commandAwaitingConfirmation = <T>(data: T): MetabotCommandResult<T> => ({
  ok: true,
  state: 'awaiting_confirmation',
  data,
});

export const commandWaiting = (code: string, message: string, pollAfterMs: number): MetabotCommandResult<never> => ({
  ok: false,
  state: 'waiting',
  code,
  message,
  pollAfterMs
});

export const commandManualActionRequired = (code: string, message: string, localUiUrl?: string): MetabotCommandResult<never> => ({
  ok: false,
  state: 'manual_action_required',
  code,
  message,
  localUiUrl
});

export const commandFailed = (code: string, message: string): MetabotCommandResult<never> => ({
  ok: false,
  state: 'failed',
  code,
  message
});
