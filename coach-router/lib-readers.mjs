/**
 * lib-readers.mjs — every live READ the tooling makes, in one place.
 *
 * `npm run author`, `npm run pipeline`, the dashboard and the health job all
 * build their `ctx` here, so a reader is written once and every view agrees.
 * Plan: ghl-shopify subscription/plans/22-pipeline-dashboard.md §3.
 *
 * READ-ONLY BY CONSTRUCTION. `ghl()` refuses anything but GET and the one
 * search POST; nothing here writes to GHL, Shopify, Voiceflow or KV.
 *
 * KV BUDGET (plan 22 rule 2). The free plan allows 1,000 KV list calls a day
 * and the Worker's own cron spends ~384 of them. Nothing in this file lists KV.
 * `kvGet` is a single key read, used only by `author status --deep`.
 *
 * Results are cached for `ttlMs` (default: for the life of the process — a CLI
 * run). The dashboard passes a TTL and calls `clear()` on Refresh.
 */

import { execFileSync } from 'node:child_process';
import { HERE } from './lib-config.mjs';
import { connectShopify, shopifyConfig } from './lib-shopify.mjs';

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const GHL_PAGE = 100;
const GHL_MAX_PAGES = 200;

export function makeReaders(shared, { ttlMs = Infinity, fetchImpl = fetch } = {}) {
  const cache = new Map();
  const memo = (key, fn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = Promise.resolve().then(fn);
    cache.set(key, { at: Date.now(), value });
    // A failed read must not be cached: the next refresh should try again.
    value.catch(() => cache.delete(key));
    return value;
  };
  const workerUrl = String(shared.workerUrl || '').replace(/\/+$/, '');

  async function fetchText(url) {
    return memo(`page:${url}`, async () => {
      const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      return { status: res.status, text: res.ok ? await res.text() : '' };
    });
  }

  /** Every product in Shopify's public catalogue. No token needed. */
  function catalog() {
    return memo('catalog', async () => {
      const map = new Map();
      for (let page = 1; page <= 40; page++) {
        const r = await fetchImpl(`https://leadershipbooks.com/products.json?limit=250&page=${page}`, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error(`Shopify products.json ${r.status}`);
        const { products = [] } = await r.json();
        for (const p of products) map.set(String(p.id), p);
        if (products.length < 250) break;
      }
      return map;
    });
  }

  // `version`: the Courses API answers only to Version v3 (plans/03 in the dashboard).
  async function ghl(path, { method = 'GET', body = null, version = GHL_VERSION } = {}) {
    // Read-only by construction: the only POST is contacts/search.
    if (method !== 'GET' && path !== '/contacts/search') throw new Error(`readers refuse to ${method} ${path}`);
    const key = `ghl:${version}:${method}:${path}:${body ? JSON.stringify(body) : ''}`;
    return memo(key, async () => {
      const res = await fetchImpl(`${GHL_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${shared.ghlApiToken}`,
          Version: version,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`GHL ${res.status} on ${path.split('?')[0]}`);
      return res.json();
    });
  }

  /** The Worker's /health, with the token (so it carries the per-coach detail). */
  function health() {
    return memo('health', async () => {
      const r = await fetchImpl(`${workerUrl}/health`, { headers: { 'x-health-token': shared.healthToken || '' }, signal: AbortSignal.timeout(20000) });
      const body = await r.json().catch(() => null);
      // 503 is a real answer ("something is wrong"), not a failed read — keep the body.
      if (!body) throw new Error(`/health ${r.status} with no JSON body`);
      return { ...body, httpStatus: r.status };
    });
  }

  /** One KV key, via wrangler. A READ — never a list. Only `--deep` uses it. */
  function kvGet(key) {
    const IS_WIN = process.platform === 'win32';
    try {
      return JSON.parse(execFileSync(IS_WIN ? 'npx.cmd' : 'npx', ['wrangler', 'kv', 'key', 'get', key, '--binding=COACH_KV', '--remote', '--preview=false'], {
        cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: IS_WIN,
      }));
    } catch {
      return null;
    }
  }

  /**
   * Every contact matching `filters`, all pages, with custom fields as a map.
   * Throws on a truncated result rather than returning a short list — a missing
   * contact reads exactly like a healthy one (the Worker's rule, 2026-09-22).
   */
  async function searchAll(filters) {
    return memo(`search:${JSON.stringify(filters)}`, async () => {
      const out = [];
      let cursor = null;
      for (let page = 0; page < GHL_MAX_PAGES; page++) {
        const body = { locationId: shared.ghlLocationId, pageLimit: GHL_PAGE, filters, ...(cursor ? { searchAfter: cursor } : {}) };
        const res = await fetchImpl(`${GHL_API}/contacts/search`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${shared.ghlApiToken}`, Version: GHL_VERSION, accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`GHL ${res.status} on contacts/search`);
        const data = await res.json().catch(() => ({}));
        const batch = Array.isArray(data.contacts) ? data.contacts : [];
        for (const c of batch) {
          if (!c || !c.id) continue;
          const fields = {};
          for (const f of c.customFields || []) if (f && f.id) fields[f.id] = f.value;
          out.push({ id: c.id, email: c.email || '', tags: Array.isArray(c.tags) ? c.tags : [], fields, dateAdded: c.dateAdded || '' });
        }
        if (batch.length < GHL_PAGE) return out;
        cursor = batch[batch.length - 1] && batch[batch.length - 1].searchAfter;
        if (!cursor) return out;
      }
      throw new Error(`more than ${GHL_MAX_PAGES * GHL_PAGE} contacts matched — refusing a truncated census`);
    });
  }

  /** Every contact holding ANY of `tags` — one paginated query (an array ORs). */
  const census = (tags) => searchAll([{ field: 'tags', operator: 'contains', value: [...new Set(tags.filter(Boolean))].sort() }]);

  /** Every contact whose custom field `fieldId` equals `value`. Proven 2026-10-02. */
  const byField = (fieldId, value) => searchAll([{ field: `customFields.${fieldId}`, operator: 'eq', value }]);

  /**
   * Currently-paying subscriptions, through the Worker's OWN reader — so this
   * tool and the reconcile can never disagree about what "active" means.
   */
  function subscriptions({ allowTest = false } = {}) {
    return memo(`subs:${allowTest}`, async () => {
      const { __test } = await import('./coach-router.worker.js');
      return __test.ghlActiveSubscriptions({ GHL_API_TOKEN: shared.ghlApiToken, GHL_LOCATION_ID: shared.ghlLocationId }, { allowTest });
    });
  }

  /** GHL's workflow list: name + status. Needs workflows.readonly. */
  function workflows() {
    return memo('workflows', async () => (await ghl(`/workflows/?locationId=${encodeURIComponent(shared.ghlLocationId)}`)).workflows || []);
  }

  /**
   * Shopify orders created since `since` (ISO date), newest first, with what the
   * health checks need. Needs the Admin app (write_orders implies read). Orders
   * older than 60 days need read_all_orders, so callers keep the window short.
   */
  function shopifyOrders({ since }) {
    return memo(`orders:${since}`, async () => {
      if (shopifyConfig(shared).missing.length) throw new Error('Shopify is not configured');
      const { gql } = await connectShopify(shared, { fetchImpl });
      const out = [];
      let after = null;
      for (let page = 0; page < 20; page++) {
        const data = await gql(
          `query($q: String!, $after: String) { orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
             pageInfo { hasNextPage endCursor }
             nodes { id name createdAt updatedAt tags cancelledAt displayFinancialStatus
                     lineItems(first: 25) { nodes { product { legacyResourceId } } } } } }`,
          { q: `created_at:>=${since}`, after },
        );
        const o = data.orders;
        for (const n of o.nodes) {
          out.push({
            id: n.id, name: n.name, createdAt: n.createdAt, updatedAt: n.updatedAt, tags: n.tags || [],
            cancelledAt: n.cancelledAt, financial: n.displayFinancialStatus,
            productIds: (n.lineItems.nodes || []).map((li) => li.product && String(li.product.legacyResourceId)).filter(Boolean),
          });
        }
        if (!o.pageInfo.hasNextPage) return out;
        after = o.pageInfo.endCursor;
      }
      throw new Error('more than 2,000 orders in the window — narrow it rather than read a truncated list');
    });
  }

  return {
    fetchText, catalog, ghl, health, kvGet, census, byField, subscriptions, workflows, shopifyOrders,
    locationId: shared.ghlLocationId,
    clear: () => cache.clear(),
  };
}
