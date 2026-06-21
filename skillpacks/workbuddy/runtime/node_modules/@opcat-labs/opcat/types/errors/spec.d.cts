declare const _exports: ({
    name: string;
    message: string;
} | {
    name: string;
    message: (...args: any[]) => string;
} | {
    name: string;
    message: string;
    errors: ({
        name: string;
        message: string;
        errors: {
            name: string;
            message: string;
        }[];
    } | {
        name: string;
        message: string;
    })[];
})[];
export = _exports;
