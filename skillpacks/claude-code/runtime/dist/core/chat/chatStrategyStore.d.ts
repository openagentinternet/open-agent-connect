import type { MetabotPaths } from '../state/paths';
import type { ChatStrategiesState, ChatStrategy } from './privateChatTypes';
export interface ChatStrategyStore {
    paths: MetabotPaths;
    read(): Promise<ChatStrategiesState>;
    write(state: ChatStrategiesState): Promise<void>;
    getStrategy(id: string): Promise<ChatStrategy | null>;
}
export declare function createChatStrategyStore(homeDirOrPaths: string | MetabotPaths): ChatStrategyStore;
