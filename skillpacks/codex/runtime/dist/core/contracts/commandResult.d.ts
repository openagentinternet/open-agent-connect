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
export type MetabotCommandResult<T> = CommandSuccess<T> | CommandAwaitingConfirmation<T> | CommandWaiting | CommandManualActionRequired | CommandFailed;
export declare const commandSuccess: <T>(data: T) => MetabotCommandResult<T>;
export declare const commandAwaitingConfirmation: <T>(data: T) => MetabotCommandResult<T>;
export declare const commandWaiting: (code: string, message: string, pollAfterMs: number) => MetabotCommandResult<never>;
export declare const commandManualActionRequired: (code: string, message: string, localUiUrl?: string) => MetabotCommandResult<never>;
export declare const commandFailed: (code: string, message: string) => MetabotCommandResult<never>;
export {};
