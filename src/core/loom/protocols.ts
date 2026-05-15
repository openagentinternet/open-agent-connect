export type LoomProtocolName =
  | 'task'
  | 'claim'
  | 'status'
  | 'delivery'
  | 'acceptance'
  | 'claim-reject';

export interface LoomProtocolSpec {
  name: LoomProtocolName;
  path: string;
  version: '1.0.0';
  contentType: 'application/json';
}

const LOOM_VERSION = '1.0.0' as const;
const LOOM_CONTENT_TYPE = 'application/json' as const;

function spec(name: LoomProtocolName, path: string): LoomProtocolSpec {
  return {
    name,
    path,
    version: LOOM_VERSION,
    contentType: LOOM_CONTENT_TYPE,
  };
}

export const LOOM_PROTOCOLS: Record<LoomProtocolName, LoomProtocolSpec> = {
  task: spec('task', '/protocols/loom-task'),
  claim: spec('claim', '/protocols/loom-claim'),
  status: spec('status', '/protocols/loom-status'),
  delivery: spec('delivery', '/protocols/loom-delivery'),
  acceptance: spec('acceptance', '/protocols/loom-acceptance'),
  'claim-reject': spec('claim-reject', '/protocols/loom-claim-reject'),
};

export const LOOM_PROTOCOL_NAMES = Object.freeze(
  Object.keys(LOOM_PROTOCOLS) as LoomProtocolName[],
);

export const LOOM_PROTOCOL_PATHS = Object.freeze(
  LOOM_PROTOCOL_NAMES.map((name) => LOOM_PROTOCOLS[name].path),
);

export function isLoomProtocolName(value: unknown): value is LoomProtocolName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOOM_PROTOCOLS, value);
}

export function resolveLoomProtocol(value: unknown): LoomProtocolSpec {
  if (isLoomProtocolName(value)) {
    return LOOM_PROTOCOLS[value];
  }
  if (typeof value === 'string') {
    const byPath = LOOM_PROTOCOL_NAMES.map((name) => LOOM_PROTOCOLS[name]).find(
      (protocol) => protocol.path === value,
    );
    if (byPath) {
      return byPath;
    }
  }
  throw new Error(`Unsupported Loom protocol: ${String(value)}`);
}
