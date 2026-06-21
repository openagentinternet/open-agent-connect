# @juanelas/base64 - v1.1.5

Base64url for both node.js and brwser javascript. It can work with ArrayBuffer|TypedArray|Buffer

**`Remarks`**

Bowser code obtained from https://github.com/panva/jose/blob/main/src/runtime/browser/base64url.ts

## Table of contents

### Type Aliases

- [TypedArray](API.md#typedarray)

### Functions

- [decode](API.md#decode)
- [encode](API.md#encode)

## Type Aliases

### TypedArray

Ƭ **TypedArray**: `Int8Array` \| `Uint8Array` \| `Uint8ClampedArray` \| `Int16Array` \| `Uint16Array` \| `Int32Array` \| `Uint32Array` \| `Float32Array` \| `Float64Array` \| `BigInt64Array` \| `BigUint64Array`

A TypedArray object describes an array-like view of an underlying binary data buffer.

## Functions

### decode

▸ **decode**(`base64`): `Uint8Array`

Base64url decoding (binary output) of base64url-encoded string

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `base64` | `string` | a base64 string |

#### Returns

`Uint8Array`

a buffer or unicode string

▸ **decode**(`base64`, `stringOutput`): `Uint8Array`

#### Parameters

| Name | Type |
| :------ | :------ |
| `base64` | `string` |
| `stringOutput` | `undefined` |

#### Returns

`Uint8Array`

▸ **decode**(`base64`, `stringOutput`): `Uint8Array`

#### Parameters

| Name | Type |
| :------ | :------ |
| `base64` | `string` |
| `stringOutput` | ``false`` |

#### Returns

`Uint8Array`

▸ **decode**(`base64`, `stringOutput`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `base64` | `string` |
| `stringOutput` | ``true`` |

#### Returns

`string`

▸ **decode**(`base64`, `stringOutput`): `Uint8Array` \| `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `base64` | `string` |
| `stringOutput` | `boolean` |

#### Returns

`Uint8Array` \| `string`

___

### encode

▸ **encode**(`input`, `urlsafe?`, `padding?`): `string`

Base64Url encoding of a buffer input or a string (UTF16 in browsers, UTF8 in node)

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `input` | `string` \| [`TypedArray`](API.md#typedarray) \| `ArrayBufferLike` \| `Buffer` | `undefined` |  |
| `urlsafe` | `boolean` | `false` | if true Base64 URL encoding is used ('+' and '/' are replaced by '-', '_') |
| `padding` | `boolean` | `true` | if false, padding (trailing '=') is removed |

#### Returns

`string`

a string with the base64-encoded representation of the input
