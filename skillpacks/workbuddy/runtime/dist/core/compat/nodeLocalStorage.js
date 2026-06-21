"use strict";
function hasExplicitLocalStorageFileOption() {
    const argvHasOption = process.execArgv.some((arg) => (arg === '--localstorage-file'
        || arg.startsWith('--localstorage-file=')));
    if (argvHasOption)
        return true;
    return /(?:^|\s)--localstorage-file(?:=|\s|$)/.test(process.env.NODE_OPTIONS ?? '');
}
function disableUnavailableNodeLocalStorage() {
    if (hasExplicitLocalStorageFileOption())
        return;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    if (descriptor?.configurable && typeof descriptor.get === 'function') {
        Reflect.deleteProperty(globalThis, 'localStorage');
    }
}
disableUnavailableNodeLocalStorage();
