import '../compat/nodeLocalStorage';
import { DEFAULT_DERIVATION_PATH } from '../identity/deriveIdentity';
import { signMvcAddressMessage } from './mvcMessageSigning';

const DEFAULT_ADDRESS_INIT_URL = 'https://www.metaso.network/assist-open-api/v1/assist/gas/mvc/address-init';
const DEFAULT_ADDRESS_REWARD_URL = 'https://www.metaso.network/assist-open-api/v1/assist/gas/mvc/address-reward';
const DEFAULT_SUBSIDY_WAIT_MS = 5_000;
const CREDENTIAL_MESSAGE = 'metaso.network';

type SubsidyServiceResponse = Record<string, unknown>;

export interface RequestMvcGasSubsidyOptions {
  mvcAddress: string;
  mnemonic?: string;
  path?: string;
}

export interface RequestMvcGasSubsidyResult {
  success: boolean;
  step1?: unknown;
  step2?: unknown;
  error?: string;
}

export interface RequestMvcGasSubsidyDependencies {
  addressInitUrl?: string;
  addressRewardUrl?: string;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  waitMs?: number;
}

function readServiceResponse(value: unknown): SubsidyServiceResponse | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as SubsidyServiceResponse
    : null;
}

function readServiceCode(value: unknown): number | null {
  const response = readServiceResponse(value);
  const code = typeof response?.code === 'number'
    ? response.code
    : typeof response?.code === 'string' && response.code.trim()
      ? Number(response.code)
      : Number.NaN;
  return Number.isFinite(code) ? code : null;
}

function readServiceMessage(value: unknown): string {
  const response = readServiceResponse(value);
  for (const key of ['message', 'msg', 'error']) {
    const message = response?.[key];
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }
  return '';
}

function isAcceptedServiceResult(value: unknown, acceptedDuplicate: RegExp): boolean {
  const code = readServiceCode(value);
  if (code === 0) return true;
  return code !== null && acceptedDuplicate.test(readServiceMessage(value));
}

function formatServiceFailure(stage: 'address-init' | 'address-reward', value: unknown): string {
  const message = readServiceMessage(value);
  if (message) return `${stage} failed: ${message}`;
  const code = readServiceCode(value);
  if (code !== null) return `${stage} failed: service code ${code}`;
  return `${stage} failed: invalid service response`;
}

export async function requestMvcGasSubsidy(
  options: RequestMvcGasSubsidyOptions,
  dependencies: RequestMvcGasSubsidyDependencies = {}
): Promise<RequestMvcGasSubsidyResult> {
  const mvcAddress = typeof options.mvcAddress === 'string' ? options.mvcAddress.trim() : '';
  const mnemonic = typeof options.mnemonic === 'string' ? options.mnemonic.trim() : '';
  const derivationPath = typeof options.path === 'string' && options.path.trim()
    ? options.path.trim()
    : DEFAULT_DERIVATION_PATH;

  if (!mvcAddress) {
    return {
      success: false,
      error: 'mvcAddress is required',
    };
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const wait = dependencies.wait ?? (async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  const addressInitUrl = dependencies.addressInitUrl ?? DEFAULT_ADDRESS_INIT_URL;
  const addressRewardUrl = dependencies.addressRewardUrl ?? DEFAULT_ADDRESS_REWARD_URL;
  const waitMs = dependencies.waitMs ?? DEFAULT_SUBSIDY_WAIT_MS;
  const requestBody = JSON.stringify({
    address: mvcAddress,
    gasChain: 'mvc',
  });

  try {
    const step1Response = await fetchImpl(addressInitUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: requestBody,
    });
    const step1 = await step1Response.json();

    if (!step1Response.ok) {
      return {
        success: false,
        step1,
        error: `${formatServiceFailure('address-init', step1)} (HTTP ${step1Response.status} ${step1Response.statusText})`,
      };
    }
    if (!isAcceptedServiceResult(step1, /^address already init(?:ialized)?$/i)) {
      return {
        success: false,
        step1,
        error: formatServiceFailure('address-init', step1),
      };
    }

    if (!mnemonic) {
      return {
        success: true,
        step1,
      };
    }

    await wait(waitMs);
    const { signature, publicKey } = await signMvcAddressMessage({
      mnemonic,
      path: derivationPath,
      message: CREDENTIAL_MESSAGE,
    });
    const step2Response = await fetchImpl(addressRewardUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Signature': signature,
        'X-Public-Key': publicKey,
      },
      body: requestBody,
    });
    const step2 = await step2Response.json();

    if (!step2Response.ok) {
      return {
        success: false,
        step1,
        step2,
        error: `${formatServiceFailure('address-reward', step2)} (HTTP ${step2Response.status} ${step2Response.statusText})`,
      };
    }
    if (!isAcceptedServiceResult(step2, /^address already rewarded$/i)) {
      return {
        success: false,
        step1,
        step2,
        error: formatServiceFailure('address-reward', step2),
      };
    }

    return {
      success: true,
      step1,
      step2,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
