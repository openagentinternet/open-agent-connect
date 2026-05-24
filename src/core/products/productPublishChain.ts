import type { ChainWriteResult } from '../chain/writePin';
import type { Signer } from '../signing/signer';
import type { ProductListingPayload, ProductOrderPayload } from './productTypes';
import {
  validateProductListingPayload,
  validateProductOrderPayload,
} from './productValidation';

export const PRODUCT_LISTING_PROTOCOL_PATH = '/protocols/product-listing';
export const PRODUCT_ORDER_PROTOCOL_PATH = '/protocols/product-order';

export interface ProductListingChainWriteInput {
  signer: Pick<Signer, 'writePin'>;
  payload: ProductListingPayload;
  network?: string;
}

export interface ProductOrderChainWriteInput {
  signer: Pick<Signer, 'writePin'>;
  payload: ProductOrderPayload;
  network?: string;
}

export interface ProductChainWriteResult {
  payload: ProductListingPayload | ProductOrderPayload;
  chainWrite: ChainWriteResult;
}

function normalizeNetwork(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'mvc';
}

function buildProductListingPayload(input: ProductListingPayload): ProductListingPayload {
  const result = validateProductListingPayload(input);
  if (!result.ok) {
    throw new Error(`Invalid product listing payload: ${result.code}`);
  }
  return result.value;
}

function buildProductOrderPayload(input: ProductOrderPayload): ProductOrderPayload {
  const result = validateProductOrderPayload(input);
  if (!result.ok) {
    throw new Error(`Invalid product order payload: ${result.code}`);
  }

  const payload: Partial<ProductOrderPayload> = {
    listingPinId: result.value.listingPinId,
    skuId: result.value.skuId,
  };
  if (input.settlementKind !== undefined) {
    payload.settlementKind = result.value.settlementKind;
  }
  payload.paymentTxid = result.value.paymentTxid;
  if (input.comment !== undefined) {
    payload.comment = result.value.comment;
  }
  return payload as ProductOrderPayload;
}

export function buildProductListingChainWrite(input: {
  payload: ProductListingPayload;
  network?: string;
}) {
  const payload = buildProductListingPayload(input.payload);
  return {
    operation: 'create',
    path: PRODUCT_LISTING_PROTOCOL_PATH,
    payload: JSON.stringify(payload),
    contentType: 'application/json',
    network: normalizeNetwork(input.network),
  };
}

export function buildProductOrderChainWrite(input: {
  payload: ProductOrderPayload;
  network?: string;
}) {
  const payload = buildProductOrderPayload(input.payload);
  return {
    operation: 'create',
    path: PRODUCT_ORDER_PROTOCOL_PATH,
    payload: JSON.stringify(payload),
    contentType: 'application/json',
    network: normalizeNetwork(input.network),
  };
}

export async function publishProductListingToChain(
  input: ProductListingChainWriteInput,
): Promise<ProductChainWriteResult> {
  const payload = buildProductListingPayload(input.payload);
  const chainWrite = await input.signer.writePin({
    operation: 'create',
    path: PRODUCT_LISTING_PROTOCOL_PATH,
    payload: JSON.stringify(payload),
    contentType: 'application/json',
    network: normalizeNetwork(input.network),
  });
  return { payload, chainWrite };
}

export async function publishProductOrderToChain(
  input: ProductOrderChainWriteInput,
): Promise<ProductChainWriteResult> {
  const payload = buildProductOrderPayload(input.payload);
  const chainWrite = await input.signer.writePin({
    operation: 'create',
    path: PRODUCT_ORDER_PROTOCOL_PATH,
    payload: JSON.stringify(payload),
    contentType: 'application/json',
    network: normalizeNetwork(input.network),
  });
  return { payload, chainWrite };
}
