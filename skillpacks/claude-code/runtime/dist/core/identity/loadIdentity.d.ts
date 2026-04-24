import { type DerivedIdentity } from './deriveIdentity';
export type IdentitySource = Partial<DerivedIdentity> & {
    public_key?: string;
    chat_public_key?: string;
    mvc_address?: string;
    btc_address?: string;
    doge_address?: string;
    metaid?: string;
    globalmetaid?: string;
};
export declare function loadIdentity(source: IdentitySource): Promise<DerivedIdentity>;
