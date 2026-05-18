import { type ReadOnlineMetaBotsFromSocketPresenceResult } from '../discovery/socketPresenceDirectory';
import type { A2ASimplemsgListenerManager, A2ASimplemsgListenerStartReport, A2ASimplemsgStartedProfile } from './simplemsgListener';
export type A2ASimplemsgPresenceWatchdogStatus = 'healthy' | 'started' | 'no_profiles' | 'presence_unavailable' | 'missing_grace' | 'restart_cooling_down' | 'restarted';
export interface A2ASimplemsgPresenceWatchdogCheckResult {
    status: A2ASimplemsgPresenceWatchdogStatus;
    report: A2ASimplemsgListenerStartReport;
    missing: A2ASimplemsgStartedProfile[];
    error?: Error;
}
export interface A2ASimplemsgPresenceWatchdogRestartEvent {
    missing: A2ASimplemsgStartedProfile[];
    previousReport: A2ASimplemsgListenerStartReport;
    restartReport: A2ASimplemsgListenerStartReport;
    missingSinceMs: number;
    restartedAtMs: number;
}
export interface A2ASimplemsgPresenceWatchdog {
    start(): void;
    stop(): void;
    isRunning(): boolean;
    checkOnce(): Promise<A2ASimplemsgPresenceWatchdogCheckResult>;
}
export interface A2ASimplemsgPresenceWatchdogOptions {
    manager: A2ASimplemsgListenerManager;
    intervalMs?: number;
    gracePeriodMs?: number;
    restartCooldownMs?: number;
    socketPresenceLimit?: number;
    now?: () => number;
    readOnlineMetaBots?: () => Promise<Pick<ReadOnlineMetaBotsFromSocketPresenceResult, 'bots'>>;
    onRestart?: (event: A2ASimplemsgPresenceWatchdogRestartEvent) => void;
    onError?: (error: Error) => void;
}
export declare function createA2ASimplemsgPresenceWatchdog(input: A2ASimplemsgPresenceWatchdogOptions): A2ASimplemsgPresenceWatchdog;
