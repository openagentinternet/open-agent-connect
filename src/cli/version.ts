// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string };

export const CLI_VERSION: string = pkg.version;
