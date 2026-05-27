import type { ProductListingPayload } from '../../../core/products/productTypes';
export interface ProductCommerceRowViewModel {
    listingPinId: string;
    title: string;
    sellerLabel: string;
    onlineStateLabel: string;
    skuCountLabel: string;
    firstPriceLabel: string;
    coverPreviewUri: string;
    canPurchase: boolean;
    blockedReason: string;
}
export interface ProductCommerceSkuViewModel {
    skuId: string;
    name: string;
    priceLabel: string;
    stockLabel: string;
    imagePreviewUri: string;
    descriptionLabel: string;
}
export interface ProductCommerceOrderRowViewModel {
    orderId: string;
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    roleLabel: string;
    stateLabel: string;
    paymentTxid: string;
    orderTxid: string;
    deliveryLabel: string;
    buyerLabel: string;
    sellerLabel: string;
    createdAtLabel: string;
    updatedAtLabel: string;
}
export interface ProductCommerceOwnedListingViewModel {
    listingPinId: string;
    title: string;
    skuCountLabel: string;
    fulfillmentSkillsLabel: string;
    stateLabel: string;
}
export interface ProductCommerceOrderInspectViewModel {
    orderId: string;
    productOrderPinId: string;
    listingPinId: string;
    skuId: string;
    roleLabel: string;
    stateLabel: string;
    paymentVerificationLabel: string;
    paymentTxid: string;
    fulfillmentSkillsLabel: string;
    selectedSkuLabel: string;
    traceLabel: string;
    sessionLabel: string;
    traceUrl: string;
    deliveryPinId: string;
    deliverySummaryLabel: string;
    failureReason: string;
}
export interface ProductCommerceListingFormInput {
    name?: unknown;
    title?: unknown;
    coverImage?: unknown;
    galleryImages?: unknown;
    descriptionContentType?: unknown;
    description?: unknown;
    fulfillmentSkills?: unknown;
    fulfillmentType?: unknown;
    deliveryEndpoint?: unknown;
    estimatedDeliverySeconds?: unknown;
    deliverableDescription?: unknown;
    skuId?: unknown;
    skuName?: unknown;
    skuImage?: unknown;
    skuDescriptionContentType?: unknown;
    skuDescription?: unknown;
    priceAmount?: unknown;
    priceCurrency?: unknown;
    initialStock?: unknown;
    skus?: unknown;
}
export interface ProductCommercePurchaseSelectionInput {
    listingPinId?: unknown;
    skuId?: unknown;
    spendCap?: unknown;
    comment?: unknown;
}
export interface ProductCommercePageViewModel {
    productRows: ProductCommerceRowViewModel[];
    selectedProductRow: ProductCommerceRowViewModel | null;
    selectedSkuRows: ProductCommerceSkuViewModel[];
    purchasePreviewRequest: {
        confirmed: false;
        listingPinId: string;
        skuId: string;
        spendCap: string;
        comment?: string;
    } | null;
    listingPreviewPayload: ProductListingPayload | null;
    ownedListingRows: ProductCommerceOwnedListingViewModel[];
    orderRows: ProductCommerceOrderRowViewModel[];
    orderInspect: ProductCommerceOrderInspectViewModel | null;
    fulfillmentLabel: string;
}
export declare function buildProductCommercePageViewModel(input: {
    products?: unknown;
    selectedListing?: unknown;
    selectedSku?: unknown;
    purchaseSelection?: unknown;
    listingForm?: ProductCommerceListingFormInput | null;
    ownedListings?: unknown;
    orderRows?: unknown;
    orderInspect?: unknown;
    skillCatalog?: unknown;
}): ProductCommercePageViewModel;
export declare function buildProductCommercePageViewModelRuntimeSource(): string;
