import { CHAIN_HEARTBEAT_PROTOCOL_PATH } from '../discovery/chainHeartbeatDirectory';
import type { Signer } from '../signing/signer';
import type { ProviderPresenceStateStore } from './providerPresenceState';

export const DEFAULT_PROVIDER_HEARTBEAT_INTERVAL_MS = 60_000;

export interface ProviderHeartbeatIdentity {
  globalMetaId: string;
  mvcAddress: string;
}

export interface ProviderHeartbeatLoop {
  start(): Promise<void>;
  stop(): void;
  runOnce(): Promise<boolean>;
  isRunning(): boolean;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildHeartbeatPayload(input: {
  identity: ProviderHeartbeatIdentity;
  nowMs: number;
}) {
  return {
    providerGlobalMetaId: normalizeText(input.identity.globalMetaId),
    providerAddress: normalizeText(input.identity.mvcAddress),
    heartbeatAt: Math.floor(input.nowMs / 1000),
  };
}

export function createProviderHeartbeatLoop(input: {
  signer: Pick<Signer, 'writePin'>;
  presenceStore: ProviderPresenceStateStore;
  getIdentity: () => Promise<ProviderHeartbeatIdentity | null>;
  now?: () => number;
  intervalMs?: number;
}): ProviderHeartbeatLoop {
  const intervalMs = Number.isFinite(input.intervalMs)
    ? Math.max(1, Math.floor(input.intervalMs as number))
    : DEFAULT_PROVIDER_HEARTBEAT_INTERVAL_MS;
  const now = input.now ?? (() => Date.now());
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let runningPromise: Promise<boolean> | null = null;

  async function runOnce(): Promise<boolean> {
    if (runningPromise) {
      return runningPromise;
    }

    runningPromise = (async () => {
      const presenceState = await input.presenceStore.read();
      if (!presenceState.enabled) {
        return false;
      }

      const identity = await input.getIdentity();
      if (!identity || !normalizeText(identity.globalMetaId) || !normalizeText(identity.mvcAddress)) {
        return false;
      }

      const nowMs = now();
      const payload = buildHeartbeatPayload({
        identity,
        nowMs,
      });
      const result = await input.signer.writePin({
        operation: 'create',
        path: CHAIN_HEARTBEAT_PROTOCOL_PATH,
        payload: JSON.stringify(payload),
        contentType: 'application/json',
        network: 'mvc',
      });

      await input.presenceStore.update((current) => ({
        ...current,
        lastHeartbeatAt: nowMs,
        lastHeartbeatPinId: normalizeText(result.pinId) || null,
        lastHeartbeatTxid: normalizeText(result.txids?.[0]) || null,
      }));

      return true;
    })().finally(() => {
      runningPromise = null;
    });

    return runningPromise;
  }

  return {
    async start() {
      if (intervalId != null) {
        return;
      }

      await runOnce();
      intervalId = setInterval(() => {
        void runOnce().catch(() => {
          // Keep the loop alive; provider surfaces can inspect the last successful heartbeat metadata.
        });
      }, intervalMs);
      intervalId.unref?.();
    },
    stop() {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    runOnce,
    isRunning() {
      return intervalId != null;
    },
  };
}
