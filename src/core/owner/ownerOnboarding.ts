// Zero-touch owner onboarding: every install ends up with a usable "user
// account" without the user knowing what a wallet is. The pipeline mirrors
// the IDBots first-launch provisioning: create the machine-wide owner
// identity (default name "User"), get-or-create the traffic account, claim
// the one-time free traffic grant, request the MVC gas subsidy for the owner
// address, and publish the owner /info/name pin through the traffic sponsor
// (falling back to the subsidy-funded wallet). Progress is journaled to
// `~/.metabot/owner/onboarding.json` (storage-layout v2 amendment) so both
// UIs can show "preparing account / granted" and a later daemon start
// retries only the steps that have not converged. Deleting the owner
// identity tombstones the state (`status: "opted_out"`) so auto-provisioning
// never resurrects an identity the user deliberately removed.
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChainAdapterRegistry } from '../chain/adapters/types';
import type { ResolveSponsorWritePin } from '../signing/localMnemonicSigner';
import type { Signer } from '../signing/signer';
import {
  requestMvcGasSubsidy,
  type RequestMvcGasSubsidyOptions,
  type RequestMvcGasSubsidyResult,
} from '../subsidy/requestMvcGasSubsidy';
import { TrafficApiError, type TrafficAccountService } from '../traffic/trafficAccountService';
import {
  DEFAULT_OWNER_NAME,
  ensureOwnerIdentity,
  readOwnerIdentity,
  type OwnerIdentityRecord,
} from './ownerIdentity';
import { buildOwnerProfileChainWrites, writeOwnerProfileChainRequests } from './ownerProfilePublish';
import { createOwnerSigner } from './ownerSigner';

const ONBOARDING_FILE_MODE = 0o600;

export type OwnerOnboardingStatus = 'pending' | 'ready' | 'opted_out';
export type OwnerOnboardingStepState = 'pending' | 'done' | 'failed' | 'skipped';
export type OwnerOnboardingGrantState = 'pending' | 'claimed' | 'already_claimed' | 'disabled' | 'failed';

export interface OwnerOnboardingState {
  version: 1;
  status: OwnerOnboardingStatus;
  attempts: number;
  /** ISO timestamp of the last run; null before the first attempt. */
  lastAttemptAt: string | null;
  /** First error hit by the most recent run; null when it fully converged. */
  lastError: string | null;
  steps: {
    identity: OwnerOnboardingStepState;
    trafficAccount: OwnerOnboardingStepState;
    freeGrant: OwnerOnboardingGrantState;
    subsidy: OwnerOnboardingStepState;
    namePin: OwnerOnboardingStepState;
  };
  /** grantBytes from a successful free-grant claim; null otherwise. */
  freeGrantBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

export function resolveOwnerOnboardingStatePath(systemHomeDir: string): string {
  return path.join(path.resolve(systemHomeDir), '.metabot', 'owner', 'onboarding.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readStep(value: unknown, allowed: string[], fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return allowed.includes(text) ? text : fallback;
}

export function normalizeOwnerOnboardingState(value: unknown): OwnerOnboardingState | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const steps = isRecord(record.steps) ? record.steps : {};
  const now = new Date().toISOString();
  return {
    version: 1,
    status: readStep(record.status, ['pending', 'ready', 'opted_out'], 'pending') as OwnerOnboardingStatus,
    attempts: Number.isFinite(Number(record.attempts)) ? Math.max(0, Math.trunc(Number(record.attempts))) : 0,
    lastAttemptAt: typeof record.lastAttemptAt === 'string' && record.lastAttemptAt ? record.lastAttemptAt : null,
    lastError: typeof record.lastError === 'string' && record.lastError ? record.lastError : null,
    steps: {
      identity: readStep(steps.identity, ['pending', 'done', 'failed'], 'pending') as OwnerOnboardingStepState,
      trafficAccount: readStep(steps.trafficAccount, ['pending', 'done', 'failed'], 'pending') as OwnerOnboardingStepState,
      freeGrant: readStep(
        steps.freeGrant,
        ['pending', 'claimed', 'already_claimed', 'disabled', 'failed'],
        'pending',
      ) as OwnerOnboardingGrantState,
      subsidy: readStep(steps.subsidy, ['pending', 'done', 'failed', 'skipped'], 'pending') as OwnerOnboardingStepState,
      namePin: readStep(steps.namePin, ['pending', 'done', 'failed', 'skipped'], 'pending') as OwnerOnboardingStepState,
    },
    freeGrantBytes: Number.isFinite(Number(record.freeGrantBytes)) && Number(record.freeGrantBytes) > 0
      ? Math.trunc(Number(record.freeGrantBytes))
      : null,
    createdAt: typeof record.createdAt === 'string' && record.createdAt ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === 'string' && record.updatedAt ? record.updatedAt : now,
  };
}

function createFreshOnboardingState(): OwnerOnboardingState {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    steps: {
      identity: 'pending',
      trafficAccount: 'pending',
      freeGrant: 'pending',
      subsidy: 'pending',
      namePin: 'pending',
    },
    freeGrantBytes: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function applyOnboardingFileMode(filePath: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(filePath, ONBOARDING_FILE_MODE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EINVAL') return;
    throw error;
  }
}

async function writeOnboardingState(systemHomeDir: string, state: OwnerOnboardingState): Promise<void> {
  const filePath = resolveOwnerOnboardingStatePath(systemHomeDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: ONBOARDING_FILE_MODE,
    });
    await fs.rename(tempPath, filePath);
    await applyOnboardingFileMode(filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

/** Current onboarding state; null when this machine has never onboarded. */
export async function readOwnerOnboardingState(systemHomeDir: string): Promise<OwnerOnboardingState | null> {
  try {
    const raw = await fs.readFile(resolveOwnerOnboardingStatePath(systemHomeDir), 'utf8');
    return normalizeOwnerOnboardingState(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Tombstone after `user delete`: auto-provisioning must stay off for good. */
export async function markOwnerOnboardingOptedOut(systemHomeDir: string): Promise<OwnerOnboardingState> {
  const current = (await readOwnerOnboardingState(systemHomeDir)) ?? createFreshOnboardingState();
  const next: OwnerOnboardingState = {
    ...current,
    status: 'opted_out',
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
  await writeOnboardingState(systemHomeDir, next);
  return next;
}

/**
 * Re-arm onboarding after an explicit `user create`/`user import`: the user
 * has opted back in, so the account/grant steps may still converge on the
 * next daemon start. The identity step is already satisfied.
 */
export async function resetOwnerOnboardingAfterManualIdentity(systemHomeDir: string): Promise<OwnerOnboardingState> {
  const next: OwnerOnboardingState = {
    ...createFreshOnboardingState(),
    steps: {
      identity: 'done',
      trafficAccount: 'pending',
      freeGrant: 'pending',
      subsidy: 'pending',
      namePin: 'pending',
    },
  };
  await writeOnboardingState(systemHomeDir, next);
  return next;
}

export interface OwnerOnboardingStatusSnapshot {
  onboarding: OwnerOnboardingState | null;
  identityPresent: boolean;
}

/** Read-only snapshot for the /api/user/onboarding status verb and CLI. */
export async function readOwnerOnboardingStatus(systemHomeDir: string): Promise<OwnerOnboardingStatusSnapshot> {
  const [onboarding, identity] = await Promise.all([
    readOwnerOnboardingState(systemHomeDir),
    readOwnerIdentity(systemHomeDir).catch(() => null),
  ]);
  return { onboarding, identityPresent: identity !== null };
}

export interface OwnerOnboardingDeps {
  systemHomeDir: string;
  trafficAccountService: Pick<TrafficAccountService, 'ensureTrafficAccount' | 'claimFreeGrant'>;
  /** Chain adapters for the owner /info/name publish signer; absent = skip the pin step. */
  adapters?: ChainAdapterRegistry;
  /** MVC traffic (代付) sponsor hook for the owner signer; absent = self-pay. */
  resolveSponsorWritePin?: ResolveSponsorWritePin;
  requestMvcGasSubsidy?: (options: RequestMvcGasSubsidyOptions) => Promise<RequestMvcGasSubsidyResult>;
  /** Test seam: full override of the owner signer construction. */
  createSigner?: (owner: OwnerIdentityRecord) => Signer;
  /** Inter-write delay for the /info/name publish (defaults to 3s, like the Bot sync). */
  chainWriteDelayMs?: number;
  log?: (message: string) => void;
}

export interface OwnerOnboardingRunner {
  run(): Promise<OwnerOnboardingState>;
}

function isTerminalGrantState(state: OwnerOnboardingGrantState): boolean {
  return state === 'claimed' || state === 'already_claimed' || state === 'disabled';
}

function computeOnboardingStatus(state: OwnerOnboardingState): OwnerOnboardingStatus {
  if (state.status === 'opted_out') return 'opted_out';
  if (state.steps.identity !== 'done' || state.steps.trafficAccount !== 'done') return 'pending';
  return isTerminalGrantState(state.steps.freeGrant) ? 'ready' : 'pending';
}

function classifyGrantFailure(error: unknown): OwnerOnboardingGrantState {
  if (error instanceof TrafficApiError) {
    if (error.errorCode === 'ALREADY_CLAIMED') return 'already_claimed';
    if (error.errorCode === 'CAMPAIGN_DISABLED' || error.featureUnavailable) return 'disabled';
  }
  return 'failed';
}

/**
 * Idempotent onboarding pipeline. Each daemon start (and the explicit
 * /api/user/onboarding run verb) advances every non-terminal step; failures
 * are recorded and retried on the next run. Concurrent callers share one
 * in-flight execution.
 */
export function createOwnerOnboardingRunner(deps: OwnerOnboardingDeps): OwnerOnboardingRunner {
  const log = deps.log ?? (() => {});
  let inFlight: Promise<OwnerOnboardingState> | null = null;

  async function execute(): Promise<OwnerOnboardingState> {
    const current = (await readOwnerOnboardingState(deps.systemHomeDir)) ?? createFreshOnboardingState();
    if (current.status === 'opted_out') {
      log('skipped: onboarding is opted out on this machine');
      return current;
    }

    const state: OwnerOnboardingState = {
      ...current,
      steps: { ...current.steps },
      attempts: current.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: null,
    };
    const fail = (step: keyof OwnerOnboardingState['steps'], error: unknown): void => {
      state.steps[step] = 'failed';
      state.lastError = error instanceof Error ? error.message : String(error);
    };

    // 1. Owner identity (local, cheap, prerequisite for everything else).
    let owner = await readOwnerIdentity(deps.systemHomeDir);
    if (!owner) {
      try {
        owner = await ensureOwnerIdentity(deps.systemHomeDir, { name: DEFAULT_OWNER_NAME });
        log(`created owner identity ${owner.globalMetaId}`);
      } catch (error) {
        fail('identity', error);
        state.status = computeOnboardingStatus(state);
        await writeOnboardingState(deps.systemHomeDir, { ...state, updatedAt: new Date().toISOString() });
        return { ...state };
      }
    }
    state.steps.identity = 'done';

    // 2. Traffic account (server-side get-or-create; also binds owner + bots).
    if (state.steps.trafficAccount !== 'done') {
      try {
        const account = await deps.trafficAccountService.ensureTrafficAccount();
        state.steps.trafficAccount = 'done';
        log(`traffic account ${account.accountId} ready (balance ${account.balanceBytes} bytes)`);
      } catch (error) {
        fail('trafficAccount', error);
        state.status = computeOnboardingStatus(state);
        await writeOnboardingState(deps.systemHomeDir, { ...state, updatedAt: new Date().toISOString() });
        return { ...state };
      }
    }

    // 3. One-time free traffic grant (best-effort; a disabled or exhausted
    //    campaign must never block the rest of onboarding).
    if (!isTerminalGrantState(state.steps.freeGrant)) {
      try {
        const claim = await deps.trafficAccountService.claimFreeGrant();
        state.steps.freeGrant = 'claimed';
        state.freeGrantBytes = claim.grantBytes > 0 ? claim.grantBytes : state.freeGrantBytes;
        log(`claimed free traffic grant (${claim.grantBytes} bytes)`);
      } catch (error) {
        const grantState = classifyGrantFailure(error);
        state.steps.freeGrant = grantState;
        if (grantState === 'failed') {
          state.lastError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    // 4. MVC gas subsidy for the owner address (idempotent server-side:
    //    "address already rewarded" counts as success). Gates the name pin.
    if (state.steps.subsidy !== 'done') {
      const requestSubsidy = deps.requestMvcGasSubsidy ?? ((options) => requestMvcGasSubsidy(options));
      const subsidy = await requestSubsidy({
        mvcAddress: owner.mvcAddress,
        mnemonic: owner.mnemonic,
        path: owner.path,
      });
      state.steps.subsidy = subsidy.success ? 'done' : 'failed';
      if (!subsidy.success) {
        state.lastError = subsidy.error ?? 'MVC gas subsidy request failed.';
      }
    }

    // 5. Owner /info/name pin through the traffic sponsor (falls back to the
    //    subsidy-funded wallet), retried on later runs while pending.
    if (state.steps.namePin !== 'done' && state.steps.namePin !== 'skipped') {
      if (state.steps.subsidy !== 'done') {
        state.steps.namePin = 'skipped';
      } else {
        const signer = deps.createSigner
          ? deps.createSigner(owner)
          : deps.adapters
            ? createOwnerSigner({
              systemHomeDir: deps.systemHomeDir,
              owner,
              adapters: deps.adapters,
              ...(deps.resolveSponsorWritePin ? { resolveSponsorWritePin: deps.resolveSponsorWritePin } : {}),
            })
            : undefined;
        if (!signer) {
          state.steps.namePin = 'skipped';
        } else {
          try {
            const requests = buildOwnerProfileChainWrites({ name: owner.name });
            if (requests.length > 0) {
              await writeOwnerProfileChainRequests(signer, requests, { delayMs: deps.chainWriteDelayMs });
            }
            state.steps.namePin = 'done';
            log('published owner /info/name pin');
          } catch (error) {
            fail('namePin', error);
          }
        }
      }
    }

    state.status = computeOnboardingStatus(state);
    await writeOnboardingState(deps.systemHomeDir, { ...state, updatedAt: new Date().toISOString() });
    return { ...state };
  }

  return {
    run(): Promise<OwnerOnboardingState> {
      if (inFlight) return inFlight;
      inFlight = execute().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
