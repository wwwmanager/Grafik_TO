import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SETTLEMENT_CACHE_LIMIT,
  clearSettlementCache,
  loadSelectedRegionSettlements,
  loadSettlements,
  loadSettlementsWithStatus,
} from '../src/modules/address.js';
import { REGION_NO_DATA_HINT } from '../src/modules/ui.js';

const UI_PATH = fileURLToPath(new URL('../src/modules/ui.js', import.meta.url));

function settlementFor(dataId) {
  return [
    {
      name: `НП ${dataId}`,
      type: 'village',
      municipality: `Район ${dataId}`,
      lat: 55 + dataId / 1000,
      lon: 60 + dataId / 1000,
    },
  ];
}

function okResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

function notFoundResponse() {
  return { ok: false, status: 404, json: async () => ({}) };
}

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    return handler(target);
  };
  return calls;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  clearSettlementCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearSettlementCache();
});

describe('settlement loader: lazy and de-duplicated (GRAFIK-43)', () => {
  it('fetches nothing before a region is selected', async () => {
    const calls = stubFetch(() => okResponse(settlementFor(74)));
    const spy = async () => ({ settlements: [], failed: [] });
    expect(await loadSelectedRegionSettlements('', { loader: spy })).toEqual({
      settlements: [],
      failed: [],
    });
    expect(await loadSelectedRegionSettlements(null, { loader: spy })).toEqual({
      settlements: [],
      failed: [],
    });
    expect(await loadSelectedRegionSettlements(undefined, { loader: spy })).toEqual({
      settlements: [],
      failed: [],
    });
    expect(calls).toHaveLength(0);
  });

  it('loads exactly once per region and reuses the cached entry', async () => {
    const calls = stubFetch(() => okResponse(settlementFor(74)));
    const first = await loadSettlements([74]);
    const second = await loadSettlements([74]);
    expect(calls).toHaveLength(1);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(calls[0]).toContain('data/settlements/74.json');
  });

  it('collapses two concurrent calls for the same region into one fetch', async () => {
    let resolveFetch;
    const gate = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const calls = stubFetch(() => gate.then(() => okResponse(settlementFor(74))));
    const pending = Promise.all([loadSettlements([74]), loadSettlements([74])]);
    resolveFetch();
    const [a, b] = await pending;
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it('reports a 404 as failed[] without throwing and keeps other regions', async () => {
    const calls = stubFetch((url) =>
      url.includes('/95.json') ? notFoundResponse() : okResponse(settlementFor(74)),
    );
    const { settlements, failed } = await loadSettlementsWithStatus([74, 95]);
    expect(calls).toHaveLength(2);
    expect(settlements).toHaveLength(1);
    expect(failed).toEqual([{ dataId: 95, reason: expect.stringContaining('404') }]);
    // The legacy array API still resolves and never throws.
    expect(await loadSettlements([95])).toEqual([]);
  });

  it('dedupes concurrent failing requests too', async () => {
    const calls = stubFetch(() => notFoundResponse());
    const [a, b] = await Promise.all([
      loadSettlementsWithStatus([95]),
      loadSettlementsWithStatus([95]),
    ]);
    expect(calls).toHaveLength(1);
    expect(a.failed).toHaveLength(1);
    expect(b.failed).toHaveLength(1);
    expect(a.settlements).toEqual([]);
  });

  it('evicts the oldest region once the cap is exceeded, and a re-tick refetches', async () => {
    const calls = stubFetch((url) => okResponse(settlementFor(Number(url.match(/(\d+)\.json/)[1]))));
    const ids = Array.from({ length: SETTLEMENT_CACHE_LIMIT + 1 }, (_, index) => index + 1);
    for (const dataId of ids) await loadSettlements([dataId]);
    expect(calls).toHaveLength(ids.length);

    // The first region fell out of the LRU, so it is fetched again.
    await loadSettlements([1]);
    expect(calls).toHaveLength(ids.length + 1);

    // The most recent region is still cached.
    const before = calls.length;
    await loadSettlements([ids[ids.length - 1]]);
    expect(calls).toHaveLength(before);
  });

  it('refreshes recency on a cache hit (LRU, not FIFO)', async () => {
    const calls = stubFetch((url) => okResponse(settlementFor(Number(url.match(/(\d+)\.json/)[1]))));
    for (const dataId of [1, 2, 3, 4, 5]) await loadSettlements([dataId]);
    await loadSettlements([1]); // hit refreshes 1 -> order: 2,3,4,5,1
    await loadSettlements([6]); // order: 2,3,4,5,1,6
    await loadSettlements([7]); // evicts 2 -> order: 3,4,5,1,6,7

    const before = calls.length;
    await loadSettlements([1]); // still cached
    expect(calls).toHaveLength(before);

    await loadSettlements([2]); // evicted -> refetch
    expect(calls).toHaveLength(before + 1);
  });

  it('does not cache failures, so a later selection can retry', async () => {
    const calls = stubFetch(() => notFoundResponse());
    await loadSettlementsWithStatus([95]);
    await loadSettlementsWithStatus([95]);
    expect(calls).toHaveLength(2);
  });

  it('deduplicates repeated dataIds in one request', async () => {
    const calls = stubFetch(() => okResponse(settlementFor(74)));
    const { settlements } = await loadSettlementsWithStatus([74, 74, '74']);
    expect(calls).toHaveLength(1);
    expect(settlements).toHaveLength(1);
  });
});

describe('settlement loader: UI hint wiring (GRAFIK-43)', () => {
  it('uses the required hint wording', () => {
    expect(REGION_NO_DATA_HINT).toBe(
      'Гео-справочник для региона не загружен — используется текстовая группировка по адресам',
    );
  });

  it('UI loads on selection/tick and surfaces failed regions as a hint', () => {
    const source = readFileSync(UI_PATH, 'utf8');
    expect(source).toContain('loadSelectedRegionSettlements');
    expect(source).toContain('loadSettlementsWithStatus');
    expect(source).toContain('showRegionNoDataHint');
    expect(source).toContain('if (!checkbox.checked) return;');
  });
});
