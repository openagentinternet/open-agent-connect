export const PresetCurve: typeof PresetCurve;
declare function PresetCurve(options: any): void;
declare class PresetCurve {
    constructor(options: any);
    curve: import("./curve/short") | import("./curve/mont") | import("./curve/edwards");
    g: any;
    n: any;
    hash: any;
}
export {};
