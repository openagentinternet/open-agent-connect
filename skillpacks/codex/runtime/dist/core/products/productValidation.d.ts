import type { ProductListingPayload, ProductOrderPayload } from './productTypes';
export type ProductValidationFailureCode = 'invalid_product_payload' | 'invalid_product_name' | 'invalid_product_title' | 'invalid_product_type' | 'invalid_cover_image_uri' | 'invalid_gallery_image_uri' | 'invalid_description_content_type' | 'invalid_description' | 'invalid_fulfillment_type' | 'unsupported_fulfillment_endpoint' | 'missing_fulfillment_skill' | 'invalid_fulfillment_skill' | 'invalid_sku' | 'duplicate_sku_id' | 'invalid_sku_price' | 'invalid_initial_stock' | 'missing_listing_pin_id' | 'missing_sku_id' | 'invalid_payment_txid' | 'unsupported_settlement_kind' | 'invalid_comment';
export interface ProductValidationSuccess<T> {
    ok: true;
    value: T;
}
export interface ProductValidationFailure {
    ok: false;
    code: ProductValidationFailureCode;
    message: string;
}
export type ProductValidationResult<T> = ProductValidationSuccess<T> | ProductValidationFailure;
export declare function normalizeProductCurrency(value: unknown): string;
export declare function validateProductListingPayload(input: unknown): ProductValidationResult<ProductListingPayload>;
export declare function validateProductOrderPayload(input: unknown): ProductValidationResult<ProductOrderPayload>;
