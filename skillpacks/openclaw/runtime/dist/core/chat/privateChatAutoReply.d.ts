import type { PrivateChatStateStore } from './privateChatStateStore';
import type { ChatStrategyStore } from './chatStrategyStore';
import type { MetabotPaths } from '../state/paths';
import type { Signer } from '../signing/signer';
import type { PrivateChatInboundMessage, ChatReplyRunner, PrivateChatAutoReplyConfig } from './privateChatTypes';
export interface PrivateChatAutoReplyDependencies {
    stateStore: PrivateChatStateStore;
    strategyStore: ChatStrategyStore;
    paths: MetabotPaths;
    signer: Signer;
    selfGlobalMetaId: () => Promise<string | null>;
    resolvePeerChatPublicKey: (globalMetaId: string) => Promise<string | null>;
    replyRunner: ChatReplyRunner;
    now?: () => number;
}
export interface PrivateChatAutoReplyOrchestrator {
    handleInboundMessage(message: PrivateChatInboundMessage): Promise<void>;
}
export declare function createPrivateChatAutoReplyOrchestrator(deps: PrivateChatAutoReplyDependencies, config: PrivateChatAutoReplyConfig): PrivateChatAutoReplyOrchestrator;
