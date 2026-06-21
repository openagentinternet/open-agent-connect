[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Node.js CI](https://github.com/juanelas/base64/actions/workflows/build-and-test.yml/badge.svg)](https://github.com/juanelas/base64/actions/workflows/build-and-test.yml)
[![Coverage Status](https://coveralls.io/repos/github/juanelas/base64/badge.svg?branch=main)](https://coveralls.io/github/juanelas/base64?branch=main)

# @juanelas/base64

Base64 for both node.js and browser javascript. It supports URL-safe encoding and enabling/disabling padding. Buffers can be implementedd using ArrayBuffer, any TypedArray, or Buffer.

## Usage

`@juanelas/base64` can be imported to your project with `npm`:

```console
npm install @juanelas/base64
```

Then either require (Node.js CJS):

```javascript
const base64 = require('@juanelas/base64')
```

or import (JavaScript ES module):

```javascript
import * as base64 from '@juanelas/base64'
```

The appropriate version for browser or node is automatically exported. Types for TypeScript users are also provided.

You can also download the [IIFE bundle](https://raw.githubusercontent.com/juanelas/base64/main/dist/bundle.iife.js), the [ESM bundle](https://raw.githubusercontent.com/juanelas/base64/main/dist/esm/bundle.min.js) or the [UMD bundle](https://raw.githubusercontent.com/juanelas/base64/main/dist/bundle.umd.js) and manually add it to your project, or, if you have already installed `@juanelas/base64` in your project, just get the bundles from `node_modules/@juanelas/base64/dist/bundles/`.

An example of usage could be:

```typescript
import * as base64 from '@juanelas/base64'

const buf = new Uint8Array([254, 1, 128, 255])
const base64str = base64.encode(buf, true, false) // URL-safe base64 with no padding

console.log(base64str) // Outputs: '_gGA_w'

const buf2 = base64.decode(base64str) // URL-safe encoding and padding are automatically detected

console.log(buf2.toString()) // Outputs: '254,1,128,255'

const text = 'fooba'
const base64str2 = base64.encode(text) // Standard base64 with padding

console.log(base64str2) // Outputs: 'Zm9vYmE='

const text2 = base64.decode(base64str2, true) // Output to unicode string instead of Uint8Array

console.log(text2) // Outputs: 'fooba'

```

## API reference documentation

[Check the API](./docs/API.md)
