import '../compat/nodeLocalStorage';
export declare function signMvcAddressMessage(input: {
    mnemonic: string;
    path: string;
    message: string;
}): Promise<{
    signature: string;
    publicKey: string;
}>;
