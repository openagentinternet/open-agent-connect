import { o as ToCBOR, d as Decodeable, f as ITag, m as TagNumber, T as TagDecoder, R as RequiredDecodeOptions, h as RequiredCommentOptions } from './options-Tr9xj9hl.js';
import './sorts.js';

/**
 * A CBOR tagged value.
 * @see https://www.iana.org/assignments/cbor-tags/cbor-tags.xhtml
 */
declare class Tag implements ToCBOR, Decodeable, ITag {
    #private;
    readonly tag: TagNumber;
    contents: unknown;
    /**
     * A tag wrapped around another value.
     *
     * @param tag The tag number.
     * @param contents The value that follows the tag number.
     */
    constructor(tag: TagNumber, contents?: unknown);
    /**
     * When constructing the commented version of this tag, should the contents
     * be written as well?  If true, the comment function should output the
     * contents values itself (only used for tag 24 so far).
     *
     * @type {boolean}
     * @readonly
     */
    get noChildren(): boolean;
    /**
     * Register a decoder for a give tag number.
     *
     * @param tag The tag number.
     * @param decoder Decoder function.
     * @param description If provided, use this when commenting to add a type
     *   name in parens after the tag number.
     * @returns Old decoder for this tag, if there was one.
     */
    static registerDecoder(tag: TagNumber, decoder: TagDecoder, description?: string): TagDecoder | undefined;
    /**
     * Remove the encoder for this tag number.
     *
     * @param tag Tag number.
     * @returns Old decoder, if there was one.
     */
    static clearDecoder(tag: TagNumber): TagDecoder | undefined;
    /**
     * Get the decoder for a given tag number.
     *
     * @param tag The tag number.
     * @returns The decoder function, if there is one.
     */
    static getDecoder(tag: TagNumber): TagDecoder | undefined;
    /**
     * Get all registered decoders clone of the map.
     *
     * @returns Map containing current decoders, as a copy.
     */
    static getAllDecoders(): ReadonlyMap<TagNumber, TagDecoder>;
    /**
     * Iterate over just the contents, so that the tag works more like an
     * array.
     *
     * @yields One time, the contained value.
     */
    [Symbol.iterator](): Generator<unknown, void, undefined>;
    /**
     * Makes Tag act like an array, so that no special casing is needed when
     * the tag's contents are available.
     *
     * @param contents The value associated with the tag.
     * @returns Always returns 1.
     */
    push(contents: unknown): number;
    /**
     * Convert this tagged value to a useful data type, if possible.
     *
     * @param options Options for decoding.
     * @returns The converted value.
     */
    decode(options: RequiredDecodeOptions): unknown;
    comment(options: RequiredCommentOptions, depth: number): string | undefined;
    toCBOR(): [TagNumber, unknown];
}

export { Tag };
