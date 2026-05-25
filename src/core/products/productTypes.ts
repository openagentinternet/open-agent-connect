export type ProductType = 'virtual' | 'physical';
export type ProductFulfillmentType = 'digital_delivery' | 'physical_shipping';
export type ProductDeliveryEndpoint = 'simplemsg' | 'logistics';
export type ProductSettlementKind = 'native';
export type ProductOrderRole = 'buyer' | 'seller';
export type ProductOrderState =
  | 'created'
  | 'payment_pending'
  | 'paid'
  | 'notified'
  | 'accepted'
  | 'fulfilling'
  | 'delivered'
  | 'failed'
  | 'closed';

export interface ProductPrice {
  amount: string;
  currency: string;
}

export interface ProductSku {
  skuId: string;
  name: string;
  image: string;
  descriptionContentType: string;
  description: string;
  price: ProductPrice;
  initialStock: number;
}

export interface ProductFulfillment {
  fulfillmentType: ProductFulfillmentType;
  deliveryEndpoint: ProductDeliveryEndpoint;
  fulfillmentSkills: string[];
  estimatedDeliverySeconds?: number;
  deliverableDescription?: string;
}

export interface ProductListingPayload {
  name: string;
  title: string;
  productType: ProductType;
  coverImage: string;
  galleryImages?: string[];
  descriptionContentType: string;
  description: string;
  fulfillment: ProductFulfillment;
  skus: ProductSku[];
}

export interface ProductOrderPayload {
  listingPinId: string;
  skuId: string;
  settlementKind?: ProductSettlementKind;
  paymentTxid: string;
  comment?: string;
}

export interface ProductDirectoryItem {
  listingPinId: string;
  listing: ProductListingPayload;
  sellerMetaId?: string;
  sellerName?: string;
  sellerAvatar?: string;
  online: boolean;
  updatedAt?: string;
}

export interface ProductPurchaseRequest {
  listingPinId?: string;
  query?: string;
  skuId?: string;
  maxAmount?: string;
  currency?: string;
  comment?: string;
  confirmed?: boolean;
}

export interface ProductPurchaseConfirmation {
  listingPinId: string;
  skuId: string;
  productTitle: string;
  skuName: string;
  price: ProductPrice;
  fulfillmentType: ProductFulfillmentType;
  sellerName?: string;
}

export interface ProductBuyerOrder {
  role: 'buyer';
  state: ProductOrderState;
  productOrderPinId?: string;
  listingPinId: string;
  skuId: string;
  paymentTxid?: string;
  orderTxid?: string;
  sellerMetaId?: string;
  buyerMetaId?: string;
  traceId?: string;
  sessionId?: string;
  deliverySummary?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSellerOrder {
  role: 'seller';
  state: ProductOrderState;
  productOrderPinId: string;
  listingPinId: string;
  skuId: string;
  paymentTxid: string;
  orderTxid?: string;
  buyerMetaId?: string;
  paymentVerified?: boolean;
  fulfillmentSkills: string[];
  deliveryPinId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}
