import { D as DecodeOptions } from './options-Tr9xj9hl.js';
export { A as AbstractClassType, B as BaseDecoder, C as CommentOptions, b as DecodeStreamOptions, c as DecodeValue, d as Decodeable, e as DiagnosticSizes, E as EncodeOptions, I as ICommenter, f as ITag, M as MtAiValue, O as ObjectCreator, P as Parent, g as ParentConstructor, h as RequiredCommentOptions, R as RequiredDecodeOptions, a as RequiredEncodeOptions, i as RequiredWriterOptions, S as Simple, j as Sliceable, k as StringNormalization, T as TagDecoder, l as TagDecoderMap, m as TagNumber, n as TaggedValue, o as ToCBOR, p as TypeEncoder, q as TypeEncoderMap, W as Writer, r as WriterOptions } from './options-Tr9xj9hl.js';
export { version } from './version.js';
export { DecodeStream, ValueGenerator } from './decodeStream.js';
export { SequenceEvents, decode, decodeSequence } from './decoder.js';
export { diagnose } from './diagnostic.js';
export { comment } from './comment.js';
export { cdeEncodeOptions, dcborEncodeOptions, defaultEncodeOptions, encode, encodedNumber } from './encoder.js';
export { Tag } from './tag.js';
export { OriginalEncoding, getEncoded, saveEncoded, saveEncodedLength, unbox } from './box.js';
export { NAN, NAN_SIZE } from './float.js';
import './sorts.js';
import './constants.js';

declare const cdeDecodeOptions: DecodeOptions;
declare const dcborDecodeOptions: DecodeOptions;
declare const defaultDecodeOptions: Required<DecodeOptions>;

export { DecodeOptions, cdeDecodeOptions, dcborDecodeOptions, defaultDecodeOptions };
