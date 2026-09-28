/**
 * lib-shopify.mjs — Shopify Admin API for the two things plans/21 §D needs:
 * creating an author's bundle product, and placing a $0 test order.
 *
 * ⚠ WRITTEN AGAINST THE DOCUMENTED API, NOT YET RUN LIVE. There is no Shopify
 * Admin token in this project (plans/21 §D). Every call is mocked in the tests;
 * the first real run must be watched, and this note removed once it passes.
 *
 * Needs `shared.shopifyAdminToken` and `shared.shopifyShop`
 * (e.g. "get-published-pro.myshopify.com") in coaches.json. Scopes:
 *   write_products       create the bundle, set price/SKU/weight, add to collection
 *   write_publications   publish it to the Online Store
 *   write_draft_orders   the $0 test order
 *   write_orders         CANCEL the test order — see placeTestOrder
 *
 * The network is an injected `gql(query, variables)` so every rule is testable.
 */

export const SHOPIFY_API_VERSION = '2025-07';
export const BUNDLE_COLLECTION = 'coach-bundles';
export const DELIVERED_TAG = 'delivered-manual';

/** A GraphQL client that throws on transport errors AND on userErrors. */
export function makeGql({ shop, token, fetchImpl = fetch }) {
  return async (query, variables = {}) => {
    const res = await fetchImpl(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.errors) throw new Error(`Shopify ${res.status}: ${JSON.stringify(body.errors || body).slice(0, 300)}`);
    return body.data;
  };
}

/** userErrors are a 200 with a list; surface them as a throw naming the step. */
function check(step, payload) {
  const errs = (payload && payload.userErrors) || [];
  if (errs.length) throw new Error(`${step}: ${errs.map((e) => `${(e.field || []).join('.')} ${e.message}`).join('; ')}`);
  return payload;
}

const numericId = (gid) => String(gid || '').split('/').pop();

/** The bundle title convention, plans/20 §7b-bis. */
export const bundleTitle = (coach) => `${coach.bookTitle} [${coach.displayName || coach.name}] + Your Personal AI Coach`;

/** Refusals before any call. SKU and weight are required: runbook §3. */
export function bundleProblems({ coach, price, sku, grams }) {
  const p = [];
  if (coach.shopifyProductId) p.push(`coach ${coach.code} already has shopifyProductId ${coach.shopifyProductId} — this creates, it never edits`);
  if (!coach.bookTitle) p.push('the record has no bookTitle — it is in the product title');
  if (!/^\d+(\.\d{2})?$/.test(String(price || ''))) p.push(`--price "${price}" must look like 29.95`);
  if (!/^BC\d{10,13}$/.test(String(sku || ''))) p.push(`--sku "${sku || ''}" must follow BC<ISBN>, e.g. BC9781951648213`);
  if (!(Number(grams) > 0)) p.push('--grams must be the real shipping weight — 0 breaks carrier-calculated rates');
  return p;
}

/**
 * Create, price, publish and collect the bundle. Returns numeric ids.
 * On failure the error carries `.created` so a half-made product is never a mystery.
 */
export async function createBundle(gql, { coach, price, sku, grams }) {
  const created = {};
  const fail = (err) => {
    err.created = created;
    throw err;
  };
  try {
    const made = check('productCreate', (await gql(
      `mutation($product: ProductCreateInput!) { productCreate(product: $product) {
         product { id handle variants(first: 1) { nodes { id } } } userErrors { field message } } }`,
      { product: { title: bundleTitle(coach), status: 'ACTIVE', productType: 'Book + AI Coach', tags: [BUNDLE_COLLECTION] } },
    )).productCreate);
    const product = made.product;
    created.productId = numericId(product.id);
    created.handle = product.handle;
    const variantGid = product.variants.nodes[0].id;
    created.variantId = numericId(variantGid);

    check('productVariantsBulkUpdate', (await gql(
      `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) {
         productVariants { id } userErrors { field message } } }`,
      { productId: product.id, variants: [{ id: variantGid, price: String(price), inventoryItem: { sku, requiresShipping: true, measurement: { weight: { value: Number(grams), unit: 'GRAMS' } } } }] },
    )).productVariantsBulkUpdate);

    // Published to the Online Store, or the Zipify cart link 404s.
    const pubs = (await gql('{ publications(first: 20) { nodes { id name } } }')).publications.nodes;
    const store = pubs.find((x) => x.name === 'Online Store');
    if (!store) throw new Error(`no "Online Store" publication among: ${pubs.map((x) => x.name).join(', ')}`);
    check('publishablePublish', (await gql(
      `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`,
      { id: product.id, input: [{ publicationId: store.id }] },
    )).publishablePublish);
    created.published = true;

    // The coach-bundles collection is insurance, not the mechanism (plans/20 §4.2).
    const cols = (await gql(`{ collections(first: 1, query: "handle:${BUNDLE_COLLECTION}") { nodes { id } } }`)).collections.nodes;
    if (cols.length) {
      check('collectionAddProducts', (await gql(
        `mutation($id: ID!, $productIds: [ID!]!) { collectionAddProducts(id: $id, productIds: $productIds) { userErrors { field message } } }`,
        { id: cols[0].id, productIds: [product.id] },
      )).collectionAddProducts);
      created.collection = BUNDLE_COLLECTION;
    }
    return created;
  } catch (err) {
    return fail(err);
  }
}

/**
 * A $0 order for one bundle, tagged `delivered-manual`.
 *
 * Why this exercises Flow B for real: Flow B triggers on ORDER CREATED and
 * checks for `delivered-manual`. A draft carrying that tag, completed, creates
 * exactly such an order — no "Run workflow" click needed.
 *
 * 🚨 THE ORDER MUST THEN BE CANCELLED (cancelTestOrder). Flow A also fires, on
 * Order paid, and starts a 21-day Wait. 21 days later its guard checks
 * `cancelledAt is empty` — an uncancelled test order passes, POSTs to the
 * Worker, and re-creates the deleted test contact with a live trial.
 */
export async function placeTestOrder(gql, { variantId, email, note }) {
  const draft = check('draftOrderCreate', (await gql(
    `mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } userErrors { field message } } }`,
    {
      input: {
        email,
        tags: [DELIVERED_TAG, 'coach-test'],
        note: note || 'verify-author test order — cancel, do not fulfil',
        lineItems: [{ variantId: `gid://shopify/ProductVariant/${variantId}`, quantity: 1 }],
        appliedDiscount: { valueType: 'PERCENTAGE', value: 100, title: 'verify-author' },
      },
    },
  )).draftOrderCreate);
  const done = check('draftOrderComplete', (await gql(
    `mutation($id: ID!) { draftOrderComplete(id: $id, paymentPending: false) { draftOrder { order { id name tags } } userErrors { field message } } }`,
    { id: draft.draftOrder.id },
  )).draftOrderComplete);
  const order = done.draftOrder.order;
  return { orderGid: order.id, orderId: numericId(order.id), orderName: order.name, tags: order.tags || [] };
}

/** Cancel without notifying, refunding ($0) or restocking a physical book that never shipped. */
export async function cancelTestOrder(gql, orderGid) {
  const res = (await gql(
    `mutation($orderId: ID!) { orderCancel(orderId: $orderId, reason: OTHER, refund: false, restock: true, notifyCustomer: false, staffNote: "verify-author test order") {
       orderCancelUserErrors { field message } } }`,
    { orderId: orderGid },
  )).orderCancel;
  // orderCancel names its error list differently from every other mutation.
  check('orderCancel', { userErrors: (res && res.orderCancelUserErrors) || [] });
  return true;
}
