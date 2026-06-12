import {
  browserFailure,
  browserSuccess,
  type BrowserActorInput,
  type BrowserCacheClearResult,
  type BrowserCacheSnapshot,
  type BrowserCommandFailure,
  type BrowserCommandResult,
  type BrowserHostAdapter,
  type BrowserResourceEnvelope,
  type BrowserResourceOwner,
  type BrowserResolveAction,
  type BrowserResourceSection,
  type BrowserRuntimeSnapshot,
  type BrowserSettingsSnapshot,
  type BrowserTrustedActionInput,
  type BrowserTrustedActionResult,
} from '@openagentinternet/agent-browser-host-contract';
import { normalizeResourceSections } from '@openagentinternet/agent-browser-core';
import type { BrowserResolveResult, BrowserTrustedAction } from '../../core/browser/types';
import type { BrowserTrustedActionInput as OacBrowserTrustedActionInput } from '../../core/browser/hostTypes';
import type { MetabotCommandResult } from '../../core/contracts/commandResult';
import { createOacBrowserHostAdapter, type CreateOacBrowserHostAdapterInput } from './oacBrowserHostAdapter';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function toBrowserFailure(result: MetabotCommandResult<unknown>): BrowserCommandFailure {
  return browserFailure(
    text((result as { code?: unknown }).code) || text((result as { state?: unknown }).state) || 'browser_oac_failure',
    text((result as { message?: unknown }).message) || 'OAC Browser command failed.',
  );
}

function toBrowserResult<T>(result: MetabotCommandResult<T>): BrowserCommandResult<T> {
  return result.ok ? browserSuccess(result.data) : toBrowserFailure(result);
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

function nonTerminalTrustedActionResultFromOac(
  actionInput: BrowserTrustedActionInput,
  result: MetabotCommandResult<unknown>,
): BrowserCommandResult<BrowserTrustedActionResult> | null {
  if (result.ok || (result.state !== 'waiting' && result.state !== 'manual_action_required')) {
    return null;
  }

  const resultData = record(result.data);
  const href = text((result as { localUiUrl?: unknown }).localUiUrl);
  const traceId = text(resultData.traceId);
  const normalizedData = trustedActionData({
    message: text(result.message),
    ...(href ? { href } : traceId ? { route: `/ui/trace?traceId=${encodeURIComponent(traceId)}` } : {}),
  });
  return browserSuccess({
    kind: actionInput.kind,
    handled: true,
    ...(normalizedData ? { data: normalizedData } : {}),
  });
}

function trustedActionResultFromOac(
  actionInput: BrowserTrustedActionInput,
  result: MetabotCommandResult<unknown>,
): BrowserCommandResult<BrowserTrustedActionResult> {
  if (!result.ok) {
    const nonTerminalResult = nonTerminalTrustedActionResultFromOac(actionInput, result);
    if (nonTerminalResult) {
      return nonTerminalResult;
    }
    return toBrowserFailure(result);
  }

  const outer = record(result.data);
  const nested = record(outer.data);
  const normalizedData = trustedActionData(Object.keys(nested).length ? nested : outer);
  return browserSuccess({
    kind: actionInput.kind,
    handled: true,
    ...(normalizedData ? { data: normalizedData } : {}),
  });
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

function ownerFromResult(result: BrowserResolveResult): BrowserResourceOwner {
  return {
    kind: result.owner.kind === 'metaapp-publisher' ? 'metaapp-publisher' : result.owner.kind === 'bot' ? 'bot' : 'unknown',
    globalMetaId: result.owner.globalMetaId || undefined,
    address: result.owner.address || undefined,
    name: result.owner.name || result.title,
    label: result.owner.name || result.title,
    avatar: result.owner.avatar || undefined,
    verificationState: result.owner.verificationState,
  };
}

function actionFromOac(action: BrowserTrustedAction): BrowserResolveAction | null {
  if (action.kind === 'private-chat') {
    return {
      id: action.id,
      label: action.label,
      kind: 'private-chat',
      enabled: action.enabled !== false,
      ...(action.uri ? { uri: action.uri } : {}),
      ...(action.payload ? { payload: action.payload } : {}),
    };
  }

  if (action.kind === 'service-call') {
    return {
      id: action.id,
      label: action.label,
      kind: 'service-call',
      enabled: action.enabled !== false,
      ...(action.serviceId ? { serviceId: action.serviceId } : {}),
      ...(action.payload ? { payload: action.payload } : {}),
    };
  }

  if (action.kind === 'copy') {
    return {
      id: action.id,
      label: action.label,
      kind: 'copy',
      enabled: action.enabled !== false,
      ...(action.uri ? { uri: action.uri } : {}),
      ...(action.payload ? { payload: action.payload } : {}),
    };
  }

  return null;
}

function sectionsFromOacResult(result: BrowserResolveResult): BrowserResourceSection[] {
  if (result.resourceType !== 'bot') {
    return [];
  }

  const data = record(result.renderer.data);
  return normalizeResourceSections([
    { id: 'overview', title: 'Overview', kind: 'generic-list', items: Object.keys(record(data.homepage)).length ? [record(data.homepage)] : [] },
    { id: 'services', title: 'Services', kind: 'services', items: list(data.services) },
    { id: 'skills', title: 'Skills', kind: 'skills', items: list(data.skills) },
    { id: 'buses', title: 'Buses', kind: 'buses', items: list(data.buses) },
    { id: 'buzzes', title: 'Buzz', kind: 'buzzes', items: list(data.buzzes).length ? list(data.buzzes) : list(data.buzz) },
    { id: 'apps', title: 'Apps', kind: 'apps', items: list(data.apps) },
    { id: 'activity', title: 'Recent Activity', kind: 'activity', items: list(data.activity) },
  ]);
}

export function oacResolveResultToBrowserEnvelope(result: BrowserResolveResult): BrowserResourceEnvelope {
  return {
    uri: result.uri,
    normalizedUri: result.normalizedUri,
    resourceType: result.resourceType === 'unsupported' ? 'unknown' : result.resourceType,
    title: result.title,
    owner: ownerFromResult(result),
    ownerAffinity: null,
    renderer: {
      type: result.renderer.type,
      contentType: result.renderer.contentType,
      templateId: result.renderer.templateId,
      url: result.renderer.url,
      data: result.renderer.data,
      error: result.renderer.error,
    },
    actions: result.actions.flatMap((action) => {
      const mapped = actionFromOac(action);
      return mapped ? [mapped] : [];
    }),
    sections: sectionsFromOacResult(result),
    status: result.status,
    proof: result.proof,
    source: result.source,
    raw: result,
  };
}

export function createOacBrowserCoreHostAdapter(input: CreateOacBrowserHostAdapterInput): BrowserHostAdapter {
  const adapter = createOacBrowserHostAdapter(input);

  return {
    async getRuntime(actorInput?: BrowserActorInput): Promise<BrowserCommandResult<BrowserRuntimeSnapshot>> {
      return toBrowserResult(await adapter.getRuntime(actorInput));
    },
    async resolveResource(resolveInput): Promise<BrowserCommandResult<BrowserResourceEnvelope>> {
      const result = await adapter.resolveResource(resolveInput);
      return result.ok ? browserSuccess(oacResolveResultToBrowserEnvelope(result.data)) : toBrowserFailure(result);
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
