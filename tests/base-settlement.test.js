import { describe, expect, it } from 'vitest';

import {
  formatBaseSettlementLabel,
  parseAddress,
  pickBaseSettlement,
  resolveAddressesForBase,
} from '../src/modules/address.js';

const REGION = 74;

function settlement(name, municipality, lat, lon) {
  return { name, municipality, lat, lon };
}

// One entry per address; every entry is tagged with the region it resolved in.
function address(settlementRef, dataId = REGION) {
  return {
    name: settlementRef.name,
    municipality: settlementRef.municipality,
    lat: settlementRef.lat,
    lon: settlementRef.lon,
    key: `${settlementRef.name}|${settlementRef.municipality}`,
    dataId,
  };
}

function repeat(entry, count) {
  return Array.from({ length: count }, () => ({ ...entry }));
}

describe('pickBaseSettlement (GRAFIK-44)', () => {
  const tainak = settlement('Тайнак', 'Златоуст', 55.14104, 59.34924);
  const zlatoust = settlement('Златоуст', 'Златоуст', 55.16742, 59.67926);
  const kuvashi = settlement('Куваши', 'Златоуст', 55.15548, 59.4123);

  it('picks the only resolved settlement', () => {
    const result = pickBaseSettlement(repeat(address(tainak), 4), REGION, {
      regionSettlements: [tainak, zlatoust, kuvashi],
      total: 4,
    });
    expect(result.source).toBe('auto');
    expect(result.settlement.name).toBe('Тайнак');
    expect(result.count).toBe(4);
    expect(result.total).toBe(4);
  });

  it('picks the clear mode when one settlement dominates', () => {
    const resolved = [
      ...repeat(address(tainak), 5),
      ...repeat(address(zlatoust), 2),
      ...repeat(address(kuvashi), 1),
    ];
    const result = pickBaseSettlement(resolved, REGION, {
      regionSettlements: [tainak, zlatoust, kuvashi],
      total: 8,
    });
    expect(result.settlement.name).toBe('Тайнак');
    expect(result.count).toBe(5);
  });

  it('breaks an exact 3 vs 3 tie by distance to the address centroid', () => {
    const near = settlement('Ближний', 'Район', 55.2, 59.2);
    const far = settlement('Дальний', 'Район', 55.0, 59.0);
    const anchor = settlement('Якорь', 'Район', 56.0, 60.0);
    const resolved = [
      ...repeat(address(near), 3),
      ...repeat(address(far), 3),
      address(anchor),
    ];
    const result = pickBaseSettlement(resolved, REGION, {
      regionSettlements: [near, far, anchor],
      total: 7,
    });
    expect(result.count).toBe(3);
    expect(result.settlement.name).toBe('Ближний');
  });

  it('breaks a full tie (same count, same distance) by settlement name', () => {
    const alfa = settlement('Альфа', 'Район', 55.0, 59.0);
    const beta = settlement('Бета', 'Район', 55.0, 59.0);
    const resolved = [...repeat(address(beta), 3), ...repeat(address(alfa), 3)];
    const result = pickBaseSettlement(resolved, REGION, {
      regionSettlements: [beta, alfa],
      total: 6,
    });
    expect(result.count).toBe(3);
    expect(result.settlement.name).toBe('Альфа');
  });

  it('ignores resolved addresses from a neighbouring region', () => {
    const neighbour = settlement('Соседний', 'Соседний район', 55.3, 59.5);
    const resolved = [
      ...repeat(address(neighbour, 95), 10),
      address(tainak),
    ];
    const result = pickBaseSettlement(resolved, REGION, {
      regionSettlements: [tainak, zlatoust],
      total: 11,
    });
    expect(result.settlement.name).toBe('Тайнак');
    expect(result.count).toBe(1);
  });

  it('falls back to the first settlement of the region when nothing resolves', () => {
    const result = pickBaseSettlement([], REGION, {
      regionSettlements: [zlatoust, tainak],
      total: 118,
    });
    expect(result.source).toBe('fallback');
    expect(result.settlement.name).toBe('Златоуст');
    expect(result.count).toBe(0);
    expect(result.total).toBe(118);
    expect(formatBaseSettlementLabel(result)).toContain('первый в регионе');
  });

  it('returns null without throwing when there is no reference at all', () => {
    const result = pickBaseSettlement([], REGION, { regionSettlements: [], total: 0 });
    expect(result.settlement).toBeNull();
    expect(result.source).toBe('fallback');
    expect(formatBaseSettlementLabel(result)).toBe('— автоматически (нет данных) —');
  });

  it('lets a manual override win while the settlement still exists', () => {
    const resolved = repeat(address(tainak), 9);
    const result = pickBaseSettlement(resolved, REGION, {
      manualSettlement: zlatoust,
      regionSettlements: [tainak, zlatoust],
      total: 9,
    });
    expect(result.source).toBe('manual');
    expect(result.settlement.name).toBe('Златоуст');
    expect(result.count).toBe(0);
  });

  it('preserves a manual override after a re-import when the settlement exists', () => {
    const reimported = repeat(address(tainak), 3);
    const result = pickBaseSettlement(reimported, REGION, {
      manualSettlement: { name: 'Златоуст', municipality: 'Златоуст', lat: 55.1, lon: 59.6 },
      regionSettlements: [tainak, zlatoust],
      total: 3,
    });
    expect(result.source).toBe('manual');
    expect(result.settlement.name).toBe('Златоуст');
  });

  it('ignores a manual override whose settlement no longer exists', () => {
    const result = pickBaseSettlement(repeat(address(tainak), 2), REGION, {
      manualSettlement: settlement('Исчезнувший', 'Район', 55.9, 60.1),
      regionSettlements: [tainak, zlatoust],
      total: 2,
    });
    expect(result.source).toBe('auto');
    expect(result.settlement.name).toBe('Тайнак');
  });

  it('is deterministic and does not mutate its input', () => {
    const resolved = [
      ...repeat(address(tainak), 2),
      ...repeat(address(zlatoust), 2),
    ];
    const snapshot = JSON.stringify(resolved);
    const first = pickBaseSettlement(resolved, REGION, { regionSettlements: [tainak, zlatoust] });
    const second = pickBaseSettlement(resolved, REGION, { regionSettlements: [tainak, zlatoust] });
    expect(second).toEqual(first);
    expect(JSON.stringify(resolved)).toBe(snapshot);
  });
});

describe('formatBaseSettlementLabel (GRAFIK-44)', () => {
  it('renders the required auto label with the address counts', () => {
    const label = formatBaseSettlementLabel({
      settlement: settlement('Тайнак', 'Златоуст', 55.14, 59.34),
      source: 'auto',
      count: 42,
      total: 118,
    });
    expect(label).toBe('— автоматически (Тайнак, 42 адреса из 118) —');
  });

  it('uses Russian plural forms', () => {
    const base = { settlement: { name: 'Тайнак' }, source: 'auto', total: 10 };
    expect(formatBaseSettlementLabel({ ...base, count: 1 })).toContain('1 адрес');
    expect(formatBaseSettlementLabel({ ...base, count: 2 })).toContain('2 адреса');
    expect(formatBaseSettlementLabel({ ...base, count: 5 })).toContain('5 адресов');
    expect(formatBaseSettlementLabel({ ...base, count: 11 })).toContain('11 адресов');
    expect(formatBaseSettlementLabel({ ...base, count: 21 })).toContain('21 адрес');
    expect(formatBaseSettlementLabel({ ...base, count: 22 })).toContain('22 адреса');
  });
});

describe('resolveAddressesForBase (GRAFIK-44)', () => {
  const tainak = settlement('Тайнак', 'Златоуст', 55.14104, 59.34924);
  const zlatoust = settlement('Златоуст', 'Златоуст', 55.16742, 59.67926);
  const settlements = [tainak, zlatoust];

  it('tags resolved addresses with the region and counts unresolved ones in total', () => {
    const records = [
      { address: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ТАЙНАК П' },
      { address: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ТАЙНАК П' },
      { address: 'ЧЕЛЯБИНСКАЯ ОБЛ, , , НЕСУЩЕСТВУЮЩИЙ Р-Н, НЕТ Г, , , НЕТ П' },
      { address: '' },
    ];
    const { resolved, total } = resolveAddressesForBase(records, settlements, REGION);
    expect(total).toBe(3); // records with a non-empty address
    expect(resolved).toHaveLength(2);
    expect(resolved.every((entry) => entry.dataId === REGION)).toBe(true);
    expect(resolved[0].name).toBe('Тайнак');

    const picked = pickBaseSettlement(resolved, REGION, { regionSettlements: settlements, total });
    expect(picked.settlement.name).toBe('Тайнак');
    expect(picked.count).toBe(2);
    expect(picked.total).toBe(3);
  });

  it('parses the documented synthetic example', () => {
    const parsed = parseAddress('ЧЕЛЯБИНСКАЯ ОБЛ, , , КУСИНСКИЙ Р-Н, ЗЛАТОУСТ Г, , , ТАЙНАК П');
    expect(parsed.district).toBe('КУСИНСКИЙ Р-Н');
    expect(parsed.city).toBe('ЗЛАТОУСТ Г');
    expect(parsed.inner).toBe('ТАЙНАК П');
  });
});
