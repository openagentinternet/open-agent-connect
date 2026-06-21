import { type MetabotPaths } from '../state/paths';
import type { SecretStore } from './secretStore';
export declare function createFileSecretStore(homeDirOrPaths: string | MetabotPaths): SecretStore;
