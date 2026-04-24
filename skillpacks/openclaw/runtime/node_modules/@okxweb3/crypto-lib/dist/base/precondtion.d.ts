type ErrorType = undefined | string | Error;
declare const check: (statement: any, orError?: ErrorType) => void;
declare const checkIsDefined: <T>(something?: T | undefined, orError?: ErrorType) => T;
declare const checkIsUndefined: (something: any, orError?: ErrorType) => void;
export { check, checkIsDefined, checkIsUndefined };
