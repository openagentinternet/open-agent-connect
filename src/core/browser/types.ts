import type { DefaultWriteNetwork } from '../config/configTypes';

export type BrowserUriScheme = 'metaid' | 'metaapp';
export type BrowserResourceType = 'bot' | 'metaapp' | 'unsupported';
export type BrowserRendererType = 'bot-page' | 'html-iframe' | 'pdf' | 'image' | 'video' | 'unsupported';
export type BrowserResolutionState = 'resolved' | 'loading' | 'not_found' | 'error';
export type BrowserVerificationState = 'verified' | 'partial' | 'unverified';

export interface BotBrowserConfig {
  metasoP2PBaseUrl: string;
  metafileContentBaseUrl?: string;
  manApiBaseUrl?: string;
  blockExplorerBaseUrl?: string;
  walletApiBaseUrl?: string;
  defaultChainName: DefaultWriteNetwork;
  localMode: boolean;
}

export interface ParsedBrowserUri {
  originalUri: string;
  normalizedUri: string;
  scheme: BrowserUriScheme;
  id: string;
}

export interface BrowserResourceOwner {
  kind: 'bot' | 'metaapp-publisher' | 'unknown';
  globalMetaId: string;
  metaid?: string;
  address?: string;
  name: string;
  avatar?: string;
  online?: boolean | null;
  verificationState: BrowserVerificationState;
}

export interface BrowserRendererDescriptor {
  type: BrowserRendererType;
  contentType: string;
  url?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface BrowserResolutionStatus {
  state: BrowserResolutionState;
  verificationState: BrowserVerificationState;
  message: string;
}

export interface BrowserProofSummary {
  txid?: string;
  pinId?: string;
  protocolPath?: string;
  contentHash?: string;
  publisherGlobalMetaId?: string;
  explorerUrl?: string;
  verificationState: BrowserVerificationState;
  details?: Record<string, unknown>;
}

export interface BrowserSourceSummary {
  resolver: string;
  url?: string;
  fetchedAt?: number;
  indexedAt?: number;
  stale?: boolean;
  schemaVersion?: string;
  raw?: Record<string, unknown>;
}

export interface BrowserTrustedAction {
  id: string;
  label: string;
  kind: 'private-chat' | 'service-list' | 'service-call' | 'copy' | 'proof' | 'creator';
  enabled?: boolean;
  requiresUsingIdentity?: boolean;
  uri?: string;
  serviceId?: string;
  payload?: Record<string, unknown>;
}

export interface BrowserResolveResult {
  uri: string;
  normalizedUri: string;
  resourceType: BrowserResourceType;
  title: string;
  owner: BrowserResourceOwner;
  renderer: BrowserRendererDescriptor;
  status: BrowserResolutionStatus;
  proof?: BrowserProofSummary;
  source: BrowserSourceSummary;
  actions: BrowserTrustedAction[];
}

export interface BrowserUsingIdentity {
  slug: string;
  name: string;
  globalMetaId: string;
  avatar?: string;
  isDefault: boolean;
}

export interface BrowserContextResult {
  usingIdentities: BrowserUsingIdentity[];
  defaultUsingIdentity: BrowserUsingIdentity | null;
  defaultUri: string | null;
}
