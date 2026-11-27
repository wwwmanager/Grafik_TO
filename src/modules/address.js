// Address resolver for GRAFIK-33
// Parses owner addresses, picks region(s), resolves to OSM settlements

import { REGIONS_TABLE } from './regions-table.js';

export { REGIONS_TABLE };

const TYPE_TOKENS = [
  'г', 'п', 'пос', 'с', 'д', 'дер', 'рп', 'р-н', 'район', 'х', 'ст', 'мкр', 'тер',
  'снт', 'респ', 'край', 'ао', 'область', 'край', 'республика', 'автономная',
  'автономный', 'округ', 'областной', 'краевой', 'городской', 'сельский', 'поселковый'
];

// Region-specific suffix tokens (only strip at end of string)
// Note: 'обл' is kept as it's part of official abbreviated region names like "Челябинская обл"
const REGION_SUFFIX_TOKENS = ['область', 'край', 'республика', 'автономная', 'автономный', 'округ'];

function stripTypeTokens(text, isRegion = false) {
  let result = text.toLowerCase().replace(/ё/g, 'е');
  // Remove type tokens as prefix or suffix with/without dot
  const tokens = isRegion ? REGION_SUFFIX_TOKENS : TYPE_TOKENS;
  for (const token of tokens) {
    // prefix with dot: "г. " "п. " etc.
    result = result.replace(new RegExp(`^${token}\\.?\\s+`, 'g'), '');
    // suffix with dot: " г." " п." etc.
    result = result.replace(new RegExp(`\\s+${token}\\.?$`, 'g'), '');
    // prefix without dot: "г " "п " etc.
    result = result.replace(new RegExp(`^${token}\\s+`, 'g'), '');
    // suffix without dot: " г" " п" etc.
    result = result.replace(new RegExp(`\\s+${token}$`, 'g'), '');
  }
  // Collapse spaces and hyphens
  result = result.replace(/\s+/g, ' ').replace(/\s+-\s+/g, '-').replace(/-+/g, '-').trim();
  return result;
}

export function normalizeName(s, isRegion = false) {
  if (!s) return '';
  return stripTypeTokens(String(s), isRegion);
}

// Parse comma-separated address parts
// Part indexes are 1-based as per spec:
// 1 = region (optional, e.g. "ЧЕЛЯБИНСКАЯ ОБЛ", "РЕСП БАШКОРТОСТАН")
// 4 = district ("КУСИНСКИЙ Р-Н", empty for urban okrugs)
// 5 = city/village ("ЗЛАТОУСТ Г", "МАГНИТКА РП", "ТЮБУК С")
// 8 = inner settlement ("ТАЙНАК П")
export function parseAddress(text) {
  if (!text) return { region: '', district: '', city: '', inner: '' };
  const parts = String(text).split(',').map(p => p.trim());
  return {
    region: parts[0] || '',
    district: parts[3] || '',
    city: parts[4] || '',
    inner: parts[7] || '',
  };
}

// Build group key from parsed address - finest given level
// parent = district if present, else city
export function buildGroupKey(parsed) {
  const levels = [];
  if (parsed.inner) levels.push(normalizeName(parsed.inner));
  if (parsed.city) levels.push(normalizeName(parsed.city));
  if (parsed.district) levels.push(normalizeName(parsed.district));
  if (parsed.region) levels.push(normalizeName(parsed.region, true));
  const key = levels.join('|');
  const parent = parsed.district ? normalizeName(parsed.district) : normalizeName(parsed.city);
  return { key, parent };
}

// Detect region from records by majority vote against the regions table.
// Returns the internal dataId (stable identity); callers map it to a display code.
export function detectRegion(records, regions) {
  if (!records || !records.length) return null;
  const counts = new Map();
  for (const rec of records) {
    const parsed = parseAddress(rec.address);
    if (!parsed.region) continue;
    const normRegion = normalizeName(parsed.region, true);
    for (const reg of regions) {
      const regNorm = normalizeName(reg.name, true);
      if (normRegion === regNorm || normRegion.includes(regNorm) || regNorm.includes(normRegion)) {
        counts.set(reg.dataId, (counts.get(reg.dataId) || 0) + 1);
        break;
      }
    }
  }
  if (!counts.size) return null;
  let bestId = null, bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) { bestCount = count; bestId = id; }
  }
  return bestId;
}

// Levenshtein distance for fuzzy matching
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

// GRAFIK-43: settlement cache is an LRU (insertion-order Map, refreshed on hit)
// and concurrent callers share one in-flight request per dataId.
export const SETTLEMENT_CACHE_LIMIT = 6;

const settlementCache = new Map();
const settlementInflight = new Map();

function normalizeDataIds(dataIds) {
  const unique = [];
  const seen = new Set();
  for (const value of dataIds || []) {
    const dataId = Number(value);
    if (!Number.isInteger(dataId) || dataId <= 0 || seen.has(dataId)) continue;
    seen.add(dataId);
    unique.push(dataId);
  }
  return unique;
}

function touchCache(dataId) {
  const value = settlementCache.get(dataId);
  settlementCache.delete(dataId);
  settlementCache.set(dataId, value);
  return value;
}

function storeInCache(dataId, data) {
  settlementCache.set(dataId, data);
  while (settlementCache.size > SETTLEMENT_CACHE_LIMIT) {
    const oldest = settlementCache.keys().next().value;
    settlementCache.delete(oldest);
  }
}

function startFetch(dataId) {
  const request = (async () => {
    const url = `${import.meta.env.BASE_URL}data/settlements/${dataId}.json`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    storeInCache(dataId, data);
    return data;
  })();
  const tracked = request.then(
    (data) => {
      settlementInflight.delete(dataId);
      return data;
    },
    (error) => {
      settlementInflight.delete(dataId);
      throw error;
    },
  );
  settlementInflight.set(dataId, tracked);
  return tracked;
}

// Returns { settlements, failed: [{ dataId, reason }] }. Failures never throw
// and are not cached, so a later selection can retry a region that was down.
export async function loadSettlementsWithStatus(dataIds) {
  const unique = normalizeDataIds(dataIds);
  const failed = [];
  const batches = await Promise.all(
    unique.map(async (dataId) => {
      if (settlementCache.has(dataId)) return touchCache(dataId);
      const inflight = settlementInflight.get(dataId);
      try {
        return await (inflight || startFetch(dataId));
      } catch (error) {
        const reason = String(error?.message || error);
        console.warn(`Failed to load settlements for region dataId ${dataId}:`, error);
        failed.push({ dataId, reason });
        return null;
      }
    }),
  );
  const settlements = [];
  for (const batch of batches) {
    if (batch) settlements.push(...batch);
  }
  return { settlements, failed };
}

// Backward-compatible array return for existing callers.
export async function loadSettlements(dataIds) {
  const { settlements } = await loadSettlementsWithStatus(dataIds);
  return settlements;
}

// UI helper: an empty selection must not trigger a single settlement fetch.
export async function loadSelectedRegionSettlements(
  selection,
  { loader = loadSettlementsWithStatus } = {},
) {
  const dataId = Number(selection);
  if (!Number.isInteger(dataId) || dataId <= 0) {
    return { settlements: [], failed: [] };
  }
  return loader([dataId]);
}

// Test/perf seam: drop cached and in-flight entries.
export function clearSettlementCache() {
  settlementCache.clear();
  settlementInflight.clear();
}

// GRAFIK-45: one resolution pass that also records what could not be matched.
// Pure: no persistence, no logging of addresses (privacy), no mutation.
export function buildUnresolvedReport(records, settlements, dataId = null) {
  const index = getSettlementIndex(settlements);
  const resolved = [];
  const unresolved = [];
  let total = 0;
  (records || []).forEach((record, position) => {
    const address = record?.address;
    if (!address) return;
    total += 1;
    const match = resolveSettlement(parseAddress(address), index);
    if (match.match === 'exact' || match.match === 'fuzzy') {
      resolved.push({ ...match, dataId, rowIndex: position + 1 });
    } else {
      // 1-based position in import order (records keep the file's row order).
      unresolved.push({ index: position + 1, address: String(address), match: match.match });
    }
  });
  return {
    resolved,
    unresolved,
    total,
    resolvedCount: resolved.length,
    unresolvedCount: unresolved.length,
    clipboardText: formatUnresolvedClipboard(unresolved),
  };
}

// GRAFIK-44: resolve the export's addresses against one region's reference so
// the base settlement can be derived from the actual data.
export function resolveAddressesForBase(records, settlements, dataId = null) {
  const { resolved, total } = buildUnresolvedReport(records, settlements, dataId);
  return { resolved, total };
}

export function formatUnresolvedClipboard(unresolved = []) {
  return (unresolved || []).map((row) => `${row.index}: ${row.address}`).join('\n');
}

function geoDistanceKm(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function settlementOf(entry) {
  if (!entry) return null;
  return {
    name: entry.name,
    municipality: entry.municipality,
    lat: entry.lat,
    lon: entry.lon,
  };
}

function matchesName(candidate, settlement) {
  return (
    candidate?.name === settlement?.name &&
    (candidate?.municipality || '') === (settlement?.municipality || '')
  );
}

function addressWord(count) {
  const abs = Math.abs(Number(count) || 0);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'адресов';
  if (mod10 === 1) return 'адрес';
  if (mod10 >= 2 && mod10 <= 4) return 'адреса';
  return 'адресов';
}

export function formatBaseSettlementLabel(result) {
  if (!result || !result.settlement) return '— автоматически (нет данных) —';
  const name = result.settlement.name || '—';
  if (result.source === 'manual') return `— ${name} (выбрано вручную) —`;
  if (result.source === 'fallback') return `— автоматически (первый в регионе: ${name}) —`;
  const count = Number(result.count) || 0;
  const total = Number(result.total) || 0;
  return `— автоматически (${name}, ${count} ${addressWord(count)} из ${total}) —`;
}

// Pure rule for the base settlement (GRAFIK-44). Deterministic tie-break:
// 1) most resolved addresses; 2) nearest to the region's address centroid;
// 3) settlement name (Russian collation). A manual override wins while the
// settlement still exists in the region reference; otherwise fall back to the
// first settlement of the region (the previous behaviour).
export function pickBaseSettlement(resolved = [], regionDataId = null, overrides = {}) {
  const { manualSettlement = null, regionSettlements = [], total = null } = overrides;
  const entries = (resolved || []).filter((entry) => {
    if (regionDataId == null) return true;
    return entry?.dataId == null || Number(entry.dataId) === Number(regionDataId);
  });
  const totalCount = total == null ? entries.length : Number(total);

  if (manualSettlement) {
    const existing = (regionSettlements || []).find((candidate) =>
      matchesName(manualSettlement, candidate),
    );
    if (existing || (regionSettlements || []).length === 0) {
      const key = `${manualSettlement.name}|${manualSettlement.municipality || ''}`;
      const count = entries.filter(
        (entry) => (entry.key || `${entry.name}|${entry.municipality || ''}`) === key,
      ).length;
      return {
        settlement: settlementOf(manualSettlement),
        source: 'manual',
        count,
        total: totalCount,
        key,
      };
    }
  }

  if (entries.length === 0) {
    const first = (regionSettlements || [])[0] || null;
    return {
      settlement: settlementOf(first),
      source: 'fallback',
      count: 0,
      total: totalCount,
      key: first ? `${first.name}|${first.municipality || ''}` : null,
    };
  }

  const groups = new Map();
  let centroidLat = 0;
  let centroidLon = 0;
  let centroidCount = 0;
  for (const entry of entries) {
    const key = entry.key || `${entry.name}|${entry.municipality || ''}`;
    if (!groups.has(key)) groups.set(key, { key, entries: [] });
    groups.get(key).entries.push(entry);
    if (Number.isFinite(entry.lat) && Number.isFinite(entry.lon)) {
      centroidLat += entry.lat;
      centroidLon += entry.lon;
      centroidCount += 1;
    }
  }
  const centroid =
    centroidCount > 0
      ? { lat: centroidLat / centroidCount, lon: centroidLon / centroidCount }
      : null;

  const ranked = [...groups.values()].map((group) => {
    let groupLat = 0;
    let groupLon = 0;
    let groupCount = 0;
    for (const entry of group.entries) {
      if (Number.isFinite(entry.lat) && Number.isFinite(entry.lon)) {
        groupLat += entry.lat;
        groupLon += entry.lon;
        groupCount += 1;
      }
    }
    const representative =
      group.entries.find(
        (entry) => Number.isFinite(entry.lat) && Number.isFinite(entry.lon),
      ) || group.entries[0];
    const distance =
      centroid && groupCount > 0
        ? geoDistanceKm(
            centroid.lat,
            centroid.lon,
            groupLat / groupCount,
            groupLon / groupCount,
          )
        : Infinity;
    return { ...group, representative, distance, count: group.entries.length };
  });

  ranked.sort(
    (a, b) =>
      b.count - a.count ||
      a.distance - b.distance ||
      String(a.representative.name || '').localeCompare(
        String(b.representative.name || ''),
        'ru',
      ) ||
      String(a.key).localeCompare(String(b.key), 'ru'),
  );

  const winner = ranked[0];
  return {
    settlement: settlementOf(winner.representative),
    source: 'auto',
    count: winner.count,
    total: totalCount,
    key: winner.key,
  };
}

// GRAFIK-47: the normalized lookup is built once per settlement list, never
// once per address (that was 150 x 1267 x 2 normalizations on the real export).
const settlementIndexCache = new WeakMap();

export function createSettlementIndex(settlements) {
  const pairs = [];
  const pairByKey = new Map();
  const byName = new Map();
  const byMunicipality = new Map();
  for (const settlement of settlements) {
    const name = normalizeName(settlement.name);
    const municipality = normalizeName(settlement.municipality);
    const key = `${name}|${municipality}`;
    let pair = pairByKey.get(key);
    if (!pair) {
      pair = { key, name, municipality, list: [] };
      pairByKey.set(key, pair);
      pairs.push(pair);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(pair);
      if (!byMunicipality.has(municipality)) byMunicipality.set(municipality, []);
      byMunicipality.get(municipality).push(pair);
    }
    pair.list.push(settlement);
  }
  return { settlements, pairs, pairByKey, byName, byMunicipality };
}

export function getSettlementIndex(settlements) {
  if (Array.isArray(settlements)) {
    let index = settlementIndexCache.get(settlements);
    if (!index) {
      index = createSettlementIndex(settlements);
      settlementIndexCache.set(settlements, index);
    }
    return index;
  }
  if (settlements && settlements.byName && Array.isArray(settlements.pairs)) {
    return settlements;
  }
  return createSettlementIndex([]);
}

// Resolve a parsed address to a settlement reference. Accepts either the raw
// settlements array (index cached per array) or a prebuilt index.
export function resolveSettlement(parsed, settlements) {
  const index = getSettlementIndex(settlements);

  // Try exact match at finest level first
  const candidates = [];
  const pushPair = (pair) => {
    for (const settlement of pair.list) {
      candidates.push({ ...settlement, match: 'exact', key: pair.key });
    }
  };

  // Inner settlement match
  if (parsed.inner) {
    const normInner = normalizeName(parsed.inner);
    const normCity = normalizeName(parsed.city);
    const normDistrict = normalizeName(parsed.district);

    for (const pair of index.byName.get(normInner) || []) {
      // Prefer matching municipality (district/city)
      if (normDistrict && pair.municipality === normDistrict) {
        return { ...pair.list[0], match: 'exact', key: pair.key };
      }
      if (normCity && pair.municipality === normCity) {
        return { ...pair.list[0], match: 'exact', key: pair.key };
      }
      pushPair(pair);
    }
  }

  // City/village match
  if (parsed.city) {
    const normCity = normalizeName(parsed.city);
    const normDistrict = normalizeName(parsed.district);

    for (const pair of index.byName.get(normCity) || []) {
      if (normDistrict && pair.municipality === normDistrict) {
        return { ...pair.list[0], match: 'exact', key: pair.key };
      }
      pushPair(pair);
    }
  }

  // District match (only for urban okrugs without city, or when no city/inner specified)
  if (parsed.district && !parsed.city && !parsed.inner) {
    const normDistrict = normalizeName(parsed.district);
    for (const pair of index.byMunicipality.get(normDistrict) || []) {
      pushPair(pair);
    }
  }
  
  // If we have exact matches but multiple, disambiguate
  if (candidates.length === 1) {
    return { ...candidates[0], match: 'exact' };
  }
  if (candidates.length > 1) {
    // Prefer by settlement type from address string
    const typeFromAddress = inferTypeFromAddress(parsed);
    const typed = candidates.filter(c => c.type === typeFromAddress);
    if (typed.length === 1) return { ...typed[0], match: 'exact' };
    
    // Mark ambiguous for manual choice
    return { 
      key: candidates[0].name, 
      name: candidates[0].name, 
      parent: candidates[0].municipality,
      municipality: candidates[0].municipality,
      region: '',
      lat: candidates[0].lat,
      lon: candidates[0].lon,
      match: 'ambiguous',
      candidates: candidates.map(c => ({ name: c.name, municipality: c.municipality, type: c.type }))
    };
  }
  
  // Fuzzy match (Levenshtein <= 2) - only if unique among all matches within distance <= 2
  const searchName = parsed.inner || parsed.city || parsed.district;
  if (searchName) {
    const normSearch = normalizeName(searchName);
    let bestMatch = null;
    let bestDist = Infinity;
    let matchCount = 0;
    
    for (const pair of index.pairs) {
      const dist = levenshtein(normSearch, pair.name);
      if (dist <= 2) {
        matchCount++;
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = pair.list[0];
        }
      }
    }
    
    if (bestMatch && matchCount === 1 && bestDist > 0) {
      return { ...bestMatch, match: 'fuzzy' };
    }
  }
  
  // No match - return text key
  const textKey = [parsed.inner, parsed.city, parsed.district, parsed.region]
    .filter(Boolean).join(' > ') || 'unknown';
  return { key: textKey, name: textKey, match: 'none' };
}

function inferTypeFromAddress(parsed) {
  const text = [parsed.inner, parsed.city, parsed.district].join(' ').toUpperCase();
  if (/\b(Г|ГОРОД)\b/.test(text)) return 'city';
  if (/\b(П|ПОС|ПОСЕЛОК)\b/.test(text)) return 'town';
  if (/\b(С|СЕЛО|Д|ДЕР|ДЕРЕВНЯ)\b/.test(text)) return 'village';
  if (/\b(РП|РАБОЧИЙ ПОСЕЛОК)\b/.test(text)) return 'town';
  if (/\b(Х|ХУТОР)\b/.test(text)) return 'hamlet';
  if (/\b(СТ|СТАНЦИЯ)\b/.test(text)) return 'hamlet';
  if (/\b(МКР|МИКРОРАЙОН)\b/.test(text)) return 'hamlet';
  if (/\b(ТЕР|ТЕРРИТОРИЯ)\b/.test(text)) return 'hamlet';
  if (/\b(СНТ| САДОВОЕ)\b/.test(text)) return 'hamlet';
  return 'village'; // default
}

// Settings block 4: Region selection UI helpers
export function getRegionsForSelect() {
  return REGIONS_TABLE.map(r => ({
    dataId: r.dataId,
    fnsCode: r.fnsCode,
    gibddCode: r.gibddCode,
    name: r.name,
    iso: r.iso,
  }));
}

export function getDefaultRegionSettings(detectedDataId) {
  return {
    inspectionRegion: detectedDataId || null, // stores dataId for persistence
    neighboringRegions: [],
    hint: detectedDataId ? null : 'Выберите регион инспекции'
  };
}

export function persistRegionSettings(settings) {
  try {
    localStorage.setItem('grafik:regionSettings', JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to persist region settings:', e);
  }
}

export function loadRegionSettings() {
  try {
    const stored = localStorage.getItem('grafik:regionSettings');
    return stored ? JSON.parse(stored) : { inspectionRegion: null, neighboringRegions: [], hint: 'Выберите регион инспекции' };
  } catch {
    return { inspectionRegion: null, neighboringRegions: [], hint: 'Выберите регион инспекции' };
  }
}