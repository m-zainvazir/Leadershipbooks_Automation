/**
 * lib-shopify.mjs — Shopify Admin API for the two things plans/21 §D needs:
 * creating an author's bundle product, and placing a $0 test order.
 *
 * ⚠ WRITTEN AGAINST THE DOCUMENTED API, NOT YET RUN LIVE. There is no Shopify
 * Admin token in this project (plans/21 §D). Every call is mocked in the tests;
 * the first real run must be watched, and this note removed once it passes.
 *
 * Needs `shared.shopifyShop` (e.g. "get-published-pro.myshopify.com"),
 * `shared.shopifyClientId` and `shared.shopifyClientSecret` in coaches.json —
 * a Dev Dashboard app, see shopifyAccessToken. Scopes:
 *   write_products       create the bundle, set price/SKU/weight, add to collection,
 *                        upload and attach its image
 *   write_publications   publish it to the Online Store
 *   write_draft_orders   the $0 test order
 *   write_orders         CANCEL the test order — see placeTestOrder
 *
 * The network is an injected `gql(query, variables)` so every rule is testable.
 */

export const SHOPIFY_API_VERSION = '2026-07'; // matches the Dev Dashboard app's version, 2026-09-28
export const BUNDLE_COLLECTION = 'coach-bundles';
export const DELIVERED_TAG = 'delivered-manual';

/**
 * Shopify no longer shows an Admin token anywhere (legacy admin-created custom
 * apps were retired). A Dev Dashboard app installed on a store in the SAME
 * organization trades its Client ID + secret for a token on demand — the
 * "client credentials grant". The token lasts 24 hours, so every run mints its
 * own and nothing long-lived is ever stored.
 *
 * `shop_not_permitted` means the app and the store are in different Shopify
 * organizations: recreate the app from inside this store's admin.
 */
export async function shopifyAccessToken({ shop, clientId, clientSecret, fetchImpl = fetch }) {
  const res = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const why = JSON.stringify(body).slice(0, 200);
    throw new Error(`Shopify token exchange ${res.status}: ${why}${/shop_not_permitted/.test(why) ? ' — the app is not in this store\'s organization; create it from this store\'s admin' : ''}`);
  }
  return { token: body.access_token, scope: body.scope || '' };
}

/** The Shopify settings a command needs, and what is missing. */
export function shopifyConfig(shared = {}) {
  const shop = String(shared.shopifyShop || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const missing = [];
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) missing.push('shared.shopifyShop (the store\'s xxx.myshopify.com domain)');
  // Either credential style works. A fixed Admin API token (shpat_…) is what the
  // older "Configuration / API credentials" screen hands out; the Dev Dashboard
  // gives a Client ID + secret instead.
  const adminToken = String(shared.shopifyAdminToken || '').trim();
  if (!adminToken) {
    if (!shared.shopifyClientId) missing.push('shared.shopifyClientId (or shared.shopifyAdminToken)');
    if (!shared.shopifyClientSecret) missing.push('shared.shopifyClientSecret (or shared.shopifyAdminToken)');
  }
  return { shop, adminToken, clientId: shared.shopifyClientId, clientSecret: shared.shopifyClientSecret, missing };
}

export const REQUIRED_SCOPES = ['write_products', 'write_publications', 'write_draft_orders', 'write_orders'];

/** Token (exchanged or fixed) + client + scope check, in one step. */
export async function connectShopify(shared, { fetchImpl = fetch } = {}) {
  const cfg = shopifyConfig(shared);
  if (cfg.missing.length) throw new Error(`Shopify is not configured: ${cfg.missing.join(', ')}`);
  let token = cfg.adminToken;
  let scopes;
  if (token) {
    // A fixed token carries no scope list, so ask the installation itself.
    const gql = makeGql({ shop: cfg.shop, token, fetchImpl });
    const data = await gql('{ currentAppInstallation { accessScopes { handle } } }');
    scopes = data.currentAppInstallation.accessScopes.map((s) => s.handle);
  } else {
    const ex = await shopifyAccessToken({ ...cfg, fetchImpl });
    token = ex.token;
    scopes = ex.scope.split(',').map((x) => x.trim()).filter(Boolean);
  }
  const lacking = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
  return { gql: makeGql({ shop: cfg.shop, token, fetchImpl }), scope: scopes.join(','), lacking, via: cfg.adminToken ? 'admin token' : 'client credentials' };
}

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

/* ------------------------------------------------ selling outside the US --- */

/**
 * Shopify's international selling (Managed Markets) blocks a product in every other
 * country — "Restrictions: 188" in the Products list, "Unsupported regions 188 —
 * Certain products can't be sold" on the product — until it looks like something it
 * can ship and sell. PROVEN on Reinhard Klett's bundle, 2026-10-12, one change at a time:
 *   - category Educational Services + a description:   still 188 (a SERVICE that ships)
 *   - category Print Books:                            still 188
 *   - + a weight (0.95 lb) and country of origin US:   0 — sells abroad
 * So a product that SHIPS gets: Print Books, a description, a weight, origin US — the
 * shape of REVEALED, which reads 0. A product that does NOT ship (the course collection)
 * is a digital item: Educational Services + a description, the shape of the unrestricted
 * "Coached by the Bible + Your Personal AI Coach".
 */
export const PRINT_BOOKS = 'gid://shopify/TaxonomyCategory/me-1-3';
export const EDUCATIONAL_SERVICES = 'gid://shopify/TaxonomyCategory/se-6-2';
export const ORIGIN = 'US';
/** A paperback's weight (REVEALED's) — used when no real weight is given. Change it in Shopify any time. */
export const DEFAULT_WEIGHT = { value: 0.95, unit: 'POUNDS' };
const SERVICE = /^gid:\/\/shopify\/TaxonomyCategory\/se-/;

const html = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const possessive = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/** The bundle's standard description — only what the bundle really gives (the 10-day trial, then $59). */
export function bundleDescription(coach) {
  const a = coach.displayName || coach.name;
  return `<p><strong>${html(coach.bookTitle)}</strong> by ${html(a)}, plus 10 days of your personal BookCoach AI — a coach built on ${html(possessive(a))} teaching that helps you put the book into practice in your own life.</p>`
    + '<p>After the 10 days, you may keep your coach for $59 per month. The book is yours to keep either way.</p>';
}

/**
 * The course collection's standard description. It does NOT promise the coach:
 * buying the collection gives no coach access until plan 02 is built.
 */
export function collectionDescription(coach) {
  const a = coach.displayName || coach.name;
  return `<p><strong>${html(coach.bookTitle)}</strong> — the complete learning system${a ? ` by ${html(a)}` : ''}: the online video course and the book, together.</p>`;
}

/**
 * What an EXISTING product lacks for international selling, and the change that fills
 * it. Mostly only what is missing — a description, a weight, an origin already set
 * are kept. The one thing replaced: a product that SHIPS filed under a SERVICE
 * category (or none) becomes Print Books — the proven cause of "can't be sold".
 * `product` needs: category { id }, descriptionHtml, variants { id price inventoryItem
 * { requiresShipping countryCodeOfOrigin measurement { weight { value } } } }.
 */
export function listingFixes(product, description) {
  const product_ = {};
  const variants = [];
  const missing = [];
  const vs = (product.variants && product.variants.nodes) || [];
  const ships = vs.some((v) => v.inventoryItem && v.inventoryItem.requiresShipping);
  const cat = product.category && product.category.id;
  if (ships && (!cat || SERVICE.test(cat))) { product_.category = PRINT_BOOKS; missing.push(cat ? 'category Print Books (it ships — not a service)' : 'category Print Books'); }
  if (!ships && !cat) { product_.category = EDUCATIONAL_SERVICES; missing.push('category Educational Services'); }
  if (!String(product.descriptionHtml || '').replace(/<[^>]+>/g, '').trim()) { product_.descriptionHtml = description; missing.push('description'); }
  if (ships) {
    for (const v of vs) {
      const it = v.inventoryItem || {};
      const fix = {};
      if (!(it.measurement && it.measurement.weight && Number(it.measurement.weight.value) > 0)) fix.measurement = { weight: DEFAULT_WEIGHT };
      if (!it.countryCodeOfOrigin) fix.countryCodeOfOrigin = ORIGIN;
      if (Object.keys(fix).length) variants.push({ id: v.id, inventoryItem: fix });
    }
    if (variants.some((v) => v.inventoryItem.measurement)) missing.push(`weight ${DEFAULT_WEIGHT.value} lb`);
    if (variants.some((v) => v.inventoryItem.countryCodeOfOrigin)) missing.push(`origin ${ORIGIN}`);
  }
  const notes = vs.length && !vs.some((v) => Number(v.price) > 0) ? ['its price is $0.00 — that alone blocks it abroad; set a price in Shopify'] : [];
  return { change: { product: product_, variants }, missing, notes };
}

/** Apply listingFixes' change to one product. Returns what was changed. */
export async function fixListing(gql, productGid, change) {
  const done = [];
  if (Object.keys(change.product || {}).length) {
    check('productUpdate', (await gql(
      'mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { product { id } userErrors { field message } } }',
      { p: { id: productGid, ...change.product } },
    )).productUpdate);
    done.push(...Object.keys(change.product));
  }
  if ((change.variants || []).length) {
    check('productVariantsBulkUpdate', (await gql(
      'mutation($pid: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $pid, variants: $v) { productVariants { id } userErrors { field message } } }',
      { pid: productGid, v: change.variants },
    )).productVariantsBulkUpdate);
    done.push('weight/origin');
  }
  return done;
}

/**
 * Refusals before any call. SKU and weight are OPTIONAL: delivery goes through
 * IngramSpark, updated by hand, not Shopify shipping (decided 2026-09-29). With no
 * weight given, a paperback's (DEFAULT_WEIGHT) is used — selling abroad needs one.
 * If given, they must still be well-formed.
 */
export function bundleProblems({ coach, price, sku, grams }) {
  const p = [];
  if (coach.shopifyProductId) p.push(`coach ${coach.code} already has shopifyProductId ${coach.shopifyProductId} — this creates, it never edits`);
  if (!coach.bookTitle) p.push('the record has no bookTitle — it is in the product title');
  if (!/^\d+(\.\d{2})?$/.test(String(price || ''))) p.push(`--price "${price}" must look like 29.95`);
  if (sku && !/^BC\d{10,13}$/.test(String(sku))) p.push(`--sku "${sku}" must follow BC<ISBN>, e.g. BC9781951648213`);
  if (grams !== undefined && !(Number(grams) > 0)) p.push('--grams, if given, must be a positive weight');
  return p;
}

/* ------------------------------------------------------- product image --- */

/**
 * The product image: a file on this computer, or a link. Either way the bytes
 * are read HERE, checked, and uploaded to Shopify exactly as they are — never
 * resized or re-encoded, so Shopify keeps the full-size original (its store
 * serves smaller copies from that). Shopify's limits: 20 MB, 20 megapixels.
 */
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_MAX_PIXELS = 20_000_000;
export const IMAGE_HD_SIDE = 2048; // Shopify's recommended size for a product photo (zoom)
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

/** Type and size from the file's own header — the name or a server's say-so is not trusted. */
export function imageInfo(buf) {
  const b = Buffer.from(buf);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { mime: 'image/png', ext: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString('latin1', 0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = b.toString('latin1', 12, 16);
    if (chunk === 'VP8X') return { mime: 'image/webp', ext: 'webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8L') return { mime: 'image/webp', ext: 'webp', width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    if (chunk === 'VP8 ') return { mime: 'image/webp', ext: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }
      // SOF0-SOF15 carry the size; C4 (DHT), C8 (JPG) and CC (DAC) do not.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', ext: 'jpg', width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  return null;
}

/** A path as Windows "Copy as path" gives it: quotes around it are dropped. */
export const cleanImagePath = (p) => String(p || '').trim().replace(/^"(.*)"$/, '$1').trim();

/**
 * A sharing link turned into the file itself, where the host has a known way:
 * Google Drive (…/file/d/<id>/view, open?id=) and Dropbox (dl=0 → dl=1).
 * Anything else is fetched as given.
 */
export function directImageUrl(url) {
  const s = String(url || '').trim();
  const drive = /^https:\/\/drive\.google\.com\/(?:file\/d\/([\w-]+)|open\?id=([\w-]+)|uc\?(?:.*&)?id=([\w-]+))/.exec(s);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1] || drive[2] || drive[3]}`;
  if (/^https:\/\/(www\.)?dropbox\.com\//.test(s)) {
    const u = new URL(s);
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  return s;
}

/**
 * Read the image and check it. Returns { image, problems, notes } — `image` is
 * null when there is a problem. Nothing is uploaded here, so the dry run uses it too.
 */
export async function loadProductImage({ file, url } = {}, { fetchImpl = fetch, readImpl, existsImpl } = {}) {
  const problems = [];
  const notes = [];
  if (file && url) return { image: null, problems: ['give the image as a file OR a link, not both'], notes };
  if (!file && !url) return { image: null, problems: [], notes };
  let bytes;
  let name;
  let source;
  if (file) {
    const path = cleanImagePath(file);
    const fs = await import('node:fs');
    const exists = existsImpl || fs.existsSync;
    const read = readImpl || fs.readFileSync;
    source = path;
    name = path.split(/[\\/]/).pop();
    if (!/^([a-z]:[\\/]|\\\\)/i.test(path)) problems.push(`the image file needs its full path, e.g. C:\\Users\\you\\Pictures\\cover.jpg — got "${path}"`);
    else if (!IMAGE_EXT.test(path)) problems.push(`the image file must be .jpg, .png, .webp or .gif — got "${name}"`);
    else if (!exists(path)) problems.push(`no file at ${path}`);
    else bytes = read(path);
  } else {
    source = String(url).trim();
    if (!/^https?:\/\//i.test(source)) return { image: null, problems: [`the image link must start with https:// — got "${source}"`], notes };
    const direct = directImageUrl(source);
    if (direct !== source) notes.push(`sharing link → fetched as ${direct}`);
    try {
      const res = await fetchImpl(direct, { redirect: 'follow', headers: { accept: 'image/*' } });
      if (!res.ok) throw new Error(`the link answered ${res.status}`);
      const len = Number(res.headers && res.headers.get && res.headers.get('content-length'));
      if (len > IMAGE_MAX_BYTES) throw new Error(`the image is ${(len / 1048576).toFixed(1)} MB — Shopify takes at most 20 MB`);
      bytes = Buffer.from(await res.arrayBuffer());
      name = decodeURIComponent(new URL(res.url || direct).pathname.split('/').pop() || '') || 'product-image';
    } catch (err) {
      problems.push(`could not download the image: ${err.message}`);
    }
  }
  if (problems.length) return { image: null, problems, notes };
  const info = imageInfo(bytes);
  if (!info) {
    const page = /^\s*</.test(Buffer.from(bytes).toString('utf8', 0, 200));
    problems.push(page
      ? 'that link opens a web page, not the picture itself — open the picture, right-click it → "Copy image address", and paste that'
      : 'that is not a JPG, PNG, WebP or GIF image');
    return { image: null, problems, notes };
  }
  if (bytes.length > IMAGE_MAX_BYTES) problems.push(`the image is ${(bytes.length / 1048576).toFixed(1)} MB — Shopify takes at most 20 MB`);
  if (info.width * info.height > IMAGE_MAX_PIXELS) problems.push(`the image is ${info.width} × ${info.height} — Shopify takes at most 20 megapixels (e.g. 4472 × 4472)`);
  if (Math.max(info.width, info.height) < IMAGE_HD_SIDE) {
    notes.push(`the image is ${info.width} × ${info.height} — smaller than Shopify's recommended ${IMAGE_HD_SIDE} px, so it may look soft when zoomed. It will still be uploaded at that size`);
  }
  if (problems.length) return { image: null, problems, notes };
  // Shopify names the stored file after this; keep the original name, with the right extension.
  const filename = `${name.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'product-image'}.${info.ext}`;
  return { image: { bytes, ...info, filename, source }, problems, notes };
}

/** One line for the dry run and the log. */
const fileSize = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const describeImage = (img) => `${img.filename}  ${img.width} × ${img.height} ${img.ext.toUpperCase()}, ${fileSize(img.bytes.length)} — uploaded as is, full size`;

/**
 * Upload the bytes to Shopify's own storage (a staged upload) and return the
 * address productCreate takes as the media's source. No product exists yet, so
 * a failure here leaves nothing behind in the store.
 */
export async function stageImage(gql, img, { fetchImpl = fetch } = {}) {
  const staged = check('stagedUploadsCreate', (await gql(
    `mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) {
       stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`,
    { input: [{ resource: 'IMAGE', filename: img.filename, mimeType: img.mime, httpMethod: 'POST', fileSize: String(img.bytes.length) }] },
  )).stagedUploadsCreate);
  const target = staged.stagedTargets[0];
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([img.bytes], { type: img.mime }), img.filename); // the file goes last
  const res = await fetchImpl(target.url, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`image upload: Shopify's storage answered ${res.status}`);
  return target.resourceUrl;
}

/**
 * Shopify processes an image after the product is made. Wait for it (up to
 * ~60 s) and say how it ended — READY with its size, FAILED with the reason.
 */
export async function waitForImage(gql, productGid, { tries = 30, delayMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), before = [] } = {}) {
  let last = { status: 'UNKNOWN' };
  for (let i = 0; i < tries; i++) {
    const data = await gql(
      `query($id: ID!) { product(id: $id) { media(first: 50) { nodes { id status mediaErrors { message details }
         ... on MediaImage { image { width height } } } } } }`,
      { id: productGid },
    );
    // `before`: the media the product already had — the new image is the one not among them.
    const m = ((data.product && data.product.media.nodes) || []).find((n) => !before.includes(n.id));
    if (m) {
      last = { status: m.status, width: m.image && m.image.width, height: m.image && m.image.height, errors: (m.mediaErrors || []).map((e) => e.details || e.message) };
      if (m.status === 'READY' || m.status === 'FAILED') return last;
    }
    if (i < tries - 1) await sleep(delayMs);
  }
  return last;
}

/** An existing product's title and the media it has now — null if Shopify has no such product. Read only. */
export async function productMedia(gql, productId) {
  const data = await gql(
    'query($id: ID!) { product(id: $id) { title media(first: 50) { nodes { id } } } }',
    { id: `gid://shopify/Product/${numericId(productId)}` },
  );
  if (!data.product) return null;
  return { title: data.product.title, mediaIds: data.product.media.nodes.map((n) => n.id) };
}

/**
 * Add the image to a product that ALREADY exists (made by hand, or before
 * images were uploaded here). Only the image is added: the title, price and
 * everything else on the product stay as they are. Placed after any images it
 * already has. Returns how Shopify's processing ended, as waitForImage does.
 */
export async function addProductImage(gql, { productId, image }, { fetchImpl = fetch, mediaWait = {} } = {}) {
  const gid = `gid://shopify/Product/${numericId(productId)}`;
  const now = await productMedia(gql, productId);
  if (!now) throw new Error(`product ${productId} is not in Shopify — check the product id saved for this author`);
  const source = await stageImage(gql, image, { fetchImpl });
  check('productUpdate', (await gql(
    `mutation($product: ProductUpdateInput!, $media: [CreateMediaInput!]) { productUpdate(product: $product, media: $media) {
       product { id } userErrors { field message } } }`,
    { product: { id: gid }, media: [{ originalSource: source, mediaContentType: 'IMAGE', alt: now.title }] },
  )).productUpdate);
  return waitForImage(gql, gid, { ...mediaWait, before: now.mediaIds });
}

/** Published to the Online Store, or the Zipify cart link 404s. */
async function publishOnlineStore(gql, productGid) {
  const pubs = (await gql('{ publications(first: 20) { nodes { id name } } }')).publications.nodes;
  const store = pubs.find((x) => x.name === 'Online Store');
  if (!store) throw new Error(`no "Online Store" publication among: ${pubs.map((x) => x.name).join(', ')}`);
  check('publishablePublish', (await gql(
    `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`,
    { id: productGid, input: [{ publicationId: store.id }] },
  )).publishablePublish);
}

/* ------------------------------------------------- the course collection --- */

/**
 * The optional Course Collection product (checklist step "Course Collection +
 * Bundle Image", decided 2026-10-12): the course and the book together.
 *
 * 🚨 Kept apart from the coach bundle ON PURPOSE: never tagged coach-bundles,
 * never in that collection, and its id is recorded as collectionProductId —
 * never shopifyProductId. The Worker starts a trial for an order whose product
 * is an author's shopifyProductId, so this product starts nothing (plan 02 is
 * what would give it three months of the coach).
 */
export const COLLECTION_PRICE = '97.00';
export const COLLECTION_TYPE = 'Course Collection';
export const collectionTitle = (coach) => `${coach.bookTitle} - Collection Bundle`;

export function collectionProblems({ coach, price }) {
  const p = [];
  if (coach.collectionProductId) p.push(`coach ${coach.code} already has collectionProductId ${coach.collectionProductId} — this creates, it never edits`);
  if (!coach.bookTitle) p.push('the record has no bookTitle — it is in the product title');
  if (!/^\d+(\.\d{2})?$/.test(String(price || ''))) p.push(`--price "${price}" must look like 97.00`);
  return p;
}

/**
 * Create, price and publish the collection product, with its image, its category
 * and a standard description (both needed to sell abroad), inventory NOT tracked,
 * no shipping address asked. Same shape and
 * same failure rules as createBundle: `.created` on an error, the image last.
 */
export async function createCollectionProduct(gql, { coach, price = COLLECTION_PRICE, image }, { fetchImpl = fetch, mediaWait = {} } = {}) {
  const created = {};
  try {
    const title = collectionTitle(coach);
    const media = image ? [{ originalSource: await stageImage(gql, image, { fetchImpl }), mediaContentType: 'IMAGE', alt: title }] : [];
    const made = check('productCreate', (await gql(
      `mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) { productCreate(product: $product, media: $media) {
         product { id handle variants(first: 1) { nodes { id } } } userErrors { field message } } }`,
      { product: { title, status: 'ACTIVE', productType: COLLECTION_TYPE, category: EDUCATIONAL_SERVICES, descriptionHtml: collectionDescription(coach) }, media },
    )).productCreate);
    const product = made.product;
    created.productId = numericId(product.id);
    created.handle = product.handle;
    const variantGid = product.variants.nodes[0].id;
    created.variantId = numericId(variantGid);

    check('productVariantsBulkUpdate', (await gql(
      `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) {
         productVariants { id } userErrors { field message } } }`,
      { productId: product.id, variants: [{ id: variantGid, price: String(price), inventoryItem: { tracked: false, requiresShipping: false } }] },
    )).productVariantsBulkUpdate);

    await publishOnlineStore(gql, product.id);
    created.published = true;
    if (image) {
      try {
        created.image = await waitForImage(gql, product.id, mediaWait);
      } catch (err) {
        created.image = { status: 'UNKNOWN', errors: [err.message] };
      }
    }
    return created;
  } catch (err) {
    err.created = created;
    throw err;
  }
}

/**
 * Create, price, publish and collect the bundle. Returns numeric ids.
 * On failure the error carries `.created` so a half-made product is never a mystery.
 * `image` (from loadProductImage) is uploaded BEFORE the product is made and
 * attached as it is created. If Shopify then fails to process it, the product
 * still stands and its ids are still returned — `created.image` says what happened.
 */
export async function createBundle(gql, { coach, price, sku, grams, image }, { fetchImpl = fetch, mediaWait = {} } = {}) {
  const created = {};
  const fail = (err) => {
    err.created = created;
    throw err;
  };
  try {
    const media = image ? [{ originalSource: await stageImage(gql, image, { fetchImpl }), mediaContentType: 'IMAGE', alt: bundleTitle(coach) }] : [];
    const made = check('productCreate', (await gql(
      `mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) { productCreate(product: $product, media: $media) {
         product { id handle variants(first: 1) { nodes { id } } } userErrors { field message } } }`,
      { product: { title: bundleTitle(coach), status: 'ACTIVE', productType: 'Book + AI Coach', tags: [BUNDLE_COLLECTION], category: PRINT_BOOKS, descriptionHtml: bundleDescription(coach) }, media },
    )).productCreate);
    const product = made.product;
    created.productId = numericId(product.id);
    created.handle = product.handle;
    const variantGid = product.variants.nodes[0].id;
    created.variantId = numericId(variantGid);

    check('productVariantsBulkUpdate', (await gql(
      `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) {
         productVariants { id } userErrors { field message } } }`,
      {
        productId: product.id,
        variants: [{
          id: variantGid,
          price: String(price),
          inventoryItem: {
            requiresShipping: true, // a physical book, even though IngramSpark ships it
            ...(sku ? { sku } : {}),
            // A weight and an origin: without them Shopify will not sell it abroad (proven 2026-10-12).
            measurement: { weight: grams ? { value: Number(grams), unit: 'GRAMS' } : DEFAULT_WEIGHT },
            countryCodeOfOrigin: ORIGIN,
          },
        }],
      },
    )).productVariantsBulkUpdate);

    await publishOnlineStore(gql, product.id);
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
    // Last, so a slow or failed image never stands between the product and its ids being recorded.
    if (image) {
      try {
        created.image = await waitForImage(gql, product.id, mediaWait);
      } catch (err) {
        created.image = { status: 'UNKNOWN', errors: [err.message] };
      }
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
