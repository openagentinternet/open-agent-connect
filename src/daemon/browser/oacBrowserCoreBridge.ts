import {
  browserFailure,
  browserManualActionRequired,
  browserSuccess,
  browserWaiting,
  type BrowserActorInput,
  type BrowserCacheClearResult,
  type BrowserCacheSnapshot,
  type BrowserCommandFailure,
  type BrowserCommandFailureOptions,
  type BrowserCommandResult,
  type BrowserCommandWaitingOptions,
  type BrowserFollowUpAction,
  type BrowserHostAdapter,
  type BrowserResolveResult,
  type BrowserRuntimeSnapshot,
  type BrowserSettingsSnapshot,
  type BrowserTrustedActionInput,
  type BrowserTrustedActionResult,
} from '@openagentinternet/agent-browser-host-contract';
import type { BrowserTrustedActionInput as OacBrowserTrustedActionInput } from '../../core/browser/hostTypes';
import type { MetabotCommandResult } from '../../core/contracts/commandResult';
import { createOacBrowserHostAdapter, type CreateOacBrowserHostAdapterInput } from './oacBrowserHostAdapter';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function followUpActionFromOac(result: MetabotCommandResult<unknown>): BrowserFollowUpAction | undefined {
  const resultData = record(result.data);
  const href = text((result as { localUiUrl?: unknown }).localUiUrl);
  const traceId = text(resultData.traceId);
  const route = href ? '' : traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : '';
  if (!href && !route) return undefined;
  const action: BrowserFollowUpAction = {
    label: text((result as { actionLabel?: unknown }).actionLabel) || 'Open details',
  };
  if (href) action.href = href;
  if (route) action.route = route;
  return action;
}

function dataRecord(value: unknown): Record<string, unknown> | undefined {
  const next = record(value);
  return Object.keys(next).length ? next : undefined;
}

function failureCode(result: MetabotCommandResult<unknown>): string {
  return text((result as { code?: unknown }).code) || text((result as { state?: unknown }).state) || 'browser_oac_failure';
}

function failureMessage(result: MetabotCommandResult<unknown>): string {
  return text((result as { message?: unknown }).message) || 'OAC Browser command failed.';
}

function toBrowserFailure(result: MetabotCommandResult<unknown>): BrowserCommandFailure {
  const options: BrowserCommandFailureOptions = {};
  const action = followUpActionFromOac(result);
  const data = dataRecord(result.data);
  if (action) options.action = action;
  if (data) options.data = data;
  return browserFailure(failureCode(result), failureMessage(result), options);
}

function toBrowserResult<T>(result: MetabotCommandResult<T>): BrowserCommandResult<T> {
  if (result.ok) return browserSuccess(result.data);

  if (result.state === 'waiting') {
    const options: BrowserCommandWaitingOptions = {};
    const pollAfterMs = (result as { pollAfterMs?: unknown }).pollAfterMs;
    const action = followUpActionFromOac(result);
    const data = dataRecord(result.data);
    if (typeof pollAfterMs === 'number') options.pollAfterMs = pollAfterMs;
    if (action) options.action = action;
    if (data) options.data = data;
    return browserWaiting(failureCode(result), failureMessage(result), options);
  }

  if (result.state === 'manual_action_required') {
    const options: BrowserCommandFailureOptions = {};
    const action = followUpActionFromOac(result);
    const data = dataRecord(result.data);
    if (action) options.action = action;
    if (data) options.data = data;
    return browserManualActionRequired(failureCode(result), failureMessage(result), options);
  }

  return toBrowserFailure(result);
}

function trustedActionData(value: unknown): BrowserTrustedActionResult['data'] | undefined {
  const data = record(value);
  const href = text(data.href);
  const route = text(data.route);
  const copiedText = text(data.copiedText);
  const message = text(data.message);
  const normalized = {
    ...(href ? { href } : {}),
    ...(route ? { route } : {}),
    ...(copiedText ? { copiedText } : {}),
    ...(message ? { message } : {}),
  };
  return Object.keys(normalized).length ? normalized : undefined;
}

function trustedActionResultFromOac(
  actionInput: BrowserTrustedActionInput,
  result: MetabotCommandResult<unknown>,
): BrowserCommandResult<BrowserTrustedActionResult> {
  if (!result.ok) {
    return toBrowserResult(result as MetabotCommandResult<BrowserTrustedActionResult>);
  }

  const outer = record(result.data);
  const nested = record(outer.data);
  const normalizedData = trustedActionData(Object.keys(nested).length ? nested : outer);
  const response: BrowserTrustedActionResult = {
    kind: actionInput.kind,
    handled: true,
  };
  if (normalizedData) response.data = normalizedData;
  return browserSuccess(response);
}

function copyUriTrustedActionResult(actionInput: BrowserTrustedActionInput): BrowserCommandResult<BrowserTrustedActionResult> {
  const payload = record(actionInput.payload);
  const copiedText = text(payload.uri) || text(payload.currentUri) || text(actionInput.resourceUri);
  return browserSuccess({
    kind: 'copy-uri',
    handled: true,
    data: {
      copiedText,
    },
  });
}

function isOacTrustedActionKind(kind: BrowserTrustedActionInput['kind']): kind is OacBrowserTrustedActionInput['kind'] {
  return [
    'private-chat',
    'service-call',
    'open-settings',
    'login',
    'edit-profile',
    'configure-chat',
    'view-messages',
  ].includes(kind);
}

function toOacTrustedActionInput(input: BrowserTrustedActionInput): OacBrowserTrustedActionInput | null {
  if (!isOacTrustedActionKind(input.kind)) {
    return null;
  }
  return {
    ...(input.actorId ? { actorId: input.actorId } : {}),
    resourceUri: input.resourceUri,
    kind: input.kind,
    ...(input.payload ? { payload: input.payload } : {}),
  };
}

export function createOacBrowserCoreHostAdapter(input: CreateOacBrowserHostAdapterInput): BrowserHostAdapter {
  const adapter = createOacBrowserHostAdapter(input);

  return {
    async getRuntime(actorInput?: BrowserActorInput): Promise<BrowserCommandResult<BrowserRuntimeSnapshot>> {
      return toBrowserResult(await adapter.getRuntime(actorInput));
    },
    async resolveResource(resolveInput): Promise<BrowserCommandResult<BrowserResolveResult>> {
      return toBrowserResult(await adapter.resolveResource(resolveInput));
    },
    async getSettings(actorInput?: BrowserActorInput): Promise<BrowserCommandResult<BrowserSettingsSnapshot>> {
      return toBrowserResult(await adapter.getSettings(actorInput));
    },
    async updateSettings(settingsInput): Promise<BrowserCommandResult<BrowserSettingsSnapshot>> {
      return toBrowserResult(await adapter.updateSettings(settingsInput));
    },
    async getCache(actorInput?: BrowserActorInput): Promise<BrowserCommandResult<BrowserCacheSnapshot>> {
      return toBrowserResult(await adapter.getCache(actorInput));
    },
    async clearCache(cacheInput): Promise<BrowserCommandResult<BrowserCacheClearResult>> {
      return toBrowserResult(await adapter.clearCache({ ...cacheInput, scope: cacheInput.scope ?? 'all' }));
    },
    async runTrustedAction(actionInput: BrowserTrustedActionInput): Promise<BrowserCommandResult<BrowserTrustedActionResult>> {
      if (actionInput.kind === 'copy-uri') {
        return copyUriTrustedActionResult(actionInput);
      }

      const oacActionInput = toOacTrustedActionInput(actionInput);
      if (!oacActionInput) {
        return browserFailure(
          'browser_action_not_supported',
          `Browser trusted action is not supported by OAC: ${actionInput.kind}`,
        );
      }
      const result = await adapter.runTrustedAction(oacActionInput);
      return trustedActionResultFromOac(actionInput, result);
    },
  };
}
